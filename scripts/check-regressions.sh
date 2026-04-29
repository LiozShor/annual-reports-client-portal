#!/usr/bin/env bash
# check-regressions.sh — Run regression cases from .claude/regressions/cases.md
# Exit non-zero if any case FAILs.
#
# Usage: bash scripts/check-regressions.sh [--quiet]
#
# Format of cases.md:
#   id | category | command | expect | rule_link
# Lines starting with # or blank are skipped.

set -u

CASES_FILE=".claude/regressions/cases.md"
TIMEOUT=30
QUIET=0

if [ "${1:-}" = "--quiet" ]; then
  QUIET=1
fi

if [ ! -f "$CASES_FILE" ]; then
  echo "ERROR: cases file not found: $CASES_FILE" >&2
  exit 1
fi

pass=0
fail=0
skip=0
total=0

while IFS= read -r line; do
  # Skip blank lines and comments
  case "$line" in
    '' | '#'*) continue ;;
  esac

  # Split on " | " — must have exactly 5 fields
  id=""
  category=""
  command=""
  expect=""
  rule_link=""

  # Use parameter expansion to split on " | "
  # field 1
  rest="$line"
  id="${rest%% | *}"
  rest="${rest#*" | "}"
  # field 2
  category="${rest%% | *}"
  rest="${rest#*" | "}"
  # field 3
  command="${rest%% | *}"
  rest="${rest#*" | "}"
  # field 4
  expect="${rest%% | *}"
  rest="${rest#*" | "}"
  # field 5
  rule_link="${rest}"

  # Validate we got at least id + command
  if [ -z "$id" ]; then
    continue
  fi

  total=$((total + 1))

  if [ -z "$command" ] || [ "$command" = " " ]; then
    skip=$((skip + 1))
    [ "$QUIET" -eq 0 ] && echo "[SKIP] $id $category: $expect"
    continue
  fi

  # Run command in subshell with timeout, from repo root
  if command -v timeout >/dev/null 2>&1; then
    timeout "$TIMEOUT" bash -c "$command" >/dev/null 2>&1
    exit_code=$?
  else
    # Git Bash on Windows may not have `timeout`; use a background subshell trick
    bash -c "$command" >/dev/null 2>&1 &
    pid=$!
    count=0
    while kill -0 "$pid" 2>/dev/null && [ $count -lt $TIMEOUT ]; do
      sleep 1
      count=$((count + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      exit_code=124  # simulate timeout exit code
    else
      wait "$pid"
      exit_code=$?
    fi
  fi

  if [ $exit_code -eq 0 ]; then
    pass=$((pass + 1))
    [ "$QUIET" -eq 0 ] && echo "[PASS] $id $category: $expect"
  else
    fail=$((fail + 1))
    echo "[FAIL] $id $category: $expect  (exit $exit_code, rule: $rule_link)"
  fi

done < "$CASES_FILE"

echo ""
echo "$total cases run: $pass pass, $fail fail, $skip skip"

if [ $fail -gt 0 ]; then
  exit 1
fi
exit 0
