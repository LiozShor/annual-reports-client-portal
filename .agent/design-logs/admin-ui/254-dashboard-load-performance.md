# Design Log 254: Dashboard Load Performance Under Scale
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-12
**Related Logs:** DL-247 (tab switching SWR), DL-175 (prefetch pattern), DL-250 (entity tab switch reload)

## 1. Context & Problem
After sending 300 questionnaires, the admin dashboard shows significant performance issues:
1. **Infinite reload loop** (fixed separately — auth guard on data-loading functions)
2. **Double dashboard load on init** — `checkAuth()` and `DOMContentLoaded→switchEntityTab()` both call `loadDashboard()`, doubling all API calls
3. **AI Review & Reminders endpoints failing** — `loadAIClassifications` and `loadReminders` throw errors under load (6+ cascading Airtable queries timing out)
4. **6.7s click handler** — login triggers dashboard + 5 parallel prefetches competing for bandwidth
5. **Full table scan for available_years** — dashboard fetches ALL Records just to extract distinct year values

## 2. User Requirements
1. **Q:** Priority scope?
   **A:** Fix all perf issues — double-load, API slowness, years query, staggered prefetches
2. **Q:** Available years optimization?
   **A:** KV cache (1hr TTL), invalidated by rollover endpoint
3. **Q:** Stagger prefetches?
   **A:** Yes — load dashboard first, fire prefetches after render
4. **Q:** Classifications/reminders timeout fix?
   **A:** Bump frontend timeout to 20s for heavy endpoints + optimize API with KV caching and parallel batch fetches

## 3. Research
### Domain
Web Performance, SWR Caching, API Query Optimization

### Sources Consulted
1. **web.dev: Stale-While-Revalidate** — serve cached immediately, refresh in background. For SPAs: must be application-level (JS), not HTTP Cache-Control. Seed caches on login, SWR for subsequent navs. Deduplicate in-flight requests by cache key.
2. **Cloudflare Workers KV Cache-Aside** — read-through pattern with tiered TTLs: static data 1h, volatile data 1-5m. Writes propagate globally in ~60s. Max 1 write/key/sec. For large tables, prefer partial (record-by-record) over full table cache.
3. **Fetch Priority API + requestIdleCallback** — `requestIdleCallback` defers prefetches until main thread idle. `fetch(url, {priority:'low'})` tells browser to deprioritize. HTTP/2 multiplexes ~100 streams, but staggering at app level is more reliable than protocol prioritization.

### Key Principles Extracted
- **Critical path first** — dashboard data is what the user needs to see. Prefetches should not compete.
- **Cache reference data** — templates, categories, years change rarely. Fetching them on every request is wasteful.
- **Parallelize independent queries** — sequential batch fetches can be parallelized when they don't depend on each other.
- **Match timeout to payload** — 10s timeout for endpoints doing 6+ Airtable queries is too tight.

### Research Verdict
Five changes: (1) fix double-load race, (2) cache available_years in KV, (3) stagger prefetches, (4) bump timeout for heavy endpoints, (5) cache DOCUMENTS table in classifications endpoint and parallelize batch fetches.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `getCachedOrFetch()` in `api/src/lib/cache.ts` — KV cache helper, already used for templates/categories
  - `invalidateCache()` in same file — already used by mutation endpoints
  - `deduplicatedFetch()` in `assets/js/resilient-fetch.js` — already wired to some loaders (DL-247)
  - `FETCH_TIMEOUTS` in `resilient-fetch.js` — defines timeout tiers (quick=6s, load=10s, slow=20s)
  - SWR guard with `STALE_AFTER_MS=30s` in all 5 loaders

* **Reuse Decision:** Reuse `getCachedOrFetch`/`invalidateCache` for years cache. Reuse `FETCH_TIMEOUTS.slow` (20s) for heavy endpoints.

* **Relevant Files:**
  - `github/annual-reports-client-portal/admin/js/script.js` — init flow, loadDashboard, prefetch logic
  - `assets/js/resilient-fetch.js` — timeout tiers
  - `api/src/routes/dashboard.ts` — available_years full table scan
  - `api/src/routes/classifications.ts` — cascading Airtable queries
  - `api/src/routes/reminders.ts` — reminder list query
  - `api/src/lib/cache.ts` — KV cache helpers
  - `api/src/routes/rollover.ts` — needs to invalidate years cache

## 5. Technical Constraints & Risks
* **Security:** No auth changes. KV cache keys are internal.
* **Risks:**
  - Stale years cache could show wrong year after rollover → mitigated by invalidation in rollover endpoint
  - Staggered prefetches mean tabs load slightly later on first visit → acceptable tradeoff
  - Changing timeouts doesn't fix root cause (slow API) → KV caching of documents reduces query count
* **Breaking Changes:** None.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Dashboard loads in <3s (was 6.7s). No "load failed" errors. No double API calls on init. Tab switches remain instant (DL-247 SWR preserved).

### Task Breakdown

#### Task 1: Fix double-load on init (frontend)
**File:** `admin/js/script.js`
- In `switchEntityTab()` (line ~1186): add guard `&& dashboardLoadedAt > 0` to skip `loadDashboard()` on initial call (before first dashboard load completes)
- Same for all other tab loaders called from `switchEntityTab` — add `&& <loadedAt> > 0` guard
- This prevents DOMContentLoaded→switchEntityTab from triggering loads that checkAuth already started

#### Task 2: Cache available_years in KV (API)
**File:** `api/src/routes/dashboard.ts`
- Replace the full-table-scan `listAllRecords('tbls7m3hmHC4hhQVy', { fields: ['year'] })` with `getCachedOrFetch(c.env.CACHE_KV, 'cache:available_years', 3600, fetcher)`
- The fetcher still does the query, but it's cached for 1 hour
- Dashboard's main reports query (filtered by year) is untouched

**File:** `api/src/routes/rollover.ts`
- Add `invalidateCache(c.env.CACHE_KV, 'cache:available_years')` after successful rollover

#### Task 3: Stagger prefetches after dashboard render (frontend)
**File:** `admin/js/script.js`
- In `loadDashboard()` (lines ~601-607): wrap the 5 prefetch calls in `setTimeout(() => { ... }, 0)` or `requestAnimationFrame`
- This lets the dashboard render first, then fires prefetches after the browser has painted
- Keep prefetches as-is (non-blocking, silent=true)

#### Task 4: Bump timeout for heavy endpoints (frontend)
**File:** `admin/js/script.js`
- `loadAIClassifications`: change `FETCH_TIMEOUTS.load` (10s) → `FETCH_TIMEOUTS.slow` (20s)
- `loadReminders`: same change

#### Task 5: Optimize classifications endpoint (API)
**File:** `api/src/routes/classifications.ts`
- **Parallelize batch report fetches:** Steps 3 and DL-239 cross-filing map (lines 142-194) both fetch REPORTS in sequential batches. Parallelize with `Promise.all` on the chunks.
- **Cache DOCUMENTS query:** The `listAllRecords(TABLES.DOCUMENTS, { filterByFormula: "{status} != 'Waived'" })` is a large unbounded query. Cache it in KV with short TTL (5 min) — mutations (approve, reject, waive) invalidate the cache.

#### Task 6 (Final): Housekeeping
- Update design log status → `[IMPLEMENTED — NEED TESTING]`
- Update INDEX
- Update `.agent/current-status.md`
- Git commit & push

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Double-load guard, stagger prefetches, bump timeouts |
| `api/src/routes/dashboard.ts` | Modify | KV-cache available_years |
| `api/src/routes/classifications.ts` | Modify | Parallelize batches, cache documents |
| `api/src/routes/rollover.ts` | Modify | Invalidate years cache |
| `api/src/routes/approve-and-send.ts` | Modify | Invalidate documents cache on approve |

## 7. Validation Plan
* [ ] Load admin dashboard — no double API calls in Network tab (1 dashboard call, not 2)
* [ ] Login from scratch — dashboard renders fast, prefetches fire after
* [ ] Fresh visit with no token — no infinite reload (auth guard fix already pushed)
* [ ] AI Review tab loads without "load failed" error
* [ ] Reminders tab loads without "load failed" error
* [ ] Year rollover → available_years updates (KV invalidated)
* [ ] classifications endpoint response time with 300+ clients (should be under 10s)
* [ ] No regression in tab switching (SWR still works)

## 8. Implementation Notes (Post-Code)
* *Playwright baseline (2026-04-12):*
  - 438 clients loaded
  - Returning user: 10 API calls (should be 5-6) — dashboard x2, classifications x3, pending x2, reminders x2
  - Fresh login: 7 API calls, no errors but all fire simultaneously
  - `loadAIReviewCount` uses `fetchWithTimeout` not `deduplicatedFetch` — causes extra classifications call
  - Auth guard fix confirmed working — no infinite reload on fresh visit
