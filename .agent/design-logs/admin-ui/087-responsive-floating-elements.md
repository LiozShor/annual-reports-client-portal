# Design Log 087: Responsive Floating Elements — Viewport-Aware Popovers & Dropdowns
**Status:** [IN PROGRESS]
**Date:** 2026-03-04
**Related Logs:** [082-clickable-ui-audit](082-clickable-ui-audit.md), [055-sortable-headers-clickable-stage-badges](055-sortable-headers-clickable-stage-badges.md)

## 1. Context & Problem
On narrow desktop viewports (~800-1200px, e.g., half-screen browser), floating elements (popovers, dropdowns) get cut off because they use fixed positioning without any viewport boundary checking. The stage dropdown, docs popover, evidence tooltip, and suppress menu all position below the trigger element without checking whether there's actually enough space below, or whether the element overflows horizontally.

## 2. User Requirements
1. **Q:** What viewport size is this mainly about?
   **A:** Narrow desktop (browser resized to half-screen)
2. **Q:** Which elements are problematic?
   **A:** All popovers/dropdowns across all tabs, not just /admin dashboard
3. **Q:** Preferred approach when popover doesn't fit?
   **A:** Research first, then decide (user chose custom utility function after seeing options)
4. **Q:** Should the table itself adapt?
   **A:** Keep horizontal scroll as-is
5. **Q:** Content adaptations for docs popover?
   **A:** Just constrain height + scroll — no collapsed groups

## 3. Research
### Domain
Responsive Popover/Dropdown Positioning, Floating UI Patterns, CSS Anchor Positioning

### Sources Consulted
1. **Floating UI docs (flip/shift/size middleware)** — The gold standard for positioning floating elements. Canonical middleware order: offset → flip → shift → size. `flip()` switches side when no room; `shift()` slides along axis to stay in viewport; `size()` constrains dimensions to available space.
2. **Nielsen Norman Group (Menu Design, Bottom Sheets)** — Don't cover entire screen on desktop. Click activation, not hover. Bottom sheets are mobile-only pattern. Content popovers should stay under 250 characters for supplementary info.
3. **Radix UI Popover** — Exposes CSS custom properties `--radix-popover-content-available-height/width` for dynamic sizing. Collision-aware `data-side` attribute enables directional animations. Anti-pattern: fixed width/height prevents collision detection from working.
4. **GitHub Primer Design System** — Explicit popover-to-bottom-sheet transition at mobile breakpoints via `mobileVariant="bottomSheet"`. For desktop, uses flip+shift. Safe area insets for notched devices.
5. **CSS Anchor Positioning (2026 state)** — Now 81% browser support (Chrome 125+, Firefox 147+, Safari 26+). `position-try-fallbacks: flip-block` for vertical flip. Still lacks parity with JS solutions for shift behavior. Future direction but Floating UI is more mature.

### Key Principles Extracted
- **Flip+Shift is universal** — every major product (GitHub, Notion, Stripe) implements it. It's the baseline expectation.
- **Measure first, position second** — use `getBoundingClientRect()` on both trigger AND floating element to compute available space in all directions before committing to a position.
- **Size constraining prevents overflow** — dynamically set `max-height` based on available viewport space, not a fixed value.
- **`limitShift()` prevents visual detachment** — without it, a popover can slide so far along the axis it appears disconnected from its trigger.
- **8px viewport padding minimum** — popovers touching the viewport edge look broken. Always maintain at least 8px buffer.

### Patterns to Use
- **`positionFloating()` utility:** Single reusable function that applies flip, shift, and size-constrain to any floating element.
- **Direction-aware animation:** Use `data-side` attribute on popovers to animate from the correct direction (slide down when below, slide up when above).
- **`overflow-y: auto` with dynamic max-height:** Let the browser handle scrolling within the constrained popover.

### Anti-Patterns to Avoid
- **Fixed max-height (current: 340px):** Doesn't account for actual available space — a popover near the bottom of viewport overflows even though 340px was meant to be "safe".
- **No measurement of floating element dimensions:** Current code positions based only on trigger rect, never checks if the floating element actually fits.
- **Bottom sheets on desktop:** NNG explicitly warns against this — feels wrong at desktop widths. Reserve for < 640px.

### Research Verdict
Implement a lightweight `positionFloating()` utility that applies the three core strategies (flip, shift, size-constrain) using vanilla JS. No external dependencies. The doc combobox dropdown already implements a partial version of this (flip only) — we'll generalize that pattern and apply it uniformly to all 4 floating elements.

## 4. Codebase Analysis
### Relevant Files
| File | What it contains |
|------|-----------------|
| `admin/js/script.js` L388-430 | `openStageDropdown()` — no boundary checking |
| `admin/js/script.js` L534-611 | `toggleDocsPopover()` — no boundary checking |
| `admin/js/script.js` L1359-1372 | `positionDropdown()` (doc combobox) — HAS flip logic, partial model |
| `admin/js/script.js` L3150-3157 | `toggleSuppressMenu()` — absolute positioning, no boundary checking |
| `admin/js/script.js` L3852-3891 | Evidence tooltip IIFE — has left-edge check only |
| `admin/css/style.css` L448-458 | `.stage-dropdown` — fixed, min-width 190px |
| `admin/css/style.css` L2495-2527 | `.suppress-menu` — absolute, min-width 140px |
| `admin/css/style.css` L3268-3281 | `.docs-popover` — fixed, min-width 260px, max-height 340px (hardcoded) |

### Existing Patterns
- All fixed-position floating elements use the same pattern: `getBoundingClientRect()` on trigger → set `top`/`right`/`left` on floating element
- The doc combobox dropdown (L1359) is the **only one** that already checks `spaceBelow` vs `spaceAbove` and flips — we'll generalize this pattern
- Evidence tooltip has a left-edge check but no vertical flip or shift

### Alignment with Research
- Current: 0/4 fixed floating elements have boundary checking (combobox is inside a modal, different context)
- Target: 4/4 use the shared `positionFloating()` utility
- The suppress menu uses `position: absolute` — may need conversion to fixed or a different approach

## 5. Technical Constraints & Risks
* **Security:** None — purely UI positioning logic
* **Risks:** Animation direction needs to change when flipping (currently hardcoded `translateY(-4px)` assumes "below" direction). RTL layout means we use `right` instead of `left` for horizontal positioning.
* **Breaking Changes:** None — positions will be more correct, not different in behavior

## 6. Proposed Solution (The Blueprint)

### Logic Flow
1. Add a shared `positionFloating(triggerEl, floatingEl, opts)` utility at the top of the floating elements section
2. Refactor `openStageDropdown()` to use `positionFloating()`
3. Refactor `toggleDocsPopover()` to use `positionFloating()`
4. Refactor evidence tooltip IIFE to use `positionFloating()`
5. Convert suppress menu from absolute to fixed positioning + use `positionFloating()`
6. Update CSS: remove hardcoded `max-height` from `.docs-popover`, add `data-side` animation variants
7. Update the `stageDropdownIn` animation to respect direction

### `positionFloating()` API
```javascript
/**
 * Position a floating element relative to a trigger with viewport-aware
 * flip, shift, and size-constraining.
 *
 * @param {Element} triggerEl   - The element that triggered the popup
 * @param {Element} floatingEl  - The popup/popover/dropdown element
 * @param {Object}  [opts]
 * @param {number}  [opts.gap=6]         - Space between trigger and floating
 * @param {number}  [opts.padding=8]     - Min distance from viewport edges
 * @param {number}  [opts.minHeight=120] - Min height before giving up on flip
 */
function positionFloating(triggerEl, floatingEl, opts = {}) {
  const { gap = 6, padding = 8, minHeight = 120 } = opts;
  const tRect = triggerEl.getBoundingClientRect();

  // Temporarily show offscreen to measure natural size
  floatingEl.style.visibility = 'hidden';
  floatingEl.style.display = 'block';
  floatingEl.style.maxHeight = '';  // Reset for measurement
  const fW = floatingEl.offsetWidth;
  const fH = floatingEl.offsetHeight;
  floatingEl.style.visibility = '';

  const vW = window.innerWidth;
  const vH = window.innerHeight;

  // === FLIP (vertical) ===
  const spaceBelow = vH - tRect.bottom - gap - padding;
  const spaceAbove = tRect.top - gap - padding;
  const preferBelow = spaceBelow >= fH || spaceBelow >= spaceAbove;
  const top = preferBelow
    ? tRect.bottom + gap
    : Math.max(padding, tRect.top - gap - Math.min(fH, spaceAbove));

  // === SIZE (constrain height) ===
  const availableH = preferBelow ? spaceBelow : spaceAbove;
  const maxH = Math.max(minHeight, availableH);

  // === SHIFT (horizontal — RTL-aware, uses right) ===
  let right = vW - tRect.right;
  // Clamp: don't let it go past left edge or right edge
  const maxRight = vW - fW - padding;  // rightmost position
  right = Math.max(padding, Math.min(right, maxRight));

  // Apply
  floatingEl.style.top = top + 'px';
  floatingEl.style.right = right + 'px';
  floatingEl.style.left = 'auto';
  floatingEl.style.maxHeight = maxH + 'px';
  floatingEl.dataset.side = preferBelow ? 'bottom' : 'top';
}
```

### CSS Changes
```css
/* Direction-aware animation */
.stage-dropdown[data-side="bottom"],
.docs-popover[data-side="bottom"] {
    animation: floatInDown 120ms ease-out;
}
.stage-dropdown[data-side="top"],
.docs-popover[data-side="top"] {
    animation: floatInUp 120ms ease-out;
}

@keyframes floatInDown {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
}
@keyframes floatInUp {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
}

/* Remove hardcoded max-height — now dynamic */
.docs-popover {
    /* max-height: 340px; ← REMOVE, now set by positionFloating() */
    overflow-y: auto;
}

/* Suppress menu: convert to fixed positioning */
.suppress-menu {
    position: fixed;
    /* top/right set by JS */
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add `positionFloating()` utility; refactor 4 positioning call sites |
| `admin/css/style.css` | Modify | Direction-aware animations; remove hardcoded max-height; convert suppress menu to fixed |
| `docs/ui-design-system.md` | Modify | Add Section 21: Floating Element Positioning — document the utility and rules |

## 7. Validation Plan
* [ ] Stage dropdown: click badge near bottom of viewport → dropdown flips above
* [ ] Stage dropdown: click badge near right edge → dropdown shifts left to stay visible
* [ ] Docs popover: click doc count near bottom of viewport → popover flips above
* [ ] Docs popover: verify max-height adjusts based on available space (not always 340px)
* [ ] Evidence tooltip: narrow window → tooltip stays within viewport (no horizontal clipping)
* [ ] Suppress menu: click suppress button near bottom of reminders table → menu flips above
* [ ] Normal wide viewport: everything looks identical to current behavior (no regression)
* [ ] Animation direction: flipped popovers animate from correct direction (up instead of down)
* [ ] Horizontal scroll: table still scrolls horizontally on narrow screens (no change)

## 8. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
