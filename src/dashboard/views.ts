import { PROJECT, TOPICS, LENSES } from "../../config/taxonomy";
import { viewReddit } from "./reddit";
import { Env } from "../lib";
import { risingTopics, opportunities, normQ, RegionFilter, Opportunity, RisingTopic } from "../analysis";
import {
  esc, fmt, pct, topicLabel, sourceLabel, SOURCE_LABELS, dateShort, timeShort, href, keepFilters, questionHref, topicHref, topicTag,
  spark, dailyBars, meter, empty, notice, eyebrow, section, sendButton, segmented, pager, layout, Ctx,
} from "./ui";
import {
  masthead, kpis, queuedSet, queueKey, pipeline, historyDays, questionDetail, mythGroups, topicDetail, seasonality, weekOfYear,
  communities, runs, siteUrlCount,
} from "./data";

const BASELINE_DAYS = 21;
const PER_PAGE = 50;
const int = (v: string | null, d: number, min = 1, max = 100000) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= min ? Math.min(n, max) : d; };
const two = (n: number) => String(n).padStart(2, "0");
const lensName = (lens?: string) => LENSES.find((l) => l.id === lens)?.label;

// ---------- Shared pieces ----------

interface QOpts { start?: number; days?: number; queued: Set<string>; showTopic?: boolean }

function qtable(ctx: Ctx, opps: Opportunity[], o: QOpts) {
  const max = Math.max(1, ...opps.map((x) => x.score));
  const rows = opps.map((x, i) => {
    const link = href(ctx, "/q", { topic: x.topic, q: x.question, days: o.days });
    return `<tr data-row tabindex="0">
<td class="rank">${two((o.start || 0) + i + 1)}</td>
<td class="qcell"><a class="qlink" data-drawer href="${link}">${esc(x.question)}</a><div class="qmeta">${o.showTopic === false ? "" : topicTag(ctx, x.topic)}<span class="d-only">${esc(sourceLabel(x.sources))}</span><span class="m-only">${fmt(x.count)} ${x.count === 1 ? "mention" : "mentions"} · ${fmt(x.engagement)} engagement · score ${x.score.toFixed(1)}</span></div></td>
<td class="num d-only">${fmt(x.count)}</td>
<td class="num d-only">${fmt(x.engagement)}</td>
<td class="covercell">${x.covered ? `<a class="covered" href="${esc(x.covered)}" target="_blank" rel="noopener" title="${esc(x.covered)}">Covered</a>` : `<span class="gap-tag">Gap</span>`}</td>
<td class="num score d-only">${x.score.toFixed(1)}${meter(x.score / max)}</td>
<td class="act">${sendButton(x.topic, x.question, o.queued.has(queueKey(x.topic, x.question)), true)}</td></tr>`;
  }).join("");
  return `<div class="tbl-wrap"><table class="q"><thead><tr><th class="rank" scope="col"><span class="sr">Rank</span></th><th scope="col">Question</th><th class="num d-only" scope="col">Mentions</th><th class="num d-only" scope="col">Engagement</th><th scope="col">On site</th><th class="num d-only" scope="col">Score</th><th scope="col"><span class="sr">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

const changeText = (r: RisingTopic) => {
  if (!r.baselineReady) return `<span class="muted"><span class="d-only">Baseline building</span><span class="m-only">Building</span></span>`;
  const up = r.ratio >= 1.15, down = r.ratio <= 0.85;
  return `<span class="${up ? "up" : "down"}">${up ? "▲ " : down ? "▼ " : ""}×${r.ratio.toFixed(1)}</span>`;
};

function baselineNotice(h: { first: string | null; days: number }) {
  const day = Math.min(h.days, BASELINE_DAYS);
  const on = h.first ? dateShort(new Date(Date.parse(h.first + "T00:00:00Z") + BASELINE_DAYS * 86400000).toISOString()) : "";
  return notice(`<div class="progress"><span>${h.first ? `Day ${day} of ${BASELINE_DAYS}.` : "No history yet."} Growth ratios compare each topic with its own 4-week average and start ${on ? `on <b>${esc(on)}</b>` : "after 3 weeks"}. Until then topics are ranked by this week's volume.</span>${meter(day / BASELINE_DAYS, `${day} of ${BASELINE_DAYS} days of history`)}</div>`);
}

// ---------- Today ----------

async function today(env: Env, ctx: Ctx, mh: Awaited<ReturnType<typeof masthead>>) {
  const brief = await env.DB.prepare(`SELECT body_json, date, model FROM briefs WHERE project=?1 ORDER BY date DESC LIMIT 1`).bind(PROJECT.id).first<any>();
  const b = brief ? JSON.parse(brief.body_json) : null;
  const [k, rising, opps14, queued, pipe, myths] = await Promise.all([
    kpis(env, ctx.region, ctx.lens), risingTopics(env, ctx.lens, ctx.region), opportunities(env, 14, ctx.lens, 500, ctx.region),
    queuedSet(env), pipeline(env, 5, 0), mythGroups(env, ctx.lens, ctx.region, undefined, 30),
  ]);
  const unanswered = opps14.filter((o) => !o.covered);
  const findOpp = (topic: string, q: string) => opps14.find((o) => o.topic === topic && normQ(o.question) === normQ(q));

  // Brief ideas, narrowed to the chosen audience's topics
  let ideas: { title: string; topic: string; why: string; questions: string[] }[] = (b?.ideas || []).filter((i: any) => i && i.title);
  let filtered = false;
  let fromBrief = ideas.length > 0;
  if (ctx.lens && ideas.length) {
    const kept = ideas.filter((i) => TOPICS.find((t) => t.id === i.topic)?.lens.includes(ctx.lens as any));
    filtered = kept.length !== ideas.length; ideas = kept;
  }
  if (!ideas.length) { fromBrief = false; } 
  if (!ideas.length) ideas = unanswered.slice(0, 5).map((o) => ({ title: o.question, topic: o.topic, why: `${fmt(o.count)} mentions and ${fmt(o.engagement)} engagement in 14 days; nothing on the site answers it yet.`, questions: [o.question] }));

  const issues = mh.issues.length ? `<div class="alert" role="status"><b>${mh.issues.length} collection ${mh.issues.length === 1 ? "issue" : "issues"} in the last day.</b> Data may be thin until they clear. <a href="${href(ctx, "/sources")}#runs">Run log</a><ul>${mh.issues.map((i) => `<li><b>${esc(i.job)}</b>: ${esc(i.problem)}</li>`).join("")}</ul></div>` : "";
  const headMeta = brief ? `Brief for ${esc(dateShort(brief.date))} · ${brief.model === "rules" ? "rules-based" : "AI-written"}${filtered ? ` · ${esc(lensName(ctx.lens))} topics only` : ""}` : "No brief yet";

  let hero = "";
  const lead = ideas[0];
  if (lead) {
    const m = findOpp(lead.topic, lead.questions?.[0] || lead.title) || findOpp(lead.topic, lead.title);
    const sendQ = lead.title;
    const leadPosts = m ? (await questionDetail(env, m.topic, m.question, 14, ctx.lens, ctx.region)).posts : [];
    const where = new Map<string, number>();
    for (const p of leadPosts) { const c = p.community || SOURCE_LABELS[p.source] || p.source; where.set(c, (where.get(c) || 0) + 1); }
    const askedIn = [...where.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const said = leadPosts.filter((p) => (p.text || p.title || "").length > 20 && normQ(p.text || p.title || "") !== normQ(m!.question)).slice(0, 2);
    const qs = (lead.questions || []).slice(0, 4);
    hero = `<article class="panel hero c-7" aria-labelledby="lead">
<div>${eyebrow(fromBrief ? "Lead idea" : "Top unanswered question")}${topicTag(ctx, lead.topic)}</div>
<h2 id="lead">${m ? `<a data-drawer href="${href(ctx, "/q", { topic: m.topic, q: m.question, days: 14 })}">${esc(lead.title)}</a>` : esc(lead.title)}</h2>
<p class="why">${esc(lead.why)}</p>
${qs.length && !(qs.length === 1 && normQ(qs[0]) === normQ(lead.title)) ? `<div><p class="eyebrow">Answer these as H2s</p><ol class="h2list">${qs.map((q, i) => `<li><span>H2·${i + 1}</span>${esc(q)}</li>`).join("")}</ol></div>` : ""}
${said.length ? `<div><p class="eyebrow">In their words</p><ul class="quotes">${said.map((p) => `<li>${esc((p.text || p.title || "").slice(0, 200))}${(p.text || "").length > 200 ? "…" : ""}<span>${esc(p.community || SOURCE_LABELS[p.source] || p.source)} · ${esc(SOURCE_LABELS[p.source] || p.source)}${p.engagement ? ` · ${fmt(p.engagement)} engagement` : ""}</span></li>`).join("")}</ul></div>` : ""}
${askedIn.length ? `<div><p class="eyebrow">Asked in</p><div class="qmeta" style="margin:0">${askedIn.map(([c, n]) => `<span class="tag">${esc(c)} <span class="muted">· ${n}</span></span>`).join("")}</div></div>` : ""}
<div class="hero-foot">${m ? `<dl class="stats"><div><dt>Mentions</dt><dd>${fmt(m.count)}</dd></div><div><dt>Engagement</dt><dd>${fmt(m.engagement)}</dd></div><div><dt>Sources</dt><dd>${m.sources.split(", ").length}</dd></div><div><dt>Score</dt><dd>${m.score.toFixed(1)}</dd></div></dl>` : `<span></span>`}
<div class="actions" style="display:flex;gap:10px;align-items:center">${sendButton(lead.topic, sendQ, queued.has(queueKey(lead.topic, sendQ)))}</div></div>
</article>`;
  }
  const rest = ideas.slice(1, 5);
  const queue = `<section class="panel queue c-5" aria-label="More ideas">${eyebrow(fromBrief ? "Also in today's brief" : "Next in line")}${rest.length ? `<ol>${rest.map((i, n) => {
    const m = findOpp(i.topic, i.questions?.[0] || i.title) || findOpp(i.topic, i.title);
    return `<li><span class="n">${two(n + 2)}</span><div>${m ? `<a class="t" data-drawer href="${href(ctx, "/q", { topic: m.topic, q: m.question, days: 14 })}">${esc(i.title)}</a>` : `<a class="t" href="${topicHref(ctx, i.topic)}">${esc(i.title)}</a>`}<p>${esc(topicLabel(i.topic))} · ${esc(i.why)}</p></div></li>`;
  }).join("")}</ol>` : `<p class="muted" style="margin:12px 0 0">Nothing else in the brief for this audience.</p>`}</section>`;

  const week = k?.week || 0, prev = k?.prevweek || 0;
  const kpiStrip = `<div class="kpis">
<div><div class="v">${fmt(k?.total)}</div><div class="l">Posts archived</div><div class="s">${k?.irrelevant ? `${fmt(k.irrelevant)} off-topic hidden` : "Every post kept"}</div></div>
<div><div class="v">${fmt(week)}</div><div class="l">Collected, 7 days</div><div class="s">${prev ? `${week >= prev ? "Up" : "Down"} ${Math.abs(pct(week - prev, prev))}% on the week before` : "First week of collection"}</div></div>
<div><div class="v">${fmt(k?.questions)}</div><div class="l">Questions extracted</div><div class="s">${ctx.region === "uk" ? "UK and unsure" : "All regions"}${ctx.lens ? `, ${esc(lensName(ctx.lens)?.toLowerCase())}` : ""}</div></div>
<div><div class="v">${pct(k?.uk || 0, k?.tagged || 0)}%</div><div class="l">Clearly from the UK</div><div class="s">Of ${fmt(k?.tagged)} tagged posts</div></div>
</div>`;

  const top = rising.slice(0, 6);
  const strip = top.length ? `<div class="strip">${top.map((r) => `<a href="${topicHref(ctx, r.topic)}"><span class="t">${esc(r.label)}</span><span class="m"><span><b>${fmt(r.last7)}</b> this week</span>${changeText(r)}</span>${spark(r.spark, 160, 34, `${r.label}: daily mentions over 35 days`)}</a>`).join("")}</div>` : empty("No topic history yet", "Rising topics appear after the first daily rollup.");

  const mythList = myths.slice(0, 3);
  const bottom = `<div class="bento" style="margin-top:8px">
<section class="c-6">${section("Claims to fact-check", `<a href="${href(ctx, "/myths")}">All myths</a>`)}${mythList.length ? `<div class="myth-teaser">${mythList.map((m, i) => `<div class="myth"><span class="rank">${two(i + 1)}</span><div><p class="claim">${esc(m.claim)}</p><div class="qmeta">${topicTag(ctx, m.topic)}<span>Seen ${fmt(m.count)} ${m.count === 1 ? "time" : "times"} in 30 days</span></div></div></div>`).join("")}</div>` : empty("No myths in the last 30 days")}</section>
<section class="c-6">${section("Recently sent to the pipeline", `<a href="${href(ctx, "/pipeline")}">Pipeline</a>`)}${pipe.rows.length ? `<ul class="list">${pipe.rows.map((p: any) => `<li class="post"><div class="post-h"><span class="mono">${esc(timeShort(p.created_at))}</span>${topicTag(ctx, p.topic)}</div><a class="qlink" data-drawer href="${href(ctx, "/q", { topic: p.topic, q: p.question || "" })}">${esc(p.question || topicLabel(p.topic))}</a></li>`).join("")}</ul>` : empty("Nothing sent yet", "Press <kbd>s</kbd> on a question, or use Send to pipeline, to queue it for the Content Ledger.")}</section>
</div>`;

  const body = `${issues}<div class="page-head"><div>${eyebrow(headMeta)}<h1>What to write next</h1></div></div>
<div class="bento">${hero || `<div class="c-12">${empty("No questions yet", "They appear after the first collection and analysis runs. The first brief is written after a full day of collection.")}</div>`}${hero ? queue : ""}</div>
${kpiStrip}
${section("Rising this week", `<a href="${href(ctx, "/rising")}">All topics</a>`)}${top.length && !top[0].baselineReady ? `<p class="hint" style="margin:-4px 0 12px">Ranked by volume until there are ${BASELINE_DAYS} days of history.</p>` : ""}${strip}
${section("Top unanswered questions", `Last 14 days · <a href="${href(ctx, "/questions", { status: "gaps", days: 30 })}">Question bank</a>`)}${unanswered.length ? qtable(ctx, unanswered.slice(0, 8), { queued, days: 14 }) : empty("Every question from the last 14 days is covered", "Or nothing has been collected yet for this filter.")}
${bottom}`;
  return { title: "Today", body };
}

// ---------- Question bank ----------

async function questions(env: Env, ctx: Ctx, url: URL) {
  const topic = url.searchParams.get("topic") || "";
  const q = (url.searchParams.get("q") || "").trim();
  const days = [7, 30, 90, 365].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 90;
  const status = ["gaps", "covered"].includes(url.searchParams.get("status") || "") ? url.searchParams.get("status")! : "";
  const sort = ["mentions", "engagement"].includes(url.searchParams.get("sort") || "") ? url.searchParams.get("sort")! : "";
  const [all, queued] = await Promise.all([opportunities(env, days, ctx.lens, 5000, ctx.region), queuedSet(env)]);
  let opps = all;
  if (topic) opps = opps.filter((o) => o.topic === topic);
  if (q) { const n = q.toLowerCase(); opps = opps.filter((o) => o.question.toLowerCase().includes(n)); }
  const gaps = opps.filter((o) => !o.covered).length;
  if (status === "gaps") opps = opps.filter((o) => !o.covered);
  if (status === "covered") opps = opps.filter((o) => o.covered);
  if (sort === "mentions") opps = [...opps].sort((a, b) => b.count - a.count || b.score - a.score);
  if (sort === "engagement") opps = [...opps].sort((a, b) => b.engagement - a.engagement || b.score - a.score);
  const pages = Math.max(1, Math.ceil(opps.length / PER_PAGE));
  const page = Math.min(int(url.searchParams.get("page"), 1), pages);
  const slice = opps.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const params = { q, topic, days, status, sort };
  const opt = (v: string | number, label: string, cur: string | number) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label)}</option>`;
  const toolbar = `<form class="toolbar" method="get" action="/questions" data-auto role="search">${keepFilters(ctx)}
<label class="field search"><span class="sr">Search questions</span><input name="q" value="${esc(q)}" placeholder="Search questions" autocomplete="off"><kbd>/</kbd></label>
<label class="field"><span class="sr">Topic</span><select name="topic">${opt("", "All topics", topic)}${TOPICS.map((t) => opt(t.id, t.label, topic)).join("")}</select></label>
<label class="field"><span class="sr">Period</span><select name="days">${[7, 30, 90, 365].map((d) => opt(d, d === 365 ? "Last 12 months" : `Last ${d} days`, days)).join("")}</select></label>
<label class="field"><span class="sr">Coverage</span><select name="status">${opt("", "Gaps and covered", status)}${opt("gaps", "Gaps only", status)}${opt("covered", "Covered only", status)}</select></label>
<label class="field"><span class="sr">Sort</span><select name="sort">${opt("", "Sort by score", sort)}${opt("mentions", "Sort by mentions", sort)}${opt("engagement", "Sort by engagement", sort)}</select></label>
<button class="btn-line">Apply</button></form>`;
  const filteredOut = (q || topic || status) ? ` <a href="${href(ctx, "/questions", { days })}">Clear filters</a>` : "";
  const body = `<div class="page-head"><div>${eyebrow(`Last ${days === 365 ? "12 months" : `${days} days`}`)}<h1>Question bank</h1><p class="lede">${!all.length ? "Nothing extracted for this period and filter yet." : `${fmt(opps.length)} grouped ${opps.length === 1 ? "question" : "questions"}${status ? "" : `, ${fmt(gaps)} not answered on companimal.co.uk`}. Gaps score higher; growing topics get a boost.`}${filteredOut}</p></div></div>
${toolbar}
${slice.length ? qtable(ctx, slice, { start: (page - 1) * PER_PAGE, queued, days }) : empty(q ? `Nothing matches “${q}”` : "No questions for this filter", q || topic || status ? "Try a longer period or clear the filters." : "Questions appear after the first collection and analysis runs.")}
${pager(ctx, "/questions", params, page, opps.length, PER_PAGE)}
<p class="hint d-only"><span><kbd>j</kbd> <kbd>k</kbd> move</span><span><kbd>o</kbd> open</span><span><kbd>s</kbd> send to pipeline</span><span><kbd>/</kbd> search</span></p>`;
  return { title: "Question bank", body };
}

// ---------- Question detail (page and drawer fragment) ----------

async function questionDetailHtml(env: Env, ctx: Ctx, url: URL, partial: boolean) {
  const topic = url.searchParams.get("topic") || "";
  const qtext = url.searchParams.get("q") || "";
  const days = int(url.searchParams.get("days"), 90, 1, 3650);
  if (!topic || !qtext) return null;
  const [d, queued] = await Promise.all([questionDetail(env, topic, qtext, days, ctx.lens, ctx.region), queuedSet(env)]);
  const s = d.self;
  const sources = [...new Set(d.posts.map((p) => p.source))];
  const shown = d.posts.slice(0, 40);
  const html = `<div class="detail">
<div>${topicTag(ctx, topic)}</div>
<h2 class="q">${esc(d.question)}</h2>
<dl class="stats"><div><dt>Mentions</dt><dd>${fmt(d.posts.length)}</dd></div><div><dt>Engagement</dt><dd>${fmt(d.posts.reduce((a, p) => a + (p.engagement || 0), 0))}</dd></div><div><dt>Sources</dt><dd>${sources.length}</dd></div>${s ? `<div><dt>Score</dt><dd>${s.score.toFixed(1)}</dd></div>` : ""}</dl>
<div class="actions">${sendButton(topic, d.question, queued.has(queueKey(topic, d.question)))}${partial ? `<a class="btn-line" href="${href(ctx, "/q", { topic, q: d.question, days })}">Open as page</a>` : ""}<a class="btn-quiet" href="${topicHref(ctx, topic)}">${esc(topicLabel(topic))} topic</a></div>
<div class="block"><h3>On companimal.co.uk</h3><div class="cover">${d.covered ? `<span class="covered">Covered</span><a href="${esc(d.covered)}" target="_blank" rel="noopener">${esc(d.covered.replace(/^https?:\/\/(www\.)?/, ""))}</a>` : `<span class="gap-tag">Gap</span><span>No Companimal page answers this yet.</span>`}</div></div>
${d.related.length ? `<div class="block"><h3>Related questions, H2 candidates</h3><ol class="h2list">${d.related.map((r, i) => `<li><span>${two(i + 1)}</span><a data-drawer href="${href(ctx, "/q", { topic, q: r.question, days })}">${esc(r.question)}</a></li>`).join("")}</ol></div>` : ""}
<div class="block"><h3>Where it was asked${d.first ? ` · ${d.first === d.last ? esc(dateShort(d.first)) : `${esc(dateShort(d.first))} to ${esc(dateShort(d.last))}`}` : ""}</h3>
${shown.length ? `<ul class="list">${shown.map((p) => {
    const title = p.title && p.title !== p.text ? p.title : "";
    const text = (p.text || "").slice(0, 280);
    return `<li class="post"><div class="post-h"><b>${esc(p.community || SOURCE_LABELS[p.source] || p.source)}</b><span>${esc(SOURCE_LABELS[p.source] || p.source)}</span><span class="mono">${esc(dateShort(p.collected_date))}</span>${p.engagement ? `<span>${fmt(p.engagement)} engagement</span>` : ""}${p.region === "non_uk" ? `<span class="tag">Not UK</span>` : ""}</div>${title ? `<p><b>${esc(title.slice(0, 160))}</b></p>` : ""}${text ? `<p>${esc(text)}${(p.text || "").length > 280 ? "…" : ""}</p>` : ""}${p.url ? `<a class="out" href="${esc(p.url)}" target="_blank" rel="noopener">Open post ↗</a>` : ""}</li>`;
  }).join("")}</ul>${d.posts.length > shown.length ? `<p class="muted">And ${fmt(d.posts.length - shown.length)} more, showing the most engaged.</p>` : ""}` : `<p class="muted">No posts in the last ${days} days for this filter. Try All regions or All audiences.</p>`}</div>
</div>`;
  if (partial) return { partial: html };
  return { title: d.question, body: `<a class="back" href="${href(ctx, "/questions")}">← Question bank</a><div class="panel" style="padding:28px 30px;max-width:880px">${html}</div>` };
}

// ---------- Rising ----------

async function rising(env: Env, ctx: Ctx) {
  const [rows, h] = await Promise.all([risingTopics(env, ctx.lens, ctx.region), historyDays(env)]);
  const ready = rows[0]?.baselineReady ?? h.days >= BASELINE_DAYS;
  const body = `<div class="page-head"><div>${eyebrow("Last 7 days against each topic's own 4-week average")}<h1>Rising topics</h1><p class="lede">What people are talking about more than usual. Open a topic for its trend, questions and best communities.</p></div></div>
${ready ? "" : baselineNotice(h)}
${rows.length ? `<div class="tbl-wrap scroll"><table><thead><tr><th class="rank"><span class="sr">Rank</span></th><th>Topic</th><th class="num">This week</th><th class="num d-only">Weekly average</th><th class="num">Change</th><th>35 days</th></tr></thead><tbody>
${rows.map((r, i) => `<tr><td class="rank">${two(i + 1)}</td><td class="name"><a class="qlink" href="${topicHref(ctx, r.topic)}">${esc(r.label)}</a></td><td class="num">${fmt(r.last7)}</td><td class="num d-only">${r.baselineReady ? fmt(Math.round(r.prior28 / 4)) : `<span class="muted">Not yet</span>`}</td><td class="num">${changeText(r)}</td><td class="sparkcell" style="width:220px;min-width:140px">${spark(r.spark, 200, 30, `${r.label}: daily mentions over 35 days`)}</td></tr>`).join("")}
</tbody></table></div>` : empty("No topic history yet", "Topics appear after the first daily rollup.")}`;
  return { title: "Rising topics", body };
}

// ---------- Topic page ----------

async function topicPage(env: Env, ctx: Ctx, id: string) {
  const t = TOPICS.find((x) => x.id === id);
  if (!t) return null;
  const [d, opps, myths, queued] = await Promise.all([topicDetail(env, id, ctx.lens, ctx.region, 90), opportunities(env, 90, ctx.lens, 5000, ctx.region), mythGroups(env, ctx.lens, ctx.region, id, 365), queuedSet(env)]);
  const qs = opps.filter((o) => o.topic === id);
  const last7 = d.series.slice(-7).reduce((a, x) => a + x.n, 0);
  const total = d.series.reduce((a, x) => a + x.n, 0);
  const covered = qs.filter((o) => o.covered).length;
  const kindTotal = d.kinds.reduce((a: number, k: any) => a + k.n, 0);
  const KIND: Record<string, string> = { question: "Questions", problem: "Problems", recommendation: "Recommendations", myth: "Myths", story: "First-hand stories", opinion: "Opinions", other: "Other" };
  const body = `<a class="back" href="${href(ctx, "/rising")}">← Rising topics</a>
<div class="page-head"><div>${eyebrow(`Topic · ${t.lens.map((l) => lensName(l)).join(", ")}`)}<h1>${esc(t.label)}</h1></div><a class="btn-line" href="${href(ctx, "/questions", { topic: id })}">Open in question bank</a></div>
<div class="kpis" style="margin-top:0"><div><div class="v">${fmt(last7)}</div><div class="l">Mentions, 7 days</div></div><div><div class="v">${fmt(total)}</div><div class="l">Mentions, 90 days</div></div><div><div class="v">${fmt(qs.length)}</div><div class="l">Question clusters</div></div><div><div class="v">${pct(covered, qs.length)}%</div><div class="l">Covered on site</div><div class="s">${fmt(qs.length - covered)} gaps</div></div></div>
${section("Daily mentions", "Last 90 days")}<div class="panel" style="padding:18px 18px 12px">${total ? dailyBars(d.series) : empty("No mentions in the last 90 days for this filter")}</div>
<div class="split" style="margin-top:8px"><div>${section("Top questions", `<a href="${href(ctx, "/questions", { topic: id })}">All ${fmt(qs.length)}</a>`)}${qs.length ? qtable(ctx, qs.slice(0, 15), { queued, days: 90, showTopic: false }) : empty("No questions yet for this topic")}
${section("Myths and claims")}${myths.length ? myths.slice(0, 5).map((m, i) => `<div class="myth"><span class="rank">${two(i + 1)}</span><div><p class="claim">${esc(m.claim)}</p><div class="qmeta"><span>Seen ${fmt(m.count)} ${m.count === 1 ? "time" : "times"}</span><span class="mono">Last ${esc(dateShort(m.last))}</span></div></div><div class="side">${sendButton(m.topic, m.claim, queued.has(queueKey(m.topic, m.claim)), true)}</div></div>`).join("") : `<p class="muted">No myths detected for this topic.</p>`}</div>
<aside class="side">${section("Best communities", "90 days")}${d.comm.length ? `<ul class="list">${d.comm.map((c: any) => `<li><div class="post-h" style="justify-content:space-between"><b>${esc(c.community || SOURCE_LABELS[c.source] || c.source)}</b><span>${fmt(c.n)} ${c.n === 1 ? "post" : "posts"}</span></div><div class="post-h" style="justify-content:space-between;margin-top:4px"><span>${esc(SOURCE_LABELS[c.source] || c.source)}</span><span>${pct(c.q, c.n)}% questions</span></div>${meter(c.q / Math.max(1, c.n), `${fmt(c.q)} of ${fmt(c.n)} posts are questions`)}</li>`).join("")}</ul>` : `<p class="muted">No posts yet.</p>`}
${section("What people post")}${d.kinds.length ? `<ul class="list">${d.kinds.map((k: any) => `<li><div class="post-h" style="justify-content:space-between"><b>${esc(KIND[k.kind] || k.kind)}</b><span>${fmt(k.n)} · ${pct(k.n, kindTotal)}%</span></div>${meter(k.n / Math.max(1, kindTotal))}</li>`).join("")}</ul>` : `<p class="muted">No posts yet.</p>`}</aside></div>`;
  return { title: t.label, body };
}

// ---------- Gaps ----------

async function gapsView(env: Env, ctx: Ctx) {
  const [opps, urls, queued] = await Promise.all([opportunities(env, 90, ctx.lens, 5000, ctx.region), siteUrlCount(env), queuedSet(env)]);
  const byTopic = new Map<string, { total: number; gaps: number; score: number }>();
  for (const o of opps) {
    const t = byTopic.get(o.topic) || { total: 0, gaps: 0, score: 0 };
    t.total++; if (!o.covered) { t.gaps++; t.score += o.score; }
    byTopic.set(o.topic, t);
  }
  const rows = [...byTopic.entries()].sort((a, b) => b[1].score - a[1].score);
  const maxScore = Math.max(1, ...rows.map(([, v]) => v.score));
  const gapList = opps.filter((o) => !o.covered);
  const covered = opps.length - gapList.length;
  const body = `<div class="page-head"><div>${eyebrow("Last 90 days")}<h1>Content gaps</h1><p class="lede">Question clusters matched against Companimal's content pages from the sitemap. Topics are ranked by the total score of their unanswered questions.</p></div></div>
${urls ? "" : notice("The sitemap hasn't been read yet, so every question shows as a gap. It refreshes every Monday.")}
<div class="kpis" style="margin-top:0"><div><div class="v">${fmt(urls)}</div><div class="l">Companimal content pages</div></div><div><div class="v">${fmt(opps.length)}</div><div class="l">Question clusters</div></div><div><div class="v">${pct(covered, opps.length)}%</div><div class="l">Answered on site</div></div><div><div class="v">${fmt(gapList.length)}</div><div class="l">Open gaps</div></div></div>
${section("Coverage by topic")}${rows.length ? `<div class="tbl-wrap scroll"><table><thead><tr><th>Topic</th><th class="num d-only">Clusters</th><th class="num">Gaps</th><th>Coverage</th><th class="num d-only">Gap score</th></tr></thead><tbody>${rows.map(([t, v]) => `<tr><td class="name"><a class="qlink" href="${topicHref(ctx, t)}">${esc(topicLabel(t))}</a></td><td class="num d-only">${fmt(v.total)}</td><td class="num"><a href="${href(ctx, "/questions", { topic: t, status: "gaps" })}">${fmt(v.gaps)}</a></td><td style="min-width:160px"><div style="display:flex;gap:10px;align-items:center">${meter((v.total - v.gaps) / v.total, `${fmt(v.total - v.gaps)} of ${fmt(v.total)} covered`)}<span>${pct(v.total - v.gaps, v.total)}%</span></div></td><td class="num score d-only">${fmt(Math.round(v.score))}${meter(v.score / maxScore)}</td></tr>`).join("")}</tbody></table></div>` : empty("No question clusters yet")}
${section("Biggest gaps", `<a href="${href(ctx, "/questions", { status: "gaps" })}">All ${fmt(gapList.length)} gaps</a>`)}${gapList.length ? qtable(ctx, gapList.slice(0, 25), { queued, days: 90 }) : empty("No open gaps", "Every question cluster in the last 90 days has a matching page.")}`;
  return { title: "Content gaps", body };
}

// ---------- Myths ----------

async function mythsView(env: Env, ctx: Ctx, url: URL) {
  const topic = url.searchParams.get("topic") || "";
  const [all, queued] = await Promise.all([mythGroups(env, ctx.lens, ctx.region, undefined, 365), queuedSet(env)]);
  const topicsWith = [...new Set(all.map((m) => m.topic))];
  const list = topic ? all.filter((m) => m.topic === topic) : all;
  const per = 25, pages = Math.max(1, Math.ceil(list.length / per));
  const page = Math.min(int(url.searchParams.get("page"), 1), pages);
  const slice = list.slice((page - 1) * per, page * per);
  const chips = topicsWith.length > 1 ? `<div class="toolbar">${segmented("Topic", [{ href: href(ctx, "/myths"), label: "All topics", on: !topic }, ...TOPICS.filter((t) => topicsWith.includes(t.id)).map((t) => ({ href: href(ctx, "/myths", { topic: t.id }), label: t.label, on: topic === t.id }))])}</div>` : "";
  const body = `<div class="page-head"><div>${eyebrow("Last 12 months")}<h1>Myths and claims</h1><p class="lede">Beliefs owners repeat that may not be true. Each is a candidate for a Dog Data Library article that sets the record straight with data.</p></div></div>
${chips}
${slice.length ? `<div>${slice.map((m, i) => `<article class="myth"><span class="rank">${two((page - 1) * per + i + 1)}</span><div><p class="claim">${esc(m.claim)}</p><div class="qmeta">${topicTag(ctx, m.topic)}<span>Seen ${fmt(m.count)} ${m.count === 1 ? "time" : "times"}</span>${m.engagement ? `<span>${fmt(m.engagement)} engagement</span>` : ""}<span class="mono">${m.first === m.last ? esc(dateShort(m.last)) : `${esc(dateShort(m.first))} to ${esc(dateShort(m.last))}`}</span></div>
<details class="more" style="margin-top:8px"><summary>Where it was said</summary><ul class="list">${m.posts.map((p: any) => `<li class="post"><div class="post-h"><b>${esc(p.community || SOURCE_LABELS[p.source] || p.source)}</b><span>${esc(SOURCE_LABELS[p.source] || p.source)}</span><span class="mono">${esc(dateShort(p.collected_date))}</span></div>${p.text ? `<p>${esc(String(p.text).slice(0, 260))}</p>` : ""}${p.url ? `<a class="out" href="${esc(p.url)}" target="_blank" rel="noopener">Open post ↗</a>` : ""}</li>`).join("")}</ul></details></div>
<div class="side">${sendButton(m.topic, m.claim, queued.has(queueKey(m.topic, m.claim)), true)}</div></article>`).join("")}</div>` : empty("No myths detected yet", "Posts that repeat a doubtful belief show up here once they're analysed.")}
${pager(ctx, "/myths", { topic }, page, list.length, per)}`;
  return { title: "Myths and claims", body };
}

// ---------- Seasonality ----------

const HEAT = ["#E4EBE5", "#BCCDC1", "#8DA898", "#5E7E6B", "#2F4A3A"]; // forest, light to dark

async function seasonalityView(env: Env, ctx: Ctx) {
  const s = await seasonality(env, ctx.lens, ctx.region);
  const nowWeek = weekOfYear(new Date().toISOString().slice(0, 10));
  const full = s.first ? dateShort(new Date(Date.parse(s.first + "T00:00:00Z") + 365 * 86400000).toISOString()) : "";
  const rows = [...s.topics].sort((a, b) => b.total - a.total);
  const monthStarts = [[1, "Jan"], [5, "Feb"], [9, "Mar"], [14, "Apr"], [18, "May"], [22, "Jun"], [27, "Jul"], [31, "Aug"], [36, "Sep"], [40, "Oct"], [44, "Nov"], [48, "Dec"]] as const;
  const header = `<span></span>${Array.from({ length: 53 }, (_, i) => { const m = monthStarts.find(([w]) => w === i + 1); return `<span class="cl">${m ? m[1] : ""}</span>`; }).join("")}`;
  const grid = rows.map((t) => {
    const max = Math.max(0, ...t.weeks.map((v) => v || 0));
    return `<span class="rl"><a href="${topicHref(ctx, t.id)}">${esc(t.label)}</a></span>${t.weeks.map((v, i) => {
      const w = i + 1, now = w === nowWeek ? " now" : "";
      if (v === null) return `<span class="cell none${now}" data-tip="Week ${w}: not collected yet"></span>`;
      const level = max ? Math.min(4, Math.floor((v / max) * 4.999)) : 0;
      return `<span class="cell${now}" style="background:${v ? HEAT[level] : "var(--well-2)"}" data-tip="${esc(`${t.label}, week ${w}: ${fmt(Math.round(v))} mentions${v && max ? `, ${pct(v, max)}% of its busiest week` : ""}`)}"></span>`;
    }).join("")}`;
  }).join("");
  const body = `<div class="page-head"><div>${eyebrow("Mentions by week of the year")}<h1>Seasonality</h1><p class="lede">When each topic peaks across the year, so articles can go live before demand does. Each row is shaded against that topic's own busiest week.</p></div></div>
${notice(`<div class="progress"><span><b>${s.weeksCollected} of 52 weeks</b> collected. Seasonal patterns become reliable after 12 months${full ? `, from <b>${esc(full)}</b>` : ""}; until then the grid fills in week by week, and year-on-year comparison follows in year two.</span>${meter(s.weeksCollected / 52, `${s.weeksCollected} of 52 weeks`)}</div>`)}
${s.weeksCollected ? `<div class="panel scroll heatwrap" style="padding:18px" data-scroll-now><div class="heat" role="img" aria-label="Weekly mentions per topic across the year">${header}${grid}</div></div>
<div class="legend"><span><i style="border:1px dashed var(--rule)"></i>Not collected yet</span><span><i style="background:var(--well-2)"></i>No mentions</span>${HEAT.map((c, i) => `<span><i style="background:${c}"></i>${["Quiet", "", "", "", "Busiest week"][i] || ""}</span>`).join("")}<span><i style="outline:1.5px solid var(--ink);outline-offset:-1.5px"></i>This week (week ${nowWeek})</span></div>` : empty("No weekly history yet", "The grid starts filling in after the first daily rollup.")}`;
  return { title: "Seasonality", body };
}

// ---------- Pipeline ----------

async function pipelineView(env: Env, ctx: Ctx, url: URL) {
  const page = int(url.searchParams.get("page"), 1);
  const p = await pipeline(env, PER_PAGE, (page - 1) * PER_PAGE);
  const body = `<div class="page-head"><div>${eyebrow(`${fmt(p.total)} queued`)}<h1>Pipeline</h1><p class="lede">Questions and claims sent from this dashboard, ready to feed the Content Ledger. Newest first.</p></div></div>
${p.rows.length ? `<div class="tbl-wrap scroll"><table><thead><tr><th>Sent</th><th>Question or claim</th><th class="d-only">Topic</th><th>Status</th></tr></thead><tbody>${p.rows.map((r: any) => `<tr><td class="mono" style="white-space:nowrap">${esc(timeShort(r.created_at))}</td><td><a class="qlink" data-drawer href="${href(ctx, "/q", { topic: r.topic, q: r.question || "" })}">${esc(r.question || topicLabel(r.topic))}</a></td><td class="d-only">${topicTag(ctx, r.topic)}</td><td>${r.status === "queued" ? `<span class="stamp" style="transform:none">Queued</span>` : `<span class="tag">${esc(r.status)}</span>`}</td></tr>`).join("")}</tbody></table></div>` : empty("Nothing in the pipeline yet", "Use Send to pipeline on any question, or press <kbd>s</kbd> on a focused row in the question bank.")}
${pager(ctx, "/pipeline", {}, page, p.total, PER_PAGE)}`;
  return { title: "Pipeline", body };
}

// ---------- Sources ----------

async function sourcesView(env: Env, ctx: Ctx, url: URL) {
  const rpage = int(url.searchParams.get("runs"), 1);
  const per = 40;
  const [comm, chans, r] = await Promise.all([
    communities(env, ctx.lens, 30),
    env.DB.prepare(`SELECT name, title, status FROM yt_channels ORDER BY status, name`).all<any>().then((x) => x.results || []),
    runs(env, per, (rpage - 1) * per),
  ]);
  const maxQ = Math.max(1, ...comm.map((c: any) => c.q / Math.max(1, c.n)));
  const found = chans.filter((c: any) => c.status === "ok").length;
  const body = `<div class="page-head"><div>${eyebrow("Collection health and spend")}<h1>Sources and coverage</h1><p class="lede">Which communities produce the most questions, and whether every collector ran.</p></div></div>
<div class="kpis" style="margin-top:0"><div><div class="v">$${(r.cost?.c30 || 0).toFixed(2)}</div><div class="l">Spend, 30 days</div><div class="s">$${(r.cost?.c7 || 0).toFixed(2)} in the last 7</div></div><div><div class="v">${fmt(r.cost?.n)}</div><div class="l">Runs, 30 days</div></div><div><div class="v">${fmt(r.cost?.errors)}</div><div class="l">Failed runs</div><div class="s">${r.cost?.errors ? `<a href="#runs">See the run log</a>` : "None in 30 days"}</div></div><div><div class="v">${found}/${chans.length}</div><div class="l">UK YouTube channels found</div></div></div>
${section("Top communities", `Last 30 days${ctx.lens ? `, ${esc(lensName(ctx.lens)?.toLowerCase())}` : ""} · region shares shown as columns`)}
${comm.length ? `<div class="tbl-wrap scroll"><table><thead><tr><th>Community</th><th class="num">Posts</th><th class="num">Questions</th><th>Question rate</th><th class="num">UK</th><th class="num">Not UK</th><th class="num">Off-topic</th><th class="num">Engagement</th></tr></thead><tbody>${comm.map((c: any) => `<tr><td class="name"><b style="font-weight:600">${esc(c.community || "Unknown")}</b><div class="muted" style="font-size:12.5px">${esc(sourceLabel(c.source))}</div></td><td class="num">${fmt(c.n)}</td><td class="num">${fmt(c.q)}</td><td style="min-width:150px"><div style="display:flex;gap:10px;align-items:center">${meter((c.q / Math.max(1, c.n)) / maxQ, `${pct(c.q, c.n)}% of posts are questions`)}<span>${pct(c.q, c.n)}%</span></div></td><td class="num">${pct(c.uk || 0, c.n)}%</td><td class="num">${pct(c.nonuk || 0, c.n)}%</td><td class="num">${pct(c.offtopic || 0, c.n)}%</td><td class="num">${fmt(c.eng)}</td></tr>`).join("")}</tbody></table></div>` : empty("No posts in the last 30 days")}
${section("UK YouTube channels", `${found} found${chans.length - found ? `, ${chans.length - found} not found` : ""}`)}${chans.length ? `<div class="tbl-wrap scroll"><table><thead><tr><th>Configured as</th><th>Channel found</th><th>Status</th></tr></thead><tbody>${chans.map((c: any) => `<tr><td>${esc(c.name)}</td><td>${esc(c.title || "")}</td><td>${c.status === "ok" ? `<span class="pill-ok">Found</span>` : `<span class="pill-err">Not found</span>`}</td></tr>`).join("")}</tbody></table></div>` : empty("Channels are looked up on the next YouTube run")}
${section("Run log", `${fmt(r.total)} runs`, "runs")}${r.rows.length ? `<div class="tbl-wrap scroll"><table><thead><tr><th>Job</th><th>Started</th><th>Status</th><th class="num">New</th><th class="num">Seen</th><th class="num">Cost</th><th>Note</th></tr></thead><tbody>${r.rows.map((x: any) => `<tr><td><b style="font-weight:600">${esc(x.job)}</b></td><td class="mono" style="white-space:nowrap">${esc(timeShort(x.started_at))}</td><td>${x.status === "ok" ? `<span class="pill-ok">OK</span>` : x.status === "running" ? `<span class="muted">Running</span>` : `<span class="pill-err">${esc(x.status === "error" ? "Failed" : x.status)}</span>`}</td><td class="num">${fmt(x.items_new)}</td><td class="num">${fmt(x.items_seen)}</td><td class="num mono">$${(x.cost_usd || 0).toFixed(3)}</td><td class="muted" style="font-size:13px;max-width:380px">${esc(x.note || "")}</td></tr>`).join("")}</tbody></table></div>` : empty("No runs yet")}
${pager(ctx, "/sources", {}, rpage, r.total, per, "runs")}`;
  return { title: "Sources and coverage", body };
}

// ---------- Router ----------

/** Render a dashboard route. Returns null for unknown paths. */
export async function renderPage(env: Env, url: URL, lens: string | undefined, region: RegionFilter): Promise<string | null> {
  const ctx: Ctx = { path: url.pathname, lens: LENSES.some((l) => l.id === lens) ? lens : undefined, region };
  const p = url.pathname;
  if (p === "/q" && url.searchParams.get("partial") === "1") {
    const r = await questionDetailHtml(env, ctx, url, true);
    return r && "partial" in r ? r.partial ?? null : null;
  }
  const mh = await masthead(env);
  let out: { title: string; body: string } | null = null;
  if (p === "/") out = await today(env, ctx, mh);
  else if (p === "/questions") out = await questions(env, ctx, url);
  else if (p === "/q") { const r = await questionDetailHtml(env, ctx, url, false); out = r && "body" in r ? r as { title: string; body: string } : null; }
  else if (p === "/rising") out = await rising(env, ctx);
  else if (p.startsWith("/topics/")) out = await topicPage(env, ctx, decodeURIComponent(p.slice(8)));
  else if (p === "/gaps") out = await gapsView(env, ctx);
  else if (p === "/myths") out = await mythsView(env, ctx, url);
  else if (p === "/reddit") out = await viewReddit(env, url, ctx);
  else if (p === "/seasonality") out = await seasonalityView(env, ctx);
  else if (p === "/pipeline") out = await pipelineView(env, ctx, url);
  else if (p === "/sources") out = await sourcesView(env, ctx, url);
  if (!out) return null;
  return layout(ctx, out.title, out.body, { issues: mh.issues.length, since: mh.since, posts: mh.posts, queued: mh.queued });
}

/** 404 page in the same shell. */
export async function notFoundPage(env: Env, url: URL, lens: string | undefined, region: RegionFilter) {
  const ctx: Ctx = { path: url.pathname, lens, region };
  const mh = await masthead(env);
  return layout(ctx, "Not found", `${empty("That page doesn't exist", `<a href="${href(ctx, "/")}">Back to Today</a>`)}`, { issues: mh.issues.length, since: mh.since, posts: mh.posts, queued: mh.queued });
}

