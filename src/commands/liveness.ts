#!/usr/bin/env tsx
/**
 * liveness.ts — Playwright job link liveness checker
 *
 * Tests whether job posting URLs in the DB are still active or expired.
 * Zero LLM tokens — pure Playwright.
 *
 * Usage:
 *   tsx src/commands/liveness.ts                  # check all Applied/Evaluated apps
 *   tsx src/commands/liveness.ts --url <url>       # check single URL
 *   tsx src/commands/liveness.ts --status Applied  # filter by status
 *   tsx src/commands/liveness.ts --all             # include all statuses
 */

import { chromium } from 'playwright';
import { getDb } from '../db/client.js';
import chalk from 'chalk';

const HARD_EXPIRED = [
  /job (is )?no longer available/i,
  /position has been filled/i,
  /this job has expired/i,
  /no longer accepting applications/i,
  /this (position|role|job) (is )?no longer/i,
  /applications?\s+(?:(?:have|are|is)\s+)?closed/i,
  /job (listing )?not found/i,
  /404|page not found/i,
  /the page you are looking for doesn.t exist/i,
];

const APPLY_SIGNALS = [
  /\bapply\b/i, /submit application/i, /easy apply/i, /start application/i,
];

type LivenessResult = 'active' | 'expired' | 'uncertain';

async function checkUrl(url: string): Promise<{ result: LivenessResult; reason: string }> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const status = res?.status() ?? 0;

    if (status === 404 || status === 410) {
      return { result: 'expired', reason: `HTTP ${status}` };
    }

    await page.waitForTimeout(2000);

    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const finalUrl = page.url();

    // Hard expired patterns
    for (const pat of HARD_EXPIRED) {
      if (pat.test(bodyText) || pat.test(finalUrl)) {
        return { result: 'expired', reason: `Matched: ${pat.source.slice(0, 40)}` };
      }
    }

    // Apply button present → active
    const controls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a,button,input[type="submit"],[role="button"]'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map(el => (el as HTMLElement).innerText || el.getAttribute('aria-label') || '')
    );

    const hasApplyBtn = controls.some(c => APPLY_SIGNALS.some(p => p.test(c)));
    if (hasApplyBtn) return { result: 'active', reason: 'Apply button found' };

    if (bodyText.length < 300) return { result: 'uncertain', reason: 'Page too short' };

    return { result: 'uncertain', reason: 'No apply button detected' };
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const singleUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
  const statusFilter = args.includes('--status') ? args[args.indexOf('--status') + 1] : null;
  const checkAll = args.includes('--all');

  if (singleUrl) {
    console.log(chalk.dim(`\n  Checking: ${singleUrl}`));
    const r = await checkUrl(singleUrl);
    const icon = r.result === 'active' ? chalk.green('✓ ACTIVE') : r.result === 'expired' ? chalk.red('✗ EXPIRED') : chalk.yellow('? UNCERTAIN');
    console.log(`  ${icon}  ${chalk.dim(r.reason)}\n`);
    return;
  }

  const db = getDb();
  let query = 'SELECT id, num, company, role, url, status FROM applications WHERE url IS NOT NULL';
  if (!checkAll) {
    query += statusFilter ? ` AND status = '${statusFilter}'` : " AND status IN ('Applied', 'Evaluated', 'Interview')";
  }
  query += ' ORDER BY num DESC';

  const apps = db.prepare(query).all() as { id: number; num: number; company: string; role: string; url: string; status: string }[];

  if (!apps.length) {
    console.log(chalk.dim('\n  No applications to check.\n'));
    return;
  }

  console.log(chalk.bold(`\n  Checking liveness of ${apps.length} job postings…\n`));

  let active = 0, expired = 0, uncertain = 0;

  for (const app of apps) {
    process.stdout.write(`  [${String(app.num).padStart(3)}] ${app.company.padEnd(20)} `);
    const r = await checkUrl(app.url);

    if (r.result === 'active') {
      console.log(chalk.green('✓ ACTIVE'));
      active++;
    } else if (r.result === 'expired') {
      console.log(chalk.red(`✗ EXPIRED  ${chalk.dim(r.reason)}`));
      expired++;
      // Mark as discarded if expired
      db.prepare("UPDATE applications SET status = 'Discarded', notes = ? WHERE id = ?")
        .run(`Liveness check: posting expired — ${new Date().toISOString().split('T')[0]}`, app.id);
    } else {
      console.log(chalk.yellow(`? UNCERTAIN  ${chalk.dim(r.reason)}`));
      uncertain++;
    }
  }

  console.log(chalk.bold(`\n  Results: ${chalk.green(active + ' active')}  ${chalk.red(expired + ' expired')}  ${chalk.yellow(uncertain + ' uncertain')}`));
  if (expired > 0) console.log(chalk.dim(`  ${expired} expired jobs marked as Discarded in DB.`));
  console.log('');
}

main().catch(err => { console.error(chalk.red('Liveness check failed:'), err.message); process.exit(1); });
