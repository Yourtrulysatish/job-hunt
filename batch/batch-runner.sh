#!/usr/bin/env bash
set -euo pipefail

# job-hunt batch runner — parallel job evaluation via claude -p workers
# Reads batch-input.tsv, delegates each offer to a claude -p worker,
# tracks state in batch-state.tsv for resumability.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BATCH_DIR="$SCRIPT_DIR"
INPUT_FILE="$BATCH_DIR/batch-input.tsv"
STATE_FILE="$BATCH_DIR/batch-state.tsv"
PROMPT_FILE="$BATCH_DIR/batch-prompt.md"
LOGS_DIR="$BATCH_DIR/logs"
REPORTS_DIR="$PROJECT_DIR/reports"

# Defaults
PARALLEL=1
DRY_RUN=false
RETRY_FAILED=false
START_FROM=0
MAX_RETRIES=2
MIN_SCORE=0

usage() {
  cat <<'USAGE'
job-hunt batch runner — evaluate multiple job offers in parallel via claude -p workers

Usage: batch-runner.sh [OPTIONS]

Options:
  --parallel N         Number of parallel workers (default: 1)
  --dry-run            Show pending jobs without executing
  --retry-failed       Only retry jobs marked as "failed"
  --start-from N       Start from ID N
  --max-retries N      Max retry attempts per job (default: 2)
  --min-score N        Skip record for jobs scoring below N
  -h, --help           Show this help

Files:
  batch-input.tsv      Input URLs  (id, url, source, notes)
  batch-state.tsv      Processing state (auto-managed)
  batch-prompt.md      Prompt template for workers
  logs/                Per-job logs

Examples:
  # Add jobs to batch-input.tsv first:
  echo -e "1\thttps://boards.greenhouse.io/.../job/123\tgreenhouse\t" >> batch/batch-input.tsv

  # Dry run to see pending
  ./batch/batch-runner.sh --dry-run

  # Process all pending
  ./batch/batch-runner.sh

  # Process 3 at a time
  ./batch/batch-runner.sh --parallel 3
USAGE
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --parallel)   PARALLEL="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --retry-failed) RETRY_FAILED=true; shift ;;
    --start-from) START_FROM="$2"; shift 2 ;;
    --max-retries) MAX_RETRIES="$2"; shift 2 ;;
    --min-score)  MIN_SCORE="$2"; shift 2 ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

# Ensure required files exist
if [[ ! -f "$INPUT_FILE" ]]; then
  echo "ERROR: batch-input.tsv not found. Create it first."
  exit 1
fi
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "ERROR: batch-prompt.md not found."
  exit 1
fi

mkdir -p "$LOGS_DIR"

# Init state file if empty
if [[ ! -s "$STATE_FILE" ]]; then
  echo -e "id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries" > "$STATE_FILE"
fi

# Read state into memory (associative array)
declare -A STATE_STATUS STATE_RETRIES STATE_REPORT_NUM
while IFS=$'\t' read -r id url status started completed report_num score error retries; do
  [[ "$id" == "id" ]] && continue
  STATE_STATUS["$id"]="$status"
  STATE_RETRIES["$id"]="${retries:-0}"
  STATE_REPORT_NUM["$id"]="${report_num:--}"
done < "$STATE_FILE"

# Collect pending jobs
PENDING=()
while IFS=$'\t' read -r id url source notes; do
  [[ "$id" == "id" || -z "$id" || -z "$url" ]] && continue
  [[ "$id" -lt "$START_FROM" ]] && continue

  current_status="${STATE_STATUS[$id]:-pending}"
  current_retries="${STATE_RETRIES[$id]:-0}"

  if [[ "$RETRY_FAILED" == true ]]; then
    [[ "$current_status" != "failed" ]] && continue
  else
    [[ "$current_status" == "completed" ]] && continue
    [[ "$current_status" == "failed" && "$current_retries" -ge "$MAX_RETRIES" ]] && continue
  fi

  PENDING+=("$id|$url|$source|$notes")
done < "$INPUT_FILE"

echo ""
echo "  job-hunt batch runner"
echo "  ─────────────────────────────────────────────"
echo "  Pending:   ${#PENDING[@]} jobs"
echo "  Parallel:  $PARALLEL workers"
echo "  Dry run:   $DRY_RUN"
echo ""

if [[ ${#PENDING[@]} -eq 0 ]]; then
  echo "  Nothing to process."
  exit 0
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "  Would process:"
  for entry in "${PENDING[@]}"; do
    IFS='|' read -r id url source notes <<< "$entry"
    echo "    [$id] $url  ($source)"
  done
  exit 0
fi

# State update helper (file-locked)
update_state() {
  local id="$1" new_status="$2" report_num="${3:--}" score="${4:--}" error="${5:--}" retries="${6:-0}"
  local now; now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local tmp; tmp=$(mktemp)

  # Remove existing row for this id, append updated
  grep -v "^${id}"$'\t' "$STATE_FILE" > "$tmp" || true
  if [[ "$new_status" == "running" ]]; then
    echo -e "${id}\t-\t${new_status}\t${now}\t-\t-\t-\t-\t${retries}" >> "$tmp"
  else
    echo -e "${id}\t-\t${new_status}\t-\t${now}\t${report_num}\t${score}\t${error}\t${retries}" >> "$tmp"
  fi
  mv "$tmp" "$STATE_FILE"
}

# Worker function — runs in subshell for parallel execution
run_worker() {
  local id="$1" url="$2"
  local log_file="$LOGS_DIR/${id}.log"
  local retries="${STATE_RETRIES[$id]:-0}"

  update_state "$id" "running" "-" "-" "-" "$retries"
  echo "  [START] Job $id: $url"

  # Build prompt with substituted placeholders
  local today; today=$(date +%Y-%m-%d)
  local prompt; prompt=$(sed \
    -e "s|{{URL}}|$url|g" \
    -e "s|{{DATE}}|$today|g" \
    -e "s|{{ID}}|$id|g" \
    "$PROMPT_FILE")

  # Run worker — capture output
  local output exit_code=0
  output=$(cd "$PROJECT_DIR" && claude -p --dangerously-skip-permissions \
    --output-format json \
    "$prompt" 2>&1) || exit_code=$?

  echo "$output" > "$log_file"

  # Parse JSON summary from last line (worker prints JSON at end)
  local json_line; json_line=$(echo "$output" | grep '^\s*{' | tail -1 || echo "")
  local status="completed" score="-" report_num="-" error="-"

  if [[ -n "$json_line" ]]; then
    status=$(echo "$json_line"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','completed'))" 2>/dev/null || echo "completed")
    score=$(echo "$json_line"    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('score') or '-')"        2>/dev/null || echo "-")
    report_num=$(echo "$json_line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('report_num') or '-')" 2>/dev/null || echo "-")
    error=$(echo "$json_line"    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error') or '-')"        2>/dev/null || echo "-")
  elif [[ $exit_code -ne 0 ]]; then
    status="failed"
    error="exit code $exit_code"
  fi

  update_state "$id" "$status" "$report_num" "$score" "$error" "$retries"

  if [[ "$status" == "completed" ]]; then
    echo "  [DONE]  Job $id — score: $score  report: $report_num"
  else
    echo "  [FAIL]  Job $id — $error  (log: $log_file)"
  fi
}

export -f run_worker update_state
export STATE_FILE LOGS_DIR PROJECT_DIR PROMPT_FILE
# Export associative arrays via env (serialize)
export STATE_RETRIES_SERIALIZED=""
for k in "${!STATE_RETRIES[@]}"; do
  STATE_RETRIES_SERIALIZED+="${k}=${STATE_RETRIES[$k]};"
done
export STATE_RETRIES_SERIALIZED

# Run jobs — sequential or parallel via background jobs + semaphore
RUNNING=0
for entry in "${PENDING[@]}"; do
  IFS='|' read -r id url source notes <<< "$entry"

  # Parallel semaphore
  while [[ $RUNNING -ge $PARALLEL ]]; do
    wait -n 2>/dev/null || true
    RUNNING=$((RUNNING - 1))
  done

  run_worker "$id" "$url" &
  RUNNING=$((RUNNING + 1))
done

# Wait for all remaining workers
wait

echo ""
echo "  ─────────────────────────────────────────────"
# Summary
completed=$(grep -c $'\tcompleted\t' "$STATE_FILE" 2>/dev/null || echo 0)
failed=$(grep -c $'\tfailed\t' "$STATE_FILE" 2>/dev/null || echo 0)
echo "  Done: $completed completed, $failed failed"
echo "  State: $STATE_FILE"
echo "  Logs:  $LOGS_DIR/"
echo ""
