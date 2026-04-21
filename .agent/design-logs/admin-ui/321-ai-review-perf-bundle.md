# Design Log 321: AI Review Endpoint Perf Bundle — Scoped Docs Fetch + Memo + Idle Refresh

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-21
**Related Logs:** DL-311 (admin perf instrumentation), DL-317 (fetch-only prefetch), DL-318 (response-cache reverted), DL-247 (SWR staleness + dedup)

---

## 1. Context & Problem

`/webhook/get-pending-classifications?filing_type=all` (AI Review tab's data source) takes **14–17 s cold** per live admin-panel instrumentation (2026-04-21). DL-318 attempted a 60 s KV response-level cache on this endpoint, **shipped and reverted the same day** (commit `00310d4`) — latency *worsened* (20 s cold, 12 s warm). Root cause unresolved; investigation via Worker CPU/KV latency profiling deferred.

This DL does NOT re-attempt the response-cache approach. Instead, it delivers three low-risk orthogonal wins plus two surrounding improvements:

1. **Scope the Documents fetch** — the #1 latency cost is `listAllRecords(DOCUMENTS, {status != 'Waived'})` at classifications.ts:208–213, which scans the entire DOCUMENTS table. Only docs for reports visible in pending classifications are needed — reduce scope via report-ID filter.
2. **Memoize `buildShortName`** — regex-heavy function called per item in Step 6 (line 266+), no cross-item caching.
3. **Delete dead `loadAIReviewCount`** — DL-317 removed it from the prefetch pipeline; function still exists at script.js:2467 but is no longer invoked.
4. **Widen frontend dedup window** — `deduplicatedFetch` clears in-flight cache on `.finally()`, so prefetch (T=14s) + tab-click (T=15s) fire two requests. Cache resolved promises for 3 s post-settle to collapse these into one.
5. **Idle-refresh dialog** — global helper shows a soft refresh prompt (not a forced reload) after >5 min tab hidden + re-focused. Guards against stale data when TTL eventually rises (future DL). Respects open modals and focused inputs.

**Expected cold-path after:** ~2–4 s (variance depends on Airtable chunk processing).

---

## 2. User Requirements (Phase A)

1. **Scope:** Docs (#1), memoize (#2), delete dead `loadAIReviewCount` (#3) — all three in this DL.
2. **Dedup window:** widen `deduplicatedFetch` to cache for ~3 s post-resolve.
3. **Validation:** feature branch → `wrangler deploy` → curl + 10× tab-click test with `ADMIN_PERF=1` → ask user before merge.
4. **Idle-refresh dialog:** included in this bundle.

---

## 3. Research & Principles

- **N+1 / projection** — [Bhagwan Sahane, Medium](https://medium.com/@bvsahane89/understanding-the-n-1-problem-in-rest-api-design-causes-consequences-and-solutions-28d9d3d47860); [freeCodeCamp N+1 benchmarks](https://www.freecodecamp.org/news/n-plus-one-query-problem/). Canonical fix: collect IDs, batch-fetch by IDs. Our shape: use `reportIdSet` built at classifications.ts:131 to scope DOCUMENTS.
- **Stale-while-revalidate > hard prompts** — [InfoQ SWR pattern](https://www.infoq.com/news/2020/11/ux-stale-while-revalidate/), [LogRocket idle-timer](https://blog.logrocket.com/make-idle-timer-react-app/). Don't block user on minor staleness — soft revalidation in background. Fire idle-refresh **only on tab re-focus after >5 min hidden**, not on arbitrary keystroke idle. Offer "Continue" not just "Refresh."
- **Request dedup via in-flight promise cache** — [TanStack dedup discussion](https://github.com/TanStack/query/discussions/608), [createSharedPromise](https://dev.to/karbashevskyi/efficient-request-deduplication-with-createsharedpromise-in-jsts-fbf). Short TTL after resolve is a standard widening pattern.

---

## 4. Codebase Analysis

| File | Location | Current Behavior |
|---|---|---|
| `api/src/routes/classifications.ts` | :131 reportIdSet build; :208–213 **unscoped DOCUMENTS fetch**; :226–263 doc grouping; :266+ item build + `buildShortName` | Pipeline matches pre-DL-318. |
| `api/src/lib/classification-helpers.ts` | `buildShortName` — regex + template lookup, called per item in Step 6 | No memoization. |
| `api/src/lib/airtable.ts` | :80–92 `listAllRecords` — serial page loop | Can't parallelize without offset hints. Fix: scope via `filterByFormula`. |
| `frontend/admin/js/script.js` | :2467 `loadAIReviewCount` (dead); :909 comment notes DL-317 removal; prefetch chain at :900–945 | Function orphaned. Safe to delete. |
| `frontend/assets/js/resilient-fetch.js` | :199–225 `deduplicatedFetch` — cache cleared on `.finally()` | Widen to 3 s post-resolve. |
| `docs/ui-design-system.md` | `showConfirmDialog(msg, onConfirm, confirmText, danger)` — callback-based, no native `confirm()`/`alert()` | Reuse for idle-refresh dialog. |

No existing idle-refresh helper. Page Visibility API already used elsewhere — safe pattern. Dev tooling `localStorage.ADMIN_PERF='1'` + performance marks already in place per DL-311.

---

## 5. Technical Constraints & Risks

- **No schema change.** All work in Worker + frontend JS.
- **Airtable formula length limit (~16 KB).** Chunk large OR queries into batches of ~50. Pattern already exists at classifications.ts:144–153 (REPORTS query) — copy it.
- **Linked-field filter syntax.** DOCUMENTS.report is linked; cannot compare arrays directly. Verify during impl whether `{report_id}` rollup exists on DOCUMENTS as a queryable field. If not, use `FIND('recXXX', ARRAYJOIN({report}))`.
- **Cache invalidation scope unchanged.** Still invalidate `cache:documents_non_waived` (5 min TTL) on all existing write paths. Future DL may raise TTL once idle-refresh is live in production.
- **Idle-refresh conflict with in-progress state.** DO NOT fire dialog while a modal (`.ai-modal-overlay` or `.modal-overlay`) is open or an input/textarea/contenteditable has focus. Check before prompting.
- **No DL-318 regression.** We're only narrowing one Airtable query's filter — response shape unchanged. DL-318 regressed because it wrapped the entire handler in a `getCachedOrFetch` lambda; we avoid that shape entirely.

---

## 6. Proposed Solution

### Success Criteria

- `dl317:aiClassifications:fetch` **cold p50 ≤ 5 s** and **warm (within 3 s of prefetch resolve) ≤ 500 ms** via `localStorage.ADMIN_PERF='1'` on 10 consecutive AI Review tab clicks post-reload.
- Zero `TimeoutError` on same 10 clicks.
- `loadAIReviewCount` function removed; badge still updates correctly via `loadAIClassifications`.
- Idle-refresh dialog appears after 5 min hidden + visible, offers Refresh / Continue, does NOT fire if modal open or input focused.

### Changes

**1. Scope Documents fetch** (classifications.ts:206–213)

- After `reportIdSet` (line 131) and `clientToReports` (lines 199–204) are built, compute union `allRelevantReportIds = new Set([...reportIdSet, ...clientToReports.values().flat()])`.
- Replace single `listAllRecords(DOCUMENTS, {status != 'Waived'})` with chunked parallel calls (chunk size ~50, pattern from lines 144–153):
  ```typescript
  for each chunk of 50 report IDs:
    OR(AND({status} != 'Waived', {report_id} = 'recXXX'), …)
  Promise.all(all chunks)
  ```
- If `{report_id}` rollup is not queryable, use `FIND('recXXX', ARRAYJOIN({report}))` in the formula.
- Response shape unchanged.

**2. Memoize `buildShortName`** (classifications.ts ~line 266+)

- Add per-request `const nameMemo = new Map<string, string>()` before Step 6.
- On each `buildShortName` call, use: `memo.get(key) ?? memo.set(key, buildShortName(…)).get(key)` where `key = "${templateId}::${issuerName}"`.
- No changes to classification-helpers.ts.

**3. Delete `loadAIReviewCount`** (script.js:2467)

- Remove function body at lines 2467–2485.
- Update/remove comment at line 909.
- Grep to confirm zero call sites remain. Already verified in this DL.

**4. Widen dedup window** (resilient-fetch.js:199–225)

- Change cache entry from `Promise<Response>` to `{ promise, settledAt: number | null }`.
- On `.finally()`, set `settledAt = Date.now()` instead of deleting.
- On lookup: if cached entry exists AND (`settledAt === null` OR `Date.now() - settledAt < 3000`), reuse. Otherwise delete and create fresh.
- Still clone response per consumer (DL-247 rule preserved).

**5. New idle-refresh module + bootstrap** (idle-refresh.js + admin/index.html)

- Create `frontend/assets/js/idle-refresh.js` with `initIdleRefresh({ idleMs = 5*60*1000, ... })`.
- Track `lastVisibleAt` via `visibilitychange`. On `hidden → visible` transition, if `Date.now() - lastHiddenAt >= idleMs`, schedule dialog.
- Guard: skip if `document.querySelector('.ai-modal-overlay, .modal-overlay')` exists or `document.activeElement.matches('input, textarea, [contenteditable="true"]')`.
- Use `showConfirmDialog('ייתכן שהנתונים אינם מעודכנים — לרענן?', () => location.reload(), 'רענן', false)` with cancel action.
- Bootstrap in `frontend/admin/index.html` + cache-bust `?v=278 → v=279`.

### Files Changed

| File | Action | Notes |
|------|--------|-------|
| `api/src/routes/classifications.ts` | Modify | Scope DOCUMENTS fetch (#1); memoize buildShortName (#2) |
| `frontend/admin/js/script.js` | Modify | Delete dead `loadAIReviewCount` (#3) |
| `frontend/assets/js/resilient-fetch.js` | Modify | Widen dedup window to 3 s post-resolve (#4) |
| `frontend/assets/js/idle-refresh.js` | Create | New idle-refresh helper (#5) |
| `frontend/admin/index.html` | Modify | Include idle-refresh.js; cache-bust v=279 |
| `.agent/design-logs/admin-ui/321-ai-review-perf-bundle.md` | Create | Design log file |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-321 entry |
| `.agent/current-status.md` | Modify | DL-321 TODO + test checklist |

---

## 7. Validation Plan

Run in order on the feature branch after `wrangler deploy`:

- [ ] `./node_modules/.bin/tsc --noEmit` (Windows — NEVER bare `npx tsc`) on `api/` passes
- [ ] `cd api && npx wrangler deploy` succeeds
- [ ] `wrangler tail --format=pretty` clean on startup for 60 s
- [ ] **Curl cold path:** `curl -w '%{time_total}\n' -o /dev/null -s -H "Authorization: Bearer <admin-token>" '<worker>/webhook/get-pending-classifications?filing_type=all'` → expect < 5 s on first hit after deploy
- [ ] **10× tab-click test:** hard-reload admin, `localStorage.ADMIN_PERF='1'`, click AI Review tab 10× in a row — zero `TimeoutError`, no fetch over 5 s after the first
- [ ] **Warm path:** second AI Review tab click within 3 s of prefetch completing → `dl317:aiClassifications:fetch` < 500 ms (dedup window hit)
- [ ] **Parity checks:**
  - [ ] AI Review cards still render for pending classifications
  - [ ] `pre_questionnaire` badge still shows (DL-315)
  - [ ] `shared_ref_count` chip still shows (DL-314)
  - [ ] File hash dedup still works (DL-112)
  - [ ] OneDrive "open file" still resolves
  - [ ] Tab badge count matches AI Review card count (no `loadAIReviewCount` regression)
- [ ] **Idle-refresh:**
  - [ ] Hide admin tab for 6 min, return → dialog appears
  - [ ] Dialog does NOT appear if a modal is open
  - [ ] "המשך" dismiss resets 5-min timer
  - [ ] "רענן" reloads page
- [ ] **Ask user before merging to main.** Per user memory feedback_ask_before_merge_push.md.

---

## 8. Implementation Notes (Post-Code)

To be populated during Phase D after deploy.
