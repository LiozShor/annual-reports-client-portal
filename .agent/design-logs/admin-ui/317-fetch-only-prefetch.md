# Design Log 317: Fetch-Only Prefetch for Heavy Tab Loaders
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-21
**Related Logs:** DL-311 (admin perf profile), DL-314 (SVG sprite — removed heavy loaders from prefetch as quick fix), DL-247 (SWR staleness)

## 1. Context & Problem
After DL-311 (surgical perf fixes) + DL-314 (SVG sprite), 5 heavy tab loaders (`loadPendingClients`, `loadAIClassifications`, `loadPendingApprovalQueue`, `loadReminders`, `loadQuestionnaires`) each render a table/card list at 144–663ms. When prefetched in a single `requestIdleCallback` chain, Chrome bundled them into 600–1300ms `setTimeout took Nms` violations.

DL-314's final commit shipped a quick fix: **removed** the 5 heavy loaders from the prefetch pipeline entirely. Initial dashboard load got clean, but first click on each tab now pays its full fetch+render (144–663ms) once per session.

## 2. Approach
Split FETCH (cheap async I/O) from RENDER (expensive sync DOM). Prefetch warms the in-memory data cache only; render is deferred until the user clicks the tab. Net result:
- Initial load stays clean (no render bursts, no long tasks from the 5 heavy loaders).
- First-click cost drops to render-only (~200–500ms instead of fetch+render 144–663ms).
- Cheap badge/stats updates still happen in prefetch, so users see correct counts before clicking the tab.

### User-confirmed choices
- Per-loader `everRendered` flag for the render gate (explicit, greppable).
- Parallel prefetch reusing existing `postBg` scheduler; one chain with 5 heavy loaders tacked on.
- Separate perf marks: `dl317:<name>:fetch` + `dl317:<name>:render`.
- SWR on switchTab — render cached data immediately if present; refetch in background when stale.

## 3. Scope
5 loaders in `frontend/admin/js/script.js`:

| Loader | Data var | Heavy render | Cheap (stays in prefetch) |
|---|---|---|---|
| `loadPendingClients` | `pendingClients` | `renderPendingClients()` | — |
| `loadAIClassifications` | `aiClassificationsData` | `resetPreviewPanel()` + `applyAIFilters()` | `updateAIStats`, `syncAIBadge` |
| `loadPendingApprovalQueue` | `pendingApprovalData` | `_paPage = 1; filterPendingApproval(true)` | `syncPaBadge` |
| `loadReminders` | `remindersData` | `filterReminders()` | `updateReminderStats` |
| `loadQuestionnaires` | `questionnairesData` | `filterQuestionnaires()` | `updateQuestionnaireStats` |

**Out of scope (follow-ups):**
- `loadRecentMessages` + `loadQueuedEmails` 372ms bundle on v=272 — DL-316 candidate.
- `/webhook/get-pending-classifications` intermittent 504s — unrelated server-side issue.

## 4. Implementation Summary

### 4a. Signature change
Each of the 5 loaders gains a second optional param:
```js
async function loadX(silent = false, prefetchOnly = false)
```
- `switchTab` callers stay `loadX(true)` — second arg defaults to `false`, so click-triggered behavior unchanged.
- Prefetch pipeline calls `loadX(true, true)` — fetch + cache only.

### 4b. SWR render gate (prepended to each loader)
```js
if (!prefetchOnly && xLoaded && !xEverRendered) {
    const _tR = perfStart();
    <heavy render>;
    xEverRendered = true;
    perfEnd('dl317:x:render', _tR);
}
```
Fires once per session on the first click after a prefetch landed. If the user clicks before prefetch lands (`!xLoaded`), the SWR branch no-ops and the subsequent fetch path handles render inline.

### 4c. Fetch block
Wrapped in `dl317:x:fetch` perf marks (both success and catch paths close the mark). Render block now gated behind `if (!prefetchOnly)` — sets `xEverRendered = true`.

### 4d. Prefetch pipeline (line ~902 in script.js)
Added 5 heavy loaders to the existing `postBg`-staggered chain:
```js
() => loadPendingClients(true, true),
() => loadAIClassifications(true, true),
() => loadPendingApprovalQueue(true, true),
() => loadReminders(true, true),
() => loadQuestionnaires(true, true),
```
**Removed `loadAIReviewCount()` from the pipeline** — `loadAIClassifications(true, true)` hits the same endpoint via `deduplicatedFetch` and updates the same badge via `syncAIBadge`. The standalone `loadAIReviewCount` function remains defined (not removed) in case any other caller wants it, but it no longer fires on initial dashboard load. This also kills its 407ms `setTimeout` violation observed on v=272.

### 4e. `loadAIClassifications` — special handling
Badge + stats are cheap and produce user-visible benefit in prefetch (correct counts before the user clicks the tab), so they run unconditionally. Only `resetPreviewPanel` + `applyAIFilters` are gated behind `!prefetchOnly`. The fingerprint-based skip path (silent refresh when data unchanged) also closes the fetch perf mark before returning.

### 4f. Cache bust
`frontend/admin/index.html` line 1502: `script.js?v=272` → `v=273`.

## 5. Files Changed
- `frontend/admin/js/script.js` — 5 loader refactors + prefetch pipeline update + 5 new `*EverRendered` flags.
- `frontend/admin/index.html` — cache bust v=272 → v=273.

## 6. Risks / Gotchas
- **Cold click before prefetch lands (<~200ms after page load):** `xLoaded === false` so the SWR branch no-ops; the fetch path runs normally with render inline. Verified pattern against `loadPendingClients`/etc. — no regression.
- **`loadAIClassifications` fingerprint path:** silent refresh with unchanged data returns early. Added explicit `perfEnd('dl317:aiClassifications:fetch', _tF)` before that return so the perf mark always closes.
- **`loadPendingApprovalQueue`:** `_paPage = 1` pagination reset moved inside the gate — prefetch must not reset a page the user might be on (user can't be on any page before clicking the tab, but symmetry with the render block is cleaner).
- **`loadAIReviewCount` removal:** functionally redundant once `loadAIClassifications(true, true)` runs in the prefetch pipeline. Function remains defined for any ad-hoc callers; not removed from source to avoid hunting every stale reference. Safe to delete later if grep confirms no other callers.

## 7. Validation Plan
- [ ] `loadPendingClients` prefetches correctly (ADMIN_PERF console shows `dl317:pendingClients:fetch` during prefetch)
- [ ] First click on **Send** tab renders cached data (`dl317:pendingClients:render` fires once)
- [ ] `loadAIClassifications` prefetch populates `aiClassificationsData` and badge — verify AI review count on the tab shows correct number BEFORE clicking the tab
- [ ] First click on **AI Review** tab renders list without refetch
- [ ] `loadPendingApprovalQueue` prefetches, badge updates, first click renders
- [ ] `loadReminders` prefetches, stats update, first click renders
- [ ] `loadQuestionnaires` prefetches, stats update, first click renders
- [ ] Initial dashboard load: no `setTimeout >300ms` violations attributable to the 5 loaders (light-loader violations may remain — tracked in follow-up DL-316)
- [ ] SWR behavior: on stale cache, switchTab renders stale instantly + revalidates in background (wait 10+ min, switch tabs, confirm data flashes in after brief delay)
- [ ] Cold-click regression: click a tab fast (<200ms after load) — still works, pays fetch+render inline
- [ ] No duplicate renders (accordion doesn't collapse on AI Review tab switch; fingerprint comparison in loadAIClassifications still works)
- [ ] Cache-bust bumped to `v=273` in `frontend/admin/index.html`
- [ ] `loadAIReviewCount` removed from prefetch pipeline; no regression in AI badge display

## 8. Implementation Notes (Post-Code)

### Follow-ups captured but out of scope
- **DL-316 candidate:** `loadRecentMessages` + `loadQueuedEmails` bundle into 372ms long task on initial v=272 load. Same fetch-only pattern would likely fix this.
- **AI endpoint flakiness:** `/webhook/get-pending-classifications?filing_type=all` timing out intermittently. Server-side issue (probably Airtable query cost). Unrelated to this DL — cache-stale/everRendered paths still exercise correctly even if endpoint 504s.
- **`loadAIReviewCount` full removal:** pipeline reference deleted; function definition (line ~2452) left in place for safety. Candidate for removal after one release cycle confirms no external callers.
