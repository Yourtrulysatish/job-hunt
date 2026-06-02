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
