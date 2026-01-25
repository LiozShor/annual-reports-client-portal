/**
 * WORKFLOW PROCESSOR LIBRARY FOR n8n
 * ====================================
 *
 * This library contains ALL business logic for processing Tally questionnaires
 * and generating document requirements for the Annual Reports CRM system.
 *
 * Fetch from: https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/workflow-processor-n8n.js
 *
 * SINGLE SOURCE OF TRUTH - All workflow [02] logic lives here!
 */

// ========== CONFIGURATION ==========

const KEY_MAP = {
  // HIDDEN FIELDS (English -> Hebrew)
  "question_WNRM5Q_21cb2748-23e4-4b6f-acbd-1b0ee32c0afe": "question_Ad2ZXW_eda95daa-e622-4fcb-98d6-3f0aa0649680",
  "question_WNRM5Q_7bdf1402-3d31-4855-bf97-88a1f48c912d": "question_Ad2ZXW_07088289-7dc1-4173-97cb-855bc6655b0a",
  "question_WNRM5Q_7da15418-e79a-4265-9726-0f92bdd4a2e9": "question_Ad2ZXW_45f853b0-2044-45f0-bca8-4cb0db3c538a",
  "question_WNRM5Q_885e9fda-7bb7-4a09-af17-892ad4fe41fa": "question_Ad2ZXW_12245f33-980a-4def-8656-f87f7ed1f397",
  "question_WNRM5Q_f154cc30-448c-4960-837a-b857542fa97a": "question_Ad2ZXW_5cf54aa8-32b8-47cc-b2c0-a2bcddabb689",
  "question_WNRM5Q_dbe5baba-db73-4a05-bd58-eb953a3c308d": "question_Ad2ZXW_64644761-68e7-45eb-aac2-18c5471941fa",

  // VISIBLE FIELDS (English Key -> Hebrew Key)
  "question_R0oJPP": "question_vAekdl",
  "question_oyR7GM": "question_K65baX",
  "question_GzpJlz": "question_Lb7l6l",
  "question_J6lJA7": "question_67Kv1P",
  "question_g0q7MK": "question_7WKvJP",
  "question_OzXJGA": "question_1ld8p1",
  "question_V0PMJl": "question_J6p7MK",
  "question_P69XO0": "question_g0d2vD",
  "question_487oro": "question_8KaOMz",
  "question_EXlJWL": "question_y62LzX",
  "question_r6OdPL": "question_XDJXzL",
  "question_jyo7P9": "question_0xBXaB",
  "question_a64DYy": "question_8Ka0Zl",
  "question_kyG76j": "question_P69RpP",
  "question_2eAJPb": "question_zqylLM",
  "question_xpDPY9": "question_5zjRMZ",
  "question_ZNOzav": "question_d6arvd",
  "question_N6XJob": "question_YQ08kW",
  "question_qdGKVk": "question_DNkQMN",
  "question_QDRJVk": "question_lyeQvN",
  "question_9WZEQ4": "question_R0Mpk4",
  "question_e6r7Ro": "question_oyeWvO",
  "question_vADOy8": "question_XDoYDP",
  "question_K6xJlK": "question_8KL8Kl",
  "question_WNRMzQ": "question_Oz4vkY",
  "question_a64Ddy": "question_V0QgDM",
  "question_67KON5": "question_P61KkB",
  "question_LbKJW2": "question_0x8vx9",
  "question_pKo7BE": "question_zqMJqk",
  "question_7WKVxz": "question_r6a7v2",
  "question_b7e8dE": "question_48J5zA",
  "question_kyG7Ej": "question_xpMKvv",
  "question_vADOY8": "question_ZNE0De",
  "question_K6xJ1K": "question_N6lkdO",
  "question_LbKJp2": "question_qdD6vg",
  "question_pKo7OE": "question_QDeLkX",
  "question_1l4JVL": "question_9W9VM5",
  "question_MbaJR0": "question_e6Q4vl",
  "question_J6lJz7": "question_WNEy1k",
  "question_g0q7GK": "question_a65VvX",
  "question_e6r79k": "question_487oPA",
  "question_XDoM0V": "question_7WLGM0",
  "question_7WKV2z": "question_K6xQyA",
  "question_67KO25": "question_zqya7k",
  "question_8KLPQo": "question_Ad2Zye",
  "question_0x8J6Q": "question_BXdN0R",
  "question_zqMrDE": "question_kyeqvo",
  "question_5z9G1b": "question_vAekKl",
  "question_d60DxN": "question_K65bkX",
  "question_YQGMW0": "question_pKyav8",
  "question_DNpJdp": "question_1ld861",
  "question_lyO7d6": "question_MbNBMk",
  "question_R0oJ5P": "question_J6p7oK",
  "question_oyR7MM": "question_g0d2zD",
  "question_GzpJdz": "question_y62L1X",
  "question_b7e8xE": "question_a64Q7E",
  "question_AdpqLN": "question_67K8aO",
  "question_OzXJ5A": "question_XDJXQL",
  "question_V0PM5l": "question_8KaOrz",
  "question_BXpQkY": "question_oyR995",
  "question_P69X50": "question_0xBXkB",
  "question_EXlJQL": "question_zqyldM",
  "question_1l4J7L": "question_5z9vzN",
  "question_r6OdAL": "question_5zjRVZ",
  "question_487oxo": "question_d6arzd",
  "question_jyo7Q9": "question_YQ089W",
  "question_2eAJNb": "question_DNkQaN",
  "question_xpDPa9": "question_lyeQzN",
  "question_ZNOz6v": "question_R0Mpj4",
  "question_N6XJWb": "question_Gz9WbL",
  "question_qdGKAk": "question_Oz4vEY",
  "question_QDRJ5k": "question_V0QgNM",
  "question_9WZED4": "question_P61KrB",
  "question_e6r7eo": "question_EXd96B"
};

const VALUE_TRANSLATIONS = {
  "Severance pay": "פיצויי פיטורין",
  "Retirement grant": "מענק פרישה",
  "Lump-sum withdrawal": "משיכת תגמולים (הוני)",
  "Lump-sum withdrawal of benefits (capital)": "משיכת תגמולים (הוני)",
  "Pension / pension commutation": "קצבה / היוון קצבה",
  "Study fund withdrawal": "משיכת קרן השתלמות",
  "Disability": "נכות",
  "Unemployment": "אבטלה",
  "Reserve duty": "מילואים",
  "Maternity benefits": "דמי לידה",
  "Work injury": "פגיעה בעבודה"
};

// ========== HELPER FUNCTIONS ==========

function norm(v) {
  return String(v ?? "").trim();
}

function htmlEscape(s) {
  return norm(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function translateValue(val) {
  const v = norm(val);
  return VALUE_TRANSLATIONS[v] || v;
}

function cleanAndBold(text) {
  if (!text) return '';
  return `<b>${htmlEscape(String(text).trim())}</b>`;
}

// ========== EXPORTED FUNCTIONS ==========

/**
 * Extract system fields from Tally webhook data
 * @param {Object} tallyData - Raw Tally webhook payload
 * @returns {Object} System fields (report_id, client_name, spouse_name, year, etc.)
 */
function extractSystemFields(tallyData) {
  const body = tallyData.body || {};
  const eventData = body.data || {};
  const fields = Array.isArray(eventData.fields) ? eventData.fields : [];

  // Detect language
  const formLanguage = fields.some(f => f.key && KEY_MAP[f.key]) ? 'en' : 'he';

  // Build answers map
  const answersByKey = {};
  fields.forEach(f => {
    const key = formLanguage === 'en' ? (KEY_MAP[f.key] || f.key) : f.key;
    answersByKey[key] = f.value;
  });

  // Extract system fields
  const report_record_id = answersByKey["question_Ad2ZXW_eda95daa-e622-4fcb-98d6-3f0aa0649680"] || "";
  const client_id = answersByKey["question_Ad2ZXW_07088289-7dc1-4173-97cb-855bc6655b0a"] || "";
  const year = answersByKey["question_Ad2ZXW_45f853b0-2044-45f0-bca8-4cb0db3c538a"] || "";
  const token = answersByKey["question_Ad2ZXW_12245f33-980a-4def-8656-f87f7ed1f397"] || "";
  const client_name = answersByKey["question_Ad2ZXW_5cf54aa8-32b8-47cc-b2c0-a2bcddabb689"] || "";
  const spouse_name = answersByKey["question_Ad2ZXW_64644761-68e7-45eb-aac2-18c5471941fa"] || "";

  // Extract email from first visible email field
  let client_email = "";
  for (const f of fields) {
    if (f.type === 'EMAIL_ADDRESS' && f.value) {
      client_email = f.value;
      break;
    }
  }

  const display_name = spouse_name ? `${client_name} ובן/בת זוג` : client_name;

  return {
    report_record_id: norm(report_record_id),
    client_id: norm(client_id),
    year: norm(year),
    token: norm(token),
    client_name: norm(client_name),
    spouse_name: norm(spouse_name),
    display_name: norm(display_name),
    client_email: norm(client_email),
    form_language: formLanguage,
    formName: eventData.formName || "",
    createdAt: eventData.createdAt || new Date().toISOString()
  };
}

/**
 * Build answers table HTML for email
 * @param {Object} tallyData - Raw Tally webhook payload
 * @param {string} formLanguage - 'he' or 'en'
 * @returns {string} HTML table with all questionnaire answers
 */
function buildAnswersTableHTML(tallyData, formLanguage) {
  const body = tallyData.body || {};
  const eventData = body.data || {};
  const fields = Array.isArray(eventData.fields) ? eventData.fields : [];

  let htmlRows = "";

  fields.forEach(field => {
    // Skip hidden fields
    if (field.type === 'HIDDEN_FIELDS') return;

    // Translate key if English form
    const questionKey = formLanguage === 'en' ? (KEY_MAP[field.key] || field.key) : field.key;
    const label = field.label || questionKey;
    let value = field.value;

    // Translate value if needed
    if (value && typeof value === 'string') {
      value = translateValue(value);
    }

    // Format value based on type
    let displayValue = '';
    if (Array.isArray(value)) {
      displayValue = value.map(v => htmlEscape(translateValue(v))).join(', ');
    } else if (value) {
      displayValue = htmlEscape(value);
    } else {
      displayValue = '-';
    }

    htmlRows += `
      <tr>
        <td style="border:1px solid #ddd; padding:8px; background:#f9f9f9; font-weight:bold;">${htmlEscape(label)}</td>
        <td style="border:1px solid #ddd; padding:8px;">${displayValue}</td>
      </tr>`;
  });

  return htmlRows;
}

/**
 * Process all questionnaire mappings to create documents
 * @param {Object} tallyData - Raw Tally webhook payload
 * @param {Object} mappingData - Full mapping file with { categories, document_types, question_mappings }
 * @param {Object} systemFields - System fields from extractSystemFields()
 * @returns {Array} Array of document objects with category info
 */
function processAllMappings(tallyData, mappingData, systemFields) {
  const body = tallyData.body || {};
  const eventData = body.data || {};
  const fields = Array.isArray(eventData.fields) ? eventData.fields : [];

  // Build answers map
  const answers = {};
  fields.forEach(f => {
    const key = systemFields.form_language === 'en' ? (KEY_MAP[f.key] || f.key) : f.key;
    answers[key] = f.value;
  });

  const DOCUMENT_TYPES = mappingData.document_types || {};
  const CATEGORIES = mappingData.categories || {};
  const QUESTION_MAPPINGS = mappingData.question_mappings || [];

  const reportId = systemFields.report_record_id;
  const tax_year = systemFields.year;

  // Airtable type mapping (legacy compatibility)
  const AIRTABLE_TYPE_MAP = {
    "form_106": "Form_106",
    "form_106_spouse": "Form_106_Spouse",
    "form_867": "Form_867",
    "crypto_report": "Crypto_Report",
    "residency_cert": "Residency_Cert",
    "id_appendix": "ID_Appendix",
    "child_id_appendix": "Child_ID_Appendix",
    "special_ed_approval": "Special_Ed_Approval",
    "child_disability_approval": "Child_Disability_Approval",
    "alimony_judgment": "Alimony_Judgment",
    "pension_withdrawal": "Pension_Withdrawal",
    "nii_disability_allowance_cert": "NII_Allowance_Cert",
    "nii_allowance_cert_spouse": "NII_Allowance_Cert_Spouse",
    "nii_maternity_allowance_cert": "NII_Allowance_Cert",
    "rent_contract_income": "Rent_Contract_Income",
    "rent_contract_expense": "Rent_Contract_Expense",
    "inventory_list": "Inventory_List",
    "insurance_tax_cert": "Insurance_Tax_Cert",
    "army_release_cert": "Army_Release_Cert",
    "degree_cert": "Degree_Cert",
    "medical_committee": "Medical_Committee",
    "donation_receipts": "Donation_Receipts",
    "memorial_receipts": "Memorial_Receipts",
    "institution_approval": "Institution_Approval",
    "foreign_income_report": "Foreign_Income_Report",
    "gambling_win_cert": "Gambling_Win_Cert",
    "general_doc": "General_Doc",
    "wht_approval": "WHT_Approval_IncomeTax",
    "wht_approval_nii": "WHT_Approval_NII"
  };

  // Client/Spouse names
  const answerName = answers['question_vAekdl'];
  const clientNamePlain = (answerName || systemFields.client_name || "הלקוח").trim();

  const SPOUSE_KEY = 'question_1ld8p1';
  let rawSpouse = answers[SPOUSE_KEY] || systemFields.spouse_name;
  const placeholderValues = ["spouse's name", "שם בן/בת הזוג", "first and last name", "שם מלא"];
  let cleanSpouse = String(rawSpouse || "").trim();
  const isPlaceholder = placeholderValues.some(p => cleanSpouse.toLowerCase() === p.toLowerCase());
  const isRealName = cleanSpouse.length > 1 && !isPlaceholder;
  const spouseNamePlain = isRealName ? cleanSpouse : "בן/בת הזוג";

  // Helper functions
  function mdToHtml(text) {
    return String(text || "").replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
  }

  function shouldGenerateDocs(mapping, answerValue) {
    if (!mapping.documents || mapping.documents.length === 0) return false;
    if (!answerValue) return false;

    const condition = mapping.condition;
    if (condition === null) return true;

    const normalized = norm(answerValue).toLowerCase();

    if (condition === "yes") {
      return normalized === 'כן' || normalized === 'yes' || normalized === 'true';
    }
    if (condition === "no") {
      return normalized === 'לא' || normalized === 'no' || normalized === 'false';
    }

    return normalized === norm(condition).toLowerCase();
  }

  function splitListItems(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(v => norm(v)).filter(Boolean);
    return String(value).split(/[\n,]/).map(x => x.trim()).filter(Boolean);
  }

  function formatDocumentName(typeId, params) {
    const docType = DOCUMENT_TYPES[typeId];
    if (!docType) return { he: typeId, en: typeId };

    let template = docType.name.he;
    let template_en = docType.name.en;

    for (const [key, value] of Object.entries(params)) {
      const placeholder = `{${key}}`;
      template = template.replaceAll(placeholder, value);
      template_en = template_en.replaceAll(placeholder, value);
    }

    return { he: mdToHtml(template), en: mdToHtml(template_en) };
  }

  function getCategoryId(categoryKey) {
    const cat = CATEGORIES[categoryKey];
    return cat ? categoryKey : 'other';
  }

  function cleanKeyPart(s) {
    return String(s ?? "").trim().replace(/\s+/g, "_").replace(/[^\u0590-\u05FFa-zA-Z0-9_]/g, "");
  }

  // Data containers
  const out = [];
  const seen = new Set();

  function addDoc(mapping, docTypeId, issuer_name_he, issuer_name_en, itemRaw = "static") {
    const stepKey = cleanKeyPart(mapping.id || "mapping");
    const itemKey = cleanKeyPart(itemRaw || "static");
    const document_key = `${docTypeId}_${reportId}_${stepKey}_${itemKey}`;

    if (seen.has(document_key)) return;
    seen.add(document_key);

    const airtableType = AIRTABLE_TYPE_MAP[docTypeId] || docTypeId;
    const categoryId = getCategoryId(mapping.category);
    const person = mapping.isSpouse ? 'spouse' : 'client';

    out.push({
      document_key,
      report_record_id: reportId,
      type: airtableType,
      status: "Required_Missing",
      issuer_key: mapping.tallyKeys?.he || "",
      issuer_name: issuer_name_he,
      issuer_name_en: issuer_name_en,
      category: categoryId,
      person: person
    });
  }

  // Main processing loop
  for (const mapping of QUESTION_MAPPINGS) {
    if (!mapping.documents || mapping.documents.length === 0) continue;

    const answerValue = answers[mapping.tallyKeys?.he] || answers[mapping.tallyKeys?.en];

    if (!shouldGenerateDocs(mapping, answerValue)) continue;

    for (const docTypeId of mapping.documents) {
      const docType = DOCUMENT_TYPES[docTypeId];
      if (!docType) continue;

      if (mapping.perItem) {
        // Split answer into multiple items
        const items = splitListItems(answerValue);
        if (items.length === 0) continue;

        items.forEach(item => {
          const params = { year: tax_year };

          // Add ALL parameters from docType.details
          if (docType.details && docType.details.length > 0) {
            docType.details.forEach(detail => {
              if (detail.key === 'year') return;

              if (mapping.fixedParams && mapping.fixedParams[detail.key]) {
                params[detail.key] = cleanAndBold(mapping.fixedParams[detail.key]);
              } else if (item) {
                params[detail.key] = cleanAndBold(item);
              }
            });
          } else if (mapping.detailsField) {
            params[mapping.detailsField] = cleanAndBold(item);
          }

          // Add entity name
          params.name = mapping.isSpouse ? cleanAndBold(spouseNamePlain) : cleanAndBold(clientNamePlain);

          const names = formatDocumentName(docTypeId, params);
          addDoc(mapping, docTypeId, names.he, names.en, item);
        });
      } else {
        // Single document
        const params = { year: tax_year };

        params.name = mapping.isSpouse ? cleanAndBold(spouseNamePlain) : cleanAndBold(clientNamePlain);

        if (docType.details && docType.details.length > 0) {
          docType.details.forEach(detail => {
            if (detail.key === 'year' || detail.key === 'name') return;

            if (mapping.fixedParams && mapping.fixedParams[detail.key]) {
              params[detail.key] = cleanAndBold(mapping.fixedParams[detail.key]);
            } else if (mapping.detailsField && answerValue) {
              const linkedAnswer = answers[mapping.linkedQuestion] || answerValue;
              params[detail.key] = cleanAndBold(linkedAnswer);
            }
          });
        } else if (mapping.detailsField && answerValue) {
          const linkedAnswer = answers[mapping.linkedQuestion] || answerValue;
          params[mapping.detailsField] = cleanAndBold(linkedAnswer);
        }

        const names = formatDocumentName(docTypeId, params);
        addDoc(mapping, docTypeId, names.he, names.en, "static");
      }
    }
  }

  // Special handling: Pension withdrawal multi-expand
  const pensionMapping = QUESTION_MAPPINGS.find(m => m.id === "pension_withdrawal_type");
  if (pensionMapping && pensionMapping.documents && pensionMapping.documents.length > 0) {
    const pensionAnswer = answers[pensionMapping.tallyKeys?.he] || answers[pensionMapping.tallyKeys?.en];
    if (pensionAnswer) {
      const items = splitListItems(pensionAnswer);
      const otherDetailKey = 'question_R0Mpk4';

      items.forEach(rawItem => {
        const isOther = norm(rawItem).replace(/["']/g, "") === 'אחר' || norm(rawItem).toLowerCase() === 'other';
        const withdrawalType = isOther ? (answers[otherDetailKey] || 'אחר') : rawItem;

        const params = { year: tax_year, withdrawal_type: cleanAndBold(withdrawalType) };
        const names = formatDocumentName('pension_withdrawal', params);
        addDoc(pensionMapping, 'pension_withdrawal', names.he, names.en, rawItem);
      });
    }
  }

  return out;
}

/**
 * Deduplicate documents by type + issuer + person
 * @param {Array} documents - Array of document objects
 * @returns {Array} Deduplicated array
 */
function deduplicateDocuments(documents) {
  const uniqueMap = new Map();

  documents.forEach(doc => {
    const key = `${doc.type}|||${doc.issuer_key || ''}|||${doc.person || 'client'}`;

    // Keep first occurrence
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, doc);
    }
  });

  return Array.from(uniqueMap.values());
}

/**
 * Prepare documents for Airtable upsert
 * @param {Array} documents - Array of document objects
 * @returns {Array} Array formatted for Airtable batch upsert (documents already have all fields)
 */
function prepareAirtablePayload(documents) {
  // Documents from processAllMappings already have the correct structure
  // Just return them as-is
  return documents;
}

/**
 * Build action buttons HTML for office email
 * @param {Object} params - { reportId, clientEmail, year, spouseName, clientName }
 * @param {string} SECRET - Webhook secret token
 * @returns {string} HTML for action buttons
 */
function buildActionButtonsHTML(params, SECRET) {
  const { reportId, clientEmail, year, spouseName, clientName } = params;

  const baseUrl = 'https://liozshor.app.n8n.cloud/webhook';
  const approveUrl = `${baseUrl}/approve-and-send?report_id=${reportId}&token=${SECRET}`;
  const editUrl = `https://liozshor.github.io/annual-reports-client-portal/document-manager.html?report_id=${reportId}&client_name=${encodeURIComponent(clientName)}&spouse_name=${encodeURIComponent(spouseName || '')}&year=${year}`;

  return `
<div style="margin-top:30px;padding:20px;background:#e3f2fd;border-radius:8px;text-align:center;">
  <div style="margin-bottom:20px;">
    <a href="${approveUrl}" style="display:inline-block;padding:12px 25px;background:#4caf50;color:white;text-decoration:none;border-radius:5px;font-weight:bold;margin:5px;">✅ המסמכים תקינים - שלח ללקוח</a>
    <a href="${editUrl}" style="display:inline-block;padding:12px 25px;background:#ff9800;color:white;text-decoration:none;border-radius:5px;font-weight:bold;margin:5px;">✏️ עריכת רשימה</a>
  </div>
  <p style="font-size:12px;color:#666;">לקוח: ${htmlEscape(clientEmail)} | שנה: ${year} | דוח: ${reportId.slice(-6)}</p>
</div>`;
}

// Return functions as object for n8n
return {
  extractSystemFields,
  buildAnswersTableHTML,
  processAllMappings,
  deduplicateDocuments,
  prepareAirtablePayload,
  buildActionButtonsHTML,
  // Export helpers for testing
  norm,
  htmlEscape,
  translateValue,
  cleanAndBold
};
