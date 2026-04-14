# DL-140: Email Safety Audit — Batch Processing & Cross-Client Data Isolation

**Date:** 2026-03-10
**Scope:** WF[01] Send Questionnaires, WF[06] Reminder Scheduler, WF[03] Approve & Send, WF[API] Send Batch Status
**Objective:** Verify no cross-client data leakage, proper batch isolation, duplicate-send prevention, and fail-safe behavior

---

## Executive Summary

**Overall risk: LOW.** No critical cross-client data leakage vulnerabilities found. The architecture relies on n8n's native item-based parallelism rather than SplitInBatches loops, which avoids the most common class of shared-state bugs. However, there are several MEDIUM-severity gaps in idempotency and failure recovery.

---

## Workflow-by-Workflow Analysis

### 1. [01] Send Questionnaires (`9rGj2qWyvGWVf9jXhv7cy`)

**Trigger:** POST webhook from admin panel with `report_ids[]` array
**Data flow:**
```
Webhook → Verify & Split (Code: splits report_ids into N items)
  → IF Valid → Get Report (Airtable, per item by report_id)
  → Get Client (Airtable, per item by client[0])
  → Build Email Data (Code, per item using $('Get Report').item / $input.item)
  → Send Email (HTTP, per item with batchSize=1, interval=2500ms)
  → Filter Sent (Code, filters to 202 responses)
  → Update Stage (Airtable, sets stage to 2-Waiting_For_Answers)
  → Count Sent → Respond Success
```

**Batch processing model:** n8n native item iteration. `Verify & Split` outputs N items (one per report_id). Each downstream node runs once per item automatically. **No SplitInBatches node.**

**Client data isolation:**
- SAFE: `Build Email Data` uses `$('Get Report').item.json` and `$input.item.json` — the `.item` accessor automatically scopes to the current item index. No cross-item leakage.
- SAFE: `_payload` is built per-item with per-item `clientEmail`, `clientName`, `reportId`.
- SAFE: `Send Email` uses `$json._payload` (current item's payload).

**Batch size limit:** No explicit limit on incoming `report_ids`. The HTTP Send Email node has `batchSize: 1, batchInterval: 2500ms` — it sends one email every 2.5 seconds. For 500 clients, that's ~21 minutes. MS Graph rate limits (~10,000/min) are not a concern.

**Failure handling:**
- Send Email uses `neverError: true` + `fullResponse: true` — failures don't crash the workflow.
- `Filter Sent` only passes items with `statusCode === 202` to `Update Stage`.
- `Count Sent` reports success/failure counts back to the admin panel.

**Duplicate-send prevention:**
- SEVERITY: **MEDIUM** — There is NO idempotency check before sending. If the admin clicks "send questionnaires" twice with the same report_ids, the same clients get the email twice. The `Update Stage` sets the report to stage 2, but there's no pre-send check like `IF stage !== '1-Send_Questionnaire' THEN skip`.
- MITIGATION: The admin panel likely disables the button after first click, but server-side dedup is absent.

**Sent tracking:**
- SEVERITY: **LOW** — `Update Stage` writes `stage`, `last_progress_check_at`, `reminder_next_date`, `reminder_count=0` but does NOT write a `questionnaire_sent_at` timestamp. There's no way to audit exactly when the questionnaire was first sent.

**Anti-pattern check:**
- `items[0].json.email` outside loop: NOT FOUND. All Code nodes use `.item` or `.map()`.
- `$node` cross-branch references: NOT FOUND. Uses `$()` syntax (safe).
- Shared state variables: NOT FOUND.
- Positional index cross-reference in `Filter Sent`: `emailData[i]?.json?.report_id` — SAFE because n8n preserves item ordering through HTTP batch processing. The `i` index in `sendResults` matches the `i` index in `emailData` output.

---

### 2. [06] Reminder Scheduler (`FjisCdmWc4ef0qSV`)

**Trigger:** Schedule Trigger (cron) OR Execute Workflow Trigger (manual "Send Now")
**Data flow:**
```
Schedule Trigger → Fetch Config → Search Due Reminders (Airtable formula: stage in [2,3], next_date<=TODAY, not suppressed, active)
  → Filter Eligible (Code: skip if sent in last 24h, skip if exhausted)
  → Split by Type (IF: type A=questionnaire, type B=docs)
    Type A → Build Type A Email → Merge All Emails
    Type B → [pending classification check] → Search Missing Docs → Prepare Type B Input → Call Document Service → Build Type B Email → Merge All Emails
  → Prepare Email Payload → Send Email (batch 1 per 2.5s)
  → Filter Sent → Set Update Fields → Update Reminder Fields
```

**Batch processing model:** n8n native item iteration throughout. No SplitInBatches.

**Client data isolation:**
- SAFE: `Build Type A Email` uses `.map(item => ...)` — each item processed independently.
- SAFE: `Build Type B Email` uses `serviceOutputs.map((item, idx) => ...)` with `inputs[idx].json` positional matching.
- SAFE: `Prepare Type B Input` groups docs by `report_record_id` per report — correct isolation.
- SAFE: `Prepare Email Payload` uses `.map(item => ...)` — per-item payload construction.

**Positional index matching (Build Type B Email):**
- SEVERITY: **MEDIUM** — `Build Type B Email` does `const inp = inputs[idx].json` where `inputs = $('Prepare Type B Input').all()` and `serviceOutputs = $input.all()` (from Call Document Service). This relies on Document Service returning items in the same order as input. If Document Service ever reorders, filters, or drops items, the positional mapping breaks and Client A could receive Client B's document list.
- MITIGATION: Document Service is a sub-workflow that maps 1:1 input→output. Current implementation preserves ordering. But this is a fragile assumption with no validation.

**Duplicate-send prevention:**
- SAFE: `Filter Eligible` checks `last_reminder_sent_at` — if sent within last 24 hours, skipped (unless `forceSend`).
- SAFE: After sending, `Set Update Fields` writes `last_reminder_sent_at = now` and increments `reminder_count`.
- SAFE: `reminder_max` cap prevents infinite reminders (per-report or system default).

**Idempotency mechanism:**
- Primary: `last_reminder_sent_at` timestamp + 24-hour cooldown
- Secondary: `reminder_count >= reminder_max` hard cap
- SEVERITY: **LOW** — If the workflow crashes AFTER `Send Email` but BEFORE `Update Reminder Fields`, the reminder won't be marked as sent. On next scheduled run, it could re-send. The 24h cooldown is calculated from `last_reminder_sent_at` (Airtable), which only gets updated AFTER successful send + filter + set fields + Airtable update. This is a ~4-step gap.

**Failure handling:**
- Send Email uses `neverError: true` + `fullResponse: true`.
- `Filter Sent` only passes `statusCode === 202` items to `Set Update Fields`.
- Failed emails are silently dropped (no error notification to admin).
- SEVERITY: **LOW** — Silent failure means admin has no visibility into which reminders failed. No error log or notification.

**Anti-pattern check:**
- `items[0].json.email` outside loop: NOT FOUND.
- `$node` cross-branch references: NOT FOUND.
- Shared state variables: NOT FOUND. `Filter Eligible` correctly processes all items in a single `.filter().map()` chain.

---

### 3. [03] Approve & Send (`cNxUgCHLPZrrqLLa`)

**Trigger:** GET webhook with `?report_id=X&token=Y&confirm=yes`
**Data flow:**
```
Webhook → Global Config → Verify Token (validates per-report hash)
  → IF Confirm (yes → send path, no → confirmation page path)
    Confirm=yes:
      → Get a record (Airtable: fresh read by report_id)
      → Airtable - List Docs (search by report_record_id, status=Required_Missing)
      → Prepare Service Input → Call Document Service → Inject Questions
      → MS Graph - Send to Client
      → IF Send OK → Set Stage 3 → Respond (JSON or HTML)
    Confirm=no:
      → Check Report (Airtable: fresh read) → Build Confirm Page → redirect to HTML
```

**Per-report confirmation: YES.** This workflow processes exactly ONE report per execution. The webhook receives a single `report_id`.

**Client data re-read at send time:**
- SAFE: `Get a record` reads the FRESH report from Airtable using `$('Verify Token').item.json.report_id`. Not stale webhook data.
- SAFE: `Airtable - List Docs` queries documents fresh from Airtable at execution time.
- SAFE: `Prepare Service Input` extracts `clientName`, `clientEmail`, `year` from the fresh Airtable record, not from the webhook.

**Duplicate-send prevention:**
- SEVERITY: **MEDIUM** — `Build Confirm Page` checks `docs_first_sent_at` and shows an "already sent" warning. But if the admin confirms anyway (or the confirm URL is hit twice quickly), there's no server-side guard to prevent a second send. The stage update to `3-Collecting_Docs` happens AFTER the email is sent, so there's a race window.
- The confirmation page shows a warning with the original sent timestamp, which is a good UX safety net, but not a hard block.

**Anti-pattern check:**
- `items[0].json.email` outside loop: NOT APPLICABLE (single-item workflow).
- `$node` cross-branch references: NOT FOUND. Uses `$('Get a record')`, `$('Verify Token')` — all within the same execution path.
- MS Graph Send uses `specifyBody: "json"` with inline expression — RISK: If `email_html` contains unescaped quotes, JSON could break. BUT this node is sending Document Service output which is HTML-safe. Noted as low-risk.

---

### 4. [API] Send Batch Status (`QREwCScDZvhF9njF`)

**Trigger:** POST webhook from admin panel with `{ report_key, client_name, items[], classification_ids[] }`
**Data flow:**
```
Webhook → Parse & Verify → IF Authorized
  → IF Dismiss (dismiss action → delete classification records → respond)
  → Get Report (Airtable by report_key)
  → Search Documents → Prepare Service Input → Call Document Service
  → Build Email → IF Email Ready → Send Email
  → IF Email Sent → Respond Success → Update Notification Status (delete pending classification records)
```

**Single-client per call: YES.** Each webhook call processes exactly ONE report. The `items[]` array contains document actions (approve/reject) for that single client's documents.

**Client data re-read at send time:**
- SAFE: `Get Report` fetches fresh from Airtable by `report_key`.
- SAFE: `Search Documents` fetches fresh document list.
- SAFE: `Build Email` reads `clientEmail` from the fresh Airtable record, not from webhook payload.
- SAFE: `clientName` is read from webhook payload (`params.client_name`) with fallback to Airtable record. This is acceptable since the admin panel sends the display name.

**Duplicate-send prevention:**
- SEVERITY: **LOW** — No explicit dedup. But this is triggered per admin action (click "send status email"), and the `classification_ids` are deleted from `pending_classifications` after send. Hitting it twice would: (a) send the email twice, (b) second delete call would silently fail (records already gone). Acceptable risk for admin-triggered action.

**Batching:** No batching. Single email per call. No `batchSize` config on the Send Email node.

**Anti-pattern check:**
- `items[0].json.email` outside loop: NOT APPLICABLE (single-item).
- `$node` cross-branch references: NOT FOUND.

---

## Cross-Cutting Findings

### Finding 1: Positional Index Matching Pattern
**Severity: MEDIUM**
**Affected:** WF[01] Filter Sent, WF[06] Build Type B Email, WF[06] Filter Sent

Multiple Code nodes use positional index matching: `array1[i]` paired with `array2[i]` where the arrays come from different upstream nodes. This works because n8n preserves item ordering through node chains. However:
- If any intermediate node filters, reorders, or drops items, the indices desync.
- There's no validation (e.g., checking `report_id` matches between paired items).

**Recommendation:** Add a defensive check: `if (emailData[i]?.json?.report_id !== expectedId) { skip or log error }`.

### Finding 2: No Global "Sent" Flag for Questionnaire Emails
**Severity: MEDIUM**
**Affected:** WF[01] Send Questionnaires

There is no `questionnaire_sent_at` or equivalent timestamp written to Airtable. The stage changes to `2-Waiting_For_Answers`, but if someone resets the stage to `1-Send_Questionnaire`, there's no audit trail that the questionnaire was already sent.

**Recommendation:** Write a `questionnaire_first_sent_at` timestamp (only if null) in the Update Stage node.

### Finding 3: Crash-Between-Send-and-Update Window
**Severity: LOW**
**Affected:** WF[01], WF[06]

Both batch workflows have a gap between "email sent via MS Graph" and "Airtable updated to reflect send." If the n8n execution crashes in this window (unlikely but possible), emails are sent but not tracked.

**Recommendation:** This is a fundamental distributed systems challenge. Current risk is low because MS Graph returns 202 synchronously and subsequent n8n nodes execute immediately. Monitoring n8n execution failures would catch this.

### Finding 4: Silent Email Failures in WF[06]
**Severity: LOW**
**Affected:** WF[06] Reminder Scheduler

When Send Email fails for a specific client, the failure is silently dropped. The admin has no notification. The reminder will retry on the next scheduled run (after 24h cooldown or next `reminder_next_date`), so it self-heals, but visibility is poor.

**Recommendation:** Consider logging failures to an Airtable error log or sending a summary notification to admin.

### Finding 5: MS Graph URL Inconsistency
**Severity: INFO (no security impact)**
**Affected:** WF[01] vs WF[03]/WF[06]/WF[04]

WF[01] uses: `https://graph.microsoft.com/v1.0/users/reports@moshe-atsits.co.il/sendMail`
WF[03], WF[06], WF[04] use: `https://graph.microsoft.com/v1.0/me/sendMail`

Both work (the OAuth credential is for the same account), but the inconsistency could cause confusion if the OAuth credential is ever changed.

---

## Anti-Pattern Scan Results

| Anti-Pattern | WF[01] | WF[06] | WF[03] | WF[04] | Status |
|---|---|---|---|---|---|
| `items[0].json.email` outside loop | - | - | N/A | N/A | **CLEAN** |
| `$node["X"]` cross-SplitInBatches reference | N/A | N/A | N/A | N/A | **CLEAN** (no SplitInBatches used) |
| Shared state not reset per iteration | - | - | N/A | N/A | **CLEAN** |
| Positional index matching without validation | YES | YES | - | - | **MEDIUM** (see Finding 1) |
| Stale webhook data used for email send | - | - | - | - | **CLEAN** (all re-read from Airtable) |
| Missing duplicate-send prevention | YES | - | PARTIAL | LOW | **MEDIUM** (see Findings 2, 3) |

---

## Severity Summary

| Severity | Count | Details |
|---|---|---|
| CRITICAL | 0 | No cross-client data leakage found |
| HIGH | 0 | No unsafe shared state or SplitInBatches misuse |
| MEDIUM | 3 | Positional index matching without validation; no questionnaire-sent flag; no server-side dedup on WF[01] re-send |
| LOW | 3 | Crash-between-send-and-update window; silent failures in WF[06]; WF[03] race condition on double-confirm |
| INFO | 1 | MS Graph URL inconsistency |
