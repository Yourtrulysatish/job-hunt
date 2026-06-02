import { getDb, type Application, type Contact, type Followup } from './client.js';

// ── Applications ─────────────────────────────────────────────────────

export function getNextNum(): number {
  const db = getDb();
  const row = db.prepare('SELECT MAX(num) as max FROM applications').get() as { max: number | null };
  return (row.max ?? 0) + 1;
}

export function insertApplication(app: Omit<Application, 'id' | 'created_at' | 'updated_at'>): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO applications (num, date, company, role, url, status, score, pdf, report_path,
      archetype, remote, location, salary_min, salary_max, currency, legitimacy, notes, source)
    VALUES (@num, @date, @company, @role, @url, @status, @score, @pdf, @report_path,
      @archetype, @remote, @location, @salary_min, @salary_max, @currency, @legitimacy, @notes, @source)
  `);
  const result = stmt.run(app);
  return result.lastInsertRowid as number;
}

export function updateApplicationStatus(id: number, status: string, notes?: string): void {
  const db = getDb();
  if (notes) {
    db.prepare('UPDATE applications SET status = ?, notes = ? WHERE id = ?').run(status, notes, id);
  } else {
    db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, id);
  }
}

export function getApplications(filters?: {
  status?: string;
  minScore?: number;
  company?: string;
  limit?: number;
}): Application[] {
  const db = getDb();
  let query = 'SELECT * FROM applications WHERE 1=1';
  const params: (string | number)[] = [];

  if (filters?.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters?.minScore !== undefined) {
    query += ' AND score >= ?';
    params.push(filters.minScore);
  }
  if (filters?.company) {
    query += ' AND company LIKE ?';
    params.push(`%${filters.company}%`);
  }
  query += ' ORDER BY num DESC';
  if (filters?.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  return db.prepare(query).all(...params) as Application[];
}

export function getStats() {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as c FROM applications').get() as { c: number }).c;
  const byStatus = db.prepare(
    'SELECT status, COUNT(*) as count FROM applications GROUP BY status ORDER BY count DESC'
  ).all() as { status: string; count: number }[];
  const avgScore = (db.prepare(
    'SELECT AVG(score) as avg FROM applications WHERE score IS NOT NULL'
  ).get() as { avg: number | null }).avg;
  const topCompanies = db.prepare(
    'SELECT company, score FROM applications WHERE score >= 4.0 ORDER BY score DESC LIMIT 10'
  ).all() as { company: string; score: number }[];

  return { total, byStatus, avgScore, topCompanies };
}

// ── Scan history ─────────────────────────────────────────────────────

export function hasSeenUrl(url: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM scan_history WHERE url = ?').get(url);
  return row !== undefined;
}

export function hasSeenInApplications(url: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM applications WHERE url = ?').get(url);
  return row !== undefined;
}

export function recordScan(company: string, role: string, url: string, portal: string): void {
  const db = getDb();
  const existing = db.prepare('SELECT id, times_seen FROM scan_history WHERE url = ?').get(url) as
    | { id: number; times_seen: number }
    | undefined;

  if (existing) {
    db.prepare('UPDATE scan_history SET last_seen = datetime(\'now\'), times_seen = ? WHERE id = ?').run(
      existing.times_seen + 1,
      existing.id
    );
  } else {
    db.prepare(
      'INSERT INTO scan_history (company, role, url, portal) VALUES (?, ?, ?, ?)'
    ).run(company, role, url, portal);
  }
}

// ── Follow-ups ────────────────────────────────────────────────────────

export function getOverdueFollowups(): (Followup & { company: string; role: string })[] {
  const db = getDb();
  return db.prepare(`
    SELECT f.*, a.company, a.role
    FROM followups f
    JOIN applications a ON f.application_id = a.id
    WHERE f.status = 'pending' AND f.due_date <= date('now')
    ORDER BY f.due_date ASC
  `).all() as (Followup & { company: string; role: string })[];
}

export function scheduleFollowup(applicationId: number, daysFromNow: number, type: string, notes?: string): void {
  const db = getDb();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + daysFromNow);
  db.prepare(
    'INSERT INTO followups (application_id, due_date, type, notes) VALUES (?, ?, ?, ?)'
  ).run(applicationId, dueDate.toISOString().split('T')[0], type, notes ?? null);
}

// ── Contacts ──────────────────────────────────────────────────────────

export function insertContact(contact: Omit<Contact, 'id' | 'created_at'>): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO contacts (company, name, title, linkedin_url, email, connection, referral,
      outreach_sent, outreach_date, response, notes, application_id)
    VALUES (@company, @name, @title, @linkedin_url, @email, @connection, @referral,
      @outreach_sent, @outreach_date, @response, @notes, @application_id)
  `).run(contact);
  return result.lastInsertRowid as number;
}

export function getContactsByCompany(company: string): Contact[] {
  const db = getDb();
  return db.prepare('SELECT * FROM contacts WHERE company LIKE ?').all(`%${company}%`) as Contact[];
}

// ── Skills gap ────────────────────────────────────────────────────────

export function recordSkills(skills: string[], matched: string[]): void {
  const db = getDb();
  const matchedSet = new Set(matched.map(s => s.toLowerCase()));

  for (const skill of skills) {
    const key = skill.toLowerCase();
    const existing = db.prepare('SELECT id, times_seen, times_matched FROM skills_gap WHERE skill = ?').get(key) as
      | { id: number; times_seen: number; times_matched: number }
      | undefined;

    if (existing) {
      db.prepare('UPDATE skills_gap SET times_seen = ?, times_matched = ?, last_seen = datetime(\'now\') WHERE id = ?').run(
        existing.times_seen + 1,
        existing.times_matched + (matchedSet.has(key) ? 1 : 0),
        existing.id
      );
    } else {
      db.prepare('INSERT INTO skills_gap (skill, times_seen, times_matched) VALUES (?, 1, ?)').run(
        key,
        matchedSet.has(key) ? 1 : 0
      );
    }
  }
}

export function getTopSkillGaps(limit = 10): { skill: string; times_seen: number; match_rate: number }[] {
  const db = getDb();
  return (db.prepare(`
    SELECT skill, times_seen,
           ROUND(CAST(times_matched AS REAL) / times_seen, 2) as match_rate
    FROM skills_gap
    WHERE times_seen >= 2
    ORDER BY times_seen DESC, match_rate ASC
    LIMIT ?
  `).all(limit) as { skill: string; times_seen: number; match_rate: number }[]);
}

// ── Pipeline jobs (opportunity database) ──────────────────────────────

export function upsertPipelineJob(job: {
  company: string; role: string; url: string; portal?: string;
  location?: string; remote?: boolean; salary?: string;
  fit_score?: number; fit_label?: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO pipeline_jobs (company, role, url, portal, location, remote, salary, fit_score, fit_label)
    VALUES (@company, @role, @url, @portal, @location, @remote, @salary, @fit_score, @fit_label)
    ON CONFLICT(url) DO UPDATE SET
      last_seen = (SELECT scanned_at FROM pipeline_jobs WHERE url = excluded.url),
      fit_score = excluded.fit_score,
      fit_label = excluded.fit_label
  `).run({
    company: job.company, role: job.role, url: job.url,
    portal: job.portal ?? null, location: job.location ?? null,
    remote: job.remote ? 1 : 0, salary: job.salary ?? null,
    fit_score: job.fit_score ?? null, fit_label: job.fit_label ?? null,
  });
}

export function getPipelineJobs(filters?: {
  status?: string; minFit?: number; company?: string; limit?: number;
}) {
  const db = getDb();
  let q = 'SELECT * FROM pipeline_jobs WHERE 1=1';
  const p: (string | number)[] = [];
  if (filters?.status)  { q += ' AND status = ?';          p.push(filters.status); }
  if (filters?.minFit)  { q += ' AND fit_score >= ?';      p.push(filters.minFit); }
  if (filters?.company) { q += ' AND company LIKE ?';      p.push(`%${filters.company}%`); }
  q += ' ORDER BY fit_score DESC, scanned_at DESC';
  if (filters?.limit)   { q += ' LIMIT ?';                 p.push(filters.limit); }
  return db.prepare(q).all(...p) as {
    id: number; company: string; role: string; url: string; portal: string;
    location: string; remote: number; salary: string; fit_score: number;
    fit_label: string; status: string; scanned_at: string; notes: string;
  }[];
}

export function markPipelineJobReviewed(url: string, status: 'reviewed' | 'applied' | 'skipped'): void {
  const db = getDb();
  db.prepare(`UPDATE pipeline_jobs SET status = ?, reviewed_at = datetime('now') WHERE url = ?`).run(status, url);
}

// ── Contacts (full CRUD) ───────────────────────────────────────────────

export function getAllContacts() {
  return getDb().prepare(`
    SELECT c.*, a.company as app_company, a.role as app_role
    FROM contacts c
    LEFT JOIN applications a ON c.application_id = a.id
    ORDER BY c.created_at DESC
  `).all() as (Contact & { app_company?: string; app_role?: string })[];
}

export function markOutreachSent(contactId: number): void {
  getDb().prepare(
    `UPDATE contacts SET outreach_sent = 1, outreach_date = date('now') WHERE id = ?`
  ).run(contactId);
}

// ── Followups (all, not just overdue) ─────────────────────────────────

export function getAllFollowups() {
  return getDb().prepare(`
    SELECT f.*, a.company, a.role, a.status as app_status
    FROM followups f
    JOIN applications a ON f.application_id = a.id
    WHERE f.status = 'pending'
    ORDER BY f.due_date ASC
  `).all() as (Followup & { company: string; role: string; app_status: string })[];
}

export function completeFollowup(followupId: number): void {
  getDb().prepare(
    `UPDATE followups SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
  ).run(followupId);
}

// ── Gmail threads ──────────────────────────────────────────────────────

export function upsertGmailThread(thread: {
  thread_id: string; subject?: string; from_email?: string; from_name?: string;
  snippet?: string; date?: string; label?: string; application_id?: number;
}): void {
  getDb().prepare(`
    INSERT INTO gmail_threads (thread_id, subject, from_email, from_name, snippet, date, label, application_id)
    VALUES (@thread_id, @subject, @from_email, @from_name, @snippet, @date, @label, @application_id)
    ON CONFLICT(thread_id) DO UPDATE SET
      label = excluded.label,
      application_id = excluded.application_id,
      processed = 1
  `).run({
    thread_id: thread.thread_id, subject: thread.subject ?? null,
    from_email: thread.from_email ?? null, from_name: thread.from_name ?? null,
    snippet: thread.snippet ?? null, date: thread.date ?? null,
    label: thread.label ?? 'other', application_id: thread.application_id ?? null,
  });
}

export function getRecentGmailThreads(limit = 20) {
  return getDb().prepare(`
    SELECT g.*, a.company, a.role
    FROM gmail_threads g
    LEFT JOIN applications a ON g.application_id = a.id
    ORDER BY g.date DESC LIMIT ?
  `).all(limit) as {
    id: number; thread_id: string; subject: string; from_email: string;
    from_name: string; snippet: string; date: string; label: string;
    company?: string; role?: string;
  }[];
}
