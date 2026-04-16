# Design Log 280: Fix Mobile Bottom Nav Hidden After Login

**Status:** [IMPLEMENTED — NEED TESTING] (v2 root fix)
**Date:** 2026-04-16 (v1), 2026-04-16 afternoon (v2 root fix)
**Related Logs:** DL-212 (mobile bottom nav introduction), DL-257 (auth gate + FOUC defense), DL-276 (smooth admin auth flow), DL-281 (regressed v1 fix)

## 1. Context & Problem

The mobile bottom nav bar has stopped appearing on mobile (≤768px viewport). Users log in successfully but the nav is never visible — they can't switch tabs on mobile.

Root cause: a CSS specificity conflict introduced when DL-257 layered an inline `style="display:none"` FOUC defense on top of a `.visible` class gate without using `!important` in the CSS or clearing the inline style in JS. Inline styles beat non-`!important` class rules, so `.bottom-nav.visible { display: flex }` never wins and the nav stays hidden forever after auth.

- HTML (`frontend/admin/index.html:1026`): `<nav class="bottom-nav" id="bottomNav" style="display:none">` — inline style, specificity 1000
- CSS (`frontend/admin/css/style.css:5836`): `.bottom-nav.visible { display: flex; ... }` — class selector, specificity ~20, no `!important`
- JS (`frontend/admin/js/script.js:158` in `_showAppUI`): adds `.visible` but never clears the inline style

The bug was latent under DL-257's single-path auth flow and surfaced consistently after DL-276's rewrite consolidated all auth-success paths into `_showAppUI()`.

## 2. User Requirements

1. **Q:** Does this match your symptom — bottom nav never appears on mobile after login, even after reload?
   **A:** Yes, never appears.
2. **Q:** Which fix approach?
   **A:** Clear inline style in JS — preserves FOUC defense, matches existing `.visible` class pattern.
3. **Q:** Should the pageshow bfcache handler also reset the inline style symmetrically when hiding?
   **A:** Yes, reset symmetrically to keep state consistent across bfcache cycles.
4. **Q:** Any additional scope?
   **A:** No — keep scope tight, just fix DL-280.

## 3. Research

### Domain
Mobile Auth UI Gating, CSS Specificity. See DL-257 for prior research on bfcache/FOUC/auth gating — this log adds only the incremental CSS specificity finding.

### Sources Consulted
1. **MDN — Specificity** — Inline `style` attribute has specificity 1000, beating any class/ID selector that lacks `!important`. Prior DL-257 research didn't surface this because the old CSS path (`.app.visible ~ .bottom-nav`) wasn't being layered onto an inline style.
2. **web.dev — bfcache** (referenced DL-257) — `pageshow` with `event.persisted` is the correct hook. No new findings.
3. **CSS Working Group — Cascade and inheritance** — The only clean ways to beat inline styles are `!important` or removing the inline attribute via JS.

### Key Principles Extracted
- When JS toggles visibility via a class AND an element has an inline `display` style, JS must also clear the inline style — otherwise the class toggle is a no-op.
- "Defense in depth" (inline FOUC guard + class gate) needs an explicit unwind step, not just an additive one.

### Patterns to Use
- **Clear-inline + add-class pairing:** Whenever `_showAppUI()` reveals the nav, reset `bn.style.display = ''` before `bn.classList.add('visible')`. Inverse on hide paths.

### Anti-Patterns to Avoid
- **`!important` in responsive CSS:** Would work but pollutes the cascade and is explicitly avoided in this project. Rejected.
- **Removing the inline FOUC defense entirely:** Loses slow-connection protection DL-257 deliberately added. Rejected.

### Research Verdict
Keep the DL-257 FOUC defense in HTML, keep the `.visible` class gate in CSS, and add the missing JS step: clear the inline style on show, restore it on hide. Symmetric, minimal, no new CSS.

## 4. Codebase Analysis

* **Existing Solutions Found:**
  - `_showAppUI()` at `frontend/admin/js/script.js:155` — single choke point for all auth-success paths (login, same-session, new-tab verify). One fix location covers all entrypoints.
  - `pageshow` handler at `frontend/admin/js/script.js:263` — single hide path on bfcache restoration with expired token.
  - `.bottom-nav.visible` CSS rule at `frontend/admin/css/style.css:5836` — correct rule, only blocked by specificity.
* **Reuse Decision:** Modify existing `_showAppUI()` and `pageshow` handler in place. No new helpers, no new CSS, no HTML change.
* **Relevant Files:**
  - `frontend/admin/js/script.js` — lines 155-161 (`_showAppUI`), 263-269 (`pageshow`)
* **Alignment with Research:** The existing code is one JS assignment away from correct. Research confirms "clear inline + add class" is the canonical fix; no architectural change needed.
* **Dependencies:** None. Pure DOM manipulation on an element that's already present.

## 5. Technical Constraints & Risks

* **Security:** None — purely UI visibility. No auth logic change.
* **Risks:**
  - None. Setting `style.display = ''` removes the inline property, letting CSS take over. Setting it back to `'none'` on hide matches the HTML default.
  - No effect on desktop — CSS rule `.bottom-nav { display: none }` outside the media query still hides it at >768px regardless of the inline attribute.
* **Breaking Changes:** None.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
After login on mobile (≤768px), the bottom nav is visible and stays visible across tab switches, reloads, and valid bfcache restorations. On bfcache with expired token, it hides correctly along with the app.

### Logic Flow
1. In `_showAppUI()`, clear the inline `display:none` before adding `.visible`.
2. In the `pageshow` bfcache handler, set `display:none` back as the nav is hidden (symmetric state reset).

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | `_showAppUI()` (lines 155-161): clear `bottomNav.style.display`. `pageshow` handler (lines 263-269): set `bottomNav.style.display = 'none'` when hiding. |

### Exact Changes

**`_showAppUI()` — lines 155-161:**

```javascript
function _showAppUI() {
    _hideSplash();
    document.getElementById('app').classList.add('visible');
    const bn = document.getElementById('bottomNav');
    bn.style.display = '';
    bn.classList.add('visible');
    startBackgroundRefresh();
    safeCreateIcons();
}
```

**`pageshow` handler — lines 263-269:**

```javascript
window.addEventListener('pageshow', (e) => {
    if (e.persisted && (!authToken || isTokenExpired(authToken))) {
        document.getElementById('app').classList.remove('visible');
        const bn = document.getElementById('bottomNav');
        bn.classList.remove('visible');
        bn.style.display = 'none';
        document.getElementById('loginScreen').classList.add('visible');
    }
});
```

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items to `current-status.md` under "Active TODOs", commit on branch `DL-280-fix-mobile-bottom-nav-hidden`, merge to main, push, delete feature branch + remove worktree.

## 7. Validation Plan

* [ ] Fresh load on mobile viewport (DevTools 375px) with valid session — bottom nav visible immediately after splash fades
* [ ] Login from login screen on mobile viewport — bottom nav appears after auth completes
* [ ] Tab through dashboard → import → AI review on mobile — nav stays visible across all tabs
* [ ] Reload page on mobile with valid session (same-tab path in `checkAuth`) — nav appears
* [ ] Open /admin in a new tab with valid localStorage token (verify+prefetch path) — nav appears
* [ ] Desktop (>768px) — nav remains hidden (CSS `.bottom-nav { display: none }` still wins)
* [ ] bfcache: navigate away + back with valid token — nav still visible
* [ ] bfcache: navigate away + back after token expiry — nav hides, login screen shown, no FOUC flash on next forward nav
* [ ] Real mobile device (Safari iOS / Chrome Android) — verify no FOUC flicker of nav during login screen render

## 8. Implementation Notes (Post-Code)

* Applied "clear-inline + add-class" pairing in `_showAppUI()` and inverse in the `pageshow` bfcache handler. No CSS or HTML changes.
* Scope held tight per user answer — only `frontend/admin/js/script.js` touched.
* Added a short `DL-280:` comment at the only non-obvious line (inline-style clear) to explain why it's needed; other lines are self-explanatory from the symmetric pattern.

## 9. v2 Root Fix — 2026-04-16 afternoon

### Why v1 Failed
DL-281 (`81a1b36`) was branched off main BEFORE DL-280 merged (`5914ce0`). When DL-281 merged, its older copy of `_showAppUI()` overwrote DL-280's three-line fix with the original one-liner — the merge had no conflict because DL-281 wasn't aware of DL-280's edit. Result: bottom nav broke again within hours of being fixed.

The deeper lesson: **a JS-only fix to a CSS specificity problem is regression-prone**. Anyone editing `_showAppUI()` who copies the "obvious" pattern (`bottomNav.classList.add('visible')`) silently loses the fix. There's no compile-time signal, no test, no comment is loud enough to survive a stale branch merge.

### v2 Approach: Class-Based FOUC Gate
Move the FOUC defense from an inline `style` attribute into an explicit CSS class. The fix lives in HTML+CSS where it's structural, not in JS where it's procedural and easily clobbered.

**Before (v1):**
- HTML: `<nav class="bottom-nav" id="bottomNav" style="display:none">` — inline style
- JS: must clear `bn.style.display = ''` AND add `.visible` class — fragile pairing

**After (v2):**
- HTML: `<nav class="bottom-nav fouc-hidden" id="bottomNav">` — class-based
- CSS: `.bottom-nav.fouc-hidden { display: none; }` + `.bottom-nav.visible:not(.fouc-hidden) { display: flex; }` — `:not()` is a fail-safe (if JS forgets to remove `.fouc-hidden`, nav stays hidden, no broken UI)
- JS: `bn.classList.remove('fouc-hidden'); bn.classList.add('visible');` — symmetric, atomic

### v2 Research: Class-Based State Gating
- **MDN — CSS Specificity:** Class selectors carry the same weight (0-0-1-0) regardless of inline/external. Inline `style` attribute is 1000 — strictly higher. Class-vs-class fights resolve via cascade order, not inline override.
- **CSS Working Group — Cascade:** "Defense in depth" should compose at the same layer (CSS), not mix layers (HTML inline + CSS class). Mixing layers creates specificity asymmetry that's hard to reason about.
- **Patterns from React/Vue (precedent):** Both frameworks default to class-based state gates (`v-show`, `className`) rather than `style` because classes are mergeable and serializable. Same principle applies in vanilla JS.

### v2 Anti-Patterns Avoided
- **`!important` everywhere:** considered but rejected — pollutes the cascade and trains future devs to reach for it. The `:not()` guard provides the same fail-safe with no `!important`.
- **Removing FOUC defense entirely:** considered (CSS link is render-blocking) but rejected — DL-257 deliberately added the inline defense for slow-connection scenarios, and a CSS class costs nothing.
- **JS-only re-fix with louder comments:** rejected — comments don't survive merges.

### v2 Scope Expansion: Chat Widget Audit
DL-257 noted chat widget uses the same fragile `.app.visible ~ #chatWidget` sibling-combinator pattern. Audit confirms chat widget is NOT affected by the same inline-style bug (no inline style exists), but the sibling-combinator pattern is still implicit and fragile. Migrate chat widget to the same `.visible` class pattern for consistency and future-proofing.

### v2 Files Changed
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/index.html` | Modify | `<nav class="bottom-nav fouc-hidden" id="bottomNav">` (was: `style="display:none"`) |
| `frontend/admin/css/style.css` | Modify | Add `.bottom-nav.fouc-hidden { display: none; }` + add `:not(.fouc-hidden)` to `.visible` rule. Migrate chat widget: drop sibling-combinator, add `#chatWidget.visible` rule. |
| `frontend/admin/js/script.js` | Modify | `_showAppUI`: `remove('fouc-hidden') + add('visible')` for both bottomNav and chatWidget. `pageshow`: inverse symmetric reset. |

### v2 Why This Survives Merges
1. **HTML class is grep-able** — `fouc-hidden` is a unique token; any future merge that drops it from the `<nav>` element is visually obvious in code review.
2. **CSS `:not()` fail-safe** — if a future JS edit forgets to remove `.fouc-hidden`, nav stays hidden (safe default — user sees nothing missing rather than a flash of pre-auth UI).
3. **No JS-state-tracking** — `_showAppUI` does the obvious "remove hide class, add show class". No magic inline-style manipulation that future devs would dismiss as "weird".
4. **Symmetric pageshow handler** — bfcache restoration adds `.fouc-hidden` back, mirroring the show path. Easy to reason about.

### v2 Scrolling Behavior (Bonus User Concern)
User asked nav must "also be visible during scrolling." This is automatic once visibility works:
- `.bottom-nav.visible` is `position: fixed; bottom: 0` — viewport-anchored, scroll-immune
- `<nav class="bottom-nav">` is a direct child of `<body>` — no transform/filter parent that would break fixed positioning (which converts `position: fixed` into `position: absolute` relative to the transformed ancestor)
- Verified: no parent of `#bottomNav` has `transform`, `filter`, `perspective`, or `will-change`

No additional changes needed for scroll-persistence.
