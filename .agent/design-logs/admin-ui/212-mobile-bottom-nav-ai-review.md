# Design Log 212: Mobile Bottom Nav + AI Review Mobile Overhaul
**Status:** [COMPLETED]
**Date:** 2026-03-28
**Related Logs:** [087-responsive-floating-elements.md](087-responsive-floating-elements.md)

## 1. Context & Problem
The admin panel's 6-tab navigation is a horizontal scrollable bar on mobile — hard to discover and use. The user wants a native-app-style bottom navigation bar with icons and labels.

Additionally, the AI review tab is broken on mobile:
- The preview panel (`.ai-review-detail`) is `display: none` at ≤768px
- `loadDocPreview()` still targets it → clicking cards does nothing
- No fallback UI exists for showing document previews on mobile

## 2. User Requirements
1. **Q:** Which tabs in the bottom nav?
   **A:** Top 4-5 tabs with a "More" menu for the rest (mobile best practice: 3-5 items max)

2. **Q:** What AI review issues on mobile?
   **A:** Everything is bad — needs full overhaul. Previews don't work at all.

3. **Q:** Bottom nav visual style?
   **A:** Match existing design system (white bg, brand-600 active, gray icons). Consistent with admin UI.

4. **Q:** At what breakpoint?
   **A:** 768px — matches existing responsive breakpoints.

## 3. Research
### Domain
Mobile Navigation Patterns, Responsive Admin Panels

### Sources Consulted
1. **Prior research (docs/mobile-responsiveness-audit-findings.md, 2026-03-26)** — Comprehensive audit covering touch targets (44px min), breakpoints, CSS Grid/Flexbox pitfalls, RTL considerations, admin panel patterns
2. **Material Design 3 — Bottom Navigation** — 3-5 destinations, icon + label, 80dp height suggested, active item highlighted
3. **Apple HIG — Tab Bars** — Fixed bottom bar, 49pt height, icon + text label, badges supported

### Key Principles Extracted
- Bottom nav should have 3-5 items max (Material/Apple agree)
- Each item needs both icon AND label for discoverability
- Active state should be clearly differentiated (color, not just size)
- Touch targets must be ≥44px (our prior audit recommendation)
- iOS safe area (`env(safe-area-inset-bottom)`) needed for notch devices
- Preview content on mobile should use full-screen modal (no split view)

### Patterns to Use
- **Bottom tab bar:** Fixed position, flexbox, equal-width items, icon above label
- **Overflow menu:** "More" button with upward popover for less-used tabs
- **Full-screen modal for preview:** Reuse existing `.ai-modal-overlay` pattern

### Anti-Patterns to Avoid
- **Hamburger menu:** Lower discoverability than bottom nav — user explicitly asked for bottom tab style
- **Horizontal scroll tabs on mobile:** Current approach, poor UX
- **Hiding preview entirely:** Current approach breaks functionality
- **Preview-only modal without actions:** User wants to review + act in one place

### Research Verdict
Bottom nav with 5 items (dashboard, import, questionnaires, AI review, more) using design system colors. AI review preview via **full-screen review modal** on mobile that includes: document preview + LLM classification info (what AI thinks) + action buttons (approve/reject/assign). Leverages existing `.ai-modal-overlay` and `.floating-bulk-bar` patterns.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `.floating-bulk-bar` — fixed-bottom element at z-index 900 (style.css:3005-3028)
  - `.ai-modal-overlay.show` — modal toggle pattern (style.css:2249-2262)
  - `getDocPreviewUrl(itemId)` — preview URL fetcher (script.js:1789)
  - `switchTab(tabName, event)` — tab switching function (script.js:139-152)
* **Reuse Decision:** Reuse modal overlay pattern for preview. Reuse `getDocPreviewUrl`. New component for bottom nav (no existing equivalent).
* **Relevant Files:**
  - `admin/css/style.css` — all responsive styles (lines 3470-3724)
  - `admin/index.html` — tab HTML (lines 62-85), preview panel (lines 609-655)
  - `admin/js/script.js` — `switchTab` (139), `loadDocPreview` (1816), badge updates (931, 1916, 3269)
  - `assets/css/design-system.css` — base `.tabs-nav`/`.tab-item` (lines 810-844)
* **Z-index system:** 900 (bulk bar), 1000 (modals), 1001 (dropdowns), 9999 (offline banner)

## 5. Technical Constraints & Risks
* **Security:** None — purely UI/CSS changes
* **Risks:**
  - Popover positioning in RTL — flexbox reverses, need to verify `left` positioning works correctly
  - Coexistence with `.floating-bulk-bar` — both fixed at bottom, need clear stacking
  - Badge duplication — 2 sets of badges must stay in sync (3 update points for AI, 1 for review)
* **Breaking Changes:** None — desktop behavior unchanged. Changes only activate at ≤768px.

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. Add bottom nav HTML + backdrop + mobile preview modal to `index.html`
2. Add CSS: bottom nav component, preview modal, media query overrides
3. Add JS: bottom nav functions, mobile preview function, badge sync, `switchTab` hook

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/css/style.css` | Modify | Add bottom nav CSS (~90 lines), preview modal CSS (~40 lines), update @media 768px |
| `admin/index.html` | Modify | Add bottom nav HTML, backdrop, mobile preview modal |
| `admin/js/script.js` | Modify | Add nav functions, preview modal, modify switchTab + loadDocPreview + badge sync |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Active TODOs"

## 7. Validation Plan
* [ ] Bottom nav appears at ≤768px, top tabs hidden
* [ ] All 5 bottom nav items work (dashboard, import, questionnaires, AI review, more)
* [ ] Questionnaires popover opens upward with 2 sub-tabs
* [ ] More popover opens with review + reminders
* [ ] Popovers close on backdrop tap / tab switch
* [ ] Active state syncs correctly (including questionnaire sub-tabs → שאלונים highlighted)
* [ ] AI review badge shows in bottom nav
* [ ] Review badge shows in More popover
* [ ] AI review card tap opens full-screen preview modal
* [ ] Preview modal: loading/error/iframe states work
* [ ] Preview modal: download + open-in-tab buttons work
* [ ] Preview modal closes on X and backdrop tap
* [ ] `.floating-bulk-bar` appears above bottom nav
* [ ] Content not hidden behind bottom nav (padding-bottom)
* [ ] Test at 375px, 480px, 768px widths
* [ ] No horizontal overflow at any width
* [ ] Desktop layout unchanged (bottom nav hidden)

## 8. Implementation Notes (Post-Code)
* Mobile preview modal footer shows simplified actions for issuer-mismatch state (no radio comparison, just reassign/reject) to keep the modal footer compact. Full comparison flow still available on the card itself.
* Used `syncAIBadge()` helper to deduplicate badge sync logic across 3 update points.
* Commit: `dcccb56` pushed to `main`.
