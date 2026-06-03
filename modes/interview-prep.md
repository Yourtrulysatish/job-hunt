# Mode: interview-prep — Company-Specific Interview Intelligence

Trigger: user says "prep me for [Company]", "interview at [X]", or an application moves to "Interview" status.

## Inputs

1. **Company name** + **role title** (required)
2. Evaluation report in `reports/` — read for archetype, gaps, proof points
3. Story bank at `interview-prep/story-bank.md` — existing prepared stories
4. `cv.md` + `config/profile.yml` + `modes/_profile.md`

## Step 1 — Research

Run these WebSearch queries. Extract specific data points, not summaries. Cite every claim.

| Query | Extract |
|-------|---------|
| `"{company} {role} interview questions site:glassdoor.com"` | Actual questions, rounds, timeline, difficulty, offer rate |
| `"{company} interview process site:teamblind.com"` | Process descriptions, comp negotiation, hiring bar |
| `"{company} {role} interview"` | Blog posts, YouTube, candidate write-ups |
| `"{company} engineering culture values"` | What they care about, red flags |

**Never fabricate questions.** Label inferred questions as `[inferred from JD]`.

## Step 2 — Process Overview

```markdown
## Process Overview
- **Rounds:** N rounds, ~X days end-to-end
- **Format:** recruiter screen → [specific rounds] → hiring manager
- **Difficulty:** X/5 (Glassdoor avg, N reviews)
- **Positive experience rate:** X%
- **Known quirks:** [e.g., "no LeetCode — all practical case studies"]
- **Sources:** [links]
```

If data is sparse for this company, use similar-stage companies in the same domain and note that.

## Step 3 — Round-by-Round Breakdown

For each round:

```markdown
### Round N: {Type}
- **Duration:** X min
- **Conducted by:** peer / manager / recruiter
- **What they evaluate:** specific traits
- **Reported questions:**
  - [question] — [Glassdoor 2026-Q1]
  - [question] — [Blind]
- **How to prepare:** 1-2 concrete actions
```

## Step 4 — Likely Questions

Based on JD + archetype, generate 10-15 questions split by:

| Category | Examples |
|----------|---------|
| Role-specific | "How have you structured a BD pipeline from scratch?" |
| Behavioral (STAR) | "Tell me about a partnership you lost — what happened?" |
| Company-specific | "Why Ripple specifically vs other Web3 companies?" |
| Compensation | "What are your salary expectations?" |
| Red flags | "I see you've been at several companies — walk me through that" |

Label each: [sourced] or [inferred from JD].

## Step 5 — STAR Story Bank

Map existing stories from `interview-prep/story-bank.md` to the questions above.

For any uncovered important question, draft a new STAR story:

```markdown
### [Story title]
**Situation:** [1-2 sentences — context]
**Task:** [what you needed to accomplish]
**Action:** [what you specifically did — use "I", not "we"]
**Result:** [quantified outcome from cv.md — never invent]
**Maps to:** [list of questions this answers]
```

Add new stories to `interview-prep/story-bank.md`.

## Step 6 — Compensation Prep

1. WebSearch: `"{company} {role} salary site:levels.fyi"` + `site:glassdoor.com`
2. Draft the negotiation opening (read `modes/negotiate.md` for scripts)
3. Identify BATNA (next best offer / target)

## Step 7 — Output Document

Save to `interview-prep/{company-slug}-{YYYY-MM-DD}.md`:

```markdown
# Interview Prep: {Company} — {Role}

**Date:** {YYYY-MM-DD}
**Application:** #[num] (score X/5)

## Process Overview
[Step 2 output]

## Round-by-Round
[Step 3 output]

## Likely Questions + STAR Answers
[Step 4 + 5 output]

## Comp Prep
[Step 6 output]

## Day-Of Checklist
- [ ] Re-read evaluation report
- [ ] Review top 3 STAR stories out loud
- [ ] Prepare 3 questions to ask them
- [ ] Check LinkedIn for interviewer profiles
- [ ] Know exact comp floor + target
```

## Rules

- **Never fabricate** questions or candidate experiences
- **Cite sources** for every claimed interview question
- **Use exact metrics** from cv.md — never approximate
- If data is sparse: say so and note confidence level
