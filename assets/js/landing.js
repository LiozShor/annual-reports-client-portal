/* ===========================================
   LANDING PAGE JAVASCRIPT - index.html
   =========================================== */

// --- Config & Params ---
// SEC-004: Only read opaque identifiers from URL — PII fetched from API
const params = new URLSearchParams(window.location.search);
const reportId = params.get('report_id');
const token = params.get('token');

// PII populated from API in checkExistingSubmission(), not from URL
let clientId = '', year = '', fullName = '', email = '';

// Strip all query params from URL immediately (defense in depth)
if (window.location.search) {
    history.replaceState(null, '', window.location.pathname);
}

// Default form IDs — overridden by API response when available
const FORM_HE = '1AkYKb';
const FORM_EN = '1AkopM';
// API-driven form IDs (populated in checkExistingSubmission)
let formIdHe = FORM_HE;
let formIdEn = FORM_EN;
// Endpoints loaded from shared/endpoints.js
const CHECK_ENDPOINT = ENDPOINTS.CHECK_EXISTING_SUBMISSION;


// --- Localization ---
// Base64 stored to avoid encoding issues in some editors
const HE_B64 = {
    header_title: "8J+TiyDXqdeQ15zXldefINeT15XXlyDXqdeg16rXmQ==",
    loading_check: "15HXldeT16cg16DXqteV16DXmdedINen15nXmdee15nXnS4uLg==",

    // Alert messages
    warning_title: "157XpteQ16DXlSDXoNeq15XXoNeZ150g16fXmdeZ157XmdedINec15PXldeXINeU15bXlA==",
    warn_existing_flow: "16DXqNeQ15Qg16nXm9eR16gg157Xmdec15DXqiDXkNeqINeU16nXkNec15XXnyDXkdei15HXqCDXoteR15XXqCDXlNeT15XXlyDXlNeW15Qu",
    warn_docs_present: "15nXqSDXnteh157Xm9eZ150g16fXmdeZ157XmdedINec15PXldeXINeU15bXlC4=",
    warn_doc_count_label: "157Xodee15vXmdedINen15nXmdee15nXnQ==",

    // Buttons
    btn_view_docs: "16bXpNeUINeR157Xodee15vXmdedINeU16DXk9eo16nXmded",

    ready_title: "4pyFINee15XXm9efINec15TXqteX15nXnD8=",
    choose_language: "15HXl9eoINeQ16og15TXqdek15Qg15TXnteV16LXk9ek16og16LXnNeZ15o6",
    err_loading: "16nXkteZ15DXlCDXkdeY16LXmdeg16og15TXoNeq15XXoNeZ150=",
    err_missing_params: "16TXqNee15jXqNeZ150g15fXodeo15nXnSDXkden15nXqdeV16g="
};

function b64ToUtf8(b64) {
    try {
        const binary = atob(b64);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e) { return ''; }
}

function t(key) {
    return b64ToUtf8(HE_B64[key] || '');
}

// --- Lucide icon helper ---
function lucideIcon(name, cls = '') {
    return `<i data-lucide="${name}" class="${cls}"></i>`;
}

function reinitIcons() {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// --- Logic ---

// STAGE_ORDER loaded from shared/constants.js

function stageRank(s) {
    return STAGE_ORDER[s] || 0;
}

async function checkExistingSubmission() {
    const loadingEl = document.getElementById('content');
    const cancelEscalation = startLoadingEscalation(loadingEl);

    try {
        const url = `${CHECK_ENDPOINT}?report_id=${encodeURIComponent(reportId)}&token=${encodeURIComponent(token)}`;
        const response = await fetchWithTimeout(url, { cache: 'no-store' }, FETCH_TIMEOUTS.quick);
        cancelEscalation();

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (data && data.ok === false) {
            if (data.error === 'TOKEN_EXPIRED') {
                showLinkExpired();
            } else {
                showError('Invalid link or report not found. Please contact the office.');
            }
            return;
        }

        // SEC-004: Populate client data from API (not URL)
        clientId = data.client_id || '';
        year = data.year || '';
        fullName = data.client_name || '';
        email = data.client_email || '';

        // API-driven form IDs (filing_type layer)
        formIdHe = data.form_id_he || FORM_HE;
        formIdEn = data.form_id_en || FORM_EN;

        // Dynamic header/title based on filing type
        const ftLabelHe = data.filing_type_label_he || 'דוח שנתי';
        const ftLabelEn = data.filing_type_label_en || 'Annual Report';
        document.getElementById('headerTitle').textContent = '\uD83D\uDCCB \u05E9\u05D0\u05DC\u05D5\u05DF ' + ftLabelHe;
        document.querySelector('.header-subtitle').textContent = ftLabelEn + ' Questionnaire';
        document.title = ftLabelEn + ' Questionnaire';

        const stage = data.stage || 'Send_Questionnaire';
        const docCount = Number(data.document_count || 0);
        const hasDocs = docCount > 0;
        const rank = stageRank(stage);

        // Warn only if questionnaire was actually submitted before (stage >= 3) OR documents exist
        const treatAsExisting = (typeof data.has_submission === 'boolean')
            ? data.has_submission
            : ((rank >= 3) || hasDocs);

        if (!treatAsExisting) {
            showLanguageSelection();
        } else {
            showExistingProcessOptions({ docCount, hasDocs });
        }
    } catch (error) {
        cancelEscalation();
        showErrorWithRetry(document.getElementById('content'), error, {
            lang: 'he',
            onRetry: function () { checkExistingSubmission(); }
        });
    }
}

function showExistingProcessOptions({ docCount, hasDocs }) {
    const content = document.getElementById('content');

    content.innerHTML = `
        <div class="alert-box bilingual">
            <div class="alert-icon-wrapper">
                ${lucideIcon('alert-triangle', 'icon-lg')}
            </div>
            <div class="alert-title">${t('warning_title')}</div>
            <div class="en text-sm">Existing data found for this report</div>

            <p class="alert-text" style="margin-top: var(--sp-4)">
                ${t('warn_existing_flow')}
            </p>

            ${hasDocs ? `
                <div class="doc-badge">
                    ${lucideIcon('paperclip', 'icon-sm')} ${docCount} ${t('warn_doc_count_label')}
                </div>
                <p class="alert-text text-sm">
                    ${t('warn_docs_present')}
                </p>
            ` : ''}
        </div>

        <div class="actions">
            <button class="btn btn-primary btn-lg" onclick="viewDocuments()">
                <div class="bilingual">
                    <span class="flex items-center justify-center gap-2">
                        ${lucideIcon('file-text', 'icon-sm')} ${t('btn_view_docs')}
                    </span>
                    <span class="en text-sm" style="opacity:0.8">View Required Documents</span>
                </div>
            </button>

        </div>
    `;
    reinitIcons();
}

function showLanguageSelection() {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="alert-box bilingual">
            <div class="ready-icon-wrapper">
                ${lucideIcon('circle-check', 'icon-lg')}
            </div>
            <div class="alert-title">${t('ready_title')}</div>
            <p class="alert-text">${t('choose_language')}</p>
        </div>

        <div class="lang-grid">
            <div class="lang-card" onclick="goToForm('he')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')goToForm('he')">
                <img src="https://flagcdn.com/w40/il.png" alt="Israel" class="lang-flag">
                <span class="lang-name">עברית</span>
            </div>
            <div class="lang-card" onclick="goToForm('en')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')goToForm('en')">
                <img src="https://flagcdn.com/w40/gb.png" alt="UK" class="lang-flag">
                <span class="lang-name">English</span>
            </div>
        </div>
    `;
    reinitIcons();
}

function viewDocuments() {
    // Store token in sessionStorage — keeps it out of the URL bar and browser history
    sessionStorage.setItem('client_doc_token', token || '');
    window.location.href = `view-documents.html?report_id=${reportId}`;
}


function goToForm(lang) {
    const formId = lang === 'he' ? formIdHe : formIdEn;
    const qs = new URLSearchParams({
        report_record_id: reportId,
        client_id: clientId,
        year: year,
        questionnaire_token: token,
        full_name: fullName || '',
        email: email || '',
        source_language: lang
    }).toString();
    window.location.href = `https://tally.so/r/${formId}?${qs}`;
}

function _escapeHtmlErr(s) {
    const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML;
}

function showError(msg) {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="error-state bilingual" role="alert" aria-live="assertive">
            <div class="error-icon-wrapper" style="margin: 0 auto var(--sp-4)">
                ${lucideIcon('alert-triangle', 'icon-lg')}
            </div>
            <h3>Error</h3>
            <p>${_escapeHtmlErr(msg)}</p>
        </div>
    `;
    reinitIcons();
}

function showLinkExpired() {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="error-state bilingual" role="alert" aria-live="assertive">
            <div class="error-icon-wrapper" style="margin: 0 auto var(--sp-4)">
                ${lucideIcon('clock', 'icon-lg')}
            </div>
            <h3>הקישור פג תוקף</h3>
            <p>הקישור שלך פג תוקפו. אנא פנה למשרד כדי לקבל קישור חדש.</p>
            <div class="en" style="margin-top: var(--sp-4); border-top: 1px solid var(--neutral-200); padding-top: var(--sp-4)">
                <h3>Link Expired</h3>
                <p>Your link has expired. Please contact the office to receive a new link.</p>
            </div>
        </div>
    `;
    reinitIcons();
}

function init() {
    document.getElementById('headerTitle').textContent = t('header_title') || 'Tax Questionnaire';

    // Initialize offline detection
    initOfflineDetection();

    if (!reportId || !token) {
        showError(t('err_missing_params'));
    } else {
        checkExistingSubmission();
    }
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); reinitIcons(); });
} else {
    init();
    reinitIcons();
}
