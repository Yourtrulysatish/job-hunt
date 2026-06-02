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
