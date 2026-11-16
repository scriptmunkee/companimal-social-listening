// The insight layer: turns every channel into a short ranked list of moves for companimal.co.uk.
// Each move is Finding (the takeaway, with a number) -> So what (why it matters for the site) -> Now what
// (one action on one named page). Moves keep their status across daily rebuilds via `key`; a closed move
// only comes back if its evidence doubles, and "Not relevant" closes it for good.
//
// Reads across channels: Reddit (themes and per-thread readings), and questions and myths from YouTube,
// People Also Ask, forums and the web (items + enrichments).
import { PROJECT, TOPICS, SEASONS, TOOL_HOOKS, DEMAND } from "../config/taxonomy";
import { Env, nowIso, today, daysAgo, slug, batch, monthOf, inSeason, clean } from "./lib";
import { runAi, tidy, cleanIdea, AI_STRONG_MODEL, AI_MODEL } from "./enrich";
import { normQ } from "./analysis";
import { threadScore } from "./collectors/reddit";
import { sitePages, breedName, breedInText, SitePage } from "./site";

export const TYPES: Record<string, { label: string; short: string; weight: number }> = {
  new_article: { label: "New article", short: "New", weight: 1.0 },
  update_article: { label: "Update an article", short: "Update", weight: 1.15 },
  demand: { label: "Demand signal", short: "Demand", weight: 1.1 },
  seasonal: { label: "Seasonal", short: "Seasonal", weight: 0.95 },
  myth: { label: "Myth to correct", short: "Myth", weight: 0.9 },
  tool: { label: "Tool or calculator hook", short: "Tool", weight: 1.0 },
};
export const STATUSES = ["new", "planned", "done", "dismissed"] as const;
export const STATUS_LABEL: Record<string, string> = { new: "Open", planned: "Planned", done: "Done", dismissed: "Dismissed" };
export const DISMISS_REASONS = ["Not relevant", "Already covered", "Not now", "Wrong page"];
export const SOURCE_NAME: Record<string, string> = { reddit: "Reddit", youtube: "YouTube", serp_forum: "Forums", serp_discussions: "Forums", serp_paa: "People Also Ask", content_analysis: "Web" };
const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const topicLabel = (id: string | null) => TOPICS.find((t) => t.id === id)?.label || id || "";

/** One piece of evidence: a Reddit thread or a post from another channel. */
export interface Ev {
  id: string; ch: string; title: string | null; url: string | null; where: string | null; comments: number | null; upvotes: number | null; engagement: number;
  question: string | null; replies: string | null; region: string | null; uk_region: string | null; urgency: string | null; created: string | null; s: number;
}
interface Card {
  key: string; type: string; headline: string; so_what: string; action: string; action_label: string;
  target: string | null; target_exists: boolean; topic: string | null; breed: string | null; lens: string | null;
  evidence: Ev[]; extra?: Record<string, unknown>; model: string;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Reddit threads read in the last 14 days that count for "now": relevant, not clearly overseas, recent. */
async function recentThreads(env: Env): Promise<any[]> {
  return (await env.DB.prepare(`SELECT t.post_id, t.subreddit, t.url, t.title, t.posts_count, t.posts_count_prev, t.score, t.score_prev, t.seen_count, t.best_rank, t.created_at, t.first_seen,
      i.kind, i.theme, i.pain_point, i.need, i.content_angle, i.lens, i.topic, i.region, i.replies, i.breed, i.breed_slug, i.intent, i.urgency, i.uk_region, i.question, i.disagreement, i.asks_for_guide
    FROM reddit_threads t JOIN reddit_insights i ON i.post_id = t.post_id
    WHERE t.project=?1 AND t.last_seen >= ?2 AND i.kind <> 'irrelevant' AND COALESCE(i.region,'unknown') <> 'non_uk'
      AND (t.created_at >= ?3 OR (t.created_at IS NULL AND COALESCE(t.via,'') <> 'search'))`).bind(PROJECT.id, daysAgo(14), daysAgo(30)).all<any>()).results || [];
}

const threadEv = (t: any): Ev => ({
  id: t.post_id, ch: "reddit", title: t.title, url: t.url, where: `r/${t.subreddit}`, comments: t.posts_count ?? null, upvotes: t.score ?? null,
  engagement: (t.posts_count || 0) + Math.max(0, t.score || 0), question: t.question || null, replies: t.replies || null, region: t.region || null,
  uk_region: t.uk_region || null, urgency: t.urgency || null, created: t.created_at || t.first_seen || null, s: threadScore(t),
});

const itemEv = (r: any): Ev => ({
  id: r.id, ch: r.source, title: r.title || r.question, url: r.url, where: r.community || SOURCE_NAME[r.source] || r.source, comments: null, upvotes: null,
  engagement: r.engagement || 0, question: r.question || null, replies: null, region: r.region || null, uk_region: null, urgency: null, created: r.collected_date,
  // A question asked on another channel weighs like a modest thread: more for engagement, more for UK
  s: Math.round((5 + Math.log2(1 + (r.engagement || 0)) * 1.5 + (r.region === "uk" ? 2 : 0)) * 10) / 10,
});

/** Questions from the other channels (YouTube, People Also Ask, forums, web), grouped by wording within a topic. */
async function channelQuestions(env: Env) {
  const rows = (await env.DB.prepare(`SELECT i.id, i.source, i.url, i.title, i.community, i.engagement, i.collected_date, e.question, e.topic, e.lens, e.region, e.matched_url
    FROM items i JOIN enrichments e ON e.item_id = i.id
    WHERE i.project=?1 AND i.collected_date >= ?2 AND i.source <> 'reddit' AND e.question IS NOT NULL AND e.kind <> 'irrelevant' AND COALESCE(e.region,'unknown') <> 'non_uk'
    ORDER BY i.engagement DESC LIMIT 4000`).bind(PROJECT.id, daysAgo(14)).all<any>()).results || [];
  const groups = new Map<string, { topic: string; question: string; lens: string; matched: string | null; items: any[]; sources: Set<string> }>();
  for (const r of rows) {
    const k = `${r.topic}|${normQ(r.question)}`;
    if (!normQ(r.question)) continue;
    const g = groups.get(k) || { topic: r.topic, question: r.question, lens: r.lens, matched: null, items: [] as any[], sources: new Set<string>() };
    g.items.push(r); g.sources.add(r.source);
    if (r.matched_url) g.matched = r.matched_url;
    groups.set(k, g);
  }
  return [...groups.values()].filter((g) => g.items.length >= 2 || g.sources.size >= 2)
    .sort((a, b) => b.items.length - a.items.length || b.items.reduce((x, i) => x + (i.engagement || 0), 0) - a.items.reduce((x, i) => x + (i.engagement || 0), 0)).slice(0, 25);
}

/** Claims repeated on other channels that the AI tagged as myths, grouped by wording. */
async function channelMyths(env: Env) {
  const rows = (await env.DB.prepare(`SELECT i.id, i.source, i.url, i.title, i.community, i.engagement, i.collected_date, COALESCE(e.question, i.title) AS question, e.topic, e.region
    FROM items i JOIN enrichments e ON e.item_id = i.id
    WHERE i.project=?1 AND i.collected_date >= ?2 AND e.kind = 'myth' AND COALESCE(e.region,'unknown') <> 'non_uk'`).bind(PROJECT.id, daysAgo(30)).all<any>()).results || [];
  const groups = new Map<string, { topic: string; claim: string; items: any[] }>();
  for (const r of rows) {
    const k = `${r.topic}|${normQ(r.question || "")}`;
    if (!normQ(r.question || "")) continue;
    const g = groups.get(k) || { topic: r.topic, claim: r.question, items: [] as any[] };
    g.items.push(r);
    groups.set(k, g);
  }
  return [...groups.values()].filter((g) => g.items.length >= 2).sort((a, b) => b.items.length - a.items.length).slice(0, 6);
}

function metricsOf(ev: Ev[]) {
  const reddit = ev.filter((e) => e.ch === "reddit");
  const uk = ev.filter((e) => e.region === "uk").length;
  const regions = new Map<string, number>();
  for (const e of ev) if (e.uk_region) regions.set(e.uk_region, (regions.get(e.uk_region) || 0) + 1);
  const channels = [...new Set(ev.map((e) => SOURCE_NAME[e.ch] || e.ch))];
  return {
    threads: reddit.length, posts: ev.length - reddit.length, comments: reddit.reduce((a, e) => a + (e.comments || 0), 0), upvotes: reddit.reduce((a, e) => a + Math.max(0, e.upvotes || 0), 0),
    uk, ukShare: ev.length ? uk / ev.length : 0, urgent: ev.filter((e) => e.urgency === "now").length, channels,
    topRegion: [...regions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
  };
}

function priorityOf(c: Card): number {
  const top = c.evidence.map((e) => e.s).sort((a, b) => b - a).slice(0, 10);
  const m = metricsOf(c.evidence);
  let p = top.reduce((a, s) => a + s, 0) / 4 + Math.log2(1 + c.evidence.length) * 4;
  p *= TYPES[c.type]?.weight || 1;
  const asks = Number(c.extra?.guideAsks || 0);
  if (asks) p *= 1 + 0.2 * Math.min(asks, 5); // people explicitly asking for a guide: the strongest content signal
  if (m.urgent) p *= 1.15;
  if (m.channels.length >= 2) p *= 1.15; // the same thing raised on more than one channel
  // A UK site: lean towards what's clearly UK, without burying universal dog questions (most posts don't say where they are)
  if (c.evidence.length) p *= m.uk >= 2 ? 0.8 + 0.2 * m.ukShare : 0.7;
  if (c.type === "seasonal") p = Math.min(Math.max(p, 12), 45); // useful, but never above what people are asking now
  return Math.round(p * 10) / 10;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function buildInsights(env: Env) {
  const threads = await recentThreads(env);
  const byId = new Map(threads.map((t: any) => [t.post_id, t]));
  const latest = await env.DB.prepare(`SELECT MAX(date) AS d FROM reddit_themes WHERE project=?1`).bind(PROJECT.id).first<any>();
  const themes = latest?.d ? ((await env.DB.prepare(`SELECT * FROM reddit_themes WHERE project=?1 AND date=?2`).bind(PROJECT.id, latest.d).all<any>()).results || []) : [];
  for (const t of themes) {
    const list = JSON.parse(t.thread_ids_json || "[]").map((id: string) => byId.get(id)).filter(Boolean);
    t.list = list; t.comments = list.reduce((a: number, x: any) => a + (x.posts_count || 0), 0); t.upvotes = list.reduce((a: number, x: any) => a + Math.max(0, x.score || 0), 0);
    t.uk = list.filter((x: any) => x.region === "uk").length; t.asks = list.filter((x: any) => x.asks_for_guide).length;
    const topics = new Map<string, number>(); for (const x of list) topics.set(x.topic, (topics.get(x.topic) || 0) + 1);
    t.topic = [...topics.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const breeds = new Map<string, number>(); for (const x of list) if (x.breed_slug) breeds.set(x.breed_slug, (breeds.get(x.breed_slug) || 0) + 1);
    const tb = [...breeds.entries()].sort((a, b) => b[1] - a[1])[0];
    t.breed = tb && tb[1] >= Math.max(2, list.length / 2) ? tb[0] : null;
  }
  themes.sort((a: any, b: any) => (b.comments + b.upvotes) - (a.comments + a.upvotes));
  // Topic-level labels ("Training and behaviour", "Other") are categories, not themes: never a move
  const generic = new Set(["other", ...TOPICS.map((t) => t.label.toLowerCase())]);
  const usable = themes.filter((t: any) => t.list.length >= 2 && !generic.has(String(t.theme).toLowerCase())).slice(0, 12);
  const questions = await channelQuestions(env);
  const myths = await channelMyths(env);

  // Demand: commercial intent, by intent and breed (breed rows need 2+ threads; the rest pool by intent)
  const demandRows: { intent: string; breed: string | null; list: any[]; prev: number }[] = [];
  const prevRows = (await env.DB.prepare(`SELECT i.intent, i.breed_slug, COUNT(*) AS n FROM reddit_threads t JOIN reddit_insights i ON i.post_id = t.post_id
      WHERE t.project=?1 AND COALESCE(t.created_at, t.first_seen) >= ?2 AND COALESCE(t.created_at, t.first_seen) < ?3 AND i.kind <> 'irrelevant' AND COALESCE(i.region,'unknown') <> 'non_uk'
        AND i.intent IN ('buy','sell','stud','rehome','adopt') GROUP BY i.intent, i.breed_slug`).bind(PROJECT.id, daysAgo(28), daysAgo(14)).all<any>()).results || [];
  for (const intent of Object.keys(DEMAND)) {
    const list = threads.filter((t: any) => t.intent === intent);
    const breeds = new Map<string, any[]>();
    for (const t of list) if (t.breed_slug) breeds.set(t.breed_slug, [...(breeds.get(t.breed_slug) || []), t]);
    const used = new Set<string>();
    for (const [b, l] of breeds) if (l.length >= 2 && DEMAND[intent].breedHub) {
      demandRows.push({ intent, breed: b, list: l, prev: prevRows.filter((r: any) => r.intent === intent && r.breed_slug === b).reduce((a: number, r: any) => a + r.n, 0) });
      l.forEach((t) => used.add(t.post_id));
    }
    const rest = list.filter((t: any) => !used.has(t.post_id));
    if (rest.length >= 2) demandRows.push({ intent, breed: null, list: rest, prev: prevRows.filter((r: any) => r.intent === intent).reduce((a: number, r: any) => a + r.n, 0) });
  }
  demandRows.sort((a, b) => b.list.length - a.list.length);

  // Myths on Reddit: replies that disagree or repeat risky advice, grouped by theme
  const redditMyths = new Map<string, any[]>();
  for (const t of threads.filter((x: any) => x.disagreement)) redditMyths.set(t.theme || "Other", [...(redditMyths.get(t.theme || "Other") || []), t]);
  const mythRows = [
    ...[...redditMyths.entries()].filter(([theme, l]) => l.length >= 2 && !generic.has(theme.toLowerCase())).map(([theme, l]) => ({ label: theme, topic: l[0].topic, ev: l.map(threadEv), say: l.slice(0, 4).map((t) => t.replies || t.title).join(" / ") })),
    ...myths.map((g) => ({ label: g.claim, topic: g.topic, ev: g.items.map(itemEv), say: g.items.slice(0, 3).map((i: any) => i.title || i.question).join(" / ") })),
  ].sort((a, b) => b.ev.length - a.ev.length).slice(0, 6);

  // Pages and dismissed history, for targets and for not repeating closed moves
  const pages = await sitePages(env);
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const articles = pages.filter((p) => p.kind === "advice" || p.kind === "statistics" || p.path === "/lucys-law");
  const dismissed = (await env.DB.prepare(`SELECT headline, dismissed_reason FROM insights WHERE project=?1 AND status='dismissed' AND status_at >= ?2 ORDER BY status_at DESC LIMIT 25`).bind(PROJECT.id, daysAgo(60)).all<any>()).results || [];

  const norm = (p: string) => p.replace(/\/+$/, "") || "/";
  const pageFor = (target: unknown): SitePage | null => {
    if (typeof target !== "string" || !target.startsWith("/")) return null;
    return byPath.get(target) || byPath.get(norm(target)) || byPath.get(`${norm(target)}/`) || null;
  };
  const articleTarget = (target: unknown, fallback: string) => {
    const p = pageFor(target);
    // Index and listing pages (/, /puppy-advice/, /statistics/, /breeds) are never an article to update
    const index = p && ["/", "/puppy-advice/", "/statistics/", "/breeds", "/breeders", "/sale/puppies/", "/stud/dogs/"].includes(p.path);
    if (p && !index && (p.kind === "advice" || p.kind === "statistics" || p.kind === "breed" || p.kind === "core")) return { path: p.path, exists: true };
    const t = typeof target === "string" && /^\/(puppy-advice|statistics)\/[a-z0-9-]+$/.test(norm(target)) ? norm(target) : `/puppy-advice/${slug(fallback).slice(0, 60)}`;
    return { path: t, exists: false };
  };

  const cards: Card[] = [];
  let model = "rules";
  const push = (c: Omit<Card, "target" | "target_exists" | "type"> & { type: string; target: unknown; fallback: string }) => {
    const g = articleTarget(c.target, c.fallback);
    const type = c.type === "article" ? (g.exists ? "update_article" : "new_article") : c.type;
    const { target, fallback, ...rest } = c;
    cards.push({ ...rest, type, target: g.path, target_exists: g.exists });
  };
  const ev = (ids: string[]) => ids.map((id) => byId.get(id)).filter(Boolean).map(threadEv);

  // ---- AI-written moves: themes, cross-channel questions, demand and myths -----------------------
  if (env.AI && env.MOCK !== "1" && (usable.length || questions.length || demandRows.length || mythRows.length)) {
    const prompt = `You decide the next content and page moves for companimal.co.uk, a UK puppy marketplace where buyers find puppies from verified breeders, rescues and rehomers, and breeders list litters.
Site sections: /puppy-advice/ (guides), /statistics/ (the Dog Data Library: UK data articles), /breeds/<breed>/ (breed guides), /sale/puppies/<breed>/ (puppies for sale), /stud/dogs/<breed>/, /sell-my-puppies (breeders list a litter).

Each move has three parts, written for a busy SEO consultant:
- headline: the FINDING as a plain takeaway sentence with a number from the data (never invent numbers). Max 16 words. Count THREADS or POSTS, never call comments or upvotes "people": write "9 threads (1,240 comments)", not "1,240 people". e.g. "Nine threads this fortnight ask whether a £500 deposit before viewing is normal"
- so_what: one sentence on why it matters for Companimal: what people can't find answered, which page is missing or thin, or what the demand means for listings
- action: one imperative sentence: the article title to write, or the existing page and the section to add, or what the hub page must answer
- action_label: 2 to 4 words for a button, e.g. "Draft the article", "Add a section", "Fix the hub page"
- target: an existing path from PAGES when a page already covers the topic but misses what people ask (for a breed-specific topic, the /breeds/<breed>/ page); otherwise a new path /puppy-advice/<short-slug>. For a data question (prices, costs, numbers, how many), prefer a /statistics/ page
- coverage: "missing" (no page answers it), "thin" (a page exists but misses it) or "covered" (a page already answers it well)

Moves to produce:
1. For EACH theme: one move, ref "T" + number. Skip if coverage is "covered".
2. For EACH question cluster: one move, ref "Q" + number. Skip if covered.
3. For EACH demand row: one move, ref "D" + number: what the hub page (given) should answer for these people, and which questions they ask. target = the hub given.
4. For EACH myth row: one move, ref "M" + number: an article or section that corrects it, with the facts a UK reader needs.
Chris dismissed these recently; do NOT suggest them or close variants again:
${dismissed.map((d: any) => `- ${d.headline} (${d.dismissed_reason || "no reason"})`).join("\n") || "(none)"}
Companimal never phones or video-calls breeders; never suggest copy that says it does. UK English, sentence case, never double hyphens, no hype words.
Return ONLY a JSON array of {"ref","headline","so_what","action","action_label","target","coverage"}.

PAGES (path | title):
${articles.filter((p) => !["/puppy-advice/", "/statistics/"].includes(p.path)).map((p) => `${p.path} | ${p.title || p.h1 || ""}`).join("\n")}

THEMES from Reddit (number | theme | threads | comments | upvotes | clearly UK | asked for a guide | breed | what people say | article ideas):
${usable.map((t: any, i: number) => `T${i + 1} | ${t.theme} | ${t.list.length} | ${t.comments} | ${t.upvotes} | ${t.uk} | ${t.asks} | ${t.breed ? breedName(t.breed) : ""} | ${t.summary || ""} | ${JSON.parse(t.ideas_json || "[]").join("; ")}`).join("\n") || "(none yet)"}

QUESTION CLUSTERS from YouTube, People Also Ask, forums and the web (number | question | posts | channels | topic | page that may cover it):
${questions.map((q, i) => `Q${i + 1} | ${q.question} | ${q.items.length} | ${[...q.sources].map((s) => SOURCE_NAME[s] || s).join(", ")} | ${topicLabel(q.topic)} | ${q.matched || ""}`).join("\n") || "(none)"}

DEMAND from Reddit (number | intent | breed | threads, last 14 days | previous 14 days | hub | what they ask):
${demandRows.map((d, i) => `D${i + 1} | ${DEMAND[d.intent].label} | ${d.breed ? breedName(d.breed) : "any"} | ${d.list.length} | ${d.prev} | ${hubFor(d.intent, d.breed, byPath).path} | ${[...new Set(d.list.slice(0, 8).map((t: any) => t.question || t.title))].join("; ").slice(0, 400)}`).join("\n") || "(none)"}

MYTHS (number | claim or theme | posts | what people say):
${mythRows.map((m, i) => `M${i + 1} | ${m.label} | ${m.ev.length} | ${m.say.slice(0, 400)}`).join("\n") || "(none)"}`;
    try {
      const ok = (a: any[]) => a.filter((c) => c && typeof c.headline === "string" && typeof c.ref === "string").length >= 1;
      const [arr, used] = await runAi(env, prompt, 8000, 0.1, [AI_STRONG_MODEL, AI_MODEL], ok, 170000);
      model = used;
      for (const c of arr) {
        if (!c || typeof c.headline !== "string" || c.coverage === "covered") continue;
        const ref = String(c.ref || "").toUpperCase();
        const n = Number(ref.slice(1)) - 1;
        const base = { headline: c.headline, so_what: c.so_what, action: c.action, action_label: c.action_label, model, lens: null as string | null };
        if (ref[0] === "T" && usable[n]) {
          const t = usable[n];
          push({ ...base, key: `article:${slug(t.theme)}`, type: "article", target: c.target, fallback: t.theme, topic: t.topic, breed: t.breed,
            evidence: t.list.map(threadEv), extra: { theme: t.theme, summary: t.summary, ideas: JSON.parse(t.ideas_json || "[]"), coverage: c.coverage, guideAsks: t.asks } });
        } else if (ref[0] === "Q" && questions[n]) {
          const q = questions[n];
          push({ ...base, key: `article:q:${slug(q.question)}`, type: "article", target: c.target || q.matched, fallback: q.question, topic: q.topic, breed: breedInText(q.question), lens: q.lens,
            evidence: q.items.map(itemEv), extra: { question: q.question, coverage: c.coverage } });
        } else if (ref[0] === "D" && demandRows[n]) {
          const d = demandRows[n];
          const hub = hubFor(d.intent, d.breed, byPath);
          cards.push({ ...base, key: `demand:${d.intent}:${d.breed || "any"}`, type: "demand", target: hub.path, target_exists: hub.exists, topic: d.list[0]?.topic || null, breed: d.breed,
            lens: d.intent === "sell" || d.intent === "stud" ? "breeder" : d.intent === "rehome" || d.intent === "adopt" ? "rescue" : "buyer", evidence: d.list.map(threadEv), extra: { intent: d.intent, prev: d.prev } });
        } else if (ref[0] === "M" && mythRows[n]) {
          const m = mythRows[n];
          push({ ...base, key: `myth:${slug(m.label)}`, type: "myth", target: c.target, fallback: `${m.label} myth`, topic: m.topic, breed: null, evidence: m.ev });
        }
      }
    } catch (e) { console.error("insight moves failed", String((e as any)?.message || e)); model = "rules"; }
  }

  // ---- Rules: anything the AI didn't cover (and everything when it's unavailable) --------------
  const have = (key: string) => cards.some((c) => c.key === key);
  for (const t of usable.slice(0, 8)) {
    const key = `article:${slug(t.theme)}`;
    if (have(key) || model !== "rules") continue;
    const ideas = JSON.parse(t.ideas_json || "[]");
    const asks = t.asks ? ` ${t.asks} asked for a guide.` : "";
    push({ key, type: "article", headline: `${t.list.length} threads on "${t.theme}" with ${t.comments.toLocaleString("en-GB")} comments`,
      so_what: `${t.why || "People keep raising this, and the replies don't settle it."}${asks}`, action: ideas[0] ? `Write "${ideas[0]}"` : `Write an article on ${t.theme.toLowerCase()}`,
      action_label: "Draft the article", model: "rules", lens: null, target: t.breed ? `/breeds/${t.breed}/` : null, fallback: ideas[0] || t.theme, topic: t.topic, breed: t.breed,
      evidence: t.list.map(threadEv), extra: { theme: t.theme, summary: t.summary, ideas, guideAsks: t.asks } });
  }
  for (const q of questions.slice(0, 6)) {
    const key = `article:q:${slug(q.question)}`;
    if (have(key) || model !== "rules") continue;
    const channels = [...q.sources].map((s) => SOURCE_NAME[s] || s);
    push({ key, type: "article", headline: `${q.items.length} posts on ${channels.join(" and ")} ask "${q.question.slice(0, 80)}"`,
      so_what: q.matched ? `A page covers the topic but people still ask it this way.` : "Nothing on the site answers it in these words.", action: q.matched ? `Add a section answering "${q.question}"` : `Write an article answering "${q.question}"`,
      action_label: q.matched ? "Add a section" : "Draft the article", model: "rules", lens: q.lens, target: q.matched ? new URL(q.matched, PROJECT.site).pathname : null, fallback: q.question,
      topic: q.topic, breed: breedInText(q.question), evidence: q.items.map(itemEv), extra: { question: q.question } });
  }
  for (const d of demandRows) {
    const key = `demand:${d.intent}:${d.breed || "any"}`;
    if (have(key)) continue;
    const hub = hubFor(d.intent, d.breed, byPath);
    const qs = [...new Set(d.list.map((t: any) => t.question || t.title))].slice(0, 3);
    const who = d.breed ? `${breedName(d.breed)} ${DEMAND[d.intent].who}` : DEMAND[d.intent].who;
    cards.push({ key, type: "demand", headline: `${d.list.length} ${d.list.length === 1 ? "thread" : "threads"} from ${who.toLowerCase()}: ${DEMAND[d.intent].label.toLowerCase()}`,
      so_what: `${d.prev ? `${d.list.length >= d.prev ? "Up" : "Down"} from ${d.prev} the fortnight before. ` : ""}These are people Companimal can serve directly; the hub page should answer what they ask before they go elsewhere.`,
      action: `Make ${hub.path} answer: ${qs.join("; ")}`.slice(0, 300), action_label: "Fix the hub page", model: "rules", target: hub.path, target_exists: hub.exists,
      topic: d.list[0]?.topic || null, breed: d.breed, lens: d.intent === "sell" || d.intent === "stud" ? "breeder" : d.intent === "rehome" || d.intent === "adopt" ? "rescue" : "buyer",
      evidence: d.list.map(threadEv), extra: { intent: d.intent, prev: d.prev } });
  }
  for (const m of mythRows) {
    const key = `myth:${slug(m.label)}`;
    if (have(key) || model !== "rules") continue;
    push({ key, type: "myth", headline: `${m.ev.length} posts repeat or argue over "${m.label.slice(0, 70)}"`, so_what: "Wrong or risky advice is being repeated; a clear, sourced answer is worth publishing.",
      action: `Write a section that settles "${m.label}" with the UK facts`, action_label: "Draft the correction", model: "rules", lens: null, target: null, fallback: `${m.label} myth`, topic: m.topic, breed: null, evidence: m.ev });
  }

  // ---- Direct guide requests no move covers yet --------------------------------------------------
  const covered = new Set(cards.flatMap((c) => c.evidence.map((e) => e.id)));
  const askGroups = new Map<string, any[]>();
  for (const t of threads.filter((x: any) => x.asks_for_guide && !covered.has(x.post_id))) {
    const k = t.theme && !generic.has(String(t.theme).toLowerCase()) ? t.theme : t.question || t.title;
    askGroups.set(k, [...(askGroups.get(k) || []), t]);
  }
  for (const [k, l] of askGroups) {
    const top = l.sort((a, b) => threadScore(b) - threadScore(a))[0];
    push({ key: `article:ask:${slug(k)}`, type: "article", headline: `${l.length === 1 ? "Someone asked" : `${l.length} people asked`} for a guide: "${(top.question || top.title).slice(0, 90)}"`,
      so_what: top.replies ? `Replies so far: ${top.replies}` : "Nobody pointed them to a good answer.", action: top.content_angle ? `Write "${top.content_angle}"` : `Write an article answering "${top.question || top.title}"`,
      action_label: "Draft the article", lens: top.lens || null, model: "rules", target: top.breed_slug ? `/breeds/${top.breed_slug}/` : null, fallback: top.content_angle || k, topic: top.topic, breed: top.breed_slug,
      evidence: l.map(threadEv), extra: { guideAsks: l.length } });
  }

  // ---- Tool or calculator hooks: the same number-question asked again and again ----------------
  const itemQs = (await env.DB.prepare(`SELECT i.id, i.source, i.url, i.title, i.community, i.engagement, i.collected_date, e.question, e.region FROM items i JOIN enrichments e ON e.item_id = i.id
    WHERE i.project=?1 AND i.collected_date >= ?2 AND i.source <> 'reddit' AND e.question IS NOT NULL AND e.kind <> 'irrelevant' AND COALESCE(e.region,'unknown') <> 'non_uk' LIMIT 4000`).bind(PROJECT.id, daysAgo(14)).all<any>()).results || [];
  for (const h of TOOL_HOOKS) {
    const evs = [
      ...threads.filter((t: any) => h.terms.test(`${t.question || ""} ${t.title || ""}`)).map(threadEv),
      ...itemQs.filter((r: any) => h.terms.test(`${r.question || ""} ${r.title || ""}`)).map(itemEv),
    ];
    if (evs.length < 3) continue;
    const page = h.page ? byPath.get(h.page) || byPath.get(`${h.page}/`) : null;
    const target = page ? page.path : h.newPath;
    cards.push({ key: `tool:${h.id}`, type: "tool", headline: `${evs.length} posts in 14 days ask a question a ${h.label.toLowerCase()} would answer`,
      so_what: page ? `${page.title || page.path} answers it in prose; an interactive version earns links, shares and repeat visits.` : "No page answers it, and a calculator is the format people want for a number question.",
      action: page ? `Add a ${h.label.toLowerCase()} to ${page.path}` : `Build a ${h.label.toLowerCase()} at ${h.newPath}`, action_label: page ? "Add the calculator" : "Plan the tool",
      target, target_exists: !!page, topic: null, breed: null, lens: null, model: "rules", evidence: evs, extra: { tool: h.id } });
  }

  // ---- Seasonal: a season opening within 8 weeks, or under way with people already talking -------
  const now = new Date();
  for (const s of SEASONS) {
    const live = inSeason(monthOf(now), s.from, s.to);
    const start = new Date(Date.UTC(now.getUTCFullYear() + (s.from < monthOf(now) ? 1 : 0), s.from - 1, 1));
    const weeks = Math.round((start.getTime() - now.getTime()) / (7 * 86400000));
    const related = threads.filter((t: any) => s.terms.test(`${t.title || ""} ${t.theme || ""} ${t.question || ""}`));
    if (live ? related.length < 3 : weeks > 8 || weeks < 0) continue;
    const g = s.guide ? byPath.get(s.guide) : null;
    const target = g ? g.path : s.newPath;
    cards.push({ key: `seasonal:${s.id}:${live ? now.getUTCFullYear() : start.getUTCFullYear()}`, type: "seasonal",
      headline: live ? `${related.length} threads in 14 days on ${s.label.toLowerCase()}, and the season is under way` : `${s.label} starts in ${MONTHS[s.from]}, ${weeks <= 1 ? "next week" : `${weeks} weeks away`}`,
      so_what: `${s.note}. ${live ? "Searches are live now; the page needs to be ready this week." : related.length ? `${related.length} people raised it already.` : "Pages need to be live before searches pick up."}`,
      action: g ? `Refresh ${g.path} for ${MONTHS[s.from]}: what to do now and what to prepare` : `Publish "${s.title}" ${live ? "this week" : `before ${MONTHS[s.from]}`}`,
      action_label: g ? "Refresh the page" : "Draft the article", target, target_exists: !!g, topic: s.topics[0], breed: null, lens: null, model: "rules",
      evidence: related.map(threadEv), extra: { weeks: live ? 0 : weeks, season: s.id, live } });
  }

  return saveCards(env, cards, { model, themes: usable.length, questions: questions.length, demand: demandRows.length, myths: mythRows.length });
}

/** The hub page for a demand signal: the breed's sale or stud page where it exists, else the general hub. */
function hubFor(intent: string, breed: string | null, byPath: Map<string, SitePage>) {
  const d = DEMAND[intent];
  if (breed && d.breedHub) {
    const p = d.breedHub.replace("{breed}", breed);
    if (byPath.has(p)) return { path: p, exists: true };
  }
  return { path: d.hub, exists: byPath.has(d.hub) || byPath.has(d.hub.replace(/\/$/, "")) };
}

/** Save cards, keeping status. Closed moves stay closed unless the evidence doubles; "Not relevant" closes for good. */
async function saveCards(env: Env, cards: Card[], info: { model: string; themes: number; questions: number; demand: number; myths: number }) {
  const existing = (await env.DB.prepare(`SELECT id, key, status, evidence_at_status, dismissed_reason, status_at, evidence_ids_json FROM insights WHERE project=?1`).bind(PROJECT.id).all<any>()).results || [];
  const byKey = new Map(existing.map((r: any) => [r.key, r]));
  const closed = existing.filter((r: any) => r.status === "done" || r.status === "dismissed" || r.status === "planned").map((r: any) => ({ ...r, ids: new Set<string>(JSON.parse(r.evidence_ids_json || "[]")) }));
  const date = today(), ts = nowIso();
  const stmts: D1PreparedStatement[] = [];
  let created = 0, reopened = 0, merged = 0;
  const seen = new Set<string>();
  const produced: string[] = [];
  for (const c of cards.sort((a, b) => priorityOf(b) - priorityOf(a))) {
    const n = c.evidence.length;
    if ((!n && c.type !== "seasonal") || seen.has(c.key)) continue;
    seen.add(c.key);
    const ids = c.evidence.map((e) => e.id);
    let prev = byKey.get(c.key);
    // The AI may rename a theme: a new move whose evidence mostly overlaps a planned or closed one is that move
    if (!prev && n >= 2) {
      const same = closed.find((r: any) => { const hit = ids.filter((id) => r.ids.has(id)).length; return hit >= 2 && hit >= Math.min(ids.length, r.ids.size) * 0.5; });
      if (same) {
        const reopenable = same.status !== "planned" && same.dismissed_reason !== "Not relevant" && n >= Math.max(4, 2 * (same.evidence_at_status || 0));
        if (!reopenable) { merged++; continue; }
        prev = same;
        c.key = same.key;
      }
    }
    produced.push(c.key);
    const m = { ...metricsOf(c.evidence), ...(c.extra || {}), exists: c.target_exists };
    const channels = [...new Set(c.evidence.map((e) => SOURCE_NAME[e.ch] || e.ch))].join(", ");
    const fields = [c.type, priorityOf(c), tidy(c.headline, 200), tidy(c.so_what, 320), tidy(c.action, 320), tidy(c.action_label, 40) || "Open", c.target, c.target_exists ? 1 : 0,
      c.topic, c.breed, c.lens, channels,
      JSON.stringify(c.evidence.sort((a, b) => b.s - a.s).slice(0, 14).map(({ s, ...e }) => ({ ...e, title: clean(e.title, 200), replies: clean(e.replies, 300) }))),
      JSON.stringify(ids), JSON.stringify(m), ts, date, c.model];
    if (!prev) {
      stmts.push(env.DB.prepare(`INSERT INTO insights (id, project, key, type, priority, headline, so_what, action, action_label, target_url, target_exists, topic, breed, lens, channels,
          evidence_json, evidence_ids_json, metrics_json, updated_at, last_seen_date, model, created_at, status, status_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?19, 'new', ?19)`).bind(crypto.randomUUID(), PROJECT.id, c.key, ...fields));
      created++;
    } else {
      const closedNow = prev.status === "done" || prev.status === "dismissed";
      const notNowExpired = prev.dismissed_reason === "Not now" && prev.status_at < daysAgo(28);
      const reopen = closedNow && prev.dismissed_reason !== "Not relevant" && (notNowExpired || n >= Math.max(4, 2 * (prev.evidence_at_status || 0)));
      if (reopen) reopened++;
      stmts.push(env.DB.prepare(`UPDATE insights SET type=?2, priority=?3, headline=?4, so_what=?5, action=?6, action_label=?7, target_url=?8, target_exists=?9, topic=?10, breed=?11, lens=?12, channels=?13,
          evidence_json=?14, evidence_ids_json=?15, metrics_json=?16, updated_at=?17, last_seen_date=?18, model=?19
        ${reopen ? ", status='new', status_at=?17, brief_json=NULL, dismissed_reason=NULL" : ""} WHERE key=?1`).bind(c.key, ...fields));
      if (reopen) stmts.push(env.DB.prepare(`INSERT INTO insight_events (id, insight_id, at, status, reason) VALUES (?1, ?2, ?3, 'new', ?4)`)
        .bind(crypto.randomUUID(), prev.id, ts, notNowExpired ? "Back after four weeks" : "Evidence doubled since it was closed"));
    }
  }
  await batch(env, stmts);
  // Open moves this build didn't produce are no longer current (planned ones stay until you close them)
  await env.DB.prepare(`UPDATE insights SET last_seen_date = '2000-01-01' WHERE project=?1 AND status = 'new' AND key NOT IN (SELECT value FROM json_each(?2))`).bind(PROJECT.id, JSON.stringify(produced)).run();
  return { added: created, seen: produced.length, note: `${info.model}; ${created} new, ${reopened} reopened, ${merged} matched closed moves; ${info.themes} themes, ${info.questions} question clusters, ${info.demand} demand rows, ${info.myths} myths` };
}

// ---------------------------------------------------------------------------
// Status and briefs
// ---------------------------------------------------------------------------

/** Set a move's status from the dashboard. Dismissing takes a reason, which decides whether it can come back. */
export async function setStatus(env: Env, id: string, status: string, reason: string | null) {
  if (!(STATUSES as readonly string[]).includes(status)) throw new Error("bad status");
  const row = await env.DB.prepare(`SELECT evidence_ids_json FROM insights WHERE id=?1`).bind(id).first<any>();
  if (!row) throw new Error("not found");
  const n = JSON.parse(row.evidence_ids_json || "[]").length;
  const ts = nowIso();
  const why = status === "dismissed" ? (DISMISS_REASONS.includes(reason || "") ? reason : clean(reason, 200)) : null;
  await env.DB.batch([
    env.DB.prepare(`UPDATE insights SET status=?2, status_at=?3, evidence_at_status=?4, dismissed_reason=?5 WHERE id=?1`).bind(id, status, ts, n, why),
    env.DB.prepare(`INSERT INTO insight_events (id, insight_id, at, status, reason) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(crypto.randomUUID(), id, ts, status, why),
  ]);
}

/** A content brief for one move, drafted on request and kept. */
export async function draftBrief(env: Env, id: string) {
  const c = await env.DB.prepare(`SELECT * FROM insights WHERE id=?1`).bind(id).first<any>();
  if (!c) throw new Error("not found");
  const evidence: any[] = JSON.parse(c.evidence_json || "[]");
  const isStats = String(c.target_url || "").startsWith("/statistics/");
  if (!env.AI || env.MOCK === "1") {
    const brief = { title: c.headline, meta_title: null, meta_description: null, outline: ["What people are asking", "The short answer", "What it costs in the UK", "What to do next"],
      questions: [...new Set(evidence.map((e) => e.question).filter(Boolean))].slice(0, 6), consensus: evidence.find((e) => e.replies)?.replies || null, gaps: [], links: [], sources: isStats ? ["ONS", "PDSA PAW Report", "The Kennel Club"] : [] };
    await env.DB.prepare(`UPDATE insights SET brief_json=?2 WHERE id=?1`).bind(id, JSON.stringify(brief)).run();
    return brief;
  }
  const pages = (await sitePages(env)).filter((p) => p.kind === "advice" || p.kind === "statistics" || p.path === "/sell-my-puppies" || p.path === "/lucys-law" || (c.breed && p.breed === c.breed && p.kind !== "stud"));
  const replies = (await env.DB.prepare(`SELECT body, score FROM reddit_comments WHERE post_id IN (SELECT value FROM json_each(?1)) ORDER BY COALESCE(score,0) DESC LIMIT 25`).bind(c.evidence_ids_json).all<any>()).results || [];
  const prompt = `Write a content brief for ${PROJECT.site} (Companimal: UK puppy marketplace; buyers find puppies from verified breeders, rescues and rehomers; breeders list litters).
Move: ${c.headline}. Why: ${c.so_what}. Action: ${c.action}. Target page: ${c.target_url}${c.target_exists ? " (exists: write the section to add)" : " (new page)"}.
Real posts and questions:
${evidence.map((e) => `- [${e.where || e.ch}] ${e.title || ""}${e.question ? ` (${e.question})` : ""}`).join("\n")}
Most upvoted replies:
${replies.map((r: any) => `- [${r.score ?? 0}] ${String(r.body).slice(0, 240)}`).join("\n") || "(none)"}
Pages for internal links (path | title):
${pages.map((p) => `${p.path} | ${p.title || ""}`).join("\n")}

Return ONLY a JSON array with one object:
{"title": page H1 with the keyword before any colon, "meta_title": max 60 chars, "meta_description": max 155 chars,
 "outline": 5 to 8 H2s in the order a worried reader needs them, phrased as the questions people ask,
 "questions": the 5 to 8 exact questions the page must answer,
 "consensus": one sentence on what the replies agree on, or null,
 "gaps": 2 to 4 things the posts lacked that Companimal can add (UK law, real UK prices, Lucy's Law, what to ask a breeder, when to see a vet),
 "links": up to 4 {"path","anchor"} internal links where the anchor is natural wording inside a sentence of the article, never "click here", "see more" or "read our guide",
 "sources": ${isStats ? "3 to 6 reputable UK sources to cite (e.g. ONS, PDSA PAW Report, The Kennel Club, RSPCA, Dogs Trust, UK Pet Food)" : "[] (puppy advice articles carry no sources list)"}}
Companimal never phones or video-calls breeders; never write that it does. UK English, sentence case, never double hyphens.`;
  const [arr] = await runAi(env, prompt, 3000, 0, [AI_STRONG_MODEL, AI_MODEL], (a) => !!a[0]?.outline, 120000);
  const b = arr[0];
  const brief = {
    title: cleanIdea(b.title) || c.headline, meta_title: tidy(b.meta_title, 70), meta_description: tidy(b.meta_description, 170),
    outline: (b.outline || []).map((x: any) => tidy(x, 120)).filter(Boolean).slice(0, 8), questions: (b.questions || []).map((x: any) => tidy(x, 160)).filter(Boolean).slice(0, 8),
    consensus: tidy(b.consensus, 300), gaps: (b.gaps || []).map((x: any) => tidy(x, 200)).filter(Boolean).slice(0, 4),
    links: (b.links || []).filter((l: any) => l?.path && pages.some((p) => p.path === l.path)).map((l: any) => ({ path: l.path, anchor: tidy(l.anchor, 80) })).slice(0, 4),
    sources: isStats ? (b.sources || []).map((x: any) => tidy(x, 120)).filter(Boolean).slice(0, 6) : [],
  };
  await env.DB.prepare(`UPDATE insights SET brief_json=?2 WHERE id=?1`).bind(id, JSON.stringify(brief)).run();
  return brief;
}
