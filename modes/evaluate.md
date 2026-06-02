# Mode: Evaluate — Full Job Assessment

When the user pastes a job URL or JD text, deliver all 7 blocks.

## Pre-flight

1. Detect archetype (see `_shared.md`)
2. Read `cv.md`, `modes/_profile.md`, `article-digest.md` (if exists)
3. Verify posting is active via Playwright (browser_navigate + browser_snapshot)
4. Run `node src/commands/doctor.ts` silently if first eval of session

---

## Block A — Role Summary

Table:
| Field | Value |
|-------|-------|
| Archetype | (detected, with confidence) |
| Domain | (platform / agentic / LLMOps / ML / enterprise / data / backend) |
| Function | (build / consult / manage / deploy / research) |
| Seniority | (IC level + manager?) |
| Remote | (full / hybrid / onsite — office location) |
| Team size | (if mentioned) |
| Comp | (stated range or "not disclosed") |
| TL;DR | (one sentence — the honest pitch of this role) |

---

## Block B — CV Match

Read `cv.md`. Map each JD requirement to exact lines from the CV.

| JD Requirement | CV Evidence | Strength |
|----------------|-------------|----------|
| … | "exact quote from cv.md" | Strong / Partial / Gap |

**Archetype-specific proof point priority:**
- **LLMOps** → evals, observability, production pipelines, latency metrics
- **Agentic** → multi-agent systems, HITL, orchestration, tool use
- **AI PM** → product discovery, PRDs, stakeholder alignment, metrics
- **SA** → system design decisions, integration patterns, scale
- **FDE** → fast delivery, client-facing demos, prototypes shipped
- **Transformation** → change management, adoption rates, CoE setup
- **Backend** → API design, throughput, reliability, distributed systems
- **Data** → pipeline scale, tool expertise, data quality, SLAs

**Gaps section:** For each gap:
1. Hard blocker or nice-to-have?
2. Adjacent experience that covers it?
3. Concrete mitigation (cover letter framing, portfolio project, quick course)

---

## Block C — Level Strategy

1. **Detected level** in JD vs candidate's natural level for this archetype
2. **"Sell senior without lying"** — specific phrases using candidate's real achievements, positioned for this archetype
3. **"If down-leveled"** — accept conditions: comp must be 90%+ of target, explicit 6-month review, written promotion criteria

---

## Block D — Compensation Research

Use WebSearch: Glassdoor, Levels.fyi, LinkedIn Salary, Blind, Comprehensive.io

| Source | Role | Location | P25 | P50 | P75 |
|--------|------|----------|-----|-----|-----|

Score this dimension: 5 = top quartile, 3 = median, 1 = well below market.
Note company's reputation for comp (generous / fair / below market / varies by team).

---

## Block E — Personalization Plan

Top 5 CV edits + Top 5 LinkedIn changes for maximum match:

| # | Section | Current state | Proposed change | Why |
|---|---------|---------------|-----------------|-----|
| 1 | Summary | … | … | Keyword X appears 3x in JD |

Include: keywords to inject, metrics to surface, experiences to reorder.

---

## Block F — Interview Preparation

Generate 6–10 STAR+R stories mapped to JD requirements:

| # | JD Requirement | Story | S | T | A | R | Reflection |
|---|---------------|-------|---|---|---|---|------------|

**Reflection** = what the candidate learned or would do differently. Signals seniority.

Check `interview-prep/story-bank.md` for existing stories. Add new ones; avoid duplication.

Tailor by archetype:
- **FDE** → delivery speed, client-facing moments, prototype-to-production
- **SA** → architecture decisions, trade-offs, scale challenges
- **PM** → discovery process, data-driven pivots, stakeholder conflict
- **LLMOps** → eval design, latency reduction, model quality incidents

---

## Block G — Posting Legitimacy

Tier: **High Confidence / Proceed with Caution / Suspicious**

Evidence (from Playwright snapshot + WebSearch + scan_history):
- Posting age: X days
- Apply button: active / disabled / missing
- JD specificity: high / medium / generic
- Recent layoffs: yes / no / unclear
- Repost count: X in last 90 days

Framing: present signals, not accusations. Always note legitimate explanations.

---

## Post-Evaluation Actions

1. Save evaluation report to `reports/{num}-{company-slug}-{YYYY-MM-DD}.md`
2. Insert into SQLite via: `tsx src/commands/record.ts ...`
3. If score ≥ 4.0: offer to generate tailored PDF CV immediately
4. If score < 4.0: explicitly recommend against applying, explain top reason
5. Schedule follow-up if user decides to apply: +7 days

---

## Global Score

Final score: **X.X / 5.0**

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|---------|
| CV Match | /5 | 35% | |
| Role Fit | /5 | 20% | |
| Compensation | /5 | 20% | |
| Culture | /5 | 15% | |
| Upside | /5 | 10% | |
| **Red flag deductions** | — | — | -X.X |
| **GLOBAL** | | | **X.X** |

**Recommendation:** Apply now / Apply if no better options / Skip
