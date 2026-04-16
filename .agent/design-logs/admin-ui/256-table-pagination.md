# Design Log 256: Table Pagination — 50 Rows Per Page
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-12
**Related Logs:** DL-254 (API perf), DL-255 (hide/show + debounce), DL-214 (mobile cards)

## 1. Context & Problem
With 579 clients, rendering ALL rows causes:
- Initial render: 1.5-2.5s (`safeCreateIcons` scanning 2300+ icon placeholders)
- Tab clicks: 852ms-2484ms violations (each stat card click re-renders visible rows + icons)
- Dashboard endpoint timeout (10s too short for 579 clients) — intermittent "Dashboard load failed"
- DL-255 hide/show helped filtering (21ms), but initial render of ALL 578 rows still creates massive DOM

## 2. User Requirements
1. **Q:** Rows per page? **A:** 50
2. **Q:** Which tabs? **A:** All tables
3. **Q:** Pagination style? **A:** Bottom bar with prev/next + page numbers (« 1 2 3 ... 12 »)

## 3. Research
### Domain
Table Pagination UX, DOM Performance

### Sources Consulted
See DL-255 for full research. Incremental: pagination is the standard approach for admin dashboards at this scale. Key principle: render only visible rows to keep DOM light.

### Research Verdict
Paginate at 50 rows. Filter/sort operates on full dataset, pagination slices the result. Stat cards still show totals from unfiltered data. Page resets to 1 on filter change.

## 4. Codebase Analysis
* **Render pattern (all tables):** filter array → sort → `renderXxxTable(filtered)` → innerHTML + safeCreateIcons
* **Dashboard table:** `filterClients()` → `renderClientsTable(clients)` (618) — builds table + mobile cards
* **Questionnaires:** `filterQuestionnaires()` → `renderQuestionnairesTable(items)` (6724)
* **Reminders:** `filterReminders()` → `renderRemindersTable(typeA, typeB)` (4702)
* **AI Review:** `applyAIFilters()` → `renderAICards(items)` (2885)
* **Pending:** `renderPendingClients()` (1897) — simple table, no search
* **DL-255 hide/show:** Currently renders all entity-filtered rows, hides with display:none. Pagination replaces this — render only the page slice.

## 5. Technical Constraints & Risks
* **Stat cards must show total counts** — not page counts. Stats come from `recalculateStats()` on full clientsData.
* **Bulk selection** — "select all" checkbox should select all on current page, not all 579.
* **Stage filter clicks** — must reset to page 1 when filter changes.
* **Mobile cards** — pagination must work for both desktop table and mobile card list.
* **"Showing X of Y" label** — users need to know total count vs displayed.

## 6. Proposed Solution

### Shared Pagination Utility
```js
function renderPagination(containerId, totalItems, currentPage, pageSize, onPageChange) {
    // Renders: « prev | 1 2 ... N | next » + "מציג X-Y מתוך Z"
}
```
Each table stores its own `currentPage` state.

### Dashboard Table Changes
- `filterClients()`: filter + sort full dataset → store as `_filteredClients` → slice to page → `renderClientsTable(pageSlice)`
- Remove DL-255 hide/show (replaced by pagination — only page-sized DOM)
- Reset page to 1 on any filter/sort change
- Add pagination bar after table

### Other Tables
Same pattern: filter → sort → store filtered → paginate → render page slice.

### Dashboard Timeout Fix
Bump `loadDashboard` from `FETCH_TIMEOUTS.load` (10s) to `FETCH_TIMEOUTS.slow` (20s). Already edited.

### Scoped safeCreateIcons
After rendering a page of 50 rows, call `lucide.createIcons({ nameAttr: 'data-lucide' })` scoped to the container (not full document). This reduces icon scan from 2300+ to ~200 elements.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Pagination utility, wire to all 5 tables, scoped icons |
| `admin/css/style.css` | Modify | Pagination bar styles |
| `admin/index.html` | Modify | Pagination containers if needed |

## 7. Validation Plan
* [ ] Dashboard: 50 rows per page, pagination bar shows at bottom
* [ ] Click page 2 → shows next 50 clients
* [ ] Filter by stage → resets to page 1, shows correct count
* [ ] Search → resets to page 1, pagination updates
* [ ] Sort → resets to page 1
* [ ] "Showing X-Y of Z" label updates correctly
* [ ] Stat cards still show full totals (not page totals)
* [ ] Bulk select → selects current page only
* [ ] Mobile cards paginated too
* [ ] Questionnaires, reminders, AI review all paginated
* [ ] No "Dashboard load failed" timeout errors

## 8. Implementation Notes (Post-Code)
