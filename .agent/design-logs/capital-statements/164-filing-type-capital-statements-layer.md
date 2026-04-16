# DL-164: Filing Type Layer for Capital Statements Support

**Date:** 2026-03-18
**Status:** Phases 1-5 Complete, Phase 6 Deferred
**Plan:** purring-exploring-glade.md

## Context

System was hardcoded for annual reports only. Firm wants to support capital statements (הצהרות הון). Feasibility analysis confirmed system is ~70% abstract. This DL covers the **infrastructure layer only** — making the system multi-filing-type-aware without creating CS content.

## Design Decisions

1. **Filter in Code node, not Airtable filterByFormula** — safest, no node config changes
2. **API returns form IDs** (not frontend config map) — single source of truth
3. **`|| 'annual_report'` everywhere** — backward-compatible by default
4. **FILING_LABELS shared pattern** across all email Code nodes:
   ```javascript
   const FILING_LABELS = {
     annual_report: { he: 'דוח שנתי', en: 'Annual Report' },
     capital_statement: { he: 'הצהרת הון', en: 'Capital Statement' }
   };
   ```

## Changes Made

### Phase 2: Document Service Filter
- **[SUB] Document Service** (`hf7DRQ9fLmQqHv3u`) — Generate Documents node
  - Added `filingType` extraction from input (default `annual_report`)
  - Added mapping loop guard: `if (mappingFilingType !== filingType) continue;`

### Phase 3: Caller Workflows — Inject filing_type
- **WF01** (`9rGj2qWyvGWVf9jXhv7cy`) — Build Email Data: reads `filing_type` from report record
- **WF02** (`QqEIWQlRs1oZzEtNxFUcQ`) — Extract & Map: reads from Get Report Record node
- **WF03** (`cNxUgCHLPZrrqLLa`) — Prepare Service Input: forwards `filing_type`
- **WF04** (`y7n4qaAUiCS4R96W`) — Prepare Service Input: forwards `filing_type`
- **WF06** (`FjisCdmWc4ef0qSV`) — Prepare Type B Input: forwards `filing_type`
- **Batch Status** (`QREwCScDZvhF9njF`) — Prepare Service Input: forwards `filing_type`

### Phase 4: Email Template Labels
- **WF01** Build Email Data: dynamic subject/header/body using `ftLabel.he`
- **WF02** Prepare Email: dynamic subject `שאלון ${ftLabel.he} התקבל`
- **WF06** Build Type A Email: dynamic subject with `ftLabel.he`
- **WF06** Build Type B Email: dynamic HE/EN subjects with `ftLabel`

### Phase 5: Frontend + API
- **Check Existing Submission API** (`QVCYbvHetc0HybWI`): returns `filing_type`, `form_id_he`, `form_id_en`, labels
- **Get Client Documents API** (`Ym389Q4fso0UpEZq`): returns `filing_type`, labels in report object
- **landing.js**: reads API-driven form IDs, falls back to hardcoded defaults
- **view-documents.js**: dynamic mailto subject using `filing_type_label_he`
- **approve-confirm.html**: removed hardcoded "דוח שנתי" from titles

### Phase 1: Airtable Schema (COMPLETE)
- Created `filing_type` singleSelect via API in 3 tables:
  - `reports` (tbls7m3hmHC4hhQVy) — renamed from `annual_reports`
  - `documents_templates` (tblQTsbhC6ZBrhspc)
  - `question_mappings` (tblWr2sK1YvyLWG3X)
- Options: `annual_report`, `capital_statement`
- Batch-updated all 106 records to `annual_report`
- `report_key` formula updated to include `filing_type` (prevents collision for same client+year)

### Phase 6: WF05 Classification (DEFERRED)
- Needs CS document taxonomy from firm before implementation

## Risks & Mitigations

- **Risk:** Missing `filing_type` breaks document generation
  **Mitigation:** Every access uses `|| 'annual_report'` fallback — existing behavior preserved

- **Risk:** Email subjects show wrong text
  **Mitigation:** FILING_LABELS defaults to `annual_report` if key missing

- **Risk:** Frontend breaks if API doesn't return new fields
  **Mitigation:** `data.form_id_he || FORM_HE` fallback in landing.js
