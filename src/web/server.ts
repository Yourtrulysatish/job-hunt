#!/usr/bin/env tsx
/**
 * server.ts — Web dashboard for job-hunt
 */

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { getApplications, getStats, getOverdueFollowups, getTopSkillGaps } from '../db/queries.js';
import { scoreJob } from '../utils/scorer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PORT = Number(process.env.DASHBOARD_PORT ?? 3333);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────

function parsePipeline() {
  const pipelinePath = join(ROOT, 'data', 'pipeline.md');
  if (!existsSync(pipelinePath)) return [];

  const text = readFileSync(pipelinePath, 'utf8');
  const jobs: {
    company: string; role: string; url: string; portal: string;
    location: string; checked: boolean;
    fit_score: number; fit_label: string; fit_reasons: string[]; skip_reason?: string;
  }[] = [];

  let current: Partial<typeof jobs[0]> | null = null;
  let currentSection = '';

  for (const line of text.split('\n')) {
    const sectionMatch = line.match(/^###\s+Source:\s*(.+)$/i);
    if (sectionMatch) { currentSection = sectionMatch[1].trim(); continue; }

    const jobMatch = line.match(/^- \[([ x])\] \*\*(.+?)\*\* — (.+?)(?:\s·\s(.+))?$/);
    if (jobMatch) {
      current = {
        checked: jobMatch[1] === 'x',
        company: jobMatch[2],
        role: jobMatch[3].trim(),
        location: jobMatch[4]?.trim() ?? '',
        url: '',
        portal: currentSection,
        fit_score: 0, fit_label: 'Weak Match', fit_reasons: [],
      };
      jobs.push(current as typeof jobs[0]);
    } else if (current) {
      const urlMatch    = line.match(/^\s+URL:\s*(.+)$/);
      const portalMatch = line.match(/^\s+Portal:\s*(.+)$/);
      if (urlMatch)    current.url    = urlMatch[1].trim();
      if (portalMatch && !current.portal) current.portal = portalMatch[1].trim();
    }
  }

  // Score every job
  for (const job of jobs) {
    const scored = scoreJob({
      role: job.role, company: job.company,
      location: job.location, portal: job.portal,
    });
    job.fit_score   = scored.score;
    job.fit_label   = scored.label;
    job.fit_reasons = scored.reasons;
    if (scored.skipReason) job.skip_reason = scored.skipReason;
  }

  return jobs;
}

// ── API routes ────────────────────────────────────────────────────────

app.get('/api/stats', (_req, res) => {
  try { res.json(getStats()); }
  catch { res.status(500).json({ error: 'Database not initialized.' }); }
});

app.get('/api/applications', (req, res) => {
  try {
    const { status, minScore, company, limit } = req.query;
    res.json(getApplications({
      status: status as string | undefined,
      minScore: minScore ? Number(minScore) : undefined,
      company: company as string | undefined,
      limit: limit ? Number(limit) : undefined,
    }));
  } catch { res.status(500).json({ error: 'Failed to fetch applications.' }); }
});

app.get('/api/followups', (_req, res) => {
  try { res.json(getOverdueFollowups()); }
  catch { res.status(500).json({ error: 'Failed to fetch follow-ups.' }); }
});

app.get('/api/skills-gap', (_req, res) => {
  try { res.json(getTopSkillGaps(15)); }
  catch { res.status(500).json({ error: 'Failed to fetch skills gap data.' }); }
});

app.get('/api/pipeline', (_req, res) => {
  res.json(parsePipeline());
});

app.get('/api/recommendations', (_req, res) => {
  const jobs = parsePipeline().filter(j => !j.checked);
  // Top picks: score >= 3.5, sorted by score desc, max 10
  const picks = jobs
    .filter(j => j.fit_score >= 3.5 && !j.skip_reason)
    .sort((a, b) => b.fit_score - a.fit_score)
    .slice(0, 10);
  res.json(picks);
});

app.get('/api/report/:path(*)', (req, res) => {
  try {
    const content = readFileSync(join(ROOT, 'reports', req.params.path), 'utf8');
    res.type('text/plain').send(content);
  } catch { res.status(404).json({ error: 'Report not found.' }); }
});

app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  job-hunt dashboard  →  http://localhost:${PORT}\n`);
});
