# SSOT — Required Documents Generation (from Tally input + CSV)

⚠️ CRITICAL — AUTHORITATIVE SOURCE ⚠️  
This document is the SINGLE SOURCE OF TRUTH for ALL “required documents” generation.

Do not modify document title templates anywhere else without updating this file first.

Implementation entrypoint:

* `frontend/n8n/ssot-document-generator.js`

Integration status:

* See `SSOT_ALIGNMENT_SUMMARY.md`

For AI Agents:

* ALWAYS reference this file when generating document titles
* NEVER invent document names — use EXACT templates from Section 2
* Every produced document title MUST be an instance of a template in Section 2 (after applying rules below)
* Presentation headers are allowed, but ONLY bullet lines (`* ...`) are documents

---

## 0) Core Goal

Generate a clean, deterministic list of required documents based on:

1. Tally response payload (fields + values)
2. Mapping CSV (requirements + triggers)
3. Firm rules in this SSOT (normalization, dedupe, overrides, formatting)

Output requirements:

* Hebrew document titles (Section 2 is authoritative)
* Split into Client vs Spouse when marital status is “Married”
* Any respondent-provided value embedded inside a title MUST be bold
* No duplicates where dedupe rules apply (especially “ספח ת״ז” and Form 867 per institution)
* Spouse document titles MUST contain spouse name exactly once
* English output is allowed for client-facing emails (Section 4.2), but MUST be generated from this SSOT (no free translation)

---

## 1) Deterministic Rules

### 1.1 Output structure (MUST)

If marital status = “Married” and spouse name exists:

* Section A header: `מסמכים של הלקוח: **{{client_name}}**`
* Section B header: `מסמכים של בן/בת הזוג: **{{spouse_name}}**`

If not married / spouse missing:

* Output only Section A.

Spouse-name invariant:

* Every spouse document title MUST contain **{{spouse_name}}** exactly once.
* If a template would add spouse name twice (due to variables), that template is invalid.

Document lines vs presentation lines:

* Only lines that start with `* ` are considered document titles.
* Any other line (including group labels like “טופסי 106:”) is presentation only and MUST NOT be parsed as a document title.

Template-ID annotation (examples only):

* In Section 4 examples, lines may be prefixed with `(Txxx) ` for readability.
* In real generated output, template IDs MUST NOT appear inside document titles.
* If a validator checks examples, it MUST validate after stripping the optional prefix: `^(\(T\d+\)\s+)`.

---

### 1.2 Normalization & parsing (MANDATORY)

Many “list” inputs arrive as new lines or separated by `;` or `,`.

Split rules:

* Split on: newline OR `;` OR `,`
* Trim whitespace per item
* Drop empty items

Normalized key (for dedupe comparisons only):

* Trim
* Collapse multiple spaces to one
* Remove surrounding quotes (`"` / `״` / `'`)
* For Latin text: normalize case to upper-case (Hebrew unaffected)

Display value:

* The displayed value MUST remain as provided by the respondent, and MUST be bold if embedded in a title.

Boolean normalization (for triggers):

Treat the following as TRUE (case-insensitive for strings):

* `true`, `1`, `yes`, `כן`

Treat the following as FALSE:

* `false`, `0`, `no`, `לא`, empty / missing

---

### 1.3 Dedupe rules (MUST)

Global single-instance documents:

* **T002 (ספח ת״ז מעודכן)** must appear ONLY ONCE in the entire output.
* Multiple triggers may require this document:
  * Marital status change (נישואין/גירושין/התאלמנות/פירוד)
  * New child born or added to family
  * Any other trigger requiring ID appendix verification
* Even if MULTIPLE triggers exist → output ONE document only.
* There is NO separate "child_id_appendix" document type - all consolidate to T002.

Canonical "ספח ת״ז" title (exactly):

* `ספח ת״ז מעודכן`
* EN: `Updated ID appendix`

Form 867 dedupe:

* Deduplicate by normalized institution key.
* If the same institution appears more than once after normalization → only one Form 867 is required.

Withholding dedupe (IMPORTANT: TWO SEPARATE QUESTION PATHS):

There are TWO separate lists and TWO separate document types:

1) Income tax withholding (מס הכנסה)  
2) National Insurance withholding (ביטוח לאומי)

Rules:

* Deduplicate **within each type** by normalized client name key.
* If the same client appears in BOTH types → generate TWO documents (one per type).

Foreign tax return dedupe:

* If multiple countries appear, dedupe by normalized country key (one return document per country).

---

### 1.4 Bold rules (MANDATORY)

Dynamic values:

* If a title contains any respondent-provided value (from Tally), that value MUST be bold.

Always-bold literals:

* The word **מקוצר** MUST always appear bold whenever it appears.
* The word **רלוונטיים** MUST always appear bold whenever it appears.

---

### 1.5 “One per item” rule (textarea/list fields)

If the respondent provided a list → generate one document per item:

* Employers list → one Form 106 per employer
* Securities institutions list → one Form 867 per institution (dedupe identical after normalization)
* Withholding (income tax) client list → one document per client (dedupe within type)
* Withholding (NII) client list → one document per client (dedupe within type)
* Deposit companies list → one deposit certificate per company per deposit-type group
* Crypto sources list → one crypto report per source
* Other incomes list → one supporting document per item
* Foreign income types list → one per income type ONLY when foreign return was NOT filed (see 1.10)
* Survivor details list (client/spouse) → one survivors document per named survivor
* Withdrawal company list → one withdrawal document per company per applicable type (see 1.8)

---

### 1.6 Multi-select rule (one per chosen option)

If the respondent selected multiple options → generate one document per selected option:

* National Insurance allowances (client/spouse)
* Withdrawals types

---

### 1.7 National Insurance override rules (MUST)

Base rule:

* For each selected allowance type, generate one certificate.

Overrides:

* If allowance type is “נכות” ← use the disability override template (ignore generic).
* If allowance type is “דמי לידה” ← use the maternity override template (ignore generic).

Survivors (קצבת שארים):

* If survivors is Yes AND survivor details are provided → generate one document PER survivor name (per_item split on newlines).
* Each survivor name appears in bold in its own document title.
* If survivors is Yes but details are empty → generate one generic survivors document without names.

Child disability:

* If child disability allowance is Yes → generate the child disability document once.

---

### 1.8 Withdrawals rule (MUST)

Three withdrawal types have **company follow-up questions** in Tally:
* משיכת קרן השתלמות
* משיכת קרן פנסיה
* משיכת קופת גמל להשקעה

For these 3 types:
* The client specifies which insurance company/companies the funds were withdrawn from (one per line, multiple allowed).
* Generate one T401 document **per company** with both the withdrawal type AND company name in the title.
* Title format: `אישור משיכה – {type} – {company_name}` (company name in bold).
* The type-only T401 for these 3 types is SUPPRESSED (no duplicate without company).

For the other 2 types (פיצויי פיטורין, מענק פרישה):
* No company follow-up — generate one T401 per type as before.

If “אחר” (Other) exists with free text:
* Generate the T402 “Other” template, and the free text MUST be bold.

---

### 1.9 Deposits rule (MUST)

Generate one deposit document per company and per deposit group.

Deposit title MUST include bold:

* **{{deposit_type}}**
* **"{{company_name}}"**
* **מקוצר** (always, wherever it appears)

Required exact wording:

* Must include: `(נקרא גם דוח שנתי **מקוצר**)`
* Must include: `על ההפקדות`
* Company name appears in quotes

---

### 1.10 Foreign income logic — FINAL RULE (THIS IS THE LAW)

Trigger:

* Only if `foreign_income_not_reported_in_business == Yes`

Decision (binary, deterministic):

* If `foreign_return_filed_in_country == Yes` → require ONLY the foreign tax return document (one per country; deduped).
* Else (No / missing) → require ONLY evidence documents, one per income type item (per country × per income type).

No other foreign-income documents are generated.

---

### 1.11 CSV mapping integration (MUST)

This SSOT defines:

* How to format document titles (templates)
* How to normalize, dedupe, bold, split by spouse
* How overrides work

The CSV defines:

* Which templates are required given specific Tally triggers

Minimum CSV row requirements (conceptual; your actual CSV may have more columns):

* `template_id` (must exist in Section 2)
* `scope` = `CLIENT` | `SPOUSE` | `PERSON` | `GLOBAL_SINGLE`
* `trigger_key`
* `trigger_operator` (e.g., equals / contains / is_true)
* `trigger_value`
* Optional `list_source_key` (when a template is one-per-item)
* Optional `variable_map` (mapping from canonical fact keys to template variables)

Scope meanings:

* `CLIENT` → belongs to client section
* `SPOUSE` → belongs to spouse section (must include spouse name exactly once)
* `PERSON` → same template can target client or spouse by setting `person_name` = client_name/spouse_name
* `GLOBAL_SINGLE` → appears once in entire output (e.g., T002)

Hard constraint:

* Generator MUST refuse (or hard-fail) any CSV row referencing a `template_id` not in Section 2.

---

## 2) Hebrew Document Title Templates (AUTHORITATIVE)

Formatting conventions:

* Variables are written as `{{var}}` here for readability.
* In actual output, variable values must be bold (per rules).
* Spouse templates MUST include `{{spouse_name}}` exactly once.

### 2.1 General / ID / Residency

| Template ID | Scope                | Title Template                                                                                   |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| T001        | CLIENT               | אישור תושבות לשנת **{{year}}** – **{{city_name}}**                                               |
| T002        | GLOBAL_SINGLE        | ספח ת״ז מעודכן                                                                                   |
| T003        | CLIENT               | מסמכי שינוי סטטוס משפחתי בשנת **{{year}}** – **{{client_name}}** – **{{status_change_details}}** |

Notes:

* T002 must appear once בלבד בכל הפלט (ראה 1.3).

---

### 2.2 Children

| Template ID | Scope  | Title Template                                                            |
| ----------- | ------ | ------------------------------------------------------------------------- |
| T101        | CLIENT | אישור ועדת השמה/ועדת שילוב (חינוך מיוחד)                                  |
| T102        | CLIENT | אישור שנתי לשנת **{{year}}** על תקבולי קצבת נכות מביטוח לאומי עבור הילד/ה |

---

### 2.3 Employment (Form 106)

| Template ID | Scope  | Title Template                                                           |
| ----------- | ------ | ------------------------------------------------------------------------ |
| T201        | CLIENT | טופס 106 לשנת **{{year}}** – **{{employer_name}}**                       |
| T202        | SPOUSE | טופס 106 לשנת **{{year}}** – **{{spouse_name}}** – **{{employer_name}}** |

---

### 2.4 National Insurance (one per type)

Generic (when not overridden):

| Template ID | Scope  | Title Template                                                                                        |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------- |
| T301        | CLIENT | אישור שנתי לשנת **{{year}}** על תקבולי **{{allowance_type}}** מביטוח לאומי עבור - **{{client_name}}** |
| T302        | SPOUSE | אישור שנתי לשנת **{{year}}** על תקבולי **{{allowance_type}}** מביטוח לאומי עבור - **{{spouse_name}}** |

Overrides:

| Template ID | Scope  | Title Template                                                                                  |
| ----------- | ------ | ----------------------------------------------------------------------------------------------- |
| T303        | PERSON | אישור שנתי לשנת **{{year}}** על תקבולי דמי נכות שהתקבלו מביטוח לאומי עבור - **{{person_name}}** |
| T304        | PERSON | אישור שנתי לשנת **{{year}}** על תקבולי דמי לידה מביטוח לאומי עבור - **{{person_name}}**         |

Survivors:

| Template ID | Scope  | Title Template                                                                                                     |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| T305        | CLIENT | אישור שנתי לשנת {{year}} על תקבולי **קצבת שארים** מביטוח לאומי – **{{survivor_details}}**. אם הקצבה מתקבלת מחברת ביטוח – יש לצרף טופס 106 מחברת הביטוח. |
| T306        | SPOUSE | אישור שנתי לשנת {{year}} על תקבולי **קצבת שארים** מביטוח לאומי – **{{spouse_name}}** – **{{survivor_details}}**. אם הקצבה מתקבלת מחברת ביטוח – יש לצרף טופס 106 מחברת הביטוח. |

---

### 2.5 Withdrawals (one per withdrawal type, per company when applicable)

| Template ID | Scope  | Title Template                                                                |
| ----------- | ------ | ----------------------------------------------------------------------------- |
| T401        | CLIENT | אישור משיכה לשנת **{{year}}** + מס שנוכה – **{{withdrawal_type}}**            |
| T402        | CLIENT | אישור משיכה לשנת **{{year}}** + מס שנוכה – **אחר: {{withdrawal_other_text}}** |

Notes:

* For 3 types with company follow-ups (קרן השתלמות, קרן פנסיה, קופת גמל להשקעה), `{{withdrawal_type}}` includes both type and company: e.g., `קרן השתלמות – **מגדל**`.
* For types without company follow-ups (פיצויי פיטורין, מענק פרישה), `{{withdrawal_type}}` is just the type name.
* See rule 1.8 for full logic.

---

### 2.6 Deposits (one per company per deposit group)

| Template ID | Scope  | Title Template                                                                                                                           |
| ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| T501        | CLIENT | אישור שנתי למס הכנסה לשנת **{{year}}** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**{{deposit_type}}** ב**"{{company_name}}"** |

---

### 2.7 Securities (Form 867)

| Template ID | Scope  | Title Template                                        |
| ----------- | ------ | ----------------------------------------------------- |
| T601        | CLIENT | טופס 867 (אישור ניכוי מס) לשנת **{{year}}** – **{{institution_name}}** |

---

### 2.8 Crypto

| Template ID | Scope  | Title Template                                                                            |
| ----------- | ------ | ----------------------------------------------------------------------------------------- |
| T701        | CLIENT | דוח על הרווחים / הפסדים והמס שנוכה (במידה ונוכה) לשנת **{{year}}** מ**{{crypto_source}}** |

---

### 2.9 Gambling / prizes

| Template ID | Scope  | Title Template                                                     |
| ----------- | ------ | ------------------------------------------------------------------ |
| T801        | CLIENT | אישור על זכייה בפרס והמס שנוכה – **{{gambling_source}}**           |

---

### 2.10 Rent

| Template ID | Scope  | Title Template                                          |
| ----------- | ------ | ------------------------------------------------------- |
| T901        | CLIENT | חוזה שכירות – דירה מושכרת (הכנסה)                        |
| T902        | CLIENT | חוזה שכירות – דירה שכורה למגורים (הוצאה)                |

Notes:

* Rent amount fields were removed from the questionnaire. Documents are triggered by yes/no questions only.
* Templates no longer include amount variables.

---

### 2.11 Inventory

| Template ID | Scope  | Title Template                           |
| ----------- | ------ | ---------------------------------------- |
| T1001       | CLIENT | רשימת ספירת מלאי ליום 31.12.**{{year}}** |

---

### 2.12 Withholding at source (TWO separate document types)

| Template ID | Scope  | Title Template                                                          |
| ----------- | ------ | ----------------------------------------------------------------------- |
| T1101       | CLIENT | אישור ניכוי מס הכנסה במקור (טופס 857/856) – **{{withholding_client_name}}**    |
| T1102       | CLIENT | אישור ניכוי ביטוח לאומי במקור (טופס 806/857) – **{{withholding_client_name}}** |

Rules:

* Deduplicate within each type (see 1.3).
* If a client appears in both lists → request both documents.

---

### 2.13 Donations

| Template ID | Scope  | Title Template                                                                                                            |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| T1201       | CLIENT | קבלות מקוריות מרוכזות על תרומות לפי סעיף 46 (מעל 200₪) (יש לשלוח קבלות רק ממוסדות שלהם יש סעיף 46. ניתן לראות זאת בקבלה.) |

---

### 2.14 Army release

| Template ID | Scope  | Title Template                                                                |
| ----------- | ------ | ----------------------------------------------------------------------------- |
| T1301       | CLIENT | תעודת שחרור משירות צבאי/לאומי (ניתן להוציא אישור זה מאתר ״אישורים״)          |

---

### 2.15 Memorial / institution support / medical

| Template ID | Scope  | Title Template                                                             |
| ----------- | ------ | -------------------------------------------------------------------------- |
| T1401       | CLIENT | קבלות ומסמכים **רלוונטיים** על הוצאות הנצחה – **{{relationship_details}}** |
| T1402       | CLIENT | מסמך רשמי (קרוב במוסד)                                                    |
| T1403       | CLIENT | מסמך רפואי רשמי לעניין פטור/הקלות במס – **{{medical_details}}**            |

---

### 2.16 Degree

| Template ID | Scope  | Title Template                                                         |
| ----------- | ------ | ---------------------------------------------------------------------- |
| T1501       | CLIENT | אישור זכאות לתואר **{{degree_type}}** מ-**{{university_name}}**        |

---

### 2.17 Foreign income

| Template ID | Scope  | Title Template                                                                  |
| ----------- | ------ | ------------------------------------------------------------------------------- |
| T1601       | CLIENT | אסמכתאות להכנסות מחו״ל + מס ששולם בחו״ל – **{{country}}** – **{{income_type}}** |
| T1602       | CLIENT | דו״ח שנתי לשנת **{{year}}** כפי שהוגש לרשויות המס – **{{country}}**             |

---

### 2.18 Other incomes (free text)

| Template ID | Scope  | Title Template                                     |
| ----------- | ------ | -------------------------------------------------- |
| T1701       | CLIENT | מסמך תומך להכנסה נוספת – **{{other_income_text}}** |

---

## 3) Example Input Dataset (SSOT-relevant fields)

Identifiers:

* report_record_id: reci3TDgN6R42hhTl
* client_id: CPA-XXX
* year: 2025
* questionnaire_token: 1234
* client_name: לוי יצחק
* spouse_name: משה

Key facts:

* marital_status: Married
* eligible_locality: Yes
* city_name: כרמיאל
* marital_status_changed: Yes
* status_change_details: 1.1.11
* special_education_children: Yes
* child_disability_allowance: Yes
* client_employed: Yes
* client_employers: קפה גרג 1 ; קפה קפה 2
* spouse_employed: Yes
* spouse_employers: INTEL ; MICROSOFT
* withdrawals: Yes
* withdrawal_types: פיצויי פיטורין ; מענק פרישה ; משיכת קרן השתלמות ; משיכת קרן פנסיה ; משיכת קופת גמל להשקעה ; אחר
* withdrawal_other_text: משיכת כספים אחרת
* withdrawal_study_fund_companies: מגדל ; הראל
* withdrawal_pension_companies: כלל ; מנורה
* withdrawal_provident_companies: הפניקס
* client_nii_disability: Yes
* client_survivors: Yes
* client_survivor_details: קצבת שארים שלי 1 ; קצבת שארים שלי 2
* spouse_nii_allowances: נכות ; אבטלה ; מילואים ; דמי לידה ; פגיעה בעבודה ; אחר
* spouse_survivors: Yes
* spouse_survivor_details: קצבת שארים של בן זוג 1 ; קצבת שארים של בן זוג 2
* securities: Yes
* securities_institutions: מוסד ניירות ערך ; מוסד ניירות ערך 2
* crypto_sold: Yes
* crypto_sources: מטבע וירטואלי 1 ; מטבע וירטואלי 2
* gambling_prizes: Yes
* gambling_source: הכנסות לוטו
* foreign_income_not_reported_in_business: Yes
* foreign_country: ארהב
* foreign_income_types: עסק ; משכורת
* foreign_return_filed_in_country: Yes
* rent_income: Yes
* rent_expense: Yes
* inventory: Yes
* deposits_pension: Yes
* deposits_pension_companies: הפקדה עצמאית קרן פנסיה 1 ; הפקדה עצמאית קרן פנסיה 2
* deposits_hishtalmut: Yes
* deposits_hishtalmut_companies: הפקדה עצמאית קרן השתלמות 1 ; הפקדה עצמאית קרן השתלמות 2
* deposits_work_disability: Yes
* deposits_work_disability_companies: הפקדה עצמאית אובדן כושר עבודה 1 ; הפקדה עצמאית אובדן כושר עבודה 2
* deposits_life_insurance: Yes
* deposits_life_insurance_companies: הפקדה עצמאית ביטוח חיים 1 ; הפקדה עצמאית ביטוח חיים 2
* army_release_recent: Yes
* memorial_expenses: Yes
* relationship_details: קרבה קרבה
* supported_relative_in_institution: Yes
* health_change_tax_relief: Yes
* medical_details: שינוי במצב בריאותי
* degree_recent: Yes
* degree_type: הנדסת מערכות מידע
* university_name: בן גוריון
* donations_missing_receipts: Yes
* withholding_income_tax: Yes
* withholding_income_tax_clients: לקוח מנכה מס 1 ; לקוח מנכה מס 2
* withholding_nii: Yes
* withholding_nii_clients: לקוח מנכה בטל 1 ; לקוח מנכה בטל 2
* other_incomes: Yes
* other_income_items: הכנסה נוספת 1 ; הכנסה נוספת 2

---

## 4) Expected Output (MUST match Section 2 templates)

NOTE: The `(Txxx)` prefixes are documentation-only (see 1.1). Real output must NOT include them.

### מסמכים של הלקוח: **לוי יצחק**

מסמכי בסיס:

* (T001) אישור תושבות לשנת **2025** – **כרמיאל**
* (T002) ספח ת״ז מעודכן
* (T003) מסמכי שינוי סטטוס משפחתי בשנת **2025** – **לוי יצחק** – **1.1.11**

ילדים:

* (T101) אישור ועדת השמה/ועדת שילוב (חינוך מיוחד)
* (T102) אישור שנתי לשנת **2025** על תקבולי קצבת נכות מביטוח לאומי עבור הילד/ה

טופסי 106 (אחד לכל מעסיק):

* (T201) טופס 106 לשנת **2025** – **קפה גרג 1**
* (T201) טופס 106 לשנת **2025** – **קפה קפה 2**

משיכות (מסמך לכל סוג; עם חברה לכל סוג רלוונטי):

* (T401) אישור משיכה לשנת **2025** + מס שנוכה – **פיצויי פיטורין**
* (T401) אישור משיכה לשנת **2025** + מס שנוכה – **מענק פרישה**
* (T401) אישור משיכה לשנת **2025** + מס שנוכה – **קרן השתלמות** – **מגדל**
* (T401) אישור משיכה לשנת **2025** + מס שנוכה – **קרן השתלמות** – **הראל**
* (T401) אישור משיכה לשנת **2025** + מס שנוכה – **קרן פנסיה** – **כלל**
* (T401) אישור משיכה לשנת **2025** + מס שנוכה – **קרן פנסיה** – **מנורה**
* (T401) אישור משיכה לשנת **2025** + מס שנוכה – **קופת גמל להשקעה** – **הפניקס**
* (T402) אישור משיכה לשנת **2025** + מס שנוכה – **אחר: משיכת כספים אחרת**

ביטוח לאומי:

* (T303) אישור שנתי לשנת **2025** על תקבולי דמי נכות שהתקבלו מביטוח לאומי עבור - **לוי יצחק**
* (T305) אישור שנתי לשנת **2025** על תקבולי **קצבת שארים** מביטוח לאומי. אם הקצבה מתקבלת מחברת ביטוח – יש לצרף טופס 106 מחברת הביטוח.

ניירות ערך:

* (T601) טופס 867 (אישור ניכוי מס) לשנת **2025** – **מוסד ניירות ערך**
* (T601) טופס 867 (אישור ניכוי מס) לשנת **2025** – **מוסד ניירות ערך 2**

קריפטו:

* (T701) דוח על הרווחים / הפסדים והמס שנוכה (במידה ונוכה) לשנת **2025** מ**מטבע וירטואלי 1**
* (T701) דוח על הרווחים / הפסדים והמס שנוכה (במידה ונוכה) לשנת **2025** מ**מטבע וירטואלי 2**

הימורים/פרסים:

* (T801) אישור על זכייה בפרס והמס שנוכה – **הכנסות לוטו**

חו״ל (לפי כלל 1.10 — הוגש דו״ח במדינה ⇒ מבקשים רק את הדו״ח):

* (T1602) דו״ח שנתי לשנת **2025** כפי שהוגש לרשויות המס – **ארהב**

שכירות:

* (T901) חוזה שכירות – דירה מושכרת (הכנסה)
* (T902) חוזה שכירות – דירה שכורה למגורים (הוצאה)

מלאי:

* (T1001) רשימת ספירת מלאי ליום 31.12.**2025**

הפקדות (מסמך לכל חברה בכל קבוצת הפקדה):

* (T501) אישור שנתי למס הכנסה לשנת **2025** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**קרן פנסיה** ב**"הפקדה עצמאית קרן פנסיה 1"**
* (T501) אישור שנתי למס הכנסה לשנת **2025** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**קרן פנסיה** ב**"הפקדה עצמאית קרן פנסיה 2"**
* (T501) אישור שנתי למס הכנסה לשנת **2025** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**קרן השתלמות** ב**"הפקדה עצמאית קרן השתלמות 1"**
* (T501) אישור שנתי למס הכנסה לשנת **2025** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**קרן השתלמות** ב**"הפקדה עצמאית קרן השתלמות 2"**
* (T501) אישור שנתי למס הכנסה לשנת **2025** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**אובדן כושר עבודה** ב**"הפקדה עצמאית אובדן כושר עבודה 1"**
* (T501) אישור שנתי למס הכנסה לשנת **2025** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**אובדן כושר עבודה** ב**"הפקדה עצמאית אובדן כושר עבודה 2"**
* (T501) אישור שנתי למס הכנסה לשנת **2025** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**ביטוח חיים** ב**"הפקדה עצמאית ביטוח חיים 1"**
* (T501) אישור שנתי למס הכנסה לשנת **2025** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**ביטוח חיים** ב**"הפקדה עצמאית ביטוח חיים 2"**

צבא:

* (T1301) תעודת שחרור משירות צבאי/לאומי (ניתן להוציא אישור זה מאתר ״אישורים״)

הנצחה / מוסד / רפואי:

* (T1401) קבלות ומסמכים **רלוונטיים** על הוצאות הנצחה – **קרבה קרבה**
* (T1402) מסמך רשמי (קרוב במוסד)
* (T1403) מסמך רפואי רשמי לעניין פטור/הקלות במס – **שינוי במצב בריאותי**

תואר:

* (T1501) אישור זכאות לתואר **הנדסת מערכות מידע** מ-**בן גוריון**

תרומות:

* (T1201) קבלות מקוריות מרוכזות על תרומות לפי סעיף 46 (מעל 200₪) (יש לשלוח קבלות רק ממוסדות שלהם יש סעיף 46. ניתן לראות זאת בקבלה.)

ניכוי במקור (שני סוגי מסמכים נפרדים — לפי שתי שאלות נפרדות):

* (T1101) אישור ניכוי מס הכנסה במקור (טופס 857/856) – **לקוח מנכה מס 1**
* (T1101) אישור ניכוי מס הכנסה במקור (טופס 857/856) – **לקוח מנכה מס 2**
* (T1102) אישור ניכוי ביטוח לאומי במקור (טופס 806/857) – **לקוח מנכה בטל 1**
* (T1102) אישור ניכוי ביטוח לאומי במקור (טופס 806/857) – **לקוח מנכה בטל 2**

הכנסות נוספות:

* (T1701) מסמך תומך להכנסה נוספת – **הכנסה נוספת 1**
* (T1701) מסמך תומך להכנסה נוספת – **הכנסה נוספת 2**

---

### מסמכים של בן/בת הזוג: **משה**

טופסי 106 (אחד לכל מעסיק):

* (T202) טופס 106 לשנת **2025** – **משה** – **INTEL**
* (T202) טופס 106 לשנת **2025** – **משה** – **MICROSOFT**

ביטוח לאומי (מסמך לכל סוג שנבחר; overrides לנכות/דמי לידה):

* (T303) אישור שנתי לשנת **2025** על תקבולי דמי נכות שהתקבלו מביטוח לאומי עבור - **משה**
* (T302) אישור שנתי לשנת **2025** על תקבולי **אבטלה** מביטוח לאומי עבור - **משה**
* (T302) אישור שנתי לשנת **2025** על תקבולי **מילואים** מביטוח לאומי עבור - **משה**
* (T304) אישור שנתי לשנת **2025** על תקבולי דמי לידה מביטוח לאומי עבור - **משה**
* (T302) אישור שנתי לשנת **2025** על תקבולי **פגיעה בעבודה** מביטוח לאומי עבור - **משה**
* (T302) אישור שנתי לשנת **2025** על תקבולי **אחר** מביטוח לאומי עבור - **משה**

קצבת שארים:

* (T306) אישור שנתי לשנת **2025** על תקבולי **קצבת שארים** מביטוח לאומי – **משה**. אם הקצבה מתקבלת מחברת ביטוח – יש לצרף טופס 106 מחברת הביטוח.

---

## 4.2) Expected Output — English (client-facing email, presentation-only)

Purpose:

* This section is for clients who answered the questionnaire in English and will receive the required-documents email in English.
* Office staff output remains Hebrew (Section 4).

Rules:

* The English list MUST represent the SAME document set as the Hebrew list (same triggers, same split, same dedupe).
* Do NOT free-translate document names. Use the approved English renderings below.

NOTE: The `(Txxx)` prefixes are documentation-only (see 1.1). Real output must NOT include them.

### Client documents: **לוי יצחק**

Base documents:

* (T001) Residency certificate for **2025** — **כרמיאל**
* (T002) Updated ID appendix
* (T003) Marital status change documents in **2025** — **לוי יצחק** — **1.1.11**

Children:

* (T101) Special education placement / inclusion committee approval
* (T102) Annual certificate for **2025** for child disability allowance receipts from National Insurance (Bituach Leumi) — for the child

Form 106 (one per employer):

* (T201) Form 106 for **2025** — **קפה גרג 1**
* (T201) Form 106 for **2025** — **קפה קפה 2**

Withdrawals (one per type; with company for applicable types):

* (T401) Withdrawal certificate for **2025** + tax withheld — **פיצויי פיטורין**
* (T401) Withdrawal certificate for **2025** + tax withheld — **מענק פרישה**
* (T401) Withdrawal certificate for **2025** + tax withheld — **Study Fund** — **מגדל**
* (T401) Withdrawal certificate for **2025** + tax withheld — **Study Fund** — **הראל**
* (T401) Withdrawal certificate for **2025** + tax withheld — **Pension Fund** — **כלל**
* (T401) Withdrawal certificate for **2025** + tax withheld — **Pension Fund** — **מנורה**
* (T401) Withdrawal certificate for **2025** + tax withheld — **Investment Provident Fund** — **הפניקס**
* (T402) Withdrawal certificate for **2025** + tax withheld — **Other: משיכת כספים אחרת**

National Insurance:

* (T303) Annual certificate for **2025** for disability payments received from National Insurance — for **לוי יצחק**
* (T305) Annual certificate for **2025** for **survivors allowance** from National Insurance. If the allowance is received from an insurance company – attach Form 106 from the insurance company.

Securities:

* (T601) Form 867 (Tax Deduction Certificate) for **2025** — **מוסד ניירות ערך**
* (T601) Form 867 (Tax Deduction Certificate) for **2025** — **מוסד ניירות ערך 2**

Crypto:

* (T701) Gains/losses report and tax withheld (if withheld) for **2025** from **מטבע וירטואלי 1**
* (T701) Gains/losses report and tax withheld (if withheld) for **2025** from **מטבע וירטואלי 2**

Gambling / prizes:

* (T801) Prize winning certificate and tax withheld — **הכנסות לוטו**

Foreign income (rule 1.10 — return filed ⇒ request only the return):

* (T1602) Annual tax return for **2025** as filed with the tax authorities — **ארהב**

Rent:

* (T901) Rental contract – rented-out apartment (income)
* (T902) Rental contract — rented apartment for residence (expense)

Inventory:

* (T1001) Inventory count list as of 31.12.**2025**

Deposits (one document per company per deposit group):

* (T501) Annual income tax certificate for **2025** (also called an annual **concise** report) for contributions to **קרן פנסיה** at **"הפקדה עצמאית קרן פנסיה 1"**
* (T501) Annual income tax certificate for **2025** (also called an annual **concise** report) for contributions to **קרן פנסיה** at **"הפקדה עצמאית קרן פנסיה 2"**
* (T501) Annual income tax certificate for **2025** (also called an annual **concise** report) for contributions to **קרן השתלמות** at **"הפקדה עצמאית קרן השתלמות 1"**
* (T501) Annual income tax certificate for **2025** (also called an annual **concise** report) for contributions to **קרן השתלמות** at **"הפקדה עצמאית קרן השתלמות 2"**
* (T501) Annual income tax certificate for **2025** (also called an annual **concise** report) for contributions to **אובדן כושר עבודה** at **"הפקדה עצמאית אובדן כושר עבודה 1"**
* (T501) Annual income tax certificate for **2025** (also called an annual **concise** report) for contributions to **אובדן כושר עבודה** at **"הפקדה עצמאית אובדן כושר עבודה 2"**
* (T501) Annual income tax certificate for **2025** (also called an annual **concise** report) for contributions to **ביטוח חיים** at **"הפקדה עצמאית ביטוח חיים 1"**
* (T501) Annual income tax certificate for **2025** (also called an annual **concise** report) for contributions to **ביטוח חיים** at **"הפקדה עצמאית ביטוח חיים 2"**

Army:

* (T1301) Military/national service discharge certificate (can be obtained from the “Ishurim” website)

Memorial / institution / medical:

* (T1401) Receipts and **relevant** documents for memorial expenses — **קרבה קרבה**
* (T1402) Official document (relative in an institution)
* (T1403) Official medical document for tax exemption/relief — **שינוי במצב בריאותי**

Degree:

* (T1501) Eligibility certificate for **הנדסת מערכות מידע** degree from **בן גוריון**

Donations:

* (T1201) Consolidated original donation receipts under section 46 (over ₪200) (send receipts only from eligible section-46 institutions; see the receipt)

Withholding at source (two separate doc types):

* (T1101) Income tax withholding at source certificate (form 857/856) — **לקוח מנכה מס 1**
* (T1101) Income tax withholding at source certificate (form 857/856) — **לקוח מנכה מס 2**
* (T1102) National Insurance withholding at source certificate (form 806/857) — **לקוח מנכה בטל 1**
* (T1102) National Insurance withholding at source certificate (form 806/857) — **לקוח מנכה בטל 2**

Other incomes:

* (T1701) Supporting document for additional income — **הכנסה נוספת 1**
* (T1701) Supporting document for additional income — **הכנסה נוספת 2**

---

### Spouse documents: **משה**

Form 106 (one per employer):

* (T202) Form 106 for **2025** — **משה** — **INTEL**
* (T202) Form 106 for **2025** — **משה** — **MICROSOFT**

National Insurance (one per selected type; overrides for disability/maternity):

* (T303) Annual certificate for **2025** for disability payments received from National Insurance — for **משה**
* (T302) Annual certificate for **2025** for **אבטלה** from National Insurance — for **משה**
* (T302) Annual certificate for **2025** for **מילואים** from National Insurance — for **משה**
* (T304) Annual certificate for **2025** for maternity payments from National Insurance — for **משה**
* (T302) Annual certificate for **2025** for **פגיעה בעבודה** from National Insurance — for **משה**
* (T302) Annual certificate for **2025** for **אחר** from National Insurance — for **משה**

Survivors allowance:

* (T306) Annual certificate for **2025** for **survivors allowance** from National Insurance — **משה**. If the allowance is received from an insurance company – attach Form 106 from the insurance company.

---

## 5) Agent Implementation Checklist (fast sanity)

Generator MUST:

* Validate every produced document title is an instance of a Section 2 template
* Apply list splitting rules (newline/;/,) and trimming
* Apply dedupe rules:

  * T002 global single
  * T601 per normalized institution
  * T1602 per normalized country
  * T1101 within income-tax list only
  * T1102 within NII list only

* Apply bold rules for all respondent-provided values + always-bold **מקוצר**, **רלוונטיים**
* Enforce spouse-name invariant (exactly once per spouse doc title)
* Enforce foreign income binary rule (Section 1.10)

---

## Appendix: Foreign income decision logic (English-only pseudocode)

```text
if foreign_income_not_reported_in_business != "Yes":
  return []

countries = split_list(foreign_country)
income_types = split_list(foreign_income_types)

if foreign_return_filed_in_country == "Yes":
  docs = []
  for c in countries:
    docs.append(Template.T1602(country=c))
  return dedupe_by_normalized_key(docs, key="country")

# No (or missing) return filed
docs = []
for c in countries:
  for t in income_types:
    docs.append(Template.T1601(country=c, income_type=t))
return docs
```
