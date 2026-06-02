#!/usr/bin/env tsx
/**
 * followup.ts — Shows overdue and upcoming follow-ups
 */

import chalk from 'chalk';
import { getOverdueFollowups } from '../db/queries.js';

function main() {
  const overdue = getOverdueFollowups();

  if (overdue.length === 0) {
    console.log(chalk.green('No overdue follow-ups. You\'re on top of it.'));
    return;
  }

  console.log(chalk.bold.yellow(`\n  ${overdue.length} overdue follow-up${overdue.length > 1 ? 's' : ''}\n`));

  for (const f of overdue) {
    const daysAgo = Math.floor((Date.now() - new Date(f.due_date).getTime()) / 86_400_000);
    console.log(`  ${chalk.red('●')} ${chalk.bold(f.company)} — ${f.role}`);
    console.log(`    Type: ${f.type} | Due: ${f.due_date} (${daysAgo}d ago)`);
    if (f.notes) console.log(chalk.dim(`    ${f.notes}`));
    console.log();
  }
}

main();
