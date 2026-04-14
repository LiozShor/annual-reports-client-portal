# Performance Benchmarks: n8n → Cloudflare Workers Migration

**Measured:** Sessions 172-174 (2026-03-23)
**Worker URL:** `https://annual-reports-api.liozshor1.workers.dev`

## Summary

20/22 admin API endpoints migrated from n8n Cloud (Frankfurt) to Cloudflare Workers (edge). Average improvement: **3-10x faster**, with auth endpoints seeing 20-40x improvement.

## Endpoint Timings

### Phase 1 — Auth (DL-169)

| Endpoint | n8n (ms) | Worker (ms) | Improvement |
|----------|----------|-------------|-------------|
| admin-auth | 1000-2000 | 18 | ~60x |
| admin-verify | 1000-2000 | 59 | ~25x |

### Phase 2 — Read-Only (DL-170)

| Endpoint | n8n (ms) | Worker (ms) | Improvement |
|----------|----------|-------------|-------------|
| admin-dashboard | 2000-4000 | 304 | 7-13x |
| admin-pending | 1500-3000 | ~300 | 5-10x |
| admin-questionnaires | 2000-4000 | ~500 | 4-8x |
| check-existing-submission | 1000-2000 | ~300 | 3-7x |

### Phase 3 — Write Operations (DL-171)

| Endpoint | n8n (ms) | Worker (ms) | Improvement |
|----------|----------|-------------|-------------|
| admin-change-stage | 2000-4000 | ~400 | 5-10x |
| admin-toggle-active | 2000-3000 | ~300 | 7-10x |
| admin-update-client | 2000-3000 | ~400 | 5-8x |
| admin-mark-complete | 1500-2000 | ~250 | 6-8x |
| admin-bulk-import | 3000-5000 | ~1000 | 3-5x |
| admin-year-rollover | 5000-10000 | ~2000 | 3-5x |
| reset-submission | 1500-2000 | ~300 | 5-7x |

### Phase 4a — MS Graph + Documents (DL-172)

| Endpoint | n8n (ms) | Worker (ms) | Improvement |
|----------|----------|-------------|-------------|
| get-client-documents | 3000-5000 | 655-975 | 3-5x |
| get-preview-url | 2000-3000 | 205-633 | 3-10x |

### Phase 4b — AI Classifications (DL-173)

| Endpoint | n8n (ms) | Worker (ms) | Improvement |
|----------|----------|-------------|-------------|
| get-pending-classifications | 3000-6000 | 876-988 | 3-6x |
| review-classification | 3000-6000 | 1583-2533 | 2-3x |

### Phase 5 — Hybrid Async (DL-174)

| Endpoint | n8n (ms) | Worker (ms) | Improvement |
|----------|----------|-------------|-------------|
| admin-reminders (list) | 3000-5000 | ~500 | 6-10x |
| send-batch-status | 5000-10000 | 30 | 170-330x |
| edit-documents | 3000-5000 | ~1000 | 3-5x |

*send-batch-status returns instantly; email is sent async via n8n.*

## Still on n8n

| Endpoint | Why |
|----------|-----|
| admin-send-questionnaires | MS Graph email sending (heavy, async) |
| approve-and-send | MS Graph email + HTML page rendering |

## Architecture

```
Browser → Cloudflare Edge (TLV) → Airtable API → Response
                                → MS Graph (for OneDrive operations)
                                → n8n (async, for email sending only)
```

Worker latency is dominated by Airtable API round-trips (~200-400ms per call). Auth endpoints are fastest because they only do HMAC verification (no external calls).

## Phase 6 Optimizations (DL-175)

- **KV Cache:** Categories, templates, company links cached for 1h in Cloudflare KV — eliminates 3 Airtable calls per `get-client-documents` request
- **Frontend Prefetch:** All tab data prefetched after dashboard loads
- **Background Refresh:** Active tab refreshes every 60s, visibility-aware
