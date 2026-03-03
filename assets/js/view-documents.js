/* ===========================================
   VIEW DOCUMENTS JAVASCRIPT - view-documents.html
   SSOT: categories + doc names from API (Airtable)
   =========================================== */

let currentData = null;
let currentLang = 'he';

// Emoji → Lucide icon mapping for categories
const CATEGORY_ICONS = {
    '\u{1F4BC}': 'briefcase',     // 💼
    '\u{1F3E6}': 'landmark',      // 🏦
    '\u{1F3E5}': 'heart-pulse',   // 🏥
    '\u{1F3E0}': 'house',         // 🏠
    '\u{1F4CB}': 'clipboard-list',// 📋
    '\u{1F4B0}': 'coins',         // 💰
    '\u{1F393}': 'graduation-cap',// 🎓
    '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}': 'users', // 👨‍👩‍👧‍👦
    '\u{1F464}': 'user',          // 👤
    '\u{1F491}': 'heart'          // 💑
};

function getCategoryIcon(emoji) {
    return CATEGORY_ICONS[emoji] || 'file-text';
}

// Get URL params
const params = new URLSearchParams(window.location.search);
const reportId = params.get('report_id');

// Auth tokens — never exposed in the page URL
// Client flow: token stored in sessionStorage by landing.js (or URL param for old links)
// Admin flow: admin session token already in localStorage from admin login
const ADMIN_TOKEN_KEY = 'QKiwUBXVH@%#1gD7t@rB]<,dM.[NC5b_';
const clientToken = sessionStorage.getItem('client_doc_token') || params.get('token') || '';
const adminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';

// Strip any tokens from URL to prevent exposure in address bar / browser history
if (params.get('token') || params.get('admin_token')) {
    const cleanUrl = new URL(window.location);
    cleanUrl.searchParams.delete('token');
    cleanUrl.searchParams.delete('admin_token');
    history.replaceState(null, '', cleanUrl);
}

// Initialize offline detection
initOfflineDetection();

if (!reportId) {
    showError('Missing report ID / חסר מזהה דוח');
} else {
    loadDocuments();
}

async function loadDocuments() {
    const loadingEl = document.getElementById('loading');
    const cancelEscalation = startLoadingEscalation(loadingEl, { lang: currentLang });

    try {
        const tokenParam = clientToken
            ? `&token=${encodeURIComponent(clientToken)}`
            : adminToken ? `&admin_token=${encodeURIComponent(adminToken)}` : '';
        const url = `https://liozshor.app.n8n.cloud/webhook/get-client-documents?report_id=${reportId}${tokenParam}`;
        const response = await fetchWithTimeout(url, {}, FETCH_TIMEOUTS.load);

        cancelEscalation();

        if (!response.ok) {
            throw new Error('Failed to load documents');
        }

        const data = await response.json();
        currentData = data;

        // Cache successful response
        cacheResponse('docs_' + reportId, data);

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
        const subtitleHe = `${displayName} \u2022 שנת מס ${year}`;
        const subtitleEn = `${displayNameEn} \u2022 Tax Year ${year}`;
        document.getElementById('subtitle').innerHTML = `
            <span id="subtitle-he">${subtitleHe}</span>
            <span id="subtitle-en" class="hidden">${subtitleEn}</span>
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

        // Show language toggle once results load
        document.getElementById('lang-toggle').style.display = 'flex';

    } catch (error) {
        cancelEscalation();
        console.error('Error:', error);

        // Hide loading spinner on error
        document.getElementById('loading').style.display = 'none';

        // Try to show cached data
        const cached = getCachedResponse('docs_' + reportId);
        if (cached && cached.data && cached.data.ok) {
            currentData = cached.data;
            renderFromData(cached.data);
            // Show stale data warning
            showStaleBanner(document.getElementById('results'), { cachedAt: cached.cachedAt, lang: currentLang, onRefresh: function() { location.reload(); } });
            document.getElementById('results').style.display = 'block';
            document.getElementById('lang-toggle').style.display = 'flex';
        } else {
            showErrorWithRetry(document.getElementById('error').parentElement || document.getElementById('loading').parentElement, error, {
                lang: currentLang,
                onRetry: function () {
                    document.getElementById('loading').style.display = 'block';
                    loadDocuments();
                }
            });
        }
    }
}

function renderFromData(data) {
    const clientName = data.report?.client_name || '';
    const spouseName = data.report?.spouse_name || '';
    const year = data.report?.year || '';
    const sourceLanguage = data.report?.source_language || 'he';

    const displayName = spouseName ? `${clientName} ו${spouseName}` : clientName;
    const displayNameEn = spouseName ? `${clientName} & ${spouseName}` : clientName;

    const subtitleHe = `${displayName} \u2022 שנת מס ${year}`;
    const subtitleEn = `${displayNameEn} \u2022 Tax Year ${year}`;
    document.getElementById('subtitle').innerHTML = `
        <span id="subtitle-he">${subtitleHe}</span>
        <span id="subtitle-en" class="hidden">${subtitleEn}</span>
    `;

    const email = data.support_email || 'reports@moshe-atsits.co.il';
    document.getElementById('email-display').textContent = email;
    document.getElementById('email-display-en').textContent = email;
    document.getElementById('email-button').href = `mailto:${email}?subject=מסמכים לדוח שנתי ${year} - ${displayName}`;

    currentLang = sourceLanguage || 'he';
    switchLanguage(currentLang);
    renderDocuments();
}

function renderDocuments() {
    if (!currentData || !currentData.groups) return;

    const container = document.getElementById('documents-container');
    const isHe = currentLang === 'he';

    if (currentData.document_count === 0) {
        container.innerHTML = isHe
            ? '<div class="success-message">כל המסמכים התקבלו! אין מסמכים חסרים.</div>'
            : '<div class="success-message">All documents received! No missing documents.</div>';
        // Initialize Lucide icons after render
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    let html = '';
    let totalDocs = 0;
    let receivedDocs = 0;

    for (const group of currentData.groups) {
        // Person header (only if multiple groups = married couple)
        if (currentData.groups.length > 1) {
            const label = isHe ? group.person_label_he : group.person_label_en;
            html += `<div class="person-header"><i data-lucide="user" class="icon"></i>${label}</div>`;
        }

        for (const cat of group.categories) {
            const catName = isHe ? cat.name_he : cat.name_en;
            const iconName = getCategoryIcon(cat.emoji);

            html += `<div class="category-group">`;
            html += `<div class="category-header">`;
            html += `<i data-lucide="${iconName}" class="icon"></i>`;
            html += `<span>${catName}</span>`;
            html += `<span class="doc-count">${cat.docs.length}</span>`;
            html += `</div>`;

            for (const doc of cat.docs) {
                totalDocs++;
                // Document names may contain <b> tags from SSOT — render as HTML
                const docName = isHe ? doc.name_he : (doc.name_en || doc.name_he);

                let badgeClass = '';
                let badgeText = '';
                if (doc.status === 'Received') {
                    receivedDocs++;
                    badgeClass = 'badge badge-success';
                    badgeText = isHe ? 'התקבל' : 'Received';
                } else if (doc.status === 'Requires_Fix') {
                    badgeClass = 'badge badge-danger';
                    badgeText = isHe ? 'דורש תיקון' : 'Needs Fix';
                } else {
                    badgeClass = 'badge badge-warning';
                    badgeText = isHe ? 'נדרש' : 'Required';
                }

                const rowClass = doc.status === 'Received' ? 'doc-row doc-received' : 'doc-row';
                html += `<div class="${rowClass}">`;
                html += `<i data-lucide="file" class="icon-sm doc-icon"></i>`;
                html += `<span class="doc-name">${docName}</span>`;

                html += `<span class="${badgeClass}">${badgeText}</span>`;
                html += `</div>`;
            }

            html += `</div>`;
        }
    }

    container.innerHTML = html;

    // Calculate and show progress
    const percent = totalDocs > 0 ? Math.round((receivedDocs / totalDocs) * 100) : 0;
    document.getElementById('progress-fill').style.width = percent + '%';
    document.getElementById('progress-percent').textContent = percent + '%';
    document.getElementById('progress-text-he').textContent = `${receivedDocs} מתוך ${totalDocs} מסמכים התקבלו`;
    document.getElementById('progress-text-en').textContent = `${receivedDocs} of ${totalDocs} documents received`;
    document.getElementById('progress-section').style.display = 'block';

    // Toggle progress text visibility based on language
    document.getElementById('progress-text-he').classList.toggle('hidden', !isHe);
    document.getElementById('progress-text-en').classList.toggle('hidden', isHe);

    // Initialize Lucide icons after rendering new HTML
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
    document.getElementById('title-he').classList.toggle('hidden', !isHe);
    document.getElementById('title-en').classList.toggle('hidden', isHe);

    const subtitleHe = document.getElementById('subtitle-he');
    const subtitleEn = document.getElementById('subtitle-en');
    if (subtitleHe) subtitleHe.classList.toggle('hidden', !isHe);
    if (subtitleEn) subtitleEn.classList.toggle('hidden', isHe);

    // Toggle loading texts
    document.getElementById('loading-text-he').classList.toggle('hidden', !isHe);
    document.getElementById('loading-text-en').classList.toggle('hidden', isHe);

    // Toggle contact section
    document.getElementById('contact-title-he').classList.toggle('hidden', !isHe);
    document.getElementById('contact-title-en').classList.toggle('hidden', isHe);
    document.getElementById('contact-text-he').classList.toggle('hidden', !isHe);
    document.getElementById('contact-text-en').classList.toggle('hidden', isHe);

    // Update email button text
    document.getElementById('email-btn-text').textContent = isHe ? 'שליחת מייל' : 'Send Email';

    // Toggle progress text
    const progressTextHe = document.getElementById('progress-text-he');
    const progressTextEn = document.getElementById('progress-text-en');
    if (progressTextHe) progressTextHe.classList.toggle('hidden', !isHe);
    if (progressTextEn) progressTextEn.classList.toggle('hidden', isHe);

    // Re-render documents
    renderDocuments();
}

function showError(message) {
    document.getElementById('loading').style.display = 'none';
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}
