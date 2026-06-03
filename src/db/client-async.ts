import { createClient, type Client } from '@libsql/client';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SCHEMA } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'data');
const DB_URL = process.env.TURSO_URL ?? `file:${join(DATA_DIR, 'job-hunt.db')}`;

let _client: Client | null = null;
let _ready = false;

export function getAsyncDb(): Client {
  if (!_client) {
    if (DB_URL.startsWith('file:')) mkdirSync(DATA_DIR, { recursive: true });
    _client = createClient({ url: DB_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _client;
}

export async function initDb(): Promise<void> {
  if (_ready) return;
  _ready = true;
  const db = getAsyncDb();
  const sql = DB_URL.startsWith('file:')
    ? SCHEMA
    : SCHEMA.replace(/PRAGMA\s+[^;]+;\s*/g, '');
  await db.executeMultiple(sql);
}
