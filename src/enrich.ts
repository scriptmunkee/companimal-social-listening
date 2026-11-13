import { TOPICS, PROJECT, UK_SIGNALS, NON_UK_SIGNALS, UK_FORUM_DOMAINS } from "../config/taxonomy";
import { Env, nowIso, clean, inWaves } from "./lib";

export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
// Used if the main model is retired or failing
export const AI_FALLBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const REGIONS = ["uk", "non_uk", "unknown"];

/**
 * Workers AI returns `response` as a string, or already parsed into an array/object
 * when the model outputs JSON. Normalise any of those into an array of objects.
 */
export function toArray(resp: unknown): any[] {
  if (Array.isArray(resp)) return resp;
  if (resp && typeof resp === "object") {
    const firstArray = Object.values(resp as Record<string, unknown>).find(Array.isArray);
    return (firstArray as any[]) || [resp];
  }
  if (typeof resp === "string") {
    const m = resp.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try { return JSON.parse(m[0]); } catch { return []; }
  }
  return [];
}

/** Run a prompt on the main model, falling back to the backup model. Returns [array, modelUsed]. */
export async function runAi(env: Env, prompt: string, maxTokens: number, temperature = 0): Promise<[any[], string]> {
  let lastErr: unknown = new Error("AI returned nothing usable");
  for (const model of [AI_MODEL, AI_FALLBACK_MODEL]) {
    try {
      const out: any = await env.AI!.run(model as any, { messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature } as any);
      const arr = toArray(out?.response ?? out);
      if (arr.length) return [arr, model];
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** Rules-based region guess from text, source and community. */
export function regionOf(text: string, url: string | null, community: string | null, query: string | null): string {
  const t = ` ${text.toLowerCase()} `;
  const uk = UK_SIGNALS.filter((k) => t.includes(k)).length;
  const non = NON_UK_SIGNALS.filter((k) => t.includes(k)).length;
  const host = (() => { try { return url ? new URL(url).hostname : ""; } catch { return ""; } })();
  const ukSource = host.endsWith(".uk") || UK_FORUM_DOMAINS.some((d) => host.endsWith(d)) || /r\/(askuk|casualuk|unitedkingdom|uk)/i.test(`${community} ${url}`) || (query || "").startsWith("uk-channel:");
  if (non > uk && non >= 1) return "non_uk";
  if (uk > non || ukSource) return "uk";
  return "unknown";
}
const KINDS = ["question", "problem", "recommendation", "myth", "story", "opinion", "other", "irrelevant"];
// Must mention something dog-related to be considered at all when the AI isn't available
const DOG_TERMS = /\b(dogs?|pupp(y|ies)|pups?|canine|breeders?|breed|rescue|rehom\w*|kennel|whelp\w*|litters?|vet|jabs?|lead|walkies|crate|chew\w*|bark\w*|groom\w*|spaniel|labrador|lab|retriever|terrier|poodle|cockapoo|cavapoo|doodle|bulldog|collie|shepherd|dachshund|pug|husky|greyhound|lurcher|staff(ie|y)|insurance)\b/i;
const wordCount = (s: string | null) => (s || "").trim().split(/\s+/).filter(Boolean).length;
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
  if (!DOG_TERMS.test(text || title)) return { kind: "irrelevant", topic: "other", lens: "owner", question: null as string | null, sentiment: "neutral" };
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
  let question = kind === "question" ? clean(qm ? qm[0] : body, 240) : null;
  // Rules can't judge relevance well: only keep questions that hit a real topic and are a real sentence
  if (question && (topic === "other" || wordCount(question) < 4)) { question = null; kind = "other"; }
  const lens = TOPICS.find((x) => x.id === topic)?.lens[0] || "owner";
  return { kind, topic, lens, question, sentiment: "neutral" };
}

function buildPrompt(batch: { id: string; title: string; text: string; source: string }[]) {
  const topicList = TOPICS.map((t) => `${t.id} (${t.label})`).join(", ");
  return `You classify UK dog-related social posts to inform content strategy for a puppy marketplace.
For each post return an object with:
- id: the given id
- kind: one of ${KINDS.join(", ")}. Use "irrelevant" for anything not genuinely about dogs, puppies, dog ownership, breeding, buying, selling or rehoming dogs: jokes, memes, compliments to the creator ("great video"), food, other animals, TV, off-topic chat. Be strict.
- question: only if the post asks or implies a genuine question a dog owner, buyer, breeder or rescue would want answered, rewrite it as one clear standalone question in plain UK English, keeping the poster's own wording where possible (max 20 words); otherwise null
- topic: one of [${topicList}]
- lens: buyer, breeder, rescue or owner (who is speaking or who the question is for)
- sentiment: positive, negative or neutral
- region: "uk" if the poster is clearly in the UK (£, UK places, NHS, councils, Kennel Club, RSPCA, Dogs Trust, UK spelling and phrasing like "jabs"), "non_uk" if clearly elsewhere ($, US states, "shots", AKC, ASPCA, US spelling), otherwise "unknown"
"myth" means the post repeats a belief that may be untrue. "story" means a first-hand experience.
Return ONLY a JSON array, no prose.

Posts:
${batch.map((b) => JSON.stringify({ id: b.id, source: b.source, title: b.title.slice(0, 200), text: b.text.slice(0, 600) })).join("\n")}`;
}


export async function loadSiteUrls(env: Env): Promise<{ url: string; tokens: string[] }[]> {
  const rows = await env.DB.prepare(`SELECT url, tokens FROM site_urls WHERE project=?1`).bind(PROJECT.id).all<any>();
  return (rows.results || []).map((r: any) => ({ url: r.url, tokens: matchTokens(r.tokens) }));
}

export function urlMatch(site: { url: string; tokens: string[] }[], q: string): { url: string | null; score: number } {
  const qt = new Set(matchTokens(q));
  if (!qt.size) return { url: null, score: 0 };
  let best: string | null = null, bestScore = 0;
  for (const r of site) {
    const ut = r.tokens;
    const overlap = ut.filter((w) => qt.has(w)).length;
    if (overlap < 2) continue; // one shared word is not coverage
    const score = overlap / Math.max(2, Math.min(qt.size, ut.length));
    if (score > bestScore) { bestScore = score; best = r.url; }
  }
  return bestScore >= 0.6 ? { url: best, score: bestScore } : { url: null, score: bestScore };
}

/** Enrich up to `limit` unenriched items, stopping cleanly at `deadline`. Unfinished items wait for the next run. */
export async function enrichItems(env: Env, limit = 200, deadline = Date.now() + 8 * 60000) {
  const rows = await env.DB.prepare(`SELECT id, source, url, community, query, COALESCE(title,'') AS title, COALESCE(text,'') AS text FROM items WHERE enriched=0 AND project=?1 ORDER BY collected_at LIMIT ?2`).bind(PROJECT.id, limit).all<any>();
  const items = rows.results || [];
  if (!items.length) return { added: 0, seen: 0, note: "nothing to enrich" };

  const results = new Map<string, any>();
  const forAi = items.filter((i) => (i.text || i.title).length >= 25);
  let aiUsed = 0;
  const useAi = !!env.AI && env.MOCK !== "1";
  // Items the AI looked at (or tried to). Anything not attempted before the deadline is left for next run.
  const attempted = new Set<string>();
  if (useAi) {
    const batches: any[][] = [];
    for (let i = 0; i < forAi.length; i += 15) batches.push(forAi.slice(i, i + 15));
    await inWaves(batches, 4, deadline, async (batch) => {
      try {
        const [rows, model] = await runAi(env, buildPrompt(batch), 3000);
        for (const r of rows) if (r?.id && KINDS.includes(r.kind)) { results.set(r.id, { ...r, model }); aiUsed++; }
        for (const b of batch) attempted.add(b.id);
      } catch (e) {
        console.error("AI batch failed", String((e as any)?.message || e));
      }
    });
  }

  const validTopics = new Set(TOPICS.map((t) => t.id));
  const site = await loadSiteUrls(env);
  const stmts: D1PreparedStatement[] = [];
  let skipped = 0;
  for (const it of items) {
    // Long posts the AI never got to (deadline or failure) wait for the next run instead of getting rules-only tags
    if (useAi && (it.text || it.title).length >= 25 && !attempted.has(it.id)) { skipped++; continue; }
    const h = heuristic(it.title, it.text);
    const ai = results.get(it.id);
    const e = ai ? {
      kind: ai.kind,
      topic: validTopics.has(ai.topic) ? ai.topic : h.topic,
      lens: ["buyer", "breeder", "rescue", "owner"].includes(ai.lens) ? ai.lens : h.lens,
      question: ai.question ? clean(ai.question, 240) : null,
      sentiment: ["positive", "negative", "neutral"].includes(ai.sentiment) ? ai.sentiment : "neutral",
      model: ai.model || AI_MODEL,
    } : { ...h, model: "heuristic" };
    // Region: rules first (hard signals), AI decides the rest
    const ruleRegion = regionOf(`${it.title} ${it.text}`, it.url, it.community, it.query);
    const aiRegion = ai && REGIONS.includes(ai.region) ? ai.region : "unknown";
    const region = ruleRegion !== "unknown" ? ruleRegion : aiRegion;
    // PAA titles are questions by definition
    if (it.source === "serp_paa") { e.kind = "question"; e.question = clean(it.title, 240); }
    if (e.kind === "irrelevant" || wordCount(e.question) < 4) e.question = null;
    const m = e.question || !["other", "irrelevant"].includes(e.kind) ? urlMatch(site, `${e.question || it.title}`) : { url: null, score: 0 };
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO enrichments (item_id, kind, question, topic, lens, sentiment, matched_url, match_score, model, enriched_at, region) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
      .bind(it.id, e.kind, e.question, e.topic, e.lens, e.sentiment, m.url, m.score, e.model, nowIso(), region));
    stmts.push(env.DB.prepare(`UPDATE items SET enriched=1 WHERE id=?1`).bind(it.id));
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return { added: items.length - skipped, seen: items.length, note: `ai=${aiUsed}${skipped ? `, ${skipped} left for next run` : ""}` };
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
