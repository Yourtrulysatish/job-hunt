# Skill: Job Hunt

AI-powered job search system — evaluate offers, track applications, scan portals, negotiate offers, and manage your network — all from Claude Code.

## Triggers

- User pastes a job URL → auto full evaluation pipeline
- User types `/job-hunt` → show command menu
- User asks about a job/company → evaluate or research mode
- User asks about their pipeline → tracker mode

## Quick Commands

| Command | What happens |
|---------|-------------|
| `/job-hunt` | Show menu |
| `/job-hunt evaluate [URL]` | Full 7-block evaluation |
| `/job-hunt scan` | Scan configured portals for new jobs |
| `/job-hunt tracker` | Pipeline status overview |
| `/job-hunt network [company]` | Find and draft outreach to contacts |
| `/job-hunt negotiate` | Offer negotiation playbook |
| `/job-hunt followups` | Show overdue follow-ups |
| `/job-hunt dashboard` | Start web dashboard |
| `/job-hunt doctor` | Check setup health |

## Reading order on activation

1. `CLAUDE.md` (session setup, routing, global rules)
2. `modes/_shared.md` (scoring system, archetypes, writing standards)
3. `modes/_profile.md` (user-specific customization — overrides _shared.md)
4. Mode-specific file based on routing

## Auto-pipeline (URL paste)

When user pastes a URL that looks like a job posting:
1. Read `modes/evaluate.md`
2. Verify posting with Playwright
3. Run full 7-block evaluation
4. Save report to `reports/`
5. Insert into SQLite database
6. If score ≥ 4.0 → offer to generate tailored PDF CV
