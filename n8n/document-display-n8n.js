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
    employment: { name_he: 'הכנסות מעבודה', name_en: 'Employment', emoji: '💼', order: 1, docs: [] },
    investments: { name_he: 'בנקים והשקעות', name_en: 'Banks & Investments', emoji: '🏦', order: 2, docs: [] },
    insurance: { name_he: 'ביטוח ופנסיה', name_en: 'Insurance & Pension', emoji: '🛡️', order: 3, docs: [] },
    family: { name_he: 'משפחה וילדים', name_en: 'Family & Children', emoji: '👨‍👩‍👧‍👦', order: 4, docs: [] },
    education: { name_he: 'השכלה', name_en: 'Education', emoji: '🎓', order: 5, docs: [] },
    other: { name_he: 'אחר', name_en: 'Other', emoji: '📋', order: 99, docs: [] }
  };

  documents.forEach(doc => {
    const categoryId = doc.category || 'other';
    if (!categories[categoryId]) {
      categories[categoryId] = categories.other;
    }
    categories[categoryId].docs.push(doc);
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
