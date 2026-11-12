import { TOPICS, PROJECT } from "../config/taxonomy";
import { Env, nowIso, clean } from "./lib";

export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const KINDS = ["question", "problem", "recommendation", "myth", "story", "opinion", "other"];
const STOP = new Set("a an the and or but if of to in on for with is are was were be been it this that my your i we you our at as by from how what why when which who do does did can could should would will just so me im i'm uk".split(" "));

// Words too common in this niche to signal that a page answers a question
const GENERIC = new Set("puppy puppies pup dog dogs advice guide statistics companimal get got need want know new best good really".split(" "));

export function tokens(s: string): string[] {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Light stemming so "scams"/"scam" and "breeders"/"breeder" match. */
const stem = (w: string) => w.replace(/(ing|ers|er|es|s)$/, "");
export function matchTokens(s: string): string[] {
  return [...new Set(tokens(s).filter((w) => !GENERIC.has(w)).map(stem))];
}

/** Rules-based fallback, also used for very short texts to save AI calls. */
export function heuristic(title: string, text: string) {
  const t = `${title} ${text}`.toLowerCase();
  let topic = "other", best = 0;
  for (const tp of TOPICS) {
    const hits = tp.keywords.filter((k) => t.includes(k)).length;
    if (hits > best) { best = hits; topic = tp.id; }
  }
  const body = (text || title || "").trim();
  let kind = "other";
  if (/\b(myth|is it true|i heard|old wives|apparently)\b/.test(t)) kind = "myth";
  else if (/\?/.test(body) || /^(how|what|why|when|which|should|can|is|are|do|does|where|has anyone)\b/i.test(body)) kind = "question";
  else if (/\b(help|struggling|problem|issue|worried|nightmare|won't|can't)\b/.test(t)) kind = "problem";
  else if (/\b(recommend|best|suggestions?)\b/.test(t)) kind = "recommendation";
  else if (/\b(we got|our puppy|my dog|my puppy|when we|last year)\b/.test(t)) kind = "story";
  else if (body.length > 40) kind = "opinion";
  const qm = body.match(/[^.!?]*\?/);
  const question = kind === "question" ? clean(qm ? qm[0] : body, 240) : null;
  const lens = TOPICS.find((x) => x.id === topic)?.lens[0] || "owner";
  return { kind, topic, lens, question, sentiment: "neutral" };
}

function buildPrompt(batch: { id: string; title: string; text: string; source: string }[]) {
  const topicList = TOPICS.map((t) => `${t.id} (${t.label})`).join(", ");
  return `You classify UK dog-related social posts to inform content strategy for a puppy marketplace.
For each post return an object with:
- id: the given id
- kind: one of ${KINDS.join(", ")}
- question: if the post asks or implies a question, rewrite it as one clear standalone question in plain UK English, keeping the poster's own wording where possible (max 20 words); otherwise null
- topic: one of [${topicList}]
- lens: buyer, breeder, rescue or owner (who is speaking or who the question is for)
- sentiment: positive, negative or neutral
"myth" means the post repeats a belief that may be untrue. "story" means a first-hand experience.
Return ONLY a JSON array, no prose.

Posts:
${batch.map((b) => JSON.stringify({ id: b.id, source: b.source, title: b.title.slice(0, 200), text: b.text.slice(0, 600) })).join("\n")}`;
}

function parseJsonArray(s: string): any[] {
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}

async function urlMatch(env: Env, q: string): Promise<{ url: string | null; score: number }> {
  const qt = new Set(matchTokens(q));
  if (!qt.size) return { url: null, score: 0 };
  const rows = await env.DB.prepare(`SELECT url, tokens FROM site_urls WHERE project=?1`).bind(PROJECT.id).all<any>();
  let best: string | null = null, bestScore = 0;
  for (const r of rows.results || []) {
    const ut = matchTokens(r.tokens);
    const overlap = ut.filter((w) => qt.has(w)).length;
    if (overlap < 2) continue; // one shared word is not coverage
    const score = overlap / Math.max(2, Math.min(qt.size, ut.length));
    if (score > bestScore) { bestScore = score; best = r.url; }
  }
  return bestScore >= 0.6 ? { url: best, score: bestScore } : { url: null, score: bestScore };
}

/** Enrich up to `limit` unenriched items. Runs hourly. */
export async function enrichItems(env: Env, limit = 200) {
  const rows = await env.DB.prepare(`SELECT id, source, COALESCE(title,'') AS title, COALESCE(text,'') AS text FROM items WHERE enriched=0 AND project=?1 ORDER BY collected_at LIMIT ?2`).bind(PROJECT.id, limit).all<any>();
  const items = rows.results || [];
  if (!items.length) return { added: 0, seen: 0, note: "nothing to enrich" };

  const results = new Map<string, any>();
  const forAi = items.filter((i) => (i.text || i.title).length >= 25);
  let aiUsed = 0;
  if (env.AI && env.MOCK !== "1") {
    for (let i = 0; i < forAi.length; i += 15) {
      const batch = forAi.slice(i, i + 15);
      try {
        const out: any = await env.AI.run(AI_MODEL as any, { messages: [{ role: "user", content: buildPrompt(batch) }], max_tokens: 2500, temperature: 0 } as any);
        for (const r of parseJsonArray(out?.response ?? String(out))) {
          if (r?.id && KINDS.includes(r.kind)) { results.set(r.id, r); aiUsed++; }
        }
      } catch (e) {
        console.error("AI batch failed", e);
      }
    }
  }

  const validTopics = new Set(TOPICS.map((t) => t.id));
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    const h = heuristic(it.title, it.text);
    const ai = results.get(it.id);
    const e = ai ? {
      kind: ai.kind,
      topic: validTopics.has(ai.topic) ? ai.topic : h.topic,
      lens: ["buyer", "breeder", "rescue", "owner"].includes(ai.lens) ? ai.lens : h.lens,
      question: ai.question ? clean(ai.question, 240) : null,
      sentiment: ["positive", "negative", "neutral"].includes(ai.sentiment) ? ai.sentiment : "neutral",
      model: AI_MODEL,
    } : { ...h, model: "heuristic" };
    // PAA titles are questions by definition
    if (it.source === "serp_paa") { e.kind = "question"; e.question = clean(it.title, 240); }
    const m = e.question || e.kind !== "other" ? await urlMatch(env, `${e.question || it.title}`) : { url: null, score: 0 };
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO enrichments (item_id, kind, question, topic, lens, sentiment, matched_url, match_score, model, enriched_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
      .bind(it.id, e.kind, e.question, e.topic, e.lens, e.sentiment, m.url, m.score, e.model, nowIso()));
    stmts.push(env.DB.prepare(`UPDATE items SET enriched=1 WHERE id=?1`).bind(it.id));
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return { added: items.length, seen: items.length, note: `ai=${aiUsed}` };
}

/** Refresh site URLs from the sitemap for content gap matching. */
export async function refreshSitemap(env: Env) {
  const locs: string[] = [];
  const fetchLocs = async (url: string) => {
    const res = await fetch(url, { headers: { "User-Agent": "CompanimalSocialListening/1.0" } });
    if (!res.ok) throw new Error(`sitemap ${url} HTTP ${res.status}`);
    const xml = await res.text();
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  };
  const top = await fetchLocs(PROJECT.sitemap);
  const children = top.filter((u) => u.endsWith(".xml"));
  if (children.length) for (const c of children.slice(0, 25)) locs.push(...(await fetchLocs(c)));
  else locs.push(...top);
  // Content pages only: skip programmatic location x breed listings
  const content = locs.filter((u) => /puppy-advice|statistics|sell-my-pupp|guide|advice|blog/.test(u));
  const stmts = content.map((u) => {
    const slug = new URL(u).pathname.replace(/\//g, " ");
    return env.DB.prepare(`INSERT OR REPLACE INTO site_urls (project, url, tokens, updated_at) VALUES (?1, ?2, ?3, ?4)`).bind(PROJECT.id, u, tokens(slug).join(" "), nowIso());
  });
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return { added: content.length, seen: locs.length, note: `${content.length} content URLs of ${locs.length}` };
}
