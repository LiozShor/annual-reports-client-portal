/**
 * AI document classification and hash-based dedup for inbound email attachments.
 * Migrated from n8n WF05 (DL-203). Rich classification with domain prompt,
 * content routing, and strict tool schema (DL-207).
 */

import type { ProcessingContext, AttachmentInfo, ClassificationResult, AdditionalMatch } from './types';
import { TABLES } from './types';
import type { AirtableRecord } from '../airtable';
import { extractDocxText, extractDocxImages, extractXlsxText } from './text-extractor';

// ---------------------------------------------------------------------------
// Types for required-doc records
// ---------------------------------------------------------------------------

interface DocFields {
  type: string;
  issuer_name?: string;
  issuer_key?: string;
  person?: string;
  status?: string;
  expected_filename?: string;
  category?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Template IDs (T301 excluded per DL-138)
// ---------------------------------------------------------------------------

const ALL_TEMPLATE_IDS = [
  // Annual Report templates
  'T001','T002','T003','T101','T102','T201','T202',
  'T302','T303','T305','T306','T401','T402','T501','T601',
  'T701','T801','T901','T902','T1001','T1101','T1102','T1201','T1301',
  'T1401','T1402','T1403','T1501','T1601','T1602','T1701',
  // Capital Statement templates
  'CS-T001','CS-T002','CS-T003','CS-T004','CS-T005','CS-T006','CS-T007',
  'CS-T008','CS-T009','CS-T010','CS-T011','CS-T012','CS-T013','CS-T014',
  'CS-T015','CS-T016','CS-T017','CS-T018','CS-T019','CS-T020','CS-T021','CS-T022',
] as const;

// ---------------------------------------------------------------------------
// Document type reference — ported VERBATIM from n8n WF05
// ---------------------------------------------------------------------------

const DOC_TYPE_REFERENCE = `
=== COMPLETE DOCUMENT TYPE REFERENCE FOR ISRAELI TAX DOCUMENTS ===

T001 - אישור תושבות (Residency Certificate)
  What: Official certificate confirming residency in a specific locality, issued by the local municipality.
  Issued by: Local municipality (עירייה / מועצה מקומית / מועצה אזורית)
  Common filenames: אישור_תושבות.pdf, residency.pdf, ishur_toshavut.pdf, תושבות.pdf
  Look for: "אישור תושבות", "תושב/ת", municipality letterhead, year of certification, address, city name
  Visual: Usually a single-page letter with municipal logo and stamp

T002 - ספח ת״ז מעודכן (Updated ID Appendix)
  What: The appendix page of the Israeli Identity Card (Teudat Zehut), showing family status, address, and children.
  Issued by: Ministry of Interior (משרד הפנים), Population Authority (רשות האוכלוסין)
  Common filenames: ספח.pdf, ספח_תז.pdf, id_appendix.pdf, תעודת_זהות.jpg, tz.pdf
  Look for: "ספח", "תעודת זהות", "מספר זהות", 9-digit ID number, family members list, address
  Visual: Folded card scan showing personal details in a structured table format
  Note: GLOBAL SINGLE — only ONE required per submission regardless of how many triggers exist

T003 - מסמכי שינוי סטטוס משפחתי (Family Status Change Documents)
  What: Legal documents proving marital status change during tax year (marriage, divorce, widowhood, separation).
  Issued by: Rabbinate (רבנות), courts (בית משפט), religious authorities
  Common filenames: נישואין.pdf, גירושין.pdf, marriage.pdf, divorce.pdf, תעודת_נישואין.pdf
  Look for: "נישואין", "גירושין", "התאלמנות", "פירוד", "תעודת נישואין", "גט", date of status change
  Visual: Official certificate with stamps, sometimes in ornate format

T101 - אישור ועדת השמה/שילוב (Special Education Placement Certificate)
  What: Certificate from education placement/inclusion committee for children with special needs.
  Issued by: Ministry of Education (משרד החינוך), local education authority
  Common filenames: ועדת_השמה.pdf, השמה.pdf, שילוב.pdf, special_education.pdf
  Look for: "ועדת השמה", "ועדת שילוב", "חינוך מיוחד", child's name, committee decision, school year

T102 - אישור קצבת נכות ילד מביטוח לאומי (Child Disability Allowance from NII)
  What: Annual certificate confirming disability allowance payments received from National Insurance for a child.
  Issued by: National Insurance Institute (המוסד לביטוח לאומי)
  Common filenames: נכות_ילד.pdf, child_disability.pdf, ביטוח_לאומי_ילד.pdf
  Look for: "ביטוח לאומי", "נכות", "ילד/ה", "קצבה", annual payment amounts, child's details

T201 - טופס 106 (Form 106 — Employment/Salary Certificate)
  What: THE most common Israeli tax document. Annual salary certificate from employer showing gross income, tax deducted, social security, pension contributions. Every employed person gets one per employer.
  Issued by: Employer's payroll department / accounting firm
  Common filenames: 106.pdf, טופס_106.pdf, form106.pdf, 106_2024.pdf, 106_2025.pdf, salary.pdf, שכר.pdf
  Look for: "טופס 106", "אישור שכר", "ניכוי מס", "הכנסת עבודה", "סה״כ", employer name and TIN, employee ID number, annual totals table, sections numbered 1-36
  Visual: Structured form with numbered rows, employer details at top, income/deduction breakdown

T202 - טופס 106 בן/בת זוג (Form 106 — Spouse Employment Certificate)
  What: Same as T201 but issued for the client's spouse. Identical form structure.
  Issued by: Spouse's employer
  Disambiguation: Check the employee name on the form against client vs spouse name
  Common filenames: Same as T201 — must check content to distinguish

T302 - אישור ביטוח לאומי בן/בת זוג (Spouse NII Allowance Certificate)
  What: Annual certificate from NII for spouse's allowance. Scope: SPOUSE only.
  Benefit types: אבטלה (unemployment), מילואים (reserves), פגיעה בעבודה (work injury), נכות (disability), דמי לידה (maternity), or other.
  Issued by: National Insurance Institute (המוסד לביטוח לאומי)
  Common filenames: ביטוח_לאומי.pdf, נכות.pdf, דמי_לידה.pdf, אבטלה.pdf, מילואים.pdf
  Look for: "ביטוח לאומי", "המוסד לביטוח לאומי", "אישור שנתי", spouse name on document
  issuer_name: Return the BENEFIT TYPE in Hebrew (e.g., "אבטלה", "מילואים", "נכות", "דמי לידה", "פגיעה בעבודה"), NEVER "ביטוח לאומי".

T303 - אישור דמי נכות מביטוח לאומי (Client NII Disability Certificate)
  What: Annual certificate for CLIENT disability payments from NII. Scope: CLIENT only.
  Look for: "דמי נכות", "נכות", "ביטוח לאומי", client name on document
  issuer_name: Return null (no issuer_key needed for T303).

T305 - אישור קצבת שארים (Client NII Survivors Allowance)
  What: Annual certificate for CLIENT survivors allowance from NII. Scope: CLIENT.
  Look for: "קצבת שארים", "שארים", "ביטוח לאומי", client name or survivor details
  issuer_name: Return the survivor details text.

T306 - אישור קצבת שארים בן/בת זוג (Spouse NII Survivors Allowance)
  What: Annual certificate for SPOUSE survivors allowance from NII. Scope: SPOUSE.
  Look for: "קצבת שארים", "שארים", "ביטוח לאומי", spouse name on document
  issuer_name: Return the survivor details text.

T401 - אישור משיכה (Fund Withdrawal Certificate)
  What: Certificate for fund withdrawal showing amount and tax deducted.
  Issued by: Insurance/pension companies — מגדל, הראל, כלל, מנורה, הפניקס, מיטב דש, אלטשולר שחם, פסגות, אנליסט, IBI
  Common filenames: משיכה.pdf, פדיון.pdf, withdrawal.pdf, קרן_השתלמות.pdf, פנסיה.pdf, פיצויים.pdf
  Look for: "אישור משיכה", "פדיון", "קרן השתלמות", "קרן פנסיה", "קופת גמל", "פיצויי פיטורין", amount withdrawn, tax deducted

T402 - אישור משיכה אחר (Other Withdrawal Certificate)
  What: Withdrawal certificate for types not covered by standard categories.

T501 - אישור שנתי הפקדות / דוח שנתי מקוצר (Annual Deposit Report)
  What: Annual income tax certificate for contributions to pension, study fund, disability insurance, or life insurance.
  Issued by: Insurance/pension companies
  Common filenames: אישור_שנתי.pdf, דוח_מקוצר.pdf, הפקדות.pdf, annual_report.pdf
  Look for: "אישור שנתי למס הכנסה", "דוח שנתי מקוצר", "הפקדות", deposit amounts
  Also triggered by: "הודעה על תשלום פדיון" (redemption payment notice)

T601 - טופס 867 (Form 867 — Securities Annual Report)
  What: Annual report from bank/brokerage on securities transactions.
  Issued by: Banks and brokerages
  Common filenames: 867.pdf, טופס_867.pdf, ניירות_ערך.pdf, securities.pdf
  Note: Deduplicated by institution — one per bank/broker

T701 - דוח קריפטו (Cryptocurrency Report)
  What: Annual report on cryptocurrency transactions and gains/losses.
  Common filenames: crypto.pdf, קריפטו.pdf, bitcoin.pdf
  Look for: "קריפטו", "מטבע דיגיטלי", "ביטקוין", cryptocurrency exchange names, transaction history

T801 - אישור זכייה בפרס (Prize/Gambling Winnings Certificate)
  What: Certificate for prize or gambling winnings showing amount and tax withheld.
  Look for: "זכייה", "פרס", "הגרלה", "הימורים", prize amount, tax deducted

T901 - חוזה שכירות הכנסה (Rental Income Contract)
  What: Rental contract where the client is the LANDLORD receiving rental income.
  Look for: "חוזה שכירות", "משכיר", "דמי שכירות", Israeli address, monthly rent amount
  Note: Client is the LANDLORD (משכיר)

T902 - חוזה שכירות הוצאה (Rental Expense Contract)
  What: Rental contract where the client is the TENANT paying rent.
  Look for: "חוזה שכירות", "שוכר", "דמי שכירות", Israeli address, monthly rent amount
  Note: Client is the TENANT (שוכר)

T1001 - רשימת ספירת מלאי (Inventory Count List)
  What: Physical inventory count document for business owners.
  Look for: "ספירת מלאי", "מלאי", product list, quantities, values

T1101 - אישור ניכוי מס הכנסה במקור (Income Tax Withholding Certificate)
  What: Certificate showing income tax withheld at source from payments to the client.
  Look for: "ניכוי מס במקור", "ניכוי מס הכנסה", "אישור ניכוי", payer name, amounts withheld

T1102 - אישור ניכוי ביטוח לאומי במקור (NII Withholding Certificate)
  What: Certificate showing National Insurance contributions withheld at source.
  Look for: "ניכוי ביטוח לאומי", "דמי ביטוח", NII reference, amounts withheld

T1201 - קבלות תרומה סעיף 46 (Donation Receipts Section 46)
  What: Official donation receipts from recognized institutions eligible for tax deduction under Section 46.
  Look for: "תרומה", "סעיף 46", "קבלה", recognized institution name, donation amount

T1301 - תעודת שחרור (Military Discharge Certificate)
  What: IDF discharge certificate for tax credit eligibility.
  Look for: "תעודת שחרור", "צה״ל", "שירות צבאי", discharge date, service period

T1401 - קבלות הוצאות הנצחה (Memorial Expense Receipts)
  What: Receipts for memorial/bereavement expenses eligible for tax deduction.
  Look for: "הנצחה", "אבל", memorial expenses, receipts

T1402 - מסמך קרוב במוסד (Relative in Institution Document)
  What: Document proving a relative is in a care institution, for tax credit eligibility.
  Look for: "מוסד", "קרוב משפחה", institution name, relative details

T1403 - מסמך רפואי לפטור ממס (Medical Tax Exemption Document)
  What: Medical document supporting tax exemption or credit claims.
  Look for: "פטור ממס", "רפואי", "נכות", medical condition, doctor/committee certification

T1501 - אישור זכאות לתואר (Degree Eligibility Certificate)
  What: Certificate confirming completion of an academic degree, for tax credit eligibility.
  Look for: "תואר", "אוניברסיטה", "מכללה", degree type, institution name, completion date

T1601 - אסמכתאות הכנסות מחו״ל (Foreign Income Evidence)
  What: Evidence documents for income earned OUTSIDE Israel. NOT for Israeli rental contracts.
  Look for: Foreign bank statements, foreign employer documents, non-Israeli addresses, foreign currency
  Note: ONLY for income from OUTSIDE Israel. Israeli rental contracts are T901/T902.

T1602 - דו״ח שנתי שהוגש בחו״ל (Foreign Tax Return Filed Abroad)
  What: Copy of tax return filed in a foreign country.
  Look for: Foreign tax authority forms, non-Israeli tax return, foreign country tax filing

T1701 - מסמך תומך להכנסה נוספת (Supporting Document for Other Income)
  What: Supporting document for additional income not covered by other categories.
  Look for: Income documentation that doesn't fit other categories

=== CAPITAL STATEMENT DOCUMENT TYPES (CS-T*) ===

CS-T001 - תעודת זהות בנקאית מפורטת — חשבון עסקי (Business Bank Statement)
  What: Detailed bank ID for a business account showing all transactions for the tax year.
  Look for: "תעודת זהות בנקאית", "ת.ז בנקאית", "חשבון עסקי", bank name, year

CS-T002 - דף פירוט עסקאות אשראי עסקי (Business Credit Card Statement)
  What: Credit card transaction detail for business card, showing transactions in month 12 with repayment in month 1 of next year.
  Look for: "פירוט עסקאות", "כרטיס אשראי", "עסקי", card company name

CS-T003 - חו"ז בעל מניות (Shareholder Balance Report)
  What: Shareholder account balance report as of 31.12 of the tax year.
  Look for: "חו״ז בעל מניות", "בעל מניות", company name, balance date

CS-T004 - חוזה רכישת נכס (Property Purchase Contract)
  What: Contract for property purchase showing address and terms.
  Look for: "חוזה רכישה", "נכס", "נדל״ן", property address, purchase price

CS-T005 - אסמכתאות שיפוצים בנכס (Property Renovation Evidence)
  What: Evidence of renovations performed on a property (receipts, invoices).
  Look for: "שיפוצים", "שיפוץ", "קבלות", property address, renovation costs

CS-T006 - חוזה דירת נופש (Vacation Home Contract)
  What: Purchase contract or rights details for a vacation home.
  Look for: "דירת נופש", "נופש", "זכות", vacation property details

CS-T007 - רישיון רכב (Vehicle Registration)
  What: Vehicle registration document showing ownership.
  Look for: "רישיון רכב", "רכב", vehicle description, license plate number

CS-T008 - תעודת זהות בנקאית מפורטת (Personal Bank Statement)
  What: Detailed bank ID for a personal account showing all transactions for the tax year.
  Look for: "תעודת זהות בנקאית", "ת.ז בנקאית", bank name, year (no "עסקי" qualifier)

CS-T009 - דף פירוט עסקאות אשראי (Personal Credit Card Statement)
  What: Credit card transaction detail for personal card.
  Look for: "פירוט עסקאות", "כרטיס אשראי", card company name (no "עסקי" qualifier)

CS-T010 - אישור יתרת משכנתא (Mortgage Balance Confirmation)
  What: Mortgage balance confirmation as of 31.12 of the tax year.
  Look for: "משכנתא", "יתרת משכנתא", bank name, balance date

CS-T011 - אישור יתרת הלוואה (Loan Balance Confirmation)
  What: Non-bank loan balance confirmation as of 31.12.
  Look for: "הלוואה", "יתרת הלוואה", lender name, balance amount

CS-T012 - תלוש שכר (Pay Slip)
  What: Pay slip for month 12 of the tax year.
  Look for: "תלוש שכר", "תלוש משכורת", employer name, month 12

CS-T013 - אישור מס פנסיה להצהרת הון (Pension Tax Certificate for Capital Statement)
  What: Tax certificate from pension company for capital statement as of 31.12.
  Look for: "פנסיה", "אישור מס", "הצהרת הון", company name

CS-T014 - אישור מס קרן השתלמות להצהרת הון (Study Fund Tax Certificate)
  What: Tax certificate from study fund company for capital statement as of 31.12.
  Look for: "קרן השתלמות", "אישור מס", "הצהרת הון", company name

CS-T015 - אישור מס קופת גמל להשקעה להצהרת הון (Provident Fund Tax Certificate)
  What: Tax certificate from provident fund company for capital statement as of 31.12.
  Look for: "קופת גמל", "להשקעה", "אישור מס", company name

CS-T016 - אישור מס ביטוח חיים להצהרת הון (Life Insurance Tax Certificate)
  What: Tax certificate from life insurance company for capital statement as of 31.12.
  Look for: "ביטוח חיים", "אישור מס", company name

CS-T017 - אישור מס תוכנית חסכון להצהרת הון (Savings Plan Tax Certificate)
  What: Tax certificate from savings plan company for capital statement as of 31.12.
  Look for: "תוכנית חסכון", "אישור מס", company name

CS-T018 - אישור יתרת ניירות ערך (Securities Balance Certificate)
  What: Securities balance confirmation as of 31.12 from bank or broker.
  Look for: "ניירות ערך", "יתרה", institution name, balance date

CS-T019 - אסמכתא חוב כלפי התא המשפחתי (Receivable Evidence)
  What: Evidence of debt owed TO the family unit.
  Look for: "חוב", "receivable", loan agreement, amount owed to family

CS-T020 - אסמכתא חוב של התא המשפחתי (Payable Evidence)
  What: Evidence of debt owed BY the family unit.
  Look for: "חוב", "payable", loan agreement, amount owed by family

CS-T021 - אסמכתא על קיום כספת (Safe Existence Evidence)
  What: Evidence that a safe deposit box or home safe exists.
  Look for: "כספת", "safe", safe rental agreement, safe ownership

CS-T022 - ת.ז בנקאית חשבון ייפוי כוח (Power of Attorney Bank Statement)
  What: Detailed bank ID for a power of attorney or trust account.
  Look for: "ייפוי כוח", "נאמנות", "power of attorney", bank name

=== END OF DOCUMENT TYPE REFERENCE ===
`;

// ---------------------------------------------------------------------------
// Anthropic tool definition — strict schema
// ---------------------------------------------------------------------------

const CLASSIFY_TOOL = {
  name: 'classify_document',
  description: 'Classify a tax document received from an Israeli CPA firm client. Read the document content and identify the document type.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      evidence: {
        type: 'string',
        description: '1-3 sentences IN HEBREW: First identify the document CATEGORY (employment, NII, insurance/pension, banking, rental, etc.), then cite specific text that determines the exact template type. For NII: state the allowance type. For insurance: state if deposit report (T501) vs withdrawal (T401).'
      },
      issuer_name: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: 'The identifying name used to match this document to a specific required document. RULES: For NII: T302 (spouse allowance) return the BENEFIT TYPE in Hebrew (e.g., אבטלה, מילואים, נכות, דמי לידה, פגיעה בעבודה). T303 (client disability) return null. T305/T306 (survivors) return the survivor details. NEVER return ביטוח לאומי. For Form 106 (T201/T202): return the EMPLOYER name. For Form 867 (T601): return the BANK/BROKER name. For insurance docs (T401/T501): return the INSURANCE COMPANY name. For all others: return the issuing organization name. null if not visible.'
      },
      confidence: {
        type: 'number',
        description: 'Classification confidence 0.0-1.0. Be honest and calibrated.'
      },
      additional_matches: {
        type: 'array',
        description: 'If this document ALSO satisfies a requirement for the OTHER filing type (e.g., a securities statement serves both T601 for Annual Report AND CS-T018 for Capital Statement), include the secondary match(es) here. Leave empty ([]) if the document only applies to one filing type.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            template_id: { type: 'string', enum: [...ALL_TEMPLATE_IDS], description: 'Secondary template ID from the OTHER filing type.' },
            evidence: { type: 'string', description: 'Brief Hebrew evidence for why this document also matches this template.' },
            issuer_name: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Issuer name for the secondary match (same rules as primary).' },
            confidence: { type: 'number', description: 'Confidence for this secondary match (0.0-1.0).' }
          },
          required: ['template_id', 'evidence', 'issuer_name', 'confidence']
        }
      },
      contract_period: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              start_date: { type: 'string', description: 'Contract start date in YYYY-MM-DD format.' },
              end_date: { type: 'string', description: 'Contract end date in YYYY-MM-DD format.' },
              covers_full_year: { type: 'boolean', description: 'true if contract covers January 1 through December 31 of the tax year. false if partial.' }
            },
            required: ['start_date', 'end_date', 'covers_full_year']
          },
          { type: 'null' }
        ],
        description: 'For rental contracts (T901/T902 ONLY): extract the contract period dates. Return null for all other document types.'
      },
      matched_template_id: {
        anyOf: [
          { type: 'string', enum: [...ALL_TEMPLATE_IDS] },
          { type: 'null' }
        ],
        description: 'Template ID to assign. Use the Document Type Reference above. Set to null if confidence < 0.5 or no match found.'
      }
    },
    required: ['evidence', 'issuer_name', 'confidence', 'additional_matches', 'contract_period', 'matched_template_id']
  },
  cache_control: { type: 'ephemeral' }
} as const;

// ---------------------------------------------------------------------------
// DL-278: Recovery tool — lightweight template matcher for when classifier
// returns good evidence but null matched_template_id
// ---------------------------------------------------------------------------

const RECOVERY_TOOL = {
  name: 'recover_template',
  description: 'Match document evidence to the correct template ID from the required documents list.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      matched_template_id: {
        type: 'string',
        enum: [...ALL_TEMPLATE_IDS],
        description: 'The template ID that best matches the document evidence.'
      },
      confidence: {
        type: 'number',
        description: 'Confidence in the match (0.0-1.0).'
      }
    },
    required: ['matched_template_id', 'confidence']
  }
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  clientName: string,
  requiredDocs: AirtableRecord<DocFields>[],
): Array<{type: 'text'; text: string; cache_control?: {type: 'ephemeral'}}> {
  const docsCtx = requiredDocs.length > 0
    ? requiredDocs.map(d => {
        const p = d.fields.person === 'spouse' ? ' (spouse)' : '';
        const name = (d.fields.issuer_name || '').replace(/<\/?b>/g, '');
        return `- ${d.fields.type}: ${name}${p ? ' ' + p : ''}`;
      }).join('\n')
    : 'No required documents found for this client.';

  const text = `You are a document classifier for an Israeli CPA firm's tax document collection system.

${DOC_TYPE_REFERENCE}

Client name: ${clientName}

The client's required documents (not yet received):
${docsCtx}

Classification rules:
- READ the document content fully. Look for form numbers, institution names, document titles.

STEP-BY-STEP for every document:

1. PERSON CHECK (do this FIRST for ALL documents):
   Compare the person's name on the document to the client name (${clientName}).
   If the name does NOT match → this document is for the SPOUSE.
   Remember this result — you will need it below.

2. CATEGORY IDENTIFICATION:
   Determine which category this document belongs to:
   • Employment income (טופס 106) → go to Employment rules
   • National Insurance (ביטוח לאומי) → go to NII rules
   • Insurance/Pension company → go to Insurance rules
   • Securities/Banking (טופס 867) → go to Securities rules
   • Rental contract → go to Rental rules
   • Other → use Doc Type Reference

--- Employment rules ---
   • Person is CLIENT → T201
   • Person is SPOUSE → T202
   • Cannot determine → T202

--- NII rules (ביטוח לאומי) ---
   First check PERSON (client vs spouse) and BENEFIT TYPE:
   • SPOUSE + any allowance → T302
       issuer_name = the benefit type in Hebrew (e.g., "אבטלה", "דמי לידה")
   • CLIENT + disability (נכות) → T303
       issuer_name = null
   • CLIENT + survivors (שארים) → T305
       issuer_name = survivor details from the document
   • SPOUSE + survivors (שארים) → T306
       issuer_name = survivor details from the document
   ⚠️ issuer_name: NEVER return "ביטוח לאומי" — use the specific values above.

--- Insurance/Pension rules ---
   Private insurance company (מגדל, הראל, כלל, מנורה, הפניקס, מיטב דש, אלטשולר שחם, פסגות, IBI, etc.):
   • Annual deposit/contribution report → T501
   • Fund withdrawal certificate → T401

--- Securities rules ---
   Bank/broker annual report (טופס 867) → T601

--- Rental rules ---
   חוזה שכירות (rental contract):
   • T901 (income, client is landlord) or T902 (expense, client is tenant)
   • NEVER classify an Israeli rental contract as T1601 or T1701
   • T1601 is ONLY for income/documents from OUTSIDE Israel
   • For T901/T902: ALWAYS extract contract_period — find the contract start and end dates.
     If the contract covers January 1 through December 31 of the same calendar year → covers_full_year: true.
     If it covers only part of the year (e.g., ends in August, or starts mid-year) → covers_full_year: false.
     Dates in Hebrew contracts may appear as DD/MM/YYYY, DD.MM.YYYY, or Hebrew month names — normalize to YYYY-MM-DD.
     For non-rental documents, set contract_period to null.

Commonly confused pairs — pay special attention:
- T401 (fund WITHDRAWAL — משיכה/פדיון) vs T501 (annual DEPOSIT REPORT — אישור שנתי/דוח מקוצר). Key: withdrawal = T401, deposit/contribution report = T501.
- Insurance company document → T501, National Insurance → T302.
- T901/T902 (rental contracts, Israeli address) vs T1601 (foreign income evidence). A rental contract with an Israeli address is ALWAYS T901 or T902.
- T901 (rental INCOME — client is משכיר/landlord) vs T902 (rental EXPENSE — client is שוכר/tenant).
- T1101 (income TAX withholding) vs T1102 (NII withholding).
- T201 (Form 106 for CLIENT) vs T202 (Form 106 for SPOUSE). Compare the employee name on the form to the client name.
- Maternity leave (דמי לידה) from NII → always T302, regardless of whether the person is the client or spouse.

Note: If the document does NOT match any of the client's required documents, classify using the Document Type Reference — use the best matching template from the full list.

IMPORTANT — Capital Statement (CS-T*) vs Annual Report (T*) templates:
- CS-T* templates are for Capital Statement (הצהרת הון) documents — bank IDs, property contracts, vehicle registrations, balance confirmations, pay slips, etc.
- T* templates (without CS- prefix) are for Annual Report (דוח שנתי) documents — Form 106, Form 867, NII certificates, etc.
- If the client has BOTH types in their required documents list, match to the correct template family.
- Bank statements and credit card details for a capital statement → CS-T001/CS-T008/CS-T002/CS-T009
- Annual tax certificates from employers → T201/T202

--- DUAL-MATCH rules (document serves BOTH Annual Report AND Capital Statement) ---
Some documents satisfy requirements for BOTH filing types simultaneously. When you detect this, return the PRIMARY match as matched_template_id and add the SECONDARY match in additional_matches.

Known dual-match pairs:
- T601 (Form 867 — securities annual report) ↔ CS-T018 (securities balance certificate): A bank/broker annual statement often contains both trading data AND year-end balance.
- T501 (annual deposit/pension report) ↔ CS-T013 (pension tax cert) / CS-T014 (study fund cert) / CS-T015 (provident fund cert): An insurance company's annual tax certificate may cover both income tax deductions AND year-end balance.
- T401 (fund withdrawal) ↔ CS-T013 (pension tax cert): A pension company withdrawal notice may also show year-end balance for capital statement.

Rules:
- Only add additional_matches if the client has BOTH filing types in their required documents list.
- The primary match should be the template that best matches the document's primary purpose.
- Additional matches should have their own confidence score — don't just copy the primary confidence.
- If the document clearly serves only one filing type, leave additional_matches as [].

- Set matched_template_id to null if confidence < 0.5 or no match found.
- Hebrew documents are normal — read and understand Hebrew text fully.
- Extract the issuer organization name from the document's visible content, not from the filename.`;

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

// ---------------------------------------------------------------------------
// Content routing constants
// ---------------------------------------------------------------------------

const LARGE_PDF_THRESHOLD = 5 * 1024 * 1024; // 5MB
const PDF_EXT = /\.pdf$/i;
const DOCX_EXT = /\.docx?$/i;
const XLSX_EXT = /\.xlsx?$/i;
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// ---------------------------------------------------------------------------
// Issuer matching — ported from n8n Process and Prepare Upload node
// ---------------------------------------------------------------------------

/** Entity-type prefixes that cause false fuzzy matches between different institutions */
const ENTITY_STOP = new Set(['בנק', 'קרן', 'חברה', 'חברת', 'ביטוח', 'קופת', 'בית']);

function normalizeIssuer(name: string): string {
  if (!name) return '';
  return name
    .replace(/<\/?b>/g, '')
    .replace(/\*\*/g, '')
    .replace(/[\u200f\u200e]/g, '')
    .trim()
    .toLowerCase();
}

function tokenize(str: string): string[] {
  return str.split(/[\s\-\u2013\u2014,\.]+/).filter(t => t.length > 0);
}

function compareIssuers(aiIssuer: string, docIssuer: string): 'exact' | 'fuzzy' | 'mismatch' {
  const a = normalizeIssuer(aiIssuer);
  const b = normalizeIssuer(docIssuer);
  if (!a || !b) return 'mismatch';
  if (a === b) return 'exact';
  // Substring containment
  if ((a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b))) return 'exact';
  // Distinctive token overlap (entity-type prefixes + digits removed)
  const tokA = tokenize(a).filter(t => !ENTITY_STOP.has(t) && !/^\d+$/.test(t));
  const tokB = tokenize(b).filter(t => !ENTITY_STOP.has(t) && !/^\d+$/.test(t));
  if (tokA.length === 0) return 'mismatch';
  const smaller = tokA.length <= tokB.length ? tokA : tokB;
  const larger = tokA.length > tokB.length ? tokA : tokB;
  const overlap = smaller.filter(t => larger.some(l => l.includes(t) || t.includes(l))).length;
  const threshold = smaller.length <= 2 ? 1.0 : 0.5;
  return (overlap / smaller.length) >= threshold ? 'fuzzy' : 'mismatch';
}

// ---------------------------------------------------------------------------
// Quality rank for dual-field matching
// ---------------------------------------------------------------------------

const QUALITY_RANK: Record<string, number> = { exact: 3, fuzzy: 2, single: 1, mismatch: 0 };

function findBestDocMatch(
  templateId: string,
  issuerName: string,
  requiredDocs: AirtableRecord<DocFields>[],
): { docId: string | null; matchQuality: string | null; matchedDocName: string | null } {
  if (!requiredDocs || !Array.isArray(requiredDocs)) {
    return { docId: null, matchQuality: null, matchedDocName: null };
  }
  const candidates = requiredDocs.filter(r => r.fields.type === templateId);
  if (candidates.length === 0) return { docId: null, matchQuality: null, matchedDocName: null };

  if (candidates.length === 1) {
    // Single candidate — no ambiguity, issuer comparison irrelevant
    return { docId: candidates[0].id, matchQuality: 'single', matchedDocName: TEMPLATE_TITLES[candidates[0].fields.type] || candidates[0].fields.expected_filename || candidates[0].fields.type };
  }

  // Multiple candidates — find best issuer match
  let bestDoc = candidates[0];
  let bestQuality: string = 'mismatch';
  for (const doc of candidates) {
    const qKey = compareIssuers(issuerName || '', doc.fields.issuer_key || '');
    const qName = compareIssuers(issuerName || '', doc.fields.issuer_name || '');
    const q = (QUALITY_RANK[qKey] ?? 0) >= (QUALITY_RANK[qName] ?? 0) ? qKey : qName;
    if (q === 'exact') return { docId: doc.id, matchQuality: 'exact', matchedDocName: TEMPLATE_TITLES[doc.fields.type] || doc.fields.expected_filename || doc.fields.type };
    if (q === 'fuzzy' && bestQuality !== 'fuzzy') {
      bestDoc = doc;
      bestQuality = 'fuzzy';
    }
  }
  return { docId: bestDoc.id, matchQuality: bestQuality, matchedDocName: TEMPLATE_TITLES[bestDoc.fields.type] || bestDoc.fields.expected_filename || bestDoc.fields.type };
}

// ---------------------------------------------------------------------------
// Helper: build template list for the prompt
// ---------------------------------------------------------------------------

/** Map of template IDs to Hebrew titles for classification prompts */
export const TEMPLATE_TITLES: Record<string, string> = {
  T001:'אישור תושב', T002:'ספח תעודת זהות', T003:'מסמכי שינוי מצב משפחתי',
  T101:'אישור ועדת השמה', T102:'אישור קצבת ילד נכה',
  T201:'טופס 106', T202:'טופס 106',
  T302:'אישור קצבה ביטוח לאומי', T303:'אישור קצבת נכות', T304:'אישור דמי לידה',
  T305:'אישור קצבת שאירים', T306:'אישור קצבת שאירים',
  T401:'אישור משיכת ביטוח', T402:'אישור משיכת ביטוח',
  T501:'אישור שנתי קופת גמל', T601:'טופס 867',
  T701:'דוח רווחי קריפטו', T801:'אישור זכייה',
  T901:'חוזה שכירות', T902:'חוזה שכירות',
  T1001:'רשימת מלאי', T1101:'אישור ניכוי מס הכנסה', T1102:'אישור ניכוי ביטוח לאומי',
  T1201:'קבלות תרומה', T1301:'תעודת שחרור צבאי',
  T1401:'קבלות הוצאות אבל', T1402:'מסמכי מוסד', T1403:'מסמכי פטור ממס',
  T1501:'תעודת השכלה', T1601:'אסמכתאות הכנסה מחול', T1602:'דוח מס מחול',
  T1701:'מסמכי הכנסה אחרת',
  // Capital Statement templates
  'CS-T001':'ת.ז בנקאית מפורטת (עסקי)', 'CS-T002':'פירוט עסקאות אשראי (עסקי)',
  'CS-T003':'חו"ז בעל מניות', 'CS-T004':'חוזה רכישת נכס',
  'CS-T005':'אסמכתאות שיפוצים', 'CS-T006':'חוזה דירת נופש',
  'CS-T007':'רישיון רכב', 'CS-T008':'ת.ז בנקאית מפורטת',
  'CS-T009':'פירוט עסקאות אשראי', 'CS-T010':'אישור יתרת משכנתא',
  'CS-T011':'אישור יתרת הלוואה', 'CS-T012':'תלוש שכר',
  'CS-T013':'אישור מס פנסיה', 'CS-T014':'אישור מס קרן השתלמות',
  'CS-T015':'אישור מס קופת גמל', 'CS-T016':'אישור מס ביטוח חיים',
  'CS-T017':'אישור מס תוכנית חסכון', 'CS-T018':'אישור יתרת ניירות ערך',
  'CS-T019':'אסמכתא חוב כלפי המשפחה', 'CS-T020':'אסמכתא חוב של המשפחה',
  'CS-T021':'אסמכתא קיום כספת', 'CS-T022':'ת.ז בנקאית ייפוי כוח',
};

function buildTemplateList(requiredDocs: AirtableRecord<DocFields>[]): string {
  return requiredDocs
    .map((r) => {
      const title = TEMPLATE_TITLES[r.fields.type] || r.fields.expected_filename || r.fields.type;
      const issuer = r.fields.issuer_name ? ` (${r.fields.issuer_name})` : '';
      const person = r.fields.person === 'spouse' ? ' [spouse]' : '';
      return `- ${r.fields.type}: ${title}${issuer}${person}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// DL-278: Recovery agent — re-derive template ID from evidence text
// ---------------------------------------------------------------------------

async function recoverTemplateId(
  apiKey: string,
  evidence: string,
  issuerName: string,
  requiredDocs: AirtableRecord<DocFields>[],
  attachmentName: string,
): Promise<{ templateId: string; confidence: number } | null> {
  const templateList = buildTemplateList(requiredDocs);

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    system: `You are a template matcher for an Israeli CPA firm's document collection system.
Given the classification evidence (Hebrew text describing a document) and a list of required document templates, pick the BEST matching template ID.

Required documents (not yet received):
${templateList}

Rules:
- Pick the template whose type and issuer best match the evidence description.
- If the evidence mentions טופס 106 → T201 (client) or T202 (spouse).
- If the evidence mentions טופס 867 or ניירות ערך → T601.
- If the evidence mentions דוח שנתי מקוצר / אישור שנתי / הפקדות from an insurance company → T501.
- If the evidence mentions משיכה / פדיון from an insurance company → T401.
- You MUST pick a template — do not return null.`,
    messages: [{ role: 'user', content: `Document evidence: ${evidence}\nIssuer: ${issuerName || 'unknown'}\nFilename: ${attachmentName}` }],
    tools: [RECOVERY_TOOL],
    tool_choice: { type: 'tool', name: 'recover_template' },
  };

  const MAX_RETRIES = 2;
  try {
    let resp: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (resp.status !== 429 || attempt === MAX_RETRIES) break;
      const delay = 1000 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }

    if (!resp || !resp.ok) return null;

    const data = (await resp.json()) as {
      content: Array<{ type: string; input?: Record<string, unknown> }>;
    };

    const toolBlock = data.content.find((b) => b.type === 'tool_use');
    if (!toolBlock?.input) return null;

    const templateId = toolBlock.input.matched_template_id as string | undefined;
    const confidence = (toolBlock.input.confidence as number) ?? 0;

    if (!templateId || confidence < 0.5) return null;

    return { templateId, confidence };
  } catch (err) {
    console.warn(`[classifier] Recovery agent failed for "${attachmentName}": ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// classifyAttachment
// ---------------------------------------------------------------------------

export async function classifyAttachment(
  pCtx: ProcessingContext,
  attachment: AttachmentInfo,
  requiredDocs: AirtableRecord<DocFields>[],
  clientName: string,
  emailMetadata: { subject: string; bodyPreview: string; senderName: string; senderEmail: string },
): Promise<ClassificationResult> {
  // Build content array based on file type
  const content: Array<Record<string, unknown>> = [];
  const sizeKB = Math.round(attachment.size / 1024);
  const base64 = arrayBufferToBase64(attachment.content);

  const isLargePdf = (PDF_EXT.test(attachment.name) || attachment.contentType === 'application/pdf')
    && attachment.size > LARGE_PDF_THRESHOLD;

  // DL-210 Bug 4: Validate PDF header before sending to Anthropic API
  const isPdfFile = PDF_EXT.test(attachment.name) || attachment.contentType === 'application/pdf';
  const isInvalidPdf = isPdfFile && !isLargePdf && (() => {
    try {
      const header = new Uint8Array(attachment.content as ArrayBuffer, 0, Math.min(4, attachment.content.byteLength));
      // Valid PDFs start with %PDF (0x25 0x50 0x44 0x46)
      return header.length < 4 || header[0] !== 0x25 || header[1] !== 0x50 || header[2] !== 0x44 || header[3] !== 0x46;
    } catch { return true; }
  })();

  if (isInvalidPdf) {
    console.warn(`[classifier] Invalid PDF header for "${attachment.name}" — falling back to filename classification`);
    content.push({ type: 'text', text: `[Invalid/corrupted PDF — content cannot be read. Classify based on filename and email context only.]\nFilename: ${attachment.name}\nFile size: ${sizeKB}KB` });
  } else if (isLargePdf) {
    content.push({ type: 'text', text: `[Large PDF document — ${sizeKB}KB — content not included to save tokens. Classify based on filename and email context.]` });
  } else if (isPdfFile) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
  } else if (IMG_TYPES.includes(attachment.contentType) || /\.(jpe?g|png|gif|webp)$/i.test(attachment.name)) {
    const mt = attachment.contentType || 'image/jpeg';
    content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: base64 } });
  } else if (DOCX_EXT.test(attachment.name)) {
    const uint8 = new Uint8Array(attachment.content);
    const text = await extractDocxText(uint8);
    if (text.length > 10) {
      content.push({ type: 'text', text: `[Extracted DOCX text content:]\n${text.substring(0, 8000)}` });
    } else {
      const images = await extractDocxImages(uint8);
      if (images.length > 0) {
        for (const img of images.slice(0, 3)) {
          const imgBase64 = arrayBufferToBase64(img.data.buffer as ArrayBuffer);
          content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: imgBase64 } });
        }
        content.push({ type: 'text', text: `[DOCX with no text — ${images.length} embedded image(s) extracted. Classify based on image content.]` });
      }
    }
  } else if (XLSX_EXT.test(attachment.name)) {
    const uint8 = new Uint8Array(attachment.content);
    const text = await extractXlsxText(uint8);
    if (text.length > 10) {
      content.push({ type: 'text', text: `[Extracted XLSX spreadsheet content:]\n${text.substring(0, 8000)}` });
    }
  }

  // Build user prompt with email context
  const userPromptText = isLargePdf
    ? `Classify this document based on filename and email context ONLY (file too large).\nFilename: ${attachment.name}\nEmail subject: ${emailMetadata.subject}\nEmail body: ${emailMetadata.bodyPreview}\nSender: ${emailMetadata.senderName} (${emailMetadata.senderEmail})\nFile type: ${attachment.contentType}\nFile size: ${sizeKB}KB (LARGE — classify by metadata only, set lower confidence)`
    : `Classify this document.\nFilename: ${attachment.name}\nEmail subject: ${emailMetadata.subject}\nEmail body: ${emailMetadata.bodyPreview}\nSender: ${emailMetadata.senderName} (${emailMetadata.senderEmail})\nFile type: ${attachment.contentType}\nFile size: ${sizeKB}KB`;

  content.push({ type: 'text', text: userPromptText });

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: buildSystemPrompt(clientName, requiredDocs),
    messages: [{ role: 'user', content }],
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: 'classify_document' },
  };

  // DL-277: Retry with exponential backoff on 429 rate limit (DL-278: bumped 3→5)
  const MAX_RETRIES = 5;
  async function fetchWithRetry(): Promise<Response> {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'x-api-key': pCtx.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    };
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', init);
      if (resp.status !== 429 || attempt === MAX_RETRIES) return resp;
      const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
      const delay = Math.max(retryAfter * 1000, 1000 * Math.pow(2, attempt));
      console.warn(`[classifier] 429 rate limit for "${attachment.name}" — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
    throw new Error('unreachable');
  }

  try {
    const resp = await fetchWithRetry();

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Anthropic API ${resp.status}: ${errText}`);
    }

    const data = (await resp.json()) as {
      content: Array<{ type: string; input?: Record<string, unknown>; text?: string }>;
    };

    // Extract tool_use block — map new field names to internal format
    let input: { template_id: string | null; confidence: number; reason: string; issuer_name: string; additional_matches?: Array<{template_id: string; evidence: string; issuer_name: string; confidence: number}>; contract_period?: { start_date: string; end_date: string; covers_full_year: boolean } | null } | null = null;

    const toolBlock = data.content.find((b) => b.type === 'tool_use');
    if (toolBlock?.input) {
      const inp = toolBlock.input as Record<string, unknown>;
      input = {
        template_id: (inp.matched_template_id as string | null) ?? null,
        confidence: (inp.confidence as number) ?? 0,
        reason: (inp.evidence as string) ?? '',
        issuer_name: (inp.issuer_name as string) ?? '',
        additional_matches: Array.isArray(inp.additional_matches) ? inp.additional_matches as Array<{template_id: string; evidence: string; issuer_name: string; confidence: number}> : [],
        contract_period: inp.contract_period as { start_date: string; end_date: string; covers_full_year: boolean } | null ?? null,
      };
    } else {
      // Fallback: try parsing text block as JSON
      const textBlock = data.content.find((b) => b.type === 'text' && b.text);
      if (textBlock?.text) {
        try {
          input = JSON.parse(textBlock.text);
        } catch {
          // ignore parse failure
        }
      }
    }

    if (!input) {
      return {
        templateId: null,
        confidence: 0,
        reason: 'No classification output from AI',
        issuerName: '',
        matchedDocRecordId: null,
        matchedDocName: null,
        matchQuality: null,
      };
    }

    // Match against required docs
    let matchedDocRecordId: string | null = null;
    let matchedDocName: string | null = null;

    let matchQuality: string | null = null;

    if (input.template_id) {
      const match = findBestDocMatch(input.template_id, input.issuer_name, requiredDocs);
      matchedDocRecordId = match.docId;
      matchedDocName = match.matchedDocName;
      matchQuality = match.matchQuality;
    }

    // DL-278: Recovery agent — if classifier returned good evidence but null template, try to recover
    if (!input.template_id && input.confidence >= 0.5 && input.reason.length > 10) {
      console.warn(`[classifier] Null template with conf=${input.confidence} for "${attachment.name}" — invoking recovery agent`);
      const recovered = await recoverTemplateId(
        pCtx.env.ANTHROPIC_API_KEY,
        input.reason,
        input.issuer_name,
        requiredDocs,
        attachment.name,
      );
      if (recovered) {
        input.template_id = recovered.templateId;
        const match = findBestDocMatch(recovered.templateId, input.issuer_name, requiredDocs);
        matchedDocRecordId = match.docId;
        matchedDocName = match.matchedDocName;
        matchQuality = match.matchQuality;
        console.warn(`[classifier] Recovery agent matched: ${recovered.templateId} (conf=${recovered.confidence}) for "${attachment.name}"`);
      }
    }

    // Process additional matches (dual-filing)
    const additionalMatches: AdditionalMatch[] = [];
    if (input.additional_matches && input.additional_matches.length > 0) {
      for (const am of input.additional_matches) {
        if (!am.template_id || am.confidence < 0.5) continue;
        const amMatch = findBestDocMatch(am.template_id, am.issuer_name || '', requiredDocs);
        additionalMatches.push({
          templateId: am.template_id,
          evidence: am.evidence || '',
          issuerName: am.issuer_name || '',
          confidence: am.confidence,
          matchedDocRecordId: amMatch.docId,
          matchedDocName: amMatch.matchedDocName,
          matchQuality: amMatch.matchQuality,
        });
      }
    }

    // DL-268: Parse contract period for rental contracts
    const contractPeriod = input.contract_period
      ? { startDate: input.contract_period.start_date, endDate: input.contract_period.end_date, coversFullYear: input.contract_period.covers_full_year }
      : null;

    return {
      templateId: input.template_id,
      confidence: input.confidence,
      reason: input.reason,
      issuerName: input.issuer_name,
      matchedDocRecordId,
      matchedDocName,
      matchQuality,
      additionalMatches: additionalMatches.length > 0 ? additionalMatches : undefined,
      contractPeriod,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      templateId: null,
      confidence: 0,
      reason: `Classification failed: ${message}`,
      issuerName: '',
      matchedDocRecordId: null,
      matchedDocName: null,
      matchQuality: null,
    };
  }
}

// ---------------------------------------------------------------------------
// checkFileHashDuplicate
// ---------------------------------------------------------------------------

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  fileUrl?: string;
  itemId?: string;
}

export async function checkFileHashDuplicate(
  airtable: ProcessingContext['airtable'],
  sha256: string,
  _reportRecordId: string,
  emailEventRecordId?: string,
): Promise<DuplicateCheckResult> {
  // Exclude records from the current email event to avoid false positives
  // when the same email is processed twice (KV dedup race) or re-sent
  const pendingFilter = emailEventRecordId
    ? `AND({file_hash} = '${sha256}', {email_event} != '${emailEventRecordId}')`
    : `{file_hash} = '${sha256}'`;

  const [pendingRecords, docRecords] = await Promise.all([
    airtable.listAllRecords(TABLES.PENDING_CLASSIFICATIONS, {
      filterByFormula: pendingFilter,
      fields: ['file_url', 'onedrive_item_id'],
      maxRecords: 1,
    }),
    airtable.listAllRecords(TABLES.DOCUMENTS, {
      filterByFormula: `{file_hash} = '${sha256}'`,
      fields: ['file_url', 'onedrive_item_id'],
      maxRecords: 1,
    }),
  ]);

  const match = pendingRecords[0] || docRecords[0];
  if (!match) return { isDuplicate: false };

  const f = match.fields as Record<string, unknown>;
  return {
    isDuplicate: true,
    fileUrl: (f.file_url as string) || undefined,
    itemId: (f.onedrive_item_id as string) || undefined,
  };
}
