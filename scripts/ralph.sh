#!/usr/bin/env bash
set -uo pipefail

LABEL="${RALPH_LABEL:-ready-for-agent}"
MAX_ITER="${1:-10}"
MAX_FAILS="${RALPH_MAX_FAILS:-3}"
DRY_RUN="${RALPH_DRY_RUN:-0}"
NO_PUSH="${RALPH_NO_PUSH:-0}"
PROGRESS_FILE=".scratch/ralph-progress.txt"

log() { printf '[ralph %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
usage() {
  echo "usage: ./scripts/ralph.sh [max_iterations]"
  echo "  env: RALPH_LABEL (default: ready-for-agent)"
  echo "       RALPH_MAX_FAILS (default: 3 consecutive failures before skipping an issue)"
  echo "       RALPH_DRY_RUN=1 (pick issue and exit without running opencode)"
  echo "       RALPH_NO_PUSH=1 (skip git push after closing an issue)"
  echo "  spec issues (/to-spec output) are skipped automatically"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

for cmd in gh git opencode bun; do
  command -v "$cmd" >/dev/null 2>&1 || { log "required command not found: $cmd"; exit 1; }
done

if [ "$DRY_RUN" != "1" ]; then
  [ -z "$(git status --porcelain)" ] || { log "working tree is dirty. commit or stash first."; exit 1; }
fi

mkdir -p .scratch
touch "$PROGRESS_FILE"

declare -A FAIL_COUNT

for ((iter = 1; iter <= MAX_ITER; iter++)); do
  log "=== iteration $iter/$MAX_ITER ==="

  candidates=$(gh issue list --label "$LABEL" --state open --limit 200 \
    --json number,title,body \
    --jq 'sort_by(.number) | .[] | [(.number|tostring), (.title // ""), ((.body // "") | .[0:500] | gsub("[\\n\\r\\t]"; " "))] | @tsv')

  picked=""
  specs_skipped=0
  while IFS=$'\t' read -r num title body; do
    [ -n "$num" ] || continue
    if [[ "$body" == *'## Problem Statement'* ]]; then
      log "skipping #$num — spec issue, not a ticket"
      specs_skipped=$((specs_skipped + 1))
      continue
    fi
    picked="${num}"$'\t'"${title}"
    break
  done <<< "$candidates"

  if [ -z "$picked" ]; then
    if [ "$specs_skipped" -gt 0 ]; then
      log "COMPLETE: only spec issues remain labeled '$LABEL' — nothing to implement"
    else
      log "COMPLETE: no open issues labeled '$LABEL'"
    fi
    exit 0
  fi

  num="${picked%%$'\t'*}"
  title="${picked#*$'\t'}"
  log "picked #$num: $title"

  if [ "$DRY_RUN" = "1" ]; then
    log "dry-run: would run opencode for #$num"
    exit 0
  fi

  branch="ralph/issue-$num"
  if ! git rev-parse --verify "$branch" >/dev/null 2>&1; then
    git checkout -b "$branch" || { log "failed to create branch $branch"; exit 1; }
  else
    git checkout "$branch"
  fi

  prompt="Implement GitHub issue #$num in this repository.
Fetch it first with: gh issue view $num --comments
Follow AGENTS.md and the existing code conventions. Work test-first where practical.
Run 'bun test' and 'bunx tsc --noEmit' until both pass.
When green, commit ALL changes with the message: feat: #$num $title
Do not push. Do not close the issue. Never modify .env or commit secrets."

  log "running opencode for #$num"
  if ! opencode run "$prompt"; then
    log "opencode exited non-zero for #$num"
    fails=$(( ${FAIL_COUNT[$num]:-0} + 1 ))
    FAIL_COUNT[$num]=$fails
    echo "issue #$num: opencode crash (attempt $fails)" >>"$PROGRESS_FILE"
    continue
  fi

  log "verifying checks for #$num"
  logfile=$(mktemp)
  check_fail=0
  bun test >"$logfile" 2>&1 || check_fail=1
  if [ "$check_fail" -eq 0 ]; then
    bunx tsc --noEmit >>"$logfile" 2>&1 || check_fail=1
  fi

  if [ "$check_fail" -ne 0 ]; then
    tail -n 40 "$logfile"
    fails=$(( ${FAIL_COUNT[$num]:-0} + 1 ))
    FAIL_COUNT[$num]=$fails
    echo "issue #$num: checks failed (attempt $fails)" >>"$PROGRESS_FILE"
    if [ "$fails" -ge "$MAX_FAILS" ]; then
      log "giving up on #$num after $fails attempts — relabeling needs-triage, work left on $branch"
      gh issue edit "$num" --remove-label "$LABEL" --add-label "needs-triage" >/dev/null
      {
        echo "---"
        echo "issue #$num ABANDONED after $fails failed attempts ($(date -Iseconds)), branch: $branch"
        tail -n 20 "$logfile"
      } >>"$PROGRESS_FILE"
    fi
    rm -f "$logfile"
    continue
  fi
  rm -f "$logfile"

  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit -m "feat: #$num $title" || log "nothing to commit for #$num"
  fi

  gh issue close "$num" --comment "Implemented by the ralph loop (iteration $iter)." >/dev/null
  log "closed #$num"
  {
    echo "---"
    echo "issue #$num CLOSED ($(date -Iseconds)) on branch $branch"
  } >>"$PROGRESS_FILE"

  if [ "$NO_PUSH" != "1" ]; then
    if git push -u origin "$branch"; then
      log "pushed $branch"
    else
      log "push failed for $branch — continuing (issue already closed)"
    fi
  fi
done

log "max iterations reached ($MAX_ITER). rerun to continue."
