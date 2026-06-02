#!/usr/bin/env tsx
/**
 * record.ts — Log an application to SQLite + auto-schedule follow-ups
 *
 * Usage:
 *   npm run record -- --company "Ripple" --role "Senior Ecosystem Growth Manager" \
 *                     --url "https://..." --score 4.2 --status Applied
 *
 *   # Update status of existing application:
 *   npm run record -- --company "Ripple" --status Interview
 *
 *   # Mark as rejected:
 *   npm run record -- --company "Ripple" --status Rejected --notes "No feedback given"
 *
 * Auto follow-up schedule:
 *   Applied    → follow up in 7 days
 *   Interview  → thank-you note in 2 days, decision follow-up in 7 days
 *   Offer      → decision deadline reminder in 2 days
 */

import chalk from 'chalk';
import { getDb } from '../db/client.js';
import { getNextNum, insertApplication, updateApplicationStatus, scheduleFollowup } from '../db/queries.js';

// ── Parse args ────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const company   = arg('company');
const role      = arg('role');
const url       = arg('url');
const scoreRaw  = arg('score');
const status    = arg('status') ?? 'Evaluated';
const archetype = arg('archetype');
const report    = arg('report');
const notes     = arg('notes');

const VALID_STATUSES = ['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP'];

// ── Validation ────────────────────────────────────────────────────────

if (!company) {
  console.error(chalk.red('--company is required'));
  process.exit(1);
}

if (!VALID_STATUSES.includes(status)) {
  console.error(chalk.red(`Invalid status "${status}". Valid: ${VALID_STATUSES.join(', ')}`));
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const db = getDb();

  // Check if application already exists
  const existing = db.prepare(
    'SELECT id, num, status FROM applications WHERE company LIKE ? LIMIT 1'
  ).get(`%${company}%`) as { id: number; num: number; status: string } | undefined;

  if (existing) {
    // Update existing
    updateApplicationStatus(existing.id, status, notes);

    // Schedule follow-ups for new status
    autoScheduleFollowups(existing.id, status);

    console.log();
    console.log(chalk.green(`  ✓ Updated #${existing.num} ${company}`));
    console.log(`    ${chalk.dim('Status:')} ${status}`);
    if (notes) console.log(`    ${chalk.dim('Notes:')}  ${notes}`);
    printFollowupSummary(existing.id);
    console.log();

  } else {
    // Insert new application
    if (!role) {
      console.error(chalk.red('--role is required for new applications'));
      process.exit(1);
    }

    const num   = getNextNum();
    const score = scoreRaw ? parseFloat(scoreRaw) : null;
    const date  = new Date().toISOString().split('T')[0];

    const id = insertApplication({
      num, date, company, role,
      url: url ?? null,
      status,
      score,
      pdf: 0,
      report_path: report ?? null,
      archetype: archetype ?? null,
      remote: null,
      location: null,
      salary_min: null,
      salary_max: null,
      currency: 'USD',
      legitimacy: null,
      notes: notes ?? null,
      source: null,
    });

    // Schedule follow-ups
    autoScheduleFollowups(id, status);

    console.log();
    console.log(chalk.green(`  ✓ Recorded #${num} ${company} — ${role}`));
    console.log(`    ${chalk.dim('Status:')} ${status}`);
    if (score) console.log(`    ${chalk.dim('Score:')}  ${score}/5`);
    if (url)   console.log(`    ${chalk.dim('URL:')}    ${url}`);
    printFollowupSummary(id);
    console.log();
  }
}

function autoScheduleFollowups(appId: number, status: string) {
  const db = getDb();

  // Remove any existing pending follow-ups for this app (re-schedule fresh)
  db.prepare(`DELETE FROM followups WHERE application_id = ? AND status = 'pending'`).run(appId);

  switch (status) {
    case 'Applied':
      scheduleFollowup(appId, 7,  'follow-up',  'Send follow-up if no response yet');
      scheduleFollowup(appId, 14, 'check-in',   'Second follow-up or mark as dead');
      break;

    case 'Interview':
      scheduleFollowup(appId, 2, 'thank-you',      'Send thank-you note after interview');
      scheduleFollowup(appId, 7, 'decision-check', 'Follow up on hiring decision');
      break;

    case 'Responded':
      scheduleFollowup(appId, 3, 'reply', 'Respond to recruiter message');
      break;

    case 'Offer':
      scheduleFollowup(appId, 2, 'negotiate',      'Counter-offer or accept — do not delay');
      scheduleFollowup(appId, 5, 'decision-final', 'Final decision deadline');
      break;
  }
}

function printFollowupSummary(appId: number) {
  const db = getDb();
  const upcoming = db.prepare(
    `SELECT type, due_date FROM followups WHERE application_id = ? AND status = 'pending' ORDER BY due_date`
  ).all(appId) as { type: string; due_date: string }[];

  if (upcoming.length) {
    console.log(`    ${chalk.dim('Follow-ups scheduled:')}`);
    for (const f of upcoming) {
      console.log(`      ${chalk.dim('→')} ${f.type} on ${chalk.yellow(f.due_date)}`);
    }
  }
}

main();
