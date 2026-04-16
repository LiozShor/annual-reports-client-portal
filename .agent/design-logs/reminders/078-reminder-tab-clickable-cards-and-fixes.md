# Design Log 078: Reminder Tab — Clickable Stat Cards + Mute/Max Fixes
**Status:** [DRAFT]
**Date:** 2026-03-02
**Related Logs:** DL-059 (reminder system), DL-061 (configurable limits), DL-063 (settings dialog), DL-066 (counter reset), DL-067 (next-date init)

## 1. Context & Problem
The reminder tab has stat cards (מתוזמנים, השבוע, מושתקים, מוצו) that are display-only — user wants them clickable to filter the table. Additionally, the mute/max features "don't work" — likely due to never being end-to-end tested (TODO item #1 in current-status.md has been pending since session 49).

## 2. User Requirements
1. **Q:** What's missing about mute and max edit?
   **A:** "It doesn't work"
2. **Q:** What should happen when clicking a stat card?
   **A:** Filter the table below (toggle: click to filter, click again to clear)
3. **Q:** Multiple cards selectable at once?
   **A:** No, single filter only
4. **Q:** Bulk actions on filtered results?
   **A:** Yes, same bulk actions

## 3. Research
### Domain
Dashboard Filtering UX, Interactive Stat Cards

### Sources Consulted
1. **Pencil & Paper — Dashboard Design UX Patterns** — Stat cards as master filters are a standard dashboard pattern; click-to-filter with visual highlighting
2. **PatternFly — Card Accessibility Guidelines** — Use `role="button"`, `aria-pressed`, `tabindex="0"` for interactive cards
3. **Pencil & Paper — Enterprise Filtering Patterns** — Show active filters prominently, display result count, toggle behavior with clear visual indication

### Key Principles Extracted
- Cards must have clear affordance (cursor, hover state) that they're clickable
- Active state needs multiple visual cues (not just color — border weight, background tint)
- Toggle pattern: click to activate, click same card to deactivate
- `aria-pressed` attribute for screen readers

### Patterns to Use
- **Master-detail filtering:** Card click sets filter, table responds immediately
- **Toggle button pattern:** `aria-pressed="true/false"` with visual state change

### Anti-Patterns to Avoid
- **Auto-context change without feedback:** Filter must be visually obvious (WCAG 3.2.2)
- **Color-only indication:** Active state must use border + background, not just color change

### Research Verdict
Simple toggle filter on stat cards. Sync with existing dropdown filter. Add "due_this_week" as new filter option since it's not currently in the dropdown.

## 4. Codebase Analysis
* **Relevant Files:**
  - `admin/index.html` (lines 405-426) — stat card HTML
  - `admin/js/script.js` (lines 2581-3165) — full reminder JS
  - `admin/css/style.css` (lines 2101-2139) — stat card CSS
  - n8n `[API] Reminder Admin` (WF `RdBTeSoqND9phSfo`) — backend actions
* **Existing Patterns:**
  - Cards are `div.reminder-stat-item` with color-coded left border
  - Filter dropdown (`reminderStatusFilter`) syncs with `filterReminders()`
  - `getReminderStatus(r).key` returns: `'active'`, `'suppressed'`, `'exhausted'`
* **Bugs Found:**
  - No per-row "suppress forever" button (only in bulk actions)
  - No confirmation on per-row "suppress this month"
  - Backend `unsuppress` doesn't reset `reminder_count` → exhausted clients stay exhausted after unsuppress
  - Backend `set_max` doesn't validate value is a valid number (`parseInt("abc")` → NaN)
  - Stale closure in `restoreMaxCell` after data reload (cosmetic)

## 5. Technical Constraints & Risks
* **Security:** None (admin-only panel, existing auth)
* **Risks:** Card filter must not break existing dropdown filter or bulk actions
* **Breaking Changes:** None — additive changes only

## 6. Proposed Solution (The Blueprint)

### A. Clickable Stat Cards

**HTML (index.html):**
- Add `onclick="toggleCardFilter('scheduled')"` (etc.) to each card div
- Add `role="button"`, `tabindex="0"`, `aria-pressed="false"`

**JS (script.js):**
- New global: `let activeCardFilter = null;`
- New function `toggleCardFilter(filterKey)`:
  - If same card clicked → clear filter (set to null, clear dropdown)
  - If different card → set `activeCardFilter`, update dropdown if applicable
  - Update `aria-pressed` on all cards
  - Toggle `.reminder-stat-active` class on clicked card
  - Call `filterReminders()`
- Update `filterReminders()`:
  - When `activeCardFilter` is set, use it instead of dropdown
  - `'scheduled'` → `status.key === 'active'`
  - `'due_this_week'` → `status.key === 'active'` AND `reminder_next_date <= weekFromNow`
  - `'suppressed'` → `status.key === 'suppressed'`
  - `'exhausted'` → `status.key === 'exhausted'`
- When dropdown is changed manually, clear `activeCardFilter` and card highlights

**CSS (style.css):**
- `.reminder-stat-item` → add `cursor: pointer`, `transition`, `user-select: none`
- `.reminder-stat-item:hover` → subtle background tint
- `.reminder-stat-item.reminder-stat-active` → stronger border (3px → 3px all sides or thicker left), tinted background matching the card's color family

### B. Fix Mute/Max Issues

**Frontend (script.js):**
1. **Per-row suppress options:** Replace single "suppress this month" button with a small dropdown showing both "this month" and "forever" options
2. **Confirmation on suppress:** Add `showConfirmDialog` for single-row suppress actions (matching bulk behavior)
3. **Dropdown filter sync:** When `reminderStatusFilter` changes, clear card active state

**Backend (n8n `[API] Reminder Admin`):**
1. **`unsuppress` resets count:** Add `fields.reminder_count = 0` to the unsuppress case — otherwise exhausted clients remain exhausted after unsuppress
2. **`set_max` validation:** Add `if (isNaN(parseInt(value))) return error` guard

### Logic Flow
1. User clicks stat card → `toggleCardFilter(key)` → highlights card, filters table
2. User clicks same card → clears filter, removes highlight
3. User changes dropdown → clears card highlight
4. Bulk actions work on filtered results (unchanged — checkboxes still present)

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/index.html` | Modify | Add onclick/role/tabindex/aria to stat cards |
| `admin/js/script.js` | Modify | Add `toggleCardFilter()`, update `filterReminders()`, fix suppress flow |
| `admin/css/style.css` | Modify | Add hover/active states for stat cards |
| n8n `[API] Reminder Admin` | Modify | Fix unsuppress reset + set_max validation |

## 7. Validation Plan
* [ ] Click each stat card → table filters correctly
* [ ] Click active card again → filter clears
* [ ] Only one card active at a time
* [ ] Card active state visually clear (border + background)
* [ ] Dropdown change clears card highlight
* [ ] Bulk actions work on filtered results
* [ ] Mute single client (this month) → confirmation → status updates
* [ ] Mute single client (forever) → confirmation → status updates
* [ ] Unsuppress client → count resets to 0, shows as active
* [ ] Edit max per-client → value saves correctly
* [ ] Reset max to default → works correctly
* [ ] Keyboard accessibility: Tab to card, Enter to toggle

## 8. Implementation Notes (Post-Code)

### Changes Made
1. **HTML (index.html):** Added `onclick`, `role="button"`, `tabindex="0"`, `aria-pressed="false"` to all 4 stat cards. Removed status dropdown filter (replaced by card filters).
2. **CSS (style.css):** Added `cursor: pointer`, `transition`, `user-select: none`, hover state, focus-visible outline, and per-color active states using `color-mix()` for tinted backgrounds with full 2px borders. Added `.suppress-menu` dropdown styles.
3. **JS (script.js):** Added `activeCardFilter` global, `toggleCardFilter(key)` with aria/class management, keyboard listener for Enter/Space on cards. Updated `filterReminders()` to use `activeCardFilter` instead of removed dropdown. Added `toggleSuppressMenu()`, `confirmSuppress()` with `showConfirmDialog` for per-row suppress. Added document click listener to close menus.
4. **n8n Parse Action (RdBTeSoqND9phSfo):** `unsuppress` now sets `reminder_count = 0` alongside clearing suppress. `set_max` now validates `isNaN(parsed) || parsed < 1` and throws error.

### Status
[IMPLEMENTED] — Awaiting manual testing.
