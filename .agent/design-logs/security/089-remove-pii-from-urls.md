# Design Log 089: Remove PII from URLs (SEC-004, SEC-020)

**Status:** DONE
**Date:** 2026-03-04

## Summary

Removed client PII (full_name, email, client_name, spouse_name) from all URL parameters across the system. URLs now contain only opaque identifiers (report_id, token). Client data is fetched from API after page load.

## Changes Made

### Frontend (4 files)

| File | Change |
|------|--------|
| `assets/js/landing.js` | Read only `report_id`+`token` from URL; strip URL immediately via `replaceState`; populate PII from `check-existing-submission` API; `init()` only requires reportId+token |
| `assets/js/document-manager.js` | Read only `report_id` from URL; populate `CLIENT_NAME`, `SPOUSE_NAME`, `YEAR` from `get-client-documents` API response |
| `admin/js/script.js` | `viewClientDocs()` simplified to pass only `reportId`; all 4 call sites (lines 258, 1051, 1195, 3486) updated |
| `n8n/workflow-processor-n8n.js` | `editUrl` simplified to only include `report_id` |

### n8n Workflows (4 workflows)

| Workflow | Node | Change |
|----------|------|--------|
| `[API] Check Existing Submission` (QVCYbvHetc0HybWI) | Build Response | Added `client_name`, `client_email`, `client_id`, `spouse_name` to response (SEC-004 data source) |
| `[API] Get Client Documents` (Ym389Q4fso0UpEZq) | Build Response | Added `year` to office mode response |
| `[01] Send Questionnaire` (YfuRYpWdGGFpGYJG) | Code in JavaScript + HTTP Request | Stripped `full_name`, `email`, `client_id`, `year` from landing page URL (both Code output and inline email body) |
| `[06] Reminder Scheduler` (FjisCdmWc4ef0qSV) | Build Type A Email | Stripped PII from questionnaire URL |
| `[SUB] Document Service` (hf7DRQ9fLmQqHv3u) | Generate HTML | Stripped `client_name`, `spouse_name`, `year` from editUrl |

### Airtable

`questionnaire_link_he` / `questionnaire_link_en` formulas: already clean (link to Tally with only opaque IDs, no PII). No change needed.

## Backward Compatibility

- Old email links with `&full_name=...&email=...` still work — landing.js ignores extra URL params and fetches from API
- Document manager header shows data after API load (minor delay, acceptable)
- Tally redirect still includes PII (Tally constraint, accepted trade-off per plan)
