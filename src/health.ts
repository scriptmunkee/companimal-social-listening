// Health alerts (daily, only when something is wrong) and the Monday email of the week's top moves.
import { EmailMessage } from "cloudflare:email";
import { PROJECT } from "../config/taxonomy";
import { Env, nowIso, today } from "./lib";
import { TYPES } from "./insights";

// Jobs expected at least once in the last 26 hours, and whether they should collect something.
const EXPECTED: { job: string; mustCollect: boolean }[] = [
  { job: "serp_post", mustCollect: false },
  { job: "reddit_post", mustCollect: false },
  { job: "reddit_insights", mustCollect: false },
  { job: "youtube", mustCollect: true },
  { job: "content_analysis", mustCollect: false },
  { job: "serp_collect", mustCollect: true },
  { job: "enrich", mustCollect: false },
  { job: "rollup", mustCollect: false },
  { job: "insights", mustCollect: false },
];
const DAILY_BUDGET_USD = 0.5; // Serpent spend ceiling before an alert
const FROM = "alerts@companimal.co.uk";

export interface HealthIssue { job: string; problem: string }

export async function checkHealth(env: Env): Promise<HealthIssue[]> {
  const since = new Date(Date.now() - 26 * 3600000).toISOString();
  const rows = (await env.DB.prepare(`SELECT job, status, items_seen, note, started_at FROM runs WHERE project=?1 AND started_at>=?2`).bind(PROJECT.id, since).all<any>()).results || [];
  const issues: HealthIssue[] = [];
  const first = await env.DB.prepare(`SELECT MIN(started_at) AS t FROM runs WHERE project=?1`).bind(PROJECT.id).first<any>();
  const young = !first?.t || first.t > since; // under 26 hours old: not every job has had its turn
  if (!env.SERPENT_API_KEY && env.MOCK !== "1") issues.push({ job: "setup", problem: "SERPENT_API_KEY is not set, so Reddit falls back to Google's index (no upvotes, bodies or replies)" });
  const expected = env.SERPENT_API_KEY ? [...EXPECTED, { job: "reddit_feeds", mustCollect: true }, { job: "reddit_comments", mustCollect: false }] : EXPECTED;
  // New jobs get a day's grace after they first appear
  const firstRun = new Map(((await env.DB.prepare(`SELECT job, MIN(started_at) AS t FROM runs WHERE project=?1 GROUP BY job`).bind(PROJECT.id).all<any>()).results || []).map((r: any) => [r.job, r.t]));
  for (const exp of expected) {
    const runs = rows.filter((r: any) => r.job === exp.job);
    if (!runs.length) { if (young || !firstRun.has(exp.job) && exp.job === "insights") continue; issues.push({ job: exp.job, problem: "did not run in the last 26 hours" }); continue; }
    const latest = [...runs].sort((a: any, b: any) => (a.started_at < b.started_at ? 1 : -1))[0];
    const errors = latest.status === "error" ? runs.filter((r: any) => r.status === "error") : [];
    if (errors.length) issues.push({ job: exp.job, problem: `failed ${errors.length} of ${runs.length} times: ${String(errors[0].note).slice(0, 200)}` });
    else if (exp.mustCollect && runs.every((r: any) => !r.items_seen)) issues.push({ job: exp.job, problem: "ran but collected nothing" });
  }
  // AI health: the reading ran on posts but the AI handled none of them, three runs in a row
  for (const job of ["enrich", "reddit_insights"]) {
    const recent = rows.filter((r: any) => r.job === job && r.items_seen > 0).sort((a: any, b: any) => (a.started_at < b.started_at ? 1 : -1)).slice(0, 3);
    if (recent.length >= 3 && recent.every((r: any) => /ai=0\b/.test(r.note || ""))) issues.push({ job, problem: "the AI model is not answering; posts are waiting or being tagged by keyword rules only" });
  }
  // Unfound YouTube channels
  const missing = (await env.DB.prepare(`SELECT name FROM yt_channels WHERE status='not_found'`).all<any>()).results || [];
  if (missing.length) issues.push({ job: "youtube", problem: `UK channels not found: ${missing.map((m: any) => m.name).join(", ")}` });
  // Spend
  const spend = await env.DB.prepare(`SELECT COALESCE(SUM(units),0) AS u FROM api_usage WHERE day=?1 AND api='serpent'`).bind(today()).first<any>();
  const usd = (spend?.u || 0) * 0.12 / 1000;
  if (usd > DAILY_BUDGET_USD) issues.push({ job: "budget", problem: `Serpent spend today is $${usd.toFixed(2)}, over the $${DAILY_BUDGET_USD.toFixed(2)} daily ceiling` });
  // The site's pages: if the sitemap is blocked, moves point at an old inventory
  const site = await env.DB.prepare(`SELECT status, note FROM runs WHERE project=?1 AND job='site' ORDER BY started_at DESC LIMIT 1`).bind(PROJECT.id).first<any>();
  if (site?.status === "error") issues.push({ job: "site", problem: `couldn't read companimal.co.uk's sitemap: ${String(site.note).slice(0, 320)}` });
  return issues;
}

function mime(to: string, subject: string, text: string, html?: string) {
  const id = `<${crypto.randomUUID()}@companimal.co.uk>`;
  const head = [`From: Companimal listening <${FROM}>`, `To: ${to}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, `Message-ID: ${id}`, `MIME-Version: 1.0`];
  if (!html) return [...head, `Content-Type: text/plain; charset=utf-8`, ``, text].join("\r\n");
  const b = `b${crypto.randomUUID().replace(/-/g, "")}`;
  return [...head, `Content-Type: multipart/alternative; boundary="${b}"`, ``, `--${b}`, `Content-Type: text/plain; charset=utf-8`, ``, text, `--${b}`, `Content-Type: text/html; charset=utf-8`, ``, html, `--${b}--`].join("\r\n");
}

async function send(env: Env, subject: string, text: string, html?: string): Promise<string | null> {
  if (!env.ALERTS || !env.ALERT_EMAIL) return "no ALERT_EMAIL set";
  try { await env.ALERTS.send(new EmailMessage(FROM, env.ALERT_EMAIL, mime(env.ALERT_EMAIL, subject, text, html))); return null; }
  catch (e: any) { return `email failed: ${e?.message || e}`; }
}

/** Daily: record issues and email them if anything is wrong. Silent when healthy. */
export async function healthJob(env: Env) {
  const issues = await checkHealth(env);
  if (!issues.length) return { added: 0, seen: 0, note: "healthy" };
  const err = await send(env, `Social listening: ${issues.length} issue(s) need a look`,
    `The Companimal social listening tool found ${issues.length} problem(s) in the last day:\n\n${issues.map((i) => `- ${i.job}: ${i.problem}`).join("\n")}\n\nRun log: the Sources page on the dashboard.\n`);
  await env.DB.prepare(`INSERT INTO alerts (id, project, created_at, issues_json, emailed) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(crypto.randomUUID(), PROJECT.id, nowIso(), JSON.stringify(issues), err ? 0 : 1).run();
  return { added: issues.length, seen: 0, note: err ? `${issues.length} issues; ${err}` : `${issues.length} issues; emailed` };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Monday morning: the five moves for the week, so the dashboard doesn't have to be opened to act. */
export async function weeklyDigest(env: Env, dashboardUrl: string) {
  const top = (await env.DB.prepare(`SELECT id, type, status, headline, so_what, action, target_url FROM insights WHERE project=?1 AND status IN ('new','planned') AND last_seen_date >= date('now','-7 day') ORDER BY priority DESC LIMIT 5`).bind(PROJECT.id).all<any>()).results || [];
  if (!top.length) return { added: 0, seen: 0, note: "nothing to send" };
  const issues = await checkHealth(env);
  const health = issues.length ? `${issues.length} collection issue${issues.length === 1 ? "" : "s"} to look at: ${issues.map((i) => i.job).join(", ")}.` : "All collectors healthy.";
  const link = (id: string) => `${dashboardUrl}/move/${id}`;
  const text = `This week's moves for companimal.co.uk\n\n${top.map((c: any, i: number) => `${i + 1}. ${c.headline}\n   ${c.so_what}\n   Do: ${c.action}${c.target_url ? ` (${c.target_url})` : ""}\n   ${link(c.id)}`).join("\n\n")}\n\n${health}\nAll moves: ${dashboardUrl}\n`;
  const html = `<div style="font:15px/1.5 Georgia,serif;color:#1A1614;background:#F8F4EE;padding:28px;max-width:640px">
<p style="font:600 11px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#766F61;margin:0 0 10px">This week's moves</p>
<h1 style="font:400 30px/1.1 Georgia,serif;margin:0 0 6px;letter-spacing:-.02em">Comp<span style="color:#C8552D">animal</span></h1>
<p style="font:14px/1.5 Arial,sans-serif;color:#766F61;margin:0 0 18px">${esc(health)}</p>
${top.map((c: any, i: number) => `<div style="border-top:1px solid #E8E4DD;padding:16px 0"><p style="font:600 11px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#2F4A3A;margin:0 0 8px">${i + 1} · ${esc(TYPES[c.type]?.label || c.type)}${c.status === "planned" ? " · Planned" : ""}</p>
<p style="font:400 21px/1.25 Georgia,serif;margin:0 0 6px">${esc(c.headline)}</p><p style="font:14px/1.5 Arial,sans-serif;margin:0 0 8px;color:#3D3732">${esc(c.so_what)}</p>
<p style="font:14px/1.5 Arial,sans-serif;margin:0"><a href="${esc(link(c.id))}" style="color:#C8552D;font-weight:600">${esc(c.action)}</a>${c.target_url ? ` <span style="color:#766F61;font-family:monospace;font-size:12px">${esc(c.target_url)}</span>` : ""}</p></div>`).join("")}
<p style="font:14px/1.5 Arial,sans-serif;margin:20px 0 0"><a href="${esc(dashboardUrl)}" style="color:#2F4A3A">Open the listening desk</a></p></div>`;
  const err = await send(env, `This week: ${top[0].headline}`, text, html);
  return { added: top.length, seen: top.length, note: err || "sent" };
}
