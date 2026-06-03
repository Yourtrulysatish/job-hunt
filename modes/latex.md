# Mode: latex — LaTeX CV Export

Export a tailored, ATS-optimized CV as a `.tex` file and compile it to PDF via `tectonic` or `pdflatex`.

**Requires:** `tectonic` (preferred: `brew install tectonic`) or `pdflatex` on PATH.

Check: `which tectonic || which pdflatex`

## When to use

- Applying to companies that specifically request PDF with embedded fonts
- When the HTML PDF (`modes/apply.md`) looks off in their ATS
- LaTeX produces tighter typography and guaranteed font embedding

## Pipeline

1. Read `cv.md` as source of truth
2. Read `config/profile.yml` for contact info
3. Fetch or read the JD
4. Extract 15–20 keywords from JD
5. Detect language → CV language (EN default)
6. Detect archetype → adapt framing
7. Rewrite Professional Summary injecting JD keywords (never invent skills)
8. Select top 3–4 most relevant projects
9. Reorder experience bullets by JD relevance
10. Generate `.tex` from `templates/cv-template.tex`
11. Write to `output/cv-{candidate}-{company}-{YYYY-MM-DD}.tex`
12. Compile:
    ```bash
    tectonic output/cv-{candidate}-{company}-{YYYY-MM-DD}.tex
    # or:
    pdflatex -output-directory output/ output/cv-{candidate}-{company}-{YYYY-MM-DD}.tex
    ```
13. Report: .tex path, .pdf path, file size, keyword coverage %

## Template Placeholders

Template at `templates/cv-template.tex` uses `{{PLACEHOLDER}}` syntax:

| Placeholder | Source |
|-------------|--------|
| `{{NAME}}` | `profile.yml → candidate.name` |
| `{{EMAIL}}` | `profile.yml → candidate.email` |
| `{{LINKEDIN_URL}}` | Full URL with https:// |
| `{{LINKEDIN_DISPLAY}}` | Display text only (no scheme) |
| `{{PORTFOLIO_URL}}` | Full URL with https:// |
| `{{PORTFOLIO_DISPLAY}}` | Display text only |
| `{{LOCATION}}` | `profile.yml → candidate.location` |
| `{{SUMMARY}}` | Tailored Professional Summary |
| `{{EXPERIENCE}}` | LaTeX experience blocks |
| `{{PROJECTS}}` | LaTeX project blocks |
| `{{EDUCATION}}` | LaTeX education blocks |
| `{{SKILLS}}` | LaTeX skills section |

## LaTeX Content Generation

### Experience block format

```latex
\resumeSubheading
  {Company Name}{Start – End}
  {Role Title}{Location}
  \resumeItemListStart
    \resumeItem{Bullet with JD keyword injected naturally}
    \resumeItem{Another bullet — exact metric from cv.md}
  \resumeItemListEnd
```

### Projects block format

```latex
\resumeProjectHeading
  {\textbf{Project Name} $|$ \emph{Tech, Stack}}{Date}
  \resumeItemListStart
    \resumeItem{Impact bullet — metric from cv.md or article-digest.md}
  \resumeItemListEnd
```

## Keyword Injection Rules

- Reformulate real experience with JD vocabulary
- **Never add skills the candidate doesn't have**
- Example: JD says "ecosystem partnerships" + CV says "partner development" → `"ecosystem partnership development"`
- Distribute keywords: Summary (top 5), first bullet of each role, Skills section

## ATS Rules

- Single-column layout only
- Standard section headers: Professional Summary, Work Experience, Education, Skills, Projects
- No text in graphics/images
- UTF-8, selectable text
- Keywords must appear as plain text (not images)

## On Failure

If `tectonic`/`pdflatex` not found:
1. Write the `.tex` file anyway
2. Tell the user: "LaTeX not installed. Install with `brew install tectonic` and run: `tectonic output/cv-*.tex`"
3. Offer to generate HTML PDF instead (modes/apply.md)
