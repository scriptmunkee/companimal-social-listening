// Read-only query helpers for the dashboard. Nothing here writes to the database.
import { PROJECT, TOPICS } from "../../config/taxonomy";
import { Env, daysAgo, dayOfYear } from "../lib";
import { normQ, opportunities, regionSql, RegionFilter, RELEVANT_SQL, Opportunity } from "../analysis";
import { matchTokens } from "../enrich";
import { checkHealth, HealthIssue } from "../health";

const lensSql = (lens: string | undefined, n: number) => (lens ? ` AND e.lens=?${n}` : "");
const lensArg = (lens?: string) => (lens ? [lens] : []);

export const queueKey = (topic: string, q: string | null | undefined) => `${topic}|${normQ(q || "")}`;

/** Everything already sent to the pipeline, keyed by topic and normalised question. */
export async function queuedSet(env: Env): Promise<Set<string>> {
  const rows = (await env.DB.prepare(`SELECT topic, question FROM pipeline_queue WHERE project=?1`).bind(PROJECT.id).all<any>()).results || [];
  return new Set(rows.map((r: any) => queueKey(r.topic, r.question)));
}

export async function pipeline(env: Env, limit = 50, offset = 0) {
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM pipeline_queue WHERE project=?1`).bind(PROJECT.id).first<any>())?.n || 0;
  const rows = (await env.DB.prepare(`SELECT id, topic, question, created_at, status FROM pipeline_queue WHERE project=?1 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3`).bind(PROJECT.id, limit, offset).all<any>()).results || [];
  return { total: Number(total), rows };
}

/** Masthead numbers shown on every page, plus health issues. */
export async function masthead(env: Env) {
  const r = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM items WHERE project=?1) AS posts, (SELECT MIN(collected_date) FROM items WHERE project=?1) AS since, (SELECT COUNT(*) FROM pipeline_queue WHERE project=?1) AS queued`).bind(PROJECT.id).first<any>();
  const issues: HealthIssue[] = await checkHealth(env).catch(() => []);
  return { posts: r?.posts || 0, since: r?.since || null, queued: r?.queued || 0, issues };
}

export async function kpis(env: Env, region: RegionFilter, lens?: string) {
  return env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM items WHERE project=?1) AS total,
    (SELECT COUNT(*) FROM items WHERE project=?1 AND collected_date>=?2) AS week,
    (SELECT COUNT(*) FROM items WHERE project=?1 AND collected_date>=?3 AND collected_date<?2) AS prevweek,
    (SELECT COUNT(*) FROM enrichments e JOIN items i ON i.id=e.item_id WHERE i.project=?1 AND e.question IS NOT NULL${regionSql("e.region", region)}${RELEVANT_SQL}${lensSql(lens, 4)}) AS questions,
    (SELECT COUNT(*) FROM enrichments e JOIN items i ON i.id=e.item_id WHERE i.project=?1 AND e.kind='irrelevant') AS irrelevant,
    (SELECT COUNT(*) FROM enrichments e JOIN items i ON i.id=e.item_id WHERE i.project=?1 AND e.region='uk') AS uk,
    (SELECT COUNT(*) FROM enrichments e JOIN items i ON i.id=e.item_id WHERE i.project=?1 AND e.region IS NOT NULL) AS tagged`)
    .bind(PROJECT.id, daysAgo(7), daysAgo(14), ...lensArg(lens)).first<any>();
}

/** Days of daily-count history, used for "baseline building" states. */
export async function historyDays(env: Env): Promise<{ first: string | null; days: number }> {
  const first = (await env.DB.prepare(`SELECT MIN(date) AS d FROM daily_counts WHERE project=?1`).bind(PROJECT.id).first<any>())?.d || null;
  if (!first) return { first: null, days: 0 };
  return { first, days: Math.floor((Date.now() - Date.parse(first + "T00:00:00Z")) / 86400000) + 1 };
}

export interface QuestionPost { question: string; source: string; community: string | null; url: string | null; title: string | null; text: string | null; engagement: number; collected_date: string; region: string | null; lens: string | null; matched_url: string | null }

/** Every post behind one grouped question, plus related questions as H2 candidates. */
export async function questionDetail(env: Env, topic: string, question: string, days: number, lens: string | undefined, region: RegionFilter) {
  const key = normQ(question);
  const rows = (await env.DB.prepare(`SELECT e.question, e.lens, e.region, e.matched_url, i.source, i.community, i.url, i.title, i.text, i.engagement, i.collected_date
    FROM enrichments e JOIN items i ON i.id=e.item_id
    WHERE i.project=?1 AND e.topic=?2 AND e.question IS NOT NULL AND i.collected_date>=?3${regionSql("e.region", region)}${RELEVANT_SQL}${lensSql(lens, 4)}
    ORDER BY i.engagement DESC, i.collected_date DESC`).bind(PROJECT.id, topic, daysAgo(days), ...lensArg(lens)).all<any>()).results || [];
  const posts: QuestionPost[] = rows.filter((r: any) => normQ(r.question) === key);
  const opps = (await opportunities(env, days, lens, 5000, region)).filter((o) => o.topic === topic);
  const self = opps.find((o) => normQ(o.question) === key) || null;
  const qt = new Set(matchTokens(question));
  const related = opps.filter((o) => normQ(o.question) !== key)
    .map((o) => ({ o, overlap: matchTokens(o.question).filter((w) => qt.has(w)).length }))
    .sort((a, b) => b.overlap - a.overlap || b.o.score - a.o.score)
    .slice(0, 6).map((x) => x.o);
  const covered = posts.find((p) => p.matched_url)?.matched_url || self?.covered || null;
  const dates = posts.map((p) => p.collected_date).sort();
  return { question: self?.question || posts[0]?.question || question, topic, self, posts, related, covered, first: dates[0] || null, last: dates[dates.length - 1] || null };
}

/** Myths grouped by claim, newest and most engaged first. */
export async function mythGroups(env: Env, lens: string | undefined, region: RegionFilter, topic?: string, days = 365) {
  const rows = (await env.DB.prepare(`SELECT e.topic, COALESCE(e.question, i.title) AS claim, i.text, i.url, i.source, i.community, i.engagement, i.collected_date
    FROM enrichments e JOIN items i ON i.id=e.item_id
    WHERE i.project=?1 AND e.kind='myth' AND i.collected_date>=?2${regionSql("e.region", region)}${lensSql(lens, 3)}
    ORDER BY i.collected_date DESC, i.engagement DESC LIMIT 3000`).bind(PROJECT.id, daysAgo(days), ...lensArg(lens)).all<any>()).results || [];
  const groups = new Map<string, { topic: string; claim: string; count: number; engagement: number; last: string; first: string; posts: any[] }>();
  for (const r of rows) {
    if (topic && r.topic !== topic) continue;
    const k = `${r.topic}|${normQ(r.claim || "")}`;
    if (!normQ(r.claim || "")) continue;
    const g = groups.get(k) || { topic: r.topic, claim: r.claim, count: 0, engagement: 0, last: r.collected_date, first: r.collected_date, posts: [] as any[] };
    g.count++; g.engagement += r.engagement || 0;
    if (r.collected_date > g.last) g.last = r.collected_date;
    if (r.collected_date < g.first) g.first = r.collected_date;
    if (g.posts.length < 4) g.posts.push(r);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.engagement - a.engagement || (a.last < b.last ? 1 : -1));
}

/** Topic page data: daily trend, communities, kinds. */
export async function topicDetail(env: Env, topic: string, lens: string | undefined, region: RegionFilter, days = 90) {
  const daily = (await env.DB.prepare(`SELECT date, SUM(n) AS n FROM daily_counts WHERE project=?1 AND topic=?2 AND date>=?3${lens ? " AND lens=?4" : ""}${regionSql("region", region)} GROUP BY date`)
    .bind(PROJECT.id, topic, daysAgo(days - 1), ...lensArg(lens)).all<any>()).results || [];
  const m = new Map(daily.map((d: any) => [d.date, d.n]));
  const series = Array.from({ length: days }, (_, i) => { const d = daysAgo(days - 1 - i); return { date: d, n: Number(m.get(d) || 0) }; });
  const comm = (await env.DB.prepare(`SELECT i.source, i.community, COUNT(*) AS n, SUM(CASE WHEN e.question IS NOT NULL THEN 1 ELSE 0 END) AS q, SUM(i.engagement) AS eng
    FROM items i JOIN enrichments e ON e.item_id=i.id WHERE i.project=?1 AND e.topic=?2 AND i.collected_date>=?3${regionSql("e.region", region)}${RELEVANT_SQL}${lensSql(lens, 4)}
    GROUP BY i.source, i.community ORDER BY n DESC LIMIT 10`).bind(PROJECT.id, topic, daysAgo(days), ...lensArg(lens)).all<any>()).results || [];
  const kinds = (await env.DB.prepare(`SELECT e.kind, COUNT(*) AS n FROM items i JOIN enrichments e ON e.item_id=i.id WHERE i.project=?1 AND e.topic=?2 AND i.collected_date>=?3${regionSql("e.region", region)}${RELEVANT_SQL}${lensSql(lens, 4)} GROUP BY e.kind ORDER BY n DESC`)
    .bind(PROJECT.id, topic, daysAgo(days), ...lensArg(lens)).all<any>()).results || [];
  return { series, comm, kinds };
}

/** Week of year (1 to 53) used by the seasonality grid. */
export const weekOfYear = (iso: string) => Math.min(53, Math.floor((dayOfYear(new Date(iso + "T12:00:00Z")) - 1) / 7) + 1);

/** Mentions per topic per week of year, averaged across the years collected so far. */
export async function seasonality(env: Env, lens: string | undefined, region: RegionFilter) {
  const rows = (await env.DB.prepare(`SELECT date, topic, SUM(n) AS n FROM daily_counts WHERE project=?1${lens ? " AND lens=?2" : ""}${regionSql("region", region)} GROUP BY date, topic`)
    .bind(PROJECT.id, ...lensArg(lens)).all<any>()).results || [];
  const weeksSeen = new Map<number, Set<number>>(); // week -> years with data
  const cells = new Map<string, number>(); // topic|week -> total
  let first: string | null = null;
  for (const r of rows) {
    if (!first || r.date < first) first = r.date;
    const w = weekOfYear(r.date), y = Number(r.date.slice(0, 4));
    if (!weeksSeen.has(w)) weeksSeen.set(w, new Set());
    weeksSeen.get(w)!.add(y);
    cells.set(`${r.topic}|${w}`, (cells.get(`${r.topic}|${w}`) || 0) + Number(r.n));
  }
  const topics = TOPICS.filter((t) => t.id !== "other").map((t) => {
    const weeks = Array.from({ length: 53 }, (_, i) => {
      const w = i + 1, years = weeksSeen.get(w)?.size || 0;
      return years ? (cells.get(`${t.id}|${w}`) || 0) / years : null;
    });
    const total = weeks.reduce<number>((a, b) => a + (b || 0), 0);
    return { id: t.id, label: t.label, weeks, total };
  });
  return { topics, weeksCollected: weeksSeen.size, first };
}

export async function communities(env: Env, lens: string | undefined, days = 30) {
  return (await env.DB.prepare(`SELECT i.source, i.community, COUNT(*) AS n, SUM(CASE WHEN e.question IS NOT NULL THEN 1 ELSE 0 END) AS q, SUM(i.engagement) AS eng,
    SUM(CASE WHEN e.region='uk' THEN 1 ELSE 0 END) AS uk, SUM(CASE WHEN e.region='non_uk' THEN 1 ELSE 0 END) AS nonuk, SUM(CASE WHEN e.kind='irrelevant' THEN 1 ELSE 0 END) AS offtopic
    FROM items i LEFT JOIN enrichments e ON e.item_id=i.id WHERE i.project=?1 AND i.collected_date>=?2${lens ? " AND e.lens=?3" : ""}
    GROUP BY i.source, i.community ORDER BY q DESC, n DESC LIMIT 60`).bind(PROJECT.id, daysAgo(days), ...lensArg(lens)).all<any>()).results || [];
}

export async function runs(env: Env, limit: number, offset: number) {
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs WHERE project=?1`).bind(PROJECT.id).first<any>())?.n || 0;
  const rows = (await env.DB.prepare(`SELECT job, started_at, finished_at, status, items_new, items_seen, cost_usd, note FROM runs WHERE project=?1 ORDER BY started_at DESC LIMIT ?2 OFFSET ?3`).bind(PROJECT.id, limit, offset).all<any>()).results || [];
  const cost = await env.DB.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS c30, COALESCE(SUM(CASE WHEN started_at>=?3 THEN cost_usd ELSE 0 END),0) AS c7, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors, COUNT(*) AS n FROM runs WHERE project=?1 AND started_at>=?2`)
    .bind(PROJECT.id, daysAgo(30), daysAgo(7)).first<any>();
  return { total: Number(total), rows, cost };
}

export async function siteUrlCount(env: Env): Promise<number> {
  return Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_urls WHERE project=?1`).bind(PROJECT.id).first<any>())?.n || 0);
}

export type { Opportunity };
