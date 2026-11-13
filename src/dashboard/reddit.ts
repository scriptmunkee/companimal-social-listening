import { PROJECT, TOPICS } from "../../config/taxonomy";
import { Env, daysAgo } from "../lib";
import { RegionFilter } from "../analysis";
import { threadScore } from "../collectors/reddit";
import { esc, fmt, pct, href, keepFilters, topicTag, dateShort, meter, empty, notice, eyebrow, section, sendButton, segmented, pager, Ctx } from "./ui";
import { queuedSet, queueKey } from "./data";

const KIND_LABELS: Record<string, string> = {
  question: "Question", advice_request: "Asking for advice", vent: "Venting", story: "Story", celebration: "Celebrating",
  debate: "Debate", recommendation_request: "Wants recommendations", myth: "Myth or claim", news: "News", other: "Other",
};

export interface ThreadRow {
  post_id: string; subreddit: string; url: string; title: string; snippet: string; created_at: string | null; first_seen: string;
  last_seen: string; seen_count: number; best_rank: number | null; posts_count: number | null; posts_count_prev: number | null;
  kind: string | null; theme: string | null; pain_point: string | null; need: string | null; emotion: string | null;
  content_angle: string | null; lens: string | null; topic: string | null; region: string | null; score: number; growth: number;
}

export async function loadThreads(env: Env, opts: { days: number; lens?: string; region: RegionFilter; sub?: string; kind?: string; topic?: string }): Promise<ThreadRow[]> {
  const where = [`t.project=?1`, `t.last_seen >= ?2`, `COALESCE(i.kind,'') <> 'irrelevant'`];
  const binds: unknown[] = [PROJECT.id, daysAgo(opts.days)];
  const add = (sql: string, v: unknown) => { binds.push(v); where.push(sql.replace("?", `?${binds.length}`)); };
  if (opts.region !== "all") where.push(`COALESCE(i.region,'unknown') <> 'non_uk'`);
  if (opts.lens) add(`i.lens = ?`, opts.lens);
  if (opts.sub) add(`lower(t.subreddit) = lower(?)`, opts.sub);
  if (opts.kind) add(`i.kind = ?`, opts.kind);
  if (opts.topic) add(`i.topic = ?`, opts.topic);
  const rows = (await env.DB.prepare(`SELECT t.*, i.kind, i.theme, i.pain_point, i.need, i.emotion, i.content_angle, i.lens, i.topic, i.region
    FROM reddit_threads t LEFT JOIN reddit_insights i ON i.post_id = t.post_id WHERE ${where.join(" AND ")} LIMIT 3000`).bind(...binds).all<any>()).results || [];
  return rows.map((r: any) => ({ ...r, score: threadScore(r), growth: Math.max(0, (r.posts_count || 0) - (r.posts_count_prev ?? r.posts_count ?? 0)) }));
}

function age(iso: string | null) {
  if (!iso) return "";
  const d = (Date.now() - Date.parse(iso)) / 86400000;
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h`;
  if (d < 60) return `${Math.round(d)}d`;
  if (d < 730) return `${Math.round(d / 30)}mo`;
  return `${Math.round(d / 365)}y`;
}

export const KINDS = KIND_LABELS;

const SENTIMENT: Record<string, string> = { negative: "Mostly negative", positive: "Mostly positive", mixed: "Mixed feelings", neutral: "Neutral" };

/** Reddit view: themes, ranked threads, pain points, angles, feelings, subreddits. */
export async function viewReddit(env: Env, url: URL, ctx: Ctx): Promise<{ title: string; body: string }> {
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 7;
  const sub = url.searchParams.get("sub") || undefined;
  const kind = url.searchParams.get("kind") || undefined;
  const topic = url.searchParams.get("topic") || undefined;
  const sort = ["discussed", "new"].includes(url.searchParams.get("sort") || "") ? url.searchParams.get("sort")! : "hot";
  const params = { days: days === 7 ? undefined : days, sub, kind, topic, sort: sort === "hot" ? undefined : sort };
  const link = (over: Record<string, string | number | undefined>) => href(ctx, "/reddit", { ...params, ...over });

  const [all, queued] = await Promise.all([loadThreads(env, { days, lens: ctx.lens, region: ctx.region, sub, kind, topic }), queuedSet(env)]);
  const threads = [...all].sort((a, b) =>
    sort === "discussed" ? (b.posts_count || 0) - (a.posts_count || 0)
    : sort === "new" ? Date.parse(b.created_at || b.first_seen) - Date.parse(a.created_at || a.first_seen)
    : b.score - a.score);

  const themeDate = await env.DB.prepare(`SELECT MAX(date) AS d FROM reddit_themes WHERE project=?1`).bind(PROJECT.id).first<any>();
  const themes = themeDate?.d ? ((await env.DB.prepare(`SELECT * FROM reddit_themes WHERE project=?1 AND date=?2 ORDER BY thread_count DESC`).bind(PROJECT.id, themeDate.d).all<any>()).results || []) : [];
  const byId = new Map(all.map((t) => [t.post_id, t]));
  const totals = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN posts_count IS NOT NULL THEN 1 ELSE 0 END) AS withc, COUNT(DISTINCT subreddit) AS subs, SUM(CASE WHEN first_seen >= ?2 THEN 1 ELSE 0 END) AS new24 FROM reddit_threads WHERE project=?1`).bind(PROJECT.id, new Date(Date.now() - 86400000).toISOString()).first<any>();
  const pending = await env.DB.prepare(`SELECT COUNT(*) AS n FROM reddit_threads WHERE insight_done=0`).first<any>();

  // Subreddit leaderboard and mixes (from the threads in view)
  const subs = new Map<string, { n: number; comments: number; withc: number; questions: number; emotional: number; themes: Map<string, number> }>();
  const emotions = new Map<string, number>();
  for (const t of all) {
    const s = subs.get(t.subreddit) || { n: 0, comments: 0, withc: 0, questions: 0, emotional: 0, themes: new Map() };
    s.n++; if (t.posts_count !== null && t.posts_count !== undefined) { s.comments += t.posts_count; s.withc++; }
    if (["question", "advice_request", "recommendation_request"].includes(t.kind || "")) s.questions++;
    if (["vent", "story", "celebration"].includes(t.kind || "")) s.emotional++;
    if (t.theme) s.themes.set(t.theme, (s.themes.get(t.theme) || 0) + 1);
    subs.set(t.subreddit, s);
    if (t.emotion) emotions.set(t.emotion, (emotions.get(t.emotion) || 0) + 1);
  }
  const subRows = [...subs.entries()].sort((a, b) => b[1].n - a[1].n);
  const subOptions = [...new Set([...subRows.map(([s]) => s), ...(sub ? [sub] : [])])];
  const emoRows = [...emotions.entries()].filter(([e]) => e !== "neutral").sort((a, b) => b[1] - a[1]);
  const emoTotal = emoRows.reduce((a, [, n]) => a + n, 0);
  const pains = threads.filter((t) => t.pain_point).slice(0, 10);
  const angles = [...new Map(threads.filter((t) => t.content_angle).map((t) => [t.content_angle!.toLowerCase(), t])).values()].slice(0, 10);

  // Themes: one lead, the rest as a ranked list
  const themeCard = (t: any, lead: boolean, rank = 1) => {
    const ids: string[] = JSON.parse(t.thread_ids_json || "[]");
    const ex = ids.map((id) => byId.get(id)).filter(Boolean).slice(0, lead ? 3 : 2) as ThreadRow[];
    const ideas: string[] = JSON.parse(t.ideas_json || "[]");
    const tTopic = ex.find((e) => e.topic)?.topic || "other";
    const meta = `<div class="qmeta" style="margin:0"><span class="tag">${fmt(t.thread_count)} threads</span><span>${esc(SENTIMENT[t.sentiment] || t.sentiment || "")}</span></div>`;
    if (!lead) return `<li><span class="n">${String(rank).padStart(2, "0")}</span><div><span class="t">${esc(t.theme)}</span>${t.summary && !/^\d+ threads/.test(t.summary) ? `<p>${esc(t.summary)}</p>` : ""}<div style="margin-top:6px">${meta}</div></div></li>`;
    return `<article class="panel hero c-7"><div>${eyebrow("Biggest conversation this week")}${meta}</div><h2>${esc(t.theme)}</h2><p class="why">${esc(t.summary || "")}</p>
${t.why ? `<div><p class="eyebrow">Why it matters</p><p style="margin:0;color:var(--ink-2)">${esc(t.why)}</p></div>` : ""}
${ideas.length ? `<div><p class="eyebrow">Article ideas</p><ol class="h2list">${ideas.slice(0, 4).map((i, n) => `<li><span>${String(n + 1).padStart(2, "0")}</span><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><span style="font:inherit;color:inherit">${esc(i)}</span>${sendButton(tTopic, i, queued.has(queueKey(tTopic, i)), true)}</div></li>`).join("")}</ol></div>` : ""}
${ex.length ? `<div><p class="eyebrow">Threads behind it</p><ul class="quotes">${ex.map((e) => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc((e.title || "Untitled thread").slice(0, 110))}</a><span>r/${esc(e.subreddit)}${e.posts_count ? ` · ${fmt(e.posts_count)} comments` : ""}</span></li>`).join("")}</ul></div>` : ""}</article>`;
  };
  const restThemes = themes.slice(1, 6);
  const themesHtml = themes.length ? `<div class="bento">${themeCard(themes[0], true)}<section class="panel queue c-5">${eyebrow("Also being talked about")}${restThemes.length ? `<ol>${restThemes.map((t: any, i: number) => themeCard(t, false, i + 2)).join("")}</ol>` : `<p class="muted" style="margin:12px 0 0">One theme so far.</p>`}</section></div>`
    : empty("Themes are on their way", "They're written once the first batch of threads has been analysed.");

  // Threads toolbar and table
  const opt = (v: string, label: string, cur: string | undefined) => `<option value="${esc(v)}"${v === (cur || "") ? " selected" : ""}>${esc(label)}</option>`;
  const toolbar = `<div class="toolbar">${segmented("Sort", [{ href: link({ sort: undefined }), label: "Hot right now", on: sort === "hot" }, { href: link({ sort: "discussed" }), label: "Most discussed", on: sort === "discussed" }, { href: link({ sort: "new" }), label: "Newest", on: sort === "new" }])}
${segmented("Period", [7, 30, 90].map((d) => ({ href: link({ days: d === 7 ? undefined : d }), label: `${d} days`, on: days === d })))}
<form method="get" action="/reddit" data-auto style="display:flex;gap:10px;flex-wrap:wrap">${keepFilters(ctx)}${days !== 7 ? `<input type="hidden" name="days" value="${days}">` : ""}${sort !== "hot" ? `<input type="hidden" name="sort" value="${esc(sort)}">` : ""}${topic ? `<input type="hidden" name="topic" value="${esc(topic)}">` : ""}
<label class="field"><span class="sr">Subreddit</span><select name="sub">${opt("", "All subreddits", sub)}${subOptions.map((s) => opt(s, `r/${s}`, sub)).join("")}</select></label>
<label class="field"><span class="sr">Kind of post</span><select name="kind">${opt("", "All kinds of post", kind)}${Object.entries(KIND_LABELS).map(([k, l]) => opt(k, l, kind)).join("")}</select></label>
<noscript><button class="btn-line">Apply</button></noscript></form></div>`;
  const per = 50, pages = Math.max(1, Math.ceil(threads.length / per));
  const page = Math.min(Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1)), pages);
  const slice = threads.slice((page - 1) * per, page * per);
  const maxScore = Math.max(1, ...threads.map((t) => t.score));
  const rows = slice.map((t, i) => `<tr data-row tabindex="0">
<td class="rank">${String((page - 1) * per + i + 1).padStart(2, "0")}</td>
<td class="qcell"><a class="qlink" data-ext href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title || "Untitled thread")}</a>${t.snippet ? `<p class="snip">${esc(t.snippet.slice(0, 180))}${t.snippet.length > 180 ? "…" : ""}</p>` : ""}<div class="qmeta"><a class="tag" href="${link({ sub: t.subreddit, page: undefined })}">r/${esc(t.subreddit)}</a><span>${age(t.created_at || t.first_seen)} old</span><span>Seen ${fmt(t.seen_count)} ${t.seen_count === 1 ? "time" : "times"}</span><span class="m-only">${t.posts_count !== null && t.posts_count !== undefined ? `${fmt(t.posts_count)} comments${t.growth ? `, +${fmt(t.growth)}` : ""} · ` : ""}score ${t.score.toFixed(1)}</span></div></td>
<td class="num d-only">${t.posts_count !== null && t.posts_count !== undefined ? fmt(t.posts_count) : `<span class="muted">n/a</span>`}${t.growth ? `<div class="up" style="font-size:12.5px">+${fmt(t.growth)}</div>` : ""}</td>
<td class="about">${t.kind ? `<span class="tag">${esc(KIND_LABELS[t.kind] || t.kind)}</span>` : ""}${t.theme ? `<div class="theme">${esc(t.theme)}</div>` : `<div class="muted">Being analysed</div>`}${t.pain_point ? `<div class="muted small">${esc(t.pain_point)}</div>` : ""}${t.emotion && t.emotion !== "neutral" ? `<div class="muted small">Feeling ${esc(t.emotion)}${t.need ? `; wants ${esc(t.need)}` : ""}</div>` : ""}</td>
<td class="angle">${t.content_angle ? `<div><b class="m-only" style="font-weight:600">Angle: </b>${esc(t.content_angle)}</div>` : ""}</td>
<td class="num score d-only">${t.score.toFixed(1)}${meter(t.score / maxScore)}</td>
<td class="act">${t.content_angle ? sendButton(t.topic || "other", t.content_angle, queued.has(queueKey(t.topic || "other", t.content_angle)), true) : ""}</td></tr>`).join("");
  const table = slice.length ? `<div class="tbl-wrap"><table class="q reddit"><thead><tr><th class="rank"><span class="sr">Rank</span></th><th>Thread</th><th class="num d-only">Comments</th><th>What it's about</th><th>Content angle</th><th class="num d-only">Score</th><th><span class="sr">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>${pager(ctx, "/reddit", params, page, threads.length, per)}`
    : empty(sub || kind || topic ? "No threads for these filters" : "No threads yet", sub || kind || topic ? `Try a longer period or <a href="${href(ctx, "/reddit")}">clear the filters</a>.` : "Searches are queued; results arrive within the hour.");

  const lower = `<div class="bento" style="margin-top:8px">
<section class="c-4">${section("Pain points")}${pains.length ? `<ul class="list">${pains.map((t) => `<li class="post"><p>${esc(t.pain_point)}</p><div class="post-h"><a href="${esc(t.url)}" target="_blank" rel="noopener">r/${esc(t.subreddit)} ↗</a>${t.topic ? topicTag(ctx, t.topic) : ""}</div></li>`).join("")}</ul>` : `<p class="muted">These appear once threads are analysed.</p>`}</section>
<section class="c-5">${section("Content angles")}${angles.length ? `<ul class="list">${angles.map((t) => `<li class="post"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><p style="color:var(--ink)">${esc(t.content_angle)}</p>${sendButton(t.topic || "other", t.content_angle!, queued.has(queueKey(t.topic || "other", t.content_angle!)), true)}</div><div class="post-h"><span>From r/${esc(t.subreddit)}${t.posts_count ? `, ${fmt(t.posts_count)} comments` : ""}</span></div></li>`).join("")}</ul>` : `<p class="muted">These appear once threads are analysed.</p>`}</section>
<section class="c-3">${section("How people feel")}${emoRows.length ? `<ul class="list">${emoRows.slice(0, 8).map(([e, n]) => `<li><div class="post-h" style="justify-content:space-between"><b>${esc(e[0].toUpperCase() + e.slice(1))}</b><span>${fmt(n)} · ${pct(n, emoTotal)}%</span></div>${meter(n / Math.max(1, emoRows[0][1]))}</li>`).join("")}</ul>` : `<p class="muted">This appears once threads are analysed.</p>`}</section></div>`;

  const subsTable = subRows.length ? `<div class="tbl-wrap scroll"><table><thead><tr><th>Subreddit</th><th class="num">Threads</th><th class="num">Avg comments</th><th>Asking for help</th><th class="num">Stories and venting</th><th class="d-only">Top theme</th></tr></thead><tbody>${subRows.map(([s, v]) => {
    const top = [...v.themes.entries()].sort((a, b) => b[1] - a[1])[0];
    return `<tr><td class="name"><a class="qlink" href="${link({ sub: s, page: undefined })}">r/${esc(s)}</a></td><td class="num">${fmt(v.n)}</td><td class="num">${v.withc ? fmt(Math.round(v.comments / v.withc)) : `<span class="muted">n/a</span>`}</td><td style="min-width:140px"><div style="display:flex;gap:10px;align-items:center">${meter(v.questions / v.n)}<span>${pct(v.questions, v.n)}%</span></div></td><td class="num">${pct(v.emotional, v.n)}%</td><td class="d-only">${top ? esc(top[0]) : ""}</td></tr>`;
  }).join("")}</tbody></table></div>` : empty("No subreddit data yet");

  const body = `<div class="page-head"><div>${eyebrow("From Google's index of Reddit")}<h1>Reddit</h1><p class="lede">What dog people on Reddit are talking about. Comment counts come from Google's Discussions and forums results; the comments themselves aren't available, so themes are read from titles and snippets.</p></div></div>
${pending?.n ? notice(`<b>${fmt(pending.n)} ${pending.n === 1 ? "thread is" : "threads are"} still being analysed.</b> Themes, pain points and angles fill in as they're read, every 10 minutes.`) : ""}
<div class="kpis" style="margin-top:0"><div><div class="v">${fmt(totals?.n)}</div><div class="l">Threads tracked</div><div class="s">Across ${fmt(totals?.subs)} subreddits</div></div><div><div class="v">${fmt(totals?.new24)}</div><div class="l">New, 24 hours</div></div><div><div class="v">${fmt(totals?.withc)}</div><div class="l">With comment counts</div><div class="s">${pct(totals?.withc || 0, totals?.n || 0)}% of threads</div></div><div><div class="v">${fmt(all.length)}</div><div class="l">In view</div><div class="s">Last ${days} days${sub ? `, r/${esc(sub)}` : ""}</div></div></div>
${section("What people are talking about", themeDate?.d ? `Themes for ${esc(dateShort(themeDate.d))}` : "")}${themesHtml}
${section("Threads", `${fmt(threads.length)} in view`)}${toolbar}${table}
<p class="hint d-only"><span><kbd>j</kbd> <kbd>k</kbd> move</span><span><kbd>o</kbd> open thread</span><span><kbd>s</kbd> send the angle to the pipeline</span></p>
${lower}
${section("Subreddits", `Last ${days} days`)}${subsTable}`;
  return { title: "Reddit", body };
}

/** JSON for the front end: threads with insights and score. */
export async function redditThreadsApi(env: Env, url: URL, lens?: string, region: RegionFilter = "uk") {
  const rows = await loadThreads(env, {
    days: Number(url.searchParams.get("days") || 7), lens, region,
    sub: url.searchParams.get("sub") || undefined, kind: url.searchParams.get("kind") || undefined, topic: url.searchParams.get("topic") || undefined,
  });
  return rows.sort((a, b) => b.score - a.score).slice(0, Number(url.searchParams.get("limit") || 200));
}

/** JSON for the front end: latest themes snapshot, plus the dates available for history. */
export async function redditThemesApi(env: Env) {
  const dates = ((await env.DB.prepare(`SELECT DISTINCT date FROM reddit_themes WHERE project=?1 ORDER BY date DESC LIMIT 60`).bind(PROJECT.id).all<any>()).results || []).map((r: any) => r.date);
  const latest = dates[0] ? ((await env.DB.prepare(`SELECT * FROM reddit_themes WHERE project=?1 AND date=?2 ORDER BY thread_count DESC`).bind(PROJECT.id, dates[0]).all<any>()).results || []) : [];
  return { dates, themes: latest.map((t: any) => ({ ...t, ideas: JSON.parse(t.ideas_json || "[]"), thread_ids: JSON.parse(t.thread_ids_json || "[]") })) };
}
