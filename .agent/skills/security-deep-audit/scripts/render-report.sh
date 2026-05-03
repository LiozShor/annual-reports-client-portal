#!/usr/bin/env bash
# render-report.sh — turn JSON-lines findings (stdin) into the audit markdown report (stdout).
#
# Usage:
#   cat findings.jsonl | bash render-report.sh > .agent/audits/security-deep-audit-YYYY-MM-DD.md
#
# Input: one finding per line, schema per references/category-checks.md.
# Reads .agent/audits/false-positive-allowlist.yaml (if present) and suppresses matching hashes.
# Reads .agent/skills/security-deep-audit/assets/report-template.md as the skeleton.
#
# Exits:
#   0 = report written
#   1 = template missing or stdin empty
set -uo pipefail

REPO=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not in repo"; exit 1; }
TEMPLATE="$REPO/.agent/skills/security-deep-audit/assets/report-template.md"
ALLOWLIST="$REPO/.agent/audits/false-positive-allowlist.yaml"

[ -f "$TEMPLATE" ] || { echo "missing template: $TEMPLATE"; exit 1; }

INPUT=$(cat)
[ -z "$INPUT" ] && { echo "empty stdin — no findings to render"; exit 1; }

DATE=$(date -u +%Y-%m-%d)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Extract allowlisted hashes if present
SUPPRESSED_HASHES=""
if [ -f "$ALLOWLIST" ]; then
  SUPPRESSED_HASHES=$(grep -E "^\s*-?\s*evidence_hash:" "$ALLOWLIST" 2>/dev/null \
    | sed -E 's/.*evidence_hash:\s*"?([^"]+)"?.*/\1/' \
    | sort -u)
fi

# Filter + count + sort
FILTERED=$(echo "$INPUT" | jq -c --arg sup "$SUPPRESSED_HASHES" '
  . as $f |
  if ($sup | split("\n") | index($f.evidence_hash // "")) then
    {suppressed: true} + $f
  else
    {suppressed: false} + $f
  end
')

# Severity sort key: CRITICAL=0, HIGH=1, MEDIUM=2, LOW=3, INFO=4, CLEAN=5
SORTED=$(echo "$FILTERED" | jq -c '. + {sev_rank: (
  if .severity=="CRITICAL" then 0
  elif .severity=="HIGH" then 1
  elif .severity=="MEDIUM" then 2
  elif .severity=="LOW" then 3
  elif .severity=="INFO" then 4
  else 5 end)}' | jq -s 'sort_by(.sev_rank, .category)' | jq -c '.[]')

# Counts
count_sev() { echo "$SORTED" | jq -s --arg s "$1" '[.[] | select(.severity==$s and .suppressed==false)] | length'; }
CRIT=$(count_sev CRITICAL)
HIGH=$(count_sev HIGH)
MED=$(count_sev MEDIUM)
LOW=$(count_sev LOW)
INFO=$(count_sev INFO)
SUPP=$(echo "$SORTED" | jq -s '[.[] | select(.suppressed==true)] | length')
TOTAL=$((CRIT + HIGH + MED + LOW + INFO))

# Time-bombs (any severity, time_bomb_days <=7)
TIME_BOMBS=$(echo "$SORTED" | jq -s '[.[] | select(.suppressed==false) | select(.time_bomb_days != null and .time_bomb_days <= 7)]')
TIME_BOMBS_COUNT=$(echo "$TIME_BOMBS" | jq 'length')

# Manual UI checks
MANUAL=$(echo "$SORTED" | jq -s '[.[] | select(.suppressed==false) | select(.manual_ui_check==true)]')
MANUAL_COUNT=$(echo "$MANUAL" | jq 'length')

# CLEAN findings → "Already-protected" section
CLEAN=$(echo "$SORTED" | jq -s '[.[] | select(.suppressed==false) | select(.severity=="CLEAN" or .severity=="INFO")]')

# ---------- emit report ----------
cat <<EOF
# Security Deep Audit — $DATE

**Run:** $TS
**Total findings:** $TOTAL ($CRIT CRITICAL, $HIGH HIGH, $MED MEDIUM, $LOW LOW, $INFO INFO, $SUPP suppressed)
**Time-bombs (≤7 days):** $TIME_BOMBS_COUNT
**Manual UI checks needed:** $MANUAL_COUNT

---

## 1. Findings (prioritized)

| # | Sev | Cat | Title | Location | Action | Effort |
|---|---|---|---|---|---|---|
EOF

i=0
echo "$SORTED" | jq -c 'select(.suppressed==false) | select(.severity!="CLEAN" and .severity!="INFO")' | while read -r line; do
  i=$((i + 1))
  sev=$(echo "$line" | jq -r .severity)
  cat=$(echo "$line" | jq -r .category)
  title=$(echo "$line" | jq -r .title)
  loc=$(echo "$line" | jq -r .location)
  act=$(echo "$line" | jq -r .recommended_action)
  eff=$(echo "$line" | jq -r .effort_estimate)
  printf "| %d | %s | %s | %s | \`%s\` | %s | %s |\n" "$i" "$sev" "$cat" "$title" "$loc" "$act" "$eff"
done

echo
echo "---"
echo
echo "## 2. Time-bombs (action required <7 days)"
echo
if [ "$TIME_BOMBS_COUNT" -eq 0 ]; then
  echo "_None detected._"
else
  echo "| Days | Sev | Cat | Title | Action |"
  echo "|---|---|---|---|---|"
  echo "$TIME_BOMBS" | jq -c '.[]' | while read -r line; do
    days=$(echo "$line" | jq -r .time_bomb_days)
    sev=$(echo "$line" | jq -r .severity)
    cat=$(echo "$line" | jq -r .category)
    title=$(echo "$line" | jq -r .title)
    act=$(echo "$line" | jq -r .recommended_action)
    printf "| %s | %s | %s | %s | %s |\n" "$days" "$sev" "$cat" "$title" "$act"
  done
fi

echo
echo "---"
echo
echo "## 3. Manual UI checks needed"
echo
if [ "$MANUAL_COUNT" -eq 0 ]; then
  echo "_All checks were automatable this run._"
else
  echo "$MANUAL" | jq -c '.[]' | while read -r line; do
    title=$(echo "$line" | jq -r .title)
    act=$(echo "$line" | jq -r .recommended_action)
    echo "- [ ] **$title** — $act"
  done
fi

echo
echo "---"
echo
echo "## 4. Already-protected (CLEAN / INFO)"
echo
if [ "$(echo "$CLEAN" | jq 'length')" -eq 0 ]; then
  echo "_No CLEAN/INFO assertions emitted — categories may have failed to report. Investigate._"
else
  echo "| Cat | Assertion |"
  echo "|---|---|"
  echo "$CLEAN" | jq -c '.[]' | while read -r line; do
    cat=$(echo "$line" | jq -r .category)
    title=$(echo "$line" | jq -r .title)
    printf "| %s | %s |\n" "$cat" "$title"
  done
fi

echo
echo "---"
echo
echo "## 5. Suppressed by allowlist"
echo
if [ "$SUPP" -eq 0 ]; then
  echo "_No allowlist entries applied this run._"
else
  echo "| Hash | Cat | Title |"
  echo "|---|---|---|"
  echo "$SORTED" | jq -c 'select(.suppressed==true)' | while read -r line; do
    hash=$(echo "$line" | jq -r .evidence_hash)
    cat=$(echo "$line" | jq -r .category)
    title=$(echo "$line" | jq -r .title)
    printf "| \`%s\` | %s | %s |\n" "$hash" "$cat" "$title"
  done
fi

echo
echo "---"
echo
echo "_Generated by \`/security-deep-audit\`. Read-only — no actions taken._"
echo "_Allowlist: \`.agent/audits/false-positive-allowlist.yaml\` (see \`assets/false-positive-allowlist.example.yaml\`)._"
