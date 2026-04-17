# 02 — Trim SSOT Blank Lines

**Status:** PENDING
**Tier:** 🟢 Trivial
**Est. effort:** 5 min
**Branch:** `refactor/trim-ssot-blank-lines`

## Context
`SSOT_required_documents_from_Tally_input.md` has 885 lines of which ~300 are blank — many as runs of 3–6 consecutive blank lines. Collapsing runs to a single blank line cuts ~300 lines (~2k tokens) with zero content loss.

## Files touched
- `SSOT_required_documents_from_Tally_input.md` — currently 885 LOC; target ~585 LOC

## Steps
1. Read current file to confirm no intentional multi-blank formatting (e.g., section separators using 3+ blanks).
2. Run collapse:
   ```bash
   # Collapse 2+ consecutive blank lines to one
   perl -i -0pe 's/\n{3,}/\n\n/g' SSOT_required_documents_from_Tally_input.md
   ```
   (Or equivalent sed/awk — verify on Windows Git Bash that perl is available first; fallback is a small Node script.)
3. Verify line count dropped and content is intact: `wc -l SSOT_required_documents_from_Tally_input.md`
4. `git add SSOT_required_documents_from_Tally_input.md && git commit -m "chore(ssot): collapse excess blank lines (~300 lines removed)"`

## Quality exit criteria
- `grep -c '^$' SSOT_required_documents_from_Tally_input.md` drops from ~300 to ≤100.
- No two consecutive blank lines remain: `grep -Pzo '\n\n\n' SSOT_required_documents_from_Tally_input.md` returns empty.
- All document names and field values present: spot-check 5 random entries before and after.

## Verification
- Diff the before/after: `git diff HEAD SSOT_required_documents_from_Tally_input.md | grep '^+' | grep -v '^+++' | wc -l` — should be 0 (only deletions, no new content added).
- No downstream scripts parse this file directly (it's LLM context only) — confirm with `git grep 'SSOT_required_documents'`.

## Rollback
```bash
git revert HEAD
```

## Token savings
- Per-session: ~2k tokens
- Per-edit (when LLM loads this file): ~2k tokens
