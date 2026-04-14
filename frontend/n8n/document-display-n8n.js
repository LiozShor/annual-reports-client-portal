/**
 * DOCUMENT DISPLAY LIBRARY FOR n8n
 * =================================
 *
 * Fetch from: https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/frontend/n8n/document-display-n8n.js
 */

function formatDocumentName(doc, spouseName = null) {
  // SSOT already handles all formatting - this is now a pass-through
  let name = doc.issuer_name || doc.description || 'מסמך';

  return {
    plain: name,
    html: name
  };
}

function renderDocLi(name, status) {
  if (status === 'Waived') {
    return '';
  }
  if (status === 'Received') {
    return `<li style="color:#9ca3af;text-decoration:line-through;"><span style="color:#059669;">&#x2611;</span> ${name}</li>`;
  }
  return `<li>&#x2610; ${name}</li>`;
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
  options = options || {};
  const clientName = options.client_name || '';
  const spouseName = options.spouse_name || '';
  const language = options.language || 'he';

  const isMarried = spouseName && spouseName.trim().length > 0;

  // Separate by person first (SSOT Rule 1.1)
  const { client, spouse } = separateClientAndSpouse(documents);

  let html = '';

  // ========== CLIENT SECTION ==========
  if (client.length > 0) {
    html += `<div style="margin-bottom:30px;">
      <h3 style="color:#2563eb;border-bottom:2px solid #3b82f6;padding-bottom:8px;">
        מסמכים של הלקוח: <b>${clientName}</b>
      </h3>`;

    // Group client docs by category
    const clientGrouped = groupDocumentsByCategory(client);

    Object.entries(clientGrouped).forEach(([categoryId, category]) => {
      const categoryName = language === 'he' ? category.name_he : category.name_en;

      html += `<div style="margin:15px 0;">
        <h4 style="color:#ff9800;margin:10px 0;">${category.emoji} ${categoryName}</h4>
        <ul style="list-style:none;padding:0;margin:5px 0;">`;

      category.docs.forEach(doc => {
        // SSOT already formatted titles - just pass through
        const name = doc.issuer_name || doc.description || 'מסמך';
        html += renderDocLi(name, doc.status);
      });

      html += `</ul></div>`;
    });

    html += `</div>`;
  }

  // ========== SPOUSE SECTION ==========
  if (isMarried && spouse.length > 0) {
    html += `<div style="margin-bottom:30px;">
      <h3 style="color:#7b1fa2;border-bottom:2px solid #9c27b0;padding-bottom:8px;">
        מסמכים של בן/בת הזוג: <b>${spouseName}</b>
      </h3>`;

    // Group spouse docs by category
    const spouseGrouped = groupDocumentsByCategory(spouse);

    Object.entries(spouseGrouped).forEach(([categoryId, category]) => {
      const categoryName = language === 'he' ? category.name_he : category.name_en;

      html += `<div style="margin:15px 0;">
        <h4 style="color:#ff9800;margin:10px 0;">${category.emoji} ${categoryName}</h4>
        <ul style="list-style:none;padding:0;margin:5px 0;">`;

      category.docs.forEach(doc => {
        // SSOT already formatted titles - just pass through
        const name = doc.issuer_name || doc.description || 'מסמך';
        html += renderDocLi(name, doc.status);
      });

      html += `</ul></div>`;
    });

    html += `</div>`;
  }

  return `<div style="margin-top:20px;padding:15px;background:#fff3cd;border-radius:8px;border-right:5px solid #ff9800;direction:rtl;text-align:right;">
    <h3 style="margin-top:0;">📄 מסמכים נדרשים</h3>
    ${html}
  </div>`;
}

// Exports for Node.js / n8n
module.exports = {
  formatDocumentName,
  renderDocLi,
  groupDocumentsByCategory,
  separateClientAndSpouse,
  generateDocumentListHTML
};