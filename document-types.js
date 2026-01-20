/**
 * Document Types Registry - Single Source of Truth
 *
 * All document type definitions in one place.
 * When you need to add, modify, or remove a document type, only edit this file.
 *
 * Template placeholders:
 * - {year} - Tax year
 * - {employer} - Employer name
 * - {institution} - Bank/financial institution name
 * - {company} - Insurance company name
 * - {name} - Person's name (client or spouse)
 * - {type} - Insurance type (pension, study fund, etc.)
 * - {platform} - Crypto platform name
 * - {withdrawal_type} - Type of withdrawal
 */

// ============================================================================
// CATEGORIES
// ============================================================================
export const CATEGORIES = {
    employment: {
        id: 'employment',
        emoji: '💼',
        name_he: 'הכנסות מעבודה',
        name_en: 'Employment Income',
        order: 1
    },
    banks: {
        id: 'banks',
        emoji: '🏦',
        name_he: 'בנקים ושוק ההון',
        name_en: 'Banks & Capital Markets',
        order: 2
    },
    insurance: {
        id: 'insurance',
        emoji: '🛡️',
        name_he: 'ביטוח, פנסיה וקצבאות',
        name_en: 'Insurance, Pension & Benefits',
        order: 3
    },
    housing: {
        id: 'housing',
        emoji: '🏠',
        name_he: 'מגורים ונדל"ן',
        name_en: 'Housing & Real Estate',
        order: 4
    },
    personal: {
        id: 'personal',
        emoji: '📋',
        name_he: 'אישי ותרומות',
        name_en: 'Personal & Donations',
        order: 5
    },
    additional: {
        id: 'additional',
        emoji: '💰',
        name_he: 'הכנסות נוספות',
        name_en: 'Additional Income',
        order: 6
    },
    other: {
        id: 'other',
        emoji: '📋',
        name_he: 'אחר',
        name_en: 'Other',
        order: 7
    }
};

// ============================================================================
// WITHDRAWAL TYPES (for pension/provident fund withdrawals)
// ============================================================================
export const WITHDRAWAL_TYPES = {
    severance: {
        id: 'severance',
        name_he: 'פיצויי פיטורין',
        name_en: 'Severance pay'
    },
    retirement_grant: {
        id: 'retirement_grant',
        name_he: 'מענק פרישה',
        name_en: 'Retirement grant'
    },
    pension_fund: {
        id: 'pension_fund',
        name_he: 'משיכת קרן פנסיה',
        name_en: 'Pension fund withdrawal'
    },
    study_fund: {
        id: 'study_fund',
        name_he: 'משיכת קרן השתלמות',
        name_en: 'Study fund withdrawal'
    },
    investment_provident: {
        id: 'investment_provident',
        name_he: 'משיכת קופת גמל להשקעה',
        name_en: 'Investment provident fund withdrawal'
    },
    lump_sum: {
        id: 'lump_sum',
        name_he: 'משיכת תגמולים (הוני)',
        name_en: 'Lump-sum withdrawal'
    },
    pension_annuity: {
        id: 'pension_annuity',
        name_he: 'קצבה / היוון קצבה',
        name_en: 'Pension / pension commutation'
    }
};

// ============================================================================
// DOCUMENT TYPES
// ============================================================================
export const DOCUMENT_TYPES = {
    // -------------------------------------------------------------------------
    // EMPLOYMENT (💼)
    // -------------------------------------------------------------------------
    form_106: {
        id: 'form_106',
        category: 'employment',
        name_he: 'טופס 106 לשנת {year} מ{employer}',
        name_en: 'Form 106 for {year} from {employer}',
        // Dropdown display (without placeholders)
        dropdown_he: 'טופס 106',
        dropdown_en: 'Form 106',
        requires_detail: true,
        detail: {
            key: 'employer',
            label_he: 'שם המעסיק',
            label_en: 'Employer name',
            placeholder_he: 'לדוגמה: חברת ABC בע"מ',
            placeholder_en: 'e.g.: ABC Ltd.'
        },
        notes_he: null,
        notes_en: null
    },

    form_106_spouse: {
        id: 'form_106_spouse',
        category: 'employment',
        name_he: 'טופס 106 לשנת {year} מ{employer} - בן/בת זוג',
        name_en: 'Form 106 for {year} from {employer} - Spouse',
        dropdown_he: 'טופס 106 - בן/בת זוג',
        dropdown_en: 'Form 106 - Spouse',
        requires_detail: true,
        detail: {
            key: 'employer',
            label_he: 'שם המעסיק של בן/בת הזוג',
            label_en: 'Spouse\'s employer name',
            placeholder_he: 'לדוגמה: חברת XYZ בע"מ',
            placeholder_en: 'e.g.: XYZ Ltd.'
        },
        notes_he: null,
        notes_en: null
    },

    // -------------------------------------------------------------------------
    // BANKS & CAPITAL MARKETS (🏦)
    // -------------------------------------------------------------------------
    form_867: {
        id: 'form_867',
        category: 'banks',
        name_he: 'טופס 867 לשנת {year} מ{institution}',
        name_en: 'Form 867 for {year} from {institution}',
        dropdown_he: 'טופס 867',
        dropdown_en: 'Form 867',
        requires_detail: true,
        detail: {
            key: 'institution',
            label_he: 'שם הבנק / המוסד הפיננסי',
            label_en: 'Bank / Financial institution name',
            placeholder_he: 'לדוגמה: בנק הפועלים, מיטב דש',
            placeholder_en: 'e.g.: Bank Hapoalim, Meitav Dash'
        },
        // Deduplication: same form + same bank = require only 1 document
        deduplication_key: ['form_867', 'institution'],
        notes_he: null,
        notes_en: null
    },

    form_867_spouse: {
        id: 'form_867_spouse',
        category: 'banks',
        name_he: 'טופס 867 לשנת {year} מ{institution} - בן/בת זוג',
        name_en: 'Form 867 for {year} from {institution} - Spouse',
        dropdown_he: 'טופס 867 - בן/בת זוג',
        dropdown_en: 'Form 867 - Spouse',
        requires_detail: true,
        detail: {
            key: 'institution',
            label_he: 'שם הבנק / המוסד הפיננסי - בן/בת זוג',
            label_en: 'Bank / Financial institution - Spouse',
            placeholder_he: 'לדוגמה: בנק לאומי',
            placeholder_en: 'e.g.: Bank Leumi'
        },
        deduplication_key: ['form_867_spouse', 'institution'],
        notes_he: null,
        notes_en: null
    },

    crypto_report: {
        id: 'crypto_report',
        category: 'banks',
        // Change #15: New crypto format
        name_he: 'דוח על הרווחים / הפסדים והמס שנוכה (במידה ונוכה) לשנת {year} מ{platform}',
        name_en: 'Profit/loss report and tax withheld (if any) for {year} from {platform}',
        dropdown_he: 'טופס 1399 (קריפטו)',
        dropdown_en: 'Form 1399 (Crypto)',
        requires_detail: true,
        detail: {
            key: 'platform',
            label_he: 'שם הפלטפורמה',
            label_en: 'Platform name',
            placeholder_he: 'לדוגמה: Binance, Coinbase',
            placeholder_en: 'e.g.: Binance, Coinbase'
        },
        notes_he: null,
        notes_en: null
    },

    dividend_cert: {
        id: 'dividend_cert',
        category: 'banks',
        name_he: 'אישור דיבידנד לשנת {year}',
        name_en: 'Dividend certificate for {year}',
        dropdown_he: 'אישור דיבידנד',
        dropdown_en: 'Dividend certificate',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    // -------------------------------------------------------------------------
    // INSURANCE, PENSION & BENEFITS (🛡️)
    // -------------------------------------------------------------------------
    pension_withdrawal: {
        id: 'pension_withdrawal',
        category: 'insurance',
        // Change #2: Support specific withdrawal types
        name_he: 'אישור על {withdrawal_type} לשנת {year} והמס שנוכה בעת המשיכה',
        name_en: 'Certificate for {withdrawal_type} for {year} and tax withheld at withdrawal',
        dropdown_he: 'אישור משיכת כספים (פנסיה/גמל/ביטוח)',
        dropdown_en: 'Fund withdrawal certificate',
        requires_detail: true,
        detail: {
            key: 'withdrawal_type',
            label_he: 'סוג המשיכה',
            label_en: 'Withdrawal type',
            placeholder_he: 'לדוגמה: פיצויי פיטורין, מענק פרישה, קצבה',
            placeholder_en: 'e.g.: Severance pay, Retirement grant',
            // Available options for dropdown
            options: Object.values(WITHDRAWAL_TYPES)
        },
        notes_he: null,
        notes_en: null
    },

    investment_provident_withdrawal: {
        id: 'investment_provident_withdrawal',
        category: 'insurance',
        // Change #5: New provident fund format
        name_he: 'אישור על משיכת קופת גמל להשקעה לשנת {year} והמס שנוכה בעת המשיכה',
        name_en: 'Investment provident fund withdrawal certificate for {year} and tax withheld',
        dropdown_he: 'אישור משיכת קופת גמל להשקעה',
        dropdown_en: 'Investment provident fund withdrawal',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    insurance_annual_report: {
        id: 'insurance_annual_report',
        category: 'insurance',
        // Change #3 & #6: New annual report format with bold "דוח שנתי מקוצר"
        name_he: 'אישור שנתי למס הכנסה לשנת {year} (נקרא גם **דוח שנתי מקוצר**) על ההפקדות ל{type} ב"{company}"',
        name_en: 'Annual tax certificate for {year} (also called **abbreviated annual report**) for deposits to {type} at "{company}"',
        dropdown_he: 'אישור מס שנתי מחברת ביטוח',
        dropdown_en: 'Annual insurance tax certificate',
        requires_detail: true,
        detail: {
            key: 'company',
            label_he: 'סוג הביטוח ושם החברה',
            label_en: 'Insurance type and company name',
            placeholder_he: 'לדוגמה: פנסיה - מיטב דש, קרן השתלמות - אלטשולר שחם',
            placeholder_en: 'e.g.: Pension - Meitav Dash, Study Fund - Altshuler Shaham'
        },
        // Type options for the insurance
        type_options: [
            { id: 'pension', name_he: 'פנסיה', name_en: 'Pension' },
            { id: 'study_fund', name_he: 'קרן השתלמות', name_en: 'Study fund' },
            { id: 'disability', name_he: 'אובדן כושר עבודה', name_en: 'Disability insurance' },
            { id: 'life', name_he: 'ביטוח חיים', name_en: 'Life insurance' }
        ],
        notes_he: null,
        notes_en: null
    },

    nii_disability: {
        id: 'nii_disability',
        category: 'insurance',
        // Change #7: New disability format
        name_he: 'אישור שנתי לשנת {year} על תקבולי דמי נכות שהתקבלו מביטוח לאומי - {name}',
        name_en: 'Annual certificate for {year} on disability benefits received from National Insurance - {name}',
        dropdown_he: 'אישור שנתי מביטוח לאומי',
        dropdown_en: 'National Insurance annual certificate',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    nii_disability_spouse: {
        id: 'nii_disability_spouse',
        category: 'insurance',
        name_he: 'אישור שנתי לשנת {year} על תקבולי דמי נכות שהתקבלו מביטוח לאומי - בן/בת זוג',
        name_en: 'Annual certificate for {year} on disability benefits from National Insurance - Spouse',
        dropdown_he: 'אישור שנתי מביטוח לאומי - בן/בת זוג',
        dropdown_en: 'National Insurance annual certificate - Spouse',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    nii_maternity: {
        id: 'nii_maternity',
        category: 'insurance',
        // Change #4: New maternity format
        name_he: 'אישור שנתי לשנת {year} על תקבולי דמי לידה מביטוח לאומי עבור - {name}',
        name_en: 'Annual certificate for {year} on maternity benefits from National Insurance for - {name}',
        dropdown_he: 'אישור דמי לידה מביטוח לאומי',
        dropdown_en: 'National Insurance maternity certificate',
        requires_detail: true,
        detail: {
            key: 'name',
            label_he: 'שם מקבל/ת הדמי לידה',
            label_en: 'Recipient name',
            placeholder_he: 'שם מלא',
            placeholder_en: 'Full name'
        },
        notes_he: null,
        notes_en: null
    },

    child_disability_allowance: {
        id: 'child_disability_allowance',
        category: 'insurance',
        // Change #10: New child disability format
        name_he: 'אישור שנתי לשנת {year} על תקבולי קצבת נכות מביטוח לאומי עבור הילד/ה',
        name_en: 'Annual certificate for {year} on disability allowance from National Insurance for the child',
        dropdown_he: 'אישור קצבת נכות לילד',
        dropdown_en: 'Child disability allowance certificate',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    // -------------------------------------------------------------------------
    // HOUSING & REAL ESTATE (🏠)
    // -------------------------------------------------------------------------
    rent_contract_income: {
        id: 'rent_contract_income',
        category: 'housing',
        name_he: 'חוזה שכירות (הכנסה) לשנת {year}',
        name_en: 'Rental contract (income) for {year}',
        dropdown_he: 'חוזה שכירות (הכנסה)',
        dropdown_en: 'Rental contract (income)',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    rent_contract_expense: {
        id: 'rent_contract_expense',
        category: 'housing',
        name_he: 'חוזה שכירות (הוצאה) לשנת {year}',
        name_en: 'Rental contract (expense) for {year}',
        dropdown_he: 'חוזה שכירות (הוצאה)',
        dropdown_en: 'Rental contract (expense)',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    residency_cert: {
        id: 'residency_cert',
        category: 'housing',
        // Change #8: Simplified residency certificate
        name_he: 'אישור תושבות לשנת המס מהרשות המקומית',
        name_en: 'Municipality residency certificate for the tax year',
        dropdown_he: 'אישור תושבות מהרשות המקומית',
        dropdown_en: 'Municipality residency certificate',
        requires_detail: false,
        // Removed: "למימוש הטבת מס ליישובים מזכים"
        notes_he: null,
        notes_en: null
    },

    // -------------------------------------------------------------------------
    // PERSONAL & DONATIONS (📋)
    // -------------------------------------------------------------------------
    id_appendix: {
        id: 'id_appendix',
        category: 'personal',
        name_he: 'ספח תעודת זהות כולל פרטי ילדים',
        name_en: 'ID appendix including children details',
        dropdown_he: 'ספח ת.ז כולל פרטי ילדים',
        dropdown_en: 'ID appendix with children',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    id_appendix_updated: {
        id: 'id_appendix_updated',
        category: 'personal',
        name_he: 'ספח תעודת זהות מעודכן',
        name_en: 'Updated ID appendix',
        dropdown_he: 'ספח ת.ז מעודכן',
        dropdown_en: 'Updated ID appendix',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    id_appendix_new_child: {
        id: 'id_appendix_new_child',
        category: 'personal',
        // Change #13: New child ID appendix format
        name_he: 'ספח ת"ז בו מופיע הילד/ה שהצטרפו למשפחה',
        name_en: 'ID appendix showing the child who joined the family',
        dropdown_he: 'ספח ת.ז (ילד חדש)',
        dropdown_en: 'ID appendix (new child)',
        requires_detail: false,
        // Removed parenthetical note
        notes_he: null,
        notes_en: null
    },

    army_release_cert: {
        id: 'army_release_cert',
        category: 'personal',
        // Change #12: Simplified army release certificate
        name_he: 'אישור שחרור משירות סדיר (ניתן להוציא את האישור מאתר "אישורים")',
        name_en: 'Military/National service release certificate (can be obtained from the "Certificates" website)',
        dropdown_he: 'אישור שחרור מצה"ל/שירות לאומי',
        dropdown_en: 'Military/National service release',
        requires_detail: false,
        // Removed: "למימוש נקודות זיכוי לחיילים משוחררים"
        notes_he: null,
        notes_en: null
    },

    degree_cert: {
        id: 'degree_cert',
        category: 'personal',
        // Change #9: New degree certificate format
        name_he: 'אישור זכאות לתואר אקדמי מ{institution}',
        name_en: 'Academic degree eligibility certificate from {institution}',
        dropdown_he: 'אישור זכאות לתואר',
        dropdown_en: 'Degree eligibility certificate',
        requires_detail: true,
        detail: {
            key: 'institution',
            label_he: 'שם המוסד האקדמי',
            label_en: 'Academic institution name',
            placeholder_he: 'לדוגמה: אוניברסיטת תל אביב',
            placeholder_en: 'e.g.: Tel Aviv University'
        },
        notes_he: null,
        notes_en: null
    },

    donation_receipts: {
        id: 'donation_receipts',
        category: 'personal',
        // Change #14: New donation receipts format
        name_he: 'קבלות תרומות מרוכזות (יש לשלוח קבלות רק ממוסדות שלהם יש סעיף 46. ניתן לראות זאת בקבלה)',
        name_en: 'Consolidated donation receipts (only send receipts from institutions with Section 46 approval. This is noted on the receipt)',
        dropdown_he: 'קבלות תרומות מרוכזות (סעיף 46)',
        dropdown_en: 'Donation receipts (Section 46)',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    memorial_receipts: {
        id: 'memorial_receipts',
        category: 'personal',
        // Change #11: New memorial receipts format
        name_he: 'קבלות ומסמכים **רלוונטיים** על הוצאות הנצחה',
        name_en: 'Receipts and **relevant** documents for memorial expenses',
        dropdown_he: 'קבלות ומסמכי הנצחה',
        dropdown_en: 'Memorial receipts and documents',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    alimony_judgment: {
        id: 'alimony_judgment',
        category: 'personal',
        name_he: 'פסק דין / הסכם גירושין (מזונות)',
        name_en: 'Court judgment / Divorce agreement (alimony)',
        dropdown_he: 'פסק דין / הסכם גירושין (מזונות)',
        dropdown_en: 'Court judgment / Divorce agreement',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    medical_documents: {
        id: 'medical_documents',
        category: 'personal',
        name_he: 'מסמך רופא/ועדה רפואית',
        name_en: 'Medical document/committee',
        dropdown_he: 'מסמך רופא/ועדה רפואית',
        dropdown_en: 'Medical document/committee',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    institution_care: {
        id: 'institution_care',
        category: 'personal',
        name_he: 'מסמך רשמי - החזקת קרוב במוסד',
        name_en: 'Official document - Family member in institution',
        dropdown_he: 'מסמך רשמי - החזקת קרוב במוסד',
        dropdown_en: 'Family member in institution',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    special_ed_approval: {
        id: 'special_ed_approval',
        category: 'personal',
        name_he: 'אישור ועדת השמה/שילוב',
        name_en: 'Placement/Integration committee approval',
        dropdown_he: 'אישור ועדת השמה/שילוב',
        dropdown_en: 'Placement committee approval',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    // -------------------------------------------------------------------------
    // ADDITIONAL INCOME (💰)
    // -------------------------------------------------------------------------
    gambling_cert: {
        id: 'gambling_cert',
        category: 'additional',
        name_he: 'אסמכתא הימורים/פרסים',
        name_en: 'Gambling/prizes documentation',
        dropdown_he: 'אסמכתא הימורים/פרסים',
        dropdown_en: 'Gambling/prizes documentation',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    foreign_income: {
        id: 'foreign_income',
        category: 'additional',
        name_he: 'אסמכתא הכנסות מחו"ל',
        name_en: 'Foreign income documentation',
        dropdown_he: 'אסמכתא הכנסות מחו"ל',
        dropdown_en: 'Foreign income documentation',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    },

    wht_approval: {
        id: 'wht_approval',
        category: 'additional',
        name_he: 'אישור ניכוי מס במקור לשנת {year}',
        name_en: 'Withholding tax approval for {year}',
        dropdown_he: 'אישור ניכוי מס במקור',
        dropdown_en: 'Withholding tax approval',
        requires_detail: true,
        detail: {
            key: 'source',
            label_he: 'מקור ההכנסה',
            label_en: 'Income source',
            placeholder_he: 'לדוגמה: דמי שכירות, דיבידנד מחברה פרטית',
            placeholder_en: 'e.g.: Rental income, Dividend from private company'
        },
        notes_he: null,
        notes_en: null
    },

    // -------------------------------------------------------------------------
    // OTHER (📋)
    // -------------------------------------------------------------------------
    inventory_list: {
        id: 'inventory_list',
        category: 'other',
        name_he: 'רשימת ספירת מלאי לסוף שנת {year}',
        name_en: 'Inventory count list for end of {year}',
        dropdown_he: 'רשימת ספירת מלאי',
        dropdown_en: 'Inventory count list',
        requires_detail: false,
        notes_he: null,
        notes_en: null
    }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format a document name by replacing placeholders with actual values
 * @param {string} template - The name template with placeholders
 * @param {Object} params - Values to replace placeholders (year, employer, etc.)
 * @returns {string} - Formatted document name
 */
export function formatDocumentName(template, params = {}) {
    if (!template) return '';

    let result = template;

    // Replace all placeholders
    for (const [key, value] of Object.entries(params)) {
        const placeholder = `{${key}}`;
        result = result.replace(new RegExp(placeholder, 'g'), value || '');
    }

    // Clean up any remaining placeholders
    result = result.replace(/\{[^}]+\}/g, '');

    // Clean up double spaces
    result = result.replace(/\s+/g, ' ').trim();

    return result;
}

/**
 * Format document name with markdown support (convert **text** to <strong>)
 * @param {string} template - The name template
 * @param {Object} params - Values to replace placeholders
 * @returns {string} - Formatted name with HTML strong tags
 */
export function formatDocumentNameHtml(template, params = {}) {
    let name = formatDocumentName(template, params);
    // Convert **text** to <strong>text</strong>
    name = name.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return name;
}

/**
 * Get document type by ID
 * @param {string} typeId - The document type ID
 * @returns {Object|null} - Document type definition or null
 */
export function getDocumentType(typeId) {
    return DOCUMENT_TYPES[typeId] || null;
}

/**
 * Get category by ID
 * @param {string} categoryId - The category ID
 * @returns {Object|null} - Category definition or null
 */
export function getCategory(categoryId) {
    return CATEGORIES[categoryId] || null;
}

/**
 * Get all document types for a specific category
 * @param {string} categoryId - The category ID
 * @returns {Object[]} - Array of document types in the category
 */
export function getDocumentsByCategory(categoryId) {
    return Object.values(DOCUMENT_TYPES).filter(doc => doc.category === categoryId);
}

/**
 * Get the formatted category name with emoji
 * @param {string} categoryId - The category ID
 * @param {string} lang - Language ('he' or 'en')
 * @returns {string} - Formatted category name with emoji
 */
export function getCategoryDisplay(categoryId, lang = 'he') {
    const category = CATEGORIES[categoryId];
    if (!category) return categoryId;

    const name = lang === 'en' ? category.name_en : category.name_he;
    return `${category.emoji} ${name}`;
}

/**
 * Generate HTML options for document dropdown
 * @param {string} lang - Language ('he' or 'en')
 * @returns {string} - HTML string of <option> elements
 */
export function getDocumentDropdownOptions(lang = 'he') {
    const sortedDocs = Object.values(DOCUMENT_TYPES).sort((a, b) => {
        // Sort by category order, then by dropdown name
        const catA = CATEGORIES[a.category]?.order || 999;
        const catB = CATEGORIES[b.category]?.order || 999;
        if (catA !== catB) return catA - catB;

        const nameA = lang === 'en' ? a.dropdown_en : a.dropdown_he;
        const nameB = lang === 'en' ? b.dropdown_en : b.dropdown_he;
        return nameA.localeCompare(nameB, lang === 'en' ? 'en' : 'he');
    });

    let options = lang === 'he'
        ? '<option value="">-- בחר מסמך מהרשימה --</option>'
        : '<option value="">-- Select document --</option>';

    let currentCategory = null;

    for (const doc of sortedDocs) {
        // Add optgroup for new category
        if (doc.category !== currentCategory) {
            if (currentCategory !== null) {
                options += '</optgroup>';
            }
            currentCategory = doc.category;
            const categoryDisplay = getCategoryDisplay(doc.category, lang);
            options += `<optgroup label="${categoryDisplay}">`;
        }

        const name = lang === 'en' ? doc.dropdown_en : doc.dropdown_he;
        const value = doc.requires_detail ? `${doc.id}|REQUIRES_DETAIL` : doc.id;
        options += `<option value="${value}">${name}</option>`;
    }

    if (currentCategory !== null) {
        options += '</optgroup>';
    }

    return options;
}

/**
 * Get detail configuration for a document type
 * @param {string} typeId - The document type ID
 * @param {string} lang - Language ('he' or 'en')
 * @returns {Object|null} - Detail configuration or null
 */
export function getDocumentDetailConfig(typeId, lang = 'he') {
    const doc = DOCUMENT_TYPES[typeId];
    if (!doc || !doc.requires_detail || !doc.detail) return null;

    return {
        key: doc.detail.key,
        label: lang === 'en' ? doc.detail.label_en : doc.detail.label_he,
        placeholder: lang === 'en' ? doc.detail.placeholder_en : doc.detail.placeholder_he,
        options: doc.detail.options || null
    };
}

/**
 * Build DOCS_REQUIRING_DETAILS object for backward compatibility
 * @param {string} lang - Language ('he' or 'en')
 * @returns {Object} - Object mapping dropdown names to detail configs
 */
export function buildDocsRequiringDetails(lang = 'he') {
    const result = {};

    for (const doc of Object.values(DOCUMENT_TYPES)) {
        if (doc.requires_detail && doc.detail) {
            const key = lang === 'en' ? doc.dropdown_en : doc.dropdown_he;
            result[key] = {
                label: lang === 'en' ? doc.detail.label_en : doc.detail.label_he,
                placeholder: lang === 'en' ? doc.detail.placeholder_en : doc.detail.placeholder_he
            };
        }
    }

    return result;
}

/**
 * Build category translations object for backward compatibility
 * @returns {Object} - Object mapping Hebrew category names to English
 */
export function buildCategoryTranslations() {
    const result = {};

    for (const category of Object.values(CATEGORIES)) {
        const heKey = `${category.emoji} ${category.name_he}`;
        result[heKey] = category.name_en;
    }

    return result;
}

/**
 * Get all document types as an array for API response
 * @returns {Array} - Array of all document type objects
 */
export function getAllDocumentTypes() {
    return Object.values(DOCUMENT_TYPES).map(doc => ({
        ...doc,
        category_info: CATEGORIES[doc.category]
    }));
}

/**
 * Export full registry for n8n API endpoint
 * @returns {Object} - Full registry with document types and categories
 */
export function getFullRegistry() {
    return {
        document_types: DOCUMENT_TYPES,
        categories: CATEGORIES,
        withdrawal_types: WITHDRAWAL_TYPES,
        version: '1.0.0',
        last_updated: new Date().toISOString()
    };
}

// ============================================================================
// LEGACY COMPATIBILITY - for existing code that uses old format
// ============================================================================

/**
 * Convert document type ID to old-style dropdown value
 * @param {string} typeId - Document type ID
 * @returns {string} - Value in old format (e.g., "טופס 106|REQUIRES_DETAIL")
 */
export function toLegacyDropdownValue(typeId) {
    const doc = DOCUMENT_TYPES[typeId];
    if (!doc) return typeId;

    const name = doc.dropdown_he;
    return doc.requires_detail ? `${name}|REQUIRES_DETAIL` : name;
}

/**
 * Get document type from old-style dropdown name
 * @param {string} dropdownName - Hebrew dropdown name
 * @returns {Object|null} - Document type or null
 */
export function getDocumentTypeByDropdownName(dropdownName) {
    // Remove the REQUIRES_DETAIL suffix if present
    const cleanName = dropdownName.split('|')[0];

    return Object.values(DOCUMENT_TYPES).find(
        doc => doc.dropdown_he === cleanName || doc.dropdown_en === cleanName
    ) || null;
}
