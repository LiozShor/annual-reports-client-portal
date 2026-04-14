# DL-166: Admin Portal Filing Type Tabs (AR / CS)

**Date:** 2026-03-19
**Status:** IMPLEMENTED — NEED TESTING
**Depends on:** DL-164 (filing_type infrastructure), DL-165 (UX research)
**Plan:** e556f816-8399-47dc-a27c-30d07448f300

## Context

DL-164 completed the filing_type infrastructure (Airtable schema, Doc Service filter, email labels, frontend API-driven form IDs). The admin portal now needs UX changes to support two filing types: Annual Reports (AR) and Capital Statements (CS). DL-165 research confirmed: **tabs for entity types, not filters** — they're different navigation contexts, not in-page filtering.

This is a **design-only** log. No code changes. Documents UX decisions so implementation is straightforward when CS content exists.

## Design Decisions

### 1. Two-Level Tab Hierarchy

**Entity tabs** (new, primary) sit above **functional tabs** (existing):

```
┌─────────────────────────────────────────────────────────┐
│  [דוחות שנתיים (342)]  │  [הצהרות הון (28)]           │  ← NEW: Entity tabs
├─────────────────────────────────────────────────────────┤
│  [לוח בקרה] [הוספת לקוחות] [שאלונים ▾] [מוכנים] ...   │  ← EXISTING: Functional tabs
├─────────────────────────────────────────────────────────┤
│  Stats Grid (9 cards, scoped to selected entity)        │
│  Client Table (filtered by entity type)                 │
└─────────────────────────────────────────────────────────┘
```

**Visual hierarchy:** Entity tabs are larger, bolder, pill-style with count badges. Functional tabs keep existing underline style (smaller). Two levels must be visually distinct.

**RTL:** First tab on right (natural RTL start). CSS flexbox handles mirroring — no manual work needed.

### 2. Global Summary Bar — Skipped for MVP

Research suggested 2-3 KPI cards above entity tabs (total clients, completion rate, needs-attention count). **Decision: skip for MVP.** Per-tab stats grid is sufficient. Add later if the firm switches tabs just to check totals.

### 3. Client-Side Filtering (Option B)

Two options were considered:
- **Option A:** `filing_type` query param → API filters server-side
- **Option B:** API returns all, JS filters client-side

**Chosen: Option B.** No API changes. `clientsData` is already cached — just filter by `filing_type` before rendering. Dataset is small (~600 clients/year). Dashboard API already returns `filing_type` per report (added in DL-164).

### 4. Per-Tab Stats Grid

Each entity tab has its own 9-column stats grid. Same `recalculateStats()` logic, filtered by active entity type. Implementation:

```javascript
function recalculateStats() {
    const activeType = activeEntityTab; // 'annual_report' or 'capital_statement'
    const counts = { total: 0, stage1: 0, ... };
    for (const client of clientsData) {
        if (client.is_active === false) continue;
        if ((client.filing_type || 'annual_report') !== activeType) continue; // NEW filter
        counts.total++;
        // ... existing stage counting
    }
    // ... existing DOM updates
}
```

### 5. Client Table — Same Columns

Both AR and CS use the 8-stage pipeline and identical table columns (name, stage, docs progress, missing count, notes, actions). `filterClients()` adds a `filing_type` filter before rendering:

```javascript
function filterClients() {
    let filtered = clientsData;
    // NEW: filter by entity tab
    const activeType = activeEntityTab;
    filtered = filtered.filter(c => (c.filing_type || 'annual_report') === activeType);
    // ... existing archive/search/stage/year filters
}
```

If CS needs different columns later, use a column config array per type.

### 6. State Persistence

Per-tab filter state survives tab switches via `sessionStorage`:

```javascript
const entityTabState = {
    annual_report:      { stage: '', search: '', scrollY: 0, sort: null },
    capital_statement:  { stage: '', search: '', scrollY: 0, sort: null }
};
```

On entity tab switch: save current state → restore target state. Clear bulk selections on switch.

### 7. URL Hash Routing

- `admin/index.html#annual` → Annual Reports tab (default)
- `admin/index.html#capital` → Capital Statements tab
- On load: read hash → activate corresponding tab
- On tab switch: `history.replaceState()` → update hash
- Browser back/forward navigates between entity tabs

### 8. Import Dialog — Filing Type Selector

Add `סוג דוח` radio/select next to year selector in both:
- **Manual add form** (`section-manual`): add after `manualYear` field
- **Import preview** (`previewSection .import-options`): add after `importYear` field

Default: `דוח שנתי`. All imported clients get the selected filing type. One import = one type. Pass `filing_type` in API call body.

### 9. Year Rollover — Filing Type Aware

Add `סוג דוח` selector to rollover dialog, between source/target year fields. Only clone reports matching the selected type. Default: `דוח שנתי` (annual_report).

## Files to Change (When Implementing)

| File | Change |
|------|--------|
| `admin/index.html` | Add entity tab bar HTML above `.tabs-nav` (line 62). Add `filing_type` selectors to manual add (line 233), import preview (line 308), rollover (line 356). |
| `admin/js/script.js` | Add `activeEntityTab` state var (line 7). Add `switchEntityTab()`. Modify `recalculateStats()` (line 635) to filter by type. Modify `filterClients()` (line 378) to filter by type. Add state persistence + hash routing. Modify `addManualClient()` (line 1102), `startImport()` (line 1062), `previewYearRollover()` (line 5040), `executeYearRollover()` (line 5093) to pass `filing_type`. Update entity tab counts after `loadDashboard()` (line 207). |
| `admin/css/style.css` | Entity tab bar styles — larger, pill-style with count badges. Must be visually distinct from existing `.tabs-nav` underline tabs. |
| n8n `[Admin] Bulk Import` | Accept `filing_type` in payload, write to Airtable. |
| n8n `[Admin] Year Rollover` | Accept `filing_type`, filter source records by type. |

## Implementation Order (When Ready)

1. Entity tab bar HTML + CSS
2. `switchEntityTab()` + `activeEntityTab` state
3. Filter `clientsData` by active entity tab in `filterClients()` + `recalculateStats()`
4. Entity tab count badges (update after dashboard load)
5. State persistence (sessionStorage save/restore per tab)
6. Hash routing (#annual / #capital)
7. Filing type selector in import dialog (manual + bulk)
8. Filing type selector in rollover dialog
9. n8n workflow updates (import + rollover accept filing_type)

## Verification Checklist (For Implementation)

- [ ] Switch between AR/CS tabs → correct clients shown, stats recalculated
- [ ] Filters persist across tab switches
- [ ] URL hash updates on tab switch; direct navigation to `#capital` works
- [ ] Import with `filing_type = capital_statement` creates CS reports
- [ ] Rollover respects filing_type selection
- [ ] Mobile: entity tabs don't break layout (test at 375px width)
- [ ] Existing AR functionality unchanged (regression)
- [ ] `|| 'annual_report'` default handles legacy records without filing_type
