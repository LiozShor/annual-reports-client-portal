# Phase 3: Simple Write Endpoints

**Status:** COMPLETED (session 172, DL-171)

## Goal

Migrate all **mutation endpoints** that write to Airtable but don't call external APIs (no MS Graph, no email sending). These are the second-biggest UX win — every click on "change stage", "archive client", "save notes" currently takes 2-4 seconds and will drop to under 500ms.

---

## Endpoints Being Migrated

### 1. `POST /admin-change-stage`

**Current workflow:** `[API] Admin Change Stage` (3fjQJAwX1ZGj93vL)

**Current logic:**
1. Verify admin token
2. Validate `report_id` and `target_stage` against allowed stages list
3. Get report from `annual_reports` by ID
4. **Process stage change:**
   - Detect backward transitions (regression from higher stage to lower)
   - Clear `docs_completed_at` on backward moves from stage 5+
   - **Reminder logic (DL-155):** If target stage is 2 (Waiting_For_Answers) or 4 (Collecting_Docs):
     - Calculate next reminder date: twice-monthly cadence on 1st & 15th
     - If day < 15 → next 1st; else → next 15th (skip one cycle)
     - Preserve `reminder_suppress: 'forever'` if already set
   - Reset reminder fields on transitions to stage 5+
5. Update report: `stage`, `docs_completed_at`, `reminder_count`, `reminder_suppress`, `reminder_next_date`, `last_reminder_sent_at`
6. **Clear last_reminder_sent_at:** Direct Airtable API PATCH (n8n node can't clear dateTime fields with null) using hardcoded PAT
7. Create audit log entry in `audit_logs` table
8. Return `{ok: true}`

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| annual_reports | `tbls7m3hmHC4hhQVy` | GET + UPDATE | stage, docs_completed_at, reminder_count, reminder_suppress, reminder_next_date, last_reminder_sent_at |
| audit_logs | `tblVjLznorm0jrRtd` | CREATE | action, report_id, details, timestamp, actor |

**Key detail:** The separate Airtable API PATCH to clear `last_reminder_sent_at` (because n8n's Airtable node can't send `null` for dateTime fields) is unnecessary in the Worker — just include `null` in the update payload directly.

---

### 2. `POST /admin-toggle-active`

**Current workflow:** `[API] Admin Toggle Active` (jIvRNEOifVc3SIgi)

**Current logic:**
1. Verify admin token
2. Validate `report_id` and `active` (must be boolean)
3. Get report → extract linked `client` record ID (array → first element)
4. Update `clients` table: set `is_active` to the new value
5. Create audit log entry
6. Return `{ok: true, active: boolean, client_name: string}`

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| annual_reports | `tbls7m3hmHC4hhQVy` | GET | client (linked record) |
| clients | `tblFFttFScDRZ7Ah5` | UPDATE | is_active |
| audit_logs | `tblVjLznorm0jrRtd` | CREATE | action, report_id, details, timestamp |

---

### 3. `POST /admin-update-client`

**Current workflow:** `[API] Admin Update Client` (grR1Xs2vMEuq8QtZ)

**Current logic:**
1. Verify admin token
2. Three action routes:
   - **`action: 'get'`** — Return current client details (name, email, phone)
   - **`action: 'update'`** — Update client name/email/phone (requires at least one field)
   - **`action: 'update-notes'`** — Update report notes field
3. Get report → extract linked `client` record ID
4. Route to appropriate operation
5. Create audit log on update (not on get)
6. Return `{ok: true}` or `{ok: true, client: {name, email, phone}}`

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| annual_reports | `tbls7m3hmHC4hhQVy` | GET, UPDATE (notes) | client (linked), notes |
| clients | `tblFFttFScDRZ7Ah5` | GET, UPDATE | name, email, phone |
| audit_logs | `tblVjLznorm0jrRtd` | CREATE | action, report_id, details, timestamp |

---

### 4. `POST /admin-mark-complete`

**Current workflow:** `[Admin] Mark Complete` (loOiiYcMqIgSRVfr)

**Current logic:**
1. Verify admin token
2. Update report stage to `"Completed"`
3. Return `{ok: true}`

**Simplest write endpoint.** No audit logging, no conditional logic.

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| annual_reports | `tbls7m3hmHC4hhQVy` | UPDATE | stage → "Completed" |

---

### 5. `POST /admin-bulk-import`

**Current workflow:** `[Admin] Bulk Import` (DjIXYUiERMe-vMYnAImuO)

**Current logic:**
1. Verify admin token
2. Extract `year` and `clients[]` array (each: `{name, email}`)
3. **Parallel loads:** Get existing clients + Get existing reports for year
4. **Filter duplicates:**
   - Skip clients with email already in clients table
   - Skip clients with email already having a report for this year
   - Deduplicate within the import batch (case-insensitive email)
5. For each new client:
   - Generate `questionnaire_token` (crypto.randomBytes hex)
   - Generate `report_uid` (crypto.randomUUID)
   - Create client record in `clients` table (name, email, is_active=true)
   - Create annual report record (linked to client, year, stage=Send_Questionnaire, tokens)
6. Count successes/failures (continueOnFail pattern)
7. Return `{ok: true, created: N, skipped: N, failed: N, report_ids: [...]}`

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| clients | `tblFFttFScDRZ7Ah5` | SEARCH, CREATE | name, email, is_active |
| annual_reports | `tbls7m3hmHC4hhQVy` | SEARCH, CREATE | client (link), year, stage, questionnaire_token, report_uid |

**Worker advantage:** Can use `Promise.allSettled()` for batch creates instead of n8n's sequential-with-continueOnFail. Also, Airtable's batch create API (10 records per call) is more efficient than n8n's one-at-a-time approach.

---

### 6. `POST /admin-year-rollover`

**Current workflow:** `[Admin] Year Rollover` (ODsIuVv0d8Lxl12R)

**Current logic:**
1. Verify admin token
2. Validate `source_year`, `target_year` (must differ), and `mode` ('preview' or 'execute')
3. **Parallel loads (3 queries):**
   - Get active clients (is_active=TRUE)
   - Get source year reports
   - Get target year reports
4. **Process rollover:**
   - Build sets: sourceClientIds, targetClientIds
   - Eligible = active ∩ hasSource - hasTarget
   - **Preview mode:** Return count + client list, no mutations
   - **Execute mode:** For each eligible client, generate UUID + token, emit for creation
5. Create report records for eligible clients
6. Return `{ok: true, created: N, already_exist: N, eligible: N}`

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| clients | `tblFFttFScDRZ7Ah5` | SEARCH | is_active |
| annual_reports | `tbls7m3hmHC4hhQVy` | SEARCH (×2), CREATE (batch) | client, year, stage, questionnaire_token, report_uid |

---

### 7. `POST /reset-submission`

**Current workflow:** `[API] Reset Submission` (ZTigIbycpt0ldemO)

**Current logic:**
1. Validate **client token** (CLIENT_SECRET_KEY, timing-safe comparison, 45-day expiry)
2. Security logging on invalid token (fire-and-forget)
3. Get report by ID
4. Search documents linked to report: `FIND('{report_id}', ARRAYJOIN({report_record_id}))`
5. Delete all found documents (batch)
6. Search questionnaire responses linked to report
7. Delete all found responses (batch)
8. Update report: stage → `Waiting_For_Answers`, update `last_progress_check_at`
9. Return success

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| annual_reports | `tbls7m3hmHC4hhQVy` | GET, UPDATE | stage, last_progress_check_at |
| documents | `tblcwptR63skeODPn` | SEARCH, DELETE (batch) | report_record_id |
| questionnaires | `tblxEox8MsbliwTZI` | SEARCH, DELETE (batch) | report_record_id |

**Important:** This is a **client-facing** endpoint — uses `CLIENT_SECRET_KEY` and client auth middleware. Also the most destructive endpoint (deletes records), so the security logging is critical.

---

## External APIs Involved

**None.** All seven endpoints are pure Airtable CRUD operations.

---

## Migration Approach

### Route Handlers

```
api/src/routes/
├── auth.ts               # (Phase 1)
├── dashboard.ts          # (Phase 2)
├── pending.ts            # (Phase 2)
├── questionnaires.ts     # (Phase 2)
├── submission.ts         # (Phase 2)
├── stage.ts              # POST /admin-change-stage + POST /admin-mark-complete
├── client.ts             # POST /admin-toggle-active + POST /admin-update-client
├── import.ts             # POST /admin-bulk-import
├── rollover.ts           # POST /admin-year-rollover
└── reset.ts              # POST /reset-submission
```

### Shared Utilities Needed

#### Audit Logger (`lib/audit-log.ts`)
```typescript
async function logAudit(env: Env, ctx: ExecutionContext, entry: {
  action: string;
  report_id?: string;
  details: string;
}): Promise<void> {
  ctx.waitUntil(
    airtable.create(env, 'tblVjLznorm0jrRtd', {
      action: entry.action,
      report_id: entry.report_id,
      details: entry.details,
      timestamp: new Date().toISOString(),
      actor: 'admin'
    }).catch(() => {})
  );
}
```
Fire-and-forget via `ctx.waitUntil()` — audit logging never blocks the response.

#### Reminder Date Calculator (`lib/reminders.ts`)
Port the twice-monthly cadence logic from the Change Stage workflow:
```
If target is reminder stage (2 or 4):
  Skip one cycle, then schedule on 1st or 15th
  If today's day < 15 → next 1st of next month
  If today's day >= 15 → next 15th of next month
```

#### Batch Operations
For bulk import and year rollover, use Airtable's batch APIs:
- Create: `POST /v0/{baseId}/{tableId}` with `records[]` (max 10 per call)
- Delete: `DELETE /v0/{baseId}/{tableId}?records[]={id1}&records[]={id2}` (max 10)

Chunk operations into groups of 10 and run sequentially (Airtable rate limit: 5 req/sec).

### Key Implementation Patterns

#### Change Stage — Simplification Over n8n
In n8n, clearing a dateTime field requires a separate API PATCH call because the Airtable node can't send `null`. In the Worker, we just include `last_reminder_sent_at: null` in the update payload — one fewer API call.

#### Bulk Import — Optimized Batching
n8n creates clients one-at-a-time with `continueOnFail`. The Worker can:
1. Batch create clients 10 at a time via Airtable batch API
2. Use `Promise.allSettled()` to handle partial failures
3. Chain: create all clients → create all reports (linking to client IDs)

#### Reset Submission — Sequential Deletes
Must delete documents before questionnaire responses (in case of foreign key constraints). Use Airtable batch delete (max 10 per call), chunked.

---

## Rollback Plan

Each endpoint has its own URL in `shared/endpoints.js`. Revert individual endpoints or all seven at once:

```javascript
// Revert one endpoint
ADMIN_CHANGE_STAGE: `${API_BASE_N8N}/admin-change-stage`,  // back to n8n

// All others stay on Worker
ADMIN_TOGGLE_ACTIVE: `${API_BASE_WORKER}/admin-toggle-active`,
```

**Data safety:** All mutations go to the same Airtable base regardless of whether the Worker or n8n handles the request. No data migration needed.

---

## Testing Checklist

### Change Stage
- [ ] Stage transitions work for all 8 stages
- [ ] Forward transitions (1→2, 4→5) work correctly
- [ ] Backward transitions (5→4) clear docs_completed_at
- [ ] Reminder fields set correctly for stages 2 and 4
- [ ] Reminder fields cleared for stages 5+
- [ ] `reminder_suppress: 'forever'` preserved on stage change
- [ ] `last_reminder_sent_at` cleared to null (verify in Airtable)
- [ ] Audit log entry created with correct details
- [ ] Invalid stage rejected with error

### Toggle Active
- [ ] Archive (active=false) works, returns `{ok: true, active: false, client_name: "..."}`
- [ ] Reactivate (active=true) works
- [ ] Linked client record updated (not report)
- [ ] Audit log differentiates "Reactivated" vs "Deactivated"

### Update Client
- [ ] `action: 'get'` returns current {name, email, phone}
- [ ] `action: 'update'` updates name, email, phone (individually and together)
- [ ] `action: 'update-notes'` updates report notes field
- [ ] Audit log created on update but not on get
- [ ] At least one field required for update action

### Mark Complete
- [ ] Sets stage to "Completed"
- [ ] No audit log (matches current behavior)
- [ ] Simple and fast

### Bulk Import
- [ ] Deduplicates against existing clients by email (case-insensitive)
- [ ] Deduplicates against existing reports for the target year
- [ ] Deduplicates within the import batch itself
- [ ] Creates client + report pairs for new entries
- [ ] Reports have stage=Send_Questionnaire, valid tokens
- [ ] Returns correct {created, skipped, failed} counts
- [ ] Partial failures don't block successful creates

### Year Rollover
- [ ] Preview mode returns count + client list without mutations
- [ ] Execute mode creates reports for eligible clients only
- [ ] Eligible = active ∩ has_source_report - has_target_report
- [ ] New reports have correct year, stage=Send_Questionnaire, valid tokens
- [ ] Returns correct {created, already_exist, eligible} counts

### Reset Submission
- [ ] Client token validation (45-day expiry, timing-safe)
- [ ] All documents for report deleted
- [ ] All questionnaire responses for report deleted
- [ ] Report stage reset to Waiting_For_Answers
- [ ] Security logging on invalid token
- [ ] Returns success after all operations complete

### Cross-cutting
- [ ] All 7 endpoints return proper CORS headers
- [ ] All return 401 on unauthorized requests
- [ ] Response shapes match n8n exactly
- [ ] Admin portal write operations all work end-to-end

---

## Estimated Effort

| Task | Hours |
|------|-------|
| Change Stage handler (with reminder logic) | 2.5 |
| Toggle Active handler | 1 |
| Update Client handler (3-way routing) | 1.5 |
| Mark Complete handler | 0.5 |
| Bulk Import handler (dedup + batch create) | 3 |
| Year Rollover handler (preview/execute modes) | 2.5 |
| Reset Submission handler (batch delete) | 2 |
| Audit logger utility | 0.5 |
| Reminder date calculator utility | 0.5 |
| Response shape validation | 2 |
| Frontend integration + browser testing | 1.5 |
| **Total** | **~17.5 hours** |

---

## Expected Performance Improvement

| Endpoint | Current (n8n) | Expected (Worker) | Improvement |
|----------|---------------|-------------------|-------------|
| Change Stage | 2-4s | 300-500ms | 5-8x faster |
| Toggle Active | 2-3s | 300-400ms | 5-7x faster |
| Update Client | 2-3s | 300-500ms | 5-6x faster |
| Mark Complete | 1.5-2s | 200-300ms | 5-7x faster |
| Bulk Import (20 clients) | 15-30s | 5-8s | 3-4x faster |
| Year Rollover (execute) | 10-20s | 4-6s | 3-4x faster |
| Reset Submission | 3-5s | 500-800ms | 4-6x faster |

Bulk operations are still bounded by Airtable rate limits (5 req/sec), but removing n8n overhead saves significant time on the per-record overhead.
