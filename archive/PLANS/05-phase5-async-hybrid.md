# Phase 5: Async Hybrid Endpoints — ✅ COMPLETED

**Design Log:** DL-174 | **Session:** 174 (2026-03-23) | **Status:** COMPLETED

## Goal

Handle endpoints that have **dual responsibilities**: respond to the browser AND trigger side effects (email sending, scheduler execution). The Worker handles the fast response path and triggers n8n asynchronously for the email/notification parts via `ctx.waitUntil()`.

## Implementation Summary

- **No new n8n webhook nodes** — modified auth code in existing workflows to accept `X-Internal-Key` header
- **No email builder porting** — email HTML stays on n8n (hybrid pattern)
- Worker calls same webhook paths as frontend, n8n auth checks header first
- 3 route files: `reminders.ts`, `batch-status.ts`, `edit-documents.ts`
- `upsertRecords()` added to AirtableClient for config table
- Performance: batch-status 5-10s → 30ms, reminders 3-5s → ~500ms, edit-docs 3-5s → ~1s

---

## Endpoints Being Migrated

### 1. `GET /admin-reminders` (List Action → Worker)

**Current workflow:** `[API] Reminder Admin` (RdBTeSoqND9phSfo)

**This endpoint has two modes — only the list mode moves to Worker:**

#### GET Mode (→ Worker)
1. Verify admin token
2. Search `annual_reports`: `AND(OR({stage}='Waiting_For_Answers', {stage}='Collecting_Docs'), {client_is_active}=TRUE())`
3. Fetch `reminder_default_max` from config table
4. Build response:
   - Deduplicate search results by id
   - Parse `reminder_history` JSON field
   - Calculate `_exhausted` flag: `reminder_count >= reminder_max && !reminder_suppress`
   - Stats: total, scheduled, due_this_week, suppressed, exhausted
5. Return `{ok, stats, items, default_max}`

#### POST Modes (→ Hybrid)
- **`action: 'send_now'`** → Worker validates token → fires n8n webhook asynchronously → responds instantly
- **`action: 'execute_scheduler'`** → Worker validates token → fires n8n webhook → responds instantly
- **`action: 'update_config'`** → Worker handles directly (Airtable upsert on config table)

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| annual_reports | `tbls7m3hmHC4hhQVy` | SEARCH | stage, client_is_active, reminder_count, reminder_max, reminder_next_date, reminder_suppress, last_reminder_sent_at, reminder_history, docs_total, docs_received_count, docs_missing_count, client_name, client_email |
| config | `tblqHOkDnvb95YL3O` | SEARCH, UPDATE | config_key, config_value |

**n8n trigger (for send_now/execute_scheduler):**
The Worker fires a POST to the existing `[06] Reminder Scheduler` workflow (or a new thin webhook) with the relevant parameters. n8n handles the actual email sending via MS Graph.

---

### 2. `POST /send-batch-status` (→ Hybrid)

**Current workflow:** `[API] Send Batch Status` (QREwCScDZvhF9njF)

**Current logic:**
1. Verify admin token
2. Extract `report_key`, `client_name`, `items` (approval/rejection list), `classification_ids`
3. Get report from Airtable
4. Search documents for the report
5. Call [SUB] Document Service sub-workflow
6. Build bilingual email HTML:
   - Lists rejected documents with reason translations
   - Lists approved documents with checkmark
   - Progress summary with doc counts
   - 45-day client token for view-documents button
7. Send email via MS Graph (`reports@moshe-atsits.co.il`)
8. Update notification status in Airtable

**Hybrid approach:**
- **Worker handles:** Token verification, instant response `{ok: true, queued: true}`
- **n8n handles:** The full email build + send flow (needs Document Service sub-workflow + MS Graph)

The Worker fires the existing n8n webhook asynchronously via `ctx.waitUntil()`:
```typescript
ctx.waitUntil(
  fetch('https://liozshor.app.n8n.cloud/webhook/send-batch-status-internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': env.INTERNAL_WEBHOOK_KEY },
    body: JSON.stringify({ report_key, client_name, items, classification_ids })
  }).catch(() => {}) // Fire and forget
);
```

The n8n workflow needs a small modification: add a new "internal" webhook path that accepts pre-authenticated requests (verified by a shared internal key instead of admin token).

**Why not fully migrate?** This endpoint calls the Document Service sub-workflow (77KB of embedded logic) and sends email via MS Graph with complex HTML generation. The cost/risk of porting all this to the Worker exceeds the benefit — the admin already gets instant feedback.

---

### 3. `POST /edit-documents` (→ Worker)

**Current workflow:** `[04] Document Edit Handler` (y7n4qaAUiCS4R96W)

**Current logic:**
1. Parse Tally form POST body (complex nested structure with `fields` + `extensions`)
2. Extract hidden fields: report_record_id, client_name, spouse_name, year
3. Extract operations from checkboxes and extensions:
   - `docs_to_waive` (from checkboxes)
   - `docs_to_create` (from checkboxes + custom text field)
   - `docs_to_restore`, `status_changes`, `note_updates`, `name_updates` (from extensions)
4. Save `client_questions` to report via direct Airtable API PATCH (fire-and-forget)
5. Consolidate all modifications into updateMap (dedup by doc ID)
6. Normalize `issuer_key`: spaces → underscores, non-alphanumeric → stripped, lowercase
7. Build `document_uid` format: `{reportId}_{templateId}_{person}[_{issuerKey}]`
8. Update existing documents (batch): status, bookkeepers_notes, issuer_name
9. Create new documents: status=Required_Missing, with generated UIDs
10. Optionally trigger email notification

**Airtable tables:**
| Table | Table ID | Operation | Fields |
|-------|----------|-----------|--------|
| annual_reports | `tbls7m3hmHC4hhQVy` | PATCH (direct API) | client_questions |
| documents | `tblcwptR63skeODPn` | UPDATE (batch), CREATE (batch) | status, bookkeepers_notes, issuer_name, type, category, person, document_uid, document_key, report (link) |

**No MS Graph dependency** — this is pure Airtable. The optional email notification at the end can be fired to n8n asynchronously if needed.

**Decision:** Fully migrate to Worker. The Tally form parsing and Airtable operations are all portable JavaScript. If the email notification trigger is needed, fire it to n8n via `waitUntil()`.

---

### 4. Endpoints That Stay on n8n

These endpoints are NOT migrated — they're email-sending workflows that need n8n's MS Graph credential and template infrastructure:

| Endpoint | Reason to Stay |
|----------|---------------|
| `POST /admin-send-questionnaires` | Sends emails via MS Graph, builds HTML with 45-day tokens, updates stages |
| `GET /approve-and-send` | Dual auth (Bearer + hash), calls Document Service, sends email, renders HTML pages |

**Future consideration:** Once the Worker has reliable MS Graph token management (from Phase 4) and the Document Service logic is ported, these could move to the Worker in a future phase. But the ROI is low — they're not high-frequency endpoints (questionnaires sent once per client, approval is a one-time action).

---

## The `waitUntil()` Pattern

Cloudflare Workers support `ctx.waitUntil(promise)` — a way to do work after the response is sent to the browser. This is perfect for the hybrid pattern:

```typescript
app.post('/send-batch-status', authMiddleware, async (c) => {
  const body = await c.req.json();
  const { report_key, client_name, items, classification_ids } = body;

  // Validate inputs
  if (!report_key || !items?.length) {
    return c.json({ ok: false, error: 'Missing required fields' }, 400);
  }

  // Fire n8n webhook in background (after response is sent)
  c.executionCtx.waitUntil(
    fetch(`${N8N_BASE}/send-batch-status-internal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': c.env.INTERNAL_WEBHOOK_KEY
      },
      body: JSON.stringify({ report_key, client_name, items, classification_ids })
    }).catch(err => {
      // Log error but don't fail — email will be retried manually if needed
      console.error('Failed to trigger n8n batch status:', err);
    })
  );

  // Respond instantly to browser
  return c.json({ ok: true, queued: true });
});
```

**Frontend impact:** The admin panel already handles this gracefully — it shows a toast "Status email sent" without waiting for email delivery confirmation. The `queued: true` response is functionally equivalent to the current behavior.

---

## n8n Workflow Modifications

### New Internal Webhooks
For the hybrid pattern, the existing n8n workflows need an "internal" webhook path that:
1. Accepts a shared internal key (`X-Internal-Key` header) instead of admin token
2. Skips the token verification step
3. Processes the request normally (email build + send)

**Workflows to modify:**
1. `[API] Send Batch Status` — add webhook path `/send-batch-status-internal`
2. `[06] Reminder Scheduler` — add webhook path `/reminder-execute-internal`

These are minimal changes: add a new Webhook trigger node with the internal path, connect it to the existing flow after the auth step.

### New Worker Secret
```bash
wrangler secret put INTERNAL_WEBHOOK_KEY  # Shared key for Worker→n8n calls
```

---

## Migration Approach

### Route Handlers

```
api/src/routes/
├── reminders.ts          # GET (list) + POST (send_now → n8n, update_config → direct)
├── batch-status.ts       # POST → instant response + fire n8n async
└── edit-documents.ts     # POST → full Worker handling (Tally form parse + Airtable ops)
```

### Edit Documents — Tally Form Parsing
The Tally form POST body has a specific structure that needs careful parsing:
- `data.fields[]` — array of form fields with `type` and `value`
- `data.extensions` — JSON object with structured operations
- Hidden fields contain report metadata

Port the exact parsing logic from the n8n Code node. Key operations:
1. Extract hidden fields (report_record_id, etc.)
2. Parse checkbox selections → doc IDs to waive
3. Parse extension arrays → restore, status_change, note_update, name_update operations
4. Normalize issuer keys
5. Generate document UIDs matching the existing format

### Reminders — Dual-Mode Handler
```typescript
app.all('/admin-reminders', authMiddleware, async (c) => {
  const method = c.req.method;
  const body = method === 'POST' ? await c.req.json() : {};

  if (method === 'GET' || body.action === 'list') {
    // Handle locally — search Airtable + build stats
    return handleReminderList(c);
  }

  if (body.action === 'send_now') {
    // Fire n8n async
    c.executionCtx.waitUntil(triggerN8n(c.env, '/reminder-execute-internal', body));
    return c.json({ ok: true, queued: true });
  }

  if (body.action === 'update_config') {
    // Handle locally — upsert config table
    return handleConfigUpdate(c, body);
  }
});
```

---

## Rollback Plan

1. **Reminders (list):** Revert `ADMIN_REMINDERS` URL to n8n
2. **Send Batch Status:** Revert `SEND_BATCH_STATUS` URL to n8n
3. **Edit Documents:** Revert `EDIT_DOCUMENTS` URL to n8n
4. **Internal webhooks:** Can be left in place on n8n (they don't interfere)

Each endpoint is independently rollbackable. The internal webhook modifications to n8n are additive (new webhook paths alongside existing ones).

---

## Testing Checklist

### Reminders (List)
- [ ] Returns correct reminder items (stages 2 + 4, active only)
- [ ] Stats correct: total, scheduled, due_this_week, suppressed, exhausted
- [ ] `reminder_history` JSON parsed correctly
- [ ] `_exhausted` flag calculated correctly
- [ ] `default_max` from config table returned
- [ ] Stats-only mode works (`stats_only` flag)
- [ ] Deduplication by record ID works

### Reminders (Send Now)
- [ ] Worker responds instantly with `{ok: true, queued: true}`
- [ ] n8n internal webhook receives the request
- [ ] Reminder email actually sent to client
- [ ] Airtable reminder fields updated by n8n

### Reminders (Update Config)
- [ ] Config value updated in Airtable config table
- [ ] Returns success

### Send Batch Status
- [ ] Worker responds instantly with `{ok: true, queued: true}`
- [ ] n8n internal webhook receives request with classification IDs
- [ ] Batch status email sent to client
- [ ] Notification status updated in Airtable
- [ ] Frontend toast shows success

### Edit Documents
- [ ] Tally form body parsed correctly (hidden fields, checkboxes, extensions)
- [ ] Documents waived (status → Waived)
- [ ] Documents restored (status back to Required_Missing)
- [ ] New documents created with correct UIDs
- [ ] Notes updated on existing documents
- [ ] Names updated on existing documents
- [ ] Client questions saved to report record
- [ ] Empty operations (no changes) handled gracefully

### Hybrid Pattern
- [ ] `waitUntil()` fires correctly after response is sent
- [ ] Internal webhook key validated by n8n
- [ ] Failed n8n trigger doesn't affect Worker response
- [ ] n8n internal webhook rejects requests without valid key

---

## Estimated Effort

| Task | Hours |
|------|-------|
| Reminders handler (list mode + config update) | 3 |
| Reminders hybrid (send_now → n8n trigger) | 1 |
| Send Batch Status hybrid handler | 1.5 |
| Edit Documents handler (Tally form parsing) | 4 |
| n8n workflow modifications (internal webhooks) | 2 |
| Internal webhook key setup | 0.5 |
| Response shape validation | 1.5 |
| End-to-end testing (reminders tab, batch send, doc edits) | 2.5 |
| **Total** | **~16 hours** |

---

## Expected Performance Improvement

| Endpoint | Current (n8n) | Expected (Worker) | Improvement |
|----------|---------------|-------------------|-------------|
| Reminders (list) | 3-5s | 500ms-1s | 4-6x faster |
| Send Batch Status | 5-10s (blocks until email sent) | <100ms (instant, async) | 50-100x faster perceived |
| Edit Documents | 3-5s | 500ms-1s | 3-5x faster |

The biggest win is Send Batch Status — currently the admin waits 5-10 seconds for the email to actually send before getting a response. With the hybrid pattern, they get instant feedback and the email sends in the background.
