#!/usr/bin/env tsx
/**
 * verify.ts — Pipeline integrity checker
 *
 * Checks:
 * 1. All statuses are canonical
 * 2. No duplicate company+role entries
 * 3. All report_path links point to existing files
 * 4. Scores are in valid range (0–5)
 * 5. No orphaned followups (application_id missing)
 * 6. DB schema tables all exist
 *
 * Usage:
 *   tsx src/commands/verify.ts
 *   tsx src/commands/verify.ts --fix   # auto-fix fixable issues
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/client.js';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const CANONICAL_STATUSES = ['evaluated', 'applied', 'responded', 'interview', 'offer', 'rejected', 'discarded', 'skip'];

const args = process.argv.slice(2);
const FIX = args.includes('--fix');

type Issue = { severity: 'error' | 'warn'; message: string; fixable: boolean; fix?: () => void };

function main() {
  const db = getDb();
  const issues: Issue[] = [];

  console.log(chalk.bold('\n  Verifying pipeline integrity…\n'));

  // ── 1. Schema tables exist ─────────────────────────────────────────
  const requiredTables = ['applications', 'followups', 'contacts', 'pipeline_jobs', 'skills_gap', 'scan_history', 'hunter_stats', 'daily_quests', 'xp_log', 'achievements_unlocked'];
  const existingTables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name)
  );
  for (const t of requiredTables) {
    if (!existingTables.has(t)) {
      issues.push({ severity: 'error', message: `Missing table: ${t}`, fixable: false });
    }
  }

  // ── 2. Applications: canonical statuses ───────────────────────────
  const apps = db.prepare('SELECT id, num, company, role, status, score, report_path FROM applications').all() as {
    id: number; num: number; company: string; role: string; status: string; score: number | null; report_path: string | null;
  }[];

  for (const a of apps) {
    const s = a.status.toLowerCase();
    if (!CANONICAL_STATUSES.includes(s)) {
      issues.push({
        severity: 'error',
        message: `#${a.num} ${a.company} — non-canonical status: "${a.status}"`,
        fixable: false,
      });
    }
  }

  // ── 3. Duplicate company+role ─────────────────────────────────────
  const seen = new Map<string, number>();
  for (const a of apps) {
    const key = `${a.company.toLowerCase()}::${a.role.toLowerCase()}`;
    if (seen.has(key)) {
      issues.push({ severity: 'warn', message: `Duplicate entry: ${a.company} — ${a.role} (nums ${seen.get(key)} and ${a.num})`, fixable: false });
    } else {
      seen.set(key, a.num);
    }
  }

  // ── 4. Report paths exist ─────────────────────────────────────────
  for (const a of apps) {
    if (a.report_path && !existsSync(join(ROOT, a.report_path))) {
      issues.push({
        severity: 'warn',
        message: `#${a.num} ${a.company} — report_path not found: ${a.report_path}`,
        fixable: FIX,
        fix: () => db.prepare("UPDATE applications SET report_path = NULL WHERE id = ?").run(a.id),
      });
    }
  }

  // ── 5. Scores in range ────────────────────────────────────────────
  for (const a of apps) {
    if (a.score != null && (a.score < 0 || a.score > 5)) {
      issues.push({ severity: 'error', message: `#${a.num} ${a.company} — score out of range: ${a.score}`, fixable: false });
    }
  }

  // ── 6. Orphaned followups ─────────────────────────────────────────
  const orphaned = db.prepare(`
    SELECT f.id FROM followups f
    LEFT JOIN applications a ON f.application_id = a.id
    WHERE a.id IS NULL
  `).all() as { id: number }[];
  for (const f of orphaned) {
    issues.push({
      severity: 'error',
      message: `Orphaned followup id=${f.id} (application deleted)`,
      fixable: FIX,
      fix: () => db.prepare("DELETE FROM followups WHERE id = ?").run(f.id),
    });
  }

  // ── 7. Hunter stats singleton ─────────────────────────────────────
  const hunterRow = db.prepare('SELECT COUNT(*) as c FROM hunter_stats').get() as { c: number };
  if (hunterRow.c === 0) {
    issues.push({
      severity: 'error',
      message: 'hunter_stats has no row — gamification broken',
      fixable: FIX,
      fix: () => db.prepare('INSERT OR IGNORE INTO hunter_stats (id) VALUES (1)').run(),
    });
  }

  // ── Apply fixes ────────────────────────────────────────────────────
  const errors   = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warn');

  if (FIX) {
    const fixable = issues.filter(i => i.fixable && i.fix);
    for (const issue of fixable) issue.fix!();
    if (fixable.length) console.log(chalk.green(`  Auto-fixed ${fixable.length} issue(s)\n`));
  }

  // ── Report ─────────────────────────────────────────────────────────
  if (!issues.length) {
    console.log(chalk.green(`  ✓ All checks passed (${apps.length} applications, ${requiredTables.length} tables)\n`));
    return;
  }

  for (const i of errors)   console.log(chalk.red(`  ✗ ERROR  ${i.message}${i.fixable ? '' : ''}`));
  for (const i of warnings) console.log(chalk.yellow(`  ⚠ WARN   ${i.message}${i.fixable ? chalk.dim(' (--fix to repair)') : ''}`));

  console.log(`\n  ${chalk.red(errors.length + ' errors')}  ${chalk.yellow(warnings.length + ' warnings')}`);
  if (!FIX && issues.some(i => i.fixable)) {
    console.log(chalk.dim('  Run with --fix to auto-repair fixable issues.'));
  }
  console.log('');

  if (errors.length > 0) process.exit(1);
}

main();
