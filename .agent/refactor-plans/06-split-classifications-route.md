# 06 — Split `api/src/routes/classifications.ts`

**Status:** PENDING
**Tier:** 🟠 Medium-Hard
**Est. effort:** 2–3 hr
**Branch:** `refactor/split-classifications-route`

## Context
`api/src/routes/classifications.ts` is 1,632 LOC handling three distinct concerns: listing classification runs, executing a new run, and reviewing results. This makes any edit to one handler load the full 1,632-LOC file. Done means each concern lives in its own file, all existing endpoints return identical JSON responses (verified by diff against a captured baseline), and `tsc --noEmit` is clean.

## Files touched
- `api/src/routes/classifications.ts` — 1,632 LOC (becomes thin barrel)
- `api/src/routes/classifications/list.ts` — new
- `api/src/routes/classifications/run.ts` — new
- `api/src/routes/classifications/review.ts` — new
- `api/src/routes/classifications/index.ts` — barrel re-export + router assembly

## Steps
1. Read `classifications.ts` fully. List every route handler and shared helper.
2. **Capture baseline:** for each endpoint, `curl` the live API and save JSON to `.agent/refactor-plans/baseline-classifications/` (create dir). These files are the diff target after refactor.
3. Identify shared helpers (response builders, validators, Airtable query helpers). Extract them to a `_shared.ts` inside the classifications folder.
4. Move list-related handlers → `list.ts`. Import shared helpers.
5. Move run-related handlers → `run.ts`. Import shared helpers.
6. Move review-related handlers → `review.ts`. Import shared helpers.
7. Write `index.ts`: assemble the router from the three handler files; re-export types.
8. Replace `classifications.ts` body with `export * from './classifications/index'` (or direct router re-export, whichever matches how the main router imports it).
9. `./node_modules/.bin/tsc --noEmit` — zero errors.
10. Commit: `refactor(classifications): split 1632-LOC route into list/run/review`.

## Quality exit criteria
- No handler file exceeds 150 LOC. If any does, split further with extracted helpers before shipping.
- No anonymous arrow function assigned to a route handler — give each function a named declaration.
- Zero duplicate response-builder blocks: `grep -n 'return.*json\(' classifications/ | sort | uniq -c | sort -rn` — duplicates collapse to shared helpers.
- `./node_modules/.bin/tsc --noEmit` exits 0.
- `classifications.ts` barrel is ≤10 LOC.

## Verification
- `./node_modules/.bin/tsc --noEmit` — clean.
- `npx wrangler deploy --dry-run` — clean.
- For each baseline JSON file captured in Step 2: re-run the same curl and `diff` against baseline — zero diff on data fields (timestamps/IDs may differ; use `jq 'del(.timestamp)'` normalization).
- Live Airtable test: trigger a classification run from the admin panel; confirm it completes and the review endpoint returns expected data.

## Rollback
```bash
git revert HEAD
```

## Token savings
- Per-session: ~8k tokens (route file no longer fully loaded on non-classification tasks)
- Per-edit (when LLM edits one handler type): ~12k tokens saved vs loading the full 1,632-LOC monolith
