# 10 — Cross-Cutting Quality Audit

**Status:** PENDING
**Tier:** 🟠 Medium
**Est. effort:** 2–3 hr (read-only — no code changes)
**Branch:** `refactor/quality-audit`

## Context
Plans 08 and 09 each require a quality pass before restructuring. This plan runs the audit repo-wide and produces `.agent/refactor-plans/audit-findings.md` — a ranked kill-list that both plans consume. Since it makes no code changes, it can run in parallel with plans 03 or 04 to get findings ready before the hard plans start. Done means `audit-findings.md` exists and contains ranked, actionable findings for each category below.

## Files touched (read-only)
- `frontend/admin/js/script.js`
- `frontend/assets/js/document-manager.js`
- `frontend/admin/index.html`
- `frontend/assets/document-manager.html`
- All `frontend/**/*.js` and `frontend/**/*.html`
- `api/src/**/*.ts` (secondary pass)
- Output: `.agent/refactor-plans/audit-findings.md` (new file)

## Steps

### 1. Dead code scan
```bash
git grep -n '^\s*//' frontend/ api/ \
  | grep -vE '// (TODO|FIXME|NOTE|DL-|@|eslint|prettier)' \
  > /tmp/dead-code-candidates.txt
wc -l /tmp/dead-code-candidates.txt
```
Group by file, rank by count. Flag any file with 5+ contiguous commented lines as a removal candidate.

### 2. Inline handler inventory
```bash
grep -rEn '(onclick|onchange|oninput|onblur|onfocus|onsubmit)=' \
  frontend/admin/index.html frontend/assets/document-manager.html
```
Count per file. For each handler: note the target function name and whether it's a `window.X` call. This is the migration candidates list for plans 08 and 09.

### 3. Global `window.X` sprawl
```bash
grep -rEn '^\s*window\.[a-zA-Z_]+ = ' frontend/
```
List every assignment. Flag any where the function is only called from one location (candidate for direct reference instead of global). Flag any where the name collides with a browser built-in.

### 4. Duplicate function names
```bash
grep -rEn '^(async )?function [a-zA-Z_]+' frontend/ \
  | awk -F'function ' '{print $2}' | awk '{print $1}' \
  | sort | uniq -c | sort -rn | head -40
```
Any function name appearing 2+ times is a smell — likely copy-paste duplication. Document each with file + line.

### 5. Mega-function finder
Write a small Node script (`.agent/refactor-plans/find-mega-functions.js`):
```js
const fs = require('fs');
const path = require('path');
// Walk frontend/**/*.js, count lines between function declarations and matching closing brace
// Print any function with >150 LOC: filename, function name, start line, LOC
```
Run: `node .agent/refactor-plans/find-mega-functions.js`
Output to `audit-findings.md` Section 5.

### 6. Unused `window.X` exports
Cross-reference `window.X` assignments (Step 3) against all HTML inline handlers (Step 2) and all `window.X` call sites in other JS files. Flag any assigned but never called.

### 7. Mixed-concern files
For each JS file: count the number of distinct concern types present (API `fetch()` calls, DOM manipulation, business logic transformations, state management). Flag any file that mixes 3+ concerns with no clear separation.

## Output format for `audit-findings.md`

```markdown
# Quality Audit Findings — 2026-04-17

## 1. Dead Code (commented-out blocks)
| File | Count | Worst offender (line range) |
...

## 2. Inline Handlers
| File | Count | Migration-ready | Requires window.X |
...

## 3. window.X Globals
| Name | File | Line | Used from | Removable? |
...

## 4. Duplicate Function Names
| Name | Files | Lines | Verdict |
...

## 5. Mega-Functions (>150 LOC)
| File | Function | Start | LOC | Plan |
...

## 6. Unused window.X Exports
| Name | Assigned at | Called at |
...

## 7. Mixed-Concern Files
| File | Concerns present | Severity |
...

## Summary / Priority for plans 08+09
Top 10 items by impact, with recommended action and target plan.
```

## Quality exit criteria
- `audit-findings.md` exists at `.agent/refactor-plans/audit-findings.md`.
- All 7 sections populated with real data (not placeholders).
- Section 5 Node script exists and is runnable: `node .agent/refactor-plans/find-mega-functions.js` produces output.
- Summary section has ≥10 ranked action items.

## Verification
- This plan makes no code changes — verification is that the output file is complete and findings are reproducible.
- Spot-check: pick 3 "dead code" candidates from Section 1 and manually verify they are indeed commented-out dead code (not active code with a comment prefix).
- Confirm findings in Section 4 (duplicate functions) by opening the flagged files at the listed lines.

## Rollback
```bash
git rm .agent/refactor-plans/audit-findings.md .agent/refactor-plans/find-mega-functions.js
git commit -m "revert: quality audit findings"
```
(This plan adds only new files — no existing files modified.)

## Token savings
- Per-session: 0 direct savings (audit only)
- Indirect: findings enable 08+09 quality passes to target the highest-impact dead code, preventing those plans from enshrining bad patterns into the new module structure
