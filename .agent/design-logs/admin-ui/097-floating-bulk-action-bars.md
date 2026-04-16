# Design Log 097: Floating Bulk Action Bars
**Status:** [DRAFT]
**Date:** 2026-03-05
**Related Logs:** [087-responsive-floating-elements](087-responsive-floating-elements.md), [086-persistent-batch-review](086-persistent-batch-review.md)

## 1. Context & Problem
When selecting multiple clients via checkboxes in the admin panel (Dashboard, Send Questionnaires, Reminders tabs), bulk action bars appear inline — either above or below the table. If the user scrolls down a long client list, the action buttons are out of view. The bars should float at the bottom of the viewport for constant accessibility.

## 2. User Requirements
1. **Q:** Which screens?
   **A:** All 3 — Dashboard, Send Questionnaires, Reminders
2. **Q:** Animation?
   **A:** Slide up from bottom edge
3. **Q:** Bar width?
   **A:** Research decides (→ content-width, not full viewport)
4. **Q:** Scroll behavior?
   **A:** Always floating at viewport bottom (never returns to inline)

## 3. Research
### Domain
Floating Action Bars, Bulk Selection UX, Material Design Snackbar Patterns

### Sources Consulted
1. **Material Design 3 (Snackbar & Bottom App Bar)** — Fixed positioning at bottom with Level 2 elevation shadow. Entry animation uses `cubic-bezier(0.05, 0.7, 0.1, 1)` (emphasized decelerate) at 300ms; exit uses `cubic-bezier(0.3, 0, 0.8, 0.15)` at 200ms.
2. **NNGroup (Animation Duration & Bulk Actions)** — Entry 300ms with ease-out, exit 200ms with ease-in. Never exceed 500ms. Bulk action bars should appear when ≥1 row selected; persist after non-destructive actions.
3. **Emplifi Soul Design System (Bulk Action Bar)** — Content-width (not full viewport), 16px buffer from bottom, reserve 108px padding at table bottom so the bar doesn't cover the last row. Center over content area, not viewport.

### Key Principles Extracted
- **Content-aligned width** — bar should match the content container width, not span the full viewport. Prevents disconnect on wide screens.
- **Entry ≠ Exit timing** — entry should be 300ms (deliberate, decelerate), exit 200ms (swift, accelerate). Asymmetry feels natural.
- **Bottom padding on scroll containers** — reserve space so the floating bar never covers the last row of data.
- **z-index hygiene** — slot between content (100) and modals/overlays (1000). Use 900.

### Patterns to Use
- **Shared CSS class (`.floating-bulk-bar`)** — one class handles position, shadow, animation. Applied via JS alongside existing visibility toggles.
- **`position: fixed` with auto-centering** — `left/right` margins with `max-width` and `margin: 0 auto`.

### Anti-Patterns to Avoid
- **Full-viewport width** — looks disconnected from content when no sidebar
- **Linear easing** — feels mechanical; always use decelerate for entry
- **Covering last table row** — must add bottom padding to table containers

### Research Verdict
Use a single `.floating-bulk-bar` CSS class with `position: fixed; bottom: 16px`, Material Design decelerate curve for entry, content-aligned max-width matching `.content` (1400px), z-index 900. Add bottom padding to table containers to prevent overlap.

## 4. Codebase Analysis
* **Existing Solutions Found:** Three separate bulk action implementations with inconsistent visibility patterns (CSS class `.visible` vs inline `style.display`). No shared floating infrastructure.
* **Reuse Decision:** Reuse existing bar HTML elements. Add shared `.floating-bulk-bar` class. Unify reminder bar to use class-based toggle.
* **Relevant Files:** `admin/css/style.css` (lines 771–779, 2406–2415, 2617–2638), `admin/js/script.js` (lines 1113–1116, 3592–3596, 4137–4171), `admin/index.html` (lines 162–171, 401–408, 474–485)
* **Existing Patterns:** Project uses `@keyframes` with `opacity + translateY` for similar animations (floatInDown 120ms, modalSlideUp 200ms). Consistent `var(--brand-50)` background + `var(--brand-200)` border across all bulk bars.
* **Alignment with Research:** Existing animations align with Material Design patterns (opacity + translate). z-index hierarchy has a gap at 900 (between header at 100 and modals at 1000) — perfect slot for the floating bar.
* **Dependencies:** None beyond CSS/JS changes.

## 5. Technical Constraints & Risks
* **Security:** None
* **Risks:** z-index 900 could conflict if future elements use same value. Inline `style.display` on `#sendActions` and `#reminderBulkActions` overrides class-based display — must be handled in JS.
* **Breaking Changes:** None. Existing functionality preserved; only positioning changes.

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. Add `.floating-bulk-bar` CSS class with fixed positioning, centering, shadow, animation
2. Add `@keyframes bulkBarSlideUp` (300ms decelerate)
3. Modify `updateClientSelectedCount()` to add/remove `.floating-bulk-bar` alongside `.visible`
4. Modify `updateReminderSelectedCount()` to switch from inline style to class-based + `.floating-bulk-bar`
5. Modify `updateSelectedCount()` to toggle `.floating-bulk-bar` on `#sendActions` when checkboxes checked
6. Add `.send-actions.floating-bulk-bar` override for flex display
7. Add bottom padding to table containers when floating bar is active
8. Add `role="toolbar"` to bulk action bar elements

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/css/style.css` | Modify | Add `.floating-bulk-bar` class, keyframe, responsive override, send-actions override, table padding |
| `admin/js/script.js` | Modify | Update 3 visibility functions to toggle `.floating-bulk-bar` |
| `admin/index.html` | Modify | Add `role="toolbar"` to 3 bulk action elements |

## 7. Validation Plan
* [ ] Dashboard: check 2+ clients → bar slides up from bottom, fixed on scroll
* [ ] Dashboard: uncheck all → bar disappears
* [ ] Reminders: check reminders → floating bar appears
* [ ] Send Questionnaires: check clients → floating bar with both buttons
* [ ] Last table row is NOT covered by floating bar
* [ ] Modals/dropdowns appear above floating bar (z-index)
* [ ] Narrow viewport (~800px) — bar fits properly
* [ ] Animation replay: uncheck all, re-check → animation plays again

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
