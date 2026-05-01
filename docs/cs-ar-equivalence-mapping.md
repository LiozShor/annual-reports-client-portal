# Capital Statements (CS) vs Annual Reports (AR) — Questionnaire & Document Equivalence

**Date:** 2026-03-25
**Source:** imkforms questionnaire (zform_95041574259712) + Natan's mapping email
**Purpose:** Map CS questionnaire fields to AR equivalents to plan Tally form + SSOT document generation

---

## 1. CS Questionnaire Fields (from imkforms)

The CS questionnaire has **2 sections** and **~22 questions**:

### Section A: הון המושקע בעסקים (Business Capital)

| # | CS Question | Type | Follow-up |
|---|------------|------|-----------|
| 1 | שם פרטי ומשפחה | Text (required) | — |
| 2 | חשבון בנק עסקי ביום 31.12.2024? | Yes/No (required) | If yes: שם הבנק |
| 3 | כרטיסי אשראי חוץ-בנקאיים בחשבון עסקי? | Yes/No (required) | If yes: מספר כרטיסים |
| 4 | בעלי מניות בחברה ביום 31.12.2024? | Yes/No (required) | If yes: שמות החברות |

### Section B: רכוש והתחייבויות פרטיים (Private Assets & Liabilities)

| # | CS Question | Type | Follow-up |
|---|------------|------|-----------|
| 5 | נכסי מקרקעין בבעלותכם? | Yes/No (required) | If yes: כתובות הנכסים |
| 6 | שיפוצים/תוספות בנכסים? | Yes/No | — |
| 7 | זכויות בדירות נופש בארץ/חו"ל? | Yes/No (required) | If yes: תיאור, מיקום, תאריך רכישה, עלות |
| 8 | כלי רכב/טייס/שייט בבעלות? | Yes/No (required) | If yes: סוג, תאריך רכישה, עלות |
| 9 | חשבונות בנק של התא המשפחתי (ארץ+חו"ל) | Text (required) | List all banks |
| 10 | כרטיסי אשראי חוץ-בנקאיים פרטיים | Text | מספר + שמות |
| 11 | משכנתא ביום 31.12.2024? | Yes/No (required) | If yes: מאיזה בנק |
| 12 | הלוואות חוץ-בנקאיות? | Text | פרטים |
| 13 | שכירים בדצמבר 2024? | Yes/No (required) | If yes: מקומות עבודה |
| 14 | קופות גמל/ביטוחי חיים/קרנות השתלמות/ני"ע בחברות ביטוח | Text | שם מבטח/בנק + סוג קופה |
| 15 | גורמים חיצוניים חייבים לכם כסף? (receivables) | Yes/No | If yes: שמות, תאריכים, סכומים |
| 16 | חייבים כספים לגורמים חיצוניים? (payables) | Yes/No (required) | If yes: שמות, תאריכים, סכומים |
| 17 | ניירות ערך סחירים/קרנות נאמנות? | Text | שם בנק/מוסד |
| 18 | מזומנים בבית מעל 5,000 ש"ח? | Yes/No | — |
| 19 | כספת? | Text | תכולה ושווי |
| 20 | מיפה כוח/אפוטרופוס/נאמן על חשבונות לא שלכם? | Yes/No (required) | If yes: פרטי החשבונות |
| 21 | נכסים/התחייבויות אחרים? | Text | פרטים חופשיים |

---

## 2. Document Mapping (from Natan's email)

Each CS question triggers specific required documents. Extracted from Natan's mapping:

| CS Question | Required Document(s) | Document Title Template |
|-------------|----------------------|------------------------|
| Business bank account | 1 per bank | תעודת זהות בנקאית *מפורטת* לשנת {{year}} מ**{{bank_name}}** |
| Business credit cards | 1 per card | דף פירוט עסקאות אשראי עבור העסקאות שבוצעו בחודש 12.{{year}} ומועד פירעונם היה בחודש 1.{{year+1}} מ**{{card_company}}** |
| Shares in companies | 1 per company | חו"ז בעל מניות ליום 31.12.{{year}} מ**{{company_name}}** |
| Real estate | 1 per property | חוזה רכישת הנכס — **{{property_address}}** |
| Renovations | Evidence per property | אסמכתאות עבור השיפוצים שבוצעו בנכס |
| Vacation homes | Contract + description | חוזה רכישת הנכס + פרטי הזכות |
| Vehicles | 1 per vehicle | רישיון רכב — **{{vehicle_description}}** |
| Bank accounts (personal) | 1 per bank | ת.ז בנקאית *מפורטת* לשנת {{year}} מ**{{bank_name}}** |
| Personal credit cards | 1 per card | דף פירוט עסקאות אשראי עבור העסקאות שבוצעו בחודש 12.{{year}} ומועד פירעונם היה בחודש 1.{{year+1}} מ**{{card_company}}** |
| Mortgage | 1 per bank | אישור יתרת משכנתא ליום 31.12.{{year}} מ**{{bank_name}}** |
| Non-bank loans | 1 per lender | אישור יתרת הלוואה ליום 31.12.{{year}} מ**{{lender_name}}** |
| Employment (Dec) | 1 per employer | תלוש שכר לחודש 12.{{year}} מ**{{employer_name}}** |
| Insurance/pension/savings | 1 per insurer | אישור מס להצהרת הון ליום 31.12.{{year}} מ**{{insurer_name}}** |
| Receivables (owed TO you) | Evidence per debtor | שמות המלווים, תאריך יצירת החוב, תאריך פירעון, סכום + אסמכתא |
| Payables (you OWE) | Evidence per creditor | שמות המלווים, תאריך יצירת החוב, תאריך פירעון, סכום + אסמכתא |
| Securities | 1 per institution | אישור יתרת ניירות ערך ליום 31.12.{{year}} מ**{{institution_name}}** |
| Cash at home | Declare amount | ציון סכום המזומנים |
| Safe | Declare contents | ציון תכולת הכספת ושוויה |
| Power of attorney accounts | 1 per account | ת.ז בנקאית מפורטת לשנת {{year}} מהבנק |
| Other assets/liabilities | Free text | (manual — Natan will request docs case by case) |

---

## 3. Equivalence Matrix: CS ↔ AR

### 3.1 Questions that EXIST in both AR and CS

| Topic | AR Tally Question | CS imkforms Question | Same Logic? | Notes |
|-------|-------------------|---------------------|-------------|-------|
| **Employment** | שכיר? → מקומות עבודה | שכירים בדצמבר? → מקומות עבודה | SIMILAR | AR asks for Form 106 per employer. CS asks for pay slip (תלוש שכר) for Dec only. **Different document.** |
| **Securities** | ניירות ערך? → מוסדות | ניירות ערך סחירים? → מוסד | SIMILAR | AR: Form 867 per institution. CS: balance confirmation (אישור יתרת ני"ע) per institution. **Different document.** |
| **Bank accounts** | (not explicitly asked in AR) | חשבונות בנק → list all | CS-ONLY | AR doesn't collect bank info. CS needs detailed bank ID (ת.ז בנקאית) per bank. |
| **Insurance/pension** | הפקדות (deposits) → companies | קופות גמל/ביטוח חיים → מבטח+סוג | SIMILAR | AR: deposit certificate (דוח מקוצר). CS: tax certificate for capital statement (אישור מס להצהרת הון). **Different document.** |

### 3.2 Questions that are CS-ONLY (no AR equivalent)

| CS Question | Why CS-only |
|-------------|------------|
| Business bank account | CS tracks all assets; AR doesn't care about bank balances |
| Business credit cards | Same — asset tracking |
| Shares in companies | CS needs shareholder balance; AR only cares about dividends (if any) |
| Real estate | CS needs property ownership proof; AR only asks about rent income/expense |
| Renovations on property | Affects property value in CS |
| Vacation home rights | Asset category in CS |
| Vehicles/boats/aircraft | Asset category in CS |
| Personal credit cards | Liability/asset tracking |
| Mortgage | Liability in CS |
| Non-bank loans | Liability in CS |
| Receivables (others owe you) | Asset in CS |
| Payables (you owe others) | Liability in CS |
| Cash at home (>5000 NIS) | Asset in CS |
| Safe contents | Asset in CS |
| Power of attorney on other accounts | Disclosure requirement in CS |
| Other assets/liabilities | Catch-all in CS |

### 3.3 Questions that are AR-ONLY (no CS equivalent)

| AR Topic | Why AR-only |
|----------|------------|
| Eligible locality (אישור תושבות) | Tax credit, not balance sheet |
| Marital status change | Tax event, not asset |
| Special education children | Tax credit |
| Child disability allowance | Tax credit |
| NII allowances (disability, maternity, unemployment, etc.) | Income in AR, not asset |
| Withdrawals (pension, study fund, etc.) | Taxable event in AR, not balance |
| Crypto | Taxable event in AR; could appear as asset in CS under "other" |
| Gambling/prizes | Taxable event |
| Rent income/expense | Tax reporting; real estate ownership is CS |
| Inventory | Business asset — partially overlaps with CS business section |
| Withholding at source | Tax deduction |
| Donations | Tax credit |
| Army release | Tax credit |
| Memorial/institution/medical | Tax deductions |
| Degree | Tax credit |
| Foreign income | Tax reporting |
| Other incomes | Tax reporting |

---

## 4. Key Differences Summary

| Dimension | Annual Report (AR) | Capital Statement (CS) |
|-----------|-------------------|----------------------|
| **Focus** | Income & expenses for the tax year | Assets & liabilities snapshot on 31.12.{{year}} |
| **Scope** | Individual (+ spouse separately) | Entire family unit (תא משפחתי) together |
| **Date reference** | Full year (שנת {{year}}) | Single date (31.12.{{year}}) |
| **Document types** | Forms (106, 867), certificates, receipts | Balance confirmations, contracts, bank IDs |
| **Questionnaire sections** | ~25 topics across income/deductions | 2 sections: business capital + personal assets |
| **Spouse handling** | Separate document list per person | Combined — family unit answers together |
| **Overlap** | ~4 topics (employment, securities, insurance, ID) | ~4 topics overlap |

---

## 5. Implications for Implementation

### 5.1 Tally Form Design
- CS needs a **completely new Tally form** — the overlap with AR is minimal (~15%)
- Most CS questions are yes/no + free text follow-up (simpler than AR's multi-select patterns)
- CS doesn't need the complex multi-select logic (NII types, withdrawal types, etc.)
- CS form should ask about **the entire family unit** together (not split client/spouse like AR)

### 5.2 SSOT Document Templates
- Need **~18 new CS-specific templates** (CS-T001 through CS-T018)
- Only ~4 templates are *conceptually* similar to AR (but with different wording/purpose)
- CS documents are primarily: balance confirmations, contracts, bank IDs, pay slips
- AR documents are primarily: annual forms, tax certificates, receipts

### 5.3 Document Generation Logic
- CS is **simpler** than AR — mostly "one per item" with no complex dedupe rules
- No multi-select cascading (like NII allowances or withdrawal types in AR)
- Main complexity: parsing free-text lists of banks/companies/properties into individual documents
- "Other" catch-all is manual (Natan decides per case) — may need a "pending review" state

### 5.4 What Natan Wants to Change
From his email: *"כאן ארצה להתעכב איתך כי אני רוצה קצת לשנות השאלה הזאת"* — regarding the insurance/pension question. Need to discuss with Natan what changes he wants before finalizing the CS Tally form.

---

## 6. Natan's Clarifications (2026-03-25)

### Q1: Insurance/pension question
**Split into 5 separate yes/no questions**, each with a follow-up "which company?":
- פנסיה
- קרן השתלמות
- קופת גמל להשקעה
- ביטוח חיים
- תוכנית חסכון

**Document per type per company:** אישור מס להצהרת הון ליום 31.12.{{year}} מ**{{company_name}}**

### Q2: Spouse handling
Ask: "האם ביום 31.12.{{year}} היית נשוי?" — if yes, change question phrasing to plural (רבים) instead of singular (יחיד). **No separate spouse document list** — the whole questionnaire is about the family unit (תא משפחתי) together.

### Q3: Real estate
**Separate row per property** — and a separate document required per property (חוזה רכישה per address).

### Q4: "Other" assets/liabilities
**Free text field** — Natan will manually add required documents from the admin panel per case. No auto-generated documents for this category.

### Q5: Cash & safe
- **Cash at home:** Declaration only (no document required) — just a text field for the amount
- **Safe:** Requires evidence of the safe's existence (e.g., purchase invoice, receipt). Document: אסמכתא על קיום כספת

### Q6: Additional questions
None for now — current imkforms questionnaire covers everything needed.

---

## 7. Next Steps

1. **Design CS Tally form** — map each imkforms question to Tally fields with proper types, split insurance into 5 sub-questions
2. **Create CS SSOT templates** — define the ~20 document title templates with proper Hebrew wording
3. **Build CS document generator** — extend ssot-document-generator.js or create separate CS generator
4. **Test with Natan's sample data** — use his test submission to validate the mapping
