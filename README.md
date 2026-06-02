# Job Hunt

**AI-powered job search system built for Claude Code.**

A complete rebuild of the job search automation concept — with a web dashboard, SQLite database, TypeScript scripts, multi-portal scanning (Greenhouse, Ashby, Lever, Workday, SmartRecruiters), networking CRM, and a negotiation playbook.

---

## Why this exists

[career-ops](https://github.com/santifer/career-ops) is excellent. This takes that idea further:

| career-ops | Job Hunt |
|---|---|
| Markdown files for data (fragile, no queries) | **SQLite** — proper queries, no corruption |
| Terminal TUI (requires Go compilation) | **Web dashboard** — browser, no build step |
| Plain JS `.mjs` scripts | **TypeScript** — type-safe, IDE-friendly |
| Greenhouse + Ashby + Lever | + **Workday + SmartRecruiters** |
| No networking tracking | **Contacts CRM** built in |
| Manual follow-up | **Auto follow-up scheduling** |
| Spanish mode names | **All English, globally consistent** |
| Salary negotiation scripts only | **Full negotiation playbook** with counter-offer math |
| Skills gap not tracked | **Skills gap analysis** across all evaluations |

Both systems share the same core philosophy: **quality over quantity, human always decides, AI filters and recommends**.

---

## Features

| Feature | Description |
|---------|-------------|
| **7-Block Evaluation** | Role summary, CV match (with gap strategy), level strategy, comp research, personalization plan, interview prep (STAR+R), posting legitimacy |
| **SQLite Storage** | All pipeline data in a queryable database. No more broken markdown tables. |
| **Web Dashboard** | Browser-based pipeline view with charts, status filters, score distribution, skills gap — no Go, no compilation |
| **Multi-Portal Scanner** | Greenhouse, Ashby, Lever, Workday, SmartRecruiters — zero LLM tokens, pure HTTP |
| **Networking CRM** | Track LinkedIn contacts, warm intros, referral chains, outreach status |
| **Negotiation Mode** | Offer intake → market benchmark → counter-offer math → scripts for every scenario |
| **Follow-up Scheduler** | Auto-schedule follow-ups after applying, interviewing, or receiving offers |
| **Skills Gap Tracker** | Aggregates required skills across all evaluated JDs vs your profile |
| **Interview Story Bank** | Accumulates STAR+R stories across evaluations — adapts to each archetype |
| **Human-in-the-Loop** | AI evaluates and recommends. You decide and act. Nothing is submitted without your review. |

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Yourtrulysatish/job-hunt.git
cd job-hunt

# 2. Install
npm install
npx playwright install chromium

# 3. Configure
cp config/profile.example.yml config/profile.yml
cp config/portals.example.yml config/portals.yml
cp modes/_profile.template.md modes/_profile.md

# 4. Add your CV
# Create cv.md in the project root (markdown format)

# 5. Check setup
npm run doctor

# 6. Open Claude Code
claude
```

Claude will guide you through onboarding if anything is missing.

---

## Usage

**Evaluate a job** — paste a URL in Claude Code:
```
https://jobs.ashbyhq.com/anthropic/some-role
```
Claude runs the full 7-block evaluation, saves a report, logs to the database.

**Scan for new jobs:**
```bash
npm run scan              # scan all enabled companies
npm run scan -- --company Anthropic
npm run scan -- --dry-run
```

**Web dashboard:**
```bash
npm run dashboard
# → http://localhost:3333
```

**Check follow-ups:**
```bash
npm run followup
```

**Within Claude Code:**
```
/job-hunt              # show menu
/job-hunt tracker      # pipeline status
/job-hunt negotiate    # offer negotiation
/job-hunt network Acme # find contacts at Acme
```

---

## Project Structure

```
job-hunt/
├── CLAUDE.md               # AI agent instructions
├── cv.md                   # Your CV (create this)
├── article-digest.md       # Proof points / portfolio highlights (optional)
├── src/
│   ├── commands/
│   │   ├── scan.ts         # Multi-portal job scanner
│   │   ├── doctor.ts       # Setup validator
│   │   └── followup.ts     # Overdue follow-up checker
│   ├── db/
│   │   ├── schema.ts       # SQLite schema (applications, contacts, followups, skills)
│   │   ├── client.ts       # Database client
│   │   └── queries.ts      # Typed query helpers
│   └── web/
│       ├── server.ts       # Express dashboard server
│       └── public/
│           └── index.html  # Dashboard UI
├── modes/                  # AI instruction files
│   ├── _shared.md          # Scoring system, archetypes, writing standards
│   ├── _profile.md         # YOUR customization (never auto-updated)
│   ├── _profile.template.md
│   ├── evaluate.md         # Full 7-block job evaluation
│   ├── network.md          # LinkedIn outreach + referral strategy
│   ├── negotiate.md        # Offer negotiation playbook
│   └── tracker.md          # Pipeline status queries
├── config/
│   ├── profile.example.yml
│   └── portals.example.yml
├── reports/                # Evaluation reports (gitignored)
├── data/                   # SQLite database (gitignored)
└── .claude/
    └── skills/job-hunt/SKILL.md
```

---

## Database Schema

```sql
applications  — core pipeline (with score, archetype, salary range, legitimacy)
contacts      — networking CRM (company contacts, outreach status, referral flag)
followups     — scheduled follow-up actions with due dates
scan_history  — deduplication across scans (prevents reprocessing seen URLs)
skills_gap    — aggregated skill demand vs match rate across evaluations
salary_data   — market comp data collected during evaluations
```

---

## Score Interpretation

| Score | Meaning | Action |
|-------|---------|--------|
| 4.5–5.0 | Strong match | Apply immediately |
| 4.0–4.4 | Good match | Apply |
| 3.5–3.9 | Marginal | Only if specific reason |
| < 3.5 | Poor fit | Skip — save your time |

**Scores below 4.0 are flagged with a recommendation not to apply.** Quality beats spray-and-pray every time.

---

## Customization

Everything is customizable by asking Claude directly:
- "Change the archetypes to data engineering roles" → edits `modes/_profile.md`
- "Add these companies to my portal scan" → edits `config/portals.yml`
- "Update my salary target" → edits `config/profile.yml`
- "Translate the modes to German" → edits files in `modes/`

**User layer** (your data, never auto-updated): `cv.md`, `config/profile.yml`, `modes/_profile.md`, `config/portals.yml`

**System layer** (safe to update): `modes/_shared.md`, `src/`, `CLAUDE.md`

---

## Adding Portals

Supported out of the box: **Greenhouse**, **Ashby**, **Lever**, **Workday**, **SmartRecruiters**

Add any company in `config/portals.yml`:
```yaml
- name: Your Company
  careers_url: https://jobs.ashbyhq.com/yourcompany
  enabled: true
```

The scanner auto-detects the portal from the URL.

---

## Ethics

This system is a **quality filter, not a spray tool**.

- Nothing is submitted without your explicit review
- Scores below 4.0 → explicit recommendation to skip
- Every application that goes out should be worth a recruiter's attention
- Networking outreach is personalized, never bulk-sent

---

## Stack

- **Runtime:** Node.js 20+ / TypeScript
- **AI:** Claude Code (Claude Sonnet 4.6 / Claude Opus 4)
- **Database:** SQLite via `better-sqlite3`
- **Scraping / PDF:** Playwright
- **Dashboard:** Express + vanilla JS (no build step)
- **Portal APIs:** Greenhouse, Ashby, Lever, Workday, SmartRecruiters (zero LLM tokens)

---

## License

MIT — fork it, make it yours, build something better.
