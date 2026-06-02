# Mode: Tracker — Pipeline Status Overview

When the user asks for their pipeline status, run this query and present the results clearly.

## Queries to run

```sql
-- Overall stats
SELECT status, COUNT(*) as count, ROUND(AVG(score), 1) as avg_score
FROM applications
GROUP BY status
ORDER BY CASE status
  WHEN 'Interview' THEN 1
  WHEN 'Applied' THEN 2
  WHEN 'Offer' THEN 3
  WHEN 'Responded' THEN 4
  WHEN 'Evaluated' THEN 5
  WHEN 'Rejected' THEN 6
  ELSE 7
END;

-- Active pipeline (not closed)
SELECT num, date, company, role, score, status, notes
FROM applications
WHERE status NOT IN ('Rejected', 'Discarded', 'SKIP')
ORDER BY status, score DESC;

-- Overdue follow-ups
SELECT f.type, f.due_date, a.company, a.role, a.status
FROM followups f
JOIN applications a ON f.application_id = a.id
WHERE f.status = 'pending' AND f.due_date <= date('now')
ORDER BY f.due_date;
```

## Presentation format

```
Pipeline Overview — [date]
──────────────────────────
  Interview  2  (avg 4.4)
  Applied    8  (avg 4.1)
  Evaluated  12 (avg 3.9)
  Rejected   5
  Total      30 applications

Active opportunities:
  #042  Acme Corp       Senior AI Engineer    4.5  Interview  ← priority
  #038  Beta Inc        Staff Engineer        4.2  Applied    (applied 5d ago)
  ...

⚠ Overdue follow-ups:
  Beta Inc — follow up now (applied 9d ago, no response)
```

## Canonical statuses

| Status | When |
|--------|------|
| `Evaluated` | Report done, decision pending |
| `Applied` | Application sent |
| `Responded` | Company replied (any direction) |
| `Interview` | Active interview process |
| `Offer` | Offer received |
| `Rejected` | Company said no |
| `Discarded` | Candidate withdrew or posting closed |
| `SKIP` | Decided not to apply |
