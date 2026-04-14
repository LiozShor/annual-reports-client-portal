# Design Log 268: AI Review Tab — Paginate by Client + FIFO Sort
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-14
**Related Logs:** DL-256 (table pagination utility)

## 1. Context & Problem
The AI review tab paginates by **documents** (flat array) but displays **client accordion groups**. The pagination bar says "מציג 1-50 מתוך 55" counting documents, while the user sees 9 client rows. The units don't match, causing confusion.

Additionally, items were sorted newest-first (`received_at DESC` from API). User wants FIFO — oldest-waiting clients first.

## 2. User Requirements
1. **Q:** Should pagination count clients or documents?
   **A:** Clients (accordion rows) — matches the visible unit.
2. **Q:** Should a client's documents ever be split across pages?
   **A:** Never — each client group stays whole on one page.
3. **Q:** How many clients per page?
   **A:** 25 (smaller than the 50 used by other tabs, since accordion rows are heavier).
4. **Q:** Sort order?
   **A:** FIFO — oldest-waiting client first.

## 3. Research
### Domain
Table Pagination UX — Grouped/Accordion Lists

### Sources Consulted
1. **NN/G "Users' Pagination Preferences"** — count labels must match the unit the user navigates
2. **ui-grid GitHub #6993** — documents the exact bug: paginating by child rows while grouping by parent causes inconsistent counts
3. **Carbon/PatternFly Design System** — accordion pagination: controls outside the list, preserve expand state across pages

### Research Verdict
Paginate by client groups. "Showing X of Y" label counts groups, not documents. Show document/client totals in the summary bar (separate from pagination).

## 4. Codebase Analysis
* **Existing:** DL-256 built shared `renderPagination()` utility and wired AI review to paginate by flat document count
* **`applyAIFilters()`** (script.js:3175): filters → slices flat array → `renderAICards()` which groups by client internally
* **`renderAICards()`** (script.js:3301): groups items by `client_name`, renders accordion per group
* **API:** `received_at` field available on every item — used for FIFO sort client-side

## 5. Technical Constraints & Risks
* Summary bar must reflect totals across ALL pages, not just current page
* Accordion expand state preserved across re-renders (already implemented)
* No backend changes needed — `received_at` already returned

## 6. Proposed Solution

### Logic Flow
1. Filter flat `_filteredAI` array (unchanged)
2. Group by `client_name` into `Map`
3. Sort groups FIFO by earliest `received_at` ascending
4. Paginate groups at `AI_PAGE_SIZE = 25`
5. Flatten page slice → pass to `renderAICards(pageItems, allFilteredItems)`
6. `renderPagination()` counts total groups, not documents

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add `AI_PAGE_SIZE = 25`; rewrite `applyAIFilters` to group→sort→paginate by client; update `renderAICards` signature to accept `allFilteredItems` for summary bar totals |

## 7. Validation Plan
* [ ] Pagination says "מציג 1-25 מתוך N" where N = number of clients
* [ ] Clients ordered oldest-waiting first (FIFO)
* [ ] Click page 2 → shows next 25 clients
* [ ] Filter by confidence/type → resets to page 1, counts update
* [ ] Search by name → pagination updates correctly
* [ ] Summary bar shows total doc/client counts across all pages
* [ ] Expanding accordion, navigating pages, coming back → state preserved

## 8. Implementation Notes
- Added `AI_PAGE_SIZE = 25` at line 37
- `applyAIFilters`: groups by client via `Map`, sorts by `Math.min(...received_at)` ascending, paginates group entries, flattens page slice
- `renderAICards` now accepts optional `allFilteredItems` parameter; summary bar uses it for cross-page totals
- No changes to `renderPagination` utility — it's generic enough to work with any unit count
