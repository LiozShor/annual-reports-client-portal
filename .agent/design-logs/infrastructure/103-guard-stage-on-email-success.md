# DL-103: Guard Stage/Status Updates on Email Delivery Success

**Date:** 2026-03-05
**Status:** Completed
**Session:** 93

## Problem

When email sends fail (MS Graph 429, DNS error, token expiry), downstream Airtable state updates still execute — "losing" clients who appear processed but never received their email. WF[01] and WF[06] both had `continueOnFail: true` on Send Email with no downstream error check.

## Solution

Added guard nodes after every Send Email HTTP Request node that check `statusCode === 202` before allowing state updates. Uses n8n's `neverError` + `fullResponse` options so non-2xx responses flow as regular items with status codes.

**Pattern:** `Send Email (neverError + fullResponse) → Guard Node (check 202) → State Update`

## Changes

### WF[01] Send Questionnaires (`9rGj2qWyvGWVf9jXhv7cy`)
- **Send Email** (`bc4aff20`): Added `neverError: true` + `fullResponse: true` to options
- **Added "Filter Sent"** Code node: cross-references Send Email results with Build Email Data by position, passes only 202 items with `report_id`
- **Update Stage**: changed from `$('Build Email Data').item.json.report_id` → `$json.report_id`
- **Count Sent**: updated to check `statusCode === 202` instead of `!item.json.error`
- **Rewired**: Send Email → Filter Sent → Update Stage (parallel branch: Send Email → Count Sent → Respond Success)
- **Result**: Failed sends = stage stays at 1, admin sees failure count in response modal

### WF[06] Reminder Scheduler (`FjisCdmWc4ef0qSV`)
- **Send Email** (`send_email_graph`): Added `neverError: true` (already had `fullResponse: true`)
- **Added "Filter Sent"** Code node: cross-references with Prepare Email Payload by position, passes only 202 items with `_report_id` + `_count`
- **Set Update Fields**: reads from `$input.all()` (Filter Sent output) instead of `$('Prepare Email Payload').all()`
- **Rewired**: Send Email → Filter Sent → Set Update Fields
- **Result**: Failed sends = client stays in reminder queue for next cycle

### WF[03] Approve & Send (`cNxUgCHLPZrrqLLa`)
- **MS Graph - Send to Client** (`1742a9e7`): Added `neverError: true` + `fullResponse: true` + `continueOnFail: true`
- **Added "IF Send OK"** IF node: `statusCode === 202`
- **Added "Error Page"** Respond to Webhook: meta-refresh redirect to `approve-confirm.html?result=error`
- **Rewired**: MS Graph → IF Send OK → (true) Set Stage 3 / (false) Error Page
- **Result**: Admin sees friendly error page; stage NOT updated on failure

### Batch Status (`QREwCScDZvhF9njF`)
- **Send Email** (`http-send-email`): Added `neverError: true` + `fullResponse: true`
- **Added "IF Email Sent"** IF node: `statusCode === 202`
- **Added "Respond Email Failed"** Respond to Webhook: `{ ok: false, error: 'שגיאה בשליחת המייל' }` with CORS headers
- **Rewired**: Send Email → IF Email Sent → (true) Respond Success / (false) Respond Email Failed
- **Result**: Admin panel shows `showModal('error', ...)` on email failure

## Node Count Changes
| Workflow | Before | After | Delta |
|----------|--------|-------|-------|
| WF[01] | 11 | 12 | +1 |
| WF[03] | 14 | 16 | +2 |
| WF[06] | 23 | 24 | +1 |
| Batch Status | 17 | 19 | +2 |

## Frontend Changes: NONE
- `approve-confirm.html` already handles `?result=error`
- `admin/js/script.js` already handles `ok: false` from batch status
- `admin/js/script.js` already handles partial failures in sendQuestionnaires

## Key Technical Detail
When `fullResponse: true`, Send Email output items become `{statusCode, headers, body}` — original payload fields are lost. Filter Sent nodes cross-reference with upstream payload node by positional index to recover fields like `report_id`, `_report_id`, `_count`.
