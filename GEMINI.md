# job-hunt — AI Job Search Pipeline (Gemini CLI)

> This file is auto-loaded by Gemini CLI as persistent context.
> It is the Gemini equivalent of CLAUDE.md.

## What is job-hunt

AI-powered job search automation: pipeline tracking, offer evaluation, CV generation, portal scanning, batch processing, gamification.

Originally built on Claude Code. Fully supported on Gemini CLI.

## Data Contract

**User Layer (never auto-update):**
- `cv.md`, `config/profile.yml`, `modes/_profile.md`, `config/portals.yml`
- `data/`, `reports/`, `output/`, `interview-prep/`

**System Layer (safe to update):**
- `modes/` (except _profile.md), `src/`, `CLAUDE.md`, `GEMINI.md`, `templates/`

**THE RULE:** User personalizations go in `modes/_profile.md` or `config/profile.yml`. Never in `modes/_shared.md`.

## Session Start Checklist

Run silently on session start:
1. Check `cv.md` exists
2. Check `config/profile.yml` exists
3. Check `modes/_profile.md` exists
4. Check `config/portals.yml` exists

If any missing → Onboarding Mode (see CLAUDE.md).

## Mode Routing

| User does this | Read this mode |
|----------------|----------------|
| Pastes job URL or JD | `modes/evaluate.md` |
| "Batch evaluate these URLs" | `modes/batch.md` → run `./batch/batch-runner.sh` |
| "Analyze patterns" | `modes/patterns.md` → run `tsx src/commands/analyze-patterns.ts --summary` |
| "Prep for interview at X" | `modes/interview-prep.md` |
| "Generate LaTeX CV" | `modes/latex.md` |
| "Find contacts at X" | `modes/network.md` |
| "Research X company" | `modes/deep.md` |
| "Compare these offers" | Evaluate each, then rank by Global score |
| "Scan for new jobs" | `tsx src/commands/scan.ts` |
| "What's my pipeline?" | `tsx src/commands/doctor.ts` |
| "Follow-ups due?" | `tsx src/commands/followup.ts` |
| "Negotiate this offer" | `modes/negotiate.md` |
| "What skills am I missing?" | Query skills_gap table |
| "Start dashboard" | `npm run dashboard` → http://localhost:3333 |
| "Check liveness" | `tsx src/commands/liveness.ts` |
| "Verify pipeline" | `tsx src/commands/verify.ts` |

## Evaluation → Database Rule

After every evaluation, record it:

```bash
npx tsx src/commands/record.ts \
  --company "Company" \
  --role "Role Title" \
  --url "https://..." \
  --score 4.2 \
  --status "Evaluated"
```

## Gemini-Specific Notes

- Use `google_search` tool for comp data, company research, Glassdoor queries
- For file generation (PDFs, LaTeX), write files then run shell commands
- For parallel evaluation, use `parallel_tool_call` where available
- Playwright-based liveness checks require local Chrome — run `tsx src/commands/liveness.ts`

## Global Rules

### NEVER
1. Invent experience or metrics
2. Edit `cv.md` (read-only)
3. Submit an application without user review
4. Recommend roles below 4.0/5 without strong reason
5. Use corporate-speak ("passionate about", "synergies", "innovative")

### ALWAYS
1. Read `cv.md` + `modes/_profile.md` before evaluating
2. Use search tools for salary data and company research
3. Register every evaluation in the DB
4. Follow up legitimacy check (Block G) on every evaluation
5. Short sentences. Action verbs. No passive voice.
