// AI reading of Reddit threads: what each one is really about, and the week's conversation themes.
import { PROJECT, TOPICS, REDDIT_INSIGHTS_PER_RUN, REDDIT_COMMENTS_TOP, REDDIT_COMMENTS_MIN, INTENTS, URGENCY, UK_REGIONS } from "../config/taxonomy";
import { breedSlugOf, breedInText, breedName } from "./site";
import { Env, nowIso, today, daysAgo, clean, inWaves } from "./lib";
import { runAi, regionOf, heuristic, cleanIdea, sentenceCase, AI_STRONG_MODEL, AI_MODEL, AI_FALLBACK_MODEL } from "./enrich";
import { threadScore } from "./collectors/reddit";

const KINDS = ["question", "advice_request", "vent", "story", "celebration", "debate", "recommendation_request", "myth", "news", "other", "irrelevant"];
const EMOTIONS = ["worried", "frustrated", "sad", "happy", "proud", "curious", "angry", "guilty", "overwhelmed", "neutral"];
const LENSES = ["buyer", "breeder", "rescue", "owner"];
const REGIONS = ["uk", "non_uk", "unknown"];

// UK places people mention, mapped to a region (for the UK region field when the AI can't say)
const PLACES: [RegExp, string][] = [
  [/\b(london|croydon|hackney|islington|camden|brixton|wimbledon)\b/i, "London"],
  [/\b(scotland|scottish|glasgow|edinburgh|aberdeen|dundee|inverness|highlands)\b/i, "Scotland"],
  [/\b(wales|welsh|cardiff|swansea|newport|snowdonia)\b/i, "Wales"],
  [/\b(northern ireland|belfast|derry|antrim)\b/i, "Northern Ireland"],
  [/\b(newcastle|durham|sunderland|teesside|middlesbrough|northumberland|gateshead|hartlepool|darlington)\b/i, "North East"],
  [/\b(manchester|liverpool|lancashire|cheshire|cumbria|preston|blackpool|bolton|wigan|stockport)\b/i, "North West"],
  [/\b(yorkshire|leeds|sheffield|bradford|hull|york|wakefield|huddersfield|doncaster)\b/i, "Yorkshire"],
  [/\b(birmingham|coventry|wolverhampton|west midlands|staffordshire|shropshire|worcestershire|warwickshire)\b/i, "West Midlands"],
  [/\b(nottingham|leicester|derby|lincoln|east midlands|northampton)\b/i, "East Midlands"],
  [/\b(norfolk|suffolk|essex|cambridge|norwich|ipswich|hertfordshire|bedford)\b/i, "East of England"],
  [/\b(bristol|devon|cornwall|somerset|dorset|gloucestershire|wiltshire|plymouth|exeter|bath)\b/i, "South West"],
  [/\b(kent|surrey|sussex|brighton|oxford|reading|hampshire|southampton|portsmouth|berkshire|buckinghamshire|milton keynes)\b/i, "South East"],
];
export const ukRegionOf = (text: string): string | null => PLACES.find(([re]) => re.test(text))?.[1] || null;

/** Commercial intent by wording, for the rules-based reading and channels without an AI intent. */
export function intentOf(text: string): string {
  if (/\bstud\b/i.test(text)) return "stud";
  if (/\b(sell(ing)? (my|our|the) (puppies|pups|litter)|selling puppies|advertis(e|ing) (my|our|a) (litter|puppies)|time ?wasters|how (do|should) i (sell|price) (my|our|the) (puppies|litter))\b/i.test(text)) return "sell";
  if (/\b(rehom(e|ing) (my|our|him|her|the dog)|have to (give up|rehome)|can'?t keep (him|her|my dog))\b/i.test(text)) return "rehome";
  if (/\b(adopt(ing|ion)?|from a rescue|rescue (centre|center)|shelter)\b/i.test(text)) return "adopt";
  if (/\b(looking (for|to buy|to get) (a|an) [\w ]{0,20}(puppy|pup|dog)|want(ing)? to (buy|get) (a|an) [\w ]{0,20}(puppy|pup)|where (to|can i|should i|do i) (buy|get|find) (a|an)? ?[\w ]{0,20}(puppy|pup|breeder)|reputable [\w ]{0,20}breeder|recommend (a )?breeder|(buying|bought) (a|our|my) (first )?puppy)\b/i.test(text)) return "buy";
  return "own";
}

// A genuine question whose post asks for a guide, or whose replies point to one: the strongest content signal
const ASKS_GUIDE = /\b(any (good )?(guides?|resources?|articles?|books?|websites?)|is there a (good )?(guide|step[- ]by[- ]step|checklist|resource)|step[- ]by[- ]step (guide|instructions)|where (can|do) i (learn|read|find out)|beginner'?s guide|can'?t find (a|any) (good )?(guide|info|information|explanation))\b/i;
const REPLY_RESOURCE = /\b(there'?s a (good|great|decent) (guide|article|video|book|page)|(check|have a look at|look at|read) (the )?(this|that|kennel club|pdsa|rspca|dogs trust|battersea) (guide|page|website|article)|recommend (the |this )?book|google (it|for)|loads of (guides|videos) online)\b/i;
const GENUINE = ["question", "advice_request", "recommendation_request"];
export function asksForGuide(kind: string, text: string, replies: any[]): number {
  if (!GENUINE.includes(kind)) return 0;
  return ASKS_GUIDE.test(text) || replies.some((r: any) => REPLY_RESOURCE.test(String(r.body || ""))) ? 1 : 0;
}

function insightPrompt(batch: any[]) {
  const topics = TOPICS.map((t) => t.id).join(", ");
  return `You read Reddit threads about dogs to inform content strategy for Companimal, a UK puppy marketplace for buyers, breeders, rescues and rehomers.
For each thread you get the title, the post (the full body, or Google's snippet when that's all we have), upvotes, comment count and, when available, the most upvoted replies. Judge what the conversation is about.
Write in UK English (behaviour, socialisation, colour) even when the poster uses US spelling.
For each thread return an object:
- id: the given id
- kind: one of ${KINDS.join(", ")}. "irrelevant" for anything not genuinely about dogs or dog ownership (memes, megathread boilerplate, off-topic).
- theme: a short, specific conversation theme in 2 to 5 words, reusable across threads (e.g. "Crate training night crying", "Fear after a bite", "Breeder deposit worries"), UK English
- pain_point: the underlying problem or worry in one short sentence, or null
- need: what the poster wants (reassurance, step-by-step help, a recommendation, validation, to share joy...), a few words
- emotion: one of ${EMOTIONS.join(", ")}
- content_angle: one article title Companimal could publish that answers THIS poster's exact situation, specific not generic (bad: "Pet insurance: what to expect"; good: "Pet insurance claim rejected: how to appeal and what insurers check"). Sentence case, UK English, keyword phrase first. Never "tips and tricks" or "what you need to know". null if nothing genuinely fits
- lens: buyer, breeder, rescue or owner
- topic: one of [${topics}]
- region: "uk" only with clear UK signals (£, UK places, UK spelling and terms), "non_uk" with clear non-UK signals ($, US states, "shots"), else "unknown"
- replies: when top replies are given, one sentence on what the replies actually say: the advice people agree on, the split if they disagree, or the reassurance given (e.g. "Most say it's normal for the first two weeks and to move the crate beside the bed; a few warn against leaving the pup to cry it out"). UK English. null when no replies are given
- breed: the dog breed the thread is about, as people name it (e.g. "Cockapoo", "Cocker Spaniel", "French Bulldog"), or null if no single breed
- intent: what the poster wants to do: "buy" (find or buy a puppy, choose a breeder), "sell" (sell or advertise a litter), "stud" (find or offer a stud dog), "rehome" (give up their own dog), "adopt" (adopt from a rescue), "own" (already has the dog and wants help), "learn" (researching, no dog yet), "share" (showing or telling)
- urgency: "now" (stuck today: dog ill, deposit at risk, scam in progress, must rehome this week), "soon" (this month), "planning" (thinking ahead), "none"
- uk_region: when the thread is clearly in the UK and names a place, one of ${UK_REGIONS.join(", ")}; else null
- question: the poster's core question as a short search query a UK person would type (e.g. "how much is a cockapoo puppy uk", "puppy crying in crate at night"), lower case, or null if there is no question
- disagreement: true when the replies disagree with each other or with the poster, or repeat advice that is wrong or risky (e.g. "let him cry it out", "rescue backs are scams", "no need to see the mum"); else false
Return ONLY a JSON array.

Threads:
${batch.map((t) => JSON.stringify({
  id: t.post_id, subreddit: `r/${t.subreddit}`, flair: t.flair || undefined, upvotes: t.score ?? undefined, comments: t.posts_count,
  title: (t.title || "").slice(0, 200), post: (t.body || t.snippet || "").slice(0, 700),
  top_replies: t.replies?.length ? t.replies.map((r: any) => `[${r.score ?? 0}] ${String(r.body).slice(0, 220)}`) : undefined,
})).join("\n")}`;
}

/** Analyse threads that have no insight yet. Runs every 10 minutes; cheap when there's nothing new. */
export async function analyseRedditThreads(env: Env, limit = REDDIT_INSIGHTS_PER_RUN, deadline = Date.now() + 4 * 60000) {
  const rows = (await env.DB.prepare(`SELECT post_id, subreddit, url, title, snippet, body, flair, score, posts_count, COALESCE(insight_attempts,0) AS attempts FROM reddit_threads WHERE project=?1 AND insight_done=0
      AND NOT (source='api' AND comments_fetched_at IS NULL AND (posts_count IS NULL OR posts_count >= ?3) AND first_seen > ?4)
    ORDER BY COALESCE(posts_count,0) + COALESCE(score,0) DESC, last_seen DESC LIMIT ?2`).bind(PROJECT.id, limit, REDDIT_COMMENTS_MIN, new Date(Date.now() - 6 * 3600000).toISOString()).all<any>()).results || [];
  // (threads waiting for their replies are read once those arrive, or after 6 hours without them)
  if (!rows.length) return { added: 0, seen: 0, note: "nothing new" };
  // The most upvoted replies per thread (top-level and replies alike)
  const replies = new Map<string, any[]>();
  for (let i = 0; i < rows.length; i += 90) {
    const ids = JSON.stringify(rows.slice(i, i + 90).map((r: any) => r.post_id));
    const cs = (await env.DB.prepare(`SELECT post_id, body, score FROM (
        SELECT post_id, body, score, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY COALESCE(score,0) DESC) AS rn
        FROM reddit_comments WHERE post_id IN (SELECT value FROM json_each(?1)) AND length(body) >= 15)
      WHERE rn <= ?2`).bind(ids, REDDIT_COMMENTS_TOP).all<any>()).results || [];
    for (const c of cs) replies.set(c.post_id, [...(replies.get(c.post_id) || []), c]);
  }
  for (const r of rows) r.replies = replies.get(r.post_id) || [];
  const out = new Map<string, any>();
  let model = "heuristic";
  const aiOn = !!env.AI && env.MOCK !== "1";
  let answered = 0;
  if (aiOn) {
    const batches: any[][] = [];
    // Smaller batches when replies are included, to stay well inside the model's context
    for (let i = 0; i < rows.length; i += 8) batches.push(rows.slice(i, i + 8));
    await inWaves(batches, 4, deadline, async (batch) => {
      try {
        const [arr, used] = await runAi(env, insightPrompt(batch), 4000);
        answered++;
        for (const r of arr) if (r?.id && KINDS.includes(r.kind)) out.set(String(r.id), r);
        model = used;
      } catch (e) { console.error("reddit insight batch failed", String((e as any)?.message || e)); }
    });
  }
  // Nothing answered at all (AI outage or daily limit): leave every thread for the next run rather than
  // counting a failed attempt against it, so an outage never turns into rules-only readings
  if (aiOn && !answered) return { added: 0, seen: rows.length, note: "ai=0 outage; nothing changed, retrying next run" };
  const validTopics = new Set(TOPICS.map((t) => t.id));
  const stmts: D1PreparedStatement[] = [];
  let ai = 0;
  for (const t of rows) {
    const r = out.get(t.post_id);
    const ukSub = /^(askuk|casualuk|unitedkingdom|uk)$/i.test(t.subreddit || "");
    const ruleRegion = ukSub ? "uk" : regionOf(`${t.title} ${t.body || t.snippet || ""}`, t.url, `r/${t.subreddit}`, null);
    if (!r && env.AI && env.MOCK !== "1" && t.attempts < 2) {
      // AI skipped or failed on this one: try again next run (rules-based reading after 3 tries)
      stmts.push(env.DB.prepare(`UPDATE reddit_threads SET insight_attempts=COALESCE(insight_attempts,0)+1 WHERE post_id=?1`).bind(t.post_id));
      continue;
    }
    const text = `${t.title || ""} ${t.body || t.snippet || ""}`;
    const h = heuristic(t.title || "", t.body || t.snippet || "");
    const slugAi = r ? breedSlugOf(r.breed) : null;
    const slugText = breedInText(text);
    const breedSlug = slugAi || slugText;
    const ins = r ? {
      kind: r.kind, theme: sentenceCase(clean(r.theme, 60)), pain_point: clean(r.pain_point, 240), need: clean(r.need, 80),
      emotion: EMOTIONS.includes(r.emotion) ? r.emotion : "neutral", content_angle: cleanIdea(clean(r.content_angle, 160)),
      lens: LENSES.includes(r.lens) ? r.lens : h.lens, topic: validTopics.has(r.topic) ? r.topic : h.topic,
      region: ruleRegion !== "unknown" ? ruleRegion : REGIONS.includes(r.region) ? r.region : "unknown", model,
      replies: t.replies.length ? clean(r.replies, 400) : null,
      breed: clean(r.breed, 60) || (breedSlug ? breedName(breedSlug) : null), breed_slug: breedSlug,
      intent: (INTENTS as readonly string[]).includes(r.intent) ? r.intent : intentOf(text), urgency: (URGENCY as readonly string[]).includes(r.urgency) ? r.urgency : "none",
      uk_region: UK_REGIONS.includes(r.uk_region) ? r.uk_region : ukRegionOf(text), question: clean(r.question, 120)?.toLowerCase() || null,
      disagreement: r.disagreement === true ? 1 : 0, asks_for_guide: asksForGuide(r.kind, text, t.replies),
    } : {
      kind: h.kind === "irrelevant" ? "irrelevant" : h.question ? "question" : "other", theme: TOPICS.find((x) => x.id === h.topic)?.label || null,
      pain_point: null, need: null, emotion: "neutral", content_angle: null, lens: h.lens, topic: h.topic, region: ruleRegion, model: "heuristic", replies: null,
      breed: breedSlug ? breedName(breedSlug) : null, breed_slug: breedSlug, intent: intentOf(text), urgency: "none", uk_region: ukRegionOf(text),
      question: h.question ? clean(h.question, 120)?.toLowerCase() || null : null,
      disagreement: t.replies.filter((c: any) => /\b(never|don'?t|myth|not true|wrong|actually|disagree|nonsense)\b/i.test(String(c.body))).length >= 2 ? 1 : 0, asks_for_guide: asksForGuide(h.question ? "question" : "other", text, t.replies),
    };
    if (r) ai++;
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO reddit_insights (post_id, kind, theme, pain_point, need, emotion, content_angle, lens, topic, region, model, created_at, replies,
        breed, breed_slug, intent, urgency, uk_region, question, disagreement, asks_for_guide) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)`)
      .bind(t.post_id, ins.kind, ins.theme, ins.pain_point, ins.need, ins.emotion, ins.content_angle, ins.lens, ins.topic, ins.region, ins.model, nowIso(), ins.replies,
        ins.breed, ins.breed_slug, ins.intent, ins.urgency, ins.uk_region, ins.question, ins.disagreement, ins.asks_for_guide));
    stmts.push(env.DB.prepare(`UPDATE reddit_threads SET insight_done=1, insight_with_comments=?2 WHERE post_id=?1`).bind(t.post_id, t.replies.length ? 1 : 0));
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return { added: rows.length, seen: rows.length, note: `ai=${ai}` };
}

/** Group the last 14 days of threads into conversation themes. Daily snapshot, kept for trend history. */
export async function buildRedditThemes(env: Env) {
  const rows = (await env.DB.prepare(`
    SELECT t.post_id, t.subreddit, t.title, t.posts_count, t.posts_count_prev, t.score, t.score_prev, t.seen_count, t.best_rank, t.created_at, t.first_seen,
           i.theme, i.pain_point, i.kind, i.emotion, i.replies
    FROM reddit_threads t JOIN reddit_insights i ON i.post_id=t.post_id
    WHERE t.project=?1 AND t.last_seen >= ?2 AND i.kind NOT IN ('irrelevant') AND COALESCE(i.region,'unknown') <> 'non_uk'
      AND (t.created_at >= ?3 OR (t.created_at IS NULL AND COALESCE(t.via,'') <> 'search'))`).bind(PROJECT.id, daysAgo(14), daysAgo(30)).all<any>()).results || [];
  if (rows.length < 5) return { added: 0, seen: rows.length, note: "not enough threads yet" };
  // s = "doing well" score for ranking; score stays Reddit's upvotes (the AI is shown real upvotes)
  const ranked = rows.map((r: any) => ({ ...r, s: threadScore(r) })).sort((a: any, b: any) => b.s - a.s).slice(0, 180);
  let themes: any[] = [];
  let model = "rules";
  if (env.AI && env.MOCK !== "1") {
    const prompt = `You are a content strategist for Companimal, a UK puppy marketplace for buyers, breeders, rescues and rehomers.
Below are the last two weeks of Reddit dog threads (title, upvotes, comment count, an AI reading of each thread's specific theme and pain point, and what the replies say where known).

Group them into 8 to 14 SPECIFIC conversation themes. Rules:
- A theme is a specific situation or problem people keep raising, NOT a category. Good: "Fear of their own dog after a bite", "Leash pulling in adolescent dogs", "Vet bills people on low incomes can't afford", "Puppy blues and regret in week one", "Spotting a breeder deposit scam". Bad: "Dog training", "Puppy care", "Dog health", "Rescue and rehoming", "Dog ownership".
- Build themes from the per-thread theme and pain point labels; merge near-duplicates into one theme. Every theme needs at least 2 threads.
- summary: 1 to 2 sentences on what people are actually saying, with concrete specifics from the threads (ages, breeds, situations, numbers), including what the replies advise or argue about where known.
- why: one sentence on why it matters for Companimal's audience (buyers, breeders, rescues, new owners).
- ideas: 2 article titles that answer the exact pain point, specific not generic. Never use "tips and tricks", "what you need to know" or "everything you need to know". Keyword phrase first, then a colon if needed.
- UK English spelling (behaviour, socialisation, colour, programme) and sentence case for theme labels and titles.
- sentiment: "positive", "mixed" or "negative".
- thread_ids: the ids of every thread in the theme.
Order themes by total comments and upvotes, then thread count. Return ONLY a JSON array of {"theme","summary","why","ideas","sentiment","thread_ids"}.

id | subreddit | upvotes | comments | thread theme | pain point | title | replies say
${ranked.map((r: any) => `${r.post_id} | r/${r.subreddit} | ${r.score ?? "?"} | ${r.posts_count ?? "?"} | ${r.theme || ""} | ${(r.pain_point || "").slice(0, 90)} | ${(r.title || "").slice(0, 100)} | ${(r.replies || "").slice(0, 120)}`).join("\n")}`;
    try {
      const usable = (a: any[]) => a.filter((t) => t && typeof t.theme === "string" && Array.isArray(t.thread_ids) && t.thread_ids.length >= 2).length >= 4;
      const [arr, used] = await runAi(env, prompt, 6000, 0.1, [AI_STRONG_MODEL, AI_MODEL], usable, 150000);
      themes = arr.filter((t) => t && typeof t.theme === "string" && Array.isArray(t.thread_ids) && t.thread_ids.length >= 2);
      if (themes.length) model = used;
    } catch (e) { console.error("reddit themes failed", String((e as any)?.message || e)); }
  }
  if (!themes.length) {
    // Rules fallback: group by the per-thread theme label
    const by = new Map<string, any[]>();
    for (const r of ranked) { const k = r.theme || "Other"; by.set(k, [...(by.get(k) || []), r]); }
    themes = [...by.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10).map(([theme, list]) => ({
      theme, summary: `${list.length} threads in the last two weeks.`, why: "", ideas: [], sentiment: "mixed", thread_ids: list.map((x: any) => x.post_id),
    }));
  }
  const valid = new Set(ranked.map((r: any) => r.post_id));
  const date = today();
  const stmts = [env.DB.prepare(`DELETE FROM reddit_themes WHERE project=?1 AND date=?2`).bind(PROJECT.id, date)];
  for (const t of themes) {
    const ids = (t.thread_ids || []).map(String).filter((id: string) => valid.has(id));
    if (!ids.length) continue;
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO reddit_themes (project, date, theme, summary, why, ideas_json, thread_ids_json, thread_count, sentiment, model, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
      .bind(PROJECT.id, date, sentenceCase(clean(t.theme, 80)), clean(t.summary, 400), clean(t.why, 300), JSON.stringify((t.ideas || []).map(cleanIdea).filter(Boolean).slice(0, 3)), JSON.stringify(ids), ids.length, ["positive", "mixed", "negative"].includes(t.sentiment) ? t.sentiment : "mixed", model, nowIso()));
  }
  await env.DB.batch(stmts);
  return { added: stmts.length - 1, seen: ranked.length, note: model };
}
