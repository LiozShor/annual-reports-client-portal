# DL-081: Rejection Stale Fields Fix

**Date:** 2026-03-02
**Status:** Implemented
**Workflow:** `[API] Review Classification` (`c1d7zPAmHfHM71nV`)
**Node:** `Process Action` (`code-process-action`)

## Problem

When admin rejects or reassigns a classification, the downstream Airtable Update node silently drops `null` values from the payload. This leaves stale fields on the document record:
- `review_status` stays `pending_review` instead of being cleared
- `reviewed_at`, `uploaded_at`, `ai_confidence` remain populated
- `source_message_id`, `source_internet_message_id` not cleared at all

**Impact:** Reminder email logic checks `review_status` to determine if a doc is truly missing. Stale `pending_review` causes docs to be excluded from the missing count (e.g., shows 14 missing instead of 16).

## Root Cause

n8n's Airtable node (Update Row) ignores fields set to `null` — it simply omits them from the API call. Airtable's API requires explicit `null` in the PATCH body to clear a field.

## Solution

### Code Changes (Process Action node)

1. **Moved shared Airtable constants** (`AT_KEY`, `BASE_ID`, `DOCS_TABLE`, `hdrs`, `h`) from inside the DL-070 guard block to top-level scope so they're available to both the guard and the new PATCH.

2. **Added 2 missing fields** to reject and reassign `docUpdate` objects:
   - `source_message_id: ''`
   - `source_internet_message_id: ''`

3. **Added inline PATCH** (DL-081 block) after the DL-069 guard and before `return`:
   - For reject/reassign only — approve path unchanged
   - Uses `this.helpers.httpRequest()` to PATCH directly to Airtable API
   - Sends all fields including `null` values (which Airtable correctly interprets as "clear this field")
   - On success: sets `docUpdate = null` to skip downstream Airtable node
   - On failure: logs error, leaves `docUpdate` intact as fallback

### Data Fix

PATCHed 2 stuck records directly:
- `rec9VkiavRp0mXGYa` (T002) — cleared `review_status`, `reviewed_at`, `uploaded_at`, `ai_confidence`
- `recoJ7n3se2ZZf6Y7` (T201) — cleared same fields

## Testing

- Reject a classification → verify all fields on the doc record are properly cleared in Airtable
- Approve a classification → verify unchanged behavior (still goes through Airtable node)
- Check reminder email count matches actual missing docs
