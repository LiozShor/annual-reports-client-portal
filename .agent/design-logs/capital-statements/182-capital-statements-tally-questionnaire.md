# Design Log 182: Capital Statements Tally Questionnaire
**Status:** [BEING IMPLEMENTED]
**Date:** 2026-03-25
**Related Logs:** [DL-164: Filing Type Layer](164-filing-type-capital-statements-layer.md), [docs/cs-ar-equivalence-mapping.md](../../docs/cs-ar-equivalence-mapping.md)

## 1. Context & Problem

The firm handles two filing types: Annual Reports (AR) and Capital Statements (CS / הצהרות הון). AR already has a complete bilingual Tally questionnaire (94 fields), SSOT document templates (33), and Airtable question mappings (60). CS currently uses an old imkforms questionnaire that is monolingual (Hebrew), not integrated with our system, and requires manual document list creation by Natan.

DL-164 already built the filing-type infrastructure layer — `filing_type` field exists in Airtable tables, Document Service filters by filing type, emails use dynamic labels. This DL designs the **CS content**: the Tally form, SSOT document templates, and Airtable mappings.

## 2. User Requirements

1. **Q:** Should the CS form use conditional show/hide like AR?
   **A:** Yes — same as AR. Follow-up fields appear only when user answers "yes".

2. **Q:** Insurance/pension: 5 separate yes/no or one multi-select?
   **A:** 5 separate yes/no, each with its own "which company?" follow-up. Matches Natan's explicit request.

3. **Q:** Multiple properties: repeatable rows, fixed slots, or textarea?
   **A:** Textarea — one address per line (same pattern as AR employers). Parse and generate one doc per line.

4. **Q:** Married toggle: add spouse-specific sections or family unit only?
   **A:** Family unit only — when married, switch to plural phrasing. No separate spouse doc lists.

**Additional requirements from Natan (pre-discovery):**
- Insurance document: "אישור מס להצהרת הון ליום 31.12.[year] מחברת ___"
- Split insurance into: pension, study fund, provident, life insurance, savings plan
- Married toggle changes phrasing to plural
- Real estate: separate row + doc per property
- "Other" catch-all: free text, Natan adds docs manually from admin panel
- Cash: declaration only (no doc). Safe: needs evidence (purchase invoice etc.)
- No additional questions needed beyond old imkforms

## 3. Research

### Domain
Form Design, Bilingual RTL/LTR UX, Financial Questionnaire Design

### Sources Consulted
1. **"Form Design Patterns" — Adam Silver** — One thing per page; conditional branching as page routing; never show irrelevant questions.
2. **GOV.UK Design System** — Gateway yes/no questions filter complexity; explicit "not applicable" choices; summary-check pattern for verification.
3. **Nielsen Norman Group — Complex Form Research** — Progressive disclosure increases completion 20-30%. Users abandon on irrelevant questions, not on length.

### Key Principles
- **Progressive disclosure via gateway questions** — each CS section starts with yes/no; details only appear if relevant. Directly maps to Tally's conditional logic blocks.
- **Group by life context** — sections organized as: Business Capital → Real Estate → Banking → Employment → Insurance → Investments → Debts → Cash/Other. Users think "I own a car" not "vehicle assets for balance sheet."
- **Bilingual = two parallel forms** — separate HE and EN Tally forms with shared field keys. Not inline translation. User picks language at landing page.
- **English keys for storage** — all data stored with English semantic keys (`has_business_bank`, `property_addresses`). Display labels come from translation map.

### Patterns to Use
- **AR Tally pattern (proven):** Hidden fields → personal info → conditional sections → free text. Replicate exactly for CS.
- **Per-item textarea parsing:** Same as AR employers/securities — one line per item, split and generate one doc each.
- **KEY_MAP translation:** Same EN→HE key mapping pattern for bilingual form support.

### Anti-Patterns to Avoid
- **Mixing RTL/LTR in labels** — keep forms monolingual per instance.
- **Showing full doc list before context** — CS form captures situation, system derives docs.

### Research Verdict
Follow the proven AR Tally pattern exactly. CS is simpler (fewer conditional cascades, no multi-select with overrides). Main design work is mapping the ~22 imkforms questions to ~49 Tally fields with proper bilingual labels and conditional logic.

## 4. Codebase Analysis

### Existing Solutions Found
- **DL-164:** Filing type infrastructure DONE — `filing_type` field in Airtable, Document Service filters, email labels, API returns form IDs
- **FILING_CONFIG in `api/src/routes/submission.ts`:** Empty `form_id_he`/`form_id_en` placeholders for `capital_statement` — ready to fill
- **`workflow-processor-n8n.js`:** KEY_MAP + VALUE_TRANSLATIONS pattern ready to extend with CS keys
- **`documents_templates` table:** Has `filing_type` field — CS templates just need to be inserted
- **`question_mappings` table:** Has `filing_type` field — CS mappings just need to be inserted

### Reuse Decision
Reuse 100% of the existing infrastructure. No new code architecture needed. Only new content:
- New Tally forms (built in Tally UI)
- New SSOT doc (markdown)
- New Airtable records (templates + mappings)
- CS KEY_MAP addition to workflow processor

### Relevant Files
| File | Purpose |
|------|---------|
| `api/src/routes/submission.ts:20-33` | FILING_CONFIG — fill in CS form IDs |
| `github/.../n8n/workflow-processor-n8n.js:21-105` | KEY_MAP — add CS mappings after EN form built |
| `archive/tally_n8n_mapping_with_english_keys.csv` | Reference for AR mapping format |
| `SSOT_required_documents_from_Tally_input.md` | AR SSOT — template for CS SSOT |
| `docs/cs-ar-equivalence-mapping.md` | CS↔AR analysis with Natan's clarifications |

### Dependencies
- Tally account (form creation is manual in Tally UI)
- Airtable API access (to create template + mapping records)
- n8n workflow access (to update processor after forms built)

## 5. Technical Constraints & Risks

* **Security:** CS forms use same HMAC token pattern as AR. No new security concerns.
* **Risks:**
  - Tally field keys are only known AFTER form creation — CSV and KEY_MAP populated post-build
  - Insurance/pension 5-way split = 10 fields — longer than imkforms but justified by Natan's doc mapping needs
* **Breaking Changes:** None — CS is additive. AR unaffected.

## 6. Proposed Solution (The Blueprint)

### Phase 1: Create CS SSOT Document
Create `SSOT_CS_required_documents.md` with 22 CS document templates:

| ID | Category | Title Template (HE) | Variables |
|----|----------|---------------------|-----------|
| CS-T001 | business_capital | תעודת זהות בנקאית *מפורטת* לשנת **{year}** מ**{bank_name}** (חשבון עסקי) | year, bank_name |
| CS-T002 | business_capital | דף פירוט עסקאות אשראי לחודש 12.**{year}** מ**{card_company}** (עסקי) | year, card_company |
| CS-T003 | business_capital | חו"ז בעל מניות ליום 31.12.**{year}** מ**{company_name}** | year, company_name |
| CS-T004 | real_estate | חוזה רכישת הנכס — **{property_address}** | property_address |
| CS-T005 | real_estate | אסמכתאות שיפוצים בנכס — **{property_address}** | property_address |
| CS-T006 | real_estate | חוזה רכישה + פרטי זכות — דירת נופש **{vacation_details}** | vacation_details |
| CS-T007 | real_estate | רישיון רכב — **{vehicle_description}** | vehicle_description |
| CS-T008 | banking | ת.ז בנקאית *מפורטת* לשנת **{year}** מ**{bank_name}** | year, bank_name |
| CS-T009 | banking | דף פירוט עסקאות אשראי לחודש 12.**{year}** מ**{card_company}** | year, card_company |
| CS-T010 | banking | אישור יתרת משכנתא ליום 31.12.**{year}** מ**{bank_name}** | year, bank_name |
| CS-T011 | banking | אישור יתרת הלוואה ליום 31.12.**{year}** מ**{lender_name}** | year, lender_name |
| CS-T012 | employment | תלוש שכר לחודש 12.**{year}** מ**{employer_name}** | year, employer_name |
| CS-T013 | insurance_pension | אישור מס להצהרת הון ליום 31.12.**{year}** מ**{company_name}** — פנסיה | year, company_name |
| CS-T014 | insurance_pension | אישור מס להצהרת הון ליום 31.12.**{year}** מ**{company_name}** — קרן השתלמות | year, company_name |
| CS-T015 | insurance_pension | אישור מס להצהרת הון ליום 31.12.**{year}** מ**{company_name}** — קופת גמל להשקעה | year, company_name |
| CS-T016 | insurance_pension | אישור מס להצהרת הון ליום 31.12.**{year}** מ**{company_name}** — ביטוח חיים | year, company_name |
| CS-T017 | insurance_pension | אישור מס להצהרת הון ליום 31.12.**{year}** מ**{company_name}** — תוכנית חסכון | year, company_name |
| CS-T018 | investments | אישור יתרת ניירות ערך ליום 31.12.**{year}** מ**{institution_name}** | year, institution_name |
| CS-T019 | debts | אסמכתא — חוב כלפי התא המשפחתי | (no variables — free text question, details in notes) |
| CS-T020 | debts | אסמכתא — חוב של התא המשפחתי | (no variables — free text question, details in notes) |
| CS-T021 | other_assets | אסמכתא על קיום כספת | (no variables) |
| CS-T022 | banking | ת.ז בנקאית מפורטת — חשבון ייפוי כוח/נאמנות מ**{bank_name}** | bank_name |

### Phase 2: Create CS Tally Form Spec

Complete field spec for both HE and EN forms:

#### Hidden Fields (6)
Same as AR: report_record_id, client_id, year, questionnaire_token, full_name, email

#### Section 0: Personal Info
| # | HE Label | EN Label | Type | Required | Conditional |
|---|----------|----------|------|----------|-------------|
| 1 | שם ושם משפחה | First and Last Name | INPUT_TEXT | Yes | — |
| 2 | אימייל | Email | INPUT_EMAIL | Yes | — |
| 3 | טלפון | Phone Number | PHONE_NUMBER | No | — |

#### Section 1: Family Status
| # | HE Label | EN Label | Type | Required | Conditional |
|---|----------|----------|------|----------|-------------|
| 4 | האם ביום 31.12.{year} היית נשוי/אה? | Were you married on 31.12.{year}? | MULTIPLE_CHOICE (כן/לא) | Yes | — |
| 5 | שם בן/בת הזוג | Spouse's name | INPUT_TEXT | Yes | Q4 = כן |

#### Section 2: הון המושקע בעסקים / Business Capital
| # | HE Label | EN Label | Type | Required | Conditional |
|---|----------|----------|------|----------|-------------|
| 6 | האם ביום 31.12.{year} היה לכם חשבון בנק עסקי? | Did you have a business bank account on 31.12.{year}? | MULTIPLE_CHOICE | Yes | — |
| 7 | שם הבנק העסקי (אם יותר מאחד — אחד בכל שורה) | Business bank name(s) — one per line | TEXTAREA | Yes | Q6 = כן |
| 8 | האם ביום 31.12.{year} היו ברשותכם כרטיסי אשראי חוץ-בנקאיים בחשבון העסקי? | Did you have non-bank credit cards on the business account on 31.12.{year}? | MULTIPLE_CHOICE | Yes | — |
| 9 | שם חברת האשראי ומספר הכרטיס (אחד בכל שורה) | Credit card company and number — one per line | TEXTAREA | Yes | Q8 = כן |
| 10 | האם ביום 31.12.{year} הייתם בעלי מניות בחברה? | Did you hold shares in a company on 31.12.{year}? | MULTIPLE_CHOICE | Yes | — |
| 11 | שמות החברות (אחת בכל שורה) | Company names — one per line | TEXTAREA | Yes | Q10 = כן |

#### Section 3: נכסי מקרקעין ורכוש / Real Estate & Property
| # | HE Label | EN Label | Type | Required | Conditional |
|---|----------|----------|------|----------|-------------|
| 12 | האם ביום 31.12.{year} היו קיימים נכסי מקרקעין בבעלותכם? | Did you own real estate on 31.12.{year}? | MULTIPLE_CHOICE | Yes | — |
| 13 | כתובת כל נכס (אחד בכל שורה) | Property addresses — one per line | TEXTAREA | Yes | Q12 = כן |
| 14 | האם בוצעו שיפוצים/תוספות בנכסים? | Were renovations/additions made to any property? | MULTIPLE_CHOICE | No | Q12 = כן |
| 15 | האם ביום 31.12.{year} היו לכם זכויות בדירות נופש בארץ ו/או בחו"ל? | Did you have rights in vacation homes in Israel or abroad on 31.12.{year}? | MULTIPLE_CHOICE | Yes | — |
| 16 | תיאור הזכות, מיקום, תאריך רכישה ועלות (אחד בכל שורה) | Rights description, location, purchase date and cost — one per line | TEXTAREA | Yes | Q15 = כן |
| 17 | האם ביום 31.12.{year} היו ברשותכם כלי רכב, טייס, שייט? | Did you own vehicles, aircraft, or boats on 31.12.{year}? | MULTIPLE_CHOICE | Yes | — |
| 18 | סוג כלי התחבורה, תאריך רכישה ועלות (אחד בכל שורה) | Vehicle type, purchase date and cost — one per line | TEXTAREA | Yes | Q17 = כן |

#### Section 4: חשבונות בנק ואשראי / Banking & Credit
| # | HE Label | EN Label | Type | Required | Conditional |
|---|----------|----------|------|----------|-------------|
| 19 | כל חשבונות הבנק של התא המשפחתי בארץ ובחו"ל (אחד בכל שורה) | All family bank accounts in Israel and abroad — one per line | TEXTAREA | Yes | — |
| 20 | כרטיסי אשראי חוץ-בנקאיים פרטיים — שם חברה (אחד בכל שורה) | Personal non-bank credit cards — company name, one per line | TEXTAREA | No | — |
| 21 | האם ביום 31.12.{year} הייתה לכם משכנתא? | Did you have a mortgage on 31.12.{year}? | MULTIPLE_CHOICE | Yes | — |
| 22 | מאיזה בנק נלקחה המשכנתא (אחד בכל שורה) | Mortgage bank(s) — one per line | TEXTAREA | Yes | Q21 = כן |
| 23 | האם היו הלוואות חוץ-בנקאיות ליום 31.12.{year}? | Did you have non-bank loans on 31.12.{year}? | MULTIPLE_CHOICE | No | — |
| 24 | שם המלווה ופרטי ההלוואה (אחד בכל שורה) | Lender name and loan details — one per line | TEXTAREA | Yes | Q23 = כן |

#### Section 5: תעסוקה / Employment
| # | HE Label | EN Label | Type | Required | Conditional |
|---|----------|----------|------|----------|-------------|
| 25 | האם הייתם שכירים בחודש דצמבר {year}? | Were you employed in December {year}? | MULTIPLE_CHOICE | Yes | — |
| 26 | שמות מקומות העבודה (אחד בכל שורה) | Employer names — one per line | TEXTAREA | Yes | Q25 = כן |

#### Section 6: ביטוח ופנסיה / Insurance & Pension
Intro text: יש לפרט את כל קופות הגמל, ביטוחי החיים, קרנות ההשתלמות וכו' של התא המשפחתי ליום 31.12.{year}

| # | HE Label | EN Label | Type | Required | Conditional |
|---|----------|----------|------|----------|-------------|
| 27 | האם יש לכם קרן פנסיה? | Do you have a pension fund? | MULTIPLE_CHOICE | No | — |
| 28 | שם חברת הפנסיה (אחד בכל שורה) | Pension company name(s) — one per line | TEXTAREA | Yes | Q27 = כן |
| 29 | האם יש לכם קרן השתלמות? | Do you have a study fund? | MULTIPLE_CHOICE | No | — |
| 30 | שם החברה (אחד בכל שורה) | Study fund company name(s) — one per line | TEXTAREA | Yes | Q29 = כן |
| 31 | האם יש לכם קופת גמל להשקעה? | Do you have a provident fund for investment? | MULTIPLE_CHOICE | No | — |
| 32 | שם החברה (אחד בכל שורה) | Provident fund company name(s) — one per line | TEXTAREA | Yes | Q31 = כן |
| 33 | האם יש לכם ביטוח חיים? | Do you have life insurance? | MULTIPLE_CHOICE | No | — |
| 34 | שם חברת הביטוח (אחד בכל שורה) | Life insurance company name(s) — one per line | TEXTAREA | Yes | Q33 = כן |
| 35 | האם יש לכם תוכנית חסכון? | Do you have a savings plan? | MULTIPLE_CHOICE | No | — |
| 36 | שם הבנק/חברה (אחד בכל שורה) | Savings plan bank/company name(s) — one per line | TEXTAREA | Yes | Q35 = כן |

#### Section 7: השקעות / Investments
| # | HE Label | EN Label | Type | Required | Conditional |
|---|----------|----------|------|----------|-------------|
| 37 | האם ביום 31.12.{year} היו ברשותכם ניירות ערך או קרנות נאמנות? | Did you hold securities or mutual funds on 31.12.{year}? | MULTIPLE_CHOICE | No | — |
| 38 | שם הבנק/מוסד בו מוחזקים ניירות הערך (אחד בכל שורה) | Securities institution name(s) — one per line | TEXTAREA | Yes | Q37 = כן |

#### Section 8: חובות / Receivables & Payables
| # | HE Label | EN Label | Type | Required | Conditional |
|---|----------|----------|------|----------|-------------|
| 39 | האם ביום 31.12.{year} היו גורמים חיצוניים שחייבים כספים לתא המשפחתי? | Were there external parties who owed money to your family on 31.12.{year}? | MULTIPLE_CHOICE | No | — |
| 40 | שמות, תאריך יצירת החוב, תאריך פירעון וסכום | Names, debt creation date, repayment date and amount | TEXTAREA | Yes | Q39 = כן |
| 41 | האם ביום 31.12.{year} היה מישהו מהתא המשפחתי חייב כספים לגורמים חיצוניים? | Did anyone in your family owe money to external parties on 31.12.{year}? | MULTIPLE_CHOICE | Yes | — |
| 42 | שמות, תאריך יצירת החוב, תאריך פירעון וסכום | Names, debt creation date, repayment date and amount | TEXTAREA | Yes | Q41 = כן |

#### Section 9: מזומנים ונכסים אחרים / Cash & Other Assets
| # | HE Label | EN Label | Type | Required | Conditional |
|---|----------|----------|------|----------|-------------|
| 43 | האם ביום 31.12.{year} החזקתם מזומנים בבית מעל 5,000 ₪? | Did you hold cash at home exceeding 5,000 NIS on 31.12.{year}? | MULTIPLE_CHOICE | No | — |
| 44 | סכום המזומנים | Cash amount | INPUT_TEXT | Yes | Q43 = כן |
| 45 | האם ברשותכם כספת? | Do you have a safe? | MULTIPLE_CHOICE | No | — |
| 46 | תכולת הכספת ושוויה | Safe contents and value | TEXTAREA | Yes | Q45 = כן |
| 47 | האם מישהו מהתא המשפחתי משמש מיופה כוח/אפוטרופוס/נאמן על חשבונות שאינם שלכם? | Does anyone in your family serve as power of attorney/guardian/trustee on accounts not owned by you? | MULTIPLE_CHOICE | Yes | — |
| 48 | פרטי החשבונות (אחד בכל שורה) | Account details — one per line | TEXTAREA | Yes | Q47 = כן |
| 49 | נכסים או התחייבויות נוספים שלא צוינו לעיל | Other assets or liabilities not mentioned above | TEXTAREA | No | — |

**Total: 49 visible + 6 hidden = 55 fields**

### Phase 3: Insert Airtable Records

#### a. CS Document Templates (22 records in `documents_templates`)
Insert all CS-T001 through CS-T022 with `filing_type: capital_statement`, appropriate categories, scope=CLIENT, and bilingual name templates.

**New categories to create:**
- `business_capital` — הון עסקי
- `real_estate` — נדל"ן ורכוש
- `banking` — בנקאות ואשראי
- `investments` — השקעות
- `insurance_pension` — ביטוח ופנסיה
- `employment` — תעסוקה
- `debts` — חובות
- `other_assets` — נכסים אחרים

#### b. CS Question Mappings (~30 records in `question_mappings`)
Each mapping links a Tally field key → template ID(s) with condition type and per_item flag.

| mapping_id | tally_key_he | template_ids | condition | per_item | category |
|------------|-------------|--------------|-----------|----------|----------|
| cs_business_bank | (TBD) | CS-T001 | yes | true | business_capital |
| cs_business_credit | (TBD) | CS-T002 | yes | true | business_capital |
| cs_shares | (TBD) | CS-T003 | yes | true | business_capital |
| cs_real_estate | (TBD) | CS-T004 | has_value | true | real_estate |
| cs_renovations | (TBD) | CS-T005 | yes | true | real_estate |
| cs_vacation_home | (TBD) | CS-T006 | has_value | true | real_estate |
| cs_vehicles | (TBD) | CS-T007 | has_value | true | real_estate |
| cs_personal_bank | (TBD) | CS-T008 | has_value | true | banking |
| cs_personal_credit | (TBD) | CS-T009 | has_value | true | banking |
| cs_mortgage | (TBD) | CS-T010 | yes | true | banking |
| cs_nonbank_loans | (TBD) | CS-T011 | yes | true | banking |
| cs_employment | (TBD) | CS-T012 | yes | true | employment |
| cs_pension | (TBD) | CS-T013 | yes | true | insurance_pension |
| cs_study_fund | (TBD) | CS-T014 | yes | true | insurance_pension |
| cs_provident | (TBD) | CS-T015 | yes | true | insurance_pension |
| cs_life_insurance | (TBD) | CS-T016 | yes | true | insurance_pension |
| cs_savings_plan | (TBD) | CS-T017 | yes | true | insurance_pension |
| cs_securities | (TBD) | CS-T018 | yes | true | investments |
| cs_receivables | (TBD) | CS-T019 | yes | false | debts |
| cs_payables | (TBD) | CS-T020 | yes | false | debts |
| cs_safe | (TBD) | CS-T021 | yes | false | other_assets |
| cs_poa_accounts | (TBD) | CS-T022 | yes | true | banking |

*Note: `tally_key_he` values are TBD — populated after Tally forms are built.*

### Phase 4: Build Tally Forms (Automated via Tally MCP)
1. Install Tally MCP: `claude mcp add tally --transport http https://api.tally.so/mcp`
2. Create HE form via Tally MCP with all Hebrew labels, conditional logic, hidden fields
3. Create EN form via Tally MCP with all English labels, same structure
4. Extract form IDs and field keys via Tally API ("list questions" endpoint)
5. Populate `archive/tally_cs_mapping.csv` with actual field keys
6. Update `FILING_CONFIG` in `api/src/routes/submission.ts` with form IDs

### Phase 5: Update Workflow Processor
1. Add CS_KEY_MAP to `workflow-processor-n8n.js` (EN→HE key mapping)
2. Add filing-type routing: if `filing_type === 'capital_statement'`, use CS_KEY_MAP
3. No VALUE_TRANSLATIONS needed for CS (no multi-select options to translate)

### Final Step (Always)
* **Housekeeping:** Update design log status, update INDEX, update `current-status.md`

## 7. Validation Plan
* [ ] All 22 CS templates match Natan's email document mapping — no document missing
* [ ] All imkforms questions accounted for in Tally spec (cross-check Section 6 vs imkforms)
* [ ] Insurance/pension correctly split into 5 separate sub-questions
* [ ] No AR-only topics in CS form (no NII allowances, no withdrawals, no donations, etc.)
* [ ] Cash question = declaration only (no doc). Safe = has evidence doc (CS-T021)
* [ ] "Other" field (Q49) = free text, no auto-generated documents
* [ ] Married toggle only changes phrasing, no separate spouse sections
* [ ] After Tally build: test submission → verify correct documents generated
* [ ] After Tally build: test bilingual — HE and EN forms produce identical data

## 8. Implementation Notes (Post-Code)

### Session (2026-03-25) — Phases 1–4 Complete

**Phase 1 (SSOT doc):** Created in previous session — `docs/capital-statements-implementation-plan.md` and `docs/cs-ar-equivalence-mapping.md`.

**Phase 2 (Form Spec):** Finalized in DL-182 above — 49 visible fields, 6 hidden, across 9 content pages.

**Phase 3 (Airtable inserts):** ✅ DONE (2026-03-28)
- 22 CS document templates inserted into `documents_templates` (CS-T001..CS-T022)
- 22 CS question mappings inserted into `question_mappings` with HE tally keys
- 8 new categories auto-created via typecast: `business_capital`, `real_estate`, `banking`, `employment`, `insurance_pension`, `investments`, `debts`, `other_assets`
- All records have `filing_type: capital_statement`, `scope: CLIENT`
- EN tally keys (`tally_key_en`) left empty — will populate after EN form duplication

**Phase 4 (Build Tally Forms):** ✅ DONE

| Form | ID | Language | Blocks | Pages | Status |
|------|----|----------|--------|-------|--------|
| HE Capital Statements | `7Roovz` | Hebrew | 144 | 9 | DRAFT |
| EN Capital Statements | `XxEEYV` | English | — | — | DELETED (will duplicate from HE after conditionals) |

Both forms built with Tally MCP. All 49 visible fields + 6 hidden + structure blocks + thank-you page.

**Field keys extracted:** `archive/tally_cs_mapping.csv` — maps all 49 questions to `tally_key_he` and `tally_key_en` (questionUuids), plus `template_ids`, `conditional_on`, and `per_item`.

**Conditional logic:** Tally API/MCP cannot set conditional logic — UI only (confirmed via web research). **User must add manually** in Tally UI: block menu (drag icon) → "Add conditional logic". 22 rules needed per form (same rules in both HE + EN).

**Broken blocks to clean up:** 2 empty CONDITIONAL_LOGIC blocks were accidentally created in HE form (`7Roovz`) during Playwright automation attempt. Delete them manually:
- `01faeba6-b70b-4122-847c-4cfb84f229e7`
- `9e8d94b7-56a6-46a1-8fa2-dee02ffb8aa7`

### Remaining Tasks (next session)

| Task | Description | Owner |
|------|-------------|-------|
| Conditionals | Add 22 show/hide rules to HE form `7Roovz` | User (Tally UI) |
| Conditionals | Add 22 show/hide rules to EN form `XxEEYV` | User (Tally UI) |
| Cleanup | Delete 2 broken CONDITIONAL_LOGIC blocks in HE form | User (Tally UI) |
| ~~Phase 3a~~ | ~~Insert 22 CS document templates into Airtable~~ | ✅ Done 2026-03-28 |
| ~~Phase 3b~~ | ~~Insert ~22 CS question mappings into Airtable~~ | ✅ Done 2026-03-28 |
| Phase 5 | Update `workflow-processor-n8n.js` with CS_KEY_MAP (EN→HE key translation) | Agent — DEFERRED until EN form exists |
| ~~FILING_CONFIG~~ | ~~Update `api/src/routes/submission.ts` with CS form ID~~ | ✅ Done 2026-03-28 (`form_id_he: '7Roovz'`, `form_id_en: ''`) |
| Publish | Publish both forms (currently DRAFT) | User or Agent |
| Test | Submit test questionnaire → verify correct documents generated | Both |

### 22 Conditional Logic Rules

| # | Form Question | Show When | Both forms |
|---|--------------|-----------|------------|
| 1 | Q5 — Spouse name | Q4 = כן / Yes | ✓ |
| 2 | Q7 — Business bank names | Q6 = כן / Yes | ✓ |
| 3 | Q9 — Business credit card company | Q8 = כן / Yes | ✓ |
| 4 | Q11 — Company names (shares) | Q10 = כן / Yes | ✓ |
| 5 | Q13 — Property addresses | Q12 = כן / Yes | ✓ |
| 6 | Q14 — Renovations | Q12 = כן / Yes | ✓ |
| 7 | Q16 — Vacation home details | Q15 = כן / Yes | ✓ |
| 8 | Q18 — Vehicle details | Q17 = כן / Yes | ✓ |
| 9 | Q22 — Mortgage bank | Q21 = כן / Yes | ✓ |
| 10 | Q24 — Lender details | Q23 = כן / Yes | ✓ |
| 11 | Q26 — Employer names | Q25 = כן / Yes | ✓ |
| 12 | Q28 — Pension company | Q27 = כן / Yes | ✓ |
| 13 | Q30 — Study fund company | Q29 = כן / Yes | ✓ |
| 14 | Q32 — Provident fund company | Q31 = כן / Yes | ✓ |
| 15 | Q34 — Life insurance company | Q33 = כן / Yes | ✓ |
| 16 | Q36 — Savings plan company | Q35 = כן / Yes | ✓ |
| 17 | Q38 — Securities institution | Q37 = כן / Yes | ✓ |
| 18 | Q40 — Receivables details | Q39 = כן / Yes | ✓ |
| 19 | Q42 — Payables details | Q41 = כן / Yes | ✓ |
| 20 | Q44 — Cash amount | Q43 = כן / Yes | ✓ |
| 21 | Q46 — Safe contents | Q45 = כן / Yes | ✓ |
| 22 | Q48 — POA account details | Q47 = כן / Yes | ✓ |
