# Design Log 053: AI Review Tab Silent Refresh
**Status:** [IMPLEMENTED]
**Date:** 2026-02-23
**Related Logs:** 037 (Admin Portal UX Refactor), 044 (Error Handling Architecture), 036 (AI Classification Review Interface)

## 1. Context & Problem

When switching to the AI review tab in the admin portal, a full-screen blocking overlay appears **every time**. All other data-loading tabs use a `silent` parameter for background refresh on tab switch:

| Tab | Function | Silent? |
|-----|----------|---------|
| Dashboard | `loadDashboard(true)` | ✅ Yes |
| Review | `loadDashboard(true)` | ✅ Yes |
| Send | `loadPendingClients(true)` | ✅ Yes |
| **AI Review** | `loadAIClassifications()` | ❌ **No** |
| Import | (no refresh) | N/A |

The `loadAIClassifications()` function (line 978 of `admin/js/script.js`) always calls `showLoading()` which creates a full-screen blocking overlay. The `aiReviewLoaded` flag (line 976) already exists but is never used to gate loading behavior.

Design log 037 (Q2) originally specified "Fresh each time. Load from API when tab is clicked. Always current." — this was implemented correctly (fresh data), but the blocking overlay was never switched to silent mode for repeat visits.

## 2. User Requirements

1. **Q:** First load behavior — show overlay or silent?
   **A:** First = overlay, repeat = silent. First visit shows loading indicator, subsequent tab switches refresh silently.

2. **Q:** Silent error handling — retry button or silent fail?
   **A:** Yes with retry button. If silent fetch fails, show inline error with retry inside tab content.

3. **Q:** Scope — just AI review or all tabs?
   **A:** All tabs should be fresh. The other tabs already have silent refresh — only AI review is broken.

## 3. Research

### Domain
Tab-based Admin UI, Background Data Refresh, Loading State UX

### Sources Consulted
1. **NN/G — Progress Indicators** — Show indicators only for delays >1 second. Below that, silent refresh is less distracting.
2. **Optimistic UI Patterns (Simon Hearne)** — Decouple feedback from network timing. Update UI immediately, reconcile in background.
3. **Tabs UX Best Practices (Eleken)** — Preserve tab state without blocking. Background data syncing should be transparent.

### Key Principles Extracted
- Silent refresh for repeat visits (data already visible, just update in background)
- First visit needs loading indicator (no data to show yet)
- Silent error = keep existing data visible, don't replace with error screen

### Patterns to Use
- **`silent` parameter pattern:** Already established in `loadDashboard(silent)` and `loadPendingClients(silent)` — just replicate for `loadAIClassifications(silent)`

### Anti-Patterns to Avoid
- **Replacing visible data with error screen on silent failure:** If background refresh fails, keep existing data visible. Don't flash an error screen.

### Research Verdict
Follow the existing `silent` pattern. No new architecture needed — this is pattern alignment.

## 4. Codebase Analysis

* **File:** `github/annual-reports-client-portal/admin/js/script.js`
* **Existing Pattern:** `loadDashboard(silent=false)` (line 117) and `loadPendingClients(silent=false)` (line 565) — wrap `showLoading`/`hideLoading` and error modals in `!silent` checks
* **Alignment:** The `silent` pattern is well-established. AI review simply wasn't given it.
* **Key flag:** `aiReviewLoaded` (line 976) — already tracks whether data has been loaded once. Perfect gate for `switchTab` to decide overlay vs silent.

## 5. Technical Constraints & Risks

* **Security:** No auth changes — same token flow
* **Risks:** Minimal — adding a parameter with default `false` preserves all existing call sites
* **Breaking Changes:** None — default behavior unchanged

## 6. Proposed Solution (The Blueprint)

### Logic Flow
1. Add `silent = false` parameter to `loadAIClassifications()`
2. Gate `showLoading()`/`hideLoading()` and error UI behind `!silent`
3. In `switchTab`, pass `aiReviewLoaded` as the silent flag
4. On silent error: log to console, keep existing data visible

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add `silent` param to `loadAIClassifications()`, update `switchTab()` |

### Specific Changes

**Line 978** — Function signature:
```javascript
async function loadAIClassifications(silent = false) {
```

**Line 979** — Gate loading overlay:
```javascript
if (!silent) showLoading('טוען סיווגים...');
```

**Line 985** — Gate hideLoading:
```javascript
if (!silent) hideLoading();
```

**Lines 1009-1023** — Gate error handling:
```javascript
if (!silent) hideLoading();
// Only replace content with error UI if not silent
if (!silent) {
    container.innerHTML = `...error HTML...`;
}
```

**Lines 110-112** — switchTab:
```javascript
} else if (tabName === 'ai-review') {
    loadAIClassifications(aiReviewLoaded);
}
```

## 7. Validation Plan

* [ ] Open admin portal → click AI review tab → should show loading overlay (first load)
* [ ] Switch to dashboard → switch back to AI review → no overlay, data refreshes silently
* [ ] Rapid tab switching → no overlay flicker, no stale loading states
* [ ] Simulate API failure on silent refresh → existing data stays visible, console error logged
* [ ] Explicit "refresh" button still shows overlay (called without silent arg)
* [ ] "Try again" button in error state still works (called without silent arg)

## 8. Implementation Notes (Post-Code)
* *To be filled after implementation.*
