import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { createInterface } from 'readline';

const TURSO_URL   = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('Set TURSO_URL and TURSO_AUTH_TOKEN');
  process.exit(1);
}

const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

// 1. Create schema
const schemaSrc = readFileSync(new URL('../src/db/schema.ts', import.meta.url), 'utf8');
const schema = schemaSrc.match(/`([\s\S]+)`/)[1].replace(/PRAGMA\s+[^;]+;\s*/g, '');
await db.executeMultiple(schema);
console.log('✓ Schema created');

// 2. Import INSERT statements from stdin
const inserts = [];
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (line.startsWith('INSERT')) inserts.push(line);
}

let count = 0;
for (const sql of inserts) {
  try { await db.execute(sql); count++; } catch {}
}
console.log(`✓ Imported ${count} rows`);
process.exit(0);
