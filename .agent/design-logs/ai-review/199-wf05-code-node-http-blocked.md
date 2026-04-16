# Design Log 199: WF05 Code Node HTTP Calls Silently Failing
**Status:** [BLOCKED — NEEDS RESEARCH]
**Date:** 2026-03-26
**Related Logs:** [112-webhook-dedup-and-issuer-display](112-webhook-dedup-and-issuer-display.md)

## 1. Problem

**Both `$helpers.httpRequest()` and `fetch()` silently fail inside Code nodes in WF05** on n8n Cloud. They throw immediately (caught by try/catch), causing fail-open behavior. This was discovered while implementing Layer 1.5 (internet_message_id dedup check), but also affects the existing **Dedup Lock node (Layer 1)** from DL-112.

### Evidence

| Execution | Node | Expected Time | Actual Time | Result |
|-----------|------|---------------|-------------|--------|
| 10534 | Check Already Processed (`$helpers.httpRequest`) | 200ms+ | 7ms | Fail-open (passed through) |
| 10536 | Check Already Processed (`$helpers.httpRequest`, no `json:true`) | 200ms+ | 9ms | Fail-open |
| 10538 | Check Already Processed (`fetch()`) | 200ms+ | 8ms | Fail-open |
| 10538 | Dedup Lock (`$helpers.httpRequest`) | 200ms+ | 10ms | Fail-open (no `_dedup_record_id`) |
| 10539 | Check Already Processed (`fetch()`, after deactivate/reactivate) | 200ms+ | 9ms | Fail-open |
| 10539 | Dedup Lock (`fetch()`) | 200ms+ | 11ms | Fail-open |

**Key observation:** Dedup Lock has been silently failing since deployment. The pipeline works because Create Email Event (native Airtable node) creates the email_event record downstream — it was never the Dedup Lock doing it.

### What was tried

1. `$helpers.httpRequest({...})` — original pattern from DL-112. Fails silently (~10ms).
2. Removed `json: true` option — same result.
3. Replaced with `fetch()` — same result (~9ms).
4. Deactivated and reactivated workflow — same result.
5. Added verbose `console.log` at every step — can't read console output from n8n API, so couldn't pinpoint exact error.

### What was NOT tried

- Using an **HTTP Request node** instead of Code node for the API call (the standard n8n pattern for external HTTP calls)
- Using a native **Airtable Search node** instead of raw API
- Testing `$helpers.httpRequest` in a minimal isolated Code node to confirm it's a platform-level restriction
- Checking n8n Cloud docs/changelog for Code node sandbox restrictions

## 2. Impact

### Dedup Lock (Layer 1) — broken since DL-112 deployment
- The Airtable upsert never executes → no race-condition protection
- MS Graph duplicate notifications (~141ms apart) are NOT being deduplicated at Layer 1
- Pipeline still works because fail-open passes through, but duplicate email_events and pending_classifications can occur

### Layer 1.5 (internet_message_id check) — cannot implement as Code node
- Delete+restore emails fire new notifications with different Outlook IDs
- Without Layer 1.5, these create duplicate processing runs
- The Code node approach (API call inside Code) doesn't work on n8n Cloud

## 3. Confirmed Bug: Delete+Undo Reprocesses Email

**Reported 2026-03-26:** User deleted an email and immediately undid the delete. MS Graph fired a new notification → WF05 processed it again (execution 10477 = original, 10540 = duplicate after undo).

**Why it happens:**
- Dedup Lock (Layer 1) is broken (Code node HTTP fails on n8n Cloud, fail-open)
- `Create Email Event` upserts on `source_message_id` (MS Graph `email.id`), but after delete+undo the notification may carry a **different MS Graph message ID** for the same physical email
- Only `internetMessageId` (RFC 2822 Message-ID) is stable across delete/undo cycles
- No `changeType` filtering exists — all notification types (`created`, `updated`) are processed

## 4. Proposed Fix — Layered Approach

**Best practice = cheapest filter first, robust dedup second.**

| Layer | What | How | Cost | Handles |
|-------|------|-----|------|---------|
| **0** | Filter `changeType` | 1-line change in Extract Notification: skip if `changeType !== 'created'` | Zero API calls | Delete+undo (if it fires as `updated`) |
| **1.5** | `internet_message_id` dedup | Native Airtable Search node after Extract Email: check if `internet_message_id` already exists in `email_events` → IF node to skip | 1 Airtable read/notification | All duplicates: delete+undo, Graph retries, concurrent notifications |
| **1** | Airtable upsert lock | Replace broken Code-node HTTP with native HTTP Request node + evaluation Code node | 1 Airtable write/notification | Race conditions between concurrent executions |

**Recommendation:** Implement Layers 0 + 1.5. Layer 1 upsert lock is nice-to-have but may be overkill if Layer 1.5 works.

### TODO before implementing

- [ ] Check `changeType` in execution 10540 (Extract Notification output) — if it's `updated`, Layer 0 alone might suffice
- [ ] If `changeType` is `created`, Layer 1.5 is mandatory

### Layer 0: changeType filter (in Extract Notification)

```javascript
// Add after extracting messageId, before return:
if (notification.changeType !== 'created') {
  console.log(`Skipping non-created notification: ${notification.changeType}`);
  return [];
}
```

### Layer 1.5: internet_message_id dedup (native nodes)

**Option A — Airtable Search + IF:**
1. Airtable Search node → `email_events` table, `filterByFormula: {source_internet_message_id} = '...'`
2. IF node → `records.length === 0` → continue, else → skip (return [])
3. Set `alwaysOutputData: true` on the Airtable Search node (0-result trap)

**Option B — HTTP Request node:**
1. HTTP Request node → `GET https://api.airtable.com/v0/{base}/{table}?filterByFormula=...`
2. Code node (no HTTP) → evaluate `records.length`, return [] if found

Option A is cleaner (uses native Airtable credentials, no API key in code).

### Layer 1: Fix existing Dedup Lock (optional)

Replace Code node HTTP with:
1. HTTP Request node → Airtable PATCH with `performUpsert` body
2. Code node (no HTTP) → check `createdRecords.includes(recordId)`

## 5. Files Affected

| Location | Current State | Needed |
|----------|--------------|--------|
| WF05 `cIa23K8v1PrbDJqY` — Extract Notification | No changeType filter | Add Layer 0 filter |
| WF05 `cIa23K8v1PrbDJqY` — after Extract Email | No internet_message_id check | Add Airtable Search + IF (Layer 1.5) |
| WF05 `cIa23K8v1PrbDJqY` — Dedup Lock | Code node with `$helpers.httpRequest`, silently failing | Optional: replace with HTTP Request + eval Code node |

## 6. Rollback Status

All previous WF05 changes have been **fully reverted** to pre-session state:
- "Check Already Processed" node removed
- Extract Email → Get Attachments connection restored
- Dedup Lock code restored to original `$helpers.httpRequest` version (still broken, fail-open)
- Workflow is active and functional (dedup layers fail-open, so no breakage)
