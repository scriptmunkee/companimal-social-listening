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
  {
    name: "0006_relevance_reclassify",
    sql: [`UPDATE items SET enriched=0`],
  },
  {
    // One-off catch-up after the relevance fixes: run everything now instead of waiting for tomorrow
    name: "0007_catch_up",
    sql: [
      `CREATE TABLE IF NOT EXISTS pending_jobs (job TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
      `INSERT OR IGNORE INTO pending_jobs (job, created_at) VALUES ('sitemap', datetime('now')), ('collect', datetime('now')), ('paa', datetime('now')), ('morning_when_ready', datetime('now'))`,
    ],
  },
  {
    // Read subreddits now rather than waiting for 02:00; brief rebuilt once analysed
    name: "0008_subreddits_now",
    sql: [`INSERT OR IGNORE INTO pending_jobs (job, created_at) VALUES ('subreddits', datetime('now')), ('morning_when_ready', datetime('now'))`],
  },
  {
    name: "0009_reddit",
    sql: [
      // One row per Reddit thread (keyed by Reddit's own post id), updated on every sighting
      `CREATE TABLE IF NOT EXISTS reddit_threads (
        post_id TEXT PRIMARY KEY, project TEXT NOT NULL, subreddit TEXT, url TEXT, title TEXT, snippet TEXT,
        created_at TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, seen_count INTEGER DEFAULT 1,
        best_rank INTEGER, posts_count INTEGER, posts_count_prev INTEGER, posts_count_max INTEGER DEFAULT 0,
        via TEXT, insight_done INTEGER DEFAULT 0)`,
      `CREATE INDEX IF NOT EXISTS idx_rt_last ON reddit_threads(project, last_seen)`,
      `CREATE INDEX IF NOT EXISTS idx_rt_sub ON reddit_threads(subreddit)`,
      `CREATE INDEX IF NOT EXISTS idx_rt_ins ON reddit_threads(insight_done)`,
      // Every sighting: which search found it, at what rank, with what comment count (growth history)
      `CREATE TABLE IF NOT EXISTS reddit_thread_hits (
        post_id TEXT NOT NULL, seen_date TEXT NOT NULL, query TEXT NOT NULL, rank INTEGER, posts_count INTEGER, via TEXT,
        PRIMARY KEY (post_id, seen_date, query))`,
      // AI reading of each thread: what it is, what's going on, what to write
      `CREATE TABLE IF NOT EXISTS reddit_insights (
        post_id TEXT PRIMARY KEY, kind TEXT, theme TEXT, pain_point TEXT, need TEXT, emotion TEXT,
        content_angle TEXT, lens TEXT, topic TEXT, region TEXT, model TEXT, created_at TEXT)`,
      `CREATE INDEX IF NOT EXISTS idx_ri_theme ON reddit_insights(theme)`,
      // Daily snapshot of the week's conversation themes
      `CREATE TABLE IF NOT EXISTS reddit_themes (
        project TEXT NOT NULL, date TEXT NOT NULL, theme TEXT NOT NULL, summary TEXT, why TEXT, ideas_json TEXT,
        thread_ids_json TEXT, thread_count INTEGER, sentiment TEXT, model TEXT, created_at TEXT,
        PRIMARY KEY (project, date, theme))`,
      // Topic searches run, so harvested questions aren't searched twice in a month
      `CREATE TABLE IF NOT EXISTS reddit_queries (query TEXT PRIMARY KEY, source TEXT, last_run TEXT, runs INTEGER DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, until TEXT NOT NULL)`,
    ],
  },
  {
    // Fold earlier Reddit results into the registry, then run the full Reddit sweep now
    name: "0010_reddit_now",
    sql: [`INSERT OR IGNORE INTO pending_jobs (job, created_at) VALUES ('reddit_backfill_items', datetime('now')), ('reddit_now', datetime('now')), ('reddit_themes_when_ready', datetime('now'))`],
  },
  {
    name: "0011_insight_attempts",
    sql: [`ALTER TABLE reddit_threads ADD COLUMN insight_attempts INTEGER DEFAULT 0`],
  },
  {
    name: "0012_rebuild_themes",
    sql: [`INSERT OR IGNORE INTO pending_jobs (job, created_at) VALUES ('reddit_themes_now', datetime('now'))`],
  },
  {
    name: "0013_rebuild_themes_strong_model",
    sql: [`INSERT OR IGNORE INTO pending_jobs (job, created_at) VALUES ('reddit_themes_now', datetime('now'))`],
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
