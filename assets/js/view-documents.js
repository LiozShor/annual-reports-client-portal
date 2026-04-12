/* ===========================================
   VIEW DOCUMENTS JAVASCRIPT - view-documents.html
   SSOT: categories + doc names from API (Airtable)
   =========================================== */

let currentData = null;
let currentLang = 'he';

// Filing type tabs state
let allReports = [];           // from get-client-reports
let siblingTokens = {};        // reportId → token
let tabDataCache = {};         // reportId → API response data
let activeReportId = null;     // currently displayed report (set after reportId is parsed)

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

// sanitizeDocHtml() loaded from shared/utils.js

/** Sanitize HTML for Help Content */
function sanitizeHelpHtml(html) {
    if (!html) return '';
    const el = document.createElement('div');
    el.textContent = html;
    let safe = el.innerHTML;
    safe = safe.replace(/&lt;b&gt;/gi, '<b>').replace(/&lt;\/b&gt;/gi, '</b>');
    safe = safe.replace(/&lt;strong&gt;/gi, '<strong>').replace(/&lt;\/strong&gt;/gi, '</strong>');
    safe = safe.replace(/&lt;i&gt;/gi, '<i>').replace(/&lt;\/i&gt;/gi, '</i>');
    safe = safe.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    // Strip escaped <a> tags with empty or non-https hrefs, keep text content
    safe = safe.replace(/&lt;a\s+href="(?!https?:\/\/)[^"]*"[^&]*&gt;([\s\S]*?)&lt;\/a&gt;/gi, '$1');
    // Un-escape valid <a> tags (https only)
    safe = safe.replace(/&lt;a\s+href="(https?:\/\/[^"]*)"[^&]*&gt;/gi, (match, url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">`;
    });
    safe = safe.replace(/&lt;\/a&gt;/gi, '</a>');
    return safe;
}

window.toggleDocHelp = function (btn) {
    const wrapper = btn.closest('.doc-item-wrapper');
    const content = wrapper.querySelector('.doc-help-content');

    if (content.classList.contains('open')) {
        content.classList.remove('open');
        content.classList.remove('pinned');
        btn.classList.remove('active');
    } else {
        content.classList.add('open');
        content.classList.add('pinned');
        btn.classList.add('active');
    }
};

/** Hover open/close for help content (skip if pinned via click) */
document.addEventListener('mouseover', function (e) {
    if (!e.target || !e.target.closest) return;
    const wrapper = e.target.closest('.doc-item-wrapper');
    if (!wrapper || wrapper._hoverOpen) return;
    const content = wrapper.querySelector('.doc-help-content');
    if (!content || content.classList.contains('pinned')) return;
    wrapper._hoverOpen = true;
    content.classList.add('open');
});

document.addEventListener('mouseout', function (e) {
    if (!e.target || !e.target.closest) return;
    const wrapper = e.target.closest('.doc-item-wrapper');
    if (!wrapper) return;
    if (wrapper.contains(e.relatedTarget)) return;
    const content = wrapper.querySelector('.doc-help-content');
    if (!content || content.classList.contains('pinned')) return;
    wrapper._hoverOpen = false;
    content.classList.remove('open');
});

/** Escape all HTML for plain text content */
function escapeHtml(text) {
    const el = document.createElement('div');
    el.textContent = text || '';
    return el.innerHTML;
}

// Get URL params
const params = new URLSearchParams(window.location.search);
const reportId = params.get('report_id');
activeReportId = reportId;

// Auth tokens — never exposed in the page URL
// Client flow: token stored in sessionStorage by landing.js (or URL param for old links)
// Admin flow: admin session token already in localStorage from admin login
// ADMIN_TOKEN_KEY loaded from shared/constants.js
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
} else if (!clientToken && !adminToken) {
    showLinkExpired();
} else {
    loadDocuments();
}

async function loadDocuments() {
    const loadingEl = document.getElementById('loading');
    const cancelEscalation = startLoadingEscalation(loadingEl, { lang: currentLang });

    try {
        let url, fetchOptions = {};
        if (adminToken && !clientToken) {
            // Office mode only when admin is viewing (no client token present)
            url = `${ENDPOINTS.GET_CLIENT_DOCUMENTS}?report_id=${reportId}&mode=office`;
            fetchOptions = { headers: { 'Authorization': `Bearer ${adminToken}` } };
        } else {
            // Client mode — always use client token when available (server filters waived docs)
            const tokenParam = clientToken ? `&token=${encodeURIComponent(clientToken)}` : '';
            url = `${ENDPOINTS.GET_CLIENT_DOCUMENTS}?report_id=${reportId}${tokenParam}`;
        }
        const response = await fetchWithTimeout(url, fetchOptions, FETCH_TIMEOUTS.load);

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
            if (data.error === 'TOKEN_EXPIRED') {
                showLinkExpired();
            } else {
                showError(data.error || 'Error loading documents / שגיאה בטעינת המסמכים');
            }
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
        const subtitleHe = `${escapeHtml(displayName)} \u2022 שנת מס ${escapeHtml(year)}`;
        const subtitleEn = `${escapeHtml(displayNameEn)} \u2022 Tax Year ${escapeHtml(year)}`;
        document.getElementById('subtitle').innerHTML = `
            <span id="subtitle-he">${subtitleHe}</span>
            <span id="subtitle-en" class="hidden">${subtitleEn}</span>
        `;

        // Set email
        const email = data.support_email || 'reports@moshe-atsits.co.il';
        document.getElementById('email-display').textContent = email;
        document.getElementById('email-display-en').textContent = email;
        const filingLabel = data.report?.filing_type_label_he || '\u05d3\u05d5\u05d7';
        document.getElementById('email-button').href = `mailto:${email}?subject=${encodeURIComponent(`\u05de\u05e1\u05de\u05db\u05d9\u05dd \u05dc${filingLabel} ${year} - ${displayName}`)}`;

        const ftLabelHe = data.report?.filing_type_label_he || '\u05d3\u05d5\u05d7';
        const ftLabelEn = data.report?.filing_type_label_en || 'Report';
        document.title = `\u05e8\u05e9\u05d9\u05de\u05ea \u05de\u05e1\u05de\u05db\u05d9\u05dd \u05e0\u05d3\u05e8\u05e9\u05d9\u05dd \u05dc\u05d4\u05db\u05e0\u05ea \u05d4${ftLabelHe} - Required Documents for ${ftLabelEn}`;
        document.getElementById('title-he').textContent = `\u05e8\u05e9\u05d9\u05de\u05ea \u05de\u05e1\u05de\u05db\u05d9\u05dd \u05e0\u05d3\u05e8\u05e9\u05d9\u05dd \u05dc\u05d4\u05db\u05e0\u05ea \u05d4${ftLabelHe}`;
        document.getElementById('title-en').textContent = `Required Documents for ${ftLabelEn}`;

        // Set default language based on questionnaire language
        currentLang = sourceLanguage || 'he';
        switchLanguage(currentLang);

        renderDocuments();
        document.getElementById('results').style.display = 'block';

        // Cache initial data for tab switching
        tabDataCache[reportId] = data;

        // Discover sibling reports (non-fatal, adds tabs if multi-report client)
        discoverSiblingReports();

        // Show language toggle once results load
        document.getElementById('lang-toggle').style.display = 'flex';

    } catch (error) {
        cancelEscalation();
        console.error('Document load failed', error);

        // Hide loading spinner on error
        const loadingEl2 = document.getElementById('loading');
        if (loadingEl2) loadingEl2.style.display = 'none';

        // Try to show cached data
        const cached = getCachedResponse('docs_' + reportId);
        if (cached && cached.data && cached.data.ok) {
            currentData = cached.data;
            renderFromData(cached.data);
            // Show stale data warning
            showStaleBanner(document.getElementById('results'), { cachedAt: cached.cachedAt, lang: currentLang, onRefresh: function () { location.reload(); } });
            document.getElementById('results').style.display = 'block';
            document.getElementById('lang-toggle').style.display = 'flex';
        } else {
            showErrorWithRetry(document.getElementById('error').parentElement || document.getElementById('loading').parentElement, error, {
                lang: currentLang,
                onRetry: function () {
                    location.reload();
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

    const subtitleHe = `${escapeHtml(displayName)} \u2022 שנת מס ${escapeHtml(year)}`;
    const subtitleEn = `${escapeHtml(displayNameEn)} \u2022 Tax Year ${escapeHtml(year)}`;
    document.getElementById('subtitle').innerHTML = `
        <span id="subtitle-he">${subtitleHe}</span>
        <span id="subtitle-en" class="hidden">${subtitleEn}</span>
    `;

    const email = data.support_email || 'reports@moshe-atsits.co.il';
    document.getElementById('email-display').textContent = email;
    document.getElementById('email-display-en').textContent = email;
    const filingLabel2 = data.report?.filing_type_label_he || '\u05d3\u05d5\u05d7';
    document.getElementById('email-button').href = `mailto:${email}?subject=${encodeURIComponent(`\u05de\u05e1\u05de\u05db\u05d9\u05dd \u05dc${filingLabel2} ${year} - ${displayName}`)}`;

    const ftLabelHe = data.report?.filing_type_label_he || '\u05d3\u05d5\u05d7';
    const ftLabelEn = data.report?.filing_type_label_en || 'Report';
    document.title = `\u05e8\u05e9\u05d9\u05de\u05ea \u05de\u05e1\u05de\u05db\u05d9\u05dd \u05e0\u05d3\u05e8\u05e9\u05d9\u05dd \u05dc\u05d4\u05db\u05e0\u05ea \u05d4${ftLabelHe} - Required Documents for ${ftLabelEn}`;
    document.getElementById('title-he').textContent = `\u05e8\u05e9\u05d9\u05de\u05ea \u05de\u05e1\u05de\u05db\u05d9\u05dd \u05e0\u05d3\u05e8\u05e9\u05d9\u05dd \u05dc\u05d4\u05db\u05e0\u05ea \u05d4${ftLabelHe}`;
    document.getElementById('title-en').textContent = `Required Documents for ${ftLabelEn}`;

    currentLang = sourceLanguage || 'he';
    switchLanguage(currentLang);
    renderDocuments();
    updateFilingBadge();
}

/**
 * Build the amber "rejected uploads" callout HTML.
 * Returns '' when entries is empty/falsy (no-op).
 * @param {Array} entries - parsed rejected_uploads_log array
 * @param {boolean} isHe  - true = Hebrew (RTL), false = English (LTR)
 */
function buildRejectedUploadsCallout(entries, isHe) {
    if (!Array.isArray(entries) || entries.length === 0) return '';

    const dir   = isHe ? 'rtl' : 'ltr';
    const align = isHe ? 'right' : 'left';

    const title    = isHe
        ? '\u05de\u05e1\u05de\u05db\u05d9\u05dd \u05e9\u05e7\u05d9\u05d1\u05dc\u05e0\u05d5 \u05de\u05de\u05da \u05d1\u05e2\u05d1\u05e8'
        : 'Files we received from you previously';
    const subtitle = isHe
        ? '\u05e9\u05d9\u05dd \u05dc\u05d1 \u2014 \u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05d4\u05d9\u05d4 \u05dc\u05e9\u05dc\u05d1 \u05d0\u05ea \u05d4\u05de\u05e1\u05de\u05db\u05d9\u05dd \u05d4\u05d1\u05d0\u05d9\u05dd. \u05d0\u05dd \u05d4\u05dd \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd, \u05d0\u05e0\u05d0 \u05e9\u05dc\u05d7 \u05d0\u05d5\u05ea\u05dd \u05e9\u05d5\u05d1 \u05d1\u05d0\u05d9\u05db\u05d5\u05ea \u05d8\u05d5\u05d1\u05d4.'
        : "Note \u2014 we received the following files but couldn\u2019t use them. If they are relevant, please resend them clearly.";

    let rowsHtml = '';
    for (const entry of entries) {
        // Format date DD/MM/YYYY from YYYY-MM-DD
        const rawDate = entry.received_at || '';
        let dateStr = rawDate;
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
            const [y, m, d] = rawDate.split('-');
            dateStr = `${d}/${m}/${y}`;
        }

        let rowText = escapeHtml(entry.filename || '');
        rowText += ` \u00B7 ${escapeHtml(dateStr)}`;
        if (entry.reason_text && entry.reason_text.trim()) {
            rowText += ` \u00B7 ${escapeHtml(entry.reason_text)}`;
        }
        if (entry.notes && entry.notes.trim()) {
            rowText += ` (${escapeHtml(entry.notes)})`;
        }

        rowsHtml += `<div style="padding:6px 0;border-bottom:1px solid #FDE68A;font-size:14px;color:#92400E;direction:${dir};text-align:${align};">${rowText}</div>`;
    }

    return `<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:20px;margin-bottom:20px;direction:${dir};">` +
        `<div style="font-size:16px;font-weight:700;color:#92400E;margin-bottom:8px;text-align:${align};">${title}</div>` +
        `<div style="font-size:14px;color:#78350F;margin-bottom:12px;text-align:${align};">${subtitle}</div>` +
        `<div>${rowsHtml}</div>` +
        `</div>`;
}

function renderDocuments() {
    if (!currentData || !currentData.groups) return;

    const container = document.getElementById('documents-container');
    const isHe = currentLang === 'he';

    // Render rejected-uploads callout above the doc list
    const calloutContainer = document.getElementById('rejected-uploads-callout');
    if (calloutContainer) {
        let rejectedEntries = [];
        try {
            const raw = currentData.rejected_uploads_log;
            if (raw && typeof raw === 'string' && raw.trim()) {
                rejectedEntries = JSON.parse(raw);
            } else if (Array.isArray(raw)) {
                rejectedEntries = raw;
            }
        } catch (e) {
            rejectedEntries = [];
        }
        calloutContainer.innerHTML = buildRejectedUploadsCallout(rejectedEntries, isHe);
    }

    if (currentData.document_count === 0) {
        const stage = currentData.report?.stage || '';
        const isPreQuestionnaire = stage.startsWith('1-') || stage.startsWith('2-');

        if (isPreQuestionnaire) {
            const isAdmin = !!adminToken;
            const ctaHtml = (!isAdmin && clientToken) ? `<a href="index.html?report_id=${encodeURIComponent(reportId)}&token=${encodeURIComponent(clientToken)}" class="btn btn-primary" style="margin-top: var(--sp-4)">${isHe ? 'מלא/י שאלון' : 'Fill Questionnaire'}</a>` : '';
            container.innerHTML = `<div class="alert alert-info" style="flex-direction:column; align-items:center; text-align:center">
                <i data-lucide="clipboard-list" class="icon"></i>
                <span>${isHe
                    ? 'טרם מולא שאלון. יש למלא את השאלון כדי שנוכל להכין את רשימת המסמכים הנדרשים.'
                    : "The questionnaire hasn't been submitted yet. Please fill it out so we can prepare your required documents list."
                }</span>
                ${ctaHtml}
            </div>`;
        } else {
            container.innerHTML = isHe
                ? '<div class="success-message">כל המסמכים התקבלו! אין מסמכים חסרים.</div>'
                : '<div class="success-message">All documents received! No missing documents.</div>';
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    let html = '';
    let totalDocs = 0;
    let receivedDocs = 0;

    for (const group of currentData.groups) {
        // Person header (only if multiple groups = married couple)
        if (currentData.groups.length > 1) {
            const label = isHe ? (group.person_label_he || group.person_label) : (group.person_label_en || group.person_label);
            html += `<div class="person-header"><i data-lucide="user" class="icon"></i>${label}</div>`;
        }

        for (const cat of group.categories) {
            const catName = isHe ? cat.name_he : cat.name_en;
            const iconName = getCategoryIcon(cat.emoji);

            html += `<div class="category-group">`;
            html += `<div class="category-header">`;
            html += `<i data-lucide="${iconName}" class="icon"></i>`;
            html += `<span>${catName}</span>`;
            const activeDocs = cat.docs.filter(d => { const s = (d.status || '').toLowerCase(); return s !== 'waived' && s !== 'removed'; });
            html += `<span class="doc-count">${activeDocs.length}</span>`;
            html += `</div>`;

            for (const doc of cat.docs) {
                // Safety net: skip waived/removed docs even if server didn't filter
                const docStatus = (doc.status || '').toLowerCase();
                if (docStatus === 'waived' || docStatus === 'removed') continue;
                totalDocs++;

                // Document names may contain <b> tags from SSOT — render as HTML
                const docName = isHe
                    ? (doc.name_he || doc.issuer_name || 'מסמך')
                    : (doc.name_en || doc.issuer_name || doc.name_he || 'Document');

                const helpTextRaw = isHe ? doc.help_he : doc.help_en;
                const reportYear = currentData.report?.year || '';
                let helpText = helpTextRaw ? helpTextRaw.replace(/\{year\}/g, reportYear) : '';

                // Replace company placeholders for insurance/pension docs
                if (helpText && (helpText.includes('{company_name}') || helpText.includes('{company_url}'))) {
                    const companyLinks = currentData.company_links || {};
                    // Find matching company by checking if any company name appears in the doc title
                    const docTitle = doc.name_he || doc.issuer_name || '';
                    let matchedCompany = '';
                    let matchedUrl = '';
                    const docTitleLower = docTitle.toLowerCase();
                    for (const [name, url] of Object.entries(companyLinks)) {
                        if (docTitleLower.includes(name.toLowerCase())) {
                            matchedCompany = name;
                            matchedUrl = url;
                            break;
                        }
                    }
                    if (matchedUrl) {
                        helpText = helpText.replace(/\{company_name\}/g, matchedCompany);
                        helpText = helpText.replace(/\{company_url\}/g, matchedUrl);
                    } else {
                        // Graceful fallback: remove link placeholder entirely
                        helpText = helpText.replace(/<a href="\{company_url\}"[^>]*>\{company_name\}<\/a>/g, '');
                        helpText = helpText.replace(/\{company_name\}/g, '');
                        helpText = helpText.replace(/\{company_url\}/g, '#');
                    }
                }
                const showHelp = !!helpText;

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

                html += `<div class="doc-item-wrapper">`;
                html += `<div class="${rowClass}">`;
                html += `<i data-lucide="file" class="icon-sm doc-icon"></i>`;
                html += `<span class="doc-name">${sanitizeDocHtml(docName)}</span>`;

                if (showHelp) {
                    html += `<button class="help-toggle-btn" onclick="toggleDocHelp(this)" title="${isHe ? 'הנחיות קבלת מסמך' : 'Document Help'}">`;
                    html += `<span class="help-icon-text">?</span>`;
                    html += `</button>`;
                }

                html += `<span class="${badgeClass}">${badgeText}</span>`;
                html += `</div>`; // end .doc-row

                if (showHelp) {
                    html += `<div class="doc-help-content">`;
                    html += sanitizeHelpHtml(helpText);
                    html += `</div>`;
                }
                html += `</div>`; // end .doc-item-wrapper
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

    // Re-render filing tabs and badge with correct language
    if (allReports.length > 1) {
        renderFilingTabs();
        updateFilingBadge();
    }
}

// ── Filing Type Badge (DL-251) ───────────────────────────────────
function updateFilingBadge() {
    const badge = document.getElementById('filing-type-badge');
    if (!badge || allReports.length <= 1) return;

    const report = allReports.find(r => r.report_id === activeReportId);
    if (!report) return;

    const isHe = currentLang === 'he';
    badge.textContent = isHe ? report.label_he : report.label_en;
    badge.className = `ai-filing-type-badge ai-ft-${report.filing_type}`;
    badge.style.display = 'inline-flex';
}

// ── Filing Type Tabs ──────────────────────────────────────────────

async function discoverSiblingReports() {
    try {
        const tokenParam = clientToken ? `&token=${encodeURIComponent(clientToken)}` : '';
        const resp = await fetchWithTimeout(
            `${ENDPOINTS.GET_CLIENT_REPORTS}?report_id=${encodeURIComponent(reportId)}${tokenParam}`,
            {}, FETCH_TIMEOUTS?.load || 15000
        );
        const data = await resp.json();
        if (!data.ok || !data.reports || data.reports.length <= 1) return;

        allReports = data.reports;
        // Store tokens for sibling reports
        for (const r of allReports) {
            siblingTokens[r.report_id] = r.token;
        }

        renderFilingTabs();
    } catch (e) {
        // Non-fatal — single-report experience continues
        console.error('[view-docs] Sibling discovery failed:', e.message);
    }
}

function renderFilingTabs() {
    const container = document.getElementById('filing-tabs');
    if (!container) return;
    const isHe = currentLang === 'he';

    container.innerHTML = allReports.map(r => {
        const label = isHe ? r.label_he : r.label_en;
        const isActive = r.report_id === activeReportId;
        return `<button class="filing-tab${isActive ? ' active' : ''}"
                 data-report-id="${r.report_id}"
                 onclick="switchFilingTab('${r.report_id}')">
            ${escapeHtml(label)} <span class="tab-count">(${r.docs_received}/${r.docs_total})</span>
        </button>`;
    }).join('');
    container.style.display = 'flex';
    updateFilingBadge();
}

window.switchFilingTab = function(newReportId) {
    if (newReportId === activeReportId) return;
    activeReportId = newReportId;

    // Update active tab styling
    document.querySelectorAll('.filing-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.reportId === newReportId);
    });

    if (tabDataCache[newReportId]) {
        // Render from cache
        currentData = tabDataCache[newReportId];
        renderFromData(currentData);
        document.getElementById('results').style.display = 'block';
    } else {
        // Fetch docs for this report
        loadSiblingDocs(newReportId);
    }
};

async function loadSiblingDocs(siblingReportId) {
    const token = siblingTokens[siblingReportId];
    if (!token) return;

    // Show loading
    document.getElementById('results').style.display = 'none';
    document.getElementById('loading').style.display = 'block';

    try {
        const resp = await fetchWithTimeout(
            `${ENDPOINTS.GET_CLIENT_DOCUMENTS}?report_id=${encodeURIComponent(siblingReportId)}&token=${encodeURIComponent(token)}`,
            {}, FETCH_TIMEOUTS?.load || 15000
        );
        const data = await resp.json();

        if (!data.ok) {
            throw new Error(data.error || 'Failed to load documents');
        }

        // Cache and render
        tabDataCache[siblingReportId] = data;
        currentData = data;

        document.getElementById('loading').style.display = 'none';
        renderFromData(data);
        document.getElementById('results').style.display = 'block';
    } catch (err) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('results').style.display = 'block';
        // Show error inline
        const container = document.getElementById('documents-container');
        if (container) container.innerHTML = `<div class="alert alert-danger">${currentLang === 'he' ? 'שגיאה בטעינת מסמכים' : 'Error loading documents'}</div>`;
    }
}

function showError(message) {
    document.getElementById('loading').style.display = 'none';
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function showLinkExpired() {
    document.getElementById('loading').style.display = 'none';
    const errorDiv = document.getElementById('error');
    errorDiv.innerHTML = '<strong>הקישור פג תוקף</strong> — פנה למשרד לקבלת קישור חדש.<br><span style="font-size:0.9em;opacity:0.8">Link expired — please contact the office for a new link.</span>';
    errorDiv.style.display = 'block';
}
