CREATE TABLE IF NOT EXISTS briefs (
  project TEXT NOT NULL,
  date TEXT NOT NULL,
  body_json TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project, date)
);
