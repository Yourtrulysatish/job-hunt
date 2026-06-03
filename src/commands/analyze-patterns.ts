#!/usr/bin/env tsx
/**
 * analyze-patterns.ts — Rejection pattern detector
 *
 * Reads all applications from SQLite, cross-references linked reports,
 * and outputs structured JSON with actionable patterns.
 *
 * Usage:
 *   tsx src/commands/analyze-patterns.ts              # JSON to stdout
 *   tsx src/commands/analyze-patterns.ts --summary    # human-readable table
 *   tsx src/commands/analyze-patterns.ts --min N      # minimum entries before analysis
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/client.js';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const REPORTS_DIR = join(ROOT, 'reports');

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const minArg = args.indexOf('--min');
const MIN_THRESHOLD = minArg !== -1 ? parseInt(args[minArg + 1] ?? '5') : 5;

// ── Status helpers ─────────────────────────────────────────────────────

function classifyOutcome(status: string): 'positive' | 'negative' | 'self_filtered' | 'pending' {
  const s = status.toLowerCase();
  if (['interview', 'offer', 'responded'].includes(s)) return 'positive';
  if (['rejected', 'discarded'].includes(s)) return 'negative';
  if (['skip', 'evaluated'].includes(s)) return 'self_filtered';
  if (s === 'applied') return 'positive';
  return 'pending';
}

// ── Report reader ──────────────────────────────────────────────────────

function readReportMeta(reportPath: string): { archetype?: string; gaps?: string[]; keywords?: string[] } {
  if (!reportPath || !existsSync(join(ROOT, reportPath))) return {};
  try {
    const text = readFileSync(join(ROOT, reportPath), 'utf8');
    const archetype = text.match(/\*\*Archetype:\*\*\s*(.+)/)?.[1]?.trim();
    const gaps = [...text.matchAll(/GAP[:\s]+(.+)/gi)].map(m => m[1].trim().slice(0, 60));
    const keywords = [...text.matchAll(/Keywords?[:\s]+(.+)/gi)].map(m => m[1].trim()).slice(0, 1).flatMap(l => l.split(/[,;]+/).map(k => k.trim()));
    return { archetype, gaps, keywords };
  } catch { return {}; }
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
  const db = getDb();

  // Load all applications
  const apps = db.prepare(`
    SELECT id, num, date, company, role, url, status, score, archetype, remote, location,
           salary_min, salary_max, source, notes, report_path
    FROM applications ORDER BY num ASC
  `).all() as {
    id: number; num: number; date: string; company: string; role: string; url: string;
    status: string; score: number | null; archetype: string | null; remote: string | null;
    location: string | null; salary_min: number | null; salary_max: number | null;
    source: string | null; notes: string | null; report_path: string | null;
  }[];

  const progressed = apps.filter(a => !['evaluated', 'skip'].includes(a.status.toLowerCase()));

  if (progressed.length < MIN_THRESHOLD) {
    const msg = `Not enough data yet — ${progressed.length}/${MIN_THRESHOLD} applications have progressed beyond evaluation. Keep applying and come back.`;
    if (summaryMode) { console.log(chalk.yellow(`\n  ${msg}\n`)); }
    else { console.log(JSON.stringify({ error: msg })); }
    process.exit(0);
  }

  // ── Funnel ─────────────────────────────────────────────────────────
  const statusCounts: Record<string, number> = {};
  for (const a of apps) {
    statusCounts[a.status.toLowerCase()] = (statusCounts[a.status.toLowerCase()] ?? 0) + 1;
  }

  // ── Outcomes ──────────────────────────────────────────────────────
  const outcomes = apps.map(a => ({ ...a, outcome: classifyOutcome(a.status) }));
  const positive       = outcomes.filter(a => a.outcome === 'positive');
  const negative       = outcomes.filter(a => a.outcome === 'negative');
  const selfFiltered   = outcomes.filter(a => a.outcome === 'self_filtered');
  const pending        = outcomes.filter(a => a.outcome === 'pending');

  // ── Score comparison ───────────────────────────────────────────────
  function scoreStats(list: typeof apps) {
    const scored = list.filter(a => a.score != null).map(a => a.score as number);
    if (!scored.length) return { avg: null, min: null, max: null, count: 0 };
    return {
      avg: Math.round((scored.reduce((s, v) => s + v, 0) / scored.length) * 100) / 100,
      min: Math.min(...scored),
      max: Math.max(...scored),
      count: scored.length,
    };
  }

  const scoreComparison = {
    positive: scoreStats(positive),
    negative: scoreStats(negative),
    self_filtered: scoreStats(selfFiltered),
    pending: scoreStats(pending),
  };

  // ── Archetype breakdown ────────────────────────────────────────────
  const archetypeMap: Record<string, { total: number; positive: number; negative: number; self_filtered: number }> = {};
  for (const a of outcomes) {
    const arch = a.archetype ?? 'Unknown';
    if (!archetypeMap[arch]) archetypeMap[arch] = { total: 0, positive: 0, negative: 0, self_filtered: 0 };
    archetypeMap[arch].total++;
    archetypeMap[arch][a.outcome === 'pending' ? 'positive' : a.outcome]++;
  }
  const archetypeBreakdown = Object.entries(archetypeMap).map(([arch, counts]) => ({
    archetype: arch, ...counts,
    conversionRate: counts.total > 0 ? Math.round((counts.positive / counts.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  // ── Remote policy analysis ─────────────────────────────────────────
  const remoteMap: Record<string, { total: number; positive: number; negative: number }> = {};
  for (const a of outcomes) {
    const key = a.remote ?? 'unknown';
    if (!remoteMap[key]) remoteMap[key] = { total: 0, positive: 0, negative: 0 };
    remoteMap[key].total++;
    if (a.outcome === 'positive') remoteMap[key].positive++;
    if (a.outcome === 'negative') remoteMap[key].negative++;
  }

  // ── Score threshold recommendation ────────────────────────────────
  const negScores = negative.filter(a => a.score != null).map(a => a.score as number);
  const posScores = positive.filter(a => a.score != null).map(a => a.score as number);
  const avgNeg = negScores.length ? negScores.reduce((s, v) => s + v, 0) / negScores.length : 0;
  const avgPos = posScores.length ? posScores.reduce((s, v) => s + v, 0) / posScores.length : 0;
  const recommendedMinScore = Math.max(3.5, avgNeg > 0 ? Math.round((avgNeg + 0.2) * 2) / 2 : 4.0);

  // ── Cross-reference reports for gap data ──────────────────────────
  const reportMeta: Record<number, ReturnType<typeof readReportMeta>> = {};
  for (const a of negative) {
    if (a.report_path) reportMeta[a.id] = readReportMeta(a.report_path);
  }
  const allGaps = Object.values(reportMeta).flatMap(m => m.gaps ?? []);
  const gapCounts: Record<string, number> = {};
  for (const g of allGaps) { gapCounts[g] = (gapCounts[g] ?? 0) + 1; }
  const topGaps = Object.entries(gapCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([gap, count]) => ({ gap, count }));

  // ── Recommendations ────────────────────────────────────────────────
  const recommendations: { action: string; reason: string; impact: 'high' | 'medium' | 'low' }[] = [];

  if (recommendedMinScore > 3.5) {
    recommendations.push({
      action: `Raise minimum score threshold to ${recommendedMinScore}`,
      reason: `Rejected applications averaged ${avgNeg.toFixed(1)}/5 vs positive outcomes at ${avgPos.toFixed(1)}/5`,
      impact: 'high',
    });
  }

  const worstArch = archetypeBreakdown.find(a => a.total >= 2 && a.conversionRate === 0);
  if (worstArch) {
    recommendations.push({
      action: `Reconsider applying to "${worstArch.archetype}" roles`,
      reason: `0% conversion rate across ${worstArch.total} applications`,
      impact: 'high',
    });
  }

  if (topGaps.length > 0) {
    recommendations.push({
      action: `Address top skill gap: "${topGaps[0].gap}"`,
      reason: `Appeared in ${topGaps[0].count} rejected applications`,
      impact: 'medium',
    });
  }

  const remoteUnknown = Object.entries(remoteMap).find(([k]) => k === 'unknown');
  if (remoteUnknown && remoteUnknown[1].total >= 3) {
    recommendations.push({
      action: 'Verify remote policy before applying',
      reason: `${remoteUnknown[1].total} applications had unclear remote status`,
      impact: 'medium',
    });
  }

  if (pending.length > 5) {
    recommendations.push({
      action: `Follow up on ${pending.length} pending applications`,
      reason: 'Pending applications older than 7 days need follow-up or status update',
      impact: 'low',
    });
  }

  // ── Output ─────────────────────────────────────────────────────────

  const report = {
    metadata: {
      total: apps.length,
      date_range: { from: apps[0]?.date ?? '-', to: apps[apps.length - 1]?.date ?? '-' },
      analysis_date: new Date().toISOString().split('T')[0],
    },
    funnel: statusCounts,
    outcomes: { positive: positive.length, negative: negative.length, self_filtered: selfFiltered.length, pending: pending.length },
    scoreComparison,
    archetypeBreakdown,
    remotePolicy: Object.entries(remoteMap).map(([policy, counts]) => ({ policy, ...counts })),
    scoreThreshold: { recommended: recommendedMinScore, reason: `avg positive ${avgPos.toFixed(1)} vs avg rejected ${avgNeg.toFixed(1)}` },
    topSkillGaps: topGaps,
    recommendations: recommendations.slice(0, 5),
  };

  if (summaryMode) {
    console.log(chalk.bold('\n  Pattern Analysis — ' + report.metadata.analysis_date));
    console.log(chalk.dim('  ' + '─'.repeat(50)));
    console.log(`  Applications: ${apps.length}  |  Positive: ${positive.length}  |  Negative: ${negative.length}  |  Pending: ${pending.length}`);
    console.log(`  Avg score (positive): ${avgPos.toFixed(1)}  |  Avg score (rejected): ${avgNeg.toFixed(1)}`);
    console.log(`  Recommended min score: ${chalk.yellow(recommendedMinScore)}`);

    if (archetypeBreakdown.length) {
      console.log(chalk.bold('\n  Archetype Breakdown'));
      for (const a of archetypeBreakdown) {
        console.log(`    ${a.archetype.padEnd(35)} ${a.total} apps  ${a.conversionRate}% conversion`);
      }
    }

    if (topGaps.length) {
      console.log(chalk.bold('\n  Top Skill Gaps (from rejected reports)'));
      for (const g of topGaps.slice(0, 5)) {
        console.log(`    ${g.gap.padEnd(50)} ×${g.count}`);
      }
    }

    console.log(chalk.bold('\n  Recommendations'));
    for (const r of report.recommendations) {
      const badge = r.impact === 'high' ? chalk.red('HIGH') : r.impact === 'medium' ? chalk.yellow('MED ') : chalk.dim('LOW ');
      console.log(`    [${badge}] ${r.action}`);
      console.log(chalk.dim(`           ${r.reason}`));
    }
    console.log('');

    // Save report to file
    const outPath = join(REPORTS_DIR, `pattern-analysis-${report.metadata.analysis_date}.md`);
    const md = [
      `# Pattern Analysis — ${report.metadata.analysis_date}`,
      '',
      `**Applications analyzed:** ${apps.length}`,
      `**Date range:** ${report.metadata.date_range.from} to ${report.metadata.date_range.to}`,
      `**Outcomes:** ${positive.length} positive, ${negative.length} negative, ${selfFiltered.length} self-filtered, ${pending.length} pending`,
      '',
      '## Funnel',
      ...Object.entries(statusCounts).map(([s, c]) => `- ${s}: ${c}`),
      '',
      '## Score Comparison',
      `- Positive: ${scoreComparison.positive.avg ?? '—'}/5 avg (${scoreComparison.positive.count} scored)`,
      `- Negative: ${scoreComparison.negative.avg ?? '—'}/5 avg (${scoreComparison.negative.count} scored)`,
      `- Recommended minimum: **${recommendedMinScore}/5**`,
      '',
      '## Archetype Breakdown',
      ...archetypeBreakdown.map(a => `- **${a.archetype}**: ${a.total} apps, ${a.conversionRate}% conversion`),
      '',
      '## Top Skill Gaps',
      ...topGaps.map(g => `- ${g.gap} (×${g.count})`),
      '',
      '## Recommendations',
      ...report.recommendations.map(r => `- **[${r.impact.toUpperCase()}]** ${r.action} — ${r.reason}`),
    ].join('\n');

    writeFileSync(outPath, md);
    console.log(chalk.dim(`  Report saved: ${outPath.replace(ROOT + '/', '')}`));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main();
