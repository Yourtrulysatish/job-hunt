#!/usr/bin/env tsx
/**
 * brief.ts — Morning briefing
 *
 * Prints a clean daily summary:
 *   - Top unreviewed jobs scored 3.5+ from pipeline
 *   - Follow-ups due today or overdue
 *   - Active pipeline status
 *
 * Usage:
 *   npm run brief
 *   tsx src/commands/brief.ts
 *   tsx src/commands/brief.ts --json   (machine-readable output)
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { getDb } from '../db/client.js';
import { scoreJob } from '../utils/scorer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..', '..');
const JSON_MODE = process.argv.includes('--json');

// ── Helpers ───────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function bar(label: string, value: string | number, color = chalk.white) {
  const l = chalk.dim(label.padEnd(18));
  return `  ${l} ${color(String(value))}`;
}

function divider(title = '') {
  const line = '─'.repeat(50);
  return title
    ? chalk.dim(line.slice(0, 2)) + ' ' + chalk.bold(title) + ' ' + chalk.dim(line.slice(title.length + 4))
    : chalk.dim(line);
}

// ── Parse pipeline.md for unreviewed top jobs ─────────────────────────

interface PipelineJob {
  company: string;
  role: string;
  url: string;
  portal: string;
  location: string;
  fit_score: number;
  fit_label: string;
}

function getTopPipelineJobs(limit = 5): PipelineJob[] {
  const path = join(ROOT, 'data', 'pipeline.md');
  if (!existsSync(path)) return [];

  const text  = readFileSync(path, 'utf8');
  const jobs: PipelineJob[] = [];
  let current: Partial<PipelineJob> | null = null;
  let section = '';

  for (const line of text.split('\n')) {
    const sec = line.match(/^###\s+Source:\s*(.+)$/i);
    if (sec) { section = sec[1].trim(); continue; }

    const m = line.match(/^- \[( )\] \*\*(.+?)\*\* — (.+?)(?:\s·\s(.+))?$/);
    if (m) {
      current = { company: m[2], role: m[3].trim(), location: m[4]?.trim() ?? '', portal: section };
      jobs.push(current as PipelineJob);
    } else if (current) {
      const u = line.match(/^\s+URL:\s*(.+)$/);
      const p = line.match(/^\s+Portal:\s*(.+)$/);
      if (u) current.url = u[1].trim();
      if (p && !current.portal) current.portal = p[1].trim();
    }
  }

  // Score and sort
  for (const j of jobs) {
    const s = scoreJob({ role: j.role, company: j.company, location: j.location, portal: j.portal });
    j.fit_score = s.score;
    j.fit_label = s.label;
  }

  return jobs
    .filter(j => j.fit_score >= 3.5 && j.url)
    .sort((a, b) => b.fit_score - a.fit_score)
    .slice(0, limit);
}

// ── DB queries ────────────────────────────────────────────────────────

function getPipelineStats() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM applications
    WHERE status NOT IN ('Rejected','Discarded','SKIP')
    GROUP BY status
  `).all() as { status: string; count: number }[];
  return rows;
}

function getDueFollowups() {
  const db = getDb();
  return db.prepare(`
    SELECT f.id, f.due_date, f.type, f.notes,
           a.company, a.role, a.url, a.status
    FROM followups f
    JOIN applications a ON f.application_id = a.id
    WHERE f.status = 'pending' AND f.due_date <= date('now', '+1 day')
    ORDER BY f.due_date ASC
  `).all() as { id: number; due_date: string; type: string; notes: string; company: string; role: string; url: string; status: string }[];
}

function getRecentApplications(days = 7) {
  const db = getDb();
  return db.prepare(`
    SELECT company, role, status, score, date
    FROM applications
    WHERE date >= date('now', '-${days} days')
    ORDER BY date DESC
    LIMIT 10
  `).all() as { company: string; role: string; status: string; score: number; date: string }[];
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const topJobs   = getTopPipelineJobs(5);
  const stats     = getPipelineStats();
  const followups = getDueFollowups();
  const recent    = getRecentApplications(7);

  if (JSON_MODE) {
    console.log(JSON.stringify({ topJobs, stats, followups, recent }, null, 2));
    return;
  }

  const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  console.log();
  console.log(chalk.bold.white('  JOB HUNT BRIEFING') + chalk.dim(` — ${dateStr}`));
  console.log('  ' + divider());
  console.log();

  // ── Follow-ups (highest urgency) ──────────────────────────────────
  const overdue  = followups.filter(f => f.due_date < today());
  const dueToday = followups.filter(f => f.due_date === today());
  const dueSoon  = followups.filter(f => f.due_date > today());

  if (followups.length) {
    console.log('  ' + chalk.red.bold('⚡ ACTION REQUIRED'));
    console.log();

    for (const f of overdue) {
      const ago = daysAgo(f.due_date);
      console.log(`  ${chalk.red('●')} ${chalk.bold(f.company)} — ${f.role}`);
      console.log(`    ${chalk.red(`${f.type} overdue by ${ago} day${ago !== 1 ? 's' : ''}`)} · status: ${f.status}`);
      if (f.url) console.log(chalk.dim(`    ${f.url}`));
      console.log();
    }

    for (const f of dueToday) {
      console.log(`  ${chalk.yellow('●')} ${chalk.bold(f.company)} — ${f.role}`);
      console.log(`    ${chalk.yellow(`${f.type} due today`)} · status: ${f.status}`);
      if (f.url) console.log(chalk.dim(`    ${f.url}`));
      console.log();
    }

    for (const f of dueSoon) {
      console.log(`  ${chalk.dim('●')} ${chalk.dim(f.company)} — ${chalk.dim(f.role)}`);
      console.log(chalk.dim(`    ${f.type} due ${f.due_date}`));
      console.log();
    }

    console.log('  ' + divider());
    console.log();
  } else {
    console.log('  ' + chalk.green('✓ No follow-ups due today'));
    console.log();
  }

  // ── Top job picks ─────────────────────────────────────────────────
  if (topJobs.length) {
    console.log('  ' + chalk.bold('⭐ TOP PICKS FROM INBOX'));
    console.log();
    for (const j of topJobs) {
      const stars = '★'.repeat(Math.round(j.fit_score)) + '☆'.repeat(5 - Math.round(j.fit_score));
      const scoreColor = j.fit_score >= 4 ? chalk.green : chalk.yellow;
      console.log(`  ${scoreColor(stars)} ${chalk.bold(j.company)} — ${j.role}`);
      if (j.location) console.log(chalk.dim(`    ${j.location} · ${j.portal}`));
      console.log(chalk.dim(`    ${j.url}`));
      console.log(chalk.dim(`    → Paste URL in Claude Code to evaluate`));
      console.log();
    }
    console.log('  ' + divider());
    console.log();
  } else {
    console.log('  ' + chalk.dim('No new top picks. Run: npm run scan'));
    console.log();
  }

  // ── Pipeline status ───────────────────────────────────────────────
  if (stats.length) {
    console.log('  ' + chalk.bold('📋 ACTIVE PIPELINE'));
    console.log();
    const order = ['Interview', 'Applied', 'Responded', 'Evaluated'];
    const sorted = [...stats].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    for (const s of sorted) {
      const color = s.status === 'Interview' ? chalk.green
                  : s.status === 'Applied'   ? chalk.blue
                  : s.status === 'Responded' ? chalk.yellow
                  : chalk.dim;
      console.log(bar(s.status, s.count + ' active', color));
    }
    console.log();
  }

  // ── Recent activity ───────────────────────────────────────────────
  if (recent.length) {
    console.log('  ' + chalk.bold('🕐 RECENT (last 7 days)'));
    console.log();
    for (const a of recent.slice(0, 5)) {
      const scoreStr = a.score ? chalk.dim(` [${a.score.toFixed(1)}]`) : '';
      const statusColor = a.status === 'Applied' ? chalk.blue
                        : a.status === 'Interview' ? chalk.green
                        : chalk.dim;
      console.log(`  ${statusColor(a.status.padEnd(12))} ${chalk.white(a.company)} — ${chalk.dim(a.role)}${scoreStr}`);
    }
    console.log();
  }

  // ── Quick commands ────────────────────────────────────────────────
  console.log('  ' + divider());
  console.log();
  console.log('  ' + chalk.dim('Quick commands:'));
  console.log(chalk.dim('    npm run scan          ') + chalk.dim('pull new jobs'));
  console.log(chalk.dim('    npm run dashboard     ') + chalk.dim('open browser dashboard → :3333'));
  console.log(chalk.dim('    claude                ') + chalk.dim('open Claude Code to evaluate + apply'));
  console.log();
}

main().catch(e => {
  console.error(chalk.red('Brief failed:'), e.message);
  process.exit(1);
});
