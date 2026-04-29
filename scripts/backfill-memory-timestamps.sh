#!/usr/bin/env bash
# backfill-memory-timestamps.sh
# One-shot script to add created: and last_validated: frontmatter to memory files.
# Safe to re-run — skips files that already have both fields.

set -euo pipefail

MEMORY_DIR="C:/Users/liozm/.claude/projects/C--Users-liozm-Desktop-moshe-annual-reports/memory"
TODAY="2026-04-29"

processed=0
skipped=0
already_done=0

for filepath in "$MEMORY_DIR"/*.md; do
  filename="$(basename "$filepath")"

  # Skip the index file (no frontmatter)
  if [[ "$filename" == "MEMORY.md" ]]; then
    echo "SKIP (index): $filename"
    ((skipped++)) || true
    continue
  fi

  # Check if file starts with frontmatter
  first_line="$(head -1 "$filepath")"
  if [[ "$first_line" != "---" ]]; then
    echo "SKIP (no frontmatter): $filename"
    ((skipped++)) || true
    continue
  fi

  # Check if both fields already present
  has_created=$(grep -c "^created:" "$filepath" || true)
  has_validated=$(grep -c "^last_validated:" "$filepath" || true)

  if [[ "$has_created" -gt 0 && "$has_validated" -gt 0 ]]; then
    echo "OK (already has both): $filename"
    ((already_done++)) || true
    continue
  fi

  # Get file modification time as proxy for created date (YYYY-MM-DD)
  # stat -c %y gives "YYYY-MM-DD HH:MM:SS.ns +OFFSET"
  mtime_raw=$(stat -c %y "$filepath" 2>/dev/null || echo "$TODAY 00:00:00")
  created_date="${mtime_raw:0:10}"

  # Use Python for safe in-place edit (avoids sed quoting issues on Windows/Git Bash)
  python3 - "$filepath" "$created_date" "$TODAY" "$has_created" "$has_validated" <<'PYEOF'
import sys

filepath = sys.argv[1]
created_date = sys.argv[2]
today = sys.argv[3]
has_created = int(sys.argv[4])
has_validated = int(sys.argv[5])

with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the closing --- of the frontmatter (second occurrence of ---)
fm_close_idx = None
for i, line in enumerate(lines):
    if i == 0:
        continue  # skip opening ---
    if line.strip() == '---':
        fm_close_idx = i
        break

if fm_close_idx is None:
    print(f"  WARNING: could not find closing --- in {filepath}, skipping", file=sys.stderr)
    sys.exit(0)

# Collect lines to insert before the closing ---
inserts = []
if has_created == 0:
    inserts.append(f'created: {created_date}\n')
if has_validated == 0:
    inserts.append(f'last_validated: {today}\n')

new_lines = lines[:fm_close_idx] + inserts + lines[fm_close_idx:]

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
PYEOF

  echo "UPDATED: $filename  (created=$created_date, last_validated=$TODAY)"
  ((processed++)) || true
done

echo ""
echo "Summary: $processed updated, $already_done already complete, $skipped skipped"
