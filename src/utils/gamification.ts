/**
 * gamification.ts — XP system, ranks, quests, achievements
 *
 * Call awardXP(action) from any command to log XP, update stats,
 * check quest progress, and unlock achievements automatically.
 */

import { getDb } from '../db/client.js';

// ── XP values for every action ────────────────────────────────────────

export const XP = {
  SCAN_JOBS:          10,
  EVALUATE_JOB:       20,
  GENERATE_PACKAGE:   15,
  APPLY_JOB:          30,
  SEND_OUTREACH:      25,
  ADD_CONTACT:        15,
  FOLLOW_UP:          20,
  GOT_REPLY:          50,
  GOT_INTERVIEW:     100,
  COMPLETED_INTERVIEW: 75,
  GOT_OFFER:         500,
  COMPLETE_QUEST:     50,
  STREAK_7:          100,
  STREAK_30:         500,
} as const;

export type XPAction = keyof typeof XP;

// ── Rank thresholds ───────────────────────────────────────────────────

export const RANKS = [
  { rank: 'E', label: 'E-Rank', min: 0,      max: 500,   color: '#8b949e', description: 'Just entered the system' },
  { rank: 'D', label: 'D-Rank', min: 500,    max: 2000,  color: '#3fb950', description: 'Building momentum'       },
  { rank: 'C', label: 'C-Rank', min: 2000,   max: 6000,  color: '#58a6ff', description: 'Getting noticed'         },
  { rank: 'B', label: 'B-Rank', min: 6000,   max: 15000, color: '#bc8cff', description: 'In serious contention'   },
  { rank: 'A', label: 'A-Rank', min: 15000,  max: 30000, color: '#ffa657', description: 'Recruiters come to you'  },
  { rank: 'S', label: 'S-Rank', min: 30000,  max: Infinity, color: '#d29922', description: 'Unstoppable'          },
] as const;

export function getRankInfo(totalXp: number) {
  const r = RANKS.find(r => totalXp >= r.min && totalXp < r.max) ?? RANKS[RANKS.length - 1];
  const next = RANKS[RANKS.indexOf(r as typeof RANKS[number]) + 1];
  const progressInRank = totalXp - r.min;
  const rankSize = (next?.min ?? totalXp + 1) - r.min;
  const pct = Math.min(100, Math.round((progressInRank / rankSize) * 100));
  return { ...r, xpIntoRank: progressInRank, xpToNext: next ? next.min - totalXp : 0, pct, nextRank: next?.rank ?? null };
}

export function getLevelFromXP(totalXp: number): number {
  // Level 1–100, roughly sqrt scaling
  return Math.min(100, Math.max(1, Math.floor(Math.sqrt(totalXp / 3)) + 1));
}

// ── Dungeon grade from fit score ──────────────────────────────────────

export function dungeonGrade(fitScore: number): { grade: string; color: string; label: string } {
  if (fitScore >= 4.7) return { grade: 'S', color: '#d29922', label: '⬛ S-RANK DUNGEON' };
  if (fitScore >= 4.3) return { grade: 'A', color: '#ffa657', label: '🟥 A-RANK DUNGEON' };
  if (fitScore >= 3.8) return { grade: 'B', color: '#bc8cff', label: '🟧 B-RANK DUNGEON' };
  if (fitScore >= 3.0) return { grade: 'C', color: '#58a6ff', label: '🟨 C-RANK DUNGEON' };
  if (fitScore >= 2.0) return { grade: 'D', color: '#3fb950', label: '🟩 D-RANK DUNGEON' };
  return { grade: 'E', color: '#8b949e', label: '🟦 E-RANK DUNGEON' };
}

// ── All achievements ──────────────────────────────────────────────────

export const ACHIEVEMENTS: {
  key: string; name: string; description: string; icon: string; xp: number;
  check: (stats: HunterStats) => boolean;
}[] = [
  { key: 'first_blood',    name: 'First Blood',         icon: '⚔️',  xp: 50,  description: 'Submitted your first application',          check: s => s.applications_sent >= 1   },
  { key: 'shadow_scout',   name: 'Shadow Scout',         icon: '🕵️', xp: 30,  description: 'Added your first contact to the CRM',       check: s => s.contacts_added >= 1       },
  { key: 'the_analyst',    name: 'The Analyst',          icon: '🧠',  xp: 40,  description: 'Evaluated 10 job opportunities',             check: s => s.jobs_evaluated >= 10      },
  { key: 'speed_runner',   name: 'Speed Runner',         icon: '🏃',  xp: 60,  description: 'Applied within 24h of a posting going live', check: _s => false /* checked elsewhere */ },
  { key: 'sharpshooter',   name: 'Sharpshooter',         icon: '🎯',  xp: 75,  description: 'Applied to 5 jobs all scored 4.0+',          check: _s => false /* checked elsewhere */ },
  { key: 'the_followup',   name: 'The Follow-Up',        icon: '🔄',  xp: 50,  description: 'Sent 5 follow-ups — persistence pays',       check: s => s.followups_sent >= 5       },
  { key: 'dungeon_reply',  name: 'Dungeon Response',     icon: '📞',  xp: 100, description: 'Got your first recruiter reply',             check: _s => false /* triggered externally */ },
  { key: 'interview_day',  name: 'Interview Day',        icon: '🗓️', xp: 150, description: 'Scheduled your first interview',             check: s => s.interviews >= 1           },
  { key: 'shadow_army',    name: 'Shadow Army',          icon: '👥',  xp: 100, description: 'Built a network of 10+ contacts',            check: s => s.contacts_added >= 10      },
  { key: 'on_fire',        name: 'On Fire',              icon: '🔥',  xp: 100, description: '7 days active in a row',                     check: s => s.streak >= 7               },
  { key: 'the_grind',      name: 'The Grind',            icon: '💎',  xp: 500, description: '30 days active in a row — legendary',        check: s => s.streak >= 30              },
  { key: 'analyst_pro',    name: 'Master Analyst',       icon: '🔬',  xp: 100, description: 'Evaluated 25 job opportunities',             check: s => s.jobs_evaluated >= 25      },
  { key: 'double_dungeon', name: 'Double Dungeon',        icon: '⚡',  xp: 60,  description: 'Applied to 2 jobs in one day',               check: _s => false /* checked elsewhere */ },
  { key: 'night_raid',     name: 'Night Raid',           icon: '🌙',  xp: 40,  description: 'Applied after midnight',                     check: _s => false /* checked elsewhere */ },
  { key: 'the_negotiator', name: 'The Negotiator',       icon: '🎭',  xp: 150, description: 'Entered offer negotiation',                  check: _s => false /* triggered externally */ },
  { key: 's_rank',         name: 'S-Rank Achieved',      icon: '👑',  xp: 500, description: 'Received and accepted a job offer',          check: s => s.offers >= 1               },
];

// ── Types ─────────────────────────────────────────────────────────────

export interface HunterStats {
  total_xp: number;
  level: number;
  rank: string;
  streak: number;
  longest_streak: number;
  last_active: string | null;
  applications_sent: number;
  interviews: number;
  offers: number;
  contacts_added: number;
  jobs_evaluated: number;
  followups_sent: number;
}

export interface AwardResult {
  xp: number;
  action: string;
  newLevel?: number;
  newRank?: string;
  unlockedAchievements: { name: string; icon: string; xp: number }[];
  questsCompleted: { label: string; xp: number }[];
}

// ── Core award function ────────────────────────────────────────────────

export function awardXP(action: XPAction, description?: string): AwardResult {
  const db = getDb();
  const xp = XP[action];
  const result: AwardResult = { xp, action, unlockedAchievements: [], questsCompleted: [] };

  // Log XP
  db.prepare('INSERT INTO xp_log (action, xp, description) VALUES (?, ?, ?)').run(action, xp, description ?? action);

  // Update total XP
  db.prepare('UPDATE hunter_stats SET total_xp = total_xp + ? WHERE id = 1').run(xp);

  // Update streak
  updateStreak();

  // Update relevant stat counter
  const statMap: Partial<Record<XPAction, string>> = {
    APPLY_JOB:          'applications_sent',
    GOT_INTERVIEW:      'interviews',
    GOT_OFFER:          'offers',
    ADD_CONTACT:        'contacts_added',
    EVALUATE_JOB:       'jobs_evaluated',
    FOLLOW_UP:          'followups_sent',
  };
  const statCol = statMap[action];
  if (statCol) db.prepare(`UPDATE hunter_stats SET ${statCol} = ${statCol} + 1 WHERE id = 1`).run();

  // Re-read stats
  const stats = getHunterStats();

  // Check level/rank progression
  const oldLevel = stats.level;
  const oldRank  = stats.rank;
  const newLevel = getLevelFromXP(stats.total_xp);
  const newRank  = getRankInfo(stats.total_xp).rank;

  if (newLevel !== oldLevel || newRank !== oldRank) {
    db.prepare('UPDATE hunter_stats SET level = ?, rank = ? WHERE id = 1').run(newLevel, newRank);
    if (newLevel !== oldLevel) result.newLevel = newLevel;
    if (newRank !== oldRank)   result.newRank = newRank;
  }

  // Check achievements
  const unlocked = getUnlockedAchievementKeys();
  for (const ach of ACHIEVEMENTS) {
    if (unlocked.has(ach.key)) continue;
    if (ach.check(stats)) {
      db.prepare('INSERT OR IGNORE INTO achievements_unlocked (key, name, description, icon, xp_bonus) VALUES (?,?,?,?,?)').run(ach.key, ach.name, ach.description, ach.icon, ach.xp);
      // Award achievement bonus XP
      db.prepare('INSERT INTO xp_log (action, xp, description) VALUES (?, ?, ?)').run('ACHIEVEMENT', ach.xp, `Achievement: ${ach.name}`);
      db.prepare('UPDATE hunter_stats SET total_xp = total_xp + ? WHERE id = 1').run(ach.xp);
      result.unlockedAchievements.push({ name: ach.name, icon: ach.icon, xp: ach.xp });
    }
  }

  // Check quest progress
  result.questsCompleted = advanceQuests(action);

  return result;
}

// ── Streak management ─────────────────────────────────────────────────

function updateStreak() {
  const db = getDb();
  const stats = db.prepare('SELECT last_active, streak, longest_streak FROM hunter_stats WHERE id = 1').get() as
    { last_active: string | null; streak: number; longest_streak: number };

  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if (stats.last_active === today) return; // already active today

  let newStreak = stats.last_active === yesterday ? stats.streak + 1 : 1;
  const newLongest = Math.max(stats.longest_streak, newStreak);
  db.prepare('UPDATE hunter_stats SET streak = ?, longest_streak = ?, last_active = ? WHERE id = 1').run(newStreak, newLongest, today);

  // Streak bonus XP
  if (newStreak === 7)  { db.prepare('INSERT INTO xp_log (action, xp, description) VALUES (?,?,?)').run('STREAK_7', XP.STREAK_7, '7-day streak bonus'); db.prepare('UPDATE hunter_stats SET total_xp = total_xp + ? WHERE id = 1').run(XP.STREAK_7); }
  if (newStreak === 30) { db.prepare('INSERT INTO xp_log (action, xp, description) VALUES (?,?,?)').run('STREAK_30', XP.STREAK_30, '30-day streak bonus'); db.prepare('UPDATE hunter_stats SET total_xp = total_xp + ? WHERE id = 1').run(XP.STREAK_30); }
}

// ── Daily quests ──────────────────────────────────────────────────────

const QUEST_POOL = [
  { type: 'EVALUATE_JOB',    label: 'Evaluate 1 job from your inbox',         xp: 50  },
  { type: 'APPLY_JOB',       label: 'Apply to 1 job (score 3.5+)',             xp: 75  },
  { type: 'FOLLOW_UP',       label: 'Follow up on 1 pending application',      xp: 50  },
  { type: 'ADD_CONTACT',     label: 'Add 1 contact to your shadow army',       xp: 40  },
  { type: 'SCAN_JOBS',       label: 'Run the job scanner',                     xp: 30  },
  { type: 'GENERATE_PACKAGE',label: 'Generate a full application package',     xp: 60  },
  { type: 'SEND_OUTREACH',   label: 'Send 1 recruiter outreach message',       xp: 60  },
];

export function ensureDailyQuests(): void {
  const db   = getDb();
  const today = new Date().toISOString().split('T')[0];
  const existing = db.prepare('SELECT COUNT(*) as c FROM daily_quests WHERE date = ?').get(today) as { c: number };
  if (existing.c >= 3) return;

  // Pick 3 random non-duplicate quests
  const shuffled = [...QUEST_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const q of shuffled) {
    db.prepare('INSERT OR IGNORE INTO daily_quests (date, quest_type, label, xp_reward) VALUES (?,?,?,?)').run(today, q.type, q.label, q.xp);
  }
}

function advanceQuests(action: XPAction): { label: string; xp: number }[] {
  const db    = getDb();
  const today = new Date().toISOString().split('T')[0];
  const completed: { label: string; xp: number }[] = [];

  const quests = db.prepare('SELECT * FROM daily_quests WHERE date = ? AND completed = 0 AND quest_type = ?').all(today, action) as
    { id: number; label: string; target: number; progress: number; xp_reward: number }[];

  for (const q of quests) {
    const newProgress = q.progress + 1;
    if (newProgress >= q.target) {
      db.prepare('UPDATE daily_quests SET progress = ?, completed = 1, completed_at = datetime("now") WHERE id = ?').run(newProgress, q.id);
      // Award quest XP
      db.prepare('INSERT INTO xp_log (action, xp, description) VALUES (?,?,?)').run('COMPLETE_QUEST', q.xp_reward, `Quest: ${q.label}`);
      db.prepare('UPDATE hunter_stats SET total_xp = total_xp + ? WHERE id = 1').run(q.xp_reward);
      completed.push({ label: q.label, xp: q.xp_reward });
    } else {
      db.prepare('UPDATE daily_quests SET progress = ? WHERE id = ?').run(newProgress, q.id);
    }
  }

  return completed;
}

// ── Readers ────────────────────────────────────────────────────────────

export function getHunterStats(): HunterStats {
  return getDb().prepare('SELECT * FROM hunter_stats WHERE id = 1').get() as HunterStats;
}

export function getDailyQuests(date?: string) {
  const d = date ?? new Date().toISOString().split('T')[0];
  return getDb().prepare('SELECT * FROM daily_quests WHERE date = ? ORDER BY id').all(d) as {
    id: number; quest_type: string; label: string; target: number;
    progress: number; completed: number; xp_reward: number; completed_at: string | null;
  }[];
}

export function getUnlockedAchievementKeys(): Set<string> {
  const rows = getDb().prepare('SELECT key FROM achievements_unlocked').all() as { key: string }[];
  return new Set(rows.map(r => r.key));
}

export function getAllUnlockedAchievements() {
  return getDb().prepare('SELECT * FROM achievements_unlocked ORDER BY unlocked_at DESC').all() as {
    id: number; key: string; name: string; description: string; icon: string; xp_bonus: number; unlocked_at: string;
  }[];
}

export function getRecentXPLog(limit = 20) {
  return getDb().prepare('SELECT * FROM xp_log ORDER BY earned_at DESC LIMIT ?').all(limit) as {
    id: number; action: string; xp: number; description: string; earned_at: string;
  }[];
}

// ── Print award result (for CLI commands) ─────────────────────────────

export function printAward(result: AwardResult, chalk: { green: (s: string) => string; yellow: (s: string) => string; bold: { white: (s: string) => string }; dim: (s: string) => string }): void {
  console.log(chalk.dim(`  [+${result.xp} XP] ${result.action}`));

  if (result.newRank) {
    console.log(chalk.green(`\n  ╔══════════════════════════════╗`));
    console.log(chalk.green(`  ║  RANK UP!  ${result.newRank}-Rank achieved  ║`));
    console.log(chalk.green(`  ╚══════════════════════════════╝\n`));
  } else if (result.newLevel) {
    console.log(chalk.yellow(`  ↑ Level ${result.newLevel} reached!`));
  }

  for (const ach of result.unlockedAchievements) {
    console.log(chalk.yellow(`\n  ${ach.icon} ACHIEVEMENT UNLOCKED: ${ach.name}  (+${ach.xp} XP)`));
  }

  for (const q of result.questsCompleted) {
    console.log(chalk.green(`  ✓ QUEST COMPLETE: "${q.label}"  (+${q.xp} XP)`));
  }
}
