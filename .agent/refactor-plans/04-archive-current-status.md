# 04 — Archive `.agent/current-status.md` Old Sections

**Status:** PENDING
**Tier:** 🟡 Easy-Medium
**Est. effort:** 30 min
**Branch:** `refactor/archive-current-status`

## Context
`.agent/current-status.md` is 1,810 lines with 69 `##` sections spanning months. Only the last ~6 weeks of active items need to be in context on every session. Splitting old sections into monthly archive files cuts ~25k tokens per session — the largest single-session saving in this plan set. Done means current-status.md is ≤200 lines of active items, monthly archives exist, and the union-merge `.gitattributes` driver is preserved.

## Files touched
- `.agent/current-status.md` — 1,810 LOC → target ≤200 LOC
- `.agent/status-archive/2026-01.md` — new file
- `.agent/status-archive/2026-02.md` — new file
- `.agent/status-archive/2026-03.md` — new file (partial — sections older than 2026-03-05 only)
- `.gitattributes` — verify union-merge driver still covers `current-status.md`; update path if needed

## Steps
1. Read `.gitattributes` and note the exact merge driver configuration for `current-status.md`. Do not change it.
2. Read `current-status.md` and identify the cutoff: sections with dates before 2026-03-05 (6 weeks before today 2026-04-17) are archivable.
3. `mkdir -p .agent/status-archive`
4. For each archivable month's sections: create (or append to) `.agent/status-archive/YYYY-MM.md` with those sections, preserving the original `##` headings and content verbatim.
5. Remove archived sections from `current-status.md`, leaving only sections from 2026-03-05 onward plus a header block that links to the archive:
   ```markdown
   # Current Status
   > Archived sections: [status-archive/](status-archive/)
   > This file: active items only (last ~6 weeks). Updated continuously.
   ```
6. `git add -A && git commit -m "chore(status): archive current-status sections pre-2026-03-05 (~1600 lines)"`

## Quality exit criteria
- `wc -l .agent/current-status.md` ≤ 200.
- `wc -l .agent/status-archive/2026-01.md .agent/status-archive/2026-02.md` together account for the moved lines (within ±5 for header overhead).
- `cat .agent/status-archive/2026-01.md .agent/status-archive/2026-02.md .agent/status-archive/2026-03.md current-status.md | wc -l` ≈ original 1,810 (content not lost).
- `.gitattributes` still has union-merge driver pointing at `current-status.md`.

## Verification
- Open a new Claude Code session; confirm `current-status.md` loads in <5 seconds and shows only recent items.
- `git log --oneline -3` — confirm only one commit added by this plan.
- Spot-check: pick one archived section and confirm it appears verbatim in the correct archive file.
- Confirm `.gitattributes` is unchanged: `git diff HEAD~1 .gitattributes` returns empty.

## Rollback
```bash
git revert HEAD
```

## Token savings
- Per-session: ~25k tokens (largest per-session saving across all plans)
- Per-edit (when LLM loads .agent/ area): ~25k tokens
