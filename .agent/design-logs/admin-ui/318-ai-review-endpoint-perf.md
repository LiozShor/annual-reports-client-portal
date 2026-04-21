# DL-318: AI Review Endpoint Perf — KV Cache + Projection + Parallel URL Resolve

**Status:** `[IMPLEMENTED — NEED TESTING]`

## 1. Problem Statement

`/webhook/get-pending-classifications?filing_type=all` (AI Review tab's data source) has excessive latency:

- Prefetch: 7110 ms
- User refetch on tab click: 14621 ms → `TimeoutError` at `FETCH_TIMEOUTS.slow`
- Other tabs elevated but AI is ~4× worst

Root causes:
1. No response-level KV cache — full 8-step pipeline re-runs every request
2. Inline MS Graph `batchResolveUrls` for up to 20 OneDrive item IDs per request
3. Dead field `email_body_text` returned but never consumed (payload bloat)

## 2. Solution Design

Three server-side changes in `api/src/`:

### 2.1 Response-level KV cache (60 s TTL)

- Key: `cache:pending_classifications:{filing_type}` (3 variants: `annual_report`, `capital_statements`, `all`)
- Wraps entire pipeline (Steps 1–8) in `getCachedOrFetch` helper
- Cached payload: `{ok, items, stats}` JSON response
- TTL: 60 s (same admin hitting cache < 1 min apart = immediate p95 improvement)

### 2.2 Explicit cache invalidation on writes

Extended invalidation to all pending-classifications write sites (3 locations):
- `classifications.ts` line 641: `also_match` handler creates docs → extend invalidation
- `classifications.ts` line 1776: `review-classification` POST handler → extend invalidation
- `processor.ts` line 613: Classifier writes new classification → new invalidation

New helper: `invalidatePendingClassificationsCache(kv)` in `lib/cache.ts` (exported, used by both routes + processor).

### 2.3 Projection — drop `email_body_text`

- Frontend grep: 0 consumers in `script.js`
- All other fat fields consumed (checked: `all_docs`, `missing_docs`, `other_report_docs`, `contract_period`, `page_count`, `issuer_match_quality`, `matched_doc_name`, `client_notes`)
- Removed from item object at `classifications.ts:345`

### 2.4 Cache MS Graph webURL resolutions

Before calling `batchResolveUrls`, check KV for each `onedrive_item_id`:
- Hit: apply immediately, skip Graph call
- Miss: fetch from Graph, write back to KV with 3600 s TTL
- Non-fatal on error (pre-existing behavior)

Pattern: `cache:onedrive_weburl:{itemId}` in KV, await all in parallel.

## 3. Files Changed

| File | Changes |
|------|---------|
| `api/src/lib/cache.ts` | Add `invalidatePendingClassificationsCache(kv)` export |
| `api/src/routes/classifications.ts` | GET handler KV wrap (60s); drop `email_body_text`; cache webUrls; extend invalidation at 3 sites |
| `api/src/lib/inbound/processor.ts` | Import + call `invalidatePendingClassificationsCache` after `createRecords(PENDING_CLASSIFICATIONS)` |
| `frontend/admin/index.html` | Bump asset cache-bust: `?v=273 → v=274` |
| `.agent/design-logs/INDEX.md` | Add DL-318 row |
| `.agent/current-status.md` | Add DL-318 TODO + testing checklist |

## 4. Expected Outcomes

- p50: < 1.5 s (warm cache)
- p95: < 3 s (warm cache)
- First load (cold cache): same as pre-DL-318 but sub-1 s on second tab open
- No `TimeoutError` on 10 consecutive AI Review tab clicks
- Badge count updates instantly after approve (TTL-based invalidation < 1 s)

## 5. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Cache stampede on expiry | 60 s TTL is short; next request fetches + refills |
| Stale data if invalidation fails | Fire-and-forget invalidation; worst case: 60 s stale, no data loss |
| webURL resolution misses | Non-fatal, items just render without webUrl links (pre-existing behavior) |

## 6. Rollback

```bash
git revert <merge-commit-sha>
npx wrangler deploy
```

KV keys auto-expire in 60 s; no manual cleanup needed.

## 7. Verification (MUST COMPLETE BEFORE MERGE)

- [ ] Deploy to Workers: `cd api && npx wrangler deploy`
- [ ] `wrangler tail --format=pretty` — no errors for 60 s
- [ ] Admin panel perf: `localStorage.ADMIN_PERF='1'; location.reload()` → AI Review tab
  - [ ] Cold load (first open): < 3 s `dl317:aiClassifications:fetch`
  - [ ] Warm load (second open within 60 s): < 500 ms `dl317:aiClassifications:fetch`
- [ ] Approve a classification, reload AI Review within 60 s
  - [ ] Badge count decrements (invalidation works)
- [ ] 10 consecutive AI Review tab clicks — zero `TimeoutError`
- [ ] `pre_questionnaire` badge still renders (DL-315 parity check)
- [ ] Doc-row filter chips + dedup working (DL-314 + DL-112 parity)
- [ ] OneDrive "open file" link (`file_url`) resolves on cards

## 8. Notes

- No frontend changes — lowest blast radius
- `getCachedOrFetch` lambda captures `airtable`, `c` from outer scope — safe closure pattern
- `filingType` extracted before cache check to use as cache key
- Early return in pipeline changed from `c.json(...)` to plain return (inside lambda)
- Final return `c.json(result)` outside lambda (after `getCachedOrFetch` completes)
