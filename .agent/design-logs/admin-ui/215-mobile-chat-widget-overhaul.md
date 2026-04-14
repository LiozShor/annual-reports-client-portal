# Design Log 215: Mobile Chat Widget Full Overhaul
**Status:** [DRAFT]
**Date:** 2026-03-28
**Related Logs:** [212-mobile-bottom-nav-ai-review.md](212-mobile-bottom-nav-ai-review.md), [193-mobile-responsiveness-audit.md](../infrastructure/193-mobile-responsiveness-audit.md)

## 1. Context & Problem
The AI chatbot widget (FAB + chat panel) in the admin panel is completely broken on mobile:
1. **FAB hidden behind bottom nav:** Both use `z-index: 950`; FAB at `bottom: 16px` is behind the 60px-tall bottom nav
2. **Chat panel layout broken:** `inset: 0` + same z-index as bottom nav = layering conflict
3. **Keyboard covers input:** No `dvh` units, no `interactive-widget` meta, no `visualViewport` handling
4. **No safe area support:** Viewport meta lacks `viewport-fit=cover`
5. **Fixed max-height:** `max-height: calc(100vh - 140px)` doesn't account for keyboard

Natan (office worker) uses the admin panel on his phone daily and needs the AI agent to work.

## 2. User Requirements
1. **Q:** What specific problems were reported?
   **A:** All of the above — FAB hidden, panel broken, keyboard covers input. General: everything is bad.

2. **Q:** Is the chatbot currently live?
   **A:** Yes, live. The CLAUDE.md "intentionally disabled" note was outdated (removed).

3. **Q:** Who uses it on mobile?
   **A:** Natan (admin panel).

4. **Q:** Scope — quick fix or full overhaul?
   **A:** Full mobile overhaul.

## 3. Research
### Domain
Mobile Chat UX, Virtual Keyboard Handling, Responsive Admin Panels

### Sources Consulted
1. **Material Design 3 — Bottom Navigation + FAB** — FAB at elevation Level 3 (above bottom nav), 16dp above nav, 56dp size, `inset-inline-end` for RTL
2. **CSS `dvh` units + `interactive-widget` meta** — Modern approach: `100dvh` + `interactive-widget=resizes-content` makes flexbox layouts keyboard-aware without JS. Chrome 108+, Safari 16+.
3. **WhatsApp/Intercom/Zendesk mobile patterns** — Universal: 100% viewport takeover on mobile. FAB and bottom nav disappear when chat opens. Slide-up transition 300ms.
4. **Apple HIG — Tab Bars & Safe Areas** — `viewport-fit=cover` + `env(safe-area-inset-*)` with `max()` fallbacks. 96.78% browser support.
5. **Prior research (DL-193, DL-212)** — 44px min touch targets, 768px breakpoint, `env(safe-area-inset-bottom)` already on bottom nav

### Key Principles Extracted
- Full-screen takeover on mobile is the universal pattern for chat widgets
- `dvh` + `interactive-widget=resizes-content` eliminates JS keyboard handling in modern browsers
- FAB must be positioned ABOVE the bottom nav, not at the same level
- Use CSS logical properties (`inset-inline-start`) for RTL compatibility
- Always provide both gesture (swipe) and button (X) for closing — we'll start with X button only

### Patterns to Use
- **Full-screen takeover:** `height: 100dvh` + flexbox column + `flex: 1` on messages
- **Body class toggle:** `body.chat-fullscreen` to hide bottom nav when chat is open
- **Safe area padding:** `max(design-spacing, env(safe-area-inset-*))` pattern
- **visualViewport fallback:** JS listener for older browsers where `interactive-widget` isn't supported

### Anti-Patterns to Avoid
- **Same z-index for overlapping fixed elements:** Current bug. Fix: distinct z-index layers.
- **Fixed max-height on scrollable areas:** Breaks with dynamic viewport changes (keyboard). Use `flex: 1` instead.
- **`100vh` on mobile:** Includes browser chrome height. Use `100dvh` instead.

### Research Verdict
CSS-first approach: `100dvh` + `interactive-widget=resizes-content` + flexbox handles 90% of keyboard issues. Small JS fallback via `visualViewport` API for older browsers. All changes scoped to `@media (max-width: 768px)`.

## 4. Codebase Analysis
* **Existing Solutions Found:** Bottom nav safe area support already uses `env(safe-area-inset-bottom)` (line 5103). Chat panel already has mobile media queries (lines 5049-5074) — just broken.
* **Reuse Decision:** Extend existing CSS structure. Reuse `--sp-*`, `--radius-*`, `--brand-*` variables. Reuse `toggleChat()` function with additions.
* **Relevant Files:**
  - `admin/css/style.css:4734-5074` — chat widget CSS + mobile overrides
  - `admin/js/chatbot.js:764-777` — `toggleChat()`, `879` — `init()`
  - `admin/index.html:6` — viewport meta tag
* **Existing Patterns:** Bottom nav hides on desktop via `display: none` + shows via media query. Chat uses `opacity`/`transform` transition for open/close.
* **Alignment with Research:** Current code violates research findings (same z-index, fixed max-height, no dvh, no safe areas). Fix aligns with all research principles.
* **Dependencies:** Bottom nav bar (DL-212), design system CSS variables

## 5. Technical Constraints & Risks
* **Security:** No security impact — CSS/layout changes only
* **Risks:**
  - `viewport-fit=cover` could cause content behind notch on OTHER pages. Mitigated: only fixed elements (bottom nav, chat) sit at edges, and both will have safe area padding.
  - `interactive-widget=resizes-content` not supported on older browsers — mitigated by `visualViewport` JS fallback.
* **Breaking Changes:** None. Desktop completely unaffected. All mobile changes are additive/replacement.

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. Update viewport meta tag with `viewport-fit=cover` + `interactive-widget=resizes-content`
2. Raise chat z-index from 950 → 960 (above bottom nav stack)
3. Replace mobile chat CSS with full-screen takeover layout
4. Add `body.chat-fullscreen` class toggle in JS to hide bottom nav
5. Add `visualViewport` keyboard fallback in JS
6. Add scroll lock when chat is open on mobile

### Z-Index Stack (After)
| Element | Z-Index |
|---------|---------|
| Bottom nav backdrop | 949 |
| Bottom nav | 950 |
| Bottom nav popover | 951 |
| Chat FAB | 960 |
| Chat panel (desktop) | 960 |
| Chat panel (mobile fullscreen) | 1000 |

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/index.html` | Modify | Add `viewport-fit=cover` + `interactive-widget=resizes-content` to meta |
| `admin/css/style.css` | Modify | Raise z-index (2 lines), replace mobile chat block (~80 lines), delete 480px block |
| `admin/js/chatbot.js` | Modify | Body class toggle, scroll lock, keyboard handler, auto-focus (~30 lines) |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update `current-status.md`

## 7. Validation Plan
* [ ] Mobile Chrome: FAB visible above bottom nav bar
* [ ] Mobile Chrome: Tap FAB → chat opens full-screen, bottom nav hidden
* [ ] Mobile Chrome: Type message → keyboard opens, input stays visible above keyboard
* [ ] Mobile Chrome: Close chat → bottom nav reappears
* [ ] Mobile Safari: Safe areas render correctly (notch devices)
* [ ] Mobile Safari: `dvh` handles keyboard correctly
* [ ] Desktop Chrome: No visual changes — panel 400px wide, FAB bottom-left
* [ ] RTL: FAB on right side on mobile (inset-inline-start in RTL = right)
* [ ] Touch targets: All buttons ≥44px
* [ ] Scroll lock: Page doesn't scroll behind open chat on mobile
* [ ] Approval cards and batch cards render correctly in fullscreen chat

## 8. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
