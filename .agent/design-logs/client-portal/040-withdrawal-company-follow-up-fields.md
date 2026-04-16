# Design Log 040: Withdrawal Company Follow-Up Fields
**Status:** [COMPLETED]
**Date:** 2026-02-19
**Related Logs:** 029 (Simplified WF02), 024 (SSOT Alignment), 007 (Questionnaire Mapping Refactor)

## 1. Context & Problem
Three withdrawal types in the Tally questionnaire (קרן השתלמות, קרן פנסיה, קופת גמל להשקעה) now have follow-up questions asking "from which insurance company were the funds withdrawn?" — added to both HE and EN Tally forms as TEXTAREA fields (one company per line, multi-company support).

Currently, T401 documents generate as "אישור משיכה – קרן השתלמות" with no company name. The office needs to know WHICH company the withdrawal came from. The new follow-up answers need to flow through the full pipeline: Tally → Airtable → question_mappings → Document Service → document title.

**Airtable columns already created** (this session): `חברת ביטוח - קרן השתלמות`, `חברת ביטוח - קרן פנסיה`, `חברת ביטוח - קופת גמל להשקעה` (all multilineText in `תשובות שאלון שנתי`).

## 2. User Requirements (The 5 Questions)

1. **Q:** How are the Tally follow-ups structured — 3 separate fields or 1 shared?
   **A:** 3 separate fields, each with its own question ID.

2. **Q:** Should company name appear in the document title?
   **A:** Yes. Format: `אישור משיכה – קרן השתלמות – **מגדל**` (option B with dash separator).

3. **Q:** Should "אחר" (Other) withdrawal type also get a company follow-up?
   **A:** No — stays separate as T402.

4. **Q:** Do פיצויי פיטורין and מענק פרישה also need company follow-ups?
   **A:** No — only the 3 types with insurance companies.

5. **Q:** What if the client leaves the company field empty but selects the withdrawal type?
   **A:** It's a required field in Tally — can't be empty.

6. **Q:** Can withdrawals be from multiple companies per type?
   **A:** Yes — same per_item pattern as employer lists (T201). One company per line → one document per company.

## 3. Technical Constraints & Risks

* **Dependencies:**
  - Tally form fields (already created in both HE/EN forms)
  - Airtable `תשובות שאלון שנתי` table (columns already created)
  - Airtable `question_mappings` table (needs 3 new rows)
  - Airtable `documents_templates` T401 (needs `{company_name}` variable)
  - n8n `[SUB] Document Service` (`hf7DRQ9fLmQqHv3u`) — "Generate Documents" Code node
  - n8n `[02] Questionnaire Response` (`QqEIWQlRs1oZzEtNxFUcQ`) — "Extract & Map" Code node

* **Risks:**
  - The existing `withdrawal_types` mapping (per_item on multipleSelects) generates T401 docs by type. The new company follow-ups generate T401 docs by company within a type. These two must NOT create duplicate documents — the company-specific docs should REPLACE the type-only docs for the 3 applicable types.
  - Types without company fields (פיצויי פיטורין, מענק פרישה) must continue generating T401 without company name.
  - The `per_item` pattern splits on `\n` and `;`. Tally TEXTAREA should produce `\n`-separated values.

* **Two codebases:** Document Service logic exists in both n8n Code nodes AND GitHub Pages JS — both need updating.

## 4. Proposed Solution (The Blueprint)

### 4.1 Tally → Airtable Connection (Manual Step)

User must configure in Tally's Airtable integration settings:

| Tally TEXTAREA (HE) | → Airtable Column |
|---------------------|-------------------|
| `f91ebbf4-...` (קרן השתלמות follow-up) | חברת ביטוח - קרן השתלמות |
| `9548659b-...` (קרן פנסיה follow-up) | חברת ביטוח - קרן פנסיה |
| `91371b53-...` (קופת גמל follow-up) | חברת ביטוח - קופת גמל להשקעה |

| Tally TEXTAREA (EN) | → Airtable Column |
|---------------------|-------------------|
| `4647ccc8-...` (Study fund follow-up) | חברת ביטוח - קרן השתלמות |
| `02b5efe7-...` (Provident fund follow-up) | חברת ביטוח - קופת גמל להשקעה |
| `cada8b0c-...` (Pension fund follow-up) | חברת ביטוח - קרן פנסיה |

### 4.2 Airtable `question_mappings` — 3 New Rows

| mapping_id | tally_key_he | airtable_field_name | template_ids | condition | per_item | is_spouse | category |
|-----------|-------------|-------------------|-------------|-----------|---------|-----------|---------|
| withdrawal_study_fund_companies | (from Tally) | חברת ביטוח - קרן השתלמות | T401 | has_value | true | false | insurance |
| withdrawal_pension_companies | (from Tally) | חברת ביטוח - קרן פנסיה | T401 | has_value | true | false | insurance |
| withdrawal_provident_companies | (from Tally) | חברת ביטוח - קופת גמל להשקעה | T401 | has_value | true | false | insurance |

**Note:** The `tally_key_he` values will be determined after Tally integration is configured — Tally assigns question IDs that we'll need to record.

### 4.3 Document Generation Logic Change

**Current behavior:**
- `withdrawal_types` mapping fires per selected type from multipleSelects
- Each type → T401 with `{withdrawal_type}` = type name
- Title: "אישור משיכה – קרן השתלמות"

**New behavior:**
- For 3 types WITH company follow-ups (קרן השתלמות, קרן פנסיה, קופת גמל להשקעה):
  - The company-specific mapping fires per_item (one doc per company)
  - T401 with `{withdrawal_type}` = type name AND `{company_name}` = company
  - Title: "אישור משיכה – קרן השתלמות – **מגדל**"
  - The type-only mapping for these 3 types should be SUPPRESSED (to avoid duplicates)

- For 2 types WITHOUT company follow-ups (פיצויי פיטורין, מענק פרישה):
  - Current behavior unchanged
  - Title: "אישור משיכה – פיצויי פיטורין" (no company)

**Implementation approach — Document Service "Generate Documents" node:**

The existing `withdrawal_types` per_item mapping generates one T401 per selected type. We need to intercept the 3 types that have company follow-ups and replace them with company-specific documents instead.

Option A — **Suppress + Replace:** When processing `withdrawal_types`, skip the 3 types that have company follow-ups. Then the 3 company mappings generate their own T401 docs with both type and company in the title.

Option B — **Enrich in-place:** When processing `withdrawal_types` per_item, for the 3 applicable types, look up the corresponding company field and generate per-company docs instead of one per-type doc.

**Recommended: Option A (Suppress + Replace)** — cleaner separation, each mapping row is self-contained.

To implement Option A:
1. Add a `suppress_for_types` or similar mechanism to the `withdrawal_types` mapping, so that when the type is "משיכת קרן השתלמות", "משיכת קרן פנסיה", or "משיכת קופת גמל להשקעה", the per_item doc is skipped.
2. The 3 new company mappings handle those types fully, adding both `{withdrawal_type}` and `{company_name}` to the title.

### 4.4 Template Update — T401

**Current:** `אישור משיכה – {withdrawal_type}`

**Updated:** `אישור משיכה – {withdrawal_type}` (unchanged — company appended conditionally by Document Service)

Alternatively, keep T401 as-is and have the Document Service append ` – **{company_name}**` to the issuer_name when company is present. This avoids template change and keeps backward compat for types without company.

**Recommended:** Don't change T401 template. Instead, the Document Service builds `issuer_name` as:
- Without company: `קרן השתלמות`
- With company: `קרן השתלמות – **מגדל**`

This way the template `אישור משיכה – {withdrawal_type}` works for both cases.

### 4.5 WF02 "Extract & Map" — No Change Needed

The Extract & Map node already reads ALL `question_mappings` rows and translates `airtable_field_name` → `tally_key_he` dynamically. Adding 3 new mappings with correct `airtable_field_name` values will be picked up automatically on next execution.

### 4.6 English Label for New Mappings

| mapping_id | label_en |
|-----------|---------|
| withdrawal_study_fund_companies | Study fund withdrawal - insurance companies |
| withdrawal_pension_companies | Pension fund withdrawal - insurance companies |
| withdrawal_provident_companies | Investment provident fund withdrawal - insurance companies |

### 4.7 Minor Text Fix (EN Form)

The helper text "Enter each withdrawn a separate line." should be "Enter each company on a separate line." — 3 blocks in EN form need updating.

### Architecture
* **Modified (Airtable):**
  - `question_mappings` — 3 new rows
  - No template change to T401
* **Modified (n8n):**
  - `[SUB] Document Service` ("Generate Documents" Code node) — suppress 3 types from `withdrawal_types`, add company-specific T401 generation from new mappings
* **Modified (GitHub Pages):**
  - `n8n/ssot-document-generator.js` — same logic change (if applicable to browser-side)
* **Manual steps:**
  - User configures Tally → Airtable field mapping for 3 new TEXTAREAs

## 5. Validation Plan
* [x] Submit test form (HE) selecting קרן השתלמות + קרן פנסיה with company names (2 companies each)
* [x] Verify Airtable columns populated correctly (one company per line)
* [x] Verify WF02 processes new fields → generates T401 docs with company names
* [x] Verify doc titles: "אישור משיכה – קרן השתלמות – **מגדל**", "אישור משיכה – קרן השתלמות – **הראל**"
* [x] Verify פיצויי פיטורין still generates T401 WITHOUT company: "אישור משיכה – פיצויי פיטורין"
* [x] Verify no duplicate T401 docs (company-specific replaces type-only for the 3 applicable types)
* [x] Verify "אחר" still generates T402 separately
* [x] Verify office email shows correct categorized doc list
* [x] Submit test form (EN) with same selections — verify same result
* [x] Verify no regression: other document types unaffected (60 docs total, all correct)

## 6. Implementation Notes (Post-Code)
* Airtable columns already created: `חברת ביטוח - קרן השתלמות` (`fldOZQUjZQ9KtOiAA`), `חברת ביטוח - קרן פנסיה` (`flde2aHE3Tn6OEphd`), `חברת ביטוח - קופת גמל להשקעה` (`fld4Yj5NkduDzovmr`)
* Implementation used Option A (Suppress + Replace) as planned: WITHDRAWAL_COMPANY_MAPPINGS constants + dedicated T401 handler + skip guard in generic loop
* Tally → Airtable mapping configured manually by user for both HE and EN forms (6 TEXTAREAs total)
* Additional bugs found and fixed during testing:
  - Fix #15: T302 "Other" Hebrew prefix — was using English "Other:" instead of Hebrew "אחר:" for HE form submissions
  - Fix #16: T901/T902 rent contracts — removed amount guards that killed docs after Tally field removal (amounts no longer collected)
  - Fix #17: T305/T306 survivors — set per_item=true on Airtable mappings + removed code overrides that concatenated all survivor names into one doc
  - Font fix: Switched email HTML from system font stack to Calibri, standardized font-weight to only normal/bold
* Deleted 2 dead question_mappings rows (rent_income_amount, rent_expense_amount) — 64→62 rows
* SSOT file updated with all new rules (sections 1.5, 1.7, 1.8, 2.5, 2.10, 3, 4, 4.2)
* GitHub Pages JS (`ssot-document-generator.js`) NOT yet updated — pending
