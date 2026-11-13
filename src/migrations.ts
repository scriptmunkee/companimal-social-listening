// Schema changes the Worker applies to itself on startup, so deploys from GitHub
// never need a separate migration step. Append new entries; never edit old ones.
// 0001 and 0002 mirror migrations/*.sql (all IF NOT EXISTS, so safe to re-run).
import type { Env } from "./lib";

const MIGRATIONS: { name: string; sql: string[] }[] = [
  {
    name: "0003_region",
    sql: [
      `ALTER TABLE enrichments ADD COLUMN region TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_enr_region ON enrichments(region)`,
      `CREATE TABLE IF NOT EXISTS daily_counts (
        project TEXT NOT NULL, date TEXT NOT NULL, topic TEXT NOT NULL, lens TEXT NOT NULL,
        kind TEXT NOT NULL, region TEXT NOT NULL, n INTEGER NOT NULL, engagement INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project, date, topic, lens, kind, region))`,
      // Re-run enrichment on everything collected so far so it gets a region tag
      `UPDATE items SET enriched=0`,
    ],
  },
  {
    name: "0004_youtube_channels",
    sql: [
      `CREATE TABLE IF NOT EXISTS yt_channels (
        name TEXT PRIMARY KEY, channel_id TEXT, title TEXT, resolved_at TEXT, status TEXT)`,
    ],
  },
  {
    name: "0005_alerts",
    sql: [
      `CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, created_at TEXT NOT NULL, issues_json TEXT NOT NULL, emailed INTEGER DEFAULT 0)`,
    ],
  },
];

let checked = false;

export async function ensureSchema(env: Env): Promise<void> {
  if (checked) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`).run();
  const done = new Set(((await env.DB.prepare(`SELECT name FROM _app_migrations`).all<any>()).results || []).map((r: any) => r.name));
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    for (const stmt of m.sql) {
      try {
        await env.DB.prepare(stmt).run();
      } catch (e: any) {
        // Re-running an ADD COLUMN that already exists is fine
        if (!/duplicate column/i.test(String(e?.message))) throw e;
      }
    }
    await env.DB.prepare(`INSERT OR IGNORE INTO _app_migrations (name, applied_at) VALUES (?1, ?2)`).bind(m.name, new Date().toISOString()).run();
  }
  checked = true;
}
