# Design Log 203: WF05 Inbound Email Processing — Migration to Cloudflare Worker
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-26
**Related Logs:** [035](../ai-review/035-wf05-ai-classification-onedrive-upload.md), [046](../ai-review/046-wf05-loop-restructure-classification-optimization.md), [112](../ai-review/112-dedup-lock-airtable-upsert.md), [199](../ai-review/199-wf05-code-node-http-blocked.md)

## 1. Context & Problem

WF05 (`[05] Inbound Document Processing`, ID: `cIa23K8v1PrbDJqY`) is a 56-node n8n workflow that processes inbound client emails: fetches email + attachments from MS Graph, identifies the client, classifies documents via AI, uploads to OneDrive, and updates Airtable.

**Problems:**
1. **Overly complex** — 56 nodes with ~15 inside a loop. Hard to debug, trace failures, or understand the flow.
2. **Broken dedup** — Layer 1 dedup (Code node HTTP → Airtable upsert) has been silently failing since DL-112. n8n Cloud blocks `$helpers.httpRequest()` and `fetch()` in Code nodes.
3. **Not testable** — No unit tests possible for n8n visual nodes. Business logic locked inside Code node strings.
4. **Error blind spots** — Failures in the middle of the pipeline are hard to detect. No structured error logging.
5. **n8n Cloud limitations** — Code node sandbox restrictions prevent legitimate HTTP calls, limiting architectural options.

**Why now:** The Worker API (`api/src/`) already has all the building blocks (MSGraphClient, AirtableClient, Anthropic API key, KV namespaces). The migration is a natural evolution, not a rewrite.

## 2. User Requirements

1. **Q:** How much of WF05 should move to the Worker?
   **A:** Everything after the webhook trigger. n8n keeps only the thin MS Graph webhook → forward to Worker.

2. **Q:** Should DL-199 dedup fixes be part of this migration?
   **A:** Yes — KV dedup is trivial in Worker. Fixes dedup as a natural side-effect.

3. **Q:** Sync or async processing?
   **A:** Async with `ctx.waitUntil()`. Respond immediately, process in background.

4. **Q:** Include client notes feature (DL-199)?
   **A:** Yes — move it too. It's just an Anthropic call + Airtable write.

## 3. Research

### Domain
Workflow Orchestration Migration, Background Processing, Distributed Deduplication

### Sources Consulted
1. **"Designing Data-Intensive Applications" (Kleppmann)** — Exactly-once delivery is impossible; aim for exactly-once *processing* via idempotency + dedup caches. Layer cheapest filter first.
2. **Cloudflare Workers Docs (limits + waitUntil)** — `waitUntil()` extends execution 30s after response. No hard wall-clock limit while client connected. CPU time: 5 min on paid plan. Don't destructure `ctx`.
3. **Architecture Weekly: "Deduplication in Distributed Systems"** — Bounded dedup cache with TTL. Consumer-side idempotency is more reliable than broker-side dedup. Use inbox pattern for processed message IDs.

### Key Principles Extracted
- **Layered dedup (cheapest first):** Layer 0 (filter changeType) → Layer 1 (KV cache, ~1ms) → Layer 2 (Airtable hash query, ~300ms). Each layer is cheaper/faster than the next.
- **Idempotent consumers:** Each step should be safe to re-execute. Airtable upserts on unique keys. OneDrive uploads with `conflictBehavior: replace`.
- **Respond-then-process:** Return 200 immediately, process via `waitUntil()`. Prevents webhook timeouts and allows the caller (n8n) to proceed.
- **Independent attachment processing:** One failed attachment shouldn't block others. Process sequentially but isolate errors per attachment.

### Patterns to Use
- **Fire-and-forget with waitUntil:** Matches existing Worker pattern (audit logs, error alerts)
- **KV dedup cache:** `CACHE_KV.put(key, '1', {expirationTtl: 86400})` — atomic, fast, self-cleaning
- **Modular pipeline:** Each concern in its own file (client ID, classification, attachments)

### Anti-Patterns to Avoid
- **Monolithic handler:** Tempting to put everything in one function, but kills testability. Split by concern.
- **Synchronous sequential everything:** LLM summarization + attachment processing can overlap.
- **Silent failure:** n8n's current pattern. Every error must be logged via `logError()`.

### Research Verdict
Full migration to Worker. The infrastructure already exists (MSGraphClient, AirtableClient, ANTHROPIC_API_KEY, CACHE_KV). The migration fixes the dedup bug, adds type safety, enables testing, and reduces WF05 from 56 to 6 nodes.

## 4. Codebase Analysis

### Existing Solutions Found
- `MSGraphClient` (`api/src/lib/ms-graph.ts`) — `.get()`, `.post()`, `.patch()`, `.putBinary()`, `.sendMail()`. Auto-retries on 401.
- `AirtableClient` (`api/src/lib/airtable.ts`) — `.listAllRecords()`, `.createRecords()`, `.updateRecord()`, `.upsertRecords()`.
- `DRIVE_ID`, `sanitizeFilename()` (`api/src/lib/classification-helpers.ts`) — OneDrive constants and filename cleanup.
- `logError()` (`api/src/lib/error-logger.ts`) — Fire-and-forget Airtable + email alerts.
- `OFFICE_EMAIL` (`api/src/lib/email-styles.ts`) — Mailbox constant.

### Reuse Decision
All existing libs reused as-is. New code organized into `api/src/lib/inbound/` directory with 5 files.

### Relevant Files
- `api/src/index.ts` — Route mounting (modify: add import + mount)
- `api/src/lib/types.ts` — Env interface (has all bindings we need)
- `api/src/routes/upload-document.ts` — Reference pattern for file handling
- `api/src/routes/classifications.ts` — Reference pattern for classification Airtable queries

### Existing Patterns
- All routes: Hono router, `{ok: boolean}` response, try/catch + logError
- Auth: Bearer token validation against env secret
- Constructor order: `new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT)` (**note:** `error-logger.ts:40` has args swapped — existing bug, don't replicate)

### Dependencies
- Airtable tables: clients, reports, documents, email_events, pending_classifications, templates
- MS Graph API: email fetch, attachments, mark read, OneDrive upload, PDF conversion
- Anthropic API: document classification (tool_use), email summarization, client identification (Haiku)
- KV: `CACHE_KV` (dedup), `TOKEN_CACHE` (Graph auth)

## 5. Technical Constraints & Risks

### Security
- `N8N_INTERNAL_KEY` for Worker ↔ n8n auth (already exists as secret)
- `ANTHROPIC_API_KEY` for AI calls (already bound)
- MS Graph OAuth2 tokens managed by existing `ms-graph-token.ts`
- No PII in KV dedup keys (just message_id hashes)

### Risks
| Risk | Mitigation |
|------|------------|
| waitUntil exceeds 30s | Processing is mostly I/O (~15-25s for 3 attachments). Monitor and add Queues if needed |
| Worker deployment breaks existing routes | All new code in new files. Only `index.ts` gets 2 lines added |
| Graph mailbox path wrong (/me vs /users) | Worker must use `/users/reports@moshe-atsits.co.il/...` not `/me/` |
| Shadow mode doubles Airtable writes | Use marker field `source: 'worker'` during shadow mode |
| Image-to-PDF not feasible in Workers | Upload images as-is. PDF conversion post-upload if needed |

### Breaking Changes
None. New endpoint, old pipeline stays until cutover.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

**Worker endpoint: `POST /webhook/process-inbound-email`**

1. Validate auth (`N8N_INTERNAL_KEY`)
2. Parse body: `{message_id, change_type}`
3. Layer 0: Skip if `change_type !== 'created'`
4. Layer 1: KV dedup — `CACHE_KV.get('dedup:' + message_id)` → skip if exists
5. KV dedup lock — `CACHE_KV.put('dedup:' + message_id, '1', {expirationTtl: 86400})`
6. Respond `{ok: true, status: 'processing'}`
7. `ctx.waitUntil(processInboundEmail(env, ctx, message_id))`

**processInboundEmail pipeline:**

1. Init MSGraphClient + AirtableClient
2. Fetch email: `graph.get('/users/reports@moshe-atsits.co.il/messages/{id}?$select=...')`
3. Extract metadata (sender, subject, body), check auto-reply patterns
4. If auto-reply → log email event as "Filtered", return
5. Fetch attachments: `graph.get('/users/.../messages/{id}/attachments')`
6. Filter valid attachments (skip inline, tiny, non-doc types)
7. Mark as read: `graph.patch('/users/.../messages/{id}', {isRead: true})`
8. Upsert email event (status: "Detected")
9. Identify client (3-tier cascade):
   - Tier 1: Email match in clients table
   - Tier 2: Parse forwarded headers + sender name match
   - Tier 3: AI (Haiku, confidence >= 0.5)
   - Fallback: unidentified
10. Get active report (latest year, stage = Collecting_Docs or Review)
11. Get required docs for report
12. **Parallel:** LLM summarize email → save client note
13. **Sequential per attachment:**
    a. Classify via Anthropic tool_use (Haiku)
    b. Check file hash duplicate (Airtable query)
    c. Upload to OneDrive (correct folder based on classification)
    d. Office-to-PDF conversion if needed (MS Graph `?format=pdf`)
    e. Create pending classification in Airtable
    f. Update document record if matched template
14. Update email event status to "Completed"

**n8n WF05 (thin trigger, 6 nodes):**
1. Email Notification (webhook)
2. Check Validation (IF)
3. Respond Validation
4. Extract Notification (Code)
5. Respond 202
6. HTTP Request → `POST .../webhook/process-inbound-email`

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/types.ts` | Create | Pipeline types + Airtable table constants |
| `api/src/lib/inbound/attachment-utils.ts` | Create | Filter, fetch, upload, convert helpers |
| `api/src/lib/inbound/client-identifier.ts` | Create | 3-tier client identification cascade |
| `api/src/lib/inbound/document-classifier.ts` | Create | AI classification + hash dedup |
| `api/src/lib/inbound/processor.ts` | Create | Main pipeline orchestrator |
| `api/src/routes/inbound-email.ts` | Create | Route handler with auth + dedup + waitUntil |
| `api/src/index.ts` | Modify | Mount new route (+2 lines) |
| n8n WF05 | Modify | Keep 5 nodes, add 1 HTTP node, disable 50 old nodes |

### Migration Strategy
1. **Build & deploy** — new endpoint, no traffic
2. **Shadow mode** — n8n sends to both old pipeline + Worker in parallel (2-3 days)
3. **Cutover** — disable old branch, Worker handles all traffic
4. **Cleanup** — remove disabled nodes

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan

* [ ] Worker builds and deploys without errors (`wrangler deploy`)
* [ ] Auth: unauthenticated request returns 401
* [ ] Layer 0: `change_type: 'updated'` returns `{status: 'skipped', reason: 'change_type_not_created'}`
* [ ] Layer 1: duplicate message_id returns `{status: 'skipped', reason: 'duplicate'}`
* [ ] Manual test: send real message_id, verify email_events row created in Airtable
* [ ] Client identification: known client email matches correctly
* [ ] Attachments uploaded to correct OneDrive folder
* [ ] Pending classification created with correct template_id and confidence
* [ ] Document record updated with file_url when matched
* [ ] Client note saved to report record
* [ ] Auto-reply email filtered (not processed)
* [ ] Office doc (XLSX) converted to PDF after upload
* [ ] Shadow mode: Worker results match n8n results for 2+ days
* [ ] Error handling: simulate failure, verify logError fires + email alert sent
* [ ] No regression on existing Worker endpoints (health check, other routes)

## 8. Implementation Notes (Post-Code)

**Implementation date:** 2026-03-26

### Files Created
- `api/src/lib/inbound/types.ts` (~130 lines) — Pipeline types, table constants, extension sets
- `api/src/lib/inbound/attachment-utils.ts` (~105 lines) — Filter, fetch, hash, upload helpers
- `api/src/lib/inbound/client-identifier.ts` (~370 lines) — 4-tier client identification cascade
- `api/src/lib/inbound/document-classifier.ts` (~220 lines) — Anthropic tool_use classification + hash dedup
- `api/src/lib/inbound/processor.ts` (~300 lines) — Main pipeline orchestrator
- `api/src/routes/inbound-email.ts` (~65 lines) — Route handler with auth, dedup, waitUntil

### Files Modified
- `api/src/index.ts` — Added import + route mount for inbound-email

### Smoke Test Results (2026-03-26)
- Auth (no token): 401 ✅
- Layer 0 (change_type=updated): skipped ✅
- Layer 1 (first call): processing ✅
- Layer 1 (duplicate): skipped ✅
- Deployed to: https://annual-reports-api.liozshor1.workers.dev (version 06dad942)

### Deviations from Plan
- `convertOfficeToPdf()` returns null (TODO) — MSGraphClient needs binary GET method for this. Office-to-PDF conversion will be addressed in follow-up.
- Image-to-PDF conversion not implemented — images uploaded as-is per plan recommendation.

### Next Steps
- Shadow mode: Add parallel branch in n8n WF05 to send to Worker
- Test with real emails (not just smoke test)
- After shadow mode validation: cutover n8n to thin trigger
