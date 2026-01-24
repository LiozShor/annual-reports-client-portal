/* ===========================================
   VIEW DOCUMENTS JAVASCRIPT - view-documents.html
   =========================================== */

let currentData = null;
let currentLang = 'he';

// Get report_id from URL
const params = new URLSearchParams(window.location.search);
const reportId = params.get('report_id');

if (!reportId) {
    showError('חסר מזהה דוח / Missing report ID');
} else {
    loadDocuments();
}

async function loadDocuments() {
    try {
        const response = await fetch(`https://liozshor.app.n8n.cloud/webhook/get-client-documents?report_id=${reportId}`);

        if (!response.ok) {
            throw new Error('Failed to load documents');
        }

        const data = await response.json();
        console.log('API Response:', data); // Debug log
        currentData = data;

        document.getElementById('loading').style.display = 'none';

        if (!data.ok) {
            showError(data.error || 'שגיאה בטעינת המסמכים / Error loading documents');
            return;
        }

        // FIXED: Access nested report object
        const clientName = data.report?.client_name || '';
        const spouseName = data.report?.spouse_name || '';
        const year = data.report?.year || '';
        const sourceLanguage = data.report?.source_language || 'he';

        // Build display name (include spouse if exists)
        const displayName = spouseName ? `${clientName} ו${spouseName}` : clientName;
        const displayNameEn = spouseName ? `${clientName} & ${spouseName}` : clientName;

        // Update subtitle
        const subtitleHe = `${displayName} • שנת מס ${year}`;
        const subtitleEn = `${displayNameEn} • Tax Year ${year}`;
        document.getElementById('subtitle').innerHTML = `
            <span id="subtitle-he">${subtitleHe}</span>
            <span id="subtitle-en" style="display: none;">${subtitleEn}</span>
        `;

        // Set email
        const email = data.support_email || 'reports@moshe-atsits.co.il';
        document.getElementById('email-display').textContent = email;
        document.getElementById('email-display-en').textContent = email;
        document.getElementById('email-button').href = `mailto:${email}?subject=מסמכים לדוח שנתי ${year} - ${displayName}`;

        // Set default language based on questionnaire language
        currentLang = sourceLanguage || 'he';
        switchLanguage(currentLang);

        renderDocuments();
        document.getElementById('results').style.display = 'block';

    } catch (error) {
        console.error('Error:', error);
        showError('שגיאה בטעינת המסמכים / Error loading documents');
    }
}

function renderDocuments() {
    // FIXED: API returns "documents" object, not "categories" array
    if (!currentData || !currentData.documents) return;

    const container = document.getElementById('documents-container');

    if (currentData.document_count === 0) {
        container.innerHTML = currentLang === 'he'
            ? '<div class="success-message">✅ כל המסמכים התקבלו! אין מסמכים חסרים.</div>'
            : '<div class="success-message">✅ All documents received! No missing documents.</div>';
        return;
    }

    // Build category translation map from registry
    const categoryTranslations = {};
    Object.values(window.DocRegistry.CATEGORIES).forEach(cat => {
        const heKey = `${cat.emoji} ${cat.he}`;
        categoryTranslations[heKey] = cat.en;
    });

    let html = '';

    // FIXED: Iterate over documents object (category name → documents array)
    for (const [categoryHe, docs] of Object.entries(currentData.documents)) {
        const categoryEn = categoryTranslations[categoryHe] || categoryHe;
        const categoryName = currentLang === 'he' ? categoryHe : categoryEn;

        html += `<div class="category">`;
        html += `<div class="category-header">${categoryName}</div>`;
        html += `<ul class="document-list">`;

        for (const doc of docs) {
            const docName = currentLang === 'he' ? doc.name_he : doc.name_en;

            // Apply smart formatting (bold after dashes)
            const formattedName = formatDocumentName(docName);

            let statusBadge = '';
            if (doc.status === 'Received') {
                statusBadge = currentLang === 'he'
                    ? '<span class="status-badge status-received">התקבל</span>'
                    : '<span class="status-badge status-received">Received</span>';
            } else if (doc.status === 'Requires_Fix') {
                statusBadge = currentLang === 'he'
                    ? '<span class="status-badge status-fix">דורש תיקון</span>'
                    : '<span class="status-badge status-fix">Needs Fix</span>';
            } else {
                statusBadge = currentLang === 'he'
                    ? '<span class="status-badge status-missing">נדרש</span>'
                    : '<span class="status-badge status-missing">Required</span>';
            }

            html += `<li class="document-item">${statusBadge}${formattedName}</li>`;
        }

        html += `</ul></div>`;
    }

    container.innerHTML = html;
}

function formatDocumentName(name) {
    // Bold parts after dashes (names, companies, banks)
    const parts = String(name || '').split(' - ');
    if (parts.length === 1) return name;

    const formatted = [parts[0]];
    for (let i = 1; i < parts.length; i++) {
        formatted.push(`<strong>${parts[i]}</strong>`);
    }

    return formatted.join(' - ');
}

function switchLanguage(lang) {
    currentLang = lang;
    const isHe = lang === 'he';

    // Toggle direction
    document.documentElement.dir = isHe ? 'rtl' : 'ltr';
    document.documentElement.lang = isHe ? 'he' : 'en';

    // Toggle buttons
    document.getElementById('btn-he').classList.toggle('active', isHe);
    document.getElementById('btn-en').classList.toggle('active', !isHe);

    // Toggle titles
    document.getElementById('title-he').style.display = isHe ? 'block' : 'none';
    document.getElementById('title-en').style.display = isHe ? 'none' : 'block';

    const subtitleHe = document.getElementById('subtitle-he');
    const subtitleEn = document.getElementById('subtitle-en');
    if (subtitleHe) subtitleHe.style.display = isHe ? 'inline' : 'none';
    if (subtitleEn) subtitleEn.style.display = isHe ? 'none' : 'inline';

    // Toggle loading texts
    document.getElementById('loading-text-he').style.display = isHe ? 'block' : 'none';
    document.getElementById('loading-text-en').style.display = isHe ? 'none' : 'block';

    // Toggle contact section
    document.getElementById('contact-title-he').style.display = isHe ? 'block' : 'none';
    document.getElementById('contact-title-en').style.display = isHe ? 'none' : 'block';
    document.getElementById('contact-text-he').style.display = isHe ? 'block' : 'none';
    document.getElementById('contact-text-en').style.display = isHe ? 'none' : 'block';

    // Update email button text
    document.getElementById('email-button').textContent = isHe ? '📧 שליחת מייל' : '📧 Send Email';

    // Re-render documents
    renderDocuments();
}

function showError(message) {
    document.getElementById('loading').style.display = 'none';
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}
