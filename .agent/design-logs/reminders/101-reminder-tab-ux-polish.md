# Design Log 101: Reminder Tab UI/UX Polish Pass
**Status:** [DRAFT]
**Date:** 2026-03-05
**Related Logs:** DL-099 (suppress overhaul), DL-078 (clickable cards & mute fixes), DL-097 (floating bulk action bars)

## 1. Context & Problem
After completing the suppress UX overhaul (DL-099), an expert consultation (Yuki/UI, Amara/A11y, Renzo/Arch) audited the reminder tab and identified 15 action items across accessibility, bugs, UX, and visual polish. Key issues: WCAG contrast failure on suppressed rows (opacity: 0.6), checkbox desync between section headers and in-table select-all, non-actionable muted warning chip, and status badge lacking clear affordance split.

## 2. User Requirements
1.  **Q:** Keep all send confirmations or remove for bulk?
    **A:** Keep all confirms (single + bulk).
2.  **Q:** Muted chip behavior — click to deselect or visual-only?
    **A:** Actionable — click to deselect muted clients from selection.
3.  **Q:** Date cell hover affordance — add pencil icon or underline?
    **A:** Skip — current behavior is fine.
4.  **Q:** Status badge design — full clickable pill or split label|chevron?
    **A:** Split design — color label on left, small chevron button on right with divider.

## 3. Research
### Domain
See DL-099 Section 3 for prior research on Inline Editing UX, Data Table Interaction Patterns, Status Toggle UX. Incremental additions below.

### Sources Consulted
1. **WCAG 2.1 — 1.4.3 Contrast (Minimum)** — Text and images of text must have 4.5:1 contrast ratio. Blanket opacity on table rows fails this for small text.
2. **Inclusive Design Patterns (Heydon Pickering)** — Interactive elements need keyboard access (Tab/Enter/Escape), visible focus indicators, and ARIA roles.
3. **Linear/Notion admin panels** — Split badge pattern: status color pill + separate action trigger with visual divider. Common in task management UIs.

### Key Principles Extracted
- **Surgical dimming** — dim secondary data, keep primary identifiers (name, status) fully legible
- **Keyboard parity** — every mouse interaction must have a keyboard equivalent
- **Action affordance** — interactive elements should look different from static ones (the chip, the chevron)

### Patterns to Use
- **Split pill badge:** `[label pill] | [▾ button]` — clear separation of display vs action
- **CSS-only dropdown positioning:** `position: absolute` relative to parent, no JS measurement needed
- **Indeterminate checkbox state:** `checkbox.indeterminate = true` when partial selection

### Anti-Patterns to Avoid
- **Blanket opacity:** Dims everything including text that needs to be readable
- **Orphaned JS functions:** Dead code (`toggleSuppressMenu`) confuses future maintainers

### Research Verdict
Fix accessibility first (contrast + keyboard), then bugs (checkbox desync), then UX (actionable chip + better labels), then visual polish (split badge + tokenize CSS). Incremental commits per category.

## 4. Codebase Analysis
* **Existing Solutions Found:** `positionFloating()` used for status menu — will be replaced with CSS positioning. `editClientMax` pattern already has proper keyboard handling — extend to date cell.
* **Reuse Decision:** Reuse `showConfirmDialog`, `showAIToast`, `updateReminderSelectedCount` patterns. Replace `positionFloating` with pure CSS.
* **Relevant Files:**
  - `admin/js/script.js` — all reminder tab logic
  - `admin/css/style.css` — reminder styles
  - `admin/index.html` — bulk actions bar
* **Dependencies:** None (frontend-only changes)

## 5. Technical Constraints & Risks
* **RTL layout:** Split badge must render correctly in RTL — use `border-inline-start` not `border-left`
* **CSS positioning:** Switching from `position: fixed` (with JS measurement) to `position: absolute` — dropdown must not clip inside overflow containers. The `.reminder-status-dropdown` parent has `position: relative` already, so this should work.
* **Breaking Changes:** None — all changes are progressive enhancement

## 6. Proposed Solution (The Blueprint)

### A. Accessibility (Priority 1)
1. Replace `tr.reminder-row-suppressed td { opacity: 0.6 }` with surgical dimming — name + status full opacity, other cols use `color: var(--gray-400)`
2. Add `tabindex="0"`, `role="button"`, `aria-label="ערוך תאריך"` + keydown handler to date cells
3. Add `aria-label` to inline date editor save/cancel buttons
4. Add Escape-to-close + focus-return to `toggleStatusMenu()`

### B. Bug Fixes (Priority 2)
5. Fix checkbox desync: `toggleReminderSelectAll` syncs section header checkbox. Individual checkbox changes recalculate both masters with indeterminate state.
6. Verify accordion trigger stopPropagation on section header checkbox

### C. UX Improvements (Priority 3)
7. Make muted warning chip clickable → `deselectMutedClients()` → uncheck muted, update count
8. Bulk suppress confirm: `'אשר'` → `'השתק'`
9. Toast labels: `suppress_forever` → `'תזכורות הופסקו'`, `unsuppress` → `'תזכורות הופעלו מחדש'`

### D. Visual Polish (Priority 4)
10. Split status badge: `[label] | [▾]` with divider line
11. CSS-only dropdown positioning (remove `positionFloating` call)
12. Bulk "ללא תזכורות" button → warning-outline style
13. Tokenize magic numbers (3px→sp-1, 10px→sp-3, 99px→radius-full, 12px→text-xs, 15px→16px)
14. Delete dead `toggleSuppressMenu` function
15. Improve `.suppress-menu` border + padding

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Items 2-5, 7-9, 10-11, 14 |
| `admin/css/style.css` | Modify | Items 1, 12-13, 15 |
| `admin/index.html` | Modify | Item 12 (bulk button class) |

## 7. Validation Plan
* [ ] Suppressed row: name + status legible, secondary cols dimmed but readable
* [ ] Tab to date cell → Enter opens editor → type date → Enter saves
* [ ] Escape on date editor → cancels, restores original
* [ ] Tab to status chevron → Enter opens dropdown → Escape closes + focus returns
* [ ] Save/cancel buttons in date editor have aria-labels
* [ ] Section header checkbox: check → all rows + in-table checkbox checked
* [ ] In-table checkbox: check → section header checkbox synced
* [ ] Individual row checkbox: partial → both masters show indeterminate
* [ ] Click muted warning chip → muted clients deselected → chip hides
* [ ] Bulk suppress confirm says "השתק" not "אשר"
* [ ] Suppress toast: "תזכורות הופסקו". Unsuppress toast: "תזכורות הופעלו מחדש"
* [ ] Split status badge renders: [פעיל | ▾] with divider in both active + suppressed states
* [ ] Status dropdown opens below badge via CSS, no JS positioning
* [ ] Bulk "ללא תזכורות" button has warning-outline style
* [ ] No references to `toggleSuppressMenu` remain in codebase
* [ ] All magic numbers in reminder CSS replaced with design tokens
* [ ] RTL: split badge + dropdown render correctly

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation.*
