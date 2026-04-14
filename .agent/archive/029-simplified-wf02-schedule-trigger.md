# Design Log 029: Simplified WF02 + Schedule Trigger + n8n Cleanup

**Date:** 2026-02-14
**Status:** COMPLETED
**Workflow:** [02] Questionnaire Response Processing (QqEIWQlRs1oZzEtNxFUcQ)

## Summary

Complete rebuild of Workflow [02] — replaced unreliable Airtable Trigger with Schedule Trigger + Search pattern, added Airtable-first field mapping via new `airtable_field_name` column, and cleaned up 11 unused/redundant workflows.

## Problem

Three versions of WF02 existed (97KB, 68KB, 21KB), all with issues. The Airtable Trigger (from design log 028) proved unreliable — GitHub issue #16831 documents this as a known n8n bug. Meanwhile, the Extract node used hardcoded field references instead of reading mappings from Airtable.

## Solution: 4-Phase Implementation

### Phase 0: Field Discovery
- Cross-referenced 60 `question_mappings` records against 83 fields in `תשובות שאלון שנתי` schema
- Semantically matched Hebrew field names to Tally keys (e.g., `employment_client` → `האם היית שכיר/ה בשנת המס`)
- Result: 59 of 60 mappings matched (1 skip: `nii_client_allowances` has NULL tally_key)

### Phase 1: Airtable Schema Update
- Created `airtable_field_name` (singleLineText) column on `question_mappings` table via API
- Populated all 60 records with batch_update
- This bridges Hebrew Airtable field names to `tally_key_he` values that the Document Service expects

### Phase 2: Rebuilt Workflow [02] (14 nodes)

**New architecture:**
```
Schedule Trigger (every minute)
    ↓
Search Unprocessed (Airtable: AND({תאריך הגשה} != '', {סטטוס} = ''))
    ↓
Get Mappings (Airtable: question_mappings, all 60 records)
    ↓
Extract & Map (Code: translate Hebrew fields → tally_key_he, ~80 lines)
    ↓
Call Document Service (sub-workflow hf7DRQ9fLmQqHv3u)
    ↓
Success? (IF: $json.ok === true)
  ├─ TRUE:
  │   ├→ Prepare for Airtable → Upsert Documents ──→ Wait for Both ──→ Update Report Stage
  │   └→ Prepare Email → MS Graph - Send Email ────↗                └→ Mark Processed
  └─ FALSE:
      └→ Log Error
```

**Key design decisions:**
1. **Schedule + Search** instead of Airtable Trigger — avoids known unreliability bug
2. **Mark Processed** node sets `סטטוס = 'התקבל'` to prevent reprocessing (idempotent)
3. **Extract & Map** reads mappings at runtime from Airtable — no hardcoded field references
4. **Code loaded from file** — avoids Python string interpolation mangling `$('NodeName')` syntax

### Phase 3: Cleanup

**Deleted (7 workflows):**
| Workflow | ID | Reason |
|----------|-----|--------|
| My Sub Workflow 1 | a7IxomwbNjoSdhI0 | Empty template |
| [02] Original | EMFcb8RlVI0mge6W | Replaced by rebuilt WF02 |
| [02-NEW] Simplified | bwGGDKXexSXrYvbL | Replaced by rebuilt WF02 |
| [04b] Document Manager API | 3QRm17PLrrJohJme | Legacy |
| [04b] Document Manager HTML | yF7gKmxgj6BfAFkd | Legacy |
| [TEST] Tally Mock Trigger | kH9GYY9huFQHQE2R | Old test |
| [TEST] Document Service | uFIrf6gUVbvTHn8Q | Old test |

**Deactivated (4 workflows):**
| Workflow | ID | Reason |
|----------|-----|--------|
| [API] Get Document Types | AhWYAxX83IQVQ1mK | Types now in Airtable |
| [API] Get Questionnaire Mapping | If0tyzzUWF081jnD | Mappings now in Airtable |
| [Admin] Update Document Types | 3AGsWkVSxH2AvLPO | Redundant |
| [Admin] Update Questionnaire Mapping | M3MhbIO2ckcYMv0Y | Redundant |

**Final state:** 18 workflows (13 active, 5 inactive)

## Bugs Encountered & Fixed

| Bug | Root Cause | Fix |
|-----|------------|-----|
| Airtable Trigger never fires | Known n8n bug #16831 | Replaced with Schedule + Search |
| `Can't use .first() here` | Node mode `runOnceForEachItem` | Changed to `runOnceForAllItems` |
| `Node 'Get Mappings' hasn't been executed` | Parallel execution — Get Mappings not ready | Made flow sequential |
| `Unexpected token '.'` SyntaxError | Python mangled `$('NodeName')` in code string | Load JS from separate file |
| Mark Processed 422 error | Used `"processed"` — not a valid option | Changed to `התקבל` (valid singleSelect) |
| `UNKNOWN_FIELD_NAME` on batch_update | Field didn't exist yet | Create field via API first, then populate |

## Verification Results

- **End-to-end test:** Processed test record successfully
- **Documents created:** 48 (correct count)
- **Email sent:** Yes, to reports@moshe-atsits.co.il
- **Report stage updated:** `3-Collecting_Docs`
- **Mark Processed:** Fixed and deployed (pending next submission test)

## Cost Analysis

Idle cost: 2 Airtable API calls/minute (Search + check). Well within Airtable free tier limits (100k calls/month ≈ 86k idle calls/month). Each actual execution adds ~5 more API calls.

## Files Modified

- `.mcp.json` — Updated n8n API key
- `docs/airtable-schema.md` — Added `airtable_field_name` column
- `CLAUDE.md` — Updated workflow IDs
- `.agent/current-status.md` — Full rewrite

## Credentials Used

| Credential | ID | Purpose |
|-----------|-----|---------|
| Airtable PAT | ODW07LgvsPQySQxh | All Airtable nodes |
| MS Graph OAuth2 | GcLQZwzH2xj41sV7 | Send office email |

## Remaining Items

1. Verify Mark Processed works on next real submission
2. Run full SSOT verification checklist against the 48 documents
3. Review deactivated workflows before permanent deletion
4. Phase 4 (future): Simplify WF03 & WF04 to read from Airtable
