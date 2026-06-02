#!/usr/bin/env tsx

/**
 * scrape.ts — Playwright-based job scraper
 *
 * Scrapes LinkedIn, Wellfound (AngelList), and Indeed using a real browser.
 * Slower than scan.ts but covers platforms with no public API.
 *
 * Usage:
 *   tsx src/commands/scrape.ts                     # all sources
 *   tsx src/commands/scrape.ts --source linkedin
 *   tsx src/commands/scrape.ts --source wellfound
 *   tsx src/commands/scrape.ts --dry-run
 */

import { appendFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type Page } from 'playwright';
import chalk from 'chalk';
import ora from 'ora';
import { hasSeenUrl, hasSeenInApplications, recordScan } from '../db/queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SOURCE  = args.includes('--source') ? args[args.indexOf('--source') + 1]?.toLowerCase() : 'all';

// ── Search queries tailored to Satish's profile ───────────────────────

const LINKEDIN_QUERIES = [
  { q: 'Partnership Manager Web3 Remote',           f_WT: '2' },
  { q: 'Business Development Manager Crypto Remote', f_WT: '2' },
  { q: 'Ecosystem Growth Manager Blockchain',        f_WT: '2' },
  { q: 'Affiliate Manager Crypto Remote',            f_WT: '2' },
  { q: 'Growth Marketing Manager Web3',              f_WT: '2' },
  { q: 'BD Manager DeFi Remote',                    f_WT: '2' },
];

const WELLFOUND_QUERIES = [
  'partnership-manager',
  'business-development-crypto',
  'ecosystem-growth',
  'web3-marketing',
];

// ── Types ─────────────────────────────────────────────────────────────

interface JobListing {
  company: string;
  role: string;
  url: string;
  location?: string;
  source: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

async function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function ensurePipelineMd() {
  if (!existsSync(PIPELINE_PATH)) {
    writeFileSync(PIPELINE_PATH, '# Pipeline — Pending Evaluation\n\nPaste job URLs or add via scan.\n\n');
  }
}

// ── LinkedIn scraper ──────────────────────────────────────────────────

async function scrapeLinkedIn(page: Page): Promise<JobListing[]> {
  const results: JobListing[] = [];

  for (const query of LINKEDIN_QUERIES) {
    try {
      // LinkedIn job search URL — f_WT=2 is remote, f_TPR=r86400 is last 24h (remove for wider)
      const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query.q)}&f_WT=${query.f_WT}&f_TPR=r604800&sortBy=DD`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await wait(2000);

      // Scroll to load more
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await wait(1500);

      const jobs = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.job-search-card, [data-entity-urn*="jobPosting"]'));
        return cards.slice(0, 25).map(card => {
          const titleEl = card.querySelector('.job-search-card__title, h3, .base-search-card__title');
          const companyEl = card.querySelector('.job-search-card__subtitle, h4, .base-search-card__subtitle');
          const locationEl = card.querySelector('.job-search-card__location, .job-search-card__location');
          const linkEl = card.querySelector('a[href*="/jobs/view/"]');
          return {
            role: titleEl?.textContent?.trim() ?? '',
            company: companyEl?.textContent?.trim() ?? '',
            location: locationEl?.textContent?.trim() ?? '',
            url: (linkEl as HTMLAnchorElement)?.href ?? '',
          };
        }).filter(j => j.role && j.url);
      });

      for (const j of jobs) {
        // Normalize LinkedIn URL (remove tracking params)
        const cleanUrl = j.url.split('?')[0].replace(/\/$/, '');
        if (cleanUrl) {
          results.push({ ...j, url: cleanUrl, source: 'linkedin' });
        }
      }

      await wait(1500); // rate limit between queries
    } catch { /* continue */ }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return results.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; });
}

// ── Wellfound scraper ─────────────────────────────────────────────────

async function scrapeWellfound(page: Page): Promise<JobListing[]> {
  const results: JobListing[] = [];

  for (const q of WELLFOUND_QUERIES) {
    try {
      await page.goto(`https://wellfound.com/jobs?q=${q}&remote=true`, {
        waitUntil: 'domcontentloaded', timeout: 20_000,
      });
      await wait(2500);

      const jobs = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[class*="JobCard"], [data-test="job-card"], article'));
        return cards.slice(0, 30).map(card => {
          const titleEl = card.querySelector('[class*="title"], h2, h3');
          const companyEl = card.querySelector('[class*="company"], [class*="startup"]');
          const locationEl = card.querySelector('[class*="location"]');
          const linkEl = card.querySelector('a[href*="/jobs/"]');
          return {
            role: titleEl?.textContent?.trim() ?? '',
            company: companyEl?.textContent?.trim() ?? '',
            location: locationEl?.textContent?.trim() ?? 'Remote',
            url: (linkEl as HTMLAnchorElement)?.href ?? '',
          };
        }).filter(j => j.role && j.url);
      });

      for (const j of jobs) {
        const url = j.url.startsWith('http') ? j.url : `https://wellfound.com${j.url}`;
        results.push({ ...j, url, source: 'wellfound' });
      }

      await wait(2000);
    } catch { /* continue */ }
  }

  const seen = new Set<string>();
  return results.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; });
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const spinner = ora('Launching browser…').start();
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    const allListings: JobListing[] = [];

    if (SOURCE === 'all' || SOURCE === 'linkedin') {
      spinner.text = 'Scraping LinkedIn…';
      const li = await scrapeLinkedIn(page);
      spinner.succeed(`LinkedIn: ${li.length} listings found`);
      allListings.push(...li);
    }

    if (SOURCE === 'all' || SOURCE === 'wellfound') {
      spinner.text = 'Scraping Wellfound…';
      const wf = await scrapeWellfound(page);
      spinner.succeed(`Wellfound: ${wf.length} listings found`);
      allListings.push(...wf);
    }

    // Deduplicate against DB
    const newListings = allListings.filter(l => l.url && !hasSeenUrl(l.url) && !hasSeenInApplications(l.url));

    console.log(chalk.bold(`\n  ${allListings.length} total · ${chalk.green(newListings.length + ' new')}\n`));

    if (!newListings.length) {
      console.log(chalk.dim('  No new listings.'));
      return;
    }

    if (DRY_RUN) {
      for (const l of newListings) {
        console.log(`  [${chalk.cyan(l.source)}] ${chalk.bold(l.company)} — ${l.role}`);
        if (l.location) console.log(chalk.dim(`    ${l.location}`));
      }
      return;
    }

    ensurePipelineMd();

    const bySource = new Map<string, JobListing[]>();
    for (const l of newListings) {
      if (!bySource.has(l.source)) bySource.set(l.source, []);
      bySource.get(l.source)!.push(l);
    }

    const lines: string[] = [`\n## Scrape — ${new Date().toISOString().split('T')[0]} (${newListings.length} new)\n`];
    for (const [source, jobs] of bySource) {
      lines.push(`\n### Source: ${source}\n`);
      for (const l of jobs) {
        lines.push(`- [ ] **${l.company}** — ${l.role}${l.location ? ` · ${l.location}` : ''}`);
        lines.push(`  URL: ${l.url}`);
        lines.push(`  Portal: ${source}`);
        lines.push('');
        recordScan(l.company, l.role, l.url, source);
      }
    }

    appendFileSync(PIPELINE_PATH, lines.join('\n'));
    console.log(chalk.green(`  ✓ ${newListings.length} new listings added to data/pipeline.md`));

  } finally {
    await browser?.close();
  }
}

main().catch(err => {
  console.error(chalk.red('Scrape failed:'), err.message);
  process.exit(1);
});
