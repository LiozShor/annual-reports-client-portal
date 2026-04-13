// Configuration — API_BASE, ADMIN_TOKEN_KEY, STAGES, STAGE_NUM_TO_KEY
// are loaded from shared/constants.js

// Safe Lucide icon replacement — avoids "No elements found" error when
// no unprocessed [data-lucide] elements exist in the DOM
function safeCreateIcons(rootOrOpts) {
    if (typeof lucide === 'undefined') return;
    try {
        const opts = rootOrOpts instanceof Element ? { root: rootOrOpts } : rootOrOpts;
        lucide.createIcons(opts);
    } catch (_) { /* no unprocessed icons */ }
}

const SESSION_FLAG_KEY = 'admin_session_active';

// State
let authToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
let clientsData = [];
let importData = [];
let existingEmails = new Set();
let reviewQueueData = [];
let showArchivedMode = false;
let dashboardLoaded = false;
let pendingClientsLoaded = false;
// Staleness timestamps — SWR: show cached data, refresh if stale (DL-247)
let dashboardLoadedAt = 0;
let pendingClientsLoadedAt = 0;
const STALE_AFTER_MS = 30000; // 30s — skip re-fetch if data is fresh

// DL-256: Pagination state
let _clientsPage = 1;
let _qaPage = 1;
let _reminderPageA = 1;
let _reminderPageB = 1;
let _aiPage = 1;
const PAGE_SIZE = 50;

// DL-256: Shared pagination renderer
function renderPagination(containerId, totalItems, currentPage, pageSize, onPageChange) {
    let container = document.getElementById(containerId);
    if (!container) {
        // Auto-create pagination container if not in DOM
        const parent = document.getElementById(containerId.replace('Pagination', 'TableContainer'))
            || document.getElementById(containerId.replace('Pagination', 'Container'));
        if (parent) {
            container = document.createElement('div');
            container.id = containerId;
            parent.parentNode.insertBefore(container, parent.nextSibling);
        } else return;
    }
    const totalPages = Math.ceil(totalItems / pageSize);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalItems);

    // Build page numbers with ellipsis
    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        if (currentPage > 3) pages.push('…');
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
        if (currentPage < totalPages - 2) pages.push('…');
        pages.push(totalPages);
    }

    let html = '<div class="pagination-bar" dir="rtl">';
    html += `<span class="pagination-info">מציג ${start}-${end} מתוך ${totalItems}</span>`;
    html += '<div class="pagination-buttons">';
    html += `<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">הקודם «</button>`;
    for (const p of pages) {
        if (p === '…') {
            html += '<span class="pagination-ellipsis">…</span>';
        } else {
            html += `<button class="pagination-btn${p === currentPage ? ' active' : ''}" data-page="${p}">${p}</button>`;
        }
    }
    html += `<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">» הבא</button>`;
    html += '</div></div>';

    container.innerHTML = html;
    container.querySelectorAll('.pagination-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => onPageChange(Number(btn.dataset.page)));
    });
}

// DL-255: Debounce utility for search inputs
function debounce(fn, ms = 150) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
const debouncedFilterClients = debounce(filterClients, 150);
const debouncedFilterReminders = debounce(filterReminders, 150);
const debouncedApplyAIFilters = debounce(applyAIFilters, 150);
const debouncedFilterQuestionnaires = debounce(filterQuestionnaires, 150);
let activeEntityTab = sessionStorage.getItem('entityTab') || 'annual_report';

const FILING_TYPE_LABELS = {
    annual_report: 'דוח שנתי',
    capital_statement: 'הצהרת הון'
};

function getClientOtherFilingType(email, year) {
    if (!email) return null;
    const normalEmail = email.toLowerCase();
    const normalYear = String(year || document.getElementById('yearFilter')?.value || new Date().getFullYear());
    const clientReports = clientsData.filter(c =>
        c.email?.toLowerCase() === normalEmail &&
        String(c.year) === normalYear &&
        c.is_active !== false
    );
    const types = new Set(clientReports.map(c => c.filing_type || 'annual_report'));
    if (types.has('annual_report') && !types.has('capital_statement')) return 'capital_statement';
    if (types.has('capital_statement') && !types.has('annual_report')) return 'annual_report';
    return null;
}

const SORT_CONFIG = {
    name:    { accessor: c => c.name || '',    type: 'string' },
    stage:   { accessor: c => STAGES[c.stage]?.num || 0, type: 'number' },
    docs:    { accessor: c => c.docs_total > 0 ? c.docs_received / c.docs_total : 0, type: 'number' },
    missing: { accessor: c => (c.docs_total || 0) - (c.docs_received || 0), type: 'number' },
    notes:   { accessor: c => c.notes || '', type: 'string' }
};

let currentSort = { column: null, direction: 'asc' };

// ==================== AUTH ====================

/** Decode admin token and check if expired (exp is in ms) */
function isTokenExpired(token) {
    try {
        const parts = token.split('.');
        if (parts.length < 2) return false;
        const payload = JSON.parse(atob(parts[0]));
        return payload.exp ? Date.now() > payload.exp : false;
    } catch (e) {
        return false;
    }
}

async function login() {
    const password = document.getElementById('passwordInput').value;
    if (!password) return;

    showLoading('מאמת...');

    try {

        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_AUTH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        }, FETCH_TIMEOUTS.quick);

        const data = await response.json();

        hideLoading();

        if (data.ok && data.token) {
            authToken = data.token;
            localStorage.setItem(ADMIN_TOKEN_KEY, authToken);
            sessionStorage.setItem(SESSION_FLAG_KEY, 'true');
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('app').classList.add('visible');
            document.getElementById('bottomNav').classList.add('visible');
            loadDashboard();
            startBackgroundRefresh();
            safeCreateIcons();
        } else {
            document.getElementById('loginError').style.display = 'block';
        }
    } catch (error) {
        hideLoading();
        document.getElementById('loginError').textContent = 'שגיאת התחברות';
        document.getElementById('loginError').style.display = 'block';
    }
}

function logout() {
    stopBackgroundRefresh();
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_FLAG_KEY);
    authToken = '';
    location.reload();
}

// Check if already logged in
async function checkAuth() {
    if (!authToken) return;

    // Reject expired tokens before trusting sessionStorage
    if (isTokenExpired(authToken)) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_FLAG_KEY);
        authToken = '';
        return;
    }

    // If session already active in this browser window, skip API call
    if (sessionStorage.getItem(SESSION_FLAG_KEY) === 'true') {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('app').classList.add('visible');
        document.getElementById('bottomNav').classList.add('visible');
        loadDashboard();
        startBackgroundRefresh();
        safeCreateIcons();
        return;
    }

    // New tab/window - verify token with API
    try {

        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_VERIFY, { headers: { 'Authorization': `Bearer ${authToken}` } }, FETCH_TIMEOUTS.quick);
        const data = await response.json();


        if (data.ok) {
            sessionStorage.setItem(SESSION_FLAG_KEY, 'true');
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('app').classList.add('visible');
            document.getElementById('bottomNav').classList.add('visible');
            loadDashboard();
            startBackgroundRefresh();
            safeCreateIcons();
        } else {
            localStorage.removeItem(ADMIN_TOKEN_KEY);
            sessionStorage.removeItem(SESSION_FLAG_KEY);
            authToken = '';
        }
    } catch (error) {
        // Token invalid, stay on login
    }
}

// bfcache guard: if page is restored from cache with expired/missing token, force logout UI
window.addEventListener('pageshow', (e) => {
    if (e.persisted && (!authToken || isTokenExpired(authToken))) {
        document.getElementById('app').classList.remove('visible');
        document.getElementById('bottomNav').classList.remove('visible');
        document.getElementById('loginScreen').style.display = '';
    }
});

// Enter key to login
document.getElementById('passwordInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});

// ==================== TABS ====================

const TAB_DROPDOWN_TABS = { send: 'שליחת שאלונים', questionnaires: 'שאלונים שהתקבלו' };

function switchTab(tabName, evt) {
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    if (tabName in TAB_DROPDOWN_TABS) {
        // Activate the dropdown wrapper's tab button
        const wrapperBtn = document.querySelector('.tab-dropdown-wrapper > .tab-item');
        if (wrapperBtn) wrapperBtn.classList.add('active');
        document.getElementById('tabDropdownLabel').textContent = TAB_DROPDOWN_TABS[tabName];
    } else if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add('active');
    }
    document.getElementById(`tab-${tabName}`).classList.add('active');
    safeCreateIcons();

    // Sync bottom nav active state (mobile)
    syncBottomNav(tabName);

    // DL-247: Always silent on tab switch — show cached data, refresh if stale
    if (tabName === 'dashboard' || tabName === 'review') {
        loadDashboard(true);
    } else if (tabName === 'send') {
        loadPendingClients(true);
    } else if (tabName === 'ai-review') {
        loadAIClassifications(true);
    } else if (tabName === 'reminders') {
        loadReminders(true);
    } else if (tabName === 'questionnaires') {
        loadQuestionnaires(true);
    }
}

function toggleTabDropdown(event) {
    event.stopPropagation();
    const menu = document.getElementById('tabDropdownMenu');
    const btn = event.currentTarget;
    const wasOpen = menu.classList.contains('open');
    closeAllRowMenus();
    if (!wasOpen) {
        positionFloating(btn, menu);
        menu.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        safeCreateIcons();
    }
}

function switchTabFromDropdown(tabName, event) {
    event.stopPropagation();
    const menu = document.getElementById('tabDropdownMenu');
    menu.classList.remove('open');
    const wrapperBtn = document.querySelector('.tab-dropdown-wrapper > .tab-item');
    if (wrapperBtn) wrapperBtn.setAttribute('aria-expanded', 'false');
    switchTab(tabName);
}

// ==================== MOBILE BOTTOM NAV ====================

function syncBottomNav(tabName) {
    const bottomNav = document.getElementById('bottomNav');
    if (!bottomNav) return;

    bottomNav.querySelectorAll('.bottom-nav-item').forEach(btn => btn.classList.remove('active'));

    const questGroupTabs = ['send', 'questionnaires'];
    const moreGroupTabs = ['review', 'reminders'];

    let dataTab = tabName;
    if (questGroupTabs.includes(tabName)) dataTab = 'questionnaires-group';
    else if (moreGroupTabs.includes(tabName)) dataTab = 'more';

    const target = bottomNav.querySelector(`[data-tab="${dataTab}"]`);
    if (target) target.classList.add('active');

    closeBottomNavPopovers();
}

function toggleBottomNavSubmenu(event) {
    event.stopPropagation();
    const popover = document.getElementById('bottomNavQuestPopover');
    const morePopover = document.getElementById('bottomNavMorePopover');
    const backdrop = document.getElementById('bottomNavBackdrop');
    const wasOpen = popover.classList.contains('open');

    morePopover.classList.remove('open');
    popover.classList.toggle('open', !wasOpen);
    backdrop.classList.toggle('open', !wasOpen);

    if (!wasOpen) {
        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();
        popover.style.left = Math.max(8, rect.left + rect.width / 2 - 90) + 'px';
    }

    safeCreateIcons();
}

function toggleBottomNavMore(event) {
    event.stopPropagation();
    const popover = document.getElementById('bottomNavMorePopover');
    const questPopover = document.getElementById('bottomNavQuestPopover');
    const backdrop = document.getElementById('bottomNavBackdrop');
    const wasOpen = popover.classList.contains('open');

    questPopover.classList.remove('open');
    popover.classList.toggle('open', !wasOpen);
    backdrop.classList.toggle('open', !wasOpen);

    if (!wasOpen) {
        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();
        const popW = 180;
        let leftPos = rect.left + rect.width / 2 - 90;
        leftPos = Math.max(8, Math.min(leftPos, window.innerWidth - popW - 8));
        popover.style.left = leftPos + 'px';
    }

    safeCreateIcons();
}

function closeBottomNavPopovers() {
    const q = document.getElementById('bottomNavQuestPopover');
    const m = document.getElementById('bottomNavMorePopover');
    const b = document.getElementById('bottomNavBackdrop');
    if (q) q.classList.remove('open');
    if (m) m.classList.remove('open');
    if (b) b.classList.remove('open');
}

function switchTabFromBottomNav(tabName, event) {
    event.stopPropagation();
    closeBottomNavPopovers();
    switchTab(tabName);
}

function syncAIBadge(topBadge, count) {
    const bottomBadge = document.getElementById('aiReviewBottomBadge');
    if (count > 0) {
        topBadge.textContent = count;
        topBadge.style.display = 'inline-flex';
        if (bottomBadge) { bottomBadge.textContent = count; bottomBadge.style.display = 'inline-flex'; }
    } else {
        topBadge.style.display = 'none';
        if (bottomBadge) bottomBadge.style.display = 'none';
    }
}

// ==================== MOBILE PREVIEW MODAL (AI Review) ====================

let mobilePreviewCardIds = []; // ordered list of visible card IDs for nav
let mobilePreviewCurrentIdx = -1;

function getMobilePreviewCardIds() {
    // Get visible card IDs in DOM order (respects current filters)
    const cards = document.querySelectorAll('#aiCardsContainer .ai-review-card:not([style*="display: none"])');
    return Array.from(cards).map(c => c.dataset.id).filter(Boolean);
}

function loadMobileDocPreview(recordId) {
    const item = aiClassificationsData.find(i => i.id === recordId);
    if (!item) return;

    // Build navigation list from visible cards
    mobilePreviewCardIds = getMobilePreviewCardIds();
    mobilePreviewCurrentIdx = mobilePreviewCardIds.indexOf(recordId);

    const modal = document.getElementById('mobilePreviewModal');
    const fileName = document.getElementById('mobilePreviewFileName');
    const openTab = document.getElementById('mobilePreviewOpenTab');
    const downloadBtn = document.getElementById('mobilePreviewDownload');
    const loading = document.getElementById('mobilePreviewLoading');
    const error = document.getElementById('mobilePreviewError');
    const errorMsg = document.getElementById('mobilePreviewErrorMsg');
    const iframe = document.getElementById('mobilePreviewIframe');
    const footer = document.getElementById('mobilePreviewFooter');

    // Reset state
    loading.style.display = 'none';
    error.style.display = 'none';
    iframe.style.display = 'none';
    iframe.src = 'about:blank';
    downloadBtn.style.display = 'none';

    // Set header info
    fileName.textContent = item.attachment_name || 'מסמך';
    openTab.href = item.file_url || '#';
    openTab.style.display = item.file_url ? '' : 'none';

    // Update navigation counter & arrow states
    updateMobilePreviewNav();

    // Build footer with AI classification info + actions
    buildMobilePreviewFooter(item, footer);

    // Show modal
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    safeCreateIcons();

    // No onedrive_item_id — show error
    if (!item.onedrive_item_id) {
        error.style.display = '';
        errorMsg.textContent = 'אין מזהה קובץ — לא ניתן לטעון תצוגה מקדימה';
        return;
    }

    // Show loading
    loading.style.display = '';

    getDocPreviewUrl(item.onedrive_item_id).then(({ previewUrl, downloadUrl }) => {
        // Keep spinner until iframe actually loads
        iframe.onload = () => {
            loading.style.display = 'none';
            iframe.style.display = '';
        };
        iframe.src = previewUrl;
        if (downloadUrl) {
            downloadBtn.href = downloadUrl;
            downloadBtn.style.display = '';
        }
    }).catch(err => {
        loading.style.display = 'none';
        error.style.display = '';
        errorMsg.textContent = err.message || 'שגיאה בטעינת תצוגה מקדימה';
    });
}

function buildMobilePreviewFooter(item, footer) {
    const reviewStatus = item.review_status || 'pending';
    if (reviewStatus !== 'pending') {
        footer.style.display = 'none';
        return;
    }

    const state = getCardState(item);
    const rawConfidence = item.ai_confidence || 0;
    const confidencePercent = Math.round(rawConfidence * 100);

    let classificationHtml = '';
    let actionsHtml = '';

    if (state === 'full' || state === 'fuzzy') {
        const docDisplayName = item.matched_short_name || item.matched_template_name || 'לא ידוע';
        classificationHtml = `
            <div class="ai-classification-result">
                <span class="ai-confidence-prefix">🤖 AI חושב שזה:</span>
                <span class="ai-template-match">${renderDocLabel(docDisplayName)}</span>
                <span class="ai-confidence-badge">${confidencePercent}%</span>
            </div>`;
        if (item.ai_reason) {
            classificationHtml += `<div class="ai-reason-inline" style="font-size:var(--text-xs);color:var(--gray-500);margin-top:var(--sp-1);">${escapeHtml(friendlyAIReason(item.ai_reason))}</div>`;
        }
        const approveDisabled = item.is_unrequested;
        actionsHtml = `
            <div class="ai-card-actions">
                <button class="btn btn-success btn-sm" ${approveDisabled
                    ? 'aria-disabled="true" title="לא ניתן לאשר מסמך שלא נדרש"'
                    : `onclick="approveAIClassification('${escapeAttr(item.id)}'); closeMobilePreview();"`}>
                    <i data-lucide="check" class="icon-sm"></i> נכון
                </button>
                <button class="btn btn-link btn-sm" onclick="closeMobilePreview(); showAIReassignModal('${escapeAttr(item.id)}')">
                    <i data-lucide="arrow-right-left" class="icon-sm"></i> לא נכון, שייך מחדש
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}'); closeMobilePreview();">
                    <i data-lucide="x" class="icon-sm"></i> מסמך לא רלוונטי
                </button>
            </div>`;

    } else if (state === 'issuer-mismatch') {
        const templateName = item.matched_short_name || item.matched_template_name || item.matched_template_id || '';
        const aiIssuer = item.issuer_name || 'לא ידוע';
        classificationHtml = `
            <div class="ai-classification-result">
                <span class="ai-confidence-prefix">🤖 AI חושב שזה:</span>
                <span class="ai-template-match">${renderDocLabel(templateName)}</span>
                <span class="ai-confidence-badge">${confidencePercent}%</span>
            </div>
            <div style="font-size:var(--text-xs);color:var(--gray-500);margin-top:var(--sp-1);">מ: ${escapeHtml(aiIssuer)}</div>`;
        actionsHtml = `
            <div class="ai-card-actions">
                <button class="btn btn-link btn-sm" onclick="closeMobilePreview(); showAIReassignModal('${escapeAttr(item.id)}')">
                    <i data-lucide="arrow-right-left" class="icon-sm"></i> שייך מחדש
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}'); closeMobilePreview();">
                    <i data-lucide="x" class="icon-sm"></i> מסמך לא רלוונטי
                </button>
            </div>`;

    } else {
        // Unmatched
        const reasonHtml = item.ai_reason
            ? `<div style="font-size:var(--text-xs);color:var(--gray-500);margin-top:var(--sp-1);">${escapeHtml(friendlyAIReason(item.ai_reason))}</div>`
            : '';
        classificationHtml = `
            <div class="ai-classification-result">
                <span class="ai-template-unmatched">🤖 לא זוהה</span>
            </div>
            ${reasonHtml}`;
        actionsHtml = `
            <div class="ai-card-actions">
                <button class="btn btn-link btn-sm" onclick="closeMobilePreview(); showAIReassignModal('${escapeAttr(item.id)}')">
                    <i data-lucide="arrow-right-left" class="icon-sm"></i> שייך ידנית
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}'); closeMobilePreview();">
                    <i data-lucide="x" class="icon-sm"></i> מסמך לא רלוונטי
                </button>
            </div>`;
    }

    const clientName = item.client_name || '';
    const clientHeader = clientName
        ? `<div class="mobile-preview-client"><i data-lucide="user" class="icon-sm"></i> ${escapeHtml(clientName)}</div>`
        : '';

    footer.innerHTML = clientHeader + classificationHtml + actionsHtml;
    footer.style.display = '';
}

function closeMobilePreview() {
    const modal = document.getElementById('mobilePreviewModal');
    const iframe = document.getElementById('mobilePreviewIframe');
    if (modal) modal.classList.remove('show');
    document.body.style.overflow = '';
    if (iframe) iframe.src = 'about:blank';
    mobilePreviewCurrentIdx = -1;
}

function navigateMobilePreview(direction) {
    // direction: -1 = previous (right in RTL), +1 = next (left in RTL)
    const newIdx = mobilePreviewCurrentIdx + direction;
    if (newIdx < 0 || newIdx >= mobilePreviewCardIds.length) return;
    const newId = mobilePreviewCardIds[newIdx];
    mobilePreviewCurrentIdx = newIdx;
    loadMobileDocPreview(newId);
}

function updateMobilePreviewNav() {
    const counter = document.getElementById('mobilePreviewCounter');
    const prevBtn = document.getElementById('mobilePreviewPrev');
    const nextBtn = document.getElementById('mobilePreviewNext');
    const nav = document.getElementById('mobilePreviewNav');

    if (mobilePreviewCardIds.length <= 1) {
        nav.style.display = 'none';
        return;
    }

    nav.style.display = '';
    counter.textContent = `${mobilePreviewCurrentIdx + 1} / ${mobilePreviewCardIds.length}`;
    prevBtn.disabled = mobilePreviewCurrentIdx <= 0;
    nextBtn.disabled = mobilePreviewCurrentIdx >= mobilePreviewCardIds.length - 1;
}

// ==================== DASHBOARD ====================

function updateReviewQueueUI() {
    reviewQueueData.forEach(c => { if (!c.filing_type) console.warn('Missing filing_type for record', c.id || c.report_id); });
    const filtered = reviewQueueData.filter(c => (c.filing_type || 'annual_report') === activeEntityTab);
    const badge = document.getElementById('reviewCountBadge');
    const reviewBottomBadge = document.getElementById('reviewBottomBadge');
    if (filtered.length > 0) {
        badge.textContent = filtered.length;
        badge.style.display = 'inline-flex';
        if (reviewBottomBadge) { reviewBottomBadge.textContent = filtered.length; reviewBottomBadge.style.display = 'inline-flex'; }
    } else {
        badge.style.display = 'none';
        if (reviewBottomBadge) reviewBottomBadge.style.display = 'none';
    }
    document.getElementById('reviewHeaderCount').textContent = `${filtered.length} לקוחות בתור`;
    renderReviewTable(filtered);
}

async function loadDashboard(silent = false) {
    if (!authToken) return; // Not logged in — prevent unauthorized API call + reload loop
    // DL-247: SWR — skip if data is fresh, otherwise fetch silently
    const isFresh = dashboardLoaded && (Date.now() - dashboardLoadedAt < STALE_AFTER_MS);
    if (silent && isFresh) return;

    // DL-247: Inline loading for first-ever load only (no full-screen overlay)


    try {
        const year = document.getElementById('yearFilter')?.value || '2025';
        const response = await fetchWithTimeout(`${ENDPOINTS.ADMIN_DASHBOARD}?year=${year}&_t=${Date.now()}`, { headers: { 'Authorization': `Bearer ${authToken}` } }, FETCH_TIMEOUTS.slow); // DL-254: 20s for 579+ clients
        const data = await response.json();



        if (!data.ok) {
            if (data.error === 'unauthorized') {
                logout();
                return;
            }
            throw new Error(data.error);
        }

        // Store clients data
        clientsData = data.clients || [];
        dashboardLoaded = true;
        dashboardLoadedAt = Date.now();

        // Update stats (recalculate client-side to exclude deactivated)
        recalculateStats();
        existingEmails = new Set(clientsData.map(c => c.email?.toLowerCase()));

        // Store review queue data (unfiltered) + render filtered by entity tab
        reviewQueueData = data.review_queue || [];
        updateReviewQueueUI();

        // DL-255: Reset base key to force full rebuild, then filterClients handles render + hide/show
        _clientsBaseKey = '';
        _clientsSortKey = '';

        // Render table via filterClients (builds full base set, applies current filters)
        const currentStageFilter = document.getElementById('stageFilter').value;
        toggleStageFilter(currentStageFilter, false); // Pass false to prevent re-filtering

        safeCreateIcons();

        // Update year dropdowns with available years from API
        if (data.available_years && data.available_years.length > 0) {
            const yearChanged = updateYearDropdowns(data.available_years);
            if (yearChanged) {
                dashboardLoaded = false; dashboardLoadedAt = 0; // year changed — invalidate cache
                pendingClientsLoaded = false; pendingClientsLoadedAt = 0;
                loadDashboard(true); // reload with the newest year
                return;
            }
        }

        // Load AI review badge count + prefetch other tabs (async, non-blocking) — DL-175
        // Safari/iOS lacks requestIdleCallback — fall back to setTimeout
        const deferFn = typeof requestIdleCallback === 'function'
            ? (cb) => requestIdleCallback(cb, { timeout: 2000 })
            : (cb) => setTimeout(cb, 100);
        deferFn(() => {
            loadAIReviewCount();
            loadReminderCount();
            loadRecentMessages(); // DL-261: side panel
            if (!pendingClientsLoaded) loadPendingClients(true);
            if (!aiReviewLoaded) loadAIClassifications(true); // DL-247: prefetch AI review
            if (!questionnaireLoaded) loadQuestionnaires(true);
            if (!reminderLoaded) loadReminders(true);
            updateActiveFilterCount(); // DL-214
        });
    } catch (error) {

        console.error('Dashboard load failed', error);
        if (!silent) showModal('error', 'שגיאה', 'לא ניתן לטעון את הנתונים', null, { label: 'רענן', onClick: () => location.reload() });
    }
}

// DL-261: Recent client messages side panel
let recentMessagesLoaded = false;

function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    // Date field is date-only (no time), so use day-level precision
    const today = new Date().toISOString().slice(0, 10);
    if (dateStr === today) return 'היום';
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === yesterday) return 'אתמול';
    const days = Math.floor((Date.now() - new Date(dateStr + 'T12:00:00').getTime()) / 86400000);
    if (days < 7) return `לפני ${days} ימים`;
    if (days < 30) return `לפני ${Math.floor(days / 7)} שבועות`;
    return dateStr.replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1');
}

async function loadRecentMessages() {
    if (!authToken) return;
    const container = document.getElementById('recentMessagesContainer');
    if (!container) return;

    try {
        const year = document.getElementById('yearFilter')?.value || '2025';
        const response = await fetchWithTimeout(
            `${ENDPOINTS.ADMIN_RECENT_MESSAGES}?year=${year}&_t=${Date.now()}`,
            { headers: { 'Authorization': `Bearer ${authToken}` } },
            FETCH_TIMEOUTS.load
        );
        const data = await response.json();
        if (!data.ok) return;

        const messages = data.messages || [];
        recentMessagesLoaded = true;

        // Update badge count
        const badge = document.getElementById('recentMsgCount');
        if (badge) {
            if (messages.length > 0) {
                badge.textContent = messages.length;
                badge.style.display = '';
            } else {
                badge.style.display = 'none';
            }
        }

        if (messages.length === 0) {
            container.innerHTML = `
                <div class="msg-empty">
                    <i data-lucide="inbox" class="icon-2xl"></i>
                    <p>אין הודעות אחרונות</p>
                </div>`;
            safeCreateIcons(container);
            return;
        }

        container.innerHTML = messages.map(m => {
            const navParam = m.client_id ? `client_id=${encodeURIComponent(m.client_id)}` : `report_id=${encodeURIComponent(m.report_id)}`;
            const displayText = m.raw_snippet || m.summary || '';
            const noteId = escapeHtml(m.id || '');
            const reportId = escapeHtml(m.report_id || '');
            return `<div class="msg-row" data-note-id="${noteId}" onclick="window.location.href='../document-manager.html?${navParam}'">
                <div class="msg-content">
                    <div class="msg-meta">
                        <span class="msg-client">${escapeHtml(m.client_name)}</span>
                        <span class="msg-date">${formatRelativeTime(m.date)}</span>
                    </div>
                    <div class="msg-summary">${escapeHtml(displayText)}</div>
                </div>
                <button class="msg-delete-btn" title="מחק/הסתר הודעה" onclick="event.stopPropagation(); showMessageDeleteDialog('${noteId}', '${reportId}')"><i data-lucide="trash-2" class="icon-sm"></i></button>
            </div>`;
        }).join('');
        safeCreateIcons(container);
    } catch (error) {
        console.error('Recent messages load failed', error);
        container.innerHTML = '';
    }
}

// DL-263: Two-button dialog for delete/hide message
function showMessageDeleteDialog(noteId, reportId) {
    const dialog = document.getElementById('confirmDialog');
    const msgEl = document.getElementById('confirmDialogMessage');
    const btnEl = document.getElementById('confirmDialogBtn');
    const footerEl = btnEl.parentElement;
    const originalFooterHtml = footerEl.innerHTML;

    msgEl.textContent = 'מה לעשות עם ההודעה?';
    footerEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;width:100%">
            <button class="btn confirm-btn-danger" id="msgDeletePermanentBtn">
                <i data-lucide="trash-2" class="icon-sm"></i> מחק לצמיתות
            </button>
            <button class="btn btn-outline" id="msgHideDashboardBtn">
                <i data-lucide="eye-off" class="icon-sm"></i> הסתר מהדשבורד
            </button>
            <button class="btn btn-ghost" id="msgCancelBtn">ביטול</button>
        </div>
    `;

    function cleanup() {
        dialog.classList.remove('show');
        footerEl.innerHTML = originalFooterHtml;
    }

    document.getElementById('msgDeletePermanentBtn').addEventListener('click', () => { cleanup(); deleteRecentMessage(noteId, reportId, 'permanent'); });
    document.getElementById('msgHideDashboardBtn').addEventListener('click', () => { cleanup(); deleteRecentMessage(noteId, reportId, 'hide'); });
    document.getElementById('msgCancelBtn').addEventListener('click', () => { cleanup(); });

    dialog.classList.add('show');
    safeCreateIcons();
}

// DL-263: Delete or hide a message from the dashboard panel
async function deleteRecentMessage(noteId, reportId, mode) {
    try {
        const year = document.getElementById('yearFilter')?.value || '2025';
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_UPDATE_CLIENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ token: authToken, report_id: reportId, action: 'delete-client-note', note_id: noteId, mode })
        });
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || 'Failed');

        // Remove row from DOM
        const row = document.querySelector(`.msg-row[data-note-id="${noteId}"]`);
        if (row) {
            row.style.transition = 'opacity 0.3s, max-height 0.3s';
            row.style.opacity = '0';
            row.style.maxHeight = '0';
            row.style.overflow = 'hidden';
            setTimeout(() => {
                row.remove();
                // Update badge count
                const remaining = document.querySelectorAll('.msg-row').length;
                const badge = document.getElementById('recentMsgCount');
                if (badge) {
                    if (remaining > 0) { badge.textContent = remaining; badge.style.display = ''; }
                    else { badge.style.display = 'none'; }
                }
                if (remaining === 0) {
                    const container = document.getElementById('recentMessagesContainer');
                    if (container) {
                        container.innerHTML = `<div class="msg-empty"><i data-lucide="inbox" class="icon-2xl"></i><p>אין הודעות אחרונות</p></div>`;
                        safeCreateIcons(container);
                    }
                }
            }, 300);
        }

        showAIToast(mode === 'permanent' ? 'ההודעה נמחקה לצמיתות' : 'ההודעה הוסתרה מהדשבורד', 'success');
    } catch (err) {
        showAIToast('שגיאה: ' + (err.message || 'Unknown error'), 'error');
    }
}

function renderClientsTable(clients) {
    const container = document.getElementById('clientsTableContainer');

    if (!clients || clients.length === 0) {
        // DL-247: Don't replace skeleton with empty state if data hasn't loaded yet
        if (!dashboardLoaded) return;
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="folder-open" class="icon-2xl"></i></div>
                <p>לא נמצאו לקוחות</p>
            </div>
        `;
        safeCreateIcons();
        return;
    }

    function sortAttr(col) {
        if (currentSort.column !== col) return 'none';
        return currentSort.direction === 'asc' ? 'ascending' : 'descending';
    }

    let html = `
        <div class="table-scroll-container" role="region" aria-label="טבלת לקוחות" tabindex="0">
        <table>
            <thead>
                <tr>
                    <th style="width:32px"><input type="checkbox" class="dashboard-select-all" onchange="toggleClientSelectAll(this)"></th>
                    <th><button class="th-sort-btn" onclick="toggleSort('name')" aria-sort="${sortAttr('name')}">שם <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th><button class="th-sort-btn" onclick="toggleSort('stage')" aria-sort="${sortAttr('stage')}">שלב <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th><button class="th-sort-btn" onclick="toggleSort('docs')" aria-sort="${sortAttr('docs')}">מסמכים <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th><button class="th-sort-btn" onclick="toggleSort('missing')" aria-sort="${sortAttr('missing')}">חסרים <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th><button class="th-sort-btn" onclick="toggleSort('notes')" aria-sort="${sortAttr('notes')}">הערות <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th>פעולות</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const client of clients) {
        const stage = STAGES[client.stage] || { label: client.stage, icon: 'help-circle', class: '' };
        const docsReceived = client.docs_received || 0;
        const docsTotal = client.docs_total || 0;
        const progressPercent = docsTotal > 0 ? Math.round((docsReceived / docsTotal) * 100) : 0;
        const missingCount = docsTotal - docsReceived;
        const stageNum = stage.num || 0;
        const rid = escapeAttr(client.report_id);
        const cName = escapeAttr(client.name);
        const isActive = client.is_active !== false;
        const otherType = getClientOtherFilingType(client.email, client.year);
        const otherTypeLabel = otherType ? FILING_TYPE_LABELS[otherType] : '';

        html += `
            <tr data-report-id="${rid}" data-client-name="${cName}" data-stage="${escapeAttr(client.stage)}" data-is-active="${isActive}">
                <td><input type="checkbox" class="dashboard-client-checkbox" value="${rid}" onchange="updateClientSelectedCount()"></td>
                <td>
                    <div class="client-name-cell">
                        <strong
                            class="client-link"
                            onclick="viewClientDocs('${rid}')"
                            title="${escapeHtml(client.email || '')}"
                        >
                            ${escapeHtml(client.name)}
                        </strong>
                        <a class="client-edit-link" href="javascript:void(0)" onclick="event.stopPropagation(); openClientDetailModal('${rid}')" title="עריכת פרטים">
                            <i data-lucide="pencil" class="icon-xs"></i>
                        </a>
                    </div>
                </td>
                <td>
                    <span id="stage-badge-${rid}" class="stage-badge ${stage.class} clickable"
                        onclick="openStageDropdown(event, '${rid}', '${escapeAttr(client.stage)}')"
                        title="לחץ לשינוי שלב">
                        <i data-lucide="${stage.icon}" class="icon-sm"></i> ${stage.label} <span class="stage-caret">&#x25BE;</span>
                    </span>
                </td>
                <td>
                    ${stageNum <= 3
                        ? '<span class="missing-count not-applicable">—</span>'
                        : `<div class="docs-progress-cell clickable-docs" onclick="toggleDocsPopover(event, '${rid}', '${cName}')" tabindex="0" role="button" title="לחץ לצפייה במסמכים">
                        <span class="docs-count">${docsReceived}/${docsTotal}</span>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                    </div>`
                    }
                </td>
                <td>
                    ${stageNum <= 3
                        ? '<span class="missing-count not-applicable">—</span>'
                        : `<span class="missing-count clickable-count ${missingCount > 0 ? 'has-missing' : 'all-done'}" onclick="toggleDocsPopover(event, '${rid}', '${cName}')" tabindex="0" role="button" title="לחץ לצפייה במסמכים">${missingCount > 0 ? missingCount : '✓'}</span>`
                    }
                </td>
                <td class="notes-cell" onclick="editReportNotes(event, '${rid}')" title="${escapeAttr(client.notes || '')}">
                    <span class="notes-text">${escapeHtml((client.notes || '').substring(0, 60))}${(client.notes || '').length > 60 ? '…' : ''}</span>
                </td>
                <td>
                    ${client.stage === 'Send_Questionnaire' ?
                `<button class="action-btn send" onclick="sendSingle('${rid}')" title="שלח שאלון"><i data-lucide="send" class="icon-sm"></i></button>` :
                ''}
                    ${(client.stage === 'Waiting_For_Answers' || client.stage === 'Collecting_Docs') ?
                `<button class="action-btn reminder-set-btn" onclick="sendDashboardReminder('${rid}', '${cName}')" title="שלח תזכורת"><i data-lucide="bell-ring" class="icon-sm"></i></button>` :
                ''}
                    <div class="row-overflow-dropdown">
                        <button class="action-btn overflow" onclick="toggleRowMenu(this, event)" title="פעולות נוספות">⋮</button>
                        <div class="row-menu">
                            <button onclick="viewClient('${rid}'); closeAllRowMenus();"><i data-lucide="external-link"></i> צפייה כלקוח</button>
                            ${stageNum >= 3 ?
                `<button onclick="viewQuestionnaire('${rid}'); closeAllRowMenus();"><i data-lucide="file-text"></i> צפה בשאלון</button>` : ''}
                            ${isActive && otherType ?
                `<button onclick="addSecondFilingType('${rid}'); closeAllRowMenus();"><i data-lucide="file-plus"></i> הוסף ${otherTypeLabel}</button>` : ''}
                            ${isActive ?
                `<button class="danger" onclick="deactivateClient('${rid}', '${cName}'); closeAllRowMenus();"><i data-lucide="archive"></i> העבר לארכיון</button>` :
                `<button onclick="reactivateClient('${rid}'); closeAllRowMenus();"><i data-lucide="archive-restore"></i> הפעל מחדש</button>`}
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    html += '</tbody></table>';

    // Mobile card list (DL-214)
    let cards = '<ul class="mobile-card-list" role="list" aria-label="רשימת לקוחות">';
    for (const client of clients) {
        const stage = STAGES[client.stage] || { label: client.stage, icon: 'help-circle', class: '' };
        const docsReceived = client.docs_received || 0;
        const docsTotal = client.docs_total || 0;
        const progressPercent = docsTotal > 0 ? Math.round((docsReceived / docsTotal) * 100) : 0;
        const missingCount = docsTotal - docsReceived;
        const stageNum = stage.num || 0;
        const rid = escapeAttr(client.report_id);
        const cName = escapeAttr(client.name);
        const isActive = client.is_active !== false;
        const mOtherType = getClientOtherFilingType(client.email, client.year);
        const mOtherTypeLabel = mOtherType ? FILING_TYPE_LABELS[mOtherType] : '';

        cards += `<li class="mobile-card" data-report-id="${rid}" data-stage="${escapeAttr(client.stage)}" data-is-active="${isActive}">
            <div class="mobile-card-primary">
                <span class="mobile-card-checkbox"><input type="checkbox" class="dashboard-client-checkbox" value="${rid}" onchange="updateClientSelectedCount()"></span>
                <div class="mobile-card-info">
                    <span class="mobile-card-name" onclick="viewClientDocs('${rid}')" title="${escapeHtml(client.email || '')}">${escapeHtml(client.name)}</span>
                    <span id="stage-badge-m-${rid}" class="stage-badge ${stage.class} clickable"
                        onclick="openStageDropdown(event, '${rid}', '${escapeAttr(client.stage)}')"
                        title="לחץ לשינוי שלב">
                        <i data-lucide="${stage.icon}" class="icon-sm"></i> ${stage.label}
                    </span>
                </div>
            </div>
            <div class="mobile-card-secondary">
                ${stageNum > 3 ? `
                    <span class="mobile-card-detail">
                        <span class="label">מסמכים</span>
                        <span class="docs-count clickable-docs" onclick="toggleDocsPopover(event, '${rid}', '${cName}')">${docsReceived}/${docsTotal}</span>
                    </span>
                    <span class="mobile-card-detail">
                        <span class="label">חסרים</span>
                        <span class="missing-count ${missingCount > 0 ? 'has-missing' : 'all-done'}">${missingCount > 0 ? missingCount : '✓'}</span>
                    </span>
                ` : ''}
                ${client.notes ? `<span class="notes-text" onclick="editReportNotes(event, '${rid}')">${escapeHtml((client.notes || '').substring(0, 40))}${(client.notes || '').length > 40 ? '…' : ''}</span>` : ''}
            </div>
            <div class="mobile-card-actions">
                ${client.stage === 'Send_Questionnaire' ?
                    `<button class="action-btn send" onclick="sendSingle('${rid}')" title="שלח שאלון"><i data-lucide="send" class="icon-sm"></i></button>` : ''}
                ${(client.stage === 'Waiting_For_Answers' || client.stage === 'Collecting_Docs') ?
                    `<button class="action-btn reminder-set-btn" onclick="sendDashboardReminder('${rid}', '${cName}')" title="שלח תזכורת"><i data-lucide="bell-ring" class="icon-sm"></i></button>` : ''}
                <div class="row-overflow-dropdown">
                    <button class="action-btn overflow" onclick="toggleRowMenu(this, event)" title="פעולות נוספות">⋮</button>
                    <div class="row-menu">
                        <button onclick="viewClient('${rid}'); closeAllRowMenus();"><i data-lucide="external-link"></i> צפייה כלקוח</button>
                        ${stageNum >= 3 ?
                            `<button onclick="viewQuestionnaire('${rid}'); closeAllRowMenus();"><i data-lucide="file-text"></i> צפה בשאלון</button>` : ''}
                        ${isActive && mOtherType ?
                            `<button onclick="addSecondFilingType('${rid}'); closeAllRowMenus();"><i data-lucide="file-plus"></i> הוסף ${mOtherTypeLabel}</button>` : ''}
                        ${isActive ?
                            `<button class="danger" onclick="deactivateClient('${rid}', '${cName}'); closeAllRowMenus();"><i data-lucide="archive"></i> העבר לארכיון</button>` :
                            `<button onclick="reactivateClient('${rid}'); closeAllRowMenus();"><i data-lucide="archive-restore"></i> הפעל מחדש</button>`}
                    </div>
                </div>
            </div>
        </li>`;
    }
    cards += '</ul>';

    html += cards + '</div>';
    container.innerHTML = html;
    safeCreateIcons(container);
}

let _filteredClients = []; // DL-256: filtered+sorted client list for pagination
function filterClients(keepPage) {
    resetClientBulkSelection();
    const search = document.getElementById('searchInput').value.toLowerCase();
    const stage = document.getElementById('stageFilter').value;
    const year = document.getElementById('yearFilter').value;

    let filtered = clientsData.filter(c => (c.filing_type || 'annual_report') === activeEntityTab);
    filtered = filtered.filter(c => showArchivedMode ? c.is_active === false : c.is_active !== false);

    if (search) {
        filtered = filtered.filter(c =>
            c.name?.toLowerCase().includes(search) ||
            c.email?.toLowerCase().includes(search)
        );
    }
    if (stage) {
        filtered = filtered.filter(c => c.stage === STAGE_NUM_TO_KEY[stage]);
    }
    if (year) {
        filtered = filtered.filter(c => String(c.year) === year);
    }

    _filteredClients = sortClients(filtered);
    if (!keepPage) _clientsPage = 1;

    const pageSlice = _filteredClients.slice((_clientsPage - 1) * PAGE_SIZE, _clientsPage * PAGE_SIZE);
    renderClientsTable(pageSlice);
    renderPagination('clientsPagination', _filteredClients.length, _clientsPage, PAGE_SIZE, goToClientsPage);
    updateActiveFilterCount();
}

function goToClientsPage(page) {
    _clientsPage = page;
    filterClients(true);
    document.getElementById('clientsTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// DL-214: Mobile collapsible filter bar
function toggleMobileFilters() {
    const filters = document.querySelector('.filters.filters-mobile-hidden, .filters.filters-mobile-visible');
    const bar = document.querySelector('.filters-mobile-bar');
    if (!filters || !bar) return;

    const isHidden = filters.classList.contains('filters-mobile-hidden');
    if (isHidden) {
        filters.classList.remove('filters-mobile-hidden');
        filters.classList.add('filters-mobile-visible');
        bar.classList.add('expanded');
    } else {
        filters.classList.remove('filters-mobile-visible');
        filters.classList.add('filters-mobile-hidden');
        bar.classList.remove('expanded');
    }
}

function updateActiveFilterCount() {
    const countEl = document.getElementById('activeFilterCount');
    if (!countEl) return;
    let count = 0;
    const search = document.getElementById('searchInput');
    if (search && search.value.trim()) count++;
    const stage = document.getElementById('stageFilter');
    if (stage && stage.value) count++;
    const year = document.getElementById('yearFilter');
    if (year && year.value) count++;
    countEl.textContent = count > 0 ? count : '';
}

function toggleStageFilter(stage) {
    const select = document.getElementById('stageFilter');
    const cards = document.querySelectorAll('.stat-card');

    // If clicking the currently selected stage, toggle it off (unless it's empty/all, which stays selected)
    if (select.value === stage && stage !== '') {
        select.value = '';
    } else {
        select.value = stage;
    }

    // Update UI visual state
    cards.forEach(card => card.classList.remove('active'));

    if (select.value === '') {
        // Activate total card
        cards[0].classList.add('active');
    } else {
        // Activate specific stage card (index matches stage number)
        if (cards[parseInt(select.value)]) {
            cards[parseInt(select.value)].classList.add('active');
        }
    }

    filterClients();
}

// ==================== SORTING ====================

function toggleSort(column) {
    if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.direction = 'asc';
    }
    filterClients();
}

function sortClients(clients) {
    if (!currentSort.column) return clients;
    const config = SORT_CONFIG[currentSort.column];
    if (!config) return clients;

    return [...clients].sort((a, b) => {
        const aVal = config.accessor(a);
        const bVal = config.accessor(b);
        let cmp;
        if (config.type === 'string') {
            cmp = String(aVal).localeCompare(String(bVal), 'he');
        } else {
            cmp = (aVal || 0) - (bVal || 0);
        }
        return currentSort.direction === 'asc' ? cmp : -cmp;
    });
}

// ==================== FLOATING ELEMENT POSITIONING ====================

/**
 * Position a fixed floating element relative to a trigger, with flip/shift/size-constrain.
 * @param {Element} triggerEl - The element that triggers the floating element
 * @param {Element} floatingEl - The floating element to position (must be position:fixed)
 * @param {Object} [opts] - Options
 * @param {number} [opts.gap=6] - Gap between trigger and floating element
 * @param {number} [opts.padding=8] - Viewport edge padding
 */
function positionFloating(triggerEl, floatingEl, opts = {}) {
    const gap = opts.gap ?? 6;
    const pad = opts.padding ?? 8;
    const rect = triggerEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Temporarily show to measure
    const prevDisplay = floatingEl.style.display;
    floatingEl.style.visibility = 'hidden';
    floatingEl.style.display = 'block';
    const floatRect = floatingEl.getBoundingClientRect();
    const floatW = floatRect.width;
    const floatH = floatRect.height;
    floatingEl.style.visibility = '';
    floatingEl.style.display = prevDisplay;

    // Flip: pick side with more room
    const spaceBelow = vh - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const placeAbove = spaceBelow < floatH && spaceAbove > spaceBelow;
    const side = placeAbove ? 'top' : 'bottom';

    if (side === 'bottom') {
        floatingEl.style.top = (rect.bottom + gap) + 'px';
        floatingEl.style.bottom = '';
    } else {
        floatingEl.style.top = '';
        floatingEl.style.bottom = (vh - rect.top + gap) + 'px';
    }

    // Shift: align right edge to trigger, clamp horizontally
    let rightPos = vw - rect.right;
    const minRight = pad;
    const maxRight = vw - floatW - pad;
    rightPos = Math.max(minRight, Math.min(rightPos, maxRight));
    floatingEl.style.right = rightPos + 'px';
    floatingEl.style.left = 'auto';

    // Size-constrain: dynamic max-height
    const availableSpace = (side === 'bottom' ? spaceBelow : spaceAbove) - pad;
    floatingEl.style.maxHeight = Math.max(availableSpace, 120) + 'px';

    // Direction attribute for CSS animations
    floatingEl.setAttribute('data-side', side);
}

// ==================== STAGE DROPDOWN ====================

function openStageDropdown(event, reportId, currentStage) {
    event.stopPropagation();
    const dropdown = document.getElementById('stageDropdown');
    const rect = event.currentTarget.getBoundingClientRect();
    const currentNum = STAGES[currentStage]?.num || 0;

    let html = '';
    for (const [key, info] of Object.entries(STAGES)) {
        const isActive = key === currentStage;
        const isBackward = info.num < currentNum;
        html += `<button class="stage-dropdown-option ${isActive ? 'active' : ''} ${isBackward ? 'warning' : ''}"
                    onclick="changeClientStage('${escapeAttr(reportId)}', '${key}')" ${isActive ? 'disabled' : ''}>
                    <i data-lucide="${info.icon}" class="icon-sm"></i>
                    ${info.label}
                    ${isBackward ? '<span class="backward-badge">← אחורה</span>' : ''}
                </button>`;
    }

    dropdown.innerHTML = html;

    positionFloating(event.currentTarget, dropdown);
    dropdown.style.display = 'block';

    safeCreateIcons();

    // Prevent immediate close from the same click event bubbling to document
    requestAnimationFrame(() => {
        document.addEventListener('click', _closeStageDropdownOnClick, { once: true });
    });
}

function _closeStageDropdownOnClick() {
    closeStageDropdown();
}

function closeStageDropdown() {
    const dropdown = document.getElementById('stageDropdown');
    if (dropdown) dropdown.style.display = 'none';
    document.removeEventListener('click', _closeStageDropdownOnClick);
}

function changeClientStage(reportId, newStage) {
    closeStageDropdown();

    const client = clientsData.find(c => c.report_id === reportId);
    if (!client || client.stage === newStage) return;

    const currentNum = STAGES[client.stage]?.num || 0;
    const targetNum = STAGES[newStage]?.num || 0;
    const isBackward = targetNum < currentNum;
    const targetLabel = STAGES[newStage]?.label || newStage;

    if (isBackward) {
        showConfirmDialog(
            `שינוי אחורה ל"${targetLabel}" — פעולה זו עלולה לאפס נתונים. להמשיך?`,
            () => executeStageChange(reportId, newStage),
            'שנה שלב',
            true
        );
    } else {
        executeStageChange(reportId, newStage);
    }
}

async function executeStageChange(reportId, newStage) {
    const client = clientsData.find(c => c.report_id === reportId);
    if (!client) return;

    const previousStage = client.stage;

    // Optimistic update
    client.stage = newStage;
    updateClientStageInPlace(reportId, newStage);
    recalculateStats();

    try {

        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_CHANGE_STAGE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: authToken, report_id: reportId, target_stage: newStage })
        }, FETCH_TIMEOUTS.mutate);

        const data = await response.json();


        if (!data.ok) {
            throw new Error(data.error || 'שגיאה לא ידועה');
        }

        showAIToast(`שלב עודכן ל"${STAGES[newStage]?.label}"`, 'success');
    } catch (error) {
        // Revert optimistic update
        client.stage = previousStage;
        updateClientStageInPlace(reportId, previousStage);
        recalculateStats();
        showAIToast('שגיאה בעדכון שלב: ' + error.message, 'danger');
    }
}

function updateClientStageInPlace(reportId, newStage) {
    const badge = document.getElementById(`stage-badge-${reportId}`);
    if (!badge) return;

    const stage = STAGES[newStage] || { label: newStage, icon: 'help-circle', class: '' };

    badge.className = `stage-badge ${stage.class} clickable`;
    badge.setAttribute('onclick', `openStageDropdown(event, '${escapeAttr(reportId)}', '${escapeAttr(newStage)}')`);
    badge.innerHTML = `<i data-lucide="${stage.icon}" class="icon-sm"></i> ${stage.label} <span class="stage-caret">&#x25BE;</span>`;

    safeCreateIcons();
}

function recalculateStats() {
    const counts = { total: 0, stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0, stage6: 0, stage7: 0, stage8: 0 };

    for (const client of clientsData) {
        if (!client.filing_type) console.warn('Missing filing_type for record', client.id || client.report_id);
        if ((client.filing_type || 'annual_report') !== activeEntityTab) continue;
        if (client.is_active === false) continue; // Skip deactivated clients in stats
        counts.total++;
        const num = STAGES[client.stage]?.num;
        if (num) counts['stage' + num]++;
    }

    document.getElementById('stat-total').textContent = counts.total;
    document.getElementById('stat-stage1').textContent = counts.stage1;
    document.getElementById('stat-stage2').textContent = counts.stage2;
    document.getElementById('stat-stage3').textContent = counts.stage3;
    document.getElementById('stat-stage4').textContent = counts.stage4;
    document.getElementById('stat-stage5').textContent = counts.stage5;
    document.getElementById('stat-stage6').textContent = counts.stage6;
    document.getElementById('stat-stage7').textContent = counts.stage7;
    document.getElementById('stat-stage8').textContent = counts.stage8;

    // Stage 3 attention: toggle .needs-attention based on count
    const stage3Card = document.querySelector('.stat-card.stage-3');
    if (stage3Card) {
        stage3Card.classList.toggle('needs-attention', counts.stage3 > 0);
    }
}

function updateImportFilingTypeLabel(type) {
    const label = document.getElementById('importFilingTypeLabel');
    if (!label) return;
    label.textContent = FILING_TYPE_LABELS[type] || type;
    label.className = `ai-filing-type-badge ai-ft-${type}`;
}

function switchEntityTab(type) {
    activeEntityTab = type;
    sessionStorage.setItem('entityTab', type);

    // Update desktop tab active state
    document.querySelectorAll('.entity-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.type === type));

    // Update mobile toggle active state
    document.querySelectorAll('.entity-toggle-btn').forEach(t =>
        t.classList.toggle('active', t.dataset.type === type));

    // Update mobile bar inline label
    const barLabel = document.getElementById('entityBarLabel');
    if (barLabel) barLabel.textContent = type === 'capital_statement' ? 'הצהרות הון' : 'דוחות שנתיים';

    // Update navbar entity toggle (mobile)
    document.querySelectorAll('.entity-nav-btn').forEach(t =>
        t.classList.toggle('active', t.dataset.type === type));

    // Update URL hash
    history.replaceState(null, '', type === 'capital_statement' ? '#capital' : '#annual');

    // Reset bulk selection
    resetClientBulkSelection();

    // Save which tabs were loaded BEFORE invalidating (for reload decision below)
    const wasDashboardLoaded = dashboardLoaded;
    const wasPendingLoaded = pendingClientsLoaded;
    const wasQuestionnaireLoaded = questionnaireLoaded;
    const wasReminderLoaded = reminderLoaded;

    // Invalidate tab caches so they reload with new filing_type
    // DL-238: aiReviewLoaded NOT invalidated — AI Review always shows all filing types
    dashboardLoaded = false; dashboardLoadedAt = 0;
    pendingClientsLoaded = false; pendingClientsLoadedAt = 0;
    questionnaireLoaded = false; questionnaireLoadedAt = 0;
    reminderLoaded = false; reminderLoadedAt = 0;

    // Sync import/add filing type dropdowns + header label
    const manualFT = document.getElementById('manualFilingType');
    const importFT = document.getElementById('importFilingType');
    if (manualFT) manualFT.value = type;
    if (importFT) importFT.value = type;
    updateImportFilingTypeLabel(type);

    // DL-247/DL-250: Reload active tab on entity switch — opacity fade for tabs that fetch data
    const activeContent = document.querySelector('.tab-content.active');
    const activeTab = activeContent?.id?.replace('tab-', '');
    const addRefresh = () => { if (activeContent) activeContent.classList.add('tab-refreshing'); };
    const removeRefresh = () => { if (activeContent) activeContent.classList.remove('tab-refreshing'); };
    if (activeTab === 'send' && wasPendingLoaded) { addRefresh(); loadPendingClients().then(removeRefresh, removeRefresh); }
    else if (activeTab === 'questionnaires' && wasQuestionnaireLoaded) { addRefresh(); loadQuestionnaires().then(removeRefresh, removeRefresh); }
    else if (activeTab === 'reminders' && wasReminderLoaded) { addRefresh(); loadReminders().then(removeRefresh, removeRefresh); }
    // DL-238: AI Review not reloaded on entity tab switch — always shows all
    else if ((activeTab === 'review' || activeTab === 'dashboard') && wasDashboardLoaded) loadDashboard();
}

// Close dropdowns/popovers on Escape; Enter on clickable counts triggers click
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeStageDropdown();
        closeDocsPopover();
        closeAllRowMenus();
    }
    if (e.key === 'Enter' && e.target.classList.contains('clickable-count')) {
        e.target.click();
    }
});

// ==================== DOCS POPOVER ====================

const docsCache = new Map();

function toggleDocsPopover(event, reportId, clientName) {
    event.stopPropagation();
    const popover = document.getElementById('docsPopover');

    // Toggle off if already showing for this report
    if (popover.style.display !== 'none' && popover.dataset.reportId === reportId) {
        closeDocsPopover();
        return;
    }

    popover.dataset.reportId = reportId;

    positionFloating(event.currentTarget, popover);
    popover.style.display = 'block';

    // Show loading or cached content
    if (docsCache.has(reportId)) {
        renderDocsPopover(popover, docsCache.get(reportId), clientName);
    } else {
        popover.innerHTML = '<div class="docs-popover-loading">טוען מסמכים...</div>';
        fetchDocsForPopover(reportId, clientName);
    }

    requestAnimationFrame(() => {
        document.addEventListener('click', _closeDocsPopoverOnClick, { once: true });
    });
}

function _closeDocsPopoverOnClick() {
    closeDocsPopover();
}

function closeDocsPopover() {
    const popover = document.getElementById('docsPopover');
    if (popover) popover.style.display = 'none';
    document.removeEventListener('click', _closeDocsPopoverOnClick);
}

async function fetchDocsForPopover(reportId, clientName) {
    try {
        const response = await fetchWithTimeout(
            `${ENDPOINTS.GET_CLIENT_DOCUMENTS}?report_id=${reportId}&mode=office`,
            { headers: { 'Authorization': `Bearer ${authToken}` } },
            FETCH_TIMEOUTS.quick
        );
        const data = await response.json();
        if (!data.ok) {
            const popover = document.getElementById('docsPopover');
            if (popover.dataset.reportId === reportId) {
                popover.innerHTML = `<div class="docs-popover-loading">${escapeHtml(data.error || 'שגיאה')}</div>`;
            }
            return;
        }
        // Flatten docs from groups[].categories[].docs[]
        const documents = [];
        for (const group of (data.groups || [])) {
            for (const cat of (group.categories || [])) {
                for (const doc of (cat.docs || [])) {
                    documents.push({ ...doc, name: (doc.name || '').replace(/<\/?b>/g, '') });
                }
            }
        }
        docsCache.set(reportId, documents);
        const popover = document.getElementById('docsPopover');
        if (popover.style.display !== 'none' && popover.dataset.reportId === reportId) {
            renderDocsPopover(popover, documents, clientName);
        }
    } catch (err) {
        const popover = document.getElementById('docsPopover');
        if (popover.dataset.reportId === reportId) {
            popover.innerHTML = '<div class="docs-popover-loading">שגיאה בטעינה</div>';
        }
    }
}

function renderDocsPopover(popover, documents, clientName) {
    const STATUS_CONFIG = {
        'Received':        { icon: '✓', iconClass: 'received', label: 'התקבלו' },
        'Required_Missing': { icon: '✗', iconClass: 'missing', label: 'חסרים' },
        'Requires_Fix':    { icon: '⚠', iconClass: 'fix', label: 'לתיקון' },
        'Waived':          { icon: '–', iconClass: 'waived', label: 'הוסרו' }
    };

    // Group by status
    const groups = {};
    for (const doc of documents) {
        const status = doc.status || 'Required_Missing';
        if (!groups[status]) groups[status] = [];
        groups[status].push(doc);
    }

    let html = `<div class="docs-popover-title">${escapeHtml(clientName)} — ${documents.length} מסמכים</div>`;

    // Show missing first, then fix, then received, then waived
    const order = ['Required_Missing', 'Requires_Fix', 'Received', 'Waived'];
    for (const status of order) {
        const docs = groups[status];
        if (!docs || docs.length === 0) continue;
        const cfg = STATUS_CONFIG[status] || { icon: '?', iconClass: 'missing', label: status };

        html += `<div class="docs-popover-group">`;
        html += `<div class="docs-popover-group-label">${cfg.label} (${docs.length})</div>`;
        for (const doc of docs) {
            html += `<div class="docs-popover-item">
                <span class="docs-popover-icon ${cfg.iconClass}">${cfg.icon}</span>
                <span>${escapeHtml(doc.title || doc.name || 'מסמך')}</span>
            </div>`;
        }
        html += `</div>`;
    }

    popover.innerHTML = html;
}

// ==================== REMINDER HISTORY POPOVER ====================

function toggleHistoryPopover(event, reportId) {
    event.stopPropagation();
    const popover = document.getElementById('reminderHistoryPopover');

    if (popover.style.display !== 'none' && popover.dataset.reportId === reportId) {
        closeHistoryPopover();
        return;
    }

    popover.dataset.reportId = reportId;
    positionFloating(event.currentTarget, popover);
    popover.style.display = 'block';

    // DL-111: Read history from already-loaded remindersData (inline JSON field)
    const item = remindersData.find(r => r.report_id === reportId);
    const history = (item && Array.isArray(item.history)) ? item.history : [];
    renderHistoryPopover(popover, history);

    requestAnimationFrame(() => {
        document.addEventListener('click', closeHistoryPopover, { once: true });
    });
}

function closeHistoryPopover() {
    const popover = document.getElementById('reminderHistoryPopover');
    if (popover) popover.style.display = 'none';
    document.removeEventListener('click', closeHistoryPopover);
}

function renderHistoryPopover(popover, history) {
    if (!history.length) {
        popover.innerHTML = `
            <div class="docs-popover-title" style="text-align:center;padding:16px;">
                <i data-lucide="clock" style="width:20px;height:20px;margin-bottom:8px;opacity:0.4;"></i>
                <div>לא נשלחו תזכורות</div>
            </div>`;
        safeCreateIcons({ attrs: { class: 'icon-sm' } });
        return;
    }

    const TYPE_LABELS = { A: 'שאלון', B: 'מסמכים' };
    let html = `<div class="docs-popover-title">היסטוריית שליחה (${history.length})</div>`;
    for (const entry of history) {
        const dateStr = entry.sent_at ? formatDateHe(entry.sent_at.split('T')[0]) : '-';
        const typeLabel = TYPE_LABELS[entry.type] || entry.type || '-';
        html += `<div class="docs-popover-item">
            <span class="docs-popover-icon" style="font-size:11px;opacity:0.5;">●</span>
            <span>${dateStr}</span>
            <span style="margin-right:auto;color:var(--text-tertiary);font-size:12px;">${typeLabel}</span>
        </div>`;
    }
    popover.innerHTML = html;
}

// ==================== COPY TO CLIPBOARD ====================

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        showAIToast('הועתק', 'success');
        if (btn) {
            const origHTML = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="check" class="icon-xs"></i>';
            safeCreateIcons();
            setTimeout(() => {
                btn.innerHTML = origHTML;
                safeCreateIcons();
            }, 1500);
        }
    }).catch(() => {
        showAIToast('שגיאה בהעתקה', 'danger');
    });
}

function refreshData() {
    // DL-247: Spin the refresh button while loading
    // Add class to BUTTON (not SVG) — lucide.createIcons() replaces SVG nodes
    const btn = document.querySelector('[onclick="refreshData()"]');
    if (btn) btn.classList.add('is-refreshing');
    const stopSpin = () => { if (btn) btn.classList.remove('is-refreshing'); };

    // Force fresh fetch by resetting staleness timestamps
    const activeTab = document.querySelector('.tab-content.active')?.id?.replace('tab-', '');
    let promise;
    if (activeTab === 'reminders') {
        reminderLoadedAt = 0;
        promise = loadReminders();
    } else if (activeTab === 'ai-review') {
        aiReviewLoadedAt = 0;
        promise = loadAIClassifications();
    } else if (activeTab === 'send') {
        pendingClientsLoadedAt = 0;
        promise = loadPendingClients();
    } else if (activeTab === 'questionnaires') {
        questionnaireLoadedAt = 0;
        promise = loadQuestionnaires();
    } else {
        dashboardLoadedAt = 0;
        promise = loadDashboard();
    }
    if (promise) promise.then(stopSpin, stopSpin);
}

// ==================== BACKGROUND REFRESH (DL-175) ====================

let bgRefreshInterval = null;

function startBackgroundRefresh() {
    if (bgRefreshInterval) return;
    bgRefreshInterval = setInterval(() => {
        const activeTab = document.querySelector('.tab-content.active')?.id?.replace('tab-', '');
        if (activeTab === 'dashboard' || activeTab === 'review') { dashboardLoadedAt = 0; loadDashboard(true); }
        else if (activeTab === 'send') { pendingClientsLoadedAt = 0; loadPendingClients(true); }
        else if (activeTab === 'ai-review') { aiReviewLoadedAt = 0; loadAIClassifications(true); }
        else if (activeTab === 'reminders') { reminderLoadedAt = 0; loadReminders(true); }
        else if (activeTab === 'questionnaires') { questionnaireLoadedAt = 0; loadQuestionnaires(true); }
    }, 300_000);
}

function stopBackgroundRefresh() {
    clearInterval(bgRefreshInterval);
    bgRefreshInterval = null;
}

let lastVisibilityRefresh = 0;

document.addEventListener('visibilitychange', () => {
    if (!authToken) return; // Not logged in
    if (document.hidden) {
        stopBackgroundRefresh();
    } else {
        // Debounce: skip refresh if last one was < 5min ago (prevents OS-triggered visibility spam)
        const now = Date.now();
        if (now - lastVisibilityRefresh >= 300_000) {
            lastVisibilityRefresh = now;
            // Silently refresh active tab on return — reset timestamps to force SWR refresh
            const activeTab = document.querySelector('.tab-content.active')?.id?.replace('tab-', '');
            if (activeTab === 'dashboard' || activeTab === 'review') { dashboardLoadedAt = 0; loadDashboard(true); }
            else if (activeTab === 'send') { pendingClientsLoadedAt = 0; loadPendingClients(true); }
            else if (activeTab === 'ai-review') { aiReviewLoadedAt = 0; loadAIClassifications(true); }
            else if (activeTab === 'reminders') { reminderLoadedAt = 0; loadReminders(true); }
            else if (activeTab === 'questionnaires') { questionnaireLoadedAt = 0; loadQuestionnaires(true); }
        }
        startBackgroundRefresh();
    }
});

// Load AI review pending count for tab badge
async function loadAIReviewCount() {
    const badge = document.getElementById('aiReviewTabBadge');
    try {
        const resp = await deduplicatedFetch(`${ENDPOINTS.GET_PENDING_CLASSIFICATIONS}?filing_type=all`, { headers: { 'Authorization': `Bearer ${authToken}` } }, FETCH_TIMEOUTS.slow); // DL-254: must match loadAIClassifications timeout (shared via dedup)
        const data = await resp.json();
        badge.classList.remove('ai-badge-loading');
        if (data.ok && data.items) {
            const pending = data.items.filter(i => (i.review_status || 'pending') === 'pending');
            const uniqueClients = new Set(pending.map(i => i.client_id).filter(Boolean)).size;
            syncAIBadge(badge, uniqueClients);
        } else {
            syncAIBadge(badge, 0);
        }
    } catch (e) {
        // Fetch failed - hide the loading badge
        badge.classList.remove('ai-badge-loading');
        badge.style.display = 'none';
    }
}

// ==================== IMPORT ====================

// Drag and drop
const uploadZone = document.getElementById('uploadZone');

if (uploadZone) {
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) processFile(file);
    });
}


function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) processFile(file);
}

function downloadImportTemplate() {
    const csvContent = 'name,email,cc_email\nמשה כהן,moshe@example.com,sara@example.com\nשרה לוי,sara@example.com,';
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function processFile(file) {
    showLoading('קורא קובץ...');

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            hideLoading();
            processImportData(jsonData);
        } catch (error) {
            hideLoading();
            showModal('error', 'שגיאה', 'לא ניתן לקרוא את הקובץ. וודא שזהו קובץ Excel תקין.');
        }
    };
    reader.readAsArrayBuffer(file);
}

function processImportData(data) {
    importData = [];
    let validCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const name = String(row.name || row['שם'] || '').trim();
        const email = String(row.email || row['אימייל'] || row['מייל'] || '').trim().toLowerCase();
        const cc_email = String(row.cc_email || row['אימייל בן/בת זוג'] || '').trim().toLowerCase();

        let status = 'valid';
        let statusText = 'תקין';

        if (!name || !email) {
            status = 'error';
            statusText = 'חסר שם או אימייל';
            errorCount++;
        } else if (!isValidEmail(email)) {
            status = 'error';
            statusText = 'אימייל לא תקין';
            errorCount++;
        } else if (existingEmails.has(email)) {
            status = 'duplicate';
            statusText = 'קיים במערכת';
            duplicateCount++;
        } else {
            validCount++;
        }

        importData.push({ name, email, cc_email, status, statusText });
    }

    // Update preview stats
    document.getElementById('preview-total').textContent = importData.length;
    document.getElementById('preview-valid').textContent = validCount;
    document.getElementById('preview-errors').textContent = errorCount;
    document.getElementById('preview-duplicates').textContent = duplicateCount;
    document.getElementById('importCount').textContent = validCount;

    // Render preview table
    const tbody = document.getElementById('previewTableBody');
    tbody.innerHTML = importData.map((row, idx) => `
        <tr class="${row.status}">
            <td>${idx + 1}</td>
            <td>${escapeHtml(row.name) || '<em style="color:#999">חסר</em>'}</td>
            <td>${escapeHtml(row.email) || '<em style="color:#999">חסר</em>'}</td>
            <td>${escapeHtml(row.cc_email) || ''}</td>
            <td><span class="status-badge ${row.status}">${row.statusText}</span></td>
        </tr>
    `).join('');

    // Show preview section
    document.getElementById('previewSection').classList.add('visible');
    document.getElementById('importBtn').disabled = validCount === 0;
}

function clearPreview() {
    importData = [];
    document.getElementById('previewSection').classList.remove('visible');
    document.getElementById('fileInput').value = '';
}

async function performServerImport(clients, year, successMessage, options) {
    showLoading(clients.length > 1 ? `מייבא ${clients.length} לקוחות...` : 'מוסיף לקוח...', FETCH_TIMEOUTS.batch + 5000);
    const filingType = options?.filing_type || activeEntityTab;

    try {

        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_BULK_IMPORT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                year: parseInt(year),
                clients: clients,
                filing_type: filingType
            })
        }, FETCH_TIMEOUTS.batch);

        const data = await response.json();

        hideLoading();

        if (!data.ok) {
            throw new Error(data.error || 'Import failed');
        }

        if (!options?.suppressModal) {
            showModal('success', 'הפעולה הושלמה!',
                successMessage || `הנתונים נשמרו בהצלחה.`,
                { created: data.created, skipped: data.skipped, failed: data.failed }
            );
        }

        return data;

    } catch (error) {
        hideLoading();
        const isTimeout = error.name === 'TimeoutError' || error.message?.includes('timed out') || error.message?.includes('aborted');
        if (isTimeout) {
            showModal('warning', 'תם הזמן',
                'הבקשה עדיין רצה ברקע — ייתכן שהלקוחות נוספו בהצלחה. רענן את הדף ובדוק לפני שתנסה שוב.');
        } else {
            showModal('error', 'שגיאה', 'שגיאה בשמירת הנתונים: ' + error.message);
        }
        return null;
    }
}

async function startImport() {
    const validClients = importData.filter(c => c.status === 'valid');
    if (validClients.length === 0) return;

    const year = document.getElementById('importYear').value;
    const filingType = document.getElementById('importFilingType').value;

    const success = await performServerImport(
        validClients.map(c => ({ name: c.name, email: c.email, cc_email: c.cc_email || '' })),
        year,
        'הלקוחות נוספו בהצלחה למערכת.',
        { filing_type: filingType }
    );

    if (success) {
        clearPreview();
        loadDashboard();
    }
}

function setAddMode(mode) {
    document.getElementById('section-import').style.display = mode === 'import' ? 'block' : 'none';
    document.getElementById('section-manual').style.display = mode === 'manual' ? 'block' : 'none';

    const btnImport = document.getElementById('btn-mode-import');
    const btnManual = document.getElementById('btn-mode-manual');

    if (mode === 'import') {
        btnImport.className = 'btn btn-primary';
        btnImport.disabled = true;
        btnManual.className = 'btn btn-secondary';
        btnManual.disabled = false;
    } else {
        btnImport.className = 'btn btn-secondary';
        btnImport.disabled = false;
        btnManual.className = 'btn btn-primary';
        btnManual.disabled = true;
    }

    safeCreateIcons();
}

async function addManualClient() {
    const name = document.getElementById('manualName').value.trim();
    const email = document.getElementById('manualEmail').value.trim().toLowerCase();
    const cc_email = document.getElementById('manualCcEmail').value.trim().toLowerCase();
    const year = document.getElementById('manualYear').value;
    const filingType = document.getElementById('manualFilingType').value;

    if (!name || !email) {
        showModal('warning', 'חסרים נתונים', 'נא להזין שם ואימייל');
        return;
    }
    if (!isValidEmail(email)) {
        showModal('warning', 'אימייל לא תקין', 'כתובת האימייל אינה תקינה');
        return;
    }
    // Block only if same email + filing type already exists
    const hasSameTypeReport = clientsData.some(c =>
        c.email?.toLowerCase() === email && c.filing_type === filingType
    );
    if (hasSameTypeReport) {
        showModal('warning', 'דוח קיים', 'ללקוח זה כבר קיים דוח מאותו סוג.');
        return;
    }

    await _doManualAdd(name, email, cc_email, year, filingType);
}

async function _doManualAdd(name, email, cc_email, year, filingType) {
    const data = await performServerImport(
        [{ name, email, cc_email }],
        year,
        null,
        { suppressModal: true, filing_type: filingType }
    );

    if (data) {
        document.getElementById('manualName').value = '';
        document.getElementById('manualEmail').value = '';
        document.getElementById('manualCcEmail').value = '';
        dismissExistingBanner();
        document.querySelectorAll('.field-prefilled').forEach(el => el.classList.remove('field-prefilled'));

        const reportId = data.report_ids?.[0];
        if (reportId) {
            showAIToast('הלקוח נוסף בהצלחה', 'success', {
                label: 'שלח שאלון',
                onClick: () => sendQuestionnaires([reportId])
            });
        } else {
            showAIToast('הלקוח נוסף בהצלחה', 'success');
        }

        loadDashboard();
    }
}

// ==================== EXISTING CLIENT BANNER (DL-228) ====================

function onEmailBlur() {
    const email = (document.getElementById('manualEmail')?.value || '').toLowerCase().trim();
    if (!email) { dismissExistingBanner(); return; }

    const year = document.getElementById('manualYear')?.value || String(new Date().getFullYear());

    const matches = clientsData.filter(c =>
        c.email?.toLowerCase() === email &&
        String(c.year) === String(year) &&
        c.is_active !== false
    );

    if (!matches.length) { dismissExistingBanner(); return; }

    const types = new Set(matches.map(c => c.filing_type || 'annual_report'));

    let otherType = null;
    if (types.has('annual_report') && !types.has('capital_statement')) otherType = 'capital_statement';
    else if (types.has('capital_statement') && !types.has('annual_report')) otherType = 'annual_report';

    if (!otherType) { dismissExistingBanner(); return; }

    const client = matches[0];
    const existingType = types.has('annual_report') ? 'annual_report' : 'capital_statement';
    const existingLabel = FILING_TYPE_LABELS[existingType] || existingType;
    const otherLabel = FILING_TYPE_LABELS[otherType] || otherType;
    const stageLabel = STAGES[client.stage]?.label || client.stage || '';
    const ccLine = client.cc_email
        ? `<div class="banner-detail">CC: ${escapeHtml(client.cc_email)}</div>`
        : '';

    const banner = document.getElementById('existingClientBanner');
    if (!banner) return;

    banner.innerHTML = `
        <div class="banner-title">ℹ️ לקוח קיים: ${escapeHtml(client.name || email)}</div>
        <div class="banner-detail">${escapeHtml(existingLabel)} ${escapeHtml(String(year))} — ${escapeHtml(stageLabel)}</div>
        ${ccLine}
        <div class="banner-actions">
            <button class="btn-fill" onclick="fillFromExisting('${escapeHtml(email)}')">מלא פרטים ← ${escapeHtml(otherLabel)}</button>
            <button class="btn-dismiss" onclick="dismissExistingBanner()">✕</button>
        </div>
    `;

    requestAnimationFrame(() => banner.classList.add('visible'));
}

function fillFromExisting(email) {
    const normalEmail = email.toLowerCase();
    const client = clientsData.find(c => c.email?.toLowerCase() === normalEmail && c.is_active !== false);
    if (!client) { dismissExistingBanner(); return; }

    const nameEl = document.getElementById('manualName');
    const ccEl = document.getElementById('manualCcEmail');
    const filingTypeEl = document.getElementById('manualFilingType');

    if (nameEl) {
        nameEl.value = client.name || '';
        if (client.name) nameEl.classList.add('field-prefilled');
    }
    if (ccEl) {
        ccEl.value = client.cc_email || '';
        if (client.cc_email) ccEl.classList.add('field-prefilled');
    }
    if (filingTypeEl) {
        const year = document.getElementById('manualYear')?.value;
        const otherType = getClientOtherFilingType(email, year);
        if (otherType) filingTypeEl.value = otherType;
    }

    dismissExistingBanner();
}

function dismissExistingBanner() {
    const banner = document.getElementById('existingClientBanner');
    if (!banner) return;
    banner.classList.remove('visible');
    setTimeout(() => { banner.innerHTML = ''; }, 200);
}

async function addSecondFilingType(reportId) {
    const client = clientsData.find(c => c.report_id === reportId);
    if (!client) return;

    const year = String(client.year || document.getElementById('yearFilter')?.value || new Date().getFullYear());
    const otherType = getClientOtherFilingType(client.email, year);
    if (!otherType) {
        showModal('warning', 'דוח קיים', 'ללקוח זה כבר קיימים שני סוגי דוחות.');
        return;
    }

    const otherLabel = FILING_TYPE_LABELS[otherType] || otherType;
    showConfirmDialog(
        `להוסיף ${otherLabel} ללקוח ${client.name || client.email}?`,
        async () => {
            await _doManualAdd(client.name, client.email, client.cc_email || '', year, otherType);
        },
        `הוסף ${otherLabel}`
    );
}

// ==================== SEND QUESTIONNAIRES ====================

let pendingClients = [];

async function loadPendingClients(silent = false) {
    if (!authToken) return;
    // DL-247: SWR — skip if fresh, otherwise fetch silently
    const isFresh = pendingClientsLoaded && (Date.now() - pendingClientsLoadedAt < STALE_AFTER_MS);
    if (silent && isFresh) return;



    try {
        const year = document.getElementById('sendYearFilter').value;
        const response = await deduplicatedFetch(`${ENDPOINTS.ADMIN_PENDING}?year=${year}&filing_type=${activeEntityTab}`, { headers: { 'Authorization': `Bearer ${authToken}` } }, FETCH_TIMEOUTS.load);
        const data = await response.json();



        if (!data.ok) throw new Error(data.error);

        pendingClients = data.clients || [];
        pendingClientsLoaded = true;
        pendingClientsLoadedAt = Date.now();
        renderPendingClients();

    } catch (error) {

        if (!silent) showModal('error', 'שגיאה', 'לא ניתן לטעון את הרשימה');
    }
}

function renderPendingClients() {
    const container = document.getElementById('pendingClientsContainer');

    // Filter out archived clients
    pendingClients = pendingClients.filter(c => c.is_active !== false);

    if (pendingClients.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="circle-check" class="icon-2xl"></i></div>
                <p>אין לקוחות ממתינים לשליחת שאלון</p>
            </div>
        `;
        document.getElementById('sendActions').style.display = 'none';
        safeCreateIcons();
        return;
    }

    let html = `
        <div class="table-scroll-container" role="region" aria-label="לקוחות ממתינים לשליחה" tabindex="0">
        <table>
            <thead>
                <tr>
                    <th><input type="checkbox" id="selectAll" onchange="toggleSelectAll()"></th>
                    <th>שם</th>
                    <th>אימייל</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const client of pendingClients) {
        html += `
            <tr>
                <td><input type="checkbox" class="client-checkbox" value="${client.report_id}" onchange="updateSelectedCount()"></td>
                <td>
                    <strong class="client-link" onclick="viewClientDocs('${escapeAttr(client.report_id)}')">
                        ${escapeHtml(client.name)}
                    </strong>
                </td>
                <td>
                    <div class="email-cell">
                        <a href="mailto:${escapeAttr(client.email)}" class="email-link">${escapeHtml(client.email)}</a>
                        <button class="copy-email-btn" onclick="event.stopPropagation(); copyToClipboard('${escapeAttr(client.email)}', this)" title="העתק אימייל"><i data-lucide="copy" class="icon-xs"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }

    html += '</tbody></table>';

    // Mobile card list (DL-214)
    let cards = '<ul class="mobile-card-list" role="list" aria-label="לקוחות ממתינים">';
    for (const client of pendingClients) {
        cards += `<li class="mobile-card">
            <div class="mobile-card-primary">
                <span class="mobile-card-checkbox"><input type="checkbox" class="client-checkbox" value="${client.report_id}" onchange="updateSelectedCount()"></span>
                <div class="mobile-card-info">
                    <span class="mobile-card-name" onclick="viewClientDocs('${escapeAttr(client.report_id)}')">${escapeHtml(client.name)}</span>
                </div>
            </div>
            <div class="mobile-card-secondary">
                <div class="email-cell">
                    <a href="mailto:${escapeAttr(client.email)}" class="email-link">${escapeHtml(client.email)}</a>
                    <button class="copy-email-btn" onclick="event.stopPropagation(); copyToClipboard('${escapeAttr(client.email)}', this)" title="העתק אימייל"><i data-lucide="copy" class="icon-xs"></i></button>
                </div>
            </div>
        </li>`;
    }
    cards += '</ul>';

    html += cards + '</div>';
    container.innerHTML = html;
    document.getElementById('sendActions').style.display = 'block';
    updateSelectedCount();
    safeCreateIcons();
}

const MAX_BULK_SEND = 50;

function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll').checked;
    const cbs = document.querySelectorAll('.client-checkbox');
    if (selectAll) {
        let count = 0;
        cbs.forEach(cb => {
            cb.checked = count < MAX_BULK_SEND;
            count++;
        });
    } else {
        cbs.forEach(cb => cb.checked = false);
    }
    updateSelectedCount();
}

function updateSelectedCount() {
    const selected = document.querySelectorAll('.client-checkbox:checked').length;
    document.getElementById('selectedCount').textContent = selected;
    // Disable unchecked checkboxes when at limit
    document.querySelectorAll('.client-checkbox').forEach(cb => {
        if (!cb.checked) cb.disabled = selected >= MAX_BULK_SEND;
    });
    const sendBar = document.getElementById('sendActions');
    if (selected > 0) {
        sendBar.style.display = '';
        sendBar.classList.add('floating-bulk-bar');
        document.getElementById('pendingClientsContainer').style.paddingBottom = '72px';
    } else {
        sendBar.classList.remove('floating-bulk-bar');
        sendBar.style.display = 'block';
        document.getElementById('pendingClientsContainer').style.paddingBottom = '';
    }
}

async function sendToSelected() {
    const selected = Array.from(document.querySelectorAll('.client-checkbox:checked')).map(cb => cb.value);
    if (selected.length === 0) {
        showModal('warning', 'שגיאה', 'יש לבחור לפחות לקוח אחד');
        return;
    }
    await sendQuestionnaires(selected);
}

async function sendToAll() {
    const reportIds = pendingClients.map(c => c.report_id);
    if (reportIds.length > MAX_BULK_SEND) {
        showModal('warning', 'מגבלת שליחה', `ניתן לשלוח עד ${MAX_BULK_SEND} שאלונים בבת אחת. כרגע יש ${reportIds.length} לקוחות ממתינים.\nיש לבחור לקוחות ספציפיים.`);
        return;
    }
    showConfirmDialog(`האם לשלוח שאלון ל-${reportIds.length} לקוחות?`, async () => {
        await sendQuestionnaires(reportIds);
    }, 'שלח לכולם');
}

async function sendSingle(reportId) {
    await sendQuestionnaires([reportId]);
}

let _sendQuestionnairesLocked = false;

async function sendQuestionnaires(reportIds) {
    if (_sendQuestionnairesLocked) return;
    if (reportIds.length > MAX_BULK_SEND) {
        showModal('warning', 'מגבלת שליחה', `ניתן לשלוח עד ${MAX_BULK_SEND} שאלונים בבת אחת. נבחרו ${reportIds.length}.`);
        return;
    }
    _sendQuestionnairesLocked = true;

    const CHUNK_SIZE = 25;
    const totalCount = reportIds.length;
    const isBulk = totalCount > 1;
    const chunks = [];
    for (let i = 0; i < totalCount; i += CHUNK_SIZE) {
        chunks.push(reportIds.slice(i, i + CHUNK_SIZE));
    }

    // Safety timer scales with chunk count: ~90s per chunk of 25 (each email ~2.5s + overhead)
    const safetyMs = isBulk ? Math.max(95000, chunks.length * 90000) : 25000;

    let totalSent = 0;
    let totalFailed = 0;
    let allErrors = [];

    try {
        showLoading(isBulk ? `שולח שאלונים... (0/${totalCount})` : 'שולח שאלון...', safetyMs);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkTimeout = Math.max(FETCH_TIMEOUTS.batch, chunk.length * 4000);

            if (chunks.length > 1) {
                const progress = i * CHUNK_SIZE;
                showLoading(`שולח שאלונים... (${progress}/${totalCount})`);
            }

            const response = await fetchWithTimeout(ENDPOINTS.ADMIN_SEND_QUESTIONNAIRES, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: authToken, report_ids: chunk })
            }, chunkTimeout);
            const data = await response.json();

            if (data.ok !== undefined) {
                totalSent += data.sent || 0;
                totalFailed += data.failed || 0;
                if (data.errors) allErrors.push(...data.errors);
            } else {
                // Whole chunk failed
                totalFailed += chunk.length;
                allErrors.push({ message: data.error || 'Chunk failed' });
            }
        }

        hideLoading();

        if (totalFailed === 0) {
            showModal('success', 'נשלח בהצלחה!', 'השאלונים נשלחו ללקוחות.', { sent: totalSent });
        } else if (totalSent > 0) {
            showModal('warning', 'שליחה חלקית',
                `נשלחו ${totalSent} שאלונים בהצלחה.\n${totalFailed} שאלונים לא נשלחו.`,
                { sent: totalSent, failed: totalFailed });
        } else {
            showModal('error', 'שגיאה', `כל ${totalFailed} השאלונים נכשלו בשליחה.`);
        }

        loadDashboard();
        loadPendingClients(true);
    } catch (err) {
        hideLoading();
        if (totalSent > 0) {
            showModal('warning', 'שליחה חלקית',
                `נשלחו ${totalSent} שאלונים. השליחה הופסקה עקב שגיאה.`,
                { sent: totalSent, failed: totalCount - totalSent });
            loadDashboard();
            loadPendingClients(true);
        } else {
            showModal('error', 'שגיאה', 'שליחת השאלונים נכשלה. נסו שוב.');
        }
    } finally {
        _sendQuestionnairesLocked = false;
    }
}

// ==================== REVIEW QUEUE ====================

function renderReviewTable(queue) {
    const container = document.getElementById('reviewTableContainer');

    // Filter out archived clients
    if (queue) queue = queue.filter(c => c.is_active !== false);

    if (!queue || queue.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="inbox" class="icon-2xl"></i></div>
                <p>אין לקוחות מוכנים להכנה כרגע</p>
            </div>
        `;
        safeCreateIcons();
        return;
    }

    const now = new Date();

    let html = `
        <div class="table-scroll-container" role="region" aria-label="תור בדיקה" tabindex="0">
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>שם</th>
                    <th>אימייל</th>
                    <th>שנה</th>
                    <th>מסמכים</th>
                    <th>תאריך השלמה</th>
                    <th>ממתין</th>
                    <th>פעולות</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (let i = 0; i < queue.length; i++) {
        const client = queue[i];
        const completedAt = new Date(client.docs_completed_at);
        const diffMs = now - completedAt;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        let waitingClass = '';
        if (diffDays >= 14) waitingClass = 'waiting-urgent';
        else if (diffDays >= 7) waitingClass = 'waiting-warn';

        const waitingText = diffDays === 0 ? 'היום' : diffDays === 1 ? 'יום אחד' : `${diffDays} ימים`;
        const dateStr = completedAt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

        html += `
            <tr>
                <td><span class="fifo-number">${i + 1}</span></td>
                <td>
                    <strong
                        class="client-link"
                        onclick="viewClientDocs('${escapeAttr(client.report_id)}')"
                    >
                        ${escapeHtml(client.name)}
                    </strong>
                </td>
                <td>
                    <div class="email-cell">
                        <a href="mailto:${escapeAttr(client.email)}" class="email-link">${escapeHtml(client.email)}</a>
                        <button class="copy-email-btn" onclick="event.stopPropagation(); copyToClipboard('${escapeAttr(client.email)}', this)" title="העתק אימייל"><i data-lucide="copy" class="icon-xs"></i></button>
                    </div>
                </td>
                <td>${client.year}</td>
                <td><span class="docs-count clickable-count" onclick="toggleDocsPopover(event, '${escapeOnclick(client.report_id)}', '${escapeOnclick(client.name)}')" tabindex="0" role="button" title="לחץ לצפייה במסמכים">${client.docs_received}/${client.docs_total}</span></td>
                <td>${dateStr}</td>
                <td><span class="waiting-badge ${waitingClass}">${waitingText}</span></td>
                <td>
                    <button class="action-btn view" onclick="viewClient('${escapeAttr(client.report_id)}')" title="צפה בתיק"><i data-lucide="eye" class="icon-sm"></i></button>
                    <button class="action-btn complete" onclick="markComplete('${escapeOnclick(client.report_id)}', '${escapeOnclick(client.name)}')" title="סמן כהושלם"><i data-lucide="circle-check" class="icon-sm"></i></button>
                </td>
            </tr>
        `;
    }

    html += '</tbody></table>';

    // Mobile card list (DL-214)
    const nowCards = new Date();
    let cards = '<ul class="mobile-card-list" role="list" aria-label="תור בדיקה">';
    for (let i = 0; i < queue.length; i++) {
        const client = queue[i];
        const completedAt = new Date(client.docs_completed_at);
        const diffMs = nowCards - completedAt;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        let waitingClass = '';
        if (diffDays >= 14) waitingClass = 'waiting-urgent';
        else if (diffDays >= 7) waitingClass = 'waiting-warn';
        const waitingText = diffDays === 0 ? 'היום' : diffDays === 1 ? 'יום אחד' : `${diffDays} ימים`;
        const dateStr = completedAt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

        cards += `<li class="mobile-card">
            <div class="mobile-card-primary">
                <span class="fifo-number">${i + 1}</span>
                <div class="mobile-card-info">
                    <span class="mobile-card-name" onclick="viewClientDocs('${escapeAttr(client.report_id)}')">${escapeHtml(client.name)}</span>
                    <span class="waiting-badge ${waitingClass}">${waitingText}</span>
                </div>
            </div>
            <div class="mobile-card-secondary">
                <span class="mobile-card-detail"><span class="label">שנה</span> ${client.year}</span>
                <span class="mobile-card-detail"><span class="label">מסמכים</span> <span class="docs-count clickable-count" onclick="toggleDocsPopover(event, '${escapeOnclick(client.report_id)}', '${escapeOnclick(client.name)}')">${client.docs_received}/${client.docs_total}</span></span>
                <span class="mobile-card-detail"><span class="label">השלמה</span> ${dateStr}</span>
                <div class="email-cell">
                    <a href="mailto:${escapeAttr(client.email)}" class="email-link">${escapeHtml(client.email)}</a>
                    <button class="copy-email-btn" onclick="event.stopPropagation(); copyToClipboard('${escapeAttr(client.email)}', this)" title="העתק אימייל"><i data-lucide="copy" class="icon-xs"></i></button>
                </div>
            </div>
            <div class="mobile-card-actions">
                <button class="action-btn view" onclick="viewClient('${escapeAttr(client.report_id)}')" title="צפה בתיק"><i data-lucide="eye" class="icon-sm"></i></button>
                <button class="action-btn complete" onclick="markComplete('${escapeOnclick(client.report_id)}', '${escapeOnclick(client.name)}')" title="סמן כהושלם"><i data-lucide="circle-check" class="icon-sm"></i></button>
            </div>
        </li>`;
    }
    cards += '</ul>';

    html += cards + '</div>';
    container.innerHTML = html;
    safeCreateIcons();
}

let _markCompleteLocked = false;

async function markComplete(reportId, name) {
    if (_markCompleteLocked) return;
    showConfirmDialog(`לסמן את "${name}" כהושלם?`, async () => {
        _markCompleteLocked = true;
        showLoading('מעדכן...');

        try {
            const response = await fetchWithTimeout(ENDPOINTS.ADMIN_MARK_COMPLETE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: authToken,
                    report_id: reportId
                })
            }, FETCH_TIMEOUTS.mutate);

            const data = await response.json();
            hideLoading();

            if (!data.ok) throw new Error(data.error);

            showModal('success', 'הושלם!', `"${name}" סומן כהושלם בהצלחה.`);
            loadDashboard();

        } catch (error) {
            hideLoading();
            showModal('error', 'שגיאה', getErrorMessage(error, 'he'));
        } finally {
            _markCompleteLocked = false;
        }
    }, 'סמן כהושלם');
}

function exportReviewToExcel() {
    reviewQueueData.forEach(c => { if (!c.filing_type) console.warn('Missing filing_type for record', c.id || c.report_id); });
    const filtered = reviewQueueData.filter(c => (c.filing_type || 'annual_report') === activeEntityTab);
    if (!filtered.length) return;

    const now = new Date();
    const exportData = filtered.map((c, i) => {
        const completedAt = new Date(c.docs_completed_at);
        const diffDays = Math.floor((now - completedAt) / (1000 * 60 * 60 * 24));
        return {
            '#': i + 1,
            'שם': c.name,
            'אימייל': c.email,
            'שנה': c.year,
            'מסמכים': `${c.docs_received}/${c.docs_total}`,
            'תאריך השלמה': completedAt.toLocaleDateString('he-IL'),
            'ימי המתנה': diffDays
        };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'מוכנים להכנה');
    XLSX.writeFile(wb, `review_queue_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// ==================== DOC SEARCH COMBOBOX ====================

function createDocCombobox(container, docs, { currentMatchId = null, onSelect = null, allowCreate = false, otherDocs = null, ownFilingType = null, otherFilingType = null } = {}) {
    // DL-239: Track active doc set for filing type toggle
    let activeDocs = docs;

    function groupDocs(docList) {
        const groups = [];
        let currentCat = null;
        for (const doc of docList) {
            if (doc.category !== currentCat) {
                currentCat = doc.category;
                groups.push({ category: doc.category, name: doc.category_name || doc.category, emoji: doc.category_emoji || '', docs: [] });
            }
            groups[groups.length - 1].docs.push(doc);
        }
        return groups;
    }

    // Group docs by category, skip empty categories
    let groups = groupDocs(docs);

    const getDisplayName = (doc) => doc.name_short || doc.name || doc.template_id || '';
    const getPlainName = (doc) => (getDisplayName(doc)).replace(/<\/?b>/g, '');

    container.innerHTML = `
        <div class="doc-combobox">
            <input class="doc-combobox-input" placeholder="\ud83d\udd0d \u05d7\u05e4\u05e9 \u05de\u05e1\u05de\u05da..." autocomplete="off" />
            <div class="doc-combobox-dropdown"></div>
            ${allowCreate ? '<a href="#" class="doc-combobox-back-link" style="display:none">\u2190 \u05d7\u05d6\u05e8\u05d4 \u05dc\u05e8\u05e9\u05d9\u05de\u05d4</a>' : ''}
        </div>
    `;

    const combobox = container.querySelector('.doc-combobox');
    const input = combobox.querySelector('.doc-combobox-input');
    const dropdown = combobox.querySelector('.doc-combobox-dropdown');
    const backLink = combobox.querySelector('.doc-combobox-back-link');
    let selectedValue = null;
    let inCreateMode = false;

    function enterCreateMode() {
        inCreateMode = true;
        input.value = '';
        input.placeholder = '\u05e9\u05dd \u05d4\u05de\u05e1\u05de\u05da \u05d4\u05d7\u05d3\u05e9...';
        input.classList.add('create-mode');
        input.classList.remove('has-value');
        combobox.dataset.selectedValue = '__NEW__';
        combobox.dataset.newDocName = '';
        combobox.dataset.selectedDocId = '';
        selectedValue = '__NEW__';
        close();
        if (backLink) backLink.style.display = '';
        input.focus();
        if (onSelect) onSelect('__NEW__', null);
    }

    function exitCreateMode() {
        inCreateMode = false;
        input.value = '';
        input.placeholder = '\ud83d\udd0d \u05d7\u05e4\u05e9 \u05de\u05e1\u05de\u05da...';
        input.classList.remove('create-mode', 'has-value');
        combobox.dataset.selectedValue = '';
        combobox.dataset.newDocName = '';
        selectedValue = null;
        if (backLink) backLink.style.display = 'none';
        if (onSelect) onSelect(null, null);
    }

    if (backLink) {
        backLink.addEventListener('click', (e) => {
            e.preventDefault();
            exitCreateMode();
        });
    }

    function renderOptions(filter = '') {
        let html = '';
        let hasResults = false;

        // DL-239: Filing type toggle inside dropdown
        if (otherDocs && otherDocs.length > 0 && ownFilingType && otherFilingType) {
            const ownLabel = FILING_TYPE_LABELS[ownFilingType] || ownFilingType;
            const otherLabel = FILING_TYPE_LABELS[otherFilingType] || otherFilingType;
            const isOwnActive = activeDocs === docs;
            html += `<div class="doc-combobox-ft-toggle">
                <button class="doc-combobox-ft-btn${isOwnActive ? ' active' : ''}" data-ft="own">${escapeHtml(ownLabel)}</button>
                <button class="doc-combobox-ft-btn${!isOwnActive ? ' active' : ''}" data-ft="other">${escapeHtml(otherLabel)}</button>
            </div>`;
        }

        if (allowCreate) {
            html += `<div class="doc-combobox-create-btn" data-action="create">+ \u05d4\u05d5\u05e1\u05e3 \u05de\u05e1\u05de\u05da \u05d7\u05d3\u05e9</div>`;
        }

        for (const group of groups) {
            const filtered = group.docs.filter(d =>
                !filter || matchesFilter(d.name, filter) || matchesFilter(getDisplayName(d), filter)
            );
            if (filtered.length === 0) continue;
            hasResults = true;

            html += `<div class="doc-combobox-category">${escapeHtml(group.emoji)} ${escapeHtml(group.name)}</div>`;
            for (const doc of filtered) {
                const isCurrent = currentMatchId && doc.template_id === currentMatchId;
                const isReceived = doc.status === 'Received';
                const cls = (isCurrent ? ' current-match' : '') + (isReceived ? ' doc-received' : '');
                const badge = isCurrent ? `<span class="current-badge">\u25c0 \u05e0\u05d5\u05db\u05d7\u05d9</span>` :
                              isReceived ? `<span class="received-badge">\u2705</span>` : '';
                html += `<div class="doc-combobox-option${cls}" data-value="${escapeAttr(doc.template_id)}" data-doc-id="${escapeAttr(doc.doc_record_id || '')}" data-name="${escapeAttr(getPlainName(doc))}">${renderDocLabel(getDisplayName(doc))}${badge}</div>`;
            }
        }

        if (!hasResults && !allowCreate) {
            html = `<div class="doc-combobox-empty">\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05ea\u05d5\u05e6\u05d0\u05d5\u05ea</div>`;
        } else if (!hasResults && allowCreate) {
            html += `<div class="doc-combobox-empty">\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05ea\u05d5\u05e6\u05d0\u05d5\u05ea \u2014 \u05e0\u05e1\u05d4 \u05dc\u05d4\u05d5\u05e1\u05d9\u05e3 \u05de\u05e1\u05de\u05da \u05d7\u05d3\u05e9</div>`;
        }

        dropdown.innerHTML = html;

        // DL-239: Bind filing type toggle clicks
        dropdown.querySelectorAll('.doc-combobox-ft-btn').forEach(btn => {
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (btn.classList.contains('active')) return;
                activeDocs = btn.dataset.ft === 'own' ? docs : otherDocs;
                groups = groupDocs(activeDocs);
                // Reset selection
                selectedValue = null;
                input.value = '';
                input.classList.remove('has-value');
                combobox.dataset.selectedValue = '';
                combobox.dataset.selectedDocId = '';
                if (onSelect) onSelect(null, null);
                renderOptions(input.value);
                // Keep dropdown open and re-anchor to input
                positionDropdown();
                dropdown.scrollTop = 0;
            });
        });

        // Bind create button click
        const createBtn = dropdown.querySelector('.doc-combobox-create-btn');
        if (createBtn) {
            createBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                enterCreateMode();
            });
        }

        // Bind option clicks
        dropdown.querySelectorAll('.doc-combobox-option').forEach(opt => {
            opt.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectedValue = opt.dataset.value;
                input.value = opt.dataset.name;
                input.classList.add('has-value');
                combobox.dataset.selectedValue = selectedValue;
                combobox.dataset.selectedDocId = opt.dataset.docId || '';
                combobox.dataset.newDocName = '';
                close();
                if (onSelect) onSelect(selectedValue, opt.dataset.docId);
            });
        });
    }

    function matchesFilter(docName, searchText) {
        const name = (docName || '').toLowerCase();
        const words = searchText.toLowerCase().split(/\s+/).filter(Boolean);
        return words.every(w => name.includes(w));
    }

    function positionDropdown() {
        const rect = input.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - 10;
        const spaceAbove = rect.top - 10;
        const dropHeight = Math.min(280, Math.max(spaceBelow, spaceAbove));

        if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
            dropdown.style.top = rect.bottom + 4 + 'px';
        } else {
            dropdown.style.top = (rect.top - dropHeight - 4) + 'px';
        }
        dropdown.style.right = (window.innerWidth - rect.right) + 'px';
        dropdown.style.maxHeight = dropHeight + 'px';
    }

    // DL-239: Re-anchor fixed-position dropdown on scroll/resize while open
    let scrollHandler = null;
    function open() {
        if (inCreateMode) return;
        combobox.classList.add('open');
        positionDropdown();
        renderOptions(input.classList.contains('has-value') ? '' : input.value);
        if (!scrollHandler) {
            scrollHandler = () => {
                if (combobox.classList.contains('open')) positionDropdown();
            };
            window.addEventListener('scroll', scrollHandler, true);
            window.addEventListener('resize', scrollHandler);
        }
    }

    function close() {
        combobox.classList.remove('open');
        if (scrollHandler) {
            window.removeEventListener('scroll', scrollHandler, true);
            window.removeEventListener('resize', scrollHandler);
            scrollHandler = null;
        }
    }

    input.addEventListener('focus', open);
    // DL-239: Click already-focused input to toggle close
    input.addEventListener('mousedown', (e) => {
        if (combobox.classList.contains('open') && document.activeElement === input) {
            e.preventDefault();
            close();
            input.blur();
        }
    });
    input.addEventListener('input', () => {
        if (inCreateMode) {
            combobox.dataset.newDocName = input.value;
            combobox.dataset.selectedValue = input.value.trim() ? '__NEW__' : '';
            selectedValue = input.value.trim() ? '__NEW__' : null;
            if (onSelect) onSelect(input.value.trim() ? '__NEW__' : null, null);
            return;
        }
        input.classList.remove('has-value');
        selectedValue = null;
        combobox.dataset.selectedValue = '';
        if (onSelect) onSelect(null, null);
        positionDropdown();
        renderOptions(input.value);
    });

    // Close on blur (with delay so mousedown on option fires first)
    input.addEventListener('blur', () => {
        setTimeout(close, 150);
    });

    // Close on Escape
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { close(); input.blur(); }
    });

    return {
        getValue: () => selectedValue,
        isCreateMode: () => inCreateMode,
        getNewDocName: () => inCreateMode ? (combobox.dataset.newDocName || '') : '',
        setValue: (val) => {
            if (inCreateMode) exitCreateMode();
            const doc = docs.find(d => d.template_id === val);
            if (doc) {
                selectedValue = val;
                input.value = getDisplayName(doc) || val;
                input.classList.add('has-value');
                combobox.dataset.selectedValue = val;
            }
        },
        clear: () => {
            if (inCreateMode) exitCreateMode();
            selectedValue = null;
            input.value = '';
            input.classList.remove('has-value');
            combobox.dataset.selectedValue = '';
        }
    };
}

// ==================== AI REVIEW ====================

let aiClassificationsData = [];
let aiCurrentReassignId = null;
let aiReviewLoaded = false;
let aiReviewLoadedAt = 0;
let activePreviewItemId = null;

const REJECTION_REASONS = {
    image_quality: 'איכות תמונה ירודה',
    wrong_document: 'מסמך לא נכון',
    incomplete: 'מסמך חלקי / חתוך',
    wrong_year: 'שנה לא נכונה',
    wrong_person: 'לא שייך ללקוח',
    not_relevant: 'מסמך לא רלוונטי',
    other: 'אחר'
};

// ---- Document Preview ----

async function getDocPreviewUrl(itemId) {
    const response = await fetchWithTimeout(
        `${ENDPOINTS.GET_PREVIEW_URL}?itemId=${encodeURIComponent(itemId)}`,
        { headers: { 'Authorization': `Bearer ${authToken}` } }, FETCH_TIMEOUTS.load
    );
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Failed to get preview URL');
    return { previewUrl: data.previewUrl, downloadUrl: data.downloadUrl || null };
}

function resetPreviewPanel() {
    activePreviewItemId = null;
    document.querySelectorAll('.ai-review-card.preview-active').forEach(c => c.classList.remove('preview-active'));
    const placeholder = document.getElementById('previewPlaceholder');
    const loading = document.getElementById('previewLoading');
    const error = document.getElementById('previewError');
    const iframe = document.getElementById('previewIframe');
    const header = document.getElementById('previewHeaderBar');
    const download = document.getElementById('previewDownload');
    if (placeholder) placeholder.style.display = '';
    if (loading) loading.style.display = 'none';
    if (error) error.style.display = 'none';
    if (iframe) { iframe.style.display = 'none'; iframe.src = 'about:blank'; }
    if (header) header.style.display = 'none';
    if (download) { download.style.display = 'none'; download.href = '#'; }
}

async function loadDocPreview(recordId) {
    // On mobile, use full-screen modal instead of side panel
    if (window.innerWidth <= 768) {
        loadMobileDocPreview(recordId);
        return;
    }

    // Toggle off if same card clicked
    if (activePreviewItemId === recordId) {
        resetPreviewPanel();
        return;
    }

    const item = aiClassificationsData.find(i => i.id === recordId);
    if (!item) return;

    const placeholder = document.getElementById('previewPlaceholder');
    const loading = document.getElementById('previewLoading');
    const error = document.getElementById('previewError');
    const errorMsg = document.getElementById('previewErrorMsg');
    const iframe = document.getElementById('previewIframe');
    const header = document.getElementById('previewHeaderBar');
    const fileName = document.getElementById('previewFileName');
    const openTab = document.getElementById('previewOpenTab');
    const downloadBtn = document.getElementById('previewDownload');

    // Mark active card
    document.querySelectorAll('.ai-review-card.preview-active').forEach(c => c.classList.remove('preview-active'));
    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (card) card.classList.add('preview-active');
    activePreviewItemId = recordId;

    // No onedrive_item_id — show error
    if (!item.onedrive_item_id) {
        placeholder.style.display = 'none';
        loading.style.display = 'none';
        iframe.style.display = 'none';
        error.style.display = '';
        errorMsg.textContent = 'אין מזהה קובץ — לא ניתן לטעון תצוגה מקדימה';
        header.style.display = 'none';
        return;
    }

    // Show loading — clear old iframe to prevent flash of previous doc
    placeholder.style.display = 'none';
    error.style.display = 'none';
    iframe.src = 'about:blank';
    iframe.style.display = 'none';
    loading.style.display = '';
    downloadBtn.style.display = 'none';

    // Update header
    fileName.textContent = item.attachment_name || 'מסמך';
    openTab.href = item.file_url || '#';
    openTab.style.display = item.file_url ? '' : 'none';
    header.style.display = '';

    try {
        const { previewUrl, downloadUrl } = await getDocPreviewUrl(item.onedrive_item_id);
        // Verify still the active card (user might have clicked another)
        if (activePreviewItemId !== recordId) return;
        // Keep spinner until iframe actually loads
        iframe.onload = () => {
            if (activePreviewItemId !== recordId) return;
            loading.style.display = 'none';
            iframe.style.display = '';
        };
        iframe.src = previewUrl;
        if (downloadUrl) {
            downloadBtn.href = downloadUrl;
            downloadBtn.style.display = '';
        }
    } catch (err) {
        console.error('Preview load failed');
        if (activePreviewItemId !== recordId) return;
        loading.style.display = 'none';
        iframe.style.display = 'none';
        error.style.display = '';
        errorMsg.textContent = err.message || 'שגיאה בטעינת תצוגה מקדימה';
    }
}

async function loadAIClassifications(silent = false) {
    if (!authToken) return;
    // DL-247: SWR — skip if fresh, otherwise fetch silently
    const isFresh = aiReviewLoaded && (Date.now() - aiReviewLoadedAt < STALE_AFTER_MS);
    if (silent && isFresh) return;



    try {
        const response = await deduplicatedFetch(`${ENDPOINTS.GET_PENDING_CLASSIFICATIONS}?filing_type=all`, { headers: { 'Authorization': `Bearer ${authToken}` } }, FETCH_TIMEOUTS.slow); // DL-238: unified view
        const data = await response.json();



        if (!data.ok) {
            if (data.error === 'unauthorized') {
                logout();
                return;
            }
            throw new Error(data.error || 'שגיאה בטעינת הנתונים');
        }

        const newItems = data.items || [];

        // Silent refresh: skip re-render if data hasn't changed (prevents accordion collapse)
        if (silent && aiClassificationsData.length > 0) {
            const oldFingerprint = aiClassificationsData.map(i => `${i.id}:${i.review_status || 'pending'}`).sort().join(',');
            const newFingerprint = newItems.map(i => `${i.id}:${i.review_status || 'pending'}`).sort().join(',');
            if (oldFingerprint === newFingerprint) {
                // Data unchanged — just update badge, skip DOM rebuild
                aiReviewLoaded = true;
                aiReviewLoadedAt = Date.now();
                const badge = document.getElementById('aiReviewTabBadge');
                const pendingForBadge = newItems.filter(i => (i.review_status || 'pending') === 'pending');
                const uniqueClients = new Set(pendingForBadge.map(i => i.client_id).filter(Boolean)).size;
                syncAIBadge(badge, uniqueClients);
                return;
            }
        }

        aiClassificationsData = newItems;
        aiReviewLoaded = true;
        aiReviewLoadedAt = Date.now();
        resetPreviewPanel();

        updateAIStats(data.stats || {});
        applyAIFilters();

        // Update tab badge — show unique client count (not doc count)
        const badge = document.getElementById('aiReviewTabBadge');
        const pendingForBadge = newItems.filter(i => (i.review_status || 'pending') === 'pending');
        const uniqueClients = new Set(pendingForBadge.map(i => i.client_id).filter(Boolean)).size;
        syncAIBadge(badge, uniqueClients);
    } catch (error) {

        console.error('AI review load failed', error);
        if (!silent) {
            const container = document.getElementById('aiCardsContainer');
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i data-lucide="alert-triangle" class="icon-2xl"></i></div>
                    <p style="color: var(--danger-500);">לא ניתן לטעון את הסיווגים. נסה שוב.</p>
                    <button class="btn btn-secondary mt-4" onclick="loadAIClassifications()">
                        <i data-lucide="refresh-cw" class="icon-sm"></i> נסה שוב
                    </button>
                </div>
            `;
            safeCreateIcons();
        }
    }
}

function updateAIStats(stats) {
    // Stats bar removed — no-op, kept for compatibility
}

let _filteredAI = []; // DL-256: filtered AI items for pagination
function applyAIFilters(keepPage) {
    const searchText = (document.getElementById('aiSearchInput').value || '').trim().toLowerCase();
    const confidenceFilter = document.getElementById('aiConfidenceFilter')?.value || '';
    const typeFilter = document.getElementById('aiTypeFilter')?.value || '';
    const reviewStatusFilter = document.getElementById('aiReviewStatusFilter')?.value || '';

    let filtered = aiClassificationsData.filter(item => item.client_is_active !== false);

    if (searchText) {
        filtered = filtered.filter(item =>
            (item.client_name || '').toLowerCase().includes(searchText)
        );
    }

    if (confidenceFilter) {
        filtered = filtered.filter(item => {
            const conf = item.ai_confidence || 0;
            if (confidenceFilter === 'high') return conf >= 0.85;
            if (confidenceFilter === 'medium') return conf >= 0.50 && conf < 0.85;
            if (confidenceFilter === 'low') return conf < 0.50;
            return true;
        });
    }

    if (typeFilter) {
        filtered = filtered.filter(item => {
            if (typeFilter === 'matched') return !!item.matched_template_id;
            if (typeFilter === 'unmatched') return !item.matched_template_id;
            return true;
        });
    }

    // DL-086: Review status filter
    if (reviewStatusFilter) {
        filtered = filtered.filter(item => {
            const rs = item.review_status || 'pending';
            if (reviewStatusFilter === 'pending') return rs === 'pending';
            if (reviewStatusFilter === 'reviewed') return rs !== 'pending';
            return true;
        });
    }

    _filteredAI = filtered;
    if (!keepPage) _aiPage = 1;

    const pageSlice = _filteredAI.slice((_aiPage - 1) * PAGE_SIZE, _aiPage * PAGE_SIZE);
    renderAICards(pageSlice);
    renderPagination('aiPagination', _filteredAI.length, _aiPage, PAGE_SIZE, goToAIPage);
}

function goToAIPage(page) {
    _aiPage = page;
    applyAIFilters(true);
    document.getElementById('aiCardsContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Client/spouse template pairs — same document type, different person
const RELATED_TEMPLATES = {
    T201: ['T201', 'T202'], T202: ['T201', 'T202'],
    T302: ['T302'],
    T305: ['T305', 'T306'], T306: ['T305', 'T306'],
};

function friendlyAIReason(reason) {
    if (!reason) return '';
    if (reason.startsWith('Classification failed')) return 'קובץ PDF פגום';
    return reason;
}

function getCardState(item) {
    if (!item.matched_template_id) return 'unmatched';
    const q = item.issuer_match_quality;
    if (q === 'mismatch') return 'issuer-mismatch';
    if (q === 'fuzzy') return 'fuzzy';
    return 'full';
}

function toggleMissingDocs(el) {
    el.closest('.ai-missing-docs-group').classList.toggle('open');
}


function handleComparisonRadio(recordId, radioEl) {
    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;
    // Deselect all radios in this card
    card.querySelectorAll('.ai-comparison-radio').forEach(r => r.classList.remove('selected'));
    radioEl.closest('.ai-comparison-radio').classList.add('selected');
    // Enable assign button
    const assignBtn = card.querySelector('.btn-ai-comparison-assign');
    if (assignBtn) assignBtn.disabled = false;
}

function quickAssignSelected(recordId) {
    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;
    const selectedRadio = card.querySelector('.ai-validation-options input[type="radio"]:checked');
    if (!selectedRadio) return;
    const templateId = selectedRadio.dataset.templateId;
    const docRecordId = selectedRadio.dataset.docRecordId || '';
    const docName = selectedRadio.dataset.docName || '';
    quickAssignFromComparison(recordId, templateId, docRecordId, docName);
}

function quickAssignFromComparison(recordId, templateId, docRecordId, docName) {
    showInlineConfirm(recordId, `לשייך ל: ${docName}?`, async () => {
        await submitAIReassign(recordId, templateId, docRecordId, 'משייך...');
    }, { confirmText: 'שייך' });
}

function renderAICards(items) {
    const container = document.getElementById('aiCardsContainer');
    const emptyState = document.getElementById('aiEmptyState');

    // Preserve the single open accordion across re-renders
    const openAccordionClient = container.querySelector('.ai-accordion.open')?.dataset.client || null;

    if (!items || items.length === 0) {
        container.innerHTML = '';
        const sb = document.getElementById('aiSummaryBar');
        if (sb) sb.style.display = 'none';

        if (aiClassificationsData.length === 0) {
            container.style.display = 'none';
            emptyState.style.display = 'block';
        } else {
            container.style.display = 'block';
            emptyState.style.display = 'none';
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i data-lucide="filter-x" class="icon-2xl"></i></div>
                    <p>אין תוצאות לסינון הנוכחי</p>
                </div>
            `;
        }
        safeCreateIcons(container);
        return;
    }

    container.style.display = 'block';
    emptyState.style.display = 'none';

    // Group by client_name
    const groups = {};
    for (const item of items) {
        const clientName = item.client_name || 'לא ידוע';
        if (!groups[clientName]) groups[clientName] = [];
        groups[clientName].push(item);
    }

    // Update summary bar
    const totalPending = items.filter(i => (i.review_status || 'pending') === 'pending').length;
    const clientsWithPending = Object.entries(groups).filter(([, ci]) => ci.some(i => (i.review_status || 'pending') === 'pending')).length;
    const summaryBar = document.getElementById('aiSummaryBar');
    const summaryText = document.getElementById('aiSummaryText');
    if (summaryBar && summaryText) {
        if (totalPending > 0) {
            summaryText.textContent = `${totalPending} מסמכים ממתינים לבדיקה · ${clientsWithPending} לקוחות`;
            summaryBar.style.display = 'block';
        } else {
            summaryBar.style.display = 'none';
        }
    }

    let html = '';

    for (const [clientName, clientItems] of Object.entries(groups)) {
        // Count by card state for accordion badges
        let identifiedCount = 0; // full + fuzzy
        let mismatchCount = 0;   // issuer-mismatch
        let unmatchedCount = 0;  // unmatched
        // DL-086: Count pending vs reviewed
        let pendingCount = 0;
        let reviewedCount = 0;
        let approvedCount = 0;
        let rejectedCount = 0;
        for (const i of clientItems) {
            const rs = i.review_status || 'pending';
            if (rs === 'pending') {
                pendingCount++;
                const s = getCardState(i);
                if (s === 'full' || s === 'fuzzy') identifiedCount++;
                else if (s === 'issuer-mismatch') mismatchCount++;
                else unmatchedCount++;
            } else {
                reviewedCount++;
                if (rs === 'rejected') rejectedCount++;
                else approvedCount++;
            }
        }

        // Build accordion stat badge
        let badgesHtml = '';
        if (pendingCount > 0) {
            badgesHtml = `<span class="ai-accordion-stat-badge badge-matched">${pendingCount} מסמכים ממתינים</span>`;
        }

        // Build document manager link button (icon-only, next to expand arrow)
        const clientId = clientItems[0].client_id;
        const docManagerBtn = clientId
            ? `<a href="../document-manager.html?client_id=${encodeURIComponent(clientId)}"
                 target="_blank" class="ai-doc-manager-link"
                 onclick="event.stopPropagation()" title="לניהול המסמכים">
                 <i data-lucide="folder-open" class="icon-xs"></i>
               </a>`
            : '';

        html += `
            <div class="ai-accordion" data-client="${escapeHtml(clientName)}">
                <div class="ai-accordion-header" onclick="toggleAIAccordion(this)">
                    <div class="ai-accordion-title">
                        <i data-lucide="user" class="icon-sm"></i>
                        ${escapeHtml(clientName)}
                    </div>
                    <div class="ai-accordion-stats">
                        ${badgesHtml}
                    </div>
                    ${docManagerBtn}
                    <span class="ai-accordion-icon">▾</span>
                </div>
                <div class="ai-accordion-body">
        `;

        // DL-199: Client communication notes timeline (in-place expand)
        const clientNotesRaw = clientItems.find(i => i.client_notes)?.client_notes;
        if (clientNotesRaw) {
            let cnArr = [];
            try { cnArr = JSON.parse(clientNotesRaw); if (!Array.isArray(cnArr)) cnArr = []; } catch(e) {}
            if (cnArr.length > 0) {
                const sorted = [...cnArr].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                const renderEntry = n => {
                    const isEmail = n.source === 'email';
                    const iconName = isEmail ? 'mail' : 'pencil';
                    const iconClass = isEmail ? 'cn-icon--email' : 'cn-icon--manual';
                    const rawDate = n.date || '';
                    const dateStr = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/) ? rawDate.replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3-$2-$1') : rawDate;
                    return `<div class="ai-cn-entry">
                        <i data-lucide="${iconName}" class="icon-sm ${iconClass}"></i>
                        <span class="ai-cn-date">${escapeHtml(dateStr)}</span>
                        <span class="ai-cn-summary">${escapeHtml(n.summary)}</span>
                    </div>`;
                };
                const previewHtml = sorted.slice(0, 5).map(renderEntry).join('');
                const hasMore = sorted.length > 5;
                const expandedHtml = hasMore
                    ? `<div class="ai-cn-expanded">${sorted.slice(5).map(renderEntry).join('')}</div>`
                    : '';

                html += `<div class="ai-cn-section">
                    <div class="ai-cn-header">📋 הודעות הלקוח (${cnArr.length})</div>
                    <div class="ai-cn-entries">${previewHtml}${expandedHtml}</div>
                    <span class="ai-cn-toggle" onclick="toggleClientNotes(this)">הצג הכל ▼</span>
                </div>`;
            }
        }

        // Document status overview — grouped by category, collapsible
        const allDocs = (clientItems[0].all_docs || []);
        const groupMissingDocs = (clientItems[0].missing_docs || []);
        const displayDocs = allDocs.length > 0 ? allDocs : groupMissingDocs;
        const docsReceivedCount = clientItems[0].docs_received_count || 0;
        const docsTotalCount = clientItems[0].docs_total_count || displayDocs.length;
        const hasStatusVariation = allDocs.length > 0 && docsReceivedCount > 0;

        if (displayDocs.length > 0) {
            // Group by category
            const catGroups = [];
            let currentCat = null;
            for (const d of displayDocs) {
                const cat = d.category || 'other';
                if (cat !== currentCat) {
                    currentCat = cat;
                    catGroups.push({
                        category: cat,
                        name: d.category_name || cat,
                        emoji: d.category_emoji || '',
                        docs: []
                    });
                }
                catGroups[catGroups.length - 1].docs.push(d);
            }

            let categoriesHtml = '<div class="ai-missing-category-tags">';
            for (const group of catGroups) {
                categoriesHtml += group.docs.map(d => renderDocTag(d)).join('');
            }
            categoriesHtml += '</div>';

            const toggleLabel = hasStatusVariation
                ? `מסמכים נדרשים (${docsReceivedCount}/${docsTotalCount} התקבלו)`
                : `מסמכים חסרים (${groupMissingDocs.length})`;

            html += `
                    <div class="ai-missing-docs-group">
                        <div class="ai-missing-docs-toggle" onclick="toggleMissingDocs(this)">
                            <span class="toggle-arrow">▸</span>
                            ${toggleLabel}
                        </div>
                        <div class="ai-missing-docs-body">
                            ${categoriesHtml}
                        </div>
                    </div>
            `;
        }

        html += `
                    <div class="ai-accordion-content">
        `;

        for (const item of clientItems) {
            html += renderAICard(item);
        }

        html += `
                    </div>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;

    // Restore the single open accordion
    if (openAccordionClient) {
        const el = container.querySelector(`.ai-accordion[data-client="${CSS.escape(openAccordionClient)}"]`);
        if (el) el.classList.add('open');
    }

    // Initialize inline comboboxes (unmatched + mismatch fallback)
    container.querySelectorAll('.doc-combobox-container').forEach(el => {
        const recordId = el.dataset.recordId;
        const itemData = aiClassificationsData.find(i => i.id === recordId);
        // DL-224: Show all docs (not just missing) — received ones get checkmark badge
        const ownDocs = itemData ? (itemData.all_docs || itemData.missing_docs || []) : [];
        const otherDocsArr = itemData?.other_report_docs || [];
        const hasBothTypes = otherDocsArr.length > 0;
        createDocCombobox(el, ownDocs, {
            allowCreate: true,
            onSelect: (templateId) => {
                const btn = el.closest('.ai-card-actions')?.querySelector('.btn-ai-assign-confirm');
                if (btn) btn.disabled = !templateId;
            },
            // DL-239: Pass other filing type docs for toggle
            ...(hasBothTypes ? {
                otherDocs: otherDocsArr,
                ownFilingType: itemData.filing_type || 'annual_report',
                otherFilingType: itemData.other_filing_type || (itemData.filing_type === 'annual_report' ? 'capital_statement' : 'annual_report'),
            } : {}),
        });
    });

    safeCreateIcons(container);

    // DL-210: Show review-done prompt for clients where all items are already reviewed
    for (const [clientName, clientItems] of Object.entries(groups)) {
        const pendingLeft = clientItems.filter(i => (i.review_status || 'pending') === 'pending').length;
        if (pendingLeft === 0 && clientItems.length > 0) {
            showClientReviewDonePrompt(clientName);
        }
    }
}

function renderAICard(item) {
    // DL-086: Check if this item is reviewed (not pending)
    const reviewStatus = item.review_status || 'pending';
    const isReviewed = reviewStatus !== 'pending';

    if (isReviewed) {
        return renderReviewedCard(item, reviewStatus);
    }

    const state = getCardState(item);
    const rawConfidence = item.ai_confidence || 0;
    const confidencePercent = Math.round(rawConfidence * 100);
    const confidenceClass = rawConfidence >= 0.85 ? 'ai-confidence-high' :
                           rawConfidence >= 0.50 ? 'ai-confidence-medium' : 'ai-confidence-low';
    const cardClass = 'match-' + state;

    const receivedAt = item.received_at ? formatAIDate(item.received_at) : '';
    const senderEmail = item.sender_email || '';
    const senderTooltipParts = [senderEmail, receivedAt].filter(Boolean);
    const senderTooltip = senderTooltipParts.join(' | ');

    const missingDocs = item.missing_docs || [];

    const viewFileBtn = `<button class="btn btn-ghost btn-sm ai-preview-btn"
        onclick="event.stopPropagation(); loadDocPreview('${escapeAttr(item.id)}')"
        title="תצוגה מקדימה">
        <i data-lucide="eye" class="icon-sm"></i> תצוגה מקדימה
    </button>`;

    const evidenceIcon = item.ai_reason
        ? `<span class="ai-evidence-trigger" data-tooltip="${escapeAttr(friendlyAIReason(item.ai_reason))}"><i data-lucide="bot" class="icon-sm"></i>?</span>`
        : '';

    let classificationHtml = '';
    let actionsHtml = '';

    if (state === 'full') {
        // State A: Full match — green border, short name from API
        const docDisplayName = item.matched_short_name || item.matched_template_name || 'לא ידוע';
        classificationHtml = `
            <span class="ai-classification-type">
                <span class="ai-confidence-prefix">🤖 AI חושב שזה:</span>
                <span class="ai-template-match">${renderDocLabel(docDisplayName)}</span>
            </span>
        `;
        const approveDisabled = item.is_unrequested;
        actionsHtml = `
            <button class="btn btn-success btn-sm" ${approveDisabled
                ? 'aria-disabled="true" title="לא ניתן לאשר מסמך שלא נדרש — יש לשייך מחדש או לדחות"'
                : `onclick="approveAIClassification('${escapeAttr(item.id)}')"`}>
                <i data-lucide="check" class="icon-sm"></i> נכון
            </button>
            <button class="btn btn-link btn-sm" onclick="showAIReassignModal('${escapeAttr(item.id)}')">
                <i data-lucide="arrow-right-left" class="icon-sm"></i> לא נכון, שייך מחדש
            </button>
            <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                <i data-lucide="x" class="icon-sm"></i> מסמך לא רלוונטי
            </button>
        `;

    } else if (state === 'issuer-mismatch') {
        // State B: Issuer mismatch — amber border, type + badge, issuer info, validation area
        const templateName = item.matched_short_name || item.matched_template_name || item.matched_template_id || '';
        const aiIssuer = item.issuer_name || 'לא ידוע';

        // Filter same-type docs (including client/spouse pairs) from missing_docs
        const relatedIds = RELATED_TEMPLATES[item.matched_template_id] || [item.matched_template_id];
        const sameTypeDocs = missingDocs.filter(d => relatedIds.includes(d.template_id));

        let comparisonHtml;
        if (sameTypeDocs.length > 0) {
            // Card-style radio options
            const radiosHtml = sameTypeDocs.map(d => {
                const docName = d.name_short || d.name || d.template_id;
                const docLabel = d.name_short || d.name_html || d.name || d.template_id;
                return `
                    <label class="ai-comparison-radio">
                        <input type="radio" name="compare_${escapeAttr(item.id)}"
                            data-template-id="${escapeAttr(d.template_id)}"
                            data-doc-record-id="${escapeAttr(d.doc_record_id || '')}"
                            data-doc-name="${escapeAttr(docName.replace(/<\/?b>/g, ''))}"
                            onchange="handleComparisonRadio('${escapeAttr(item.id)}', this)">
                        <span>${renderDocLabel(docLabel)}</span>
                    </label>
                `;
            }).join('');

            comparisonHtml = `
                <div class="ai-validation-area">
                    <div class="ai-validation-title">האם זה אחד מהבאים?</div>
                    <div class="ai-validation-options">
                        ${radiosHtml}
                    </div>
                </div>
            `;

            actionsHtml = `
                <button class="btn btn-success btn-sm btn-ai-comparison-assign" disabled
                    onclick="quickAssignSelected('${escapeAttr(item.id)}')">
                    <i data-lucide="check" class="icon-sm"></i> אישור ושיוך
                </button>
                <button class="btn btn-link btn-sm" onclick="showAIReassignModal('${escapeAttr(item.id)}')">
                    <i data-lucide="arrow-right-left" class="icon-sm"></i> לא מצאתי ברשימה
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                    <i data-lucide="x" class="icon-sm"></i> מסמך לא רלוונטי
                </button>
            `;
        } else {
            // Edge case: no same-type docs in missing — fall back to full combobox
            comparisonHtml = `
                <div class="ai-validation-area">
                    <div class="ai-validation-title">⚠️ כל מסמכי ${renderDocLabel(templateName)} כבר התקבלו</div>
                </div>
            `;
            actionsHtml = `
                <div class="ai-assign-section">
                    <span class="ai-assign-label">שייך ל:</span>
                    <div class="doc-combobox-container" data-record-id="${escapeAttr(item.id)}"></div>
                    <button class="btn btn-success btn-sm btn-ai-assign-confirm" disabled
                        onclick="assignAIUnmatched('${escapeAttr(item.id)}', this)">
                        <i data-lucide="check" class="icon-sm"></i> שייך
                    </button>
                </div>
                <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                    <i data-lucide="x" class="icon-sm"></i> מסמך לא רלוונטי
                </button>
            `;
        }

        classificationHtml = `
            <span class="ai-classification-type">
                <span class="ai-confidence-prefix">🤖 AI חושב שזה:</span>
                <span class="ai-template-match">${renderDocLabel(templateName)}</span>
            </span>
            <div class="ai-issuer-received">🤖 AI חושב שזה התקבל מ: <span class="ai-issuer-value">${escapeHtml(aiIssuer)}</span></div>
            ${comparisonHtml}
        `;

    } else if (state === 'fuzzy') {
        // State C: Fuzzy match — green border, short name from API
        const docDisplayName = item.matched_short_name || item.matched_template_name || 'לא ידוע';
        classificationHtml = `
            <span class="ai-classification-type">
                <span class="ai-confidence-prefix">🤖 AI חושב שזה:</span>
                <span class="ai-template-match">${renderDocLabel(docDisplayName)}</span>
            </span>
        `;
        const fuzzyApproveDisabled = item.is_unrequested;
        actionsHtml = `
            <button class="btn btn-success btn-sm" ${fuzzyApproveDisabled
                ? 'aria-disabled="true" title="לא ניתן לאשר מסמך שלא נדרש — יש לשייך מחדש או לדחות"'
                : `onclick="approveAIClassification('${escapeAttr(item.id)}')"`}>
                <i data-lucide="check" class="icon-sm"></i> נכון
            </button>
            <button class="btn btn-link btn-sm" onclick="showAIReassignModal('${escapeAttr(item.id)}')">
                <i data-lucide="arrow-right-left" class="icon-sm"></i> לא נכון, שייך מחדש
            </button>
            <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                <i data-lucide="x" class="icon-sm"></i> מסמך לא רלוונטי
            </button>
        `;

    } else {
        // State D: Unmatched — amber border, show AI reason inline
        const reasonHtml = item.ai_reason
            ? `<div class="ai-reason-inline">${escapeHtml(friendlyAIReason(item.ai_reason))}</div>`
            : '';
        classificationHtml = `
            <span class="ai-template-unmatched">🤖 לא זוהה</span>
            ${reasonHtml}
        `;
        actionsHtml = `
            <div class="ai-assign-section">
                <span class="ai-assign-label">שייך ל:</span>
                <div class="ai-inline-ft-toggle" data-record-id="${escapeAttr(item.id)}" style="display:none"></div>
                <div class="doc-combobox-container" data-record-id="${escapeAttr(item.id)}"></div>
                <button class="btn btn-success btn-sm btn-ai-assign-confirm" disabled
                    onclick="assignAIUnmatched('${escapeAttr(item.id)}', this)">
                    <i data-lucide="check" class="icon-sm"></i> שייך
                </button>
            </div>
            <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                <i data-lucide="x" class="icon-sm"></i> מסמך לא רלוונטי
            </button>
        `;
    }

    // DL-237: Split banner for multi-page PDFs — own row above actions
    const splitBannerHtml = (item.page_count && item.page_count >= 2) ? `
            <div class="ai-split-banner">
                <button class="btn btn-outline btn-sm ai-split-btn"
                    onclick="event.stopPropagation(); openSplitModal('${escapeAttr(item.id)}')"
                    title="פיצול PDF — ${item.page_count} עמודים">
                    <i data-lucide="scissors" class="icon-sm"></i> פיצול PDF
                </button>
            </div>` : '';

    return `
        <div class="ai-review-card ${cardClass}" data-id="${escapeAttr(item.id)}" ${item.is_unrequested ? 'data-unrequested="true"' : ''}>
            <div class="ai-card-top" onclick="loadDocPreview('${escapeAttr(item.id)}')">
                <div class="ai-file-info">
                    <span class="ai-file-source-label">📎 קובץ מקור:</span>
                    <span class="ai-file-name clickable-preview" ${senderTooltip ? `title="${escapeAttr(senderTooltip)}"` : ''}>${escapeHtml(item.attachment_name || 'ללא שם')}</span>
                    ${item.filing_type ? `<span class="ai-filing-type-badge ai-ft-${escapeAttr(item.filing_type)}">${escapeHtml(FILING_TYPE_LABELS[item.filing_type] || item.filing_type)}</span>` : ''}
                    ${item.is_duplicate ? '<span class="ai-duplicate-badge" title="קובץ כפול — אותו קובץ כבר קיים במערכת">כפול</span>' : ''}
                    ${item.is_unrequested ? '<span class="ai-unrequested-badge" title="מסמך שלא נדרש מהלקוח">לא נדרש</span>' : ''}

                    ${evidenceIcon}
                </div>
                ${viewFileBtn}
            </div>
            <div class="ai-card-body">
                <div class="ai-classification-result">
                    <div class="ai-classification-label">
                        ${classificationHtml}
                    </div>
                </div>
            </div>
            ${splitBannerHtml}
            <div class="ai-card-actions">
                ${actionsHtml}
            </div>
        </div>
    `;
}

// DL-086: Render a card in reviewed (non-pending) state
function renderReviewedCard(item, reviewStatus) {
    const senderEmail = item.sender_email || '';
    const receivedAt = item.received_at ? formatAIDate(item.received_at) : '';
    const senderTooltipParts = [senderEmail, receivedAt].filter(Boolean);
    const senderTooltip = senderTooltipParts.join(' | ');

    const viewFileBtn = `<button class="btn btn-ghost btn-sm ai-preview-btn"
        onclick="event.stopPropagation(); loadDocPreview('${escapeAttr(item.id)}')"
        title="תצוגה מקדימה">
        <i data-lucide="eye" class="icon-sm"></i> תצוגה מקדימה
    </button>`;

    // Status lozenge
    let lozengeClass, lozengeText;
    if (reviewStatus === 'approved') {
        lozengeClass = 'lozenge-approved';
        lozengeText = '\u2713 אושר';
    } else if (reviewStatus === 'rejected') {
        lozengeClass = 'lozenge-rejected';
        lozengeText = '\u26A0 דורש תיקון';
    } else {
        lozengeClass = 'lozenge-reassigned';
        lozengeText = '\u2713 שויך מחדש';
    }

    // Card class for background tint
    const reviewedClass = reviewStatus === 'rejected' ? 'reviewed-rejected' : 'reviewed-approved';

    // Rejection details
    let rejectionHtml = '';
    if (reviewStatus === 'rejected' && item.notes) {
        try {
            const notesData = typeof item.notes === 'string' ? JSON.parse(item.notes) : item.notes;
            const reasonLabel = REJECTION_REASONS[notesData.reason] || notesData.reason || '';
            const notesText = notesData.text || '';
            rejectionHtml = `<div class="ai-reviewed-rejection-info">`;
            if (reasonLabel) rejectionHtml += `<strong>${escapeHtml(reasonLabel)}</strong>`;
            if (notesText) rejectionHtml += `${reasonLabel ? ' — ' : ''}${escapeHtml(notesText)}`;
            rejectionHtml += `</div>`;
        } catch { /* ignore parse errors */ }
    }

    // Classification info — use API-resolved short name
    const displayName = item.matched_short_name || item.matched_template_name || 'לא ידוע';

    // Change Decision button — all reviewed cards can be re-reviewed (reassign safe via onedrive_item_id)
    const canChangeDecision = true;
    const actionsHtml = canChangeDecision
        ? `<button class="ai-change-decision-btn" onclick="startReReview('${escapeAttr(item.id)}')">
               <i data-lucide="rotate-ccw" class="icon-sm"></i> שנה החלטה
           </button>`
        : '';

    return `
        <div class="ai-review-card ${reviewedClass}" data-id="${escapeAttr(item.id)}" data-review-status="${escapeAttr(reviewStatus)}">
            <div class="ai-card-top" onclick="loadDocPreview('${escapeAttr(item.id)}')">
                <div class="ai-file-info">
                    <span class="ai-review-lozenge ${lozengeClass}">${lozengeText}</span>
                    ${item.filing_type ? `<span class="ai-filing-type-badge ai-ft-${escapeAttr(item.filing_type)}">${escapeHtml(FILING_TYPE_LABELS[item.filing_type] || item.filing_type)}</span>` : ''}
                    <span class="ai-file-name clickable-preview" ${senderTooltip ? `title="${escapeAttr(senderTooltip)}"` : ''}>${escapeHtml(item.attachment_name || 'ללא שם')}</span>
                </div>
                ${viewFileBtn}
            </div>
            <div class="ai-card-body">
                <div class="ai-classification-result">
                    <div class="ai-classification-label">
                        <span class="ai-template-match">${renderDocLabel(displayName)}</span>
                    </div>
                </div>
                ${rejectionHtml}
            </div>
            <div class="ai-card-actions">
                ${actionsHtml}
            </div>
        </div>
    `;
}

// DL-086: Re-review — restore action buttons on a reviewed card
function startReReview(recordId) {
    const item = aiClassificationsData.find(i => i.id === recordId);
    if (!item) return;

    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;

    // Restore original action buttons based on card state
    const state = getCardState(item);
    let actionsHtml = '';

    if (state === 'full' || state === 'fuzzy') {
        const approveDisabled = item.is_unrequested;
        actionsHtml = `
            <button class="btn btn-success btn-sm" ${approveDisabled
                ? 'aria-disabled="true" title="לא ניתן לאשר מסמך שלא נדרש — יש לשייך מחדש או לדחות"'
                : `onclick="approveAIClassification('${escapeAttr(recordId)}')"`}>
                <i data-lucide="check" class="icon-sm"></i> נכון
            </button>
            <button class="btn btn-link btn-sm" onclick="showAIReassignModal('${escapeAttr(recordId)}')">
                <i data-lucide="arrow-right-left" class="icon-sm"></i> לא נכון, שייך מחדש
            </button>
            <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(recordId)}')">
                <i data-lucide="x" class="icon-sm"></i> מסמך לא רלוונטי
            </button>
            <button class="btn btn-ghost btn-sm" onclick="cancelReReview('${escapeAttr(recordId)}')">
                ביטול
            </button>
        `;
    } else {
        // unmatched or issuer-mismatch — show reject + reassign
        actionsHtml = `
            <button class="btn btn-link btn-sm" onclick="showAIReassignModal('${escapeAttr(recordId)}')">
                <i data-lucide="arrow-right-left" class="icon-sm"></i> לא נכון, שייך מחדש
            </button>
            <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(recordId)}')">
                <i data-lucide="x" class="icon-sm"></i> מסמך לא רלוונטי
            </button>
            <button class="btn btn-ghost btn-sm" onclick="cancelReReview('${escapeAttr(recordId)}')">
                ביטול
            </button>
        `;
    }

    // Remove reviewed styling
    card.classList.remove('reviewed-approved', 'reviewed-rejected', 'reviewed-reassigned');
    card.style.opacity = '';

    // Replace actions
    const actionsDiv = card.querySelector('.ai-card-actions');
    if (actionsDiv) actionsDiv.innerHTML = actionsHtml;

    safeCreateIcons();
}

// DL-086: Cancel re-review — re-render the card in reviewed state
function cancelReReview(recordId) {
    const item = aiClassificationsData.find(i => i.id === recordId);
    if (!item) return;

    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;

    // Replace the card entirely with the reviewed version
    const tmpDiv = document.createElement('div');
    tmpDiv.innerHTML = renderReviewedCard(item, item.review_status || 'pending');
    const newCard = tmpDiv.firstElementChild;
    card.replaceWith(newCard);
    safeCreateIcons();
}

function toggleAIAccordion(header) {
    const accordion = header.closest('.ai-accordion');
    const isOpen = accordion.classList.contains('open');

    // Close all other accordions — only one open at a time
    accordion.closest('#aiCardsContainer')
        .querySelectorAll('.ai-accordion.open')
        .forEach(el => el.classList.remove('open'));

    // Toggle the clicked one (re-open if it wasn't already open)
    if (!isOpen) accordion.classList.add('open');
}

function toggleClientNotes(toggleEl) {
    const section = toggleEl.closest('.ai-cn-section');
    const expanded = section.querySelector('.ai-cn-expanded');
    const entries = section.querySelector('.ai-cn-entries');
    const isOpen = section.classList.contains('ai-cn-open');
    section.classList.toggle('ai-cn-open', !isOpen);
    if (expanded) expanded.style.display = isOpen ? 'none' : 'block';
    entries.classList.toggle('ai-cn-entries-scroll', !isOpen);
    toggleEl.textContent = isOpen ? 'הצג הכל ▼' : 'הסתר ▲';
}

// AI Review Actions
async function parseAIResponse(response) {
    const text = await response.text();
    if (!text) throw new Error('השרת לא החזיר תשובה — ייתכן שגיאה פנימית. נסה שוב.');
    try {
        const data = JSON.parse(text);
        // DL-070: Surface 409 conflict as a typed response
        if (response.status === 409 && data.conflict) {
            data._conflict = true;
        }
        return data;
    } catch {
        throw new Error('תשובה לא תקינה מהשרת. נסה שוב או בדוק את הלוגים.');
    }
}

function formatAIResponseError(data) {
    if (!data.errors || data.errors.length === 0) return data.error || 'שגיאה לא ידועה';
    return data.errors.map(e => `${e.node}: ${e.message}`).join('\n');
}

function formatAISuccessToast(data) {
    const title = (data.doc_title || '').replace(/<[^>]+>/g, '');
    const parts = [];
    if (data.action === 'approve') parts.push('אושר');
    else if (data.action === 'reject') parts.push('נדחה');
    else if (data.action === 'reassign') parts.push('שויך מחדש');
    if (title) parts.push(`— ${title}`);
    if (data.errors && data.errors.length > 0) parts.push(`⚠ ${data.errors.length} שגיאות`);
    return parts.join(' ');
}

function setCardLoading(recordId, text) {
    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;
    card.classList.add('ai-loading');
    const overlay = document.createElement('div');
    overlay.className = 'ai-card-loading-overlay';
    overlay.innerHTML = `<div class="spinner"></div><span>${text || 'מעבד...'}</span>`;
    card.appendChild(overlay);
}

function clearCardLoading(recordId) {
    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;
    card.classList.remove('ai-loading');
    const overlay = card.querySelector('.ai-card-loading-overlay');
    if (overlay) overlay.remove();
}

async function approveAIClassification(recordId) {
    showInlineConfirm(recordId, 'לאשר את הסיווג?', async () => {
        setCardLoading(recordId, 'מאשר סיווג...');

        try {
            const response = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: authToken,
                    classification_id: recordId,
                    action: 'approve'
                })
            }, FETCH_TIMEOUTS.mutate);

            const data = await parseAIResponse(response);
            clearCardLoading(recordId);

            // DL-222: Approve conflict — show 3-option dialog
            if (data._conflict) {
                const existingName = (data.conflict_existing_name || '').replace(/<[^>]+>/g, '');
                const newName = (data.conflict_new_name || '').replace(/<[^>]+>/g, '');
                const title = (data.conflict_doc_title || '').replace(/<[^>]+>/g, '');
                showApproveConflictDialog(title, existingName, newName,
                    () => resubmitApprove(recordId, 'merge', 'ממזג קבצים...'),
                    () => resubmitApprove(recordId, 'keep_both', 'שומר שניהם...'),
                    () => resubmitApprove(recordId, 'override', 'מחליף קובץ...')
                );
                return;
            }

            if (!data.ok) throw new Error(formatAIResponseError(data));

            const approvedItem = aiClassificationsData.find(i => i.id === recordId);
            // DL-224: Use response doc_id (resolved by backend) instead of stale matched_doc_record_id
            const resolvedDocId = data.doc_id || approvedItem?.matched_doc_record_id;
            if (resolvedDocId && approvedItem) {
                updateClientDocState(approvedItem.client_name, resolvedDocId);
            }
            // DL-086: Transition to reviewed state instead of removing
            transitionCardToReviewed(recordId, 'approved', data);
            showAIToast(formatAISuccessToast(data), 'success');
        } catch (error) {
            clearCardLoading(recordId);
            showModal('error', 'שגיאה', error.message);
        }
    }, { confirmText: 'נכון', btnClass: 'btn-success' });
}

// DL-222: Re-submit approve with conflict resolution mode
async function resubmitApprove(recordId, mode, loadingText) {
    setCardLoading(recordId, loadingText);
    try {
        const response = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: recordId,
                action: 'approve',
                force_overwrite: true,
                approve_mode: mode
            })
        }, FETCH_TIMEOUTS.mutate);

        const data = await parseAIResponse(response);
        clearCardLoading(recordId);

        if (!data.ok) throw new Error(formatAIResponseError(data));

        const approvedItem = aiClassificationsData.find(i => i.id === recordId);
        // DL-224: Use response doc_id (resolved by backend)
        const resolvedDocId = data.doc_id || approvedItem?.matched_doc_record_id;
        if (resolvedDocId && approvedItem) {
            updateClientDocState(approvedItem.client_name, resolvedDocId);
        }
        transitionCardToReviewed(recordId, 'approved', data);
        const modeLabel = mode === 'merge' ? 'מוזג' : mode === 'keep_both' ? 'נשמרו שניהם' : 'הוחלף';
        showAIToast(`${modeLabel} — ${formatAISuccessToast(data)}`, 'success');
    } catch (error) {
        clearCardLoading(recordId);
        showModal('error', 'שגיאה', error.message);
    }
}

// DL-224: Re-submit reassign with conflict resolution mode
async function resubmitReassign(recordId, templateId, docRecordId, newDocName, mode, loadingText) {
    setCardLoading(recordId, loadingText);
    try {
        const body = {
            token: authToken,
            classification_id: recordId,
            action: 'reassign',
            reassign_template_id: templateId,
            reassign_doc_record_id: docRecordId || null,
            force_overwrite: true,
            approve_mode: mode
        };
        if (newDocName) body.new_doc_name = newDocName;

        const response = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, FETCH_TIMEOUTS.mutate);

        const data = await parseAIResponse(response);
        clearCardLoading(recordId);

        if (!data.ok) throw new Error(formatAIResponseError(data));

        const reassignedItem = aiClassificationsData.find(i => i.id === recordId);
        const resolvedDocId = data.doc_id || docRecordId;
        if (resolvedDocId && reassignedItem) {
            updateClientDocState(reassignedItem.client_name, resolvedDocId);
        }
        if (reassignedItem && data.doc_title) {
            reassignedItem.matched_doc_name = data.doc_title;
            reassignedItem.matched_template_id = templateId;
            reassignedItem.matched_short_name = data.matched_short_name || data.doc_title || '';
            reassignedItem.matched_template_name = reassignedItem.matched_short_name;
        }
        transitionCardToReviewed(recordId, 'reassigned', data);
        const modeLabel = mode === 'merge' ? 'מוזג' : mode === 'keep_both' ? 'נשמרו שניהם' : 'הוחלף';
        showAIToast(`${modeLabel} — ${formatAISuccessToast(data)}`, 'success');
    } catch (error) {
        clearCardLoading(recordId);
        showModal('error', 'שגיאה', error.message);
    }
}

async function rejectAIClassification(recordId) {
    showRejectNotesPanel(recordId);
}

function showRejectNotesPanel(recordId) {
    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;
    const actionsDiv = card.querySelector('.ai-card-actions');
    if (!actionsDiv) return;

    cancelInlineConfirm(recordId);
    actionsDiv.dataset.originalHtml = actionsDiv.innerHTML;

    actionsDiv.innerHTML = `
        <div class="ai-reject-notes-panel">
            <select class="ai-reject-reason-select">
                <option value="">בחר סיבה...</option>
                ${Object.entries(REJECTION_REASONS).map(([k, v]) =>
                    `<option value="${k}">${escapeHtml(v)}</option>`
                ).join('')}
            </select>
            <textarea class="ai-reject-notes-text" placeholder="הערות נוספות (אופציונלי)" rows="2"></textarea>
            <div class="ai-reject-notes-actions">
                <button class="btn btn-danger btn-sm ai-reject-confirm-btn" disabled>מסמך לא רלוונטי</button>
                <button class="btn btn-ghost btn-sm ai-reject-cancel-btn">ביטול</button>
            </div>
        </div>
    `;

    const select = actionsDiv.querySelector('.ai-reject-reason-select');
    const confirmBtn = actionsDiv.querySelector('.ai-reject-confirm-btn');
    const cancelBtn = actionsDiv.querySelector('.ai-reject-cancel-btn');

    select.addEventListener('change', () => { confirmBtn.disabled = !select.value; });
    cancelBtn.addEventListener('click', () => cancelInlineConfirm(recordId));

    function escapeHandler(e) { if (e.key === 'Escape') cancelInlineConfirm(recordId); }
    document.addEventListener('keydown', escapeHandler);
    card._inlineConfirmCleanup = () => document.removeEventListener('keydown', escapeHandler);

    confirmBtn.addEventListener('click', async () => {
        if (card._inlineConfirmCleanup) { card._inlineConfirmCleanup(); card._inlineConfirmCleanup = null; }
        const rejectionReason = select.value;
        const notes = actionsDiv.querySelector('.ai-reject-notes-text').value.trim();
        await executeReject(recordId, rejectionReason, notes);
    });
}

async function executeReject(recordId, rejectionReason, notes) {
    setCardLoading(recordId, 'דוחה סיווג...');

    try {
        const response = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: recordId,
                action: 'reject',
                notes: JSON.stringify({ reason: rejectionReason, text: notes })
            })
        }, FETCH_TIMEOUTS.mutate);

        const data = await parseAIResponse(response);
        clearCardLoading(recordId);

        if (!data.ok) throw new Error(formatAIResponseError(data));

        // DL-086: Store notes on the item for reviewed card display
        const rejItem = aiClassificationsData.find(i => i.id === recordId);
        if (rejItem) rejItem.notes = JSON.stringify({ reason: rejectionReason, text: notes });
        // DL-086: Transition to reviewed state instead of removing
        transitionCardToReviewed(recordId, 'rejected', data);
        showAIToast(formatAISuccessToast(data), 'danger');
    } catch (error) {
        clearCardLoading(recordId);
        showModal('error', 'שגיאה', error.message);
    }
}

// DL-239: Track selected report for cross-filing-type reassign
let aiReassignSelectedReportId = null;

function showAIReassignModal(recordId) {
    const item = aiClassificationsData.find(i => i.id === recordId);
    // DL-224: Show all docs (not just missing) — received ones get checkmark badge
    const ownDocs = item ? (item.all_docs || item.missing_docs || []) : [];
    const otherDocsArr = item?.other_report_docs || [];
    const hasBothTypes = otherDocsArr.length > 0;

    aiCurrentReassignId = recordId;
    aiReassignSelectedReportId = item?.report_record_id || null;

    const fileInfoEl = document.getElementById('aiReassignFileInfo');
    if (item) {
        fileInfoEl.innerHTML = `<i data-lucide="file" class="icon-sm" style="display:inline;vertical-align:middle;"></i> ${escapeHtml(item.attachment_name || 'ללא שם')}`;
    } else {
        fileInfoEl.textContent = '';
    }

    // DL-239: Hide external toggle (now inside combobox dropdown)
    const toggleContainer = document.getElementById('aiReassignFtToggle');
    if (toggleContainer) { toggleContainer.style.display = 'none'; toggleContainer.innerHTML = ''; }

    const comboContainer = document.getElementById('aiReassignComboboxContainer');
    const currentMatchId = item ? item.matched_template_id : null;

    document.getElementById('aiReassignConfirmBtn').disabled = true;
    createDocCombobox(comboContainer, ownDocs, {
        currentMatchId,
        allowCreate: true,
        onSelect: (templateId) => {
            document.getElementById('aiReassignConfirmBtn').disabled = !templateId;
        },
        // DL-239: Pass other filing type docs for in-dropdown toggle
        ...(hasBothTypes ? {
            otherDocs: otherDocsArr,
            ownFilingType: item.filing_type || 'annual_report',
            otherFilingType: item.other_filing_type || (item.filing_type === 'annual_report' ? 'capital_statement' : 'annual_report'),
        } : {}),
    });

    document.getElementById('aiReassignModal').classList.add('show');
    safeCreateIcons();
}

function closeAIReassignModal() {
    document.getElementById('aiReassignModal').classList.remove('show');
    aiCurrentReassignId = null;
}

async function confirmAIReassign() {
    const combobox = document.querySelector('#aiReassignComboboxContainer .doc-combobox');
    const templateId = combobox ? combobox.dataset.selectedValue : '';
    const docRecordId = combobox ? combobox.dataset.selectedDocId : '';
    const newDocName = combobox ? (combobox.dataset.newDocName || '') : '';
    if (!templateId || !aiCurrentReassignId) return;

    const recordId = aiCurrentReassignId;
    // DL-239: Capture selected report ID for cross-type reassign before closing
    const selectedReportId = aiReassignSelectedReportId;
    const item = aiClassificationsData.find(i => i.id === recordId);
    const isCrossType = selectedReportId && item && selectedReportId !== item.report_record_id;
    closeAIReassignModal();

    if (templateId === '__NEW__' && newDocName.trim()) {
        await submitAIReassign(recordId, 'general_doc', '', null, newDocName.trim(), false, isCrossType ? selectedReportId : null);
    } else {
        await submitAIReassign(recordId, templateId, docRecordId);
    }
}

async function submitAIReassign(recordId, templateId, docRecordId, loadingText, newDocName, forceOverwrite, targetReportId) {
    setCardLoading(recordId, loadingText || 'משייך מחדש...');

    try {
        const body = {
            token: authToken,
            classification_id: recordId,
            action: 'reassign',
            reassign_template_id: templateId,
            reassign_doc_record_id: docRecordId || null
        };
        if (newDocName) body.new_doc_name = newDocName;
        if (forceOverwrite) body.force_overwrite = true;
        if (targetReportId) body.target_report_id = targetReportId; // DL-239

        const response = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, FETCH_TIMEOUTS.mutate);

        const data = await parseAIResponse(response);
        clearCardLoading(recordId);

        // DL-224: Handle target doc conflict with 3-option dialog (same as approve)
        if (data._conflict) {
            const title = (data.conflict_doc_title || '').replace(/<[^>]+>/g, '');
            const existingName = (data.conflict_existing_name || '').replace(/<[^>]+>/g, '');
            const newName = (data.conflict_new_name || '').replace(/<[^>]+>/g, '');
            showApproveConflictDialog(title, existingName, newName,
                () => resubmitReassign(recordId, templateId, docRecordId, newDocName, 'merge', 'ממזג קבצים...'),
                () => resubmitReassign(recordId, templateId, docRecordId, newDocName, 'keep_both', 'שומר שניהם...'),
                () => resubmitReassign(recordId, templateId, docRecordId, newDocName, 'override', 'מחליף קובץ...')
            );
            return;
        }

        if (!data.ok) throw new Error(formatAIResponseError(data));

        const reassignedItem = aiClassificationsData.find(i => i.id === recordId);
        // Update local item with reassigned doc info from API response
        if (reassignedItem && data.doc_title) {
            reassignedItem.matched_doc_name = data.doc_title;
            reassignedItem.matched_template_id = templateId;
            // Derive short name from all_docs if API doesn't provide it — match by doc_record_id for multi-instance types
            const matchedDoc = docRecordId
                ? (reassignedItem.all_docs || []).find(d => d.doc_record_id === docRecordId)
                : (reassignedItem.all_docs || []).find(d => d.template_id === templateId);
            reassignedItem.matched_short_name = data.matched_short_name || (matchedDoc && matchedDoc.name_short) || data.doc_title || '';
            reassignedItem.matched_template_name = reassignedItem.matched_short_name;
        }
        if (docRecordId) {
            updateClientDocState(reassignedItem?.client_name, docRecordId);
        }
        // DL-086: Transition to reviewed state instead of removing
        transitionCardToReviewed(recordId, 'reassigned', data);
        showAIToast(formatAISuccessToast(data), 'success');
    } catch (error) {
        clearCardLoading(recordId);
        showModal('error', 'שגיאה', error.message);
    }
}

async function assignAIUnmatched(recordId, btnEl) {
    const actionsContainer = btnEl.closest('.ai-card-actions');
    const comboboxEl = actionsContainer.querySelector('.doc-combobox');
    const templateId = comboboxEl ? comboboxEl.dataset.selectedValue : '';
    const docRecordId = comboboxEl ? comboboxEl.dataset.selectedDocId : '';
    const newDocName = comboboxEl ? (comboboxEl.dataset.newDocName || '') : '';
    if (!templateId) return;

    // DL-239: Detect cross-type toggle for "create new doc" path
    const item = aiClassificationsData.find(i => i.id === recordId);
    const assignSection = btnEl.closest('.ai-assign-section') || actionsContainer;
    const activeToggle = assignSection.querySelector('.ai-inline-ft-toggle .ai-ft-toggle-btn.active');
    const selectedFt = activeToggle?.dataset.ft;
    const isCrossType = selectedFt && item && selectedFt !== item.filing_type;
    const targetReportId = isCrossType ? item.other_report_id : null;

    if (templateId === '__NEW__' && newDocName.trim()) {
        showInlineConfirm(recordId, `ליצור מסמך "${newDocName.trim()}"?`, async () => {
            await submitAIReassign(recordId, 'general_doc', '', 'יוצר ומשייך...', newDocName.trim(), false, targetReportId);
        }, { confirmText: 'צור ושייך' });
    } else {
        showInlineConfirm(recordId, 'לשייך?', async () => {
            await submitAIReassign(recordId, templateId, docRecordId, 'משייך...');
        }, { confirmText: 'שייך' });
    }
}

// DL-086: Transition card to reviewed state instead of removing
function transitionCardToReviewed(recordId, newReviewStatus, responseData) {
    // Update the item in aiClassificationsData
    const item = aiClassificationsData.find(i => i.id === recordId);
    if (item) {
        item.review_status = newReviewStatus;
        item.reviewed_at = new Date().toISOString();
    }

    // Re-render the card in-place
    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (card) {
        const tmpDiv = document.createElement('div');
        tmpDiv.innerHTML = renderReviewedCard(item || { id: recordId, review_status: newReviewStatus }, newReviewStatus);
        const newCard = tmpDiv.firstElementChild;
        card.replaceWith(newCard);
    }

    recalcAIStats();
    safeCreateIcons();

    // DL-210: Check if all items for this client are now reviewed
    if (item) {
        const clientName = item.client_name;
        const clientItems = aiClassificationsData.filter(i => i.client_name === clientName);
        const pendingLeft = clientItems.filter(i => (i.review_status || 'pending') === 'pending').length;
        if (pendingLeft === 0 && clientItems.length > 0) {
            showClientReviewDonePrompt(clientName);
        }
    }
}

// DL-210: Show "mark review as done?" prompt when all client items are reviewed
function showClientReviewDonePrompt(clientName) {
    const accordion = document.querySelector(`.ai-accordion[data-client="${CSS.escape(clientName)}"]`);
    if (!accordion) return;

    // Scroll to accordion header
    accordion.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Remove existing prompt if any
    const existing = accordion.querySelector('.ai-review-done-prompt');
    if (existing) existing.remove();

    // Count approved/rejected/reassigned
    const clientItems = aiClassificationsData.filter(i => i.client_name === clientName);
    const approved = clientItems.filter(i => i.review_status === 'approved').length;
    const rejected = clientItems.filter(i => i.review_status === 'rejected').length;
    const reassigned = clientItems.filter(i => i.review_status === 'reassigned').length;

    const statParts = [];
    if (approved) statParts.push(`${approved} אושרו`);
    if (reassigned) statParts.push(`${reassigned} שויכו`);
    if (rejected) statParts.push(`${rejected} נדחו`);

    const prompt = document.createElement('div');
    prompt.className = 'ai-review-done-prompt';
    prompt.innerHTML = `
        <div class="ai-review-done-content">
            <i data-lucide="check-circle-2" class="icon-md ai-review-done-icon"></i>
            <div class="ai-review-done-text">
                <strong>כל המסמכים נבדקו!</strong>
                <span class="ai-review-done-stats">${statParts.join(' · ')}</span>
            </div>
            <button class="btn btn-success btn-sm ai-review-done-btn" onclick="dismissClientReview('${escapeOnclick(clientName)}')">
                <i data-lucide="check" class="icon-xs"></i>
                סיום בדיקה
            </button>
        </div>
    `;

    // Insert after accordion header
    const header = accordion.querySelector('.ai-accordion-header');
    header.after(prompt);

    // Update badge to show done state
    const statsEl = accordion.querySelector('.ai-accordion-stats');
    if (statsEl) {
        statsEl.innerHTML = `<span class="ai-accordion-stat-badge badge-success">✓ הושלם</span>`;
    }

    safeCreateIcons();
}

// DL-210: Remove all reviewed cards for this client from the UI + delete from Airtable
async function dismissClientReview(clientName) {
    const accordion = document.querySelector(`.ai-accordion[data-client="${CSS.escape(clientName)}"]`);
    if (!accordion) return;

    // Collect record IDs before removing from data
    const clientItems = aiClassificationsData.filter(i => i.client_name === clientName);
    const recordIds = clientItems.map(i => i.id);

    // Delete from Airtable (fire-and-forget, non-blocking)
    if (recordIds.length > 0) {
        fetchWithTimeout(ENDPOINTS.DISMISS_CLASSIFICATIONS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: authToken, record_ids: recordIds })
        }, FETCH_TIMEOUTS.mutate).catch(err => {
            console.error('[dismissClientReview] Airtable delete failed:', err.message);
        });
    }

    // Animate accordion collapse then remove
    accordion.style.maxHeight = accordion.offsetHeight + 'px';
    accordion.offsetHeight; // force reflow
    accordion.classList.add('removing');
    setTimeout(() => {
        accordion.remove();

        // Remove client items from data
        aiClassificationsData = aiClassificationsData.filter(i => i.client_name !== clientName);

        // Check if everything is empty
        if (aiClassificationsData.length === 0) {
            document.getElementById('aiCardsContainer').style.display = 'none';
            document.getElementById('aiEmptyState').style.display = 'block';
            safeCreateIcons();
        }

        recalcAIStats();
    }, 350);
}

function animateAndRemoveAI(recordId) {
    aiClassificationsData = aiClassificationsData.filter(item => item.id !== recordId);

    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (card) {
        // Lock current height so CSS can transition max-height to 0
        card.style.maxHeight = card.offsetHeight + 'px';
        // Force layout reflow before adding the class
        card.offsetHeight; // eslint-disable-line no-unused-expressions
        card.classList.add('removing');
        setTimeout(() => {
            card.remove();

            // Check if parent accordion group is now empty
            document.querySelectorAll('.ai-accordion').forEach(accordion => {
                const cards = accordion.querySelectorAll('.ai-review-card');
                if (cards.length === 0) {
                    accordion.remove();
                }
            });

            // Check if everything is empty
            if (aiClassificationsData.length === 0) {
                document.getElementById('aiCardsContainer').style.display = 'none';
                document.getElementById('aiEmptyState').style.display = 'block';
                safeCreateIcons();
            }

            recalcAIStats();
        }, 350);
    } else {
        recalcAIStats();
    }
}

function updateClientDocState(clientName, docRecordId) {
    if (!clientName || !docRecordId) return;

    // DL-227: Delegate to shared functions
    applyDocStatusChange(clientName, docRecordId, 'Received');
    refreshClientDocTags(clientName);
}

function recalcAIStats() {
    // DL-086: Split into pending (needing review) and reviewed-unsent
    const pendingItems = aiClassificationsData.filter(i => (i.review_status || 'pending') === 'pending');
    const reviewedItems = aiClassificationsData.filter(i => (i.review_status || 'pending') !== 'pending');

    const pendingCount = pendingItems.length;
    const reviewedUnsent = reviewedItems.length;
    const matched = pendingItems.filter(i => !!i.matched_template_id).length;
    const unmatched = pendingCount - matched;
    const mismatchCount = pendingItems.filter(i =>
        i.matched_template_id && i.issuer_match_quality === 'mismatch'
    ).length;


    // Update tab badge — show unique client count (not doc count)
    const badge = document.getElementById('aiReviewTabBadge');
    const uniqueClientsPending = new Set(pendingItems.map(i => i.client_id).filter(Boolean)).size;
    const uniqueClientsReviewed = new Set(reviewedItems.map(i => i.client_id).filter(Boolean)).size;
    const badgeCount = uniqueClientsPending > 0 ? uniqueClientsPending : (uniqueClientsReviewed > 0 ? uniqueClientsReviewed : 0);
    syncAIBadge(badge, badgeCount);
}

// --- DL-227: Inline doc tag rendering + waive/receive ---

function renderDocTag(d) {
    const label = d.name_short || d.name || d.template_id || '';
    const docId = d.doc_record_id || '';
    const status = d.status || 'Required_Missing';

    const tagClasses = {
        'Received': 'ai-doc-tag-received',
        'Waived': 'ai-doc-tag-waived',
        'Requires_Fix': 'ai-doc-tag-requires-fix',
    };
    const tagClass = tagClasses[status] || 'ai-missing-doc-tag';
    const prefixes = { 'Received': '&#x2713; ', 'Waived': '&mdash; ', 'Requires_Fix': '&#x26A0; ' };
    const prefix = prefixes[status] || '';

    return `<span class="${tagClass}" data-doc-record-id="${escapeAttr(docId)}" data-status="${escapeAttr(status)}" onclick="openDocTagMenu(event, this)">${prefix}${renderDocLabel(label)}</span>`;
}

function openDocTagMenu(event, tagEl) {
    event.stopPropagation();
    closeDocTagMenu();

    const currentStatus = tagEl.dataset.status || 'Required_Missing';
    const docRecordId = tagEl.dataset.docRecordId;
    if (!docRecordId) return;

    const options = [
        { status: 'Required_Missing', label: 'חסר', icon: '○' },
        { status: 'Received', label: 'התקבל', icon: '✓' },
        { status: 'Waived', label: 'לא נדרש', icon: '—' },
    ].filter(o => o.status !== currentStatus);

    const menu = document.createElement('div');
    menu.className = 'ai-doc-tag-menu';
    menu.innerHTML = options.map(o =>
        `<button class="ai-doc-tag-menu-item" data-new-status="${o.status}" onclick="selectDocTagStatus(event, this)">
            <span class="ai-doc-tag-menu-icon">${o.icon}</span> ${o.label}
        </button>`
    ).join('');

    // Position relative to tag
    const rect = tagEl.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
    menu.dataset.docRecordId = docRecordId;
    menu.dataset.tagId = docRecordId; // link back to tag

    document.body.appendChild(menu);
    tagEl.classList.add('ai-doc-tag-active');

    // Close on outside click (next tick to avoid immediate close)
    requestAnimationFrame(() => {
        document._docTagMenuClose = (e) => {
            if (!menu.contains(e.target) && e.target !== tagEl) closeDocTagMenu();
        };
        document.addEventListener('click', document._docTagMenuClose, { capture: true });
    });
}

function selectDocTagStatus(event, btnEl) {
    event.stopPropagation();
    const menu = btnEl.closest('.ai-doc-tag-menu');
    const docRecordId = menu.dataset.docRecordId;
    const newStatus = btnEl.dataset.newStatus;
    closeDocTagMenu();

    // Find the tag's client
    const tagEl = document.querySelector(`[data-doc-record-id="${CSS.escape(docRecordId)}"].ai-doc-tag-active`)
        || document.querySelector(`[data-doc-record-id="${CSS.escape(docRecordId)}"]`);
    if (!tagEl) return;

    const accordion = tagEl.closest('.ai-accordion');
    const clientName = accordion ? accordion.dataset.client : null;
    if (!clientName) return;

    updateDocStatusInline(clientName, docRecordId, newStatus);
}

function closeDocTagMenu() {
    const existing = document.querySelector('.ai-doc-tag-menu');
    if (existing) existing.remove();
    document.querySelectorAll('.ai-doc-tag-active').forEach(el => el.classList.remove('ai-doc-tag-active'));
    if (document._docTagMenuClose) {
        document.removeEventListener('click', document._docTagMenuClose, { capture: true });
        document._docTagMenuClose = null;
    }
}

async function updateDocStatusInline(clientName, docRecordId, newStatus) {
    // Find representative item to get report_record_id
    const representative = aiClassificationsData.find(i => i.client_name === clientName);
    if (!representative) return;
    const reportRecordId = representative.report_record_id;
    if (!reportRecordId) return;

    // Find the doc in all_docs to get previous status
    const allDocs = representative.all_docs || representative.missing_docs || [];
    const doc = allDocs.find(d => d.doc_record_id === docRecordId);
    if (!doc) return;
    const previousStatus = doc.status || 'Required_Missing';
    if (previousStatus === newStatus) return;

    // Optimistic update: mutate data
    applyDocStatusChange(clientName, docRecordId, newStatus);
    refreshClientDocTags(clientName);

    // Fire API
    const payload = {
        data: {
            fields: [{ type: 'HIDDEN_FIELDS', value: { report_record_id: reportRecordId } }],
            extensions: {
                status_changes: [{ id: docRecordId, new_status: newStatus }],
                send_email: false
            }
        }
    };

    const statusLabels = {
        'Waived': 'המסמך סומן כלא נדרש',
        'Required_Missing': 'המסמך שוחזר לרשימה',
        'Received': 'המסמך סומן כהתקבל',
        'Requires_Fix': 'המסמך סומן כדרוש תיקון'
    };

    try {
        const response = await fetchWithTimeout(ENDPOINTS.EDIT_DOCUMENTS, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        }, FETCH_TIMEOUTS.mutate);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        showAIToast(statusLabels[newStatus] || 'הסטטוס עודכן', 'success', {
            label: 'ביטול',
            onClick: () => undoDocStatusChange(clientName, docRecordId, previousStatus, reportRecordId)
        });
    } catch (err) {
        // Rollback on error
        applyDocStatusChange(clientName, docRecordId, previousStatus);
        refreshClientDocTags(clientName);
        showAIToast('שגיאה בעדכון סטטוס המסמך', 'danger');
        console.error('DL-227: status update failed', err);
    }
}

async function undoDocStatusChange(clientName, docRecordId, revertStatus, reportRecordId) {
    applyDocStatusChange(clientName, docRecordId, revertStatus);
    refreshClientDocTags(clientName);

    const payload = {
        data: {
            fields: [{ type: 'HIDDEN_FIELDS', value: { report_record_id: reportRecordId } }],
            extensions: {
                status_changes: [{ id: docRecordId, new_status: revertStatus }],
                send_email: false
            }
        }
    };

    try {
        const response = await fetchWithTimeout(ENDPOINTS.EDIT_DOCUMENTS, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        }, FETCH_TIMEOUTS.mutate);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        showAIToast('הפעולה בוטלה', 'success');
    } catch (err) {
        showAIToast('שגיאה בביטול — רענן את הדף', 'danger');
        console.error('DL-227: undo failed', err);
    }
}

function applyDocStatusChange(clientName, docRecordId, newStatus) {
    for (const item of aiClassificationsData) {
        if (item.client_name !== clientName) continue;

        // Update in all_docs
        if (item.all_docs) {
            const doc = item.all_docs.find(d => d.doc_record_id === docRecordId);
            if (doc) {
                const wasReceived = doc.status === 'Received';
                const isNowReceived = newStatus === 'Received';
                doc.status = newStatus;
                if (!wasReceived && isNowReceived) {
                    item.docs_received_count = (item.docs_received_count || 0) + 1;
                } else if (wasReceived && !isNowReceived) {
                    item.docs_received_count = Math.max(0, (item.docs_received_count || 0) - 1);
                }
            }
        }

        // Update missing_docs: remove if waived/received, add back if restored
        if (item.missing_docs) {
            if (newStatus === 'Required_Missing') {
                // Add back if not already there
                if (!item.missing_docs.find(d => d.doc_record_id === docRecordId)) {
                    const docData = (item.all_docs || []).find(d => d.doc_record_id === docRecordId);
                    if (docData) item.missing_docs.push(docData);
                }
            } else {
                item.missing_docs = item.missing_docs.filter(d => d.doc_record_id !== docRecordId);
            }
        }
    }
}

function refreshClientDocTags(clientName) {
    const accordion = document.querySelector(`.ai-accordion[data-client="${CSS.escape(clientName)}"]`);
    if (!accordion) return;

    const representative = aiClassificationsData.find(i => i.client_name === clientName);
    if (!representative) return;

    const allDocs = representative.all_docs || [];
    const groupMissingDocs = representative.missing_docs || [];
    const displayDocs = allDocs.length > 0 ? allDocs : groupMissingDocs;
    const docsReceivedCount = representative.docs_received_count || 0;
    const docsTotalCount = representative.docs_total_count || displayDocs.length;
    const hasStatusVariation = allDocs.length > 0 && docsReceivedCount > 0;

    const docsGroup = accordion.querySelector('.ai-missing-docs-group');
    if (docsGroup && displayDocs.length > 0) {
        let categoriesHtml = '<div class="ai-missing-category-tags">';
        const catGroups = [];
        let currentCat = null;
        for (const d of displayDocs) {
            const cat = d.category || 'other';
            if (cat !== currentCat) {
                currentCat = cat;
                catGroups.push({ category: cat, name: d.category_name || cat, emoji: d.category_emoji || '', docs: [] });
            }
            catGroups[catGroups.length - 1].docs.push(d);
        }
        for (const group of catGroups) {
            categoriesHtml += group.docs.map(d => renderDocTag(d)).join('');
        }
        categoriesHtml += '</div>';

        const toggleLabel = hasStatusVariation
            ? `מסמכים נדרשים (${docsReceivedCount}/${docsTotalCount} התקבלו)`
            : `מסמכים חסרים (${groupMissingDocs.length})`;

        const wasOpen = docsGroup.classList.contains('open');
        docsGroup.querySelector('.ai-missing-docs-toggle').innerHTML =
            `<span class="toggle-arrow">${wasOpen ? '▾' : '▸'}</span> ${toggleLabel}`;
        docsGroup.querySelector('.ai-missing-docs-body').innerHTML = categoriesHtml;
    }

    // Re-initialize inline comboboxes with updated missing_docs
    accordion.querySelectorAll('.doc-combobox-container').forEach(el => {
        const recId = el.dataset.recordId;
        const itemData = aiClassificationsData.find(i => i.id === recId);
        const docs = itemData ? (itemData.missing_docs || []) : [];
        createDocCombobox(el, docs, {
            allowCreate: true,
            onSelect: (templateId) => {
                const btn = el.closest('.ai-card-actions').querySelector('.btn-ai-assign-confirm');
                if (btn) btn.disabled = !templateId;
            }
        });
    });

    // Rebuild issuer-mismatch radio lists with filtered data
    accordion.querySelectorAll('.ai-review-card').forEach(card => {
        const cardId = card.dataset.id;
        const cardItem = aiClassificationsData.find(i => i.id === cardId);
        if (!cardItem || getCardState(cardItem) !== 'issuer-mismatch') return;

        const validationArea = card.querySelector('.ai-validation-area');
        if (!validationArea) return;

        const relatedIds = RELATED_TEMPLATES[cardItem.matched_template_id] || [cardItem.matched_template_id];
        const sameTypeDocs = (cardItem.missing_docs || []).filter(d => relatedIds.includes(d.template_id));

        if (sameTypeDocs.length > 0) {
            validationArea.innerHTML = `
                <div class="ai-validation-title">האם זה אחד מהבאים?</div>
                <div class="ai-validation-options">
                    ${sameTypeDocs.map(d => {
                        const docName = d.name_short || d.name || d.template_id;
                        const docLabel = d.name_short || d.name_html || d.name || d.template_id;
                        return `
                            <label class="ai-comparison-radio">
                                <input type="radio" name="compare_${escapeAttr(cardId)}"
                                    data-template-id="${escapeAttr(d.template_id)}"
                                    data-doc-record-id="${escapeAttr(d.doc_record_id || '')}"
                                    data-doc-name="${escapeAttr(docName.replace(/<\/?b>/g, ''))}"
                                    onchange="handleComparisonRadio('${escapeAttr(cardId)}', this)">
                                <span>${renderDocLabel(docLabel)}</span>
                            </label>
                        `;
                    }).join('')}
                </div>
            `;
        } else {
            const templateName = cardItem.matched_short_name || cardItem.matched_template_name || cardItem.matched_template_id || '';
            validationArea.innerHTML = `
                <div class="ai-validation-title">⚠️ כל מסמכי ${renderDocLabel(templateName)} כבר התקבלו</div>
            `;
        }
    });
}

// AI helper functions
function getAIFileIcon(contentTypeOrName) {
    const str = (contentTypeOrName || '').toLowerCase();
    if (str.includes('pdf')) return 'file-text';
    if (str.includes('word') || str.includes('.doc')) return 'file-type';
    if (str.includes('excel') || str.includes('sheet') || str.includes('.xls')) return 'file-spreadsheet';
    if (str.includes('image') || str.includes('.png') || str.includes('.jpg') || str.includes('.jpeg')) return 'image';
    return 'file';
}

function formatAIDate(dateStr) {
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('he-IL', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}

function escapeAttr(text) {
    if (typeof text !== 'string') text = String(text || '');
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Escape for use inside JS string literals within inline onclick handlers
// First escapes for JS (backslash + single quote), then for HTML attribute context
function escapeOnclick(text) {
    if (typeof text !== 'string') text = String(text || '');
    return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showAIToast(message, type, action) {
    const toast = document.getElementById('aiToast');
    const toastText = document.getElementById('aiToastText');
    const toastIcon = document.getElementById('aiToastIcon');
    const actionBtn = document.getElementById('aiToastAction');
    const closeBtn = document.getElementById('aiToastClose');

    // Clear any previous timer
    if (toast._dismissTimer) clearTimeout(toast._dismissTimer);

    toastText.textContent = message;
    toast.className = 'ai-toast ai-toast-' + (type || 'success');

    if (type === 'danger') {
        toastIcon.setAttribute('data-lucide', 'x-circle');
    } else {
        toastIcon.setAttribute('data-lucide', 'check-circle');
    }

    // Action button
    if (action) {
        actionBtn.textContent = action.label;
        actionBtn.style.display = '';
        actionBtn.onclick = () => {
            toast.classList.remove('show');
            action.onClick();
        };
        closeBtn.style.display = '';
        closeBtn.onclick = () => toast.classList.remove('show');
    } else {
        actionBtn.style.display = 'none';
        actionBtn.onclick = null;
        closeBtn.style.display = 'none';
        closeBtn.onclick = null;
    }

    toast.classList.add('show');
    safeCreateIcons();

    // Action toasts stay until manually dismissed; plain toasts auto-dismiss
    toast.onmouseenter = null;
    toast.onmouseleave = null;

    if (!action) {
        toast._dismissTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

// ==================== REMINDERS TAB ====================

let remindersData = [];
let reminderLoaded = false;
let reminderLoadedAt = 0;
let reminderDefaultMax = null; // null = unlimited
let activeCardFilter = 'scheduled';

async function loadReminders(silent = false) {
    if (!authToken) return;
    // DL-247: SWR — skip if fresh (POST-based, no deduplicatedFetch)
    const isFresh = reminderLoaded && (Date.now() - reminderLoadedAt < STALE_AFTER_MS);
    if (silent && isFresh) return;



    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_REMINDERS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: authToken, action: 'list', filing_type: activeEntityTab })
        }, FETCH_TIMEOUTS.slow);
        const data = await response.json();



        if (!data.ok) {
            if (data.error === 'unauthorized') { logout(); return; }
            throw new Error(data.error || 'שגיאה בטעינת הנתונים');
        }

        remindersData = data.items || [];
        reminderLoaded = true;
        reminderLoadedAt = Date.now();
        reminderDefaultMax = data.default_max !== undefined ? data.default_max : null;
        updateReminderStats(data.stats || {});
        filterReminders();
    } catch (error) {

        console.error('Reminders load failed');
        if (!silent) {
            document.getElementById('reminderTableContainer').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i data-lucide="alert-triangle" class="icon-2xl"></i></div>
                    <p style="color: var(--danger-500);">לא ניתן לטעון את התזכורות. נסה שוב.</p>
                    <button class="btn btn-secondary mt-4" onclick="loadReminders()">
                        <i data-lucide="refresh-cw" class="icon-sm"></i> נסה שוב
                    </button>
                </div>
            `;
            safeCreateIcons();
        }
    }
}

async function loadReminderCount() {
    // Badge removed — no-op, kept for compatibility
}

function updateReminderStats(stats) {
    document.getElementById('reminder-stat-scheduled').textContent = stats.scheduled || 0;
    document.getElementById('reminder-stat-due').textContent = stats.due_this_week || 0;
    document.getElementById('reminder-stat-suppressed').textContent = (stats.suppressed || 0) + (stats.exhausted || 0);
    const pendingEl = document.getElementById('reminder-stat-pending');
    if (pendingEl) pendingEl.textContent = stats.pending_review || 0;
    // Apply active state for current filter
    const cardMap = { scheduled: 'reminder-stat-scheduled', due_this_week: 'reminder-stat-due', suppressed: 'reminder-stat-suppressed', pending: 'reminder-stat-pending' };
    document.querySelectorAll('.reminder-stat-item').forEach(card => {
        card.classList.remove('reminder-stat-active');
        card.setAttribute('aria-pressed', 'false');
    });
    if (activeCardFilter) {
        const activeCard = document.querySelector(`.${cardMap[activeCardFilter]}`);
        if (activeCard) {
            activeCard.closest('.reminder-stat-item').classList.add('reminder-stat-active');
            activeCard.closest('.reminder-stat-item').setAttribute('aria-pressed', 'true');
        }
    }
}

function isExhausted(r) {
    const effectiveMax = r.reminder_max != null ? r.reminder_max : reminderDefaultMax;
    if (effectiveMax == null) return false; // unlimited
    return r.reminder_count >= effectiveMax && !r.reminder_suppress;
}

function getReminderStatus(r) {
    if (r.reminder_suppress === 'forever') return { label: 'מושתק', class: 'reminder-status-suppressed', key: 'suppressed' };
    if (isExhausted(r)) return { label: 'מושתק', class: 'reminder-status-suppressed', key: 'suppressed' };
    if (r.pending_count > 0 && r.stage === 'Collecting_Docs') return { label: 'ממתין לסיווג', class: 'reminder-status-pending', key: 'pending' };
    return { label: 'פעיל', class: 'reminder-status-active', key: 'active' };
}

function toggleCardFilter(key) {
    // Toggle: same key clears, different key sets
    activeCardFilter = activeCardFilter === key ? null : key;

    // Update visual state on all cards
    document.querySelectorAll('.reminder-stat-item').forEach(card => {
        card.classList.remove('reminder-stat-active');
        card.setAttribute('aria-pressed', 'false');
    });
    if (activeCardFilter) {
        const cardMap = { scheduled: 'reminder-stat-scheduled', due_this_week: 'reminder-stat-due', suppressed: 'reminder-stat-suppressed', pending: 'reminder-stat-pending' };
        const activeCard = document.querySelector(`.${cardMap[activeCardFilter]}`);
        if (activeCard) {
            activeCard.classList.add('reminder-stat-active');
            activeCard.setAttribute('aria-pressed', 'true');
        }
    }

    filterReminders();
}

// Keyboard support for stat cards (Enter/Space)
document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('reminder-stat-item')) {
        e.preventDefault();
        e.target.click();
    }
});

let _filteredTypeA = []; // DL-256: filtered Type A reminders for per-section pagination
let _filteredTypeB = []; // DL-256: filtered Type B reminders for per-section pagination
function filterReminders(keepPage) {
    const search = (document.getElementById('reminderSearchInput').value || '').trim().toLowerCase();

    let filtered = remindersData.filter(r => r.is_active !== false);

    if (search) {
        filtered = filtered.filter(r => (String(r.name || '')).toLowerCase().includes(search));
    }

    if (activeCardFilter) {
        if (activeCardFilter === 'due_this_week') {
            const weekFromNow = new Date();
            weekFromNow.setDate(weekFromNow.getDate() + 7);
            const weekStr = weekFromNow.toISOString().split('T')[0];
            filtered = filtered.filter(r => getReminderStatus(r).key === 'active' && r.reminder_next_date && r.reminder_next_date <= weekStr);
        } else if (activeCardFilter === 'scheduled') {
            filtered = filtered.filter(r => getReminderStatus(r).key === 'active');
        } else {
            filtered = filtered.filter(r => getReminderStatus(r).key === activeCardFilter);
        }
    }

    // Sort by next_date ascending (nulls last)
    const sortFn = (a, b) => {
        const da = a.reminder_next_date || '9999';
        const db = b.reminder_next_date || '9999';
        return da.localeCompare(db);
    };

    // DL-256: Split first, paginate each section independently
    _filteredTypeA = filtered.filter(r => r.stage === 'Waiting_For_Answers').sort(sortFn);
    _filteredTypeB = filtered.filter(r => r.stage === 'Collecting_Docs').sort(sortFn);
    if (!keepPage) { _reminderPageA = 1; _reminderPageB = 1; }

    const typeASlice = _filteredTypeA.slice((_reminderPageA - 1) * PAGE_SIZE, _reminderPageA * PAGE_SIZE);
    const typeBSlice = _filteredTypeB.slice((_reminderPageB - 1) * PAGE_SIZE, _reminderPageB * PAGE_SIZE);

    renderRemindersTable(typeASlice, typeBSlice);
}

function goToReminderPageA(page) {
    _reminderPageA = page;
    filterReminders(true);
}
function goToReminderPageB(page) {
    _reminderPageB = page;
    filterReminders(true);
}

function renderRemindersTable(typeA, typeB) {
    const container = document.getElementById('reminderTableContainer');
    const totalA = _filteredTypeA.length;
    const totalB = _filteredTypeB.length;

    // Preserve accordion open state across re-renders
    const openSections = new Set();
    const allSections = container.querySelectorAll('.reminder-section');
    allSections.forEach((el, i) => { if (el.classList.contains('open')) openSections.add(i); });

    if (totalA === 0 && totalB === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="bell" class="icon-2xl"></i></div>
                <p>${remindersData.length === 0 ? 'אין תזכורות מתוזמנות' : 'אין תוצאות לסינון הנוכחי'}</p>
            </div>
        `;
        safeCreateIcons();
        return;
    }

    let html = '';

    // --- Type A: Haven't filled questionnaire (stage 2) ---
    html += `<div class="reminder-section${openSections.has(0) ? ' open' : ''}">`;
    html += `<div class="reminder-section-header reminder-section-a" onclick="toggleReminderSection(this)">
        <i data-lucide="chevron-left" class="icon-sm reminder-chevron"></i>
        <input type="checkbox" class="reminder-section-select-all" onclick="event.stopPropagation()" onchange="toggleSectionSelectAll(this)" title="בחר הכל">
        <i data-lucide="clipboard-list" class="icon-sm"></i>
        <h3>לא מילאו שאלון</h3>
        <span class="reminder-section-count">${totalA}</span>
    </div>`;
    html += `<div class="reminder-section-body">`;

    if (typeA.length > 0) {
        html += buildReminderTable(typeA, false);
        html += `<div id="reminderPaginationA"></div>`;
    } else {
        html += `<div class="reminder-section-empty">אין לקוחות בקטגוריה זו</div>`;
    }
    html += `</div></div>`;

    // --- Type B: Filled but missing docs (stage 4) ---
    html += `<div class="reminder-section${openSections.has(1) ? ' open' : ''}">`;
    html += `<div class="reminder-section-header reminder-section-b" onclick="toggleReminderSection(this)">
        <i data-lucide="chevron-left" class="icon-sm reminder-chevron"></i>
        <input type="checkbox" class="reminder-section-select-all" onclick="event.stopPropagation()" onchange="toggleSectionSelectAll(this)" title="בחר הכל">
        <i data-lucide="folder-open" class="icon-sm"></i>
        <h3>חסרים מסמכים</h3>
        <span class="reminder-section-count">${totalB}</span>
    </div>`;
    html += `<div class="reminder-section-body">`;

    if (typeB.length > 0) {
        html += buildReminderTable(typeB, true);
        html += `<div id="reminderPaginationB"></div>`;
    } else {
        html += `<div class="reminder-section-empty">אין לקוחות בקטגוריה זו</div>`;
    }
    html += `</div></div>`;

    container.innerHTML = html;
    safeCreateIcons(container);

    // DL-256: Per-section pagination (rendered after innerHTML so containers exist)
    renderPagination('reminderPaginationA', totalA, _reminderPageA, PAGE_SIZE, goToReminderPageA);
    renderPagination('reminderPaginationB', totalB, _reminderPageB, PAGE_SIZE, goToReminderPageB);
}

function buildReminderTable(items, showDocs) {
    const today = new Date().toISOString().split('T')[0];
    const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    let html = `
        <div class="table-scroll-container" role="region" aria-label="טבלת תזכורות" tabindex="0">
        <table>
            <thead>
                <tr>
                    <th><input type="checkbox" class="reminder-select-all" onchange="toggleReminderSelectAll(this)"></th>
                    <th>שם</th>
                    ${showDocs ? '<th>מסמכים</th>' : ''}
                    <th>נשלח לאחרונה</th>
                    <th>תאריך הבא</th>
                    <th>נשלחו</th>
                    <th>מקסימום</th>
                    <th>סטטוס</th>
                    <th>פעולות</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const r of items) {
        const status = getReminderStatus(r);
        const hasCustomMax = r.reminder_max != null;
        const effectiveMax = hasCustomMax ? r.reminder_max : reminderDefaultMax;
        const nextDate = r.reminder_next_date ? formatDateHe(r.reminder_next_date) : '-';
        const isDue = r.reminder_next_date && r.reminder_next_date <= today;
        const isDueSoon = r.reminder_next_date && r.reminder_next_date <= weekFromNow && !isDue;
        const dateClass = isDue ? 'reminder-date-due' : isDueSoon ? 'reminder-date-soon' : '';
        const docsReceived = r.docs_received || 0;
        const docsTotal = r.docs_total || 0;
        const progressPercent = docsTotal > 0 ? Math.round((docsReceived / docsTotal) * 100) : 0;

        // Max column content
        let maxCellHtml;
        if (hasCustomMax) {
            maxCellHtml = `<span class="reminder-max-cell reminder-max-custom" id="max-cell-${escapeAttr(r.report_id)}" onclick="editClientMax('${escapeAttr(r.report_id)}', this)">${effectiveMax} <button class="reminder-reset-btn" onclick="event.stopPropagation(); resetClientMax('${escapeAttr(r.report_id)}')" title="איפוס לברירת מחדל">↺</button></span>`;
        } else if (effectiveMax != null) {
            maxCellHtml = `<span class="reminder-max-cell reminder-max-default" id="max-cell-${escapeAttr(r.report_id)}" onclick="editClientMax('${escapeAttr(r.report_id)}', this)">${effectiveMax}</span>`;
        } else {
            maxCellHtml = `<span class="reminder-max-cell reminder-max-unlimited" id="max-cell-${escapeAttr(r.report_id)}" onclick="editClientMax('${escapeAttr(r.report_id)}', this)">ללא הגבלה</span>`;
        }

        const isSuppressed = r.reminder_suppress === 'forever';
        html += `
            <tr data-report-id="${escapeAttr(r.report_id)}"${isSuppressed ? ' class="reminder-row-suppressed"' : ''}>
                <td><input type="checkbox" class="reminder-checkbox" value="${escapeAttr(r.report_id)}" onchange="updateReminderSelectedCount()"></td>
                <td>
                    <strong class="client-link" onclick="viewClientDocs('${escapeAttr(r.report_id)}')">
                        ${escapeHtml(r.name)}
                    </strong>
                </td>
                ${showDocs ? `
                <td>
                    ${docsTotal > 0 ? `
                        <div class="docs-progress-cell clickable-docs" onclick="toggleDocsPopover(event, '${escapeOnclick(r.report_id)}', '${escapeOnclick(r.name)}')" tabindex="0" role="button" title="לחץ לצפייה במסמכים">
                            <span class="docs-count">${docsReceived}/${docsTotal}</span>
                            <div class="progress-bar"><div class="progress-fill" style="width: ${progressPercent}%"></div></div>
                        </div>
                    ` : '-'}
                </td>
                ` : ''}
                <td class="reminder-date-cell" title="לחץ לצפייה בהיסטוריית שליחה" onclick="toggleHistoryPopover(event, '${escapeAttr(r.report_id)}')" tabindex="0" role="button" aria-label="היסטוריית שליחה" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleHistoryPopover(event,'${escapeAttr(r.report_id)}');}">${r.last_reminder_sent_at ? `<span class="reminder-date">${formatDateHe(r.last_reminder_sent_at.split('T')[0])}</span>` : '-'}</td>
                <td${isSuppressed ? '' : ` class="reminder-date-cell editable-date" title="לחץ לעריכת תאריך" onclick="editReminderDate('${escapeAttr(r.report_id)}', this)" tabindex="0" role="button" aria-label="ערוך תאריך" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();editReminderDate('${escapeAttr(r.report_id)}',this);}"`}>${isSuppressed ? '-' : `<span class="reminder-date ${dateClass}">${nextDate}<i data-lucide="pencil" class="edit-pencil"></i></span>`}</td>
                <td class="reminder-date-cell" title="לחץ לצפייה בהיסטוריית שליחה" onclick="toggleHistoryPopover(event, '${escapeAttr(r.report_id)}')" tabindex="0" role="button" aria-label="היסטוריית שליחה" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleHistoryPopover(event,'${escapeAttr(r.report_id)}');}">${r.reminder_count || 0}</td>
                <td>${maxCellHtml}</td>
                <td>
                    <div class="reminder-status-dropdown">
                        <button class="reminder-status-btn ${status.class}" onclick="toggleStatusMenu(this, event)">
                            ${status.label} <span class="stage-caret">&#x25BE;</span>
                        </button>
                        <div class="suppress-menu status-menu">
                            ${isSuppressed
                                ? `<button onclick="reminderAction('unsuppress', '${escapeAttr(r.report_id)}')">פעיל</button>`
                                : `<button class="danger" onclick="confirmSuppress('suppress_forever', '${escapeOnclick(r.report_id)}', '${escapeOnclick(r.name)}')">ללא תזכורות</button>`
                            }
                        </div>
                    </div>
                </td>
                <td>
                    <div class="reminder-row-actions">
                        ${!r.reminder_suppress ? `
                            <button class="action-btn send" onclick="reminderAction('send_now', '${escapeAttr(r.report_id)}')" title="שלח עכשיו">
                                <i data-lucide="send" class="icon-sm"></i>
                            </button>
                        ` : ''}

                    </div>
                </td>
            </tr>
        `;
    }

    html += '</tbody></table>';

    // Mobile card list (DL-214)
    const todayCards = new Date().toISOString().split('T')[0];
    const weekFromNowCards = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    let cards = '<ul class="mobile-card-list" role="list" aria-label="רשימת תזכורות">';
    for (const r of items) {
        const status = getReminderStatus(r);
        const hasCustomMax = r.reminder_max != null;
        const effectiveMax = hasCustomMax ? r.reminder_max : reminderDefaultMax;
        const nextDate = r.reminder_next_date ? formatDateHe(r.reminder_next_date) : '-';
        const isDue = r.reminder_next_date && r.reminder_next_date <= todayCards;
        const isDueSoon = r.reminder_next_date && r.reminder_next_date <= weekFromNowCards && !isDue;
        const dateClass = isDue ? 'reminder-date-due' : isDueSoon ? 'reminder-date-soon' : '';
        const docsReceived = r.docs_received || 0;
        const docsTotal = r.docs_total || 0;
        const progressPercent = docsTotal > 0 ? Math.round((docsReceived / docsTotal) * 100) : 0;
        const isSuppressed = r.reminder_suppress === 'forever';

        let maxText;
        if (hasCustomMax) maxText = effectiveMax;
        else if (effectiveMax != null) maxText = effectiveMax;
        else maxText = '∞';

        cards += `<li class="mobile-card${isSuppressed ? ' reminder-card-suppressed' : ''}" data-report-id="${escapeAttr(r.report_id)}">
            <div class="mobile-card-primary">
                <span class="mobile-card-checkbox"><input type="checkbox" class="reminder-checkbox" value="${escapeAttr(r.report_id)}" onchange="updateReminderSelectedCount()"></span>
                <div class="mobile-card-info">
                    <span class="mobile-card-name" onclick="viewClientDocs('${escapeAttr(r.report_id)}')">${escapeHtml(r.name)}</span>
                    <div class="reminder-status-dropdown">
                        <button class="reminder-status-btn ${status.class}" onclick="toggleStatusMenu(this, event)">
                            ${status.label} <span class="stage-caret">&#x25BE;</span>
                        </button>
                        <div class="suppress-menu status-menu">
                            ${isSuppressed
                                ? `<button onclick="reminderAction('unsuppress', '${escapeAttr(r.report_id)}')">פעיל</button>`
                                : `<button class="danger" onclick="confirmSuppress('suppress_forever', '${escapeOnclick(r.report_id)}', '${escapeOnclick(r.name)}')">ללא תזכורות</button>`
                            }
                        </div>
                    </div>
                </div>
            </div>
            <div class="mobile-card-secondary">
                ${!isSuppressed ? `
                    <span class="mobile-card-detail editable-date" onclick="editReminderDate('${escapeAttr(r.report_id)}', this)">
                        <span class="label">הבא</span>
                        <span class="reminder-date ${dateClass}">${nextDate} <i data-lucide="pencil" class="edit-pencil"></i></span>
                    </span>
                ` : ''}
                <span class="mobile-card-detail" onclick="toggleHistoryPopover(event, '${escapeAttr(r.report_id)}')" style="cursor:pointer">
                    <span class="label">נשלח</span> ${r.last_reminder_sent_at ? formatDateHe(r.last_reminder_sent_at.split('T')[0]) : '-'}
                </span>
                <span class="mobile-card-detail" onclick="toggleHistoryPopover(event, '${escapeAttr(r.report_id)}')" style="cursor:pointer">
                    <span class="label">נשלחו</span> ${r.reminder_count || 0}/${maxText}
                </span>
                ${showDocs && docsTotal > 0 ? `
                    <span class="mobile-card-detail clickable-docs" onclick="toggleDocsPopover(event, '${escapeOnclick(r.report_id)}', '${escapeOnclick(r.name)}')">
                        <span class="label">מסמכים</span>
                        <span class="docs-count">${docsReceived}/${docsTotal}</span>
                    </span>
                ` : ''}
            </div>
            ${!isSuppressed ? `
                <div class="mobile-card-actions">
                    <button class="action-btn send" onclick="reminderAction('send_now', '${escapeAttr(r.report_id)}')" title="שלח עכשיו">
                        <i data-lucide="send" class="icon-sm"></i>
                    </button>
                </div>
            ` : ''}
        </li>`;
    }
    cards += '</ul>';

    html += cards + '</div>';
    return html;
}

function toggleReminderSection(header) {
    header.closest('.reminder-section').classList.toggle('open');
}

function formatDateHe(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {
        return dateStr;
    }
}

function getUniqueReminderCheckedCount() {
    return new Set(Array.from(document.querySelectorAll('.reminder-checkbox:checked')).map(cb => cb.value)).size;
}

function syncDuplicateCheckboxes(scope) {
    // Sync table ↔ mobile card checkboxes sharing the same value
    const byValue = {};
    scope.querySelectorAll('.reminder-checkbox').forEach(cb => {
        if (!byValue[cb.value]) byValue[cb.value] = [];
        byValue[cb.value].push(cb);
    });
    Object.values(byValue).forEach(group => {
        const checked = group.some(cb => cb.checked);
        const disabled = group.some(cb => cb.disabled);
        group.forEach(cb => { cb.checked = checked; cb.disabled = disabled; });
    });
}

function toggleReminderSelectAll(masterCb) {
    const table = masterCb.closest('table');
    const section = masterCb.closest('.reminder-section');
    if (masterCb.checked) {
        const seen = new Set();
        let count = getUniqueReminderCheckedCount();
        table.querySelectorAll('.reminder-checkbox').forEach(cb => {
            if (!seen.has(cb.value) && count < MAX_BULK_SEND) {
                seen.add(cb.value);
                count++;
            }
            cb.checked = seen.has(cb.value);
        });
    } else {
        table.querySelectorAll('.reminder-checkbox').forEach(cb => cb.checked = false);
    }
    if (section) syncDuplicateCheckboxes(section);
    // Sync section header checkbox
    if (section) {
        const headerCb = section.querySelector('.reminder-section-select-all');
        if (headerCb) {
            headerCb.checked = masterCb.checked;
            headerCb.indeterminate = false;
        }
    }
    updateReminderSelectedCount();
}

function toggleSectionSelectAll(headerCb) {
    const section = headerCb.closest('.reminder-section');
    if (headerCb.checked) {
        const seen = new Set();
        let count = getUniqueReminderCheckedCount();
        section.querySelectorAll('.reminder-checkbox').forEach(cb => {
            if (!seen.has(cb.value) && count < MAX_BULK_SEND) {
                seen.add(cb.value);
                count++;
            }
            cb.checked = seen.has(cb.value);
        });
    } else {
        section.querySelectorAll('.reminder-checkbox').forEach(cb => cb.checked = false);
    }
    syncDuplicateCheckboxes(section);
    // Sync the in-table select-all checkbox too
    const tableSelectAll = section.querySelector('.reminder-select-all');
    if (tableSelectAll) tableSelectAll.checked = headerCb.checked;
    updateReminderSelectedCount();
}

function syncMasterCheckboxes() {
    document.querySelectorAll('table').forEach(table => {
        const cbs = Array.from(table.querySelectorAll('.reminder-checkbox'));
        if (!cbs.length) return;
        const allChecked = cbs.every(cb => cb.checked);
        const someChecked = cbs.some(cb => cb.checked);
        const masterCb = table.querySelector('.reminder-select-all');
        if (masterCb) {
            masterCb.checked = allChecked;
            masterCb.indeterminate = !allChecked && someChecked;
        }
        const section = table.closest('.reminder-section');
        if (section) {
            const headerCb = section.querySelector('.reminder-section-select-all');
            if (headerCb) {
                headerCb.checked = allChecked;
                headerCb.indeterminate = !allChecked && someChecked;
            }
        }
    });
}

function updateReminderSelectedCount() {
    const checkedIds = [...new Set(Array.from(document.querySelectorAll('.reminder-checkbox:checked')).map(cb => cb.value))];
    const count = checkedIds.length;
    document.getElementById('reminderSelectedCount').textContent = count;
    // DL-257: Disable unchecked checkboxes at bulk cap
    document.querySelectorAll('.reminder-checkbox').forEach(cb => {
        if (!cb.checked) cb.disabled = count >= MAX_BULK_SEND;
    });
    syncMasterCheckboxes();

    const mutedCount = checkedIds.filter(id => {
        const r = remindersData.find(x => x.report_id === id);
        return r && r.reminder_suppress === 'forever';
    }).length;
    const allMuted = count > 0 && mutedCount === count;
    const mutedWarning = document.getElementById('reminderBulkMutedWarning');
    const activeActions = document.getElementById('reminderBulkActiveActions');
    const mutedActions = document.getElementById('reminderBulkMutedActions');
    if (mutedCount > 0 && !allMuted) {
        document.getElementById('reminderBulkMutedCount').textContent = mutedCount;
        mutedWarning.style.display = '';
    } else {
        mutedWarning.style.display = 'none';
    }
    if (activeActions) activeActions.style.display = allMuted ? 'none' : '';
    if (mutedActions) mutedActions.style.display = allMuted ? '' : 'none';

    const rbar = document.getElementById('reminderBulkActions');
    if (count > 0) {
        rbar.style.display = '';
        rbar.classList.add('floating-bulk-bar');
    } else {
        rbar.classList.remove('floating-bulk-bar');
        rbar.style.display = 'none';
    }
    safeCreateIcons();
}

function deselectMutedClients() {
    document.querySelectorAll('.reminder-checkbox:checked').forEach(cb => {
        const r = remindersData.find(x => x.report_id === cb.value);
        if (r && r.reminder_suppress === 'forever') cb.checked = false;
    });
    updateReminderSelectedCount();
}

function reminderAction(action, reportId) {
    document.querySelectorAll('.suppress-menu.open').forEach(m => m.classList.remove('open'));
    if (action === 'send_now') {
        const r = remindersData.find(x => x.report_id === reportId);
        if (r && isExhausted(r)) {
            const effectiveMax = r.reminder_max != null ? r.reminder_max : reminderDefaultMax;
            showConfirmDialog(
                `הלקוח כבר קיבל ${r.reminder_count} תזכורות (מתוך ${effectiveMax} מותרות). לשלוח בכל זאת?`,
                () => executeReminderAction(action, [reportId], null, true),
                'שלח בכל זאת'
            );
            return;
        }
        // 24h recency check moved to Worker — returns warning server-side
    }
    if (action === 'send_now') {
        const r = remindersData.find(x => x.report_id === reportId);
        const name = r ? (r.client_name || r.name || '') : '';
        showConfirmDialog(`לשלוח תזכורת ל${name}?`, () => executeReminderAction(action, [reportId]), 'שלח');
        return;
    }
    executeReminderAction(action, [reportId]);
}

function toggleStatusMenu(btn, e) {
    e.stopPropagation();
    const menu = btn.nextElementSibling;
    const wasOpen = menu.classList.contains('open');
    document.querySelectorAll('.suppress-menu.open').forEach(m => m.classList.remove('open'));
    if (!wasOpen) {
        positionFloating(btn, menu);
        menu.classList.add('open');
        const onEsc = (ke) => {
            if (ke.key === 'Escape') {
                menu.classList.remove('open');
                btn.focus();
                document.removeEventListener('keydown', onEsc);
            }
        };
        document.addEventListener('keydown', onEsc);
    }
}


function confirmSuppress(action, reportId, name) {
    document.querySelectorAll('.suppress-menu.open').forEach(m => m.classList.remove('open'));
    const msg = `להפסיק להזכיר ל${name}?`;
    showConfirmDialog(msg, () => executeReminderAction(action, [reportId]), 'השתק', true);
}

// Close suppress menus on outside click
document.addEventListener('click', () => {
    document.querySelectorAll('.suppress-menu.open').forEach(m => m.classList.remove('open'));
});

function reminderBulkAction(action) {
    const reportIds = [...new Set(Array.from(document.querySelectorAll('.reminder-checkbox:checked')).map(cb => cb.value))];
    if (reportIds.length === 0) return;

    if (action === 'send_now') {
        // 24h recency + pending classification checks handled server-side by Worker
        showConfirmDialog(`לשלוח תזכורת ל-${reportIds.length} לקוחות?`, () => executeReminderAction(action, reportIds), 'שלח');
        return;
    }
    if (action === 'suppress_forever') {
        showConfirmDialog(`להפסיק תזכורות ל-${reportIds.length} לקוחות?`, () => executeReminderAction(action, reportIds), 'השתק', true);
        return;
    }

    executeReminderAction(action, reportIds);
}

function setRowLoading(reportId, text) {
    const row = document.querySelector(`tr[data-report-id="${reportId}"]`);
    if (!row) return;
    row.classList.add('reminder-loading');
    const overlay = document.createElement('div');
    overlay.className = 'reminder-row-loading-overlay';
    overlay.innerHTML = `<div class="spinner"></div><span>${text || 'מעבד...'}</span>`;
    row.style.position = 'relative';
    row.appendChild(overlay);
}

function clearRowLoading(reportId) {
    const row = document.querySelector(`tr[data-report-id="${reportId}"]`);
    if (!row) return;
    row.classList.remove('reminder-loading');
    const overlay = row.querySelector('.reminder-row-loading-overlay');
    if (overlay) overlay.remove();
}

async function executeReminderAction(action, reportIds, value, forceOverride) {
    const isBulk = reportIds.length > 1;
    const actionLoadingLabels = {
        send_now: 'שולח...',
        suppress_forever: 'מפסיק תזכורות...',
        unsuppress: 'מפעיל...',
        change_date: 'מעדכן...',
        set_max: 'מעדכן...'
    };

    if (isBulk && action === 'send_now') {
        // Single batch request for all report IDs
        try {
            showLoading(`שולח ${reportIds.length} תזכורות...`, 95000);
            const body = { token: authToken, action, report_ids: reportIds };
            if (reminderDefaultMax != null) body.default_max = reminderDefaultMax;
            if (forceOverride) body.force_override = true;
            const response = await fetchWithTimeout(ENDPOINTS.ADMIN_REMINDERS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }, FETCH_TIMEOUTS.batch);
            let data;
            try { data = await response.json(); } catch (e) {
                hideLoading();
                showAIToast('שגיאה בשליחת תזכורות', 'danger');
                loadReminders(true);
                return;
            }
            hideLoading();
            if (data.ok) showAIToast('תזכורות נשלחו', 'success');
            else showAIToast(data.error || 'שגיאה בשליחת תזכורות', 'danger');
        } catch (err) {
            hideLoading();
            showAIToast('שגיאה בשליחת תזכורות', 'danger');
        }
        cancelReminderSelection();
        loadReminders(true);
        return;
    }

    if (isBulk) {
        showLoading('מעדכן...');
    } else {
        setRowLoading(reportIds[0], actionLoadingLabels[action] || 'מעבד...');
    }

    try {
        const body = { token: authToken, action, report_ids: reportIds };
        if (value !== undefined) body.value = value;
        if (action === 'send_now' && reminderDefaultMax != null) body.default_max = reminderDefaultMax;
        if (forceOverride) body.force_override = true;

        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_REMINDERS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, FETCH_TIMEOUTS.mutate);

        let data;
        try {
            data = await response.json();
        } catch (e) {
            throw new Error('השרת לא החזיר תשובה תקינה. נסה שוב.');
        }

        if (isBulk) hideLoading();
        else clearRowLoading(reportIds[0]);

        if (!data.ok) throw new Error(data.message || data.error || 'שגיאה לא ידועה');

        if (data.warning) {
            if (isBulk) hideLoading();
            else clearRowLoading(reportIds[0]);
            // Use innerHTML for formatted warning (contains <b> and <br>)
            const msgEl = document.getElementById('confirmDialogMessage');
            msgEl.innerHTML = data.warning + '<br><br>לשלוח בכל זאת?';
            _confirmCallback = () => executeReminderAction('send_now', data.report_ids || reportIds, null, true);
            const btn = document.getElementById('confirmDialogBtn');
            btn.textContent = 'שלח בכל זאת';
            btn.className = 'btn btn-primary';
            document.getElementById('confirmDialog').classList.add('show');
            return;
        }

        const actionLabels = {
            send_now: 'תזכורת נשלחה',
            suppress_forever: 'תזכורות הופסקו',
            unsuppress: 'תזכורות הופעלו מחדש',
            change_date: 'תאריך עודכן',
            set_max: 'מקסימום עודכן'
        };
        showAIToast(actionLabels[action] || 'עודכן בהצלחה', 'success');
        cancelReminderSelection();
        loadReminders(true);
    } catch (error) {
        if (isBulk) hideLoading();
        else clearRowLoading(reportIds[0]);
        showModal('error', 'שגיאה', error.message);
    }
}

function setManualReminder(reportId, clientName) {
    const today = new Date().toISOString().split('T')[0];
    const msgEl = document.getElementById('confirmDialogMessage');
    msgEl.innerHTML = `להגדיר תזכורת ל-${escapeHtml(clientName)}?<br><label style="display:block;margin-top:12px;font-size:14px;color:var(--text-secondary)">תאריך תזכורת:</label><input type="date" id="reminderDateInput" value="${today}" style="margin-top:4px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;width:100%;direction:ltr">`;
    _confirmCallback = () => {
        const date = document.getElementById('reminderDateInput').value || today;
        executeReminderAction('change_date', [reportId], date);
    };
    const btn = document.getElementById('confirmDialogBtn');
    btn.textContent = 'הגדר תזכורת';
    btn.className = 'btn btn-primary';
    document.getElementById('confirmDialog').classList.add('show');
}

async function sendDashboardReminder(reportId, clientName) {
    if (!reminderLoaded) {
        try {
            await loadReminders(true);
        } catch (e) {
            showConfirmDialog(
                `לשלוח תזכורת ל${clientName}?`,
                () => executeReminderAction('send_now', [reportId]),
                'שלח תזכורת'
            );
            return;
        }
    }
    reminderAction('send_now', reportId);
}

async function viewQuestionnaire(reportId) {
    let item = questionnairesData.find(i => i.report_record_id === reportId);
    if (!item) {
        try {
            showLoading('טוען שאלון...');
            const year = document.getElementById('questionnaireYearFilter')?.value || String(new Date().getFullYear() - 1);
            const response = await fetchWithTimeout(
                `${ENDPOINTS.ADMIN_QUESTIONNAIRES}?token=${encodeURIComponent(authToken)}&year=${encodeURIComponent(year)}&filing_type=${activeEntityTab}`,
                { method: 'GET' },
                FETCH_TIMEOUTS.load
            );
            const data = await response.json();
            hideLoading();
            if (data.ok && data.items) {
                questionnairesData = data.items;
                questionnaireLoaded = true;
                item = questionnairesData.find(i => i.report_record_id === reportId);
            }
        } catch (e) {
            hideLoading();
        }
    }
    if (!item) {
        showAIToast('לא נמצא שאלון עבור לקוח זה', 'warning');
        return;
    }
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
        showAIToast('לא ניתן לפתוח חלון. אפשר חלונות קופצים.', 'error');
        return;
    }
    win.document.write(generateQuestionnairePrintHTML([item]));
    win.document.close();
    win.focus();
}

function showReminderDatePicker(reportId, currentDate) {
    const input = document.createElement('input');
    input.type = 'date';
    input.value = currentDate || '';
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
        if (input.value) {
            await executeReminderAction('change_date', [reportId], input.value);
        }
        input.remove();
    });

    input.addEventListener('blur', () => {
        setTimeout(() => input.remove(), 200);
    });

    input.showPicker();
}

function editReminderDate(reportId, cell) {
    const popover = document.getElementById('reminderDatePopover');
    // Toggle off if already open for this report
    if (popover.style.display !== 'none' && popover.dataset.reportId === reportId) {
        closeDatePopover();
        return;
    }

    const r = remindersData.find(x => x.report_id === reportId);
    if (!r) return;
    const currentDate = r.reminder_next_date || '';

    const addTime = (days, months = 0) => {
        const d = new Date();
        if (months) d.setMonth(d.getMonth() + months);
        if (days) d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
    };

    popover.dataset.reportId = reportId;
    popover.innerHTML = `
        <div class="date-editor-title">עריכת תאריך תזכורת</div>
        <input type="date" value="${currentDate}" class="date-editor-input" id="dateEditorInput">
        <div class="date-quick-picks">
            <button class="date-quick-pick" data-date="${addTime(7)}">שבוע</button>
            <button class="date-quick-pick" data-date="${addTime(0, 1)}">חודש</button>
            <button class="date-quick-pick" data-date="${addTime(0, 2)}">חודשיים</button>
        </div>
        <div class="date-editor-actions">
            <button class="btn btn-primary btn-sm" id="dateEditorSave">שמור</button>
            <button class="btn btn-ghost btn-sm" id="dateEditorCancel">ביטול</button>
        </div>`;

    positionFloating(cell, popover);
    popover.style.display = 'block';

    const input = popover.querySelector('#dateEditorInput');
    input.focus();

    const save = () => {
        const val = input.value;
        if (val) {
            closeDatePopover();
            executeReminderAction('change_date', [reportId], val);
        }
    };

    popover.querySelector('#dateEditorSave').addEventListener('click', (e) => { e.stopPropagation(); save(); });
    popover.querySelector('#dateEditorCancel').addEventListener('click', (e) => { e.stopPropagation(); closeDatePopover(); });
    popover.querySelectorAll('.date-quick-pick').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            input.value = btn.dataset.date;
            save();
        });
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { e.preventDefault(); closeDatePopover(); }
    });

    requestAnimationFrame(() => {
        document.addEventListener('click', handleDatePopoverOutsideClick);
    });
}

function handleDatePopoverOutsideClick(e) {
    const popover = document.getElementById('reminderDatePopover');
    if (popover && !popover.contains(e.target)) closeDatePopover();
}

function closeDatePopover() {
    const popover = document.getElementById('reminderDatePopover');
    if (popover) popover.style.display = 'none';
    document.removeEventListener('click', handleDatePopoverOutsideClick);
}

// ==================== REMINDER SETTINGS MODAL ====================

function openReminderSettingsModal() {
    document.getElementById('settingsDefaultMaxInput').value =
        reminderDefaultMax != null ? reminderDefaultMax : '';
    document.getElementById('reminderSettingsModal').classList.add('show');
    document.getElementById('settingsDefaultMaxInput').focus();
    safeCreateIcons();
}

function closeReminderSettingsModal() {
    document.getElementById('reminderSettingsModal').classList.remove('show');
}

async function saveReminderSettings() {
    const maxVal = document.getElementById('settingsDefaultMaxInput').value.trim();

    // Warn if new default max would exhaust active clients
    if (maxVal !== '') {
        const newMax = parseInt(maxVal);
        const affected = remindersData.filter(r =>
            r.reminder_max == null && !r.reminder_suppress &&
            (r.reminder_count || 0) >= newMax
        );
        if (affected.length > 0) {
            closeReminderSettingsModal();
            showConfirmDialog(
                `${affected.length} לקוחות כבר שלחו ${newMax} תזכורות או יותר ויסומנו כ"מוצה". להמשיך?`,
                () => doSaveReminderSettings(maxVal),
                'המשך ושמור'
            );
            return;
        }
    }

    closeReminderSettingsModal();
    doSaveReminderSettings(maxVal);
}

async function doSaveReminderSettings(maxVal) {
    showLoading('שומר הגדרות...');
    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_REMINDERS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                action: 'update_configs',
                configs: { reminder_default_max: maxVal }
            })
        }, FETCH_TIMEOUTS.rollover);
        const data = await response.json();
        hideLoading();
        if (!data.ok) throw new Error('שגיאה בשמירת הגדרות');
        showAIToast('הגדרות תזכורות עודכנו', 'success');
        remindersData = data.items || [];
        reminderDefaultMax = data.default_max !== undefined ? data.default_max : null;
        updateReminderStats(data.stats || {});
        filterReminders();
    } catch (error) {
        hideLoading();
        showModal('error', 'שגיאה', error.message);
    }
}

// ==================== REMINDER INLINE EDIT ====================

function editClientMax(reportId, cell) {
    if (cell.querySelector('.reminder-max-editor')) return;
    const r = remindersData.find(x => x.report_id === reportId);
    if (!r) return;
    const currentMax = r.reminder_max;

    cell.innerHTML = `<span class="reminder-max-editor">
        <input type="number" min="1" max="999" placeholder="∞" value="${currentMax != null ? currentMax : ''}" class="reminder-max-input">
        <button class="reminder-max-save" title="שמור">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <button class="reminder-max-cancel" title="ביטול">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    </span>`;
    const input = cell.querySelector('.reminder-max-input');
    input.focus();
    input.select();

    const save = async () => {
        const val = input.value.trim();
        const saveBtn = cell.querySelector('.reminder-max-save');
        const cancelBtn = cell.querySelector('.reminder-max-cancel');

        // Determine new value
        let newMax = null;
        if (val !== '') {
            const num = parseInt(val);
            if (!(num > 0)) { restoreMaxCell(cell, r, reportId); return; }
            newMax = num;
        }

        // Show saving state inline
        input.disabled = true;
        saveBtn.disabled = true;
        cancelBtn.style.display = 'none';
        saveBtn.innerHTML = '<span class="reminder-max-spinner"></span>';

        try {
            const body = { token: authToken, action: 'set_max', report_ids: [reportId], value: newMax };
            const response = await fetchWithTimeout(ENDPOINTS.ADMIN_REMINDERS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }, FETCH_TIMEOUTS.mutate);
            const data = await response.json();
            if (!data.ok) throw new Error(data.message || data.error || 'שגיאה');

            // Update local data optimistically
            r.reminder_max = newMax;
            restoreMaxCell(cell, r, reportId);
            showAIToast('מקסימום עודכן', 'success');

            // Silent background refresh for stats
            if (data.items) { remindersData = data.items; }
            if (data.stats) { updateReminderStats(data.stats); }
        } catch (error) {
            restoreMaxCell(cell, r, reportId);
            showAIToast(error.message || 'שגיאה בעדכון', 'error');
        }
    };

    cell.querySelector('.reminder-max-save').addEventListener('click', (e) => { e.stopPropagation(); save(); });
    cell.querySelector('.reminder-max-cancel').addEventListener('click', (e) => { e.stopPropagation(); restoreMaxCell(cell, r, reportId); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { e.preventDefault(); restoreMaxCell(cell, r, reportId); }
    });
}

function restoreMaxCell(cell, r, reportId) {
    const hasCustom = r.reminder_max != null;
    const effectiveMax = hasCustom ? r.reminder_max : reminderDefaultMax;
    const safeMax = isFinite(effectiveMax) ? String(effectiveMax) : '—';
    if (hasCustom) {
        cell.className = 'reminder-max-cell reminder-max-custom';
        cell.innerHTML = `${safeMax} <button class="reminder-reset-btn" onclick="event.stopPropagation(); resetClientMax('${escapeAttr(reportId)}')" title="איפוס לברירת מחדל">↺</button>`;
    } else if (effectiveMax != null) {
        cell.className = 'reminder-max-cell reminder-max-default';
        cell.innerHTML = `${safeMax}`;
    } else {
        cell.className = 'reminder-max-cell reminder-max-unlimited';
        cell.innerHTML = 'ללא הגבלה';
    }
}

function saveClientMax(reportId, maxValue) {
    // Legacy — inline save now handled directly in editClientMax
    executeReminderAction('set_max', [reportId], maxValue);
}

async function resetClientMax(reportId) {
    const r = remindersData.find(x => x.report_id === reportId);
    const cell = document.getElementById(`max-cell-${reportId}`);
    if (!r || !cell) { executeReminderAction('set_max', [reportId], null); return; }

    // Show inline spinner on the reset button
    const resetBtn = cell.querySelector('.reminder-reset-btn');
    if (resetBtn) { resetBtn.innerHTML = '<span class="reminder-max-spinner"></span>'; resetBtn.disabled = true; }

    try {
        const body = { token: authToken, action: 'set_max', report_ids: [reportId], value: null };
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_REMINDERS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, FETCH_TIMEOUTS.mutate);
        const data = await response.json();
        if (!data.ok) throw new Error(data.message || data.error || 'שגיאה');

        r.reminder_max = null;
        restoreMaxCell(cell, r, reportId);
        showAIToast('אופס לברירת מחדל', 'success');
        if (data.items) { remindersData = data.items; }
        if (data.stats) { updateReminderStats(data.stats); }
    } catch (error) {
        restoreMaxCell(cell, r, reportId);
        showAIToast(error.message || 'שגיאה באיפוס', 'error');
    }
}

// ==================== REPORT NOTES ====================

function editReportNotes(event, reportId) {
    event.stopPropagation();
    const cell = event.currentTarget;
    if (cell.querySelector('textarea')) return;
    const client = clientsData.find(c => c.report_id === reportId);
    if (!client) return;
    const currentNotes = client.notes || '';
    cell.innerHTML = `<textarea class="notes-editor">${escapeHtml(currentNotes)}</textarea>`;
    const textarea = cell.querySelector('textarea');
    textarea.focus();
    textarea.style.height = textarea.scrollHeight + 'px';
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    });
    textarea.addEventListener('blur', () => saveReportNotes(reportId, textarea.value, cell));
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); restoreNotesCell(cell, client); }
    });
    textarea.addEventListener('click', (e) => e.stopPropagation());
}

function restoreNotesCell(cell, client) {
    const text = client.notes || '';
    cell.title = text;
    cell.innerHTML = `<span class="notes-text">${escapeHtml(text.substring(0, 60))}${text.length > 60 ? '…' : ''}</span>`;
}

async function saveReportNotes(reportId, newText, cell) {
    const client = clientsData.find(c => c.report_id === reportId);
    if (!client) return;
    const oldText = client.notes || '';
    if (newText === oldText) { restoreNotesCell(cell, client); return; }
    client.notes = newText;
    restoreNotesCell(cell, client);
    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_UPDATE_CLIENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: authToken, report_id: reportId, action: 'update-notes', notes: newText })
        });
        const result = await response.json();
        if (result.ok) {
            showAIToast('הערה נשמרה', 'success');
        } else {
            throw new Error(result.error || 'Failed');
        }
    } catch (err) {
        client.notes = oldText;
        restoreNotesCell(cell, client);
        showAIToast('שגיאה בשמירת הערה', 'error');
    }
}

// ==================== DEACTIVATE / ARCHIVE ====================

function deactivateClient(reportId, clientName) {
    showConfirmDialog(
        `האם להעביר את "${clientName}" לארכיון? הלקוח לא יופיע ברשימה ולא יקבל תזכורות.`,
        () => executeToggleActive(reportId, false),
        'העבר לארכיון',
        true
    );
}

function reactivateClient(reportId) {
    executeToggleActive(reportId, true);
}

async function executeToggleActive(reportId, active) {
    const client = clientsData.find(c => c.report_id === reportId);
    if (!client) return;

    const previousActive = client.is_active;
    const clientName = client.name;

    // Optimistic update
    client.is_active = active;
    recalculateStats();
    filterClients();

    try {

        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_TOGGLE_ACTIVE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: authToken, report_id: reportId, active })
        }, FETCH_TIMEOUTS.mutate);

        const data = await response.json();


        if (!data.ok) {
            throw new Error(data.error || 'שגיאה לא ידועה');
        }

        if (!active) {
            showAIToast(`"${clientName}" הועבר לארכיון`, 'success', {
                label: 'בטל',
                onClick: () => executeToggleActive(reportId, true)
            });
        } else {
            showAIToast(`"${clientName}" הופעל מחדש`, 'success');
        }
    } catch (error) {
        // Revert optimistic update
        client.is_active = previousActive;
        recalculateStats();
        filterClients();
        showAIToast('שגיאה בעדכון: ' + error.message, 'danger');
    }
}

// ==================== CLIENT DETAIL MODAL ====================

async function openClientDetailModal(reportId) {
    document.getElementById('clientDetailReportId').value = reportId;
    document.getElementById('clientDetailName').value = '';
    document.getElementById('clientDetailEmail').value = '';
    document.getElementById('clientDetailCcEmail').value = '';
    document.getElementById('clientDetailPhone').value = '';

    // Show modal with loading state
    document.getElementById('clientDetailLoading').style.display = '';
    document.getElementById('clientDetailFields').style.display = 'none';
    document.getElementById('clientDetailSavingOverlay').style.display = 'none';
    document.getElementById('clientDetailModal').classList.add('show');

    try {

        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_UPDATE_CLIENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: authToken, report_id: reportId, action: 'get' })
        }, FETCH_TIMEOUTS.load);
        const data = await response.json();


        if (!data.ok) throw new Error(data.error || 'שגיאה בטעינה');

        document.getElementById('clientDetailName').value = data.client.name || '';
        document.getElementById('clientDetailEmail').value = data.client.email || '';
        document.getElementById('clientDetailCcEmail').value = data.client.cc_email || '';
        document.getElementById('clientDetailPhone').value = data.client.phone || '';

        // Swap loading → fields
        document.getElementById('clientDetailLoading').style.display = 'none';
        document.getElementById('clientDetailFields').style.display = '';
    } catch (error) {
        closeClientDetailModal();
        showAIToast('שגיאה בטעינת פרטי לקוח: ' + error.message, 'danger');
    }
}

function closeClientDetailModal() {
    document.getElementById('clientDetailModal').classList.remove('show');
    document.getElementById('clientDetailReportId').value = '';
    document.getElementById('clientDetailName').value = '';
    document.getElementById('clientDetailEmail').value = '';
    document.getElementById('clientDetailCcEmail').value = '';
    document.getElementById('clientDetailPhone').value = '';
}

async function saveClientDetails() {
    const reportId = document.getElementById('clientDetailReportId').value;
    const name = document.getElementById('clientDetailName').value.trim();
    const email = document.getElementById('clientDetailEmail').value.trim().toLowerCase();
    const cc_email = document.getElementById('clientDetailCcEmail').value.trim().toLowerCase();
    const phone = document.getElementById('clientDetailPhone').value.trim();

    if (!name) {
        showAIToast('יש להזין שם', 'warning');
        return;
    }
    if (!isValidEmail(email)) {
        showAIToast('כתובת אימייל לא תקינה', 'warning');
        return;
    }

    const doSave = async () => {
        document.getElementById('clientDetailSavingOverlay').style.display = '';
        try {
    
            const response = await fetchWithTimeout(ENDPOINTS.ADMIN_UPDATE_CLIENT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: authToken, report_id: reportId, action: 'update', name, email, cc_email, phone })
            }, FETCH_TIMEOUTS.mutate);
            const data = await response.json();


            if (!data.ok) throw new Error(data.error || 'שגיאה בשמירה');

            // Optimistic update in clientsData
            const client = clientsData.find(c => c.report_id === reportId);
            if (client) {
                client.name = name;
                client.email = email;
                client.cc_email = cc_email;
                client.phone = phone;
                filterClients();
            }

            closeClientDetailModal();
            showAIToast('פרטי הלקוח עודכנו בהצלחה', 'success');
        } catch (error) {
            document.getElementById('clientDetailSavingOverlay').style.display = 'none';
            showAIToast('שגיאה בשמירה: ' + error.message, 'danger');
        }
    };

    // If email changed, confirm first
    const client = clientsData.find(c => c.report_id === reportId);
    if (client && client.email !== email) {
        showConfirmDialog(
            `שינוי כתובת אימייל מ-"${client.email}" ל-"${email}"?\n\nשים לב: הלקוח ישתמש בכתובת החדשה מהפעם הבאה.`,
            doSave,
            'שנה אימייל',
            true
        );
    } else {
        await doSave();
    }
}

function toggleArchiveMode() {
    showArchivedMode = !showArchivedMode;
    const banner = document.getElementById('archiveBanner');
    const headerLabel = document.getElementById('headerArchiveLabel');
    const menuLabel = document.getElementById('headerArchiveMenuLabel');
    const statsGrid = document.getElementById('statsGrid');

    if (showArchivedMode) {
        banner.classList.add('visible');
        headerLabel.textContent = '— ארכיון';
        menuLabel.textContent = 'חזרה לרשימה';
        statsGrid.style.display = 'none';
    } else {
        banner.classList.remove('visible');
        headerLabel.textContent = '';
        menuLabel.textContent = 'לקוחות עבר';
        statsGrid.style.display = '';
    }

    resetClientBulkSelection();
    filterClients();
    safeCreateIcons();
}

// ==================== ROW MENU / CONTEXT MENU ====================

function closeAllRowMenus() {
    document.querySelectorAll('.row-menu.open').forEach(m => m.classList.remove('open'));
    const ctx = document.getElementById('clientContextMenu');
    if (ctx) { ctx.style.display = 'none'; ctx.classList.remove('open'); }
    // Close tab dropdown
    const tabMenu = document.getElementById('tabDropdownMenu');
    if (tabMenu) {
        tabMenu.classList.remove('open');
        const tabBtn = document.querySelector('.tab-dropdown-wrapper > .tab-item');
        if (tabBtn) tabBtn.setAttribute('aria-expanded', 'false');
    }
}

function toggleRowMenu(btn, e) {
    e.stopPropagation();
    const menu = btn.nextElementSibling;
    const wasOpen = menu.classList.contains('open');
    closeAllRowMenus();
    if (!wasOpen) {
        positionFloating(btn, menu);
        menu.classList.add('open');
    }
}

function toggleHeaderMore(btn, e) {
    e.stopPropagation();
    const menu = document.getElementById('headerMoreMenu');
    const wasOpen = menu.classList.contains('open');
    closeAllRowMenus();
    if (!wasOpen) {
        positionFloating(btn, menu);
        menu.classList.add('open');
    }
}

function openClientContextMenu(e) {
    const tr = e.target.closest('tr');
    if (!tr || !tr.dataset.reportId) return;
    e.preventDefault();
    closeAllRowMenus();

    const rid = tr.dataset.reportId;
    const cName = tr.dataset.clientName;
    const stage = tr.dataset.stage;
    const isActive = tr.dataset.isActive === 'true';

    const menu = document.getElementById('clientContextMenu');
    let items = '';

    const stageNum = STAGES[stage]?.num || 0;
    if (isActive) {
        if (stage === 'Send_Questionnaire') {
            items += `<button onclick="sendSingle('${rid}'); closeAllRowMenus();"><i data-lucide="send"></i> שלח שאלון</button>`;
        }
        if (stage === 'Waiting_For_Answers' || stage === 'Collecting_Docs') {
            items += `<button onclick="sendDashboardReminder('${rid}', '${cName}'); closeAllRowMenus();"><i data-lucide="bell-ring"></i> שלח תזכורת</button>`;
        }
        if (stageNum >= 3) {
            items += `<button onclick="viewQuestionnaire('${rid}'); closeAllRowMenus();"><i data-lucide="file-text"></i> צפה בשאלון</button>`;
        }
        items += `<button onclick="viewClient('${rid}'); closeAllRowMenus();"><i data-lucide="external-link"></i> צפייה כלקוח</button>`;
        const ctxClient = clientsData.find(c => c.report_id === rid);
        if (ctxClient) {
            const ctxOtherType = getClientOtherFilingType(ctxClient.email, ctxClient.year);
            if (ctxOtherType) {
                const ctxLabel = FILING_TYPE_LABELS[ctxOtherType];
                items += `<button onclick="addSecondFilingType('${rid}'); closeAllRowMenus();"><i data-lucide="file-plus"></i> הוסף ${ctxLabel}</button>`;
            }
        }
        items += `<hr>`;
        items += `<button class="danger" onclick="deactivateClient('${rid}', '${cName}'); closeAllRowMenus();"><i data-lucide="archive"></i> העבר לארכיון</button>`;
    } else {
        items += `<button onclick="viewClient('${rid}'); closeAllRowMenus();"><i data-lucide="external-link"></i> צפייה כלקוח</button>`;
        items += `<hr>`;
        items += `<button onclick="reactivateClient('${rid}'); closeAllRowMenus();"><i data-lucide="archive-restore"></i> הפעל מחדש</button>`;
    }

    menu.innerHTML = items;

    // Position at cursor, clamped to viewport
    menu.style.display = 'block';
    menu.style.visibility = 'hidden';
    const mRect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = e.clientY;
    let left = e.clientX;
    if (top + mRect.height > vh - 8) top = vh - mRect.height - 8;
    if (left + mRect.width > vw - 8) left = vw - mRect.width - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    menu.style.top = top + 'px';
    menu.style.right = 'auto';
    menu.style.left = left + 'px';
    menu.style.bottom = '';
    menu.style.maxHeight = '';
    menu.style.visibility = '';
    menu.classList.add('open');

    safeCreateIcons();
}

// ==================== BULK ACTIONS (CHECKBOXES) ====================

function toggleClientSelectAll(masterCb) {
    const table = masterCb.closest('table');
    if (!table) return;
    const cbs = table.querySelectorAll('.dashboard-client-checkbox');
    if (masterCb.checked) {
        let count = 0;
        cbs.forEach(cb => {
            cb.checked = count < MAX_BULK_SEND;
            count++;
        });
    } else {
        cbs.forEach(cb => cb.checked = false);
    }
    updateClientSelectedCount();
}

function updateClientSelectedCount() {
    const checked = document.querySelectorAll('.dashboard-client-checkbox:checked');
    const count = checked.length;
    // Disable unchecked checkboxes when at limit
    document.querySelectorAll('.dashboard-client-checkbox').forEach(cb => {
        if (!cb.checked) cb.disabled = count >= MAX_BULK_SEND;
    });
    const bar = document.getElementById('clientBulkActions');
    const countEl = document.getElementById('clientSelectedCount');
    const sendBtn = document.getElementById('bulkSendBtn');
    const archiveBtn = document.getElementById('bulkArchiveBtn');

    countEl.textContent = count;

    if (count > 0) {
        bar.classList.add('visible', 'floating-bulk-bar');
    } else {
        bar.classList.remove('visible', 'floating-bulk-bar');
        return;
    }

    // Check if all selected are stage 1 → show send button
    let allStage1 = true;
    checked.forEach(cb => {
        const tr = cb.closest('tr');
        if (tr && tr.dataset.stage !== 'Send_Questionnaire') allStage1 = false;
    });
    sendBtn.style.display = allStage1 ? '' : 'none';

    // In archive mode, switch archive button to reactivate
    if (showArchivedMode) {
        archiveBtn.innerHTML = '<i data-lucide="archive-restore" class="icon-sm"></i> הפעל מחדש';
        archiveBtn.className = 'btn btn-sm btn-outline-success';
    } else {
        archiveBtn.innerHTML = '<i data-lucide="archive" class="icon-sm"></i> העבר לארכיון';
        archiveBtn.className = 'btn btn-sm btn-danger';
    }
    safeCreateIcons();
}

function resetClientBulkSelection() {
    document.querySelectorAll('.dashboard-client-checkbox, .dashboard-select-all').forEach(cb => cb.checked = false);
    updateClientSelectedCount();
}

function cancelReminderSelection() {
    document.querySelectorAll('.reminder-checkbox, .reminder-select-all, .reminder-section-select-all').forEach(cb => { cb.checked = false; cb.disabled = false; cb.indeterminate = false; });
    updateReminderSelectedCount();
}

function cancelSendSelection() {
    document.querySelectorAll('.client-checkbox').forEach(cb => cb.checked = false);
    const selectAll = document.getElementById('selectAll');
    if (selectAll) selectAll.checked = false;
    updateSelectedCount();
}

function bulkArchiveClients() {
    const checked = document.querySelectorAll('.dashboard-client-checkbox:checked');
    if (checked.length === 0) return;

    const ids = Array.from(checked).map(cb => cb.value);
    const active = !showArchivedMode; // active mode → archive; archive mode → reactivate
    const action = active ? 'להעביר לארכיון' : 'להפעיל מחדש';

    showConfirmDialog(
        `${action} ${ids.length} לקוחות?`,
        async () => {
            for (const id of ids) {
                await executeToggleActive(id, !active);
            }
            resetClientBulkSelection();
        },
        active ? 'העבר לארכיון' : 'הפעל מחדש',
        active
    );
}

function bulkSendQuestionnaires() {
    const checked = document.querySelectorAll('.dashboard-client-checkbox:checked');
    if (checked.length === 0) return;

    const ids = Array.from(checked).map(cb => cb.value);

    showConfirmDialog(
        `לשלוח שאלון ל-${ids.length} לקוחות?`,
        () => {
            sendQuestionnaires(ids);
            resetClientBulkSelection();
        },
        'שלח'
    );
}

// ==================== UTILITIES ====================

function viewClient(reportId) {
    // Admin token is already in localStorage (same origin) — view-documents.html reads it directly
    window.open(`https://liozshor.github.io/annual-reports-client-portal/view-documents.html?report_id=${encodeURIComponent(reportId)}`, '_blank');
}

function viewClientDocs(reportId) {
    const client = clientsData.find(c => c.report_id === reportId);
    const clientId = client?.client_id;
    if (clientId) {
        const ft = client.filing_type || activeEntityTab || '';
        const tabParam = ft ? `&tab=${encodeURIComponent(ft)}` : '';
        window.location.href = `../document-manager.html?client_id=${encodeURIComponent(clientId)}${tabParam}`;
    }
}

function exportToExcel() {
    if (!clientsData.length) return;

    const exportData = clientsData.map(c => ({
        'שם': c.name,
        'אימייל': c.email,
        'שנה': c.year,
        'שלב': c.stage,
        'מסמכים שהתקבלו': c.docs_received,
        'סה"כ מסמכים': c.docs_total
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'לקוחות');
    XLSX.writeFile(wb, `clients_export_${new Date().toISOString().split('T')[0]}.xlsx`);
}

let _loadingSafetyTimer = null;

function showLoading(text, safetyMs = 25000) {
    document.getElementById('loadingText').textContent = text || 'מעבד...';
    document.getElementById('loadingOverlay').classList.add('visible');

    // Safety timeout: auto-hide and show error
    clearTimeout(_loadingSafetyTimer);
    _loadingSafetyTimer = setTimeout(function () {
        hideLoading();
        showModal('error', 'שגיאה', 'הפעולה ארכה זמן רב מדי. אנא נסו שוב.');
    }, safetyMs);
}

function hideLoading() {
    clearTimeout(_loadingSafetyTimer);
    _loadingSafetyTimer = null;
    document.getElementById('loadingOverlay').classList.remove('visible');
}

function showModal(type, title, body, stats = null, action = null) {
    const icons = {
        success: '<i data-lucide="circle-check" class="icon-2xl"></i>',
        error: '<i data-lucide="circle-alert" class="icon-2xl"></i>',
        warning: '<i data-lucide="alert-triangle" class="icon-2xl"></i>'
    };
    document.getElementById('modalIcon').innerHTML = icons[type] || '<i data-lucide="circle-check" class="icon-2xl"></i>';
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').textContent = body;

    if (stats) {
        let statsHtml = '';
        if (stats.created !== undefined) {
            statsHtml += `<div class="modal-stat"><div class="modal-stat-number">${stats.created}</div><div class="modal-stat-label">נוצרו</div></div>`;
        }
        if (stats.skipped !== undefined) {
            statsHtml += `<div class="modal-stat"><div class="modal-stat-number" style="color: var(--warning-500)">${stats.skipped}</div><div class="modal-stat-label">דולגו</div></div>`;
        }
        if (stats.sent !== undefined) {
            statsHtml += `<div class="modal-stat"><div class="modal-stat-number">${stats.sent}</div><div class="modal-stat-label">נשלחו</div></div>`;
        }
        if (stats.failed !== undefined && stats.failed > 0) {
            statsHtml += `<div class="modal-stat"><div class="modal-stat-number" style="color: var(--danger-500)">${stats.failed}</div><div class="modal-stat-label">נכשלו</div></div>`;
        }
        document.getElementById('modalStats').innerHTML = statsHtml;
    } else {
        document.getElementById('modalStats').innerHTML = '';
    }

    // Action button (e.g. refresh) — rendered before סגור
    const actionsEl = document.getElementById('modalActions');
    if (action && action.label && action.onClick) {
        actionsEl.innerHTML = `<button class="btn btn-primary" id="modalActionBtn">${action.label}</button>`
            + `<button class="btn btn-ghost" onclick="closeModal()">סגור</button>`;
        document.getElementById('modalActionBtn').addEventListener('click', () => { closeModal(); action.onClick(); });
    } else {
        actionsEl.innerHTML = '<button class="btn btn-primary" onclick="closeModal()">סגור</button>';
    }

    document.getElementById('resultModal').classList.add('visible');
    safeCreateIcons();

    if (type === 'success') {
        setTimeout(() => closeModal(), 3000);
    }
}

function closeModal() {
    document.getElementById('resultModal').classList.remove('visible');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

/** Escape HTML but preserve <b></b> tags for SSOT doc name formatting */
function renderDocLabel(name) {
    return escapeHtml(name).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ==================== INLINE CONFIRM (AI Review cards) ====================

function showInlineConfirm(recordId, message, onConfirm, opts = {}) {
    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;
    const actionsDiv = card.querySelector('.ai-card-actions');
    if (!actionsDiv) return;

    // Cancel any existing inline confirm on this card
    cancelInlineConfirm(recordId);

    // Store original HTML
    actionsDiv.dataset.originalHtml = actionsDiv.innerHTML;

    const dangerClass = opts.danger ? 'danger' : '';
    const btnClass = opts.danger ? 'btn-danger' : (opts.btnClass || 'btn-primary');
    const confirmText = opts.confirmText || 'אישור';

    actionsDiv.innerHTML = `
        <div class="ai-inline-confirm ${dangerClass}">
            <span class="ai-inline-confirm-msg">${escapeHtml(message)}</span>
            <button class="btn btn-sm ${btnClass} ai-inline-confirm-btn" disabled>${escapeHtml(confirmText)}</button>
            <button class="btn btn-ghost btn-sm ai-inline-cancel-btn">ביטול</button>
        </div>
    `;

    const confirmBtn = actionsDiv.querySelector('.ai-inline-confirm-btn');
    const cancelBtn = actionsDiv.querySelector('.ai-inline-cancel-btn');

    // Enable confirm button after 150ms (double-click protection)
    setTimeout(() => { if (confirmBtn.isConnected) confirmBtn.disabled = false; }, 150);

    // Escape key handler
    function escapeHandler(e) {
        if (e.key === 'Escape') cancelInlineConfirm(recordId);
    }
    document.addEventListener('keydown', escapeHandler);
    card._inlineConfirmCleanup = () => document.removeEventListener('keydown', escapeHandler);

    cancelBtn.addEventListener('click', () => cancelInlineConfirm(recordId));
    confirmBtn.addEventListener('click', () => {
        if (card._inlineConfirmCleanup) { card._inlineConfirmCleanup(); card._inlineConfirmCleanup = null; }
        onConfirm();
    });
}

function cancelInlineConfirm(recordId) {
    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;
    const actionsDiv = card.querySelector('.ai-card-actions');
    if (!actionsDiv || !actionsDiv.dataset.originalHtml) return;

    // Clean up escape handler
    if (card._inlineConfirmCleanup) { card._inlineConfirmCleanup(); card._inlineConfirmCleanup = null; }

    actionsDiv.innerHTML = actionsDiv.dataset.originalHtml;
    delete actionsDiv.dataset.originalHtml;

    // Re-initialize inline comboboxes if present
    actionsDiv.querySelectorAll('.doc-combobox-container').forEach(el => {
        let docs = [];
        try { docs = JSON.parse(el.dataset.docs); } catch (e) { /* skip */ }
        createDocCombobox(el, docs, {
            onSelect: (templateId) => {
                const btn = actionsDiv.querySelector('.btn-ai-assign-confirm');
                if (btn) btn.disabled = !templateId;
            }
        });
    });

    safeCreateIcons();
}

// ==================== CONFIRM DIALOG ====================

let _confirmCallback = null;

function showConfirmDialog(message, onConfirm, confirmText = 'אישור', danger = false) {
    _confirmCallback = onConfirm;
    document.getElementById('confirmDialogMessage').textContent = message;
    const btn = document.getElementById('confirmDialogBtn');
    btn.textContent = confirmText;
    btn.className = danger ? 'btn confirm-btn-danger' : 'btn btn-primary';
    document.getElementById('confirmDialog').classList.add('show');
    safeCreateIcons();
}

function closeConfirmDialog(confirmed) {
    document.getElementById('confirmDialog').classList.remove('show');
    const cb = _confirmCallback;
    _confirmCallback = null;
    if (confirmed && cb) cb();
}

// DL-222: 3-option conflict dialog for approve with existing file
function showApproveConflictDialog(docTitle, existingName, newName, onMerge, onKeepBoth, onOverride) {
    // Reuse the confirm dialog container but inject custom content
    const dialog = document.getElementById('confirmDialog');
    const msgEl = document.getElementById('confirmDialogMessage');
    const btnEl = document.getElementById('confirmDialogBtn');
    const footerEl = btnEl.parentElement;

    // Save original footer HTML for restoration
    const originalFooterHtml = footerEl.innerHTML;

    msgEl.innerHTML = `<strong>למסמך "${escapeHtml(docTitle)}" כבר קיים קובץ מאושר.</strong>`
        + `<div style="margin-top:8px;font-size:0.92em;color:var(--gray-600)">`
        + `<div>קובץ קיים: <strong>${escapeHtml(existingName)}</strong></div>`
        + `<div>קובץ חדש: <strong>${escapeHtml(newName)}</strong></div>`
        + `</div>`
        + `<div style="margin-top:12px">מה לעשות?</div>`;

    footerEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;width:100%">
            <button class="btn btn-primary" id="conflictMergeBtn">
                <i data-lucide="merge" class="icon-sm"></i> מזג קבצים
            </button>
            <button class="btn btn-outline" id="conflictKeepBothBtn">
                <i data-lucide="copy-plus" class="icon-sm"></i> שמור שניהם
            </button>
            <button class="btn confirm-btn-danger" id="conflictOverrideBtn">
                <i data-lucide="replace" class="icon-sm"></i> החלף קובץ
            </button>
            <button class="btn btn-ghost" id="conflictCancelBtn">ביטול</button>
        </div>
    `;

    function cleanup() {
        dialog.classList.remove('show');
        footerEl.innerHTML = originalFooterHtml;
    }

    document.getElementById('conflictMergeBtn').addEventListener('click', () => { cleanup(); onMerge(); });
    document.getElementById('conflictKeepBothBtn').addEventListener('click', () => { cleanup(); onKeepBoth(); });
    document.getElementById('conflictOverrideBtn').addEventListener('click', () => { cleanup(); onOverride(); });
    document.getElementById('conflictCancelBtn').addEventListener('click', () => { cleanup(); });

    dialog.classList.add('show');
    safeCreateIcons();
}

// ==================== YEAR DROPDOWNS ====================

function populateYearDropdowns() {
    const currentYear = new Date().getFullYear();
    const taxYear = currentYear - 1; // CPA tax year: working on last year's reports

    // All standard dropdowns — single tax year
    const yearSelects = ['manualYear', 'importYear', 'sendYearFilter'];
    for (const id of yearSelects) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.innerHTML = `<option value="${taxYear}" selected>${taxYear}</option>`;
    }

    // Dashboard year filter — "All" + tax year
    const yearFilter = document.getElementById('yearFilter');
    if (yearFilter) {
        yearFilter.innerHTML = `<option value="">הכל</option><option value="${taxYear}" selected>${taxYear}</option>`;
    }

    // Rollover: source = tax year, target = next year
    const srcEl = document.getElementById('rolloverSourceYear');
    const tgtEl = document.getElementById('rolloverTargetYear');
    if (srcEl) srcEl.innerHTML = `<option value="${taxYear}" selected>${taxYear}</option>`;
    if (tgtEl) tgtEl.innerHTML = `<option value="${currentYear}" selected>${currentYear}</option>`;
}

/**
 * Update year dropdowns with actual available years from the API.
 * Called after loadDashboard() returns available_years.
 * Returns true if the dashboard year filter changed (caller should reload).
 */
let _yearsInitialized = false;
function updateYearDropdowns(years) {
    if (!years || years.length === 0) return false;

    const currentYear = new Date().getFullYear();
    const sortedYears = [...years].sort((a, b) => b - a); // newest first
    const newestYear = sortedYears[0];
    let yearFilterChanged = false;

    // Dashboard year filter — "All" + each available year, default to newest
    const yearFilter = document.getElementById('yearFilter');
    if (yearFilter) {
        const prevVal = yearFilter.value;
        const defaultYear = _yearsInitialized ? prevVal : String(newestYear);
        yearFilter.innerHTML = '<option value="">הכל</option>' +
            sortedYears.map(y => `<option value="${y}"${String(y) === defaultYear ? ' selected' : ''}>${y}</option>`).join('');
        yearFilterChanged = !_yearsInitialized && prevVal !== String(newestYear);
    }

    // Other dropdowns — show all available years, default to newest
    const yearSelects = ['manualYear', 'importYear', 'sendYearFilter'];
    for (const id of yearSelects) {
        const el = document.getElementById(id);
        if (!el) continue;
        const defaultVal = _yearsInitialized ? el.value : String(newestYear);
        el.innerHTML = sortedYears.map(y =>
            `<option value="${y}"${String(y) === defaultVal ? ' selected' : ''}>${y}</option>`
        ).join('');
    }

    // Rollover: source = newest available, target = next year after newest
    const srcEl = document.getElementById('rolloverSourceYear');
    const tgtEl = document.getElementById('rolloverTargetYear');
    if (srcEl) {
        srcEl.innerHTML = sortedYears.map(y =>
            `<option value="${y}"${y === newestYear ? ' selected' : ''}>${y}</option>`
        ).join('');
    }
    if (tgtEl) {
        const nextYear = newestYear + 1;
        const targetYears = sortedYears.includes(nextYear) ? sortedYears : [nextYear, ...sortedYears];
        targetYears.sort((a, b) => b - a);
        tgtEl.innerHTML = targetYears.map(y =>
            `<option value="${y}"${y === nextYear ? ' selected' : ''}>${y}</option>`
        ).join('');
    }

    _yearsInitialized = true;
    return yearFilterChanged;
}

// ==================== YEAR ROLLOVER ====================

async function previewYearRollover() {
    const sourceYear = document.getElementById('rolloverSourceYear').value;
    const targetYear = document.getElementById('rolloverTargetYear').value;
    const filingType = document.getElementById('rolloverFilingType').value;

    if (sourceYear === targetYear) {
        showModal('warning', 'שגיאה', 'שנת המקור ושנת היעד חייבות להיות שונות');
        return;
    }

    showLoading('בודק לקוחות להעברה...');

    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_YEAR_ROLLOVER, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                source_year: parseInt(sourceYear),
                target_year: parseInt(targetYear),
                mode: 'preview',
                filing_type: filingType
            })
        }, FETCH_TIMEOUTS.slow);

        const data = await response.json();
        hideLoading();

        if (!data.ok) throw new Error(data.error || 'Preview failed');

        // Update preview stats
        document.getElementById('rollover-eligible').textContent = data.eligible;
        document.getElementById('rollover-existing').textContent = data.already_exist;
        document.getElementById('rolloverCount').textContent = data.eligible;
        document.getElementById('rolloverExecuteBtn').disabled = data.eligible === 0;

        // Render preview table
        const tbody = document.getElementById('rolloverPreviewBody');
        tbody.innerHTML = (data.clients || []).map((c, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(c.name)}</td>
                <td>${escapeHtml(c.email)}</td>
            </tr>
        `).join('');

        document.getElementById('rolloverPreview').classList.add('visible');
        safeCreateIcons();

    } catch (error) {
        hideLoading();
        showModal('error', 'שגיאה', 'שגיאה בטעינת תצוגה מקדימה: ' + error.message);
    }
}

async function executeYearRollover() {
    const sourceYear = document.getElementById('rolloverSourceYear').value;
    const targetYear = document.getElementById('rolloverTargetYear').value;
    const count = document.getElementById('rolloverCount').textContent;

    const filingType = document.getElementById('rolloverFilingType').value;

    showConfirmDialog(
        `להעביר ${count} לקוחות משנת ${sourceYear} לשנת ${targetYear}?`,
        async () => {
            showLoading(`מעביר ${count} לקוחות...`);

            try {
                const response = await fetchWithTimeout(ENDPOINTS.ADMIN_YEAR_ROLLOVER, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: authToken,
                        source_year: parseInt(sourceYear),
                        target_year: parseInt(targetYear),
                        mode: 'execute',
                        filing_type: filingType
                    })
                }, FETCH_TIMEOUTS.rollover);

                const data = await response.json();
                hideLoading();

                if (!data.ok) throw new Error(data.error || 'Rollover failed');

                showModal('success', 'העברה הושלמה!',
                    `הלקוחות הועברו בהצלחה לשנת ${targetYear}.`,
                    { created: data.created, failed: data.failed }
                );

                clearRolloverPreview();
                loadDashboard();

            } catch (error) {
                hideLoading();
                showModal('error', 'שגיאה', 'שגיאה בהעברת שנה: ' + error.message);
            }
        },
        'בצע העברה'
    );
}

function clearRolloverPreview() {
    document.getElementById('rolloverPreview').classList.remove('visible');
    document.getElementById('rolloverPreviewBody').innerHTML = '';
}

// ==================== ROW MENU GLOBAL LISTENERS ====================

// Close row menus on click outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.row-menu') && !e.target.closest('.action-btn.overflow') && !e.target.closest('.header-more-wrapper') && !e.target.closest('#clientContextMenu')) {
        closeAllRowMenus();
    }
});

// Right-click context menu on client table rows
document.getElementById('clientsTableContainer').addEventListener('contextmenu', openClientContextMenu);

// Close row menus on scroll
document.addEventListener('scroll', closeAllRowMenus, true);

// ==================== INIT ====================

// Restore entity tab from URL hash or sessionStorage
(function initEntityTab() {
    const hash = location.hash;
    if (hash === '#capital') activeEntityTab = 'capital_statement';
    else if (hash === '#annual') activeEntityTab = 'annual_report';
    // Sync UI after DOM is ready
    document.addEventListener('DOMContentLoaded', () => switchEntityTab(activeEntityTab));
})();

// Populate year dropdowns immediately (script is at bottom of body, DOM is ready)
populateYearDropdowns();

// Initialize Lucide icons and offline detection when DOM is ready
// Floating evidence tooltip (escapes overflow:hidden parents)
(function () {
    let tip = null;
    function getTrigger(e) {
        const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
        return el && el.closest('.ai-evidence-trigger');
    }
    document.addEventListener('mouseover', (e) => {
        const trigger = getTrigger(e);
        if (!trigger) return;
        const text = trigger.getAttribute('data-tooltip');
        if (!text) return;
        if (!tip) {
            tip = document.createElement('div');
            tip.className = 'ai-evidence-tooltip';
            document.body.appendChild(tip);
        }
        tip.textContent = text;
        positionFloating(trigger, tip);
        tip.classList.add('visible');
    });
    document.addEventListener('mouseout', (e) => {
        if (!tip) return;
        const trigger = getTrigger(e);
        if (!trigger) return;
        // Only hide if mouse actually left the trigger (not moving between children)
        const related = e.relatedTarget;
        if (related && trigger.contains(related)) return;
        tip.classList.remove('visible');
    });
})();

document.addEventListener('DOMContentLoaded', () => {
    safeCreateIcons();
    initOfflineDetection();
});

// Initialize
updateImportFilingTypeLabel(activeEntityTab);
checkAuth();


// ==================== QUESTIONNAIRES TAB ====================

let questionnairesData = [];
let questionnaireLoaded = false;
let questionnaireLoadedAt = 0;
let questionnaireFilteredData = [];
let qaHideNoAnswers = true;

const QA_SORT_CONFIG = {
    qa_name:  { accessor: i => i.client_info?.name || '', type: 'string' },
    qa_stage: { accessor: i => {
        const c = clientsData.find(c => c.report_id === i.report_record_id);
        return STAGES[c?.stage]?.num || 0;
    }, type: 'number' },
    qa_date:  { accessor: i => i.client_info?.submission_date || '', type: 'string' }
};
let qaCurrentSort = { column: 'qa_name', direction: 'asc' };

function initQuestionnaireYearFilter() {
    const sel = document.getElementById('questionnaireYearFilter');
    if (!sel || sel.options.length > 1) return; // already populated
    const latestTaxYear = new Date().getFullYear() - 1; // tax year lags by 1
    sel.innerHTML = '';
    for (let y = latestTaxYear; y >= 2025; y--) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        if (y === latestTaxYear) opt.selected = true;
        sel.appendChild(opt);
    }
}

async function loadQuestionnaires(silent = false) {
    if (!authToken) return;
    initQuestionnaireYearFilter();
    // DL-247: SWR — skip if fresh, otherwise fetch silently
    const isFresh = questionnaireLoaded && (Date.now() - questionnaireLoadedAt < STALE_AFTER_MS);
    if (silent && isFresh) return;



    try {
        const year = document.getElementById('questionnaireYearFilter')?.value || String(new Date().getFullYear() - 1);
        const response = await deduplicatedFetch(
            `${ENDPOINTS.ADMIN_QUESTIONNAIRES}?token=${encodeURIComponent(authToken)}&year=${encodeURIComponent(year)}&filing_type=${activeEntityTab}`,
            { method: 'GET' },
            FETCH_TIMEOUTS.load
        );
        const data = await response.json();



        if (!data.ok) {
            if (data.error === 'unauthorized') { logout(); return; }
            throw new Error(data.error || 'שגיאה בטעינת השאלונים');
        }

        questionnairesData = data.items || [];
        questionnaireLoaded = true;
        questionnaireLoadedAt = Date.now();
        updateQuestionnaireStats();
        filterQuestionnaires();

    } catch (error) {

        if (!silent) showModal('error', 'שגיאה בטעינת שאלונים', error.message || 'לא ניתן לטעון את השאלונים');
    }
}

function updateQuestionnaireStats() {
    const count = questionnairesData.length;
    const el = document.getElementById('questionnaire-stat-count');
    if (el) el.textContent = count;

}

function toggleQaSort(column) {
    if (qaCurrentSort.column === column) {
        qaCurrentSort.direction = qaCurrentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        qaCurrentSort.column = column;
        qaCurrentSort.direction = 'asc';
    }
    filterQuestionnaires();
}

function sortQuestionnaires(items) {
    const config = QA_SORT_CONFIG[qaCurrentSort.column];
    if (!config) return items;

    return [...items].sort((a, b) => {
        const aVal = config.accessor(a);
        const bVal = config.accessor(b);
        let cmp;
        if (config.type === 'string') {
            cmp = String(aVal).localeCompare(String(bVal), 'he');
        } else {
            cmp = (aVal || 0) - (bVal || 0);
        }
        return qaCurrentSort.direction === 'asc' ? cmp : -cmp;
    });
}

function filterQuestionnaires(keepPage) {
    const search = (document.getElementById('questionnaireSearchInput')?.value || '').toLowerCase().trim();

    questionnaireFilteredData = questionnairesData.filter(item => {
        if (!search) return true;
        const name = (item.client_info?.name || '').toLowerCase();
        const spouse = (item.client_info?.spouse || '').toLowerCase();
        return name.includes(search) || spouse.includes(search);
    });

    questionnaireFilteredData = sortQuestionnaires(questionnaireFilteredData);
    if (!keepPage) _qaPage = 1;

    const pageSlice = questionnaireFilteredData.slice((_qaPage - 1) * PAGE_SIZE, _qaPage * PAGE_SIZE);
    renderQuestionnairesTable(pageSlice);
    renderPagination('questionnairePagination', questionnaireFilteredData.length, _qaPage, PAGE_SIZE, goToQaPage);
}

function goToQaPage(page) {
    _qaPage = page;
    filterQuestionnaires(true);
    document.getElementById('questionnaireTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderQuestionnairesTable(items) {
    const container = document.getElementById('questionnaireTableContainer');
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="file-text" class="icon-2xl"></i></div>
                <p>${questionnairesData.length === 0 ? 'אין שאלונים שהוגשו לשנה זו' : 'לא נמצאו תוצאות לחיפוש'}</p>
            </div>`;
        safeCreateIcons();
        return;
    }

    function qaSortAttr(col) {
        if (qaCurrentSort.column !== col) return 'none';
        return qaCurrentSort.direction === 'asc' ? 'ascending' : 'descending';
    }

    let html = `
        <table>
            <thead>
                <tr>
                    <th style="width:36px;">
                        <input type="checkbox" class="questionnaire-select-all" onchange="toggleQuestionnaireSelectAll(this)" title="בחר הכל">
                    </th>
                    <th><button class="th-sort-btn" onclick="toggleQaSort('qa_name')" aria-sort="${qaSortAttr('qa_name')}">שם לקוח <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th>בן/בת זוג</th>
                    <th><button class="th-sort-btn" onclick="toggleQaSort('qa_stage')" aria-sort="${qaSortAttr('qa_stage')}">שלב <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th><button class="th-sort-btn" onclick="toggleQaSort('qa_date')" aria-sort="${qaSortAttr('qa_date')}">תאריך הגשה <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th style="width:112px; text-align:center;">פעולות</th>
                </tr>
            </thead>
            <tbody>`;

    items.forEach((item, qaIdx) => {
        const id = item.report_record_id || '';
        const name = item.client_info?.name || '—';
        const spouse = item.client_info?.spouse || '—';
        const date = formatDateDisplay(item.client_info?.submission_date || '');
        const clientRecord = clientsData.find(c => c.report_id === id);
        const stage = STAGES[clientRecord?.stage] || null;

        html += `
                <tr data-qa-id="${id}" class="qa-main-row qa-row-clickable" onclick="toggleQuestionnaireDetail('${id}')">
                    <td onclick="event.stopPropagation();">
                        <input type="checkbox" class="questionnaire-row-checkbox"
                            data-qa-id="${id}"
                            onchange="updateQuestionnaireSelectedCount()">
                    </td>
                    <td style="font-weight:600;">${escapeHtml(name)}</td>
                    <td>${escapeHtml(spouse)}</td>
                    <td>${stage ? `<span class="stage-badge ${stage.class}"><i data-lucide="${stage.icon}" class="icon-sm"></i> ${stage.label}</span>` : '—'}</td>
                    <td>${date}</td>
                    <td class="qa-actions-cell" onclick="event.stopPropagation();">
                        <div class="qa-actions-inner">
                            <button class="action-btn view" onclick="navigateToDocManager('${id}')" title="מנהל מסמכים">
                                <i data-lucide="folder-open" class="icon-sm"></i>
                            </button>
                            <button class="action-btn" style="background:var(--gray-100);color:var(--gray-600);" onclick="printSingleQuestionnaire('${id}')" title="הדפס שאלון">
                                <i data-lucide="printer" class="icon-sm"></i>
                            </button>
                            <button class="expand-toggle" id="toggle-${id}" onclick="toggleQuestionnaireDetail('${id}')" title="הצג/הסתר תשובות">
                                <i data-lucide="chevron-left" class="icon-sm"></i>
                            </button>
                        </div>
                    </td>
                </tr>
                <tr class="qa-detail-row" id="detail-${id}" data-qa-idx="${qaIdx}" style="display:none;">
                    <td colspan="6">
                        <div class="qa-detail-content">
                            ${buildQADetailHTML(item)}
                        </div>
                    </td>
                </tr>`;
    });

    html += `</tbody></table>`;

    // Mobile card list (DL-214)
    let cards = '<ul class="mobile-card-list" role="list" aria-label="רשימת שאלונים">';
    items.forEach((item, qaIdx) => {
        const id = item.report_record_id || '';
        const name = item.client_info?.name || '—';
        const spouse = item.client_info?.spouse || '—';
        const date = formatDateDisplay(item.client_info?.submission_date || '');
        const clientRecord = clientsData.find(c => c.report_id === id);
        const stage = STAGES[clientRecord?.stage] || null;

        cards += `<li class="mobile-card" data-qa-id="${id}">
            <div class="mobile-card-primary">
                <span class="mobile-card-checkbox" onclick="event.stopPropagation();">
                    <input type="checkbox" class="questionnaire-row-checkbox" data-qa-id="${id}" onchange="updateQuestionnaireSelectedCount()">
                </span>
                <div class="mobile-card-info">
                    <span class="mobile-card-name" style="cursor:default">${escapeHtml(name)}</span>
                    ${stage ? `<span class="stage-badge ${stage.class}"><i data-lucide="${stage.icon}" class="icon-sm"></i> ${stage.label}</span>` : ''}
                </div>
            </div>
            <div class="mobile-card-secondary">
                ${spouse !== '—' ? `<span class="mobile-card-detail"><span class="label">בן/בת זוג</span> ${escapeHtml(spouse)}</span>` : ''}
                <span class="mobile-card-detail"><span class="label">הגשה</span> ${date}</span>
            </div>
            <div class="mobile-card-actions">
                <button class="action-btn view" onclick="navigateToDocManager('${id}')" title="מנהל מסמכים">
                    <i data-lucide="folder-open" class="icon-sm"></i>
                </button>
                <button class="action-btn" style="background:var(--gray-100);color:var(--gray-600);" onclick="printSingleQuestionnaire('${id}')" title="הדפס שאלון">
                    <i data-lucide="printer" class="icon-sm"></i>
                </button>
                <button class="expand-toggle" id="toggle-m-${id}" onclick="toggleQuestionnaireCardDetail('${id}')" title="הצג/הסתר תשובות">
                    <i data-lucide="chevron-left" class="icon-sm"></i>
                </button>
            </div>
            <div class="qa-card-detail" id="card-detail-${id}">
                ${buildQADetailHTML(item)}
            </div>
        </li>`;
    });
    cards += '</ul>';

    container.innerHTML = `<div class="table-scroll-container" role="region" tabindex="0" aria-label="טבלת שאלונים">${html}${cards}</div>`;
    safeCreateIcons(container);
}

// Toggle questionnaire detail in mobile card (DL-214)
function toggleQuestionnaireCardDetail(id) {
    const detail = document.getElementById('card-detail-' + id);
    if (!detail) return;
    detail.classList.toggle('open');
    const toggle = document.getElementById('toggle-m-' + id);
    if (toggle) {
        const icon = toggle.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', detail.classList.contains('open') ? 'chevron-down' : 'chevron-left');
            safeCreateIcons();
        }
    }
}

function toggleQaHideNoAnswers() {
    qaHideNoAnswers = !qaHideNoAnswers;
    // Re-render all open detail rows
    document.querySelectorAll('.qa-detail-row').forEach(row => {
        const idx = row.dataset.qaIdx;
        if (idx !== undefined && questionnaireFilteredData[idx]) {
            const contentEl = row.querySelector('.qa-detail-content');
            if (contentEl) contentEl.innerHTML = buildQADetailHTML(questionnaireFilteredData[idx]);
        }
    });
    safeCreateIcons();
}

function buildQADetailHTML(item) {
    const info = item.client_info || {};
    const answers = item.answers || [];
    let clientQuestions = [];
    try {
        const rawCQ = item.client_questions || item.raw_answers?.client_questions || '[]';
        clientQuestions = JSON.parse(rawCQ);
        if (!Array.isArray(clientQuestions)) clientQuestions = [];
    } catch (e) { clientQuestions = []; }

    let html = `
        <div class="qa-summary-box">
            <div class="qa-summary-field">
                <span class="qa-summary-label">שם</span>
                <span class="qa-summary-value">${escapeHtml(info.name || '—')}</span>
            </div>
            ${info.spouse ? `<div class="qa-summary-field">
                <span class="qa-summary-label">בן/בת זוג</span>
                <span class="qa-summary-value">${escapeHtml(info.spouse)}</span>
            </div>` : ''}
            <div class="qa-summary-field">
                <span class="qa-summary-label">שנת מס</span>
                <span class="qa-summary-value">${escapeHtml(info.year || '—')}</span>
            </div>
            <div class="qa-summary-field">
                <span class="qa-summary-label">אימייל</span>
                <span class="qa-summary-value">${escapeHtml(info.email || '—')}</span>
            </div>
            ${info.phone ? `<div class="qa-summary-field">
                <span class="qa-summary-label">טלפון</span>
                <span class="qa-summary-value">${escapeHtml(info.phone)}</span>
            </div>` : ''}
            <div class="qa-summary-field">
                <span class="qa-summary-label">תאריך הגשה</span>
                <span class="qa-summary-value">${formatDateDisplay(info.submission_date || '')}</span>
            </div>
        </div>`;

    const noCount = answers.filter(a => a.value === '✗ לא').length;
    const displayAnswers = qaHideNoAnswers ? answers.filter(a => a.value !== '✗ לא') : answers;

    if (noCount > 0) {
        html += `<div style="margin-bottom:8px; text-align:start;">
            <button class="btn btn-sm btn-ghost qa-toggle-no-btn" onclick="event.stopPropagation(); toggleQaHideNoAnswers()">
                <i data-lucide="${qaHideNoAnswers ? 'eye' : 'eye-off'}" class="icon-sm"></i>
                ${qaHideNoAnswers ? `הצג תשובות לא (${noCount})` : 'הסתר תשובות לא'}
            </button>
        </div>`;
    }

    if (displayAnswers.length === 0) {
        html += `<p style="color:var(--gray-400); font-size:var(--text-sm);">אין תשובות להצגה</p>`;
    } else {
        html += `
        <table class="qa-zebra-table" dir="rtl">
            <thead>
                <tr>
                    <th class="qa-question-col">שאלה</th>
                    <th class="qa-answer-col">תשובה</th>
                </tr>
            </thead>
            <tbody>`;
        displayAnswers.forEach(({ label, value }) => {
            html += `
                <tr>
                    <td class="qa-question-col">${escapeHtml(label)}</td>
                    <td class="qa-answer-col">${escapeHtml(String(value || ''))}</td>
                </tr>`;
        });
        html += `</tbody></table>`;
    }

    // Client questions section (DL-110, DL-122: added answers)
    if (clientQuestions.length > 0) {
        html += `
        <div class="qa-client-questions">
            <div class="qa-client-questions-title">
                <i data-lucide="help-circle" class="icon-sm"></i> שאלות הלקוח (${clientQuestions.length})
            </div>`;
        clientQuestions.forEach((q, idx) => {
            const text = typeof q === 'string' ? q : (q.text || q.question || JSON.stringify(q));
            const answer = (typeof q === 'object' && q.answer) ? q.answer.trim() : '';
            const answered = !!answer;
            html += `<div class="qa-client-question-item">
                <div class="qa-cq-question">
                    <span class="qa-cq-status ${answered ? 'qa-cq-answered' : 'qa-cq-unanswered'}"></span>
                    <strong>${idx + 1}.</strong> ${escapeHtml(text)}
                </div>
                <div class="qa-cq-answer ${answered ? '' : 'qa-cq-no-answer'}">${answered ? escapeHtml(answer) : 'ללא תשובה'}</div>
            </div>`;
        });
        html += `</div>`;
    }

    return html;
}

function toggleQuestionnaireDetail(id) {
    const detailRow = document.getElementById(`detail-${id}`);
    const toggleBtn = document.getElementById(`toggle-${id}`);
    if (!detailRow) return;

    const isVisible = detailRow.style.display !== 'none';

    const mainRow = document.querySelector(`tr[data-qa-id="${id}"].qa-main-row`);

    if (isVisible) {
        detailRow.style.display = 'none';
        toggleBtn?.classList.remove('expanded');
        mainRow?.classList.remove('qa-main-row-sticky');
    } else {
        // Close all other open detail rows (single-open accordion)
        document.querySelectorAll('.qa-detail-row').forEach(row => {
            if (row.id !== `detail-${id}` && row.style.display !== 'none') {
                row.style.display = 'none';
                const rowId = row.id.replace('detail-', '');
                document.getElementById(`toggle-${rowId}`)?.classList.remove('expanded');
                document.querySelector(`tr[data-qa-id="${rowId}"].qa-main-row`)?.classList.remove('qa-main-row-sticky');
            }
        });
        detailRow.style.display = '';
        toggleBtn?.classList.add('expanded');
        mainRow?.classList.add('qa-main-row-sticky');
        safeCreateIcons();
    }
}

function updateQuestionnaireSelectedCount() {
    const checked = document.querySelectorAll('.questionnaire-row-checkbox:checked');
    const count = checked.length;
    const bar = document.getElementById('questionnaireBulkActions');
    const countEl = document.getElementById('questionnaireSelectedCount');

    if (countEl) countEl.textContent = count;

    if (count > 0) {
        bar?.classList.add('visible', 'floating-bulk-bar');
    } else {
        bar?.classList.remove('visible', 'floating-bulk-bar');
    }
}

function toggleQuestionnaireSelectAll(masterCb) {
    const checkboxes = document.querySelectorAll('.questionnaire-row-checkbox');
    checkboxes.forEach(cb => { cb.checked = masterCb.checked; });
    updateQuestionnaireSelectedCount();
}

function resetQuestionnaireBulkSelection() {
    document.querySelectorAll('.questionnaire-row-checkbox, .questionnaire-select-all').forEach(cb => cb.checked = false);
    updateQuestionnaireSelectedCount();
}

function generateQuestionnairePrintHTML(items) {
    let printHtml = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<title>שאלונים — הדפסה</title>
<style>
  @page { margin: 15mm; size: A4; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Arial', 'Segoe UI', sans-serif;
    font-size: 12pt;
    color: #1f2937;
    direction: rtl;
    margin: 0;
    padding: 0;
  }
  .client-page { page-break-before: always; }
  .client-page:first-child { page-break-before: avoid; }
  .client-header {
    border-bottom: 3px solid #4f46e5;
    padding-bottom: 10px;
    margin-bottom: 16px;
  }
  .client-header h2 {
    margin: 0 0 4px;
    font-size: 18pt;
    color: #1f2937;
  }
  .client-header .meta {
    font-size: 10pt;
    color: #6b7280;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 16px;
  }
  .summary-field { display: flex; flex-direction: column; gap: 2px; }
  .summary-label { font-size: 8pt; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }
  .summary-value { font-size: 11pt; font-weight: 600; color: #111827; }
  .qa-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
    font-size: 10pt;
  }
  .qa-table th {
    background: #f3f4f6;
    padding: 7px 10px;
    font-weight: 700;
    color: #374151;
    border-bottom: 2px solid #d1d5db;
    text-align: right;
  }
  .qa-table td {
    padding: 6px 10px;
    border-bottom: 1px solid #f3f4f6;
    vertical-align: top;
    text-align: right;
  }
  .qa-table tr:nth-child(even) td { background: #f9fafb; }
  .qa-table .q-col { font-weight: 600; color: #374151; width: 40%; }
  .qa-table .a-col { color: #4b5563; }
  .client-questions { margin-top:12px; border-right:3px solid #d97706; padding:8px 12px; background:#fffbeb; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .client-questions h4 { margin:0 0 8px; font-size:10pt; color:#92400e; text-transform:uppercase; letter-spacing:0.05em; }
  .cq-item { padding:6px 0; border-bottom:1px solid #fde68a; break-inside:avoid; }
  .cq-item:last-child { border-bottom:none; }
  .cq-q { font-weight:600; color:#78350f; font-size:10pt; }
  .cq-a { color:#4b5563; font-size:10pt; margin-top:2px; padding-right:16px; }
  .cq-no-answer { color:#9ca3af; font-style:italic; }
  .office-notes { margin-top:12px; border-right:3px solid #3b82f6; padding:8px 12px; background:#eff6ff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .office-notes h4 { margin:0 0 8px; font-size:10pt; color:#1e40af; text-transform:uppercase; letter-spacing:0.05em; }
  .office-notes .notes-content { color:#1f2937; font-size:10pt; white-space:pre-wrap; }
  .footer {
    margin-top: 12px;
    font-size: 8pt;
    color: #9ca3af;
    border-top: 1px solid #e5e7eb;
    padding-top: 8px;
  }
  @media print {
    .client-page { page-break-before: always; }
    .client-page:first-child { page-break-before: avoid; }
  }
</style>
</head>
<body>`;

    items.forEach((item) => {
        const info = item.client_info || {};
        const answers = item.answers || [];
        const printAnswers = answers.filter(a => a.value && a.value !== '✗ לא');
        let clientQuestions = [];
        const rawCQ = item.client_questions || item.raw_answers?.client_questions || '';
        if (rawCQ && String(rawCQ).trim()) {
            try {
                const parsed = JSON.parse(rawCQ);
                if (Array.isArray(parsed)) clientQuestions = parsed;
            } catch (e) {
                console.warn('Failed to parse client_questions for print', e);
            }
        }

        const date = formatDateDisplay(info.submission_date || '');
        const reportClient = clientsData.find(c => c.report_id === item.report_record_id);
        const itemFilingType = item.filing_type || reportClient?.filing_type || activeEntityTab;
        const ftLabel = FILING_TYPE_LABELS[itemFilingType] || FILING_TYPE_LABELS.annual_report;
        printHtml += `
<div class="client-page">
  <div class="client-header">
    <h2>${escapeHtml(info.name || '—')} — ${ftLabel} ${escapeHtml(info.year || '—')}</h2>
    <div class="meta">${escapeHtml(info.email || '—')}${info.phone ? ` | ${escapeHtml(info.phone)}` : ''} | שאלון הוגש: ${date}</div>
  </div>
  <div class="summary-grid">
    <div class="summary-field">
      <span class="summary-label">שם</span>
      <span class="summary-value">${escapeHtml(info.name || '—')}</span>
    </div>
    ${info.spouse ? `<div class="summary-field">
      <span class="summary-label">בן/בת זוג</span>
      <span class="summary-value">${escapeHtml(info.spouse)}</span>
    </div>` : ''}
    <div class="summary-field">
      <span class="summary-label">שנת מס</span>
      <span class="summary-value">${escapeHtml(info.year || '—')}</span>
    </div>
    ${info.phone ? `<div class="summary-field">
      <span class="summary-label">טלפון</span>
      <span class="summary-value">${escapeHtml(info.phone)}</span>
    </div>` : ''}
    <div class="summary-field">
      <span class="summary-label">תאריך הגשה</span>
      <span class="summary-value">${date}</span>
    </div>
  </div>`;

        if (printAnswers.length > 0) {
            printHtml += `
  <table class="qa-table">
    <thead>
      <tr><th class="q-col">שאלה</th><th class="a-col">תשובה</th></tr>
    </thead>
    <tbody>`;
            printAnswers.forEach(({ label, value }) => {
                printHtml += `
      <tr>
        <td class="q-col">${escapeHtml(label)}</td>
        <td class="a-col">${escapeHtml(String(value || ''))}</td>
      </tr>`;
            });
            printHtml += `</tbody></table>`;
        }

        if (clientQuestions.length > 0) {
            printHtml += `<div class="client-questions"><h4>שאלות הלקוח</h4>`;
            clientQuestions.forEach((q, idx) => {
                const text = typeof q === 'string' ? q : (q.text || q.question || JSON.stringify(q));
                const answer = (typeof q === 'object' && q.answer) ? q.answer.trim() : '';
                printHtml += `<div class="cq-item">
                    <div class="cq-q">${idx + 1}. ${escapeHtml(text)}</div>
                    <div class="cq-a${answer ? '' : ' cq-no-answer'}">${answer ? escapeHtml(answer) : 'ללא תשובה'}</div>
                </div>`;
            });
            printHtml += `</div>`;
        }

        // Office notes — read from item.notes (returned by API), fallback to clientsData lookup
        const itemNotes = item.notes || reportClient?.notes || '';
        if (itemNotes) {
            printHtml += `<div class="office-notes"><h4>הערות משרד</h4><div class="notes-content">${escapeHtml(itemNotes)}</div></div>`;
        }

        printHtml += `
  <div class="footer">הודפס מתוך מערכת ניהול דוחות — Client Name רו"ח</div>
</div>`;
    });

    printHtml += `</body></html>`;
    return printHtml;
}

function printQuestionnaires() {
    const checked = document.querySelectorAll('.questionnaire-row-checkbox:checked');
    if (checked.length === 0) {
        showAIToast('לא נבחרו שאלונים להדפסה', 'warning');
        return;
    }

    const ids = Array.from(checked).map(cb => cb.getAttribute('data-qa-id'));
    const selectedItems = questionnairesData.filter(item => ids.includes(item.report_record_id));

    if (selectedItems.length === 0) {
        showAIToast('לא נמצאו נתונים להדפסה', 'error');
        return;
    }

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
        showAIToast('לא ניתן לפתוח חלון הדפסה. אפשר חלונות קופצים.', 'error');
        return;
    }

    printWindow.document.write(generateQuestionnairePrintHTML(selectedItems));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
}

function printSingleQuestionnaire(id) {
    const item = questionnairesData.find(i => i.report_record_id === id);
    if (!item) {
        showAIToast('לא נמצאו נתונים להדפסה', 'error');
        return;
    }
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
        showAIToast('לא ניתן לפתוח חלון הדפסה. אפשר חלונות קופצים.', 'error');
        return;
    }
    printWindow.document.write(generateQuestionnairePrintHTML([item]));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
}

function navigateToDocManager(reportId) {
    const client = clientsData.find(c => c.report_id === reportId);
    const clientId = client?.client_id;
    if (clientId) {
        window.location.href = `../document-manager.html?client_id=${encodeURIComponent(clientId)}`;
    }
}

// Helper: format date for display (questionnaire tab)
function formatDateDisplay(dateStr) {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {
        return dateStr;
    }
}

// ---- PDF Split Modal (DL-237) ----

let pdfjsLoaded = false;
async function ensurePdfJs() {
    if (pdfjsLoaded) return;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = () => {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            pdfjsLoaded = true;
            resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

const splitState = {
    classificationId: null,
    pageCount: 0,
    mode: 'all',
    groups: [],
    pdfDoc: null,
    thumbnailsRendered: false,
};

const SPLIT_GROUP_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

async function openSplitModal(recordId) {
    const item = aiClassificationsData.find(c => c.id === recordId);
    if (!item) return;

    splitState.classificationId = recordId;
    splitState.pageCount = item.page_count || 0;
    splitState.mode = 'all';
    splitState.groups = [];
    splitState.pdfDoc = null;
    splitState.thumbnailsRendered = false;

    const modal = document.getElementById('aiSplitModal');
    modal.classList.add('show');
    document.getElementById('splitModalPageInfo').textContent = `(${splitState.pageCount} עמודים)`;
    document.getElementById('splitThumbnailGrid').innerHTML = '<div class="split-loading"><div class="split-spinner"></div>מוריד ומעבד את הקובץ...</div>';
    document.getElementById('splitManualInput').style.display = 'none';
    const rangeInput = document.getElementById('splitRangeInput');
    if (rangeInput) rangeInput.value = '';
    document.getElementById('splitRangeError').style.display = 'none';

    setSplitMode('all');
    safeCreateIcons();

    try {
        await ensurePdfJs();
        // DL-237: Fetch PDF binary through our API proxy (CSP blocks direct SharePoint URLs)
        const proxyUrl = `${ENDPOINTS.GET_PREVIEW_URL.replace('get-preview-url', 'download-file')}?token=${encodeURIComponent(authToken)}&itemId=${encodeURIComponent(item.onedrive_item_id)}`;
        const pdfResp = await fetch(proxyUrl);
        if (!pdfResp.ok) throw new Error('Could not download PDF');
        const pdfData = await pdfResp.arrayBuffer();

        console.warn('[split] PDF downloaded, size:', pdfData.byteLength);
        const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
        console.warn('[split] PDF parsed, pages:', pdfDoc.numPages);
        splitState.pdfDoc = pdfDoc;
        splitState.pageCount = pdfDoc.numPages;
        document.getElementById('splitModalPageInfo').textContent = `(${splitState.pageCount} עמודים)`;

        await renderSplitThumbnails(pdfDoc);
        console.warn('[split] Thumbnails rendered');
        setSplitMode(splitState.mode); // re-apply to update groups with actual page count
    } catch (err) {
        console.error('[split] Failed to load PDF:', err);
        document.getElementById('splitThumbnailGrid').innerHTML =
            `<div class="split-error">שגיאה בטעינת הקובץ: ${err.message || 'Unknown error'}</div>`;
    }
}

function closeSplitModal() {
    closePagePreview(); // DL-246: close lightbox if open
    document.getElementById('aiSplitModal').classList.remove('show');
    splitState.pdfDoc = null;
    // DL-250: Reset progress view for next open
    document.getElementById('splitProgressView').style.display = 'none';
    document.getElementById('splitThumbnailGrid').style.display = '';
    document.querySelector('.split-mode-tabs').style.display = '';
    document.getElementById('splitConfirmBtn').style.display = '';
    const cancelBtn = document.getElementById('splitCancelBtn');
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'ביטול';
}

async function renderSplitThumbnails(pdfDoc) {
    const grid = document.getElementById('splitThumbnailGrid');
    grid.innerHTML = '';

    const SCALE = 0.2; // Lower scale for faster rendering on large PDFs
    const DPR = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        // Create placeholder immediately so user sees progress
        const wrapper = document.createElement('div');
        wrapper.className = 'split-thumb-wrapper';
        wrapper.dataset.page = i;

        const label = document.createElement('span');
        label.className = 'split-thumb-label';
        label.textContent = `עמוד ${i}`;

        wrapper.appendChild(label);
        grid.appendChild(wrapper);

        try {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: SCALE });

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width * DPR;
            canvas.height = viewport.height * DPR;
            canvas.style.width = viewport.width + 'px';
            canvas.style.height = viewport.height + 'px';

            const ctx = canvas.getContext('2d');
            ctx.scale(DPR, DPR);
            await page.render({ canvasContext: ctx, viewport }).promise;

            // Convert canvas to img for memory efficiency
            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/jpeg', 0.6); // JPEG for smaller memory
            img.style.width = viewport.width + 'px';
            img.style.height = viewport.height + 'px';

            wrapper.insertBefore(img, label);

            // DL-246: Add magnify overlay for page preview
            const zoomOverlay = document.createElement('div');
            zoomOverlay.className = 'split-thumb-zoom';
            zoomOverlay.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
            wrapper.appendChild(zoomOverlay);

            // Click thumbnail to preview page
            wrapper.addEventListener('click', (e) => {
                e.stopPropagation();
                openPagePreview(i);
            });

            page.cleanup(); // Free page resources
        } catch (pageErr) {
            console.error(`[split] Failed to render page ${i}:`, pageErr);
            const errSpan = document.createElement('span');
            errSpan.className = 'split-thumb-label';
            errSpan.textContent = '⚠️ שגיאה';
            wrapper.insertBefore(errSpan, label);
        }
    }

    splitState.thumbnailsRendered = true;
}

function setSplitMode(mode) {
    splitState.mode = mode;

    document.querySelectorAll('.split-mode-tab').forEach(tab => tab.classList.remove('active'));
    const tabs = document.querySelectorAll('.split-mode-tab');
    if (mode === 'all' && tabs[0]) tabs[0].classList.add('active');
    if (mode === 'manual' && tabs[1]) tabs[1].classList.add('active');

    document.getElementById('splitManualInput').style.display = mode === 'manual' ? 'block' : 'none';

    if (mode === 'all') {
        splitState.groups = [];
        for (let i = 1; i <= splitState.pageCount; i++) {
            splitState.groups.push([i]);
        }
    } else {
        parseSplitRanges();
    }

    updateSplitPreview();
    updateThumbnailHighlights();
}

function parseSplitRanges() {
    const input = document.getElementById('splitRangeInput').value.trim();
    const errorEl = document.getElementById('splitRangeError');

    if (!input) {
        splitState.groups = [];
        errorEl.style.display = 'none';
        updateSplitPreview();
        updateThumbnailHighlights();
        return;
    }

    const parts = input.split(',').map(s => s.trim()).filter(Boolean);
    const groups = [];
    const usedPages = new Set();

    for (const part of parts) {
        const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
        const singleMatch = part.match(/^(\d+)$/);

        if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            if (start < 1 || end > splitState.pageCount || start > end) {
                errorEl.textContent = `טווח לא תקין: ${part} (PDF מכיל ${splitState.pageCount} עמודים)`;
                errorEl.style.display = 'block';
                splitState.groups = [];
                updateSplitPreview();
                updateThumbnailHighlights();
                return;
            }
            const group = [];
            for (let p = start; p <= end; p++) {
                if (usedPages.has(p)) {
                    errorEl.textContent = `עמוד ${p} מופיע יותר מפעם אחת`;
                    errorEl.style.display = 'block';
                    splitState.groups = [];
                    updateSplitPreview();
                    updateThumbnailHighlights();
                    return;
                }
                usedPages.add(p);
                group.push(p);
            }
            groups.push(group);
        } else if (singleMatch) {
            const p = parseInt(singleMatch[1]);
            if (p < 1 || p > splitState.pageCount) {
                errorEl.textContent = `עמוד ${p} לא קיים (PDF מכיל ${splitState.pageCount} עמודים)`;
                errorEl.style.display = 'block';
                splitState.groups = [];
                updateSplitPreview();
                updateThumbnailHighlights();
                return;
            }
            if (usedPages.has(p)) {
                errorEl.textContent = `עמוד ${p} מופיע יותר מפעם אחת`;
                errorEl.style.display = 'block';
                splitState.groups = [];
                updateSplitPreview();
                updateThumbnailHighlights();
                return;
            }
            usedPages.add(p);
            groups.push([p]);
        } else {
            errorEl.textContent = `פורמט לא תקין: "${part}". השתמש ב-1-3, 4, 5-7`;
            errorEl.style.display = 'block';
            splitState.groups = [];
            updateSplitPreview();
            updateThumbnailHighlights();
            return;
        }
    }

    if (groups.length < 2) {
        errorEl.textContent = 'יש להגדיר לפחות 2 קבוצות';
        errorEl.style.display = 'block';
        splitState.groups = [];
        updateSplitPreview();
        updateThumbnailHighlights();
        return;
    }

    errorEl.style.display = 'none';
    splitState.groups = groups;
    updateSplitPreview();
    updateThumbnailHighlights();
}

function updateThumbnailHighlights() {
    document.querySelectorAll('.split-thumb-wrapper').forEach(w => {
        w.style.borderColor = '';
        w.style.backgroundColor = '';
        const gl = w.querySelector('.split-thumb-group-label');
        if (gl) gl.remove();
    });

    splitState.groups.forEach((group, gi) => {
        const color = SPLIT_GROUP_COLORS[gi % SPLIT_GROUP_COLORS.length];
        group.forEach(pageNum => {
            const wrapper = document.querySelector(`.split-thumb-wrapper[data-page="${pageNum}"]`);
            if (wrapper) {
                wrapper.style.borderColor = color;
                wrapper.style.backgroundColor = color + '15';

                const label = document.createElement('span');
                label.className = 'split-thumb-group-label';
                label.style.backgroundColor = color;
                label.textContent = `${gi + 1}`;
                wrapper.appendChild(label);
            }
        });
    });
}

function updateSplitPreview() {
    const preview = document.getElementById('splitResultPreview');
    const confirmBtn = document.getElementById('splitConfirmBtn');
    const confirmText = document.getElementById('splitConfirmText');

    if (splitState.groups.length >= 2) {
        const count = splitState.groups.length;
        preview.innerHTML = `<span class="split-preview-count">${count} מסמכים ייווצרו</span>`;
        preview.style.display = 'block';
        confirmBtn.disabled = false;
        confirmText.textContent = `פצל ל-${count} מסמכים`;
    } else {
        preview.innerHTML = '';
        preview.style.display = 'none';
        confirmBtn.disabled = true;
        confirmText.textContent = 'פצל';
    }
}

// DL-250: Frontend-orchestrated split with live progress
async function confirmSplit() {
    if (splitState.groups.length < 2) return;

    const totalSegments = splitState.groups.length;
    const classificationId = splitState.classificationId;

    // Switch modal to progress view
    document.getElementById('splitThumbnailGrid').style.display = 'none';
    document.getElementById('splitResultPreview').style.display = 'none';
    document.querySelector('.split-mode-tabs').style.display = 'none';
    document.getElementById('splitManualInput').style.display = 'none';
    document.getElementById('splitConfirmBtn').style.display = 'none';
    document.getElementById('splitCancelBtn').disabled = true;

    const progressView = document.getElementById('splitProgressView');
    const progressFill = document.getElementById('splitProgressFill');
    const progressLabel = document.getElementById('splitProgressLabel');
    const stepsContainer = document.getElementById('splitProgressSteps');
    progressView.style.display = 'block';

    // Build step list
    const stepHtml = [`<div class="split-step active" id="splitStep0">
        <div class="split-step-icon"><div class="split-step-spinner"></div></div>
        <span class="split-step-name">מפצל ומעלה ${totalSegments} קבצים...</span>
        <span class="split-step-detail"></span>
    </div>`];
    for (let i = 0; i < totalSegments; i++) {
        const pr = splitState.groups[i].length === 1
            ? String(splitState.groups[i][0])
            : `${splitState.groups[i][0]}-${splitState.groups[i][splitState.groups[i].length - 1]}`;
        stepHtml.push(`<div class="split-step" id="splitStep${i + 1}">
            <div class="split-step-icon"><span style="color:var(--gray-300)">●</span></div>
            <span class="split-step-name">עמודים ${pr}</span>
            <span class="split-step-detail">ממתין</span>
        </div>`);
    }
    stepsContainer.innerHTML = stepHtml.join('');

    function updateStep(idx, status, detail) {
        const step = document.getElementById(`splitStep${idx}`);
        if (!step) return;
        step.className = 'split-step ' + status;
        const iconEl = step.querySelector('.split-step-icon');
        const detailEl = step.querySelector('.split-step-detail');
        if (status === 'active') {
            iconEl.innerHTML = '<div class="split-step-spinner"></div>';
        } else if (status === 'done') {
            iconEl.innerHTML = '<span style="color:var(--success-color, #16a34a)">✓</span>';
        } else if (status === 'failed') {
            iconEl.innerHTML = '<span style="color:var(--danger-color, #dc2626)">✗</span>';
        }
        if (detail) detailEl.textContent = detail;
        step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function updateProgress(completed) {
        const pct = Math.round((completed / (totalSegments + 1)) * 100);
        progressFill.style.width = pct + '%';
        progressLabel.textContent = `${completed}/${totalSegments + 1}`;
    }

    updateProgress(0);

    try {
        // Phase 1: Split PDF + upload segments to OneDrive
        const splitResp = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: classificationId,
                action: 'split',
                groups: splitState.groups,
            }),
        }, 120000);

        const splitResult = await splitResp.json();
        if (!splitResult.ok) {
            throw new Error(splitResult.error || 'Split failed');
        }

        updateStep(0, 'done', `${splitResult.segments.length} קבצים הועלו`);
        updateProgress(1);

        // Phase 2: Classify each segment sequentially
        let classified = 0;
        let failed = 0;
        for (let i = 0; i < splitResult.segments.length; i++) {
            const seg = splitResult.segments[i];
            const stepIdx = i + 1;
            updateStep(stepIdx, 'active', 'מסווג...');

            try {
                const clsResp = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: authToken,
                        classification_id: classificationId,
                        action: 'classify-segment',
                        segment: seg,
                    }),
                }, 60000);

                const clsResult = await clsResp.json();
                if (clsResult.ok && clsResult.classified) {
                    updateStep(stepIdx, 'done', clsResult.matched_doc_name || 'סווג בהצלחה');
                    classified++;
                } else if (clsResult.ok) {
                    updateStep(stepIdx, 'done', 'לא סווג — ניתן לשייך ידנית');
                    classified++;
                } else {
                    updateStep(stepIdx, 'failed', clsResult.error || 'שגיאה');
                    failed++;
                }
            } catch (err) {
                updateStep(stepIdx, 'failed', err.message || 'שגיאה');
                failed++;
            }
            updateProgress(1 + i + 1);
        }

        // Phase 3: Finalize — delete original
        await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: classificationId,
                action: 'finalize-split',
            }),
        }, 15000);

        // Show summary
        const summaryText = failed > 0
            ? `הפיצול הושלם: ${classified} סווגו, ${failed} נכשלו`
            : `הפיצול הושלם: ${classified} מסמכים סווגו בהצלחה`;

        document.getElementById('splitCancelBtn').disabled = false;
        document.getElementById('splitCancelBtn').textContent = 'סגור';

        showAIToast(summaryText, failed > 0 ? 'warning' : 'success');
        await loadAIClassifications();

    } catch (err) {
        // Phase 1 failed — original reverted to pending by backend
        updateStep(0, 'failed', err.message);
        document.getElementById('splitCancelBtn').disabled = false;
        showModal('error', 'שגיאה בפיצול', err.message);
    }
}

// ---- Page Preview Lightbox (DL-246) ----

const splitPreviewState = {
    open: false,
    currentPage: 1,
    scale: 1,
    translateX: 0,
    translateY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    lastTranslateX: 0,
    lastTranslateY: 0,
};

async function openPagePreview(pageNum) {
    if (!splitState.pdfDoc) return;
    splitPreviewState.currentPage = pageNum;
    splitPreviewState.scale = 1;
    splitPreviewState.translateX = 0;
    splitPreviewState.translateY = 0;
    splitPreviewState.open = true;

    const overlay = document.getElementById('splitPagePreview');
    overlay.classList.add('show');

    document.addEventListener('keydown', handlePreviewKeydown);

    await renderPreviewPage(pageNum);
}

function closePagePreview() {
    splitPreviewState.open = false;
    document.getElementById('splitPagePreview').classList.remove('show');
    document.removeEventListener('keydown', handlePreviewKeydown);
    // Reset image to avoid flash of old content
    const img = document.getElementById('splitPreviewImage');
    img.src = '';
    img.style.transform = '';
}

let _previewRenderGen = 0;

async function renderPreviewPage(pageNum) {
    const gen = ++_previewRenderGen;

    const label = document.getElementById('splitPreviewPageLabel');
    label.textContent = `עמוד ${pageNum} מתוך ${splitState.pageCount}`;

    // Keep current zoom level, reset pan position
    splitPreviewState.translateX = 0;
    splitPreviewState.translateY = 0;

    const img = document.getElementById('splitPreviewImage');
    img.alt = '';

    try {
        const page = await splitState.pdfDoc.getPage(pageNum);
        const PREVIEW_SCALE = 1.5;
        const DPR = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: PREVIEW_SCALE });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width * DPR;
        canvas.height = viewport.height * DPR;

        const ctx = canvas.getContext('2d');
        ctx.scale(DPR, DPR);
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (gen !== _previewRenderGen) { page.cleanup(); return; } // stale render

        img.src = canvas.toDataURL('image/jpeg', 0.85);
        img.style.width = viewport.width + 'px';
        img.style.height = viewport.height + 'px';
        canvas.width = 0; // release backing store
        canvas.height = 0;
        page.cleanup();
        applyPreviewTransform(); // re-apply current zoom level
    } catch (err) {
        if (gen !== _previewRenderGen) return;
        console.error('[preview] Failed to render page:', err);
        img.alt = 'שגיאה בטעינת העמוד';
    }
}

function previewNavigate(delta) {
    if (!splitPreviewState.open) return;
    let newPage = splitPreviewState.currentPage + delta;
    if (newPage < 1) newPage = splitState.pageCount;
    if (newPage > splitState.pageCount) newPage = 1;
    splitPreviewState.currentPage = newPage;
    renderPreviewPage(newPage);
}

function previewZoom(direction) {
    const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];
    const currentIdx = ZOOM_STEPS.indexOf(splitPreviewState.scale);
    let newIdx;
    if (currentIdx === -1) {
        // Find nearest step
        newIdx = ZOOM_STEPS.findIndex(s => s >= splitPreviewState.scale);
        if (direction > 0) newIdx = Math.min(newIdx + 1, ZOOM_STEPS.length - 1);
        else newIdx = Math.max((newIdx ?? 1) - 1, 0);
    } else {
        newIdx = direction > 0
            ? Math.min(currentIdx + 1, ZOOM_STEPS.length - 1)
            : Math.max(currentIdx - 1, 0);
    }
    splitPreviewState.scale = ZOOM_STEPS[newIdx];
    // Reset pan when zooming back to exactly 1x
    if (splitPreviewState.scale === 1) {
        splitPreviewState.translateX = 0;
        splitPreviewState.translateY = 0;
    }
    applyPreviewTransform();
}

function applyPreviewTransform() {
    const img = document.getElementById('splitPreviewImage');
    const s = splitPreviewState.scale;
    const tx = splitPreviewState.translateX;
    const ty = splitPreviewState.translateY;
    img.style.transform = `scale(${s}) translate(${tx}px, ${ty}px)`;
    // Remove transition during drag for responsiveness
    img.style.transition = splitPreviewState.isDragging ? 'none' : 'transform 0.15s ease';

    document.getElementById('splitPreviewZoomLevel').textContent = `${Math.round(s * 100)}%`;

    // Update cursor based on zoom
    const container = document.getElementById('splitPreviewImageContainer');
    container.style.cursor = splitPreviewState.isDragging ? 'grabbing' : 'grab';
}

function handlePreviewKeydown(e) {
    if (!splitPreviewState.open) return;
    switch (e.key) {
        case 'Escape':
            closePagePreview();
            e.preventDefault();
            break;
        case 'ArrowRight':
            previewNavigate(-1); // RTL: right = previous
            e.preventDefault();
            break;
        case 'ArrowLeft':
            previewNavigate(1); // RTL: left = next
            e.preventDefault();
            break;
        case '+':
        case '=':
            previewZoom(1);
            e.preventDefault();
            break;
        case '-':
            previewZoom(-1);
            e.preventDefault();
            break;
    }
}

// Scroll wheel zoom + drag-to-pan (registered immediately — script loads at end of body)
(function initPreviewInteractions() {
    const container = document.getElementById('splitPreviewImageContainer');
    if (!container) return;

    container.addEventListener('wheel', (e) => {
        if (!splitPreviewState.open) return;
        e.preventDefault();
        const direction = e.deltaY < 0 ? 1 : -1;
        previewZoom(direction);
    }, { passive: false });

    // Double-click to toggle zoom
    container.addEventListener('dblclick', (e) => {
        if (!splitPreviewState.open) return;
        e.preventDefault();
        if (splitPreviewState.scale === 1) {
            splitPreviewState.scale = 2;
        } else {
            splitPreviewState.scale = 1;
            splitPreviewState.translateX = 0;
            splitPreviewState.translateY = 0;
        }
        applyPreviewTransform();
    });

    // Drag-to-pan
    container.addEventListener('mousedown', (e) => {
        if (!splitPreviewState.open) return;
        splitPreviewState.isDragging = true;
        splitPreviewState.dragStartX = e.clientX;
        splitPreviewState.dragStartY = e.clientY;
        splitPreviewState.lastTranslateX = splitPreviewState.translateX;
        splitPreviewState.lastTranslateY = splitPreviewState.translateY;
        container.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!splitPreviewState.isDragging) return;
        const dx = (e.clientX - splitPreviewState.dragStartX) / splitPreviewState.scale;
        const dy = (e.clientY - splitPreviewState.dragStartY) / splitPreviewState.scale;
        splitPreviewState.translateX = splitPreviewState.lastTranslateX + dx;
        splitPreviewState.translateY = splitPreviewState.lastTranslateY + dy;
        applyPreviewTransform();
    });

    document.addEventListener('mouseup', () => {
        if (!splitPreviewState.isDragging) return;
        splitPreviewState.isDragging = false;
        const container = document.getElementById('splitPreviewImageContainer');
        if (container) container.classList.remove('dragging');
        applyPreviewTransform(); // Re-enable transition
    });
})();
