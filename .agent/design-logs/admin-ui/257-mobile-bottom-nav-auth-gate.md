# Design Log 257: Mobile Bottom Nav — Auth Gate Fix
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-12
**Related Logs:** [212-mobile-bottom-nav-ai-review.md](212-mobile-bottom-nav-ai-review.md)

## 1. Context & Problem
The mobile bottom nav bar (introduced in DL-212) is sometimes visible on the login screen before the user has authenticated. The visibility gate relies on a CSS general sibling combinator: `.app.visible ~ .bottom-nav { display: flex }`. While correct in theory, this approach is fragile against:

1. **bfcache restoration** — Mobile browsers aggressively cache pages. On back-navigation, the browser restores DOM state including `.app.visible` without re-running JS. No `pageshow` handler exists to re-verify auth.
2. **FOUC** — The `<nav>` element has no inline `style="display:none"`, so on slow mobile connections where CSS hasn't loaded yet, the nav renders with default `display: block`.
3. **CSS sibling fragility** — The `~` combinator depends on exact DOM ordering and is easy to break if elements are moved.

## 2. User Requirements
1. **Q:** When does the bottom nav appear before auth?
   **A:** On the login screen — nav visible at the bottom while the password screen is showing
2. **Q:** What fix approach?
   **A:** JS class on `#bottomNav` — explicitly add `.visible` class after auth, remove CSS sibling selector
3. **Q:** Add pageshow bfcache guard?
   **A:** Yes — add `window.pageshow` listener to re-check auth on bfcache restoration

## 3. Research
### Domain
Mobile Auth UI Gating, Browser Page Lifecycle (bfcache)

### Sources Consulted
1. **web.dev — bfcache** — Pages restored from bfcache don't re-run scripts; `pageshow` event with `event.persisted` is the only reliable signal. DOM state (classes, inline styles) is fully preserved.
2. **MDN — General Sibling Combinator (~)** — Selects siblings after the reference element at the same level. Works correctly but is implicit — visibility depends on a different element's class, making it fragile for auth gating.
3. **Google Web Fundamentals — FOUC prevention** — Critical CSS should be inline or render-blocking. Elements that must start hidden should use inline `style="display:none"` as defense-in-depth.

### Key Principles Extracted
- Auth-gated UI should use **explicit JS control** (classList add/remove) rather than CSS relational selectors
- bfcache restoration requires `pageshow` handler to re-validate auth state
- Inline `style="display:none"` on initially-hidden elements prevents FOUC regardless of CSS load timing

### Patterns to Use
- **Explicit visibility class:** `.bottom-nav.visible { display: flex }` — same pattern already used for `.floating-bulk-bar`, `.ai-modal-overlay.show`, etc.
- **pageshow guard:** Re-check auth on bfcache restore, reset UI if token expired

### Anti-Patterns to Avoid
- **CSS sibling selectors for auth gating:** Implicit, fragile, doesn't survive bfcache
- **JS media query checks:** Don't hardcode breakpoint values in JS — let CSS handle responsive behavior

### Research Verdict
Replace CSS sibling combinator with explicit JS `.visible` class on `#bottomNav`. Add `pageshow` bfcache guard. Add inline `style="display:none"` as FOUC defense.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `.app.visible ~ .bottom-nav` (style.css:5355) — current auth gate, CSS sibling selector
  - `.app.visible ~ #chatWidget` (style.css:5968) — same pattern for chat widget
  - 3 auth completion points in script.js: login (line 167), checkAuth fast path (line 204), checkAuth API path (line 221)
  - `visibilitychange` handler (script.js:~1524) — handles tab hide/show but NOT bfcache
  - No `pageshow` handler exists
* **Reuse Decision:** Extend existing auth completion points with one extra line each. Follow existing `.visible` class pattern (used on bulk bars, modals).
* **Relevant Files:**
  - `admin/index.html` — bottom nav HTML (lines 988-1032)
  - `admin/css/style.css` — bottom nav CSS (lines 5342-5490), chatWidget (5964-5970)
  - `admin/js/script.js` — auth flow (lines 144-233), checkAuth (190-233)
* **DOM structure:** `#app` closes at line 763, `#bottomNav` at line 988-1032 — siblings under `<body>`. chatWidget between them at line 985.
* **Dependencies:** None

## 5. Technical Constraints & Risks
* **Security:** None — purely UI visibility fix, auth logic unchanged
* **Risks:**
  - Chat widget uses same `.app.visible ~` pattern — should fix it too for consistency? (Low risk if left, but same fragility)
  - bfcache guard could cause a flash of login screen for returning users with valid sessions → mitigate by checking token validity before resetting UI
* **Breaking Changes:** None — desktop behavior unchanged, mobile nav behavior only changes in timing of when `.visible` is applied

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Bottom nav never appears on mobile while the login screen is showing, even on bfcache restore or slow connections.

### Logic Flow
1. Add `style="display:none"` to `<nav class="bottom-nav">` in HTML (FOUC defense)
2. Replace CSS `.app.visible ~ .bottom-nav { ... }` with `.bottom-nav.visible { ... }`
3. In all 3 auth completion points, add `document.getElementById('bottomNav').classList.add('visible')`
4. Add `pageshow` handler: if `event.persisted` and token is expired → remove `.visible` from `#app` and `#bottomNav`, show login screen

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/index.html` | Modify | Add `style="display:none"` to `<nav class="bottom-nav">` |
| `admin/css/style.css` | Modify | Replace `.app.visible ~ .bottom-nav` with `.bottom-nav.visible` in media query |
| `admin/js/script.js` | Modify | Add `bottomNav.classList.add('visible')` in 3 auth points + add `pageshow` handler |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update current-status.md

## 7. Validation Plan
* [ ] Fresh load on mobile (no session) — login screen shows, bottom nav hidden
* [ ] Login on mobile — bottom nav appears after auth
* [ ] Refresh page on mobile (with session) — bottom nav appears correctly
* [ ] Navigate away and back (bfcache) — if session valid, nav shows; if expired, login screen shown
* [ ] Slow connection simulation (DevTools throttle) — no FOUC flash of nav
* [ ] Desktop — no regression, bottom nav still hidden on desktop
* [ ] Chat widget behavior unchanged

## 8. Implementation Notes (Post-Code)
* Commit: `0ab131d` — pushed to `main` on 2026-04-13
* All 3 auth completion points updated (login, checkAuth sessionStorage fast path, checkAuth API path)
* `pageshow` handler inserted before "Enter key to login" listener (~line 235)
* CSS comment updated to explain visibility is now JS-controlled
