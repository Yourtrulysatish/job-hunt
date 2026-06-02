#!/usr/bin/env tsx
/**
 * server.ts — Web dashboard for job-hunt
 */

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import {
  getApplications, getStats, getOverdueFollowups, getTopSkillGaps,
  getPipelineJobs, getAllContacts, getAllFollowups, getRecentGmailThreads,
  insertContact, completeFollowup, markPipelineJobReviewed,
} from '../db/queries.js';
import { scoreJob } from '../utils/scorer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PORT = Number(process.env.DASHBOARD_PORT ?? 3333);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

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

// ── API: Stats ────────────────────────────────────────────────────────

app.get('/api/stats', (_req, res) => {
  try { res.json(getStats()); }
  catch { res.status(500).json({ error: 'DB not initialized.' }); }
});

// ── API: Applications ─────────────────────────────────────────────────

app.get('/api/applications', (req, res) => {
  try {
    const { status, minScore, company, limit } = req.query;
    res.json(getApplications({ status: status as string, minScore: minScore ? Number(minScore) : undefined, company: company as string, limit: limit ? Number(limit) : undefined }));
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Pipeline (opportunity database) ─────────────────────────────

app.get('/api/pipeline', (_req, res) => {
  try {
    // Try DB first, fall back to markdown
    const dbJobs = getPipelineJobs({ limit: 200 });
    if (dbJobs.length > 0) return res.json(dbJobs.map(j => ({ ...j, checked: j.status !== 'new', fit_reasons: [], remote: j.remote === 1 })));
    res.json(parsePipelineMd());
  } catch { res.json(parsePipelineMd()); }
});

app.patch('/api/pipeline/:url/status', (req, res) => {
  try {
    const { status } = req.body as { status: 'reviewed' | 'applied' | 'skipped' };
    markPipelineJobReviewed(decodeURIComponent(req.params.url), status);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Recommendations ──────────────────────────────────────────────

app.get('/api/recommendations', (_req, res) => {
  const jobs = parsePipelineMd().filter(j => !j.checked);
  res.json(jobs.filter(j => j.fit_score >= 3.5 && !j.skip_reason).sort((a, b) => b.fit_score - a.fit_score).slice(0, 10));
});

// ── API: Follow-ups ────────────────────────────────────────────────────

app.get('/api/followups', (_req, res) => {
  try { res.json(getAllFollowups()); }
  catch { res.status(500).json({ error: 'Failed.' }); }
});

app.post('/api/followups/:id/complete', (req, res) => {
  try { completeFollowup(Number(req.params.id)); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Contacts ──────────────────────────────────────────────────────

app.get('/api/contacts', (_req, res) => {
  try { res.json(getAllContacts()); }
  catch { res.status(500).json({ error: 'Failed.' }); }
});

app.post('/api/contacts', (req, res) => {
  try {
    const body = req.body as { company: string; name: string; title?: string; linkedin_url?: string; email?: string; notes?: string };
    const id = insertContact({ company: body.company, name: body.name, title: body.title ?? null, linkedin_url: body.linkedin_url ?? null, email: body.email ?? null, connection: 'none', referral: 0, outreach_sent: 0, outreach_date: null, response: null, notes: body.notes ?? null, application_id: null });
    res.json({ id });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Skills gap ────────────────────────────────────────────────────

app.get('/api/skills-gap', (_req, res) => {
  try { res.json(getTopSkillGaps(15)); }
  catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Gmail ────────────────────────────────────────────────────────

app.get('/api/gmail', (_req, res) => {
  try { res.json(getRecentGmailThreads(30)); }
  catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Profile ──────────────────────────────────────────────────────

app.get('/api/profile', (_req, res) => {
  try {
    const cvPath      = join(ROOT, 'cv.md');
    const profilePath = join(ROOT, 'config', 'profile.yml');
    const cv          = existsSync(cvPath)      ? readFileSync(cvPath, 'utf8')      : null;
    const profileRaw  = existsSync(profilePath) ? readFileSync(profilePath, 'utf8') : null;
    const profile     = profileRaw ? yaml.load(profileRaw) : null;
    res.json({ cv, profile });
  } catch { res.status(500).json({ error: 'Failed.' }); }
});

// ── API: Reports ──────────────────────────────────────────────────────

app.get('/api/report/:path(*)', (req, res) => {
  try { res.type('text/plain').send(readFileSync(join(ROOT, 'reports', req.params.path), 'utf8')); }
  catch { res.status(404).json({ error: 'Not found.' }); }
});

// ── Fallback ──────────────────────────────────────────────────────────

app.get('*', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`\n  job-hunt dashboard  →  http://localhost:${PORT}\n`));
