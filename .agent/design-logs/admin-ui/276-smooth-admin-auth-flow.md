# Design Log 276: Smooth Admin Auth Flow
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-15
**Related Logs:** DL-142 (auth failure error pages), DL-265 (entity tab switch loading)

## 1. Context & Problem
When navigating to `/admin`, users who are already authenticated see a "tack tack tack" — multiple visible state changes:
1. **Login screen flashes** (HTML default: `.login-screen` visible, `.app { display: none }`)
2. JS runs `checkAuth()` → hides login, shows app (visual flip #1)
3. Dashboard data loads → content populates (visual flip #2)

This happens because the login screen is the HTML default state, and `checkAuth()` runs after the full script loads. Even for same-session users (sessionStorage shortcut, no API call), the login screen briefly renders before JS hides it.

## 2. User Requirements
1. **Q:** What scenario to fix?
   **A:** Both — same-session AND new-tab.
2. **Q:** Loading state while auth checks?
   **A:** Blank background + spinner with logo (similar style to entity tab switch bouncing dots loader, but adapted for full-page splash).
3. **Q:** Transition animation?
   **A:** Fade in (200ms opacity) from splash to app.
4. **Q:** Optimize dashboard data load?
   **A:** Yes — parallel prefetch. Start fetching dashboard data alongside token verify so data is ready when auth clears.

## 3. Research
### Domain
Auth Loading States / Flash of Unauthenticated Content (FOUC-Auth)

### Sources Consulted
1. **React Navigation Auth Flow docs** — Gate all routing behind auth-check phase; render nothing until auth state is known.
2. **Auth0 — Splash Screen for React Apps** — Keep splash under 1 second for daily users; use skeleton over spinner for long loads.
3. **Martin Fowler — Data Fetching Patterns in SPAs** — Fire non-personalized prefetches in parallel with auth check; avoid prefetching personalized HTML.

### Key Principles Extracted
- Never render route tree in indeterminate auth state — show splash until resolved
- Implement auth gate at the top level, not inline per-page
- Parallel prefetch only for data that requires the token (dashboard API requires auth header)

### Patterns to Use
- **Auth Splash Gate:** CSS hides BOTH login and app by default. A new splash screen is the only visible element. JS decides which to show.
- **Optimistic Parallel Prefetch:** For new-tab scenario, fire `loadDashboard()` in parallel with `ADMIN_VERIFY` — both use the same stored token.

### Anti-Patterns to Avoid
- **Login-first rendering:** Showing login screen as default HTML state — causes flash even for authenticated users.
- **Sequential verify-then-load:** Waiting for token verify to complete before starting dashboard fetch wastes 300-500ms.

### Research Verdict
Classic FOUC-Auth fix: CSS-hidden auth gate with splash screen. Our case is simpler than SPA routers because we have exactly two states (login vs. app) and one page. The parallel prefetch is safe because `loadDashboard()` already handles `unauthorized` responses gracefully (calls `logout()`).

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - Entity tab switch loader (DL-265): `.tab-refresh-loader` with bouncing dots — user wants similar style
  - `showLoading()`/`hideLoading()`: Full-screen overlay for operations — too heavy for auth splash
  - Skeleton loader pattern in `frontend/index.html` (landing page) — exists but not ideal for auth splash
* **Reuse Decision:** Reuse the bouncing dots keyframe animation from DL-265, create a new lightweight auth splash component
* **Relevant Files:**
  - `frontend/admin/index.html` (lines 27-41: login screen HTML)
  - `frontend/admin/js/script.js` (lines 132-248: auth section, line 667: loadDashboard, line 7448: init)
  - `frontend/admin/css/style.css` (lines 14-78: login + app CSS, lines 993-1049: tab-refresh-loader)
* **Dependencies:** `ENDPOINTS.ADMIN_VERIFY`, `fetchWithTimeout`, `FETCH_TIMEOUTS.quick`

## 5. Technical Constraints & Risks
* **Security:** No change to auth logic — only visual layer. Token still verified server-side.
* **Risks:** If parallel prefetch fails silently, dashboard may not load. Mitigated: `loadDashboard()` already handles errors.
* **Breaking Changes:** None — login flow, token storage, session flags all unchanged.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
When navigating to `/admin` with a valid session, the user sees: splash (logo + dots) → smooth fade to populated dashboard, with zero login screen flash.

### Logic Flow
1. **CSS gate:** Both `.login-screen` and `.app` start hidden. New `.auth-splash` is visible by default.
2. **`checkAuth()` rewritten:**
   - If no token → hide splash, show login (fade in)
   - If token expired → same as no token
   - If sessionStorage flag → fire `loadDashboard()`, hide splash, show app (fade in)
   - If token but no session flag → fire `ADMIN_VERIFY` + `loadDashboard()` **in parallel** via `Promise.allSettled`
     - Both OK → set session flag, hide splash, show app (fade in), dashboard data already loaded
     - Verify fails → cancel/ignore dashboard result, hide splash, show login
3. **Fade transition:** `.auth-splash` fades out while target (login or app) fades in — 200ms CSS transition on opacity.

### Data Structures / Schema Changes
None — no Airtable/API changes.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/index.html` | Modify | Add auth splash HTML (logo + bouncing dots) before login screen |
| `frontend/admin/css/style.css` | Modify | Add `.auth-splash` styles, change `.login-screen` default to `display: none`, add fade transitions |
| `frontend/admin/js/script.js` | Modify | Rewrite `checkAuth()` with splash gate + parallel prefetch logic |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update `current-status.md`

## 7. Validation Plan
* [ ] Navigate to `/admin` with valid session (same tab) — should see splash → app, no login flash
* [ ] Open `/admin` in new tab with valid localStorage token — should see splash → app (slightly longer due to verify)
* [ ] Open `/admin` with no token — should see splash → login screen (fade in)
* [ ] Open `/admin` with expired/invalid token — should see splash → login screen
* [ ] Log in from login screen — should work as before (no regression)
* [ ] Logout → should show login screen correctly
* [ ] bfcache restore (navigate away, press back) — should handle correctly
* [ ] Dashboard data should be populated when app appears (parallel prefetch)
* [ ] Mobile: same behavior on small screens

## 8. Implementation Notes (Post-Code)
* Applied FOUC-Auth pattern: CSS-hidden auth gate with splash screen visible by default
* Splash uses same `dotBounce` keyframe animation as DL-265 entity tab switch loader
* Simplified fade: only splash fades out (200ms CSS transition) — login/app appear instantly behind it since CSS can't transition from `display: none`
* Parallel prefetch: `loadDashboard()` fires alongside `ADMIN_VERIFY` via `Promise.allSettled` — dashboard data ready when auth clears
* Splash DOM element removed after fade completes (250ms timeout) to keep DOM clean
* `logout()` kept as `location.reload()` — simplest approach, splash will show briefly on reload then route to login
