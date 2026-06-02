export const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS applications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  num         INTEGER UNIQUE NOT NULL,
  date        TEXT NOT NULL,
  company     TEXT NOT NULL,
  role        TEXT NOT NULL,
  url         TEXT,
  status      TEXT NOT NULL DEFAULT 'Evaluated',
  score       REAL,
  pdf         INTEGER NOT NULL DEFAULT 0,
  report_path TEXT,
  archetype   TEXT,
  remote      TEXT,
  location    TEXT,
  salary_min  INTEGER,
  salary_max  INTEGER,
  currency    TEXT DEFAULT 'USD',
  legitimacy  TEXT,
  notes       TEXT,
  source      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company      TEXT NOT NULL,
  name         TEXT NOT NULL,
  title        TEXT,
  linkedin_url TEXT,
  email        TEXT,
  connection   TEXT DEFAULT 'none',
  referral     INTEGER NOT NULL DEFAULT 0,
  outreach_sent INTEGER NOT NULL DEFAULT 0,
  outreach_date TEXT,
  response     TEXT,
  notes        TEXT,
  application_id INTEGER REFERENCES applications(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS followups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  due_date       TEXT NOT NULL,
  type           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  notes          TEXT,
  completed_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scan_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company      TEXT NOT NULL,
  role         TEXT NOT NULL,
  url          TEXT NOT NULL UNIQUE,
  portal       TEXT,
  first_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen    TEXT NOT NULL DEFAULT (datetime('now')),
  times_seen   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS skills_gap (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  skill        TEXT NOT NULL,
  times_seen   INTEGER NOT NULL DEFAULT 1,
  times_matched INTEGER NOT NULL DEFAULT 0,
  last_seen    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Proper opportunity database replacing pipeline.md
CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company      TEXT NOT NULL,
  role         TEXT NOT NULL,
  url          TEXT NOT NULL UNIQUE,
  portal       TEXT,
  location     TEXT,
  remote       INTEGER DEFAULT 0,
  salary       TEXT,
  fit_score    REAL,
  fit_label    TEXT,
  status       TEXT NOT NULL DEFAULT 'new',  -- new | reviewed | applied | skipped
  scanned_at   TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at  TEXT,
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_fit   ON pipeline_jobs(fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_status ON pipeline_jobs(status);

CREATE TABLE IF NOT EXISTS gmail_threads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id    TEXT NOT NULL UNIQUE,
  subject      TEXT,
  from_email   TEXT,
  from_name    TEXT,
  snippet      TEXT,
  date         TEXT,
  label        TEXT,  -- recruiter | interview | offer | rejection | other
  application_id INTEGER REFERENCES applications(id),
  processed    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ══════════════════════════════════════════════════════
-- GAMIFICATION TABLES
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hunter_stats (
  id            INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  total_xp      INTEGER NOT NULL DEFAULT 0,
  level         INTEGER NOT NULL DEFAULT 1,
  rank          TEXT    NOT NULL DEFAULT 'E',
  streak        INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active   TEXT,
  applications_sent INTEGER NOT NULL DEFAULT 0,
  interviews    INTEGER NOT NULL DEFAULT 0,
  offers        INTEGER NOT NULL DEFAULT 0,
  contacts_added INTEGER NOT NULL DEFAULT 0,
  jobs_evaluated INTEGER NOT NULL DEFAULT 0,
  followups_sent INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO hunter_stats (id) VALUES (1);

CREATE TABLE IF NOT EXISTS xp_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL,
  xp          INTEGER NOT NULL,
  description TEXT,
  earned_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_quests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  quest_type  TEXT NOT NULL,
  label       TEXT NOT NULL,
  target      INTEGER NOT NULL DEFAULT 1,
  progress    INTEGER NOT NULL DEFAULT 0,
  completed   INTEGER NOT NULL DEFAULT 0,
  xp_reward   INTEGER NOT NULL,
  completed_at TEXT,
  UNIQUE(date, quest_type)
);

CREATE TABLE IF NOT EXISTS achievements_unlocked (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  xp_bonus    INTEGER NOT NULL DEFAULT 0,
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_xp_log_date ON xp_log(earned_at DESC);
CREATE INDEX IF NOT EXISTS idx_quests_date ON daily_quests(date);

CREATE TABLE IF NOT EXISTS salary_data (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  role         TEXT NOT NULL,
  company      TEXT,
  location     TEXT,
  amount       INTEGER NOT NULL,
  currency     TEXT DEFAULT 'USD',
  level        TEXT,
  source       TEXT,
  date         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS applications_updated
AFTER UPDATE ON applications
BEGIN
  UPDATE applications SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_score ON applications(score);
CREATE INDEX IF NOT EXISTS idx_applications_company ON applications(company);
CREATE INDEX IF NOT EXISTS idx_scan_history_url ON scan_history(url);
CREATE INDEX IF NOT EXISTS idx_followups_due ON followups(due_date, status);
`;
