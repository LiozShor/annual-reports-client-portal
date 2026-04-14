# Design Log 055: Sortable Table Headers + Clickable Stage Badges
**Status:** [IMPLEMENTED]
**Date:** 2026-02-25
**Related Logs:** [037-admin-portal-ux-refactor](037-admin-portal-ux-refactor.md), [054-inline-stage-advancement](054-inline-stage-advancement-review-classification.md), [045-document-manager-status-overview](045-document-manager-status-overview-file-actions.md)

## 1. Context & Problem

The admin dashboard's clients table is static — no sorting, and stage badges are read-only. Office staff managing 500+ clients need:
1. **Column sorting** — click headers to sort by name, stage, documents, or missing count
2. **Quick stage overrides** — click a stage badge to change a client's stage directly, without navigating to another page or waiting for workflow side-effects

Currently, stage transitions only happen as workflow side-effects (WF[01] sends questionnaire → stage 1→2, client submits Tally → stage 2→3, etc.). There's no way to manually override a stage, which is needed when correcting errors or handling edge cases.

## 2. User Requirements

1. **Q:** Which tables should have sortable headers?
   **A:** Clients table only (main dashboard table).

2. **Q:** Should stages 1-2 be changeable (system-triggered transitions)?
   **A:** All stages changeable, with warnings for dangerous transitions.

3. **Q:** Immediate changes or batch save?
   **A:** Immediate with confirmation dialog per change.

4. **Q:** Should backward transitions require a reason?
   **A:** Required for backward moves only. Forward moves don't need a reason.

5. **Q:** Update behavior?
   **A:** Smooth in-place updates — no full page refresh. Badge updates optimistically, stat cards recalculate locally.

## 3. Research

### Domain
Interactive Data Tables (sorting, inline editing), State Machine Manual Overrides, Accessible ARIA Patterns

### Sources Consulted
1. **W3C WAI-ARIA APG — Sortable Table Example** — `<button>` inside `<th>`, `aria-sort` attribute on sorted column, character entities (▲/▼) with `aria-hidden="true"` for indicators. Button fills entire header cell for maximum click target.
2. **Pencil & Paper — Enterprise Data Table UX Patterns** — Inline editing with text cursor hint on hover. Status dropdowns as click-to-change popups. States must be visually obvious (open, closed, active, filled).
3. **State Machine Audit Trail patterns** — Audit table with foreign key, from_state, to_state, event, created_at. Manual overrides still go through transition validation. Store context (reason) for non-standard transitions.

### Key Principles Extracted
- **W3C APG:** Use `<button>` inside `<th>` for keyboard accessibility — native focus, Enter/Space activation. `aria-sort` communicates state to screen readers.
- **Enterprise tables:** Inline editing minimizes context switching. Visual affordances (cursor, caret) essential for discoverability.
- **Audit trails:** Every manual override should log who, what, when, and why (for backward moves).

### Patterns to Use
- **W3C Sortable Table:** Button-in-th, aria-sort, CSS pseudo-elements for indicators
- **Document-manager dropdown pattern:** Single shared `<div>` with `position: fixed`, positioned via `getBoundingClientRect()`, closed on click-outside/Escape
- **Optimistic UI update:** Update badge + stats locally before API confirmation, revert on failure

### Anti-Patterns to Avoid
- **Mystery Meat Navigation:** Stage badges MUST show affordance (cursor, caret) — not just be passively colored
- **Full-page refresh on change:** Defeats "smooth" requirement — use in-place DOM updates
- **Free-form stage setter:** Constrained transitions with warnings for dangerous ones

### Research Verdict
Follow W3C APG for sorting (button-in-th + aria-sort). Mirror document-manager's dropdown for stage changes. Optimistic local updates for smoothness. New n8n API endpoint for persisting stage changes with audit trail.

## 4. Codebase Analysis

### Relevant Files
- `admin/js/script.js` — `renderClientsTable()` (line 177), `filterClients()` (line 262), `stageLabels` (line 191, local to render fn), `showConfirmDialog()` (line 2017), `showAIToast()` (line 1807), `loadDashboard()` (line 117)
- `admin/css/style.css` — Table overrides (line 222), stage badges (line 254)
- `admin/index.html` — Table container `#clientsTableContainer` (line 138), confirm dialog (line 464), toast (line 458)
- `assets/js/document-manager.js` — `openStatusDropdown()` (line 369), `setDocStatus()` (line 388) — reference pattern
- `assets/js/resilient-fetch.js` — `fetchWithTimeout()`, `FETCH_TIMEOUTS` (mutate: 15s)

### Existing Patterns
- **Dropdown:** document-manager uses single shared `<div id="statusDropdown">` with `position: fixed`, RTL positioning via `window.innerWidth - rect.right`
- **Confirm dialog:** `showConfirmDialog(message, onConfirm, confirmText, danger)` — modal overlay with callback
- **Toast:** `showAIToast(message, type)` — 3-second auto-dismiss notification
- **Table re-render:** `innerHTML` replacement + `lucide.createIcons()` — existing pattern for all tables
- **API calls:** `fetchWithTimeout()` with `FETCH_TIMEOUTS.mutate` (15s) for write operations
- **stageLabels/stageMap:** Defined independently in 2 places (lines 191 and 277) — should consolidate

### Alignment with Research
- Codebase uses semantic `<table>` with `<th>` — aligns with W3C APG base
- No `<button>` inside `<th>` currently — need to add
- Dropdown pattern already proven in document-manager — can mirror exactly
- No `aria-sort` anywhere — need to add

## 5. Technical Constraints & Risks

### Security
- Stage change API needs admin token validation (same as all admin endpoints)
- Frontend sends `authToken` already stored in localStorage

### Risks
- **Stage change bypasses workflow side-effects** — changing to stage 2 won't send questionnaire email. Admin must understand this. Mitigated with clear confirmation message.
- **Concurrent editing** — two admins could change same client's stage. Last-write-wins is acceptable for small office.
- **Backend doesn't exist yet** — new n8n workflow needed. Frontend can be built first with graceful error handling.

### Breaking Changes
- None — additive changes only. Existing filtering, stat cards, and table behavior preserved.

## 6. Proposed Solution (The Blueprint)

### Part A: Canonical STAGES Object (SSOT consolidation)

Extract `stageLabels` (line 191) and `stageMap` (line 277) into a single top-level constant:

```javascript
const STAGES = {
    '1-Send_Questionnaire':  { num: 1, he: 'ממתין לשליחה', icon: 'clipboard-list', class: 'stage-1' },
    '2-Waiting_For_Answers': { num: 2, he: 'ממתין לתשובה', icon: 'hourglass', class: 'stage-2' },
    '3-Collecting_Docs':     { num: 3, he: 'אוסף מסמכים', icon: 'folder-open', class: 'stage-3' },
    '4-Review':              { num: 4, he: 'בבדיקה', icon: 'search', class: 'stage-4' },
    '5-Completed':           { num: 5, he: 'הושלם', icon: 'circle-check', class: 'stage-5' }
};
```

Replace `stageLabels` and `stageMap` references to derive from `STAGES`.

### Part B: Sortable Table Headers

**State:**
```javascript
let currentSort = { column: null, direction: 'asc' }; // null = no sort
```

**Sort config (one place):**
```javascript
const SORT_CONFIG = {
    name:    { accessor: c => c.name || '', type: 'string' },
    stage:   { accessor: c => STAGES[c.stage]?.num || 0, type: 'number' },
    docs:    { accessor: c => c.docs_total > 0 ? c.docs_received / c.docs_total : 0, type: 'number' },
    missing: { accessor: c => (c.docs_total || 0) - (c.docs_received || 0), type: 'number' }
};
```

**Functions:**
1. `toggleSort(column)` — toggle asc↔desc, update `currentSort`, call `filterClients()`
2. `sortClients(clients)` — pure function, returns sorted copy. Hebrew-aware `localeCompare('he')` for strings
3. Modify `filterClients()` — apply sort after filter: `renderClientsTable(sortClients(filtered))`
4. Modify `renderClientsTable()` — add `<button>` inside sortable `<th>`, `aria-sort` attribute, sort indicator spans

**HTML structure per sortable th:**
```html
<th aria-sort="ascending">
    <button class="th-sort-btn" onclick="toggleSort('name')">
        שם <span class="sort-indicator" aria-hidden="true">▲</span>
    </button>
</th>
```

Non-sortable Actions column: plain `<th>` with no button.

### Part C: Clickable Stage Badges

**Allowed transitions (all stages, with warnings):**
```javascript
const STAGE_TRANSITIONS = {
    '1-Send_Questionnaire':  ['2-Waiting_For_Answers', '3-Collecting_Docs'],
    '2-Waiting_For_Answers': ['1-Send_Questionnaire', '3-Collecting_Docs'],
    '3-Collecting_Docs':     ['2-Waiting_For_Answers', '4-Review'],
    '4-Review':              ['3-Collecting_Docs', '5-Completed'],
    '5-Completed':           ['4-Review']
};
```

**Dangerous transitions** (going backward or skipping): show warning in confirmation.

**Stage badge in table (modified):**
```html
<span class="stage-badge stage-3 clickable"
      onclick="openStageDropdown(event, 'recXXX', '3-Collecting_Docs')"
      title="לחץ לשינוי שלב">
    <i data-lucide="folder-open" class="icon-sm"></i> אוסף מסמכים
    <span class="stage-caret">▾</span>
</span>
```

**Stage dropdown (single shared element in HTML):**
```html
<div id="stageDropdown" class="stage-dropdown" style="display:none;">
    <!-- populated dynamically based on allowed transitions -->
</div>
```

**Functions:**
1. `openStageDropdown(event, reportId, currentStage)` — position dropdown, populate with allowed transitions, highlight current
2. `closeStageDropdown()` — hide dropdown
3. `changeClientStage(reportId, newStage)` — show confirmation → API call → optimistic update
4. `updateClientStageInPlace(reportId, newStage)` — DOM update without full re-render

**Optimistic update flow:**
1. Close dropdown
2. Show confirmation dialog (with reason field for backward moves)
3. On confirm: immediately update badge DOM + recalculate stat cards
4. Fire API call in background
5. On success: show toast "השלב עודכן בהצלחה"
6. On failure: revert badge + stats, show error toast

**Stat cards local recalculation:**
```javascript
function recalculateStats() {
    const stats = { total: clientsData.length, stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0 };
    for (const c of clientsData) {
        const num = STAGES[c.stage]?.num;
        if (num) stats[`stage${num}`]++;
    }
    // Update DOM elements
}
```

### Part D: New n8n API Endpoint

**Workflow: `[API] Admin Change Stage`**
- Webhook: POST `/admin-change-stage`
- Auth: verify admin token
- Validate: report_id, target_stage (must be valid Airtable value)
- Transition check: warn but allow (admin override)
- Airtable: update `stage` field. If backward from 4→3: clear `docs_completed_at`
- Audit: log to `system_logs` table
- Response: `{ ok: true, report_id, previous_stage, new_stage }`

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add STAGES, SORT_CONFIG, STAGE_TRANSITIONS constants. Add sort state + functions. Modify renderClientsTable() for sortable headers + clickable badges. Add stage dropdown functions. Modify filterClients(). Add recalculateStats(). |
| `admin/css/style.css` | Modify | Add .th-sort-btn, .sort-indicator, [aria-sort] styles. Add .stage-badge.clickable, .stage-caret, .stage-dropdown styles. |
| `admin/index.html` | Modify | Add `<div id="stageDropdown">` element. Optionally add reason textarea to confirmDialog. |
| n8n (new workflow) | Create | [API] Admin Change Stage workflow with auth, validation, Airtable update, audit log. |

## 7. Validation Plan

### Sorting
- [ ] Click "שם" header → sorts alphabetically (Hebrew-aware)
- [ ] Click again → reverses direction
- [ ] Click "שלב" → sorts by stage number 1-5
- [ ] Click "מסמכים" → sorts by completion ratio
- [ ] Click "חסרים" → sorts by missing count
- [ ] Sort persists through filter changes (search, stage, year)
- [ ] Sort indicators (▲/▼) visible and correct
- [ ] Actions column NOT sortable
- [ ] aria-sort attribute updates on sorted column

### Stage Change
- [ ] Click stage badge → dropdown appears below badge
- [ ] Dropdown shows only allowed transitions
- [ ] Current stage highlighted
- [ ] Click outside / Escape → closes dropdown
- [ ] Select new stage → confirmation dialog
- [ ] Backward move → reason field appears in dialog
- [ ] Confirm → badge updates in-place (no page refresh)
- [ ] Stat cards update in-place
- [ ] Toast shows success message
- [ ] API failure → badge reverts, error toast
- [ ] Dangerous transitions show warning text

### Integration
- [ ] Sorting works after a stage change
- [ ] Filtering works after sorting
- [ ] Stage filter (stat card click) + sort = correct combined behavior

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
