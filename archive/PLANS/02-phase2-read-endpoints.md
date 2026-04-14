# Phase 2: Read-Only Endpoints

**Status:** COMPLETED (session 172, DL-170)

## Goal

Migrate all **read-only** endpoints to Cloudflare Workers. These are the biggest UX win — they're called on every tab switch and page load. Moving them to the edge eliminates the most-felt latency: the dashboard that takes 3+ seconds to load will load in under 1 second.

---

## Endpoints Being Migrated

### 1. `GET /admin-dashboard`

**Current workflow:** `[Admin] Dashboard` (AueLKVnkdNUorWVYfGUMG)

**Current logic:**
1. Verify admin token (Bearer header or query param)
2. Extract `year` from query params (defaults to '2024')
3. **Parallel Airtable queries:**
   - Get Reports: Search `annual_reports` filtered by `{year}={requested_year}`
   - Get Distinct Years: Search `annual_reports`, extract unique `year` values
4. Format Response:
   - Filter empty placeholder records (`.filter(r => r.id)`)
   - Count clients per stage (stats.stage1 through stats.stage8) using STAGE_ORDER map
   - Map each report to: `{report_id, name, email, year, stage, docs_received, docs_total, docs_completed_at, is_active, notes}`
   - Handle `client_is_active` lookup field (array `[true]`/`[null]`, boolean, or undefined → default true)
   - Build review queue: clients with `stage='Review'` + `docs_completed_at` + `is_active !== false`, sorted by completion date (FIFO)
   - Sort clients by Hebrew collation on name
   - Return `{ok, stats, clients, review_queue, available_years}`

**Airtable tables:**
| Table | Table ID | Filter | Fields Used |
|-------|----------|--------|-------------|
| annual_reports | `tbls7m3hmHC4hhQVy` | `{year}='{year}'` | year, stage, client_name, client_email, client_is_active, docs_received_count, docs_total, docs_completed_at, notes, record_id |

**Frontend caller:** `loadDashboard(silent)` in `script.js` — called on tab switch, uses `FETCH_TIMEOUTS.load` (10s).

**Worker advantage:** Two parallel Airtable requests can use `Promise.all()` instead of n8n's Merge node. Response formatting runs in ~1ms on the edge instead of sequential node hops.

---

### 2. `GET /admin-pending`

**Current workflow:** `[Admin] Pending Clients` (s7u7iZkk2OrKYQq4CVedd)

**Current logic:**
1. Verify admin token
2. Search `annual_reports`: `AND({year}='{year}', {stage}='Send_Questionnaire', {client_is_active}=TRUE())`
3. Map each report to `{report_id, name, email}`
4. Sort by Hebrew collation on name
5. Return `{ok, clients}`

**Airtable tables:**
| Table | Table ID | Filter | Fields Used |
|-------|----------|--------|-------------|
| annual_reports | `tbls7m3hmHC4hhQVy` | `AND({year}='{year}', {stage}='Send_Questionnaire', {client_is_active}=TRUE())` | client_name, client_email, record_id |

**Frontend caller:** `loadPendingClients(silent)` — called on "Send" tab switch.

**Simplest endpoint after auth** — single Airtable search + map/sort.

---

### 3. `GET /admin-questionnaires`

**Current workflow:** `[API] Admin Questionnaires` (uRG6TGVureMjmJWr)

**Current logic:**
1. Verify admin token (from query param `?token=`)
2. Search `questionnaires` table:
   - If `report_id` provided: filter by `{report_record_id}='{report_id}'`
   - If not: filter by `{year}='{year}'`
3. Call sub-workflow `[SUB] Format Questionnaire` (9zqfOuniztQc2hEl) to format Q&A data
4. Build response with `report_record_id`, `client_info`, `answers`, `raw_answers`
5. De-duplicate report record IDs → batch fetch from `annual_reports` to get `client_questions` field
6. Add `client_questions` to each item
7. Return `{ok, items, count}`

**Airtable tables:**
| Table | Table ID | Filter | Fields Used |
|-------|----------|--------|-------------|
| questionnaires | `tblxEox8MsbliwTZI` | `{report_record_id}` or `{year}` | report_record_id, client_info, answers, raw_answers |
| annual_reports | `tbls7m3hmHC4hhQVy` | Dynamic OR formula by record_id | client_questions, record_id |

**Sub-workflow dependency:** The Format Questionnaire sub-workflow needs to be inlined into the Worker. Read its logic from `9zqfOuniztQc2hEl-_SUB_Format_Questionnaire.json` and port it.

**Frontend caller:** `loadQuestionnaires(silent)` — note: passes token via query param, not header.

---

### 4. `GET /check-existing-submission`

**Current workflow:** `[API] Check Existing Submission` (QVCYbvHetc0HybWI)

**Current logic:**
1. Validate **client token** (different secret: `CLIENT_SECRET_KEY`, format: `expiryUnix.hexHmac`, 45-day expiry)
   - Timing-safe comparison to prevent timing attacks
   - Fire-and-forget security logging on failure
2. Get report by record ID (direct lookup, not search)
3. Search documents: `AND(FIND(report_id, ARRAYJOIN({report_record_id})), {status} != 'Waived', {status} != 'Removed')`
4. Build response:
   - `has_submission`: true if stage >= 3 (Pending_Approval) OR document_count > 0
   - Map filing type (annual_report → form IDs, capital_statement → form IDs)
   - Return: report metadata, stage, submission status, filing type config

**Airtable tables:**
| Table | Table ID | Filter | Fields Used |
|-------|----------|--------|-------------|
| annual_reports | `tbls7m3hmHC4hhQVy` | Direct GET by record ID | client_name, client_email, client_id, spouse_name, year, stage, filing_type |
| documents | `tblcwptR63skeODPn` | `AND(FIND('{report_id}', ARRAYJOIN({report_record_id})), {status}!='Waived', {status}!='Removed')` | status (count only) |

**Important:** This is a **client-facing** endpoint — uses `CLIENT_SECRET_KEY`, not admin token. Uses the client auth middleware from Phase 1.

**Frontend caller:** Client landing page (not admin panel).

---

## External APIs Involved

**None.** All four endpoints are pure Airtable reads + formatting logic.

---

## n8n Workflow Logic Summaries

### Dashboard Response Formatting
The heaviest logic is in the Dashboard's Format Response node:
- **Stage counting:** Iterate all reports, increment `stats.stage{N}` counters
- **Lookup field handling:** `client_is_active` comes as `[true]`, `[null]`, `true`, `false`, or `undefined` from Airtable lookups — must handle all forms
- **Review queue:** Filter + sort subset of clients
- **Hebrew collation:** `localeCompare('he')` for name sorting

### Questionnaire Format Q&A Sub-workflow
The `[SUB] Format Questionnaire` sub-workflow formats raw Tally form answers into a structured Q&A array. Port this logic directly into the Worker handler — no need for sub-workflows in Workers.

---

## Migration Approach

### Route Handlers

```
api/src/routes/
├── auth.ts          # (Phase 1)
├── dashboard.ts     # GET /admin-dashboard
├── pending.ts       # GET /admin-pending
├── questionnaires.ts # GET /admin-questionnaires
└── submission.ts    # GET /check-existing-submission
```

### Dashboard Handler Strategy
The dashboard is the most impactful endpoint. Key optimizations over n8n:

1. **Parallel Airtable calls via `Promise.all()`:**
```
const [reports, yearsData] = await Promise.all([
  airtable.search('tbls7m3hmHC4hhQVy', `{year}='${year}'`),
  airtable.search('tbls7m3hmHC4hhQVy', '', { fields: ['year'] })
]);
```

2. **Single-pass stats calculation:** Instead of n8n's sequential node pipeline, compute stats, client array, and review queue in one loop over the reports array.

3. **Hebrew collation:** Use `Intl.Collator('he')` (available in Workers runtime).

### Questionnaires Handler Strategy
The sub-workflow call needs to be inlined. Read `[SUB] Format Questionnaire` JSON to extract the formatting logic and embed it directly in the handler. Key transformation:
- Raw Tally answers (nested JSON) → structured Q&A array with labels

### Check Existing Submission Strategy
Uses **client auth middleware** instead of admin auth. Both middlewares are already built in Phase 1. The handler itself is straightforward: get report, count non-waived docs, determine submission status.

---

## Frontend Changes

In `shared/endpoints.js`, update these four URLs:

```javascript
// Phase 2 — switch to Worker
ADMIN_DASHBOARD: `${API_BASE_WORKER}/admin-dashboard`,
ADMIN_PENDING: `${API_BASE_WORKER}/admin-pending`,
ADMIN_QUESTIONNAIRES: `${API_BASE_WORKER}/admin-questionnaires`,
CHECK_EXISTING_SUBMISSION: `${API_BASE_WORKER}/check-existing-submission`,
```

**No other frontend changes needed.** Request/response shapes are identical.

---

## Rollback Plan

Revert any or all four endpoint URLs in `shared/endpoints.js` back to the n8n base URL. Each endpoint is independent — if Dashboard works but Questionnaires has a bug, only revert Questionnaires.

---

## Testing Checklist

### Dashboard
- [ ] Returns correct stage counts matching n8n response
- [ ] Client list has all fields (report_id, name, email, year, stage, docs_received, docs_total, docs_completed_at, is_active, notes)
- [ ] `client_is_active` handles all Airtable lookup formats (array, boolean, undefined)
- [ ] Review queue correctly filters stage=Review + is_active + has docs_completed_at
- [ ] Review queue sorted by docs_completed_at ascending (FIFO)
- [ ] Client names sorted by Hebrew collation
- [ ] `available_years` includes all distinct years
- [ ] Year filter parameter works correctly
- [ ] Unauthorized request returns 401
- [ ] Response time < 1 second from Israel

### Pending Clients
- [ ] Only returns clients with stage=Send_Questionnaire and is_active=TRUE
- [ ] Filtered by year
- [ ] Sorted by Hebrew collation
- [ ] Empty result returns `{ok: true, clients: []}`

### Questionnaires
- [ ] Returns all questionnaires for the year when no report_id specified
- [ ] Returns single questionnaire when report_id specified
- [ ] Q&A formatting matches n8n sub-workflow output exactly
- [ ] `client_questions` field enriched from annual_reports table
- [ ] Token via query param (not header) works correctly

### Check Existing Submission
- [ ] Client token validation works (45-day expiry, timing-safe)
- [ ] Expired client token returns proper error
- [ ] `has_submission` = true when stage >= 3
- [ ] `has_submission` = true when document_count > 0
- [ ] Filing type config (form IDs, labels) matches current behavior
- [ ] Security logging fires on invalid tokens
- [ ] Returns client metadata (name, email, spouse, year)

### Cross-cutting
- [ ] CORS headers present on all responses (success + error)
- [ ] OPTIONS preflight returns correct headers
- [ ] Response shapes match n8n exactly (diff JSON outputs)
- [ ] No regression in admin portal tab switching
- [ ] Cache flags (`dashboardLoaded`, etc.) work correctly with Worker responses

---

## Estimated Effort

| Task | Hours |
|------|-------|
| Dashboard handler (parallel queries, stats, formatting) | 3 |
| Pending clients handler | 1 |
| Questionnaires handler (inline sub-workflow logic) | 3 |
| Check Existing Submission handler (client auth) | 2 |
| Read + port Format Questionnaire sub-workflow | 1.5 |
| Response shape validation (diff n8n vs Worker) | 2 |
| Frontend URL switch + browser testing | 1 |
| **Total** | **~13.5 hours** |

---

## Expected Performance Improvement

| Endpoint | Current (n8n) | Expected (Worker) | Improvement |
|----------|---------------|-------------------|-------------|
| Dashboard | 2-4s | 400-800ms | 3-5x faster |
| Pending | 1.5-3s | 300-500ms | 4-6x faster |
| Questionnaires | 2-4s | 500-900ms | 3-4x faster |
| Check Submission | 1-2s | 300-500ms | 3-4x faster |

The main bottleneck becomes Airtable API latency (~200-400ms per query from Cloudflare's edge), which is irreducible. But removing n8n's workflow overhead (200-800ms) and geographic hop (Frankfurt detour) saves 1-3 seconds per request.
