# Mode: patterns — Rejection Pattern Detector

When the user says "analyze my rejections", "what patterns do you see", or "what's not working", run this mode.

## Purpose

Find patterns in application outcomes and surface actionable insights. What archetypes convert? What score range is worth applying at? Which skill gaps keep appearing?

## Minimum Threshold

Check: are there at least 5 applications with status beyond "Evaluated"?

```bash
tsx src/commands/analyze-patterns.ts --summary
```

If not enough data:
> "Not enough data yet — need at least 5 progressed applications. Keep applying and come back."

## Step 1 — Run the analyzer

```bash
tsx src/commands/analyze-patterns.ts --summary
```

This reads from SQLite and cross-references evaluation reports. Outputs:
- Funnel (Evaluated → Applied → Interview → Offer)
- Score comparison (positive vs rejected outcomes)
- Archetype breakdown and conversion rates
- Remote policy analysis
- Recommended minimum score threshold
- Top skill gaps (from rejected reports)
- Top 5 actionable recommendations

Report is saved to `reports/pattern-analysis-YYYY-MM-DD.md`.

## Step 2 — Interpret the output

Parse the JSON (or summary table) and generate a narrative analysis:

### What to look for

| Signal | What it means | Action |
|--------|---------------|--------|
| Avg score (positive) > avg score (rejected) by 0.5+ | Score filter is meaningful | Raise minimum threshold |
| Archetype with 0% conversion | That archetype doesn't fit | Avoid or reframe pitch |
| Same gap appears in 3+ rejections | Hard skill gap | Target learning or reframe |
| High % of "uncertain" remote roles | Wasted effort on onsite roles | Pre-filter by remote policy |
| Many pending > 14 days | Follow-up needed | Batch follow-up outreach |

### Report format

```markdown
## Pattern Analysis — [date]

**TL;DR:** [1-2 sentence verdict]

### What's working
- [archetype] roles at [score range] are converting at [X]%
- [remote policy] jobs show [X]% positive rate

### What's not working  
- [archetype] has 0/N conversion — stop applying or change pitch
- Score below [X] = 0 interviews — raise the floor

### Top skill gaps (blocking factor)
1. [gap] — appeared in N rejections — [mitigation plan]
2. ...

### Next 3 actions
1. [specific action] — impact: HIGH/MED/LOW
2. ...
```

## Step 3 — Update filter settings

If patterns suggest changing score floor or removing archetypes, update:
- `config/portals.yml` — title_filter.positive/negative
- `modes/_profile.md` — scoring weights for archetypes
- Dashboard min score filter

## When to run this

- Every 10 new applications
- After a string of rejections
- Before a new outreach campaign
- Monthly review
