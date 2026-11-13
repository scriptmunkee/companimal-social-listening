// Reddit via Serpent API (apiserpent.com): subreddit feeds with real upvotes, comment counts
// and post bodies, Reddit search, and full comment threads.
//
//  - Feeds (new, hot, rising) for each watched subreddit every few hours: every new thread,
//    plus an upvote and comment snapshot each time, so growth is measured rather than guessed.
//  - Top of the week and month once a day: what did best.
//  - Searches once a day (topic bank, harvested questions, UK subreddits): threads anywhere on
//    Reddit, including the evergreen ones people keep finding.
//  - Comment threads for threads with a few comments, fetched again when they keep growing.
//
// Everything lands in the same thread registry as the Google route, which stays as the fallback.

import {
  PROJECT, SUBREDDITS, REDDIT_FEEDS, REDDIT_TOP, REDDIT_TOPIC_QUERIES, REDDIT_UK_SEARCHES, REDDIT_SNOWBALL_PER_DAY,
  REDDIT_DOG_FILTER, REDDIT_COMMENTS_MIN, REDDIT_COMMENTS_PER_DAY, REDDIT_COMMENTS_PER_TICK, REDDIT_COMMENTS_REFETCH_GROWTH,
} from "../../config/taxonomy";
import { Env, Item, nowIso, today, clean, daysAgo, sha256, archiveRaw, saveItems } from "../lib";
import { snowballQueries } from "./reddit";

const BASE = "https://apiserpent.com/api/reddit";
const PRICE_PER_UNIT = 0.12 / 1000; // Default plan; posts and comments cost one unit per started block of 25

export const hasSerpent = (env: Env) => !!env.SERPENT_API_KEY || env.MOCK === "1";

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

class SerpentError extends Error {}

const unitsFor = (path: string, limit?: number) => (path === "/posts" || path === "/comments") ? Math.ceil((limit || 25) / 25) : 1;

async function serpent(env: Env, path: string, params: Record<string, string | number | boolean>, usage: Usage): Promise<any> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  if (env.MOCK === "1") { usage.add(path, unitsFor(path, Number(params.limit))); return mockResponse(path, params); }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: { "X-API-Key": env.SERPENT_API_KEY! } });
    if (res.status === 402) throw new SerpentError("Serpent API is out of credit (402 Payment Required): top up at apiserpent.com");
    if (res.status === 401 || res.status === 403) throw new SerpentError(`Serpent API rejected the key (HTTP ${res.status}): check the SERPENT_API_KEY secret`);
    if (res.status === 429 || res.status === 503 || res.status === 502) {
      // Throttled or briefly unavailable: not billed. Wait as told (capped) and try again.
      const wait = Math.min(10, Number(res.headers.get("Retry-After")) || 2 * (attempt + 1));
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status === 404) { usage.add(path, unitsFor(path, Number(params.limit))); return null; } // removed thread or community
    const body: any = await res.json().catch(() => null);
    if (!res.ok || !body?.success) throw new Error(`Serpent ${path} HTTP ${res.status}: ${String(body?.message || body?.error || "").slice(0, 160)}`);
    usage.add(path, unitsFor(path, Number(params.limit)));
    return body;
  }
  return null; // still throttled after retries: skip this one, the next run picks it up
}

/** Counts paid calls so each run reports its cost and the daily comment ceiling holds. */
class Usage {
  calls = new Map<string, { calls: number; units: number }>();
  add(path: string, units: number) {
    const k = path.replace(/^\//, "");
    const c = this.calls.get(k) || { calls: 0, units: 0 };
    c.calls++; c.units += units;
    this.calls.set(k, c);
  }
  get cost() { let u = 0; for (const c of this.calls.values()) u += c.units; return Math.round(u * PRICE_PER_UNIT * 10000) / 10000; }
  get summary() { return [...this.calls.entries()].map(([k, c]) => `${c.calls} ${k}`).join(", "); }
  async save(env: Env) {
    const day = today();
    const stmts = [...this.calls.entries()].map(([kind, c]) => env.DB.prepare(`INSERT INTO api_usage (day, api, kind, calls, units) VALUES (?1, 'serpent', ?2, ?3, ?4)
      ON CONFLICT(day, api, kind) DO UPDATE SET calls = calls + excluded.calls, units = units + excluded.units`).bind(day, kind, c.calls, c.units));
    if (stmts.length) await env.DB.batch(stmts);
  }
}

/** Run fn over items, n at a time, stopping before the deadline. Serpent allows parallel calls. */
async function pool<T>(items: T[], n: number, deadline: number, fn: (x: T) => Promise<void>) {
  let i = 0, firstError: unknown = null;
  const worker = async () => {
    while (i < items.length && Date.now() < deadline && !firstError) {
      const x = items[i++];
      try { await fn(x); } catch (e) { if (e instanceof SerpentError) firstError = e; else console.error("serpent call failed", String((e as any)?.message || e)); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (firstError) throw firstError; // out of credit or bad key: stop and let the health check email
  return i;
}

// ---------------------------------------------------------------------------
// Storing posts
// ---------------------------------------------------------------------------

interface ApiPost {
  id: string; title: string; selftext: string | null; author: string | null; subreddit: string;
  score: number | null; upvote_ratio: number | null; num_comments: number | null; created_at: string | null;
  permalink: string | null; url: string | null; post_type: string | null; flair: { text?: string } | null;
  stickied?: boolean; is_nsfw?: boolean;
}

const threadUrl = (p: { permalink?: string | null; subreddit: string; id: string }) =>
  p.permalink ? `https://www.reddit.com${p.permalink}` : `https://www.reddit.com/r/${p.subreddit}/comments/${p.id}/`;
const isoOrNull = (s: unknown) => { const t = Date.parse(String(s || "")); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const hourKey = () => nowIso().slice(0, 13);

/** Upsert posts from a feed, with a metrics snapshot and a sighting. Returns items for the shared pipeline. */
async function recordPosts(env: Env, posts: ApiPost[], label: string, ranked: boolean): Promise<Item[]> {
  const now = nowIso(), day = today(), hour = hourKey();
  const salt = env.HASH_SALT || "companimal";
  const stmts: D1PreparedStatement[] = [];
  const items: Item[] = [];
  for (const [i, p] of posts.entries()) {
    if (!p?.id || p.stickied || p.is_nsfw) continue;
    const id = String(p.id).toLowerCase();
    const body = clean(p.selftext, 4000);
    const author = p.author && p.author !== "[deleted]" ? (await sha256(salt + p.author)).slice(0, 16) : null;
    const created = isoOrNull(p.created_at);
    const rank = ranked ? i + 1 : null;
    const url = threadUrl({ ...p, id });
    stmts.push(env.DB.prepare(`
      INSERT INTO reddit_threads (post_id, project, subreddit, url, title, snippet, body, created_at, first_seen, last_seen, seen_count, best_rank,
        posts_count, posts_count_max, score, upvote_ratio, flair, post_type, author_hash, source, metrics_at, via)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 1, ?10, ?11, COALESCE(?11, 0), ?12, ?13, ?14, ?15, ?16, 'api', ?9, 'feed')
      ON CONFLICT(post_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        best_rank = MIN(COALESCE(reddit_threads.best_rank, 999), COALESCE(excluded.best_rank, 999)),
        title = excluded.title,
        snippet = COALESCE(excluded.snippet, reddit_threads.snippet),
        body = COALESCE(excluded.body, reddit_threads.body),
        created_at = COALESCE(excluded.created_at, reddit_threads.created_at),
        posts_count = COALESCE(excluded.posts_count, reddit_threads.posts_count),
        posts_count_max = MAX(COALESCE(reddit_threads.posts_count_max, 0), COALESCE(excluded.posts_count, 0)),
        score = excluded.score, upvote_ratio = excluded.upvote_ratio, flair = excluded.flair, post_type = excluded.post_type,
        author_hash = COALESCE(excluded.author_hash, reddit_threads.author_hash), source = 'api', metrics_at = excluded.metrics_at`)
      .bind(id, PROJECT.id, p.subreddit, url, clean(p.title, 300), body ? body.slice(0, 1200) : null, body, created, now, rank,
        p.num_comments ?? null, p.score ?? null, p.upvote_ratio ?? null, clean(p.flair?.text, 60), p.post_type || null, author));
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO reddit_metrics (post_id, ts, score, comments) VALUES (?1, ?2, ?3, ?4)`).bind(id, hour, p.score ?? null, p.num_comments ?? null));
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO reddit_thread_hits (post_id, seen_date, query, rank, posts_count, via) VALUES (?1, ?2, ?3, ?4, ?5, 'feed')`).bind(id, day, label, rank, p.num_comments ?? null));
    const engagement = (p.num_comments || 0) + Math.max(0, p.score || 0);
    stmts.push(env.DB.prepare(`UPDATE items SET engagement = ?2, text = CASE WHEN length(COALESCE(text,'')) < length(COALESCE(?3,'')) THEN ?3 ELSE text END WHERE id = ?1`).bind(`reddit:${id}`, engagement, body ? body.slice(0, 1200) : null));
    items.push({ source: "reddit", source_id: id, url, title: clean(p.title, 300), text: body ? body.slice(0, 1200) : null, community: `r/${p.subreddit}`, author: p.author || null, published_at: created, query: label, engagement });
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  await refreshDerived(env, items.map((x) => x.source_id));
  return items;
}

/** Search results carry no metrics or body: register the thread; the comment fetch fills the rest. */
async function recordSearchHits(env: Env, results: any[], query: string): Promise<Item[]> {
  const now = nowIso(), day = today();
  const stmts: D1PreparedStatement[] = [];
  const items: Item[] = [];
  for (const [i, r] of results.entries()) {
    if (!r?.id || !r.subreddit || r.is_nsfw || r.quarantined) continue;
    const id = String(r.id).toLowerCase();
    const url = threadUrl({ permalink: r.permalink, subreddit: r.subreddit, id });
    const rank = Number(r.position) || i + 1;
    stmts.push(env.DB.prepare(`
      INSERT INTO reddit_threads (post_id, project, subreddit, url, title, first_seen, last_seen, seen_count, best_rank, via, source)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 1, ?7, 'search', 'api')
      ON CONFLICT(post_id) DO UPDATE SET last_seen = excluded.last_seen,
        best_rank = MIN(COALESCE(reddit_threads.best_rank, 999), COALESCE(excluded.best_rank, 999)),
        title = COALESCE(reddit_threads.title, excluded.title)`)
      .bind(id, PROJECT.id, r.subreddit, url, clean(r.title, 300), now, rank));
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO reddit_thread_hits (post_id, seen_date, query, rank, posts_count, via) VALUES (?1, ?2, ?3, ?4, NULL, 'search')`).bind(id, day, query.slice(0, 200), rank));
    items.push({ source: "reddit", source_id: id, url, title: clean(r.title, 300), text: null, community: `r/${r.subreddit}`, author: r.author || null, published_at: null, query, engagement: 0 });
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  await refreshDerived(env, items.map((x) => x.source_id));
  return items;
}

/**
 * Growth baselines and sighting counts, recomputed for the given threads:
 * posts_count_prev / score_prev = the snapshot from about a day earlier (0 for threads under a day old),
 * seen_count = distinct (day, feed or search) sightings, so a thread sitting in "new" all day counts once.
 */
async function refreshDerived(env: Env, ids: string[]) {
  const dayBefore = new Date(Date.now() - 20 * 3600000).toISOString().slice(0, 13);
  const dayOld = new Date(Date.now() - 24 * 3600000).toISOString();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 400) {
    const list = JSON.stringify(unique.slice(i, i + 400));
    await env.DB.prepare(`
      UPDATE reddit_threads SET
        posts_count_prev = COALESCE(
          (SELECT m.comments FROM reddit_metrics m WHERE m.post_id = reddit_threads.post_id AND m.ts <= ?1 ORDER BY m.ts DESC LIMIT 1),
          CASE WHEN created_at >= ?2 THEN 0 END,
          (SELECT m.comments FROM reddit_metrics m WHERE m.post_id = reddit_threads.post_id ORDER BY m.ts ASC LIMIT 1),
          posts_count_prev),
        score_prev = COALESCE(
          (SELECT m.score FROM reddit_metrics m WHERE m.post_id = reddit_threads.post_id AND m.ts <= ?1 ORDER BY m.ts DESC LIMIT 1),
          CASE WHEN created_at >= ?2 THEN 0 END,
          (SELECT m.score FROM reddit_metrics m WHERE m.post_id = reddit_threads.post_id ORDER BY m.ts ASC LIMIT 1)),
        seen_count = MAX(1, (SELECT COUNT(*) FROM reddit_thread_hits h WHERE h.post_id = reddit_threads.post_id))
      WHERE post_id IN (SELECT value FROM json_each(?3))`).bind(dayBefore, dayOld, list).run();
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** Subreddit feeds (new, hot, rising). Every few hours from the 10-minute tick. */
export async function collectRedditFeeds(env: Env, deadline = Date.now() + 3 * 60000) {
  const usage = new Usage();
  const raw: any[] = [];
  const items: Item[] = [];
  const calls = SUBREDDITS.flatMap(({ sub, filter }) => REDDIT_FEEDS.map((f) => ({ sub, filtered: !!filter, ...f })));
  try {
    await pool(calls, 6, deadline, async (c) => {
      const res = await serpent(env, "/posts", { subreddit: c.sub, sort: c.sort, limit: c.limit }, usage);
      if (!res) return;
      raw.push({ sub: c.sub, sort: c.sort, res });
      const posts: ApiPost[] = (res.posts || []).filter((p: ApiPost) => !c.filtered || REDDIT_DOG_FILTER.test(`${p.title} ${p.selftext || ""}`));
      items.push(...await recordPosts(env, posts, `r/${c.sub} ${c.sort}`, c.sort !== "new"));
    });
  } finally { await usage.save(env); }
  const key = raw.length ? await archiveRaw(env, "reddit_api", "feeds", raw) : null;
  const s = await saveItems(env, dedupe(items), key);
  return { ...s, cost: usage.cost, note: `${usage.summary}; ${items.length} posts` };
}

/** Once a day: top of the week and month per subreddit, plus all Reddit searches. */
export async function collectRedditDaily(env: Env, deadline = Date.now() + 10 * 60000) {
  const usage = new Usage();
  const raw: any[] = [];
  const items: Item[] = [];
  const tops = SUBREDDITS.flatMap(({ sub, filter }) => REDDIT_TOP.map((t) => ({ sub, filtered: !!filter, ...t })));
  const snowball = await snowballQueries(env, REDDIT_SNOWBALL_PER_DAY);
  const searches = [...new Set([...REDDIT_TOPIC_QUERIES, ...REDDIT_UK_SEARCHES, ...snowball])];
  try {
    await pool(tops, 6, deadline, async (c) => {
      const res = await serpent(env, "/posts", { subreddit: c.sub, sort: "top", t: c.t, limit: c.limit }, usage);
      if (!res) return;
      raw.push({ sub: c.sub, top: c.t, res });
      const posts: ApiPost[] = (res.posts || []).filter((p: ApiPost) => !c.filtered || REDDIT_DOG_FILTER.test(`${p.title} ${p.selftext || ""}`));
      items.push(...await recordPosts(env, posts, `r/${c.sub} top ${c.t}`, true));
    });
    await pool(searches, 6, deadline, async (q) => {
      const res = await serpent(env, "/search", { q, limit: 25 }, usage);
      if (!res) return;
      raw.push({ q, res });
      items.push(...await recordSearchHits(env, res.results || [], q));
    });
  } finally { await usage.save(env); }
  const mark = searches.map((q) => env.DB.prepare(`INSERT INTO reddit_queries (query, source, last_run, runs) VALUES (?1, ?2, ?3, 1)
    ON CONFLICT(query) DO UPDATE SET last_run=excluded.last_run, runs=reddit_queries.runs+1`).bind(q, snowball.includes(q) ? "snowball" : "seed", nowIso()));
  for (let i = 0; i < mark.length; i += 60) await env.DB.batch(mark.slice(i, i + 60));
  const key = raw.length ? await archiveRaw(env, "reddit_api", "daily", raw) : null;
  const s = await saveItems(env, dedupe(items), key);
  return { ...s, cost: usage.cost, note: `${usage.summary}; ${searches.length} searches (${snowball.length} harvested questions)` };
}

/**
 * Comment threads, from the 10-minute tick, within a daily ceiling. Priority:
 * new threads with known comment counts (most discussed first), then threads that kept growing
 * since their last fetch, then search finds whose size we don't know yet.
 */
export async function collectRedditComments(env: Env, deadline = Date.now() + 2.5 * 60000) {
  const used = await env.DB.prepare(`SELECT COALESCE(SUM(calls),0) AS n FROM api_usage WHERE day=?1 AND api='serpent' AND kind='comments'`).bind(today()).first<any>();
  const room = Math.min(REDDIT_COMMENTS_PER_TICK, REDDIT_COMMENTS_PER_DAY - (used?.n || 0));
  if (room <= 0) return { added: 0, seen: 0, note: "daily comment ceiling reached" };
  const rows = (await env.DB.prepare(`
    SELECT post_id, subreddit, posts_count, created_at, insight_done, insight_with_comments,
      CASE WHEN comments_fetched_at IS NULL AND posts_count IS NOT NULL THEN 0 WHEN comments_fetched_at IS NOT NULL THEN 1 ELSE 2 END AS pri
    FROM reddit_threads WHERE project=?1 AND last_seen >= ?2 AND (
      (comments_fetched_at IS NULL AND (posts_count IS NULL OR posts_count >= ?3))
      OR (comments_fetched_at IS NOT NULL AND comments_fetched_at < ?4 AND (created_at IS NULL OR created_at >= ?5)
          AND posts_count >= COALESCE(comments_at_fetch, 0) * ?6 AND posts_count - COALESCE(comments_at_fetch, 0) >= 10))
    ORDER BY pri, COALESCE(posts_count, 0) + COALESCE(score, 0) DESC, COALESCE(best_rank, 999), last_seen DESC
    LIMIT ?7`).bind(PROJECT.id, daysAgo(14), REDDIT_COMMENTS_MIN, new Date(Date.now() - 6 * 3600000).toISOString(), daysAgo(7), REDDIT_COMMENTS_REFETCH_GROWTH, room).all<any>()).results || [];
  if (!rows.length) return { added: 0, seen: 0, note: "nothing to fetch" };

  const usage = new Usage();
  const salt = env.HASH_SALT || "companimal";
  const raw: any[] = [];
  let stored = 0, threads = 0;
  try {
    await pool(rows, 6, deadline, async (t) => {
      // Small threads come whole in one block of 25; big ones get the top 50
      const limit = (t.posts_count || 0) > 25 ? 50 : 25;
      const res = await serpent(env, "/comments", { subreddit: t.subreddit, post_id: t.post_id, limit }, usage);
      const now = nowIso();
      if (!res) {
        // Gone (deleted or removed): don't ask again
        await env.DB.prepare(`UPDATE reddit_threads SET comments_fetched_at=?2, comments_at_fetch=COALESCE(posts_count,0) WHERE post_id=?1`).bind(t.post_id, now).run();
        return;
      }
      raw.push({ post_id: t.post_id, res });
      const stmts: D1PreparedStatement[] = [];
      let earliest: string | null = null, kept = 0;
      for (const c of res.comments || []) {
        const created = isoOrNull(c.created_at);
        if (created && (!earliest || created < earliest)) earliest = created;
        const body = clean(c.body, 2000);
        if (!c.id || !body || /^\[(deleted|removed)\]$/i.test(body) || /^automoderator$/i.test(c.author || "")) continue;
        const author = c.author && c.author !== "[deleted]" ? (await sha256(salt + c.author)).slice(0, 16) : null;
        stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO reddit_comments (comment_id, post_id, parent_id, depth, author_hash, body, score, created_at, fetched_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
          .bind(String(c.id), t.post_id, c.parent_id || null, c.depth ?? null, author, body, c.score ?? null, created, now));
        kept++;
      }
      const total = typeof res.total_comments === "number" ? res.total_comments : null;
      // Earliest comment stands in for the post date when we only know the thread from search
      stmts.push(env.DB.prepare(`UPDATE reddit_threads SET comments_fetched_at=?2, comments_at_fetch=COALESCE(?3, posts_count, ?4),
          posts_count = COALESCE(?3, posts_count), posts_count_max = MAX(COALESCE(posts_count_max,0), COALESCE(?3,0)),
          created_at = COALESCE(created_at, ?5), metrics_at = CASE WHEN ?3 IS NOT NULL THEN ?2 ELSE metrics_at END,
          insight_done = CASE WHEN ?4 > 0 AND COALESCE(insight_with_comments,0) = 0 THEN 0 ELSE insight_done END,
          insight_attempts = CASE WHEN ?4 > 0 AND COALESCE(insight_with_comments,0) = 0 THEN 0 ELSE insight_attempts END
        WHERE post_id=?1`).bind(t.post_id, now, total, kept, earliest));
      if (total !== null) stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO reddit_metrics (post_id, ts, score, comments) VALUES (?1, ?2, (SELECT score FROM reddit_threads WHERE post_id=?1), ?3)`).bind(t.post_id, hourKey(), total));
      for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
      stored += kept; threads++;
    });
  } finally { await usage.save(env); }
  if (raw.length) await archiveRaw(env, "reddit_api", "comments", raw);
  await refreshDerived(env, rows.map((r: any) => r.post_id));
  return { added: stored, seen: threads, cost: usage.cost, note: `${threads} threads, ${stored} comments` };
}

/**
 * Keep D1 well inside its size limit over the years: comments older than 90 days are thinned to the
 * 10 most upvoted per thread (the full responses stay in the R2 archive), growth snapshots older
 * than 60 days to one a day.
 */
export async function pruneReddit(env: Env) {
  const c = await env.DB.prepare(`DELETE FROM reddit_comments WHERE fetched_at < ?1 AND comment_id NOT IN (
      SELECT comment_id FROM (SELECT comment_id, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY COALESCE(score,0) DESC) AS rn
        FROM reddit_comments WHERE fetched_at < ?1) WHERE rn <= 10)`).bind(daysAgo(90)).run();
  const m = await env.DB.prepare(`DELETE FROM reddit_metrics WHERE ts < ?1 AND ts NOT IN (
      SELECT MAX(ts) FROM reddit_metrics m2 WHERE m2.post_id = reddit_metrics.post_id AND m2.ts < ?1 GROUP BY substr(m2.ts, 1, 10))`).bind(daysAgo(60)).run();
  return { added: 0, seen: 0, note: `pruned ${c.meta?.changes || 0} old comments, ${m.meta?.changes || 0} old snapshots` };
}

/** One-off full pull: feeds, then the daily tops and searches. */
export async function collectRedditNow(env: Env) {
  const a = await collectRedditFeeds(env, Date.now() + 4 * 60000);
  const b = await collectRedditDaily(env, Date.now() + 8 * 60000);
  return { added: a.added + b.added, seen: a.seen + b.seen, cost: (a.cost || 0) + (b.cost || 0), note: `${a.note} | ${b.note}` };
}

function dedupe(items: Item[]): Item[] {
  const m = new Map<string, Item>();
  for (const it of items) { const prev = m.get(it.source_id); if (!prev || (it.text && !prev.text)) m.set(it.source_id, it); }
  return [...m.values()];
}

// ---------------------------------------------------------------------------
// Local test fixtures (MOCK=1)
// ---------------------------------------------------------------------------

const MOCK_TITLES = [
  "8 week old puppy cries in the crate every night, does it get better?", "Breeder wants a £500 deposit before we can visit, normal?",
  "Rescue dog growls when we touch his food bowl", "We survived the puppy blues", "Is pet insurance worth it for a cockapoo?",
  "Recall training not working with my 6 month old spaniel", "Our first litter arrived today!", "How do you vet puppy buyers as a small breeder?",
];
function mockResponse(path: string, params: Record<string, string | number | boolean>): any {
  const seed = [...JSON.stringify(params)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const n = (k: number) => ((seed >> (k % 24)) ^ (seed * (k + 3))) >>> 0;
  if (path === "/posts") {
    const sub = String(params.subreddit);
    const posts = Array.from({ length: 12 }, (_, i) => {
      const id = `m${(n(i) % 46656).toString(36)}${i}`;
      const title = MOCK_TITLES[n(i + 1) % MOCK_TITLES.length];
      return { id, title, selftext: `${title} Long story: we brought her home last week and she is 9 weeks old. Any advice from UK owners?`, author: `user${n(i) % 50}`,
        subreddit: sub, score: n(i + 2) % 400, upvote_ratio: 0.9, num_comments: n(i + 5) % 120, created_at: new Date(Date.now() - (n(i) % 72) * 3600000).toISOString(),
        permalink: `/r/${sub}/comments/${id}/mock/`, url: null, post_type: "text", flair: null, stickied: false, is_nsfw: false };
    });
    return { success: true, subreddit: sub, posts };
  }
  if (path === "/search") {
    return { success: true, results: Array.from({ length: 8 }, (_, i) => ({ id: `s${(n(i) % 46656).toString(36)}${i}`, title: MOCK_TITLES[n(i) % MOCK_TITLES.length], subreddit: ["puppy101", "dogs", "AskUK"][i % 3], permalink: null, position: i + 1 })) };
  }
  if (path === "/comments") {
    const replies = ["It gets better by week three, cover the crate and keep it next to your bed.", "Totally normal, ours did the same. Hang in there.", "Never pay a deposit before seeing the pup with mum. That's a classic scam.", "Ask your vet, but we found a snuffle mat helped a lot."];
    return { success: true, post_id: params.post_id, total_comments: 30 + (seed % 40), count: 6,
      comments: Array.from({ length: 6 }, (_, i) => ({ id: `c${seed % 9999}${i}`, author: `u${i}`, body: replies[(seed + i) % replies.length], score: 40 - i * 5, depth: i % 2, parent_id: null, created_at: new Date(Date.now() - (10 - i) * 3600000).toISOString() })) };
  }
  return { success: true };
}
