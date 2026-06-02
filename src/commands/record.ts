#!/usr/bin/env tsx
/**
 * record.ts — Log an application to SQLite + auto-schedule follow-ups + award XP
 */

import chalk from 'chalk';
import { getDb } from '../db/client.js';
import { getNextNum, insertApplication, updateApplicationStatus, scheduleFollowup } from '../db/queries.js';
import { awardXP, ensureDailyQuests, printAward, type XPAction } from '../utils/gamification.js';

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

if (!company) { console.error(chalk.red('--company is required')); process.exit(1); }
if (!VALID_STATUSES.includes(status)) { console.error(chalk.red(`Invalid status "${status}"`)); process.exit(1); }

// ── Status → XP action map ────────────────────────────────────────────

const STATUS_XP: Partial<Record<string, XPAction>> = {
  Evaluated:  'EVALUATE_JOB',
  Applied:    'APPLY_JOB',
  Responded:  'GOT_REPLY',
  Interview:  'GOT_INTERVIEW',
  Offer:      'GOT_OFFER',
};

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const db = getDb();
  ensureDailyQuests();

  const existing = db.prepare(
    'SELECT id, num, status FROM applications WHERE company LIKE ? LIMIT 1'
  ).get(`%${company}%`) as { id: number; num: number; status: string } | undefined;

  if (existing) {
    updateApplicationStatus(existing.id, status, notes);
    autoScheduleFollowups(existing.id, status);

    console.log();
    console.log(chalk.green(`  ✓ Updated #${existing.num} ${company}`));
    console.log(`    ${chalk.dim('Status:')} ${status}`);
    if (notes) console.log(`    ${chalk.dim('Notes:')}  ${notes}`);
    printFollowupSummary(existing.id);

  } else {
    if (!role) { console.error(chalk.red('--role is required for new applications')); process.exit(1); }

    const num   = getNextNum();
    const score = scoreRaw ? parseFloat(scoreRaw) : null;
    const date  = new Date().toISOString().split('T')[0];

    const id = insertApplication({
      num, date, company: company!, role,
      url: url ?? null, status, score, pdf: 0,
      report_path: report ?? null, archetype: archetype ?? null,
      remote: null, location: null, salary_min: null, salary_max: null,
      currency: 'USD', legitimacy: null, notes: notes ?? null, source: null,
    });

    autoScheduleFollowups(id, status);

    console.log();
    console.log(chalk.green(`  ✓ Recorded #${num} ${company} — ${role}`));
    console.log(`    ${chalk.dim('Status:')} ${status}`);
    if (score) console.log(`    ${chalk.dim('Score:')}  ${score}/5`);
    if (url)   console.log(`    ${chalk.dim('URL:')}    ${url}`);
    printFollowupSummary(id);

    // Night raid achievement
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5 && status === 'Applied') {
      awardXP('APPLY_JOB', `Night raid — ${company}`);
    }
  }

  // Award XP for this status change
  const xpAction = STATUS_XP[status];
  if (xpAction) {
    const result = awardXP(xpAction, `${company} → ${status}`);
    console.log();
    printAward(result, chalk as Parameters<typeof printAward>[1]);
  }

  console.log();
}

function autoScheduleFollowups(appId: number, status: string) {
  const db = getDb();
  db.prepare(`DELETE FROM followups WHERE application_id = ? AND status = 'pending'`).run(appId);
  switch (status) {
    case 'Applied':
      scheduleFollowup(appId, 7,  'follow-up', 'Send follow-up if no response yet');
      scheduleFollowup(appId, 14, 'check-in',  'Second follow-up or mark as dead');
      break;
    case 'Interview':
      scheduleFollowup(appId, 2, 'thank-you',      'Send thank-you note');
      scheduleFollowup(appId, 7, 'decision-check', 'Follow up on decision');
      break;
    case 'Responded':
      scheduleFollowup(appId, 3, 'reply', 'Respond to recruiter');
      break;
    case 'Offer':
      scheduleFollowup(appId, 2, 'negotiate',      'Counter-offer or accept — do not delay');
      scheduleFollowup(appId, 5, 'decision-final', 'Final decision deadline');
      break;
  }
}

function printFollowupSummary(appId: number) {
  const db = getDb();
  const upcoming = db.prepare(`SELECT type, due_date FROM followups WHERE application_id = ? AND status = 'pending' ORDER BY due_date`).all(appId) as { type: string; due_date: string }[];
  if (upcoming.length) {
    console.log(`    ${chalk.dim('Follow-ups:')}`);
    for (const f of upcoming) console.log(`      ${chalk.dim('→')} ${f.type} on ${chalk.yellow(f.due_date)}`);
  }
}

main();
