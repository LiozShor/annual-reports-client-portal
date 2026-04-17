# 05 — Split `api/src/lib/email-html.ts`

**Status:** PENDING
**Tier:** 🟡 Medium
**Est. effort:** 1–2 hr
**Branch:** `refactor/split-email-html`

## Context
`api/src/lib/email-html.ts` is a 728-LOC monolith mixing HTML template strings for three distinct email types (batch status, reminder, welcome) plus the shared bilingual card CSS (DL-076). Splitting it into a `email/` subfolder with one file per template makes each file independently loadable and removes the shared CSS from every email edit context. Done means `tsc --noEmit` passes and one live email per type has been sent successfully.

## Files touched
- `api/src/lib/email-html.ts` — 728 LOC (becomes thin re-export barrel)
- `api/src/lib/email/batch-status.ts` — new (~200 LOC est.)
- `api/src/lib/email/reminder.ts` — new (~150 LOC est.)
- `api/src/lib/email/welcome.ts` — new (~100 LOC est.)
- `api/src/lib/email/card-styles.ts` — new, shared DL-076 bilingual card CSS constants (~80 LOC est.)
- `api/src/lib/email/index.ts` — barrel re-export

## Steps
1. Read `email-html.ts` in full. Map every exported symbol to its email type.
2. Create `api/src/lib/email/` directory.
3. Extract shared CSS constants (bilingual card, base table styles) into `card-styles.ts`. No logic — pure string constants only.
4. Extract batch-status template function(s) → `batch-status.ts`. Import from `card-styles.ts`.
5. Extract reminder template function(s) → `reminder.ts`. Import from `card-styles.ts`.
6. Extract welcome template function(s) → `welcome.ts`. Import from `card-styles.ts`.
7. Write `index.ts` barrel: re-export everything from the four new files.
8. Replace `email-html.ts` body with `export * from './email/index'`.
9. `./node_modules/.bin/tsc --noEmit` — must pass with zero errors.
10. Commit: `refactor(email-html): split into email/ subfolder with per-type files`.

## Quality exit criteria
- No exported HTML template literal exceeds 100 lines.
- `card-styles.ts` is the only file containing the bilingual card CSS string — `grep -rn 'dir="rtl"' api/src/lib/email/` returns hits in `card-styles.ts` only.
- `email-html.ts` is ≤10 LOC (barrel only).
- `./node_modules/.bin/tsc --noEmit` exits 0.
- Zero duplicate string blocks >5 lines between the new files.

## Verification
- `./node_modules/.bin/tsc --noEmit` — clean.
- `npx wrangler deploy --dry-run` — clean.
- Live test: trigger one batch-status email, one reminder email, one welcome email via admin panel or curl. Inspect rendered HTML in email client (or Mailhog if available).
- Confirm bilingual card renders correctly (EN + HE side by side, `dir` attributes intact) per DL-076 memory.

## Rollback
```bash
git revert HEAD
# email-html.ts barrel still imports from email/ — also revert the split:
git checkout HEAD~1 -- api/src/lib/email-html.ts
git rm -r api/src/lib/email/
git commit -m "revert: email-html split"
```

## Token savings
- Per-session: ~5k tokens (email-html.ts no longer fully loaded on non-email tasks)
- Per-edit (when LLM edits a single email type): ~8k tokens saved vs loading the full 728-LOC monolith
