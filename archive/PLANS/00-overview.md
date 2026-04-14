# Migration Plan: n8n Webhooks → Cloudflare Workers

## Executive Summary

The Annual Reports CRM admin portal currently routes **every API call** through n8n Cloud (Frankfurt, Germany). For an office in Israel using this portal all day, every action — loading the dashboard, approving a document, changing a stage — takes **2-5 seconds** due to:

1. **Geographic latency:** Browser (Israel) → n8n Cloud (Frankfurt) → Airtable (US) → back
2. **Workflow engine overhead:** 200-800ms cold start per n8n execution
3. **Sequential node execution:** Each n8n node runs one after another, adding ~50-100ms per hop
4. **No caching:** Every dashboard load re-fetches the same client list from Airtable

**The fix:** Replace n8n as the API layer with **Cloudflare Workers** — edge-deployed JavaScript that runs in Tel Aviv for Israeli users with 0ms cold start. The Worker code is essentially the same JavaScript already inside n8n's Code nodes, but running directly on the edge without the workflow engine overhead.

---

## Architecture: Before vs After

### Before (Current)
```
┌──────────┐     ┌─────────────────────────────────────────┐     ┌───────────┐
│  Browser  │────▶│  n8n Cloud (Frankfurt)                  │────▶│ Airtable  │
│  (Israel) │◀────│  Webhook → Verify Token → Code Node(s)  │◀────│   (US)    │
│           │     │  → Airtable Node → Respond to Webhook   │     │           │
└──────────┘     └─────────────────────────────────────────┘     └───────────┘
                        │                    ▲
                        ▼                    │
                  ┌──────────────┐    ┌──────────────┐
                  │  MS Graph    │    │  Sub-workflows│
                  │  (OneDrive)  │    │  (Doc Service)│
                  └──────────────┘    └──────────────┘

Latency: 2,000–5,000ms per request
```

### After (Migrated)
```
┌──────────┐     ┌──────────────────────────────┐     ┌───────────┐
│  Browser  │────▶│  Cloudflare Worker (Tel Aviv) │────▶│ Airtable  │
│  (Israel) │◀────│  Hono router → handler logic  │◀────│   (US)    │
│           │     │  → Airtable REST client        │     │           │
└──────────┘     └──────────────────────────────┘     └───────────┘
                        │           │
                        │           ▼ (async, via waitUntil)
                        ▼     ┌─────────────────────────┐
                  ┌──────────┐│  n8n Cloud (Frankfurt)   │
                  │ MS Graph ││  Email sending workflows  │
                  │(OneDrive)││  Tally processing         │
                  └──────────┘│  Scheduled jobs           │
                              └─────────────────────────┘

Latency: 200–800ms per request (3-10x improvement)
```

### What Moves to Workers
All **synchronous API endpoints** that the browser calls (request → query Airtable → return JSON).

### What Stays on n8n
- **Email sending** (MS Graph sendMail via OAuth2)
- **Tally form processing** ([02] Questionnaire Response Processing)
- **Scheduled jobs** ([06] Reminder Scheduler, [MONITOR] Log Cleanup)
- **Document classification pipeline** ([05] Inbound Document Processing)
- **Sub-workflows** ([SUB] Document Service, [SUB] Format Questionnaire)

### Hybrid Pattern (Phase 5)
Some endpoints do both: respond to browser AND trigger an email. For these, the Worker handles the fast response path and fires an n8n webhook asynchronously via `ctx.waitUntil()`.

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Runtime** | Cloudflare Workers | Edge compute (Tel Aviv PoP for Israel) |
| **Framework** | Hono | Lightweight router + middleware (~14KB) |
| **Language** | TypeScript | Type safety for Airtable field names, API contracts |
| **Build** | Wrangler | Cloudflare's CLI for Workers dev/deploy |
| **Auth** | HMAC-SHA256 (same keys) | Cross-compatible with existing n8n tokens |
| **Database** | Airtable REST API | Direct HTTP calls (same as n8n Code nodes) |
| **Cache** | Cloudflare KV | Optional: cache slow-changing data (Phase 6) |
| **File Storage** | MS Graph API | OneDrive operations (Phases 4-5) |
| **Secrets** | Cloudflare Worker Secrets | API keys, signing secrets, OAuth tokens |

---

## Frontend Impact

**Only one file changes:** `shared/endpoints.js`

```javascript
// Before
const API_BASE = 'https://liozshor.app.n8n.cloud/webhook';

// After (phased — each endpoint switches independently)
const API_BASE_WORKER = 'https://api.moshe-atsits.co.il';  // or workers subdomain
const API_BASE_N8N = 'https://liozshor.app.n8n.cloud/webhook';
```

Each endpoint URL switches from n8n to Worker as its phase completes. Rollback = revert that one URL. All request/response shapes stay identical.

---

## Complete Endpoint Migration Map

| # | Endpoint | Phase | Status | Notes |
|---|----------|-------|--------|-------|
| 1 | `/admin-auth` | 1 | ✅ Worker | 18ms |
| 2 | `/admin-verify` | 1 | ✅ Worker | 49ms |
| 3 | `/admin-dashboard` | 2 | ✅ Worker | 300-566ms |
| 4 | `/admin-pending` | 2 | ✅ Worker | 280ms |
| 5 | `/admin-questionnaires` | 2 | ✅ Worker | 491ms |
| 6 | `/check-existing-submission` | 2 | ✅ Worker | |
| 7 | `/admin-change-stage` | 3 | ✅ Worker | 688ms |
| 8 | `/admin-toggle-active` | 3 | ✅ Worker | 619ms |
| 9 | `/admin-update-client` | 3 | ✅ Worker | |
| 10 | `/admin-mark-complete` | 3 | ✅ Worker | |
| 11 | `/admin-bulk-import` | 3 | ✅ Worker | |
| 12 | `/admin-year-rollover` | 3 | ✅ Worker | |
| 13 | `/reset-submission` | 3 | ✅ Worker | |
| 14 | `/get-client-documents` | 4 | ✅ Worker | 420-780ms |
| 15 | `/get-pending-classifications` | 4 | ✅ Worker | 848-998ms |
| 16 | `/get-preview-url` | 4 | ✅ Worker | 205-633ms |
| 17 | `/review-classification` | 4 | ✅ Worker | 1.5-2.5s |
| 18 | `/admin-reminders` | 5 | ✅ Worker (hybrid) | ~500ms, send_now fires n8n async |
| 19 | `/send-batch-status` | 5 | ✅ Worker (hybrid) | 30ms, email via n8n async |
| 20 | `/edit-documents` | 5 | ✅ Worker (hybrid) | ~1s, office email via n8n async |
| 21 | `/admin-send-questionnaires` | 6 | ✅ Worker | 894ms single, 2.5s bulk |
| 22 | `/approve-and-send` | 6 | ✅ Worker | 855ms (DL-177) |

---

## Phase Summary

| Phase | Name | Endpoints | Status |
|-------|------|-----------|--------|
| 1 | Scaffold + Auth | 2 | ✅ DONE (DL-169) |
| 2 | Read Endpoints | 4 | ✅ DONE (DL-170) |
| 3 | Simple Writes | 7 | ✅ DONE (DL-171) |
| 4 | MS Graph Endpoints | 4 | ✅ DONE (DL-172, DL-173) |
| 5 | Async Hybrid | 3 | ✅ DONE (DL-174) |
| 6 | Cleanup + Optimization + Final 2 | 2 | ✅ DONE (DL-175, DL-177) |

**22/22 endpoints migrated. Migration complete.** All n8n API workflows archived. n8n now handles only event-driven processing (Tally, OneDrive), scheduled jobs (reminders, monitoring), and async email sending (batch status, edit notifications).

---

## Shared Infrastructure (Built in Phase 1, Used by All)

| Module | Purpose |
|--------|---------|
| `middleware/cors.ts` | CORS headers for `liozshor.github.io` origin |
| `middleware/auth.ts` | Admin token verification (HMAC-SHA256) |
| `middleware/client-auth.ts` | Client token verification (different secret, 45-day expiry) |
| `lib/airtable.ts` | Typed Airtable REST client (search, get, create, update, delete, batch) |
| `lib/security-log.ts` | Fire-and-forget security logging to Airtable |
| `lib/constants.ts` | Stage definitions, table IDs, field names |

---

## Rollback Strategy

Every phase is independently rollbackable:

1. Each endpoint has its own URL in `shared/endpoints.js`
2. To rollback one endpoint: change its URL back to the n8n webhook
3. n8n workflows are NOT deleted until Phase 6 (after full validation)
4. Tokens are cross-compatible (same HMAC keys, same format)
5. No data migration needed — both Worker and n8n talk to the same Airtable base

**Canary deployment:** During each phase, both the Worker and n8n endpoint can run simultaneously. Test the Worker URL directly before updating `endpoints.js`.

---

## Secrets Required in Cloudflare Workers

| Secret Name | Value Source | Used By |
|-------------|-------------|---------|
| `ADMIN_SECRET_KEY` | `QKiwUBXVH@%#1gD7t@rB]<,dM.[NC5b_` | Admin token sign/verify |
| `CLIENT_SECRET_KEY` | `db3f995dd145fa5d2942bee10b0b17d7e90bb68549c953f812712a6778fa2c8f` | Client token verify |
| `ADMIN_PASSWORD` | `reports3737!` | Login endpoint |
| `AIRTABLE_PAT` | `patvXzYxSlSUEKx9i.25f38a9e...` | All Airtable calls |
| `AIRTABLE_PAT_SECURITY` | `pat2XQGRyzPdycQWr.059c2b89...` | Security log writes |
| `MS_GRAPH_CLIENT_ID` | From n8n credential | Phase 4+ |
| `MS_GRAPH_CLIENT_SECRET` | From n8n credential | Phase 4+ |
| `MS_GRAPH_REFRESH_TOKEN` | From n8n credential | Phase 4+ |
| `MS_GRAPH_TENANT_ID` | From n8n credential | Phase 4+ |
| `WEBHOOK_SECRET` | From n8n global config | Approve & Send hash tokens |

---

## Airtable Tables Referenced Across All Endpoints

| Table | Table ID | Used By Phases |
|-------|----------|---------------|
| annual_reports | `tbls7m3hmHC4hhQVy` | 2, 3, 4, 5 |
| clients | `tblFFttFScDRZ7Ah5` | 3 |
| documents | `tblcwptR63skeODPn` | 2, 3, 4, 5 |
| questionnaires | `tblxEox8MsbliwTZI` | 2 |
| classifications | `tbloiSDN3rwRcl1ii` | 4 |
| documents_templates | `tblQTsbhC6ZBrhspc` | 4 |
| document_categories | `tblbn6qzWNfR8uL2b` | 4 |
| company_links | `tblDQJvIaEgBw2L6T` | 4 |
| security_logs | (no table ID in code) | 1, 2, 3, 4 |
| audit_logs | `tblVjLznorm0jrRtd` | 3 |
| config | `tblqHOkDnvb95YL3O` | 5 |
