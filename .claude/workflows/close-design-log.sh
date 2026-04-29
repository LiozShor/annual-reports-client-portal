#!/usr/bin/env bash
# .claude/workflows/close-design-log.sh
# Mark a design log as COMPLETED, run PII guard, stage, and print commit suggestion.
#
# Usage: bash .claude/workflows/close-design-log.sh <DL-number>
# Example: bash .claude/workflows/close-design-log.sh 379
#          bash .claude/workflows/close-design-log.sh DL-379

set -euo pipefail

[[ $# -lt 1 ]] && { echo "Usage: $0 <DL-number>" >&2; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Normalise: strip DL- prefix, extract digits
NUM="${1#DL-}"
NUM="${NUM#dl-}"
if ! [[ "$NUM" =~ ^[0-9]+$ ]]; then
  echo "ERROR: '$1' is not a valid DL number" >&2; exit 1
fi

TODAY="$(date +%Y-%m-%d)"
INDEX="$REPO_ROOT/.agent/design-logs/INDEX.md"

# Find the DL file
DL_FILE="$(find "$REPO_ROOT/.agent/design-logs" -name "${NUM}-*.md" | head -1)"
if [[ -z "$DL_FILE" ]]; then
  echo "ERROR: No design log file found for DL-$NUM" >&2; exit 1
fi
echo "→ Found: $DL_FILE"

# Patch the DL file: replace any status in the header (first 10 lines)
perl -i -pe "
  if (\$. <= 10) {
    s/IMPLEMENTED — NEED TESTING/COMPLETED — $TODAY/g;
    s/IMPLEMENTED, NEED TESTING/COMPLETED — $TODAY/g;
    s/IN PROGRESS/COMPLETED — $TODAY/g;
    s/NEED TESTING/COMPLETED — $TODAY/g;
  }
" "$DL_FILE"

# Patch INDEX.md: update the status column for this DL row
perl -i -pe "
  if (/^\| $NUM \|/) {
    s/\| IMPLEMENTED — NEED TESTING \|/| COMPLETED — $TODAY |/g;
    s/\| IMPLEMENTED, NEED TESTING \|/| COMPLETED — $TODAY |/g;
    s/\| IN PROGRESS \|/| COMPLETED — $TODAY |/g;
    s/\| NEED TESTING \|/| COMPLETED — $TODAY |/g;
  }
" "$INDEX"

echo "→ Patched status to COMPLETED — $TODAY in DL file and INDEX.md"

# Run PII guard
PII_GUARD="$REPO_ROOT/.claude/hooks/agent-pii-guard.py"
if [[ -f "$PII_GUARD" ]]; then
  echo "→ Running PII guard..."
  if ! python3 "$PII_GUARD" "$DL_FILE" "$INDEX"; then
    echo "ERROR: PII guard flagged issues — fix before committing" >&2; exit 2
  fi
  echo "→ PII guard: clean"
else
  echo "WARN: PII guard not found at $PII_GUARD — skipping"
fi

# Stage only the two changed files
git add "$DL_FILE" "$INDEX"
echo "→ Staged: $(basename "$DL_FILE") + INDEX.md"

# Extract one-line summary from DL file (second heading line or first pipe-table description)
SUMMARY="$(grep -m1 '^\| '"$NUM"' \|' "$INDEX" | awk -F'|' '{print $4}' | sed 's/^ *//;s/ *$//' | cut -c1-50 || echo "close DL-$NUM")"
echo ""
echo "Suggested commit:"
echo "  git commit -m \"docs(dl-$NUM): close DL-$NUM — ${SUMMARY}\""
