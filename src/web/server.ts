#!/usr/bin/env tsx
/**
 * server.ts — Web dashboard for job-hunt
 */

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { createHmac } from 'crypto';
import yaml from 'js-yaml';
import { initDb } from '../db/client-async.js';
import {
  getApplications, getStats, getOverdueFollowups, getTopSkillGaps,
  getPipelineJobs, getAllContacts, getAllFollowups, getRecentGmailThreads,
  insertContact, completeFollowup, markPipelineJobReviewed,
} from '../db/queries-async.js';
import {
  getHunterStats, getDailyQuests, getAllUnlockedAchievements,
  getRecentXPLog, ensureDailyQuests, getUnlockedAchievementKeys,
} from '../utils/gamification-async.js';
import {
  getRankInfo, getLevelFromXP, ACHIEVEMENTS,
} from '../utils/gamification.js';
import { scoreJob } from '../utils/scorer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PORT = Number(process.env.DASHBOARD_PORT ?? 3333);
const PIN = process.env.DASHBOARD_PIN ?? '0408';
const COOKIE_SECRET = process.env.COOKIE_SECRET ?? 'jh-secret-xK9p-2026';
const COOKIE_NAME = 'jh_auth';

function makeToken() {
  return createHmac('sha256', COOKIE_SECRET).update(PIN).digest('hex').slice(0, 32);
}

function parseCookies(req: express.Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = v.join('=');
  }
  return out;
}

function requirePin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.path === '/pin') return next();
  if (parseCookies(req)[COOKIE_NAME] === makeToken()) return next();
  res.redirect('/pin');
}

const PIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Job Hunt — Enter PIN</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f1117; color: #e2e8f0; font-family: system-ui, sans-serif;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1d27; border: 1px solid #2d3148; border-radius: 12px;
            padding: 2.5rem 3rem; width: 320px; text-align: center; }
    h1 { font-size: 1.1rem; color: #94a3b8; margin-bottom: 1.8rem; letter-spacing: 0.05em; }
    input { width: 100%; padding: 0.75rem 1rem; font-size: 1.5rem; letter-spacing: 0.4em;
            text-align: center; background: #0f1117; border: 1px solid #2d3148;
            border-radius: 8px; color: #e2e8f0; outline: none; }
    input:focus { border-color: #6366f1; }
    button { margin-top: 1.2rem; width: 100%; padding: 0.75rem; background: #6366f1;
             border: none; border-radius: 8px; color: #fff; font-size: 1rem;
             cursor: pointer; transition: background 0.15s; }
    button:hover { background: #4f46e5; }
    .error { margin-top: 1rem; color: #f87171; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>JOB HUNT</h1>
    <form method="POST" action="/pin">
      <input type="password" name="pin" inputmode="numeric" maxlength="8" autofocus placeholder="••••" />
      <button type="submit">Unlock</button>
      {{ERROR}}
    </form>
  </div>
</body>
</html>`;

// ── Pipeline markdown parser (fallback when DB pipeline_jobs is empty) ──

function parsePipelineMd() {
  const path = join(ROOT, 'data', 'pipeline.md');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const jobs: { company: string; role: string; url: string; portal: string; location: string; checked: boolean; fit_score: number; fit_label: string; fit_reasons: string[]; skip_reason?: string }[] = [];
  let current: Partial<typeof jobs[0]> | null = null;
  let section = '';
  for (const line of text.split('\n')) {
    const sec = line.match(/^###\s+Source:\s*(.+)$/i);
    if (sec) { section = sec[1].trim(); continue; }
    const m = line.match(/^- \[([ x])\] \*\*(.+?)\*\* — (.+?)(?:\s·\s(.+))?$/);
    if (m) {
      current = { checked: m[1] === 'x', company: m[2], role: m[3].trim(), location: m[4]?.trim() ?? '', portal: section, fit_score: 0, fit_label: 'Weak Match', fit_reasons: [] };
      jobs.push(current as typeof jobs[0]);
    } else if (current) {
      const u = line.match(/^\s+URL:\s*(.+)$/);
      const p = line.match(/^\s+Portal:\s*(.+)$/);
      if (u) current.url = u[1].trim();
      if (p && !current.portal) current.portal = p[1].trim();
    }
  }
  for (const j of jobs) {
    const s = scoreJob({ role: j.role, company: j.company, location: j.location, portal: j.portal });
    j.fit_score = s.score; j.fit_label = s.label; j.fit_reasons = s.reasons;
    if (s.skipReason) j.skip_reason = s.skipReason;
  }
  return jobs;
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(requirePin);
app.use(express.static(join(__dirname, 'public')));

app.get('/pin', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(PIN_PAGE.replace('{{ERROR}}', ''));
});

app.post('/pin', (req, res) => {
  if (req.body.pin === PIN) {
    const token = makeToken();
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
    return res.redirect('/');
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(PIN_PAGE.replace('{{ERROR}}', '<p class="error">Incorrect PIN</p>'));
});

// ── API: Stats ────────────────────────────────────────────────────────

app.get('/api/stats', async (_req, res) => {
  try { res.json(await getStats()); }
  catch { res.status(500).json({ error: 'DB not initialized.' }); }
});

// ── API: Applications ─────────────────────────────────────────────────

app.get('/api/applications', async (req, res) => {
  try {
    const { status, minScore, company, limit } = req.query;
    res.json(await getApplications({ status: status as string, minScore: minScore ? Number(minScore) : undefined, company: company as string, limit: limit ? Number(limit) : undefined }));
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Pipeline (opportunity database) ─────────────────────────────

app.get('/api/pipeline', async (_req, res) => {
  try {
    const dbJobs = await getPipelineJobs({ limit: 200 });
    if (dbJobs.length > 0) return res.json(dbJobs.map(j => {
      const scored = scoreJob({ role: j.role, company: j.company, location: j.location, portal: j.portal });
      return { ...j, checked: j.status !== 'new', fit_reasons: scored.reasons, remote: j.remote === 1 };
    }));
    res.json(parsePipelineMd());
  } catch { res.json(parsePipelineMd()); }
});

app.patch('/api/pipeline/:url/status', async (req, res) => {
  try {
    const { status } = req.body as { status: 'reviewed' | 'applied' | 'skipped' };
    await markPipelineJobReviewed(decodeURIComponent(req.params.url), status);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Recommendations ──────────────────────────────────────────────

app.get('/api/recommendations', async (_req, res) => {
  try {
    const dbJobs = await getPipelineJobs({ limit: 200 });
    if (dbJobs.length > 0) {
      const scored = dbJobs
        .filter(j => j.status === 'new' && (j.fit_score ?? 0) >= 3.5)
        .map(j => ({ ...j, checked: false, fit_reasons: scoreJob({ role: j.role, company: j.company, location: j.location, portal: j.portal }).reasons, remote: j.remote === 1 }))
        .sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0))
        .slice(0, 10);
      return res.json(scored);
    }
    const mdJobs = parsePipelineMd().filter(j => !j.checked);
    res.json(mdJobs.filter(j => j.fit_score >= 3.5 && !j.skip_reason).sort((a, b) => b.fit_score - a.fit_score).slice(0, 10));
  } catch {
    const mdJobs = parsePipelineMd().filter(j => !j.checked);
    res.json(mdJobs.filter(j => j.fit_score >= 3.5 && !j.skip_reason).sort((a, b) => b.fit_score - a.fit_score).slice(0, 10));
  }
});

// ── API: Follow-ups ────────────────────────────────────────────────────

app.get('/api/followups', async (_req, res) => {
  try { res.json(await getAllFollowups()); }
  catch { res.status(500).json({ error: 'Failed.' }); }
});

app.post('/api/followups/:id/complete', async (req, res) => {
  try { await completeFollowup(Number(req.params.id)); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Contacts ──────────────────────────────────────────────────────

app.get('/api/contacts', async (_req, res) => {
  try { res.json(await getAllContacts()); }
  catch { res.status(500).json({ error: 'Failed.' }); }
});

app.post('/api/contacts', async (req, res) => {
  try {
    const body = req.body as { company: string; name: string; title?: string; linkedin_url?: string; email?: string; notes?: string };
    const id = await insertContact({ company: body.company, name: body.name, title: body.title ?? null, linkedin_url: body.linkedin_url ?? null, email: body.email ?? null, connection: 'none', referral: 0, outreach_sent: 0, outreach_date: null, response: null, notes: body.notes ?? null, application_id: null });
    res.json({ id });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Skills gap ────────────────────────────────────────────────────

app.get('/api/skills-gap', async (_req, res) => {
  try { res.json(await getTopSkillGaps(15)); }
  catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Gmail ────────────────────────────────────────────────────────

app.get('/api/gmail', async (_req, res) => {
  try { res.json(await getRecentGmailThreads(30)); }
  catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Scan trigger ─────────────────────────────────────────────────

let scanRunning = false;
let lastScanResult: { newJobs: number; total: number; timestamp: string } | null = null;

app.get('/api/scan/status', (_req, res) => {
  res.json({ running: scanRunning, last: lastScanResult });
});

function runCommand(cmd: string[], onDone: (stdout: string) => void) {
  const proc = spawn('npx', cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
  proc.stderr.on('data', (d: Buffer) => { stdout += d.toString(); });
  proc.on('close', () => onDone(stdout));
}

app.post('/api/scan', (_req, res) => {
  if (scanRunning) return res.status(409).json({ error: 'Scan already running' });
  scanRunning = true;
  res.json({ started: true });

  runCommand(['tsx', 'src/commands/scan.ts'], stdout => {
    scanRunning = false;
    const newMatch   = stdout.match(/(\d+) new/);
    const totalMatch = stdout.match(/(\d+) total/);
    lastScanResult = {
      newJobs: newMatch   ? parseInt(newMatch[1])   : 0,
      total:   totalMatch ? parseInt(totalMatch[1]) : 0,
      timestamp: new Date().toISOString(),
    };
  });
});

// ── LinkedIn scraper ───────────────────────────────────────────────────

let linkedinRunning = false;
let lastLinkedinResult: { newJobs: number; timestamp: string; error?: string } | null = null;

app.get('/api/linkedin/status', (_req, res) => {
  const hasSession = existsSync(join(ROOT, 'config', 'linkedin-session.json'));
  res.json({ running: linkedinRunning, last: lastLinkedinResult, hasSession });
});

app.post('/api/linkedin', (_req, res) => {
  if (linkedinRunning) return res.status(409).json({ error: 'LinkedIn scan already running' });

  const hasSession = existsSync(join(ROOT, 'config', 'linkedin-session.json'));
  if (!hasSession) return res.status(400).json({ error: 'NO_SESSION', message: 'Run: npm run linkedin:auth first' });

  linkedinRunning = true;
  res.json({ started: true });

  runCommand(['tsx', 'src/commands/linkedin.ts'], stdout => {
    linkedinRunning = false;
    const newMatch = stdout.match(/(\d+) new LinkedIn jobs/);
    lastLinkedinResult = {
      newJobs: newMatch ? parseInt(newMatch[1]) : 0,
      timestamp: new Date().toISOString(),
      error: stdout.includes('session expired') || stdout.includes('SESSION_EXPIRED') ? 'Session expired — run npm run linkedin:auth' : undefined,
    };
  });
});

// ── API: Hunter / Gamification ────────────────────────────────────────

app.get('/api/hunter', async (_req, res) => {
  try {
    await ensureDailyQuests();
    const stats        = await getHunterStats();
    const quests       = await getDailyQuests();
    const achievements = await getAllUnlockedAchievements();
    const xpLog        = await getRecentXPLog(30);
    const rankInfo     = getRankInfo(stats.total_xp);
    const level        = getLevelFromXP(stats.total_xp);
    const unlocked     = await getUnlockedAchievementKeys();
    const allAch       = ACHIEVEMENTS.map(a => ({ ...a, unlocked: unlocked.has(a.key), check: undefined }));
    res.json({ stats, quests, achievements, xpLog, rankInfo, level, allAchievements: allAch });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/profile', (_req, res) => {
  try {
    const cvPath      = join(ROOT, 'cv.md');
    const profilePath = join(ROOT, 'config', 'profile.yml');
    const cv          = process.env.CV_MD
                        ?? (existsSync(cvPath)      ? readFileSync(cvPath, 'utf8')      : null);
    const profileRaw  = process.env.PROFILE_YML
                        ?? (existsSync(profilePath) ? readFileSync(profilePath, 'utf8') : null);
    const profile     = profileRaw ? yaml.load(profileRaw) : null;
    res.json({ cv, profile });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Reports ──────────────────────────────────────────────────────

app.get('/api/report/:path(*)', (req, res) => {
  try { res.type('text/plain').send(readFileSync(join(ROOT, 'reports', (req.params as Record<string, string>)['path(*)']), 'utf8')); }
  catch { res.status(404).json({ error: 'Not found.' }); }
});

// ── Fallback ──────────────────────────────────────────────────────────

app.get('*', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────

initDb()
  .then(() => app.listen(PORT, () => console.log(`\n  job-hunt dashboard  →  http://localhost:${PORT}\n`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
