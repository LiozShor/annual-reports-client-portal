# 09 — Split `frontend/admin/js/script.js`

**Status:** PENDING
**Tier:** 🔴 Hardest
**Est. effort:** 6–10 hr across multiple sessions
**Branch:** `refactor/split-admin-script`

## Context
`frontend/admin/js/script.js` is 10,310 LOC, 43 section banners, 317 top-level closers — "the devil file" per CLAUDE.md memory. This is the highest-risk plan: a broken admin panel blocks the office. The approach is strictly incremental: one section per commit, verify after each before moving on. The quality pass runs per section, not as a single upfront pass. Done means a full Playwright suite passes on all admin flows.

**Pre-requisite:** Plan 10 (quality audit) findings must be available before starting Phase 2.

## Target Module Map

### Loads first (shared state — no dependencies)
- `frontend/admin/js/shared-state.js` — `FILING_TYPE_LABELS`, `SORT_CONFIG`, `currentSort`, `REJECTION_REASONS`, `RELATED_TEMPLATES`, `paCompanyLinks`, `QA_SORT_CONFIG`, `TAB_DROPDOWN_TABS`, and all other module-level constants/vars

### Auth + navigation
- `auth.js` — L.135–290
- `tabs.js` — L.291–357
- `mobile-nav.js` — L.358–448
- `mobile-preview.js` — L.449–692

### Dashboard (split further — 901 LOC)
- `dashboard-render.js` — row rendering, column formatters
- `dashboard-filters.js` — filter bar, search, sort
- `dashboard-actions.js` — row click handlers, bulk select

### UI components
- `sorting.js`
- `floating-positioning.js`
- `stage-dropdown.js` — L.1681–2038
- `docs-popover.js`
- `reminder-history.js`
- `copy-clipboard.js`
- `background-refresh.js`

### Import + client management
- `import.js` — L.2330–2601
- `existing-client-banner.js`
- `send-questionnaires.js` — L.2705–2960

### Review workflows
- `review-queue.js`
- `doc-search-combobox.js`

### AI review (split further — 2,263 LOC, L.3423–5685)
- `ai-review-render.js` — DOM builders for AI review panel
- `ai-review-preview.js` — document preview / lightbox integration
- `ai-review-actions.js` — approve/reject/skip actions
- `ai-review-rejection.js` — rejection reason picker + DL-292 review-approve-queue

### Q&A + notes
- `review-approve-queue.js` — DL-292
- `qa-section.js`
- `notes.js`
- `questions-for-client.js` — L.6096–6562, 467 LOC

### Settings + tools
- `manual-issuer-edit.js` — DL-299
- `bookkeepers-notes.js`
- `questionnaire-print.js`

### Reminders (split further — 923 LOC, L.6883–7805)
- `reminders-list.js`
- `reminders-send.js`
- `reminders-settings.js`

### Misc
- `reminder-inline-edit.js`
- `report-notes.js`
- `deactivate-archive.js`
- `client-detail-modal.js`
- `row-menu.js`
- `bulk-actions.js`
- `utilities.js`
- `inline-confirm.js`
- `confirm-dialog.js`
- `year-dropdowns.js`
- `year-rollover.js`
- `questionnaires-tab.js`
- `pdf-split-modal.js` — DL-237
- `page-preview-lightbox.js` — DL-246

### Entry point
- `init.js` — DOMContentLoaded handler, loads last

## Files touched
- `frontend/admin/js/script.js` — 10,310 LOC (becomes `@import`-equivalent loader or minimal bootstrap)
- `frontend/admin/js/modules/` — new directory containing all target files above
- `frontend/admin/index.html` — update `<script>` tags

## Steps

### Phase 1 — Quality pass (per-section, interleaved with Phase 2)
Before extracting each section:
1. **Dead-code removal:** remove commented-out blocks >3 lines from that section.
2. **Inline-handler migration:** inventory `onclick=` etc. in `index.html` for that section's functions. Migrate to `addEventListener` + `data-action` where feasible. Document remaining `window.X`.
3. **Function-size cap:** split any function >150 LOC within the section.
4. **Global-state audit:** flag every `window.X = ` assignment; document or remove.
5. **Dedup check:** `sort <section-lines> | uniq -c | sort -rn | head -20` — collapse genuine duplicates.

### Phase 2 — Extract (strictly one section per commit)
6. Create `frontend/admin/js/modules/`.
7. Extract `shared-state.js` first. Add `<script>` tag to `index.html`. Load admin panel — confirm globals available. Commit.
8. Extract next section per module map. Quality pass first. Commit. Verify. Repeat.
9. For the three large splits (dashboard ~901 LOC, AI review ~2,263 LOC, reminders ~923 LOC): split into sub-files before or during extraction — never commit a module >300 LOC.
10. Update `index.html` `<script>` tags incrementally as each module is added.
11. `script.js` shrinks by one section per commit. When empty, replace with a `// All modules loaded via index.html` comment or remove entirely.
12. Final commit: `refactor(script): complete split into modules/ directory`.

## Quality exit criteria
- No module file exceeds 300 LOC. Preferred target: ≤150 LOC.
- `grep -rn 'window\.' frontend/admin/js/modules/ | wc -l` drops vs original; all remaining `window.X` are in `.agent/refactor-plans/admin-window-globals.md` with justifications.
- Zero commented-out code blocks >3 lines in any new module.
- `shared-state.js` is the only file with module-level mutable state — all others import from it or from `dm/state.js`.
- `grep -rEn '^(async )?function [a-zA-Z_]+' frontend/admin/js/modules/ | awk -F: '{print $NF}' | sort | uniq -c | sort -rn | head -10` — no function name appears in more than one module file.
- Browser console zero errors/warnings on admin panel load.

## Verification

Per-section (after each commit):
- Load admin panel in browser.
- Exercise the extracted section's primary flows.
- Check browser console — zero errors.

Final full suite (Playwright):
1. Login flow
2. Dashboard load, filter, sort
3. Stage change (stage-dropdown)
4. Review queue — approve and reject
5. AI review — render, preview, approve, reject with reason
6. Reminder send (from reminders tab)
7. PDF split modal (DL-237)
8. Q&A edit and save
9. Client detail modal open/edit
10. Bulk actions (select multiple, batch status)
11. Import flow (new client)
12. Questionnaire print preview

All flows must complete without console errors and with correct Airtable data updates confirmed.

## Rollback
Per commit: `git revert HEAD`

Full rollback to pre-split state:
```bash
git revert HEAD~N..HEAD
git rm -r frontend/admin/js/modules/
git checkout main -- frontend/admin/js/script.js frontend/admin/index.html
git commit -m "revert: admin script.js split"
```

## Token savings
- Per-session: ~60k tokens (script.js not loaded for non-admin tasks; per-module load for targeted edits)
- Per-edit (when LLM edits one module): ~60k tokens saved vs loading the full 10,310-LOC monolith
