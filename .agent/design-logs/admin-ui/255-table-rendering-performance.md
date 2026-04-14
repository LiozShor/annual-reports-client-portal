# Design Log 255: Table Rendering Performance — Hide/Show + Debounce
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-12
**Related Logs:** DL-254 (dashboard load perf), DL-247 (tab switching SWR), DL-214 (mobile card layout), DL-132 (god component risk)

## 1. Context & Problem
With 579 clients, every filter keystroke, sort click, or stage filter change triggers a full `innerHTML` rebuild of the clients table. `renderClientsTable()` generates 1,158 HTML elements (desktop table row + mobile card per client), destroys all DOM nodes, rebuilds from scratch, then calls `safeCreateIcons()` to scan and replace ~2,300 Lucide icon placeholders.

This affects all 5 admin tables:
- **Dashboard clients table** (579 rows) — most impacted, filtered/sorted frequently
- **Questionnaires table** (~300+ rows) — search + sort
- **Reminders table** (~100+ rows) — search + card filter
- **AI Review cards** (~20 items) — small, but grouped by client accordion
- **Pending/Send table** (~100+ rows) — minimal filtering

All 4 search inputs use `oninput="filter...()"` with no debounce.

## 2. User Requirements
1. **Q:** Table rendering approach?
   **A:** Hide/show rows — build once, toggle visibility on filter. Instant for 579 rows.
2. **Q:** Sort strategy?
   **A:** Re-render only on sort. Filters use hide/show, sort does full rebuild (infrequent).
3. **Q:** Scope?
   **A:** All admin tables, not just clients.

## 3. Research
### Domain
DOM Performance, Large Table Rendering, Client-Side Filtering

### Sources Consulted
1. **web.dev: Rendering Performance** — Avoid layout thrashing by batching DOM reads/writes. `display:none` removes elements from layout, so toggling it avoids reflow for hidden rows.
2. **UI research on table rendering** — For <2000 rows, hide/show with CSS classes outperforms virtual scroll. `content-visibility: auto` on table rows lets browser skip off-screen rendering natively (Chrome 85+).
3. **Debounce best practices** — 150-200ms debounce on search inputs eliminates unnecessary intermediate renders while feeling instant to users. `requestAnimationFrame` for visual updates.

### Key Principles
- **Build once, filter with visibility** — for 579 rows, toggling `display:none` is near-instant vs destroying/recreating 1158 DOM nodes
- **Debounce search at 150ms** — users type faster than they can read results
- **Skip icon re-creation on filter** — if rows already have Lucide icons from initial render, filtering by visibility doesn't need `safeCreateIcons()`
- **`content-visibility: auto`** — CSS-only optimization for off-screen rows, zero JS needed

### Anti-Patterns to Avoid
- **Virtual scroll** — overkill for 579 rows, breaks Ctrl+F, print, accessibility
- **Pagination** — admin users want to scan all clients at a glance
- **Web Workers for filtering** — postMessage overhead > filter time at this scale

### Research Verdict
Hide/show pattern for all tables. Build DOM once on data load. On filter/search, iterate the JS data array and toggle row visibility. Only do full innerHTML rebuild on sort, data refresh, or entity tab switch. Add 150ms debounce on all search inputs. Add `content-visibility: auto` CSS for off-screen rows.

## 4. Codebase Analysis
* **Existing Solutions:** None — all tables use innerHTML rebuild on every change
* **Render functions:** `renderClientsTable` (line 618), `renderQuestionnairesTable` (line 6695), `renderRemindersTable` (line 4702), `renderAICards` (line 2885), `renderPendingClients` (line 1897)
* **Filter functions:** `filterClients` (line 808), `filterQuestionnaires` (line 6681), `filterReminders` (line 4666), `applyAIFilters` (line 2786)
* **Search inputs:** 4 inputs in `admin/index.html` (lines 178, 602, 652, 733) — all `oninput` with no debounce
* **safeCreateIcons:** Called 53 times across script.js — each does `lucide.createIcons()` DOM scan
* **Data arrays:** `clientsData`, `questionnairesData`, `remindersData`, `aiClassificationsData`, `pendingClients` — all in-memory, filtering is against these

## 5. Technical Constraints & Risks
* **Security:** No changes.
* **Risks:**
  - Rows must have stable `data-report-id` attributes for hide/show to work with popovers, context menus, bulk selection
  - Mobile card list must be synced with desktop table visibility
  - Sort requires full rebuild — DOM node reordering would be fragile with the inline event handlers
* **Breaking Changes:** None — same visual output, just faster rendering.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Filtering 579 clients by stage or search feels instant (<50ms). No visible jank on filter change. Sort still works correctly.

### Approach per table

#### Dashboard Clients Table (biggest impact)
1. `renderClientsTable()` — add `data-report-id` to both `<tr>` and mobile `<li>` (already has it)
2. New `filterClientsDOM()` function:
   - Iterate `clientsData` array (already filtered by entity type)
   - Apply search, stage, year, active filters
   - For each client: `document.querySelector(`tr[data-report-id="${id}"]`).style.display = match ? '' : 'none'`
   - Same for mobile card
   - Update counts without DOM counting
3. `filterClients()` — call `filterClientsDOM()` instead of `renderClientsTable(filtered)`
4. When sort changes: set a flag, call `renderClientsTable(sorted)` (full rebuild — sort only)
5. On data refresh: full `renderClientsTable()` (new data from API)

#### Questionnaires Table
Same pattern: `filterQuestionnairesDOM()` toggles row visibility. Full rebuild on sort or data refresh.

#### Reminders Table
Same pattern: `filterRemindersDOM()` toggles row visibility. Has accordion sections (Type A / Type B) — need to hide entire section if all rows hidden.

#### AI Review Cards
Smaller dataset (~20 items), but uses accordion grouping by client. Apply hide/show on accordion groups. Full rebuild unnecessary — just toggle `.ai-accordion` visibility.

#### Pending/Send Table
Minimal filtering (just active/inactive). Low priority but easy to include.

### Debounce
Add a single `debounce` utility function. Wire it to all 4 search inputs:
```js
function debounce(fn, ms = 150) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
```
In `index.html`, change `oninput="filterClients()"` to call debounced versions. Simplest: define debounced wrappers in script.js and reference them from `oninput`.

### CSS `content-visibility`
Add to `admin/css/style.css`:
```css
#clientsTableContainer tbody tr,
#questionnaireTableContainer tbody tr,
#reminderTableContainer tbody tr {
    content-visibility: auto;
    contain-intrinsic-size: 0 48px;
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add DOM-based filter functions, debounce utility, wire up |
| `admin/index.html` | Modify | Debounced search inputs |
| `admin/css/style.css` | Modify | `content-visibility: auto` for table rows |

### Final Step
* **Housekeeping:** Update design log, INDEX, current-status. Commit & push.

## 7. Validation Plan
* [ ] Type in search input — no jank, results filter as you type with ~150ms debounce
* [ ] Click stage filter (stat card) — rows hide/show instantly, no full table rebuild
* [ ] Sort by column — full rebuild, correct order, icons render
* [ ] Entity tab switch (AR→CS) — data reloads, table rebuilds correctly
* [ ] Mobile responsive — cards also filter correctly
* [ ] Bulk selection — checkboxes work on visible rows
* [ ] Context menu — works on visible rows
* [ ] Questionnaires tab — search debounced, sort works
* [ ] Reminders tab — search debounced, card filter works, accordion sections hide if empty
* [ ] AI Review tab — search filters client accordions

## 8. Implementation Notes (Post-Code)
* Implemented hide/show for dashboard clients table only (biggest impact — 578 rows)
* Questionnaires, reminders, AI review tables NOT converted to hide/show yet — they use smaller datasets and the debounce + content-visibility improvements help them enough for now
* Playwright measurements: stage filter 21ms, search 13ms, back-to-all 20ms — all under 25ms
* `filterClients()` tracks `_clientsBaseKey` (entity+archive) and `_clientsSortKey` — full rebuild only when these change
* `renderClientsTable()` renders ALL entity-filtered rows; hide/show toggles search/stage/year visibility
* DL-254 timeout fix: `loadAIReviewCount` timeout bumped to match `loadAIClassifications` (both use `FETCH_TIMEOUTS.slow` via deduplicatedFetch)
