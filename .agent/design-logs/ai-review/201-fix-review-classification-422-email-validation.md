# Design Log 201: Fix review-classification 422 — Airtable Email Field Validation
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-26
**Related Logs:** DL-173 (classifications migration to Workers)

## 1. Context & Problem

Worker error alert fired on `/webhook/review-classification` endpoint:
```
Airtable updateRecord error: 422
{"error":{"type":"INVALID_REQUEST_UNKNOWN","message":"Invalid request: parameter validation failed. Check your request data."}}
```

The endpoint copies classification fields (from email ingestion) directly to the Documents table. The `source_sender_email` field in Documents is an Airtable `email` type, which validates format. If the classification's `sender_email` is empty string `""` or malformed (e.g., display name without `@`), Airtable rejects the entire PATCH with 422.

## 2. Root Cause

Two code paths in `api/src/routes/classifications.ts` copy raw `clsFields` values to Documents without sanitization:

- **Approve path** (line ~389): `source_sender_email: clsFields.sender_email`
- **Reassign path** (line ~511): `source_sender_email: clsFields.sender_email`

If `clsFields.sender_email` is `""` (empty string from email parsing), Airtable's email-type field rejects it. Other fields (`file_url`, `uploaded_at`, etc.) had similar risk with falsy/undefined values, though less likely to trigger 422.

## 3. Codebase Analysis

* **Airtable schema** (`docs/airtable-schema.md`):
  - `source_sender_email` (Documents, line 130): `email` type — validates format
  - `sender_email` (Classifications, line 312/387): `email` type
  - `uploaded_at` (Documents, line 121): `dateTime` type
* **AirtableClient.updateRecord** (`api/src/lib/airtable.ts:109`): Thin wrapper, passes `{fields}` directly — no sanitization
* **Both approve and reassign paths** pass raw classification fields without null-coalescing

## 4. Fix Applied

1. Added `sanitizeEmail()` helper inside the route handler — returns `undefined` for empty/non-email strings (no `@` → rejected)
2. All copied classification fields now use `|| null` / `?? null` to convert falsy values to explicit `null` (Airtable accepts null = clear field)
3. Applied to both **approve** and **reassign** update paths

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | Add sanitizeEmail helper, null-coalesce all copied fields in approve + reassign paths |

## 5. Validation Plan

* [ ] Approve a classification where sender_email is populated — verify document gets correct email
* [ ] Approve a classification where sender_email is empty/null — verify no 422, field stays empty
* [ ] Reassign a classification — verify target document gets sanitized fields
* [ ] Check Worker logs for 24h — no more 422 errors on this endpoint

## 6. Implementation Notes

- Fix is minimal and defensive — doesn't change behavior for valid data, only prevents 422 on empty/malformed emails
- `ai_confidence` uses `??` (nullish coalescing) instead of `||` to preserve `0` as a valid confidence score
