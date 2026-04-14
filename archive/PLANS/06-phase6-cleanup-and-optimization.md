# Phase 6: Cleanup & Optimization — ✅ COMPLETE

## Status: DONE (DL-175, DL-177, Session 178)

- **KV caching:** Implemented (categories, templates, company_links — 1h TTL)
- **Prefetching:** Questionnaires + reminders prefetched after dashboard load
- **Background refresh:** 60s visibility-aware refresh
- **Final 2 endpoints:** approve-and-send + send-questionnaires migrated (DL-177)
- **E2E testing:** All 7 tests passed (session 178)
- **n8n archival:** 20 workflows renamed [ARCHIVED] and deactivated (session 178)
- **Remaining TODO:** monitoring/alerting setup, uptime checks

## Goal

Post-migration optimization: add caching, prefetching, and monitoring. Remove decommissioned n8n workflows. Measure and document performance improvements.

---

## 1. Frontend Prefetching

### Problem
Currently, tab data loads only when the user clicks a tab. After login, the user waits 2-4 seconds for the dashboard to load before they can do anything.

### Solution: Parallel Prefetch After Login
After successful login/verification, prefetch data for all commonly-used tabs in parallel:

```javascript
// In checkAuth() after successful verification
async function prefetchTabData() {
  const [dashboardData, pendingData, reminderData] = await Promise.allSettled([
    fetchWithTimeout(ENDPOINTS.ADMIN_DASHBOARD + `?year=${currentYear}`, authHeaders, FETCH_TIMEOUTS.load),
    fetchWithTimeout(ENDPOINTS.ADMIN_PENDING + `?year=${currentYear}`, authHeaders, FETCH_TIMEOUTS.load),
    fetchWithTimeout(ENDPOINTS.ADMIN_REMINDERS, authHeaders, FETCH_TIMEOUTS.load),
  ]);

  // Store results in global state
  if (dashboardData.status === 'fulfilled') {
    const data = await dashboardData.value.json();
    if (data.ok) { clientsData = data.clients; reviewQueueData = data.review_queue; dashboardLoaded = true; }
  }
  // ... same for other tabs
}
```

**Impact:** When the user clicks "Reminders" or "Send" tab, data is already loaded — zero wait time.

### Implementation Notes
- Only prefetch read-only tabs (dashboard, pending, reminders)
- Don't prefetch AI classifications (heavy, less frequently used)
- Prefetch runs after initial render so it doesn't block first paint
- Cache flags (`dashboardLoaded`, etc.) already exist in the codebase — prefetch just sets them earlier

---

## 2. Background Refresh

### Problem
If the office has the portal open all day, data goes stale. Staff currently click "Refresh" manually or reload the page.

### Solution: 60-Second Background Refresh
Auto-refresh the active tab's data every 60 seconds:

```javascript
let refreshInterval = null;

function startBackgroundRefresh() {
  refreshInterval = setInterval(() => {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'dashboard') loadDashboard(true);  // silent=true (no loading spinner)
    else if (activeTab === 'ai-review') loadAIClassifications(true);
    // ... etc
  }, 60_000);
}

// Stop on logout or tab blur
function stopBackgroundRefresh() {
  clearInterval(refreshInterval);
}
```

**Key:** `silent=true` prevents the loading overlay from appearing during background refresh. Updates happen seamlessly.

### Visibility API Optimization
Only refresh when the tab is visible:
```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopBackgroundRefresh();
  else startBackgroundRefresh();
});
```

---

## 3. Cloudflare KV Cache for Slow-Changing Data

### What to Cache

| Data | KV Key Pattern | TTL | Invalidation |
|------|---------------|-----|-------------|
| Document categories | `cache:categories` | 1 hour | Rarely changes |
| Document templates | `cache:templates` | 1 hour | Rarely changes |
| Company links | `cache:company_links` | 1 hour | Rarely changes |
| Config values | `cache:config:{key}` | 5 min | On update_config action |
| Available years | `cache:years` | 10 min | On rollover/import |

### Implementation
```typescript
async function getCachedOrFetch<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await kv.get(key, 'json');
  if (cached) return cached as T;

  const fresh = await fetcher();
  await kv.put(key, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
  return fresh;
}

// Usage in Get Client Documents handler
const categories = await getCachedOrFetch(
  env.CACHE_KV, 'cache:categories', 3600,
  () => airtable.search(env, 'tblbn6qzWNfR8uL2b', '', { fields: ['category_id', 'emoji', 'name_he', 'name_en', 'sort_order'] })
);
```

### KV Namespace
```toml
# wrangler.toml (add to existing)
[[kv_namespaces]]
binding = "CACHE_KV"
id = "xxxxx"  # wrangler kv namespace create CACHE_KV
```

### Cache Invalidation
- **Manual:** Add a `POST /admin-cache-clear` endpoint for emergencies
- **Automatic:** When a mutation endpoint modifies cached data, delete the relevant KV key
- **TTL-based:** Most caches expire naturally within 5-60 minutes

---

## 4. Decommission n8n Webhook Workflows

### Safety Checklist Before Decommissioning

For each workflow:
1. Verify the Worker endpoint has been live for ≥ 2 weeks with no issues
2. Check n8n execution history — confirm zero recent executions (all traffic on Worker)
3. **Deactivate** (don't delete) the n8n workflow first — wait 1 week
4. If no issues after 1 week, archive or delete

### Decommission Order

| Priority | n8n Workflow | Worker Replacement | Deactivate After |
|----------|-------------|-------------------|-----------------|
| 1 | [Admin] Auth & Verify | Phase 1 Worker auth routes | Phase 2 complete |
| 2 | [Admin] Dashboard | Phase 2 Worker dashboard route | Phase 3 complete |
| 3 | [Admin] Pending Clients | Phase 2 Worker pending route | Phase 3 complete |
| 4 | [API] Admin Questionnaires | Phase 2 Worker questionnaires route | Phase 3 complete |
| 5 | [API] Check Existing Submission | Phase 2 Worker submission route | Phase 3 complete |
| 6 | [API] Admin Change Stage | Phase 3 Worker stage route | Phase 4 complete |
| 7 | [API] Admin Toggle Active | Phase 3 Worker client route | Phase 4 complete |
| 8 | [API] Admin Update Client | Phase 3 Worker client route | Phase 4 complete |
| 9 | [Admin] Mark Complete | Phase 3 Worker stage route | Phase 4 complete |
| 10 | [Admin] Bulk Import | Phase 3 Worker import route | Phase 4 complete |
| 11 | [Admin] Year Rollover | Phase 3 Worker rollover route | Phase 4 complete |
| 12 | [API] Reset Submission | Phase 3 Worker reset route | Phase 4 complete |
| 13 | [API] Get Client Documents | Phase 4 Worker documents route | Phase 5 complete |
| 14 | [API] Get Pending Classifications | Phase 4 Worker classifications route | Phase 5 complete |
| 15 | [API] Get Preview URL | Phase 4 Worker preview route | Phase 5 complete |
| 16 | [API] Review Classification | Phase 4 Worker review route | Phase 5 complete |
| 17 | [API] Reminder Admin | Phase 5 Worker reminders route | Phase 6 validation |
| 18 | [API] Send Batch Status | Hybrid (Worker + internal webhook) | **Never fully decommission** — keep internal webhook |
| 19 | [04] Document Edit Handler | Phase 5 Worker edit route | Phase 6 validation |

### Workflows That Stay on n8n (Updated 2026-03-24)

**[01] Send Questionnaires and [3] Approve & Send were migrated to Workers in DL-177 and archived.**

These stay on n8n permanently:
- `[02] Questionnaire Response Processing` — Tally webhook processing
- `[04] Document Edit Handler` — async doc edits + MS Graph (called by Worker)
- `[05] Inbound Document Processing` — email classification pipeline
- `[06] Reminder Scheduler` — scheduled cron + email
- `[06-SUB] Monthly Reset` — monthly cron
- `[SUB] Document Service` — called by [02]
- `[05-SUB] Email Subscription Manager` — email subscriptions
- `[API] Send Batch Status` — async email sending (called by Worker)
- All MONITOR workflows — monitoring/cleanup

---

## 5. Monitoring & Alerting

### Cloudflare Worker Analytics
Cloudflare provides built-in analytics for Workers:
- Request count, success/error rates
- CPU time per request
- Latency percentiles (p50, p95, p99)

Access via Cloudflare dashboard → Workers → annual-reports-api → Analytics.

### Custom Error Logging
Add a simple error logging mechanism for Worker failures:

```typescript
// In the global error handler
app.onError((err, c) => {
  // Log to Cloudflare's console (visible in Wrangler tail + dashboard)
  console.error(`[${c.req.method} ${c.req.path}]`, err.message, err.stack);

  // Fire-and-forget to Airtable error log
  c.executionCtx.waitUntil(
    logSecurityEvent(c.env, c.executionCtx, {
      event_type: 'WORKER_ERROR',
      severity: 'error',
      endpoint: c.req.path,
      error_message: err.message,
      details: JSON.stringify({ method: c.req.method, stack: err.stack?.slice(0, 500) })
    })
  );

  return c.json({ ok: false, error: 'Internal server error' }, 500);
});
```

### Health Check Endpoint
```typescript
app.get('/health', (c) => c.json({
  ok: true,
  version: '1.0.0',
  timestamp: new Date().toISOString(),
  colo: c.req.raw.cf?.colo  // Shows which Cloudflare datacenter served the request
}));
```

### Uptime Monitoring
Set up a simple uptime check (Cloudflare, UptimeRobot, or similar) that pings `/health` every minute and alerts on failure.

---

## 6. Performance Benchmarks

### Measurement Methodology
Before each phase goes live, capture baseline metrics:

```bash
# From an Israeli IP (or use a VPS in Israel)
# Run 10 requests, capture timing
for i in {1..10}; do
  curl -o /dev/null -s -w "time_total: %{time_total}s\n" \
    -H "Authorization: Bearer $TOKEN" \
    "https://liozshor.app.n8n.cloud/webhook/admin-dashboard?year=2025"
done

# Same for Worker
for i in {1..10}; do
  curl -o /dev/null -s -w "time_total: %{time_total}s\n" \
    -H "Authorization: Bearer $TOKEN" \
    "https://api.moshe-atsits.co.il/admin-dashboard?year=2025"
done
```

### Expected Results Summary

| Endpoint | n8n Baseline | Worker Target | Improvement |
|----------|-------------|---------------|-------------|
| admin-auth | 1-2s | 50-150ms | 10-20x |
| admin-verify | 1-2s | 20-50ms | 20-40x |
| admin-dashboard | 2-4s | 400-800ms | 3-5x |
| admin-pending | 1.5-3s | 300-500ms | 4-6x |
| admin-questionnaires | 2-4s | 500-900ms | 3-4x |
| check-existing-submission | 1-2s | 300-500ms | 3-4x |
| admin-change-stage | 2-4s | 300-500ms | 5-8x |
| admin-toggle-active | 2-3s | 300-400ms | 5-7x |
| admin-update-client | 2-3s | 300-500ms | 5-6x |
| admin-mark-complete | 1.5-2s | 200-300ms | 5-7x |
| get-client-documents | 3-5s | 800ms-1.5s | 3-4x |
| get-pending-classifications | 4-6s | 1-2s | 3-4x |
| get-preview-url | 2-3s | 500ms-1s | 3-4x |
| review-classification | 3-6s | 1-2s | 2-3x |
| admin-reminders (list) | 3-5s | 500ms-1s | 4-6x |
| send-batch-status | 5-10s | <100ms | 50-100x |
| edit-documents | 3-5s | 500ms-1s | 3-5x |

### Document Results
Create `docs/performance-benchmarks.md` with before/after measurements for each phase.

---

## 7. Custom Domain Setup

### Option A: Subdomain of Existing Domain
If `moshe-atsits.co.il` is on Cloudflare:
```toml
# wrangler.toml
routes = [
  { pattern = "api.moshe-atsits.co.il/*", zone_name = "moshe-atsits.co.il" }
]
```

### Option B: Workers.dev Subdomain
Use the default `annual-reports-api.{account}.workers.dev` URL. Free, no DNS config needed.

### Option C: New Domain
Register a dedicated API domain. Adds cost but cleanest separation.

**Recommendation:** Start with Option B (workers.dev) for testing, switch to Option A for production once stable.

---

## 8. Final `shared/endpoints.js`

After all phases complete:

```javascript
const API_BASE = 'https://api.moshe-atsits.co.il';  // or workers.dev URL
const API_BASE_N8N = 'https://liozshor.app.n8n.cloud/webhook';

const ENDPOINTS = {
  // Phase 1 — Auth (Worker)
  ADMIN_AUTH:                  `${API_BASE}/admin-auth`,
  ADMIN_VERIFY:               `${API_BASE}/admin-verify`,

  // Phase 2 — Read (Worker)
  ADMIN_DASHBOARD:            `${API_BASE}/admin-dashboard`,
  ADMIN_PENDING:              `${API_BASE}/admin-pending`,
  ADMIN_QUESTIONNAIRES:       `${API_BASE}/admin-questionnaires`,
  CHECK_EXISTING_SUBMISSION:  `${API_BASE}/check-existing-submission`,

  // Phase 3 — Write (Worker)
  ADMIN_CHANGE_STAGE:         `${API_BASE}/admin-change-stage`,
  ADMIN_TOGGLE_ACTIVE:        `${API_BASE}/admin-toggle-active`,
  ADMIN_UPDATE_CLIENT:        `${API_BASE}/admin-update-client`,
  ADMIN_MARK_COMPLETE:        `${API_BASE}/admin-mark-complete`,
  ADMIN_BULK_IMPORT:          `${API_BASE}/admin-bulk-import`,
  ADMIN_YEAR_ROLLOVER:        `${API_BASE}/admin-year-rollover`,
  RESET_SUBMISSION:           `${API_BASE}/reset-submission`,

  // Phase 4 — MS Graph (Worker)
  GET_CLIENT_DOCUMENTS:       `${API_BASE}/get-client-documents`,
  GET_PENDING_CLASSIFICATIONS:`${API_BASE}/get-pending-classifications`,
  GET_PREVIEW_URL:            `${API_BASE}/get-preview-url`,
  REVIEW_CLASSIFICATION:      `${API_BASE}/review-classification`,

  // Phase 5 — Hybrid (Worker + n8n async)
  ADMIN_REMINDERS:            `${API_BASE}/admin-reminders`,
  SEND_BATCH_STATUS:          `${API_BASE}/send-batch-status`,
  EDIT_DOCUMENTS:             `${API_BASE}/edit-documents`,

  // Stays on n8n (email senders)
  ADMIN_SEND_QUESTIONNAIRES:  `${API_BASE_N8N}/admin-send-questionnaires`,
  APPROVE_AND_SEND:           `${API_BASE_N8N}/approve-and-send`,
};
```

---

## Estimated Effort

| Task | Hours |
|------|-------|
| Frontend prefetching implementation | 2 |
| Background refresh implementation | 1.5 |
| KV cache layer for slow-changing data | 2 |
| Cache invalidation on mutations | 1 |
| Health check endpoint | 0.5 |
| Error logging + monitoring setup | 1 |
| Performance benchmarking (before/after) | 2 |
| n8n workflow decommissioning (deactivate, verify, archive) | 2 |
| Custom domain setup (if applicable) | 1 |
| Documentation (performance results, architecture update) | 1 |
| **Total** | **~14 hours** |

---

## Success Criteria

- [x] All 20 migrated endpoints respond from Cloudflare (verify `colo` in health check = TLV)
- [ ] Dashboard loads in < 1 second (measured from Israel)
- [ ] All write operations respond in < 500ms
- [ ] Preview/classification endpoints respond in < 2 seconds
- [ ] Zero regression bugs after 2-week validation period
- [x] n8n execution count for decommissioned workflows = 0 — 18 workflows deactivated (session 175)
- [ ] KV cache hit rate > 80% for categories/templates/company_links
- [x] Background refresh working (60s interval, visibility-aware) — implemented session 175
- [x] Prefetch loads 3 tabs of data within 2 seconds of login — implemented session 175
- [ ] Uptime monitoring active with alerting
- [x] Performance benchmarks documented — `docs/performance-benchmarks.md`

## Implementation Progress (DL-175, Session 175, 2026-03-24)

| Task | Status |
|------|--------|
| Frontend prefetching | ✅ Done |
| Background refresh (60s, visibility-aware) | ✅ Done |
| KV cache (categories, templates, company_links, reminder config) | ✅ Done + deployed |
| Cache invalidation on config updates | ✅ Done |
| Performance benchmarks | ✅ Documented |
| n8n workflow decommissioning | ✅ 18 deactivated |
| Custom domain setup | Deferred (keeping workers.dev) |
| Monitoring/alerting | TODO |
| Error logging improvements | TODO |
