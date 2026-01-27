/**
 * SSOT DOCUMENT GENERATOR - SINGLE SOURCE OF TRUTH
 * ==================================================
 *
 * This module is the AUTHORITATIVE SOURCE for all document title generation.
 * It implements the exact requirements from:
 * SSOT_required_documents_from_Tally_input.md
 *
 * Fetch from: https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/n8n/ssot-document-generator.js
 *
 * CRITICAL RULES ENFORCED:
 * 1. Exact Hebrew wording from SSOT (character-perfect)
 * 2. Bold formatting on ALL dynamic values (employer names, amounts, etc.)
 * 3. Spouse name insertion in MIDDLE of spouse document titles
 * 4. Special wording for NII נכות and דמי לידה
 * 5. Exact deposits template with (נקרא גם דוח שנתי מקוצר)
 * 6. Form 867 deduplication by normalized institution name
 * 7. Appendix consolidation (only ONE ספח ת"ז)
 * 8. Foreign income FRA01 conditional logic
 * 9. All other SSOT requirements
 *
 * Version: 1.0.0
 * Last Updated: 2026-01-26
 */

// ========================================
// SSOT DOCUMENT TITLE TEMPLATES
// ========================================
// These are the EXACT templates from SSOT markdown.
// DO NOT modify without updating SSOT document first!

const SSOT_TEMPLATES = {
  // ============ IDENTITY & STATUS ============

  residency_cert: {
    he: 'אישור תושבות לשנת **{year}** – **{city_name}**',
    en: 'Residency certificate for **{year}** – **{city_name}**',
    params: ['year', 'city_name'],
    category: 'personal'
  },

  id_appendix_with_status_change: {
    he: 'ספח ת״ז מעודכן + מסמכי שינוי סטטוס משפחתי (לפי הצורך) – **{client_name}** – **{status_change_date}**',
    en: 'Updated ID appendix + marital status change documents (as needed) – **{client_name}** – **{status_change_date}**',
    params: ['client_name', 'status_change_date'],
    category: 'personal',
    notes: 'Used when marital status changed'
  },

  id_appendix_with_children: {
    he: 'ספח ת״ז עדכני כולל פרטי ילדים – **{client_name}**',
    en: 'Updated ID appendix including children details – **{client_name}**',
    params: ['client_name'],
    category: 'family'
  },

  child_id_appendix: {
    he: 'ספח ת״ז מעודכן – יש לשלוח ספח ת״ז בו מופיע הילד/ה שהצטרפו למשפחה',
    en: 'Updated ID appendix showing the child who joined the family',
    params: [],
    category: 'family'
  },

  army_release_cert: {
    he: 'אישור שחרור משירות (ב־3 שנים האחרונות) (ניתן להוציא את האישור מאתר ״אישורים״)',
    en: 'Military discharge certificate (within last 3 years) (can be obtained from "Certificates" website)',
    params: [],
    category: 'personal'
  },

  // ============ CHILDREN ============

  special_ed_approval: {
    he: 'אישור ועדת השמה/ועדת שילוב (חינוך מיוחד)',
    en: 'Placement/integration committee approval (special education)',
    params: [],
    category: 'children'
  },

  child_disability_cert: {
    he: 'אישור שנתי לשנת **{year}** על תקבולי קצבת נכות מביטוח לאומי עבור הילד/ה',
    en: 'Annual certificate for **{year}** for child disability allowance from NII',
    params: ['year'],
    category: 'children'
  },

  // ============ EMPLOYMENT (FORM 106) ============

  form_106_client: {
    he: 'טופס 106 לשנת **{year}** – **{employer}**',
    en: 'Form 106 for **{year}** from **{employer}**',
    params: ['year', 'employer'],
    category: 'employment',
    notes: 'One per employer for client'
  },

  form_106_spouse: {
    he: 'טופס 106 לשנת **{year}** – **{spouse_name}** – **{employer}**',
    en: 'Form 106 for **{year}** – **{spouse_name}** – **{employer}**',
    params: ['year', 'spouse_name', 'employer'],
    category: 'employment',
    notes: 'CRITICAL: Spouse name MUST be in the MIDDLE, not at end!'
  },

  // ============ NATIONAL INSURANCE ============

  nii_disability_client: {
    he: 'אישור שנתי לשנת **{year}** על תקבולי דמי נכות שהתקבלו מביטוח לאומי עבור - **{client_name}**',
    en: 'Annual certificate for **{year}** for disability payments received from NII for - **{client_name}**',
    params: ['year', 'client_name'],
    category: 'nii',
    specialWording: 'שהתקבלו מביטוח לאומי (only for נכות!)'
  },

  nii_maternity: {
    he: 'אישור שנתי לשנת **{year}** על תקבולי דמי לידה מביטוח לאומי עבור - **{name}**',
    en: 'Annual certificate for **{year}** for maternity payments from NII for - **{name}**',
    params: ['year', 'name'],
    category: 'nii',
    specialWording: 'דמי לידה (not דמי נכות!)'
  },

  nii_generic_allowance: {
    he: 'אישור שנתי לשנת **{year}** על תקבולי **{allowance_type}** מביטוח לאומי עבור - **{name}**',
    en: 'Annual certificate for **{year}** for **{allowance_type}** payments from NII for - **{name}**',
    params: ['year', 'allowance_type', 'name'],
    category: 'nii',
    notes: 'Generic template for other NII types (unemployment, reserves, etc.)'
  },

  nii_survivors: {
    he: 'אישור שנתי לשנת **{year}** – קצבת שארים (ביטוח לאומי) – **{survivor_details}**',
    en: 'Annual certificate for **{year}** – survivors pension (NII) – **{survivor_details}**',
    params: ['year', 'survivor_details'],
    category: 'nii'
  },

  nii_survivors_spouse: {
    he: 'אישור שנתי לשנת **{year}** – קצבת שארים (ביטוח לאומי) – **{spouse_name}** – **{survivor_details}**',
    en: 'Annual certificate for **{year}** – survivors pension (NII) – **{spouse_name}** – **{survivor_details}**',
    params: ['year', 'spouse_name', 'survivor_details'],
    category: 'nii'
  },

  // ============ WITHDRAWALS ============

  pension_withdrawal: {
    he: 'אישור משיכה לשנת **{year}** + מס שנוכה – **{withdrawal_type}**',
    en: 'Withdrawal certificate for **{year}** + tax withheld – **{withdrawal_type}**',
    params: ['year', 'withdrawal_type'],
    category: 'pension',
    notes: 'One per withdrawal type. DO NOT ask "withdrawn from which company"!'
  },

  pension_withdrawal_other: {
    he: 'אישור משיכה לשנת **{year}** + מס שנוכה – **אחר: {withdrawal_other_text}**',
    en: 'Withdrawal certificate for **{year}** + tax withheld – **Other: {withdrawal_other_text}**',
    params: ['year', 'withdrawal_other_text'],
    category: 'pension'
  },

  // ============ DEPOSITS (EXACT SSOT WORDING!) ============

  insurance_deposit: {
    he: 'אישור שנתי למס הכנסה לשנת **{year}** (**מקוצר**) (נקרא גם דוח שנתי מקוצר) על ההפקדות ל**{deposit_type}** ב**"{company_name}"**',
    en: 'Annual tax certificate for **{year}** (**shortened**) (also called shortened annual report) for contributions to **{deposit_type}** at **"{company_name}"**',
    params: ['year', 'deposit_type', 'company_name'],
    category: 'insurance',
    notes: [
      'CRITICAL: Must include (נקרא גם דוח שנתי מקוצר)',
      'CRITICAL: Must include על ההפקדות',
      'CRITICAL: מקוצר must be bold',
      'CRITICAL: Company name in quotes and bold'
    ]
  },

  // ============ SECURITIES (FORM 867) ============

  form_867: {
    he: 'טופס 867 לשנת **{year}** – **{institution_name}**',
    en: 'Form 867 for **{year}** – **{institution_name}**',
    params: ['year', 'institution_name'],
    category: 'investments',
    notes: 'MUST deduplicate by normalized institution name!'
  },

  // ============ CRYPTO ============

  crypto_report: {
    he: 'דוח על הרווחים / הפסדים והמס שנוכה (במידה ונוכה) לשנת **{year}** מ**{crypto_source}**',
    en: 'Report on gains/losses and tax withheld (if any) for **{year}** from **{crypto_source}**',
    params: ['year', 'crypto_source'],
    category: 'investments'
  },

  // ============ GAMBLING / PRIZES ============

  gambling_win_cert: {
    he: 'אישור זכייה/פרסים מעל 25,000₪ + מס שנוכה – **{gambling_source}**',
    en: 'Proof of winnings/prizes over 25,000₪ + tax withheld – **{gambling_source}**',
    params: ['gambling_source'],
    category: 'other'
  },

  // ============ RENT ============

  rent_contract_income: {
    he: 'חוזה שכירות – דירה מושכרת (הכנסה) – שכ״ד חודשי **{rent_income_monthly}**',
    en: 'Rental contract – rented out apartment (income) – monthly rent **{rent_income_monthly}**',
    params: ['rent_income_monthly'],
    category: 'realestate'
  },

  rent_contract_expense: {
    he: 'חוזה שכירות – דירה שכורה למגורים (הוצאה) – שכ״ד חודשי **{rent_expense_monthly}**',
    en: 'Rental contract – rented for living (expense) – monthly rent **{rent_expense_monthly}**',
    params: ['rent_expense_monthly'],
    category: 'realestate'
  },

  // ============ INVENTORY ============

  inventory_list: {
    he: 'רשימת ספירת מלאי ליום 31.12.**{year}**',
    en: 'Inventory count list as of 31.12.**{year}**',
    params: ['year'],
    category: 'business'
  },

  // ============ WITHHOLDING TAX ============

  wht_income_tax: {
    he: 'אישור ניכוי מס הכנסה במקור – **{withholding_client_name}**',
    en: 'Income tax withholding approval – **{withholding_client_name}**',
    params: ['withholding_client_name'],
    category: 'withholding',
    notes: 'One per client who withheld income tax - SEPARATE from NII withholding!'
  },

  wht_nii: {
    he: 'אישור ניכוי ביטוח לאומי במקור – **{withholding_client_name}**',
    en: 'National Insurance withholding approval – **{withholding_client_name}**',
    params: ['withholding_client_name'],
    category: 'withholding',
    notes: 'One per client who withheld NII - SEPARATE from income tax withholding!'
  },

  // DEPRECATED - Use wht_income_tax or wht_nii instead
  wht_approval: {
    he: 'אישור ניכוי מס במקור / ביטוח לאומי במקור – **{withholding_client_name}**',
    en: 'Withholding tax / NII approval – **{withholding_client_name}**',
    params: ['withholding_client_name'],
    category: 'withholding',
    notes: 'DEPRECATED: Use separate wht_income_tax and wht_nii templates'
  },

  // ============ DONATIONS ============

  donation_receipts: {
    he: 'קבלות מקוריות מרוכזות על תרומות לפי סעיף 46 (מעל 200₪) (יש לשלוח קבלות רק ממוסדות שלהם יש סעיף 46. ניתן לראות זאת בקבלה.)',
    en: 'Original consolidated donation receipts per Section 46 (over 200₪) (send receipts only from institutions with Section 46; this appears on the receipt)',
    params: [],
    category: 'donations',
    notes: 'CRITICAL: Must include סעיף 46 note text'
  },

  // ============ MEMORIAL / INSTITUTION / MEDICAL ============

  memorial_receipts: {
    he: 'קבלות ומסמכים **רלוונטיים** על הוצאות הנצחה + הוכחת קרבה – **{relationship_details}**',
    en: '**Relevant** receipts and documents for memorial expenses + proof of relationship – **{relationship_details}**',
    params: ['relationship_details'],
    category: 'health',
    notes: 'CRITICAL: רלוונטיים must be bold!'
  },

  institution_approval: {
    he: 'מסמך רשמי + הוכחת קרבה (קרוב במוסד)',
    en: 'Official document + proof of relationship (relative in institution)',
    params: [],
    category: 'health'
  },

  medical_committee: {
    he: 'מסמך רפואי רשמי לעניין פטור/הקלות במס – **{medical_details}**',
    en: 'Official medical document for tax exemption/relief – **{medical_details}**',
    params: ['medical_details'],
    category: 'health'
  },

  // ============ DEGREE ============

  degree_cert: {
    he: 'אישור זכאות לתואר אקדמי מ**{university_name}** – **{degree_type}**',
    en: 'Academic degree eligibility certificate from **{university_name}** – **{degree_type}**',
    params: ['university_name', 'degree_type'],
    category: 'education'
  },

  // ============ FOREIGN INCOME (FRA01) ============

  foreign_income_evidence: {
    he: 'אסמכתאות להכנסות מחו״ל + מס ששולם בחו״ל – **{country}** – **{income_type}**',
    en: 'Evidence of foreign income + foreign tax paid – **{country}** – **{income_type}**',
    params: ['country', 'income_type'],
    category: 'other',
    notes: 'ALWAYS required when foreign income exists'
  },

  foreign_tax_return: {
    he: 'דו״ח מס שהוגש במדינה – **{country}**',
    en: 'Tax return filed in the country – **{country}**',
    params: ['country'],
    category: 'other',
    notes: 'ONLY required if foreign_return_filed = YES'
  },

  // ============ OTHER INCOME ============

  other_income_doc: {
    he: 'מסמך תומך להכנסה נוספת – **{other_income_text}**',
    en: 'Supporting document for additional income – **{other_income_text}**',
    params: ['other_income_text'],
    category: 'other'
  }
};

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Normalize institution name for deduplication
 * Removes common prefixes and normalizes whitespace
 */
function normalizeInstitutionName(name) {
  if (!name) return '';

  let normalized = String(name).trim();

  // Remove common prefixes (case-insensitive)
  const prefixesToRemove = ['בנק ', 'Bank ', 'בית השקעות ', 'Investment House '];
  for (const prefix of prefixesToRemove) {
    const regex = new RegExp('^' + prefix, 'i');
    normalized = normalized.replace(regex, '');
  }

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Lowercase for comparison
  return normalized.toLowerCase();
}

/**
 * Convert markdown bold to HTML
 */
function markdownToHtml(text) {
  if (!text) return '';
  return String(text).replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
}

/**
 * Clean and bold a value (for user-entered data)
 */
function cleanAndBold(value) {
  if (!value) return '';
  const cleaned = String(value).trim();
  return `<b>${cleaned}</b>`;
}

/**
 * Format document title using SSOT template
 * @param {string} templateKey - Key from SSOT_TEMPLATES
 * @param {object} params - Parameters to fill (year, employer, etc.)
 * @param {object} options - { lang: 'he'|'en', person: 'client'|'spouse' }
 * @returns {object} { he: '...', en: '...' }
 */
function formatDocumentTitle(templateKey, params = {}, options = {}) {
  const lang = options.lang || 'he';
  const template = SSOT_TEMPLATES[templateKey];

  if (!template) {
    console.warn(`SSOT WARNING: Unknown template key: ${templateKey}`);
    return { he: templateKey, en: templateKey };
  }

  let text = lang === 'he' ? template.he : template.en;

  // Replace all placeholders
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `{${key}}`;
    const replacementValue = value || `[${key}]`;
    text = text.replaceAll(placeholder, replacementValue);
  }

  // Convert markdown bold to HTML
  text = markdownToHtml(text);

  return { he: text, en: text };
}

/**
 * Apply SSOT business rules to document list
 * Implements:
 * - Form 867 deduplication by institution name
 * - Appendix consolidation
 * - Foreign income FRA01 conditional logic
 * @param {array} documents - Raw document list
 * @param {object} context - { year, client_name, spouse_name, answers }
 * @returns {array} Processed document list
 */
function applyBusinessRules(documents, context) {
  const { answers = {} } = context;
  const processed = [...documents];

  // Rule 1: Form 867 deduplication by normalized institution name
  const form867Docs = processed.filter(d => d.type === 'Form_867');
  const form867Map = new Map();

  form867Docs.forEach(doc => {
    // Extract institution name from issuer_name
    // Assumes format: "טופס 867 לשנת 2025 – <b>institution</b>"
    const match = doc.issuer_name.match(/<b>(.*?)<\/b>/);
    const institutionName = match ? match[1] : doc.issuer_name;
    const normalized = normalizeInstitutionName(institutionName);

    if (!form867Map.has(normalized)) {
      form867Map.set(normalized, doc);
    } else {
      // Mark duplicate for removal
      doc._remove = true;
    }
  });

  // Rule 2: Appendix consolidation - keep only ONE
  const appendixDocs = processed.filter(d =>
    d.type === 'ID_Appendix' || d.type === 'Child_ID_Appendix'
  );

  if (appendixDocs.length > 1) {
    // Keep first, mark others for removal
    appendixDocs.slice(1).forEach(doc => {
      doc._remove = true;
    });

    // Update first appendix to generic wording
    if (appendixDocs[0]) {
      appendixDocs[0].issuer_name = 'ספח ת״ז מעודכן';
      appendixDocs[0].issuer_name_en = 'Updated ID Appendix';
    }
  }

  // Rule 3: Foreign income FRA01 logic
  // Check if foreign tax return was filed
  const foreignTaxReturnKey_he = 'question_487oPA';
  const foreignTaxReturnKey_en = 'question_e6r79k';
  const foreignTaxReturnFiled = answers[foreignTaxReturnKey_he] || answers[foreignTaxReturnKey_en];

  const skipForeignTaxReturn =
    String(foreignTaxReturnFiled || '').trim().toLowerCase() === 'כן' ||
    String(foreignTaxReturnFiled || '').trim().toLowerCase() === 'yes';

  if (skipForeignTaxReturn) {
    // Remove Foreign_Tax_Return docs
    processed.forEach(doc => {
      if (doc.type === 'Foreign_Tax_Return' || doc.document_key.includes('foreign_tax_return')) {
        doc._remove = true;
      }
    });
  }

  // Remove marked documents
  return processed.filter(d => !d._remove);
}

/**
 * Determine which NII template to use based on benefit type
 * @param {string} benefitType - Raw benefit type from Tally (e.g., "נכות", "דמי לידה")
 * @param {boolean} isSpouse - Whether this is for spouse
 * @returns {string} Template key to use
 */
function selectNIITemplate(benefitType, isSpouse = false) {
  const normalized = String(benefitType || '').trim();

  // Special wording for נכות (disability)
  if (normalized === 'נכות' || normalized.toLowerCase() === 'disability') {
    return isSpouse ? 'nii_disability_spouse' : 'nii_disability_client';
  }

  // Special wording for דמי לידה (maternity)
  if (normalized === 'דמי לידה' || normalized.toLowerCase() === 'maternity benefits') {
    return 'nii_maternity';
  }

  // Generic template for others (unemployment, reserves, work injury, etc.)
  return 'nii_generic_allowance';
}

// Add missing spouse disability template
SSOT_TEMPLATES.nii_disability_spouse = {
  he: 'אישור שנתי לשנת **{year}** על תקבולי דמי נכות שהתקבלו מביטוח לאומי עבור - **{spouse_name}**',
  en: 'Annual certificate for **{year}** for disability payments received from NII for - **{spouse_name}**',
  params: ['year', 'spouse_name'],
  category: 'nii',
  specialWording: 'שהתקבלו מביטוח לאומי (only for נכות!)'
};

// ========================================
// EXPORT (CommonJS + ES6 Dual Export)
// ========================================

// CommonJS export for n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SSOT_TEMPLATES,
    formatDocumentTitle,
    applyBusinessRules,
    selectNIITemplate,
    normalizeInstitutionName,
    cleanAndBold,
    markdownToHtml
  };
}

// ES6 export for web
if (typeof export !== 'undefined') {
  export {
    SSOT_TEMPLATES,
    formatDocumentTitle,
    applyBusinessRules,
    selectNIITemplate,
    normalizeInstitutionName,
    cleanAndBold,
    markdownToHtml
  };
}

// Browser global fallback
if (typeof window !== 'undefined') {
  window.SSOTDocumentGenerator = {
    SSOT_TEMPLATES,
    formatDocumentTitle,
    applyBusinessRules,
    selectNIITemplate,
    normalizeInstitutionName,
    cleanAndBold,
    markdownToHtml
  };
}
