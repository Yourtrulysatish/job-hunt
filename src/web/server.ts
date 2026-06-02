#!/usr/bin/env tsx
/**
 * server.ts — Web dashboard for job-hunt
 *
 * Serves a read-only dashboard with pipeline stats, application list,
 * skills gap analysis, and follow-up tracking. No build step required.
 */

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { getApplications, getStats, getOverdueFollowups, getTopSkillGaps } from '../db/queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PORT = Number(process.env.DASHBOARD_PORT ?? 3333);

const app = express();
app.use(express.json());

// Serve static files from public/
app.use(express.static(join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────────────────

app.get('/api/stats', (_req, res) => {
  try {
    res.json(getStats());
  } catch (e) {
    res.status(500).json({ error: 'Database not initialized. Run npm run migrate first.' });
  }
});

app.get('/api/applications', (req, res) => {
  try {
    const { status, minScore, company, limit } = req.query;
    const apps = getApplications({
      status: status as string | undefined,
      minScore: minScore ? Number(minScore) : undefined,
      company: company as string | undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(apps);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch applications.' });
  }
});

app.get('/api/followups', (_req, res) => {
  try {
    res.json(getOverdueFollowups());
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch follow-ups.' });
  }
});

app.get('/api/skills-gap', (_req, res) => {
  try {
    res.json(getTopSkillGaps(15));
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch skills gap data.' });
  }
});

app.get('/api/report/:path(*)', (req, res) => {
  try {
    const reportPath = join(ROOT, 'reports', req.params.path);
    const content = readFileSync(reportPath, 'utf8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: 'Report not found.' });
  }
});

// Fallback to index.html for SPA
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  job-hunt dashboard  →  http://localhost:${PORT}\n`);
});
