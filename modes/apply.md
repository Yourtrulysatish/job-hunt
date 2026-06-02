# Mode: Apply — Full Application Package Generator

When the user says "apply", "generate application", "create application package", or pastes a job URL after an evaluation, generate a complete application package.

**Output goes to:** `output/applications/{num}-{company-slug}-{YYYY-MM-DD}/`

---

## Pre-flight

1. Read `cv.md` — this is the source of truth. Never invent metrics.
2. Read `modes/_profile.md` — archetypes, proof points, negotiation targets.
3. Read `article-digest.md` if it exists — extra proof points.
4. If you don't have the JD yet — fetch it with Playwright (`browser_navigate` + `browser_snapshot`).
5. Detect role archetype (see `modes/_shared.md`).

---

## What to generate

### File 1: `cover-letter.md`

**Format:** 3 paragraphs. Max 250 words. No fluff. No buzzwords.

**Paragraph 1 — The hook (2–3 sentences)**
- Open with one specific thing about the company that is genuinely interesting to Satish
- Connect it immediately to something concrete in his background
- Do NOT open with "I am writing to apply for..."

**Paragraph 2 — The proof (4–5 sentences)**
- Pick the 2–3 most relevant proof points from cv.md for THIS specific role
- Use exact metrics from cv.md (never round up, never invent)
- Frame each proof point in terms of the JD's language — if they say "ecosystem growth", use "ecosystem growth", not "partnership development"
- Lead with the strongest proof point, not the chronological one

**Paragraph 3 — The close (2 sentences)**
- Specific reason why this company over alternatives (not generic enthusiasm)
- Clear call to action — offer a specific next step

**Forbidden words:** passionate, dynamic, synergy, leverage, spearheaded, robust, innovative, cutting-edge, results-oriented, team player, go-getter, detail-oriented, fast-paced

**Tone:** Direct. Confident. Specific. Reads like a sharp email, not a formal letter.

**Header block (top of letter):**
```
Satish Chand Gupta
satishofficial001@gmail.com | linkedin.com/in/yourtrulysatish
Siena, Italy — Remote worldwide
```

---

### File 2: `cv-changes.md`

Exactly 5 specific CV edits for this role. Format:

```
## CV Changes for [Company] — [Role]

### Change 1: [Section name]
**Current:** "[exact current text from cv.md]"
**Change to:** "[new text]"
**Why:** [one line — which JD keyword or requirement this targets]

### Change 2: ...
```

Rules:
- Only suggest changes that meaningfully improve match — no cosmetic edits
- Prioritize: Summary (highest ATS impact), Experience bullets, Skills section
- Inject keywords from the JD that are missing from cv.md
- Never invent new experience — only reframe or reorder what exists
- Flag if a required skill is genuinely missing (honest gap acknowledgment)

---

### File 3: `recruiter-email.md`

A cold email to send to the recruiter or hiring manager if Satish doesn't have a direct contact yet.

**Subject line options (give 3):** Specific to the role, not generic.

**Email body (150 words max):**
- First line: something specific about the company or team (not the job posting)
- Middle: one concrete proof point relevant to this role
- Close: a specific, easy ask ("happy to share more context in a 15-minute call")

**Tone:** Warm but direct. The email should feel like it came from someone confident, not someone desperate.

---

### File 4: `linkedin-message.md`

A LinkedIn connection request message (300 character limit) to send to the hiring manager or a relevant team member.

Then a follow-up message (if they connect) — 3–5 sentences, focused on one proof point.

---

### File 5: `application-notes.md`

Quick reference for when filling out the application form:

```
## Application Notes — [Company] [Role]

**Key JD phrases to mirror in form answers:**
- "[exact phrase from JD]"
- "[exact phrase from JD]"

**Best proof points for this role:**
1. [Specific achievement with metric]
2. [Specific achievement with metric]
3. [Specific achievement with metric]

**Likely screening questions + suggested answers:**
Q: [Common question for this archetype]
A: [2-3 sentence answer using Satish's actual experience]

**Red flags to address proactively:**
- [Any gap or mismatch — how to frame it]

**Compensation target for this role:**
Based on role level and company: $[X]–$[Y] base
Ask about: token/equity structure (for Web3), remote policy confirmation
```

---

## After generating all files

1. Print a summary:
```
✓ Application package ready: output/applications/{folder}/
  cover-letter.md       — ready to paste
  cv-changes.md         — 5 edits before you apply
  recruiter-email.md    — cold outreach draft
  linkedin-message.md   — connection request + follow-up
  application-notes.md  — form-filling reference

Next steps:
  1. Make the 5 CV changes (30 mins)
  2. Send the recruiter email first — before submitting the form
  3. Submit the application
  4. Record it: npm run record -- --company "[X]" --role "[Y]" --url "[Z]" --score [N] --status Applied
```

2. Ask: "Do you want me to search for the hiring manager or a team member at [company] to send the outreach to?"

---

## Quality rules

- Every metric in the cover letter must be traceable to cv.md or article-digest.md
- Cover letter must pass the "would I be embarrassed to send this?" test
- The CV changes must target the specific JD — not generic improvements
- The recruiter email must not sound like a template
- If Satish's profile is a poor fit for this role (score < 3.5), say so clearly and recommend not applying rather than generating a weak package
