# Mode: batch — Parallel Job Evaluation

Evaluate 10+ job offers in parallel using `claude -p` workers, each with a clean context window.

## Architecture

```
batch-runner.sh (orchestrator)
  │
  ├─ Job 1: URL → claude -p worker → evaluation report + DB record + JSON
  ├─ Job 2: URL → claude -p worker → evaluation report + DB record + JSON
  └─ Job N: ...
                   ↓
         batch-state.tsv (progress)
```

Each worker is a child `claude -p` with its own 200K token context. The orchestrator only tracks state.

## Files

```
batch/
  batch-input.tsv      URLs to evaluate (add jobs here)
  batch-state.tsv      Progress (auto-managed, resumable)
  batch-runner.sh      Orchestrator
  batch-prompt.md      Worker prompt template
  logs/                One log per job
```

## Usage

### Step 1 — Add jobs to batch-input.tsv

```
id  url  source  notes
1   https://boards.greenhouse.io/.../job/123   greenhouse
2   https://jobs.ashbyhq.com/company/job-id    ashby
3   https://ripple.com/careers/...             direct
```

Add rows manually or paste from the Inbox dashboard (copy URL button).

### Step 2 — Run the batch

```bash
# See what's pending without running
./batch/batch-runner.sh --dry-run

# Process all pending (1 at a time)
./batch/batch-runner.sh

# Process 3 in parallel (uses 3× API tokens simultaneously)
./batch/batch-runner.sh --parallel 3

# Retry only failed jobs
./batch/batch-runner.sh --retry-failed
```

### Step 3 — Review results

Results are saved to `reports/` and recorded in the DB.
Check them in the dashboard Tracker tab, or:

```bash
tsx src/commands/doctor.ts    # quick status summary
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--parallel N` | 1 | Concurrent workers |
| `--dry-run` | false | Preview without executing |
| `--retry-failed` | false | Only retry failed jobs |
| `--start-from N` | 0 | Skip jobs with ID < N |
| `--max-retries N` | 2 | Attempts per job |
| `--min-score N` | 0 | Skip DB record if score < N |

## When to use this mode

- You have 5+ URLs from the Inbox you want to evaluate overnight
- You want to bulk-screen a company's entire job board
- After a scanner run, to turn all "new" pipeline jobs into evaluations

## Workflow tip

1. Open Inbox in the dashboard
2. Filter to Strong Match + Good Match
3. Copy URL for each interesting job
4. Paste into batch-input.tsv
5. Run `./batch/batch-runner.sh --parallel 2`
6. Check results in Tracker the next morning
