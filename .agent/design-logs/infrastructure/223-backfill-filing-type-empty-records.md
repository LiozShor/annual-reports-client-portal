# Design Log 223: Backfill Empty filing_type on Legacy Report Records
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-29
**Related Logs:** DL-219 (add second filing type), DL-216 (filing type scoping all tabs), DL-164 (capital statements layer)

## 1. Context & Problem
DL-219 introduced `filing_type` as a field on report records (values: `annual_report`, `capital_statement`). DL-216 then added `filing_type` filtering to all admin tabs. However, all 33 legacy report records created before DL-219 have **empty `filing_type`** — they were never backfilled.

**Impact:** Two endpoints use hard Airtable filters (`{filing_type}='annual_report'`) that exclude records with empty values:
- **Reminders tab** — only 3 of 36 eligible clients appear
- **Pending tab (Ready/Send)** — same exclusion for `Send_Questionnaire` stage clients

Three other endpoints (dashboard, classifications, questionnaires) already have client-side fallbacks (`|| 'annual_report'`) so they work correctly.

**Data snapshot (2026-03-29):**
- Total records: 38
- With filing_type: 5 (4 AR, 1 CS)
- Without filing_type: 33 (all active, all legacy AR)

## 2. User Requirements
1. **Q:** Backfill all 33 empty records to `annual_report`?
   **A:** Yes — all legacy records are AR (CS didn't exist before DL-219).

2. **Q:** Add defensive filter fallback for empty filing_type?
   **A:** No — backfill only. All creation paths already set filing_type.

3. **Q:** Check all filtered endpoints, not just reminders?
   **A:** Yes — audit all endpoints. Found pending.ts also affected.

## 3. Research
### Domain
Data migration / field backfill patterns.

### Key Principles
- **Idempotent backfill:** Running the backfill multiple times should produce the same result. Using a filter for empty filing_type + setting to `annual_report` is naturally idempotent.
- **Verify after backfill:** Always count records before and after to confirm all were updated.
- **Batch API limits:** Airtable allows 10 records per batch update, 5 requests/second. 33 records = 4 batches — well within limits.

### Research Verdict
Simple batch update via pyairtable. No code changes needed in the API — the backfill fixes the data, and existing filters work correctly once records have the field populated.

## 4. Codebase Analysis
### Existing Solutions Found
- `api/src/routes/import.ts` — sets `filing_type` on new records (line 122)
- `api/src/routes/rollover.ts` — sets `filing_type` on rollover records (line 97)
- `api/src/routes/submission.ts` — falls back `|| 'annual_report'` for display (line 84)

### Endpoint Audit Results
| Endpoint | Filter Type | Empty filing_type behavior | Bug? |
|----------|------------|---------------------------|------|
| `dashboard.ts` | Client-side fallback | Treated as `annual_report` | No |
| `pending.ts` | Hard Airtable filter | **EXCLUDED** | **Yes** |
| `reminders.ts` | Hard Airtable filter | **EXCLUDED** | **Yes** |
| `classifications.ts` | Client-side fallback | Treated as `annual_report` | No |
| `questionnaires.ts` | Client-side fallback | Treated as `annual_report` | No |

### Reuse Decision
No code changes needed — data-only fix. All creation paths already set `filing_type`.

## 5. Technical Constraints & Risks
* **Security:** Using existing Airtable PAT with write access — standard pattern.
* **Risks:** Minimal — only setting a field on records that currently have it empty. No overwrites.
* **Breaking Changes:** None — adding a value where none existed only makes filters work correctly.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
All 38 report records have a non-empty `filing_type` value, and the reminders + pending tabs show all eligible clients.

### Logic Flow
1. Query all report records where `filing_type` is empty
2. Batch update all to `filing_type: 'annual_report'` (chunks of 10)
3. Verify: re-query to confirm 0 records have empty `filing_type`
4. Test: load reminders tab — should show all 36 clients (not just 3)

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| Airtable (reports table) | Data update | Backfill 33 records with `filing_type: 'annual_report'` |

No code files need changes.

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status.md

## 7. Validation Plan
* [ ] Before backfill: confirm 33 records have empty filing_type
* [ ] Run backfill script
* [ ] After backfill: confirm 0 records have empty filing_type
* [ ] Load reminders tab (AR) — verify all eligible clients appear (not just 3)
* [ ] Load pending/ready-send tab (AR) — verify all Send_Questionnaire clients appear
* [ ] Load dashboard — verify no regression (all clients still visible)

## 8. Implementation Notes (Post-Code)
* Backfill executed via pyairtable `batch_update` — 33 records updated to `filing_type: 'annual_report'`
* Verification: 0 records remain with empty `filing_type`. Distribution: 37 AR + 1 CS = 38 total.
* No code changes needed — all creation paths already set `filing_type`.
* No research deviations — straightforward data fix.
