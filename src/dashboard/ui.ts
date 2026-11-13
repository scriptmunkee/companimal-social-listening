// Shared UI: design tokens, page shell, and small server-rendered components.
// Design spec (ui-craft phase 1):
// 1. Aesthetic: editorial morning paper for content planning. Cream newsprint canvas,
//    Instrument Serif headlines, ruled hairline columns, ranked league-table lists.
// 2. Type: Instrument Serif (display; never Fraunces) + Instrument Sans (UI, true tabular figures) + JetBrains Mono (timestamps, keys).
// 3. Surfaces: cream canvas, paper only for raised surfaces, 1px sand hairlines, tonal wells. No shadows.
// 4. Signature: "Send to pipeline" presses down and inks into a forest "Queued" stamp; a terracotta
//    rule tracks the focused row as you move with j and k.
import { PROJECT, TOPICS, LENSES } from "../../config/taxonomy";
import type { RegionFilter } from "../analysis";
import { CLIENT_JS } from "./client";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const topicLabel = (id: string) => TOPICS.find((t) => t.id === id)?.label || id;
export const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", serp_forum: "Reddit and forums", serp_discussions: "Google discussions", serp_paa: "People Also Ask", content_analysis: "Web mentions" };
export const sourceLabel = (s: string) => (s || "").split(", ").filter(Boolean).map((x) => SOURCE_LABELS[x] || x).join(", ");
export const fmt = (n: number | null | undefined) => (Number(n) || 0).toLocaleString("en-GB");
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** 2026-11-13 → 13 Nov 2026 */
export const dateShort = (iso?: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
};
export const dateLong = (d = new Date()) => `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const timeShort = (iso?: string | null) => (iso ? `${dateShort(iso)} ${iso.slice(11, 16)}` : "");

/** Request context: the global filters every link must carry. */
export interface Ctx { path: string; lens?: string; region: RegionFilter }

/** Build a link that keeps the audience lens and region. */
export function href(ctx: Pick<Ctx, "lens" | "region">, path: string, params: Record<string, string | number | undefined | null> = {}) {
  const p = new URLSearchParams();
  if (ctx.lens) p.set("lens", ctx.lens);
  if (ctx.region === "all") p.set("region", "all");
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return esc(s ? `${path}?${s}` : path);
}
/** Hidden inputs so GET forms keep the global filters. */
export const keepFilters = (ctx: Ctx) => `${ctx.lens ? `<input type="hidden" name="lens" value="${esc(ctx.lens)}">` : ""}${ctx.region === "all" ? `<input type="hidden" name="region" value="all">` : ""}`;

export const questionHref = (ctx: Ctx, topic: string, q: string) => href(ctx, "/q", { topic, q });
export const topicHref = (ctx: Ctx, topic: string) => href(ctx, `/topics/${topic}`);
export const topicTag = (ctx: Ctx, topic: string) => `<a class="tag" href="${topicHref(ctx, topic)}">${esc(topicLabel(topic))}</a>`;

// ---------- Charts (single hue; identity is never colour alone) ----------

/** 35-day sparkline: forest 2px line, ink end point. */
export function spark(values: number[], w = 140, h = 32, label = "") {
  if (!values.length) return "";
  const max = Math.max(1, ...values);
  const step = w / Math.max(1, values.length - 1);
  const y = (v: number) => (h - 3 - (v / max) * (h - 6)).toFixed(1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`).join(" ");
  const last = values.length - 1;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label || `Daily mentions, last ${values.length} days, peak ${max}`)}"><line x1="0" x2="${w}" y1="${h - 1.5}" y2="${h - 1.5}" class="spark-base"/><polyline points="${pts}" fill="none" class="spark-line"/><circle cx="${(last * step).toFixed(1)}" cy="${y(values[last])}" r="3" class="spark-dot"/></svg>`;
}

/** Daily column chart with hover tooltips. `days` = [{date, n}]. */
export function dailyBars(days: { date: string; n: number }[], h = 160) {
  if (!days.length) return "";
  const W = 900, gap = 2, top = 18, bottom = 22;
  const max = Math.max(1, ...days.map((d) => d.n));
  const bw = (W - gap * (days.length - 1)) / days.length;
  const ch = h - top - bottom;
  const ticks = [0, Math.round(max / 2), max];
  const bars = days.map((d, i) => {
    const bh = d.n ? Math.max(2, (d.n / max) * ch) : 0;
    const x = i * (bw + gap);
    return `<g class="bar-hit" data-tip="${esc(`${dateShort(d.date)}: ${fmt(d.n)} mentions`)}"><rect x="${x.toFixed(1)}" y="${top}" width="${bw.toFixed(1)}" height="${ch}" class="hit"/>${bh ? `<path class="bar" d="${roundTop(x, top + ch - bh, bw, bh)}"/>` : ""}</g>`;
  }).join("");
  const firstLabel = dateShort(days[0].date), lastLabel = dateShort(days[days.length - 1].date);
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="Daily mentions from ${firstLabel} to ${lastLabel}, peak ${max}">
${ticks.map((t) => `<line x1="0" x2="${W}" y1="${(top + ch - (t / max) * ch).toFixed(1)}" y2="${(top + ch - (t / max) * ch).toFixed(1)}" class="grid"/>`).join("")}
${bars}</svg><div class="chart-axis"><span>${firstLabel}</span><span class="muted">Peak ${fmt(max)} a day</span><span>${lastLabel}</span></div>`;
}
function roundTop(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x.toFixed(1)},${(y + h).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)}V${(y + h).toFixed(1)}Z`;
}

/** Thin proportion bar (0..1) with optional label. */
export const meter = (v: number, tip = "") => `<span class="meter"${tip ? ` data-tip="${esc(tip)}"` : ""}><span style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%"></span></span>`;

// ---------- Small components ----------

export const empty = (title: string, body = "") => `<div class="empty"><p class="empty-t">${esc(title)}</p>${body ? `<p>${body}</p>` : ""}</div>`;
export const notice = (body: string) => `<div class="notice">${body}</div>`;
export const eyebrow = (s: string) => `<p class="eyebrow">${esc(s)}</p>`;
export const section = (title: string, aside = "", id = "") => `<div class="sec"${id ? ` id="${id}"` : ""}><h2>${esc(title)}</h2>${aside ? `<div class="sec-aside">${aside}</div>` : ""}</div>`;

export function sendButton(topic: string, question: string, queued: boolean, compact = false) {
  if (queued) return `<span class="stamp" title="Already in the content pipeline">Queued</span>`;
  return `<button type="button" class="btn-send${compact ? " row" : ""}" data-send data-topic="${esc(topic)}" data-q="${esc(question)}"${compact ? ` aria-label="Send to pipeline: ${esc(question)}" title="Send to pipeline"` : ""}>${compact ? "Send" : "Send to pipeline"}</button>`;
}

/** Segmented control made of links. */
export function segmented(label: string, items: { href: string; label: string; on: boolean }[]) {
  return `<div class="seg" role="group" aria-label="${esc(label)}">${items.map((i) => `<a href="${i.href}"${i.on ? ` class="on" aria-current="true"` : ""}>${esc(i.label)}</a>`).join("")}</div>`;
}

export function pager(ctx: Ctx, path: string, params: Record<string, string | number | undefined>, page: number, total: number, per: number, key = "page") {
  const pages = Math.max(1, Math.ceil(total / per));
  if (pages <= 1) return "";
  const from = (page - 1) * per + 1, to = Math.min(total, page * per);
  const link = (p: number, label: string, disabled: boolean, rel = "") => disabled ? `<span class="pg off">${label}</span>` : `<a class="pg" href="${href(ctx, path, { ...params, [key]: p > 1 ? p : undefined })}"${rel ? ` rel="${rel}"` : ""}>${label}</a>`;
  const nums: string[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p === page ? `<span class="pg on" aria-current="page">${p}</span>` : link(p, String(p), false));
    else if (!nums[nums.length - 1]?.includes("gap")) nums.push(`<span class="pg gap" aria-hidden="true">…</span>`);
  }
  return `<nav class="pager" aria-label="Pages"><span class="pager-range">${fmt(from)} to ${fmt(to)} of ${fmt(total)}</span><span class="pager-links">${link(page - 1, "Previous", page <= 1, "prev")}${nums.join("")}${link(page + 1, "Next", page >= pages, "next")}</span></nav>`;
}

// ---------- Page shell ----------

export const NAV: [string, string][] = [
  ["/", "Today"], ["/reddit", "Reddit"], ["/questions", "Questions"], ["/rising", "Rising"], ["/gaps", "Gaps"], ["/myths", "Myths"],
  ["/seasonality", "Seasonality"], ["/pipeline", "Pipeline"], ["/sources", "Sources"],
];

export interface Masthead { issues: number; since?: string | null; posts: number; queued: number }

export function layout(ctx: Ctx, title: string, body: string, mh: Masthead) {
  const navOn = (h: string) => (h === "/" ? ctx.path === "/" : ctx.path === h || ctx.path.startsWith(h + "/") || (h === "/questions" && ctx.path === "/q") || (h === "/rising" && ctx.path.startsWith("/topics")));
  const lensItems = [{ href: href({ region: ctx.region }, ctx.path), label: "All audiences", on: !ctx.lens },
    ...LENSES.map((l) => ({ href: href({ lens: l.id, region: ctx.region }, ctx.path), label: l.label, on: ctx.lens === l.id }))];
  const regionItems = [{ href: href({ lens: ctx.lens, region: "uk" }, ctx.path), label: "UK only", on: ctx.region === "uk" },
    { href: href({ lens: ctx.lens, region: "all" }, ctx.path), label: "All regions", on: ctx.region === "all" }];
  const status = mh.issues
    ? `<a class="status bad" href="${href(ctx, "/sources", {})}#runs"><span class="dot"></span>${mh.issues} collection ${mh.issues === 1 ? "issue" : "issues"}</a>`
    : `<span class="status"><span class="dot"></span>Collectors healthy</span>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${PROJECT.name} listening</title>
<meta name="color-scheme" content="light">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%227%22 fill=%22%231A1614%22/%3E%3Ccircle cx=%2216%22 cy=%2216%22 r=%227%22 fill=%22none%22 stroke=%22%23C8552D%22 stroke-width=%224%22 stroke-dasharray=%2233 44%22 transform=%22rotate(45 16 16)%22/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="mast">
  <div class="mast-top wrap"><span class="mono">${esc(dateLong())}</span><span class="mast-meta">${mh.since ? `<span class="mono">Archive since ${esc(dateShort(mh.since))} · ${fmt(mh.posts)} posts</span>` : ""}${status}</span></div>
  <div class="mast-main wrap">
    <a class="brand" href="${href(ctx, "/")}" aria-label="Companimal listening, Today">Comp<b>animal</b><span>Listening desk</span></a>
    <nav class="nav" aria-label="Views">${NAV.map(([h, l]) => `<a href="${href(ctx, h)}"${navOn(h) ? ` class="on" aria-current="page"` : ""}>${l}${h === "/pipeline" && mh.queued ? `<span class="count">${fmt(mh.queued)}</span>` : ""}</a>`).join("")}</nav>
  </div>
  <div class="filters wrap">${segmented("Audience", lensItems)}${segmented("Region", regionItems)}<button type="button" class="keys-btn" data-keys aria-label="Keyboard shortcuts"><kbd>?</kbd> Shortcuts</button></div>
</header>
<main id="main" class="wrap">${body}</main>
<div class="scrim" data-close hidden></div>
<aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="Question detail" hidden><div class="drawer-bar"><span class="eyebrow">Question detail</span><button type="button" class="icon-btn" data-close aria-label="Close">Close <kbd>Esc</kbd></button></div><div class="drawer-body" id="drawer-body"></div></aside>
<dialog class="keys" id="keys"><h2>Keyboard shortcuts</h2><dl>
<dt><kbd>j</kbd> <kbd>k</kbd></dt><dd>Next and previous question</dd>
<dt><kbd>o</kbd> <kbd>Enter</kbd></dt><dd>Open the focused question or thread</dd>
<dt><kbd>s</kbd></dt><dd>Send the focused question to the pipeline</dd>
<dt><kbd>/</kbd></dt><dd>Search the question bank</dd>
<dt><kbd>g</kbd> then <kbd>t</kbd> <kbd>d</kbd> <kbd>q</kbd> <kbd>r</kbd> <kbd>m</kbd></dt><dd>Go to Today, Reddit, Questions, Rising, Myths</dd>
<dt><kbd>Esc</kbd></dt><dd>Close the drawer or this panel</dd>
</dl><form method="dialog"><button class="btn-quiet">Close</button></form></dialog>
<div class="tip" id="tip" role="tooltip" hidden></div>
<script>${CLIENT_JS}</script></body></html>`;
}

const CSS = `
:root{--cream:#F8F4EE;--well:#F2ECE3;--well-2:#EBE4D9;--paper:#FFFFFF;--sand:#E8E4DD;--rule:#D9D2C6;--grey:#766F61;--ink:#1A1614;--ink-2:#3D3732;--forest:#2F4A3A;--forest-tint:#E4EBE5;--terra:#C8552D;--terra-ink:#A8441F;--terra-tint:#F7E4DA;
--display:"Instrument Serif",Georgia,serif;--sans:"Instrument Sans",ui-sans-serif,sans-serif;--mono:"JetBrains Mono",ui-monospace,monospace;--r:10px;--ease:cubic-bezier(.2,.7,.2,1)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--cream);color:var(--ink);font:400 14.5px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
.wrap{max-width:1240px;margin:0 auto;padding-left:32px;padding-right:32px}
a{color:inherit;text-decoration-color:var(--rule);text-underline-offset:3px}
a:hover{text-decoration-color:currentColor}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px;border-radius:4px}
.mono{font-family:var(--mono);font-size:12px;letter-spacing:0}
.num,td,th,.qmeta,.post-h,.kpis .v,.stats dd,.strip b,.pager,.chart-axis,.score,.meta-n,.nav .count{font-variant-numeric:tabular-nums}
.muted{color:var(--grey)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:-999px;top:8px;background:var(--ink);color:var(--cream);padding:8px 12px;border-radius:6px;z-index:50}.skip:focus{left:8px}
kbd{font:500 11px/1 var(--mono);border:1px solid var(--rule);border-bottom-width:2px;border-radius:4px;padding:2px 5px;background:var(--paper);color:var(--ink)}

/* Masthead */
.mast{border-bottom:1px solid var(--ink)}
.mast-top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-top:10px;padding-bottom:10px;color:var(--grey);border-bottom:1px solid var(--sand)}
.mast-meta{display:flex;gap:18px;align-items:center}
.status{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--forest);font-weight:500;text-decoration:none;border-radius:999px;padding:2px 0}
.status .dot{width:7px;height:7px;border-radius:50%;background:var(--forest)}
.status.bad{color:var(--terra-ink)}.status.bad .dot{background:var(--terra)}.status.bad:hover{text-decoration:underline}
.mast-main{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding-top:18px}
.brand{font:400 34px/1 var(--display);letter-spacing:-.02em;text-decoration:none;display:flex;align-items:baseline;gap:0;padding-bottom:14px;white-space:nowrap}
.brand b{color:var(--terra);font-weight:400}
.brand span{font:600 11px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--grey);margin-left:12px;padding-left:12px;border-left:1px solid var(--rule)}
.nav{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;margin-bottom:-1px}.nav::-webkit-scrollbar{display:none}
.nav a{position:relative;padding:10px 12px 14px;text-decoration:none;color:var(--grey);font-weight:500;font-size:14px;white-space:nowrap;border-radius:6px 6px 0 0;transition:color .15s,background .15s}
.nav a:hover{color:var(--ink);background:var(--well)}
.nav a:active{background:var(--well-2)}
.nav a.on{color:var(--ink)}
.nav a.on::after{content:"";position:absolute;left:12px;right:12px;bottom:0;height:3px;background:var(--terra);border-radius:3px 3px 0 0}
.nav .count{font-size:11px;margin-left:6px;padding:1px 6px;border-radius:999px;background:var(--well-2);color:var(--ink-2)}
.filters{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding-top:12px;padding-bottom:12px;border-top:1px solid var(--sand)}
.seg{display:inline-flex;background:var(--well);border:1px solid var(--sand);border-radius:999px;padding:3px;gap:2px;max-width:100%;overflow-x:auto;scrollbar-width:none}
.seg::-webkit-scrollbar{display:none}
.seg a{padding:5px 12px;border-radius:999px;text-decoration:none;font-size:13px;font-weight:500;color:var(--ink-2);white-space:nowrap;transition:background .15s,color .15s,transform .1s}
.seg a:hover{background:var(--paper);color:var(--ink)}
.seg a:active{transform:scale(.97)}
.seg a.on{background:var(--ink);color:var(--cream)}
.keys-btn{margin-left:auto;border:0;background:none;color:var(--grey);font:500 12.5px var(--sans);cursor:pointer;padding:6px 8px;border-radius:6px;display:inline-flex;gap:6px;align-items:center}
.keys-btn:hover{background:var(--well);color:var(--ink)}.keys-btn:active{transform:scale(.98)}

/* Type */
main{padding-top:32px;padding-bottom:80px}
h1{font:400 50px/1.04 var(--display);letter-spacing:-.02em;margin:0}
h2{font:400 28px/1.1 var(--display);letter-spacing:-.02em;margin:0}
h3{font:400 20px/1.25 var(--display);letter-spacing:0;margin:0}
.eyebrow{font:600 11px/1.2 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--grey);margin:0 0 8px}
.lede{color:var(--ink-2);font-size:15.5px;max-width:68ch;margin:10px 0 0}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;margin-bottom:28px}
.sec{display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin:48px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--ink)}
.sec-aside{font-size:13px;color:var(--grey)}.sec-aside a{color:var(--ink)}
.back{display:inline-block;font-size:13px;color:var(--grey);text-decoration:none;margin-bottom:14px}.back:hover{color:var(--ink)}

/* Bento */
.bento{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:20px}
.c-7{grid-column:span 7}.c-5{grid-column:span 5}.c-8{grid-column:span 8}.c-4{grid-column:span 4}.c-12{grid-column:span 12}.c-6{grid-column:span 6}.c-3{grid-column:span 3}
.panel{background:var(--paper);border:1px solid var(--sand);border-radius:var(--r)}
.hero{padding:28px 30px;display:flex;flex-direction:column;gap:18px;border-color:var(--rule)}
.hero h2{font-size:40px;line-height:1.05;letter-spacing:-.02em}
.hero h2 a{text-decoration:none}.hero h2 a:hover{text-decoration:underline;text-decoration-thickness:1px}
.hero .why{color:var(--ink-2);font-size:15.5px;margin:0;max-width:60ch}
.h2list{margin:0;padding:0;list-style:none;border-top:1px solid var(--sand)}
.h2list li{display:grid;grid-template-columns:34px 1fr;padding:9px 0;border-bottom:1px solid var(--sand);font-size:14.5px}
.h2list li span{font:500 11px/2 var(--mono);color:var(--grey)}
.hero-foot{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-top:auto}
.stats{display:flex;gap:22px;flex-wrap:wrap;margin:0}
.stats div{display:flex;flex-direction:column}
.stats dt{font:600 11px/1.2 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--grey);order:2;margin-top:3px}
.stats dd{margin:0;font-size:22px;font-weight:500;letter-spacing:-.02em;line-height:1.1}
.queue{padding:22px 24px}
.queue ol{list-style:none;margin:12px 0 0;padding:0}
.queue li{display:grid;grid-template-columns:30px 1fr;gap:4px;padding:13px 0;border-top:1px solid var(--sand)}
.queue li .n{font:500 12px/1.6 var(--mono);color:var(--grey)}
.queue li .t{font:400 19px/1.25 var(--display);text-decoration:none}
.queue li a.t:hover{text-decoration:underline;text-decoration-thickness:1px}
.queue li p{margin:4px 0 0;font-size:13px;color:var(--grey)}

/* KPI strip */
.kpis{display:grid;grid-template-columns:repeat(var(--k,4),minmax(0,1fr));border-top:1px solid var(--ink);border-bottom:1px solid var(--sand);margin:28px 0 0}
.kpis>div{padding:16px 18px 16px 0;border-right:1px solid var(--sand)}
.kpis>div+div{padding-left:18px}.kpis>div:last-child{border-right:0}
.kpis .v{font-size:32px;font-weight:500;letter-spacing:-.03em;line-height:1.05}
.kpis .l{font:600 11px/1.3 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--grey);margin-top:6px}
.kpis .s{font-size:12.5px;color:var(--grey);margin-top:2px}

/* Rising strip */
.strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));border:1px solid var(--sand);border-radius:var(--r);background:var(--paper);overflow:hidden}
.strip a{padding:14px 16px 12px;text-decoration:none;border-right:1px solid var(--sand);display:flex;flex-direction:column;gap:6px;transition:background .15s}
.strip a:last-child{border-right:0}.strip a:hover{background:var(--well)}.strip a:active{background:var(--well-2)}
.strip .t{font-weight:600;font-size:13.5px;line-height:1.25;min-height:2.5em}
.strip .m{display:flex;justify-content:space-between;font-size:12.5px;color:var(--grey)}
.strip .m b{color:var(--ink);font-weight:600;font-size:15px}
.spark{display:block;width:100%;height:auto;overflow:visible}
.spark-line{stroke:var(--forest);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.spark-base{stroke:var(--sand);stroke-width:1}
.spark-dot{fill:var(--ink);stroke:var(--paper);stroke-width:2}
.up{color:var(--forest);font-weight:600}.down{color:var(--grey)}

/* Tables */
.tbl-wrap{background:var(--paper);border:1px solid var(--sand);border-radius:var(--r);overflow:hidden}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{font:600 11px/1.2 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--grey);text-align:left;padding:12px 14px;border-bottom:1px solid var(--rule);background:var(--paper);white-space:nowrap}
td{padding:12px 14px;border-bottom:1px solid var(--sand);vertical-align:top}
tbody tr:last-child td{border-bottom:0}
th.num,td.num{text-align:right;white-space:nowrap}
tbody tr{transition:background .12s}
tbody tr:hover{background:#FCFAF6}
td.rank{font:500 11.5px/1.9 var(--mono);color:var(--grey);width:44px;padding-right:0}
tr[data-row]{cursor:pointer;outline:0}
tr[data-row]:focus-visible,tr[data-row].focus{background:var(--well);box-shadow:inset 3px 0 0 var(--terra)}
.qlink{font-weight:500;font-size:15px;line-height:1.35;text-decoration:none}
.qlink:hover{text-decoration:underline}
.qmeta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-top:6px;font-size:12.5px;color:var(--grey)}
.m-only{display:none}
.score{font-weight:600;font-size:15px}
.score .meter{margin-top:6px;margin-left:auto}
.tag{display:inline-block;font:500 12px/1.5 var(--sans);padding:1px 9px;border-radius:999px;background:var(--well);border:1px solid var(--sand);color:var(--ink-2);text-decoration:none;white-space:nowrap}
a.tag:hover{border-color:var(--rule);background:var(--well-2);color:var(--ink)}
.gap-tag{display:inline-block;font:600 11px/1.5 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);padding:1px 8px;border:1px dashed var(--rule);border-radius:999px;white-space:nowrap}
.covered{display:inline-flex;gap:5px;align-items:center;font-weight:600;font-size:12.5px;color:var(--forest);text-decoration:none;white-space:nowrap}
.covered::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--forest)}
.covered:hover{text-decoration:underline}
.ok{color:var(--forest);font-weight:600}.err{color:var(--terra-ink);font-weight:600}
.pill-ok,.pill-err{display:inline-flex;gap:6px;align-items:center;font-weight:600;font-size:12.5px}
.pill-ok::before,.pill-err::before{content:"";width:7px;height:7px;border-radius:50%}
.pill-ok{color:var(--forest)}.pill-ok::before{background:var(--forest)}
.pill-err{color:var(--terra-ink)}.pill-err::before{background:var(--terra)}
.meter{display:block;width:72px;height:4px;background:var(--well-2);border-radius:4px;overflow:hidden}
.meter>span{display:block;height:100%;background:var(--forest);border-radius:4px}
.meter.wide{width:100%;max-width:180px}

/* Buttons */
.btn-send{font:600 12.5px/1 var(--sans);color:var(--paper);background:var(--terra);border:1px solid var(--terra);padding:8px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:background .15s,transform .12s var(--ease),border-color .15s}
.btn-send:hover{background:var(--terra-ink);border-color:var(--terra-ink)}
.btn-send:active{transform:scale(.96) translateY(1px)}
.btn-send:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.btn-send.row{background:var(--paper);color:var(--ink);border-color:var(--rule);padding:7px 12px;min-width:64px}
tr:hover .btn-send.row,tr.focus .btn-send.row,.myth:hover .btn-send.row,.btn-send.row:hover,.btn-send.row:focus-visible{background:var(--terra);color:var(--paper);border-color:var(--terra)}
.btn-send[disabled]{opacity:.7;cursor:progress}
.btn-send.failed{background:var(--paper);color:var(--terra-ink);border-color:var(--terra)}
.stamp{display:inline-block;font:600 11px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--forest);border:1.5px solid var(--forest);padding:7px 10px;border-radius:6px;transform:rotate(-2deg);white-space:nowrap;background:var(--forest-tint)}
.stamp.inked{animation:ink .42s var(--ease)}
@keyframes ink{0%{transform:scale(1.35) rotate(-6deg);opacity:0}55%{transform:scale(.94) rotate(-1deg);opacity:1}100%{transform:scale(1) rotate(-2deg)}}
.btn-quiet,.btn-line{font:500 13px/1 var(--sans);border-radius:8px;padding:9px 13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .15s,border-color .15s,transform .1s}
.btn-quiet{background:var(--well);border:1px solid var(--sand);color:var(--ink)}
.btn-line{background:var(--paper);border:1px solid var(--rule);color:var(--ink)}
.btn-quiet:hover,.btn-line:hover{background:var(--well-2);border-color:var(--grey)}
.btn-quiet:active,.btn-line:active{transform:scale(.98)}
.icon-btn{border:1px solid var(--sand);background:var(--paper);border-radius:8px;padding:6px 10px;font:500 13px var(--sans);display:inline-flex;gap:8px;align-items:center;cursor:pointer;color:var(--ink)}
.icon-btn:hover{background:var(--well)}.icon-btn:active{transform:scale(.98)}

/* Toolbar */
.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.field{display:flex;align-items:center;gap:8px;background:var(--paper);border:1px solid var(--rule);border-radius:8px;padding:0 10px;transition:border-color .15s}
.field:focus-within{border-color:var(--ink)}
.field input,.field select{border:0;background:transparent;font:400 14px var(--sans);color:var(--ink);padding:9px 0;outline:0;min-width:0}
.field.search{flex:1 1 260px}.field.search input{width:100%}
.field kbd{flex:none}
.field select{cursor:pointer;padding-right:4px}
.field:hover{border-color:var(--grey)}
.hint{font-size:12.5px;color:var(--grey);display:flex;gap:14px;flex-wrap:wrap;margin:10px 2px 0}

/* States */
.empty{border:1px dashed var(--rule);border-radius:var(--r);padding:36px 28px;text-align:center;color:var(--grey);background:transparent}
.empty-t{font:400 21px/1.3 var(--display);color:var(--ink);margin:0 0 6px}
.empty p{margin:0;max-width:56ch;margin-inline:auto}
.notice{border:1px solid var(--sand);border-left:3px solid var(--forest);background:var(--paper);border-radius:6px;padding:12px 16px;font-size:14px;color:var(--ink-2);margin:0 0 18px}
.alert{border:1px solid #EBC9B8;border-left:3px solid var(--terra);background:var(--terra-tint);border-radius:6px;padding:12px 16px;font-size:14px;margin:0 0 24px}
.alert b{font-weight:600}.alert ul{margin:6px 0 0;padding-left:18px}.alert li{margin:2px 0}
.progress{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--grey)}
.progress .meter{width:140px}

/* Pager */
.pager{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px;font-size:13px;color:var(--grey)}
.pager-links{display:flex;gap:4px;flex-wrap:wrap}
.pg{min-width:34px;text-align:center;padding:6px 10px;border:1px solid var(--sand);border-radius:7px;text-decoration:none;color:var(--ink);background:var(--paper)}
a.pg:hover{border-color:var(--grey)}a.pg:active{transform:scale(.97)}
.pg.on{background:var(--ink);color:var(--cream);border-color:var(--ink)}
.pg.off{color:var(--rule)}.pg.gap{border:0;background:none;min-width:0}

/* Reddit */
.snip{margin:4px 0 0;font-size:13px;color:var(--grey);max-width:62ch}
table.reddit td.about{min-width:200px;max-width:260px;font-size:13.5px}
table.reddit td.about .theme{font-weight:600;margin-top:5px}
table.reddit td.angle{min-width:180px;max-width:240px;font-size:13.5px;color:var(--ink-2)}
.small{font-size:12.5px;margin-top:3px}
/* Lists */
.list{list-style:none;margin:0;padding:0}
.list>li{padding:14px 0;border-bottom:1px solid var(--sand)}
.list>li:first-child{padding-top:4px}
.post{display:grid;gap:4px}
.post-h{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12.5px;color:var(--grey);align-items:center}
.post-h b{color:var(--ink);font-weight:600}
.post p{margin:0;font-size:14px;color:var(--ink-2)}
.post a.out{font-size:12.5px;color:var(--ink);font-weight:500}
details.more>summary{cursor:pointer;font-size:13px;color:var(--grey);list-style:none;display:inline-flex;gap:6px;align-items:center;padding:4px 0;border-radius:4px}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::before{content:"+";font:500 13px var(--mono);width:14px}
details.more[open]>summary::before{content:"−"}
details.more>summary:hover{color:var(--ink)}

/* Myths */
.myth{display:grid;grid-template-columns:44px 1fr auto;gap:6px 16px;padding:18px 0;border-bottom:1px solid var(--sand)}
.myth .rank{font:500 11.5px/2 var(--mono);color:var(--grey)}
.myth .claim{font:400 21px/1.25 var(--display);margin:0}
.myth .side{display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.myth-teaser .claim{font-size:19px}

/* Charts */
.chart{display:block;width:100%;height:170px}
.chart .grid{stroke:var(--sand);stroke-width:1;vector-effect:non-scaling-stroke}
.chart .bar{fill:var(--forest)}
.chart .hit{fill:transparent}
.chart .bar-hit:hover .bar{fill:var(--ink)}
.chart-axis{display:flex;justify-content:space-between;font:400 11.5px var(--mono);color:var(--grey);margin-top:6px}
.tip{position:fixed;z-index:60;pointer-events:none;background:var(--ink);color:var(--cream);font:500 12.5px/1.35 var(--sans);padding:6px 9px;border-radius:6px;max-width:260px;font-variant-numeric:tabular-nums}

/* Heatmap */
.heat{display:grid;grid-template-columns:minmax(150px,200px) repeat(53,minmax(9px,1fr));gap:2px;align-items:center;min-width:820px}
.heat .rl{position:sticky;left:0;z-index:1;background:var(--paper);align-self:stretch;display:flex;align-items:center;font-size:12.5px;padding-right:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.heat .rl a{text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.heat .rl a:hover{text-decoration:underline}
.heat .cell{height:20px;border-radius:3px;background:var(--well)}
.heat .cell.none{background:transparent;border:1px dashed var(--rule)}
.heat .cell.now{outline:1.5px solid var(--ink);outline-offset:1px}
.heat .cl{font:400 10.5px var(--mono);color:var(--grey);text-align:left;white-space:nowrap}
.legend{display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--grey);margin-top:14px}
.legend i{display:inline-block;width:14px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:6px}

/* Detail */
.detail h2.q{font-size:34px;line-height:1.08;letter-spacing:-.02em;margin:4px 0 16px}
.detail .block{margin-top:26px}
.detail .block>h3{font:600 11px/1.2 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--grey);margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid var(--sand)}
.detail .actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:18px}
.cover{display:flex;gap:10px;align-items:baseline;padding:12px 14px;border-radius:8px;background:var(--well);font-size:14px}
.cover a{word-break:break-all}
.split{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:36px;align-items:start}
.split .side{position:sticky;top:20px}
.list .meter{width:100%;margin-top:8px}
.quotes{display:grid;gap:10px;margin:0;padding:0;list-style:none}
.quotes li{border-left:2px solid var(--sand);padding:2px 0 2px 14px;font-size:14px;color:var(--ink-2)}
.quotes li span{display:block;font-size:12px;color:var(--grey);margin-top:3px}

/* Drawer */
.scrim{position:fixed;inset:0;background:rgba(26,22,20,.22);z-index:40;opacity:0;transition:opacity .2s}
.scrim.open{opacity:1}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(600px,100vw);background:var(--paper);border-left:1px solid var(--rule);z-index:41;display:flex;flex-direction:column;transform:translateX(24px);opacity:0;transition:transform .24s var(--ease),opacity .18s}
.drawer.open{transform:none;opacity:1}
.drawer-bar{display:flex;justify-content:space-between;align-items:center;padding:14px 22px;border-bottom:1px solid var(--sand)}
.drawer-bar .eyebrow{margin:0}
.drawer-body{overflow-y:auto;padding:22px 26px 40px;flex:1}
.drawer-body .loading{color:var(--grey)}

/* Keys dialog */
dialog.keys{border:1px solid var(--rule);border-radius:12px;padding:24px 26px;max-width:440px;width:calc(100vw - 32px);background:var(--paper);color:var(--ink)}
dialog.keys::backdrop{background:rgba(26,22,20,.22)}
dialog.keys dl{display:grid;grid-template-columns:auto 1fr;gap:10px 18px;margin:18px 0 20px;font-size:14px}
dialog.keys dt{white-space:nowrap}dialog.keys dd{margin:0;color:var(--ink-2)}

@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media (max-width:1080px){.c-3,.c-4,.c-5{grid-column:span 6}.c-3{grid-column:span 12}.strip{grid-template-columns:repeat(3,minmax(0,1fr))}.strip a:nth-child(3n){border-right:0}.strip a:nth-child(n+4){border-top:1px solid var(--sand)}.split{grid-template-columns:1fr}.split .side{position:static}}
@media (max-width:860px){
 .wrap{padding-left:18px;padding-right:18px}
 .c-7,.c-5,.c-8,.c-4,.c-6,.c-3{grid-column:span 12}
 .mast-main{flex-direction:column;align-items:flex-start;gap:6px;padding-top:14px}
 .brand{font-size:30px;padding-bottom:4px}
 .nav{width:calc(100% + 36px);margin-left:-18px;padding:0 10px}
 .mast-top{flex-wrap:wrap}.mast-top .mono:first-child{display:none}.mast-meta .mono{display:none}
 h1{font-size:40px}
 .hero{padding:22px}.hero h2{font-size:31px}
 .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
 .kpis>div{padding:14px 12px 14px 0}.kpis>div:nth-child(2n){border-right:0;padding-left:14px}.kpis>div:nth-child(2n+1){padding-left:0}.kpis>div:nth-child(n+3){border-top:1px solid var(--sand)}
 .kpis .v{font-size:27px}
 .stats{display:grid;grid-template-columns:repeat(4,auto);gap:14px}.stats dd{font-size:19px}.stats dt{font-size:10px;letter-spacing:.06em}
 .hero-foot{flex-direction:column;align-items:stretch}.hero-foot .actions .btn-send{width:100%;padding:11px}
 .strip{grid-template-columns:repeat(2,minmax(0,1fr))}.strip a{border-right:1px solid var(--sand)!important;border-top:0!important}.strip a:nth-child(2n){border-right:0!important}.strip a:nth-child(n+3){border-top:1px solid var(--sand)!important}
 .d-only{display:none}.m-only{display:inline}
 table.q td,table.q th{padding:12px 10px}
 table.q td.rank{display:none}table.q th.rank{display:none}
 .q td.act{padding-left:0}
 .keys-btn{display:none}
 .myth{grid-template-columns:28px 1fr}.myth .side{grid-column:2;flex-direction:row;align-items:center;justify-content:space-between}
 .detail h2.q{font-size:28px}
 .drawer-body{padding:18px 18px 40px}
 .sec{margin-top:38px;flex-wrap:wrap}
 td.name{min-width:150px}
 .scroll td.rank,.scroll th.rank{display:none}
 td.sparkcell{width:120px!important;min-width:110px!important}
 .heat{grid-template-columns:132px repeat(53,14px)}
 .heatwrap{padding-left:0!important}
 .heat .rl{padding-left:14px}
 .heat>span:first-child{position:sticky;left:0;background:var(--paper);align-self:stretch;z-index:1}
}
@media (max-width:560px){
 table.q thead{display:none}
 table.q tr{display:grid;grid-template-columns:1fr auto;align-items:start}
 table.q td{border-bottom:0}
 table.q tr{border-bottom:1px solid var(--sand)}table.q tbody tr:last-child{border-bottom:0}
 table.q td.qcell{grid-column:1 / -1;padding-bottom:4px}
 table.q td.d-only{display:none}
 table.q td.covercell{padding-top:6px}
 table.q td.act{padding:6px 10px 14px;justify-self:end}
 table.q td.score{display:none}
 table.reddit td.about,table.reddit td.angle{grid-column:1 / -1;max-width:none;padding-top:2px;padding-bottom:2px}
 table.reddit td.act{grid-column:1 / -1}
}
`;
