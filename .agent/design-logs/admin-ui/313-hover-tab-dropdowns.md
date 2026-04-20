# Design Log 313: Hover-Open Tab Dropdowns with Animation
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-20
**Related Logs:** DL-125 (tab dropdown origin), DL-87 (responsive floating elements)

## 1. Context & Problem
Admin top-nav has two click-toggle dropdowns (DL-125): `[Questionnaires]` (Send / Received) and `[Reviews]` (Pending-Approval / AI-Review). Each holds 2 sub-items. Users want hover-open with a smoother animation — the current `floatInDown 120ms ease-out` is barely perceptible and requires a deliberate click just to see the 2 sub-items.

## 2. User Requirements
1. **Q:** Trigger? **A:** Hover + click both work (hover for mouse, click as keyboard/touch fallback).
2. **Q:** Animation? **A:** Fade + slide down — `opacity 0→1` + `translateY(-6px)→0`, 180ms `cubic-bezier(.2,.8,.2,1)`, `transform-origin: top`.
3. **Q:** Close behavior? **A:** On mouse leave with ~200ms grace (bridges trigger→menu gap).
4. **Q:** Mobile? **A:** Keep tap-to-toggle on touch; gate hover with `@media (hover: hover) and (pointer: fine)`.

## 3. Research

### Domain
Menubar UX — hover intent, "diagonal problem", WAI-ARIA menubar pattern.

### Sources
1. **WAI-ARIA Authoring Practices — Menubar pattern** — hover MAY open submenus; keyboard/click MUST work independently. `aria-expanded` must stay in sync regardless of open path.
2. **Jakob Nielsen / NN-g — "Mega Menus Work Well"** — hover menus need a close delay (~200–500ms) more than an open delay, to prevent flicker as the cursor sweeps.
3. **Amazon's "triangle" / diagonal problem (Ben Kamens)** — users moving diagonally from trigger to submenu cross neighboring triggers; close-delay sidesteps the complexity here since our menus sit directly below the trigger (single-axis path).

### Patterns Used
- Open-on-hover + click-toggle parity — both paths call the same open/close helpers; `aria-expanded` kept in sync.
- Close-delay timer (200ms) on `mouseleave`; cleared on re-enter of wrapper OR menu.
- CSS-only animation via existing `.open` class toggle.
- Hover gated by media query so touch devices remain click-only.

### Anti-Patterns Avoided
- Removing click handler (would break keyboard + touch).
- Instant close on `mouseleave` (flickers across trigger/menu gap).
- Pure CSS `:hover` open (loses `aria-expanded` sync, fights click-toggle state).

## 4. Codebase Analysis
- `frontend/admin/index.html:85-104` — two `.tab-dropdown-wrapper` blocks, structure unchanged.
- `frontend/admin/js/script.js:378-401` (original) — `toggleTabDropdown` + `switchTabFromDropdown`.
- `frontend/admin/js/script.js:9323-9333` — `closeAllRowMenus` already handles closing tab dropdowns; kept.
- `frontend/admin/css/style.css:5548-5605` — `.tab-dropdown-menu` styles.
- `positionFloating(btn, menu)` reused as-is for placement.
- Mobile bottom-nav popovers (`bottomNavQuestPopover`, `bottomNavReviewsPopover`) — separate system, untouched.

## 5. Constraints & Risks
- **Risk:** Hover-open while another menu is open → closed siblings explicitly in `mouseenter` handler.
- **Risk:** `aria-expanded` drift → all open/close paths go through `openTabDropdown` / `closeTabDropdown`.
- **Breaking:** None. Click behavior preserved verbatim.

## 6. Proposed Solution

### Success Criteria
On desktop (mouse), hovering [Questionnaires] or [Reviews] opens its dropdown with a visible 180ms fade-slide. Moving away closes it after ~200ms. Click still toggles. Touch devices unchanged. `aria-expanded` stays in sync on all paths.

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/css/style.css` (~5561-5590) | Modify | Added `transform-origin: top center`; new `@keyframes tabDropdownIn` (180ms, cubic-bezier, fade + translateY); `prefers-reduced-motion` fallback. |
| `frontend/admin/js/script.js` (~378-445) | Modify | Split `toggleTabDropdown` into `openTabDropdown` / `closeTabDropdown` / `toggleTabDropdown`. Added `setupTabDropdownHover()` with 200ms close timer, sibling auto-close, gated by `matchMedia('(hover: hover) and (pointer: fine)')`. |
| `frontend/admin/js/script.js` (~10085) | Modify | Call `setupTabDropdownHover()` from DOMContentLoaded. |

## 7. Validation Plan
- [ ] Desktop Chrome: hover [Questionnaires] opens with visible fade+slide; cursor-away closes after brief delay.
- [ ] Desktop Chrome: hover [Questionnaires] → move cursor into the menu across the gap → stays open; click item → navigates + closes.
- [ ] Desktop Chrome: hover [Questionnaires], then hover [Reviews] → first closes, second opens (no two-open state).
- [ ] Click parity: click [Questionnaires] opens, click again closes; `aria-expanded` toggles correctly.
- [ ] Keyboard: Tab to trigger, Enter opens, outside-click closes.
- [ ] Touch (DevTools emulation or real phone): tap opens, hover does NOT fire; bottom-nav popovers unaffected.
- [ ] `prefers-reduced-motion: reduce` — animation shortened / no translate.
- [ ] No regression in row menus, client detail modal, or any other floating element.

## 8. Implementation Notes
- Stored close-timer on `wrapper._closeTimer` (instance property) rather than dataset, since we need the numeric timer ID.
- `closeAllRowMenus` path continues to close tab dropdowns (existing behavior) — not duplicated.
- No `aria-haspopup` change needed; HTML already declares `aria-haspopup="menu"`.
