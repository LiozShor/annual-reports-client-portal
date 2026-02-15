/* ===========================================
   VIEW DOCUMENTS JAVASCRIPT - view-documents.html
   SSOT: categories + doc names from API (Airtable)
   =========================================== */

let currentData = null;
let currentLang = 'he';

// Get report_id from URL
const params = new URLSearchParams(window.location.search);
const reportId = params.get('report_id');

if (!reportId) {
    showError('Missing report ID / חסר מזהה דוח');
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
        console.log('API Response:', data);
        currentData = data;

        document.getElementById('loading').style.display = 'none';

        if (!data.ok) {
            showError(data.error || 'Error loading documents / שגיאה בטעינת המסמכים');
            return;
        }

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
        showError('Error loading documents / שגיאה בטעינת המסמכים');
    }
}

function renderDocuments() {
    if (!currentData || !currentData.groups) return;

    const container = document.getElementById('documents-container');
    const isHe = currentLang === 'he';

    if (currentData.document_count === 0) {
        container.innerHTML = isHe
            ? '<div class="success-message">כל המסמכים התקבלו! אין מסמכים חסרים.</div>'
            : '<div class="success-message">All documents received! No missing documents.</div>';
        return;
    }

    let html = '';

    for (const group of currentData.groups) {
        // Person header (only if multiple groups = married couple)
        if (currentData.groups.length > 1) {
            const label = isHe ? group.person_label_he : group.person_label_en;
            html += `<div class="person-header">${label}</div>`;
        }

        for (const cat of group.categories) {
            const catName = `${cat.emoji} ${isHe ? cat.name_he : cat.name_en}`;

            html += `<div class="category">`;
            html += `<div class="category-header">${catName}</div>`;
            html += `<ul class="document-list">`;

            for (const doc of cat.docs) {
                // Document names may contain <b> tags from SSOT — render as HTML
                const docName = isHe ? doc.name_he : (doc.name_en || doc.name_he);

                let statusBadge = '';
                if (doc.status === 'Received') {
                    statusBadge = isHe
                        ? '<span class="status-badge status-received">התקבל</span>'
                        : '<span class="status-badge status-received">Received</span>';
                } else if (doc.status === 'Requires_Fix') {
                    statusBadge = isHe
                        ? '<span class="status-badge status-fix">דורש תיקון</span>'
                        : '<span class="status-badge status-fix">Needs Fix</span>';
                } else {
                    statusBadge = isHe
                        ? '<span class="status-badge status-missing">נדרש</span>'
                        : '<span class="status-badge status-missing">Required</span>';
                }

                html += `<li class="document-item">${statusBadge}${docName}</li>`;
            }

            html += `</ul></div>`;
        }
    }

    container.innerHTML = html;
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
