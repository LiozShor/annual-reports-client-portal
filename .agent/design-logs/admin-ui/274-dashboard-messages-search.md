# Design Log 274: Dashboard Messages — Search Bar
**Status:** [COMPLETED]
**Date:** 2026-04-15
**Related Logs:** DL-272 (load more + sort fix), DL-261 (recent messages panel)

## 1. Context & Problem
Office users wanted to search across ALL historical client messages (all years), not just the current year shown in the dashboard messages panel.

## 2. User Requirements
1. Search matches client name + message text
2. Replace list with search results (clear to restore)
3. Load more pattern on search results (10 at a time)
4. Debounced as-you-type (300ms)
5. X button to clear search
6. Loading indicator during first fetch

## 3. Research
Domain: Search UX, Client-Side Filtering, Progressive Disclosure
- NNGroup: "Load more" outperforms infinite scroll for goal-directed tasks
- Debounce pattern: 300ms for API calls (vs 150ms for client-side)
- Fetch-once pattern: single API call, then instant client-side filtering

## 6. Proposed Solution
### Approach: Fetch-once, filter client-side
- API: `?q=_all` returns ALL messages across all years, cached in KV for 30 min
- Frontend: First search keystroke fetches all messages into `_searchCache`
- Subsequent keystrokes filter instantly from `_searchCache` — no API calls
- Spinner + "מחפש..." shown during initial fetch
- X clear button restores normal recent messages view

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/dashboard.ts` | Modify | Add `?q=` param, cross-year query, 30-min KV cache |
| `frontend/admin/index.html` | Modify | Add search input + clear button in panel header |
| `frontend/admin/js/script.js` | Modify | `searchMessages()` with fetch-once + client-side filter |
| `frontend/admin/css/style.css` | Modify | `.msg-search-wrap`, `.msg-search-input`, `.msg-search-clear` |

## 7. Validation Plan
* [x] Search input visible in panel header
* [x] Typing shows spinner on first search, then instant results
* [x] Results match client name + message text
* [x] Load more works on search results
* [x] X button clears search and restores recent messages
* [x] Delete/reply work on search results
* [x] No regression on normal message display

## 8. Implementation Notes
* Variable name bug: `filterFormula` vs `filterByFormula` caused 500 error — fixed immediately.
* Performance optimization: moved from per-keystroke API calls to fetch-once + client-side filtering after user reported slowness.
