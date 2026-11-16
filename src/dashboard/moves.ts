// Insights-first views: This week (the ranked ledger of moves), one move with its brief, Demand, Themes, Coverage.
// Design rules: .interface-design/system.md
import { PROJECT, SEASONS, DEMAND, TOPICS } from "../../config/taxonomy";
import { Env, daysAgo, weekKey, monthOf } from "../lib";
import { TYPES, STATUS_LABEL, DISMISS_REASONS, SOURCE_NAME } from "../insights";
import { breedName } from "../site";
import { Ctx, esc, fmt, href, empty, dateShort } from "./ui";

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
const MONTH = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const parse = (s: string | null | undefined, d: any = []) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const siteUrl = (path: string | null) => (path ? `${PROJECT.site}${path}` : "");
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "0%");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const sayN = (n: number) => (n > 0 && n < words.length ? words[n] : fmt(n));
const topicLabel = (id: string | null) => TOPICS.find((t) => t.id === id)?.label || "";

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)}d ago`;
  return `${Math.round(s / (86400 * 30))}mo ago`;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** The dog year: season bands with a "now" marker. Solid bands have people talking about them this fortnight. */
async function yearStrip(env: Env): Promise<string> {
  const rows = (await env.DB.prepare(`SELECT t.title, i.theme, i.question FROM reddit_threads t JOIN reddit_insights i ON i.post_id=t.post_id WHERE t.project=?1 AND t.last_seen >= ?2 AND i.kind <> 'irrelevant' LIMIT 4000`).bind(PROJECT.id, daysAgo(14)).all<any>()).results || [];
  const talk = new Map(SEASONS.map((s) => [s.id, rows.filter((r: any) => s.terms.test(`${r.title || ""} ${r.theme || ""} ${r.question || ""}`)).length]));
  const d = new Date();
  const pos = (monthOf(d) - 1 + (d.getUTCDate() - 1) / 31) / 12;
  const body = SEASONS.map((s, i) => {
    const row = i + 2;
    const spans = s.from <= s.to ? [[s.from, s.to]] : [[s.from, 12], [1, s.to]];
    const n = talk.get(s.id) || 0;
    const live = n >= 3;
    return `<div class="year-l" style="grid-row:${row}" title="${esc(s.note)}">${esc(s.label)}</div>` + spans.map(([a, b]) =>
      `<div class="band${live ? " live" : ""}" style="grid-row:${row};grid-column:${a + 1} / ${b + 2}" data-tip="${esc(`${s.label}: ${s.note}. ${n ? `${n} threads in the last 14 days` : "Quiet so far"}`)}"></div>`).join("");
  }).join("");
  return `<section class="year" aria-label="The dog year">
<div class="year-grid"><div></div>${MONTH.map((m) => `<div class="year-m">${m}</div>`).join("")}${body}
<div class="now" style="left:calc(var(--lw) + (100% - var(--lw)) * ${pos.toFixed(4)})"><span>Now</span></div></div>
<p class="year-cap">Rule-of-thumb UK windows. Solid bands have three or more threads about them in the last fortnight.</p></section>`;
}

function evidenceLine(m: any): string {
  const parts: string[] = [];
  if (m.threads) parts.push(`<span><b>${fmt(m.threads)}</b> ${m.threads === 1 ? "thread" : "threads"}</span>`);
  if (m.posts) parts.push(`<span><b>${fmt(m.posts)}</b> ${m.posts === 1 ? "post" : "posts"} elsewhere</span>`);
  if (m.comments) parts.push(`<span><b>${fmt(m.comments)}</b> comments</span>`);
  if (m.upvotes) parts.push(`<span><b>${fmt(m.upvotes)}</b> upvotes</span>`);
  const n = (m.threads || 0) + (m.posts || 0);
  if (n) parts.push(`<span><b>${pct(m.uk || 0, n)}</b> clearly UK</span>`);
  if (m.channels?.length > 1) parts.push(`<span>${esc(m.channels.join(", "))}</span>`);
  if (typeof m.prev === "number" && n) parts.push(`<span>${n >= m.prev ? "up" : "down"} from <b>${m.prev}</b> the fortnight before</span>`);
  return parts.join("");
}

function kindRow(c: any, m: any): string {
  const bits = [`<span class="k">${esc(TYPES[c.type]?.label || c.type)}</span>`];
  if (m.guideAsks) bits.push(`<span class="hot">${m.guideAsks} asked for a guide</span>`);
  if (m.urgent) bits.push(`<span class="hot" title="Stuck right now: a deposit at risk, a sick dog, a dog to rehome this week">${m.urgent} urgent</span>`);
  if (c.breed) bits.push(`<span class="t">${esc(breedName(c.breed))}</span>`);
  else if (c.topic && topicLabel(c.topic)) bits.push(`<span class="t">${esc(topicLabel(c.topic))}</span>`);
  if (m.topRegion) bits.push(`<span class="t">${esc(m.topRegion)}</span>`);
  if (c.type === "seasonal" && typeof m.weeks === "number") bits.push(`<span class="t">${m.live ? "Under way" : `${m.weeks} weeks out`}</span>`);
  return `<div class="kind">${bits.join("")}</div>`;
}

function statusButtons(c: any): string {
  const b = (st: string, label: string) => `<button type="button" class="btn ghost sm" data-set="${st}" aria-pressed="${c.status === st}">${label}</button>`;
  return `<div class="state">${b("planned", "Plan")}${b("done", "Done")}${b("dismissed", "Dismiss")}</div>
<div class="why" role="group" aria-label="Why dismiss this move"><span class="label">Why?</span>${DISMISS_REASONS.map((r) => `<button type="button" class="chip" data-set="dismissed" data-reason="${esc(r)}" title="${r === "Not relevant" ? "Never show this move again" : r === "Not now" ? "Hide it for four weeks" : "Hide it unless the evidence doubles"}">${r}</button>`).join("")}</div>`;
}

const target = (c: any) => c.target_url ? (c.target_exists
  ? `<a class="path" href="${esc(siteUrl(c.target_url))}" target="_blank" rel="noopener">${esc(c.target_url)}</a>`
  : `<span class="path new">${esc(c.target_url)}</span>`) : "";

function moveCard(ctx: Ctx, c: any, i: number): string {
  const m = parse(c.metrics_json, {});
  const link = href(ctx, `/move/${c.id}`);
  return `<article class="move${i === 0 ? " first" : ""}" data-id="${esc(c.id)}" data-status="${esc(c.status)}">
<div class="n" aria-hidden="true">${i + 1}</div><div>
<span class="stamp planned" aria-hidden="true">Planned</span>
${kindRow(c, m)}
<h2><a href="${link}">${esc(c.headline)}</a></h2>
<p class="so">${esc(c.so_what)}</p>
<div class="act"><a class="btn" href="${link}">${esc(c.action_label || "Open")}</a><span class="what">${esc(c.action)} ${target(c)}</span></div>
<div class="ev">${evidenceLine(m)}${statusButtons(c)}</div></div></article>`;
}

/** Freshness and size of the listening, for the stamp and empty states. */
async function totals(env: Env) {
  return env.DB.prepare(`SELECT (SELECT COUNT(*) FROM reddit_threads WHERE project=?1) AS threads, (SELECT COUNT(*) FROM reddit_insights) AS read,
    (SELECT COUNT(*) FROM items WHERE project=?1 AND source <> 'reddit') AS posts, (SELECT MIN(collected_at) FROM items WHERE project=?1) AS since,
    (SELECT COALESCE(SUM(cost_usd),0) FROM runs WHERE project=?1 AND started_at >= ?2) AS cost`).bind(PROJECT.id, new Date().toISOString().slice(0, 8) + "01").first<any>();
}

// ---------------------------------------------------------------------------
// This week
// ---------------------------------------------------------------------------
export async function thisWeek(env: Env, ctx: Ctx, url: URL) {
  const type = url.searchParams.get("type") || "";
  const view = url.searchParams.get("view") || "open";
  const statuses = view === "closed" ? ["done", "dismissed"] : view === "planned" ? ["planned"] : ["new", "planned"];
  const all = (await env.DB.prepare(`SELECT * FROM insights WHERE project=?1 AND (last_seen_date >= ?2 OR status = 'planned') ORDER BY priority DESC LIMIT 300`).bind(PROJECT.id, daysAgo(10)).all<any>()).results || [];
  const fresh = daysAgo(2);
  const isOpen = (c: any) => c.status === "planned" || (c.status === "new" && c.last_seen_date >= fresh);
  const pool = all.filter((c: any) => statuses.includes(c.status) && (c.status !== "new" || c.last_seen_date >= fresh));
  const list = pool.filter((c: any) => !type || c.type === type).slice(0, 30);
  const counts = new Map<string, number>(); for (const c of pool) counts.set(c.type, (counts.get(c.type) || 0) + 1);
  const open = all.filter(isOpen);
  const by = (t: string) => open.filter((c: any) => c.type === t).length;
  const t = await totals(env);

  // Headline sentence from the numbers
  const parts = [
    by("new_article") && `${fmt(by("new_article"))} to write`, by("update_article") && `${fmt(by("update_article"))} to update`,
    by("demand") && plural(by("demand"), "demand signal"), by("tool") && plural(by("tool"), "tool idea"), by("myth") && plural(by("myth"), "myth"), by("seasonal") && `${fmt(by("seasonal"))} seasonal`,
  ].filter(Boolean) as string[];
  const top = open[0];
  const tm = top ? parse(top.metrics_json, {}) : {};
  const headline = !t?.threads && !t?.posts ? "Listening starts with the first pull"
    : open.length ? `${sayN(open.length)} ${open.length === 1 ? "move" : "moves"} this week: ${parts.join(", ")}.` : "No open moves right now";
  const lede = !open.length
    ? (t?.threads ? "Moves are rebuilt every morning at 06:30 from the last fortnight across Reddit, YouTube, People Also Ask, forums and the web. If the first pull has only just run, they appear once the AI has read it." : "Nothing collected yet.")
    : `The biggest: ${top.headline.replace(/\.$/, "")}${tm.comments ? `, ${fmt(tm.comments)} comments between them` : ""}. Plan what you'll do; dismissed moves only come back if the evidence doubles, and "Not relevant" closes one for good.`;

  // Aside: demand, channels, listening
  const demand = (await env.DB.prepare(`SELECT i.intent, COUNT(*) AS n, SUM(CASE WHEN i.urgency='now' THEN 1 ELSE 0 END) AS urgent FROM reddit_threads t JOIN reddit_insights i ON i.post_id=t.post_id
    WHERE t.project=?1 AND COALESCE(t.created_at, t.first_seen) >= ?2 AND i.kind <> 'irrelevant' AND COALESCE(i.region,'unknown') <> 'non_uk' AND i.intent IN ('buy','sell','stud','rehome','adopt')
    GROUP BY i.intent ORDER BY n DESC`).bind(PROJECT.id, daysAgo(14)).all<any>()).results || [];
  const channels = (await env.DB.prepare(`SELECT 'reddit' AS source, COUNT(*) AS n FROM reddit_threads WHERE project=?1 AND last_seen >= ?2
    UNION ALL SELECT i.source, COUNT(*) FROM items i JOIN enrichments e ON e.item_id=i.id WHERE i.project=?1 AND i.collected_date >= ?2 AND i.source <> 'reddit' AND e.kind <> 'irrelevant' GROUP BY i.source`).bind(PROJECT.id, daysAgo(14)).all<any>()).results || [];
  const ch = new Map<string, number>(); for (const r of channels) { const k = SOURCE_NAME[r.source] || r.source; ch.set(k, (ch.get(k) || 0) + r.n); }
  const chRows = [...ch.entries()].sort((a, b) => b[1] - a[1]);
  const maxD = Math.max(1, ...demand.map((r: any) => r.n));

  const q = (k: string, v: string) => { const p = new URLSearchParams(url.search); if (v) p.set(k, v); else p.delete(k); return esc(`/?${p}`); };
  const chip = (tp: string, label: string) => `<a class="chip${type === tp ? " on" : ""}" href="${q("type", tp)}">${label}${tp ? `<b>${counts.get(tp) || 0}</b>` : ""}</a>`;
  const vchip = (v: string, label: string) => `<a class="chip${view === v ? " on" : ""}" href="${q("view", v)}">${label}</a>`;

  const body = `<p class="eyebrow">${esc(weekKey().replace("-W", " · Week "))} · ${esc(DAY.format(new Date()))}</p>
<h1 class="headline">${esc(headline)}</h1><p class="lede">${esc(lede)}</p>
${await yearStrip(env)}
<div class="ledger"><div>
<div class="chips" role="navigation" aria-label="Filter moves">${chip("", "All")}${Object.entries(TYPES).filter(([tp]) => counts.get(tp)).map(([tp, v]) => chip(tp, v.label)).join("")}<span class="spacer"></span>${vchip("open", "Open")}${vchip("planned", "Planned")}${vchip("closed", "Closed")}</div>
${list.length ? `<div class="moves">${list.map((c: any, i: number) => moveCard(ctx, c, i)).join("")}</div>`
    : empty(view === "open" ? "No open moves" : "Nothing here yet", view === "open" ? (t?.threads ? "Moves rebuild every morning at 06:30. After the first pull, they appear once the AI has read the threads." : "The first pull hasn't run yet. See Sources for the setup checklist.") : "Moves you plan, finish or dismiss land here.")}
</div><aside class="aside">
<section class="box"><h3>People ready to act, 14 days</h3>${demand.length ? `<div class="bars">${demand.map((r: any) => `<a class="bar-row" href="${href(ctx, "/demand")}#${esc(r.intent)}" data-tip="${esc(`${r.n} threads${r.urgent ? `, ${r.urgent} urgent` : ""}`)}"><span class="lab">${esc(DEMAND[r.intent]?.label || r.intent)}</span><span class="v">${fmt(r.n)}</span><span class="track"><span class="fill" style="display:block;width:${Math.round((r.n / maxD) * 100)}%"></span></span></a>`).join("")}</div>` : `<p class="muted small" style="margin:0">Nobody looking to buy, sell or rehome yet.</p>`}</section>
<section class="box"><h3>Where it's coming from, 14 days</h3>${chRows.length ? `<div class="bars">${chRows.map(([k, n]) => `<div class="bar-row"><span class="lab">${esc(k)}</span><span class="v">${fmt(n)}</span><span class="track"><span class="fill" style="display:block;width:${Math.round((n / chRows[0][1]) * 100)}%;background:var(--grey)"></span></span></div>`).join("")}</div>` : `<p class="muted small" style="margin:0">Waiting for the first collection.</p>`}</section>
<section class="box"><h3>Listening</h3><div class="figs"><div><b>${fmt(t?.threads)}</b>Reddit threads</div><div><b>${fmt(t?.posts)}</b>other posts</div><div><b>$${(t?.cost || 0).toFixed(2)}</b>this month</div></div>
<p class="small muted" style="margin:12px 0 0">${t?.since ? `Archive since ${esc(dateShort(t.since))}. ` : ""}<a href="${href(ctx, "/sources")}">Sources and health</a></p></section>
</aside></div>`;
  return { title: "This week", body };
}

// ---------------------------------------------------------------------------
// One move
// ---------------------------------------------------------------------------
export async function moveDetail(env: Env, ctx: Ctx, id: string) {
  const c = await env.DB.prepare(`SELECT * FROM insights WHERE id=?1 AND project=?2`).bind(id, PROJECT.id).first<any>();
  if (!c) return null;
  const m = parse(c.metrics_json, {});
  const ev = parse(c.evidence_json);
  const brief = parse(c.brief_json, null);
  const events = (await env.DB.prepare(`SELECT * FROM insight_events WHERE insight_id=?1 ORDER BY at DESC LIMIT 20`).bind(id).all<any>()).results || [];
  const page = c.target_url ? await env.DB.prepare(`SELECT title, h1 FROM site_pages WHERE project=?1 AND path=?2`).bind(PROJECT.id, c.target_url).first<any>() : null;
  const evRow = (e: any) => `<div class="thread"><a class="t" href="${esc(e.url || "#")}" target="_blank" rel="noopener">${esc(e.title || e.question || "Untitled")}</a>
<div class="meta">${[esc(e.where || SOURCE_NAME[e.ch] || e.ch), e.comments != null ? `${fmt(e.comments)} comments` : "", e.upvotes != null ? `${fmt(e.upvotes)} upvotes` : "", e.ch !== "reddit" && e.engagement ? `${fmt(e.engagement)} engagement` : "",
    esc(ago(e.created)), e.region === "uk" ? "UK" : "", esc(e.uk_region || ""), e.urgency === "now" ? `<span class="urgent">urgent</span>` : ""].filter(Boolean).join(" · ")}</div>
${e.question ? `<div class="meta">Asking: <span style="color:var(--ink-2)">${esc(e.question)}</span></div>` : ""}${e.replies ? `<div class="rep">${esc(e.replies)}</div>` : ""}</div>`;
  const body = `<p class="eyebrow"><a class="crumb" href="${href(ctx, "/")}">This week</a> · <span data-status-label>${esc(STATUS_LABEL[c.status] || c.status)}</span></p>
<div class="ledger"><div>
<div data-id="${esc(c.id)}" data-status="${esc(c.status)}" class="move-solo">
${kindRow(c, m)}<h1 class="headline" style="font-size:38px;max-width:28ch">${esc(c.headline)}</h1><p class="lede">${esc(c.so_what)}</p>
<section class="nowwhat" style="margin-top:24px"><p class="label">Now what</p><p class="do">${esc(c.action)}</p>
<div class="act">${c.target_url && c.target_exists ? `<a class="btn" href="${esc(siteUrl(c.target_url))}" target="_blank" rel="noopener">Open ${esc(c.target_url)}</a>` : ""}${!brief ? `<button type="button" class="btn${c.target_url && c.target_exists ? " ghost" : ""}" data-brief="${esc(c.id)}">Draft the brief</button>` : ""}
<span class="small muted">${page ? `Current title: ${esc(page.title || page.h1 || "")}` : c.target_url ? `${esc(c.target_url)} doesn't exist yet` : ""}</span></div>
<div class="ev">${evidenceLine(m)}${statusButtons(c)}</div></section></div>
${brief ? `<section class="brief"><p class="label">Content brief</p><h2>${esc(brief.title)}</h2>
${brief.meta_title ? `<p class="small" style="margin:0"><b>Title tag:</b> ${esc(brief.meta_title)}</p>` : ""}${brief.meta_description ? `<p class="small" style="margin:4px 0 0"><b>Meta description:</b> ${esc(brief.meta_description)}</p>` : ""}
<div class="grid2" style="margin-top:20px"><div><p class="label">Outline</p><ol>${(brief.outline || []).map((x: string) => `<li>${esc(x)}</li>`).join("")}</ol></div>
${brief.questions?.length ? `<div><p class="label">Questions it must answer</p><ol>${brief.questions.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ol></div>` : ""}</div>
${brief.consensus ? `<p class="label">What the replies agree on</p><p>${esc(brief.consensus)}</p>` : ""}
${brief.gaps?.length ? `<p class="label">What the threads lacked</p><ul>${brief.gaps.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
${brief.links?.length ? `<p class="label">Internal links</p><ul>${brief.links.map((l: any) => `<li>Link <b>${esc(l.anchor)}</b> to <a class="path" href="${esc(siteUrl(l.path))}" target="_blank" rel="noopener">${esc(l.path)}</a></li>`).join("")}</ul>` : ""}
${brief.sources?.length ? `<p class="label">Sources to cite</p><ul>${brief.sources.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
<button type="button" class="btn ghost sm" data-brief="${esc(c.id)}">Draft it again</button></section>` : ""}
<h3 class="label" style="margin-top:36px">The evidence</h3>${ev.length ? ev.map(evRow).join("") : `<p class="muted">A calendar move: no posts behind it yet.</p>`}
</div><aside class="aside">
<section class="box"><h3>Why it ranks here</h3><div class="figs"><div><b>${(c.priority || 0).toFixed(0)}</b>priority</div><div><b>${fmt((m.threads || 0) + (m.posts || 0))}</b>pieces of evidence</div></div>
<p class="small muted" style="margin:12px 0 0">Engagement and growth of the posts behind it, discounted by age; more for UK posts, people asking for a guide, urgency and the same thing on more than one channel.</p></section>
<section class="box"><h3>History</h3><ul class="history"><li>Found ${esc(dateShort(c.created_at))}${c.model && c.model !== "rules" ? ` · written by AI` : " · from rules"}</li>${events.map((e: any) => `<li>${esc(STATUS_LABEL[e.status] || e.status)} ${esc(dateShort(e.at))}${e.reason ? `: ${esc(e.reason)}` : ""}</li>`).join("")}</ul></section>
</aside></div>`;
  return { title: c.headline.slice(0, 60), body };
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------
export async function demandView(env: Env, ctx: Ctx) {
  const rows = (await env.DB.prepare(`SELECT t.post_id, t.title, t.url, t.subreddit, t.posts_count, t.score, t.created_at, t.first_seen, i.intent, i.breed, i.breed_slug, i.question, i.urgency, i.region, i.uk_region, i.replies,
      CASE WHEN COALESCE(t.created_at, t.first_seen) >= ?2 THEN 'cur' ELSE 'prev' END AS period
    FROM reddit_threads t JOIN reddit_insights i ON i.post_id=t.post_id WHERE t.project=?1 AND COALESCE(t.created_at, t.first_seen) >= ?3 AND i.kind <> 'irrelevant' AND COALESCE(i.region,'unknown') <> 'non_uk'
      AND i.intent IN ('buy','sell','stud','rehome','adopt')
    ORDER BY CASE i.urgency WHEN 'now' THEN 0 WHEN 'soon' THEN 1 ELSE 2 END, COALESCE(t.posts_count,0) DESC`).bind(PROJECT.id, daysAgo(14), daysAgo(28)).all<any>()).results || [];
  const cur = rows.filter((r: any) => r.period === "cur");
  const moves = new Map(((await env.DB.prepare(`SELECT id, key FROM insights WHERE project=?1 AND key LIKE 'demand:%' AND status IN ('new','planned')`).bind(PROJECT.id).all<any>()).results || []).map((r: any) => [r.key, r.id]));
  const groups = Object.keys(DEMAND).map((k) => ({ k, d: DEMAND[k], list: cur.filter((r: any) => r.intent === k), prev: rows.filter((r: any) => r.period === "prev" && r.intent === k).length }))
    .filter((g) => g.list.length || g.prev).sort((a, b) => b.list.length - a.list.length);
  const urgent = cur.filter((r: any) => r.urgency === "now").length;
  const buyers = cur.filter((r: any) => r.intent === "buy").length, sellers = cur.filter((r: any) => r.intent === "sell" || r.intent === "stud").length;
  const row = (t: any) => `<div class="thread"><a class="t" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a>
<div class="meta">${[`r/${esc(t.subreddit)}`, t.posts_count != null ? `${fmt(t.posts_count)} comments` : "", t.score != null ? `${fmt(t.score)} upvotes` : "", esc(ago(t.created_at || t.first_seen)), t.breed ? esc(t.breed) : "", t.uk_region ? esc(t.uk_region) : t.region === "uk" ? "UK" : "", t.urgency === "now" ? `<span class="urgent" title="Stuck right now">urgent</span>` : ""].filter(Boolean).join(" · ")}</div>
${t.question ? `<div class="meta">Asking: <span style="color:var(--ink-2)">${esc(t.question)}</span></div>` : ""}${t.replies ? `<div class="rep">${esc(t.replies)}</div>` : ""}</div>`;
  const body = `<p class="eyebrow">Demand · last 14 days</p>
<h1 class="headline">${cur.length ? `${sayN(cur.length)} ${cur.length === 1 ? "thread" : "threads"} from people ready to act: ${fmt(buyers)} buying, ${fmt(sellers)} selling or breeding.` : "Nobody looking to buy, sell or rehome yet"}</h1>
<p class="lede">People on Reddit looking for a puppy, a breeder, a stud or a home for their dog${urgent ? `; <b>${urgent}</b> of them stuck right now` : ""}. Each group says which Companimal page should answer them, and links to its move.</p>
<div style="margin-top:28px">${groups.length ? groups.map((g, gi) => {
    const breeds = new Map<string, number>(); for (const r of g.list) if (r.breed_slug) breeds.set(r.breed_slug, (breeds.get(r.breed_slug) || 0) + 1);
    const topBreeds = [...breeds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const moveIds = [...moves.entries()].filter(([k]) => k.startsWith(`demand:${g.k}:`));
    return `<details class="row" id="${esc(g.k)}"${gi === 0 ? " open" : ""}><summary><div><div class="kind"><span class="k">${esc(g.d.who)}</span>${g.list.filter((r: any) => r.urgency === "now").length ? `<span class="hot">${g.list.filter((r: any) => r.urgency === "now").length} urgent</span>` : ""}<span class="t">Lands on <span class="p">${esc(g.d.hub)}</span></span></div>
<h2>${esc(g.d.label)}</h2></div><div><div class="big">${fmt(g.list.length)}</div><div class="delta${g.list.length > g.prev ? " up" : ""}">${g.prev ? `${g.list.length >= g.prev ? "up" : "down"} from ${g.prev}` : "new"}</div></div></summary>
<div class="inner">${topBreeds.length ? `<div class="chips" style="margin:10px 0 4px">${topBreeds.map(([b, n]) => `<a class="chip" href="${esc(`${PROJECT.site}${g.d.breedHub ? g.d.breedHub.replace("{breed}", b) : `/breeds/${b}/`}`)}" target="_blank" rel="noopener">${esc(breedName(b))}<b>${n}</b></a>`).join("")}</div>` : ""}
${moveIds.length ? `<p class="small" style="margin:8px 0">${moveIds.map(([k, id]) => `<a href="${href(ctx, `/move/${id}`)}">See the move${k.endsWith(":any") ? "" : ` for ${esc(breedName(k.split(":")[2]))}`}</a>`).join(" · ")}</p>` : ""}
${g.list.map(row).join("") || `<p class="muted">None this fortnight.</p>`}</div></details>`;
  }).join("") : empty("Nothing yet", "This fills when people ask where to buy a puppy, how to sell a litter, where to find a stud or how to rehome a dog.")}</div>`;
  return { title: "Demand", body };
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------
export async function themesView(env: Env, ctx: Ctx) {
  const latest = await env.DB.prepare(`SELECT MAX(date) AS d FROM reddit_themes WHERE project=?1`).bind(PROJECT.id).first<any>();
  const list = latest?.d ? ((await env.DB.prepare(`SELECT * FROM reddit_themes WHERE project=?1 AND date=?2`).bind(PROJECT.id, latest.d).all<any>()).results || []) : [];
  const ids = [...new Set(list.flatMap((t: any) => parse(t.thread_ids_json)))] as string[];
  const threads = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 90) {
    const rs = (await env.DB.prepare(`SELECT t.post_id, t.title, t.url, t.subreddit, t.posts_count, t.score, t.created_at, t.first_seen, i.question, i.replies, i.region, i.uk_region, i.urgency
      FROM reddit_threads t LEFT JOIN reddit_insights i ON i.post_id=t.post_id WHERE t.post_id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(ids.slice(i, i + 90))).all<any>()).results || [];
    for (const r of rs) threads.set(r.post_id, r);
  }
  for (const t of list) { const tl = parse(t.thread_ids_json).map((id: string) => threads.get(id)).filter(Boolean); t.tl = tl; t.comments = tl.reduce((a: number, x: any) => a + (x.posts_count || 0), 0); t.upvotes = tl.reduce((a: number, x: any) => a + Math.max(0, x.score || 0), 0); }
  list.sort((a: any, b: any) => (b.comments + b.upvotes) - (a.comments + a.upvotes));
  const moves = (await env.DB.prepare(`SELECT id, key, type, status FROM insights WHERE project=?1 AND key LIKE 'article:%'`).bind(PROJECT.id).all<any>()).results || [];
  const prevDate = latest?.d ? await env.DB.prepare(`SELECT MAX(date) AS d FROM reddit_themes WHERE project=?1 AND date <= ?2`).bind(PROJECT.id, daysAgo(7)).first<any>() : null;
  const prev = new Set(prevDate?.d ? ((await env.DB.prepare(`SELECT theme FROM reddit_themes WHERE project=?1 AND date=?2`).bind(PROJECT.id, prevDate.d).all<any>()).results || []).map((r: any) => r.theme.toLowerCase()) : []);
  const card = (t: any) => {
    const sl = t.theme.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    const mv = moves.find((c: any) => c.key === `article:${sl}`);
    const cover = mv ? (mv.type === "new_article" ? "No page yet" : "Page needs work") : "Covered or not assessed";
    const ideas = parse(t.ideas_json);
    return `<article class="theme"><div class="kind"><span class="k">${esc(cover)}</span>${prevDate?.d && !prev.has(t.theme.toLowerCase()) ? `<span class="hot">New this week</span>` : ""}<span class="t">${esc(t.sentiment || "")}</span></div>
<h2>${esc(t.theme)}</h2><p>${esc(t.summary)}</p>${t.why ? `<p class="small"><b>Why it matters:</b> ${esc(t.why)}</p>` : ""}
${ideas.length ? `<p class="label" style="margin:4px 0 6px">Article ideas</p><ul>${ideas.map((i: string) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
<details class="more"><summary>The ${t.tl.length} threads</summary>${t.tl.map((x: any) => `<div class="thread"><a class="t" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><div class="meta">${[`r/${esc(x.subreddit)}`, x.posts_count != null ? `${fmt(x.posts_count)} comments` : "", x.score != null ? `${fmt(x.score)} upvotes` : "", esc(ago(x.created_at || x.first_seen))].filter(Boolean).join(" · ")}</div>${x.replies ? `<div class="rep">${esc(x.replies)}</div>` : ""}</div>`).join("")}</details>
<div class="ev"><span><b>${fmt(t.tl.length)}</b> threads</span><span><b>${fmt(t.comments)}</b> comments</span><span><b>${fmt(t.upvotes)}</b> upvotes</span>${mv ? `<span style="margin-left:auto"><a href="${href(ctx, `/move/${mv.id}`)}">See the move</a></span>` : ""}</div></article>`;
  };
  const totalComments = list.reduce((a: number, t: any) => a + t.comments, 0);
  const body = `<p class="eyebrow">Themes · Reddit, last 14 days${latest?.d ? ` · rebuilt ${esc(dateShort(latest.d))}` : ""}</p>
<h1 class="headline">${list.length ? `${sayN(list.length)} conversations dog people keep having, ${fmt(totalComments)} comments between them.` : "No themes yet"}</h1>
<p class="lede">Specific situations, not categories, grouped by the AI from what people post and what the replies say. Each is checked against companimal.co.uk: <b>No page yet</b> and <b>Page needs work</b> have a move waiting.</p>
<div style="margin-top:28px">${list.length ? `<div class="grid2">${list.map(card).join("")}</div>` : empty("Not enough threads yet", "Themes need at least five read threads from the last fortnight. They rebuild every morning at 06:30.")}</div>`;
  return { title: "Themes", body };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------
export async function coverageView(env: Env, ctx: Ctx) {
  const pages = (await env.DB.prepare(`SELECT path, kind, title, h1, updated_at, source FROM site_pages WHERE project=?1 AND kind IN ('advice','statistics','core') ORDER BY path`).bind(PROJECT.id).all<any>()).results || [];
  const breedN = await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_pages WHERE project=?1 AND kind='breed'`).bind(PROJECT.id).first<any>();
  const open = (await env.DB.prepare(`SELECT id, type, headline, target_url, target_exists, status, priority, breed FROM insights WHERE project=?1 AND (status='planned' OR (status='new' AND last_seen_date >= ?2)) ORDER BY priority DESC`).bind(PROJECT.id, daysAgo(2)).all<any>()).results || [];
  const byPage = new Map<string, any[]>();
  for (const c of open) if (c.target_url && c.target_exists) byPage.set(c.target_url, [...(byPage.get(c.target_url) || []), c]);
  const missing = open.filter((c: any) => c.target_url && !c.target_exists);
  const work = [...byPage.entries()].map(([path, cards]) => ({ path, cards, page: pages.find((p: any) => p.path === path), kind: path.startsWith("/breeds/") ? "Breed guide" : path.startsWith("/statistics/") ? "Dog Data Library" : path.startsWith("/puppy-advice/") ? "Puppy advice" : /^\/(sale|stud)\//.test(path) || path === "/sell-my-puppies" ? "Hub page" : "Page" }))
    .sort((a, b) => b.cards.length - a.cards.length);
  const quiet = pages.filter((p: any) => (p.kind === "advice" || p.kind === "statistics") && !byPage.has(p.path));
  const articles = pages.filter((p: any) => p.kind === "advice" || p.kind === "statistics").length;
  const read = pages[0]?.updated_at;
  const body = `<p class="eyebrow">Coverage · companimal.co.uk</p>
<h1 class="headline">${fmt(missing.length)} ${missing.length === 1 ? "page" : "pages"} to create, ${fmt(work.length)} to improve.</h1>
<p class="lede">Every open move against the site: ${fmt(articles)} articles across puppy advice and the Dog Data Library, ${fmt(breedN?.n)} breed guides and the sale, stud and selling hubs.${read ? ` Pages last read ${esc(ago(read))}${pages[0]?.source === "snapshot" ? " (from the saved inventory: the live sitemap was blocked)" : ""}.` : ""}</p>
<div class="ledger" style="margin-top:28px"><div>
<h3 class="label">Pages that need work</h3>
${work.length ? `<div class="tbl-wrap"><div class="scroll"><table class="stack"><thead><tr><th>Page</th><th>What people are asking for</th></tr></thead><tbody>${work.map((w) => `<tr><td style="min-width:220px"><a class="path" href="${esc(siteUrl(w.path))}" target="_blank" rel="noopener">${esc(w.path)}</a><div class="small muted">${esc(w.kind)}${w.page?.title ? ` · ${esc(w.page.title)}` : ""}</div></td><td>${w.cards.map((c: any) => `<div style="margin:2px 0"><a href="${href(ctx, `/move/${c.id}`)}">${esc(c.headline)}</a> <span class="small muted">${esc(TYPES[c.type]?.short || "")}</span></div>`).join("")}</td></tr>`).join("")}</tbody></table></div></div>` : empty("Nothing to improve right now", "Existing pages appear here when people ask things they don't answer.")}
<h3 class="label" style="margin-top:36px">Pages people are asking for</h3>
${missing.length ? `<div class="tbl-wrap"><div class="scroll"><table class="stack"><thead><tr><th>New page</th><th>Why</th></tr></thead><tbody>${missing.map((c: any) => `<tr><td style="min-width:220px"><span class="path new">${esc(c.target_url)}</span><div class="small muted">${esc(TYPES[c.type]?.label || "")}</div></td><td><a href="${href(ctx, `/move/${c.id}`)}">${esc(c.headline)}</a></td></tr>`).join("")}</tbody></table></div></div>` : empty("None right now", "New pages appear when people keep asking something nothing on the site answers.")}
</div><aside class="aside"><section class="box"><h3>Articles with nothing raised</h3><p class="small muted" style="margin:0 0 8px">${fmt(quiet.length)} of ${fmt(articles)} articles have no open move in the last fortnight.</p><details class="more"><summary>Show them</summary>${quiet.map((p: any) => `<div class="path" style="padding:3px 0">${esc(p.path)}</div>`).join("")}</details></section></aside></div>`;
  return { title: "Coverage", body };
}
