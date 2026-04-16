# Design Log 247: Tab Switching Performance & Loading Indicators
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-09
**Related Logs:** DL-167 (skeleton loading), DL-175 (prefetch pattern), DL-238 (unified AI review)

## 1. Context & Problem
Switching between admin panel tabs (AI Review, Questionnaires, Dashboard, Reminders, Send) feels slow because every tab load shows a full-screen blocking overlay ("טוען סיווגים...", "טוען שאלונים...", etc.) even when data is already cached or being prefetched. The overlay blocks the entire UI with a dark backdrop + blur — appropriate for user-initiated actions but overkill for tab navigation.

Root causes:
1. **AI review not prefetched** — dashboard prefetches 3 tabs (pending, questionnaires, reminders) but NOT AI classifications, so first AI review visit always blocks
2. **No request deduplication in tab loaders** — `deduplicatedFetch()` exists in resilient-fetch.js but tab loaders use `fetchWithTimeout()` directly, so if prefetch is in-flight and user clicks tab, a duplicate request fires with full-screen overlay
3. **Full-screen overlay for ALL loads** — `showLoading()` used for both tab navigation AND user actions (save, send, approve), making tab switches feel as heavy as mutations
4. **Filing type switch triggers overlay** — `switchEntityTab()` invalidates flags and calls load functions with `silent=false`, showing full-screen overlay for what should be a quick filter change

## 2. User Requirements
*Q&A from discovery phase:*
1. **Q:** Which tabs feel slow — first visit only or every switch?
   **A:** All tabs equally
2. **Q:** Behavior for switching to already-loaded tab?
   **A:** Instant show cached data, refresh silently in background (stale-while-revalidate)
3. **Q:** Should we prefetch AI review from dashboard load?
   **A:** Yes — prefetch from dashboard so tab is instant when clicked
4. **Q:** Wire in `deduplicatedFetch()` to prevent duplicate requests?
   **A:** Yes — replace fetchWithTimeout with deduplicatedFetch in all 5 tab loaders

## 3. Research
### Domain
Perceived Performance, Loading UX, Stale-While-Revalidate Pattern

### Sources Consulted
1. **web.dev: Stale-While-Revalidate** — "Serve cached version immediately (fast!), kick off background request to refresh." The pattern eliminates perceived latency for repeat visits while keeping data fresh.
2. **UI Deploy: Skeleton Screens vs. Spinners** — Users perceive skeleton screens as 30% faster than spinners with identical load times. Full-screen overlays are the worst offender — they block all interaction and signal "the app is broken."
3. **Pencil & Paper: UX Loading Patterns** — Match loading indicator to scope: full-screen for app-level blocking, inline for content areas, none for cached data. "Active waiting" (seeing stale content) feels shorter than "passive waiting" (staring at spinner).
4. **Boldist: Loading Spinner UX Killer** — "A loading spinner is not a loading indicator — it's a failure indicator." Replace with content-aware placeholders that maintain layout continuity.

### Key Principles Extracted
- **Show something immediately** — stale data > spinner > blank screen. Users tolerate outdated data better than blocked UI.
- **Match indicator to scope** — tab content refresh should use inline indicator, not app-level overlay. Full-screen overlay signals "serious operation in progress."
- **No indicator for cached data** — if data exists in memory, show it instantly with zero loading state. Background refresh is invisible.
- **Prevent duplicate work** — deduplicate in-flight requests so prefetch and user-triggered fetch share the same promise.

### Patterns to Use
- **Stale-While-Revalidate (SWR):** Show cached data immediately on tab switch, refresh silently. Only update DOM if data actually changed (fingerprint comparison).
- **Request Deduplication:** Use existing `deduplicatedFetch()` so prefetch and explicit load share one promise.
- **Inline Loading:** Small spinner or opacity fade in tab content area, not full-screen overlay.

### Anti-Patterns to Avoid
- **Full-screen overlay for navigation** — blocks all UI, feels like a crash. Reserve for mutations only.
- **Skeleton on every tab switch** — skeletons are for first-ever loads. Once data is cached, showing a skeleton is a regression.
- **Double fetch on race** — prefetch fires, user clicks tab, second identical request fires. Waste of bandwidth and time.

### Research Verdict
Implement stale-while-revalidate for all 5 tab loaders. Show cached data instantly on tab switch, refresh silently. Use `deduplicatedFetch()` to prevent duplicate requests. Reserve full-screen overlay exclusively for user-initiated mutations. Add AI review to the prefetch list.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `deduplicatedFetch()` in `assets/js/resilient-fetch.js:211` — ready to use, handles in-flight promise sharing for GET requests
  - `sessionStorage` cache in `resilient-fetch.js:228` — exists for view-documents, not used by admin
  - AI review already has fingerprint comparison (lines 2683-2695) — skip DOM rebuild if data unchanged
  - `silent` parameter pattern in all 5 loaders — already provides the gating logic, just needs refinement
  - Dashboard prefetch at lines 586-590 — already prefetches 3/5 tabs, just needs AI review added
* **Reuse Decision:** Extend existing `deduplicatedFetch` + `silent` pattern. No new abstractions needed.
* **Relevant Files:**
  - `admin/js/script.js` — all 5 tab load functions + `switchTab()` + `switchEntityTab()`
  - `assets/js/resilient-fetch.js` — `deduplicatedFetch()` (already exists, unused by admin)
  - `admin/css/style.css` — `.loading-overlay` styles
  - `admin/index.html` — loading overlay HTML
* **Alignment with Research:** The codebase already has the building blocks (dedup, silent mode, fingerprint). We're wiring them together, not building from scratch.

## 5. Technical Constraints & Risks
* **Security:** No auth changes. Token handling unchanged.
* **Risks:**
  - Filing type switch for send/questionnaires/reminders fetches server-side filtered data — can't show stale data from wrong filing type. Will show brief inline spinner for these cases.
  - `deduplicatedFetch` only deduplicates GET requests. `loadReminders` uses POST — need URL+body key or keep using `fetchWithTimeout` for it.
* **Breaking Changes:** None. `showLoading`/`hideLoading` still used for mutations.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Tab switches feel instant — no full-screen overlay on navigation. AI review loads without blocking. Cached tabs show immediately with silent background refresh.

### Logic Flow
1. **Prefetch AI review** from dashboard load (add to existing prefetch block)
2. **Replace `fetchWithTimeout` with `deduplicatedFetch`** in 4 GET-based tab loaders (dashboard, pending, AI review, questionnaires). Keep `fetchWithTimeout` for reminders (POST).
3. **Remove `showLoading`/`hideLoading` from tab load functions** — never show full-screen overlay during tab navigation
4. **Add stale-while-revalidate to `switchTab()`** — when `*Loaded` is true, call load function with `silent=true` (background refresh), not skip entirely
5. **For filing type switch** — show brief inline tab loading state instead of full-screen overlay
6. **Keep full-screen overlay** for: login, bulk send, bulk import, mark complete, save settings, rollover, PDF split — all user-initiated mutations

### Detailed Changes

#### A. `switchTab()` — SWR on tab switch (lines 178-189)
Current: `loadDashboard(dashboardLoaded)` — if loaded, passes `true` which skips the fetch entirely.
New: Always call load function. If loaded, show cached data instantly + fire silent background refresh.

```
// Before:
loadDashboard(dashboardLoaded);  // true = skip entirely

// After:
loadDashboard(true);  // always silent — show cached, refresh in background
```

Wait — this changes behavior. Currently `loadDashboard(true)` with `dashboardLoaded=true` returns immediately (line 534). We need to change the load functions to support SWR mode.

Better approach: Add a third mode to the load functions. The `silent` param currently means:
- `false` = show overlay + fetch
- `true` + already loaded = skip entirely
- `true` + not loaded = fetch silently (no overlay)

We need: `true` + already loaded = show cached data + fetch silently in background.

Change the early-return guard in each load function:
```javascript
// Before (line 534):
if (silent && dashboardLoaded && clientsData.length > 0) return;

// After:
// No early return — always fetch when called. Silent just means "no overlay."
// The *Loaded flag is only used by switchTab to decide silent vs non-silent.
```

But this would cause every tab switch to re-fetch. We need a smarter guard.

**Revised approach:** Use a timestamp-based staleness check. If data was loaded within the last 30 seconds, skip the refresh entirely. Otherwise, refresh silently.

```javascript
let dashboardLoadedAt = 0;
const STALE_AFTER_MS = 30000; // 30 seconds

async function loadDashboard(silent = false) {
    const isStale = Date.now() - dashboardLoadedAt > STALE_AFTER_MS;
    if (silent && dashboardLoaded && !isStale) return; // Fresh cache — skip
    // If silent and loaded but stale — continue fetching silently (SWR)
    // If not silent — show... inline indicator? No — removed overlay from tab loads
    ...
}
```

This keeps the early-return for very recent data but allows background refresh for stale data.

#### B. Remove `showLoading`/`hideLoading` from the 5 tab load functions
Replace with nothing (silent mode) or a brief inline indicator for first-ever loads.

For first-ever load (no cached data at all), show a lightweight inline loading state inside the tab's content area.

#### C. Add AI review to prefetch (line 586)
```javascript
if (!aiReviewLoaded) loadAIClassifications(true);
```

#### D. Use `deduplicatedFetch` in 4 GET-based loaders
Replace `fetchWithTimeout(url, opts, timeout)` with `deduplicatedFetch(url, opts, timeout)`.

#### E. `switchEntityTab()` — inline loading instead of overlay (lines 1160-1164)
Currently calls `loadPendingClients()` / `loadQuestionnaires()` / `loadReminders()` without `silent`, triggering overlay.
Change to pass `silent=false` but since we've removed the overlay from these functions, they'll just fetch without blocking.

For the brief period while new filing-type data loads, add a subtle opacity fade on the tab content:
```javascript
tabContent.style.opacity = '0.5';
// after load:
tabContent.style.opacity = '1';
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | All 5 load functions: remove showLoading/hideLoading, add staleness check, use deduplicatedFetch. switchTab(): always pass silent=true. switchEntityTab(): add opacity transition. Add AI review prefetch. |
| `admin/css/style.css` | Modify | Add `.tab-content.loading` opacity transition class |

### Final Step (Always)
* **Housekeeping:** Update design log status, copy unchecked Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Switch to AI Review tab on first visit — no full-screen overlay, data loads inline
* [ ] Switch back to Dashboard after visiting AI Review — instant, no loading indicator
* [ ] Switch filing type (AR → CS) — no full-screen overlay, brief opacity fade, data refreshes
* [ ] Rapid tab switching — no duplicate API calls (check Network tab)
* [ ] After 30+ seconds on a tab, switch away and back — silent background refresh fires
* [ ] User actions (bulk send, save settings, mark complete) still show full-screen overlay
* [ ] Auto-refresh (5-min interval) still works silently
* [ ] Page visibility return still refreshes data silently
* [ ] AI Review tab loads instantly after dashboard has loaded (prefetched)
* [ ] Reminders tab (POST-based) still works correctly without deduplicatedFetch

## 8. Implementation Notes (Post-Code)
* Fixed `deduplicatedFetch` to clone responses — original implementation returned same Response object which can only be `.json()`'d once
* Dashboard URL has `_t=${Date.now()}` cache-buster that prevents dedup — kept using `fetchWithTimeout` for dashboard, used `deduplicatedFetch` for pending/AI review/questionnaires (GET without cache-busters)
* Reminders uses POST — kept using `fetchWithTimeout` (dedup only works for GET)
* `switchEntityTab` now uses `.tab-refreshing` opacity fade + `.then()` on load promises for cleanup
* Background refresh and visibility handlers reset `*LoadedAt = 0` instead of `*Loaded = false` to trigger SWR through staleness check
* Year-change recursive call in dashboard also resets timestamps
