import { getAsyncDb } from '../db/client-async.js';
import type { HunterStats } from './gamification.js';

const QUEST_POOL = [
  { type: 'EVALUATE_JOB',     label: 'Evaluate 1 job from your inbox',        xp: 50 },
  { type: 'APPLY_JOB',        label: 'Apply to 1 job (score 3.5+)',            xp: 75 },
  { type: 'FOLLOW_UP',        label: 'Follow up on 1 pending application',     xp: 50 },
  { type: 'ADD_CONTACT',      label: 'Add 1 contact to your shadow army',      xp: 40 },
  { type: 'SCAN_JOBS',        label: 'Run the job scanner',                    xp: 30 },
  { type: 'GENERATE_PACKAGE', label: 'Generate a full application package',    xp: 60 },
  { type: 'SEND_OUTREACH',    label: 'Send 1 recruiter outreach message',      xp: 60 },
];

export async function getHunterStats(): Promise<HunterStats> {
  const result = await getAsyncDb().execute('SELECT * FROM hunter_stats WHERE id = 1');
  return result.rows[0] as unknown as HunterStats;
}

export async function getDailyQuests(date?: string) {
  const d = date ?? new Date().toISOString().split('T')[0];
  const result = await getAsyncDb().execute({
    sql: 'SELECT * FROM daily_quests WHERE date = ? ORDER BY id',
    args: [d],
  });
  return result.rows as unknown as {
    id: number; quest_type: string; label: string; target: number;
    progress: number; completed: number; xp_reward: number; completed_at: string | null;
  }[];
}

export async function ensureDailyQuests(): Promise<void> {
  const db = getAsyncDb();
  const today = new Date().toISOString().split('T')[0];
  const existing = await db.execute({
    sql: 'SELECT COUNT(*) as c FROM daily_quests WHERE date = ?',
    args: [today],
  });
  if (Number(existing.rows[0].c) >= 3) return;

  const shuffled = [...QUEST_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const q of shuffled) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO daily_quests (date, quest_type, label, xp_reward) VALUES (?,?,?,?)',
      args: [today, q.type, q.label, q.xp],
    });
  }
}

export async function getUnlockedAchievementKeys(): Promise<Set<string>> {
  const result = await getAsyncDb().execute('SELECT key FROM achievements_unlocked');
  return new Set(result.rows.map(r => r.key as string));
}

export async function getAllUnlockedAchievements() {
  const result = await getAsyncDb().execute(
    'SELECT * FROM achievements_unlocked ORDER BY unlocked_at DESC'
  );
  return result.rows as unknown as {
    id: number; key: string; name: string; description: string;
    icon: string; xp_bonus: number; unlocked_at: string;
  }[];
}

export async function getRecentXPLog(limit = 20) {
  const result = await getAsyncDb().execute({
    sql: 'SELECT * FROM xp_log ORDER BY earned_at DESC LIMIT ?',
    args: [limit],
  });
  return result.rows as unknown as {
    id: number; action: string; xp: number; description: string; earned_at: string;
  }[];
}
