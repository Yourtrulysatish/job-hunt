# Mode: Network — Outreach & Referral Strategy

This mode handles LinkedIn contact research, warm intro chains, referral requests, and connection outreach.

## When triggered

- "Find contacts at [company]"
- "Who do I know at [company]?"
- "Draft a LinkedIn message to [name]"
- "How do I get a referral at [company]?"
- "Track my connection with [name]"

---

## Step 1 — Contact Discovery

Use WebSearch to find:
1. Hiring manager for the role (search: `site:linkedin.com "Head of Engineering" "[company]"`)
2. Team members who'd work alongside the candidate (same archetype/domain)
3. Alumni from candidate's previous companies who now work at target
4. 2nd-degree connections via mutual companies in `cv.md`

For each contact found:

| Name | Title | LinkedIn URL | Connection path | Why to reach |
|------|-------|-------------|-----------------|--------------|
| … | … | … | 2nd via [name] | Team lead for this role |

---

## Step 2 — Outreach Prioritization

Rank contacts by warmth:
1. **Alumni** (same past company) — highest response rate
2. **Same university** — second best
3. **Mutual 1st-degree** — can ask for intro
4. **Cold 2nd-degree** — lowest, needs strongest angle

---

## Step 3 — Message Templates

### Warm (alumni/mutual)
Subject: Quick question about [Company]

> Hi [Name],
>
> We [worked at / studied at] [X] — I came across your work at [Company] and wanted to reach out.
>
> I'm exploring roles in [archetype] and [Company]'s [specific thing they do] caught my attention. I'd love a 15-min conversation to understand how the [team name] team works and what makes candidates stand out.
>
> Happy to reciprocate — I'm happy to share what I know about [candidate's area of expertise].
>
> [Name]

### Referral ask (only after 1–2 exchanges)
> I've been following [Company]'s work on [specific product/project] for a while and I applied for the [role] position. If you're open to it, a referral from someone on the team carries a lot of weight — would you be willing?

### Cold (no connection)
> Hi [Name],
>
> I'll keep this brief — I'm an [archetype] professional exploring [Company] after seeing your work on [specific thing]. I noticed [observation about their background/work].
>
> I'm not asking for a job — I'm trying to understand if [Company]'s culture is right for me before investing time in their process. Would you be open to 10 minutes?

---

## Step 4 — Track the Outreach

After drafting/sending, ask user to confirm and then log to the contacts table:

```sql
INSERT INTO contacts (company, name, title, linkedin_url, connection, outreach_sent, outreach_date, notes, application_id)
VALUES ('Acme', 'Jane Doe', 'Head of AI', 'https://...', '2nd-degree', 1, '2026-06-02', 'Alumni — met at Anthropic', 42);
```

Schedule follow-up at +7 days if no response.

---

## Rules

- **Never ask for a job directly in a first message**
- **Personalize every message** — reference something specific from their LinkedIn or company
- **Max 3 outreach attempts** per contact before moving on
- **No bulk messaging** — each message must be individually crafted
- **Always disclose intent** — don't pretend to be casually curious if you're actively job searching
