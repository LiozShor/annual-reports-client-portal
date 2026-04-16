# Design Log 233: CS Document Template Fixes
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-31
**Related Logs:** DL-164, DL-182, DL-225

## 1. Context & Problem
Capital Statements document generation had 3 bugs:
1. SSOT doc had `**` bold markers around year values — years should not be bold
2. `year_plus_1` variable never computed — CS-T002/CS-T009 credit card titles showed card company name where year+1 should be
3. Questionnaire not loading for CS reports in document-manager — API defaults to `filing_type=annual_report`

## 2. User Requirements
1. **Q:** Remove `**` from year in templates?
   **A:** Yes, only from year — keep `**` on respondent values
2. **Q:** Where is CS doc generation running?
   **A:** Investigated — runs through `workflow-processor-n8n.js` via [SUB] Document Service
3. **Q:** Change questionnaire label for CS?
   **A:** Yes — show "שאלון הצהרת הון" for CS, "השאלון השנתי" for AR

## 3. Research
Skipped — straightforward bug fixes with clear root causes.

## 4. Codebase Analysis
- `workflow-processor-n8n.js:580,639` — `params = { year: tax_year }` missing `year_plus_1`
- `workflow-processor-n8n.js:618` — detail loop overwrites `year_plus_1` with item value
- `doc-builder.ts:204` — only resolves `{year}`, not `{year_plus_1}`
- `document-manager.js:2443` — questionnaire API call missing `filing_type` param
- `questionnaires.ts:22` — API defaults to `annual_report` when no `filing_type` provided
- `document-manager.js:494` — tab switch doesn't reset `_questionnaireFetched`
- Airtable templates already clean (no `**` in DB) — only SSOT doc needed updating

## 5. Technical Constraints & Risks
- `workflow-processor-n8n.js` is fetched from GitHub by n8n — changes take effect on next execution
- No breaking changes — `year_plus_1` is additive to params

## 6. Proposed Solution (The Blueprint)

### Fix 1: SSOT doc — remove `**` from year only
- Stripped `**{{year}}**` → `{{year}}` and `**{{year_plus_1}}**` → `{{year_plus_1}}`
- Kept `**` on all respondent values (bank_name, card_company, etc.)
- Added explicit rule: year values are NOT bold

### Fix 2: Compute `year_plus_1`
- Added `year_plus_1: String(parseInt(tax_year) + 1)` to params at lines 580 and 639
- Added `year_plus_1` to skip list in detail loops (lines 618, 645) to prevent overwrite
- Added `{year_plus_1}` resolution in `doc-builder.ts` for help text

### Fix 3: Questionnaire for CS
- Pass `filing_type` from current report to API call
- Reset `_questionnaireFetched` on tab switch
- Dynamic label: "שאלון הצהרת הון" for CS, "השאלון השנתי" for AR

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `SSOT_CS_required_documents.md` | Modify | Remove `**` from year only, add year-not-bold rule |
| `github/.../n8n/workflow-processor-n8n.js` | Modify | Add `year_plus_1` to params, skip in detail loop |
| `github/.../assets/js/document-manager.js` | Modify | Pass filing_type, reset questionnaire on tab switch, dynamic label |
| `api/src/lib/doc-builder.ts` | Modify | Add `{year_plus_1}` placeholder resolution |

## 7. Validation Plan
* [ ] Submit test CS Tally form → credit card docs show correct year+1 (e.g., "ינואר 2026" not "ינואר אשראי11")
* [ ] Open document-manager for CS report → questionnaire section loads with data
* [ ] Switch between AR and CS tabs → questionnaire refreshes correctly
* [ ] CS questionnaire label shows "שאלון הצהרת הון", AR shows "השאלון השנתי"
* [ ] Verify doc titles render with bold on respondent values but NOT on year

## 8. Implementation Notes
- Airtable `documents_templates` table already had clean templates (no `**`) — no API update needed
- The `**` markers were only in the SSOT documentation file, not in the actual Airtable data
