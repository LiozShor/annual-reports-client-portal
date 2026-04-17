# 03 — Archive Resolved Design Logs

**Status:** PENDING
**Tier:** 🟢 Easy
**Est. effort:** 15 min
**Branch:** `refactor/archive-design-logs`

## Context
Completed design logs that are >60 days old still live in `.agent/design-logs/` and load into context on every session. Moving them to `.agent/design-logs/archive/` removes them from the active scan path while keeping them accessible for reference. Done means INDEX.md is updated and no completed old log remains in the top-level design-logs directory.

## Files touched
- `.agent/design-logs/INDEX.md` — add `## Archived` section, move entries
- `.agent/design-logs/DL-035.md` — candidate (verify status first)
- `.agent/design-logs/DL-046.md` — candidate
- `.agent/design-logs/DL-052.md` — candidate
- `.agent/design-logs/DL-086.md` — candidate
- `.agent/design-logs/DL-093.md` — candidate
- `.agent/design-logs/archive/` — create this directory (add `.gitkeep`)

## Steps
1. Read `.agent/design-logs/INDEX.md` and confirm each candidate is marked `[COMPLETED]` and the completion date is >60 days before today (2026-04-17, so before 2026-02-16).
2. For any candidate NOT confirmed completed/old — skip it; do not move.
3. `mkdir -p .agent/design-logs/archive && touch .agent/design-logs/archive/.gitkeep`
4. For each confirmed candidate: `git mv .agent/design-logs/DL-XXX.md .agent/design-logs/archive/DL-XXX.md`
5. Edit `INDEX.md`: move the matching rows from the active table to a new `## Archived` section at the bottom. Note the archive path.
6. `git add -A && git commit -m "chore(design-logs): archive completed DL-035/046/052/086/093"`

## Quality exit criteria
- `ls .agent/design-logs/*.md | grep -E 'DL-(035|046|052|086|093)'` returns empty.
- `ls .agent/design-logs/archive/` contains all moved files.
- INDEX.md has an `## Archived` section with matching entries.
- No active workflow or Worker code references the archived DL numbers (grep check).

## Verification
- `git grep 'DL-035\|DL-046\|DL-052\|DL-086\|DL-093' -- '*.ts' '*.js' '*.json'` — any hits in code are comments only, not functional references.
- Open INDEX.md, confirm active section looks clean with no dead entries.
- No broken links in remaining active design logs that cross-reference archived ones — do a `grep -r 'DL-035\|DL-046' .agent/design-logs/*.md` to find cross-refs and update them to point to `archive/`.

## Rollback
```bash
git revert HEAD
```

## Token savings
- Per-session: ~5k tokens (5 large DL files removed from active scan path)
- Per-edit (when LLM loads .agent/design-logs/): ~5k tokens
