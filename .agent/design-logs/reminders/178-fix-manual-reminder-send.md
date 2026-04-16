# DL-178: Fix Manual Reminder Send (Broken After Workers Migration)

**Date:** 2026-03-24
**Status:** Completed
**Trigger:** Manual "Send Now" reminders (dashboard bell icon + reminders tab) stopped working after DL-174 Phase 5 migration

## Problem

The Worker's `send_now` action fired `fireN8n('/admin-reminders', ...)` but the n8n workflow that had this webhook (`[ARCHIVED] Reminder Admin`, `RdBTeSoqND9phSfo`) was deactivated. The n8n webhook returned 404, silently caught by `catch()`, while the Worker already returned `ok: true` to the frontend. Result: success toast shown, but no email sent.

## Solution

### 1. n8n Webhook Entry Point (WF[06])

Added webhook path to WF[06] Reminder Scheduler (which already has the full reminder pipeline):

- **`Manual Send Webhook` node** — path: `/send-reminder-manual`, POST, `responseMode: onReceived`
- **`Verify & Split` Code node** — splits `report_ids` array into individual items
- **Connected:** Webhook → Verify & Split → Get Single Record → Filter Eligible → rest of pipeline
- **Updated `Filter Eligible`** — detects webhook path via `$('Verify & Split').first()`, propagates `_forceSend: true` flag on output items
- **Updated `Filter Type B By Pending`** — reads `_forceSend` from items instead of checking Execute Workflow Trigger; sets `_warn_pending: false` on forceSend (warning handled by Worker, not n8n dead-end)

### 2. Worker Warning System (Permission-Based)

Before firing n8n, the Worker checks for:
- **Pending classifications** (Type B / Collecting_Docs reports)
- **Recent sends** (< 24h since last reminder)

If warnings found and no `force_override`:
- Returns `{ok: true, warning: "<html>", report_ids: [...]}` — email NOT sent
- Frontend shows confirm dialog with formatted warning
- On confirm → re-calls with `force_override: true` → email sent

Warnings grouped per client: `<b>name</b>: warn1 · warn2`

### 3. Frontend Cleanup

- Removed duplicate 24h recency check from `reminderAction` and `reminderBulkAction` (now server-side)
- Warning dialog uses `innerHTML` for HTML formatting (bold names, `<br>` separators)
- Exhausted check (count >= max) stays client-side for instant feedback

## Gotchas

- **`$env` blocked in n8n Cloud Code nodes** — initial auth check using `$env.N8N_INTERNAL_KEY` failed with "access to env vars denied". Auth relies on webhook path secrecy (same as all other n8n webhooks).
- **Webhook registration** — webhooks added via MCP/API require manual deactivate+reactivate in n8n UI.
- **`_manual` flag lost after Get Single Record** — Airtable node replaces item data. Fixed by detecting trigger via `$('Verify & Split').first()` instead.
- **Type B pending warning was a dead end** — Route Pending Warning TRUE branch → Build Warning Response with no downstream connection. Fixed by setting `_warn_pending: false` on forceSend and moving warning logic to Worker.

## Files Changed

| File | Change |
|------|--------|
| WF[06] `FjisCdmWc4ef0qSV` | Added Manual Send Webhook + Verify & Split nodes, updated Filter Eligible + Filter Type B By Pending |
| `api/src/routes/reminders.ts` | Updated fireN8n path, added warning checks (pending + 24h), permission-based flow |
| `admin/js/script.js` | Warning confirm dialog with HTML, removed duplicate 24h checks |

## Verification

- Worker deployed via `wrangler deploy`
- WF[06] deactivated + reactivated in n8n UI
- Type A reminder: sent successfully
- Type B reminder: warning shown (pending + recent), confirm sends email
- Counter and dates updated correctly
- Dashboard bell icon and reminders tab both work
