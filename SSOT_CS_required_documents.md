# SSOT — Capital Statements Required Documents Generation

**CRITICAL — AUTHORITATIVE SOURCE**
This document is the SINGLE SOURCE OF TRUTH for ALL "required documents" generation for Capital Statements (הצהרות הון).

Implementation entrypoint:
* `frontend/n8n/ssot-cs-document-generator.js` (TBD)

For AI Agents:
* ALWAYS reference this file when generating CS document titles
* NEVER invent document names — use EXACT templates from Section 2
* Every produced document title MUST be an instance of a template in Section 2
* Only lines starting with `* ` are documents; other lines are presentation

---

## 0) Core Goal

Generate a clean, deterministic list of required documents for a Capital Statement based on:
1. Tally response payload (fields + values)
2. Mapping table in Airtable (`question_mappings` with `filing_type: capital_statement`)
3. Rules in this SSOT

Output requirements:
* Hebrew document titles (Section 2 is authoritative)
* English output for bilingual clients (Section 3)
* Any respondent-provided value embedded in a title MUST be **bold**
* Year values (`{{year}}`, `{{year_plus_1}}`) are NOT bold — plain text only
* No spouse-split sections — CS is for the entire family unit (תא משפחתי)
* "Other assets/liabilities" (Q49) generates NO automatic documents — manual only

---

## 1) Deterministic Rules

### 1.1 Output Structure

Capital Statements use a **single flat list** — no client/spouse split.
All documents are for the family unit together.

If married (Q4 = yes), question phrasing switches to plural but document structure is unchanged.

### 1.2 Normalization & Parsing (MANDATORY)

Same as AR SSOT:
* Split on: newline OR `;` OR `,`
* Trim whitespace per item
* Drop empty items
* Display value remains as provided by respondent, bold if embedded in title

### 1.3 Per-Item Rule

If the respondent provided a list → generate one document per item:
* Business bank names → one bank ID per bank (CS-T001)
* Business credit cards → one statement per card company (CS-T002)
* Company names (shares) → one shareholder report per company (CS-T003)
* Property addresses → one purchase contract per property (CS-T004)
* Property addresses (renovations) → one renovation evidence per property (CS-T005)
* Vacation home details → one contract per vacation home (CS-T006)
* Vehicle details → one registration per vehicle (CS-T007)
* Personal bank names → one bank ID per bank (CS-T008)
* Personal credit cards → one statement per card company (CS-T009)
* Mortgage banks → one balance confirmation per bank (CS-T010)
* Non-bank loans → one balance confirmation per lender (CS-T011)
* Employer names → one pay slip per employer (CS-T012)
* Pension companies → one tax certificate per company (CS-T013)
* Study fund companies → one tax certificate per company (CS-T014)
* Provident fund companies → one tax certificate per company (CS-T015)
* Life insurance companies → one tax certificate per company (CS-T016)
* Savings plan companies → one tax certificate per company (CS-T017)
* Securities institutions → one balance per institution (CS-T018)
* Power of attorney accounts → one bank ID per account (CS-T022)

### 1.4 Bold Rules (MANDATORY)

Dynamic values:
* If a title contains any respondent-provided value, that value MUST be bold.
* Year values (`{{year}}`, `{{year_plus_1}}`) are NOT bold — plain text only.

Always-bold literals:
* The word **מפורטת** MUST always appear bold wherever it appears.

### 1.5 No-Document Fields

These fields do NOT generate automatic documents:
* **Cash at home (Q43-44):** Declaration only — amount recorded but no document required
* **Safe contents (Q45-46):** Generates CS-T021 (evidence of safe existence)
* **Other assets/liabilities (Q49):** Free text — Natan adds documents manually from admin panel

### 1.6 Renovation Documents

Renovation evidence (CS-T005) is only generated when:
* Q12 = yes (owns real estate) AND Q14 = yes (renovations done)
* One CS-T005 per property address from Q13

---

## 2) Hebrew Document Title Templates (AUTHORITATIVE)

### 2.1 Business Capital (הון עסקי)

| Template ID | Title Template |
|-------------|---------------|
| CS-T001 | תעודת זהות בנקאית **מפורטת** לשנת {{year}} מ**{{bank_name}}** (חשבון עסקי) |
| CS-T002 | דף פירוט עסקאות אשראי עבור העסקאות שבוצעו בחודש 12.{{year}} ומועד פירעונם היה בחודש 1.{{year_plus_1}} מ**{{card_company}}** (עסקי) |
| CS-T003 | חו"ז בעל מניות ליום 31.12.{{year}} מ**{{company_name}}** |

### 2.2 Real Estate & Property (נדל"ן ורכוש)

| Template ID | Title Template |
|-------------|---------------|
| CS-T004 | חוזה רכישת הנכס — **{{property_address}}** |
| CS-T005 | אסמכתאות עבור השיפוצים שבוצעו בנכס — **{{property_address}}** |
| CS-T006 | חוזה רכישה + פרטי זכות — דירת נופש **{{vacation_details}}** |
| CS-T007 | רישיון רכב — **{{vehicle_description}}** |

### 2.3 Banking & Credit (בנקאות ואשראי)

| Template ID | Title Template |
|-------------|---------------|
| CS-T008 | ת.ז בנקאית **מפורטת** לשנת {{year}} מ**{{bank_name}}** |
| CS-T009 | דף פירוט עסקאות אשראי עבור העסקאות שבוצעו בחודש 12.{{year}} ומועד פירעונם היה בחודש 1.{{year_plus_1}} מ**{{card_company}}** |
| CS-T010 | אישור יתרת משכנתא ליום 31.12.{{year}} מ**{{bank_name}}** |
| CS-T011 | אישור יתרת הלוואה ליום 31.12.{{year}} מ**{{lender_name}}** |
| CS-T022 | ת.ז בנקאית **מפורטת** — חשבון ייפוי כוח/נאמנות מ**{{bank_name}}** |

### 2.4 Employment (תעסוקה)

| Template ID | Title Template |
|-------------|---------------|
| CS-T012 | תלוש שכר לחודש 12.{{year}} מ**{{employer_name}}** |

### 2.5 Insurance & Pension (ביטוח ופנסיה)

| Template ID | Title Template |
|-------------|---------------|
| CS-T013 | אישור מס להצהרת הון ליום 31.12.{{year}} מ**{{company_name}}** — פנסיה |
| CS-T014 | אישור מס להצהרת הון ליום 31.12.{{year}} מ**{{company_name}}** — קרן השתלמות |
| CS-T015 | אישור מס להצהרת הון ליום 31.12.{{year}} מ**{{company_name}}** — קופת גמל להשקעה |
| CS-T016 | אישור מס להצהרת הון ליום 31.12.{{year}} מ**{{company_name}}** — ביטוח חיים |
| CS-T017 | אישור מס להצהרת הון ליום 31.12.{{year}} מ**{{company_name}}** — תוכנית חסכון |

### 2.6 Investments (השקעות)

| Template ID | Title Template |
|-------------|---------------|
| CS-T018 | אישור יתרת ניירות ערך ליום 31.12.{{year}} מ**{{institution_name}}** |

### 2.7 Debts (חובות)

| Template ID | Title Template |
|-------------|---------------|
| CS-T019 | אסמכתא — חוב כלפי התא המשפחתי (receivable) |
| CS-T020 | אסמכתא — חוב של התא המשפחתי (payable) |

### 2.8 Other Assets (נכסים אחרים)

| Template ID | Title Template |
|-------------|---------------|
| CS-T021 | אסמכתא על קיום כספת |

---

## 3) English Document Title Templates

| Template ID | EN Title Template |
|-------------|------------------|
| CS-T001 | Detailed bank ID for {{year}} from **{{bank_name}}** (business account) |
| CS-T002 | Credit card transactions for 12.{{year}} with repayment in 01.{{year_plus_1}} from **{{card_company}}** (business) |
| CS-T003 | Shareholder balance report as of 31.12.{{year}} from **{{company_name}}** |
| CS-T004 | Property purchase contract — **{{property_address}}** |
| CS-T005 | Renovation evidence for property — **{{property_address}}** |
| CS-T006 | Purchase contract + rights details — vacation home **{{vacation_details}}** |
| CS-T007 | Vehicle registration — **{{vehicle_description}}** |
| CS-T008 | Detailed bank ID for {{year}} from **{{bank_name}}** |
| CS-T009 | Credit card transactions for 12.{{year}} with repayment in 01.{{year_plus_1}} from **{{card_company}}** |
| CS-T010 | Mortgage balance as of 31.12.{{year}} from **{{bank_name}}** |
| CS-T011 | Loan balance as of 31.12.{{year}} from **{{lender_name}}** |
| CS-T012 | Pay slip for 12.{{year}} from **{{employer_name}}** |
| CS-T013 | Tax certificate for capital statement 31.12.{{year}} from **{{company_name}}** — pension |
| CS-T014 | Tax certificate for capital statement 31.12.{{year}} from **{{company_name}}** — study fund |
| CS-T015 | Tax certificate for capital statement 31.12.{{year}} from **{{company_name}}** — provident fund |
| CS-T016 | Tax certificate for capital statement 31.12.{{year}} from **{{company_name}}** — life insurance |
| CS-T017 | Tax certificate for capital statement 31.12.{{year}} from **{{company_name}}** — savings plan |
| CS-T018 | Securities balance as of 31.12.{{year}} from **{{institution_name}}** |
| CS-T019 | Evidence — debt owed to family (receivable) |
| CS-T020 | Evidence — debt owed by family (payable) |
| CS-T021 | Evidence of safe existence |
| CS-T022 | Detailed bank ID — power of attorney account from **{{bank_name}}** |

---

## 4) Variable Reference

| Variable | Source | Used In |
|----------|--------|---------|
| year | Hidden field (from report) | CS-T001–T018, T022 |
| year_plus_1 | Computed: year + 1 | CS-T002, CS-T009 |
| bank_name | Respondent text (per item) | CS-T001, T008, T010, T022 |
| card_company | Respondent text (per item) | CS-T002, T009 |
| company_name | Respondent text (per item) | CS-T003, T013–T017 |
| property_address | Respondent text (per item) | CS-T004, T005 |
| vacation_details | Respondent text (per item) | CS-T006 |
| vehicle_description | Respondent text (per item) | CS-T007 |
| lender_name | Respondent text (per item) | CS-T011 |
| employer_name | Respondent text (per item) | CS-T012 |
| institution_name | Respondent text (per item) | CS-T018 |
