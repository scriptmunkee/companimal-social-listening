// Reddit, via Google's licensed index of Reddit (through DataForSEO).
// We never call Reddit directly: Reddit blocks automated access from servers and
// closed its API to new users, and we don't work around that.
//
// Two kinds of search feed one thread registry:
//  - subreddit searches (site:reddit.com/r/x, past day/week) for fresh threads
//  - topic searches that trigger Google's "Discussions and forums" block, which lists
//    Reddit threads with their comment count (posts_count): the "doing well" signal
// Every sighting is logged, so comment growth and repeat appearances can be tracked.

import {
  PROJECT, SUBREDDITS, SUBREDDIT_DEPTH, REDDIT_FACETS, REDDIT_FACETS_PER_DAY,
  REDDIT_TOPIC_QUERIES, REDDIT_TOPIC_PER_DAY, REDDIT_SNOWBALL_PER_DAY, REDDIT_TRACKED_PER_DAY,
} from "../../config/taxonomy";
import { Env, Item, nowIso, today, dayOfYear, clean, daysAgo } from "../lib";

export interface RedditRef { postId: string; subreddit: string; url: string }

/** Pull Reddit's post id and subreddit from a thread URL. Non-thread URLs return null. */
export function parseRedditUrl(url: string | null | undefined): RedditRef | null {
  if (!url) return null;
  const m = url.match(/reddit\.com\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)(?:\/([^/?#]*))?/i);
  if (!m) return null;
  const [, sub, id, slug] = m;
  return { postId: id.toLowerCase(), subreddit: sub, url: `https://www.reddit.com/r/${sub}/comments/${id}/${slug ? slug + "/" : ""}` };
}

export interface RedditHit extends RedditRef {
  title: string | null; snippet: string | null; createdAt: string | null;
  rank: number | null; postsCount: number | null; via: "organic" | "discussions";
}

/** Strip Google's " : r/dogs" title suffix and "12 hours ago — " snippet prefix. */
const cleanTitle = (t: unknown) => clean(String(t || "").replace(/\s*[:|-]\s*r\/\w+\s*$/i, "").replace(/\s*-\s*Reddit\s*$/i, ""), 300);
const cleanSnippet = (s: unknown) => clean(String(s || "").replace(/^[^—]{0,40}ago\s*—\s*/i, "").replace(/\s*Read more\s*$/i, ""), 1200);

/** Every Reddit thread in one Google result page, from organic results and the Discussions block. */
export function redditHitsFromSerp(result: any): RedditHit[] {
  const out: RedditHit[] = [];
  for (const el of result?.items || []) {
    if (el.type === "organic") {
      const ref = parseRedditUrl(el.url);
      if (ref) out.push({ ...ref, title: cleanTitle(el.title), snippet: cleanSnippet(el.description), createdAt: el.timestamp || null, rank: el.rank_group ?? null, postsCount: null, via: "organic" });
    }
    if (el.type === "discussions_and_forums") {
      for (const d of el.items || []) {
        const ref = parseRedditUrl(d.url);
        if (ref) out.push({ ...ref, title: cleanTitle(d.title), snippet: cleanSnippet(d.description || d.snippet), createdAt: d.timestamp || null, rank: el.rank_absolute ?? null, postsCount: typeof d.posts_count === "number" ? d.posts_count : null, via: "discussions" });
      }
    }
  }
  return out;
}

/** Upsert threads and log sightings. Returns items for the shared pipeline (question bank, topics). */
export async function recordRedditHits(env: Env, hits: RedditHit[], query: string): Promise<Item[]> {
  if (!hits.length) return [];
  const now = nowIso(), day = today();
  const stmts: D1PreparedStatement[] = [];
  for (const h of hits) {
    stmts.push(env.DB.prepare(`
      INSERT INTO reddit_threads (post_id, project, subreddit, url, title, snippet, created_at, first_seen, last_seen, seen_count, best_rank, posts_count, posts_count_max, via)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 1, ?9, ?10, COALESCE(?10, 0), ?11)
      ON CONFLICT(post_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        seen_count = reddit_threads.seen_count + 1,
        best_rank = MIN(COALESCE(reddit_threads.best_rank, 999), COALESCE(excluded.best_rank, 999)),
        title = COALESCE(reddit_threads.title, excluded.title),
        snippet = CASE WHEN length(COALESCE(excluded.snippet,'')) > length(COALESCE(reddit_threads.snippet,'')) THEN excluded.snippet ELSE reddit_threads.snippet END,
        created_at = COALESCE(reddit_threads.created_at, excluded.created_at),
        posts_count_prev = CASE WHEN excluded.posts_count IS NOT NULL AND excluded.posts_count <> COALESCE(reddit_threads.posts_count, -1) THEN reddit_threads.posts_count ELSE reddit_threads.posts_count_prev END,
        posts_count = COALESCE(excluded.posts_count, reddit_threads.posts_count),
        posts_count_max = MAX(COALESCE(reddit_threads.posts_count_max, 0), COALESCE(excluded.posts_count, 0)),
        via = CASE WHEN excluded.via = 'discussions' THEN 'discussions' ELSE reddit_threads.via END`)
      .bind(h.postId, PROJECT.id, h.subreddit, h.url, h.title, h.snippet, h.createdAt, now, h.rank, h.postsCount, h.via));
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO reddit_thread_hits (post_id, seen_date, query, rank, posts_count, via) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(h.postId, day, query.slice(0, 200), h.rank, h.postsCount, h.via));
    if (h.postsCount !== null) {
      stmts.push(env.DB.prepare(`UPDATE items SET engagement = MAX(engagement, ?2) WHERE id = ?1`).bind(`reddit:${h.postId}`, h.postsCount));
    }
  }
  for (let i = 0; i < stmts.length; i += 60) await env.DB.batch(stmts.slice(i, i + 60));
  return hits.map((h) => ({
    source: "reddit", source_id: h.postId, url: h.url, title: h.title, text: h.snippet,
    community: `r/${h.subreddit}`, published_at: h.createdAt, query, engagement: h.postsCount ?? 0,
  }));
}

/** Questions recently pulled out of Reddit and People Also Ask, not searched in the last 30 days. */
async function snowballQueries(env: Env, limit: number): Promise<string[]> {
  const rows = await env.DB.prepare(`
    SELECT e.question AS q, COUNT(*) AS n FROM enrichments e JOIN items i ON i.id = e.item_id
    WHERE i.project=?1 AND e.question IS NOT NULL AND i.source IN ('reddit','serp_paa') AND i.collected_date >= ?2
      AND COALESCE(e.kind,'') <> 'irrelevant' AND COALESCE(e.region,'unknown') <> 'non_uk'
      AND length(e.question) BETWEEN 25 AND 110
      AND e.question NOT IN (SELECT query FROM reddit_queries WHERE last_run >= ?3)
    GROUP BY e.question ORDER BY n DESC, MAX(i.engagement) DESC LIMIT ?4`)
    .bind(PROJECT.id, daysAgo(14), daysAgo(30), limit).all<any>();
  return (rows.results || []).map((r: any) => String(r.q));
}

function rotate<T>(list: T[], n: number, salt = 0): T[] {
  if (!list.length) return [];
  const start = ((dayOfYear() + salt) * n) % list.length;
  return Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(start + i) % list.length]);
}

/** Queue today's Reddit searches. "full" runs every topic search (used for a one-off backfill). */
export async function postRedditTasks(env: Env, mode: "daily" | "full" = "daily") {
  const base = { location_code: PROJECT.locationCode, language_code: PROJECT.languageCode };
  const tasks: any[] = [];

  // Fresh threads per subreddit: past day (plain), plus past week from a few rotating angles
  for (const { sub, filter } of SUBREDDITS) {
    const site = `site:reddit.com/r/${sub}${filter ? ` ${filter}` : ""}`;
    tasks.push({ ...base, keyword: site, depth: SUBREDDIT_DEPTH, search_param: "&tbs=qdr:d", tag: `csl|${PROJECT.id}|reddit_sub|${site} (day)` });
    tasks.push({ ...base, keyword: site, depth: SUBREDDIT_DEPTH, search_param: "&tbs=qdr:w", tag: `csl|${PROJECT.id}|reddit_sub|${site} (week)` });
    if (!filter) {
      const facets = mode === "full" ? REDDIT_FACETS.slice(0, 4) : rotate(REDDIT_FACETS, REDDIT_FACETS_PER_DAY, sub.length);
      for (const f of facets) tasks.push({ ...base, keyword: `${site} ${f}`, depth: 20, search_param: "&tbs=qdr:w", tag: `csl|${PROJECT.id}|reddit_sub|${site} ${f}` });
    }
  }

  // Topic searches for Discussions and forums (comment counts), plus harvested questions
  const topics = mode === "full" ? REDDIT_TOPIC_QUERIES : rotate(REDDIT_TOPIC_QUERIES, REDDIT_TOPIC_PER_DAY);
  const snowball = await snowballQueries(env, REDDIT_SNOWBALL_PER_DAY);
  // Searches that surfaced threads with comment counts recently: re-run daily to measure growth
  const tracked = ((await env.DB.prepare(`SELECT query, MAX(posts_count) AS c FROM reddit_thread_hits
    WHERE via='discussions' AND seen_date >= ?1 AND query NOT LIKE 'site:%' GROUP BY query ORDER BY c DESC LIMIT ?2`)
    .bind(daysAgo(14), REDDIT_TRACKED_PER_DAY).all<any>()).results || []).map((r: any) => String(r.query));
  const topicSet = [...new Set([...topics, ...tracked, ...snowball])];
  for (const q of topicSet) tasks.push({ ...base, keyword: q, depth: 10, tag: `csl|${PROJECT.id}|reddit_topic|${q}` });

  const mark = topicSet.map((q) => env.DB.prepare(`INSERT INTO reddit_queries (query, source, last_run, runs) VALUES (?1, ?2, ?3, 1)
    ON CONFLICT(query) DO UPDATE SET last_run=excluded.last_run, runs=reddit_queries.runs+1`).bind(q, snowball.includes(q) ? "snowball" : "seed", nowIso()));
  for (let i = 0; i < mark.length; i += 60) await env.DB.batch(mark.slice(i, i + 60));

  if (env.MOCK === "1") {
    for (const t of tasks) {
      const [, , kind, query] = t.tag.split("|");
      await env.DB.prepare(`INSERT OR IGNORE INTO serp_tasks (task_id, project, kind, query, posted_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(`mock-${kind}-${query}-${Math.random()}`, PROJECT.id, kind, query, nowIso()).run();
    }
    return { added: 0, seen: 0, note: `mock posted ${tasks.length} (${snowball.length} snowball)` };
  }

  let cost = 0, posted = 0;
  for (let i = 0; i < tasks.length; i += 100) {
    const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/task_post", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`), "Content-Type": "application/json" },
      body: JSON.stringify(tasks.slice(i, i + 100)),
    });
    if (!res.ok) throw new Error(`DataForSEO task_post HTTP ${res.status}`);
    const json: any = await res.json();
    cost += json.cost || 0;
    const ins: D1PreparedStatement[] = [];
    for (const t of json.tasks || []) {
      if (t.status_code !== 20100) continue;
      const [, , kind, query] = String(t.data?.tag || "").split("|");
      ins.push(env.DB.prepare(`INSERT OR IGNORE INTO serp_tasks (task_id, project, kind, query, posted_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(t.id, PROJECT.id, kind, query, nowIso()));
      posted++;
    }
    for (let j = 0; j < ins.length; j += 60) await env.DB.batch(ins.slice(j, j + 60));
  }
  return { added: 0, seen: 0, cost, note: `posted ${posted} Reddit searches (${tracked.length} tracked, ${snowball.length} harvested questions)` };
}

/**
 * One-off: fold Reddit threads collected before the registry existed into it, and swap their
 * generic forum items for Reddit items so each thread counts once.
 */
export async function backfillRedditItems(env: Env) {
  const rows = (await env.DB.prepare(`SELECT id, url, title, text, published_at, query, engagement FROM items
    WHERE project=?1 AND source IN ('serp_forum','serp_discussions') AND url LIKE '%reddit.com/r/%/comments/%'`).bind(PROJECT.id).all<any>()).results || [];
  const hits: RedditHit[] = [];
  for (const r of rows) {
    const ref = parseRedditUrl(r.url);
    if (ref) hits.push({ ...ref, title: cleanTitle(r.title), snippet: cleanSnippet(r.text), createdAt: r.published_at, rank: null, postsCount: null, via: "organic" });
  }
  const items = await recordRedditHits(env, hits, "backfill");
  const del: D1PreparedStatement[] = [];
  for (const r of rows) {
    del.push(env.DB.prepare(`DELETE FROM enrichments WHERE item_id=?1`).bind(r.id));
    del.push(env.DB.prepare(`DELETE FROM items WHERE id=?1`).bind(r.id));
  }
  for (let i = 0; i < del.length; i += 80) await env.DB.batch(del.slice(i, i + 80));
  return { items, note: `${hits.length} earlier Reddit results moved into the thread registry` };
}

/** "Doing well" score: comments, comment growth, repeat sightings, Google rank, freshness. */
export function threadScore(t: { posts_count?: number | null; posts_count_prev?: number | null; seen_count?: number | null; best_rank?: number | null; created_at?: string | null; first_seen?: string | null }): number {
  const comments = t.posts_count || 0;
  const growth = Math.max(0, comments - (t.posts_count_prev ?? comments));
  const ageDays = (Date.now() - Date.parse(t.created_at || t.first_seen || new Date().toISOString())) / 86400000;
  const fresh = ageDays <= 2 ? 3 : ageDays <= 7 ? 1.5 : ageDays <= 30 ? 0.5 : 0;
  const rank = t.best_rank && t.best_rank < 999 ? Math.max(0, 11 - Math.min(t.best_rank, 11)) * 0.25 : 0;
  return Math.round((Math.log2(1 + comments) * 3 + Math.log2(1 + growth) * 2 + Math.log2(1 + (t.seen_count || 1)) * 2 + rank + fresh) * 10) / 10;
}
