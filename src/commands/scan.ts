#!/usr/bin/env tsx

/**
 * scan.ts — Multi-portal job scanner
 *
 * Hits Greenhouse, Ashby, Lever, Workday, SmartRecruiters, and Rippling APIs
 * directly (zero LLM tokens). Deduplicates via SQLite scan_history and
 * applications tables. Appends new offers to data/pipeline.md.
 *
 * Usage:
 *   tsx src/commands/scan.ts
 *   tsx src/commands/scan.ts --company Anthropic
 *   tsx src/commands/scan.ts --dry-run
 *   tsx src/commands/scan.ts --portal greenhouse
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import chalk from 'chalk';
import ora from 'ora';
import { hasSeenUrl, hasSeenInApplications, recordScan } from '../db/queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const PORTALS_PATH = join(ROOT, 'config', 'portals.yml');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const CONCURRENCY = 8;
const TIMEOUT_MS = 12_000;

// ── Args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const COMPANY_FILTER = args.includes('--company') ? args[args.indexOf('--company') + 1]?.toLowerCase() : null;
const PORTAL_FILTER = args.includes('--portal') ? args[args.indexOf('--portal') + 1]?.toLowerCase() : null;

// ── Types ─────────────────────────────────────────────────────────────

type Portal = 'greenhouse' | 'ashby' | 'lever' | 'workday' | 'smartrecruiters' | 'rippling' | 'custom';

interface Company {
  name: string;
  portal?: Portal;
  api?: string;
  careers_url?: string;
  custom_api?: string;
  enabled?: boolean;
}

interface PortalConfig {
  title_filter: {
    positive: string[];
    negative: string[];
  };
  companies: Company[];
}

interface JobListing {
  company: string;
  role: string;
  url: string;
  location?: string;
  remote?: boolean;
  salary?: string;
  portal: Portal;
}

// ── API detection ─────────────────────────────────────────────────────

function detectPortal(company: Company): { portal: Portal; apiUrl: string } | null {
  if (company.portal === 'greenhouse' && company.api) {
    return { portal: 'greenhouse', apiUrl: company.api };
  }

  const url = company.careers_url ?? '';

  // Ashby
  const ashby = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashby) {
    return {
      portal: 'ashby',
      apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const lever = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (lever) {
    return { portal: 'lever', apiUrl: `https://api.lever.co/v0/postings/${lever[1]}?mode=json` };
  }

  // Greenhouse via board token in URL
  const gh = url.match(/boards\.greenhouse\.io\/([^/?#]+)/);
  if (gh) {
    return {
      portal: 'greenhouse',
      apiUrl: `https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs?content=true`,
    };
  }

  // Workday
  const wd = url.match(/([a-z0-9]+)\.wd\d+\.myworkdayjobs\.com\/([^/?#]+)/);
  if (wd) {
    return {
      portal: 'workday',
      apiUrl: `https://${wd[1]}.wd5.myworkdayjobs.com/wday/cxs/${wd[1]}/${wd[2]}/jobs`,
    };
  }

  // SmartRecruiters
  const sr = url.match(/careers\.smartrecruiters\.com\/([^/?#]+)/);
  if (sr) {
    return {
      portal: 'smartrecruiters',
      apiUrl: `https://api.smartrecruiters.com/v1/companies/${sr[1]}/postings?status=PUBLIC&limit=100`,
    };
  }

  // Rippling
  if (url.includes('rippling.com/jobs') && company.custom_api) {
    return { portal: 'rippling', apiUrl: company.custom_api };
  }

  return null;
}

// ── Fetchers ──────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'job-hunt-scanner/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGreenhouse(apiUrl: string, company: Company, filter: RegExp[]): Promise<JobListing[]> {
  const data = await fetchWithTimeout(apiUrl) as { jobs?: Array<{ title: string; absolute_url: string; location?: { name?: string } }> };
  return (data.jobs ?? [])
    .filter(j => matchesFilter(j.title, filter))
    .map(j => ({
      company: company.name,
      role: j.title,
      url: j.absolute_url,
      location: j.location?.name,
      portal: 'greenhouse' as Portal,
    }));
}

async function fetchAshby(apiUrl: string, company: Company, filter: RegExp[]): Promise<JobListing[]> {
  const data = await fetchWithTimeout(apiUrl) as {
    jobPostings?: Array<{ title: string; jobUrl: string; isListed: boolean; location?: { city?: string }; compensation?: { summary?: string } }>;
  };
  return (data.jobPostings ?? [])
    .filter(j => j.isListed && matchesFilter(j.title, filter))
    .map(j => ({
      company: company.name,
      role: j.title,
      url: j.jobUrl,
      location: j.location?.city,
      salary: j.compensation?.summary,
      portal: 'ashby' as Portal,
    }));
}

async function fetchLever(apiUrl: string, company: Company, filter: RegExp[]): Promise<JobListing[]> {
  const data = await fetchWithTimeout(apiUrl) as Array<{
    text: string;
    hostedUrl: string;
    categories?: { location?: string; commitment?: string };
  }>;
  return (Array.isArray(data) ? data : [])
    .filter(j => matchesFilter(j.text, filter))
    .map(j => ({
      company: company.name,
      role: j.text,
      url: j.hostedUrl,
      location: j.categories?.location,
      remote: j.categories?.commitment?.toLowerCase().includes('remote'),
      portal: 'lever' as Portal,
    }));
}

async function fetchWorkday(apiUrl: string, company: Company, filter: RegExp[]): Promise<JobListing[]> {
  const data = await fetchWithTimeout(apiUrl) as {
    jobPostings?: Array<{ title: string; externalPath: string; locationsText?: string; remoteType?: string }>;
  };
  const base = new URL(apiUrl);
  const baseUrl = `${base.protocol}//${base.host}`;
  return (data.jobPostings ?? [])
    .filter(j => matchesFilter(j.title, filter))
    .map(j => ({
      company: company.name,
      role: j.title,
      url: `${baseUrl}${j.externalPath}`,
      location: j.locationsText,
      remote: j.remoteType?.toLowerCase().includes('remote'),
      portal: 'workday' as Portal,
    }));
}

async function fetchSmartRecruiters(apiUrl: string, company: Company, filter: RegExp[]): Promise<JobListing[]> {
  const data = await fetchWithTimeout(apiUrl) as {
    content?: Array<{ name: string; ref: string; location?: { city?: string; country?: string }; workplace?: { wtype?: string } }>;
  };
  return (data.content ?? [])
    .filter(j => matchesFilter(j.name, filter))
    .map(j => ({
      company: company.name,
      role: j.name,
      url: j.ref,
      location: [j.location?.city, j.location?.country].filter(Boolean).join(', '),
      remote: j.workplace?.wtype === 'REMOTE',
      portal: 'smartrecruiters' as Portal,
    }));
}

// ── Filter ────────────────────────────────────────────────────────────

function buildFilter(config: PortalConfig): { positive: RegExp[]; negative: RegExp[] } {
  return {
    positive: config.title_filter.positive.map(p => new RegExp(p, 'i')),
    negative: config.title_filter.negative.map(p => new RegExp(p, 'i')),
  };
}

function matchesFilter(title: string, positiveFilters: RegExp[]): boolean {
  return positiveFilters.some(r => r.test(title));
}

function notNegative(title: string, negativeFilters: RegExp[]): boolean {
  return !negativeFilters.some(r => r.test(title));
}

// ── Main ──────────────────────────────────────────────────────────────

async function scanCompany(company: Company, filter: { positive: RegExp[]; negative: RegExp[] }): Promise<JobListing[]> {
  const detected = detectPortal(company);
  if (!detected) return [];

  if (PORTAL_FILTER && detected.portal !== PORTAL_FILTER) return [];

  try {
    let listings: JobListing[] = [];

    switch (detected.portal) {
      case 'greenhouse':
        listings = await fetchGreenhouse(detected.apiUrl, company, filter.positive);
        break;
      case 'ashby':
        listings = await fetchAshby(detected.apiUrl, company, filter.positive);
        break;
      case 'lever':
        listings = await fetchLever(detected.apiUrl, company, filter.positive);
        break;
      case 'workday':
        listings = await fetchWorkday(detected.apiUrl, company, filter.positive);
        break;
      case 'smartrecruiters':
        listings = await fetchSmartRecruiters(detected.apiUrl, company, filter.positive);
        break;
    }

    return listings.filter(l => notNegative(l.role, filter.negative));
  } catch {
    return [];
  }
}

function ensurePipelineMd(): void {
  if (!existsSync(PIPELINE_PATH)) {
    writeFileSync(
      PIPELINE_PATH,
      '# Pipeline — Pending Evaluation\n\nPaste job URLs or add them via scan. Claude will evaluate them in order.\n\n'
    );
  }
}

async function runWithConcurrency<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = await Promise.all(items.slice(i, i + concurrency).map(fn));
    results.push(...batch);
  }
  return results;
}

async function main() {
  if (!existsSync(PORTALS_PATH)) {
    console.error(chalk.red('config/portals.yml not found. Copy config/portals.example.yml and customize it.'));
    process.exit(1);
  }

  const config = yaml.load(readFileSync(PORTALS_PATH, 'utf8')) as PortalConfig;
  const filter = buildFilter(config);

  let companies = config.companies.filter(c => c.enabled !== false);
  if (COMPANY_FILTER) {
    companies = companies.filter(c => c.name.toLowerCase().includes(COMPANY_FILTER));
  }

  const spinner = ora(`Scanning ${companies.length} companies…`).start();
  const startTime = Date.now();

  const allListings = (
    await runWithConcurrency(companies, c => scanCompany(c, filter), CONCURRENCY)
  ).flat();

  // Deduplicate
  const newListings = allListings.filter(l => !hasSeenUrl(l.url) && !hasSeenInApplications(l.url));

  spinner.succeed(
    `Scanned ${companies.length} companies in ${((Date.now() - startTime) / 1000).toFixed(1)}s — ${allListings.length} total, ${newListings.length} new`
  );

  if (newListings.length === 0) {
    console.log(chalk.dim('No new listings found.'));
    return;
  }

  if (DRY_RUN) {
    console.log(chalk.yellow('\n[DRY RUN] Would add:'));
    for (const l of newListings) {
      console.log(`  ${chalk.bold(l.company)} — ${l.role}`);
      console.log(chalk.dim(`    ${l.url}`));
    }
    return;
  }

  ensurePipelineMd();

  const lines: string[] = [
    `\n## Scan — ${new Date().toISOString().split('T')[0]} (${newListings.length} new)\n`,
  ];

  for (const listing of newListings) {
    const meta: string[] = [];
    if (listing.location) meta.push(listing.location);
    if (listing.remote) meta.push('Remote');
    if (listing.salary) meta.push(listing.salary);

    lines.push(
      `- [ ] **${listing.company}** — ${listing.role}${meta.length ? ` · ${meta.join(' · ')}` : ''}`,
      `  URL: ${listing.url}`,
      `  Portal: ${listing.portal}`,
      ''
    );

    recordScan(listing.company, listing.role, listing.url, listing.portal);
  }

  appendFileSync(PIPELINE_PATH, lines.join('\n'));

  console.log(chalk.green(`\n✓ ${newListings.length} new listings added to data/pipeline.md`));
  console.log(chalk.dim('Run Claude Code in this directory to start evaluating.'));
}

main().catch(err => {
  console.error(chalk.red('Scan failed:'), err.message);
  process.exit(1);
});
