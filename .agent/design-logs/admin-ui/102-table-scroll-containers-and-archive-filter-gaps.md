# Design Log 102: Scrollable Table Containers + Archive Filter Gaps
**Status:** [DRAFT]
**Date:** 2026-03-05
**Related Logs:** DL-091 (Deactivate Client / Soft Delete), DL-055 (Sortable Headers), DL-097 (Floating Bulk Action Bars)

## 1. Context & Problem

**Task A — Scrollable Tables:** The admin panel has 4 main data tables (Dashboard, Send Questionnaires, Review Queue, Reminders) that render at full height with no scroll containment. When a table has 50+ rows, it pushes all content below the fold and the column headers scroll out of view.

**Task B — Archive Filter Gaps:** DL-091 implemented client archiving (`is_active` field), but only the Dashboard tab and Reminder Scheduler (WF[06]) filter out archived clients. Four other data paths have no filtering: Send Questionnaires, Review Queue, AI Review, and the Reminder Admin listing API.

## 2. User Requirements

1. **Q:** What's the main pain point with tables?
   **A:** Too tall vertically — tables push everything down. Need fixed-height scrollable containers.

2. **Q:** Should table headers be sticky?
   **A:** Yes — column headers should stay visible while scrolling the body.

3. **Q:** Which tables get this treatment?
   **A:** All 4 main tables (Dashboard, Send, Review Queue, Reminders).

4. **Q:** Is the archive filtering already done?
   **A:** Not sure — thinks archived clients still appear in the reminder tab. Wants verification + gaps fixed. Also needs to verify `is_active=true` bulk-set in Airtable.

## 3. Research

### Domain
CSS Architecture (Sticky Positioning), Scrollable Table Patterns, Accessibility

### Sources Consulted
1. **CSS-Tricks — "Position Sticky and Table Headers"** — Apply `position: sticky` to `<th>` cells, not `<thead>`. `border-collapse: collapse` breaks sticky in most browsers.
2. **Polypane — "Getting Stuck: All the Ways position:sticky Can Fail"** — Any ancestor with `overflow` other than `visible` disables sticky. `transform` on ancestors also breaks it.
3. **Adrian Roselli — "A Responsive Accessible Table"** — Scrollable table regions need `role="region"`, `aria-labelledby`, and `tabindex="0"` for keyboard scrolling.
4. **MDN — position: sticky** — Sticky sticks within nearest scrolling ancestor. `top: 0` is mandatory. `will-change: transform` helps repaint performance.

### Key Principles Extracted
- **Sticky on `<th>`, not `<thead>`** — `<thead>` sticky is inconsistent cross-browser
- **`border-collapse: separate` required** — `collapse` breaks sticky header borders
- **`overflow: hidden` on ancestors kills sticky** — our `.card` class has this, must override
- **Scrollable regions must be keyboard-accessible** — `tabindex="0"` + `role="region"` + focus ring
- **`max-height` over `height`** — short tables shouldn't show empty scroll space

### Patterns to Use
- **Scroll container wrapper** with `max-height: calc(100vh - Npx)` + `overflow-y: auto`
- **`border-collapse: separate; border-spacing: 0`** inside scroll containers
- **Sticky `<th>` with opaque background** to prevent content bleed-through

### Anti-Patterns to Avoid
- **Sticky on `<thead>`** — cross-browser inconsistency
- **Fixed pixel `height`** — creates empty scroll area with few rows
- **Forgetting `z-index` on sticky headers** — content bleeds over headers during scroll

## 4. Codebase Analysis

### Existing Solutions Found
- `.table-wrapper { overflow-x: auto }` exists in `design-system.css` (line 749) — used only by Import tab preview tables
- No existing vertical scroll wrapper or sticky header pattern anywhere

### Reuse Decision
- Extend `.table-wrapper` concept but create new `.table-scroll-container` class (different purpose: vertical scroll + sticky vs just horizontal scroll)

### Current Table Structure

| Table | Container ID | Inside `.card`? | Scroll wrapper? |
|-------|-------------|----------------|----------------|
| Dashboard | `#clientsTableContainer` | YES (`.card > .card-body`) | No |
| Send | `#pendingClientsContainer` | YES (`.card > .card-body`) | No |
| Review | `#reviewTableContainer` | No (direct in tab) | No |
| Reminders | `#reminderTableContainer` | No (accordion sections) | No |

### Blockers Found
1. **`table { border-collapse: collapse }` in `style.css:274`** — affects ALL tables, incompatible with sticky headers
2. **`.card { overflow: hidden }` in `design-system.css:316`** — breaks sticky for Dashboard + Send tables
3. No `<caption>` elements exist on any table (needed for accessible scroll regions)

### Archive Filtering Status

| Data Path | Filtered? | How |
|-----------|----------|-----|
| Dashboard stats | YES | `recalculateStats()` line 599 skips `is_active === false` |
| Dashboard table | YES | `filterClients()` line 347 |
| Reminder Scheduler (WF[06]) | YES | Airtable formula: `{client_is_active}=TRUE()` |
| Send Questionnaires tab | **NO** | `loadPendingClients()` renders all from API |
| Review Queue tab | **NO** | `renderReviewTable()` renders all from API |
| AI Review tab | **NO** | `loadAIClassifications()` renders all from API |
| Reminders tab | **NO** | `loadReminders()` renders all from API |

## 5. Technical Constraints & Risks

* **Security:** No auth/PII impact — purely UI + query filtering
* **Risks:**
  - Changing `border-collapse` could alter table appearance (border rendering) — need to test visually
  - `.card { overflow: hidden }` override could affect card border-radius clipping on other cards — scope override narrowly
  - Reminder section accordion (`.reminder-section-body`) already has `display:none` toggling — adding scroll container inside should be fine
* **Breaking Changes:** None — additive CSS + narrowly scoped overrides

## 6. Proposed Solution (The Blueprint)

### Part A: Scrollable Table Containers

#### A1. CSS Changes (`admin/css/style.css`)

Add `.table-scroll-container` class:
```css
.table-scroll-container {
    max-height: calc(100vh - 260px);  /* 56px header + 45px tabs + ~160px filters/stats */
    overflow-y: auto;
    overflow-x: auto;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-lg);
}

.table-scroll-container:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
}

.table-scroll-container table {
    border-collapse: separate;
    border-spacing: 0;
}

.table-scroll-container thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--gray-50);
    border-bottom: 2px solid var(--gray-300);
}
```

Override `.card { overflow: hidden }` for table cards:
```css
.card:has(.table-scroll-container) {
    overflow: visible;
}
```

Note: `:has()` has baseline support since Dec 2023 (Chrome 105+, Firefox 121+, Safari 15.4+). If needed, fallback: add a `.card--scroll` class to the specific cards.

#### A2. HTML Changes (`admin/index.html`)

No HTML changes needed — the scroll containers will be injected by JS as part of the table rendering.

#### A3. JS Changes (`admin/js/script.js`)

Each of the 4 render functions wraps its `<table>` in a scroll container:

- **`renderClientsTable()`** — wrap with `<div class="table-scroll-container" role="region" aria-label="טבלת לקוחות" tabindex="0">`
- **`renderPendingClients()`** — wrap with `<div class="table-scroll-container" role="region" aria-label="לקוחות לשליחה" tabindex="0">`
- **`renderReviewTable()`** — wrap with `<div class="table-scroll-container" role="region" aria-label="תור בדיקה" tabindex="0">`
- **`buildReminderTable()`** — wrap each accordion's table with `<div class="table-scroll-container" role="region" aria-label="תזכורות" tabindex="0">`

For reminders: the two accordion sections each get their own scroll container, with a shorter `max-height` variant since they share vertical space.

### Part B: Archive Filter Gaps

#### B1. Frontend Client-Side Filters (defense-in-depth)

Add `is_active` filtering in each tab's render/filter function:

- **`renderPendingClients()`** — filter `pendingClients.filter(c => c.is_active !== false)`
- **`renderReviewTable()`** — filter `reviewQueueData.filter(c => c.is_active !== false)`
- **`loadAIClassifications()`** — filter after API response (or in `applyAIFilters()`)
- **`filterReminders()`** — filter `remindersData.filter(r => r.is_active !== false)`

#### B2. Server-Side Filters (n8n workflows)

Add `{client_is_active}=TRUE()` to Airtable query formulas in:

1. **[Admin] Dashboard** (`AueLKVnkdNUorWVYfGUMG`) — the `Get Reports` node's filter formula, or filter in `Format Response` code node for the `review_queue` array
2. **[API] Reminder Admin** (`RdBTeSoqND9phSfo`) — the Airtable Search node's filter formula
3. **[API] Get Pending Classifications** (`kdcWwkCQohEvABX0`) — the Airtable query that fetches pending classifications
4. **Send Questionnaires pending list** — identify the endpoint (`admin-pending`) and add filter

#### B3. Airtable Bulk Update Verification

Remind user to verify all existing clients have `is_active=true` in Airtable.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/css/style.css` | Modify | Add `.table-scroll-container` styles, sticky headers, card overflow override |
| `admin/js/script.js` | Modify | Wrap 4 table renders in scroll containers + add `is_active` client-side filters |
| n8n: `[Admin] Dashboard` | Modify | Filter `review_queue` by `client_is_active` |
| n8n: `[API] Reminder Admin` | Modify | Add `client_is_active=TRUE()` to search filter |
| n8n: `[API] Get Pending Classifications` | Modify | Add `client_is_active` filter |
| n8n: Send tab endpoint | Modify | Add `client_is_active` filter |

## 7. Validation Plan

### Scrollable Tables
- [ ] Dashboard table: scroll container visible, sticky headers work on 20+ row table
- [ ] Send tab table: same
- [ ] Review Queue table: same
- [ ] Reminder accordions: both Type A and Type B tables scroll independently
- [ ] Short table (< 10 rows): no empty scroll space (max-height doesn't force fixed height)
- [ ] Card border-radius still clips correctly on Dashboard/Send cards
- [ ] Keyboard: Tab to table region, arrow keys scroll, focus ring visible
- [ ] No visual regression on table borders (border-collapse: separate vs collapse)

### Archive Filtering
- [ ] Archive a client → verify they disappear from: Send tab, Review Queue, AI Review, Reminders tab
- [ ] Reactivate → verify they reappear
- [ ] Reminder Scheduler (WF[06]): already filtered — confirm no regression
- [ ] Verify all existing Airtable clients have `is_active=true` (remind user)

## 8. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
