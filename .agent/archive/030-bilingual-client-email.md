# Design Log 030: Bilingual Client Email for English Respondents
**Status:** [COMPLETED]
**Date:** 2026-02-15
**Related Logs:** 027 (Document Service), 029 (WF02 Rebuild)

## 1. Context & Problem

When a client submits the English Tally questionnaire, their email from the office should be **bilingual** (English + Hebrew) for convenience. Currently, ALL clients receive Hebrew-only emails regardless of which questionnaire language they used.

**Office email:** Always Hebrew-only (correct, no change needed).

**Root cause:** WF[02] reads `source_language` from the questionnaire response record and passes it to the Document Service — which correctly generates bilingual HTML. But WF[02]'s "Update Report Stage" node **never writes `source_language` to the `annual_reports` table**. Later, when WF[03] triggers (office clicks "Approve & Send"), it reads `source_language` from `annual_reports`, gets null, defaults to `'he'`, and generates Hebrew-only.

**Secondary issue:** Even when bilingual mode works, the Hebrew section of the email has English dynamic values (e.g., "Severance pay" instead of "פיצויי פיטורין") because English form choice values are plugged into Hebrew templates.

## 2. User Requirements (The 5 Questions)

1. **Q:** Is the bilingual email currently working in production?
   **A:** No — the client receives Hebrew-only email even for English submissions.

2. **Q:** Should the Hebrew section translate English form values (e.g., "Severance pay" → "פיצויי פיטורין")?
   **A:** Yes — translate to Hebrew in the Hebrew section.

3. **Q:** Should the email subject be bilingual?
   **A:** English subject only for English clients. Hebrew subject for Hebrew clients.

4. **Q:** Which workflow generates the client email?
   **A:** WF[03] "Approve & Send" → calls Document Service → generates `client_email_html` → sends via MS Graph.

## 3. Technical Constraints & Risks

* **Dependencies:**
  - WF[02] "Update Report Stage" node (Airtable update — needs `source_language` added)
  - Document Service "Generate HTML" node (already has bilingual logic ✅)
  - Document Service "Generate Documents" node (needs EN→HE translation map for enum values)
  - WF[03] "Prepare Service Input" (already reads `source_language` ✅)
  - Airtable `annual_reports.source_language` field (exists ✅, singleSelect: he/en)

* **Risks:**
  - Existing `annual_reports` records from English submissions have no `source_language` set — they'll continue defaulting to Hebrew unless backfilled
  - Translation map only covers Tally enum values (dropdowns) — user-entered free text (employer names, bank names) stays as-entered, which is correct

## 4. Proposed Solution (The Blueprint)

### Fix 1: Propagate `source_language` to `annual_reports` (WF[02])

**Node:** "Update Report Stage" in WF[02] (`QqEIWQlRs1oZzEtNxFUcQ`)

**Change:** Add `source_language` field to the Airtable update:
```
Current fields: { stage, id, last_progress_check_at }
New fields:     { stage, id, last_progress_check_at, source_language }
```

Value: `={{ $('Extract & Map').item.json.language }}`

**Method:** `n8n_update_partial_workflow` with `updateNode` on "Update Report Stage" to add `source_language` to the column mapping.

### Fix 2: English-only email subject (Document Service)

**Node:** "Generate HTML" in Document Service (`hf7DRQ9fLmQqHv3u`)

**Change:** Update the subject line for English clients:
```javascript
// Current (bilingual):
const emailSubject = isEnglish
  ? `Document Request / דרישת מסמכים - ${clientName} - ${year}`
  : `דרישת מסמכים לשנת ${year} - ${clientName}`;

// New (English-only):
const emailSubject = isEnglish
  ? `Required Documents - ${clientName} - ${year}`
  : `דרישת מסמכים לשנת ${year} - ${clientName}`;
```

### Fix 3: Hebrew translations for English enum values (Document Service)

**Node:** "Generate Documents" in Document Service (`hf7DRQ9fLmQqHv3u`)

**Change:** Add a static EN→HE translation map for Tally dropdown choice values. When `language === 'en'`, apply HE translations when generating `issuer_name` (Hebrew title), and keep original English for `issuer_name_en`.

**Translation map (enum values that appear in document titles):**

| English (Tally EN form) | Hebrew (Tally HE form) |
|---|---|
| Severance pay | פיצויי פיטורין |
| Retirement grant | מענק פרישה |
| Lump-sum withdrawal of benefits (capital) | משיכת קופת גמל להשקעה |
| Pension / pension commutation | משיכת קרן פנסיה |
| Study fund withdrawal | משיכת קרן השתלמות |
| Other | אחר |
| Disability | נכות |
| Unemployment | אבטלה |
| Reserve duty | מילואים |
| Maternity benefits | דמי לידה |
| Work injury | פגיעה בעבודה |
| Rental | שכירות |
| Salary | משכורת |
| Business | עסק |
| Capital gains | רווחי הון |
| Married | נשוי/אה |
| Single | רווק/ה |
| Divorced | גרוש/ה |
| Widowed | אלמן/ה |

**Implementation:** Add `EN_TO_HE_MAP` constant at the top of Generate Documents code. Create a `translateToHebrew(value)` function that checks the map. When building Hebrew title variables, apply translation; when building English title variables, keep original.

**Note:** Free-text values (employer names, bank names, etc.) are NOT translated — only Tally dropdown enum values. This is correct behavior because employer names are proper nouns.

### Logic Flow

1. Client submits English questionnaire → Tally → Airtable (`תשובות שאלון שנתי`)
2. WF[02] Schedule Trigger picks it up → Extract & Map reads `source_language = 'en'`
3. WF[02] calls Document Service with `language: 'en'`
4. Document Service generates docs with both `issuer_name` (Hebrew with translated values) and `issuer_name_en` (English)
5. WF[02] upserts documents to Airtable (both fields saved)
6. **NEW:** WF[02] "Update Report Stage" now also sets `source_language = 'en'` on `annual_reports`
7. Office reviews → clicks "Approve & Send"
8. WF[03] reads `source_language = 'en'` from `annual_reports` ✅
9. WF[03] calls Document Service with `language: 'en'`, `action: 'html_only'`
10. Document Service generates bilingual `client_email_html` (EN section + divider + HE section)
11. WF[03] sends bilingual email with English-only subject line

### Architecture

* **Modified Nodes (3):**
  - WF[02] `Update Report Stage` — add `source_language` field
  - Document Service `Generate HTML` — change email subject to English-only
  - Document Service `Generate Documents` — add EN→HE translation map

* **No New Files / No New Nodes**

## 5. Validation Plan

* [ ] Run WF[02] test with English submission → verify `source_language = 'en'` is set on `annual_reports`
* [ ] Run WF[03] test for English report → verify client receives bilingual email
* [ ] Verify Hebrew section has translated enum values (not English)
* [ ] Verify English section has correct English titles
* [ ] Verify Hebrew submission still produces Hebrew-only email
* [ ] Verify office email is always Hebrew-only (both languages)
* [ ] Verify email subject: English client gets English-only, Hebrew client gets Hebrew-only
* [ ] Spot-check: withdrawal types, NII types, foreign income types all translated correctly

## 6. Implementation Notes (Post-Code)

### Original Fixes (Design Log Plan)

* **Fix 1 (WF[02]):** Added `source_language` field to "Update Report Stage" node via `n8n_update_partial_workflow`. Value: `={{ $('Extract & Map').item.json.language }}`. Now persists to `annual_reports` table so WF[03] can read it.
* **Fix 2 (Generate HTML):** Changed email subject from bilingual `Document Request / דרישת מסמכים` to English-only `Required Documents - {name} - {year}`. Hebrew subject unchanged.
* **Fix 3 (Generate Documents):** Added `EN_TO_HE` translation map (20+ entries covering withdrawal types, NII types, foreign income types, marital status, generic yes/no/other). Added helper functions: `toHebrew()`, `hebrewVars()`, `isOtherValue()`, `isYesValue()`. All `formatTemplate(template.name_he, vars)` calls now use `hebrewVars(vars)` for Hebrew title generation. T302 spouse NII has special handling with `displayTypeHe = toHebrew(allowanceType)`.

### Additional Fixes Discovered During Testing

* **Fix 4 (WF[02]):** Added `spouse_name` to "Update Report Stage" node. Value: `={{ $('Extract & Map').item.json.spouse_name }}`. Without this, WF[03] got null for spouse_name → `isMarried=false` → spouse section completely missing from client email. Same root cause pattern as Fix 1.
* **Fix 5 (Airtable):** Updated 28 `documents_templates.name_en` templates to add `**{var}**` bold markers matching the Hebrew templates. Previously EN titles had no bold formatting.
* **Fix 6 (Generate Documents v3):** `hasTriggeredPerItemMapping()` replaces `findPerItemMapping()` — uses `.some()` instead of `.find()` to check ALL triggered per_item mappings for a template+person. Fixes T501 "ב" empty company bug where the wrong per_item mapping was checked.
* **Fix 7 (Generate Documents v3):** T501 skips when `company_name` is empty — prevents documents with trailing "ב" in title.
* **Fix 8 (Generate Documents v3):** T501 English deposit type names via `_deposit_type_en` variable + `enVars` override. Maps mapping_id to English names: pension→"pension fund", hishtalmut→"study fund", life_insurance→"life insurance", work_disability→"work disability insurance", mortgage→"life insurance".

### Validation Results

* [x] WF[02] test with English submission → `source_language = 'en'` set on `annual_reports`
* [x] WF[03] test for English report → client receives bilingual email
* [x] Hebrew section has translated enum values (not English)
* [x] English section has correct English titles
* [x] Email subject: English client gets English-only
* [x] Spot-check: withdrawal types, NII types, foreign income types all translated correctly
* [x] Spouse section renders in both EN and HE sections (59 docs = 50 client + 9 spouse)
* [x] T501 no empty company names, English deposit types correct
* [x] T401 "Other" skipped, T402 with detail text used
* [x] T302 spouse NII "Other" includes detail text
* [x] Office email always Hebrew-only with full document list
