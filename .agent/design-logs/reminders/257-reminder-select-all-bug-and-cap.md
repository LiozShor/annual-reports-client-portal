# Design Log 257: Reminder Select-All Bug Fix & Bulk Cap
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-12
**Related Logs:** DL-236 (bulk send cap 50), DL-256 (table pagination), DL-214 (mobile card layout)

## 1. Context & Problem
The reminder tab's "select all" checkbox (section header) reports selecting 100 items when only 50 are on the page. Two issues:

1. **Duplicate checkbox bug:** Each reminder item renders TWO `.reminder-checkbox` elements — one in the desktop `<table>` (script.js:4922) and one in the mobile card list (script.js:4995). Both share the same class and `value`. `toggleSectionSelectAll` queries all `.reminder-checkbox` in the section, finding 50×2=100.

2. **No bulk cap:** The questionnaires tab caps select-all at `MAX_BULK_SEND = 50` (script.js:2052) and disables unchecked boxes at the limit. The reminders tab has no equivalent cap.

3. **No way to send next batch:** After sending reminders to page 1, the user navigates to page 2 manually — this already works via pagination (DL-256), just needs the bug fixed.

## 2. User Requirements
1. **Q:** Should the reminder 'select all' have a MAX_BULK cap like the questionnaire tab (50)?
   **A:** Yes, cap at 50 — match questionnaire tab behavior.
2. **Q:** How should Natan handle sending beyond the first 50?
   **A:** Navigate to page 2 (existing pagination handles this).
3. **Q:** Fix bug only, or bug + cap?
   **A:** Fix bug + add cap.

## 3. Research
Skipped — straightforward bug fix + pattern replication from DL-236.

## 4. Codebase Analysis
* **Existing Solutions Found:** `MAX_BULK_SEND = 50` pattern in questionnaires tab (script.js:2052-2075) — cap + disable unchecked at limit
* **Reuse Decision:** Replicate the same pattern: reuse `MAX_BULK_SEND` constant, add cap logic to reminder select-all functions, add disable logic to `updateReminderSelectedCount`
* **Root cause:** `buildReminderTable()` (script.js:4874) renders both `<table>` rows AND `.mobile-card-list` items, each with `.reminder-checkbox`. DOM queries find both.

**Key functions to modify:**
| Function | Line | Issue |
|----------|------|-------|
| `toggleSectionSelectAll()` | 5075 | Selects all `.reminder-checkbox` including mobile duplicates |
| `toggleReminderSelectAll()` | 5060 | Same issue — table master checkbox |
| `updateReminderSelectedCount()` | 5106 | Counts duplicate checked boxes → inflated count |
| `syncMasterCheckboxes()` | 5084 | Reads from both table and mobile checkboxes |
| `reminderBulkAction()` | 5203 | Collects duplicate report IDs |
| `deselectMutedClients()` | 5140 | Iterates duplicates |

**Checkbox DOM structure:**
- Desktop: `<table> ... <td><input class="reminder-checkbox" value="ID"></td>`
- Mobile: `<ul class="mobile-card-list"> ... <input class="reminder-checkbox" value="ID">`
- Only one is visible at a time (CSS media query), but both exist in DOM

## 5. Technical Constraints & Risks
* **No backend changes** — purely frontend
* **Risk:** Changing checkbox class could break event handlers. Safer approach: scope queries to visible context or deduplicate by value.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Select-all checks exactly 50 items max, count displays correctly, bulk send receives 50 unique report IDs.

### Approach: Deduplicate by value (simplest, safest)

Rather than changing HTML classes or structure, fix all query functions to deduplicate by `value`:

**Fix 1 — `updateReminderSelectedCount()` (line 5106):**
Deduplicate `checkedIds` using `new Set()` before counting:
```js
const checkedIds = [...new Set(
  Array.from(document.querySelectorAll('.reminder-checkbox:checked')).map(cb => cb.value)
)];
```

**Fix 2 — `toggleSectionSelectAll()` (line 5075):**
Add cap at MAX_BULK_SEND. When checking, use `Set` to only check first occurrence of each value up to cap:
```js
function toggleSectionSelectAll(headerCb) {
    const section = headerCb.closest('.reminder-section');
    const cbs = section.querySelectorAll('.reminder-checkbox');
    if (headerCb.checked) {
        const seen = new Set();
        let count = getCurrentReminderCheckedCount();
        cbs.forEach(cb => {
            if (!seen.has(cb.value) && count < MAX_BULK_SEND) {
                cb.checked = true;
                seen.add(cb.value);
                count++;
            }
        });
    } else {
        cbs.forEach(cb => cb.checked = false);
    }
    // sync both table and mobile checkboxes for same value
    syncDuplicateCheckboxes(section);
    const tableSelectAll = section.querySelector('.reminder-select-all');
    if (tableSelectAll) tableSelectAll.checked = headerCb.checked;
    updateReminderSelectedCount();
}
```

**Fix 3 — `toggleReminderSelectAll()` (line 5060):**
Same cap logic as Fix 2 but scoped to table.

**Fix 4 — `updateReminderSelectedCount()` disable unchecked at limit:**
Add disable logic matching questionnaire tab pattern:
```js
const uniqueCount = checkedIds.length; // after dedup
document.querySelectorAll('.reminder-checkbox').forEach(cb => {
    if (!cb.checked) cb.disabled = uniqueCount >= MAX_BULK_SEND;
});
```

**Fix 5 — `reminderBulkAction()` (line 5203) & `deselectMutedClients()` (line 5140):**
Deduplicate report IDs with `new Set()`.

**Fix 6 — `syncMasterCheckboxes()` (line 5084):**
Deduplicate when counting for master checkbox state.

### Helper function:
```js
function getUniqueReminderCheckedCount() {
    return new Set(
        Array.from(document.querySelectorAll('.reminder-checkbox:checked')).map(cb => cb.value)
    ).size;
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `github/annual-reports-client-portal/admin/js/script.js` | Modify | Fix 6 functions + add helper |

### Final Step
* **Housekeeping:** Update design log status, INDEX, current-status.md, git commit & push

## 7. Validation Plan
* [ ] Click section "select all" → count shows 50 (not 100)
* [ ] Bulk send with 50 selected → 50 unique report IDs sent to Worker
* [ ] Unchecked checkboxes disabled at limit (can't exceed 50)
* [ ] Uncheck one → re-enables unchecked boxes
* [ ] Mobile view: same behavior, count matches desktop
* [ ] Navigate to page 2 → can select another batch
* [ ] Muted client warning still works correctly
* [ ] Master/section checkbox indeterminate state still works

## 8. Implementation Notes (Post-Code)
* Root cause confirmed: each reminder renders 2 `.reminder-checkbox` elements (table row + mobile card) sharing same `value`
* Added `getUniqueReminderCheckedCount()` helper — deduplicates by value using `Set`
* Added `syncDuplicateCheckboxes(scope)` — syncs checked/disabled state across table↔mobile pairs
* Applied `MAX_BULK_SEND` cap (reusing existing constant) to both `toggleReminderSelectAll` and `toggleSectionSelectAll`
* Added disable-at-limit logic in `updateReminderSelectedCount` matching questionnaire tab pattern (DL-236)
* Deduplicated `reminderBulkAction` report IDs to prevent duplicate API calls
* Fixed `cancelReminderSelection` to also clear section-select-all and reset disabled/indeterminate states
