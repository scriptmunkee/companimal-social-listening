-- Normalised items collected from every source. Raw responses live in R2 (raw_key).
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,               -- source:source_id
  project TEXT NOT NULL,
  source TEXT NOT NULL,              -- youtube | serp_forum | serp_paa | serp_discussions | content_analysis
  source_id TEXT NOT NULL,
  url TEXT,
  title TEXT,
  text TEXT,
  community TEXT,                    -- subreddit, channel, domain
  author_hash TEXT,                  -- hashed, never the username
  published_at TEXT,
  collected_at TEXT NOT NULL,
  collected_date TEXT NOT NULL,      -- YYYY-MM-DD
  query TEXT,
  query_version TEXT,
  engagement INTEGER DEFAULT 0,      -- likes, upvotes, replies where known
  raw_key TEXT,
  enriched INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_date ON items(project, collected_date);
CREATE INDEX IF NOT EXISTS idx_items_enriched ON items(enriched);

CREATE TABLE IF NOT EXISTS enrichments (
  item_id TEXT PRIMARY KEY,
  kind TEXT,                         -- question | problem | recommendation | myth | story | opinion | other
  question TEXT,
  topic TEXT,
  lens TEXT,
  sentiment TEXT,
  matched_url TEXT,
  match_score REAL,
  model TEXT,
  enriched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_enr_topic ON enrichments(topic);
CREATE INDEX IF NOT EXISTS idx_enr_kind ON enrichments(kind);

-- Coverage log: one row per collector run, so data gaps are visible.
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT,
  items_new INTEGER DEFAULT 0,
  items_seen INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);

-- Pending DataForSEO standard-queue tasks.
CREATE TABLE IF NOT EXISTS serp_tasks (
  task_id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  kind TEXT NOT NULL,                -- forum | paa
  query TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  fetched_at TEXT
);

-- Daily rollups: kept forever, no personal data.
CREATE TABLE IF NOT EXISTS daily_topic_counts (
  project TEXT NOT NULL,
  date TEXT NOT NULL,
  topic TEXT NOT NULL,
  lens TEXT NOT NULL,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL,
  engagement INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project, date, topic, lens, kind)
);

-- Query set history, so trend changes can be traced to query changes.
CREATE TABLE IF NOT EXISTS query_versions (
  version TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  config_json TEXT NOT NULL
);

-- Site URLs for content gap matching.
CREATE TABLE IF NOT EXISTS site_urls (
  project TEXT NOT NULL,
  url TEXT NOT NULL,
  tokens TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project, url)
);

-- Opportunities sent to the content pipeline.
CREATE TABLE IF NOT EXISTS pipeline_queue (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  topic TEXT NOT NULL,
  question TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
);
