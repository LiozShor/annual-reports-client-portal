# Design Log 152: Move "צפייה כלקוח" from Inline Icon to Row Menu
**Status:** [DRAFT]
**Date:** 2026-03-14
**Related Logs:** None

## 1. Context & Problem
The main clients table has a "צפייה כלקוח" (View as Client) icon inline next to the client name, alongside the pencil (edit) icon. The user wants to declutter the client name cell by moving this action into the "⋮" (three dots) overflow menu under the פעולות column.

## 2. User Requirements
1. **Q:** Should the pencil icon (עריכת פרטים) stay inline or also move?
   **A:** Keep pencil inline — only remove the external-link icon.

2. **Q:** The "..." menu item — any changes needed?
   **A:** The "..." row-menu does NOT currently have "צפייה כלקוח" — it needs to be added. (The right-click context menu has it, but that's separate.)

## 3. Research
Skipped — trivial UI relocation, no domain research needed.

## 4. Codebase Analysis
* **Inline icon (to remove):** `script.js:321-323` — `<a class="client-view-link">` with `external-link` Lucide icon inside `div.client-name-cell`
* **Row menu (to add to):** `script.js:362-368` — `div.row-menu` inside `div.row-overflow-dropdown`, currently contains "צפה בשאלון" (conditional) and "העבר לארכיון"/"הפעל מחדש"
* **Right-click context menu:** `script.js:4586-4618` (`openClientContextMenu`) — already has "צפייה כלקוח", provides the exact pattern to follow
* **`viewClient()` function:** `script.js:4748-4751` — opens the client portal page in a new tab. Already used by both the inline icon and context menu.
* **CSS:** `client-view-link` class likely in the admin CSS — can be left as dead code or removed.

## 5. Technical Constraints & Risks
* **Security:** None — no auth changes, `viewClient()` function unchanged.
* **Risks:** Minimal — moving a button between two UI locations in the same file.
* **Breaking Changes:** None.

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. Remove the inline `<a class="client-view-link">` element (lines 321-323)
2. Add "צפייה כלקוח" button to the `row-menu` dropdown, before the archive/reactivate action (matching the context menu pattern)

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `github/annual-reports-client-portal/admin/js/script.js` | Modify | Remove inline icon (L321-323), add to row-menu (L364-367) |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`

## 7. Validation Plan
* [ ] Client name cell shows only pencil icon (no external-link icon)
* [ ] "⋮" menu shows "צפייה כלקוח" with external-link icon
* [ ] Clicking "צפייה כלקוח" in menu opens client portal in new tab
* [ ] Right-click context menu still works independently
* [ ] No console errors

## 8. Implementation Notes (Post-Code)
*Pending implementation.*
