# Design Log 100: MS Graph Email Rate Limiting & Accurate Failure Reporting
**Status:** [IMPLEMENTED]
**Date:** 2026-03-05
**Related Logs:** DL-095 (bulk send fix), DL-098 (batch email execution savings)

## 1. Context & Problem
When sending batch emails (9 test clients), only 4 emails actually delivered. The Send Email HTTP Request node fires all items simultaneously against MS Graph `/me/sendMail`. After 4 rapid requests, MS Graph returns HTTP 429 (Too Many Requests) for the remaining 5.

**Two bugs confirmed:**
1. **No throttling**: All emails fire in parallel (~323ms for 9 items). MS Graph rate-limits after ~4 concurrent requests.
2. **Count Sent is blind to failures**: Reports `sent: 9, failed: 0` when 5 actually got 429. Root cause: Count Sent reads from Update Stage output (clean Airtable records), NOT from Send Email output (where `.error` fields are present).
3. **Stage updates for failed emails**: Update Stage runs for ALL items (including 429'd ones), moving reports to "2-Waiting_For_Answers" even when the email was never sent.

**Affected workflows:**
- `[01] Send Questionnaires` (9rGj2qWyvGWVf9jXhv7cy) — batch questionnaire emails
- `[06] Reminder Scheduler` (FjisCdmWc4ef0qSV) — batch reminder emails

**Not affected** (single-email per execution):
- `[03] Approve & Send` — 1 email per approval
- `[API] Send Batch Status` — 1 email per report

## 2. User Requirements
1. **Q:** Max batch size expected?
   **A:** 600 clients. Can do it in batches if needed.
2. **Q:** Should failed emails auto-retry or report-only?
   **A:** Report only, manual re-send.
3. **Q:** Same MS Graph node across all workflows?
   **A:** Yes, all use the same MS Graph OAuth2 credential.

## 3. Research

### Domain
Email Deliverability, API Rate Limiting, Workflow Orchestration

### Sources Consulted
1. **Microsoft Graph Throttling Guidance** — 4 concurrent requests per mailbox (MailboxConcurrency). 429 responses include `Retry-After` header (10-60s typically).
2. **Exchange Online Limits** — 30 messages/minute per mailbox. 10,000 recipients/day. This is the hard constraint for bulk sends.
3. **n8n HTTP Request Node Docs** — Supports `Options > Batching`: `batchSize` (items per parallel batch) + `batchInterval` (ms delay between batches). Items WITHIN a batch run in parallel.
4. **"Email Marketing Rules" — Chad S. White** — Continue-on-error is mandatory for batch email. State-based idempotency for retry safety.
5. **n8n Rate Limiting Workflows** — Template pattern: batch size 1 + interval between requests. Simplest and most reliable for API rate limits.

### Key Principles Extracted
- **30 emails/min** is the hard Exchange Online limit. At 2.5s/email (batchSize:1, interval:2500ms) = 24/min, safely under limit.
- **Continue-on-error** already enabled (DL-098). But error detection downstream is broken.
- **Paired item references** survive `continueOnFail` — so Update Stage can still reference Build Email Data even for error items.

### Patterns to Use
- **n8n HTTP Request batching**: `batchSize: 1, batchInterval: 2500` — sequential email sending with 2.5s gap.
- **Upstream node reference**: `$('Send Email').all()` in Count Sent — reads Send Email output directly regardless of what flows into Count Sent's input.
- **Frontend chunking**: Split large batches into chunks of 25 from the frontend to stay within n8n execution timeouts.

### Anti-Patterns to Avoid
- **Fire-all-at-once** (current behavior) — guaranteed 429s for >4 emails.
- **Reading error state from downstream node** (current Count Sent bug) — Airtable overwrites the .error field.

### Research Verdict
Three-layer fix: (1) n8n batching prevents 429s, (2) Count Sent references correct node for accurate reporting, (3) frontend chunks large batches for timeout safety. Stage-update-on-failure accepted as rare edge case with batching in place.

## 4. Codebase Analysis

### [01] Send Questionnaires Flow
```
Webhook → Verify & Split → If Valid → Get Report → Get Client → Build Email Data → Send Email → Update Stage → Count Sent → Respond
```
- Send Email (`bc4aff20`): httpRequest v4.2, continueOnFail:true, **no batching**
- Update Stage (`2334ac6d`): Updates Airtable stage to "2-Waiting_For_Answers" for ALL items
- Count Sent (`9f565432`): `$input.all()` reads from Update Stage (loses .error) → BUG

### [06] Reminder Scheduler Flow
```
... → Prepare Email Payload → Send Email → Set Update Fields → Update Reminder Fields
```
- Send Email (`send_email_graph`): httpRequest, **no batching**, status unknown for continueOnFail
- No Count Sent equivalent — errors silently lost

### Frontend
- `sendQuestionnaires()` (script.js:1148): Sends ALL report IDs in one POST
- Timeout: `FETCH_TIMEOUTS.batch = 90000` (90s) — insufficient for 600 clients
- Shows loading spinner with safety timer (95s for bulk)

### Key Node IDs
| Workflow | Node | ID |
|----------|------|-----|
| [01] Send Questionnaires | Send Email | `bc4aff20-9069-4046-91cd-d62f00c162e6` |
| [01] Send Questionnaires | Count Sent | `9f565432-d930-4a98-9d62-f860f64697d0` |
| [06] Reminder Scheduler | Send Email | `send_email_graph` |

## 5. Technical Constraints & Risks
* **Execution timeout**: n8n cloud execution timeout limits how many emails per chunk. At 2.5s/email, 25 emails = ~70s (safe for 2-5 min limits).
* **600 clients × 2.5s = 25 minutes total**. Must chunk from frontend.
* **Stage update for failed sends**: With batching, 429s are nearly eliminated. Accepted as rare edge case — admin sees failure count and can investigate.

## 6. Proposed Solution (The Blueprint)

### Fix 1: Add batching to Send Email nodes (n8n)
**Both [01] and [06]:** Add `options.batching.batch = { batchSize: 1, batchInterval: 2500 }` to the Send Email httpRequest node. This spaces emails 2.5s apart (24/min, under 30/min limit).

### Fix 2: Fix Count Sent error detection ([01] only)
Change Count Sent code from `$input.all()` to `$('Send Email').all()`. This reads the Send Email output directly, where `.error` fields are intact.

Updated code:
```javascript
// Count sent emails — read from Send Email node directly
// (Update Stage overwrites .error, so we must read upstream)
const emailItems = $('Send Email').all();
const successes = emailItems.filter(item => !item.json.error);
const failures = emailItems.filter(item => !!item.json.error);

const errors = failures.map(item => ({
  message: item.json.error?.message || item.json.error || 'Unknown error',
  status: item.json.error?.status || null
}));

return {
  json: {
    ok: failures.length === 0,
    sent: successes.length,
    failed: failures.length,
    errors
  }
};
```

### Fix 3: Frontend chunked sending
Split large batches into chunks of 25, sent sequentially:

```javascript
async function sendQuestionnaires(reportIds) {
    const CHUNK_SIZE = 25;
    const chunks = [];
    for (let i = 0; i < reportIds.length; i += CHUNK_SIZE) {
        chunks.push(reportIds.slice(i, i + CHUNK_SIZE));
    }

    let totalSent = 0, totalFailed = 0, allErrors = [];

    showLoading(`שולח שאלונים... (0/${reportIds.length})`, chunks.length * 95000);

    for (let i = 0; i < chunks.length; i++) {
        updateLoadingText(`שולח שאלונים... (${totalSent}/${reportIds.length})`);
        const response = await fetchWithTimeout(..., FETCH_TIMEOUTS.batch);
        const data = await response.json();
        totalSent += data.sent || 0;
        totalFailed += data.failed || 0;
        if (data.errors) allErrors.push(...data.errors);
    }

    // Show final results
}
```

### Fix 4: Add continueOnFail to [06] Send Email
Ensure the Reminder Scheduler's Send Email node also has `continueOnFail: true` (may already be set — verify).

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n `[01] Send Questionnaires` Send Email | Modify | Add `options.batching.batch = {batchSize:1, batchInterval:2500}` |
| n8n `[01] Send Questionnaires` Count Sent | Modify | Change `$input.all()` → `$('Send Email').all()` |
| n8n `[06] Reminder Scheduler` Send Email | Modify | Add batching + verify continueOnFail |
| `admin/js/script.js` | Modify | Chunk sendQuestionnaires into batches of 25 |
| `admin/js/script.js` | Modify | Add `updateLoadingText()` helper or update showLoading |

## 7. Validation Plan
* [ ] Send questionnaire to 1 client — works identically to before
* [ ] Send questionnaires to 9 test clients — all 9 should succeed (no 429s)
* [ ] Verify Send Email node shows 2.5s gap between items in execution timeline
* [ ] Verify Count Sent reports accurate sent/failed counts
* [ ] Test with deliberate failure (invalid email) — verify `failed: 1` in response
* [ ] Test chunking with >25 clients — verify multiple requests in network tab
* [ ] Verify loading text updates with progress
* [ ] Check [06] Reminder Scheduler Send Email has batching configured

## 8. Implementation Notes

### n8n Changes Applied
1. **[01] Send Email** — Restored full HTTP parameters + added `options.batching.batch = {batchSize:1, batchInterval:2500}`. MCP partial update initially corrupted the node by replacing ALL parameters with just the options object; fixed by re-sending full parameters.
2. **[01] Count Sent** — Changed `$input.all()` → `$('Send Email').all()` and `ok: true` → `ok: failures.length === 0`.
3. **[06] Send Email** — Added batching config (same as [01]) + set `continueOnFail: true` via REST API (MCP updateNode doesn't support top-level node properties).

### Frontend Changes (script.js)
4. **sendQuestionnaires()** — Chunks reportIds into batches of 25, sends sequentially, aggregates sent/failed counts across chunks. Loading text updates with progress `(N/total)`. Safety timer scales with chunk count.
5. **Failure reporting** — Three result tiers: all-success (green), partial (warning with counts), all-failed (error). Mid-stream errors preserve partial success state.

### MCP Gotcha Documented
- `n8n_update_partial_workflow` `updateNode` replaces the ENTIRE `parameters` object, not individual keys. Always include all existing parameters when updating. Validation may report failure while changes are partially applied.
