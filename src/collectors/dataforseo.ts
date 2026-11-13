import { PROJECT, SUBREDDITS, SUBREDDIT_DEPTH, SERP_FORUM_QUERIES, SERP_FORUM_PER_DAY, SERP_PAA_QUERIES, CONTENT_ANALYSIS_KEYWORDS, CONTENT_ANALYSIS_LIMIT, UK_FORUM_DOMAINS } from "../../config/taxonomy";
import { Env, Item, archiveRaw, saveItems, nowIso, clean, dayOfYear } from "../lib";
import { mockSerp, mockContentAnalysis } from "../mock";
import { redditHitsFromSerp, recordRedditHits, parseRedditUrl } from "./reddit";

const API = "https://api.dataforseo.com/v3";
const FORUM_DOMAINS = ["reddit.com", "quora.com", "dogforum", "forum", "boards.", "community.", ...UK_FORUM_DOMAINS];

function auth(env: Env) {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) throw new Error("DataForSEO credentials not set");
  return "Basic " + btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`);
}

async function dfs(env: Env, path: string, body?: unknown): Promise<any> {
  const call = () => fetch(`${API}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: auth(env), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let res = await call();
  // DataForSEO occasionally returns a transient 5xx; retry once after a pause
  if (res.status >= 500) { await new Promise((r) => setTimeout(r, 5000)); res = await call(); }
  if (!res.ok) throw new Error(`DataForSEO ${path} HTTP ${res.status}`);
  const json: any = await res.json();
  if (json.status_code !== 20000) throw new Error(`DataForSEO ${path}: ${json.status_message}`);
  return json;
}

/** Post today's SERP tasks to the standard (cheap) queue. Results are collected later. */
export async function postSerpTasks(env: Env, includePaa: boolean, includeForum = true) {
  const start = (dayOfYear() * SERP_FORUM_PER_DAY) % SERP_FORUM_QUERIES.length;
  const forum = Array.from({ length: Math.min(SERP_FORUM_PER_DAY, SERP_FORUM_QUERIES.length) }, (_, i) => SERP_FORUM_QUERIES[(start + i) % SERP_FORUM_QUERIES.length]);
  const tasks = [
    ...(includeForum ? forum : []).map((q) => ({ keyword: q, location_code: PROJECT.locationCode, language_code: PROJECT.languageCode, depth: 20, search_param: "&tbs=qdr:m", tag: `csl|${PROJECT.id}|forum|${q}` })),
    ...(includePaa ? SERP_PAA_QUERIES.map((q) => ({ keyword: q, location_code: PROJECT.locationCode, language_code: PROJECT.languageCode, depth: 10, people_also_ask_click_depth: 1, tag: `csl|${PROJECT.id}|paa|${q}` })) : []),
  ];
  if (env.MOCK === "1") {
    for (const t of tasks) {
      const kind = t.tag.split("|")[2];
      await env.DB.prepare(`INSERT OR IGNORE INTO serp_tasks (task_id, project, kind, query, posted_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(`mock-${kind}-${t.keyword}-${Date.now()}`, PROJECT.id, kind, t.keyword, nowIso()).run();
    }
    return { added: 0, seen: 0, note: `mock posted ${tasks.length}` };
  }
  const json = await dfs(env, "serp/google/organic/task_post", tasks);
  let cost = json.cost || 0;
  for (const t of json.tasks || []) {
    if (t.status_code !== 20100) continue;
    const [, , kind, query] = String(t.data?.tag || "").split("|");
    await env.DB.prepare(`INSERT OR IGNORE INTO serp_tasks (task_id, project, kind, query, posted_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(t.id, PROJECT.id, kind, query, nowIso()).run();
  }
  return { added: 0, seen: 0, cost, note: `posted ${tasks.length} tasks` };
}

function isForum(url: string) {
  return FORUM_DOMAINS.some((d) => url.includes(d));
}

function subredditOf(url: string): string | null {
  const m = url.match(/reddit\.com\/r\/([^/]+)/i);
  return m ? `r/${m[1]}` : null;
}

/** Turn an advanced SERP result into items: forum threads, People Also Ask, Discussions and forums. */
export function serpToItems(result: any, kind: string, query: string): Item[] {
  const out: Item[] = [];
  for (const el of result?.items || []) {
    if (el.type === "organic" && el.url && isForum(el.url) && !parseRedditUrl(el.url)) {
      out.push({ source: "serp_forum", source_id: el.url.replace(/\?.*$/, ""), url: el.url, title: clean(String(el.title || "").replace(/\s*:\s*r\/\w+\s*$/i, ""), 300), text: clean(el.description), community: subredditOf(el.url) || el.domain, query, published_at: el.timestamp || null });
    }
    if (el.type === "people_also_ask") {
      for (const q of el.items || []) {
        const exp = q.expanded_element?.[0];
        out.push({ source: "serp_paa", source_id: `${query}|${q.title}`, url: exp?.url || null, title: clean(q.title, 300), text: clean(exp?.description), community: exp?.domain || null, query });
      }
    }
    if (el.type === "discussions_and_forums") {
      for (const d of el.items || []) {
        if (!d.url || parseRedditUrl(d.url)) continue;
        out.push({ source: "serp_discussions", source_id: d.url, url: d.url, title: clean(d.title, 300), text: clean(d.description || d.snippet), community: subredditOf(d.url) || d.source || d.domain || null, query });
      }
    }
  }
  return out;
}

/** Post one past-week Google search per subreddit to the standard queue. */
export async function postSubredditTasks(env: Env) {
  const tasks = SUBREDDITS.map(({ sub, filter }) => {
    const q = `site:reddit.com/r/${sub}${filter ? ` ${filter}` : ""}`;
    return { keyword: q, location_code: PROJECT.locationCode, language_code: PROJECT.languageCode, depth: SUBREDDIT_DEPTH, search_param: "&tbs=qdr:w", tag: `csl|${PROJECT.id}|subreddit|${q}` };
  });
  if (env.MOCK === "1") {
    for (const t of tasks) await env.DB.prepare(`INSERT OR IGNORE INTO serp_tasks (task_id, project, kind, query, posted_at) VALUES (?1, ?2, 'forum', ?3, ?4)`).bind(`mock-sub-${t.keyword}-${Date.now()}`, PROJECT.id, t.keyword, nowIso()).run();
    return { added: 0, seen: 0, note: `mock posted ${tasks.length}` };
  }
  const json = await dfs(env, "serp/google/organic/task_post", tasks);
  for (const t of json.tasks || []) {
    if (t.status_code !== 20100) continue;
    const [, , kind, query] = String(t.data?.tag || "").split("|");
    await env.DB.prepare(`INSERT OR IGNORE INTO serp_tasks (task_id, project, kind, query, posted_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(t.id, PROJECT.id, kind, query, nowIso()).run();
  }
  return { added: 0, seen: 0, cost: json.cost || 0, note: `posted ${tasks.length} subreddit searches` };
}

/** Collect finished SERP tasks from the standard queue. */
export async function collectSerpTasks(env: Env) {
  const pending = await env.DB.prepare(`SELECT task_id, kind, query FROM serp_tasks WHERE fetched_at IS NULL AND project=?1 ORDER BY posted_at LIMIT 100`).bind(PROJECT.id).all<any>();
  let added = 0, seen = 0;
  const list = pending.results || [];
  // Fetch finished tasks six at a time, then store them one by one
  const fetched = new Map<string, any>();
  if (env.MOCK !== "1") {
    for (let i = 0; i < list.length; i += 6) {
      await Promise.all(list.slice(i, i + 6).map(async (t: any) => {
        try { fetched.set(t.task_id, await dfs(env, `serp/google/organic/task_get/advanced/${t.task_id}`)); } catch (e: any) { fetched.set(t.task_id, { error: String(e?.message || e) }); }
      }));
    }
  }
  for (const t of list) {
    let result: any;
    let raw: any;
    if (env.MOCK === "1") {
      raw = mockSerp(t.kind, t.query);
      result = raw.tasks[0].result[0];
    } else {
      raw = fetched.get(t.task_id);
      if (!raw || raw.error) continue; // still queued or a transient error: try again next run
      const task = raw.tasks?.[0];
      if (!task || task.status_code !== 20000) continue;
      result = task.result?.[0];
    }
    const key = await archiveRaw(env, "serp", `${t.kind}-${t.query}`, raw);
    // Reddit threads from any search go to the thread registry (one item per thread)
    const redditItems = await recordRedditHits(env, redditHitsFromSerp(result), t.query);
    const r = await saveItems(env, [...serpToItems(result, t.kind, t.query), ...redditItems], key);
    added += r.added; seen += r.seen;
    await env.DB.prepare(`UPDATE serp_tasks SET fetched_at=?2 WHERE task_id=?1`).bind(t.task_id, nowIso()).run();
  }
  return { added, seen, note: `checked ${pending.results?.length || 0} tasks` };
}

/** DataForSEO Content Analysis: recent web, blog and forum citations. */
export async function collectContentAnalysis(env: Env) {
  let added = 0, seen = 0, cost = 0;
  for (const kw of CONTENT_ANALYSIS_KEYWORDS) {
    const raw = env.MOCK === "1" ? mockContentAnalysis(kw) : await dfs(env, "content_analysis/search/live", [{
      keyword: kw,
      page_type: ["blogs", "message-boards", "news"],
      search_mode: "as_is",
      // UK only: .uk sites or known UK forums, English
      filters: [[["main_domain", "like", "%.uk"], "or", ["main_domain", "in", UK_FORUM_DOMAINS]], "and", ["language", "=", "en"]],
      order_by: ["content_info.date_published,desc"],
      limit: CONTENT_ANALYSIS_LIMIT,
    }]);
    cost += raw.cost || 0;
    const key = await archiveRaw(env, "content_analysis", kw, raw);
    const items: Item[] = [];
    for (const it of raw.tasks?.[0]?.result?.[0]?.items || []) {
      const ci = it.content_info || {};
      if (!it.url) continue;
      items.push({
        source: "content_analysis",
        source_id: `${it.url}#${(ci.snippet || "").slice(0, 40)}`,
        url: it.url,
        title: clean(ci.title || ci.main_title, 300),
        text: clean(ci.snippet),
        community: it.domain,
        author: ci.author || null,
        published_at: ci.date_published || it.group_date || null,
        query: kw,
      });
    }
    const r = await saveItems(env, items, key);
    added += r.added; seen += r.seen;
  }
  return { added, seen, cost };
}
