# DL-301: PA Queue Search Bar

**Status:** IMPLEMENTED — NEED TESTING
**Branch:** `DL-301-admin-panel-search-bar`
**Date:** 2026-04-18

## Summary

Added client-side search input to the Pending Approval queue filter bar. Matches on client name, email, and spouse name. Follows the exact `filterQuestionnaires` / `filterReminders` debounce pattern already in use.

## Files Changed

- `frontend/admin/index.html` — added third `.filter-group` with `#paSearchInput` + `#paSearchClear` button inside the PA `.ai-filter-bar`
- `frontend/admin/js/script.js`:
  - Added `let _paFilteredData = []` state variable (alongside PA state block)
  - Added `const debouncedFilterPendingApproval = debounce(filterPendingApproval, 150)` (alongside other debounced filters)
  - `loadPendingApprovalQueue`: calls `filterPendingApproval(true)` instead of `renderPendingApprovalCards()` after data loads
  - `renderPendingApprovalCards`: iterates `_paFilteredData` instead of `pendingApprovalData`; empty-state gated on `pendingApprovalData.length === 0` (real empty) vs `_paFilteredData.length === 0` (no search match)
  - Added `filterPendingApproval(keepPage)` — populates `_paFilteredData`, toggles clear button, resets `_paPage` unless `keepPage`
  - Added `clearPaSearch()` — clears input and re-runs filter

## Design Decisions

- **Spouse name search:** included because Natan often searches by the non-primary member of a couple; already present in `pendingApprovalData` at no extra cost.
- **No-results vs truly-empty state:** `paEmptyState` ("כל השאלונים נסקרו") only shows when `pendingApprovalData.length === 0`; a search with no matches shows a plain "לא נמצאו תוצאות לחיפוש" paragraph instead.
- **Server filters compose correctly:** `paYearFilter` + `paFilingTypeFilter` trigger `loadPendingApprovalQueue(false)` → re-fetch → `filterPendingApproval(true)` re-applies any active search term to the new data.

## Verification Checklist

- [ ] Filter bar shows three controls: year, filing-type, search input
- [ ] Typing a partial name filters cards instantly, pagination resets to page 1
- [ ] Typing a partial email (e.g. `@gmail`) filters correctly
- [ ] Typing a spouse name shows the couple's card
- [ ] Clear-X appears when input has text; clicking resets to full list
- [ ] Changing year/filing-type while search is active: API re-fetches, search persists, filter re-applies
- [ ] No-match state shows "לא נמצאו תוצאות לחיפוש" — NOT the "כל השאלונים נסקרו" empty state
- [ ] Mobile viewport: filter bar wraps gracefully
- [ ] No console errors; paYearFilter / paFilingTypeFilter still work normally
