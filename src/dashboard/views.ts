import { PROJECT, TOPICS, LENSES } from "../../config/taxonomy";
import { Env, daysAgo } from "../lib";
import { risingTopics, opportunities, regionSql, RegionFilter } from "../analysis";
import { checkHealth } from "../health";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const topicLabel = (id: string) => TOPICS.find((t) => t.id === id)?.label || id;
const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", serp_forum: "Reddit and forums", serp_discussions: "Google discussions", serp_paa: "People Also Ask", content_analysis: "Web mentions" };
const sourceLabel = (s: string) => s.split(", ").map((x) => SOURCE_LABELS[x] || x).join(", ");
const ratioText = (r: { ratio: number; baselineReady: boolean }) => (r.baselineReady ? `×${r.ratio.toFixed(1)} vs usual` : "baseline building");

function spark(values: number[], w = 140, h = 28) {
  const max = Math.max(1, ...values);
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(" ");
  const lastX = ((values.length - 1) * step).toFixed(1);
  const lastY = (h - (values[values.length - 1] / max) * (h - 2) - 1).toFixed(1);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#C8552D" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${lastX}" cy="${lastY}" r="2.5" fill="#C8552D"/></svg>`;
}

const NAV = [
  ["/", "Today"], ["/questions", "Question bank"], ["/rising", "Rising topics"], ["/gaps", "Content gaps"], ["/myths", "Myths and claims"], ["/sources", "Sources and coverage"],
];

const qs = (lens?: string, region?: RegionFilter) => {
  const p = new URLSearchParams();
  if (lens) p.set("lens", lens);
  if (region === "all") p.set("region", "all");
  const s = p.toString();
  return s ? `?${s}` : "";
};

export function layout(path: string, title: string, body: string, lens?: string, region: RegionFilter = "uk") {
  const lensBar = `<div class="bar"><form class="lens" method="get">${region === "all" ? `<input type="hidden" name="region" value="all">` : ""}${LENSES.map((l) => `<button name="lens" value="${l.id}" class="${lens === l.id ? "on" : ""}">${l.label}</button>`).join("")}<a href="${path}${qs(undefined, region)}" class="${!lens ? "on" : ""}">All audiences</a></form>
<div class="lens region"><a href="${path}${qs(lens, "uk")}" class="${region === "uk" ? "on" : ""}">UK only</a><a href="${path}${qs(lens, "all")}" class="${region === "all" ? "on" : ""}">All regions</a></div></div>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${PROJECT.name} listening</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--cream:#F8F4EE;--terra:#C8552D;--ink:#1A1614;--forest:#2F4A3A;--grey:#766F61;--sand:#E8E4DD;--white:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font:15px/1.55 Inter,system-ui,sans-serif}
header{background:var(--white);border-bottom:1px solid var(--sand);padding:14px 28px;display:flex;align-items:center;gap:28px;flex-wrap:wrap}
.brand{font-family:Fraunces,serif;font-size:21px;font-weight:600}.brand b{color:var(--terra);font-weight:600}.brand small{font:500 12px Inter;color:var(--grey);margin-left:8px;letter-spacing:.02em}
nav a{color:var(--grey);text-decoration:none;margin-right:18px;font-weight:500;font-size:14px;padding:6px 0;border-bottom:2px solid transparent}nav a.on,nav a:hover{color:var(--ink);border-color:var(--terra)}
main{max-width:1180px;margin:0 auto;padding:28px}
h1{font-family:Fraunces,serif;font-weight:500;font-size:30px;margin:0 0 4px}h2{font-family:Fraunces,serif;font-weight:500;font-size:20px;margin:28px 0 12px}
.sub{color:var(--grey);margin:0 0 20px}
.bar{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 20px}.lens{display:flex;gap:6px;flex-wrap:wrap}.region .on{background:var(--terra)!important;border-color:var(--terra)!important}
.alert{background:#FBEAEA;border:1px solid #F0C4C4;color:#7A2323;border-radius:12px;padding:12px 16px;margin:0 0 20px;font-size:14px}.alert ul{margin:6px 0 0;padding-left:18px}.lens button,.lens a{border:1px solid var(--sand);background:var(--white);color:var(--ink);padding:6px 12px;border-radius:999px;font:500 13px Inter;cursor:pointer;text-decoration:none}.lens .on{background:var(--forest);border-color:var(--forest);color:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.card{background:var(--white);border:1px solid var(--sand);border-radius:12px;padding:16px 18px}
.kpi .n{font-family:Fraunces,serif;font-size:30px}.kpi .l{color:var(--grey);font-size:13px}
.idea h3{font-family:Fraunces,serif;font-weight:500;font-size:17px;margin:0 0 6px}.idea p{margin:0 0 8px;color:var(--grey);font-size:14px}.idea ul{margin:0;padding-left:18px;font-size:14px}
.tag{display:inline-block;background:var(--sand);color:var(--ink);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:500;margin-right:4px}
.tag.terra{background:#F6E3DA;color:#8A3A1E}.tag.forest{background:#E1EAE4;color:var(--forest)}
table{width:100%;border-collapse:collapse;background:var(--white);border:1px solid var(--sand);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--sand);vertical-align:top;font-size:14px}th{background:#FBF9F5;color:var(--grey);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
tr:last-child td{border-bottom:0}td.num{text-align:right;font-variant-numeric:tabular-nums}
a{color:var(--terra)}.muted{color:var(--grey)}.ok{color:var(--forest);font-weight:500}.err{color:#A32D2D;font-weight:500}
.btn{white-space:nowrap;background:var(--terra);color:#fff;border:0;border-radius:8px;padding:5px 10px;font:500 12px Inter;cursor:pointer}.btn:disabled{background:var(--sand);color:var(--grey);cursor:default}
form.search{display:flex;gap:8px;margin-bottom:14px}form.search input,form.search select{border:1px solid var(--sand);border-radius:8px;padding:8px 10px;font:14px Inter;background:#fff}
.empty{padding:28px;text-align:center;color:var(--grey)}
</style></head><body>
<header><div class="brand">Comp<b>animal</b><small>Social listening</small></div><nav>${NAV.map(([h, l]) => `<a href="${h}${qs(lens, region)}" class="${path === h ? "on" : ""}">${l}</a>`).join("")}</nav></header>
<main>${lensBar}${body}</main>
<script>
document.querySelectorAll('[data-send]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;b.textContent='Sending';
const r=await fetch('/api/pipeline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({topic:b.dataset.topic,question:b.dataset.q})});
b.textContent=r.ok?'Queued':'Failed';}));
</script></body></html>`;
}

function oppRows(opps: Awaited<ReturnType<typeof opportunities>>) {
  if (!opps.length) return `<div class="card empty">No questions yet. They appear after the first collection and enrichment runs.</div>`;
  return `<table><tr><th>Question</th><th>Topic</th><th class="num">Mentions</th><th class="num">Engagement</th><th>Sources</th><th>On site</th><th class="num">Score</th><th></th></tr>
${opps.map((o) => `<tr><td>${esc(o.question)}${o.example_url ? ` <a href="${esc(o.example_url)}" target="_blank" rel="noopener" class="muted">↗</a>` : ""}</td><td><span class="tag">${esc(topicLabel(o.topic))}</span></td><td class="num">${o.count}</td><td class="num">${o.engagement}</td><td class="muted">${esc(sourceLabel(o.sources))}</td>
<td>${o.covered ? `<a href="${esc(o.covered)}" target="_blank" class="ok">Covered</a>` : `<span class="tag terra">Gap</span>`}</td><td class="num"><b>${o.score}</b></td>
<td><button class="btn" data-send data-topic="${esc(o.topic)}" data-q="${esc(o.question)}">Send to pipeline</button></td></tr>`).join("")}</table>`;
}

export async function viewToday(env: Env, lens?: string, region: RegionFilter = "uk") {
  const brief = await env.DB.prepare(`SELECT body_json, date, model FROM briefs WHERE project=?1 ORDER BY date DESC LIMIT 1`).bind(PROJECT.id).first<any>();
  const b = brief ? JSON.parse(brief.body_json) : null;
  const k = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM items WHERE project=?1) AS total,
    (SELECT COUNT(*) FROM items WHERE project=?1 AND collected_date>=?2) AS week,
    (SELECT COUNT(*) FROM enrichments e JOIN items i ON i.id=e.item_id WHERE i.project=?1 AND e.question IS NOT NULL${regionSql("e.region", region)}) AS questions,
    (SELECT COUNT(*) FROM enrichments e JOIN items i ON i.id=e.item_id WHERE i.project=?1 AND e.region='uk') AS uk,
    (SELECT COUNT(*) FROM enrichments e JOIN items i ON i.id=e.item_id WHERE i.project=?1 AND e.region IS NOT NULL) AS tagged,
    (SELECT MIN(collected_date) FROM items WHERE project=?1) AS since`).bind(PROJECT.id, daysAgo(7)).first<any>();
  const rising = (await risingTopics(env, lens, region)).slice(0, 6);
  const opps = (await opportunities(env, 14, lens, 10, region)).filter((o) => !o.covered);
  const issues = await checkHealth(env).catch(() => []);
  const ukPct = k?.tagged ? Math.round((k.uk / k.tagged) * 100) : 0;
  const body = `${issues.length ? `<div class="alert"><b>${issues.length} collection issue(s) in the last day</b><ul>${issues.map((i) => `<li>${esc(i.job)}: ${esc(i.problem)}</li>`).join("")}</ul></div>` : ""}<h1>Today</h1><p class="sub">${b ? `Brief for ${esc(brief.date)} · ${brief.model === "rules" ? "rules-based" : "AI-written"}` : "No brief yet. The first one is written after the first full day of collection."}</p>
<div class="grid">
<div class="card kpi"><div class="n">${(k?.total || 0).toLocaleString("en-GB")}</div><div class="l">Posts archived${k?.since ? ` since ${esc(k.since)}` : ""}</div></div>
<div class="card kpi"><div class="n">${(k?.week || 0).toLocaleString("en-GB")}</div><div class="l">Collected in the last 7 days</div></div>
<div class="card kpi"><div class="n">${(k?.questions || 0).toLocaleString("en-GB")}</div><div class="l">Questions extracted${region === "uk" ? " (UK and unsure)" : ""}</div></div>
<div class="card kpi"><div class="n">${ukPct}%</div><div class="l">Of tagged posts clearly from the UK</div></div>
</div>
${b?.ideas?.length ? `<h2>Content ideas</h2><div class="grid">${b.ideas.map((i: any) => `<div class="card idea"><span class="tag forest">${esc(topicLabel(i.topic))}</span><h3>${esc(i.title)}</h3><p>${esc(i.why)}</p>${i.questions?.length ? `<ul>${i.questions.map((q: string) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}</div>`).join("")}</div>` : ""}
<h2>Rising topics</h2>${rising.length ? `<div class="grid">${rising.map((r) => `<div class="card"><b>${esc(r.label)}</b><div class="muted" style="font-size:13px">${r.last7} this week · ${ratioText(r)}</div>${spark(r.spark, 210, 34)}</div>`).join("")}</div>` : `<div class="card empty">Needs a few days of data.</div>`}
<h2>Top unanswered questions (14 days)</h2>${oppRows(opps)}`;
  return layout("/", "Today", body, lens, region);
}

export async function viewQuestions(env: Env, url: URL, lens?: string, region: RegionFilter = "uk") {
  const topic = url.searchParams.get("topic") || "";
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const days = Number(url.searchParams.get("days") || 90);
  let opps = await opportunities(env, days, lens, 500, region);
  if (topic) opps = opps.filter((o) => o.topic === topic);
  if (q) opps = opps.filter((o) => o.question.toLowerCase().includes(q));
  const body = `<h1>Question bank</h1><p class="sub">Every question extracted in the last ${days} days, grouped and scored. Gaps score higher.</p>
<form class="search">${lens ? `<input type="hidden" name="lens" value="${esc(lens)}">` : ""}${region === "all" ? `<input type="hidden" name="region" value="all">` : ""}<input name="q" placeholder="Search questions" value="${esc(q)}"><select name="topic"><option value="">All topics</option>${TOPICS.map((t) => `<option value="${t.id}" ${t.id === topic ? "selected" : ""}>${t.label}</option>`).join("")}</select><select name="days">${[7, 30, 90, 365].map((d) => `<option ${d === days ? "selected" : ""}>${d}</option>`).join("")}</select><button class="btn">Filter</button></form>
${oppRows(opps.slice(0, 300))}`;
  return layout("/questions", "Question bank", body, lens, region);
}

export async function viewRising(env: Env, lens?: string, region: RegionFilter = "uk") {
  const rising = await risingTopics(env, lens, region);
  const body = `<h1>Rising topics</h1><p class="sub">Last 7 days against each topic's own 4-week weekly average. Sparklines show 35 days.${rising[0] && !rising[0].baselineReady ? " Growth ratios switch on after 3 weeks of data; until then topics are ranked by volume." : ""}</p>
${rising.length ? `<table><tr><th>Topic</th><th class="num">This week</th><th class="num">Prior 4 weeks</th><th class="num">Change</th><th>35 days</th></tr>${rising.map((r) => `<tr><td><a href="/questions?topic=${r.topic}${lens ? `&lens=${lens}` : ""}${region === "all" ? "&region=all" : ""}">${esc(r.label)}</a></td><td class="num">${r.last7}</td><td class="num">${r.prior28}</td><td class="num"><b>${r.baselineReady ? "×" + r.ratio.toFixed(1) : "–"}</b></td><td>${spark(r.spark)}</td></tr>`).join("")}</table>` : `<div class="card empty">Needs a few days of data.</div>`}`;
  return layout("/rising", "Rising topics", body, lens, region);
}

export async function viewGaps(env: Env, lens?: string, region: RegionFilter = "uk") {
  const opps = await opportunities(env, 90, lens, 2000, region);
  const byTopic = new Map<string, { total: number; gaps: number; score: number }>();
  for (const o of opps) {
    const t = byTopic.get(o.topic) || { total: 0, gaps: 0, score: 0 };
    t.total++; if (!o.covered) { t.gaps++; t.score += o.score; }
    byTopic.set(o.topic, t);
  }
  const rows = [...byTopic.entries()].sort((a, b) => b[1].score - a[1].score);
  const urls = await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_urls WHERE project=?1`).bind(PROJECT.id).first<any>();
  const body = `<h1>Content gaps</h1><p class="sub">Question clusters matched against ${urls?.n || 0} Companimal content URLs from the sitemap (last 90 days).</p>
${rows.length ? `<table><tr><th>Topic</th><th class="num">Question clusters</th><th class="num">Not covered</th><th class="num">Coverage</th><th class="num">Gap score</th></tr>${rows.map(([t, v]) => `<tr><td><a href="/questions?topic=${t}">${esc(topicLabel(t))}</a></td><td class="num">${v.total}</td><td class="num">${v.gaps}</td><td class="num">${Math.round(((v.total - v.gaps) / v.total) * 100)}%</td><td class="num"><b>${Math.round(v.score)}</b></td></tr>`).join("")}</table>` : `<div class="card empty">No data yet.</div>`}
<h2>Biggest gaps</h2>${oppRows(opps.filter((o) => !o.covered).slice(0, 25))}`;
  return layout("/gaps", "Content gaps", body, lens, region);
}

export async function viewMyths(env: Env, lens?: string, region: RegionFilter = "uk") {
  const rows = await env.DB.prepare(`SELECT e.topic, COALESCE(e.question, i.title) AS claim, i.text, i.url, i.engagement, i.collected_date FROM enrichments e JOIN items i ON i.id=e.item_id WHERE i.project=?1 AND e.kind='myth' ${lens ? "AND e.lens=?2" : ""}${regionSql("e.region", region)} ORDER BY i.collected_date DESC, i.engagement DESC LIMIT 200`).bind(...[PROJECT.id, ...(lens ? [lens] : [])]).all<any>();
  const body = `<h1>Myths and claims</h1><p class="sub">Beliefs owners repeat that may not be true. Each is a candidate for a Dog Data Library article.</p>
${rows.results?.length ? `<table><tr><th>Claim</th><th>Topic</th><th class="num">Engagement</th><th>Seen</th></tr>${rows.results.map((r: any) => `<tr><td>${esc(r.claim)}<div class="muted" style="font-size:13px">${esc((r.text || "").slice(0, 220))}</div></td><td><span class="tag">${esc(topicLabel(r.topic))}</span></td><td class="num">${r.engagement}</td><td><a href="${esc(r.url)}" target="_blank">${esc(r.collected_date)}</a></td></tr>`).join("")}</table>` : `<div class="card empty">No myths detected yet.</div>`}`;
  return layout("/myths", "Myths and claims", body, lens, region);
}

export async function viewSources(env: Env, lens?: string, region: RegionFilter = "uk") {
  const comm = await env.DB.prepare(`SELECT i.source, i.community, COUNT(*) AS n, SUM(CASE WHEN e.question IS NOT NULL THEN 1 ELSE 0 END) AS q, SUM(i.engagement) AS eng, SUM(CASE WHEN e.region='uk' THEN 1 ELSE 0 END) AS uk, SUM(CASE WHEN e.region='non_uk' THEN 1 ELSE 0 END) AS nonuk FROM items i LEFT JOIN enrichments e ON e.item_id=i.id WHERE i.project=?1 AND i.collected_date>=?2 GROUP BY i.source, i.community ORDER BY q DESC, n DESC LIMIT 40`).bind(PROJECT.id, daysAgo(30)).all<any>();
  const chans = (await env.DB.prepare(`SELECT name, title, status FROM yt_channels ORDER BY status, name`).all<any>()).results || [];
  const runs = await env.DB.prepare(`SELECT job, started_at, status, items_new, items_seen, cost_usd, note FROM runs WHERE project=?1 ORDER BY started_at DESC LIMIT 40`).bind(PROJECT.id).all<any>();
  const body = `<h1>Sources and coverage</h1><p class="sub">Which communities produce the most questions, and whether every collector ran.</p>
<h2>Top communities (30 days)</h2>${comm.results?.length ? `<table><tr><th>Source</th><th>Community</th><th class="num">Posts</th><th class="num">Questions</th><th class="num">Question rate</th><th class="num">UK</th><th class="num">Not UK</th><th class="num">Engagement</th></tr>${comm.results.map((r: any) => `<tr><td>${esc(sourceLabel(r.source))}</td><td>${esc(r.community || "")}</td><td class="num">${r.n}</td><td class="num">${r.q}</td><td class="num">${Math.round((r.q / r.n) * 100)}%</td><td class="num">${Math.round(((r.uk || 0) / r.n) * 100)}%</td><td class="num">${Math.round(((r.nonuk || 0) / r.n) * 100)}%</td><td class="num">${r.eng || 0}</td></tr>`).join("")}</table>` : `<div class="card empty">No data yet.</div>`}
<h2>UK YouTube channels</h2>${chans.length ? `<table><tr><th>Configured as</th><th>Found channel</th><th>Status</th></tr>${chans.map((c: any) => `<tr><td>${esc(c.name)}</td><td>${esc(c.title || "")}</td><td class="${c.status === "ok" ? "ok" : "err"}">${c.status === "ok" ? "ok" : "not found"}</td></tr>`).join("")}</table>` : `<div class="card empty">Channels are looked up on the next YouTube run.</div>`}
<h2>Recent runs</h2>${runs.results?.length ? `<table><tr><th>Job</th><th>Started</th><th>Status</th><th class="num">New</th><th class="num">Seen</th><th class="num">Cost</th><th>Note</th></tr>${runs.results.map((r: any) => `<tr><td>${esc(r.job)}</td><td>${esc(r.started_at.replace("T", " ").slice(0, 16))}</td><td class="${r.status === "ok" ? "ok" : "err"}">${esc(r.status)}</td><td class="num">${r.items_new}</td><td class="num">${r.items_seen}</td><td class="num">$${(r.cost_usd || 0).toFixed(3)}</td><td class="muted">${esc(r.note || "")}</td></tr>`).join("")}</table>` : `<div class="card empty">No runs yet.</div>`}`;
  return layout("/sources", "Sources and coverage", body, lens, region);
}
