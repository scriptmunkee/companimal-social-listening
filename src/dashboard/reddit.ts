import { PROJECT, TOPICS } from "../../config/taxonomy";
import { Env, daysAgo } from "../lib";
import { RegionFilter } from "../analysis";
import { threadScore } from "../collectors/reddit";
import { layout, esc, topicLabel } from "./views";

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

const subLink = (url: URL, key: string, val: string | null) => {
  const u = new URL(url.toString());
  if (val === null) u.searchParams.delete(key); else u.searchParams.set(key, val);
  return `${u.pathname}${u.search}`;
};

export async function viewReddit(env: Env, url: URL, lens?: string, region: RegionFilter = "uk") {
  const days = Number(url.searchParams.get("days") || 7);
  const sub = url.searchParams.get("sub") || undefined;
  const kind = url.searchParams.get("kind") || undefined;
  const topic = url.searchParams.get("topic") || undefined;
  const sort = url.searchParams.get("sort") || "hot";
  const all = await loadThreads(env, { days, lens, region, sub, kind, topic });
  const threads = [...all].sort((a, b) =>
    sort === "discussed" ? (b.posts_count || 0) - (a.posts_count || 0)
    : sort === "new" ? Date.parse(b.created_at || b.first_seen) - Date.parse(a.created_at || a.first_seen)
    : b.score - a.score);

  const themeDate = await env.DB.prepare(`SELECT MAX(date) AS d FROM reddit_themes WHERE project=?1`).bind(PROJECT.id).first<any>();
  const themes = themeDate?.d ? ((await env.DB.prepare(`SELECT * FROM reddit_themes WHERE project=?1 AND date=?2 ORDER BY thread_count DESC`).bind(PROJECT.id, themeDate.d).all<any>()).results || []) : [];
  const byId = new Map(all.map((t) => [t.post_id, t]));
  const totals = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN posts_count IS NOT NULL THEN 1 ELSE 0 END) AS withc, COUNT(DISTINCT subreddit) AS subs, SUM(CASE WHEN first_seen >= ?2 THEN 1 ELSE 0 END) AS new24 FROM reddit_threads WHERE project=?1`).bind(PROJECT.id, new Date(Date.now() - 86400000).toISOString()).first<any>();
  const pending = await env.DB.prepare(`SELECT COUNT(*) AS n FROM reddit_threads WHERE insight_done=0`).first<any>();

  // Subreddit leaderboard and mixes
  const subs = new Map<string, { n: number; comments: number; withc: number; questions: number; emotional: number; themes: Map<string, number> }>();
  const emotions = new Map<string, number>();
  for (const t of all) {
    const s = subs.get(t.subreddit) || { n: 0, comments: 0, withc: 0, questions: 0, emotional: 0, themes: new Map() };
    s.n++; if (t.posts_count !== null) { s.comments += t.posts_count; s.withc++; }
    if (["question", "advice_request", "recommendation_request"].includes(t.kind || "")) s.questions++;
    if (["vent", "story", "celebration"].includes(t.kind || "")) s.emotional++;
    if (t.theme) s.themes.set(t.theme, (s.themes.get(t.theme) || 0) + 1);
    subs.set(t.subreddit, s);
    if (t.emotion) emotions.set(t.emotion, (emotions.get(t.emotion) || 0) + 1);
  }
  const subRows = [...subs.entries()].sort((a, b) => b[1].n - a[1].n);
  const emoRows = [...emotions.entries()].filter(([e]) => e !== "neutral").sort((a, b) => b[1] - a[1]);
  const emoMax = Math.max(1, ...emoRows.map(([, n]) => n));
  const pains = threads.filter((t) => t.pain_point).slice(0, 14);
  const angles = [...new Map(threads.filter((t) => t.content_angle).map((t) => [t.content_angle!.toLowerCase(), t])).values()].slice(0, 12);

  const chip = (label: string, href: string, on: boolean) => `<a href="${esc(href)}" class="${on ? "on" : ""}">${esc(label)}</a>`;
  const body = `<h1>Reddit</h1>
<p class="sub">What dog people on Reddit are talking about, from Google's index of Reddit. Comment counts come from Google's Discussions and forums results; comment text isn't available.${pending?.n ? ` <b>${pending.n} threads still being analysed.</b>` : ""}</p>
<div class="grid">
<div class="card kpi"><div class="n">${(totals?.n || 0).toLocaleString("en-GB")}</div><div class="l">Threads tracked across ${totals?.subs || 0} subreddits</div></div>
<div class="card kpi"><div class="n">${(totals?.new24 || 0).toLocaleString("en-GB")}</div><div class="l">New in the last 24 hours</div></div>
<div class="card kpi"><div class="n">${(totals?.withc || 0).toLocaleString("en-GB")}</div><div class="l">With comment counts</div></div>
<div class="card kpi"><div class="n">${all.length.toLocaleString("en-GB")}</div><div class="l">Relevant threads in view (${days} days)</div></div>
</div>

<h2>What people are talking about${themeDate?.d ? ` <span class="muted" style="font:400 13px Inter">(${esc(themeDate.d)})</span>` : ""}</h2>
${themes.length ? `<div class="grid">${themes.map((t: any) => {
    const ids: string[] = JSON.parse(t.thread_ids_json || "[]");
    const ex = ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 3) as ThreadRow[];
    const ideas: string[] = JSON.parse(t.ideas_json || "[]");
    return `<div class="card idea"><span class="tag ${t.sentiment === "negative" ? "terra" : t.sentiment === "positive" ? "forest" : ""}">${t.thread_count} threads · ${esc(t.sentiment)}</span><h3>${esc(t.theme)}</h3><p>${esc(t.summary)}</p>${t.why ? `<p><b>Why it matters:</b> ${esc(t.why)}</p>` : ""}${ideas.length ? `<ul>${ideas.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}${ex.length ? `<p style="margin-top:8px">${ex.map((e) => `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc((e.title || "").slice(0, 70))}</a>`).join("<br>")}</p>` : ""}</div>`;
  }).join("")}</div>` : `<div class="card empty">Themes are built once the first batch of threads is analysed.</div>`}

<h2>Threads</h2>
<div class="bar"><div class="lens">${chip("Hot right now", subLink(url, "sort", "hot"), sort === "hot")}${chip("Most discussed", subLink(url, "sort", "discussed"), sort === "discussed")}${chip("Newest", subLink(url, "sort", "new"), sort === "new")}</div>
<div class="lens">${[7, 30, 90].map((d) => chip(`${d} days`, subLink(url, "days", String(d)), days === d)).join("")}</div></div>
<div class="lens" style="margin-bottom:10px">${chip("All subreddits", subLink(url, "sub", null), !sub)}${subRows.slice(0, 12).map(([s]) => chip(`r/${s}`, subLink(url, "sub", s), sub?.toLowerCase() === s.toLowerCase())).join("")}</div>
<div class="lens" style="margin-bottom:14px">${chip("All kinds", subLink(url, "kind", null), !kind)}${Object.entries(KIND_LABELS).map(([k, l]) => chip(l, subLink(url, "kind", k), kind === k)).join("")}</div>
${threads.length ? `<table><tr><th class="num">Score</th><th>Thread</th><th>Subreddit</th><th class="num">Age</th><th class="num">Comments</th><th class="num">Seen</th><th>What it's about</th><th>Content angle</th><th></th></tr>
${threads.slice(0, 150).map((t) => `<tr>
<td class="num"><b>${t.score}</b></td>
<td style="max-width:340px"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title || "(untitled)")}</a>${t.snippet ? `<div class="muted" style="font-size:13px">${esc(t.snippet.slice(0, 180))}${t.snippet.length > 180 ? "…" : ""}</div>` : ""}</td>
<td><a href="${esc(subLink(url, "sub", t.subreddit))}">r/${esc(t.subreddit)}</a></td>
<td class="num">${age(t.created_at || t.first_seen)}</td>
<td class="num">${t.posts_count ?? "–"}${t.growth ? ` <span class="ok">+${t.growth}</span>` : ""}</td>
<td class="num">${t.seen_count}</td>
<td style="max-width:260px">${t.kind ? `<span class="tag">${esc(KIND_LABELS[t.kind] || t.kind)}</span> ` : ""}${t.theme ? `<b>${esc(t.theme)}</b>` : `<span class="muted">Analysing…</span>`}${t.pain_point ? `<div class="muted" style="font-size:13px">${esc(t.pain_point)}</div>` : ""}${t.emotion && t.emotion !== "neutral" ? `<div class="muted" style="font-size:12px">Feeling ${esc(t.emotion)}${t.need ? ` · wants ${esc(t.need)}` : ""}</div>` : ""}</td>
<td style="max-width:240px">${t.content_angle ? esc(t.content_angle) : ""}</td>
<td>${t.content_angle ? `<button class="btn" data-send data-topic="${esc(t.topic || "other")}" data-q="${esc(t.content_angle)}">Send to pipeline</button>` : ""}</td>
</tr>`).join("")}</table>${threads.length > 150 ? `<p class="muted">Showing 150 of ${threads.length}. Narrow by subreddit or kind.</p>` : ""}` : `<div class="card empty">No threads yet for these filters. Searches are queued; results arrive within the hour.</div>`}

<div class="grid" style="margin-top:28px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">
<div class="card"><h2 style="margin-top:0">Pain points</h2>${pains.length ? `<ul style="padding-left:18px;margin:0">${pains.map((t) => `<li style="margin-bottom:6px">${esc(t.pain_point)} <a href="${esc(t.url)}" target="_blank" class="muted">↗</a> <span class="tag">${esc(topicLabel(t.topic || "other"))}</span></li>`).join("")}</ul>` : `<p class="muted">Appear once threads are analysed.</p>`}</div>
<div class="card"><h2 style="margin-top:0">Content angles</h2>${angles.length ? `<ul style="padding-left:18px;margin:0">${angles.map((t) => `<li style="margin-bottom:6px">${esc(t.content_angle)} <span class="muted" style="font-size:12px">from r/${esc(t.subreddit)}${t.posts_count ? `, ${t.posts_count} comments` : ""}</span></li>`).join("")}</ul>` : `<p class="muted">Appear once threads are analysed.</p>`}</div>
<div class="card"><h2 style="margin-top:0">How people feel</h2>${emoRows.length ? emoRows.map(([e, n]) => `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:14px"><span style="width:96px">${esc(e[0].toUpperCase() + e.slice(1))}</span><span style="flex:1;background:var(--sand);border-radius:4px;height:10px"><span style="display:block;height:10px;border-radius:4px;background:var(--forest);width:${Math.round((n / emoMax) * 100)}%"></span></span><span class="muted" style="width:32px;text-align:right">${n}</span></div>`).join("") : `<p class="muted">Appears once threads are analysed.</p>`}</div>
</div>

<h2>Subreddits</h2>
${subRows.length ? `<table><tr><th>Subreddit</th><th class="num">Threads</th><th class="num">Avg comments</th><th class="num">Asking for help</th><th class="num">Stories and venting</th><th>Top theme</th></tr>${subRows.map(([s, v]) => {
    const top = [...v.themes.entries()].sort((a, b) => b[1] - a[1])[0];
    return `<tr><td><a href="${esc(subLink(url, "sub", s))}">r/${esc(s)}</a></td><td class="num">${v.n}</td><td class="num">${v.withc ? Math.round(v.comments / v.withc) : "–"}</td><td class="num">${Math.round((v.questions / v.n) * 100)}%</td><td class="num">${Math.round((v.emotional / v.n) * 100)}%</td><td>${top ? esc(top[0]) : ""}</td></tr>`;
  }).join("")}</table>` : `<div class="card empty">No subreddit data yet.</div>`}`;
  return layout("/reddit", "Reddit", body, lens, region);
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
