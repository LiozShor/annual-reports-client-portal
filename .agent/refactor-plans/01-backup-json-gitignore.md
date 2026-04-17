# 01 — Delete wf05 Backup JSON + gitignore

**Status:** PENDING
**Tier:** 🟢 Trivial
**Est. effort:** 5 min
**Branch:** `refactor/backup-json-gitignore`

## Context
`docs/wf05-backup-pre-migration-2026-03-26.json` is a one-time migration snapshot (~290 KB) that inflates every LLM context load by ~116k tokens. Done means the file is removed from git history tip, `.gitignore` blocks future backup JSONs, and no code references it.

## Files touched
- `docs/wf05-backup-pre-migration-2026-03-26.json` — delete (~290 KB, ~116k tokens)
- `.gitignore` — add two patterns

## Steps
1. Verify no code references the file: `git grep -r 'wf05-backup' -- . ':(exclude).git'` — must return zero hits before proceeding.
2. `git rm docs/wf05-backup-pre-migration-2026-03-26.json`
3. Add to `.gitignore`:
   ```
   # Workflow backup snapshots — never commit
   docs/*backup*.json
   docs/wf*-backup*.json
   ```
4. `git add .gitignore && git commit -m "chore(gitignore): rm wf05 backup JSON + block future backup JSONs"`

## Quality exit criteria
- `git ls-files docs/ | grep backup` returns empty.
- `git grep 'wf05-backup'` returns zero matches.
- `.gitignore` contains both new patterns.
- `git status` clean after commit.

## Verification
- `git grep -r 'wf05-backup'` — zero results.
- `ls docs/*.json` — no backup files present.
- No automated tests reference this file; no Worker endpoints reference it.

## Rollback
```bash
git revert HEAD
```
(restores the file and removes the .gitignore lines in one commit)

## Token savings
- Per-session: ~116k tokens (file removed from repo entirely)
- Per-edit (when LLM loads docs/ area): ~116k tokens
