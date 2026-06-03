#!/usr/bin/env tsx

/**
 * scan.ts — Multi-source job scanner
 *
 * Sources:
 *   Company portals  — Greenhouse, Ashby, Lever, Workday, SmartRecruiters
 *   Aggregator APIs  — Remotive, RemoteOK, Himalayas
 *   RSS feeds        — CryptoJobsList, Web3.career, any RSS/Atom feed
 *
 * Zero LLM tokens. Deduplicates via SQLite. Appends to data/pipeline.md.
 *
 * Usage:
 *   tsx src/commands/scan.ts                   # scan everything
 *   tsx src/commands/scan.ts --source portals  # company portals only
 *   tsx src/commands/scan.ts --source feeds    # RSS + aggregators only
 *   tsx src/commands/scan.ts --company Ripple  # single company
 *   tsx src/commands/scan.ts --dry-run
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import chalk from 'chalk';
import ora from 'ora';
import { hasSeenUrl, hasSeenInApplications, recordScan, upsertPipelineJob } from '../db/queries.js';
import { scoreJob } from '../utils/scorer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PORTALS_PATH = join(ROOT, 'config', 'portals.yml');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const CONCURRENCY = 8;
const TIMEOUT_MS = 12_000;

// ── CLI args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN      = args.includes('--dry-run');
const COMPANY_FILTER = args.includes('--company') ? args[args.indexOf('--company') + 1]?.toLowerCase() : null;
const SOURCE_FILTER  = args.includes('--source')  ? args[args.indexOf('--source') + 1]?.toLowerCase()  : null; // portals | feeds | all

// ── Types ─────────────────────────────────────────────────────────────

type Portal = 'greenhouse' | 'ashby' | 'lever' | 'workday' | 'smartrecruiters' |
              'remotive' | 'remoteok' | 'himalayas' | 'rss';

interface Company {
  name: string;
  portal?: string;
  api?: string;
  careers_url?: string;
  enabled?: boolean;
}

interface Aggregator {
  name: string;
  type: 'remotive' | 'remoteok' | 'himalayas';
  categories?: string[];
  tags?: string[];
  queries?: string[];
  enabled?: boolean;
}

interface RssFeed {
  name: string;
  url: string;
  enabled?: boolean;
}

interface PortalConfig {
  title_filter: { positive: string[]; negative: string[] };
  companies: Company[];
  aggregators?: Aggregator[];
  rss_feeds?: RssFeed[];
}

interface JobListing {
  company: string;
  role: string;
  url: string;
  location?: string;
  remote?: boolean;
  salary?: string;
  portal: Portal | string;
}

// ── HTTP helper ───────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'job-hunt-scanner/1.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'job-hunt-scanner/1.0', Accept: 'application/rss+xml, application/xml, text/xml' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Filters ───────────────────────────────────────────────────────────

function buildFilter(cfg: PortalConfig) {
  return {
    positive: cfg.title_filter.positive.map(p => new RegExp(p, 'i')),
    negative: cfg.title_filter.negative.map(p => new RegExp(p, 'i')),
  };
}

function passes(title: string, f: ReturnType<typeof buildFilter>): boolean {
  return f.positive.some(r => r.test(title)) && !f.negative.some(r => r.test(title));
}

// ══════════════════════════════════════════════════════════════════════
// COMPANY PORTAL FETCHERS
// ══════════════════════════════════════════════════════════════════════

function detectPortalApi(company: Company): { portal: string; apiUrl: string } | null {
  if (company.portal === 'greenhouse' && company.api) return { portal: 'greenhouse', apiUrl: company.api };
  const url = company.careers_url ?? '';

  const ashby = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashby) return { portal: 'ashby', apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}?includeCompensation=true` };

  const lever = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (lever) return { portal: 'lever', apiUrl: `https://api.lever.co/v0/postings/${lever[1]}?mode=json` };

  const gh = url.match(/boards\.greenhouse\.io\/([^/?#]+)/);
  if (gh) return { portal: 'greenhouse', apiUrl: `https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs?content=true` };

  const wd = url.match(/([a-z0-9]+)\.wd\d+\.myworkdayjobs\.com\/([^/?#]+)/);
  if (wd) return { portal: 'workday', apiUrl: `https://${wd[1]}.wd5.myworkdayjobs.com/wday/cxs/${wd[1]}/${wd[2]}/jobs` };

  const sr = url.match(/careers\.smartrecruiters\.com\/([^/?#]+)/);
  if (sr) return { portal: 'smartrecruiters', apiUrl: `https://api.smartrecruiters.com/v1/companies/${sr[1]}/postings?status=PUBLIC&limit=100` };

  return null;
}

async function fetchCompany(company: Company, f: ReturnType<typeof buildFilter>): Promise<JobListing[]> {
  const detected = detectPortalApi(company);
  if (!detected) return [];
  try {
    const data = await fetchJSON(detected.apiUrl);
    switch (detected.portal) {
      case 'greenhouse': {
        const d = data as { jobs?: Array<{ title: string; absolute_url: string; location?: { name?: string } }> };
        return (d.jobs ?? []).filter(j => passes(j.title, f)).map(j => ({
          company: company.name, role: j.title, url: j.absolute_url,
          location: j.location?.name, portal: 'greenhouse',
        }));
      }
      case 'ashby': {
        const d = data as { jobPostings?: Array<{ title: string; jobUrl: string; isListed: boolean; location?: { city?: string }; compensation?: { summary?: string } }> };
        return (d.jobPostings ?? []).filter(j => j.isListed && passes(j.title, f)).map(j => ({
          company: company.name, role: j.title, url: j.jobUrl,
          location: j.location?.city, salary: j.compensation?.summary, portal: 'ashby',
        }));
      }
      case 'lever': {
        const d = data as Array<{ text: string; hostedUrl: string; categories?: { location?: string; commitment?: string } }>;
        return (Array.isArray(d) ? d : []).filter(j => passes(j.text, f)).map(j => ({
          company: company.name, role: j.text, url: j.hostedUrl,
          location: j.categories?.location,
          remote: j.categories?.commitment?.toLowerCase().includes('remote'),
          portal: 'lever',
        }));
      }
      case 'workday': {
        const d = data as { jobPostings?: Array<{ title: string; externalPath: string; locationsText?: string }> };
        const base = new URL(detected.apiUrl);
        return (d.jobPostings ?? []).filter(j => passes(j.title, f)).map(j => ({
          company: company.name, role: j.title,
          url: `${base.protocol}//${base.host}${j.externalPath}`,
          location: j.locationsText, portal: 'workday',
        }));
      }
      case 'smartrecruiters': {
        const d = data as { content?: Array<{ name: string; ref: string; location?: { city?: string; country?: string }; workplace?: { wtype?: string } }> };
        return (d.content ?? []).filter(j => passes(j.name, f)).map(j => ({
          company: company.name, role: j.name, url: j.ref,
          location: [j.location?.city, j.location?.country].filter(Boolean).join(', '),
          remote: j.workplace?.wtype === 'REMOTE', portal: 'smartrecruiters',
        }));
      }
    }
  } catch { /* silent */ }
  return [];
}

// ══════════════════════════════════════════════════════════════════════
// AGGREGATOR API FETCHERS
// ══════════════════════════════════════════════════════════════════════

async function fetchRemotive(agg: Aggregator, f: ReturnType<typeof buildFilter>): Promise<JobListing[]> {
  const categories = agg.categories ?? ['marketing', 'business-development', 'sales', 'other'];
  const results: JobListing[] = [];
  for (const cat of categories) {
    try {
      const data = await fetchJSON(`https://remotive.com/api/remote-jobs?category=${cat}&limit=100`) as {
        jobs?: Array<{ title: string; company_name: string; url: string; candidate_required_location?: string; salary?: string }>;
      };
      for (const j of data.jobs ?? []) {
        if (passes(j.title, f)) {
          results.push({
            company: j.company_name, role: j.title, url: j.url,
            location: j.candidate_required_location ?? 'Remote', remote: true,
            salary: j.salary || undefined, portal: 'remotive',
          });
        }
      }
    } catch { /* continue */ }
  }
  return results;
}

async function fetchRemoteOK(agg: Aggregator, f: ReturnType<typeof buildFilter>): Promise<JobListing[]> {
  const tags = agg.tags ?? ['marketing', 'crypto', 'blockchain'];
  const results: JobListing[] = [];
  for (const tag of tags) {
    try {
      const data = await fetchJSON(`https://remoteok.com/api?tag=${encodeURIComponent(tag)}`) as Array<{
        company?: string; position?: string; url?: string; location?: string; salary_min?: number; salary_max?: number;
      }>;
      for (const j of (Array.isArray(data) ? data.slice(1) : [])) { // first item is metadata
        if (!j.position || !j.company || !j.url) continue;
        if (passes(j.position, f)) {
          const salary = j.salary_min && j.salary_max ? `$${Math.round(j.salary_min/1000)}k–$${Math.round(j.salary_max/1000)}k` : undefined;
          results.push({
            company: j.company, role: j.position,
            url: j.url.startsWith('http') ? j.url : `https://remoteok.com${j.url}`,
            location: j.location ?? 'Remote', remote: true,
            salary, portal: 'remoteok',
          });
        }
      }
    } catch { /* continue */ }
  }
  return results;
}

async function fetchHimalayas(agg: Aggregator, f: ReturnType<typeof buildFilter>): Promise<JobListing[]> {
  const queries = agg.queries ?? ['partnership manager', 'business development', 'growth marketing'];
  const results: JobListing[] = [];
  for (const q of queries) {
    try {
      const data = await fetchJSON(
        `https://himalayas.app/api/jobs?q=${encodeURIComponent(q)}&remote=true&limit=50`
      ) as { jobs?: Array<{ title: string; company: { name: string }; applicationUrl?: string; slug?: string; location?: string; salaryRange?: string }> };
      for (const j of data.jobs ?? []) {
        if (passes(j.title, f)) {
          results.push({
            company: j.company.name, role: j.title,
            url: j.applicationUrl ?? `https://himalayas.app/jobs/${j.slug}`,
            location: j.location ?? 'Remote', remote: true,
            salary: j.salaryRange || undefined, portal: 'himalayas',
          });
        }
      }
    } catch { /* continue */ }
  }
  return results;
}

// ══════════════════════════════════════════════════════════════════════
// RSS FEED PARSER
// ══════════════════════════════════════════════════════════════════════

function parseRSS(xml: string, sourceName: string, f: ReturnType<typeof buildFilter>): JobListing[] {
  const results: JobListing[] = [];

  // Extract <item> blocks
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];

  for (const item of items) {
    const title   = (item.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i) ?? item.match(/<title[^>]*>(.*?)<\/title>/i))?.[1]?.trim() ?? '';
    const link    = (item.match(/<link>(.*?)<\/link>/i) ?? item.match(/<guid[^>]*>(.*?)<\/guid>/i))?.[1]?.trim() ?? '';
    const company = (item.match(/<author>(.*?)<\/author>/i) ?? item.match(/<dc:creator>(.*?)<\/dc:creator>/i))?.[1]?.trim()
                 ?? sourceName;
    const desc    = (item.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/i) ?? item.match(/<description[^>]*>(.*?)<\/description>/i))?.[1] ?? '';

    // Try to extract company from title pattern "Role at Company"
    const atMatch = title.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    const role    = atMatch ? atMatch[1].trim() : title;
    const co      = atMatch ? atMatch[2].trim() : company;

    // Extract location from description (rudimentary)
    const locMatch = desc.match(/(?:location|remote|🌍|🌎)[:\s]*([A-Za-z,\s]+?)(?:<|\.|$)/i);
    const location = locMatch?.[1]?.trim();

    if (role && link && passes(role, f)) {
      results.push({ company: co, role, url: link, location, remote: title.toLowerCase().includes('remote'), portal: 'rss' });
    }
  }
  return results;
}

async function fetchRSSFeed(feed: RssFeed, f: ReturnType<typeof buildFilter>): Promise<JobListing[]> {
  try {
    const xml = await fetchText(feed.url);
    return parseRSS(xml, feed.name, f);
  } catch { return []; }
}

// ══════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════

async function runWithConcurrency<T, R>(items: T[], fn: (item: T) => Promise<R>, n: number): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  }
  return out;
}

function ensurePipelineMd() {
  if (!existsSync(PIPELINE_PATH)) {
    writeFileSync(PIPELINE_PATH, '# Pipeline — Pending Evaluation\n\nPaste job URLs or add via scan.\n\n');
  }
}

function portalColor(portal: string): string {
  const map: Record<string, (s: string) => string> = {
    greenhouse: chalk.green, ashby: chalk.blue, lever: chalk.magenta,
    workday: chalk.yellow, smartrecruiters: chalk.cyan,
    remotive: chalk.greenBright, remoteok: chalk.blueBright,
    himalayas: chalk.magentaBright, rss: chalk.white,
  };
  return (map[portal] ?? chalk.gray)(portal);
}

async function main() {
  if (!existsSync(PORTALS_PATH)) {
    console.error(chalk.red('config/portals.yml not found.'));
    process.exit(1);
  }

  const config = yaml.load(readFileSync(PORTALS_PATH, 'utf8')) as PortalConfig;
  const f = buildFilter(config);
  const allListings: JobListing[] = [];
  const start = Date.now();

  // ── Company portals ──────────────────────────────────────────────
  if (!SOURCE_FILTER || SOURCE_FILTER === 'portals' || SOURCE_FILTER === 'all') {
    let companies = (config.companies ?? []).filter(c => c.enabled !== false);
    if (COMPANY_FILTER) companies = companies.filter(c => c.name.toLowerCase().includes(COMPANY_FILTER));

    const spinner = ora(`Scanning ${companies.length} company portals…`).start();
    const results = (await runWithConcurrency(companies, c => fetchCompany(c, f), CONCURRENCY)).flat();
    spinner.succeed(`${chalk.bold(companies.length)} company portals → ${chalk.bold(results.length)} matches`);
    allListings.push(...results);
  }

  // ── Aggregator APIs ──────────────────────────────────────────────
  if (!SOURCE_FILTER || SOURCE_FILTER === 'feeds' || SOURCE_FILTER === 'all') {
    const aggregators = (config.aggregators ?? []).filter(a => a.enabled !== false);
    if (aggregators.length) {
      const spinner = ora(`Scanning ${aggregators.length} job aggregators…`).start();
      for (const agg of aggregators) {
        let results: JobListing[] = [];
        try {
          if (agg.type === 'remotive')  results = await fetchRemotive(agg, f);
          if (agg.type === 'remoteok')  results = await fetchRemoteOK(agg, f);
          if (agg.type === 'himalayas') results = await fetchHimalayas(agg, f);
        } catch { /* silent */ }
        allListings.push(...results);
        spinner.text = `${agg.name}: ${results.length} matches`;
      }
      const aggTotal = allListings.filter(l => ['remotive','remoteok','himalayas'].includes(l.portal)).length;
      spinner.succeed(`${chalk.bold(aggregators.length)} aggregators → ${chalk.bold(aggTotal)} matches`);
    }
  }

  // ── RSS feeds ────────────────────────────────────────────────────
  if (!SOURCE_FILTER || SOURCE_FILTER === 'feeds' || SOURCE_FILTER === 'all') {
    const feeds = (config.rss_feeds ?? []).filter(fd => fd.enabled !== false);
    if (feeds.length) {
      const spinner = ora(`Scanning ${feeds.length} RSS feeds…`).start();
      const results = (await runWithConcurrency(feeds, fd => fetchRSSFeed(fd, f), 4)).flat();
      spinner.succeed(`${chalk.bold(feeds.length)} RSS feeds → ${chalk.bold(results.length)} matches`);
      allListings.push(...results);
    }
  }

  // ── Dedup ────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const deduped = allListings.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
  const newListings = deduped.filter(l => !hasSeenUrl(l.url) && !hasSeenInApplications(l.url));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(chalk.bold(`\n  ${deduped.length} total matches · ${chalk.green(newListings.length + ' new')} · ${elapsed}s\n`));

  if (!newListings.length) { console.log(chalk.dim('  No new listings.')); return; }

  if (DRY_RUN) {
    console.log(chalk.yellow('[DRY RUN] Would add:'));
    for (const l of newListings) {
      console.log(`  [${portalColor(l.portal)}] ${chalk.bold(l.company)} — ${l.role}`);
      if (l.location) console.log(chalk.dim(`    ${l.location}`));
    }
    return;
  }

  ensurePipelineMd();

  // Group by source for readable output
  const byPortal = new Map<string, JobListing[]>();
  for (const l of newListings) {
    if (!byPortal.has(l.portal)) byPortal.set(l.portal, []);
    byPortal.get(l.portal)!.push(l);
  }

  const lines: string[] = [`\n## Scan — ${new Date().toISOString().split('T')[0]} (${newListings.length} new)\n`];

  for (const [portal, jobs] of byPortal) {
    lines.push(`\n### Source: ${portal}\n`);
    for (const l of jobs) {
      const meta = [l.location, l.remote ? 'Remote' : null, l.salary].filter(Boolean).join(' · ');
      lines.push(`- [ ] **${l.company}** — ${l.role}${meta ? ` · ${meta}` : ''}`);
      lines.push(`  URL: ${l.url}`);
      lines.push(`  Portal: ${portal}`);
      lines.push('');
      recordScan(l.company, l.role, l.url, portal);
      const scored = scoreJob({ role: l.role, company: l.company, location: l.location, remote: l.remote, portal });
      upsertPipelineJob({ company: l.company, role: l.role, url: l.url, portal, location: l.location, remote: l.remote, salary: l.salary, fit_score: scored.score, fit_label: scored.label });
    }
  }

  appendFileSync(PIPELINE_PATH, lines.join('\n'));

  // Summary by source
  console.log('  Added by source:');
  for (const [portal, jobs] of byPortal) {
    console.log(`    ${portalColor(portal).padEnd(20)} ${chalk.bold(jobs.length)} jobs`);
  }
  console.log(chalk.green(`\n  ✓ ${newListings.length} new listings → data/pipeline.md`));
  console.log(chalk.dim('  Open Claude Code and paste a job URL to start evaluating.'));
}

main().catch(err => {
  console.error(chalk.red('Scan failed:'), err.message);
  process.exit(1);
});
