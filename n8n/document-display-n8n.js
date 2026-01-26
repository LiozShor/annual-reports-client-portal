/**
 * DOCUMENT DISPLAY LIBRARY FOR n8n
 * =================================
 *
 * This is the n8n-compatible version (no ES6 exports)
 * Fetch from: https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/document-display-n8n.js
 */

function formatDocumentName(doc, spouseName = null) {
  let name = doc.issuer_name || doc.description || 'מסמך';

  // Add spouse name in parentheses if this is a spouse document
  if (doc.person === 'spouse' && spouseName) {
    // Remove generic "(בן/בת זוג)" if it exists
    name = name.replace(/\s*\(בן\/בת זוג\)\s*$/, '');
    // Add actual spouse name
    name = `${name} (${spouseName})`;
  }

  return {
    plain: name,
    html: name
  };
}

function groupDocumentsByCategory(documents) {
  const categories = {
    // Personal & Family
    personal: { name_he: 'פרטים כלליים', name_en: 'General Details', emoji: '📋', order: 1, docs: [] },
    family: { name_he: 'משפחה', name_en: 'Family', emoji: '👨‍👩‍👧‍👦', order: 2, docs: [] },
    children: { name_he: 'ילדים', name_en: 'Children', emoji: '👶', order: 3, docs: [] },

    // Income
    employment: { name_he: 'עבודה ושכר (טופס 106 – אחד לכל מעסיק)', name_en: 'Employment (Form 106)', emoji: '💼', order: 10, docs: [] },
    pension: { name_he: 'משיכות כספים (מסמך נפרד לכל סוג משיכה שסומן)', name_en: 'Pension Withdrawals', emoji: '💰', order: 11, docs: [] },
    nii: { name_he: 'ביטוח לאומי', name_en: 'National Insurance', emoji: '🏛️', order: 12, docs: [] },

    // Investments
    investments: { name_he: 'ניירות ערך', name_en: 'Securities', emoji: '📈', order: 20, docs: [] },
    realestate: { name_he: 'שכירות', name_en: 'Real Estate', emoji: '🏠', order: 21, docs: [] },

    // Deductions
    insurance: { name_he: 'הפקדות (מסמך נפרד לכל הפקדה לפי חברה)', name_en: 'Insurance Deposits', emoji: '🛡️', order: 30, docs: [] },
    donations: { name_he: 'תרומות', name_en: 'Donations', emoji: '🎁', order: 31, docs: [] },
    education: { name_he: 'תואר', name_en: 'Academic Degree', emoji: '🎓', order: 32, docs: [] },
    military: { name_he: 'צבא/שירות לאומי', name_en: 'Military Service', emoji: '🎖️', order: 33, docs: [] },
    health: { name_he: 'הנצחה / קרוב במוסד / רפואי', name_en: 'Health & Memorial', emoji: '🏥', order: 34, docs: [] },

    // Withholding
    withholding: { name_he: 'ניכוי מס במקור / ביטוח לאומי במקור (אחד לכל לקוח)', name_en: 'Tax Withholding', emoji: '📝', order: 40, docs: [] },

    // Other
    other: { name_he: 'הכנסות נוספות', name_en: 'Additional Income', emoji: '📋', order: 99, docs: [] }
  };

  documents.forEach(doc => {
    const categoryId = doc.category || 'other';

    // If category not found, use 'other' but don't create duplicate reference
    if (!categories[categoryId]) {
      if (!categories['other'].docs) categories['other'].docs = [];
      categories['other'].docs.push(doc);
    } else {
      categories[categoryId].docs.push(doc);
    }
  });

  // Remove empty categories and sort by order
  const result = {};
  Object.keys(categories)
    .filter(key => categories[key].docs.length > 0)
    .sort((a, b) => categories[a].order - categories[b].order)
    .forEach(key => {
      result[key] = categories[key];
    });

  return result;
}

function separateClientAndSpouse(documents) {
  const client = documents.filter(doc => doc.person !== 'spouse');
  const spouse = documents.filter(doc => doc.person === 'spouse');

  return { client, spouse };
}

function generateDocumentListHTML(documents, options = {}) {
  const { clientName = '', spouseName = '', language = 'he' } = options;
  const isMarried = spouseName && spouseName.trim().length > 0;

  const grouped = groupDocumentsByCategory(documents);

  let html = '';

  Object.entries(grouped).forEach(([categoryId, category]) => {
    const categoryName = language === 'he' ? category.name_he : category.name_en;
    const { client, spouse } = separateClientAndSpouse(category.docs);

    let docsHtml = '';

    // Client documents
    if (client.length > 0) {
      if (isMarried) {
        docsHtml += `<div style="margin-bottom:8px;">
          <strong style="color:#1976d2;">${clientName}:</strong>
          <ul style="list-style:none;padding:0;margin:5px 0;">
            ${client.map(doc => {
              const formatted = formatDocumentName(doc, spouseName);
              return `<li>• ${formatted.html}</li>`;
            }).join('')}
          </ul>
        </div>`;
      } else {
        docsHtml += `<ul style="list-style:none;padding:0;margin:5px 0;">
          ${client.map(doc => {
            const formatted = formatDocumentName(doc, spouseName);
            return `<li>• ${formatted.html}</li>`;
          }).join('')}
        </ul>`;
      }
    }

    // Spouse documents
    if (spouse.length > 0 && isMarried) {
      docsHtml += `<div style="margin-bottom:8px;">
        <strong style="color:#7b1fa2;">${spouseName} (בן/בת זוג):</strong>
        <ul style="list-style:none;padding:0;margin:5px 0;">
          ${spouse.map(doc => {
            const formatted = formatDocumentName(doc, spouseName);
            return `<li>• ${formatted.html}</li>`;
          }).join('')}
        </ul>
      </div>`;
    }

    html += `<div style="margin-bottom:20px;">
      <h4 style="margin:0 0 10px 0;color:#ff9800;border-bottom:1px solid #ffe0b2;">${category.emoji} ${categoryName}</h4>
      ${docsHtml}
    </div>`;
  });

  return `<div style="margin-top:20px;padding:15px;background:#fff3cd;border-radius:8px;border-right:5px solid #ff9800;">
    <h3>📄 מסמכים נדרשים</h3>
    ${html}
  </div>`;
}

// For n8n: return functions as object
return {
  formatDocumentName,
  groupDocumentsByCategory,
  separateClientAndSpouse,
  generateDocumentListHTML
};
