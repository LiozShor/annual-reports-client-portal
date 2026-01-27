/**
 * SSOT DOCUMENT GENERATOR - SINGLE SOURCE OF TRUTH
 * ==================================================
 * Last Updated: 2026-01-27
 */

const SSOT_TEMPLATES = {
  residency_cert: {
    he: 'אישור תושבות לשנת **{year}** – **{city_name}**',
    en: 'Residency certificate for **{year}** – **{city_name}**',
    params: ['year', 'city_name']
  },
  id_appendix: {
    he: 'ספח ת״ז מעודכן',
    en: 'Updated ID appendix',
    params: []
  },
  id_appendix_with_status_change: {
    he: 'ספח ת"ז מעודכן',
    en: 'Updated ID appendix',
    params: ['year', 'client_name', 'status_change_details']
  },
  child_id_appendix: {
    he: 'ספח ת״ז מעודכן)',
    en: 'Updated ID appendix',
    params: []
  },
  special_ed_approval: {
    he: 'אישור ועדת השמה/ועדת שילוב (חינוך מיוחד)',
    en: 'Special education placement / inclusion committee approval',
    params: []
  },
  child_disability_cert: {
    he: 'אישור שנתי לשנת **{year}** על תקבולי קצבת נכות מביטוח לאומי עבור הילד/ה',
    en: 'Annual certificate for **{year}** for child disability allowance receipts from National Insurance (Bituach Leumi) — for the child',
    params: ['year']
  },
  form_106_client: {
    he: 'טופס 106 לשנת **{year}** – **{employer}**',
    en: 'Form 106 for **{year}** — **{employer}**',
    params: ['year', 'employer']
  },
  form_106_spouse: {
    he: 'טופס 106 לשנת **{year}** – **{spouse_name}** – **{employer}**',
    en: 'Form 106 for **{year}** — **{spouse_name}** — **{employer}**',
    params: ['year', 'spouse_name', 'employer']
  },
  nii_disability_client: {
    he: 'אישור שנתי לשנת **{year}** על תקבולי דמי נכות שהתקבלו מביטוח לאומי עבור - **{client_name}**',
    en: 'Annual certificate for **{year}** for disability payments received from National Insurance — for **{client_name}**',
    params: ['year', 'client_name']
  },
  nii_disability_spouse: {
    he: 'אישור שנתי לשנת **{year}** על תקבולי דמי נכות שהתקבלו מביטוח לאומי עבור - **{spouse_name}**',
    en: 'Annual certificate for **{year}** for disability payments received from National Insurance — for **{spouse_name}**',
    params: ['year', 'spouse_name']
  },
  nii_maternity: {
    he: 'אישור שנתי לשנת **{year}** על תקבולי דמי לידה מביטוח לאומי עבור - **{name}**',
    en: 'Annual certificate for **{year}** for maternity payments from National Insurance — for **{name}**',
    params: ['year', 'name']
  },
  nii_generic_allowance: {
    he: 'אישור שנתי לשנת **{year}** על תקבולי **{allowance_type}** מביטוח לאומי עבור - **{name}**',
    en: 'Annual certificate for **{year}** for **{allowance_type}** from National Insurance — for **{name}**',
    params: ['year', 'allowance_type', 'name']
  },
  nii_survivors: {
    he: 'אישור שנתי לשנת **{year}** – קצבת שארים (ביטוח לאומי) – **{survivor_details}**',
    en: 'Annual certificate for **{year}** — Survivors allowance (National Insurance) — **{survivor_details}**',
    params: ['year', 'survivor_details']
  },
  nii_survivors_spouse: {
    he: 'אישור שנתי לשנת **{year}** – קצבת שארים (ביטוח לאומי) – **{spouse_name}** – **{survivor_details}**',
    en: 'Annual certificate for **{year}** — Survivors allowance (National Insurance) — **{spouse_name}** — **{survivor_details}**',
    params: ['year', 'spouse_name', 'survivor_details']
  },
  pension_withdrawal: {
    he: 'אישור משיכה לשנת **{year}** + מס שנוכה – **{withdrawal_type}**',
    en: 'Withdrawal certificate for **{year}** + tax withheld — **{withdrawal_type}**',
    params: ['year', 'withdrawal_type']
  },
  pension_withdrawal_other: {
    he: 'אישור משיכה לשנת **{year}** + מס שנוכה – **אחר: {withdrawal_other_text}**',
    en: 'Withdrawal certificate for **{year}** + tax withheld — **Other: {withdrawal_other_text}**',
    params: ['year', 'withdrawal_other_text']
  },
  insurance_deposit: {
    he: 'אישור שנתי למס הכנסה לשנת **{year}** (נקרא גם דוח שנתי **מקוצר**) על ההפקדות ל**{deposit_type}** ב**"{company_name}"**',
    en: 'Annual income tax certificate for **{year}** (also called an annual **concise** report) for contributions to **{deposit_type}** at **"{company_name}"**',
    params: ['year', 'deposit_type', 'company_name']
  },
  form_867: {
    he: 'טופס 867 לשנת **{year}** – **{institution_name}**',
    en: 'Form 867 for **{year}** — **{institution_name}**',
    params: ['year', 'institution_name']
  },
  crypto_report: {
    he: 'דוח על הרווחים / הפסדים והמס שנוכה (במידה ונוכה) לשנת **{year}** מ**{crypto_source}**',
    en: 'Gains/losses report and tax withheld (if withheld) for **{year}** from **{crypto_source}**',
    params: ['year', 'crypto_source']
  },
  gambling_win_cert: {
    he: 'אישור זכייה/פרסים מעל 25,000₪ + מס שנוכה – **{gambling_source}**',
    en: 'Winnings/prizes over ₪25,000 + tax withheld — **{gambling_source}**',
    params: ['gambling_source']
  },
  rent_contract_income: {
    he: 'חוזה שכירות – דירה מושכרת (הכנסה) – שכ״ד חודשי **{rent_income_monthly}**',
    en: 'Rental contract — rented-out apartment (income) — monthly rent **{rent_income_monthly}**',
    params: ['rent_income_monthly']
  },
  rent_contract_expense: {
    he: 'חוזה שכירות – דירה שכורה למגורים (הוצאה) – שכ״ד חודשי **{rent_expense_monthly}**',
    en: 'Rental contract — rented apartment for residence (expense) — monthly rent **{rent_expense_monthly}**',
    params: ['rent_expense_monthly']
  },
  inventory_list: {
    he: 'רשימת ספירת מלאי ליום 31.12.**{year}**',
    en: 'Inventory count list as of 31.12.**{year}**',
    params: ['year']
  },
  wht_income_tax: {
    he: 'אישור ניכוי מס הכנסה במקור – **{withholding_client_name}**',
    en: 'Income tax withholding at source certificate — **{withholding_client_name}**',
    params: ['withholding_client_name']
  },
  wht_nii: {
    he: 'אישור ניכוי ביטוח לאומי במקור – **{withholding_client_name}**',
    en: 'National Insurance withholding at source certificate — **{withholding_client_name}**',
    params: ['withholding_client_name']
  },
  donation_receipts: {
    he: 'קבלות מקוריות מרוכזות על תרומות לפי סעיף 46 (מעל 200₪) (יש לשלוח קבלות רק ממוסדות שלהם יש סעיף 46. ניתן לראות זאת בקבלה.)',
    en: 'Consolidated original donation receipts under section 46 (over ₪200) (send receipts only from eligible section-46 institutions; see the receipt)',
    params: []
  },
  army_release_cert: {
    he: 'אישור שחרור משירות (ב־3 שנים האחרונות) (ניתן להוציא את האישור מאתר ״אישורים״)',
    en: 'Army discharge certificate (within the last 3 years) (can be issued via the “Certificates” site)',
    params: []
  },
  memorial_receipts: {
    he: 'קבלות ומסמכים **רלוונטיים** על הוצאות הנצחה – **{relationship_details}**',
    en: 'Receipts and **relevant** documents for memorial expenses — **{relationship_details}**',
    params: ['relationship_details']
  },
  institution_approval: {
    he: 'מסמך רשמי (קרוב במוסד)',
    en: 'Official document (relative in an institution)',
    params: []
  },
  medical_committee: {
    he: 'מסמך רפואי רשמי לעניין פטור/הקלות במס – **{medical_details}**',
    en: 'Official medical document for tax exemption/relief — **{medical_details}**',
    params: ['medical_details']
  },
  degree_cert: {
    he: 'אישור זכאות לתואר אקדמי מ**{university_name}** – **{degree_type}**',
    en: 'Academic degree eligibility certificate from **{university_name}** — **{degree_type}**',
    params: ['university_name', 'degree_type']
  },
  foreign_income_evidence: {
    he: 'אסמכתאות להכנסות מחו״ל + מס ששולם בחו״ל – **{country}** – **{income_type}**',
    en: 'Evidence of foreign income + foreign tax paid – **{country}** – **{income_type}**',
    params: ['country', 'income_type']
  },
  foreign_tax_return: {
    he: 'דו״ח מס שהוגש במדינה – **{country}**',
    en: 'Foreign tax return filed in the country – **{country}**',
    params: ['country']
  },
  other_income_doc: {
    he: 'מסמך תומך להכנסה נוספת – **{other_income_text}**',
    en: 'Supporting document for additional income – **{other_income_text}**',
    params: ['other_income_text']
  }
};

function normalizeInstitutionName(name) {
  if (!name) return '';
  let normalized = String(name).trim();
  const prefixesToRemove = ['בנק ', 'Bank ', 'בית השקעות ', 'Investment House '];
  for (const prefix of prefixesToRemove) {
    const regex = new RegExp('^' + prefix, 'i');
    normalized = normalized.replace(regex, '');
  }
  return normalized.replace(/\s+/g, ' ').trim().toLowerCase();
}

function markdownToHtml(text) {
  if (!text) return '';
  return String(text).replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
}

function cleanAndBold(value) {
  if (!value) return '';
  const cleaned = String(value).trim();
  return `<b>${cleaned}</b>`;
}

function formatDocumentTitle(templateKey, params = {}, options = {}) {
  const lang = options.lang || 'he';
  const template = SSOT_TEMPLATES[templateKey];

  if (!template) {
    console.warn(`SSOT WARNING: Unknown template key: ${templateKey}`);
    return { he: templateKey, en: templateKey };
  }

  let text = lang === 'he' ? template.he : template.en;
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `{${key}}`;
    const replacementValue = value || `[${key}]`;
    text = text.replaceAll(placeholder, replacementValue);
  }
  text = markdownToHtml(text);
  return { he: text, en: text };
}

function selectNIITemplate(benefitType, isSpouse = false) {
  const normalized = String(benefitType || '').trim();
  if (normalized === 'נכות' || normalized.toLowerCase() === 'disability') {
    return isSpouse ? 'nii_disability_spouse' : 'nii_disability_client';
  }
  if (normalized === 'דמי לידה' || normalized.toLowerCase() === 'maternity benefits') {
    return 'nii_maternity';
  }
  return 'nii_generic_allowance';
}

function applyBusinessRules(documents, context) {
  const processed = [...documents];
  const form867Map = new Map();
  processed.filter(d => d.type === 'Form_867').forEach(doc => {
    const match = doc.issuer_name.match(/<b>(.*?)<\/b>/);
    const institutionName = match ? match[1] : doc.issuer_name;
    const normalized = normalizeInstitutionName(institutionName);
    if (!form867Map.has(normalized)) {
      form867Map.set(normalized, doc);
    } else {
      doc._remove = true;
    }
  });

  const appendixDocs = processed.filter(d => d.type === 'ID_Appendix' || d.type === 'Child_ID_Appendix');
  if (appendixDocs.length > 1) {
    appendixDocs.slice(1).forEach(doc => doc._remove = true);
    if (appendixDocs[0]) {
      // Use T002 generic
      appendixDocs[0].issuer_name = 'ספח ת״ז מעודכן';
      appendixDocs[0].issuer_name_en = 'Updated ID appendix (Safach TZ)';
    }
  }

  const { answers } = context;
  const foreignTaxReturnKey_he = 'question_487oPA';
  const foreignTaxReturnKey_en = 'question_e6r79k';
  const foreignTaxReturnFiled = answers[foreignTaxReturnKey_he] || answers[foreignTaxReturnKey_en];
  const skipForeignTaxReturn = String(foreignTaxReturnFiled || '').trim().toLowerCase().match(/^(yes|כן|true)$/i);

  if (skipForeignTaxReturn) {
    processed.forEach(doc => {
      // T1602 requested -> skip T1601 evidence? No, rule 1.10 says:
      // If return filed (T1602) -> ONLY return.
      // If NOT filed -> ONLY evidence (T1601).
      // Logic handles dedupe: remove Evidence if Return exists.
      if (doc.type === 'Foreign_Income_Evidence') {
         doc._remove = true; 
      }
    });
  }

  return processed.filter(d => !d._remove);
}

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