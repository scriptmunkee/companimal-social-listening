import { EmailMessage } from "cloudflare:email";
import { PROJECT } from "../config/taxonomy";
import { Env, nowIso } from "./lib";

// Jobs expected at least once in the last 26 hours, and whether they should collect something.
const EXPECTED: { job: string; mustCollect: boolean }[] = [
  { job: "serp_post", mustCollect: false },
  { job: "youtube", mustCollect: true },
  { job: "content_analysis", mustCollect: false },
  { job: "serp_collect", mustCollect: true },
  { job: "enrich", mustCollect: false },
  { job: "rollup", mustCollect: false },
];

export interface HealthIssue { job: string; problem: string }

export async function checkHealth(env: Env): Promise<HealthIssue[]> {
  const since = new Date(Date.now() - 26 * 3600000).toISOString();
  const rows = (await env.DB.prepare(`SELECT job, status, items_seen, note FROM runs WHERE project=?1 AND started_at>=?2`).bind(PROJECT.id, since).all<any>()).results || [];
  const issues: HealthIssue[] = [];
  for (const exp of EXPECTED) {
    const runs = rows.filter((r: any) => r.job === exp.job);
    if (!runs.length) { issues.push({ job: exp.job, problem: "did not run in the last 26 hours" }); continue; }
    const errors = runs.filter((r: any) => r.status === "error");
    if (errors.length) issues.push({ job: exp.job, problem: `failed ${errors.length} of ${runs.length} times: ${String(errors[0].note).slice(0, 200)}` });
    else if (exp.mustCollect && runs.every((r: any) => !r.items_seen)) issues.push({ job: exp.job, problem: "ran but collected nothing" });
  }
  // AI health: enrichment ran on posts but the AI handled none of them
  const enrich = rows.filter((r: any) => r.job === "enrich" && r.items_seen > 0);
  if (enrich.length && enrich.every((r: any) => /ai=0\b/.test(r.note || ""))) {
    issues.push({ job: "enrich", problem: "AI model did not respond; posts were tagged by keyword rules only" });
  }
  // Unfound YouTube channels
  const missing = (await env.DB.prepare(`SELECT name FROM yt_channels WHERE status='not_found'`).all<any>()).results || [];
  if (missing.length) issues.push({ job: "youtube", problem: `UK channels not found: ${missing.map((m: any) => m.name).join(", ")}` });
  return issues;
}

function mime(from: string, to: string, subject: string, body: string) {
  const id = `<${crypto.randomUUID()}@companimal.co.uk>`;
  return [
    `From: Companimal listening <${from}>`, `To: ${to}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${id}`, `MIME-Version: 1.0`, `Content-Type: text/plain; charset=utf-8`, ``, body,
  ].join("\r\n");
}

/** Daily: record issues and email them if anything is wrong. Silent when healthy. */
export async function healthJob(env: Env) {
  const issues = await checkHealth(env);
  if (!issues.length) return { added: 0, seen: 0, note: "healthy" };
  let emailed = 0, note = `${issues.length} issues`;
  if (env.ALERTS && env.ALERT_EMAIL) {
    const from = "alerts@companimal.co.uk";
    const body = `The Companimal social listening tool found ${issues.length} problem(s) in the last day:\n\n` +
      issues.map((i) => `- ${i.job}: ${i.problem}`).join("\n") +
      `\n\nFull run log: Sources and coverage page on the dashboard.\n`;
    try {
      await env.ALERTS.send(new EmailMessage(from, env.ALERT_EMAIL, mime(from, env.ALERT_EMAIL, `Social listening: ${issues.length} issue(s) need a look`, body)));
      emailed = 1;
    } catch (e: any) { note += `; email failed: ${e?.message || e}`; }
  } else note += "; no ALERT_EMAIL set";
  await env.DB.prepare(`INSERT INTO alerts (id, project, created_at, issues_json, emailed) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(crypto.randomUUID(), PROJECT.id, nowIso(), JSON.stringify(issues), emailed).run();
  return { added: issues.length, seen: 0, note };
}
