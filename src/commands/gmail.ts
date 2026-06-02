#!/usr/bin/env tsx
/**
 * gmail.ts — Gmail integration for job-hunt
 *
 * Scans your Gmail for recruiter emails, interview invitations, rejections,
 * and offer letters. Auto-updates application statuses in SQLite.
 *
 * SETUP (one-time):
 *   1. Go to console.cloud.google.com
 *   2. Create project → Enable Gmail API
 *   3. Create OAuth 2.0 credentials (Desktop app)
 *   4. Download credentials → save as config/gmail-credentials.json
 *   5. Run: npm run gmail:auth   (opens browser for one-time login)
 *   6. Run: npm run gmail        (scan inbox)
 *
 * Usage:
 *   npm run gmail:auth   — first-time OAuth setup
 *   npm run gmail        — scan inbox and update statuses
 *   npm run gmail -- --days 30  — scan last 30 days (default: 14)
 */

import { google, type gmail_v1 } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as http from 'http';
import * as url from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { getDb } from '../db/client.js';
import { upsertGmailThread, getRecentGmailThreads, updateApplicationStatus } from '../db/queries.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ROOT         = join(__dirname, '..', '..');
const CREDS_PATH   = join(ROOT, 'config', 'gmail-credentials.json');
const TOKEN_PATH   = join(ROOT, 'config', 'gmail-token.json');
const SCOPES       = ['https://www.googleapis.com/auth/gmail.readonly'];

const args    = process.argv.slice(2);
const IS_AUTH = args.includes('auth') || args[0] === 'auth';
const DAYS    = args.includes('--days') ? parseInt(args[args.indexOf('--days') + 1]) : 14;

// ── OAuth setup ───────────────────────────────────────────────────────

function getOAuthClient() {
  if (!existsSync(CREDS_PATH)) {
    console.error(chalk.red('\nGmail credentials not found.'));
    console.log(chalk.dim('\nSetup steps:'));
    console.log(chalk.dim('  1. Go to https://console.cloud.google.com'));
    console.log(chalk.dim('  2. Create project → APIs & Services → Enable Gmail API'));
    console.log(chalk.dim('  3. Credentials → Create → OAuth 2.0 Client ID → Desktop app'));
    console.log(chalk.dim('  4. Download JSON → save as config/gmail-credentials.json'));
    console.log(chalk.dim('  5. Run: npm run gmail:auth'));
    process.exit(1);
  }

  const creds = JSON.parse(readFileSync(CREDS_PATH, 'utf8'));
  const { client_secret, client_id, redirect_uris } = creds.installed ?? creds.web;
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

async function authorize(): Promise<gmail_v1.Gmail> {
  const oAuth2 = getOAuthClient();

  if (existsSync(TOKEN_PATH)) {
    const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2.setCredentials(token);

    // Refresh if expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      const { credentials } = await oAuth2.refreshAccessToken();
      oAuth2.setCredentials(credentials);
      writeFileSync(TOKEN_PATH, JSON.stringify(credentials));
    }

    return google.gmail({ version: 'v1', auth: oAuth2 });
  }

  // Need fresh auth
  console.error(chalk.red('Not authenticated. Run: npm run gmail:auth'));
  process.exit(1);
}

async function runAuthFlow() {
  const oAuth2   = getOAuthClient();
  const authUrl  = oAuth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES });

  console.log();
  console.log(chalk.bold('Gmail OAuth Setup'));
  console.log(chalk.dim('Opening browser for authorization…'));
  console.log();
  console.log('If the browser does not open, go to:');
  console.log(chalk.blue(authUrl));
  console.log();

  // Open browser
  const { exec } = await import('child_process');
  exec(`open "${authUrl}"`);

  // Local server to catch redirect
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const qs   = url.parse(req.url ?? '', true).query;
      const code = qs.code as string;
      res.end('<h2>Done! You can close this tab and return to the terminal.</h2>');
      server.close();
      code ? resolve(code) : reject(new Error('No code in redirect'));
    });
    server.listen(3000, () => console.log(chalk.dim('Waiting for authorization…')));
    setTimeout(() => { server.close(); reject(new Error('Timeout')); }, 120_000);
  });

  const { tokens } = await oAuth2.getToken(code);
  oAuth2.setCredentials(tokens);
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.log(chalk.green('\n✓ Gmail authorized. Token saved to config/gmail-token.json'));
  console.log(chalk.dim('Now run: npm run gmail'));
}

// ── Email classification ───────────────────────────────────────────────

const PATTERNS = {
  interview: [
    /interview/i, /schedule.*call/i, /book.*time/i, /calendly/i,
    /zoom.*link/i, /meet.*with.*team/i, /next.*step/i, /moving.*forward/i,
    /excited.*speak/i, /like.*to.*chat/i, /phone.*screen/i,
  ],
  offer: [
    /offer.*letter/i, /offer.*position/i, /pleased.*offer/i, /extend.*offer/i,
    /compensation.*package/i, /start.*date/i, /onboarding/i,
  ],
  rejection: [
    /unfortunately/i, /not.*moving.*forward/i, /decided.*not/i, /other.*candidates/i,
    /position.*filled/i, /not.*a.*fit/i, /won't.*be.*moving/i, /regret/i,
  ],
  recruiter: [
    /recruiter/i, /talent.*acquisition/i, /hiring.*team/i, /seen.*your.*profile/i,
    /opportunity.*at/i, /role.*at/i, /position.*at/i, /exciting.*opportunity/i,
    /reach.*out.*about/i, /we.*hiring/i,
  ],
};

function classifyEmail(subject: string, snippet: string): string {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (PATTERNS.offer.some(r => r.test(text)))      return 'offer';
  if (PATTERNS.interview.some(r => r.test(text)))  return 'interview';
  if (PATTERNS.rejection.some(r => r.test(text)))  return 'rejection';
  if (PATTERNS.recruiter.some(r => r.test(text)))  return 'recruiter';
  return 'other';
}

// ── Match email to application ────────────────────────────────────────

function matchToApplication(fromEmail: string, fromName: string, subject: string): number | undefined {
  const db = getDb();
  const apps = db.prepare(
    `SELECT id, company, role FROM applications WHERE status NOT IN ('Rejected','Discarded','SKIP')`
  ).all() as { id: number; company: string; role: string }[];

  const text = `${fromEmail} ${fromName} ${subject}`.toLowerCase();

  for (const app of apps) {
    const companySlug = app.company.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (text.includes(companySlug) || text.includes(app.company.toLowerCase())) {
      return app.id;
    }
  }
  return undefined;
}

// ── Status updates from email label ───────────────────────────────────

const LABEL_TO_STATUS: Record<string, string> = {
  interview:  'Interview',
  offer:      'Offer',
  rejection:  'Rejected',
  recruiter:  'Responded',
};

// ── Main scan ─────────────────────────────────────────────────────────

async function scanGmail() {
  const gmail   = await authorize();
  const spinner = ora('Scanning Gmail…').start();

  const after   = Math.floor(Date.now() / 1000) - DAYS * 86400;
  const query   = `after:${after} (interview OR recruiter OR "job opportunity" OR "position at" OR "offer" OR "unfortunately" OR "next steps")`;

  let threads: gmail_v1.Schema$Thread[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.threads.list({
      userId: 'me', q: query, maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    });
    threads = threads.concat(res.data.threads ?? []);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && threads.length < 500);

  spinner.text = `Processing ${threads.length} threads…`;

  let processed = 0, updated = 0, newThreads = 0;

  for (const thread of threads) {
    if (!thread.id) continue;

    // Fetch thread details
    const detail = await gmail.users.threads.get({
      userId: 'me', id: thread.id, format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    }).catch(() => null);

    if (!detail?.data.messages?.[0]) continue;

    const msg      = detail.data.messages[0];
    const headers  = msg.payload?.headers ?? [];
    const get      = (name: string) => headers.find(h => h.name === name)?.value ?? '';

    const subject  = get('Subject');
    const from     = get('From');
    const date     = get('Date');
    const snippet  = thread.snippet ?? '';

    // Parse from field: "Name <email>"
    const fromMatch = from.match(/^(?:"?(.+?)"?\s+)?<(.+)>$/) ?? [null, from, from];
    const fromName  = fromMatch[1]?.trim() ?? '';
    const fromEmail = fromMatch[2]?.trim() ?? from;

    const label     = classifyEmail(subject, snippet);
    const appId     = matchToApplication(fromEmail, fromName, subject);

    upsertGmailThread({ thread_id: thread.id, subject, from_email: fromEmail, from_name: fromName, snippet, date, label, application_id: appId });
    newThreads++;

    // Auto-update application status
    if (appId && label !== 'other' && label !== 'recruiter') {
      const newStatus = LABEL_TO_STATUS[label];
      if (newStatus) {
        updateApplicationStatus(appId, newStatus, `Auto-detected from Gmail: "${subject}"`);
        updated++;
      }
    }

    processed++;
  }

  spinner.succeed(`Scanned ${threads.length} threads · ${newThreads} saved · ${updated} application statuses updated`);

  // Show summary
  if (updated > 0) {
    console.log();
    console.log(chalk.bold('  Status updates:'));
    const recent = getRecentGmailThreads(10).filter(t => t.label !== 'other');
    for (const t of recent) {
      const icon = t.label === 'interview' ? '📅' : t.label === 'offer' ? '🎉' : t.label === 'rejection' ? '❌' : '📩';
      console.log(`  ${icon} ${chalk.bold(t.label.toUpperCase())} — ${t.from_name || t.from_email}`);
      console.log(chalk.dim(`    "${t.subject}"`));
      if (t.company) console.log(chalk.dim(`    Matched to: ${t.company}`));
    }
  }

  console.log();
  console.log(chalk.dim(`  View in dashboard: npm run dashboard`));
}

// ── Entry point ───────────────────────────────────────────────────────

if (IS_AUTH) {
  runAuthFlow().catch(e => { console.error(chalk.red(e.message)); process.exit(1); });
} else {
  scanGmail().catch(e => {
    if (e.message?.includes('invalid_grant') || e.message?.includes('Token')) {
      console.error(chalk.red('Auth token expired. Run: npm run gmail:auth'));
    } else {
      console.error(chalk.red('Gmail scan failed:'), e.message);
    }
    process.exit(1);
  });
}
