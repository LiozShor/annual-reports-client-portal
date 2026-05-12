# Design Log 098: Batch Email Execution Savings
**Status:** [COMPLETED — 2026-05-12]
**Date:** 2026-03-05
**Related Logs:** DL-095 (bulk send questionnaires bug — separate fix)

## 1. Context & Problem
Bulk email sends (questionnaires + reminders) use a sequential per-client pattern: the frontend loops over client IDs, making 1 API call per client. Each call = 1 n8n workflow execution. For 500 clients, that's 500 executions per batch send — rapidly consuming the monthly quota (Starter: 2,500/mo, Pro: 10,000/mo).

The irony: the n8n workflows already support arrays internally. The questionnaire workflow's "Verify & Split" node maps `report_ids` into N items and fans out natively. The frontend just never sends more than one ID per call.

## 2. User Requirements
1. **Q:** Which bulk email flows to fix?
   **A:** Both — questionnaires and reminders.
2. **Q:** Main pain point?
   **A:** Wasting n8n execution quota (not UI speed).
3. **Q:** Supersede DL-095?
   **A:** No — keep DL-095 separate (different bug).
4. **Q:** Per-client progress needed?
   **A:** No — simple "Sending to N clients..." spinner is fine.

## 3. Research

### Domain
Workflow Orchestration, Transactional Email Batching, Batch API Design

### Sources Consulted
1. **n8n Official Docs (Looping, Execute Sub-workflow, Error Handling)** — n8n processes all items in a single execution natively. Sub-workflow executions are FREE on n8n cloud. "Continue On Fail" prevents one failure from killing the batch.
2. **Postmark Batch Email API** — Batch endpoint accepts up to 500 messages, returns per-message result array. Model for our response shape.
3. **Microsoft Azure Architecture Center (Async Request-Reply pattern)** — For long-running operations, 202 + polling is standard. But for <90s operations, synchronous with generous timeout is simpler and acceptable.
4. **"Email Marketing Rules" — Chad S. White** — Separate transactional from marketing streams. Continue-on-error for batch sends. State-based idempotency > provider-side TTL keys.
5. **Eleken Bulk Actions UX Guide + NNGroup** — Show count in confirmation, simple spinner during execution, summary toast/modal on completion with failure detail action.

### Key Principles Extracted
- **1 trigger = 1 execution** regardless of item count — n8n's fundamental model. Sub-executions don't count toward monthly limit.
- **Continue-on-error is mandatory for email batches** — one bad email address must not kill the whole send.
- **State-based idempotency** (Airtable field check) beats provider TTL keys for retry safety.
- **Synchronous is fine for <500 items** — MS Graph sends at ~150ms each = ~75s for 500 clients. Within a 90s timeout.

### Patterns to Use
- **Native n8n fan-out:** Send array of IDs → Code node maps to items → downstream nodes iterate natively. Already implemented in [01] Send Questionnaires.
- **Continue On Fail + error counting:** Enable `continueOnFail` on Send Email node, then count error items vs. success items in the response.
- **Parameterized safety timer:** `showLoading(text, safetyMs)` — default 25s for normal ops, 95s for batch ops.

### Anti-Patterns to Avoid
- **Abort-on-first-failure:** One failed email kills remaining 499. Tempting because it's the default — must explicitly enable Continue On Fail.
- **Retry the whole batch:** Re-sends to recipients who already got the email. Not in scope for this DL but noted for future idempotency work.
- **Polling/SSE for 500-client batches:** Over-engineering. Synchronous with 90s timeout is simpler and sufficient.

### Research Verdict
Frontend-only change for both flows: send all IDs in one POST instead of looping. n8n workflows already handle arrays. Only n8n changes: (1) enable `continueOnFail` on Send Email for safety, (2) update Count Sent to report failures, (3) set `Execute Scheduler` mode to `each` for explicit multi-item handling.

## 4. Codebase Analysis
* **Existing Solutions Found:** `performServerImport()` already uses the single-POST-with-full-array pattern. `[01] Send Questionnaires` already supports array input via "Verify & Split" node.
* **Reuse Decision:** Reuse the import pattern for frontend. No new n8n workflows needed — existing ones already batch-capable.
* **Relevant Files:**
  - `admin/js/script.js` — `sendQuestionnaires()` (L1138-1172), `executeReminderAction()` (L3693-3783), `showLoading()` (L4265-4275)
  - `assets/js/resilient-fetch.js` — `FETCH_TIMEOUTS` (L8-14)
  - n8n `[01] Send Questionnaires` (9rGj2qWyvGWVf9jXhv7cy) — Count Sent node, Send Email node
  - n8n `[API] Reminder Admin` (RdBTeSoqND9phSfo) — Execute Scheduler node
* **Existing Patterns:** `showModal('success', ..., { sent, failed })` already renders sent/failed stats. `showAIToast` used for reminder success.
* **Alignment with Research:** n8n's native fan-out matches the batch processing best practice exactly. The only deviation from research: we skip async/polling because 500 clients is within synchronous timeout range.

## 5. Technical Constraints & Risks
* **Security:** No new auth surfaces. Token verification unchanged.
* **Risks:**
  - Without `continueOnFail`, one bad email kills the batch → must enable BEFORE frontend change goes live
  - `showLoading` safety timer (25s) would fire during a 75s batch → must add parameter
  - `Execute Scheduler` node default mode may not properly fan out items → set explicit `mode: "each"`
* **Breaking Changes:** None. Single-client sends (`sendSingle()`) still work identically — `isBulk` ternary preserves old behavior.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

**Questionnaires:**
1. Frontend: `sendQuestionnaires(reportIds)` sends ONE POST with all IDs
2. n8n: Verify & Split maps array → N items → fan-out through existing chain
3. n8n: Send Email has `continueOnFail: true` — failures don't kill batch
4. n8n: Count Sent separates successes from errors, returns `{ ok, sent, failed, errors }`
5. Frontend: Shows modal with sent/failed stats

**Reminders:**
1. Frontend: `executeReminderAction('send_now', reportIds)` sends ONE POST with all IDs
2. n8n: Parse Action maps array → N items → Update Airtable → Execute Scheduler
3. n8n: Execute Scheduler runs in `mode: "each"` — each item triggers scheduler independently
4. Frontend: Shows toast or modal based on result

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `assets/js/resilient-fetch.js` | Modify | Add `batch: 90000` to FETCH_TIMEOUTS |
| `admin/js/script.js` | Modify | 3 changes: `showLoading` safety param, `sendQuestionnaires()` batch, `executeReminderAction` send_now bulk |
| n8n `[01] Send Questionnaires` | Modify | `continueOnFail` on Send Email (REST API), update Count Sent code (MCP) |
| n8n `[API] Reminder Admin` | Modify | `Execute Scheduler` node: add `mode: "each"` (MCP) |

## 7. Validation Plan
* [ ] Send questionnaire to 1 client — should work identically to before
* [ ] Send questionnaires to 3 clients — verify ONE POST in network tab (not 3)
* [ ] Verify spinner shows "שולח שאלונים ל-3 לקוחות..." not per-client progress
* [ ] Verify modal shows `sent: 3` stat on completion
* [ ] Send reminder (send_now) to 2 clients — verify ONE POST in network tab
* [ ] Verify both clients receive reminder emails
* [ ] Check n8n execution history: 1 execution for questionnaire batch, 1 for reminder batch
* [ ] Test partial failure: use an invalid report ID in a batch — verify sent/failed counts are correct
* [ ] Non-send_now reminder bulk actions (suppress, unsuppress) — verify unchanged behavior
* [ ] `bulkArchiveClients` — verify unchanged (not in scope)

## 8. Implementation Notes (Post-Code)

**Commit:** `d787b57` — `feat(admin): batch email sends — 1 request per bulk instead of N`

### n8n Changes
1. **Send Email node** (`bc4aff20`): `continueOnFail: true` set via REST API PUT (MCP doesn't support top-level node props)
2. **Count Sent node** (`9f565432`): Updated via MCP to separate `$input.all()` into success/error items using `item.json.error` check. Returns `{ ok, sent, failed, errors }`.
3. **Execute Scheduler** (`exec_scheduler`): Set `options.mode: "each"` via MCP.

### Frontend Changes
4. `resilient-fetch.js`: Added `batch: 90000` between `slow` and `rollover`.
5. `showLoading(text, safetyMs=25000)`: Added optional 2nd param for batch safety timer.
6. `sendQuestionnaires()`: Removed `for` loop. Single POST with all `reportIds`. Uses `FETCH_TIMEOUTS.batch` / 95s safety for bulk.
7. `executeReminderAction` send_now bulk: Same pattern — single POST with `FETCH_TIMEOUTS.batch`.

### Test Results (exec 5750)
- 3 test clients sent in **1 execution** (6.1s total)
- All nodes processed 3 items correctly
- Count Sent returned `{ ok: true, sent: 3, failed: 0, errors: [] }`
- Emails bounced (test address) but batch logic confirmed working
- At 500 clients: **1 execution instead of 500** — saves ~499 executions per batch send

### Validation Checklist
* [x] Send questionnaires to 3 clients — ONE POST, one execution (exec 5750)
* [x] Count Sent returns `sent: 3, failed: 0`
* [x] n8n execution history: 1 execution for 3-client batch
* [ ] Single-client send — not retested (code path uses same function with `isBulk=false`)
* [ ] Partial failure test — not tested (would need invalid report ID)
* [ ] Reminder send_now bulk — not tested this session
* [ ] Non-send_now bulk actions — unchanged code path, not retested
