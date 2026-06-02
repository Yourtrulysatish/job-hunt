# Shared System Context — Job Hunt

<!-- AUTO-UPDATABLE: Do not put personal data here. Use modes/_profile.md instead. -->

## Sources of Truth

| File | When to read |
|------|-------------|
| `cv.md` | Every evaluation — canonical CV |
| `article-digest.md` | Every evaluation (if exists) — detailed proof points |
| `config/profile.yml` | Every session — identity, targets, preferences |
| `modes/_profile.md` | Every evaluation — archetypes, narrative, negotiation strategy |

**RULE: `modes/_profile.md` overrides any defaults here.**

---

## Scoring System (10-Point Grid, collapsed to 5.0)

Each evaluation produces a **global score from 1.0–5.0** from 6 dimensions:

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| CV Match | 35% | Skills, experience, and proof points vs JD requirements |
| Role Fit | 20% | Alignment with candidate's target archetypes (from _profile.md) |
| Compensation | 20% | Salary vs market benchmarks (Glassdoor, Levels.fyi, Blind, LinkedIn Salary) |
| Culture Signals | 15% | Remote policy, growth stage, team culture, stability |
| Opportunity Upside | 10% | Career trajectory, brand value, network building potential |
| **Red Flag Deductions** | — | Subtract 0.1–0.5 per flag (ghost posting, layoffs, toxic signals) |

**Score interpretation:**
- **4.5–5.0** → Strong match — apply immediately
- **4.0–4.4** → Good match — worth applying
- **3.5–3.9** → Marginal — only if specific reason
- **Below 3.5** → Recommend against (explain why)

---

## Role Archetypes

Detect archetype from JD, then read `modes/_profile.md` for candidate-specific framing:

| Archetype | Key JD signals |
|-----------|---------------|
| **AI Platform / LLMOps** | observability, evals, pipelines, monitoring, reliability, MLflow |
| **Agentic / Automation** | agent, HITL, orchestration, workflow, multi-agent, n8n |
| **Technical AI PM** | PRD, roadmap, discovery, stakeholder, product manager, metrics |
| **AI Solutions Architect** | architecture, enterprise, integration, design, systems design |
| **AI Forward Deployed** | client-facing, deploy, prototype, fast delivery, field |
| **AI Transformation** | change management, adoption, enablement, CoE, scaling |
| **Backend / Platform Eng** | APIs, microservices, distributed systems, Kubernetes, SRE |
| **Data Engineering** | pipelines, Spark, dbt, Airflow, data warehouse, ETL |
| **ML Engineering** | training, fine-tuning, inference, model serving, CUDA |

If archetype is a hybrid, indicate both and blend framing from `_profile.md`.

---

## Posting Legitimacy (Block G)

This is a separate qualitative assessment. It does NOT affect the 1–5 score.

**Three tiers:**
- **High Confidence** — Real, active opening
- **Proceed with Caution** — Mixed signals worth noting
- **Suspicious** — Multiple ghost indicators

**Signals (highest reliability first):**
1. Apply button active (Playwright verify — required)
2. Posting age under 30 days
3. Tech specificity in JD (generic = weaker signal)
4. No recent mass layoff in this team/department
5. Role reposted < 2x in 90 days (check SQLite scan_history)
6. Salary transparency (low reliability — jurisdiction dependent)

**MANDATORY framing:** Present signals, never accuse. Always note legitimate explanations.

---

## Writing Standards (ALL candidate-facing content)

Applied to: PDF summaries, bullets, cover letters, form answers, LinkedIn messages.

### Forbidden phrases
- passionate about / results-oriented / proven track record
- leveraged (→ used), spearheaded (→ led), facilitated (→ ran)
- synergies / robust / seamless / cutting-edge / innovative
- "in today's fast-paced world" / "best practices" / "demonstrated ability to"

### Structure rules
- Vary sentence lengths. Mix short punchy sentences with longer context-setting ones.
- Don't start every bullet with the same verb.
- Prefer specifics over abstractions at all times.

### Metrics format
- Always read from `cv.md` + `article-digest.md`. Never hardcode or invent.
- Format: "from X to Y" or "by X%" — not "significantly improved"

---

## Salary Negotiation Framework

When comp is discussed, apply this framework:

1. **Anchor high, justify with data** — cite Levels.fyi, Glassdoor, competing offers
2. **Never give the first number** if avoidable; if forced, use top of target range + 15%
3. **Geographic discount pushback** — if they cite location: "My impact is location-agnostic"
4. **Competing offer leverage** — even at interview stage, mention you're in process elsewhere
5. **Equity framing** — always ask for vesting schedule, cliff, refresh policy, strike price

---

## Follow-up Cadence (defaults, overridable in _profile.md)

| Stage | Follow-up timing |
|-------|-----------------|
| Applied | +7 days if no response |
| Phone screen | +3 days after |
| Interview | +2 days after |
| Final round | +5 days if no decision |
| Offer received | 48 hours to respond (unless negotiating) |
