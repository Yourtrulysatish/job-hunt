#!/usr/bin/env tsx
/**
 * generate.ts — AI-powered resume + cover letter generator
 *
 * Uses Claude API to generate a complete application package from a job URL.
 * Reads your cv.md, modes/_profile.md, and the live job description.
 * Saves output to output/applications/{num}-{slug}-{date}/
 *
 * Usage:
 *   npm run generate -- --url "https://ripple.com/careers/..."
 *   npm run generate -- --url "..." --type cover    (cover letter only)
 *   npm run generate -- --url "..." --type resume   (CV changes only)
 *   npm run generate -- --url "..." --type all      (default: everything)
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..', '..');

// ── Args ──────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const url    = args.includes('--url')  ? args[args.indexOf('--url') + 1]  : null;
const type   = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'all';

if (!url) {
  console.error(chalk.red('Usage: npm run generate -- --url "https://..."'));
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(chalk.red('ANTHROPIC_API_KEY not set. Add it to your .env file.'));
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────

function readFile(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
}

function nextOutputNum(): number {
  const dir = join(ROOT, 'output', 'applications');
  if (!existsSync(dir)) return 1;
  const existing = require('fs').readdirSync(dir)
    .map((f: string) => parseInt(f.split('-')[0]))
    .filter((n: number) => !isNaN(n));
  return existing.length ? Math.max(...existing) + 1 : 1;
}

async function fetchJobDescription(jobUrl: string): Promise<string> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page    = await browser.newPage();
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    await browser.close();
    return text.slice(0, 8000);
  } catch {
    // Fallback to plain fetch
    const res = await fetch(jobUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 8000);
  }
}

// ── Prompts ───────────────────────────────────────────────────────────

function buildSystemPrompt(cv: string, profile: string, digest: string): string {
  return `You are a professional career writer helping Satish Chand Gupta apply for jobs.

SATISH'S CV:
${cv}

SATISH'S PROFILE & PROOF POINTS:
${profile}

${digest ? `ADDITIONAL PROOF POINTS:\n${digest}` : ''}

RULES — follow these strictly:
- NEVER invent metrics or experience not in the CV above
- NEVER use: passionate, dynamic, synergy, leverage, spearheaded, robust, innovative, results-oriented
- Write in direct, confident, specific language — not corporate speak
- Every metric cited must come from the CV above, verbatim
- Cover letters must be max 250 words, 3 paragraphs
- The output should feel like it was written by Satish himself, not by AI`;
}

function coverLetterPrompt(jd: string, jobUrl: string): string {
  return `Write a tailored cover letter for this job.

JOB URL: ${jobUrl}

JOB DESCRIPTION:
${jd}

FORMAT:
- Header: Satish Chand Gupta | satishofficial001@gmail.com | linkedin.com/in/yourtrulysatish | Siena, Italy — Remote
- 3 paragraphs, max 250 words total
- Para 1: Hook — something specific about THIS company + immediate connection to Satish's background
- Para 2: 2–3 proof points with exact metrics from his CV, using the JD's own language
- Para 3: Specific reason for this company + clear call to action
- Do NOT start with "I am writing to apply"
- Output only the letter — no commentary`;
}

function resumeChangesPrompt(jd: string): string {
  return `Identify exactly 5 specific CV edits that would improve Satish's match for this job.

JOB DESCRIPTION:
${jd}

FORMAT for each change:
### Change N: [Section]
**Current:** "[exact current text from CV]"
**Rewrite to:** "[improved version]"
**Why:** [one line — which JD keyword/requirement this targets]

Rules:
- Only suggest changes that meaningfully improve ATS match or recruiter relevance
- Prioritize: Summary, top Experience bullets, Skills section
- Inject missing JD keywords where natural
- Never invent new experience — only reframe or reorder what exists
- If a required skill is genuinely absent, flag it honestly`;
}

function recruiterEmailPrompt(jd: string, jobUrl: string): string {
  return `Write a cold email to send to the recruiter or hiring manager for this role.

JOB URL: ${jobUrl}
JOB DESCRIPTION:
${jd}

OUTPUT:
1. Three subject line options (specific, not generic)
2. Email body (max 150 words):
   - Line 1: something specific about the company or team (not the posting)
   - Middle: one concrete proof point from Satish's background
   - Close: easy, specific ask (15-min call)
   - Tone: warm, direct, confident — not desperate

Output in markdown, clearly separated.`;
}

function linkedinPrompt(jd: string): string {
  return `Write LinkedIn outreach for this role.

JOB DESCRIPTION (for context):
${jd}

OUTPUT:
1. Connection request message (max 300 characters — LinkedIn limit)
2. Follow-up message after they connect (3–5 sentences, one proof point)

Both must feel personal and specific, not templated.`;
}

function applicationNotesPrompt(jd: string): string {
  return `Create application notes for Satish to use when filling the form.

JOB DESCRIPTION:
${jd}

FORMAT:
## Key JD phrases to mirror in form answers
- [phrase]
- [phrase]

## Best proof points for this role (from his CV)
1. [achievement with metric]
2. [achievement with metric]
3. [achievement with metric]

## Likely screening questions + suggested answers
Q: [question]
A: [2–3 sentence answer using Satish's real experience]

## Compensation target
Based on this role and level: $[X]–$[Y] base
Ask about: [token/equity if Web3, remote confirmation, etc.]

## Red flags to address proactively
- [any gap or mismatch and how to frame it]`;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const cv      = readFile(join(ROOT, 'cv.md'));
  const profile = readFile(join(ROOT, 'modes', '_profile.md'));
  const digest  = readFile(join(ROOT, 'article-digest.md'));

  if (!cv) { console.error(chalk.red('cv.md not found.')); process.exit(1); }

  // Fetch JD
  const spinner = ora('Fetching job description…').start();
  let jd = '';
  try {
    jd = await fetchJobDescription(url!);
    spinner.succeed('Job description fetched');
  } catch (e) {
    spinner.fail('Could not fetch JD — paste it manually into the prompt');
    jd = `URL: ${url}`;
  }

  // Detect company from URL for folder naming
  const companyGuess = url!.match(/(?:boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com|ripple\.com|coinbase\.com)\/([^/?#]+)/)?.[1]
    ?? new URL(url!).hostname.replace('www.', '').split('.')[0];

  const num       = nextOutputNum();
  const date      = new Date().toISOString().split('T')[0];
  const outDir    = join(ROOT, 'output', 'applications', `${String(num).padStart(3, '0')}-${slug(companyGuess)}-${date}`);
  mkdirSync(outDir, { recursive: true });

  const system = buildSystemPrompt(cv, profile, digest);

  const tasks: { name: string; prompt: string; filename: string; skip: boolean }[] = [
    { name: 'Cover letter',       prompt: coverLetterPrompt(jd, url!),  filename: 'cover-letter.md',      skip: type === 'resume' },
    { name: 'CV changes',         prompt: resumeChangesPrompt(jd),       filename: 'cv-changes.md',        skip: type === 'cover' },
    { name: 'Recruiter email',    prompt: recruiterEmailPrompt(jd, url!), filename: 'recruiter-email.md',  skip: type !== 'all' },
    { name: 'LinkedIn outreach',  prompt: linkedinPrompt(jd),            filename: 'linkedin-message.md', skip: type !== 'all' },
    { name: 'Application notes',  prompt: applicationNotesPrompt(jd),    filename: 'application-notes.md', skip: type !== 'all' },
  ];

  console.log();
  for (const task of tasks) {
    if (task.skip) continue;
    const s = ora(`Generating ${task.name}…`).start();
    try {
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: task.prompt }],
      });
      const content = (msg.content[0] as { text: string }).text;
      writeFileSync(join(outDir, task.filename), content);
      s.succeed(`${task.name} → ${task.filename}`);
    } catch (e: unknown) {
      s.fail(`${task.name} failed: ${(e as Error).message}`);
    }
  }

  // Save metadata
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ url, generated_at: new Date().toISOString(), jd_preview: jd.slice(0, 500) }, null, 2));

  console.log();
  console.log(chalk.green(`  ✓ Application package saved to:`));
  console.log(chalk.bold(`    ${outDir}`));
  console.log();
  console.log('  Next steps:');
  console.log(chalk.dim('  1. Review cover-letter.md and edit if needed'));
  console.log(chalk.dim('  2. Apply the 5 changes from cv-changes.md'));
  console.log(chalk.dim('  3. Find hiring manager → send recruiter-email.md'));
  console.log(chalk.dim('  4. Submit the application'));
  console.log(chalk.dim(`  5. npm run record -- --company "${companyGuess}" --status Applied`));
  console.log();
}

main().catch(e => {
  console.error(chalk.red('Generate failed:'), e.message);
  process.exit(1);
});
