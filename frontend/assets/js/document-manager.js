/* ===========================================
   DOCUMENT MANAGER JAVASCRIPT - document-manager.html
   SSOT: all data (docs, categories, templates) from API (Airtable)
   =========================================== */

const params = new URLSearchParams(window.location.search);
const CLIENT_ID = params.get('client_id');
const PREFERRED_FILING_TYPE = params.get('filing_type'); // auto-select tab from email link
let REPORT_ID = null;
let CLIENT_NAME = '';
let SPOUSE_NAME = '';
let YEAR = '';
let CURRENT_STAGE = '';
let CLIENT_EMAIL = '';
let CLIENT_CC_EMAIL = '';
let CLIENT_PHONE = '';
// STAGE_LABELS, API_BASE, ADMIN_TOKEN_KEY loaded from shared/constants.js
// sanitizeDocHtml() loaded from shared/utils.js
// ENDPOINTS loaded from shared/endpoints.js
let DOCS_FIRST_SENT_AT = null;
let QUEUED_SEND_AT = null;
// DL-306: resolved CPA client_id for linking to AI Review (works for both client_id and report_id URL flows)
let RESOLVED_CLIENT_ID = CLIENT_ID || '';

// DL-281: queued_send_at on Airtable doesn't auto-clear after 08:00 delivery
// (Exchange has no callback). Treat the field as live only while the next
// 08:00 Israel after the approval is still in the future. DST-safe via the
// same probe trick as api/src/lib/israel-time.ts.
function isQueuedSendStillPending(queuedAtIso) {
    if (!queuedAtIso) return false;
    const queuedAt = new Date(queuedAtIso);
    if (isNaN(queuedAt.getTime())) return false;
    const tz = 'Asia/Jerusalem';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false,
    }).formatToParts(queuedAt);
    const y = parseInt(parts.find(p => p.type === 'year').value, 10);
    const m = parseInt(parts.find(p => p.type === 'month').value, 10) - 1;
    const d = parseInt(parts.find(p => p.type === 'day').value, 10);
    const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const targetDay = h < 8 ? d : d + 1;
    const probe = new Date(Date.UTC(y, m, targetDay, 8, 0, 0));
    const probeHourIsrael = parseInt(
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
            .formatToParts(probe).find(p => p.type === 'hour').value, 10
    );
    const offsetHours = probeHourIsrael - 8;
    const scheduledMs = Date.UTC(y, m, targetDay, 8 - offsetHours, 0, 0);
    return Date.now() < scheduledMs;
}
let REPORT_NOTES = '';
let CLIENT_NOTES = []; // Parsed JSON array of client communication entries
let REJECTED_UPLOADS = []; // Parsed JSON array of rejected upload log entries

// Admin auth token — required for this office-only page
const ADMIN_TOKEN = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
if (!ADMIN_TOKEN) {
    window.location.replace('admin/index.html');
}

// State
let currentGroups = [];
let currentDocuments = [];
let markedForRemoval = new Set();
let docsToAdd = new Map(); // displayName → {template_id, category, name_en, person}
let pendingTemplate = null; // Template awaiting detail input
let apiTemplates = [];      // Templates from Airtable (SSOT)
let apiCategories = [];     // Categories from Airtable (SSOT)
let companyLinksMap = {};   // name_he → url from company_links table

// Multi-report (filing tabs) state
let allReports = [];          // All reports for this client [{report_id, filing_type, label_he, ...}]
let reportDataCache = {};     // report_id → cached doc data for tab switching

// Filing type display labels
const FILING_TYPE_LABELS = {
    annual_report: 'דוח שנתי',
    capital_statement: 'הצהרת הון'
};

// Enhanced operations state
let markedForRestore = new Set();   // doc IDs to un-waive
let statusChanges = new Map();      // docId → newStatus
let noteChanges = new Map();        // docId → noteText
let nameChanges = new Map();        // docId → newName
let sendEmailOnSave = false;
let currentDropdownDocId = null;    // currently open status dropdown target
let _uploadTargetDocId = null;      // docId for pending file upload (DL-198)
let activeStatusFilter = '';        // currently active status filter (empty = show all)
let _activeNoteDocId = null;        // docId whose note popover is currently open
let _noteOriginalValue = '';        // value when popover was opened (for cancel/discard)

// Questions for client state
let clientQuestions = [];           // current questions array [{id, text, answer}]
let originalQuestionsJSON = '[]';   // snapshot for dirty checking
let _skipQuestionsReload = false;   // set after save to avoid stale read-after-write

// Variable name → Hebrew label mapping (UI only)
const VAR_LABELS = {
    employer_name: 'שם המעסיק',
    spouse_name: 'שם בן/בת הזוג',
    institution_name: 'בנק / בית השקעות',
    company_name: 'שם החברה',
    city_name: 'שם הישוב',
    allowance_type: 'סוג הקצבה',
    person_name: 'שם מלא',
    withdrawal_type: 'סוג המשיכה',
    withdrawal_other_text: 'פרטי המשיכה',
    deposit_type: 'סוג ההפקדה',
    crypto_source: 'פלטפורמה',
    gambling_source: 'מקור הזכייה',
    rent_income_monthly: 'סכום שכירות חודשי',
    rent_expense_monthly: 'סכום שכירות חודשי',
    withholding_client_name: 'שם הלקוח',
    university_name: 'מוסד לימודים',
    degree_type: 'סוג התואר',
    country: 'מדינה',
    income_type: 'סוג ההכנסה',
    other_income_text: 'פרטי ההכנסה',
    bank_name: 'שם הבנק',
    card_company: 'חברת אשראי',
    lender_name: 'שם המלווה',
    property_address: 'כתובת הנכס',
    renovation_detail: 'פרטי השיפוץ',
    vacation_details: 'פרטי הנכס',
    vehicle_description: 'תיאור הרכב',
    year_plus_1: 'שנה עוקבת',
    survivor_details: 'פרטי שארים',
    relationship_details: 'פרטי ההנצחה',
    medical_details: 'פרטים רפואיים'
};

// Hebrew status labels
const STATUS_LABELS = {
    'Required_Missing': 'חסר',
    'Received': 'התקבל',
    'Requires_Fix': 'נדרש תיקון',
    'Waived': 'אין צורך'
};

// Initialize — header values populated after API load (SEC-004: no PII in URL)
document.getElementById('clientName').textContent = '-';
document.getElementById('spouseName').textContent = '-';
document.getElementById('year').textContent = '-';

// Initialize Lucide icons when DOM is ready
function initIcons() {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Initialize offline detection
initOfflineDetection();

// Call once on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initIcons(); initOfflineDetection('he'); });
} else {
    initIcons();
    initOfflineDetection('he');
}

// Entry point: client_id required
if (CLIENT_ID) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => loadClientReports(CLIENT_ID));
    } else {
        loadClientReports(CLIENT_ID);
    }
} else {
    // No report context — show "Not Started" state
    document.getElementById('loading').style.display = 'none';
    document.getElementById('not-started-view').style.display = 'block';
    setTimeout(initIcons, 50);
}

// Show alert (in-flow banner at top of page)
function showAlert(msg, type = 'success') {
    const alert = document.getElementById('alert');
    const typeMap = { 'error': 'danger', 'success': 'success', 'warning': 'warning', 'info': 'info' };
    const cssType = typeMap[type] || type;
    alert.className = `alert alert-${cssType} show`;
    alert.textContent = msg;
    alert.style.display = 'flex';
    setTimeout(() => {
        alert.classList.remove('show');
        alert.style.display = 'none';
    }, 5000);
}

// Fixed-position toast visible regardless of scroll
function showToast(msg, type = 'info') {
    let t = document.getElementById('_fixedToast');
    if (!t) {
        t = document.createElement('div');
        t.id = '_fixedToast';
        t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:10000;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,.15);transition:opacity .3s;direction:rtl;max-width:90vw;text-align:center;';
        document.body.appendChild(t);
    }
    const colors = { info: '#eff6ff;#1e40af;#bfdbfe', success: '#f0fdf4;#166534;#bbf7d0', error: '#fef2f2;#991b1b;#fecaca' };
    const [bg, fg, bd] = (colors[type] || colors.info).split(';');
    t.style.background = bg; t.style.color = fg; t.style.border = `1px solid ${bd}`;
    t.textContent = msg;
    t.style.opacity = '1'; t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.style.display = 'none', 300); }, 5000);
}

// Button inline loading/success states
const _btnOriginals = new WeakMap();
function setBtnState(btn, state, text) {
    if (!btn) return;
    if (!_btnOriginals.has(btn)) _btnOriginals.set(btn, btn.innerHTML);
    if (state === 'loading') {
        btn.disabled = true;
        btn.classList.add('btn-loading');
        btn.classList.remove('btn-success-flash');
        btn.innerHTML = `<svg class="btn-spinner icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v4m0 12v4m-7.07-15.07 2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/></svg> ${text}`;
    } else if (state === 'success') {
        btn.disabled = true;
        btn.classList.remove('btn-loading');
        btn.classList.add('btn-success-flash');
        btn.innerHTML = `✓ ${text}`;
    } else { // idle
        btn.disabled = false;
        btn.classList.remove('btn-loading', 'btn-success-flash');
        btn.innerHTML = _btnOriginals.get(btn) || btn.innerHTML;
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
    }
}

// Load documents for a specific report
async function loadDocuments(reportId) {
    const loadingEl = document.getElementById('loading');
    const cleanupEscalation = startLoadingEscalation(loadingEl);

    try {
        const response = await retryWithBackoff(
            () => fetchWithTimeout(`${ENDPOINTS.GET_CLIENT_DOCUMENTS}?report_id=${reportId}&mode=office`, {
                headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
            }, FETCH_TIMEOUTS.load),
            { maxRetries: 1 }
        );
        cleanupEscalation();
        const data = await response.json();

        // Update global REPORT_ID to match what we loaded
        REPORT_ID = reportId;

        // SEC-004: Populate all client data from API (not URL)
        if (data.client_name) {
            CLIENT_NAME = data.client_name;
            const nameEl = document.getElementById('clientName');
            if (nameEl) nameEl.textContent = CLIENT_NAME;
        }
        if (data.spouse_name) {
            SPOUSE_NAME = data.spouse_name;
            const spouseEl = document.getElementById('spouseName');
            if (spouseEl) spouseEl.textContent = SPOUSE_NAME;
            const spouseToggle = document.getElementById('spouseDocToggle');
            if (spouseToggle) spouseToggle.style.display = '';
        }
        if (data.year) {
            YEAR = data.year;
            const yearEl = document.getElementById('year');
            if (yearEl) yearEl.textContent = YEAR;
        }
        if (data.stage) {
            CURRENT_STAGE = data.stage;
            const stageEl = document.getElementById('clientStage');
            if (stageEl) stageEl.textContent = STAGE_LABELS[data.stage] || data.stage;
        }
        DOCS_FIRST_SENT_AT = data.docs_first_sent_at || null;
        QUEUED_SEND_AT = isQueuedSendStillPending(data.queued_send_at) ? data.queued_send_at : null;
        updateSentBadge();

        // DL-272: If email is queued for morning send, lock the button
        if (QUEUED_SEND_AT) {
            const sendBtn = document.getElementById('approveSendBtn');
            if (sendBtn) {
                sendBtn.innerHTML = '⏰ ישלח ב-08:00';
                sendBtn.disabled = true;
                sendBtn.title = 'המייל ישלח אוטומטית בבוקר';
            }
        }

        // Report notes
        REPORT_NOTES = data.notes || '';
        const notesTextarea = document.getElementById('reportNotesTextarea');
        if (notesTextarea) {
            notesTextarea.value = REPORT_NOTES;
            notesTextarea.addEventListener('blur', handleNotesSave);
        }

        // Client communication notes
        try {
            // Airtable long text can turn \n escapes into literal newlines — fix before parse
            const cnRaw = (data.client_notes || '[]').replace(/[\n\r\t]/g, m => m === '\n' ? '\\n' : m === '\r' ? '\\r' : '\\t');
            CLIENT_NOTES = JSON.parse(cnRaw);
            if (!Array.isArray(CLIENT_NOTES)) CLIENT_NOTES = [];
        } catch (e) { CLIENT_NOTES = []; }
        renderClientNotes();

        // Rejected uploads log
        try {
            REJECTED_UPLOADS = JSON.parse(data.rejected_uploads_log || '[]');
            if (!Array.isArray(REJECTED_UPLOADS)) REJECTED_UPLOADS = [];
        } catch (e) { REJECTED_UPLOADS = []; }
        renderRejectedUploads();

        // Handle case where report is found but stage is early (no docs yet)
        const stageRank = STAGE_ORDER[data.stage] || 0;
        if (stageRank <= 2) {
            if ((!data.groups || data.document_count === 0) && stageRank <= 1) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('not-started-view').style.display = 'block';
                document.getElementById('secondaryZone').style.display = '';
                setTimeout(initIcons, 50);
                return;
            }
        }

        // Store pre-grouped structure from API (SSOT)
        currentGroups = data.groups || [];
        // Flatten for ID lookups
        currentDocuments = [];
        for (const group of currentGroups) {
            for (const cat of group.categories) {
                for (const doc of cat.docs) {
                    currentDocuments.push(doc);
                }
            }
        }

        // Store templates and categories from API (SSOT)
        apiTemplates = data.templates || [];
        apiCategories = data.categories_list || [];
        companyLinksMap = data.company_links || {};

        // Load client questions
        // Skip if _skipQuestionsReload is set (post-save race: Airtable write may not be committed yet)
        if (_skipQuestionsReload) {
            _skipQuestionsReload = false;
            // keep existing clientQuestions / originalQuestionsJSON — already updated by confirmSubmit
        } else {
            try {
                clientQuestions = JSON.parse(data.client_questions || '[]');
                if (!Array.isArray(clientQuestions)) clientQuestions = [];
            } catch (e) { clientQuestions = []; }
            originalQuestionsJSON = JSON.stringify(clientQuestions);
            renderQuestions();
        }

        // Reset all change tracking — fresh data means no pending changes
        markedForRemoval = new Set();
        docsToAdd = new Map();
        markedForRestore = new Set();
        statusChanges = new Map();
        noteChanges = new Map();
        nameChanges = new Map();
        const sendBtn = document.getElementById('approveSendBtn');
        if (sendBtn) {
            if (QUEUED_SEND_AT) {
                sendBtn.innerHTML = '⏰ ישלח ב-08:00';
                sendBtn.disabled = true;
                sendBtn.title = 'המייל ישלח אוטומטית בבוקר';
            } else {
                sendBtn.disabled = false;
                sendBtn.title = '';
            }
        }

        initDocumentDropdown();
        displayDocuments();
        renderPreuploadedBanner(reportId);
        updateStats();
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
        document.getElementById('secondaryZone').style.display = '';
        setTimeout(initIcons, 50);
        initStickyBar();
        // Pre-fetch questionnaire in background so date shows in header before user clicks
        loadQuestionnaireForReport();

        // Cache loaded data for tab switching
        reportDataCache[reportId] = {
            groups: currentGroups,
            documents: currentDocuments,
            templates: apiTemplates,
            categories: apiCategories,
            companyLinks: companyLinksMap,
            clientName: CLIENT_NAME,
            spouseName: SPOUSE_NAME,
            year: YEAR,
            stage: CURRENT_STAGE,
            docsFirstSentAt: DOCS_FIRST_SENT_AT,
            queuedSendAt: QUEUED_SEND_AT,
            notes: REPORT_NOTES,
            clientNotes: CLIENT_NOTES,
            rejectedUploads: REJECTED_UPLOADS,
            clientQuestions: data.client_questions
        };

        // Discover sibling reports if loaded via report_id (backward compat)
        if (allReports.length === 0 && data.client_id) {
            discoverSiblingReports(reportId);
        }
    } catch (error) {
        cleanupEscalation();
        console.error('Document manager load failed');
        document.getElementById('loading').style.display = 'none';
        showAlert(getErrorMessage(error, 'he'), 'error');
    }
}

// Load all reports for a client (new flow: client_id URL param)
async function loadClientReports(clientId) {
    try {
        const resp = await fetchWithTimeout(
            `${ENDPOINTS.GET_CLIENT_REPORTS}?client_id=${encodeURIComponent(clientId)}&mode=office`,
            { headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` } },
            FETCH_TIMEOUTS.load
        );
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error || 'Failed to load reports');

        allReports = data.reports || [];
        if (data.client_id) RESOLVED_CLIENT_ID = data.client_id;
        CLIENT_EMAIL = data.client_email || '';
        CLIENT_CC_EMAIL = data.cc_email || '';
        CLIENT_PHONE = data.client_phone || '';
        if (allReports.length === 0) {
            updateClientBarContacts();
            document.getElementById('loading').style.display = 'none';
            document.getElementById('not-started-view').style.display = 'block';
            return;
        }

        // Set active report — prefer URL filing_type/tab param, fallback to first
        const preferredTab = PREFERRED_FILING_TYPE || params.get('tab');
        const tabMatch = preferredTab && allReports.find(r => r.filing_type === preferredTab);
        REPORT_ID = tabMatch ? tabMatch.report_id : allReports[0].report_id;
        updateClientBarContacts();

        // Render tabs if multiple reports
        if (allReports.length > 1) renderFilingTabs();
        renderAddFilingTypeBtn();

        // Load docs for active report
        loadDocuments(REPORT_ID);
    } catch (err) {
        document.getElementById('loading').style.display = 'none';
        showAlert('שגיאה בטעינת דוחות: ' + err.message, 'error');
    }
}

// Discover sibling reports when loaded via report_id (backward compat)
async function discoverSiblingReports(reportId) {
    try {
        const resp = await fetchWithTimeout(
            `${ENDPOINTS.GET_CLIENT_REPORTS}?report_id=${encodeURIComponent(reportId)}&mode=office`,
            { headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` } },
            FETCH_TIMEOUTS.load
        );
        const data = await resp.json();
        if (!data.ok || !data.reports) return;

        allReports = data.reports;
        if (data.client_id) RESOLVED_CLIENT_ID = data.client_id;
        // DL-293: populate contact info when loading via report_id
        if (data.client_email !== undefined) CLIENT_EMAIL = data.client_email || '';
        if (data.cc_email !== undefined) CLIENT_CC_EMAIL = data.cc_email || '';
        if (data.client_phone !== undefined) CLIENT_PHONE = data.client_phone || '';
        updateClientBarContacts();
        if (allReports.length > 1) renderFilingTabs();
        renderAddFilingTypeBtn();
    } catch (e) {
        // Non-fatal — just no tabs
    }
}

// DL-306: Render info banner when client has unclassified pre-uploaded docs (stage=Pending_Approval only)
function renderPreuploadedBanner(reportId) {
    const container = document.getElementById('preuploaded-docs-banner');
    if (!container) return;
    container.innerHTML = '';
    if (CURRENT_STAGE !== 'Pending_Approval') return;
    const report = (allReports || []).find(r => r.report_id === reportId);
    const count = Number(report && report.pending_reviews_count) || 0;
    if (count <= 0) return;
    const cpaId = RESOLVED_CLIENT_ID || CLIENT_ID || '';
    if (!cpaId) return;
    const safeCount = String(count);
    const safeCpa = encodeURIComponent(cpaId);
    container.innerHTML = `
<div class="preuploaded-banner" role="status">
  <i data-lucide="info"></i>
  <div class="preuploaded-banner__text">
    <strong>הלקוח כבר שלח מסמכים שממתינים לסיווג</strong>
    <span>מומלץ לעבור עליהם לפני אישור ושליחה.</span>
  </div>
  <a href="admin/index.html?tab=ai-review&client=${safeCpa}" target="_blank" rel="noopener" class="btn btn-sm preuploaded-banner__btn">פתח ב־AI Review</a>
</div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Render filing type tabs for multi-report clients
function renderFilingTabs() {
    const container = document.getElementById('filing-tabs');
    if (!container) return;
    container.innerHTML = allReports.map(r =>
        `<button class="filing-tab${r.report_id === REPORT_ID ? ' active' : ''}"
                 data-report-id="${r.report_id}" onclick="switchFilingTab('${r.report_id}')">
            ${escapeHtml(r.label_he)} <span class="tab-count">(${r.docs_received}/${r.docs_total})</span>
        </button>`
    ).join('');
    container.style.display = 'flex';
}

// Render "Add [other filing type]" button (DL-228)
function renderAddFilingTypeBtn() {
    const container = document.getElementById('addOtherTypeContainer');
    if (!container) return;

    // Determine what types exist
    const existingTypes = new Set(allReports.map(r => r.filing_type || 'annual_report'));

    let otherType = null;
    if (existingTypes.has('annual_report') && !existingTypes.has('capital_statement')) otherType = 'capital_statement';
    else if (existingTypes.has('capital_statement') && !existingTypes.has('annual_report')) otherType = 'annual_report';

    if (!otherType || !CLIENT_EMAIL) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    const label = FILING_TYPE_LABELS[otherType] || otherType;
    container.innerHTML = `<button class="add-filing-type-btn" onclick="addOtherFilingType()">
        <i data-lucide="plus" style="width:14px;height:14px"></i> הוסף ${escapeHtml(label)}
    </button>`;
    container.style.display = 'inline-flex';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.addOtherFilingType = function() {
    const existingTypes = new Set(allReports.map(r => r.filing_type || 'annual_report'));
    let otherType = null;
    if (existingTypes.has('annual_report') && !existingTypes.has('capital_statement')) otherType = 'capital_statement';
    else if (existingTypes.has('capital_statement') && !existingTypes.has('annual_report')) otherType = 'annual_report';
    if (!otherType || !CLIENT_EMAIL) return;

    const label = FILING_TYPE_LABELS[otherType];
    const year = YEAR || allReports[0]?.year || new Date().getFullYear();

    showConfirmDialog(
        `להוסיף ${label} ללקוח ${CLIENT_NAME || CLIENT_EMAIL}?`,
        async () => {
            try {
                const resp = await fetchWithTimeout(ENDPOINTS.ADMIN_BULK_IMPORT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${ADMIN_TOKEN}`
                    },
                    body: JSON.stringify({
                        token: ADMIN_TOKEN,
                        year: Number(year),
                        filing_type: otherType,
                        clients: [{ name: CLIENT_NAME, email: CLIENT_EMAIL, cc_email: CLIENT_CC_EMAIL || undefined }]
                    })
                }, FETCH_TIMEOUTS.quick);
                const data = await resp.json();
                if (data.ok && data.created > 0) {
                    showToast(`${label} נוסף בהצלחה`, 'success');
                    // Reload to show both filing tabs
                    setTimeout(() => location.reload(), 800);
                } else {
                    showToast('שגיאה בהוספת דוח', 'error');
                }
            } catch (err) {
                showToast('שגיאה בהוספת דוח', 'error');
            }
        },
        `הוסף ${label}`
    );
};

// Switch between filing tabs
window.switchFilingTab = function(reportId) {
    if (reportId === REPORT_ID) return;

    // Check for unsaved changes before switching
    const hasChanges = markedForRemoval.size > 0 || docsToAdd.size > 0 ||
        markedForRestore.size > 0 || statusChanges.size > 0 ||
        noteChanges.size > 0 || nameChanges.size > 0 || questionsAreDirty();
    if (hasChanges) {
        showToast('יש שינויים שלא נשמרו — שמור או בטל לפני מעבר', 'error');
        return;
    }

    REPORT_ID = reportId;
    _questionnaireFetched = false; // Reset so questionnaire reloads for new report/filing type

    // Update active tab styling
    document.querySelectorAll('.filing-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.reportId === reportId);
    });

    // Load from cache or fetch
    if (reportDataCache[reportId]) {
        restoreFromCache(reportId);
    } else {
        document.getElementById('content').style.display = 'none';
        document.getElementById('secondaryZone').style.display = 'none';
        document.getElementById('loading').style.display = 'block';
        loadDocuments(reportId);
    }
};

// Restore document manager state from cache (tab switch without fetch)
function restoreFromCache(reportId) {
    const cached = reportDataCache[reportId];
    currentGroups = cached.groups;
    currentDocuments = cached.documents;
    apiTemplates = cached.templates;
    apiCategories = cached.categories;
    companyLinksMap = cached.companyLinks;
    CLIENT_NAME = cached.clientName;
    SPOUSE_NAME = cached.spouseName;
    YEAR = cached.year;
    CURRENT_STAGE = cached.stage;
    DOCS_FIRST_SENT_AT = cached.docsFirstSentAt;
    QUEUED_SEND_AT = isQueuedSendStillPending(cached.queuedSendAt) ? cached.queuedSendAt : null;
    REPORT_NOTES = cached.notes;
    CLIENT_NOTES = cached.clientNotes;
    REJECTED_UPLOADS = cached.rejectedUploads || [];

    // Update header
    const nameEl = document.getElementById('clientName');
    if (nameEl) nameEl.textContent = CLIENT_NAME;
    const spouseEl = document.getElementById('spouseName');
    if (spouseEl) spouseEl.textContent = SPOUSE_NAME || '-';
    const spouseToggle = document.getElementById('spouseDocToggle');
    if (spouseToggle) spouseToggle.style.display = SPOUSE_NAME ? '' : 'none';
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = YEAR;
    const stageEl = document.getElementById('clientStage');
    if (stageEl) stageEl.textContent = STAGE_LABELS[CURRENT_STAGE] || CURRENT_STAGE;
    updateSentBadge();

    const notesTextarea = document.getElementById('reportNotesTextarea');
    if (notesTextarea) notesTextarea.value = REPORT_NOTES;
    renderClientNotes();
    renderRejectedUploads();

    // Reset change tracking
    markedForRemoval = new Set();
    docsToAdd = new Map();
    markedForRestore = new Set();
    statusChanges = new Map();
    noteChanges = new Map();
    nameChanges = new Map();
    const sendBtn = document.getElementById('approveSendBtn');
    if (sendBtn) {
        if (QUEUED_SEND_AT) {
            sendBtn.innerHTML = '⏰ ישלח ב-08:00';
            sendBtn.disabled = true;
            sendBtn.title = 'המייל ישלח אוטומטית בבוקר';
        } else {
            sendBtn.disabled = false;
            sendBtn.title = '';
        }
    }

    // Parse questions
    try { clientQuestions = JSON.parse(cached.clientQuestions || '[]'); } catch (e) { clientQuestions = []; }
    originalQuestionsJSON = JSON.stringify(clientQuestions);
    renderQuestions();

    // Re-render
    initDocumentDropdown();
    displayDocuments();
    renderPreuploadedBanner(reportId);
    updateStats();
    document.getElementById('secondaryZone').style.display = '';
    setTimeout(initIcons, 50);
    loadQuestionnaireForReport();
}

// Save report notes on blur
async function handleNotesSave() {
    const textarea = document.getElementById('reportNotesTextarea');
    if (!textarea) return;
    const newText = textarea.value;
    if (newText === REPORT_NOTES) return;
    REPORT_NOTES = newText;
    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_UPDATE_CLIENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
            body: JSON.stringify({ token: ADMIN_TOKEN, report_id: REPORT_ID, action: 'update-notes', notes: newText })
        });
        const result = await response.json();
        if (result.ok) {
            showNotesSaveIndicator('success');
        } else {
            throw new Error(result.error || 'Failed');
        }
    } catch (err) {
        showNotesSaveIndicator('error');
    }
}

function showNotesSaveIndicator(type) {
    const indicator = document.getElementById('notesSaveIndicator');
    if (!indicator) return;
    indicator.className = 'save-indicator save-indicator--' + type;
    indicator.textContent = type === 'success' ? '✓ נשמר' : '✕ שגיאה בשמירה';
    if (type === 'success') {
        clearTimeout(indicator._fadeTimer);
        indicator._fadeTimer = setTimeout(() => {
            indicator.className = 'save-indicator';
            indicator.textContent = '';
        }, 2000);
    }
}

// Populate add-doc searchable combobox from Airtable templates (SSOT)
function initDocumentDropdown() {
    const dropdown = document.getElementById('addDocComboDropdown');
    const input = document.getElementById('addDocComboInput');
    const container = document.getElementById('addDocCombobox');
    if (!dropdown || !input) return;

    // Build set of existing active template IDs (no user vars = single instance)
    const existingTemplateIds = new Set();
    for (const doc of currentDocuments) {
        if (doc.status !== 'Waived') {
            existingTemplateIds.add(doc.type);
        }
    }

    // Filter templates by active report's filing type
    const activeReport = allReports.find(r => r.report_id === REPORT_ID);
    const currentFilingType = activeReport?.filing_type || 'annual_report';
    const relevantTemplates = apiTemplates.filter(t => !t.filing_type || t.filing_type === currentFilingType);

    // Group templates by category
    const groups = {};
    for (const tpl of relevantTemplates) {
        const catId = tpl.category || 'other';
        if (!groups[catId]) groups[catId] = [];
        groups[catId].push(tpl);
    }

    // Build combobox entries data
    const comboEntries = [];
    for (const cat of apiCategories) {
        const catTemplates = groups[cat.id];
        if (!catTemplates || catTemplates.length === 0) continue;

        const items = [];
        for (const tpl of catTemplates) {
            const userVars = (tpl.variables || []).filter(v => v !== 'year' && v !== 'spouse_name');
            if (userVars.length === 0 && existingTemplateIds.has(tpl.template_id)) continue;

            const displayName = stripBold(tpl.name_he
                .replace(/\{year\}/g, YEAR || 'YYYY')
                .replace(/\{[^}]+\}/g, '[...]'));
            items.push({ tpl, displayName });
        }
        if (items.length > 0) {
            comboEntries.push({ cat, items });
        }
    }

    // Store entries for filtering
    container._entries = comboEntries;

    // Reset wizard state on re-init (report switch)
    resetAddDocWizard();

    // Render full dropdown
    renderAddDocDropdown(comboEntries, '');

    // Only attach listeners once (re-init rebuilds dropdown data via _entries)
    if (container._listenersAttached) return;
    container._listenersAttached = true;

    // Input events
    input.addEventListener('focus', () => {
        if (input.disabled) return;
        container.classList.add('open');
        renderAddDocDropdown(container._entries || [], input.value.trim());
    });

    input.addEventListener('input', () => {
        renderAddDocDropdown(container._entries || [], input.value.trim());
        container.classList.add('open');
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
        if (!container.classList.contains('open')) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                container.classList.add('open');
                e.preventDefault();
            }
            return;
        }
        const options = dropdown.querySelectorAll('.add-doc-combobox-option');
        const current = dropdown.querySelector('.add-doc-combobox-option.highlighted');
        let idx = Array.from(options).indexOf(current);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            idx = Math.min(idx + 1, options.length - 1);
            options.forEach(o => o.classList.remove('highlighted'));
            options[idx]?.classList.add('highlighted');
            options[idx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            idx = Math.max(idx - 1, 0);
            options.forEach(o => o.classList.remove('highlighted'));
            options[idx]?.classList.add('highlighted');
            options[idx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (current) current.click();
        } else if (e.key === 'Escape') {
            container.classList.remove('open');
            input.blur();
        }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            container.classList.remove('open');
        }
    });
}

function renderAddDocDropdown(entries, filter) {
    const dropdown = document.getElementById('addDocComboDropdown');
    const normalizedFilter = filter.toLowerCase();
    let html = '';
    let totalVisible = 0;

    for (const { cat, items } of entries) {
        let groupHtml = '';
        for (const { tpl, displayName } of items) {
            if (normalizedFilter && !displayName.toLowerCase().includes(normalizedFilter)) continue;
            groupHtml += `<div class="add-doc-combobox-option" data-template-id="${tpl.template_id}"
                onclick="onAddDocTemplateSelected('${tpl.template_id}')">${escapeHtml(displayName)}</div>`;
            totalVisible++;
        }
        if (groupHtml) {
            html += `<div class="add-doc-combobox-category">${cat.emoji} ${cat.name_he}</div>${groupHtml}`;
        }
    }

    if (totalVisible === 0) {
        html = '<div class="add-doc-combobox-empty">לא נמצאו תוצאות</div>';
    }

    dropdown.innerHTML = html;
}

// Add-doc wizard state
let addDocWizardState = 'idle'; // idle | variables | preview

function onAddDocTemplateSelected(templateId) {
    const tpl = apiTemplates.find(t => t.template_id === templateId);
    if (!tpl) return;

    const container = document.getElementById('addDocCombobox');
    container.classList.remove('open');

    const autoVars = ['year', 'spouse_name'];
    const userVars = (tpl.variables || []).filter(v => !autoVars.includes(v));

    // Pre-fill auto variables
    const collectedValues = { year: YEAR || '' };
    if ((tpl.variables || []).includes('spouse_name')) {
        collectedValues.spouse_name = SPOUSE_NAME || '';
    }

    pendingTemplate = { tpl, userVars, collectedValues };

    if (userVars.length > 0) {
        showAddDocVariables(tpl, userVars);
    } else {
        showAddDocPreview();
    }
}

function showAddDocVariables(tpl, userVars) {
    addDocWizardState = 'variables';
    const input = document.getElementById('addDocComboInput');
    input.disabled = true;
    input.value = '';

    const displayName = stripBold(tpl.name_he
        .replace(/\{year\}/g, YEAR || 'YYYY')
        .replace(/\{[^}]+\}/g, '[...]'));

    document.getElementById('addDocVarHeader').innerHTML =
        `<i data-lucide="file-text" class="icon-sm"></i> ${escapeHtml(displayName)}`;

    let fieldsHtml = '';
    for (const varName of userVars) {
        const label = VAR_LABELS[varName] || varName;
        fieldsHtml += `
            <div class="add-doc-var-group">
                <label for="addDocVar_${varName}">${escapeHtml(label)}</label>
                <input type="text" id="addDocVar_${varName}" data-var="${varName}" dir="auto"
                    placeholder="${escapeHtml(label)}">
            </div>`;
    }
    document.getElementById('addDocVarFields').innerHTML = fieldsHtml;

    document.getElementById('addDocVarStep').classList.add('active');
    document.getElementById('addDocPreviewStep').classList.remove('active');

    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Focus first input
    const firstInput = document.querySelector('#addDocVarFields input');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);

    // Enter key in last input triggers Next
    const inputs = document.querySelectorAll('#addDocVarFields input');
    inputs.forEach((inp, i) => {
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (i < inputs.length - 1) {
                    inputs[i + 1].focus();
                } else {
                    addDocWizardNext();
                }
            }
        });
    });
}

function addDocWizardNext() {
    if (!pendingTemplate) return;
    const { userVars, collectedValues } = pendingTemplate;

    // Collect all variable values
    let allFilled = true;
    for (const varName of userVars) {
        const input = document.getElementById(`addDocVar_${varName}`);
        const val = input ? input.value.trim() : '';
        if (!val) {
            allFilled = false;
            if (input) {
                input.style.borderColor = 'var(--danger-500)';
                input.focus();
            }
            break;
        }
        input.style.borderColor = '';
        collectedValues[varName] = val;
    }

    if (!allFilled) {
        showAlert('יש למלא את כל השדות', 'error');
        return;
    }

    showAddDocPreview();
}

function showAddDocPreview() {
    if (!pendingTemplate) return;
    addDocWizardState = 'preview';

    const { tpl, collectedValues } = pendingTemplate;
    let displayName = tpl.name_he;
    for (const [key, val] of Object.entries(collectedValues)) {
        displayName = displayName.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
    }
    displayName = stripBold(displayName);

    // Check for duplicate
    if (docsToAdd.has(displayName)) {
        showAlert('מסמך זה כבר נמצא ברשימה', 'error');
        return;
    }

    // Find category info
    const catInfo = apiCategories.find(c => c.id === (tpl.category || 'other'));
    const catLabel = catInfo ? `${catInfo.emoji} ${catInfo.name_he}` : '';
    const person = isSpouseDocMode() ? 'בן/בת זוג' : 'לקוח';
    const personIcon = isSpouseDocMode() ? '👥' : '👤';

    const input = document.getElementById('addDocComboInput');
    input.disabled = true;

    document.getElementById('addDocPreviewContent').innerHTML = `
        <div class="add-doc-preview-name">
            <i data-lucide="file-text" class="icon-sm"></i>
            ${escapeHtml(displayName)}
        </div>
        <div class="add-doc-preview-meta">
            ${catLabel ? `<span>${catLabel}</span>` : ''}
            <span>${personIcon} ${person}</span>
        </div>`;

    document.getElementById('addDocVarStep').classList.remove('active');
    document.getElementById('addDocPreviewStep').classList.add('active');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function confirmAddDoc() {
    if (!pendingTemplate) return;
    const { tpl, collectedValues } = pendingTemplate;

    let displayName = tpl.name_he;
    for (const [key, val] of Object.entries(collectedValues)) {
        displayName = displayName.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
    }
    displayName = stripBold(displayName);

    if (docsToAdd.has(displayName)) {
        showAlert('מסמך זה כבר נמצא ברשימה', 'error');
        resetAddDocWizard();
        return;
    }

    docsToAdd.set(displayName, buildDocMeta(tpl, collectedValues));
    updateSelectedDocs();
    updateStats();
    resetAddDocWizard();
}

function addDocWizardBack(fromStep) {
    if (fromStep === 'preview') {
        // If there are user vars, go back to variables step
        if (pendingTemplate && pendingTemplate.userVars.length > 0) {
            addDocWizardState = 'variables';
            document.getElementById('addDocPreviewStep').classList.remove('active');
            document.getElementById('addDocVarStep').classList.add('active');
            return;
        }
    }
    // Default: reset to idle
    resetAddDocWizard();
}

function resetAddDocWizard() {
    addDocWizardState = 'idle';
    pendingTemplate = null;

    const input = document.getElementById('addDocComboInput');
    if (input) {
        input.disabled = false;
        input.value = '';
    }

    document.getElementById('addDocVarStep').classList.remove('active');
    document.getElementById('addDocPreviewStep').classList.remove('active');

    const container = document.getElementById('addDocCombobox');
    if (container) container.classList.remove('open', 'disabled');
}

// Display documents — renders pre-grouped structure from API (SSOT)
function displayDocuments() {
    const container = document.getElementById('existingDocs');

    if (currentDocuments.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="inbox" class="icon-2xl"></i>
                <p>אין מסמכים נדרשים כרגע</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    let html = '';

    for (const group of currentGroups) {
        if (currentGroups.length > 1) {
            html += `<div class="person-header">${escapeHtml(group.person_label)}</div>`;
        }

        for (const cat of group.categories) {
            html += `
                <div class="category-header">
                    <span>${cat.emoji}</span>
                    <span>${escapeHtml(cat.name)}</span>
                </div>
                <div class="document-group">
            `;

            for (const doc of cat.docs) {
                const isWaived = doc.status === 'Waived';
                const effectiveStatus = statusChanges.get(doc.id) || doc.status;
                const status = getStatusBadge(isWaived ? doc.status : effectiveStatus);
                const hasNote = (doc.bookkeepers_notes && doc.bookkeepers_notes.trim()) || noteChanges.has(doc.id);
                const isRestoreMarked = markedForRestore.has(doc.id);
                const isStatusChanged = statusChanges.has(doc.id);
                const isNameChanged = nameChanges.has(doc.id);
                const displayName = nameChanges.get(doc.id) || doc.name;

                html += `<div class="document-wrapper" id="wrapper-${doc.id}">`;
                html += `
                    <div class="document-item ${isWaived ? 'waived-item' : ''} ${!isWaived && effectiveStatus === 'Received' ? 'status-received' : ''} ${isRestoreMarked ? 'marked-for-restore' : ''} ${isStatusChanged ? 'status-changed' : ''} ${isNameChanged ? 'name-changed' : ''} ${markedForRemoval.has(doc.id) ? 'marked-for-removal' : ''}" id="doc-${doc.id}">
                        ${isWaived
                            ? `<input type="checkbox" class="restore-checkbox"
                                onchange="toggleRestore('${doc.id}')"
                                id="restore-${doc.id}"
                                ${isRestoreMarked ? 'checked' : ''}
                                aria-label="שחזר מסמך">`
                            : ''
                        }
                        <div class="doc-name-group">
                            <span class="document-icon"><i data-lucide="file-text" class="icon-sm"></i></span>
                            <div class="document-name" id="docname-${doc.id}">${sanitizeDocHtml(displayName)}</div>
                            <button type="button" class="name-edit-btn${isWaived ? ' action-hidden' : ''}"
                                ${!isWaived ? `onclick="startNameEdit('${doc.id}')"` : ''}
                                title="שנה שם מסמך"><i data-lucide="pencil" class="icon-xs"></i></button>
                            ${doc.file_url && (effectiveStatus === 'Received' || effectiveStatus === 'Requires_Fix')
                                ? `<a href="${doc.download_url ? escapeHtml(sanitizeUrl(doc.download_url)) : '#'}" ${doc.download_url ? 'download' : ''} rel="noopener noreferrer"
                                        class="file-action-btn${doc.download_url ? '' : ' action-hidden'}" title="הורד קובץ" aria-label="הורד קובץ"><i data-lucide="download" class="icon-sm"></i></a>
                                   <a href="${escapeHtml(sanitizeUrl(doc.file_url))}" target="_blank" rel="noopener noreferrer"
                                        class="file-action-btn" title="צפה בקובץ" aria-label="צפה בקובץ"><i data-lucide="external-link" class="icon-sm"></i></a>`
                                : `<span class="file-action-btn action-hidden"><i data-lucide="download" class="icon-sm"></i></span>
                                   <span class="file-action-btn action-hidden"><i data-lucide="external-link" class="icon-sm"></i></span>`
                            }
                            ${!isWaived ? `<button type="button" class="file-action-btn upload-btn" id="upload-btn-${doc.id}"
                                onclick="triggerUpload('${doc.id}')" title="העלה קובץ" aria-label="העלה קובץ"><i data-lucide="upload" class="icon-sm"></i></button>` : ''}
                            <span id="file-clear-warning-${doc.id}" class="file-clear-warning"
                                style="display:${doc.file_url && effectiveStatus === 'Required_Missing' && doc.status !== 'Required_Missing' ? 'inline-flex' : 'none'}">
                                <i data-lucide="triangle-alert" class="icon-xs"></i> קישור הקובץ יימחק
                            </span>
                        </div>
                        <button type="button" class="delete-toggle${isWaived ? ' action-hidden' : ''} ${!isWaived && markedForRemoval.has(doc.id) ? 'active' : ''}"
                            ${!isWaived ? `onclick="toggleRemoval('${doc.id}')" id="delete-btn-${doc.id}"` : ''}
                            aria-label="סמן להסרה"
                            title="הסר מסמך"><i data-lucide="trash-2" class="icon-sm"></i></button>
                        <button class="note-btn ${hasNote ? 'has-note' : ''} ${noteChanges.has(doc.id) ? 'note-modified' : ''}"
                                onclick="openNotePopover(event, '${doc.id}')"
                                title="הערת משרד"><i data-lucide="${hasNote ? 'message-square-text' : 'message-square'}" class="icon-sm"></i></button>
                        ${isWaived
                            ? `<span class="badge ${status.class}">${status.text}</span>`
                            : `<span class="badge ${status.class} clickable"
                                    onclick="openStatusDropdown(event, '${doc.id}', '${effectiveStatus}')"
                                    id="badge-${doc.id}"
                                    title="לחץ לשינוי סטטוס">${status.text} &#x25BE;</span>`
                        }
                    </div>`;

                // DL-296: AI suggestion chip — only on Required_Missing, non-waived docs
                // that haven't yet been manually renamed in this edit session.
                // DL-300 follow-up: ✨ issuer suggestion feature disabled pending UX rework.
                const suggestion = '';
                if (suggestion && !isWaived && effectiveStatus === 'Required_Missing' && !isNameChanged) {
                    html += `
                        <div class="dm-suggestion-row" id="suggest-row-${doc.id}">
                            <button type="button" class="dm-suggest-chip"
                                data-doc-id="${escapeAttr(doc.id)}"
                                data-suggestion="${escapeAttr(suggestion)}"
                                onclick="acceptDocManagerIssuerSuggestion(this)"
                                title="${escapeAttr('החלף שם מסמך ל: ' + suggestion)}">
                                <span class="dm-suggest-chip__icon">✨</span>
                                <span class="dm-suggest-chip__label">החלף ל-<strong>${escapeHtml(suggestion)}</strong></span>
                                <span class="dm-suggest-chip__check">✓</span>
                            </button>
                        </div>`;
                }

                html += `</div>`;
            }

            html += `</div>`;
        }
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    applyStatusFilter();
}

function getStatusBadge(status) {
    switch (status) {
        case 'Received':
            return { text: 'התקבל', class: 'badge-success' };
        case 'Required_Missing':
            return { text: 'חסר', class: 'badge-danger' };
        case 'Waived':
            return { text: 'אין צורך', class: 'badge-neutral' };
        case 'Requires_Fix':
            return { text: 'נדרש תיקון', class: 'badge-warning' };
        default:
            return { text: status || 'חסר', class: 'badge-danger' };
    }
}

// Toggle removal (waive)
function toggleRemoval(id) {
    const btn = document.getElementById(`delete-btn-${id}`);
    const item = document.getElementById(`doc-${id}`);
    const isActive = markedForRemoval.has(id);

    if (!isActive) {
        markedForRemoval.add(id);
        item.classList.add('marked-for-removal');
        btn.classList.add('active');
        // Waive wins: remove any status change for this doc
        if (statusChanges.has(id)) {
            statusChanges.delete(id);
            item.classList.remove('status-changed');
        }
    } else {
        markedForRemoval.delete(id);
        item.classList.remove('marked-for-removal');
        btn.classList.remove('active');
    }

    updateStats();
}

// Toggle restore (un-waive)
function toggleRestore(id) {
    const checkbox = document.getElementById(`restore-${id}`);
    const item = document.getElementById(`doc-${id}`);

    if (checkbox.checked) {
        markedForRestore.add(id);
        item.classList.add('marked-for-restore');
    } else {
        markedForRestore.delete(id);
        item.classList.remove('marked-for-restore');
    }

    // DL-205: Show/hide file-clear warning for restored docs with files
    const doc = currentDocuments.find(d => d.id === id);
    const warningEl = document.getElementById(`file-clear-warning-${id}`);
    if (warningEl && doc) {
        warningEl.style.display = (checkbox.checked && doc.file_url) ? 'inline-flex' : 'none';
    }

    updateStats();
}

// Status dropdown
function openStatusDropdown(event, docId, currentStatus) {
    event.stopPropagation();
    currentDropdownDocId = docId;
    const dropdown = document.getElementById('statusDropdown');
    const rect = event.target.getBoundingClientRect();

    // Position dropdown below the clicked badge (RTL-aware)
    dropdown.style.top = (rect.bottom + 5) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
    dropdown.style.left = 'auto';
    dropdown.style.display = 'block';

    // Highlight current/effective status
    const effectiveStatus = statusChanges.get(docId) || currentStatus;
    dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.status === effectiveStatus);
    });
}

function setDocStatus(newStatus) {
    if (!currentDropdownDocId) return;
    const docId = currentDropdownDocId;
    const doc = currentDocuments.find(d => d.id === docId);

    if (doc && doc.status === newStatus) {
        // Reset to original — remove from changes
        statusChanges.delete(docId);
    } else {
        statusChanges.set(docId, newStatus);
    }

    updateDocStatusVisual(docId);
    closeStatusDropdown();
    updateStats();
    applyStatusFilter();
}

function updateDocStatusVisual(docId) {
    const doc = currentDocuments.find(d => d.id === docId);
    if (!doc) return;

    const effectiveStatus = statusChanges.get(docId) || doc.status;
    const status = getStatusBadge(effectiveStatus);
    const badge = document.getElementById(`badge-${docId}`);
    const item = document.getElementById(`doc-${docId}`);

    if (badge) {
        badge.className = `badge ${status.class} clickable`;
        badge.innerHTML = status.text + ' &#x25BE;';
    }
    if (item) {
        item.classList.toggle('status-changed', statusChanges.has(docId));
        item.classList.toggle('status-received', effectiveStatus === 'Received' && !item.classList.contains('waived-item'));
    }

    // DL-205: Toggle file-clear warning
    const warningEl = document.getElementById(`file-clear-warning-${docId}`);
    if (warningEl) {
        const willClear = doc.file_url && effectiveStatus === 'Required_Missing' && doc.status !== 'Required_Missing';
        warningEl.style.display = willClear ? 'inline-flex' : 'none';
    }
}

function closeStatusDropdown() {
    document.getElementById('statusDropdown').style.display = 'none';
    currentDropdownDocId = null;
}

// ==================== NOTE POPOVER ====================

function openNotePopover(event, docId) {
    event.stopPropagation();
    const popover = document.getElementById('notePopover');
    if (!popover) return;

    // Toggle off if same doc clicked again
    if (_activeNoteDocId === docId) { closeNotePopover(); return; }

    // Save previous if any
    if (_activeNoteDocId) closeNotePopover();

    _activeNoteDocId = docId;

    // Fill textarea
    const textarea = document.getElementById('notePopoverText');
    const doc = currentDocuments.find(d => d.id === docId);
    const currentNote = noteChanges.has(docId)
        ? noteChanges.get(docId)
        : (doc ? (doc.bookkeepers_notes || '') : '');
    textarea.value = currentNote;
    _noteOriginalValue = currentNote;

    // Position anchored to button using live viewport coords
    const rect = event.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const POP_W = 280;
    const POP_H = 140; // textarea + action bar
    const GAP = 6;
    const PAD = 8;

    // Vertical: below button, flip above if not enough room
    if (vh - rect.bottom - GAP >= POP_H) {
        popover.style.top = (rect.bottom + GAP) + 'px';
        popover.style.bottom = '';
    } else {
        popover.style.top = '';
        popover.style.bottom = (vh - rect.top + GAP) + 'px';
    }

    // Horizontal: align right edge to button, clamped within viewport
    const right = Math.max(PAD, Math.min(vw - rect.right, vw - POP_W - PAD));
    popover.style.right = right + 'px';
    popover.style.left = 'auto';

    popover.style.display = 'block';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function closeNotePopover() {
    const popover = document.getElementById('notePopover');
    if (!popover || !_activeNoteDocId) return;

    const docId = _activeNoteDocId;
    _activeNoteDocId = null;
    popover.style.display = 'none';

    // Save note change
    const textarea = document.getElementById('notePopoverText');
    if (!textarea) return;
    const newText = textarea.value;
    const doc = currentDocuments.find(d => d.id === docId);
    const originalNote = doc ? (doc.bookkeepers_notes || '') : '';

    if (newText === originalNote) {
        noteChanges.delete(docId);
    } else {
        noteChanges.set(docId, newText);
    }

    _updateNoteBtn(docId, newText);
    updateStats();
}

function cancelNotePopover() {
    const popover = document.getElementById('notePopover');
    if (!popover || !_activeNoteDocId) return;

    _activeNoteDocId = null;
    popover.style.display = 'none';
    // Discard — noteChanges not modified; icon stays as it was
}

function _updateNoteBtn(docId, newText) {
    const btn = document.querySelector(`#doc-${docId} .note-btn`);
    if (!btn) return;
    const hasContent = newText.trim().length > 0;
    const iconName = hasContent ? 'message-square-text' : 'message-square';
    btn.innerHTML = `<i data-lucide="${iconName}" class="icon-sm"></i>`;
    btn.classList.toggle('has-note', hasContent);
    btn.classList.toggle('note-modified', noteChanges.has(docId));
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Click-outside → save; Escape → discard; Scroll → save
document.addEventListener('click', function(e) {
    if (!_activeNoteDocId) return;
    const popover = document.getElementById('notePopover');
    if (popover && !popover.contains(e.target)) closeNotePopover();
});

document.addEventListener('keydown', function(e) {
    if (!_activeNoteDocId) return;
    if (e.key === 'Escape') cancelNotePopover();
});

document.addEventListener('scroll', function() {
    if (_activeNoteDocId) closeNotePopover();
}, true);

// Templates with company-specific issuer names (insurance/pension)
const COMPANY_TEMPLATES = ['T501', 'T401', 'T301'];

// Inline document name editing
// DL-296: Accept an AI issuer-name suggestion on doc-manager.
// Uses the same queued-edit pattern as manual rename (nameChanges Map); the
// actual PATCH fires when the admin hits the "Save" button. Server-side,
// edit-documents.ts clears issuer_name_suggested whenever name_updates touches
// the doc, so the chip naturally disappears on re-render.
function acceptDocManagerIssuerSuggestion(btn) {
    if (!btn || btn.disabled) return;
    const docId = btn.dataset.docId;
    const suggestion = (btn.dataset.suggestion || '').trim();
    if (!docId || !suggestion) return;

    const doc = currentDocuments.find(d => d.id === docId);
    if (!doc) return;

    // Queue the name change (same pattern as saveNameEdit)
    nameChanges.set(docId, suggestion);

    // Update the in-memory doc so subsequent renders don't show the chip again
    doc.issuer_name_suggested = '';

    // DOM updates — swap displayed name, mark item as changed, remove the chip row
    const nameEl = document.getElementById(`docname-${docId}`);
    if (nameEl) nameEl.innerHTML = sanitizeDocHtml(suggestion);
    const docEl = document.getElementById(`doc-${docId}`);
    if (docEl) docEl.classList.add('name-changed');
    const row = document.getElementById(`suggest-row-${docId}`);
    if (row) row.remove();

    updateStats();
}

function startNameEdit(docId) {
    const nameEl = document.getElementById(`docname-${docId}`);
    if (!nameEl) return;

    const doc = currentDocuments.find(d => d.id === docId);
    if (!doc) return;

    // For company-specific templates, show company combobox
    if (COMPANY_TEMPLATES.includes(doc.type) && Object.keys(companyLinksMap).length > 0) {
        startCompanyEdit(docId, doc);
        return;
    }

    const currentName = nameChanges.get(docId) || doc.name || '';
    const inputVal = htmlToMarkdown(currentName);
    nameEl.innerHTML = `
        <div class="name-edit-row">
            <div style="flex:1;">
                <input type="text" class="name-edit-input" id="nameinput-${docId}" dir="auto">
            </div>
            <div class="name-edit-actions">
                <button type="button" class="name-edit-save" onclick="saveNameEdit('${docId}')" title="שמור">
                    <i data-lucide="check" class="icon-xs"></i>
                </button>
                <button type="button" class="name-edit-cancel" onclick="cancelNameEdit('${docId}')" title="ביטול">
                    <i data-lucide="x" class="icon-xs"></i>
                </button>
            </div>
        </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const input = document.getElementById(`nameinput-${docId}`);
    if (input) {
        // Set value programmatically — avoids HTML attribute quote-escaping issue with בע"מ etc.
        input.value = inputVal;
        input.focus();
        // Place cursor at end (left side in RTL) so חברת בע"מ** is visible, not scrolled out
        const len = inputVal.length;
        input.setSelectionRange(len, len);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveNameEdit(docId); }
            if (e.key === 'Escape') { e.preventDefault(); cancelNameEdit(docId); }
        });
    }

    // Expand group to fill row while editing so input has full width
    const group = nameEl.closest('.doc-name-group');
    if (group) { group.style.flex = '1'; group.style.maxWidth = 'none'; }
    nameEl.style.flex = '1';

    // Hide pencil button while editing
    const pencilBtn = document.querySelector(`#doc-${docId} .name-edit-btn`);
    if (pencilBtn) pencilBtn.style.display = 'none';
}

// Company combobox edit for insurance/pension docs
// Shows full doc name as editable text + company quick-swap dropdown below
function startCompanyEdit(docId, doc) {
    const nameEl = document.getElementById(`docname-${docId}`);
    if (!nameEl) return;

    const currentName = nameChanges.get(docId) || doc.name || '';
    const inputVal = htmlToMarkdown(currentName);

    // Build company entries: one per Hebrew name, with aliases for search
    // companyLinksMap: {name → url} where multiple names can map to same URL
    const urlToNames = {};
    for (const [name, url] of Object.entries(companyLinksMap)) {
        if (!urlToNames[url]) urlToNames[url] = [];
        urlToNames[url].push(name);
    }
    // Each Hebrew name is a selectable option; search also matches sibling aliases (EN names etc.)
    const companyEntries = [];
    for (const [url, names] of Object.entries(urlToNames)) {
        const heNames = names.filter(n => /[\u0590-\u05FF]/.test(n));
        // Show each Hebrew name as its own option, searchable by all aliases for same URL
        for (const heName of heNames) {
            companyEntries.push({ display: heName, aliases: names, url });
        }
        // If no Hebrew names at all, show first name as fallback
        if (heNames.length === 0) {
            companyEntries.push({ display: names[0], aliases: names, url });
        }
    }

    nameEl.innerHTML = `
        <div class="name-edit-row">
            <div style="flex:1;">
                <input type="text" class="name-edit-input" id="nameinput-${docId}" dir="auto">
            </div>
            <div class="name-edit-actions">
                <button type="button" class="name-edit-save" onclick="saveNameEdit('${docId}')" title="שמור">
                    <i data-lucide="check" class="icon-xs"></i>
                </button>
                <button type="button" class="name-edit-cancel" onclick="cancelNameEdit('${docId}')" title="ביטול">
                    <i data-lucide="x" class="icon-xs"></i>
                </button>
            </div>
        </div>
        <div class="company-swap-section" id="company-swap-${docId}">
            <a href="javascript:void(0)" class="company-swap-toggle" id="company-toggle-${docId}">החלף חברה ▼</a>
            <div class="doc-combobox" id="company-combo-${docId}" style="display:none;">
                <input class="doc-combobox-input" id="company-input-${docId}"
                    placeholder="חפש חברה..." dir="rtl" autocomplete="off">
                <div class="doc-combobox-dropdown" id="company-dropdown-${docId}"></div>
            </div>
        </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const input = document.getElementById(`nameinput-${docId}`);
    if (input) {
        input.value = inputVal;
        input.focus();
        const len = inputVal.length;
        input.setSelectionRange(len, len);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveNameEdit(docId); }
            if (e.key === 'Escape') { e.preventDefault(); cancelNameEdit(docId); }
        });
    }

    // Expand group for full width
    const group = nameEl.closest('.doc-name-group');
    if (group) { group.style.flex = '1'; group.style.maxWidth = 'none'; }
    nameEl.style.flex = '1';

    const pencilBtn = document.querySelector(`#doc-${docId} .name-edit-btn`);
    if (pencilBtn) pencilBtn.style.display = 'none';

    // Company quick-swap dropdown
    const toggle = document.getElementById(`company-toggle-${docId}`);
    const combo = document.getElementById(`company-combo-${docId}`);
    const companyInput = document.getElementById(`company-input-${docId}`);
    const dropdown = document.getElementById(`company-dropdown-${docId}`);
    if (!toggle || !combo || !companyInput || !dropdown) return;

    let comboOpen = false;

    function renderOptions(filter) {
        const q = (filter || '').trim().toLowerCase();
        const filtered = q
            ? companyEntries.filter(e => e.display.includes(q) || e.aliases.some(a => a.toLowerCase().includes(q)))
            : companyEntries;
        if (filtered.length === 0) {
            dropdown.innerHTML = '<div class="doc-combobox-empty">לא נמצאו תוצאות</div>';
        } else {
            dropdown.innerHTML = filtered.map(e =>
                `<div class="doc-combobox-option" data-company="${escapeHtml(e.display)}">${escapeHtml(e.display)}</div>`
            ).join('');
        }
    }

    function positionDropdown() {
        const rect = companyInput.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.right = (window.innerWidth - rect.right) + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = Math.max(rect.width, 280) + 'px';
    }

    // Reposition on scroll so dropdown follows the input
    const scrollContainer = companyInput.closest('.doc-list') || window;
    const onScroll = () => { if (comboOpen) positionDropdown(); };
    scrollContainer.addEventListener('scroll', onScroll);

    toggle.addEventListener('click', () => {
        comboOpen = !comboOpen;
        combo.style.display = comboOpen ? '' : 'none';
        toggle.textContent = comboOpen ? 'החלף חברה ▲' : 'החלף חברה ▼';
        if (comboOpen) {
            renderOptions('');
            positionDropdown();
            combo.classList.add('open');
            companyInput.focus();
        } else {
            combo.classList.remove('open');
        }
    });

    companyInput.addEventListener('input', () => { renderOptions(companyInput.value); positionDropdown(); });
    companyInput.addEventListener('focus', () => {
        if (comboOpen) { renderOptions(companyInput.value); positionDropdown(); combo.classList.add('open'); }
    });

    dropdown.addEventListener('click', (e) => {
        const opt = e.target.closest('.doc-combobox-option');
        if (!opt) return;
        const companyName = opt.dataset.company;
        // Replace the LAST **bold** portion in the text input (company name is always last bold)
        const nameInput = document.getElementById(`nameinput-${docId}`);
        if (nameInput) {
            const val = nameInput.value;
            const lastBoldIdx = val.lastIndexOf('**');
            if (lastBoldIdx > -1) {
                // Find the opening ** that pairs with the last closing **
                const beforeLast = val.substring(0, lastBoldIdx);
                const openIdx = beforeLast.lastIndexOf('**');
                if (openIdx > -1) {
                    nameInput.value = val.substring(0, openIdx) + `**${companyName}**` + val.substring(lastBoldIdx + 2);
                }
            }
        }
        // Collapse the dropdown after selection
        comboOpen = false;
        combo.style.display = 'none';
        toggle.textContent = 'החלף חברה ▼';
        combo.classList.remove('open');
        if (nameInput) nameInput.focus();
    });

    // Close dropdown on outside click
    setTimeout(() => {
        function onOutsideClick(e) {
            if (!combo.contains(e.target) && e.target !== toggle) {
                combo.classList.remove('open');
            }
        }
        document.addEventListener('click', onOutsideClick);
        // Clean up when editing ends (cancel/save will replace innerHTML)
    }, 0);
}

function saveNameEdit(docId) {
    const input = document.getElementById(`nameinput-${docId}`);
    if (!input) return;

    const rawInput = input.value.trim();
    const converted = markdownToHtml(rawInput);
    const doc = currentDocuments.find(d => d.id === docId);
    if (!doc) return;

    if (converted && converted !== doc.name) {
        nameChanges.set(docId, converted);
    } else {
        nameChanges.delete(docId);
    }

    // Revert to text display
    const nameEl = document.getElementById(`docname-${docId}`);
    if (nameEl) {
        nameEl.style.flex = '';
        nameEl.innerHTML = sanitizeDocHtml(converted || doc.name);
        const group = nameEl.closest('.doc-name-group');
        if (group) { group.style.flex = ''; group.style.maxWidth = ''; }
    }

    // Show pencil button again
    const pencilBtn = document.querySelector(`#doc-${docId} .name-edit-btn`);
    if (pencilBtn) pencilBtn.style.display = '';

    // Toggle name-changed class
    const docEl = document.getElementById(`doc-${docId}`);
    if (docEl) docEl.classList.toggle('name-changed', nameChanges.has(docId));

    updateStats();
}

function cancelNameEdit(docId) {
    const doc = currentDocuments.find(d => d.id === docId);
    if (!doc) return;

    const nameEl = document.getElementById(`docname-${docId}`);
    if (nameEl) {
        nameEl.style.flex = '';
        nameEl.innerHTML = sanitizeDocHtml(nameChanges.get(docId) || doc.name);
        const group = nameEl.closest('.doc-name-group');
        if (group) { group.style.flex = ''; group.style.maxWidth = ''; }
    }

    // Show pencil button again
    const pencilBtn = document.querySelector(`#doc-${docId} .name-edit-btn`);
    if (pencilBtn) pencilBtn.style.display = '';
}

// Strip **bold** markdown markers for UI display
function stripBold(str) {
    return (str || '').replace(/\*\*(.+?)\*\*/g, '$1');
}

// Convert HTML bold tags → **markdown** markers (for edit input display)
function htmlToMarkdown(html) {
    return (html || '').replace(/<b>(.*?)<\/b>/gi, '**$1**').replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
}

// Convert **markdown** markers → <b> HTML tags (for storage)
function markdownToHtml(str) {
    return (str || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// Check if the spouse-doc checkbox is checked
function isSpouseDocMode() {
    const cb = document.getElementById('spouseDocCheckbox');
    return cb && cb.checked;
}

// Build metadata object for a template with collected variable values
function buildDocMeta(tpl, collectedValues) {
    let nameHe = tpl.name_he;
    let nameEn = tpl.name_en || '';
    for (const [key, val] of Object.entries(collectedValues)) {
        nameHe = nameHe.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
        nameEn = nameEn.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
    }
    // Determine person based on checkbox override or template scope
    const person = isSpouseDocMode() ? 'spouse' : (tpl.scope === 'SPOUSE') ? 'spouse' : 'client';
    // Build issuer_key from user-provided variable values (exclude auto-filled year/spouse_name)
    const autoVars = ['year', 'spouse_name'];
    const issuerParts = Object.entries(collectedValues)
        .filter(([k]) => !autoVars.includes(k))
        .map(([, v]) => v);
    const issuerKey = issuerParts.join(' ').trim();
    return {
        template_id: tpl.template_id,
        category: tpl.category || 'general',
        issuer_name: nameHe,
        name_en: nameEn,
        person: person,
        issuer_key: issuerKey
    };
}

// Old dropdown listener removed — replaced by add-doc combobox (DL-267)

// Update selected documents display
function updateSelectedDocs() {
    const container = document.getElementById('selectedDocs');

    if (docsToAdd.size === 0) {
        container.className = 'selected-docs empty';
        container.innerHTML = '';
        return;
    }

    container.className = 'selected-docs';

    container.innerHTML = Array.from(docsToAdd.entries()).map(([doc, meta]) => {
        const safeArg = encodeURIComponent(doc);
        const personLabel = (meta && meta.person === 'spouse') ? ' <span class="text-muted text-xs">(בן/בת זוג)</span>' : '';
        return `
            <div class="doc-tag">
                <span>${escapeHtml(doc)}${personLabel}</span>
                <button onclick="removeSelectedDoc('${safeArg}')"
                        type="button"
                        aria-label="remove">&times;</button>
            </div>
        `;
    }).join('');
}

function removeSelectedDoc(encodedDoc) {
    const doc = decodeURIComponent(encodedDoc);
    docsToAdd.delete(doc);
    updateSelectedDocs();
    updateStats();
}

// Scroll to next document matching a pill category, cycling through matches
const _pillScrollIndex = { removal: 0, added: 0, restore: 0 };

function scrollToPill(category) {
    const classMap = {
        removal: 'marked-for-removal',
        added: 'doc-tag',
        restore: 'marked-for-restore'
    };

    let matches;
    if (category === 'added') {
        // Added docs are in the selectedDocs container, not in the document list
        matches = document.querySelectorAll('#selectedDocs .doc-tag');
    } else {
        matches = document.querySelectorAll(`.document-item.${classMap[category]}`);
    }

    if (matches.length === 0) return;

    // Cycle through matches
    let idx = _pillScrollIndex[category] || 0;
    if (idx >= matches.length) idx = 0;
    _pillScrollIndex[category] = idx + 1;

    const target = matches[idx];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Pulse animation
    target.classList.add('pulse-highlight');
    setTimeout(() => target.classList.remove('pulse-highlight'), 1500);
}

// Update statistics
function updateStats() {
    const activeDocs = currentDocuments.filter(d => d.status !== 'Waived');
    document.getElementById('totalDocs').textContent = activeDocs.length;
    document.getElementById('markedDocs').textContent = markedForRemoval.size;
    document.getElementById('addedDocs').textContent = docsToAdd.size;
    document.getElementById('restoredDocs').textContent = markedForRestore.size;

    updateStatusOverview();
}

// Update status overview panel (progress bar, count boxes, edit session visibility)
function updateStatusOverview() {
    const overview = document.getElementById('statusOverview');
    if (!overview) return;

    // Show edit session bar only when there are pending changes
    const hasChanges = markedForRemoval.size > 0 || docsToAdd.size > 0 ||
        markedForRestore.size > 0 || statusChanges.size > 0 || noteChanges.size > 0 || nameChanges.size > 0 ||
        questionsAreDirty();
    document.getElementById('editSessionBar').style.display = hasChanges ? 'block' : 'none';

    // Warn before leaving with unsaved changes
    if (hasChanges) {
        window.onbeforeunload = () => true;
    } else {
        window.onbeforeunload = null;
    }

    // Mutually exclusive: save+reset row shown when changes pending, approve-send row when clean
    const saveResetRow = document.getElementById('save-reset-row');
    const approveSendRow = document.getElementById('approve-send-row');
    const actionsRow = saveResetRow?.closest('.actions-row');
    if (saveResetRow) saveResetRow.style.display = hasChanges ? 'contents' : 'none';
    if (approveSendRow) {
        approveSendRow.style.display = hasChanges ? 'none' : '';
        // Reset send button to idle when row becomes visible again (after save-then-change cycle)
        if (!hasChanges) {
            const sendBtn = document.getElementById('approveSendBtn');
            if (sendBtn) setBtnState(sendBtn, 'idle');
        }
    }

    const total = currentDocuments.length;
    if (total === 0) {
        overview.style.display = hasChanges ? 'block' : 'none';
        updateStickyBar();
        return;
    }
    overview.style.display = 'block';

    // Count each status (use effective status accounting for pending changes)
    let received = 0, missing = 0, waived = 0;
    for (const doc of currentDocuments) {
        const effectiveStatus = statusChanges.get(doc.id) || doc.status;
        switch (effectiveStatus) {
            case 'Received': received++; break;
            case 'Waived': waived++; break;
            default: missing++; break;
        }
    }

    // Update count boxes
    document.getElementById('countTotal').textContent = total;
    document.getElementById('countReceived').textContent = received;
    document.getElementById('countMissing').textContent = missing;
    document.getElementById('countWaived').textContent = waived;

    // Update progress bar segments
    const pctReceived = (received / total) * 100;
    const pctMissing = (missing / total) * 100;
    const pctWaived = (waived / total) * 100;

    document.getElementById('segReceived').style.width = pctReceived + '%';
    document.getElementById('segMissing').style.width = pctMissing + '%';
    document.getElementById('segWaived').style.width = pctWaived + '%';

    // Green glow when 100% complete (all received or waived, none missing)
    const progressBar = document.getElementById('progressBarStacked');
    progressBar.classList.toggle('complete', missing === 0 && received > 0);

    // Summary text: "X מתוך Y (Z%)"
    const activeTotal = total - waived;
    const completePct = activeTotal > 0 ? Math.round((received / activeTotal) * 100) : 0;
    document.getElementById('statusSummaryText').textContent =
        `${received} מתוך ${activeTotal} (${completePct}%)`;

    updateStickyBar();
}

// Toggle status filter (click on status count box)
function toggleStatusFilter(status) {
    // If clicking the same status, clear filter (toggle off)
    if (activeStatusFilter === status && status !== '') {
        activeStatusFilter = '';
    } else {
        activeStatusFilter = status;
    }

    // Update visual active state on boxes
    const boxes = document.querySelectorAll('.status-count-box');
    boxes.forEach(box => box.classList.remove('active'));

    if (activeStatusFilter === '') {
        // Activate total box
        const totalBox = document.querySelector('.status-count-box[data-status=""]');
        if (totalBox) totalBox.classList.add('active');
    } else {
        const activeBox = document.querySelector(`.status-count-box[data-status="${activeStatusFilter}"]`);
        if (activeBox) activeBox.classList.add('active');
    }

    // Update filter active bar
    const filterBar = document.getElementById('filterActiveBar');
    if (filterBar) {
        if (activeStatusFilter) {
            const STATUS_FILTER_LABELS = {
                'Received': 'התקבל',
                'Required_Missing': 'חסר',
                'Waived': 'אין צורך'
            };
            document.getElementById('filterStatusText').textContent =
                `מסונן לפי: ${STATUS_FILTER_LABELS[activeStatusFilter] || activeStatusFilter}`;
            filterBar.style.display = '';
        } else {
            filterBar.style.display = 'none';
        }
        lucide.createIcons();
    }

    applyStatusFilter();
}

function clearStatusFilter() {
    toggleStatusFilter('');
}

// Apply status filter — show/hide document wrappers based on active filter
function applyStatusFilter() {
    if (!activeStatusFilter) {
        // Show all — remove filter-hidden from everything
        document.querySelectorAll('.filter-hidden').forEach(el => el.classList.remove('filter-hidden'));
        return;
    }

    // Show/hide each document wrapper based on effective status
    document.querySelectorAll('.document-wrapper').forEach(wrapper => {
        const docId = wrapper.id.replace('wrapper-', '');
        const doc = currentDocuments.find(d => d.id === docId);
        if (!doc) return;

        const effectiveStatus = statusChanges.get(doc.id) || doc.status;
        // Normalize: anything not Received/Waived is treated as Required_Missing (including Requires_Fix)
        let normalizedStatus = effectiveStatus;
        if (normalizedStatus !== 'Received' && normalizedStatus !== 'Waived') {
            normalizedStatus = 'Required_Missing';
        }

        if (normalizedStatus === activeStatusFilter) {
            wrapper.classList.remove('filter-hidden');
        } else {
            wrapper.classList.add('filter-hidden');
        }
    });

    // Hide empty document-groups and their preceding category-headers
    document.querySelectorAll('.document-group').forEach(group => {
        const visibleWrappers = group.querySelectorAll('.document-wrapper:not(.filter-hidden)');
        const isEmpty = visibleWrappers.length === 0;
        group.classList.toggle('filter-hidden', isEmpty);

        // Hide the category-header sibling (previous element)
        const prev = group.previousElementSibling;
        if (prev && prev.classList.contains('category-header')) {
            prev.classList.toggle('filter-hidden', isEmpty);
        }
    });

    // Hide person-headers when all their following content is hidden
    document.querySelectorAll('.person-header').forEach(header => {
        let allHidden = true;
        let sibling = header.nextElementSibling;
        while (sibling && !sibling.classList.contains('person-header')) {
            if ((sibling.classList.contains('category-header') || sibling.classList.contains('document-group')) &&
                !sibling.classList.contains('filter-hidden')) {
                allHidden = false;
                break;
            }
            sibling = sibling.nextElementSibling;
        }
        header.classList.toggle('filter-hidden', allHidden);
    });
}

// Strip HTML tags for plain text display
function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
}

// Open confirmation modal
function openConfirmation() {
    const TXT_NO_CHANGES = "לא בוצעו שינויים. אנא בצע שינויים לפני השמירה.";

    const customDocRaw = (document.getElementById('customDoc')?.value ?? '').trim();
    const notes = '';

    const docsToRemove = currentDocuments
        .filter(doc => markedForRemoval.has(doc.id))
        .map(doc => doc.name);

    const docsToAddNames = Array.from(docsToAdd.keys());

    if (customDocRaw) {
        const customDocs = customDocRaw
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean);

        for (const cd of customDocs) {
            if (!docsToAddNames.includes(cd)) {
                docsToAddNames.push(cd);
            }
        }
    }

    const uniqueDocsToAdd = [...new Set(docsToAddNames)];

    // Check if there are any changes at all
    const hasChanges = docsToRemove.length > 0 ||
        uniqueDocsToAdd.length > 0 ||
        notes ||
        markedForRestore.size > 0 ||
        statusChanges.size > 0 ||
        noteChanges.size > 0 ||
        nameChanges.size > 0 ||
        questionsAreDirty();

    if (!hasChanges) {
        showAlert(TXT_NO_CHANGES, 'error');
        return;
    }

    let summary = '<div>';

    // Restores (blue)
    if (markedForRestore.size > 0) {
        const restoreDocs = currentDocuments.filter(d => markedForRestore.has(d.id));
        summary += `<h4 class="text-brand"><i data-lucide="refresh-cw" class="icon-sm" style="display:inline;vertical-align:middle;"></i> מסמכים שישוחזרו (${restoreDocs.length}):</h4>`;
        summary += '<ul class="changes-list">';
        restoreDocs.forEach(doc => {
            const fileClearNote = doc.file_url ? ' <span class="file-clear-warning-summary">⚠ קישור הקובץ יימחק</span>' : '';
            summary += `<li class="change-restore">${stripHtml(doc.name)}${fileClearNote}</li>`;
        });
        summary += '</ul>';
    }

    // Removals (red)
    if (docsToRemove.length > 0) {
        summary += `<h4 class="text-danger"><i data-lucide="circle-x" class="icon-sm" style="display:inline;vertical-align:middle;"></i> מסמכים שיוסרו מרשימת הלקוח (${docsToRemove.length}):</h4>`;
        summary += '<ul class="changes-list">';
        docsToRemove.forEach(doc => {
            summary += `<li class="change-remove">${stripHtml(doc)}</li>`;
        });
        summary += '</ul>';
    }

    // Additions (green)
    if (uniqueDocsToAdd.length > 0) {
        summary += `<h4 class="text-success"><i data-lucide="plus-circle" class="icon-sm" style="display:inline;vertical-align:middle;"></i> מסמכים שיתווספו (${uniqueDocsToAdd.length}):</h4>`;
        summary += '<ul class="changes-list">';
        uniqueDocsToAdd.forEach(doc => {
            const meta = docsToAdd.get(doc);
            const personTag = (meta && meta.person === 'spouse') ? ' <span class="text-muted text-xs">(בן/בת זוג)</span>' : '';
            summary += `<li class="change-add">${escapeHtml(doc)}${personTag}</li>`;
        });
        summary += '</ul>';
    }

    // Status changes (purple)
    if (statusChanges.size > 0) {
        summary += `<h4 style="color:#7C3AED;"><i data-lucide="arrow-right-left" class="icon-sm" style="display:inline;vertical-align:middle;"></i> שינויי סטטוס (${statusChanges.size}):</h4>`;
        summary += '<ul class="changes-list">';
        statusChanges.forEach((newStatus, docId) => {
            const doc = currentDocuments.find(d => d.id === docId);
            if (doc) {
                const toLabel = STATUS_LABELS[newStatus] || newStatus;
                const fileClearNote = (newStatus === 'Required_Missing' && doc.file_url && doc.status !== 'Required_Missing') ? ' <span class="file-clear-warning-summary">⚠ קישור הקובץ יימחק</span>' : '';
                summary += `<li class="change-status">${stripHtml(doc.name)} — שונה ל: ${toLabel}${fileClearNote}</li>`;
            }
        });
        summary += '</ul>';
    }

    // Note changes (teal)
    if (noteChanges.size > 0) {
        summary += `<h4 style="color:#0D9488;"><i data-lucide="file-pen" class="icon-sm" style="display:inline;vertical-align:middle;"></i> עדכוני הערות (${noteChanges.size}):</h4>`;
        summary += '<ul class="changes-list">';
        noteChanges.forEach((noteText, docId) => {
            const doc = currentDocuments.find(d => d.id === docId);
            if (doc) {
                const preview = noteText.length > 50 ? noteText.substring(0, 50) + '...' : noteText;
                summary += `<li class="change-note">${stripHtml(doc.name)}: ${escapeHtml(preview || '(הערה נמחקה)')}</li>`;
            }
        });
        summary += '</ul>';
    }

    // Name changes (orange)
    if (nameChanges.size > 0) {
        summary += `<h4 style="color:#EA580C;"><i data-lucide="pencil" class="icon-sm" style="display:inline;vertical-align:middle;"></i> שינוי שם מסמך (${nameChanges.size}):</h4>`;
        summary += '<ul class="changes-list">';
        nameChanges.forEach((newName, docId) => {
            const doc = currentDocuments.find(d => d.id === docId);
            if (doc) {
                summary += `<li class="change-name">${sanitizeDocHtml(doc.name)} → ${sanitizeDocHtml(newName)}</li>`;
            }
        });
        summary += '</ul>';
    }

    // Questions changes (amber)
    if (questionsAreDirty()) {
        const qCount = clientQuestions.filter(q => q.text.trim()).length;
        summary += `<h4 style="color:#D97706;"><i data-lucide="message-circle" class="icon-sm" style="display:inline;vertical-align:middle;"></i> שאלות ללקוח (${qCount}):</h4>`;
        summary += '<ul class="changes-list">';
        clientQuestions.filter(q => q.text.trim()).forEach((q, i) => {
            const preview = q.text.length > 60 ? q.text.substring(0, 60) + '...' : q.text;
            const answerTag = q.answer ? ' <span style="color:var(--success-600);">(נענתה)</span>' : '';
            summary += `<li style="color:#D97706;">${i + 1}. ${escapeHtml(preview)}${answerTag}</li>`;
        });
        summary += '</ul>';
    }

    // Session notes
    if (notes) {
        summary += '<h4><i data-lucide="message-square" class="icon-sm" style="display:inline;vertical-align:middle;"></i> הערות:</h4>';
        summary += '<ul class="changes-list"><li>' + escapeHtml(notes) + '</li></ul>';
    }

    summary += '</div>';

    document.getElementById('changesSummary').innerHTML = summary;

    // Sync email toggle state and update confirm button label
    const emailToggle = document.getElementById('emailToggle');
    if (emailToggle) emailToggle.checked = sendEmailOnSave;
    updateConfirmBtn();

    document.getElementById('confirmModal').classList.add('show');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Update confirm button label based on sendEmailOnSave
function updateConfirmBtn() {
    const btn = document.getElementById('confirmBtn');
    if (!btn) return;
    const label = sendEmailOnSave ? 'אשר ושלח למשרד' : 'אשר שינויים';
    btn.innerHTML = `<i data-lucide="circle-check" class="icon-sm"></i> ${label}`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Close confirmation
function closeConfirmation() {
    document.getElementById('confirmModal').classList.remove('show');
}

// Confirm and submit
let _submitLocked = false;

async function confirmSubmit() {
    if (_submitLocked) return;
    _submitLocked = true;
    closeConfirmation();

    const saveBtn = document.getElementById('saveChangesBtn');
    setBtnState(saveBtn, 'loading', 'שומר שינויים...');

    const customDoc = document.getElementById('customDoc').value.trim();
    const notes = '';

    const docsToRemoveObjs = currentDocuments.filter(doc => markedForRemoval.has(doc.id));
    const docsToRemoveIds = docsToRemoveObjs.map(d => d.id);

    const docsToAddNames = Array.from(docsToAdd.keys());

    if (customDoc) {
        const customDocs = customDoc
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean);

        for (const cd of customDocs) {
            if (!docsToAddNames.includes(cd)) {
                docsToAddNames.push(cd);
            }
        }
    }

    const uniqueDocsToAdd = [...new Set(docsToAddNames)];

    // Build extensions object
    const extensions = { send_email: sendEmailOnSave };

    // Structured docs_to_create with full metadata
    if (uniqueDocsToAdd.length > 0) {
        extensions.docs_to_create = uniqueDocsToAdd.map(name => {
            const meta = docsToAdd.get(name);
            if (meta) {
                return {
                    issuer_name: meta.issuer_name || name,
                    issuer_name_en: meta.name_en || '',
                    template_id: meta.template_id,
                    category: meta.category,
                    person: meta.person,
                    issuer_key: meta.issuer_key || ''
                };
            }
            // Custom doc (not from dropdown)
            return {
                issuer_name: name,
                issuer_name_en: name,
                template_id: 'general_doc',
                category: 'general',
                person: meta?.person || 'client',
                issuer_key: name
            };
        });
    }

    // Restores
    if (markedForRestore.size > 0) {
        extensions.docs_to_restore = currentDocuments
            .filter(d => markedForRestore.has(d.id))
            .map(d => ({ id: d.id, text: d.name }));
    }

    // Status changes (exclude docs being waived — waive wins)
    const filteredStatusChanges = new Map(statusChanges);
    for (const id of markedForRemoval) {
        filteredStatusChanges.delete(id);
    }
    if (filteredStatusChanges.size > 0) {
        extensions.status_changes = [];
        filteredStatusChanges.forEach((newStatus, docId) => {
            const doc = currentDocuments.find(d => d.id === docId);
            if (doc) {
                extensions.status_changes.push({ id: docId, new_status: newStatus, name: doc.name });
            }
        });
    }

    // Note updates
    if (noteChanges.size > 0) {
        extensions.note_updates = [];
        noteChanges.forEach((noteText, docId) => {
            extensions.note_updates.push({ id: docId, note: noteText });
        });
    }

    // Name updates
    if (nameChanges.size > 0) {
        extensions.name_updates = [];
        nameChanges.forEach((newName, docId) => {
            const doc = currentDocuments.find(d => d.id === docId);
            extensions.name_updates.push({ id: docId, issuer_name: newName, old_name: doc?.name || '' });
        });
    }

    // Client questions
    if (questionsAreDirty()) {
        extensions.client_questions = clientQuestions.filter(q => q.text.trim());
    }

    const payload = {
        data: {
            fields: [
                {
                    type: 'HIDDEN_FIELDS',
                    value: {
                        report_record_id: REPORT_ID,
                        client_name: CLIENT_NAME,
                        spouse_name: SPOUSE_NAME,
                        year: YEAR
                    }
                },
                {
                    label: 'מסמכים לשינוי סטטוס ל-Waived',
                    type: 'CHECKBOXES',
                    value: docsToRemoveIds,
                    options: docsToRemoveObjs.map(doc => ({
                        id: doc.id,
                        text: doc.name
                    }))
                },
                {
                    label: 'מסמכים להוספה',
                    type: 'CHECKBOXES',
                    value: uniqueDocsToAdd.map((_, idx) => `opt${idx}`),
                    options: uniqueDocsToAdd.map((name, idx) => ({
                        id: `opt${idx}`,
                        text: name
                    }))
                },
                {
                    label: 'מסמך מותאם אישית',
                    type: 'INPUT_TEXT',
                    value: customDoc
                },
                {
                    label: 'הערות נוספות',
                    type: 'TEXTAREA',
                    value: notes
                }
            ],
            extensions: extensions
        }
    };

    try {
        const response = await fetchWithTimeout(ENDPOINTS.EDIT_DOCUMENTS, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_TOKEN}`
            },
            body: JSON.stringify(payload)
        }, FETCH_TIMEOUTS.mutate);

        if (response.ok) {
            // Commit questions locally immediately — avoids stale read-after-write from Airtable
            clientQuestions = clientQuestions.filter(q => q.text.trim());
            originalQuestionsJSON = JSON.stringify(clientQuestions);
            renderQuestions();
            _skipQuestionsReload = true;

            setBtnState(saveBtn, 'success', 'נשמר!');
            setTimeout(() => {
                setBtnState(saveBtn, 'idle');
                loadDocuments(REPORT_ID);
            }, 1500);
        } else {
            throw new Error('Server error');
        }
    } catch (error) {
        console.error('Save operation failed');
        setBtnState(saveBtn, 'idle');
        showAlert(getErrorMessage(error, 'he'), 'error');
    } finally {
        _submitLocked = false;
    }
}

// Reset form
function resetForm() {
    // Close note popover without saving (reset discards all changes)
    if (_activeNoteDocId) {
        _activeNoteDocId = null;
        const popover = document.getElementById('notePopover');
        if (popover) popover.style.display = 'none';
    }
    markedForRemoval.clear();
    markedForRestore.clear();
    statusChanges.clear();
    noteChanges.clear();
    docsToAdd.clear();
    sendEmailOnSave = false;
    document.getElementById('customDoc').value = '';
    resetAddDocWizard();
    nameChanges.clear();

    // Reset questions to original state
    try { clientQuestions = JSON.parse(originalQuestionsJSON); } catch (e) { clientQuestions = []; }
    renderQuestions();

    // Reset status filter
    activeStatusFilter = '';
    const boxes = document.querySelectorAll('.status-count-box');
    boxes.forEach(box => box.classList.remove('active'));
    const totalBox = document.querySelector('.status-count-box[data-status=""]');
    if (totalBox) totalBox.classList.add('active');
    const filterBar = document.getElementById('filterActiveBar');
    if (filterBar) filterBar.style.display = 'none';

    // Re-render documents to clear all visual states
    displayDocuments();
    updateSelectedDocs();
    updateStats();
    showAlert('הטופס אופס בהצלחה', 'success');
}

// Add custom document from the text input
function addCustomDoc() {
    const input = document.getElementById('customDoc');
    const name = input.value.trim();

    if (!name) {
        showAlert('יש להזין שם מסמך', 'error');
        return;
    }

    if (docsToAdd.has(name)) {
        showAlert('מסמך זה כבר נמצא ברשימה', 'error');
        return;
    }

    // Check against existing docs
    if (currentDocuments.some(d => d.name === name)) {
        showAlert('מסמך זה כבר קיים ברשימת המסמכים', 'error');
        return;
    }

    docsToAdd.set(name, { custom: true, person: isSpouseDocMode() ? 'spouse' : 'client' });
    updateSelectedDocs();
    updateStats();

    input.value = '';
    document.getElementById('customDocWarning').style.display = 'none';
    showAlert(`מסמך "${name}" נוסף בהצלחה`, 'success');
}

// Check if custom document is a duplicate
function checkCustomDocDuplicate() {
    const customDoc = document.getElementById('customDoc').value.trim();
    const warning = document.getElementById('customDocWarning');

    if (customDoc && docsToAdd.has(customDoc)) {
        warning.style.display = 'block';
    } else {
        warning.style.display = 'none';
    }
}

// Send Questionnaire for Not-Started Clients
let _sendQuestionnaireLocked = false;

async function confirmSendQuestionnaire() {
    if (_sendQuestionnaireLocked) return;
    if (!confirm("האם אתה בטוח שברצונך לשלוח את השאלון ללקוח זה?")) return;

    const token = localStorage.getItem('admin_token');
    if (!token) {
        alert("שגיאת הרשאה: עליך להתחבר דרך פורטל הניהול.");
        return;
    }

    _sendQuestionnaireLocked = true;
    const btn = document.querySelector('#not-started-view button');
    const originalText = btn.textContent;
    btn.textContent = 'שולח...';
    btn.disabled = true;

    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_SEND_QUESTIONNAIRES, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                report_ids: [REPORT_ID]
            })
        }, FETCH_TIMEOUTS.mutate);

        const data = await response.json();

        if (data.ok) {
            alert("השאלון נשלח בהצלחה!");
        } else {
            alert("שגיאה בשליחה: " + (data.error || 'Unknown error'));
        }
    } catch (e) {
        alert(getErrorMessage(e, 'he'));
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
        _sendQuestionnaireLocked = false;
    }
}

// ==================== CLIENT QUESTIONS ====================

function questionsAreDirty() {
    return JSON.stringify(clientQuestions) !== originalQuestionsJSON;
}

function renderQuestions() {
    const container = document.getElementById('questionsContainer');
    if (!container) return;

    // Update badge count
    const badge = document.getElementById('questionsCount');
    const activeCount = clientQuestions.filter(q => q.text.trim()).length;
    if (badge) {
        badge.textContent = activeCount;
        badge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
    }

    // Toggle warning styling based on unanswered questions
    const questionsCard = document.getElementById('questionsSection');
    if (questionsCard) {
        const unanswered = clientQuestions.filter(q => q.text.trim() && !q.answer?.trim()).length;
        questionsCard.classList.toggle('card-section--warning', unanswered > 0);
    }

    if (clientQuestions.length === 0) {
        container.innerHTML = `
            <div class="questions-empty-state">
                <i data-lucide="message-circle" class="icon-lg"></i>
                <p>אין שאלות ללקוח. הוסף שאלה כדי לשלוח אותה באימייל הבא.</p>
                <button class="btn btn-ghost btn-sm" onclick="addQuestion()">
                    <i data-lucide="plus" class="icon-sm"></i> הוסף שאלה
                </button>
            </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    let html = '';
    clientQuestions.forEach((q, idx) => {
        const answered = q.answer && q.answer.trim();
        html += `
        <div class="question-item ${answered ? 'question-answered' : ''}" data-qid="${q.id}">
            <div class="question-number">${idx + 1}</div>
            <div class="question-body">
                <div class="question-label">שאלה</div>
                <textarea class="question-text-input" rows="1"
                    placeholder="הקלד שאלה ללקוח..."
                    oninput="updateQuestionText('${q.id}', this.value); autoResizeTextarea(this)"
                    onfocus="autoResizeTextarea(this)">${escapeHtml(q.text)}</textarea>
                <div class="question-label">תשובת הלקוח</div>
                <textarea class="question-answer-input" rows="1"
                    placeholder="תשובה (תמולא ע״י הלקוח או ידנית)"
                    oninput="updateQuestionAnswer('${q.id}', this.value); autoResizeTextarea(this)"
                    onfocus="autoResizeTextarea(this)">${escapeHtml(q.answer || '')}</textarea>
            </div>
            <button class="question-delete" onclick="deleteQuestion('${q.id}')" title="מחק שאלה">
                <i data-lucide="trash-2" class="icon-sm"></i>
            </button>
        </div>`;
    });
    html += `<button class="questions-add-btn" onclick="addQuestion()">
        <i data-lucide="plus" class="icon-sm"></i> הוסף שאלה
    </button>`;

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Auto-resize existing textareas
    container.querySelectorAll('textarea').forEach(ta => autoResizeTextarea(ta));

    // Re-render questionnaire section so client questions stay in sync
    const qContent = document.getElementById('questionnaireContent');
    if (qContent && _questionnaireData) _renderQuestionnaire(qContent);
}

function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

function addQuestion() {
    clientQuestions.push({
        id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        text: '',
        answer: ''
    });
    renderQuestions();
    updateStats();

    // Focus the new question's text input
    const container = document.getElementById('questionsContainer');
    const inputs = container.querySelectorAll('.question-text-input');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
}

function deleteQuestion(id) {
    clientQuestions = clientQuestions.filter(q => q.id !== id);
    renderQuestions();
    updateStats();
}

function updateQuestionText(id, text) {
    const q = clientQuestions.find(q => q.id === id);
    if (q) q.text = text;
    updateStats();
}

function updateQuestionAnswer(id, answer) {
    const q = clientQuestions.find(q => q.id === id);
    if (q) {
        q.answer = answer;
        // Update answered visual state
        const item = document.querySelector(`.question-item[data-qid="${id}"]`);
        if (item) item.classList.toggle('question-answered', !!answer.trim());
        const numEl = item?.querySelector('.question-number');
        if (numEl) {
            // Answered badge color is handled by CSS class
        }
    }
    updateStats();
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Validate URL scheme — only allow http(s) to prevent javascript: / data: injection
function sanitizeUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return url;
    } catch (e) { /* invalid URL */ }
    return '';
}

function showConfirmDialog(message, onConfirm, confirmText = 'אישור', danger = false) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.innerHTML = `
        <div class="modal-panel">
            <div class="modal-panel-body" style="padding-top:24px;">
                <p>${escapeHtml(message)}</p>
            </div>
            <div class="modal-panel-footer">
                <button class="btn btn-ghost" id="_confirmCancel">ביטול</button>
                <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="_confirmOk">
                    ${escapeHtml(confirmText)}
                </button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#_confirmCancel').onclick = () => overlay.remove();
    overlay.querySelector('#_confirmOk').onclick = () => { overlay.remove(); onConfirm(); };
}

// DL-308: Read-only email preview modal before approve-and-send fires.
function previewApproveEmail() {
  if (typeof window.showEmailPreviewModal !== 'function') {
    console.error('[DL-308] email-preview-modal helper not loaded');
    return;
  }
  // Mirror the state reads from approveAndSendToClient() below.
  const reportId = REPORT_ID;
  const clientName = CLIENT_NAME;
  return window.showEmailPreviewModal({
    reportId,
    clientName,
    getToken: () => (typeof ADMIN_TOKEN !== 'undefined' ? ADMIN_TOKEN : (typeof authToken !== 'undefined' ? authToken : '')),
    endpoint: ENDPOINTS.APPROVE_AND_SEND,
  });
}

function approveAndSendToClient() {
    const sentDate = DOCS_FIRST_SENT_AT
        ? new Date(DOCS_FIRST_SENT_AT).toLocaleDateString('he-IL')
        : null;

    // Build descriptive message with document counts
    const total = currentDocuments.length;
    const received = currentDocuments.filter(d => (statusChanges.get(d.id) || d.status) === 'Received').length;
    const waived = currentDocuments.filter(d => (statusChanges.get(d.id) || d.status) === 'Waived').length;
    const missing = total - received - waived;
    const unansweredQ = clientQuestions.filter(q => q.text.trim() && !q.answer?.trim()).length;

    let message = sentDate
        ? `הרשימה נשלחה ב-${sentDate}. לשלוח שוב ל-${CLIENT_NAME}?`
        : `שלח רשימת מסמכים ל-${CLIENT_NAME}?`;
    message += ` — ${received} התקבלו · ${missing} חסרים · ${total - waived} סה"כ`;
    if (unansweredQ > 0) {
        message += ` — ${unansweredQ} שאלות ללא מענה`;
    }

    showConfirmDialog(
        message,
        async () => {
            const sendBtn = document.getElementById('approveSendBtn');
            setBtnState(sendBtn, 'loading', 'שולח ללקוח...');
            try {
                const url = `${ENDPOINTS.APPROVE_AND_SEND}?report_id=${REPORT_ID}&confirm=1&respond=json`;
                console.log('[approve-and-send] fetching:', url);
                const res = await fetchWithTimeout(url, {
                    headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
                }, FETCH_TIMEOUTS.mutate);
                console.log('[approve-and-send] status:', res.status, 'redirected:', res.redirected);
                const data = await res.json();
                console.log('[approve-and-send] response:', data);
                if (data.ok) {
                    if (data.queued) {
                        // DL-264: Off-hours — email queued for morning send
                        setBtnState(sendBtn, 'success', 'בתור לשליחה!');
                        showToast('אושר ✓ ישלח אוטומטית ב-08:00', 'success');
                        setTimeout(() => {
                            if (sendBtn) {
                                sendBtn.classList.remove('btn-success-flash');
                                sendBtn.innerHTML = '⏰ ישלח ב-08:00';
                                sendBtn.disabled = true;
                                sendBtn.title = 'המייל ישלח אוטומטית בבוקר';
                            }
                        }, 1500);
                    } else {
                        if (!DOCS_FIRST_SENT_AT) DOCS_FIRST_SENT_AT = new Date().toISOString();
                        CURRENT_STAGE = data.stage || 'Collecting_Docs';
                        updateSentBadge();
                        setBtnState(sendBtn, 'success', 'נשלח!');
                        setTimeout(() => {
                            if (sendBtn) {
                                sendBtn.classList.remove('btn-success-flash');
                                sendBtn.innerHTML = '✓ נשלח ללקוח';
                                sendBtn.disabled = true;
                                sendBtn.title = 'המייל כבר נשלח ללקוח';
                            }
                        }, 1500);
                    }
                } else {
                    setBtnState(sendBtn, 'idle');
                    showToast('שגיאה בשליחת המייל. נסה שנית.', 'error');
                }
            } catch (e) {
                setBtnState(sendBtn, 'idle');
                console.error('[approve-and-send] CATCH:', e);
                showToast('שגיאה בשליחת המייל. נסה שנית.', 'error');
            }
        },
        sentDate ? 'שלח שוב' : 'שלח ללקוח',
        false
    );
}

function advanceToCollectingDocsFromDm() {
    showConfirmDialog(
        `להעביר את הלקוח לשלב איסוף מסמכים?\n⚠ לא יישלח אליו מייל עם רשימת המסמכים.`,
        async () => {
            try {
                const res = await fetchWithTimeout(ENDPOINTS.ADMIN_CHANGE_STAGE, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${ADMIN_TOKEN}`
                    },
                    body: JSON.stringify({ token: ADMIN_TOKEN, report_id: REPORT_ID, target_stage: 'Collecting_Docs' })
                }, FETCH_TIMEOUTS.mutate);
                const data = await res.json();
                if (data.ok) {
                    CURRENT_STAGE = 'Collecting_Docs';
                    showToast('הלקוח הועבר לאיסוף מסמכים — ללא מייל', 'info');
                    updateStickyBar();
                } else {
                    showToast(data.error || 'שגיאה', 'error');
                }
            } catch (e) {
                console.error('[silent-advance] CATCH:', e);
                showToast('שגיאה בהעברת השלב. נסה שנית.', 'error');
            }
        },
        'אשר מבלי לשלוח',
        false
    );
}

function updateSentBadge() {
    const el = document.getElementById('sentBadge');
    if (!el) return;
    const stageNum = parseInt((CURRENT_STAGE || '').charAt(0), 10);
    if (DOCS_FIRST_SENT_AT) {
        const date = new Date(DOCS_FIRST_SENT_AT).toLocaleDateString('he-IL');
        el.innerHTML = `<i data-lucide="send" class="icon-sm"></i><span class="text-muted text-sm">נשלח ללקוח:</span><strong>${date}</strong>`;
        el.style.display = '';
        lucide.createIcons({ nodes: [el] });
    } else if (stageNum >= 3) {
        el.innerHTML = `<i data-lucide="send" class="icon-sm"></i><span class="text-muted text-sm">טרם נשלח ללקוח</span>`;
        el.style.display = '';
        lucide.createIcons({ nodes: [el] });
    } else {
        el.style.display = 'none';
    }
}

// Close status dropdown when clicking outside
document.addEventListener('click', function (e) {
    // Close status dropdown on outside click
    const dropdown = document.getElementById('statusDropdown');
    if (dropdown && dropdown.style.display === 'block' && !dropdown.contains(e.target)) {
        closeStatusDropdown();
    }
});

// ==================== QUESTIONNAIRE VIEW ====================

let _questionnaireData = null;
let _questionnaireFetched = false;
let _hideNoAnswers = true;

async function loadQuestionnaireForReport() {
    if (_questionnaireFetched) return; // already loaded (or in progress)
    _questionnaireFetched = true;

    const container = document.getElementById('questionnaireContent');
    if (!container) return;
    // Update default label based on filing type
    const currentReportForLabel = allReports.find(r => r.report_id === REPORT_ID);
    const ftForLabel = currentReportForLabel?.filing_type || 'annual_report';
    const defaultQLabel = ftForLabel === 'capital_statement' ? 'שאלון הצהרת הון' : 'השאלון השנתי';
    const labelElDefault = document.getElementById('questionnaireLabel');
    if (labelElDefault) labelElDefault.textContent = defaultQLabel;

    container.innerHTML = '<div class="questionnaire-loading"><div class="spinner"></div><span>טוען שאלון...</span></div>';

    try {
        const currentReport = allReports.find(r => r.report_id === REPORT_ID);
        const ft = currentReport?.filing_type || 'annual_report';
        const url = `${ENDPOINTS.ADMIN_QUESTIONNAIRES}?token=${encodeURIComponent(ADMIN_TOKEN)}&report_id=${encodeURIComponent(REPORT_ID)}&filing_type=${encodeURIComponent(ft)}`;
        const resp = await fetchWithTimeout(url, { method: 'GET' }, 20000);
        const data = await resp.json();

        if (!data.ok || !data.items?.length) {
            container.innerHTML = '<p style="padding:var(--sp-4);color:var(--gray-400);font-size:var(--text-sm);">לא נמצא שאלון עבור לקוח זה</p>';
            return;
        }

        _questionnaireData = data.items[0];

        // Update questionnaire label with submission date
        const labelEl = document.getElementById('questionnaireLabel');
        const submissionDate = _questionnaireData.client_info?.submission_date;
        if (labelEl && submissionDate) {
            const formatted = new Date(submissionDate).toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
            const qLabel = ft === 'capital_statement' ? 'שאלון הצהרת הון' : 'השאלון השנתי';
            labelEl.textContent = `${qLabel} - הוגש ב-${formatted}`;
        }

        _renderQuestionnaire(container);
    } catch (e) {
        container.innerHTML = `<div class="questionnaire-loading questionnaire-error">
    <p style="color:var(--error-600);font-size:var(--text-sm);">שגיאה בטעינת השאלון</p>
    <button class="btn btn-ghost btn-sm" onclick="_questionnaireFetched = false; loadQuestionnaireForReport();">
        <i data-lucide="refresh-cw" class="icon-sm"></i> נסה שנית
    </button>
</div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        _questionnaireFetched = false; // allow retry
    }
}

function _renderQuestionnaire(container) {
    const qa = _questionnaireData;
    const allAnswers = qa.answers || [];
    const answers = _hideNoAnswers
        ? allAnswers.filter(a => a.value && a.value !== '✗ לא')
        : allAnswers;

    if (!answers.length) {
        container.innerHTML = '<p style="padding:var(--sp-4);color:var(--gray-400);font-size:var(--text-sm);">אין תשובות בשאלון</p>';
        return;
    }

    let html = `<table style="width:100%;border-collapse:collapse;font-size:var(--text-sm);" dir="rtl">
        <thead>
            <tr style="background:var(--gray-50);border-bottom:2px solid var(--gray-200);">
                <th style="padding:var(--sp-2) var(--sp-4);text-align:right;font-weight:600;color:var(--gray-600);width:40%;">שאלה</th>
                <th style="padding:var(--sp-2) var(--sp-4);text-align:right;font-weight:600;color:var(--gray-600);">תשובה</th>
            </tr>
        </thead>
        <tbody>`;

    answers.forEach(({ label, value }, i) => {
        const bg = i % 2 === 1 ? 'background:var(--gray-50);' : '';
        html += `<tr style="${bg}">
            <td style="padding:var(--sp-2) var(--sp-4);vertical-align:top;font-weight:600;color:var(--gray-700);">${escapeHtml(label)}</td>
            <td style="padding:var(--sp-2) var(--sp-4);color:var(--gray-800);">${escapeHtml(String(value || ''))}</td>
        </tr>`;
    });

    html += `</tbody></table>`;

    // Client questions section — use module-level clientQuestions (always up-to-date)
    const displayCQ = clientQuestions.filter(q => q.text && q.text.trim());

    if (displayCQ.length > 0) {
        html += `<div style="margin-top:var(--sp-3);background:#fffbeb;border:1px solid #fcd34d;border-radius:var(--radius-md);padding:var(--sp-3) var(--sp-4);">
            <div style="font-size:var(--text-xs);font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--sp-2);">שאלות הלקוח (${displayCQ.length})</div>`;
        displayCQ.forEach((q, idx) => {
            const text = typeof q === 'string' ? q : (q.text || q.question || JSON.stringify(q));
            const answer = (typeof q === 'object' && q.answer) ? q.answer.trim() : '';
            const answered = !!answer;
            const dotColor = answered ? '#10b981' : '#f59e0b';
            const dotBorder = answered ? '' : 'border:1px solid #d97706;';
            html += `<div style="padding:var(--sp-2) 0;border-bottom:1px solid #fde68a;">
                <div style="display:flex;align-items:baseline;gap:var(--sp-1);">
                    <span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block;background:${dotColor};${dotBorder}"></span>
                    <strong>${idx + 1}.</strong> <span style="color:#78350f;">${escapeHtml(text)}</span>
                </div>
                <div style="margin-top:var(--sp-1);padding-right:var(--sp-4);color:${answered ? 'var(--gray-600)' : 'var(--gray-400)'};font-size:var(--text-sm);${answered ? '' : 'font-style:italic;'}">${answered ? escapeHtml(answer) : 'ללא תשובה'}</div>
            </div>`;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

function toggleHideNoAnswers() {
    _hideNoAnswers = !_hideNoAnswers;
    const btn = document.getElementById('toggleNoAnswersBtn');
    if (btn) {
        btn.innerHTML = _hideNoAnswers
            ? '<i data-lucide="eye" class="icon-sm"></i> הצג תשובות לא'
            : '<i data-lucide="eye-off" class="icon-sm"></i> הסתר תשובות לא';
        if (window.lucide) lucide.createIcons({ nodes: [btn] });
    }
    const container = document.getElementById('questionnaireContent');
    if (container && _questionnaireData) _renderQuestionnaire(container);
}

// DL-299: thin wrapper — actual HTML generation lives in frontend/shared/print-questionnaire.js
function printQuestionnaireFromDocManager() {
    if (!_questionnaireData) {
        showToast('יש לפתוח את השאלון לפני ההדפסה', 'warning');
        return;
    }
    const qa = _questionnaireData;
    const info = qa.client_info || {};
    const activeReport = allReports.find(r => r.report_id === REPORT_ID);
    const ftLabel = FILING_TYPE_LABELS[activeReport?.filing_type || 'annual_report'] || 'דוח שנתי';

    if (typeof window.printQuestionnaireSheet !== 'function') {
        showToast('מודול ההדפסה לא נטען', 'error');
        return;
    }

    window.printQuestionnaireSheet({
        clientName: info.name || '',
        year: info.year || '',
        email: info.email || '',
        phone: info.phone || '',
        submissionDate: info.submission_date || null,
        filingTypeLabel: ftLabel,
        answers: qa.answers || [],
        clientQuestions: clientQuestions || [],
        reportNotes: REPORT_NOTES || '',
    });
}

// ===================== FILE UPLOAD PER ROW (DL-198) =====================

const UPLOAD_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const UPLOAD_ALLOWED_EXT = new Set(['pdf','jpg','jpeg','png','heic','tif','tiff','xlsx','docx','xls','doc']);

function triggerUpload(docId) {
    _uploadTargetDocId = docId;
    const input = document.getElementById('uploadFileInput');
    input.value = ''; // reset so same file can be re-selected
    input.click();
}

function handleFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file || !_uploadTargetDocId) return;

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!UPLOAD_ALLOWED_EXT.has(ext)) {
        showToast(`סוג קובץ .${ext} לא נתמך`, 'error');
        return;
    }
    if (file.size > UPLOAD_MAX_SIZE) {
        showToast('הקובץ גדול מדי (מקסימום 10MB)', 'error');
        return;
    }

    showUploadConfirmDialog(_uploadTargetDocId, file);
}

function showUploadConfirmDialog(docId, file) {
    const doc = currentDocuments.find(d => d.id === docId);
    const docName = doc ? (doc.name || doc.display_name || '') : '';
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.innerHTML = `
        <div class="modal-panel">
            <div class="modal-panel-body" style="padding-top:24px;">
                <p style="margin-bottom:12px;"><strong>העלאת קובץ</strong></p>
                <p style="margin-bottom:4px;">מסמך: ${sanitizeDocHtml(docName)}</p>
                <p style="margin-bottom:16px; color:var(--gray-500); font-size:var(--text-sm);">${escapeHtml(file.name)} (${sizeMB}MB)</p>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" id="_uploadOneDriveCheck" checked>
                    <span>העלה גם ל-OneDrive</span>
                </label>
            </div>
            <div class="modal-panel-footer">
                <button class="btn btn-ghost" id="_uploadCancel">ביטול</button>
                <button class="btn btn-primary" id="_uploadConfirm">העלה</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#_uploadCancel').onclick = () => overlay.remove();
    overlay.querySelector('#_uploadConfirm').onclick = () => {
        const uploadToOneDrive = overlay.querySelector('#_uploadOneDriveCheck').checked;
        overlay.remove();
        uploadFile(docId, file, uploadToOneDrive);
    };
}

async function uploadFile(docId, file, uploadToOneDrive = true) {
    const btn = document.getElementById(`upload-btn-${docId}`);
    if (btn) {
        btn.classList.add('uploading');
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="icon-sm spin"></i>';
        lucide.createIcons({ nodes: [btn] });
    }

    try {
        const formData = new FormData();
        formData.append('doc_id', docId);
        formData.append('report_id', REPORT_ID);
        formData.append('file', file);
        if (!uploadToOneDrive) formData.append('skip_onedrive', 'true');

        const response = await fetchWithTimeout(ENDPOINTS.UPLOAD_DOCUMENT, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
            body: formData,
        }, FETCH_TIMEOUTS.mutate);

        const data = await response.json();
        if (!data.ok) throw new Error(data.error || 'Upload failed');

        onUploadSuccess(docId, data);
    } catch (err) {
        onUploadError(docId, err);
    }
}

function onUploadSuccess(docId, result) {
    // Update the doc in currentDocuments so re-render shows links
    const doc = currentDocuments.find(d => d.id === docId);
    if (doc) {
        doc.file_url = result.file_url;
        doc.download_url = result.download_url || '';
        doc.onedrive_item_id = result.onedrive_item_id;
        doc.status = 'Received';
        // Clear any pending status change for this doc
        statusChanges.delete(docId);
    }

    // Brief success indicator
    const btn = document.getElementById(`upload-btn-${docId}`);
    if (btn) {
        btn.classList.remove('uploading');
        btn.classList.add('upload-success');
        btn.innerHTML = '<i data-lucide="check" class="icon-sm"></i>';
        lucide.createIcons({ nodes: [btn] });
    }

    showToast('הקובץ הועלה בהצלחה', 'success');

    // Re-render after brief delay so user sees the checkmark
    setTimeout(() => displayDocuments(currentGroups), 600);
}

function onUploadError(docId, error) {
    const btn = document.getElementById(`upload-btn-${docId}`);
    if (btn) {
        btn.classList.remove('uploading');
        btn.classList.add('upload-error');
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="upload" class="icon-sm"></i>';
        btn.title = `שגיאה: ${error.message || 'העלאה נכשלה'} — לחץ לנסות שנית`;
        lucide.createIcons({ nodes: [btn] });
    }

    showToast(`שגיאה בהעלאה: ${error.message || 'נכשל'}`, 'error');
}

// ==================== CLIENT COMMUNICATION NOTES ====================

function renderClientNotes() {
    const container = document.getElementById('clientNotesTimeline');
    const countBadge = document.getElementById('clientNotesCount');
    if (!container) return;

    // Update badge count
    if (countBadge) {
        if (CLIENT_NOTES.length > 0) {
            countBadge.textContent = CLIENT_NOTES.length;
            countBadge.style.display = '';
        } else {
            countBadge.style.display = 'none';
        }
    }

    // Sort newest first
    const sorted = [...CLIENT_NOTES].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    let html = '';

    // Add note bar
    html += `<div class="cn-add-bar">
        <textarea id="cnNewNote" placeholder="הוסף הערה..." rows="1"></textarea>
        <button class="btn btn-sm btn-secondary" onclick="addClientNote()">
            <i data-lucide="plus" class="icon-sm"></i> הוסף
        </button>
    </div>`;

    // DL-266: Build reply map (office_reply notes keyed by reply_to)
    const replyMap = {};
    for (const entry of sorted) {
        if (entry.type === 'office_reply' && entry.reply_to) {
            replyMap[entry.reply_to] = entry;
        }
    }

    if (sorted.length === 0) {
        html += '<div class="cn-empty">אין הודעות מהלקוח</div>';
    } else {
        for (const entry of sorted) {
            // Skip office_reply entries — they render inside their parent card
            if (entry.type === 'office_reply' && entry.reply_to) continue;

            const isEmail = entry.source === 'email';
            const iconClass = isEmail ? 'cn-icon--email' : (entry.type === 'office_reply' ? 'cn-icon--reply' : 'cn-icon--manual');
            const iconName = isEmail ? 'mail' : (entry.type === 'office_reply' ? 'corner-down-left' : 'pencil');
            const rawDate = entry.date || '';
            const dateStr = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/) ? rawDate.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3-$2-$1') : rawDate;
            const senderStr = entry.sender_email ? ` · ${escapeHtml(entry.sender_email)}` : '';
            const snippetHtml = entry.raw_snippet
                ? `<div class="cn-snippet"><span class="cn-label">טקסט מקורי:</span> "${escapeHtml(entry.raw_snippet)}"</div>`
                : '';
            const summaryLabel = isEmail ? '<span class="cn-label">סיכום AI:</span> ' : '';

            // DL-266: Render threaded office reply inside parent card
            const reply = replyMap[entry.id];
            let replyHtml = '';
            if (reply) {
                const replyDate = (reply.date || '').slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3-$2-$1');
                replyHtml = `<div class="cn-office-reply">
                    <div class="cn-reply-label"><i data-lucide="corner-down-left" class="icon-xs"></i> תגובת המשרד</div>
                    <div class="cn-reply-text">${escapeHtml(reply.summary)}</div>
                    <div class="cn-reply-date">${replyDate}</div>
                </div>`;
            }

            html += `<div class="cn-entry" data-cn-id="${escapeAttr(entry.id)}">
                <div class="cn-icon ${iconClass}">
                    <i data-lucide="${iconName}" class="icon-sm"></i>
                </div>
                <div class="cn-body">
                    <div class="cn-meta">
                        <span>${escapeHtml(dateStr)}</span>${senderStr}
                    </div>
                    <div class="cn-summary">${summaryLabel}${escapeHtml(entry.summary)}</div>
                    ${snippetHtml}
                    ${replyHtml}
                </div>
                <div class="cn-actions">
                    <button onclick="editClientNote('${escapeAttr(entry.id)}')" title="ערוך">
                        <i data-lucide="pencil" class="icon-sm"></i>
                    </button>
                    <button class="cn-delete" onclick="deleteClientNote('${escapeAttr(entry.id)}')" title="מחק">
                        <i data-lucide="trash-2" class="icon-sm"></i>
                    </button>
                </div>
            </div>`;
        }
    }

    container.innerHTML = html;
    try { if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', attrs: {} }); } catch (_) {}
}

async function saveClientNotes() {
    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_UPDATE_CLIENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
            body: JSON.stringify({
                token: ADMIN_TOKEN,
                report_id: REPORT_ID,
                action: 'update-client-notes',
                client_notes: JSON.stringify(CLIENT_NOTES)
            })
        });
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || 'Failed');
        return true;
    } catch (err) {
        showToast('שגיאה בשמירת הודעות', 'error');
        return false;
    }
}

function addClientNote() {
    const textarea = document.getElementById('cnNewNote');
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) return;

    const entry = {
        id: 'cn_' + Date.now(),
        date: new Date().toISOString().split('T')[0],
        summary: text,
        source: 'manual',
        message_id: null,
        sender_email: null,
        raw_snippet: null
    };
    CLIENT_NOTES.push(entry);
    renderClientNotes();
    saveClientNotes().then(ok => {
        if (ok) showToast('הערה נוספה', 'success');
    });
}

function editClientNote(id) {
    const entry = CLIENT_NOTES.find(e => e.id === id);
    if (!entry) return;

    const entryEl = document.querySelector(`.cn-entry[data-cn-id="${id}"]`);
    if (!entryEl) return;

    const summaryEl = entryEl.querySelector('.cn-summary');
    if (!summaryEl) return;

    const original = entry.summary;
    summaryEl.innerHTML = `<textarea class="cn-edit-textarea" rows="2">${escapeHtml(original)}</textarea>`;
    const editTextarea = summaryEl.querySelector('.cn-edit-textarea');
    editTextarea.focus();

    const finishEdit = () => {
        const newText = editTextarea.value.trim();
        if (newText && newText !== original) {
            entry.summary = newText;
            saveClientNotes().then(ok => {
                if (ok) showToast('הערה עודכנה', 'success');
                renderClientNotes();
            });
        } else {
            renderClientNotes();
        }
    };

    editTextarea.addEventListener('blur', finishEdit);
    editTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            editTextarea.blur();
        }
        if (e.key === 'Escape') {
            editTextarea.value = original;
            editTextarea.blur();
        }
    });
}

function deleteClientNote(id) {
    showConfirmDialog('למחוק הערה זו?', () => {
        CLIENT_NOTES = CLIENT_NOTES.filter(e => e.id !== id);
        renderClientNotes();
        saveClientNotes().then(ok => {
            if (ok) showToast('הערה נמחקה', 'success');
        });
    }, 'מחק', true);
}

// ==================== REJECTED UPLOADS ARCHIVE ====================

function renderRejectedUploads() {
    const container = document.getElementById('rejectedUploadsList');
    const countBadge = document.getElementById('rejectedUploadsCount');
    if (!container) return;

    // Update badge count
    if (countBadge) {
        if (REJECTED_UPLOADS.length > 0) {
            countBadge.textContent = REJECTED_UPLOADS.length;
            countBadge.style.display = '';
        } else {
            countBadge.style.display = 'none';
        }
    }

    // Sort newest first by rejected_at
    const sorted = [...REJECTED_UPLOADS].sort((a, b) => (b.rejected_at || '').localeCompare(a.rejected_at || ''));

    let html = '';

    if (sorted.length === 0) {
        html = '<div class="ru-empty">\u05d0\u05d9\u05df \u05de\u05e1\u05de\u05db\u05d9\u05dd \u05d1\u05d0\u05e8\u05db\u05d9\u05d5\u05df</div>';
    } else {
        for (const entry of sorted) {
            const rawDate = entry.received_at || entry.rejected_at || '';
            const dateStr = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
                ? rawDate.replace(/^(\d{4})-(\d{2})-(\d{2}).*/, '$3/$2/$1')
                : rawDate;
            const reasonHtml = entry.reason
                ? `<span class="ru-reason">${escapeHtml(entry.reason)}</span>`
                : '';
            const notesHtml = entry.notes
                ? `<span class="ru-notes">(${escapeHtml(entry.notes)})</span>`
                : '';

            html += `<div class="ru-entry" data-ru-id="${escapeAttr(entry.id)}">
                <div class="ru-icon">
                    <i data-lucide="file-x" class="icon-sm"></i>
                </div>
                <div class="ru-body">
                    <div class="ru-meta">
                        <span class="ru-filename">${escapeHtml(entry.filename || '')}</span>
                        <span class="ru-date">${escapeHtml(dateStr)}</span>
                    </div>
                    ${reasonHtml || notesHtml
                        ? `<div class="ru-detail">${reasonHtml}${notesHtml}</div>`
                        : ''}
                </div>
                <div class="ru-actions">
                    <button class="ru-delete" onclick="deleteRejectedUpload('${escapeAttr(entry.id)}')" title="\u05de\u05d7\u05e7">
                        <i data-lucide="trash-2" class="icon-sm"></i>
                    </button>
                </div>
            </div>`;
        }
    }

    container.innerHTML = html;
    try { if (typeof lucide !== 'undefined') lucide.createIcons({ nameAttr: 'data-lucide', attrs: {} }); } catch (_) {}
}

async function saveRejectedUploads() {
    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_UPDATE_CLIENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
            body: JSON.stringify({
                token: ADMIN_TOKEN,
                report_id: REPORT_ID,
                action: 'update-rejected-uploads',
                rejected_uploads_log: JSON.stringify(REJECTED_UPLOADS)
            })
        });
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || 'Failed');
        return true;
    } catch (err) {
        showToast('\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05e9\u05de\u05d9\u05e8\u05ea \u05d4\u05d0\u05e8\u05db\u05d9\u05d5\u05df', 'error');
        return false;
    }
}

function deleteRejectedUpload(id) {
    showConfirmDialog('\u05dc\u05de\u05d7\u05d5\u05e7 \u05e8\u05e9\u05d5\u05de\u05d4 \u05d6\u05d5?', () => {
        REJECTED_UPLOADS = REJECTED_UPLOADS.filter(e => e.id !== id);
        renderRejectedUploads();
        saveRejectedUploads().then(ok => {
            if (ok) showToast('\u05d4\u05e8\u05e9\u05d5\u05de\u05d4 \u05e0\u05de\u05d7\u05e7\u05d4', 'success');
        });
    }, '\u05de\u05d7\u05e7', true);
}

// ==================== STICKY ACTION BAR ====================

function initStickyBar() {
    const stickyBar = document.getElementById('stickyActionBar');
    if (!stickyBar) return;

    // Always visible — no IntersectionObserver needed
    stickyBar.style.display = '';
    updateStickyBar();
}

function updateStickyBar() {
    const stickyBar = document.getElementById('stickyActionBar');
    if (!stickyBar) return;

    const total = currentDocuments.length;
    if (total === 0) return;

    // Count statuses
    let received = 0, missing = 0, waived = 0;
    for (const doc of currentDocuments) {
        const effectiveStatus = statusChanges.get(doc.id) || doc.status;
        switch (effectiveStatus) {
            case 'Received': received++; break;
            case 'Waived': waived++; break;
            default: missing++; break;
        }
    }

    // Progress fill
    const activeTotal = total - waived;
    const pct = activeTotal > 0 ? Math.round((received / activeTotal) * 100) : 0;
    document.getElementById('stickyProgressFill').style.width = pct + '%';

    // Summary
    document.getElementById('stickySummary').textContent = `${received}/${activeTotal} (${pct}%)`;

    // Changes summary
    const hasChanges = markedForRemoval.size > 0 || docsToAdd.size > 0 ||
        markedForRestore.size > 0 || statusChanges.size > 0 || noteChanges.size > 0 || nameChanges.size > 0 ||
        questionsAreDirty();

    const changesEl = document.getElementById('stickyChanges');
    if (hasChanges) {
        const parts = [];
        if (markedForRemoval.size > 0) parts.push(`${markedForRemoval.size} להסרה`);
        if (docsToAdd.size > 0) parts.push(`${docsToAdd.size} להוספה`);
        if (markedForRestore.size > 0) parts.push(`${markedForRestore.size} לשחזור`);
        if (statusChanges.size > 0) parts.push(`${statusChanges.size} שינויי סטטוס`);
        if (noteChanges.size > 0) parts.push(`${noteChanges.size} הערות`);
        if (nameChanges.size > 0) parts.push(`${nameChanges.size} שינויי שם`);
        changesEl.textContent = parts.join(' · ');
    } else {
        changesEl.textContent = '';
    }

    // Action buttons — same logic as bottom actions row
    const actionsEl = document.getElementById('stickyBarActions');
    if (hasChanges) {
        actionsEl.innerHTML = `
            <button class="btn btn-primary btn-sm" onclick="openConfirmation()">
                <i data-lucide="save" class="icon-sm"></i> שמור
            </button>
            <button class="btn btn-ghost btn-sm" onclick="resetForm()">איפוס</button>`;
    } else {
        const sentLabel = DOCS_FIRST_SENT_AT
            ? `שלח שוב`
            : 'שלח ללקוח';
        const sentInfo = DOCS_FIRST_SENT_AT
            ? `<span class="text-muted text-sm" style="margin-inline-end:var(--sp-2)">נשלח ${new Date(DOCS_FIRST_SENT_AT).toLocaleDateString('he-IL')}</span>`
            : '';
        const silentBtn = (STAGE_ORDER[CURRENT_STAGE] || 0) <= 3
            ? `<button class="btn btn-sm btn-outline" id="dmSilentAdvanceBtn"
                    title="מעביר את הלקוח לשלב איסוף מסמכים. לא יישלח לו מייל."
                    onclick="advanceToCollectingDocsFromDm()">
                    <i data-lucide="mail-off" class="icon-xs"></i> אשר מבלי לשלוח
               </button>`
            : '';
        actionsEl.innerHTML = `${sentInfo}
            <button class="btn btn-secondary btn-sm" onclick="previewApproveEmail()">
                <i data-lucide="eye" class="icon-xs"></i> תצוגה מקדימה
            </button>
            <button class="btn btn-success btn-sm" onclick="approveAndSendToClient()">
                <i data-lucide="send" class="icon-sm"></i> ${sentLabel}
            </button>${silentBtn}`;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* ===========================================
   CLIENT SWITCHER (DL-208)
   Year select + searchable client combobox in header
   =========================================== */

// State
let _switcherClients = [];   // [{client_id, name, stage}]
let _switcherYear = '';       // currently selected year in switcher
let _comboOpen = false;
let _comboFocusIndex = -1;

/**
 * Load the client list into the header switcher.
 * Runs in parallel with loadDocuments().
 */
async function loadClientSwitcher() {
    const defaultYear = new URLSearchParams(window.location.search).get('year') || '2025';
    _switcherYear = defaultYear;
    try {
        const res = await fetch(`${ENDPOINTS.ADMIN_DASHBOARD}?year=${encodeURIComponent(defaultYear)}&_t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        // Populate year select
        const yearEl = document.getElementById('switcherYear');
        const years = (data.available_years && data.available_years.length > 0)
            ? data.available_years
            : [defaultYear];
        yearEl.innerHTML = years.map(y =>
            `<option value="${y}"${String(y) === String(defaultYear) ? ' selected' : ''}>${y}</option>`
        ).join('');

        yearEl.addEventListener('change', () => {
            _switcherYear = yearEl.value;
            _reloadSwitcherForYear(_switcherYear);
        });

        // Build combobox
        _switcherClients = (data.clients || []).filter(c => c.is_active !== false);
        _buildClientCombobox(_switcherClients);

        // Show switcher
        document.getElementById('clientSwitcher').style.display = 'flex';
    } catch (e) {
        // Switcher is non-critical — fail silently
    }
}

async function _reloadSwitcherForYear(year) {
    try {
        const res = await fetch(`${ENDPOINTS.ADMIN_DASHBOARD}?year=${encodeURIComponent(year)}&_t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        _switcherClients = (data.clients || []).filter(c => c.is_active !== false);
        _buildClientCombobox(_switcherClients);
    } catch (e) { /* silent */ }
}

function _buildClientCombobox(clients) {
    const input = document.getElementById('clientComboboxInput');
    const dropdown = document.getElementById('clientComboboxDropdown');
    const combo = document.getElementById('clientCombobox');

    // Set input display value to current client name
    const currentClient = clients.find(c => c.client_id === CLIENT_ID);
    input.value = currentClient ? currentClient.name : '';

    _renderComboOptions(clients, '');

    // Remove any previously attached listeners by cloning
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.addEventListener('mousedown', (e) => {
        if (!_comboOpen) {
            e.preventDefault();
            _openCombo();
        }
    });
    newInput.addEventListener('focus', () => {
        if (!_comboOpen) _openCombo();
    });
    newInput.addEventListener('input', () => {
        _renderComboOptions(_switcherClients, newInput.value);
        _positionComboDropdown();
    });
    newInput.addEventListener('keydown', (e) => {
        const options = dropdown.querySelectorAll('.client-combobox-option');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            _comboFocusIndex = Math.min(_comboFocusIndex + 1, options.length - 1);
            _updateComboFocus(options);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            _comboFocusIndex = Math.max(_comboFocusIndex - 1, 0);
            _updateComboFocus(options);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const focused = dropdown.querySelector('.client-combobox-option.focused');
            if (focused) focused.click();
        } else if (e.key === 'Escape') {
            _closeCombo();
            const cur = _switcherClients.find(c => c.client_id === CLIENT_ID);
            newInput.value = cur ? cur.name : '';
        }
    });

    // Close on outside click — remove old listener first
    document.removeEventListener('mousedown', _handleComboOutsideClick);
    document.addEventListener('mousedown', _handleComboOutsideClick);
}

function _openCombo() {
    const combo = document.getElementById('clientCombobox');
    const input = document.getElementById('clientComboboxInput');
    _comboOpen = true;
    _comboFocusIndex = -1;
    combo.classList.add('open');
    input.readOnly = false;
    input.select();
    _renderComboOptions(_switcherClients, '');
    _positionComboDropdown();
}

function _closeCombo() {
    const combo = document.getElementById('clientCombobox');
    _comboOpen = false;
    _comboFocusIndex = -1;
    combo.classList.remove('open');
}

function _handleComboOutsideClick(e) {
    const combo = document.getElementById('clientCombobox');
    if (combo && !combo.contains(e.target)) {
        if (_comboOpen) {
            _closeCombo();
            const cur = _switcherClients.find(c => c.client_id === CLIENT_ID);
            const input = document.getElementById('clientComboboxInput');
            if (input) input.value = cur ? cur.name : '';
        }
    }
}

function _renderComboOptions(clients, query) {
    const dropdown = document.getElementById('clientComboboxDropdown');
    if (!dropdown) return;
    const q = query.trim().toLowerCase();
    const filtered = q
        ? clients.filter(c => c.name.toLowerCase().includes(q))
        : clients;

    if (filtered.length === 0) {
        dropdown.innerHTML = `<div class="client-combobox-empty">לא נמצאו לקוחות</div>`;
        return;
    }

    dropdown.innerHTML = filtered.map(c => {
        const stage = (typeof STAGES !== 'undefined' && STAGES[c.stage]) || null;
        const stageBadge = stage
            ? `<span class="stage-badge ${stage.class}" style="font-size:11px;padding:1px 6px;min-width:auto;">${stage.label}</span>`
            : '';
        const isCurrent = c.client_id === CLIENT_ID;
        return `<div class="client-combobox-option${isCurrent ? ' current-client' : ''}"
            role="option"
            data-client-id="${_escAttr(c.client_id)}"
            onclick="_switcherNavigate('${_escAttr(c.client_id)}')">
            <span class="option-name">${_escHtml(c.name)}</span>
            ${stageBadge}
        </div>`;
    }).join('');

    _comboFocusIndex = -1;
}

function _updateComboFocus(options) {
    options.forEach((el, i) => el.classList.toggle('focused', i === _comboFocusIndex));
    if (_comboFocusIndex >= 0 && options[_comboFocusIndex]) {
        options[_comboFocusIndex].scrollIntoView({ block: 'nearest' });
    }
}

function _positionComboDropdown() {
    const input = document.getElementById('clientComboboxInput');
    const dropdown = document.getElementById('clientComboboxDropdown');
    if (!input || !dropdown) return;
    const rect = input.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
    dropdown.style.left = 'auto';
    dropdown.style.width = Math.max(rect.width, 280) + 'px';
}

function _switcherNavigate(clientId) {
    if (clientId === CLIENT_ID) {
        _closeCombo();
        return;
    }
    const isDirty = markedForRemoval.size > 0 || docsToAdd.size > 0 ||
        markedForRestore.size > 0 || statusChanges.size > 0 || noteChanges.size > 0 ||
        nameChanges.size > 0 || questionsAreDirty();

    const doNavigate = () => {
        const url = new URL(window.location.href);
        url.searchParams.set('client_id', clientId);
        window.location.href = url.toString();
    };

    if (isDirty) {
        showConfirmDialog(
            'יש שינויים שלא נשמרו. האם לעבור ללקוח אחר בלי לשמור?',
            doNavigate,
            'עבור בלי לשמור',
            true
        );
    } else {
        doNavigate();
    }
}

function _escAttr(str) {
    return String(str).replace(/['"<>&]/g, c => ({'\'': '&#39;', '"': '&quot;', '<': '&lt;', '>': '&gt;', '&': '&amp;'}[c]));
}
function _escHtml(str) {
    return String(str).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'}[c]));
}

// Kick off switcher load alongside main load (non-blocking)
if (CLIENT_ID) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadClientSwitcher);
    } else {
        loadClientSwitcher();
    }
}

// ==================== CLIENT DETAIL MODAL + INLINE EDIT (DL-293) ====================

function updateClientBarContacts() {
    const emailEl = document.getElementById('clientEmailField');
    if (emailEl && !emailEl.classList.contains('editing')) {
        emailEl.textContent = CLIENT_EMAIL || '—';
    }
    const phoneEl = document.getElementById('clientPhoneField');
    if (phoneEl && !phoneEl.classList.contains('editing')) {
        phoneEl.textContent = CLIENT_PHONE || '—';
    }
    const ccRow = document.getElementById('clientCcEmailRow');
    const ccEl = document.getElementById('clientCcEmailField');
    if (ccEl && !ccEl.classList.contains('editing')) {
        if (CLIENT_CC_EMAIL) {
            ccEl.textContent = CLIENT_CC_EMAIL;
            if (ccRow) ccRow.style.display = '';
        } else {
            ccEl.textContent = '—';
            // Still show the row so it can be inline-edited to add a cc email? Keep hidden to reduce noise.
            if (ccRow) ccRow.style.display = 'none';
        }
    }
    const editLink = document.getElementById('clientEditLink');
    if (editLink) editLink.style.display = REPORT_ID ? '' : 'none';
    // Refresh lucide icon (pencil glyph) once the link becomes visible
    if (editLink && REPORT_ID && window.lucide && typeof window.lucide.createIcons === 'function') {
        try { window.lucide.createIcons(); } catch (_) { /* ignore */ }
    }
}

function openClientDetailModal(reportId) {
    if (!reportId) return;
    return openClientDetailModalShared(reportId, {
        authToken: ADMIN_TOKEN,
        toast: (msg, type) => {
            const mapped = type === 'danger' ? 'error' : type === 'warning' ? 'error' : type;
            showToast(msg, mapped || 'info');
        },
        onSaved: (updated) => {
            CLIENT_NAME = updated.name;
            CLIENT_EMAIL = updated.email;
            CLIENT_CC_EMAIL = updated.cc_email;
            CLIENT_PHONE = updated.phone;
            const nameEl = document.getElementById('clientName');
            if (nameEl) nameEl.textContent = CLIENT_NAME || '-';
            updateClientBarContacts();
            showToast('פרטי הלקוח עודכנו בהצלחה', 'success');
        }
    });
}

function _isValidEmailDM(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function startInlineEdit(fieldKey) {
    const elId = fieldKey === 'email' ? 'clientEmailField'
               : fieldKey === 'cc_email' ? 'clientCcEmailField'
               : fieldKey === 'phone' ? 'clientPhoneField'
               : null;
    if (!elId) return;
    const el = document.getElementById(elId);
    if (!el || el.classList.contains('editing')) return;
    const current = fieldKey === 'email' ? CLIENT_EMAIL
                  : fieldKey === 'cc_email' ? CLIENT_CC_EMAIL
                  : CLIENT_PHONE;

    const input = document.createElement('input');
    input.type = fieldKey === 'phone' ? 'tel' : 'email';
    input.value = current || '';
    input.className = 'inline-edit-input';
    input.style.direction = 'ltr';
    input.dataset.field = fieldKey;

    el.classList.add('editing');
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    let committing = false;
    const commit = async () => {
        if (committing) return;
        committing = true;
        const value = input.value.trim();
        const normalized = fieldKey === 'phone' ? value : value.toLowerCase();

        if ((fieldKey === 'email') && normalized && !_isValidEmailDM(normalized)) {
            showToast('כתובת אימייל לא תקינה', 'error');
            input.focus();
            committing = false;
            return;
        }
        if (fieldKey === 'email' && !normalized) {
            showToast('אימייל נדרש', 'error');
            input.focus();
            committing = false;
            return;
        }
        if (fieldKey === 'cc_email' && normalized && !_isValidEmailDM(normalized)) {
            showToast('כתובת אימייל לא תקינה', 'error');
            input.focus();
            committing = false;
            return;
        }

        const prev = fieldKey === 'email' ? CLIENT_EMAIL
                   : fieldKey === 'cc_email' ? CLIENT_CC_EMAIL
                   : CLIENT_PHONE;
        if (normalized === (prev || '')) {
            cancelInlineEdit(fieldKey);
            return;
        }

        try {
            const body = { token: ADMIN_TOKEN, report_id: REPORT_ID, action: 'update' };
            body[fieldKey] = normalized;
            const resp = await fetchWithTimeout(ENDPOINTS.ADMIN_UPDATE_CLIENT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }, FETCH_TIMEOUTS.mutate);
            const data = await resp.json();
            if (!data.ok) throw new Error(data.error || 'שגיאה בשמירה');

            if (fieldKey === 'email') CLIENT_EMAIL = normalized;
            else if (fieldKey === 'cc_email') CLIENT_CC_EMAIL = normalized;
            else CLIENT_PHONE = normalized;

            el.classList.remove('editing');
            updateClientBarContacts();
            showToast('עודכן', 'success');
        } catch (err) {
            showToast('שגיאה בשמירה: ' + err.message, 'error');
            input.focus();
            committing = false;
        }
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelInlineEdit(fieldKey);
        }
    });
    input.addEventListener('blur', () => {
        // Small delay so Escape keydown can fire first
        setTimeout(() => {
            if (el.classList.contains('editing')) commit();
        }, 120);
    });
}

// ==================== DL-297: Editable stage dropdown ====================

function openStageDropdownDM(event) {
    event.stopPropagation();
    if (!REPORT_ID) return;
    const anchor = document.getElementById('clientStage');
    const dd = document.getElementById('stageDropdownDM');
    if (!anchor || !dd || typeof STAGES === 'undefined') return;

    // Render options from SSOT
    const currentKey = CURRENT_STAGE;
    dd.innerHTML = Object.entries(STAGES).map(([key, meta]) => `
        <div class="stage-option${key === currentKey ? ' current' : ''}" data-stage="${key}" onclick="selectStageDM('${key}')">
            <span class="stage-num">${meta.num}</span>
            <span>${escapeHtml(meta.label)}</span>
        </div>
    `).join('');

    // Position below the anchor (fixed positioning — viewport coords)
    const rect = anchor.getBoundingClientRect();
    dd.style.display = 'block';
    dd.style.top = (rect.bottom + 6) + 'px';
    // RTL: align dropdown's right edge with anchor's right edge
    const vw = document.documentElement.clientWidth;
    const ddWidth = Math.min(360, Math.max(260, rect.width + 40));
    dd.style.width = ddWidth + 'px';
    const right = vw - rect.right;
    dd.style.right = Math.max(8, right) + 'px';
    dd.style.left = 'auto';

    anchor.classList.add('open');

    // Close handler (capture, once)
    const close = (e) => {
        if (dd.contains(e.target) || anchor.contains(e.target)) return;
        closeStageDropdownDM();
        document.removeEventListener('click', close, true);
        document.removeEventListener('keydown', onEsc, true);
    };
    const onEsc = (e) => {
        if (e.key === 'Escape') {
            closeStageDropdownDM();
            document.removeEventListener('click', close, true);
            document.removeEventListener('keydown', onEsc, true);
        }
    };
    // Defer so the current click doesn't immediately close
    setTimeout(() => {
        document.addEventListener('click', close, true);
        document.addEventListener('keydown', onEsc, true);
    }, 0);
}

function closeStageDropdownDM() {
    const dd = document.getElementById('stageDropdownDM');
    const anchor = document.getElementById('clientStage');
    if (dd) dd.style.display = 'none';
    if (anchor) anchor.classList.remove('open');
}

async function selectStageDM(newStageKey) {
    closeStageDropdownDM();
    if (!REPORT_ID || !newStageKey || typeof STAGES === 'undefined') return;
    if (newStageKey === CURRENT_STAGE) return;

    const previousStage = CURRENT_STAGE;
    const newLabel = (STAGES[newStageKey] && STAGES[newStageKey].label) || newStageKey;

    // Optimistic update
    CURRENT_STAGE = newStageKey;
    const stageEl = document.getElementById('clientStage');
    if (stageEl) stageEl.textContent = newLabel;

    try {
        const resp = await fetchWithTimeout(ENDPOINTS.ADMIN_CHANGE_STAGE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: ADMIN_TOKEN, report_id: REPORT_ID, target_stage: newStageKey })
        }, FETCH_TIMEOUTS.mutate);
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error || 'שגיאה בעדכון שלב');
        showToast(`שלב עודכן ל"${newLabel}"`, 'success');
    } catch (err) {
        // Revert
        CURRENT_STAGE = previousStage;
        const prevLabel = (STAGES[previousStage] && STAGES[previousStage].label) || previousStage;
        if (stageEl) stageEl.textContent = prevLabel;
        showToast('שגיאה בעדכון שלב: ' + err.message, 'error');
    }
}

function cancelInlineEdit(fieldKey) {
    const elId = fieldKey === 'email' ? 'clientEmailField'
               : fieldKey === 'cc_email' ? 'clientCcEmailField'
               : fieldKey === 'phone' ? 'clientPhoneField'
               : null;
    if (!elId) return;
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.remove('editing');
    updateClientBarContacts();
}
