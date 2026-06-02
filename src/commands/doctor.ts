#!/usr/bin/env tsx
/**
 * doctor.ts — Validates the job-hunt setup
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

interface Check {
  name: string;
  required: boolean;
  pass: boolean;
  hint?: string;
}

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  const file = (name: string, path: string, required: boolean, hint?: string): Check => ({
    name,
    required,
    pass: existsSync(join(ROOT, path)),
    hint,
  });

  checks.push(
    file('cv.md', 'cv.md', true, 'Create cv.md with your CV in markdown format'),
    file('config/profile.yml', 'config/profile.yml', true, 'Copy config/profile.example.yml → config/profile.yml and fill in your details'),
    file('config/portals.yml', 'config/portals.yml', true, 'Copy config/portals.example.yml → config/portals.yml and customize companies'),
    file('modes/_profile.md', 'modes/_profile.md', true, 'Copy modes/_profile.template.md → modes/_profile.md and customize for your career'),
    file('.env', '.env', false, 'Copy .env.example → .env and add your ANTHROPIC_API_KEY for batch features'),
    file('article-digest.md', 'article-digest.md', false, 'Optional: add proof points and portfolio highlights'),
  );

  // Check Node.js version
  const nodeVersion = process.versions.node.split('.').map(Number);
  checks.push({
    name: 'Node.js >= 20',
    required: true,
    pass: nodeVersion[0] >= 20,
    hint: `Install Node.js 20+. Current: ${process.versions.node}`,
  });

  // Check playwright
  try {
    await import('playwright');
    checks.push({ name: 'Playwright installed', required: false, pass: true });
  } catch {
    checks.push({
      name: 'Playwright installed',
      required: false,
      pass: false,
      hint: 'Run: npm install && npx playwright install chromium',
    });
  }

  // Check better-sqlite3
  try {
    await import('better-sqlite3');
    checks.push({ name: 'SQLite available', required: true, pass: true });
  } catch {
    checks.push({
      name: 'SQLite available',
      required: true,
      pass: false,
      hint: 'Run: npm install',
    });
  }

  return checks;
}

async function main() {
  console.log(chalk.bold('\n  job-hunt doctor\n'));

  const checks = await runChecks();
  let allRequired = true;

  for (const check of checks) {
    const icon = check.pass ? chalk.green('✓') : check.required ? chalk.red('✗') : chalk.yellow('⚠');
    const label = check.pass
      ? chalk.dim(check.name)
      : check.required
      ? chalk.red(check.name)
      : chalk.yellow(check.name);

    console.log(`  ${icon}  ${label}`);
    if (!check.pass && check.hint) {
      console.log(`     ${chalk.dim(check.hint)}`);
    }
    if (!check.pass && check.required) allRequired = false;
  }

  console.log();

  if (allRequired) {
    console.log(chalk.green('  All required checks passed. You\'re ready to hunt.\n'));
    console.log(chalk.dim('  Next: open Claude Code in this directory and paste a job URL.'));
  } else {
    console.log(chalk.red('  Some required checks failed. Fix them before using job-hunt.\n'));
    process.exit(1);
  }
}

main();
