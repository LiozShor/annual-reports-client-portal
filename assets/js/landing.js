/* ===========================================
   LANDING PAGE JAVASCRIPT - index.html
   =========================================== */

// --- Config & Params ---
const params = new URLSearchParams(window.location.search);
const reportId = params.get('report_id');
const clientId = params.get('client_id');
const year = params.get('year');
const token = params.get('token');
const fullName = params.get('full_name');
const email = params.get('email');

const FORM_HE = '1AkYKb';
const FORM_EN = '1AkopM';
const CHECK_ENDPOINT = 'https://liozshor.app.n8n.cloud/webhook/check-existing-submission';
const RESET_ENDPOINT = 'https://liozshor.app.n8n.cloud/webhook/reset-submission';

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
    btn_reset: "157Xl9enINeV15TXqteX15wg157XlNeU16rXl9dc15Q=",
    btn_reset_dev_note: "KNeW157XoNeZIC0g15zXpNeZ16rXldeXINeR15zXkdeTKQ==",

    ready_title: "4pyFINee15XXm9efINec15PXqteX15nXnA==",
    choose_language: "15HXl9eoINeQ16og15TXqdek15Qg15TXnteV16LXk9ek16og16LXnNeZ15o6",
    reset_loading: "157XkNek16Eg16DXqteV16DXmdedLi4u",
    reset_done: "4pyFINeU16DXqteV16DXmdedINeQ15XXpNeh15U=",
    err_loading: "16nXkteZ15DXlCDXkdeY16LXmdeg16og15TXoNeq15XXoNeZ150=",
    err_reset: "16nXkteZ15DXlCDXkdeQ15nXpNeV16Eg15TXoNeq15XXoNeZ150=",
    err_missing_params: "16TXqNee15jXqNeZ150g15fXqdeo15nXnSDXkden15nXqdeV16g="
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

// Stage rank (logic only, not displayed)
const STAGE_ORDER = {
    '1-Send_Questionnaire': 1,
    '2-Waiting_For_Answers': 2,
    '3-Collecting_Docs': 3,
    '4-Review': 4,
    '5-Completed': 5
};

function stageRank(s) {
    return STAGE_ORDER[s] || 0;
}

async function checkExistingSubmission() {
    try {
        const url = `${CHECK_ENDPOINT}?report_id=${encodeURIComponent(reportId)}`;
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (data && data.ok === false) {
            showError('Invalid link or report not found. Please contact the office.');
            return;
        }

        const stage = data.stage || '1-Send_Questionnaire';
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
        showError(`${t('err_loading')}`);
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

            <button class="btn btn-outline-danger" onclick="resetAndContinue()">
                <div class="bilingual">
                    <span>${t('btn_reset')}</span>
                    <span class="dev-badge">${t('btn_reset_dev_note')}</span>
                    <span class="en text-sm">Delete & Start Over</span>
                    <span class="en dev-badge">temporary - dev only</span>
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
    // Redirect to view documents page
    window.location.href = `view-documents.html?report_id=${reportId}`;
}

async function resetAndContinue() {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <p>${t('reset_loading')}</p>
        </div>
    `;

    try {
        const url = `${RESET_ENDPOINT}?report_id=${encodeURIComponent(reportId)}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        content.innerHTML = `
            <div class="alert-box bilingual">
                <div class="ready-icon-wrapper">
                    ${lucideIcon('circle-check', 'icon-lg')}
                </div>
                <div class="alert-title" style="color: var(--success-700)">${t('reset_done')}</div>
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
    } catch (error) {
        showError(`${t('err_reset')}`);
    }
}

function goToForm(lang) {
    const formId = lang === 'he' ? FORM_HE : FORM_EN;
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

function showError(msg) {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="error-state bilingual">
            <div class="error-icon-wrapper" style="margin: 0 auto var(--sp-4)">
                ${lucideIcon('alert-triangle', 'icon-lg')}
            </div>
            <h3>Error</h3>
            <p>${msg}</p>
        </div>
    `;
    reinitIcons();
}

function init() {
    document.getElementById('headerTitle').textContent = t('header_title') || 'Tax Questionnaire';

    if (!reportId || !clientId || !year || !token) {
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
