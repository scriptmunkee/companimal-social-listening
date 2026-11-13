import { PROJECT, TOPICS } from "../config/taxonomy";
import { Env, nowIso, today, daysAgo } from "./lib";
import { runAi } from "./enrich";

/** Rebuild daily topic counts for the last few days (cheap, idempotent). */
export async function rollup(env: Env, days = 3) {
  const from = daysAgo(days);
  await env.DB.prepare(`DELETE FROM daily_counts WHERE project=?1 AND date>=?2`).bind(PROJECT.id, from).run();
  const r = await env.DB.prepare(`
    INSERT INTO daily_counts (project, date, topic, lens, kind, region, n, engagement)
    SELECT i.project, i.collected_date, e.topic, e.lens, e.kind, COALESCE(e.region,'unknown'), COUNT(*), COALESCE(SUM(i.engagement),0)
    FROM items i JOIN enrichments e ON e.item_id=i.id
    WHERE i.project=?1 AND i.collected_date>=?2
    GROUP BY i.project, i.collected_date, e.topic, e.lens, e.kind, COALESCE(e.region,'unknown')`).bind(PROJECT.id, from).run();
  return { added: r.meta?.changes ?? 0, seen: 0 };
}

/** Region filter: "uk" (default) keeps UK and unknown, "all" keeps everything. */
export type RegionFilter = "uk" | "all";
export const regionSql = (col: string, region: RegionFilter = "uk") => (region === "all" ? "" : ` AND COALESCE(${col},'unknown') <> 'non_uk'`);

export interface RisingTopic { topic: string; label: string; last7: number; prior28: number; ratio: number; spark: number[]; baselineReady: boolean }

/** Topics growing faster than their own 4-week baseline. */
export async function risingTopics(env: Env, lens?: string, region: RegionFilter = "uk"): Promise<RisingTopic[]> {
  const rows = await env.DB.prepare(`SELECT date, topic, SUM(n) AS n FROM daily_counts WHERE project=?1 AND date>=?2 ${lens ? "AND lens=?3" : ""}${regionSql("region", region)} GROUP BY date, topic`)
    .bind(...[PROJECT.id, daysAgo(35), ...(lens ? [lens] : [])]).all<any>();
  const byTopic = new Map<string, Map<string, number>>();
  for (const r of rows.results || []) {
    if (!byTopic.has(r.topic)) byTopic.set(r.topic, new Map());
    byTopic.get(r.topic)!.set(r.date, r.n);
  }
  const cut = daysAgo(7);
  const first = await env.DB.prepare(`SELECT MIN(date) AS d FROM daily_counts WHERE project=?1`).bind(PROJECT.id).first<any>();
  // Growth ratios mean nothing until there are ~3 weeks of history
  const baselineReady = !!first?.d && first.d <= daysAgo(21);
  const out: RisingTopic[] = [];
  for (const [topic, m] of byTopic) {
    if (topic === "other") continue;
    let last7 = 0, prior = 0;
    for (const [d, n] of m) (d > cut ? (last7 += n) : (prior += n));
    const baseline = prior / 4; // weekly average over the prior 4 weeks
    const ratio = baselineReady ? (last7 + 1) / (baseline + 1) : 1;
    const spark = Array.from({ length: 35 }, (_, i) => m.get(daysAgo(34 - i)) || 0);
    out.push({ topic, label: TOPICS.find((t) => t.id === topic)?.label || topic, last7, prior28: prior, ratio, spark, baselineReady });
  }
  return out.sort((a, b) => b.ratio * Math.log2(b.last7 + 2) - a.ratio * Math.log2(a.last7 + 2));
}

export function normQ(q: string) {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

export interface Opportunity { topic: string; question: string; count: number; engagement: number; sources: string; covered: string | null; score: number; example_url: string | null }

/** Questions grouped and scored: frequency, engagement, growth and whether we already cover it. */
export async function opportunities(env: Env, days = 30, lens?: string, limit = 50, region: RegionFilter = "uk"): Promise<Opportunity[]> {
  const rows = await env.DB.prepare(`
    SELECT e.question, e.topic, e.matched_url, e.match_score, i.engagement, i.source, i.url, i.collected_date
    FROM enrichments e JOIN items i ON i.id=e.item_id
    WHERE i.project=?1 AND e.question IS NOT NULL AND i.collected_date>=?2 ${lens ? "AND e.lens=?3" : ""}${regionSql("e.region", region)}`)
    .bind(...[PROJECT.id, daysAgo(days), ...(lens ? [lens] : [])]).all<any>();
  const rising = new Map((await risingTopics(env, lens, region)).map((r) => [r.topic, r.ratio]));
  const groups = new Map<string, any>();
  for (const r of rows.results || []) {
    const k = `${r.topic}|${normQ(r.question)}`;
    const g = groups.get(k) || { topic: r.topic, question: r.question, count: 0, engagement: 0, sources: new Set<string>(), covered: null as string | null, example_url: r.url };
    g.count++; g.engagement += r.engagement || 0; g.sources.add(r.source);
    if (r.matched_url) g.covered = r.matched_url;
    groups.set(k, g);
  }
  const out: Opportunity[] = [];
  for (const g of groups.values()) {
    const growth = Math.min(3, rising.get(g.topic) || 1);
    const gap = g.covered ? 0.4 : 1;
    const score = Math.round((Math.log2(g.count + 1) * 2 + Math.log2(g.engagement + 1) + g.sources.size) * growth * gap * 10) / 10;
    out.push({ topic: g.topic, question: g.question, count: g.count, engagement: g.engagement, sources: [...g.sources].join(", "), covered: g.covered, score, example_url: g.example_url });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Daily brief: top opportunities turned into content suggestions. */
export async function buildBrief(env: Env) {
  const opps = (await opportunities(env, 14, undefined, 25)).filter((o) => !o.covered);
  const rising = (await risingTopics(env)).slice(0, 5);
  const myths = await env.DB.prepare(`SELECT e.topic, COALESCE(e.question, i.title) AS claim, i.url FROM enrichments e JOIN items i ON i.id=e.item_id WHERE i.project=?1 AND e.kind='myth' AND i.collected_date>=?2${regionSql("e.region")} ORDER BY i.engagement DESC LIMIT 5`).bind(PROJECT.id, daysAgo(14)).all<any>();
  let ideas: any[] = [];
  let model = "rules";
  if (env.AI && env.MOCK !== "1" && opps.length) {
    try {
      const prompt = `You plan content for Companimal, a UK puppy marketplace (buyers, breeders, rescues). Use UK English and UK context only. From these UK audience questions, propose 5 article ideas.
Each idea: {"title": article title with the keyword before any colon, "topic": topic id, "why": one sentence on the audience signal, "questions": up to 4 of the listed questions it should answer as H2s}.
Return ONLY a JSON array.
Questions (topic | question | mentions | engagement):
${opps.slice(0, 20).map((o) => `${o.topic} | ${o.question} | ${o.count} | ${o.engagement}`).join("\n")}
Rising topics: ${rising.map((r) => `${r.label} (x${r.ratio.toFixed(1)})`).join(", ")}`;
      const [text, used] = await runAi(env, prompt, 1500, 0.2);
      const m = text.match(/\[[\s\S]*\]/);
      if (m) { ideas = JSON.parse(m[0]); model = used; }
    } catch (e) { console.error("brief AI failed", e); }
  }
  if (!ideas.length) {
    ideas = opps.slice(0, 5).map((o) => ({ title: o.question, topic: o.topic, why: `${o.count} mentions, ${o.engagement} engagement, not covered on the site yet`, questions: [o.question] }));
  }
  const body = { ideas, rising: rising.map(({ spark, ...r }) => r), myths: myths.results || [], generated_at: nowIso() };
  await env.DB.prepare(`INSERT OR REPLACE INTO briefs (project, date, body_json, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(PROJECT.id, today(), JSON.stringify(body), model, nowIso()).run();
  return { added: ideas.length, seen: opps.length, note: model };
}
