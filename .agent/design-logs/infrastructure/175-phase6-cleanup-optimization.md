# Design Log 175: Phase 6 — Cleanup & Optimization
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-24
**Related Logs:** DL-169 (Auth), DL-170 (Read), DL-171 (Write), DL-172 (MS Graph 4a), DL-173 (MS Graph 4b), DL-174 (Phase 5)

## 1. Context & Problem
The Cloudflare Workers migration is functionally complete — 20/22 endpoints run on Workers. But the admin portal still loads data lazily (one tab at a time), has no background refresh, no edge caching for slow-changing data, and 19 decommissioned n8n workflows are still active. Phase 6 addresses post-migration optimization.

## 2. User Requirements
1. **Q:** What's the scope for this session?
   **A:** Frontend prefetch + background refresh, KV cache layer for slow-changing data
2. **Q:** Decommission n8n workflows now or wait 2 weeks?
   **A:** Deactivate now — Phases 1-3 have been on Workers since session 172, all traffic is on Workers
3. **Q:** Custom domain setup?
   **A:** Keep workers.dev for now
4. **Q:** Performance benchmarks?
   **A:** Document existing timings (compile from session notes, no new measurements)

## 3. Research

### Domain
Frontend Data Prefetching, Edge Caching (Cloudflare KV), Stale-While-Revalidate Patterns

### Sources Consulted
1. **"High Performance Browser Networking" (Grigorik)** — Prefetch only high-probability next views; never compete with critical-path requests; network-aware loading
2. **Web.dev / Chrome Developers** — Visibility API for background polling; stale-while-revalidate pattern; `freeze`/`resume` events for aggressive Energy Saver tab discards
3. **Cloudflare Workers KV docs** — Eventually consistent (~60s propagation); reads 10x cheaper than writes; `expirationTtl` (min 60s) for key deletion; max 1 write/sec per key
4. **"Designing Data-Intensive Applications" (Kleppmann)** — Cache-aside pattern; write-through invalidation for read-after-write consistency; tiered TTLs by data freshness

### Key Principles Extracted
- **Prefetch after first paint, not during** — login→dashboard is critical path; prefetch other tabs only after dashboard renders
- **Stale-while-revalidate** — show cached data instantly on tab switch, revalidate in background. Invalidate cache immediately on mutations
- **Visibility-gated polling** — pause refresh when tab is hidden (saves battery, avoids throttling). Revalidate immediately on `visibilitychange` to visible
- **Tiered TTLs** — 1h for truly static data (categories, templates), short/no cache for user-specific or fast-changing data (client records, document statuses)
- **Write-through invalidation** — when a mutation endpoint modifies cached data, delete the KV key before responding

### Patterns to Use
- **Cache-aside with KV:** `getCachedOrFetch(kv, key, ttl, fetcher)` — check KV first, fetch from Airtable on miss, store result
- **Parallel prefetch:** `Promise.allSettled()` for independent tab data loads after login
- **Silent refresh:** Existing `silent=true` parameter on all load functions — reuse for both prefetch and background refresh

### Anti-Patterns to Avoid
- **Over-prefetching:** Don't prefetch AI classifications (heavy, infrequent) — only prefetch reminders + questionnaires
- **Thundering herd on reconnect:** Use `deduplicatedFetch()` (already exists in resilient-fetch.js but unused) to prevent duplicate requests on tab resume
- **Cache stampede:** Not a concern at 500 clients / single admin user — simple TTL is sufficient

### Research Verdict
Straightforward implementation using existing patterns. The codebase already has `silent` mode on all load functions, `deduplicatedFetch` utility, and cache flags. We extend these patterns rather than introducing new abstractions.

## 4. Codebase Analysis

### Existing Solutions Found
- **Cache flags:** `dashboardLoaded`, `pendingClientsLoaded`, `aiReviewLoaded`, `reminderLoaded`, `questionnaireLoaded` — all exist
- **Silent mode:** All `loadXxx(silent)` functions accept silent parameter — hides spinner, but only Dashboard and Pending actually skip fetch when cached
- **Prefetch pattern:** `loadDashboard()` already prefetches `loadPendingClients(true)` and `loadAIReviewCount()` at lines 252-255
- **`deduplicatedFetch()`:** Exists in resilient-fetch.js but unused — prevents duplicate in-flight requests for same URL
- **KV namespace:** `TOKEN_CACHE` exists but only used for token caching. Need a new `CACHE_KV` namespace

### Reuse Decision
- Extend existing cache flags + silent mode (no new pattern needed)
- Reuse `deduplicatedFetch()` for background refresh to prevent overlap
- Add cache checks to `loadAIClassifications`, `loadReminders`, `loadQuestionnaires` (currently always re-fetch)

### Relevant Files
| File | Purpose |
|------|---------|
| `admin/js/script.js` | All load functions, tab switching, auth flow |
| `assets/js/resilient-fetch.js` | Fetch utilities, timeouts, deduplication |
| `api/src/lib/types.ts` | Env interface (add CACHE_KV) |
| `api/wrangler.toml` | KV namespace config |
| `api/src/routes/documents.ts` | Fetches categories, templates, company_links |
| `api/src/routes/classifications.ts` | Fetches categories, templates |
| `api/src/routes/reminders.ts` | Fetches reminder config |
| `api/src/index.ts` | Global error handler |
| `docs/workflow-ids.md` | Workflow decommission tracking |

### Alignment with Research
- Existing silent mode aligns with stale-while-revalidate pattern
- Missing: cache checks on 3 load functions (AI, reminders, questionnaires) — easy fix
- Missing: visibility-gated background refresh — new code needed
- Missing: KV cache helper — new `lib/cache.ts` module

## 5. Technical Constraints & Risks
* **Security:** No new auth surfaces. KV caching is server-side only (no client secrets cached)
* **Risks:**
  - n8n deactivation: if a worker endpoint has a bug we missed, the n8n fallback is gone. Mitigated by checking execution history first
  - Stale cache after Airtable direct edits: categories/templates edited directly in Airtable won't reflect until TTL expires. Mitigated by keeping TTL at 1h and adding explicit invalidation on mutation endpoints
* **Breaking Changes:** None — all changes are additive

## 6. Proposed Solution (The Blueprint)

### Part A: Frontend Prefetching

**After `checkAuth()` succeeds and `loadDashboard()` returns, prefetch remaining tabs:**

In `loadDashboard()` after line 255 (existing prefetch block), add:
```javascript
// Prefetch remaining tabs (non-blocking, silent)
if (!questionnaireLoaded) loadQuestionnaires(true);
if (!reminderLoaded) loadReminders(true);
```

**Fix cache checks on 3 load functions** that currently always refetch:
- `loadAIClassifications()` — add early return when `silent && aiReviewLoaded`
- `loadReminders()` — add early return when `silent && reminderLoaded`
- `loadQuestionnaires()` — add early return when `silent && questionnaireLoaded`

### Part B: Background Refresh (60s, visibility-aware)

Add to `script.js`:
```javascript
let bgRefreshInterval = null;

function startBackgroundRefresh() {
    if (bgRefreshInterval) return;
    bgRefreshInterval = setInterval(() => {
        const activeTab = document.querySelector('.tab-content.active')?.id?.replace('tab-', '');
        if (activeTab === 'dashboard' || activeTab === 'review') loadDashboard(true);
        else if (activeTab === 'send') loadPendingClients(true);
        else if (activeTab === 'ai-review') loadAIClassifications(true);
        else if (activeTab === 'reminders') loadReminders(true);
        else if (activeTab === 'questionnaires') loadQuestionnaires(true);
    }, 60_000);
}

function stopBackgroundRefresh() {
    clearInterval(bgRefreshInterval);
    bgRefreshInterval = null;
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopBackgroundRefresh();
    } else {
        // Immediate refresh of active tab on return, then restart interval
        refreshData();  // uses existing silent=false pattern — intentional for "coming back" scenario
        startBackgroundRefresh();
    }
});
```

Call `startBackgroundRefresh()` after successful `checkAuth()`.

**Key design decisions:**
- Refresh only the ACTIVE tab (not all tabs) — avoids wasted requests
- On visibility return: do a full (non-silent) refresh to show spinner briefly, signaling "data is being refreshed"
- `refreshData()` already handles tab detection — reuse it

### Part C: KV Cache for Slow-Changing Data

**New file: `api/src/lib/cache.ts`**
```typescript
export async function getCachedOrFetch<T>(
    kv: KVNamespace, key: string, ttlSeconds: number,
    fetcher: () => Promise<T>
): Promise<T> {
    const cached = await kv.get(key, 'json');
    if (cached !== null) return cached as T;
    const fresh = await fetcher();
    await kv.put(key, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
    return fresh;
}

export async function invalidateCache(kv: KVNamespace, ...keys: string[]): Promise<void> {
    await Promise.all(keys.map(k => kv.delete(k)));
}
```

**Cache targets (all 1h TTL):**

| Key | Data | Used by |
|-----|------|---------|
| `cache:categories` | Document categories list | documents.ts, classifications.ts |
| `cache:templates` | Document templates list | documents.ts, classifications.ts |
| `cache:company-links` | Insurance company links | documents.ts |
| `cache:reminder-config` | Default max reminder count | reminders.ts |

**Infrastructure:**
- Create new KV namespace `CACHE_KV` via wrangler CLI
- Add `CACHE_KV: KVNamespace` to `Env` interface
- Add binding to `wrangler.toml`

**Cache invalidation:** Mutation endpoints that touch cached data call `invalidateCache()`. In practice, categories/templates/company_links are almost never edited, so TTL-based expiry is sufficient. Add explicit invalidation only to `update_configs` action in reminders.ts.

### Part D: Deactivate n8n Workflows

**19 workflows to deactivate** (13 from Phases 1-3 already in "Can Archive" list + 6 from Phases 4-5):

Phase 4-5 additions:
| Workflow | ID |
|----------|-----|
| [API] Get Client Documents | Ym389Q4fso0UpEZq |
| [API] Get Preview URL | aQcFuRJv8ZJFRONt |
| [API] Review Classification | c1d7zPAmHfHM71nV |
| [API] Get Pending Classifications | kdcWwkCQohEvABX0 |
| [API] Reminder Admin | RdBTeSoqND9phSfo |

**Keep active (hybrid — Worker calls n8n internally):**
| [API] Send Batch Status | QREwCScDZvhF9njF |

**Process:** Check execution history first, then deactivate via n8n MCP. Update `docs/workflow-ids.md`.

### Part E: Document Performance Timings

Compile existing timing data from sessions 172-174 into `docs/performance-benchmarks.md`:
- Auth: 18ms / 59ms (was 1-2s)
- Dashboard: 304ms (was 2-4s)
- Documents: 655-975ms (was 3-5s)
- Classifications: 876-988ms (was 3-6s)
- Reminders: ~500ms (was 3-5s)
- Batch status: 30ms (was 5-10s)

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add prefetch calls, cache checks on 3 load functions, background refresh |
| `api/src/lib/cache.ts` | Create | Shared KV cache helper |
| `api/src/lib/types.ts` | Modify | Add `CACHE_KV: KVNamespace` to Env |
| `api/wrangler.toml` | Modify | Add CACHE_KV binding |
| `api/src/routes/documents.ts` | Modify | Cache categories, templates, company_links |
| `api/src/routes/classifications.ts` | Modify | Cache categories, templates |
| `api/src/routes/reminders.ts` | Modify | Cache reminder config, invalidate on update |
| `docs/workflow-ids.md` | Modify | Move Phase 4-5 to "Can Archive", update status |
| `docs/performance-benchmarks.md` | Create | Compiled timing data |
| `.agent/current-status.md` | Modify | Update session status + test items |

### Final Step
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Prefetch: Login → open DevTools Network tab → verify reminders + questionnaires fetch automatically after dashboard loads
* [ ] Cache check: Switch to reminders tab (data loads), switch away, switch back → verify NO new network request (cached)
* [ ] Background refresh: Stay on dashboard 60+ seconds → verify silent refresh in Network tab (no spinner)
* [ ] Visibility: Switch to another browser tab, wait, switch back → verify refresh fires on return
* [ ] KV cache: Call get-client-documents twice → verify second call is faster (check `⚡` timing logs)
* [ ] KV invalidation: Update reminder config → verify next request gets fresh data
* [ ] n8n deactivation: Verify all deactivated workflows show 0 recent executions
* [ ] All admin portal tabs still work correctly after changes
* [ ] No regression in document viewing, classification review, or reminder management

## 8. Implementation Notes (Post-Code)
* KV cache uses fire-and-forget writes (`kv.put().catch(() => {})`) to avoid blocking responses on cache writes
* Background refresh resets cache flags before silent load to force a fresh fetch (otherwise silent + cached = skip)
* On visibility change back to visible: silent refresh (no spinner) — changed from plan's original "full refresh with spinner" to avoid jarring UX
* Research principle applied: stale-while-revalidate — show cached data on tab switch, background refresh brings fresh data
* `deduplicatedFetch()` not integrated yet — the 60s interval makes overlap unlikely; can add later if needed
* n8n [API] Send Batch Status (QREwCScDZvhF9njF) kept active — Worker calls it via X-Internal-Key for async email
