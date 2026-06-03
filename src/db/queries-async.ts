import { getAsyncDb } from './client-async.js';
import type { Application, Contact, Followup } from './client.js';

export async function getApplications(filters?: {
  status?: string; minScore?: number; company?: string; limit?: number;
}): Promise<Application[]> {
  const db = getAsyncDb();
  let query = 'SELECT * FROM applications WHERE 1=1';
  const args: (string | number)[] = [];

  if (filters?.status)                 { query += ' AND status = ?';     args.push(filters.status); }
  if (filters?.minScore !== undefined) { query += ' AND score >= ?';     args.push(filters.minScore); }
  if (filters?.company)                { query += ' AND company LIKE ?'; args.push(`%${filters.company}%`); }
  query += ' ORDER BY num DESC';
  if (filters?.limit)                  { query += ' LIMIT ?';            args.push(filters.limit); }

  const result = await db.execute({ sql: query, args });
  return result.rows as unknown as Application[];
}

export async function getStats() {
  const db = getAsyncDb();
  const [totRes, statusRes, avgRes, topRes] = await Promise.all([
    db.execute('SELECT COUNT(*) as c FROM applications'),
    db.execute('SELECT status, COUNT(*) as count FROM applications GROUP BY status ORDER BY count DESC'),
    db.execute('SELECT AVG(score) as avg FROM applications WHERE score IS NOT NULL'),
    db.execute('SELECT company, score FROM applications WHERE score >= 4.0 ORDER BY score DESC LIMIT 10'),
  ]);

  return {
    total:        Number(totRes.rows[0]?.c ?? 0),
    byStatus:     statusRes.rows.map(r => ({ status: r.status as string, count: Number(r.count) })),
    avgScore:     avgRes.rows[0]?.avg != null ? Number(avgRes.rows[0].avg) : null,
    topCompanies: topRes.rows.map(r => ({ company: r.company as string, score: Number(r.score) })),
  };
}

export async function getOverdueFollowups(): Promise<(Followup & { company: string; role: string })[]> {
  const result = await getAsyncDb().execute(`
    SELECT f.*, a.company, a.role
    FROM followups f JOIN applications a ON f.application_id = a.id
    WHERE f.status = 'pending' AND f.due_date <= date('now')
    ORDER BY f.due_date ASC
  `);
  return result.rows as unknown as (Followup & { company: string; role: string })[];
}

export async function getTopSkillGaps(limit = 10) {
  const result = await getAsyncDb().execute({
    sql: `SELECT skill, times_seen,
                 ROUND(CAST(times_matched AS REAL) / times_seen, 2) as match_rate
          FROM skills_gap WHERE times_seen >= 2
          ORDER BY times_seen DESC, match_rate ASC LIMIT ?`,
    args: [limit],
  });
  return result.rows as unknown as { skill: string; times_seen: number; match_rate: number }[];
}

export async function getPipelineJobs(filters?: {
  status?: string; minFit?: number; company?: string; limit?: number;
}) {
  const db = getAsyncDb();
  let q = 'SELECT * FROM pipeline_jobs WHERE 1=1';
  const p: (string | number)[] = [];
  if (filters?.status)  { q += ' AND status = ?';      p.push(filters.status); }
  if (filters?.minFit)  { q += ' AND fit_score >= ?';  p.push(filters.minFit); }
  if (filters?.company) { q += ' AND company LIKE ?';  p.push(`%${filters.company}%`); }
  q += ' ORDER BY fit_score DESC, scanned_at DESC';
  if (filters?.limit)   { q += ' LIMIT ?';             p.push(filters.limit); }

  const result = await db.execute({ sql: q, args: p });
  return result.rows as unknown as {
    id: number; company: string; role: string; url: string; portal: string;
    location: string; remote: number; salary: string; fit_score: number;
    fit_label: string; status: string; scanned_at: string; notes: string;
  }[];
}

export async function markPipelineJobReviewed(url: string, status: 'reviewed' | 'applied' | 'skipped') {
  await getAsyncDb().execute({
    sql: `UPDATE pipeline_jobs SET status = ?, reviewed_at = datetime('now') WHERE url = ?`,
    args: [status, url],
  });
}

export async function getAllContacts() {
  const result = await getAsyncDb().execute(`
    SELECT c.*, a.company as app_company, a.role as app_role
    FROM contacts c
    LEFT JOIN applications a ON c.application_id = a.id
    ORDER BY c.created_at DESC
  `);
  return result.rows as unknown as (Contact & { app_company?: string; app_role?: string })[];
}

export async function insertContact(contact: Omit<Contact, 'id' | 'created_at'>): Promise<number> {
  const result = await getAsyncDb().execute({
    sql: `INSERT INTO contacts (company, name, title, linkedin_url, email, connection, referral,
            outreach_sent, outreach_date, response, notes, application_id)
          VALUES (@company, @name, @title, @linkedin_url, @email, @connection, @referral,
            @outreach_sent, @outreach_date, @response, @notes, @application_id)`,
    args: contact as Record<string, unknown>,
  });
  return Number(result.lastInsertRowid);
}

export async function getAllFollowups() {
  const result = await getAsyncDb().execute(`
    SELECT f.*, a.company, a.role, a.status as app_status
    FROM followups f JOIN applications a ON f.application_id = a.id
    WHERE f.status = 'pending'
    ORDER BY f.due_date ASC
  `);
  return result.rows as unknown as (Followup & { company: string; role: string; app_status: string })[];
}

export async function completeFollowup(followupId: number) {
  await getAsyncDb().execute({
    sql: `UPDATE followups SET status = 'completed', completed_at = datetime('now') WHERE id = ?`,
    args: [followupId],
  });
}

export async function getRecentGmailThreads(limit = 20) {
  const result = await getAsyncDb().execute({
    sql: `SELECT g.*, a.company, a.role
          FROM gmail_threads g
          LEFT JOIN applications a ON g.application_id = a.id
          ORDER BY g.date DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows as unknown as {
    id: number; thread_id: string; subject: string; from_email: string;
    from_name: string; snippet: string; date: string; label: string;
    company?: string; role?: string;
  }[];
}
