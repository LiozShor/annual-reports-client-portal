// document-types.js
// Single Source of Truth for document types + categories.
// Notes:
// - name_he supports **markdown bold** for client display (convert to HTML where needed).
// - Use formatDocumentName(typeId, params, { lang, mode }) to render final string.

export const CATEGORIES = {
  identity:   { emoji: "🪪", he: "זהות ומעמד אישי", en: "Identity & Status" },
  family:     { emoji: "👨‍👩‍👧‍👦", he: "משפחה וילדים", en: "Family & Children" },
  employment: { emoji: "💼", he: "הכנסות מעבודה", en: "Employment Income" },
  banks:      { emoji: "🏦", he: "בנקים ושוק ההון", en: "Banks & Capital Markets" },
  benefits:   { emoji: "🧾", he: "ביטוח לאומי וקצבאות", en: "Benefits (NII)" },
  insurance:  { emoji: "🛡️", he: "ביטוח ופנסיה", en: "Insurance & Pension" },
  housing:    { emoji: "🏠", he: "דיור ושכירות", en: "Housing & Rent" },
  education:  { emoji: "🎓", he: "השכלה", en: "Education" },
  crypto:     { emoji: "🪙", he: "קריפטו", en: "Crypto" },
  business:   { emoji: "🏷️", he: "עסק/עצמאי", en: "Business" },
  other:      { emoji: "📎", he: "אחר", en: "Other" },
};

export const DOCUMENT_TYPES = {
  // --- Employment ---
  form_106: {
    id: "form_106",
    category: "employment",
    aliases: ["Form_106"],
    name_he: 'טופס 106 לשנת {year} מ{employer}',
    name_en: "Form 106 for {year} from {employer}",
    details: [
      { key: "employer", type: "text", label_he: "שם המעסיק", label_en: "Employer name",
        placeholder_he: 'לדוגמה: חברת ABC בע"מ', placeholder_en: "e.g.: ABC Ltd." }
    ],
  },

  form_106_spouse: {
    id: "form_106_spouse",
    category: "employment",
    aliases: ["Form_106_Spouse"],
    name_he: 'טופס 106 לשנת {year} מ{employer} (בן/בת זוג)',
    name_en: "Form 106 for {year} from {employer} (spouse)",
    details: [
      { key: "employer", type: "text", label_he: "שם המעסיק", label_en: "Employer name",
        placeholder_he: 'לדוגמה: חברת ABC בע"מ', placeholder_en: "e.g.: ABC Ltd." }
    ],
  },

  // --- Banks / Capital markets ---
  form_867: {
    id: "form_867",
    category: "banks",
    aliases: ["Form_867"],
    name_he: 'טופס 867 (אישור ניכוי מס) לשנת {year} מ{institution}',
    name_en: "Form 867 (withholding tax certificate) for {year} from {institution}",
    details: [
      { key: "institution", type: "text", label_he: "בנק / בית השקעות", label_en: "Bank / Broker",
        placeholder_he: "לדוגמה: לאומי / מיטב", placeholder_en: "e.g.: Leumi / Meitav" }
    ],
    // Deduplication by same form + same institution
    deduplication_key: ["id", "institution"],
  },

  // --- Crypto ---
  crypto_report: {
    id: "crypto_report",
    category: "crypto",
    aliases: ["Crypto_Report"],
    name_he: 'דוח על הרווחים / הפסדים והמס שנוכה (במידה ונוכה) לשנת {year} מ{platform}',
    name_en: "Report of gains/losses and tax withheld (if any) for {year} from {platform}",
    details: [
      { key: "platform", type: "text", label_he: "פלטפורמה", label_en: "Platform",
        placeholder_he: "לדוגמה: Binance / eToro", placeholder_en: "e.g.: Binance / eToro" }
    ],
  },

  // --- Identity / status ---
  residency_cert: {
    id: "residency_cert",
    category: "identity",
    aliases: ["Residency_Cert"],
    name_he: "אישור תושבות לשנת המס מהרשות המקומית",
    name_en: "Municipality residency certificate for the tax year",
  },

  id_appendix: {
    id: "id_appendix",
    category: "identity",
    aliases: ["ID_Appendix"],
    name_he: 'ספח ת"ז מעודכן או תעודת נישואין/גירושין/פירוד רשמי (לפי הצורך)',
    name_en: "Updated ID appendix or marriage/divorce/separation certificate (as needed)",
  },

  army_release_cert: {
    id: "army_release_cert",
    category: "identity",
    aliases: ["Army_Release_Cert"],
    name_he: 'אישור שחרור משירות סדיר (ניתן להוציא את האישור מאתר "אישורים")',
    name_en: 'Regular service discharge certificate (can be issued via the "Certificates" site)',
  },

  // --- Family / children ---
  child_id_appendix: {
    id: "child_id_appendix",
    category: "family",
    aliases: ["Child_ID_Appendix"],
    name_he: "ספח תז בו מופיע הילד/ה שהצטרפו למשפחה",
    name_en: "ID appendix showing the child added to the family",
  },

  special_ed_approval: {
    id: "special_ed_approval",
    category: "family",
    aliases: ["Special_Ed_Approval"],
    name_he: "אישור ועדת השמה/ועדת שילוב עבור הילד (חינוך מיוחד)",
    name_en: "Placement/integration committee approval (special education) for the child",
  },

  child_disability_approval: {
    id: "child_disability_approval",
    category: "family",
    aliases: ["Child_Disability_Approval"],
    name_he: "אישור שנתי לשנת {year} על תקבולי קצבת נכות מביטוח לאומי עבור הילד/ה",
    name_en: "Annual certificate for {year} of child disability allowance from NII",
  },

  alimony_judgment: {
    id: "alimony_judgment",
    category: "family",
    aliases: ["Alimony_Judgment"],
    name_he: "פסק דין / הסכם גירושין (דמי מזונות)",
    name_en: "Court judgment / divorce agreement (alimony)",
  },

  // --- NII / benefits ---
  nii_disability_allowance_cert: {
    id: "nii_disability_allowance_cert",
    category: "benefits",
    aliases: ["NII_Allowance_Cert"],
    name_he: "אישור שנתי לשנת {year} על תקבולי דמי נכות שהתקבלו מביטוח לאומי - {name}",
    name_en: "Annual certificate for {year} of disability payments from NII - {name}",
    details: [
      { key: "name", type: "text", label_he: "שם מלא", label_en: "Full name",
        placeholder_he: "לדוגמה: ישראל ישראלי", placeholder_en: "e.g.: John Doe" }
    ],
  },

  nii_allowance_cert_spouse: {
    id: "nii_allowance_cert_spouse",
    category: "benefits",
    aliases: ["NII_Allowance_Cert_Spouse"],
    name_he: "אישור שנתי מביטוח לאומי לשנת {year} בהתאם לסוג הקצבה של בן/בת הזוג - {name}",
    name_en: "Annual NII certificate for {year} by benefit type (spouse) - {name}",
    details: [
      { key: "name", type: "text", label_he: "שם מלא", label_en: "Full name",
        placeholder_he: "לדוגמה: ישראל ישראלי", placeholder_en: "e.g.: John Doe" }
    ],
  },

  nii_maternity_allowance_cert: {
    id: "nii_maternity_allowance_cert",
    category: "benefits",
    name_he: "אישור שנתי לשנת {year} על תקבולי דמי לידה מביטוח לאומי עבור - {name}",
    name_en: "Annual certificate for {year} of maternity payments from NII for - {name}",
    details: [
      { key: "name", type: "text", label_he: "שם מלא", label_en: "Full name",
        placeholder_he: "לדוגמה: ישראל ישראלי", placeholder_en: "e.g.: John Doe" }
    ],
  },

  // --- Insurance / pension ---
  insurance_tax_cert: {
    id: "insurance_tax_cert",
    category: "insurance",
    aliases: ["Insurance_Tax_Cert"],
    name_he: 'אישור שנתי למס הכנסה לשנת {year} (נקרא גם **דוח שנתי מקוצר**) על ההפקדות ל{product} ב"{company}"',
    name_en: 'Annual tax certificate for {year} (also called a shortened annual report) for contributions to {product} at "{company}"',
    details: [
      { key: "product", type: "select", label_he: "סוג המוצר", label_en: "Product type",
        options_he: ["ביטוח חיים", "אובדן כושר עבודה", "קרן השתלמות"],
        options_en: ["Life insurance", "Work capacity loss", "Study fund"] },
      { key: "company", type: "text", label_he: "שם החברה", label_en: "Company name",
        placeholder_he: 'לדוגמה: הראל', placeholder_en: "e.g.: Harel" },
    ],
  },

  pension_withdrawal: {
    id: "pension_withdrawal",
    category: "insurance",
    aliases: ["Pension_Withdrawal"],
    name_he: 'אישור על משיכת {withdrawal_type} לשנת {year} והמס שנוכה בעת המשיכה',
    name_en: "Certificate of {withdrawal_type} withdrawal for {year} and tax withheld at withdrawal",
    details: [
      { key: "withdrawal_type", type: "select", label_he: "סוג המשיכה", label_en: "Withdrawal type",
        options_he: [
          "פיצויי פיטורין",
          "מענק פרישה",
          "משיכת קרן פנסיה",
          "משיכת קרן השתלמות",
          "משיכת קופת גמל להשקעה",
        ],
        options_en: [
          "Severance pay",
          "Retirement grant",
          "Pension fund withdrawal",
          "Study fund withdrawal",
          "Investment provident fund withdrawal",
        ]},
    ],
  },

  // --- Housing ---
  rent_contract_income: {
    id: "rent_contract_income",
    category: "housing",
    aliases: ["Rent_Contract_Income"],
    name_he: "חוזה שכירות של הדירה שהשכרת (הכנסה)",
    name_en: "Rental contract of the apartment you rented out (income)",
  },

  rent_contract_expense: {
    id: "rent_contract_expense",
    category: "housing",
    aliases: ["Rent_Contract_Expense"],
    name_he: "חוזה שכירות של הדירה ששכרת למגורים (הוצאה)",
    name_en: "Rental contract of the apartment you rented for living (expense)",
  },

  // --- Education ---
  degree_cert: {
    id: "degree_cert",
    category: "education",
    aliases: ["Degree_Cert"],
    name_he: "אישור זכאות לתואר אקדמי מ{institution}",
    name_en: "Academic degree eligibility certificate from {institution}",
    details: [
      { key: "institution", type: "text", label_he: "מוסד לימודים", label_en: "Institution",
        placeholder_he: "לדוגמה: אוניברסיטת תל אביב", placeholder_en: "e.g.: Tel Aviv University" }
    ],
  },

  // --- Other / business ---
  donation_receipts: {
    id: "donation_receipts",
    category: "other",
    aliases: ["Donation_Receipts"],
    name_he: "קבלות תרומות מרוכזות (יש לשלוח קבלות רק ממוסדות שלהם יש סעיף 46. ניתן לראות זאת בקבלה)",
    name_en: "Consolidated donation receipts (only from institutions with Section 46; appears on the receipt)",
  },

  memorial_receipts: {
    id: "memorial_receipts",
    category: "other",
    aliases: ["Memorial_Receipts"],
    name_he: "קבלות ומסמכים **רלוונטיים** על הוצאות הנצחה",
    name_en: "Relevant receipts and documents for memorial expenses",
  },

  institution_approval: {
    id: "institution_approval",
    category: "other",
    aliases: ["Institution_Approval"],
    name_he: "מסמך רשמי רלוונטי על החזקת קרוב משפחה במוסד",
    name_en: "Official relevant document for maintaining a family member in an institution",
  },

  medical_committee: {
    id: "medical_committee",
    category: "other",
    aliases: ["Medical_Committee"],
    name_he: "מסמך רשמי רלוונטי על הפטור/נכות (מסמכים רפואיים/ועדה רפואית)",
    name_en: "Official document regarding exemption/disability (medical docs / medical committee)",
  },

  foreign_income_report: {
    id: "foreign_income_report",
    category: "other",
    aliases: ["Foreign_Income_Report"],
    name_he: "אסמכתאות על ההכנסה ועל המס ששולם בחו\"ל",
    name_en: "Proof of foreign income and tax paid abroad",
  },

  wht_approval: {
    id: "wht_approval",
    category: "business",
    aliases: ["WHT_Approval"],
    name_he: "אישור שנתי על ניכוי מס במקור/בט\"ל מהלקוח",
    name_en: "Annual certificate of withholding tax / NII withheld from client",
    details: [
      { key: "client", type: "text", label_he: "שם הלקוח/ה", label_en: "Client name",
        placeholder_he: 'לדוגמה: חברת XYZ בע"מ', placeholder_en: "e.g.: XYZ Ltd." }
    ],
  },

  inventory_list: {
    id: "inventory_list",
    category: "business",
    aliases: ["Inventory_List"],
    name_he: "רשימת ספירת מלאי ליום האחרון של שנת המס",
    name_en: "Inventory count list as of the last day of the tax year",
  },

  gambling_win_cert: {
    id: "gambling_win_cert",
    category: "other",
    aliases: ["Gambling_Win_Cert"],
    name_he: "אסמכתאות על הזכייה והמס שנוכה (הימורים/פרסים מעל 25,000 ש\"ח)",
    name_en: "Proof of winnings and tax withheld (gambling/prizes over 25,000 NIS)",
  },

  general_doc: {
    id: "general_doc",
    category: "other",
    aliases: ["General_Doc"],
    name_he: "אישורים/אסמכתאות על הכנסות נוספות בשנת המס (שאינן מופיעות בשאלון)",
    name_en: "Proof of additional income during the tax year (not listed in the questionnaire)",
  },
};

// ---------- Helpers ----------
const escapeHtml = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const mdBoldToHtml = (s) => String(s ?? "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

function applyTemplate(template, params) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (_, k) => (params?.[k] ?? `{${k}}`));
}

export function getDocType(typeIdOrAlias) {
  if (!typeIdOrAlias) return null;
  if (DOCUMENT_TYPES[typeIdOrAlias]) return DOCUMENT_TYPES[typeIdOrAlias];
  const found = Object.values(DOCUMENT_TYPES).find((t) => (t.aliases || []).includes(typeIdOrAlias));
  return found || null;
}

export function formatDocumentName(typeIdOrAlias, params = {}, opts = {}) {
  const { lang = "he", mode = "text" } = opts; // mode: "text" | "html"
  const t = getDocType(typeIdOrAlias);
  if (!t) return typeIdOrAlias;

  const raw = lang === "en" ? t.name_en : t.name_he;
  const withParams = applyTemplate(raw, params);

  if (mode === "html") return mdBoldToHtml(escapeHtml(withParams)).replaceAll("&lt;strong&gt;", "<strong>").replaceAll("&lt;/strong&gt;", "</strong>");
  return withParams.replace(/\*\*(.+?)\*\*/g, "$1"); // strip markdown in plain text
}

export function requiresDetails(typeIdOrAlias) {
  const t = getDocType(typeIdOrAlias);
  return !!(t?.details?.length);
}

export function getDetailsSchema(typeIdOrAlias) {
  const t = getDocType(typeIdOrAlias);
  return t?.details || [];
}

export function getDocumentDropdownOptions({ lang = "he", includeCategoryGroups = true } = {}) {
  const items = Object.values(DOCUMENT_TYPES);

  const byCat = items.reduce((acc, t) => {
    (acc[t.category] ||= []).push(t);
    return acc;
  }, {});

  const catOrder = Object.keys(CATEGORIES);
  const cats = includeCategoryGroups ? catOrder.filter((c) => byCat[c]?.length) : [null];

  const buildOption = (t) => {
    const label = formatDocumentName(t.id, { year: "{year}" }, { lang, mode: "text" }); // safe default label
    return `<option value="${escapeHtml(t.id)}">${escapeHtml(label)}</option>`;
  };

  if (!includeCategoryGroups) {
    return items
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(buildOption)
      .join("\n");
  }

  return cats
    .map((cat) => {
      const catMeta = CATEGORIES[cat];
      const catLabel = lang === "en" ? catMeta.en : catMeta.he;
      const opts = byCat[cat]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(buildOption)
        .join("\n");
      return `<optgroup label="${escapeHtml(catMeta.emoji + " " + catLabel)}">\n${opts}\n</optgroup>`;
    })
    .join("\n");
}
