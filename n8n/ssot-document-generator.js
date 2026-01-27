/**
 * SSOT Document Generator
 * =======================
 * Single Source of Truth for all document title generation.
 * 
 * This file is the AUTHORITATIVE source for:
 * - Document title templates (Hebrew & English)
 * - Airtable type mappings
 * - Title formatting logic
 * 
 * DO NOT duplicate these templates elsewhere.
 * All document generation must use this module.
 * 
 * Reference: SSOT_required_documents_from_Tally_input.md
 */

// ============================================
// SECTION 2: HEBREW DOCUMENT TITLE TEMPLATES
// ============================================
// Template IDs match the SSOT markdown (T001, T002, etc.)
// Variables use {{var}} syntax
// Bold markers use **text** (converted to HTML on output)

const TEMPLATES = {
  // ----------------------------------------
  // 2.1 General / ID / Residency
  // ----------------------------------------
  // T001
  residency_cert: {
    he: 'אישור תושבות לשנת **{{year}}** – **{{city_name}}**',
    en: 'Residency certificate for **{{year}}** – **{{city_name}}**',
    scope: 'CLIENT',
    category: 'general'
  },
  // T002 - GLOBAL_SINGLE: Must appear only ONCE in entire output
  id_appendix: {
    he: 'ספח ת״ז מעודכן',
    en: 'Updated ID appendix',
    scope: 'GLOBAL_SINGLE',
    category: 'general'
  },
  // T003
  marital_status_change: {
    he: 'מסמכי שינוי סטטוס משפחתי בשנת **{{year}}** – **{{client_name}}** – **{{status_change_details}}**',
    en: 'Marital status change documents for **{{year}}** – **{{client_name}}** – **{{status_change_details}}**',
    scope: 'CLIENT',
    category: 'general'
  },

  // ----------------------------------------
  // 2.2 Children
  // ----------------------------------------
  // T101
  special_ed_approval: {
    he: 'אישור ועדת השמה/ועדת שילוב (חינוך מיוחד)',
    en: 'Special education placement / inclusion committee approval',
    scope: 'CLIENT',
    category: 'children'
  },
  // T102
  child_disability_approval: {
    he: 'אישור שנתי לשנת **{{year}}** על תקבולי קצבת נכות מביטוח לאומי עבור הילד/ה',
    en: 'Annual certificate for **{{year}}** for child disability allowance receipts from National Insurance (Bituach Leumi) – for the child',
    scope: 'CLIENT',
    category: 'children'
  },

  // ----------------------------------------
  // 2.3 Employment (Form 106)
  // ----------------------------------------
  // T201
  form_106: {
    he: 'טופס 106 לשנת **{{year}}** – **{{employer_name}}**',
    en: 'Form 106 for **{{year}}** – **{{employer_name}}**',
    scope: 'CLIENT',
    category: 'employment'
  },
  // T202
  form_106_spouse: {
    he: 'טופס 106 לשנת **{{year}}** – **{{spouse_name}}** – **{{employer_name}}**',
    en: 'Form 106 for **{{year}}** – **{{spouse_name}}** – **{{employer_name}}**',
    scope: 'SPOUSE',
    category: 'employment'
  },

  // ----------------------------------------
  // 2.4 National Insurance
  // ----------------------------------------
  // T301 - Generic client allowance
  nii_allowance_cert: {
    he: 'אישור שנתי לשנת **{{year}}** על תקבולי **{{allowance_type}}** מביטוח לאומי עבור - **{{client_name}}**',
    en: 'Annual certificate for **{{year}}** for **{{allowance_type}}** from National Insurance – for **{{client_name}}**',
    scope: 'CLIENT',
    category: 'nii'
  },
  // T302 - Generic spouse allowance
  nii_allowance_cert_spouse: {
    he: 'אישור שנתי לשנת **{{year}}** על תקבולי **{{allowance_type}}** מביטוח לאומי עבור - **{{spouse_name}}**',
    en: 'Annual certificate for **{{year}}** for **{{allowance_type}}** from National Insurance – for **{{spouse_name}}**',
    scope: 'SPOUSE',
    category: 'nii'
  },
  // T303 - Disability override (נכות)
  nii_disability_cert: {
    he: 'אישור שנתי לשנת **{{year}}** על תקבולי דמי נכות שהתקבלו מביטוח לאומי עבור - **{{person_name}}**',
    en: 'Annual certificate for **{{year}}** for disability payments received from National Insurance – for **{{person_name}}**',
    scope: 'PERSON',
    category: 'nii'
  },
  // T304 - Maternity override (דמי לידה)
  nii_maternity_cert: {
    he: 'אישור שנתי לשנת **{{year}}** על תקבולי דמי לידה מביטוח לאומי עבור - **{{person_name}}**',
    en: 'Annual certificate for **{{year}}** for maternity payments from National Insurance – for **{{person_name}}**',
    scope: 'PERSON',
    category: 'nii'
  },
  // T305 - Survivors (client)
  nii_survivors: {
    he: 'אישור שנתי לשנת **{{year}}** – קצבת שארים (ביטוח לאומי) – **{{survivor_details}}**',
    en: 'Annual certificate for **{{year}}** – Survivors allowance (National Insurance) – **{{survivor_details}}**',
    scope: 'CLIENT',
    category: 'nii'
  },
  // T306 - Survivors (spouse)
  nii_survivors_spouse: {
    he: 'אישור שנתי לשנת **{{year}}** – קצבת שארים (ביטוח לאומי) – **{{spouse_name}}** – **{{survivor_details}}**',
    en: 'Annual certificate for **{{year}}** – Survivors allowance (National Insurance) – **{{spouse_name}}** – **{{survivor_details}}**',
    scope: 'SPOUSE',
    category: 'nii'
  },

  // ----------------------------------------
  // 2.5 Withdrawals
  // ----------------------------------------
  // T401
  pension_withdrawal: {
    he: 'אישור משיכה לשנת **{{year}}** + מס שנוכה – **{{withdrawal_type}}**',
    en: 'Withdrawal certificate for **{{year}}** + tax withheld – **{{withdrawal_type}}**',
    scope: 'CLIENT',
    category: 'pension'
  },
  // T402 - Other withdrawal
  pension_withdrawal_other: {
    he: 'אישור משיכה לשנת **{{year}}** + מס שנוכה – **אחר: {{withdrawal_other_text}}**',
    en: 'Withdrawal certificate for **{{year}}** + tax withheld – **Other: {{withdrawal_other_text}}**',
    scope: 'CLIENT',
    category: 'pension'
  },

  // ----------------------------------------
  // 2.6 Deposits (Insurance Tax Certificates)
  // ----------------------------------------
  // T501
  insurance_tax_cert: {
    he: 'אישור שנתי למס הכנסה לשנת **{{year}}** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**{{deposit_type}}** ב**"{{company_name}}"**',
    en: 'Annual income tax certificate for **{{year}}** (also called an annual **concise** report) for contributions to **{{deposit_type}}** at **"{{company_name}}"**',
    scope: 'CLIENT',
    category: 'deposits'
  },

  // ----------------------------------------
  // 2.7 Securities (Form 867)
  // ----------------------------------------
  // T601
  form_867: {
    he: 'טופס 867 לשנת **{{year}}** – **{{institution_name}}**',
    en: 'Form 867 for **{{year}}** – **{{institution_name}}**',
    scope: 'CLIENT',
    category: 'securities'
  },
  // Form 867 for spouse (if needed)
  form_867_spouse: {
    he: 'טופס 867 לשנת **{{year}}** – **{{spouse_name}}** – **{{institution_name}}**',
    en: 'Form 867 for **{{year}}** – **{{spouse_name}}** – **{{institution_name}}**',
    scope: 'SPOUSE',
    category: 'securities'
  },

  // ----------------------------------------
  // 2.8 Crypto
  // ----------------------------------------
  // T701
  crypto_report: {
    he: 'דוח על הרווחים / הפסדים והמס שנוכה (במידה ונוכה) לשנת **{{year}}** מ**{{crypto_source}}**',
    en: 'Gains/losses report and tax withheld (if withheld) for **{{year}}** from **{{crypto_source}}**',
    scope: 'CLIENT',
    category: 'investments'
  },

  // ----------------------------------------
  // 2.9 Gambling / Prizes
  // ----------------------------------------
  // T801
  gambling_win_cert: {
    he: 'אישור זכייה/פרסים מעל 25,000₪ + מס שנוכה – **{{gambling_source}}**',
    en: 'Winnings/prizes over ₪25,000 + tax withheld – **{{gambling_source}}**',
    scope: 'CLIENT',
    category: 'investments'
  },

  // ----------------------------------------
  // 2.10 Rent
  // ----------------------------------------
  // T901
  rent_contract_income: {
    he: 'חוזה שכירות – דירה מושכרת (הכנסה) – שכ״ד חודשי **{{rent_income_monthly}}**',
    en: 'Rental contract – rented-out apartment (income) – monthly rent **{{rent_income_monthly}}**',
    scope: 'CLIENT',
    category: 'realestate'
  },
  // T902
  rent_contract_expense: {
    he: 'חוזה שכירות – דירה שכורה למגורים (הוצאה) – שכ״ד חודשי **{{rent_expense_monthly}}**',
    en: 'Rental contract – rented apartment for residence (expense) – monthly rent **{{rent_expense_monthly}}**',
    scope: 'CLIENT',
    category: 'realestate'
  },

  // ----------------------------------------
  // 2.11 Inventory
  // ----------------------------------------
  // T1001
  inventory_list: {
    he: 'רשימת ספירת מלאי ליום 31.12.**{{year}}**',
    en: 'Inventory count list as of 31.12.**{{year}}**',
    scope: 'CLIENT',
    category: 'business'
  },

  // ----------------------------------------
  // 2.12 Withholding at Source
  // ----------------------------------------
  // T1101 - Income Tax withholding
  wht_approval_income_tax: {
    he: 'אישור ניכוי מס הכנסה במקור – **{{withholding_client_name}}**',
    en: 'Income tax withholding at source certificate – **{{withholding_client_name}}**',
    scope: 'CLIENT',
    category: 'withholding'
  },
  // T1102 - NII withholding
  wht_approval_nii: {
    he: 'אישור ניכוי ביטוח לאומי במקור – **{{withholding_client_name}}**',
    en: 'National Insurance withholding at source certificate – **{{withholding_client_name}}**',
    scope: 'CLIENT',
    category: 'withholding'
  },
  // Generic WHT (backward compatibility)
  wht_approval: {
    he: 'אישור ניכוי מס במקור / ביטוח לאומי במקור – **{{withholding_client_name}}**',
    en: 'Tax/NII withholding at source certificate – **{{withholding_client_name}}**',
    scope: 'CLIENT',
    category: 'withholding'
  },

  // ----------------------------------------
  // 2.13 Donations
  // ----------------------------------------
  // T1201
  donation_receipts: {
    he: 'קבלות מקוריות מרוכזות על תרומות לפי סעיף 46 (מעל 200₪) (יש לשלוח קבלות רק ממוסדות שלהם יש סעיף 46. ניתן לראות זאת בקבלה.)',
    en: 'Consolidated original donation receipts under section 46 (over ₪200) (send receipts only from eligible section-46 institutions; see the receipt)',
    scope: 'CLIENT',
    category: 'donations'
  },

  // ----------------------------------------
  // 2.14 Army Release
  // ----------------------------------------
  // T1301
  army_release_cert: {
    he: 'אישור שחרור משירות (ב־3 שנים האחרונות) (ניתן להוציא את האישור מאתר ׳אישוריא׳)',
    en: 'Army discharge certificate (within the last 3 years) (can be issued via the "Certificates" site)',
    scope: 'CLIENT',
    category: 'military'
  },

  // ----------------------------------------
  // 2.15 Memorial / Institution / Medical
  // ----------------------------------------
  // T1401
  memorial_receipts: {
    he: 'קבלות ומסמכים **רלוונטיים** על הוצאות הנצחה – **{{relationship_details}}**',
    en: 'Receipts and **relevant** documents for memorial expenses – **{{relationship_details}}**',
    scope: 'CLIENT',
    category: 'memorial'
  },
  // T1402
  institution_approval: {
    he: 'מסמך רשמי (קרוב במוסד)',
    en: 'Official document (relative in an institution)',
    scope: 'CLIENT',
    category: 'family'
  },
  // T1403
  medical_committee: {
    he: 'מסמך רפואי רשמי לעניין פטור/הקלות במס – **{{medical_details}}**',
    en: 'Official medical document for tax exemption/relief – **{{medical_details}}**',
    scope: 'CLIENT',
    category: 'medical'
  },

  // ----------------------------------------
  // 2.16 Degree
  // ----------------------------------------
  // T1501
  degree_cert: {
    he: 'אישור זכאות לתואר אקדמי מ**{{university_name}}** – **{{degree_type}}**',
    en: 'Academic degree eligibility certificate from **{{university_name}}** – **{{degree_type}}**',
    scope: 'CLIENT',
    category: 'education'
  },

  // ----------------------------------------
  // 2.17 Foreign Income
  // ----------------------------------------
  // T1601 - Evidence documents (when return NOT filed)
  foreign_income_evidence: {
    he: 'אסמכתאות להכנסות מחו״ל + מס ששולם בחו״ל – **{{country}}** – **{{income_type}}**',
    en: 'Evidence documents for foreign income + tax paid abroad – **{{country}}** – **{{income_type}}**',
    scope: 'CLIENT',
    category: 'foreign'
  },
  // T1602 - Foreign tax return (when return WAS filed)
  foreign_tax_return: {
    he: 'דו״ח מס שהוגש במדינה – **{{country}}**',
    en: 'Foreign tax return filed in the country – **{{country}}**',
    scope: 'CLIENT',
    category: 'foreign'
  },

  // ----------------------------------------
  // 2.18 Other Incomes
  // ----------------------------------------
  // T1701
  other_income_doc: {
    he: 'מסמך תומך להכנסה נוספת – **{{other_income_text}}**',
    en: 'Supporting document for additional income – **{{other_income_text}}**',
    scope: 'CLIENT',
    category: 'other'
  },

  // ----------------------------------------
  // Additional / Legacy Templates
  // ----------------------------------------
  // Alimony judgment (for backward compatibility)
  alimony_judgment: {
    he: 'פסק דין / הסכם גירושין (מזונות)',
    en: 'Divorce judgment / agreement (alimony)',
    scope: 'CLIENT',
    category: 'family'
  }
};

// ============================================
// AIRTABLE TYPE MAPPINGS
// ============================================
// Maps template keys to Airtable single-select values

const AIRTABLE_TYPES = {
  'residency_cert': 'Residency_Cert',
  'id_appendix': 'ID_Appendix',
  'marital_status_change': 'Marital_Status_Change',
  'special_ed_approval': 'Special_Ed_Approval',
  'child_disability_approval': 'Child_Disability_Approval',
  'form_106': 'Form_106',
  'form_106_spouse': 'Form_106_Spouse',
  'nii_allowance_cert': 'NII_Allowance_Cert',
  'nii_allowance_cert_spouse': 'NII_Allowance_Cert_Spouse',
  'nii_disability_cert': 'NII_Allowance_Cert',
  'nii_maternity_cert': 'NII_Allowance_Cert',
  'nii_survivors': 'NII_Survivors',
  'nii_survivors_spouse': 'NII_Survivors_Spouse',
  'pension_withdrawal': 'Pension_Withdrawal',
  'pension_withdrawal_other': 'Pension_Withdrawal',
  'insurance_tax_cert': 'Insurance_Tax_Cert',
  'form_867': 'Form_867',
  'form_867_spouse': 'Form_867_Spouse',
  'crypto_report': 'Crypto_Report',
  'gambling_win_cert': 'Gambling_Win_Cert',
  'rent_contract_income': 'Rent_Contract_Income',
  'rent_contract_expense': 'Rent_Contract_Expense',
  'inventory_list': 'Inventory_List',
  'wht_approval': 'WHT_Approval',
  'wht_approval_income_tax': 'WHT_Approval_IncomeTax',
  'wht_approval_nii': 'WHT_Approval_NII',
  'donation_receipts': 'Donation_Receipts',
  'army_release_cert': 'Army_Release_Cert',
  'memorial_receipts': 'Memorial_Receipts',
  'institution_approval': 'Institution_Approval',
  'medical_committee': 'Medical_Committee',
  'degree_cert': 'Degree_Cert',
  'foreign_income_evidence': 'Foreign_Income_Evidence',
  'foreign_tax_return': 'Foreign_Tax_Return',
  'other_income_doc': 'Other_Income_Doc',
  'alimony_judgment': 'Alimony_Judgment'
};

// ============================================
// CATEGORY DEFINITIONS
// ============================================

const CATEGORIES = {
  general: { emoji: '📋', he: 'כללי', en: 'General' },
  children: { emoji: '👶', he: 'ילדים', en: 'Children' },
  employment: { emoji: '💼', he: 'הכנסות מעבודה', en: 'Employment Income' },
  nii: { emoji: '🛡️', he: 'ביטוח לאומי', en: 'National Insurance' },
  pension: { emoji: '🏦', he: 'פנסיה ומשיכות', en: 'Pension & Withdrawals' },
  deposits: { emoji: '💰', he: 'הפקדות', en: 'Deposits' },
  securities: { emoji: '📈', he: 'ניירות ערך', en: 'Securities' },
  investments: { emoji: '📊', he: 'השקעות', en: 'Investments' },
  realestate: { emoji: '🏠', he: 'נדל״ן', en: 'Real Estate' },
  business: { emoji: '🏪', he: 'עסק', en: 'Business' },
  withholding: { emoji: '📄', he: 'ניכויים במקור', en: 'Withholding' },
  donations: { emoji: '❤️', he: 'תרומות', en: 'Donations' },
  military: { emoji: '🎖️', he: 'צבא', en: 'Military' },
  memorial: { emoji: '🕯️', he: 'הנצחה', en: 'Memorial' },
  family: { emoji: '👨‍👩‍👧', he: 'משפחה', en: 'Family' },
  medical: { emoji: '🏥', he: 'רפואי', en: 'Medical' },
  education: { emoji: '🎓', he: 'השכלה', en: 'Education' },
  foreign: { emoji: '🌍', he: 'חו״ל', en: 'Foreign' },
  other: { emoji: '📋', he: 'אחר', en: 'Other' }
};

// ============================================
// FORMAT TITLE FUNCTION
// ============================================

/**
 * Format a document title using SSOT templates
 * 
 * @param {string} templateKey - The template key (e.g., 'form_106', 'id_appendix')
 * @param {object} params - Parameters to replace in the template
 * @param {string} lang - Language code ('he' or 'en'), defaults to 'he'
 * @returns {string} Formatted title with HTML bold tags
 */
function formatTitle(templateKey, params = {}, lang = 'he') {
  const template = TEMPLATES[templateKey];
  
  if (!template) {
    console.warn(`[SSOT] Template not found: ${templateKey}`);
    return `[MISSING_TEMPLATE: ${templateKey}]`;
  }
  
  // Get template text for the requested language
  let text = template[lang] || template.he;
  
  if (!text) {
    console.warn(`[SSOT] No text for template ${templateKey} in language ${lang}`);
    return `[NO_TEXT: ${templateKey}]`;
  }
  
  // Replace all placeholders
  // Support both {{var}} and {var} syntaxes
  for (const [key, val] of Object.entries(params)) {
    const value = val != null ? String(val) : '';
    text = text.split(`{{${key}}}`).join(value);
    text = text.split(`{${key}}`).join(value);
  }
  
  // Check for unreplaced placeholders
  const unreplaced = text.match(/\{\{?\w+\}?\}/g);
  if (unreplaced) {
    console.warn(`[SSOT] Unreplaced placeholders in ${templateKey}:`, unreplaced);
  }
  
  // Convert markdown bold (**text**) to HTML (<b>text</b>)
  text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  
  return text;
}

/**
 * Get the Airtable type for a template key
 * 
 * @param {string} templateKey - The template key
 * @returns {string} Airtable type value
 */
function getAirtableType(templateKey) {
  return AIRTABLE_TYPES[templateKey] || templateKey;
}

/**
 * Get template metadata
 * 
 * @param {string} templateKey - The template key
 * @returns {object|null} Template object with scope, category, etc.
 */
function getTemplate(templateKey) {
  return TEMPLATES[templateKey] || null;
}

/**
 * Get category display info
 * 
 * @param {string} categoryKey - The category key
 * @param {string} lang - Language code
 * @returns {string} Category display string with emoji
 */
function getCategoryDisplay(categoryKey, lang = 'he') {
  const cat = CATEGORIES[categoryKey];
  if (!cat) return categoryKey;
  return `${cat.emoji} ${cat[lang] || cat.he}`;
}

/**
 * List all available template keys
 * 
 * @returns {string[]} Array of template keys
 */
function listTemplateKeys() {
  return Object.keys(TEMPLATES);
}

/**
 * Validate that a template key exists
 * 
 * @param {string} templateKey - The template key to validate
 * @returns {boolean} True if template exists
 */
function templateExists(templateKey) {
  return templateKey in TEMPLATES;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Templates
  TEMPLATES,
  SSOT_TEMPLATES: TEMPLATES, // Alias for backward compatibility
  
  // Type mappings
  AIRTABLE_TYPES,
  
  // Categories
  CATEGORIES,
  
  // Functions
  formatTitle,
  getAirtableType,
  getTemplate,
  getCategoryDisplay,
  listTemplateKeys,
  templateExists
};