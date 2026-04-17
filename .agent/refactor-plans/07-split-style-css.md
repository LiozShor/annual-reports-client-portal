# 07 — Split `frontend/admin/css/style.css`

**Status:** PENDING
**Tier:** 🔴 Hard
**Est. effort:** 3–4 hr
**Branch:** `refactor/split-style-css`

## Context
`frontend/admin/css/style.css` is 8,428 LOC with 48 logical sections and 23 `@media` blocks scattered throughout. Every admin panel edit loads the entire file. Splitting into a `css/` subfolder with one file per concern and making `style.css` a thin `@import` manifest reduces per-edit context by ~40k tokens while also enabling targeted cleanup of the duplicated `@media (max-width: 768px)` blocks. Done means Playwright screenshot diffs show no visual change on desktop, 768px, and print views.

**Risk:** CSS cascade is order-sensitive. The `@import` manifest must preserve the exact original cascade order.

## Files touched
- `frontend/admin/css/style.css` — 8,428 LOC (becomes `@import` manifest, ~15 LOC)
- `frontend/admin/css/base.css` — L.1–144 (reset, custom properties, root vars)
- `frontend/admin/css/layout.css` — L.145–275 (grid, flex containers, page structure)
- `frontend/admin/css/tables.css` — L.276–570 (all table/grid styles)
- `frontend/admin/css/stage-dropdown.css` — L.571–695 (stage pill + dropdown)
- `frontend/admin/css/ai-review.css` — L.1573–2726 (largest section, ~1,153 LOC)
- `frontend/admin/css/reminders.css` — L.3359–3802
- `frontend/admin/css/modals.css` — all modal-related rules (extract from scattered locations)
- `frontend/admin/css/dashboard-split.css` — dashboard split-view rules
- `frontend/admin/css/questionnaire.css` — questionnaire tab styles
- `frontend/admin/css/pdf-split-modal.css` — DL-237 PDF split modal (L. per section map)
- `frontend/admin/css/preview-panel.css` — preview panel / lightbox (DL-246)
- `frontend/admin/css/mobile.css` — consolidate all 9 `@media (max-width: 768px)` blocks + mobile-bottom-nav + mobile-preview-modal into one file
- `frontend/admin/css/print.css` — all `@media print` rules

## Steps
1. Read `style.css` in full and confirm the section map matches the line ranges above. Adjust if drift found.
2. **Capture baseline screenshots:** Playwright — admin panel desktop (1280px), mobile (768px), print preview. Save to `.agent/refactor-plans/css-baseline/`.
3. Create `frontend/admin/css/` directory structure (files stay in same dir — `style.css` is already there; new named files go alongside it).
4. Extract sections in order, one file per commit:
   - Commit A: `base.css` extracted, `@import './base.css'` added to manifest.
   - Commit B: `layout.css`, etc.
   - Continue per file. **Never batch two files in one commit.**
5. For `mobile.css`: locate all `@media (max-width: 768px)` blocks throughout the file. Consolidate into a single `mobile.css`. Remove scattered mobile overrides from their current locations. Verify no rules lost.
6. Final `style.css` becomes only `@import` lines in cascade order.
7. Extract duplicate color/spacing values shared across 3+ files → CSS custom properties in `base.css` `(:root { --color-...: ...; })`
8. Remove commented-out rule blocks (blocks where every line starts with `/*` or `//` — not inline comments).
9. Final commit: `refactor(css): split style.css into 14 component files`.

## Quality exit criteria
- `style.css` is ≤20 LOC (only `@import` statements).
- `grep -E '^\.[a-z-]+ \{' frontend/admin/css/*.css | sort | uniq -c | sort -rn | head -20` — no selector repeated across files except intentionally shared ones documented with a comment.
- Stat grid `repeat(9, 1fr)` preserved per CLAUDE.md memory: `grep 'repeat(9' frontend/admin/css/tables.css` returns a hit.
- Zero commented-out rule blocks >3 lines: `grep -c '/\*.*\*/' frontend/admin/css/*.css` drops significantly.
- All 9 `@media (max-width: 768px)` occurrences consolidated — `grep -rn 'max-width: 768px' frontend/admin/css/` returns only `mobile.css`.

## Verification
- Playwright screenshot diff: desktop (1280px), mobile (768px), print — pixel diff vs baseline must be zero (use `pixelmatch` or visual inspection).
- Load admin panel; open each tab (dashboard, review queue, AI review, reminders, questionnaires) and confirm no visual regressions.
- Browser console: zero CSS parsing errors (`console.warn` filter on "CSS").
- `grep 'repeat(9, 1fr)' frontend/admin/css/tables.css` — confirms stat grid intact.
- Live test with real Airtable session (Moshe as CPA-XXX if available) — dashboard renders correctly.

## Rollback
```bash
git revert HEAD~N..HEAD  # N = number of commits in this plan
# Or to revert all at once to before this branch:
git checkout main -- frontend/admin/css/style.css
git rm frontend/admin/css/base.css frontend/admin/css/layout.css  # etc.
git commit -m "revert: css split"
```

## Token savings
- Per-session: ~40k tokens (style.css fully excluded from most non-CSS sessions)
- Per-edit (when LLM edits one CSS section): ~40k tokens saved vs loading the full 8,428-LOC monolith
