# DL-216: Filing Type Scoping Across All Admin Tabs

**Created:** 2026-03-29
**Status:** IMPLEMENTED
**Category:** admin-ui

## Problem

DL-166 added AR/CS entity tabs with client-side filtering on the Dashboard tab only. All other functional tabs (Questionnaires, Ready/Send, AI Review, Reminders, Review Queue) ignored the active entity tab and showed combined AR+CS data.

## Solution

### Backend — 4 routes modified

1. **`api/src/routes/pending.ts`** — Added `filing_type` query param, filters directly in Airtable `AND()` formula.

2. **`api/src/routes/reminders.ts`** — Added `filing_type` from POST body. Converted static `REMINDER_FILTER` constant to `buildReminderFilter(filingType)` function. Added `filing_type` to `REMINDER_FIELDS` array.

3. **`api/src/routes/questionnaires.ts`** — Added `filing_type` query param. Fetches `filing_type` from linked report records during batch-fetch step. Filters questionnaires post-fetch by matching filing type.

4. **`api/src/routes/classifications.ts`** — Added `filing_type` query param. Fetches `filing_type` during existing report batch-lookup (Step 3). Filters `deduped` → `filteredByType` before building items array.

### Frontend — `admin/js/script.js`

5. **Pass `filing_type` in all API calls:**
   - `loadPendingClients()` — `&filing_type=${activeEntityTab}` in URL
   - `loadQuestionnaires()` — `&filing_type=${activeEntityTab}` in URL (both call sites)
   - `loadAIClassifications()` — `?filing_type=${activeEntityTab}` in URL
   - `loadReminders()` — `filing_type: activeEntityTab` in POST body
   - `loadAIReviewCount()` — `?filing_type=${activeEntityTab}` in URL

6. **Cache invalidation on entity tab switch** — `switchEntityTab()` resets all `*Loaded` flags and reloads the currently active functional tab (detected via `.tab-content.active`).

7. **Review Queue filtering** — Extracted `updateReviewQueueUI()` function that filters `reviewQueueData` by `activeEntityTab` before rendering badges and table. Called on dashboard load and entity tab switch. Export also filtered.

8. **Sync filing type dropdowns** — `manualFilingType` and `importFilingType` dropdowns set to match active entity tab.

9. **Mobile navbar entity toggle** — Added compact `שנתיים / הון` toggle in the navbar (between logo and רענן button), visible only on mobile via `@media (max-width: 768px)`. Allows switching entity type from any tab.

## Commits

- `feat(DL-216): add filing_type filtering to all admin endpoints` (backend, 4 routes)
- `feat(DL-216): pass filing_type to all admin tab API calls + cache invalidation on entity tab switch` (frontend)
- `fix(DL-216): filter review queue (מוכנים להכנה) by active entity tab`
- `fix(DL-216): detect active tab correctly on entity switch — use .tab-content.active instead of .tab-btn`
- `feat(DL-216): add mobile entity toggle in navbar — visible on all tabs`

## Files Changed

| File | Action |
|------|--------|
| `api/src/routes/pending.ts` | Add `filing_type` query param + Airtable filter |
| `api/src/routes/reminders.ts` | Add `filing_type` from body + dynamic filter function |
| `api/src/routes/questionnaires.ts` | Add `filing_type` query param + post-fetch filter |
| `api/src/routes/classifications.ts` | Add `filing_type` query param + report-join filter |
| `admin/js/script.js` | Pass filing_type in 5+ API calls, cache invalidation, review queue filter, mobile toggle sync |
| `admin/index.html` | Add `.entity-toggle-navbar` in header |
| `admin/css/style.css` | Add `.entity-toggle-navbar` + `.entity-nav-btn` styles (mobile only) |
