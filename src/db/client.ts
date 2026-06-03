import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SCHEMA } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'data');
const DB_PATH = join(DATA_DIR, 'job-hunt.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.exec(SCHEMA);
  return _db;
}

export type Application = {
  id: number;
  num: number;
  date: string;
  company: string;
  role: string;
  url: string | null;
  status: string;
  score: number | null;
  pdf: number;
  report_path: string | null;
  archetype: string | null;
  remote: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string;
  legitimacy: string | null;
  notes: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export type Contact = {
  id: number;
  company: string;
  name: string;
  title: string | null;
  linkedin_url: string | null;
  email: string | null;
  connection: string;
  referral: number;
  outreach_sent: number;
  outreach_date: string | null;
  response: string | null;
  notes: string | null;
  application_id: number | null;
  created_at: string;
};

export type Followup = {
  id: number;
  application_id: number;
  due_date: string;
  type: string;
  status: string;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
};
