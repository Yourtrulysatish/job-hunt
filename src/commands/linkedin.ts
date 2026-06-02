#!/usr/bin/env tsx
/**
 * linkedin.ts — LinkedIn job scraper using saved session
 *
 * LinkedIn blocks headless browsers. This works by:
 *   1. Opening a real visible browser where YOU log in (one-time setup)
 *   2. Saving your session cookies to config/linkedin-session.json
 *   3. All future runs use those cookies — no login needed again
 *
 * ⚠️  Note: Scraping LinkedIn is against their ToS.
 *     Use slowly, respectfully, for personal job search only.
 *     If your account gets rate-limited, wait 24h and try again.
 *
 * Usage:
 *   npm run linkedin:auth         first-time login + save session
 *   npm run linkedin              search jobs with saved session
 *   npm run linkedin -- --dry-run preview without saving
 *   npm run linkedin -- --pages 3 how many result pages per query (default: 2)
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { hasSeenUrl, hasSeenInApplications, recordScan } from '../db/queries.js';
import { awardXP } from '../utils/gamification.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ROOT         = join(__dirname, '..', '..');
const SESSION_PATH = join(ROOT, 'config', 'linkedin-session.json');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');

const args     = process.argv.slice(2);
const IS_AUTH  = args.includes('auth') || args[0] === 'auth';
const DRY_RUN  = args.includes('--dry-run');
const PAGES    = args.includes('--pages') ? parseInt(args[args.indexOf('--pages') + 1]) : 2;

// ── Search queries tailored to Satish's profile ───────────────────────
// Edit these to match your target roles

const SEARCHES = [
  { keywords: 'Partnership Manager Crypto Remote',          remote: true  },
  { keywords: 'Business Development Web3 Remote',           remote: true  },
  { keywords: 'Ecosystem Growth Manager Blockchain',        remote: true  },
  { keywords: 'Affiliate Manager Crypto Remote',            remote: true  },
  { keywords: 'Growth Marketing Manager Web3',              remote: true  },
  { keywords: 'BD Manager DeFi',                            remote: true  },
  { keywords: 'Partner Manager AI Startup Remote',          remote: true  },
  { keywords: 'Head of Partnerships Web3',                  remote: false },
  { keywords: 'Marketing Manager Blockchain Remote',        remote: true  },
];

// ── Title filters (reuse portals.yml logic) ───────────────────────────

const POSITIVE = [
  /partnership/i, /business\s*dev/i, /ecosystem/i, /affiliate/i,
  /growth\s*market/i, /bd\s*manager/i, /partner\s*manager/i, /partner\s*success/i,
  /marketing\s*manager/i, /marketing\s*lead/i, /head\s*of\s*(partnerships|marketing|growth)/i,
  /community\s*manager/i, /community\s*lead/i, /web3/i, /crypto/i, /defi/i, /blockchain/i,
];

const NEGATIVE = [
  /\bengineer\b/i, /\bdeveloper\b/i, /\bsoftware\b/i,
  /\bbackend\b/i, /\bfrontend\b/i, /\bfull.?stack\b/i,
  /\bdata\s*scientist\b/i, /\bintern\b/i, /\bjunior\b/i,
];

function passesFilter(title: string): boolean {
  return POSITIVE.some(r => r.test(title)) && !NEGATIVE.some(r => r.test(title));
}

// ── Helpers ───────────────────────────────────────────────────────────

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (base: number) => base + Math.random() * base * 0.5;

function linkedInJobsUrl(keywords: string, remote: boolean, start = 0): string {
  const params = new URLSearchParams({
    keywords,
    sortBy:   'DD',            // newest first
    f_TPR:    'r604800',       // past 7 days
    start:    String(start),
  });
  if (remote) params.set('f_WT', '2');
  return `https://www.linkedin.com/jobs/search/?${params}`;
}

function ensurePipelineMd(): void {
  if (!existsSync(PIPELINE_PATH)) {
    writeFileSync(PIPELINE_PATH, '# Pipeline — Pending Evaluation\n\nPaste job URLs or add via scan.\n\n');
  }
}

// ── Browser setup ─────────────────────────────────────────────────────

async function launchBrowser(headless: boolean): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:  { width: 1440, height: 900 },
    locale:    'en-US',
    timezoneId: 'Europe/Rome',
  });

  // Block images and fonts to speed up scraping
  await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', r => r.abort());

  // Patch navigator.webdriver to avoid detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return { browser, context };
}

// ── Auth flow ──────────────────────────────────────────────────────────

async function runAuth(): Promise<void> {
  console.log();
  console.log(chalk.bold('LinkedIn Session Setup'));
  console.log(chalk.dim('─────────────────────────────────────'));
  console.log(chalk.dim('A browser will open. Log in to LinkedIn normally.'));
  console.log(chalk.dim('When you see your LinkedIn feed, come back here and press Enter.'));
  console.log();

  const { browser, context } = await launchBrowser(false); // visible browser
  const page = await context.newPage();

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  // Wait for user to log in manually
  await new Promise<void>(resolve => {
    process.stdin.setRawMode?.(false);
    process.stdout.write(chalk.yellow('\nPress Enter when you are logged in to LinkedIn → '));
    process.stdin.once('data', () => resolve());
    process.stdin.resume();
  });

  // Save cookies
  const cookies = await context.cookies();
  const storage = await page.evaluate(() => JSON.stringify(window.localStorage));

  writeFileSync(SESSION_PATH, JSON.stringify({ cookies, storage, savedAt: new Date().toISOString() }, null, 2));
  await browser.close();

  console.log(chalk.green('\n✓ Session saved to config/linkedin-session.json'));
  console.log(chalk.dim('Now run: npm run linkedin'));
}

// ── Load saved session ─────────────────────────────────────────────────

async function loadSession(context: BrowserContext): Promise<boolean> {
  if (!existsSync(SESSION_PATH)) return false;
  try {
    const saved = JSON.parse(readFileSync(SESSION_PATH, 'utf8'));
    if (saved.cookies?.length) {
      await context.addCookies(saved.cookies);
    }
    return true;
  } catch {
    return false;
  }
}

// ── Scrape a single search results page ───────────────────────────────

interface JobListing {
  company: string;
  role: string;
  url: string;
  location: string;
}

async function scrapeResultsPage(page: Page, searchUrl: string): Promise<JobListing[]> {
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await wait(jitter(2000));

  // Check for login wall
  if (page.url().includes('/login') || page.url().includes('/authwall')) {
    throw new Error('SESSION_EXPIRED');
  }

  // Scroll to load lazy items
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await wait(jitter(800));
  }

  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(
      '.job-search-card, [data-entity-urn*="jobPosting"], .jobs-search__results-list > li'
    ));

    return cards.slice(0, 25).map(card => {
      const titleEl   = card.querySelector('.job-search-card__title, .base-search-card__title, h3');
      const companyEl = card.querySelector('.job-search-card__subtitle, .base-search-card__subtitle, h4');
      const locEl     = card.querySelector('.job-search-card__location, .base-search-card__metadata');
      const linkEl    = card.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement | null;

      const href = linkEl?.href ?? '';
      // Clean tracking params — keep only the job ID
      const cleanUrl = href.split('?')[0].replace(/\/$/, '');

      return {
        role:     titleEl?.textContent?.trim()   ?? '',
        company:  companyEl?.textContent?.trim() ?? '',
        location: locEl?.textContent?.trim()     ?? '',
        url:      cleanUrl,
      };
    }).filter(j => j.role && j.url && j.url.includes('/jobs/view/'));
  });
}

// ── Main search ────────────────────────────────────────────────────────

async function runSearch(): Promise<void> {
  if (!existsSync(SESSION_PATH)) {
    console.error(chalk.red('\nNo LinkedIn session found.'));
    console.log(chalk.dim('Run first: npm run linkedin:auth'));
    process.exit(1);
  }

  const { browser, context } = await launchBrowser(true);
  const page = await context.newPage();

  const spinner = ora('Loading LinkedIn session…').start();

  const loaded = await loadSession(context);
  if (!loaded) {
    spinner.fail('Could not load session. Run: npm run linkedin:auth');
    await browser.close();
    process.exit(1);
  }

  const allListings: JobListing[] = [];

  for (const search of SEARCHES) {
    spinner.text = `Searching: "${search.keywords}"…`;

    for (let pageNum = 0; pageNum < PAGES; pageNum++) {
      try {
        const url      = linkedInJobsUrl(search.keywords, search.remote, pageNum * 25);
        const listings = await scrapeResultsPage(page, url);
        allListings.push(...listings);
        await wait(jitter(2500)); // polite delay between pages
      } catch (err: unknown) {
        if ((err as Error).message === 'SESSION_EXPIRED') {
          spinner.fail('LinkedIn session expired. Run: npm run linkedin:auth');
          await browser.close();
          process.exit(1);
        }
        // Other errors: skip this page
      }
    }

    await wait(jitter(3000)); // polite delay between searches
  }

  await browser.close();

  // Deduplicate
  const seen   = new Set<string>();
  const unique = allListings.filter(j => {
    if (!j.url || seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });

  // Apply title filter
  const filtered = unique.filter(j => passesFilter(j.role));

  // Remove already seen
  const fresh = filtered.filter(j =>
    !hasSeenUrl(j.url) && !hasSeenInApplications(j.url)
  );

  spinner.succeed(
    `LinkedIn scan: ${unique.length} found → ${filtered.length} matching → ${chalk.green(String(fresh.length) + ' new')}`
  );

  if (!fresh.length) {
    console.log(chalk.dim('\nNo new LinkedIn jobs this time. Try again tomorrow.'));
    return;
  }

  if (DRY_RUN) {
    console.log(chalk.yellow('\n[DRY RUN] Would add:'));
    for (const j of fresh) {
      console.log(`  ${chalk.bold(j.company)} — ${j.role}`);
      console.log(chalk.dim(`    ${j.location}  ${j.url}`));
    }
    return;
  }

  // Write to pipeline
  ensurePipelineMd();
  const date  = new Date().toISOString().split('T')[0];
  const lines = [`\n## LinkedIn Scan — ${date} (${fresh.length} new)\n\n### Source: linkedin\n`];

  for (const j of fresh) {
    lines.push(`- [ ] **${j.company}** — ${j.role}${j.location ? ` · ${j.location}` : ''}`);
    lines.push(`  URL: ${j.url}`);
    lines.push(`  Portal: linkedin`);
    lines.push('');
    recordScan(j.company, j.role, j.url, 'linkedin');
  }

  const { appendFileSync } = await import('fs');
  appendFileSync(PIPELINE_PATH, lines.join('\n'));

  // Award XP
  awardXP('SCAN_JOBS', `LinkedIn scan — ${fresh.length} new jobs`);

  console.log(chalk.green(`\n✓ ${fresh.length} new LinkedIn jobs added to your inbox`));
  console.log(chalk.dim('Open the dashboard → Inbox tab to see them.'));
}

// ── Entry ──────────────────────────────────────────────────────────────

if (IS_AUTH) {
  runAuth().catch(e => { console.error(chalk.red(e.message)); process.exit(1); });
} else {
  runSearch().catch(e => {
    if (e.message?.includes('SESSION_EXPIRED') || e.message?.includes('session')) {
      console.error(chalk.red('Session issue. Run: npm run linkedin:auth'));
    } else {
      console.error(chalk.red('LinkedIn scan failed:'), e.message);
    }
    process.exit(1);
  });
}
