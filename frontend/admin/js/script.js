// Configuration — API_BASE, ADMIN_TOKEN_KEY, STAGES, STAGE_NUM_TO_KEY
// are loaded from shared/constants.js

// DL-311: Guarded performance instrumentation — zero cost when disabled.
// Enable (persists across reload): `localStorage.ADMIN_PERF='1'; location.reload()`
// Disable: `localStorage.removeItem('ADMIN_PERF'); location.reload()`
// Read measures: `performance.getEntriesByType('measure').filter(m => m.name.startsWith('dl311:'))`.
try { if (localStorage.getItem('ADMIN_PERF') === '1') window.__ADMIN_PERF__ = true; } catch (_) {}
function perfStart() {
    return window.__ADMIN_PERF__ ? performance.now() : 0;
}
function perfEnd(name, start) {
    if (!window.__ADMIN_PERF__ || !start) return;
    const dur = performance.now() - start;
    try { performance.measure('dl311:' + name, { start, end: performance.now() }); } catch (_) {}
}

// DL-314: safeCreateIcons is now a no-op — sprite <use> references render natively,
// no DOM walk needed. Kept as a shim for any call sites we miss; delete in a follow-up.
function safeCreateIcons(_rootOrOpts) { /* no-op since DL-314 */ }

// DL-314: Inline SVG from sprite — replaces Lucide's runtime DOM walk.
// Sprite lives at the top of admin/index.html; icons referenced as #icon-NAME.
// `stroke="currentColor"` lets existing CSS color rules (e.g. var(--brand-500)) keep working.
function icon(name, sizeClass) {
    const cls = sizeClass ? `icon ${sizeClass}` : 'icon';
    return `<svg class="${cls}" aria-hidden="true" focusable="false" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"><use href="#icon-${name}"/></svg>`;
}

const SESSION_FLAG_KEY = 'admin_session_active';

// State
let authToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
let clientsData = [];
let importData = [];
let existingEmails = new Set();
let reviewQueueData = [];
let queuedEmailsData = []; // DL-281: Outbox-backed queued email list (both filing types)
let queuedEmailsLoaded = false; // DL-281: distinguishes "API returned empty" from "not loaded yet"
let queuedEmailsAutoRefreshInterval = null; // DL-281: 5-min poll so count/modal survive 08:00 delivery boundary when dashboard stays open
let showArchivedMode = false;
let dashboardLoaded = false;
let pendingClientsLoaded = false;
// Staleness timestamps — SWR: show cached data, refresh if stale (DL-247)
let dashboardLoadedAt = 0;
let pendingClientsLoadedAt = 0;
// DL-317: EverRendered flags — fetch-only prefetch warms data cache; render
// deferred to first switchTab. First click on each tab flips the flag.
let pendingClientsEverRendered = false;
let aiClassificationsEverRendered = false;
let pendingApprovalEverRendered = false;
let remindersEverRendered = false;
let questionnairesEverRendered = false;
const _batchQuestionsSentClients = new Set(); // DL-328: track sent clients this session
const STALE_AFTER_MS = 300000; // DL-311 B2: 5min — was 30s; visibilitychange + 5min auto-refresh handle real-time freshness, so 30s triggered too many full renders during natural workflows

// DL-256: Pagination state
let _clientsPage = 1;
let _qaPage = 1;
let _reminderPageA = 1;
let _reminderPageB = 1;
let _aiPage = 1;
const PAGE_SIZE = 50;
const AI_PAGE_SIZE = 10; // DL-268: AI review paginates by client groups, not documents (DL-330: lowered 25→10 to fit the narrower clients pane without internal scroll fatigue)

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
const debouncedFilterPendingApproval = debounce(filterPendingApproval, 150);
const debouncedSearchMessages = debounce(searchMessages, 300); // DL-273: longer debounce for API call
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

// DL-276: Auth splash helpers — eliminate login screen flash
function _hideSplash() {
    const splash = document.getElementById('authSplash');
    if (splash) {
        splash.classList.add('hidden');
        setTimeout(() => splash.remove(), 250); // clean up after fade
    }
}

function _showAppUI() {
    _hideSplash();
    document.getElementById('app').classList.add('visible');
    // DL-280 v2: swap fouc-hidden → visible. Class-based gate (see CSS .bottom-nav.fouc-hidden / .visible:not(.fouc-hidden)).
    const bn = document.getElementById('bottomNav');
    bn.classList.remove('fouc-hidden');
    bn.classList.add('visible');
    // DL-280 v2: chat widget migrated from sibling-combinator to explicit .visible class.
    const cw = document.getElementById('chatWidget');
    if (cw) cw.classList.add('visible');
    startBackgroundRefresh();
    safeCreateIcons();
    // DL-306: honor ?tab= URL param for deep links (e.g. ?tab=ai-review&client=CPA-XXX)
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    if (tabParam) switchTab(tabParam);
}

function _showLoginUI() {
    _hideSplash();
    document.getElementById('loginScreen').classList.add('visible');
}

async function login() {
    const password = document.getElementById('passwordInput').value;
    if (!password) return;

    // DL-276: Inline loading on login button instead of heavy overlay
    const btn = document.querySelector('.login-box .btn-primary');
    const btnOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="loader-dots" style="justify-content:center"><div class="loader-dot"></div><div class="loader-dot"></div><div class="loader-dot"></div></div>';
    document.getElementById('loginError').style.display = 'none';

    try {

        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_AUTH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        }, FETCH_TIMEOUTS.quick);

        const data = await response.json();

        if (data.ok && data.token) {
            authToken = data.token;
            localStorage.setItem(ADMIN_TOKEN_KEY, authToken);
            sessionStorage.setItem(SESSION_FLAG_KEY, 'true');
            document.getElementById('loginScreen').classList.remove('visible');
            _showAppUI();
            loadDashboard();
        } else {
            btn.disabled = false;
            btn.innerHTML = btnOriginal;
            document.getElementById('loginError').style.display = 'block';
        }
    } catch (error) {
        btn.disabled = false;
        btn.innerHTML = btnOriginal;
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

// DL-276: Auth gate — splash screen visible by default, JS decides login vs. app
async function checkAuth() {
    // No token — show login immediately
    if (!authToken) {
        _showLoginUI();
        return;
    }

    // Reject expired tokens
    if (isTokenExpired(authToken)) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_FLAG_KEY);
        authToken = '';
        _showLoginUI();
        return;
    }

    // Same session — skip API verify, show app + fire dashboard load
    if (sessionStorage.getItem(SESSION_FLAG_KEY) === 'true') {
        _showAppUI();
        loadDashboard();
        return;
    }

    // New tab/window — verify token + prefetch dashboard in parallel
    try {
        const [verifyResult] = await Promise.allSettled([
            fetchWithTimeout(ENDPOINTS.ADMIN_VERIFY, { headers: { 'Authorization': `Bearer ${authToken}` } }, FETCH_TIMEOUTS.quick).then(r => r.json()),
            loadDashboard() // optimistic prefetch — uses same stored authToken
        ]);

        if (verifyResult.status === 'fulfilled' && verifyResult.value.ok) {
            sessionStorage.setItem(SESSION_FLAG_KEY, 'true');
            _showAppUI(); // dashboard data already loaded via parallel prefetch
        } else {
            localStorage.removeItem(ADMIN_TOKEN_KEY);
            sessionStorage.removeItem(SESSION_FLAG_KEY);
            authToken = '';
            _showLoginUI();
        }
    } catch (error) {
        _showLoginUI();
    }
}

// bfcache guard: if page is restored from cache with expired/missing token, force logout UI
window.addEventListener('pageshow', (e) => {
    if (e.persisted && (!authToken || isTokenExpired(authToken))) {
        document.getElementById('app').classList.remove('visible');
        // DL-280 v2: symmetric inverse — remove .visible, restore .fouc-hidden so nav hides cleanly.
        const bn = document.getElementById('bottomNav');
        bn.classList.remove('visible');
        bn.classList.add('fouc-hidden');
        // DL-280 v2: hide chat widget on bfcache restore with invalid token.
        const cw = document.getElementById('chatWidget');
        if (cw) cw.classList.remove('visible');
        document.getElementById('loginScreen').classList.add('visible');
    }
});

// Enter key to login
document.getElementById('passwordInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});

// ==================== TABS ====================

const TAB_DROPDOWN_TABS = { send: 'שליחת שאלונים', questionnaires: 'שאלונים שהתקבלו' };
const TAB_REVIEW_DROPDOWN_TABS = { 'pending-approval': 'סקירת שאלונים', 'ai-review': 'סקירת AI' };

// DL-311 B6: leading-edge debounce to prevent double-click from re-entering the
// load pipeline twice. 150ms is short enough to feel instant but blocks accidental
// duplicate taps on mobile and rapid keyboard nav.
let _lastSwitchTabAt = 0;
let _lastSwitchTabName = '';
function switchTab(tabName, evt) {
    const now = Date.now();
    if (tabName === _lastSwitchTabName && (now - _lastSwitchTabAt) < 150) return;
    _lastSwitchTabAt = now;
    _lastSwitchTabName = tabName;
    const _tSwitch = perfStart();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    if (tabName in TAB_DROPDOWN_TABS) {
        const wrapperBtn = document.querySelector('.tab-dropdown-wrapper[data-group="questionnaires"] > .tab-item');
        if (wrapperBtn) wrapperBtn.classList.add('active');
        document.getElementById('tabDropdownLabel').textContent = TAB_DROPDOWN_TABS[tabName];
    } else if (tabName in TAB_REVIEW_DROPDOWN_TABS) {
        const wrapperBtn = document.querySelector('.tab-dropdown-wrapper[data-group="reviews"] > .tab-item');
        if (wrapperBtn) wrapperBtn.classList.add('active');
        document.getElementById('tabReviewDropdownLabel').textContent = TAB_REVIEW_DROPDOWN_TABS[tabName];
        _activeReviewSubTab = tabName;
        _syncReviewsGroupBadge();
    } else if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add('active');
    }
    const activeTabEl = document.getElementById(`tab-${tabName}`);
    activeTabEl.classList.add('active');
    // DL-311 B4: scope icon replacement to just the activated tab content, not full doc
    safeCreateIcons(activeTabEl);

    // Sync bottom nav active state (mobile)
    syncBottomNav(tabName);

    // DL-311 B1: Only re-load dashboard data when landing ON the dashboard tab.
    // Previously loadDashboard fired on every tab switch (even when user was moving
    // AWAY from dashboard), causing a 1.5-1.9s render burst each time once data
    // went stale. Dashboard data stays fresh via visibilitychange + 5min auto-refresh.
    // DL-247: Always silent on tab switch — show cached data, refresh if stale
    if (tabName === 'dashboard') {
        loadDashboard(true);
    } else if (tabName === 'review') {
        // review tab depends on reviewQueueData (populated by loadDashboard); only
        // re-fetch if we've never loaded dashboard yet. Stale data is fine —
        // visibilitychange handler refreshes when user returns to the app.
        if (!dashboardLoaded) loadDashboard(true);
    } else if (tabName === 'send') {
        loadPendingClients(true);
    } else if (tabName === 'pending-approval') {
        loadPendingApprovalQueue(true);
    } else if (tabName === 'ai-review') {
        loadAIClassifications(true);
    } else if (tabName === 'reminders') {
        loadReminders(true);
    } else if (tabName === 'questionnaires') {
        loadQuestionnaires(true);
    }
    perfEnd('switchTab:' + tabName, _tSwitch);
}

function openTabDropdown(wrapper) {
    if (!wrapper) return;
    const btn = wrapper.querySelector(':scope > .tab-item');
    const menu = wrapper.querySelector(':scope > .tab-dropdown-menu');
    if (!btn || !menu || menu.classList.contains('open')) return;
    closeAllRowMenus();
    positionFloating(btn, menu);
    menu.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    safeCreateIcons();
}

function closeTabDropdown(wrapper) {
    if (!wrapper) return;
    const btn = wrapper.querySelector(':scope > .tab-item');
    const menu = wrapper.querySelector(':scope > .tab-dropdown-menu');
    if (menu) menu.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    const t = wrapper._closeTimer;
    if (t) { clearTimeout(t); wrapper._closeTimer = null; }
}

function toggleTabDropdown(event) {
    event.stopPropagation();
    // Hover-capable devices: hover listeners own open/close — ignore clicks
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const wrapper = event.currentTarget.parentElement;
    const menu = wrapper.querySelector(':scope > .tab-dropdown-menu');
    if (!menu) return;
    if (menu.classList.contains('open')) closeTabDropdown(wrapper);
    else openTabDropdown(wrapper);
}

function switchTabFromDropdown(tabName, event) {
    event.stopPropagation();
    const wrapper = event.currentTarget.closest('.tab-dropdown-wrapper');
    closeTabDropdown(wrapper);
    switchTab(tabName);
}

// Hover-open for desktop (mouse) only. Touch keeps click-toggle.
function setupTabDropdownHover() {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!mq.matches) return;
    const CLOSE_DELAY = 200;
    document.querySelectorAll('.tab-dropdown-wrapper').forEach(wrapper => {
        const scheduleClose = () => {
            if (wrapper._closeTimer) clearTimeout(wrapper._closeTimer);
            wrapper._closeTimer = setTimeout(() => closeTabDropdown(wrapper), CLOSE_DELAY);
        };
        const cancelClose = () => {
            if (wrapper._closeTimer) { clearTimeout(wrapper._closeTimer); wrapper._closeTimer = null; }
        };
        wrapper.addEventListener('mouseenter', () => {
            cancelClose();
            // Close siblings so only one is open
            document.querySelectorAll('.tab-dropdown-wrapper').forEach(w => {
                if (w !== wrapper) closeTabDropdown(w);
            });
            openTabDropdown(wrapper);
        });
        wrapper.addEventListener('mouseleave', scheduleClose);
        const menu = wrapper.querySelector(':scope > .tab-dropdown-menu');
        if (menu) {
            menu.addEventListener('mouseenter', cancelClose);
            menu.addEventListener('mouseleave', scheduleClose);
        }
    });
}

// ==================== MOBILE BOTTOM NAV ====================

function syncBottomNav(tabName) {
    const bottomNav = document.getElementById('bottomNav');
    if (!bottomNav) return;

    bottomNav.querySelectorAll('.bottom-nav-item').forEach(btn => btn.classList.remove('active'));

    const questGroupTabs = ['send', 'questionnaires'];
    const reviewsGroupTabs = ['pending-approval', 'ai-review'];
    const moreGroupTabs = ['review', 'reminders'];

    let dataTab = tabName;
    if (questGroupTabs.includes(tabName)) dataTab = 'questionnaires-group';
    else if (reviewsGroupTabs.includes(tabName)) dataTab = 'reviews-group';
    else if (moreGroupTabs.includes(tabName)) dataTab = 'more';

    const target = bottomNav.querySelector(`[data-tab="${dataTab}"]`);
    if (target) target.classList.add('active');

    closeBottomNavPopovers();
}

function _bnPopoverToggle(targetId, event) {
    event.stopPropagation();
    const popover = document.getElementById(targetId);
    if (!popover) return;
    const backdrop = document.getElementById('bottomNavBackdrop');
    const wasOpen = popover.classList.contains('open');

    // Close other popovers
    ['bottomNavQuestPopover', 'bottomNavReviewsPopover', 'bottomNavMorePopover'].forEach(id => {
        if (id !== targetId) {
            const p = document.getElementById(id);
            if (p) p.classList.remove('open');
        }
    });

    popover.classList.toggle('open', !wasOpen);
    if (backdrop) backdrop.classList.toggle('open', !wasOpen);

    if (!wasOpen) {
        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();
        const popW = 200;
        let leftPos = rect.left + rect.width / 2 - popW / 2;
        leftPos = Math.max(8, Math.min(leftPos, window.innerWidth - popW - 8));
        popover.style.left = leftPos + 'px';
    }

    safeCreateIcons();
}

function toggleBottomNavSubmenu(event) { _bnPopoverToggle('bottomNavQuestPopover', event); }
function toggleBottomNavReviews(event) { _bnPopoverToggle('bottomNavReviewsPopover', event); }
function toggleBottomNavMore(event) { _bnPopoverToggle('bottomNavMorePopover', event); }

function closeBottomNavPopovers() {
    ['bottomNavQuestPopover', 'bottomNavReviewsPopover', 'bottomNavMorePopover'].forEach(id => {
        const p = document.getElementById(id);
        if (p) p.classList.remove('open');
    });
    const b = document.getElementById('bottomNavBackdrop');
    if (b) b.classList.remove('open');
}

function switchTabFromBottomNav(tabName, event) {
    event.stopPropagation();
    closeBottomNavPopovers();
    switchTab(tabName);
}

let _reviewsAiCount = 0;
let _reviewsPaCount = 0;
let _activeReviewSubTab = null; // 'pending-approval' | 'ai-review' | null
function _syncReviewsGroupBadge() {
    const badge = document.getElementById('reviewsBottomBadge');
    const desktopBadge = document.getElementById('reviewsDesktopBadge');
    const total = (_reviewsAiCount || 0) + (_reviewsPaCount || 0);
    const desktopCount = _activeReviewSubTab === 'pending-approval' ? (_reviewsPaCount || 0)
        : _activeReviewSubTab === 'ai-review' ? (_reviewsAiCount || 0)
        : total;
    if (total > 0) {
        if (badge) { badge.textContent = ''; badge.style.display = 'inline-block'; }
        if (desktopBadge) { desktopBadge.textContent = String(desktopCount); desktopBadge.style.display = 'inline-flex'; }
    } else {
        if (badge) badge.style.display = 'none';
        if (desktopBadge) desktopBadge.style.display = 'none';
    }
}

function syncAIBadge(topBadge, count) {
    const bottomBadge = document.getElementById('aiReviewBottomBadge');
    topBadge.classList.remove('ai-badge-loading');
    if (count > 0) {
        topBadge.textContent = count;
        topBadge.style.display = 'inline-flex';
        if (bottomBadge) { bottomBadge.textContent = count; bottomBadge.style.display = 'inline-flex'; }
    } else {
        topBadge.style.display = 'none';
        if (bottomBadge) bottomBadge.style.display = 'none';
    }
    _reviewsAiCount = count || 0;
    _syncReviewsGroupBadge();
}

// ==================== MOBILE PREVIEW MODAL (AI Review) ====================

let mobilePreviewCardIds = []; // ordered list of visible card IDs for nav
let mobilePreviewCurrentIdx = -1;

function getMobilePreviewCardIds() {
    // Get visible card IDs in DOM order (respects current filters)
    const cards = document.querySelectorAll('#aiClientsPane .ai-review-card:not([style*="display: none"]), #aiDocsPane .ai-review-card:not([style*="display: none"])');
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
        errorMsg.textContent = humanizeError(err);
        const retryBtn = document.getElementById('mobilePreviewRetryBtn');
        if (retryBtn) {
            const isTimeout = err?.name === 'TimeoutError' || /signal timed out/i.test(err?.message || '');
            retryBtn.style.display = isTimeout ? '' : 'none';
            retryBtn.onclick = () => loadMobileDocPreview(item.id);
        }
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
        const docDisplayName = appendContractPeriod(item.matched_short_name || item.matched_template_name || 'לא ידוע', item);
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
                    ${icon('check', 'icon-sm')} נכון
                </button>
                <button class="btn btn-link btn-sm" onclick="closeMobilePreview(); showAIReassignModal('${escapeAttr(item.id)}')">
                    ${icon('arrow-right-left', 'icon-sm')} לא נכון, שייך מחדש
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}'); closeMobilePreview();">
                    ${icon('x', 'icon-sm')} מסמך לא רלוונטי
                </button>
            </div>`;

    } else if (state === 'issuer-mismatch') {
        const templateName = appendContractPeriod(item.matched_short_name || item.matched_template_name || item.matched_template_id || '', item);
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
                    ${icon('arrow-right-left', 'icon-sm')} שייך מחדש
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}'); closeMobilePreview();">
                    ${icon('x', 'icon-sm')} מסמך לא רלוונטי
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
                    ${icon('arrow-right-left', 'icon-sm')} שייך ידנית
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}'); closeMobilePreview();">
                    ${icon('x', 'icon-sm')} מסמך לא רלוונטי
                </button>
            </div>`;
    }

    const clientName = item.client_name || '';
    const clientHeader = clientName
        ? `<div class="mobile-preview-client">${icon('user', 'icon-sm')} ${escapeHtml(clientName)}</div>`
        : '';

    // DL-270: Contract period banner for mobile preview — editable
    let mobileContractBanner = '';
    if (['T901', 'T902'].includes(item.matched_template_id)) {
        const cp = item.contract_period;
        const rid = escapeAttr(item.id);
        const year = item.year || new Date().getFullYear();
        if (cp && cp.coversFullYear) {
            mobileContractBanner = `<div class="ai-contract-period-banner" style="background:#f0fdf4;border-color:#22c55e33;color:#166534;"><span class="period-label">📅 חוזה שנתי מלא ✓</span></div>`;
        } else {
            const hasEnd = cp && cp.endDate;
            const endMonth = hasEnd ? new Date(cp.endDate).getMonth() + 1 : null;
            const startMonth = cp && cp.startDate ? new Date(cp.startDate).getMonth() + 1 : null;
            const startVal = cp && cp.startDate ? cp.startDate.substring(0, 7) : '';
            const endVal = hasEnd ? cp.endDate.substring(0, 7) : '';
            const startLabel = startMonth ? `${String(startMonth).padStart(2,'0')}.${year}` : '__.__';
            const endLabel = endMonth ? `${String(endMonth).padStart(2,'0')}.${year}` : '__.__';
            const statusText = cp ? 'חוזה חלקי' : 'לא זוהו תאריכים';
            let mobileBtns = '';
            if (startMonth && startMonth > 1) {
                mobileBtns += `<button class="btn btn-outline btn-sm btn-request-period" data-record-id="${rid}" data-gap="before" onclick="event.stopPropagation(); requestMissingPeriod('${rid}', 1, ${startMonth - 1}, this)">${icon('plus', 'icon-sm')} בקש חוזה ${formatPeriodLabel(1, startMonth - 1, year)}</button>`;
            }
            if (endMonth && endMonth < 12) {
                mobileBtns += `<button class="btn btn-outline btn-sm btn-request-period" data-record-id="${rid}" data-gap="after" onclick="event.stopPropagation(); requestMissingPeriod('${rid}', ${endMonth + 1}, 12, this)">${icon('plus', 'icon-sm')} בקש חוזה ${formatPeriodLabel(endMonth + 1, 12, year)}</button>`;
            }
            mobileContractBanner = `
            <div class="ai-contract-period-banner" data-record-id="${rid}">
                <span class="period-label">📅 ${statusText}:
                    מ
                    <span class="contract-date-editable" data-field="start" data-value="${escapeAttr(startVal)}" onclick="event.stopPropagation(); editContractDate('${rid}', 'start', this)" title="לחץ לעריכה">${startLabel}</span>
                    עד
                    <span class="contract-date-editable" data-field="end" data-value="${escapeAttr(endVal)}" onclick="event.stopPropagation(); editContractDate('${rid}', 'end', this)" title="לחץ לעריכה">${endLabel}</span>
                </span>
                ${mobileBtns}
            </div>`;
        }
    }

    footer.innerHTML = clientHeader + classificationHtml + mobileContractBanner + actionsHtml;
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

        // DL-311: measure full post-fetch sync block
        const _tSync = perfStart();

        // Update stats (recalculate client-side to exclude deactivated)
        const _tStats = perfStart();
        recalculateStats();
        perfEnd('loadDashboard:recalculateStats', _tStats);
        existingEmails = new Set(clientsData.map(c => c.email?.toLowerCase()));

        // Store review queue data (unfiltered) + render filtered by entity tab
        reviewQueueData = data.review_queue || [];
        updateReviewQueueUI();

        // DL-255: Reset base key to force full rebuild, then filterClients handles render + hide/show
        _clientsBaseKey = '';
        _clientsSortKey = '';

        // Render table via filterClients (builds full base set, applies current filters)
        const _tFilter = perfStart();
        const currentStageFilter = document.getElementById('stageFilter').value;
        toggleStageFilter(currentStageFilter, false); // Pass false to prevent re-filtering
        perfEnd('loadDashboard:toggleStageFilter', _tFilter);

        // DL-311 B4: scope icon replacement to the dashboard tab only (was full-doc walk)
        const dashboardTabEl = document.getElementById('tab-dashboard');
        safeCreateIcons(dashboardTabEl || undefined);
        perfEnd('loadDashboard:postFetchSync', _tSync);

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

        // DL-311 B5: Stagger prefetch loaders — each gets its own frame instead of
        // all firing inside a single requestIdleCallback (which bundles 7 render
        // bursts into one long task). Uses scheduler.postTask('background') when
        // available, falling back to setTimeout(16ms) chain.
        const postBg = (cb) => {
            if (typeof scheduler !== 'undefined' && scheduler.postTask) {
                scheduler.postTask(cb, { priority: 'background' });
            } else if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(cb, { timeout: 2000 });
            } else {
                setTimeout(cb, 16);
            }
        };
        // DL-317: Fetch-only prefetch for heavy tab loaders — warms data cache,
        // defers render to first tab click. Light accessories (badge counts,
        // side panels) still run in full. Heavy loaders pass prefetchOnly=true
        // so they fetch+cache but skip their render burst. First switchTab
        // then paints cached data instantly (dl317:*:render mark) without
        // an extra fetch.
        // Note: loadAIReviewCount removed in DL-321 — loadAIClassifications(true, true) handles badge updates.
        const prefetchPipeline = [
            () => loadReminderCount(),
            () => loadRecentMessages(), // DL-261
            () => loadQueuedEmails(), // DL-281
            () => {
                if (!queuedEmailsAutoRefreshInterval) {
                    queuedEmailsAutoRefreshInterval = setInterval(() => {
                        if (document.visibilityState === 'visible' && authToken) loadQueuedEmails();
                    }, 5 * 60 * 1000);
                }
            },
            () => updateActiveFilterCount(), // DL-214
            // DL-317: Fetch-only prefetch — warms data cache, defers render to tab click.
            () => loadPendingClients(true, true),
            () => loadAIClassifications(true, true),
            () => loadPendingApprovalQueue(true, true),
            () => loadReminders(true, true),
            () => loadQuestionnaires(true, true),
        ];
        const _tPrefetchSchedule = perfStart();
        let _prefetchIdx = 0;
        const runNext = () => {
            if (_prefetchIdx >= prefetchPipeline.length) {
                perfEnd('loadDashboard:prefetchSchedule', _tPrefetchSchedule);
                return;
            }
            const step = prefetchPipeline[_prefetchIdx++];
            const _tStep = perfStart();
            try { step(); } catch (e) { console.warn('[DL311] prefetch step failed', e); }
            perfEnd('prefetch:step' + _prefetchIdx, _tStep);
            postBg(runNext);
        };
        postBg(runNext);
    } catch (error) {

        console.error('Dashboard load failed', error);
        if (!silent) showModal('error', 'שגיאה', 'לא ניתן לטעון את הנתונים', null, { label: 'רענן', onClick: () => location.reload() });
    }
}

// DL-261: Recent client messages side panel
let recentMessagesLoaded = false;
let _allMessages = []; // DL-271: full message list for client-side pagination
let _messagesVisible = 10; // DL-271: how many to show
let _searchCache = null; // DL-273: cached all-years messages for instant client-side search

function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    // Normalize: extract date part and optional time
    const dateOnly = dateStr.slice(0, 10);
    const hasTime = dateStr.length > 10 && dateStr.includes('T');
    const today = new Date().toISOString().slice(0, 10);
    if (dateOnly === today) {
        if (hasTime) {
            const d = new Date(dateStr);
            return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        }
        return 'היום';
    }
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateOnly === yesterday) return 'אתמול';
    const days = Math.floor((Date.now() - new Date(dateOnly + 'T12:00:00').getTime()) / 86400000);
    if (days < 7) return `לפני ${days} ימים`;
    if (days < 30) return `לפני ${Math.floor(days / 7)} שבועות`;
    return dateOnly.replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1');
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

        _allMessages = data.messages || [];
        _messagesVisible = 10;
        recentMessagesLoaded = true;

        renderMessages();
    } catch (error) {
        console.error('Recent messages load failed', error);
        const container = document.getElementById('recentMessagesContainer');
        if (container) container.innerHTML = '';
    }
}

// DL-273: Search messages — fetch all-years once, then filter client-side
async function searchMessages() {
    if (!authToken) return;
    const q = (document.getElementById('msgSearchInput')?.value || '').trim().toLowerCase();
    const clearBtn = document.getElementById('msgSearchClear');
    if (clearBtn) clearBtn.style.display = q ? '' : 'none';

    if (!q) {
        loadRecentMessages(); // restore normal view
        return;
    }

    // First search: fetch all messages across all years (API caches in KV for 30 min)
    if (!_searchCache) {
        const container = document.getElementById('recentMessagesContainer');
        if (container) container.innerHTML = '<div class="msg-empty"><div class="spinner"></div><p style="margin-top:8px;color:var(--gray-400)">מחפש...</p></div>';
        try {
            const response = await fetchWithTimeout(
                `${ENDPOINTS.ADMIN_RECENT_MESSAGES}?q=_all&_t=${Date.now()}`,
                { headers: { 'Authorization': `Bearer ${authToken}` } },
                FETCH_TIMEOUTS.load
            );
            const data = await response.json();
            if (!data.ok) return;
            _searchCache = data.messages || [];
        } catch (error) {
            console.error('Message search cache load failed', error);
            return;
        }
    }

    // Client-side filter — instant for subsequent keystrokes
    _allMessages = _searchCache.filter(m =>
        (m.client_name || '').toLowerCase().includes(q) ||
        (m.summary || '').toLowerCase().includes(q) ||
        (m.raw_snippet || '').toLowerCase().includes(q)
    );
    _messagesVisible = 10;
    renderMessages();
}

// DL-273: Clear search and restore recent messages
function clearMessageSearch() {
    const input = document.getElementById('msgSearchInput');
    if (input) input.value = '';
    const clearBtn = document.getElementById('msgSearchClear');
    if (clearBtn) clearBtn.style.display = 'none';
    loadRecentMessages();
}

// DL-271: Render visible slice of messages with "load more" link
function renderMessages() {
    const container = document.getElementById('recentMessagesContainer');
    if (!container) return;

    if (_allMessages.length === 0) {
        container.innerHTML = `
            <div class="msg-empty">
                ${icon('inbox', 'icon-2xl')}
                <p>אין הודעות אחרונות</p>
            </div>`;
        safeCreateIcons(container);
        return;
    }

    const visible = _allMessages.slice(0, _messagesVisible);
    const hasMore = _messagesVisible < _allMessages.length;
    const remaining = _allMessages.length - _messagesVisible;

    const rowsHtml = visible.map(m => {
        const navParam = m.client_id ? `client_id=${encodeURIComponent(m.client_id)}` : `report_id=${encodeURIComponent(m.report_id)}`;
        const displayText = m.raw_snippet || m.summary || '';
        const noteId = escapeHtml(m.id || '');
        const reportId = escapeHtml(m.report_id || '');
        const replies = Array.isArray(m.replies) ? m.replies : [];
        const repliesHtml = replies.length > 0
            ? `<div class="msg-thread-replies">${replies.map((r, i) => `
                <div class="msg-office-reply">
                    <div class="msg-reply-label">${icon('corner-down-left', 'icon-xs')} ${replies.length > 1 ? `תגובת המשרד #${i + 1}` : 'תגובת המשרד'}</div>
                    <div class="msg-reply-text">${escapeHtml(r.summary)}</div>
                    <div class="msg-reply-date">${formatRelativeTime(r.date)}</div>
                </div>`).join('')}</div>`
            : '';
        return `<div class="msg-row" data-note-id="${noteId}" data-client-name="${escapeAttr(m.client_name)}" data-year="${escapeAttr(String(m.year || ''))}">
            <div class="msg-content" onclick="this.parentElement.classList.toggle('expanded')">
                <div class="msg-meta">
                    <span class="msg-client">${escapeHtml(m.client_name)}</span>
                    <span class="msg-date">${formatRelativeTime(m.date)}</span>
                </div>
                <div class="msg-summary">"${escapeHtml(displayText)}"</div>
                ${repliesHtml}
            </div>
            <div class="msg-actions">
                <button class="msg-action-btn" title="השב ללקוח" onclick="event.stopPropagation(); showReplyInput('${noteId}', '${reportId}')">${icon('message-square', 'icon-xs')}</button>
                <button class="msg-action-btn" title="פתח בניהול מסמכים" onclick="window.open('../document-manager.html?${navParam}', '_blank')">${icon('folder-open', 'icon-xs')}</button>
                <button class="msg-action-btn msg-action-btn--success" title="סמן כטופל" onclick="markMessageHandled('${noteId}', '${reportId}')">${icon('check', 'icon-sm')}</button>
            </div>
        </div>`;
    }).join('');

    const loadMoreHtml = hasMore
        ? `<div class="msg-load-more" onclick="_messagesVisible += 10; renderMessages();">הצג עוד...</div>`
        : '';

    container.innerHTML = rowsHtml + loadMoreHtml;
    safeCreateIcons(container);
}

// DL-288: Mark a recent message as handled (soft-hide, no confirmation)
function markMessageHandled(noteId, reportId) {
    deleteRecentMessage(noteId, reportId, 'hide');
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

        // DL-271: Remove from in-memory array and re-render
        _allMessages = _allMessages.filter(m => m.id !== noteId);
        const row = document.querySelector(`.msg-row[data-note-id="${noteId}"]`);
        if (row) {
            row.style.transition = 'opacity 0.3s, max-height 0.3s';
            row.style.opacity = '0';
            row.style.maxHeight = '0';
            row.style.overflow = 'hidden';
            setTimeout(() => renderMessages(), 300);
        }

        showAIToast(mode === 'permanent' ? 'ההודעה נמחקה לצמיתות' : 'סומן כטופל ✓', 'success');
    } catch (err) {
        showAIToast('שגיאה: ' + (err.message || 'Unknown error'), 'error');
    }
}

// DL-266: Show inline reply input below a message
function showReplyInput(noteId, reportId, containerEl) {
    const row = containerEl
             || document.querySelector(`.msg-row[data-note-id="${noteId}"]`)
             || document.querySelector(`.ai-cn-entry[data-note-id="${noteId}"]`);
    if (!row) return;
    // Don't add twice
    if (row.querySelector('.msg-reply-zone')) return;
    const clientName = row.dataset.clientName || '';
    const year = row.dataset.year || '';

    row.classList.add('expanded');
    const replyZone = document.createElement('div');
    replyZone.className = 'msg-reply-zone';
    replyZone.innerHTML = `
        <div class="msg-reply-textarea-wrap" dir="rtl">
            <textarea class="msg-reply-textarea" placeholder="הקלד תגובה..." dir="rtl" rows="2"></textarea>
            <button type="button" class="msg-reply-expand-btn" title="הרחב חלון כתיבה">${icon('maximize-2', 'icon-xs')}</button>
        </div>
        <div class="msg-reply-buttons">
            <button class="btn btn-sm btn-primary msg-reply-send" disabled>
                ${icon('send', 'icon-xs')} שלח תגובה
            </button>
            <button class="btn btn-sm btn-ghost msg-reply-cancel">ביטול</button>
        </div>
    `;
    row.appendChild(replyZone);
    safeCreateIcons(replyZone);

    const textarea = replyZone.querySelector('.msg-reply-textarea');
    const sendBtn = replyZone.querySelector('.msg-reply-send');
    const cancelBtn = replyZone.querySelector('.msg-reply-cancel');

    const expandBtn = replyZone.querySelector('.msg-reply-expand-btn');
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            expandReplyCompose(noteId, reportId, textarea.value, (newText) => {
                textarea.value = newText;
                sendBtn.disabled = !textarea.value.trim();
            }, clientName, year);
        });
    }

    textarea.addEventListener('input', () => {
        sendBtn.disabled = !textarea.value.trim();
    });
    textarea.focus();

    cancelBtn.addEventListener('click', () => {
        replyZone.remove();
        row.classList.remove('expanded');
    });

    sendBtn.addEventListener('click', () => sendReply(noteId, reportId, textarea.value.trim(), sendBtn, replyZone, row));
}

// DL-266: Send reply comment to client
async function sendReply(noteId, reportId, commentText, sendBtn, replyZone, row) {
    if (!commentText) return;
    sendBtn.disabled = true;
    sendBtn.innerHTML = `${icon('loader', 'icon-xs spin')} שולח...`;
    safeCreateIcons(sendBtn);

    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_SEND_COMMENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ report_id: reportId, note_id: noteId, comment_text: commentText })
        }, FETCH_TIMEOUTS.save);
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || 'Failed');

        replyZone.remove();
        row.classList.remove('expanded');

        if (result.queued) {
            showAIToast('תגובה תישלח ב-08:00', 'success');
        } else if (result.email_failed) {
            showAIToast('התגובה נשמרה אך שליחת המייל נכשלה', 'warning');
        } else {
            showAIToast('תגובה נשלחה ✓', 'success');
        }

        // DL-288: Prompt to mark as handled (skip if email failed or replying from AI Review)
        if (!result.email_failed && !row.classList.contains('ai-cn-entry')) {
            showPostReplyPrompt(noteId, reportId, row);
        } else {
            loadRecentMessages();
        }
    } catch (err) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = `${icon('send', 'icon-xs')} שלח תגובה`;
        safeCreateIcons(sendBtn);
        showAIToast('שגיאה בשליחת תגובה: ' + (err.message || 'Unknown error'), 'error');
    }
}

// DL-288: After a successful reply, prompt the office to mark the message as handled.
// Replaces row content with an inline strip; auto-dismisses after 8s = "leave open".
// DL-288: After a successful reply, prompt the office to mark the message as handled.
// Appends an inline strip BELOW the row's existing content (original message + replies stay visible).
// Auto-dismisses after 8s = "leave open".
function showPostReplyPrompt(noteId, reportId, row) {
    if (!row || !row.parentElement) {
        loadRecentMessages();
        return;
    }
    // Avoid duplicate prompts on rapid double-replies
    const existing = row.querySelector('.msg-post-reply-prompt');
    if (existing) existing.remove();

    const prompt = document.createElement('div');
    prompt.className = 'msg-post-reply-prompt';
    prompt.innerHTML = `
        <div class="msg-prompt-text">נשלח ✓ &nbsp;סמן כטופל?</div>
        <div class="msg-prompt-actions">
            <button class="btn btn-sm btn-primary" data-action="handled">סמן כטופל</button>
            <button class="btn btn-sm btn-ghost" data-action="keep">השאר פתוח</button>
        </div>
    `;
    row.appendChild(prompt);
    safeCreateIcons(prompt);

    let dismissed = false;
    const cleanup = (mode) => {
        if (dismissed) return;
        dismissed = true;
        clearTimeout(timer);
        if (mode === 'handled') {
            // markMessageHandled fades the whole row out + reloads — no need to remove the prompt first
            markMessageHandled(noteId, reportId);
        } else {
            prompt.remove();
            loadRecentMessages();
        }
    };
    prompt.querySelector('[data-action="handled"]').addEventListener('click', () => cleanup('handled'));
    prompt.querySelector('[data-action="keep"]').addEventListener('click', () => cleanup('keep'));
    const timer = setTimeout(() => cleanup('keep'), 8000);
}

// DL-288: Gmail-style expanded compose modal with live email preview
function expandReplyCompose(noteId, reportId, initialText, onCollapse, clientName, year) {
    // Cleanup any prior modal
    document.querySelectorAll('.ai-modal-overlay.msg-compose-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'ai-modal-overlay msg-compose-overlay';
    overlay.innerHTML = `
        <div class="ai-modal-panel msg-compose-modal" dir="rtl">
            <div class="msg-compose-header">
                <div class="msg-compose-title">כתיבת תגובה</div>
                <button type="button" class="msg-compose-collapse-btn" title="כווץ חזרה">${icon('minimize-2', 'icon-sm')}</button>
            </div>
            <div class="msg-compose-grid">
                <div class="msg-compose-pane">
                    <div class="msg-compose-pane-label">תוכן ההודעה</div>
                    <textarea class="msg-compose-textarea" dir="rtl" placeholder="הקלד הודעה..."></textarea>
                </div>
                <div class="msg-compose-pane">
                    <div class="msg-compose-pane-label">תצוגה מקדימה</div>
                    <div class="msg-compose-preview-wrap">
                        <div class="msg-preview-empty">הקלד הודעה לתצוגה מקדימה</div>
                    </div>
                </div>
            </div>
            <div class="msg-compose-footer">
                <button class="btn btn-sm btn-ghost msg-compose-cancel">ביטול</button>
                <button class="btn btn-sm btn-primary msg-compose-send" disabled>
                    ${icon('send', 'icon-xs')} שלח תגובה
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    // Trigger display — .ai-modal-overlay is display:none until .show is added
    requestAnimationFrame(() => overlay.classList.add('show'));
    safeCreateIcons(overlay);

    const textarea = overlay.querySelector('.msg-compose-textarea');
    const previewWrap = overlay.querySelector('.msg-compose-preview-wrap');
    const sendBtn = overlay.querySelector('.msg-compose-send');
    const cancelBtn = overlay.querySelector('.msg-compose-cancel');
    const collapseBtn = overlay.querySelector('.msg-compose-collapse-btn');

    textarea.value = initialText || '';
    sendBtn.disabled = !textarea.value.trim();
    textarea.focus();
    // Move cursor to end
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    let previewTimer = null;
    let previewSeq = 0;
    const renderPreview = () => {
        const text = textarea.value;
        if (!text.trim()) {
            previewWrap.innerHTML = '<div class="msg-preview-empty">הקלד הודעה לתצוגה מקדימה</div>';
            return;
        }
        const seq = ++previewSeq;
        // Loading badge
        if (!previewWrap.querySelector('iframe')) {
            previewWrap.innerHTML = '<iframe class="msg-preview-iframe" srcdoc=""></iframe><div class="msg-preview-loading">מעדכן...</div>';
        } else {
            let badge = previewWrap.querySelector('.msg-preview-loading');
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'msg-preview-loading';
                badge.textContent = 'מעדכן...';
                previewWrap.appendChild(badge);
            }
        }
        fetchWithTimeout(ENDPOINTS.ADMIN_COMMENT_PREVIEW, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ report_id: reportId, comment_text: text, ...(clientName ? { client_name: clientName } : {}), ...(year ? { year } : {}) })
        }, FETCH_TIMEOUTS.load).then(r => r.json()).then(data => {
            if (seq !== previewSeq) return; // stale
            if (data.ok && data.html) {
                const iframe = previewWrap.querySelector('iframe') || (() => {
                    previewWrap.innerHTML = '<iframe class="msg-preview-iframe" srcdoc=""></iframe>';
                    return previewWrap.querySelector('iframe');
                })();
                iframe.srcdoc = data.html;
            }
            const badge = previewWrap.querySelector('.msg-preview-loading');
            if (badge) badge.remove();
        }).catch(err => {
            console.error('Preview fetch failed', err);
            const badge = previewWrap.querySelector('.msg-preview-loading');
            if (badge) badge.remove();
        });
    };

    textarea.addEventListener('input', () => {
        sendBtn.disabled = !textarea.value.trim();
        clearTimeout(previewTimer);
        previewTimer = setTimeout(renderPreview, 400);
    });

    // Initial preview if there's already text
    if (textarea.value.trim()) renderPreview();

    let escHandler; // declared first so collapse() can clean it up from any path
    const collapse = () => {
        clearTimeout(previewTimer);
        if (escHandler) document.removeEventListener('keydown', escHandler);
        const text = textarea.value;
        overlay.classList.remove('show');
        overlay.remove();
        if (typeof onCollapse === 'function') onCollapse(text);
    };

    collapseBtn.addEventListener('click', collapse);
    cancelBtn.addEventListener('click', collapse); // cancel = collapse, preserves text in compact box
    overlay.addEventListener('click', (e) => { if (e.target === overlay) collapse(); });
    escHandler = (e) => { if (e.key === 'Escape') collapse(); };
    document.addEventListener('keydown', escHandler);

    sendBtn.addEventListener('click', () => {
        const text = textarea.value.trim();
        if (!text) return;
        clearTimeout(previewTimer);
        // Find the row to clean up inline zone + post-reply prompt
        const row = document.querySelector(`.msg-row[data-note-id="${noteId}"]`)
                 || document.querySelector(`.ai-cn-entry[data-note-id="${noteId}"]`);
        // Make sure the compact reply zone exists with the text, then trigger sendReply
        // Simplest: directly POST via the same pipeline, then close modal + run post-prompt
        sendBtn.disabled = true;
        sendBtn.innerHTML = `${icon('loader', 'icon-xs spin')} שולח...`;
        safeCreateIcons(sendBtn);
        fetchWithTimeout(ENDPOINTS.ADMIN_SEND_COMMENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ report_id: reportId, note_id: noteId, comment_text: text })
        }, FETCH_TIMEOUTS.save).then(r => r.json()).then(result => {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
            // Remove any open inline reply zone for this row to avoid duplicates
            const replyZone = row.querySelector('.msg-reply-zone');
            if (replyZone) replyZone.remove();
            row.classList.remove('expanded');

            if (!result.ok) {
                showAIToast('שגיאה בשליחת תגובה: ' + (result.error || 'Unknown'), 'error');
                return;
            }
            if (result.queued) {
                showAIToast('תגובה תישלח ב-08:00', 'success');
            } else if (result.email_failed) {
                showAIToast('התגובה נשמרה אך שליחת המייל נכשלה', 'warning');
            } else {
                showAIToast('תגובה נשלחה ✓', 'success');
            }
            if (!result.email_failed && row && !row.classList.contains('ai-cn-entry')) {
                showPostReplyPrompt(noteId, reportId, row);
            } else {
                loadRecentMessages();
            }
        }).catch(err => {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
            showAIToast('שגיאה בשליחת תגובה: ' + (err.message || 'Unknown'), 'error');
        });
    });
}

function renderClientsTable(clients) {
    const _tRender = perfStart();
    const container = document.getElementById('clientsTableContainer');

    if (!clients || clients.length === 0) {
        // DL-247: Don't replace skeleton with empty state if data hasn't loaded yet
        if (!dashboardLoaded) return;
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">${icon('folder-open', 'icon-2xl')}</div>
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
                            onclick="viewClientDocs('${rid}', true)"
                            title="${escapeHtml(client.email || '')}"
                        >
                            ${escapeHtml(client.name)}
                        </strong>
                        <a class="client-edit-link" href="javascript:void(0)" onclick="event.stopPropagation(); openClientDetailModal('${rid}')" title="עריכת פרטים">
                            ${icon('pencil', 'icon-xs')}
                        </a>
                    </div>
                </td>
                <td>
                    <span id="stage-badge-${rid}" class="stage-badge ${stage.class} clickable"
                        onclick="openStageDropdown(event, '${rid}', '${escapeAttr(client.stage)}')"
                        title="לחץ לשינוי שלב">
                        ${icon(stage.icon, 'icon-sm')} ${stage.label} <span class="stage-caret">&#x25BE;</span>
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
                `<button class="action-btn send" onclick="sendSingle('${rid}')" title="שלח שאלון">${icon('send', 'icon-sm')}</button>` :
                ''}
                    ${(client.stage === 'Waiting_For_Answers' || client.stage === 'Collecting_Docs') ?
                `<button class="action-btn reminder-set-btn" onclick="sendDashboardReminder('${rid}', '${cName}')" title="שלח תזכורת">${icon('bell-ring', 'icon-sm')}</button>` :
                ''}
                    <div class="row-overflow-dropdown">
                        <button class="action-btn overflow" onclick="toggleRowMenu(this, event)" title="פעולות נוספות">⋮</button>
                        <div class="row-menu">
                            <button onclick="viewClient('${rid}'); closeAllRowMenus();">${icon('external-link')} צפייה כלקוח</button>
                            ${stageNum >= 3 ?
                `<button onclick="viewQuestionnaire('${rid}'); closeAllRowMenus();">${icon('file-text')} צפה בשאלון</button>` : ''}
                            ${isActive && otherType ?
                `<button onclick="addSecondFilingType('${rid}'); closeAllRowMenus();">${icon('file-plus')} הוסף ${otherTypeLabel}</button>` : ''}
                            ${isActive ?
                `<button class="danger" onclick="deactivateClient('${rid}', '${cName}'); closeAllRowMenus();">${icon('archive')} העבר לארכיון</button>` :
                `<button onclick="reactivateClient('${rid}'); closeAllRowMenus();">${icon('archive-restore')} הפעל מחדש</button>`}
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
                        ${icon(stage.icon, 'icon-sm')} ${stage.label}
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
                    `<button class="action-btn send" onclick="sendSingle('${rid}')" title="שלח שאלון">${icon('send', 'icon-sm')}</button>` : ''}
                ${(client.stage === 'Waiting_For_Answers' || client.stage === 'Collecting_Docs') ?
                    `<button class="action-btn reminder-set-btn" onclick="sendDashboardReminder('${rid}', '${cName}')" title="שלח תזכורת">${icon('bell-ring', 'icon-sm')}</button>` : ''}
                <div class="row-overflow-dropdown">
                    <button class="action-btn overflow" onclick="toggleRowMenu(this, event)" title="פעולות נוספות">⋮</button>
                    <div class="row-menu">
                        <button onclick="viewClient('${rid}'); closeAllRowMenus();">${icon('external-link')} צפייה כלקוח</button>
                        ${stageNum >= 3 ?
                            `<button onclick="viewQuestionnaire('${rid}'); closeAllRowMenus();">${icon('file-text')} צפה בשאלון</button>` : ''}
                        ${isActive && mOtherType ?
                            `<button onclick="addSecondFilingType('${rid}'); closeAllRowMenus();">${icon('file-plus')} הוסף ${mOtherTypeLabel}</button>` : ''}
                        ${isActive ?
                            `<button class="danger" onclick="deactivateClient('${rid}', '${cName}'); closeAllRowMenus();">${icon('archive')} העבר לארכיון</button>` :
                            `<button onclick="reactivateClient('${rid}'); closeAllRowMenus();">${icon('archive-restore')} הפעל מחדש</button>`}
                    </div>
                </div>
            </div>
        </li>`;
    }
    cards += '</ul>';

    html += cards + '</div>';
    const _tDom = perfStart();
    container.innerHTML = html;
    safeCreateIcons(container);
    perfEnd('renderClientsTable:innerHTML+icons', _tDom);
    perfEnd('renderClientsTable:total', _tRender);
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

function toggleStageFilter(stage, userInitiated = true) {
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

    // DL-265: On mobile, scroll to the client table after filtering (only for real user taps, not on initial load)
    if (userInitiated && window.innerWidth <= 768) {
        document.getElementById('clientsTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
                    ${icon(info.icon, 'icon-sm')}
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
    badge.innerHTML = `${icon(stage.icon, 'icon-sm')} ${stage.label} <span class="stage-caret">&#x25BE;</span>`;

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

    // DL-281/288: Outbox-backed queued count (source of truth = Outlook). Before the
    // Outbox fetch lands, render nothing — the legacy queued_send_at fallback flashed
    // stale counts ("30 בתור לשליחה") from yesterday's already-delivered emails.
    const queuedCount = queuedEmailsLoaded
        ? queuedEmailsData.filter(q => q.filing_type === activeEntityTab).length
        : 0;
    let queuedEl = stage3Card?.querySelector('.queued-subtitle');
    if (queuedCount > 0 && stage3Card) {
        if (!queuedEl) {
            queuedEl = document.createElement('div');
            queuedEl.className = 'queued-subtitle';
            queuedEl.style.cssText = 'font-size:0.7rem;color:var(--info-600);margin-top:2px;font-weight:500;cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px';
            queuedEl.setAttribute('role', 'button');
            queuedEl.setAttribute('tabindex', '0');
            queuedEl.setAttribute('title', 'לחץ לצפייה ברשימה');
            queuedEl.addEventListener('click', (e) => { e.stopPropagation(); openQueuedEmailsModal(); });
            queuedEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openQueuedEmailsModal(); }
            });
            stage3Card.querySelector('.stat-label')?.appendChild(queuedEl);
        }
        queuedEl.textContent = `(${queuedCount} בתור לשליחה)`;
    } else if (queuedEl) {
        queuedEl.remove();
    }
}

// DL-281: Fetch Outbox-backed queue for active filing type.
async function loadQueuedEmails() {
    if (!authToken) return;
    try {
        const year = document.getElementById('yearFilter')?.value || new Date().getFullYear();
        const response = await fetch(
            `${ENDPOINTS.ADMIN_QUEUED_EMAILS}?filing_type=${activeEntityTab}&year=${year}&_t=${Date.now()}`,
            { headers: { 'Authorization': `Bearer ${authToken}` } }
        );
        const data = await response.json();
        if (!data.ok) {
            console.warn('[queued-emails]', data.error);
            return;
        }
        queuedEmailsData = data.queued || [];
        queuedEmailsLoaded = true;
        recalculateStats();
    } catch (err) {
        console.warn('[queued-emails] fetch failed:', err.message);
    }
}

// DL-281: Queue modal — list of clients whose deferred emails are actually in Outbox.
// Stale-while-revalidate: render immediately from queuedEmailsData, refresh in
// background, re-render if modal still open. Fixes the bug where a dashboard
// left open across 08:00 kept showing pre-delivery counts.
async function openQueuedEmailsModal() {
    renderQueuedEmailsModal();
    try {
        await loadQueuedEmails();
    } catch { /* keep stale data visible */ }
    const overlay = document.getElementById('queuedEmailsModal');
    if (overlay?.classList.contains('show')) renderQueuedEmailsModal();
}

function renderQueuedEmailsModal() {
    const rows = (queuedEmailsData || []).filter(q => q.filing_type === activeEntityTab);
    const fmtTime = (iso) => {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
        } catch { return ''; }
    };
    const fmtDateTime = (iso) => {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return `${d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Jerusalem' })} ${fmtTime(iso)}`;
        } catch { return ''; }
    };
    const filingLabel = (ft) => ft === 'capital_statement' ? 'דוח הון' : 'דוח שנתי';
    const typeLabel = (t) => {
        if (t === 'reply') return 'תגובה';
        if (t === 'batch_questions') return 'שאלות לאחר סקירה';
        return 'דרישת מסמכים';
    };

    const listHtml = rows.length === 0
        ? `<div style="text-align:center;padding:var(--sp-8) 0;color:var(--gray-500)">אין מיילים בתור</div>`
        : rows.map(r => `
            <div class="queued-row" style="padding:var(--sp-3) 0;border-bottom:1px solid var(--gray-100)">
                <div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--sp-2)">
                    <strong style="font-size:var(--text-base);color:var(--gray-800)">${escapeHtml(r.client_name)}</strong>
                    <span style="font-size:var(--text-xs);color:var(--gray-500)">${typeLabel(r.type)} · ${filingLabel(r.filing_type)}</span>
                </div>
                <div style="font-size:var(--text-xs);color:var(--gray-600);margin-top:2px">
                    אושר ${fmtDateTime(r.queued_at)}${r.scheduled_for ? ` · יישלח ${fmtTime(r.scheduled_for)}` : ''}
                </div>
            </div>
        `).join('');

    // Build/refresh dynamic overlay
    let overlay = document.getElementById('queuedEmailsModal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'queuedEmailsModal';
        overlay.className = 'ai-modal-overlay';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeQueuedEmailsModal(); });
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <div class="ai-modal-panel">
            <div class="ai-modal-panel-header">
                ${icon('clock')}
                בתור לשליחה ב-08:00 (${rows.length})
            </div>
            <div class="ai-modal-panel-body">
                ${listHtml}
            </div>
            <div class="ai-modal-panel-footer">
                <button class="btn btn-primary" onclick="closeQueuedEmailsModal()">סגור</button>
            </div>
        </div>
    `;
    overlay.classList.add('show');
    safeCreateIcons();
}

function closeQueuedEmailsModal() {
    const overlay = document.getElementById('queuedEmailsModal');
    if (overlay) overlay.classList.remove('show');
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

    // DL-265: Reload active tab on entity switch — bouncing dots loader
    const activeContent = document.querySelector('.tab-content.active');
    const activeTab = activeContent?.id?.replace('tab-', '');
    const TAB_LOADER_LABELS = { dashboard: 'טוען לוח בקרה…', review: 'טוען לוח בקרה…', send: 'טוען רשימת לקוחות…', questionnaires: 'טוען שאלונים…', reminders: 'טוען תזכורות…' };
    const addRefresh = () => {
        if (!activeContent) return;
        activeContent.classList.add('tab-refreshing');
        const loader = document.createElement('div');
        loader.className = 'tab-refresh-loader';
        loader.innerHTML = `<span class="loader-text">${TAB_LOADER_LABELS[activeTab] || 'טוען…'}</span><div class="loader-dots"><div class="loader-dot"></div><div class="loader-dot"></div><div class="loader-dot"></div></div>`;
        activeContent.appendChild(loader);
    };
    const removeRefresh = () => {
        if (!activeContent) return;
        activeContent.classList.remove('tab-refreshing');
        activeContent.querySelector('.tab-refresh-loader')?.remove();
    };
    if (activeTab === 'send' && wasPendingLoaded) { addRefresh(); loadPendingClients().then(removeRefresh, removeRefresh); }
    else if (activeTab === 'questionnaires' && wasQuestionnaireLoaded) { addRefresh(); loadQuestionnaires().then(removeRefresh, removeRefresh); }
    else if (activeTab === 'reminders' && wasReminderLoaded) { addRefresh(); loadReminders().then(removeRefresh, removeRefresh); }
    // DL-238: AI Review not reloaded on entity tab switch — always shows all
    else if ((activeTab === 'review' || activeTab === 'dashboard') && wasDashboardLoaded) { addRefresh(); loadDashboard().then(removeRefresh, removeRefresh); }
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
                ${icon('clock')}
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
            btn.innerHTML = `${icon('check', 'icon-xs')}`;
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
    // Add class to BUTTON (not SVG) — DL-314: SVG sprite uses <use> refs, not replacement
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
    } else if (activeTab === 'pending-approval') {
        pendingApprovalLoadedAt = 0;
        promise = loadPendingApprovalQueue();
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
        else if (activeTab === 'pending-approval') { pendingApprovalLoadedAt = 0; loadPendingApprovalQueue(true); }
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

async function loadPendingClients(silent = false, prefetchOnly = false) {
    if (!authToken) return;
    // DL-247: SWR — skip if fresh, otherwise fetch silently
    const isFresh = pendingClientsLoaded && (Date.now() - pendingClientsLoadedAt < STALE_AFTER_MS);

    // DL-317: SWR — paint cached data instantly on first switchTab after a prefetch landed
    if (!prefetchOnly && pendingClientsLoaded && !pendingClientsEverRendered) {
        const _tR = perfStart();
        renderPendingClients();
        pendingClientsEverRendered = true;
        perfEnd('dl317:pendingClients:render', _tR);
    }

    if (silent && isFresh) return;

    const _tF = perfStart();
    try {
        const year = document.getElementById('sendYearFilter').value;
        const response = await deduplicatedFetch(`${ENDPOINTS.ADMIN_PENDING}?year=${year}&filing_type=${activeEntityTab}`, { headers: { 'Authorization': `Bearer ${authToken}` } }, FETCH_TIMEOUTS.load);
        const data = await response.json();



        if (!data.ok) throw new Error(data.error);

        pendingClients = data.clients || [];
        pendingClientsLoaded = true;
        pendingClientsLoadedAt = Date.now();
    } catch (error) {
        if (!silent) showModal('error', 'שגיאה', 'לא ניתן לטעון את הרשימה');
        perfEnd('dl317:pendingClients:fetch', _tF);
        return;
    }
    perfEnd('dl317:pendingClients:fetch', _tF);

    if (!prefetchOnly) {
        const _tR = perfStart();
        renderPendingClients();
        pendingClientsEverRendered = true;
        perfEnd('dl317:pendingClients:render', _tR);
    }
}

function renderPendingClients() {
    const container = document.getElementById('pendingClientsContainer');

    // Filter out archived clients
    pendingClients = pendingClients.filter(c => c.is_active !== false);

    if (pendingClients.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">${icon('circle-check', 'icon-2xl')}</div>
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
                        <button class="copy-email-btn" onclick="event.stopPropagation(); copyToClipboard('${escapeAttr(client.email)}', this)" title="העתק אימייל">${icon('copy', 'icon-xs')}</button>
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
                    <button class="copy-email-btn" onclick="event.stopPropagation(); copyToClipboard('${escapeAttr(client.email)}', this)" title="העתק אימייל">${icon('copy', 'icon-xs')}</button>
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
                <div class="empty-state-icon">${icon('inbox', 'icon-2xl')}</div>
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
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const completedMidnight = new Date(completedAt.getFullYear(), completedAt.getMonth(), completedAt.getDate());
        const diffDays = Math.max(0, Math.round((todayMidnight - completedMidnight) / (1000 * 60 * 60 * 24)));

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
                        <button class="copy-email-btn" onclick="event.stopPropagation(); copyToClipboard('${escapeAttr(client.email)}', this)" title="העתק אימייל">${icon('copy', 'icon-xs')}</button>
                    </div>
                </td>
                <td>${client.year}</td>
                <td><span class="docs-count clickable-count" onclick="toggleDocsPopover(event, '${escapeOnclick(client.report_id)}', '${escapeOnclick(client.name)}')" tabindex="0" role="button" title="לחץ לצפייה במסמכים">${client.docs_received}/${client.docs_total}</span></td>
                <td>${dateStr}</td>
                <td><span class="waiting-badge ${waitingClass}">${waitingText}</span></td>
                <td>
                    <button class="action-btn view" onclick="viewClient('${escapeAttr(client.report_id)}')" title="צפה בתיק">${icon('eye', 'icon-sm')}</button>
                    <button class="action-btn complete" onclick="markComplete('${escapeOnclick(client.report_id)}', '${escapeOnclick(client.name)}')" title="סמן כהושלם">${icon('circle-check', 'icon-sm')}</button>
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
        const todayMidnightC = new Date(nowCards.getFullYear(), nowCards.getMonth(), nowCards.getDate());
        const completedMidnightC = new Date(completedAt.getFullYear(), completedAt.getMonth(), completedAt.getDate());
        const diffDays = Math.max(0, Math.round((todayMidnightC - completedMidnightC) / (1000 * 60 * 60 * 24)));
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
                    <button class="copy-email-btn" onclick="event.stopPropagation(); copyToClipboard('${escapeAttr(client.email)}', this)" title="העתק אימייל">${icon('copy', 'icon-xs')}</button>
                </div>
            </div>
            <div class="mobile-card-actions">
                <button class="action-btn view" onclick="viewClient('${escapeAttr(client.report_id)}')" title="צפה בתיק">${icon('eye', 'icon-sm')}</button>
                <button class="action-btn complete" onclick="markComplete('${escapeOnclick(client.report_id)}', '${escapeOnclick(client.name)}')" title="סמן כהושלם">${icon('circle-check', 'icon-sm')}</button>
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

function createDocCombobox(container, docs, { currentMatchId = null, onSelect = null, allowCreate = false, onExpand = null, otherDocs = null, ownFilingType = null, otherFilingType = null } = {}) {
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
                if (onExpand) { close(); onExpand(); } else { enterCreateMode(); }
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
// DL-330: 3-pane layout — currently-selected client on desktop (null = auto-pick first pending)
let selectedClientName = null;
// DL-334: transient re-review set — when on_hold/reviewed items are being re-decided, render
// them as pending (A/B/C/D) regardless of review_status. Cleared on cancel or on transition.
const _aiReReviewing = new Set();

const REJECTION_REASONS = {
    image_quality: 'איכות תמונה ירודה',
    wrong_document: 'מסמך לא נכון',
    incomplete: 'מסמך חלקי / חתוך',
    wrong_year: 'שנה לא נכונה',
    wrong_person: 'לא שייך ללקוח',
    not_relevant: 'מסמך לא רלוונטי',
    has_question: 'בהמתנה לתשובת לקוח',
    other: 'אחר'
};

// ---- Document Preview ----

function humanizeError(err) {
    if (err?.name === 'TimeoutError' || /signal timed out/i.test(err?.message || '')) {
        return 'הפעולה ארכה יותר מדי — נסה שוב';
    }
    return err?.message || 'שגיאה לא ידועה';
}

async function getDocPreviewUrl(itemId) {
    const response = await fetchWithTimeout(
        `${ENDPOINTS.GET_PREVIEW_URL}?itemId=${encodeURIComponent(itemId)}`,
        { headers: { 'Authorization': `Bearer ${authToken}` } }, FETCH_TIMEOUTS.slow
    );
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Failed to get preview URL');
    return { previewUrl: data.previewUrl, downloadUrl: data.downloadUrl || null };
}

// DL-340: Single source of truth for preview frame reviewed-state visuals
// (badge in header + border accent + corner stamp over iframe area).
// Call with review_status string or null/undefined to clear.
function applyPreviewReviewState(reviewStatus) {
    const frame = document.querySelector('#aiReviewDetail .ai-preview-frame');
    const badge = document.getElementById('previewStatusBadge');
    const stamp = document.getElementById('previewReviewStamp');
    if (!frame || !badge) return;
    frame.classList.remove('preview-reviewed-approved', 'preview-reviewed-rejected', 'preview-reviewed-reassigned');
    const map = {
        approved:   { cls: 'preview-reviewed-approved',   badgeCls: 'badge-approved',   stampCls: 'stamp-approved',   badgeHtml: '✓ אושר',       stampText: 'אושר' },
        rejected:   { cls: 'preview-reviewed-rejected',   badgeCls: 'badge-rejected',   stampCls: 'stamp-rejected',   badgeHtml: '⚠ דורש תיקון', stampText: 'דורש תיקון' },
        reassigned: { cls: 'preview-reviewed-reassigned', badgeCls: 'badge-reassigned', stampCls: 'stamp-reassigned', badgeHtml: '↻ שויך מחדש',  stampText: 'שויך מחדש' },
    };
    const entry = map[reviewStatus];
    if (!entry) {
        badge.style.display = 'none';
        badge.className = 'preview-status-badge';
        badge.innerHTML = '';
        if (stamp) {
            stamp.style.display = 'none';
            stamp.className = 'preview-review-stamp';
            stamp.textContent = '';
        }
        return;
    }
    frame.classList.add(entry.cls);
    badge.className = `preview-status-badge ${entry.badgeCls}`;
    badge.innerHTML = entry.badgeHtml;
    badge.style.display = '';
    if (stamp) {
        stamp.className = `preview-review-stamp ${entry.stampCls}`;
        stamp.textContent = entry.stampText;
        stamp.style.display = '';
    }
}

function resetPreviewPanel() {
    activePreviewItemId = null;
    window.activePreviewItemId = null;
    document.querySelectorAll('.ai-review-card.preview-active').forEach(c => c.classList.remove('preview-active'));
    // DL-334: dual-clear — also drop .ai-doc-row.active from any thin row
    document.querySelectorAll('.ai-doc-row.active').forEach(el => el.classList.remove('active'));
    // DL-339: drop .has-selection so CSS collapses back to full-width list.
    const docsRoot = document.querySelector('.ai-review-docs');
    if (docsRoot) docsRoot.classList.remove('has-selection');
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
    applyPreviewReviewState(null);
    // DL-334: if actions panel exists, clear it to empty state
    const panel = document.getElementById('aiActionsPanel');
    if (panel && typeof renderActionsPanel === 'function') renderActionsPanel(null);
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
    // v3.2: populate skeleton filename so the user sees immediate acknowledgment
    // of their click during the 300-1700ms iframe-bootstrap window.
    const skeletonFilename = document.getElementById('previewSkeletonFilename');
    if (skeletonFilename) skeletonFilename.textContent = item.attachment_name || 'מסמך';

    // Update header
    fileName.textContent = item.attachment_name || 'מסמך';
    openTab.href = item.file_url || '#';
    openTab.style.display = item.file_url ? '' : 'none';
    header.style.display = '';
    applyPreviewReviewState(item.review_status || null);

    // DL-334 v3.1: preview latency instrumentation — gated on localStorage.ADMIN_PERF='1'.
    // Logs two durations per click:
    //   dl334:preview:urlFetch    = Worker round-trip for the SharePoint preview URL
    //   dl334:preview:iframeOnload = Microsoft viewer bootstrap + first paint
    // Per-click id so first-view vs repeat-view of the same doc is visible.
    const _perfOn = (() => { try { return localStorage.ADMIN_PERF === '1'; } catch (e) { return false; } })();
    const _perfId = _perfOn ? `${recordId}:${Date.now()}` : null;
    const _perfStart = _perfOn ? performance.now() : 0;
    let _perfUrlFetched = 0;

    try {
        const { previewUrl, downloadUrl } = await getDocPreviewUrl(item.onedrive_item_id);
        if (_perfOn) {
            _perfUrlFetched = performance.now();
            const urlMs = Math.round(_perfUrlFetched - _perfStart);
            console.log(`[dl334:preview:urlFetch] ${urlMs}ms · id=${_perfId} · itemId=${item.onedrive_item_id}`);
            try { performance.measure(`dl334:preview:urlFetch:${_perfId}`, { start: _perfStart, duration: urlMs }); } catch (e) {}
        }
        // Verify still the active card (user might have clicked another)
        if (activePreviewItemId !== recordId) return;
        // Keep spinner until iframe actually loads
        iframe.onload = () => {
            if (activePreviewItemId !== recordId) return;
            loading.style.display = 'none';
            iframe.style.display = '';
            if (_perfOn && _perfUrlFetched) {
                const loadMs = Math.round(performance.now() - _perfUrlFetched);
                const totalMs = Math.round(performance.now() - _perfStart);
                console.log(`[dl334:preview:iframeOnload] ${loadMs}ms · total=${totalMs}ms · id=${_perfId}`);
                try { performance.measure(`dl334:preview:iframeOnload:${_perfId}`, { start: _perfUrlFetched, duration: loadMs }); } catch (e) {}
            }
        };
        iframe.src = previewUrl;
        if (downloadUrl) {
            downloadBtn.href = downloadUrl;
            downloadBtn.style.display = '';
        }
    } catch (err) {
        console.error('Preview load failed', { itemId: item.onedrive_item_id, recordId, err });
        if (activePreviewItemId !== recordId) return;
        loading.style.display = 'none';
        iframe.style.display = 'none';
        error.style.display = '';
        errorMsg.textContent = humanizeError(err);
        const retryBtn = document.getElementById('previewRetryBtn');
        if (retryBtn) {
            const isTimeout = err?.name === 'TimeoutError' || /signal timed out/i.test(err?.message || '');
            retryBtn.style.display = isTimeout ? '' : 'none';
            retryBtn.onclick = () => loadDocPreview(recordId);
        }
    }
}

async function loadAIClassifications(silent = false, prefetchOnly = false) {
    if (!authToken) return;
    // DL-247: SWR — skip if fresh, otherwise fetch silently
    const isFresh = aiReviewLoaded && (Date.now() - aiReviewLoadedAt < STALE_AFTER_MS);

    // DL-317: SWR — paint cached data instantly on first switchTab after a prefetch landed
    if (!prefetchOnly && aiReviewLoaded && !aiClassificationsEverRendered && aiClassificationsData.length > 0) {
        const _tR = perfStart();
        resetPreviewPanel();
        applyAIFilters();
        aiClassificationsEverRendered = true;
        perfEnd('dl317:aiClassifications:render', _tR);
    }

    if (silent && isFresh) return;

    const _tF = perfStart();
    let _lastStatus = null;
    try {
        const response = await deduplicatedFetch(`${ENDPOINTS.GET_PENDING_CLASSIFICATIONS}?filing_type=all`, { headers: { 'Authorization': `Bearer ${authToken}` } }, FETCH_TIMEOUTS.slow); // DL-238: unified view
        _lastStatus = response.status;
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
                perfEnd('dl317:aiClassifications:fetch', _tF);
                // DL-323: if data hadn't changed but we never rendered (race: prefetch landed
                // data, then silent switchTab arrived with identical data and short-circuited
                // before the early render block at line 3709 had a chance), render now.
                if (!aiClassificationsEverRendered && !prefetchOnly) {
                    const _tR = perfStart();
                    resetPreviewPanel();
                    applyAIFilters();
                    aiClassificationsEverRendered = true;
                    perfEnd('dl317:aiClassifications:render', _tR);
                }
                return;
            }
        }

        // DL-334 / DL-053: silent refresh merge-by-id — preserve object references so
        // window.activePreviewItemId (and anything else holding a ref from the previous tick)
        // doesn't desync. Full refresh and prefetch paths keep the old wholesale replace.
        const RENDER_CRITICAL_FIELDS = [
            'review_status', 'pending_question', 'matched_template_id', 'matched_template_title',
            'ai_confidence', 'confidence', 'attachment_name', 'is_suggested',
            'is_unrequested', 'requires_issuer_fix', 'shared_ref_count', 'on_hold_question',
            'on_hold_question_preview', 'on_hold_last_reply_at'
        ];
        let mergedList;
        let silentMutatedIds = null; // list of ids whose render-critical fields changed
        let silentAddedOrRemoved = false;
        if (silent && aiClassificationsData.length > 0 && !prefetchOnly) {
            const prevMap = new Map(aiClassificationsData.map(i => [String(i.id), i]));
            const newIdsSet = new Set();
            silentMutatedIds = [];
            mergedList = [];
            for (const nr of newItems) {
                const idKey = String(nr.id);
                newIdsSet.add(idKey);
                const prev = prevMap.get(idKey);
                if (prev) {
                    let changed = false;
                    for (const f of RENDER_CRITICAL_FIELDS) {
                        if (prev[f] !== nr[f]) { changed = true; break; }
                    }
                    Object.assign(prev, nr); // mutate in place — preserve reference
                    if (changed) silentMutatedIds.push(idKey);
                    mergedList.push(prev);
                } else {
                    silentAddedOrRemoved = true;
                    mergedList.push(nr);
                }
            }
            if (prevMap.size !== newIdsSet.size) silentAddedOrRemoved = true;
            else {
                for (const k of prevMap.keys()) if (!newIdsSet.has(k)) { silentAddedOrRemoved = true; break; }
            }
            aiClassificationsData = mergedList;
        } else {
            aiClassificationsData = newItems;
        }
        aiReviewLoaded = true;
        aiReviewLoadedAt = Date.now();

        // Cheap updates run even in prefetch — users see correct badge/stats before clicking the tab
        updateAIStats(data.stats || {});
        const badge = document.getElementById('aiReviewTabBadge');
        const pendingForBadge = aiClassificationsData.filter(i => (i.review_status || 'pending') === 'pending');
        const uniqueClients = new Set(pendingForBadge.map(i => i.client_id).filter(Boolean)).size;
        syncAIBadge(badge, uniqueClients);

        perfEnd('dl317:aiClassifications:fetch', _tF);

        // Heavy render deferred until user clicks the tab
        if (!prefetchOnly) {
            const _tR = perfStart();
            if (silent && silentMutatedIds !== null && !silentAddedOrRemoved) {
                // Silent path: swap individual thin rows for changed items only — preserves scroll + active state.
                for (const idKey of silentMutatedIds) {
                    const it = aiClassificationsData.find(x => String(x.id) === idKey);
                    if (it && typeof refreshItemDom === 'function') refreshItemDom(it);
                }
                // Re-sync active item + row + panel against merged data (handles status changes from another tab)
                const activeId = window.activePreviewItemId;
                if (activeId) {
                    const activeItem = aiClassificationsData.find(x => String(x.id) === String(activeId));
                    if (activeItem) {
                        // Re-apply .ai-doc-row.active (in case the row was re-rendered)
                        document.querySelectorAll('.ai-doc-row.active').forEach(el => el.classList.remove('active'));
                        const row = document.querySelector(`.ai-doc-row[data-id="${CSS.escape(String(activeItem.id))}"]`);
                        if (row) row.classList.add('active');
                        if (typeof renderActionsPanel === 'function') renderActionsPanel(activeItem);
                    } else {
                        // Active item dismissed / removed elsewhere — clear panel.
                        window.activePreviewItemId = null;
                        if (typeof renderActionsPanel === 'function') renderActionsPanel(null);
                        // DL-339: active item disappeared (dismissed in another tab) → clear selection wrapper too.
                        const docsRoot = document.querySelector('.ai-review-docs');
                        if (docsRoot) docsRoot.classList.remove('has-selection');
                    }
                }
                aiClassificationsEverRendered = true;
            } else {
                resetPreviewPanel();
                applyAIFilters();
                aiClassificationsEverRendered = true;
            }
            perfEnd('dl317:aiClassifications:render', _tR);
        }
        return;
    } catch (error) {
        perfEnd('dl317:aiClassifications:fetch', _tF);
        const isTimeout = error && (error.name === 'TimeoutError' || /timed out/i.test(error.message || ''));
        console.error('AI review load failed', { status: _lastStatus, timeout: isTimeout, timeout_ms: FETCH_TIMEOUTS.slow, error });
        if (!silent) {
            const container = document.getElementById('aiClientsPane');
            if (container) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">${icon('alert-triangle', 'icon-2xl')}</div>
                        <p style="color: var(--danger-500);">לא ניתן לטעון את הסיווגים. נסה שוב.</p>
                        <button class="btn btn-secondary mt-4" onclick="loadAIClassifications()">
                            ${icon('refresh-cw', 'icon-sm')} נסה שוב
                        </button>
                    </div>
                `;
            }
            const docsPane = document.getElementById('aiDocsPane');
            if (docsPane) docsPane.innerHTML = '';
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

    // DL-268: Group by client, sort FIFO (oldest-waiting first), paginate by client groups
    const clientGroups = new Map();
    for (const item of _filteredAI) {
        const key = item.client_name || 'לא ידוע';
        if (!clientGroups.has(key)) clientGroups.set(key, []);
        clientGroups.get(key).push(item);
    }
    // Sort groups by earliest received_at ascending (FIFO — longest-waiting client first)
    const sortedGroups = [...clientGroups.entries()].sort((a, b) => {
        const aMin = Math.min(...a[1].map(i => new Date(i.received_at || 0).getTime()));
        const bMin = Math.min(...b[1].map(i => new Date(i.received_at || 0).getTime()));
        return aMin - bMin;
    });
    const totalGroups = sortedGroups.length;
    const pageGroups = sortedGroups.slice((_aiPage - 1) * AI_PAGE_SIZE, _aiPage * AI_PAGE_SIZE);
    const pageItems = pageGroups.flatMap(([, items]) => items);

    renderAICards(pageItems, _filteredAI);
    renderPagination('aiPagination', totalGroups, _aiPage, AI_PAGE_SIZE, goToAIPage);
}

function goToAIPage(page) {
    _aiPage = page;
    applyAIFilters(true);
    document.getElementById('aiClientsPane')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

// DL-339: End-truncate filename while preserving extension.
// Matches Gmail/Finder convention; the informative prefix + ".pdf"
// (needed to signal PDF-splittable docs) stays visible. Supersedes
// truncateMiddle for row rendering.
function truncateKeepExtension(filename, maxChars = 45) {
    if (!filename || filename.length <= maxChars) return filename || '';
    const dotIdx = filename.lastIndexOf('.');
    const ext = dotIdx > 0 && filename.length - dotIdx <= 6 ? filename.slice(dotIdx) : '';
    const stem = ext ? filename.slice(0, -ext.length) : filename;
    const budget = maxChars - ext.length - 1; // 1 char for the ellipsis
    if (budget <= 4) return filename.slice(0, maxChars - 1) + '…';
    return stem.slice(0, budget) + '…' + ext;
}

// DL-334: Resolve the stripe modifier class for a doc row.
// getCardState returns 'full' | 'fuzzy' | 'issuer-mismatch' | 'unmatched'.
// Workstream B will add on_hold to getCardState; until then we branch on review_status here.
function getRowStripeClass(item) {
    const rs = item.review_status;
    if (rs === 'on_hold') return 'ai-doc-row--state-on-hold';
    if (rs === 'approved') return 'ai-doc-row--state-approved';
    if (rs === 'rejected') return 'ai-doc-row--state-rejected';
    if (rs === 'reassigned') return 'ai-doc-row--state-reassigned';
    // pending — branch by getCardState
    const st = getCardState(item);
    if (st === 'full') return 'ai-doc-row--state-full';
    if (st === 'fuzzy') return 'ai-doc-row--state-fuzzy';
    if (st === 'issuer-mismatch') return 'ai-doc-row--state-issuer';
    return 'ai-doc-row--state-unmatched';
}

// DL-334: Resolve the end-aligned category text for a doc row.
// on_hold overrides category — returns {text, isOnHold} so caller can style.
function getRowCategoryText(item) {
    if (item.review_status === 'on_hold') {
        return { text: '⏳ ממתין ללקוח', isOnHold: true };
    }
    // DL-334 v3: row shows filing-type only (broad scan), not template name.
    // Template name is still surfaced in the actions panel when the row is selected.
    const label = FILING_TYPE_LABELS[item.filing_type] || item.filing_type || '';
    return { text: label, isOnHold: false };
}

// DL-340: Sort rank for pane-2 rows — pending first (needs action), on_hold in the
// middle (waiting for client), reviewed at the bottom (done). Within a group, oldest
// received_at first so overdue items rise. Used by buildDesktopClientDocsHtml + refreshItemDom.
function getRowSortRank(item) {
    const rs = item && item.review_status;
    if (rs === 'approved' || rs === 'rejected' || rs === 'reassigned') return 2;
    if (rs === 'on_hold') return 1;
    return 0; // pending / missing
}
function compareDocRows(a, b) {
    const ra = getRowSortRank(a);
    const rb = getRowSortRank(b);
    if (ra !== rb) return ra - rb;
    const ta = new Date(a.received_at || 0).getTime();
    const tb = new Date(b.received_at || 0).getTime();
    return ta - tb;
}

// DL-334: Render one thin pane-2 row. See DL-334 §7 "Doc rows".
function renderDocRow(item) {
    const id = String(item.id);
    const rawName = item.attachment_name || item.filename || 'ללא שם';
    const stripeClass = getRowStripeClass(item);
    const cat = getRowCategoryText(item);
    const showQGlyph = item.pending_question && item.review_status !== 'on_hold';
    const qTitle = showQGlyph ? String(item.pending_question).slice(0, 80) : '';

    // Flag dot (duplicate / unrequested / pre_questionnaire) — labels match renderAICard verbatim.
    const flagLabels = [];
    if (item.is_duplicate) flagLabels.push('כפול');
    if (item.is_unrequested && !item.pre_questionnaire) flagLabels.push('לא נדרש');
    if (item.pre_questionnaire) flagLabels.push('טרם מולא שאלון');
    const flagDotHtml = flagLabels.length > 0
        ? `<span class="ai-doc-row__flag-dot" title="${escapeAttr(flagLabels.join(' · '))}"></span>`
        : '';

    // DL-340: On reviewed rows, show a status chip (אושר/לתיקון/שויך) instead of the filing-type category.
    // The CSS above also dims + strikes the filename so the whole row reads as "done."
    const CHIP_LABELS = { approved: 'אושר', rejected: 'לתיקון', reassigned: 'שויך' };
    const isReviewedDecided = ['approved', 'rejected', 'reassigned'].includes(item.review_status);
    const endLabelHtml = isReviewedDecided
        ? `<span class="ai-doc-row__status-chip chip-${item.review_status}">${CHIP_LABELS[item.review_status]}</span>`
        : `<span class="ai-doc-row__category"${cat.isOnHold ? ' style="color: var(--warning-600);"' : ''}>${escapeHtml(cat.text)}</span>`;

    // DL-339: CSS handles bidi isolation via `unicode-bidi: plaintext` on
    // .ai-doc-row__filename. Earlier dir="auto" flipped flex alignment on
    // pure-Latin filenames — removed.
    return `<div class="ai-doc-row ${stripeClass}" data-id="${escapeAttr(id)}" title="${escapeAttr(rawName)}" onclick="selectDocument('${escapeAttr(id)}')">
        <span class="ai-doc-row__stripe"></span>
        <span class="ai-doc-row__filename">${escapeHtml(truncateKeepExtension(rawName))}</span>
        ${showQGlyph ? `<span class="ai-doc-row__question-glyph" title="${escapeAttr(qTitle)}">?</span>` : ''}
        ${endLabelHtml}
        ${flagDotHtml}
    </div>`;
}

// DL-334: Sticky thin strip at the top of pane 2.
function buildClientThinStrip(clientName, items) {
    const reviewed = items.filter(i => ['approved', 'rejected', 'reassigned'].includes(i.review_status)).length;
    const total = items.length;
    const clientId = items[0]?.client_id || '';
    const folderBtn = clientId
        ? `<button class="ai-pane2-top__folder" type="button"
               onclick="event.stopPropagation(); window.open('../document-manager.html?client_id=${encodeURIComponent(clientId)}', '_blank');"
               title="פתח ניהול מסמכים">${icon('folder-open', 'w-3.5 h-3.5')}</button>`
        : '';
    return `<div class="ai-pane2-top">
        <span class="ai-pane2-top__counter">${reviewed}/${total} נבדקו</span>
        ${folderBtn}
    </div>`;
}

// DL-334: Toggle a section's `.open` class + show/hide its content sibling.
function toggleSection(headerEl) {
    if (!headerEl) return;
    const isOpen = headerEl.classList.toggle('open');
    // Content is the next element sibling.
    const content = headerEl.nextElementSibling;
    if (content) content.style.display = isOpen ? '' : 'none';
}

// DL-334: Build the desktop pane-2 HTML for a selected client.
// Structure: sticky strip → collapsed client-notes header → collapsed missing-docs
// header → separator → flat list of renderDocRow.
function buildDesktopClientDocsHtml(clientName, items) {
    let html = buildClientThinStrip(clientName, items);

    // --- Client notes section (collapsed by default; only if N > 0 inbound notes) ---
    const clientNotesRaw = items.find(i => i.client_notes)?.client_notes;
    let notesHtml = '';
    let notesCount = 0;
    if (clientNotesRaw) {
        let cnArr = [];
        try { cnArr = JSON.parse(clientNotesRaw.replace(/[\n\r\t]/g, m => m === '\n' ? '\\n' : m === '\r' ? '\\r' : '\\t')); if (!Array.isArray(cnArr)) cnArr = []; } catch (e) {}
        const replyMap = {};
        for (const n of cnArr) {
            if (n.type === 'office_reply' && n.reply_to) replyMap[n.reply_to] = n;
        }
        // Filter: inbound client messages only (exclude office_reply + batch_questions_sent).
        cnArr = cnArr.filter(n => n.type !== 'office_reply' && n.type !== 'batch_questions_sent');
        notesCount = cnArr.length;
        if (notesCount > 0) {
            const sorted = [...cnArr].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const cnReportId = items[0]?.report_record_id || '';
            const cnYear = items[0]?.year || '';
            const renderEntry = n => {
                const isEmail = n.source === 'email';
                const iconName = isEmail ? 'mail' : 'pencil';
                const iconClass = isEmail ? 'cn-icon--email' : 'cn-icon--manual';
                const rawDate = n.date || '';
                const dateStr = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/) ? rawDate.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3-$2-$1') : rawDate;
                const nId = n.id ? escapeAttr(String(n.id)) : '';
                const replyBtn = nId
                    ? `<button class="ai-cn-action-btn" title="הגב" onclick="event.stopPropagation();showReplyInput('${nId}','${escapeAttr(cnReportId)}',this.closest('.ai-cn-entry'))">${icon('message-square', 'icon-xs')}</button>`
                    : '';
                const reply = nId ? replyMap[nId] : null;
                const replyHtml = reply
                    ? `<div class="cn-office-reply">
                        <div class="cn-reply-label">${icon('corner-down-left', 'icon-xs')} תגובת המשרד</div>
                        <div class="cn-reply-text">${escapeHtml(reply.summary)}</div>
                        <div class="cn-reply-date">${(reply.date || '').slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3-$2-$1')}</div>
                    </div>` : '';
                return `<div class="ai-cn-entry" data-note-id="${nId}" data-report-id="${escapeAttr(cnReportId)}" data-client-name="${escapeAttr(clientName)}" data-year="${escapeAttr(cnYear)}">
                    ${icon(iconName, `icon-sm ${iconClass}`)}
                    <span class="ai-cn-date">${escapeHtml(dateStr)}</span>
                    <span class="ai-cn-summary">${escapeHtml(n.raw_snippet || n.summary || '')}</span>
                    ${replyBtn}
                    ${replyHtml}
                </div>`;
            };
            const previewHtml = sorted.slice(0, 5).map(renderEntry).join('');
            const hasMore = sorted.length > 5;
            const expandedHtml = hasMore
                ? `<div class="ai-cn-expanded">${sorted.slice(5).map(renderEntry).join('')}</div>`
                : '';
            notesHtml = `<div class="ai-section-header" onclick="toggleSection(this)">
                    <span class="ai-section-header__arrow">▸</span>
                    📋 הודעות הלקוח (${notesCount})
                </div>
                <div class="ai-cn-section" style="display: none;">
                    <div class="ai-cn-entries">${previewHtml}${expandedHtml}</div>
                    ${hasMore ? `<span class="ai-cn-toggle" onclick="toggleClientNotes(this)">הצג הכל ▼</span>` : ''}
                </div>`;
        }
    }
    html += notesHtml;

    // --- Missing docs section (collapsed by default) ---
    const allDocs = (items[0].all_docs || []);
    const groupMissingDocs = (items[0].missing_docs || []);
    const displayDocs = allDocs.length > 0 ? allDocs : groupMissingDocs;
    const docsReceivedCount = items[0].docs_received_count || 0;
    const docsTotalCount = items[0].docs_total_count || displayDocs.length;
    const hasStatusVariation = allDocs.length > 0 && docsReceivedCount > 0;
    if (displayDocs.length > 0) {
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
        let categoriesHtml = '<div class="ai-missing-category-tags">';
        for (const group of catGroups) categoriesHtml += group.docs.map(d => renderDocTag(d)).join('');
        categoriesHtml += '</div>';
        const label = hasStatusVariation
            ? `📄 מסמכים נדרשים (${docsReceivedCount}/${docsTotalCount} התקבלו)`
            : `📄 מסמכים חסרים (${groupMissingDocs.length})`;
        html += `<div class="ai-section-header" onclick="toggleSection(this)">
                <span class="ai-section-header__arrow">▸</span>
                ${label}
            </div>
            <div class="ai-missing-docs-body" style="display: none;">
                ${categoriesHtml}
            </div>`;
    }

    // --- Separator before doc list ---
    html += `<div class="ai-section-separator"></div>`;

    // --- Doc list (flat; wrapped in .ai-doc-list for DL-339 60/40 split) ---
    // DL-340: sort by review-state group (pending → on_hold → reviewed), received_at within group
    html += '<div class="ai-doc-list" id="aiDocList">';
    for (const item of [...items].sort(compareDocRows)) {
        html += renderDocRow(item);
    }
    html += '</div>';
    // DL-339: actions panel placeholder, hidden by CSS until .has-selection on parent.
    html += '<div class="ai-actions-panel" id="aiActionsPanel"></div>';

    return html;
}

// DL-334: Pane-2 row click — select a doc into the cockpit.
window.selectDocument = function(id) {
    if (isAIReviewMobileLayout()) {
        loadDocPreview(id);
        return;
    }
    const item = aiClassificationsData.find(i => String(i.id) === String(id));
    if (!item) return;
    // DL-339: mark parent as having a selection → CSS flips to 60/40 split (list + actions).
    const docs = document.querySelector('.ai-review-docs');
    // DL-339: capture transition FROM no-selection (first click) before toggling the class.
    // Subsequent clicks within an already-split layout don't change list height, so the
    // post-transition scrollIntoView isn't needed there (and would jitter unnecessarily).
    const wasFirstSelection = !!(docs && !docs.classList.contains('has-selection'));
    if (docs) docs.classList.add('has-selection');
    document.querySelectorAll('.ai-doc-row.active').forEach(el => el.classList.remove('active'));
    const row = document.querySelector(`.ai-doc-row[data-id="${CSS.escape(String(id))}"]`);
    if (row) {
        row.classList.add('active');
        // DL-278: keep the active row in view on desktop.
        try { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    }
    window.activePreviewItemId = id;
    loadDocPreview(id);
    if (typeof renderActionsPanel === 'function') renderActionsPanel(item);
    // DL-339: on first-click (empty → has-selection), the list's flex-basis animates
    // from 100% → 60% over 180ms. The immediate scrollIntoView above runs against the
    // pre-transition 100% viewport; the active row can end up scrolled out in the new
    // 60% viewport. Re-scroll 200ms later (180ms transition + small buffer) so the
    // active row stays visible. block:'nearest' is a no-op when already in view.
    if (wasFirstSelection) {
        setTimeout(() => {
            const r2 = document.querySelector(`.ai-doc-row[data-id="${CSS.escape(String(id))}"]`);
            if (r2) {
                try { r2.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
            }
        }, 200);
    }
};

// DL-334: Locate the desktop actions panel iff it is currently rendering the given item id.
function findItemActionsEl(id) {
    const p = document.getElementById('aiActionsPanel');
    if (!p) return null;
    return p.dataset.itemId && String(p.dataset.itemId) === String(id) ? p : null;
}

// DL-334: Format an ISO-ish date string as DD.MM.YYYY (no time). Returns '' for falsy input.
function _formatPanelDate(dateStr) {
    if (!dateStr) return '';
    const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    try {
        const d = new Date(dateStr);
        if (!isNaN(d)) {
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            return `${dd}.${mm}.${d.getFullYear()}`;
        }
    } catch (e) {}
    return String(dateStr);
}

// DL-334: Single-item DOM refresh after a mutation. Desktop swaps the thin row + re-renders
// the actions panel (if the item is active). Mobile falls through to its own in-place swap
// (renderAICard / renderReviewedCard / renderOnHoldCard path owned by callers).
function refreshItemDom(item) {
    if (!item) return;
    if (isAIReviewMobileLayout()) {
        // Mobile fat-card path — existing callers (transitionCardToReviewed, startReReview,
        // cancelReReview) already do an outerHTML swap via `.ai-review-card[data-id]`.
        // Nothing for us to do here.
        return;
    }
    const pane2 = document.querySelector('.ai-review-docs');
    const pane2Scroll = pane2 ? pane2.scrollTop : 0;

    // Swap the thin row in pane 2
    const oldRow = document.querySelector(`.ai-doc-row[data-id="${CSS.escape(String(item.id))}"]`);
    if (oldRow) {
        const tmp = document.createElement('div');
        tmp.innerHTML = renderDocRow(item).trim();
        const newRow = tmp.firstElementChild;
        oldRow.replaceWith(newRow);
        if (window.activePreviewItemId && String(window.activePreviewItemId) === String(item.id)) {
            newRow.classList.add('active');
        }
        // DL-340: reorder row into its new state group (pending → on_hold → reviewed).
        // Find the first sibling whose rank is higher than this item's — insert before it.
        const list = newRow.parentElement;
        if (list) {
            const myRank = getRowSortRank(item);
            let insertBefore = null;
            for (const sibling of list.children) {
                if (sibling === newRow) continue;
                const sid = sibling.getAttribute('data-id');
                if (!sid) continue;
                const sItem = aiClassificationsData.find(i => String(i.id) === sid);
                if (!sItem) continue;
                if (getRowSortRank(sItem) > myRank) { insertBefore = sibling; break; }
            }
            if (insertBefore) {
                if (newRow.nextElementSibling !== insertBefore) list.insertBefore(newRow, insertBefore);
            } else if (list.lastElementChild !== newRow) {
                list.appendChild(newRow);
            }
        }
    }

    // Re-render panel if this item is active
    if (window.activePreviewItemId && String(window.activePreviewItemId) === String(item.id)) {
        renderActionsPanel(item);
    }

    if (pane2) pane2.scrollTop = pane2Scroll;
}

// DL-334: render the pane-3 actions panel (single entry point). Desktop-only.
function renderActionsPanel(item) {
    const panel = document.getElementById('aiActionsPanel');
    if (!panel) return;
    if (isAIReviewMobileLayout()) return;

    panel.className = 'ai-actions-panel';
    if (!item) {
        panel.classList.add('ai-actions-panel--empty');
        panel.dataset.itemId = '';
        panel.innerHTML = `
            <div class="ai-ap-empty">
                <span class="ai-ap-empty__icon">◉</span>
                <div>בחר מסמך לבדיקה</div>
            </div>`;
        return;
    }
    panel.dataset.itemId = String(item.id);

    const rs = item.review_status;
    const reReviewing = _aiReReviewing.has(item.id);
    let variant;
    if (!reReviewing && rs === 'on_hold') variant = 'on-hold';
    else if (!reReviewing && rs === 'approved') variant = 'approved';
    else if (!reReviewing && rs === 'rejected') variant = 'rejected';
    else if (!reReviewing && rs === 'reassigned') variant = 'reassigned';
    else {
        const st = getCardState(item);
        if (st === 'full') variant = 'full';
        else if (st === 'fuzzy') variant = 'fuzzy';
        else if (st === 'issuer-mismatch') variant = 'issuer';
        else variant = 'unmatched';
    }
    panel.classList.add(`ai-actions-panel--${variant}`);

    const header = _renderPanelHeader(item, variant);
    let body;
    if (variant === 'on-hold') body = _renderPanelOnHold(item);
    else if (variant === 'approved' || variant === 'rejected' || variant === 'reassigned')
        body = _renderPanelReviewed(item, variant);
    else if (variant === 'full' || variant === 'fuzzy')
        body = _renderPanelFullOrFuzzy(item, variant, reReviewing);
    else if (variant === 'issuer')
        body = _renderPanelIssuerMismatch(item, reReviewing);
    else
        body = _renderPanelUnmatched(item, reReviewing);

    const additive = _renderPanelAdditive(item, variant, reReviewing);

    panel.innerHTML = header
        + `<div class="ai-ap-divider"></div>`
        + `<div class="ai-ap-body">${body}</div>`
        + additive;

    try { safeCreateIcons(panel); } catch (e) {}
    try { initAIReviewComboboxes(panel); } catch (e) {}
}

function _renderPanelHeader(item, variant) {
    const rawName = item.attachment_name || item.filename || 'ללא שם';
    let lozenge = '';
    if (variant === 'approved')   lozenge = `<span class="ai-ap-lozenge ai-ap-lozenge--approved">✓ אושר</span>`;
    else if (variant === 'rejected')   lozenge = `<span class="ai-ap-lozenge ai-ap-lozenge--rejected">⚠ דורש תיקון</span>`;
    else if (variant === 'reassigned') lozenge = `<span class="ai-ap-lozenge ai-ap-lozenge--reassigned">✓ שויך מחדש</span>`;
    else if (variant === 'on-hold')    lozenge = `<span class="ai-ap-lozenge ai-ap-lozenge--on-hold">⏳ ממתין ללקוח</span>`;

    const filingChip = item.filing_type
        ? `<span class="ai-filing-type-badge ai-ft-${escapeAttr(item.filing_type)}">${escapeHtml(FILING_TYPE_LABELS[item.filing_type] || item.filing_type)}</span>`
        : '';

    const flagChips = [];
    if (item.is_duplicate) flagChips.push('כפול');
    if (item.is_unrequested && !item.pre_questionnaire) flagChips.push('לא נדרש');
    if (item.pre_questionnaire) flagChips.push('טרם מולא שאלון');
    const flagChipsHtml = flagChips.map(l =>
        `<span class="ai-ap-flag-chip" style="background: var(--warning-50); color: var(--warning-700); padding: 1px 6px; border-radius: 3px; font-size: 11px;">${escapeHtml(l)}</span>`
    ).join('');

    const sender = item.sender_email || '';
    const dateStr = _formatPanelDate(item.received_at);
    const line2Parts = [sender, dateStr].filter(Boolean).map(escapeHtml);
    const line2 = line2Parts.length > 0
        ? `<div class="ai-ap-header__line2">${line2Parts.join(' · ')}</div>`
        : '';

    return `<div class="ai-ap-header">
        <div class="ai-ap-header__line1">
            ${lozenge}
            <span class="ai-ap-filename" title="${escapeAttr(rawName)}">${escapeHtml(rawName)}</span>
            ${filingChip}
            ${flagChipsHtml}
        </div>
        ${line2}
    </div>`;
}

function _renderPanelFullOrFuzzy(item, variant, reReviewing) {
    const docName = appendContractPeriod(item.matched_short_name || item.matched_template_name || 'לא ידוע', item);
    // DL-339 v1.9: confidence percentage removed from the body — users don't act
    // on the number and it competed visually with the matched doc name.
    return `<div style="font-size: 12px; color: var(--gray-700);">
        🤖 AI חושב שזה: <span style="font-weight: 500;">${renderDocLabel(docName)}</span>
    </div>`;
}

function _renderPanelIssuerMismatch(item, reReviewing) {
    const templateName = appendContractPeriod(item.matched_short_name || item.matched_template_name || item.matched_template_id || '', item);
    const aiIssuer = item.issuer_name || 'לא ידוע';
    const missingDocs = item.missing_docs || [];
    const relatedIds = RELATED_TEMPLATES[item.matched_template_id] || [item.matched_template_id];
    const sameTypeDocs = missingDocs.filter(d => relatedIds.includes(d.template_id));

    if (sameTypeDocs.length === 0) {
        // Fall through to unmatched-style combobox
        return `<div style="font-size: 12px; color: var(--gray-700);">
                🤖 AI חושב שזה: <span style="font-weight: 500;">${renderDocLabel(templateName)}</span>
            </div>
            <div style="font-size: 12px; color: var(--gray-700); margin-top: 6px;">
                🤖 AI חושב שהתקבל מ: <span style="font-weight: 500;">${escapeHtml(aiIssuer)}</span>
            </div>
            <div style="font-size: 11px; color: var(--warning-700); margin-top: 6px;">
                ⚠️ כל מסמכי ${renderDocLabel(templateName)} כבר התקבלו
            </div>
            <div style="font-size: 11px; color: var(--gray-600); margin-top: 8px;">שייך ל:</div>
            <div class="ai-inline-ft-toggle" data-record-id="${escapeAttr(item.id)}" style="display:none"></div>
            <div class="doc-combobox-container ai-ap-combobox" data-record-id="${escapeAttr(item.id)}"></div>`;
    }

    const radiosHtml = sameTypeDocs.map(d => {
        const docName = d.name_short || d.name || d.template_id;
        const docLabel = d.name_short || d.name_html || d.name || d.template_id;
        return `<label class="ai-ap-radio-item ai-comparison-radio">
            <input type="radio" name="ap_compare_${escapeAttr(item.id)}"
                data-template-id="${escapeAttr(d.template_id)}"
                data-doc-record-id="${escapeAttr(d.doc_record_id || '')}"
                data-doc-name="${escapeAttr(String(docName).replace(/<\/?b>/g, ''))}"
                onchange="handleComparisonRadio('${escapeAttr(item.id)}', this)">
            <span>${renderDocLabel(docLabel)}</span>
        </label>`;
    }).join('');

    return `<div style="font-size: 12px; color: var(--gray-700);">
            🤖 AI חושב שהתקבל מ: <span style="font-weight: 500;">${escapeHtml(aiIssuer)}</span>
        </div>
        <div style="font-size: 11px; color: var(--gray-600); margin-top: 6px;">האם זה אחד מהבאים?</div>
        <div class="ai-ap-radio-list ai-validation-options" style="margin-top: 4px;">${radiosHtml}</div>`;
}

function _renderPanelUnmatched(item, reReviewing) {
    const reason = item.ai_reason ? friendlyAIReason(item.ai_reason) : '';
    const reasonBlock = reason
        ? `<div class="ai-ap-reasoning-block" style="background: var(--gray-50); border-radius: 4px; padding: 8px 10px; font-size: 11px; color: var(--gray-700); line-height: 1.5; margin-top: 6px;">${escapeHtml(reason)}</div>`
        : '';
    return `<div style="font-size: 12px;">
            <span style="color: var(--gray-500);">🤖</span>
            <span style="font-weight: 500; color: var(--gray-800);">לא זוהה</span>
        </div>
        ${reasonBlock}
        <div style="font-size: 11px; color: var(--gray-600); margin-top: 8px;">שייך ל:</div>
        <div class="ai-inline-ft-toggle" data-record-id="${escapeAttr(item.id)}" style="display:none"></div>
        <div class="doc-combobox-container ai-ap-combobox" data-record-id="${escapeAttr(item.id)}"></div>`;
}

function _renderPanelOnHold(item) {
    // Resolve question-sent date (reuse renderOnHoldCard logic)
    let questionSentDate = item.reviewed_at || null;
    let clientReplyHtml = '';
    if (item.client_notes) {
        let cnArr = [];
        try {
            cnArr = JSON.parse(String(item.client_notes).replace(/[\n\r\t]/g, m => m === '\n' ? '\\n' : m === '\r' ? '\\r' : '\\t'));
            if (!Array.isArray(cnArr)) cnArr = [];
        } catch (e) {}
        const bqEntry = cnArr.find(n => n.type === 'batch_questions_sent'
            && Array.isArray(n.items) && n.items.some(i => i.attachment_name === item.attachment_name));
        if (bqEntry && bqEntry.date && !questionSentDate) questionSentDate = bqEntry.date;
        const replies = cnArr.filter(n =>
            n.source === 'email' &&
            n.type !== 'batch_questions_sent' &&
            n.type !== 'office_reply' &&
            (!questionSentDate || (n.date || '') > questionSentDate)
        ).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        if (replies.length > 0) {
            const r = replies[0];
            const rDate = _formatPanelDate(r.date);
            clientReplyHtml = `<div style="font-size: 11px; color: var(--info-700); margin-top: 8px;">📧 תגובת הלקוח${rDate ? ` (${rDate})` : ''}:</div>
                <div class="ai-ap-reply-block" style="background: var(--info-50); border-radius: 4px; padding: 8px 10px; font-size: 12px; color: var(--gray-700); line-height: 1.5; white-space: pre-wrap; margin-top: 4px;">${escapeHtml(r.raw_snippet || r.summary || '')}</div>`;
        }
    }

    const sentDateStr = questionSentDate ? _formatPanelDate(questionSentDate) : '';
    const sentLabel = sentDateStr
        ? `💬 שאלה נשלחה ללקוח בתאריך ${escapeHtml(sentDateStr)}:`
        : `💬 שאלה נשלחה ללקוח:`;

    const questionBlock = item.pending_question
        ? `<div class="ai-ap-question-block" style="background: var(--warning-50); border-radius: 4px; padding: 8px 10px; font-size: 12px; color: var(--warning-800); line-height: 1.5; margin-top: 4px;">${escapeHtml(item.pending_question)}</div>`
        : '';

    const aiGuess = item.matched_template_id
        ? `<div style="font-size: 11px; color: var(--gray-600); margin-top: 8px;">🤖 AI זיהה כ: <span style="font-weight: 500;">${renderDocLabel(item.matched_short_name || item.matched_template_name || '')}</span></div>`
        : '';

    return `<div style="font-size: 11px; color: var(--gray-600);">${sentLabel}</div>
        ${questionBlock}
        ${clientReplyHtml}
        ${aiGuess}`;
}

function _renderPanelReviewed(item, variant) {
    let displayName;
    if (variant === 'rejected') {
        displayName = item.attachment_name || item.matched_short_name || 'לא ידוע';
    } else if (variant === 'reassigned') {
        const siblings = [...(item.all_docs || []), ...(item.other_report_docs || [])];
        const target = item.onedrive_item_id
            ? siblings.find(d => d.onedrive_item_id === item.onedrive_item_id && d.status === 'Received')
            : null;
        const targetName = target && (target.name_short || target.name);
        displayName = appendContractPeriod(
            targetName || item.matched_short_name || item.matched_template_name || item.attachment_name || 'לא ידוע',
            item
        );
    } else {
        // approved
        displayName = appendContractPeriod(item.matched_short_name || item.matched_template_name || 'לא ידוע', item);
    }

    let rejectionBlock = '';
    if (variant === 'rejected' && item.notes) {
        try {
            const notesData = typeof item.notes === 'string' ? JSON.parse(item.notes) : item.notes;
            const reasonLabel = REJECTION_REASONS[notesData.reason] || notesData.reason || '';
            const notesText = notesData.text || '';
            if (reasonLabel || notesText) {
                rejectionBlock = `<div class="ai-ap-reasoning-block" style="background: var(--gray-50); border-radius: 4px; padding: 8px 10px; font-size: 11px; color: var(--gray-700); line-height: 1.5; margin-top: 6px;">
                    ${reasonLabel ? `<strong>${escapeHtml(reasonLabel)}</strong>` : ''}${reasonLabel && notesText ? ': ' : ''}${escapeHtml(notesText)}
                </div>`;
            }
        } catch (e) {}
    }

    return `<div style="font-size: 12px;">
            <span style="color: var(--gray-500);">תואם ל:</span>
            <span style="font-weight: 500;"> ${renderDocLabel(displayName)}</span>
        </div>
        ${rejectionBlock}`;
}

function _renderPanelAdditive(item, variant, reReviewing) {
    const id = item.id;
    const idA = escapeAttr(id);
    const idJs = escapeOnclick(String(id));

    // --- Primary actions (DL-334 v3: two-tier layout) ---
    // Tier 1: affirmative action(s), equal weight (primary-success + neutral).
    // Tier 2: destructive action, borderless red text with margin-top separation.
    const destructiveBtn = (extraClass = '') =>
        `<button class="ai-ap-btn ai-ap-btn--destructive-text ai-ap-btn--full ${extraClass}" onclick="rejectAIClassification('${idA}')">✕ מסמך לא רלוונטי</button>`;
    const cancelReReviewBtn = reReviewing
        ? `<button class="ai-ap-btn ai-ap-btn--ghost ai-ap-btn--full" onclick="cancelReReview('${idA}')">ביטול</button>`
        : '';

    let primaryHtml = '';
    if (variant === 'full' || variant === 'fuzzy') {
        const addToRequired = item.is_unrequested && !!item.matched_template_id;
        const approveDisabled = item.is_unrequested && !item.matched_template_id;
        const approveLabel = addToRequired
            ? '✓ נכון - הוסף מסמך זה לרשימת המסמכים הדרושים'
            : '✓ נכון';
        const approveHandler = addToRequired
            ? `approveAIClassificationAddRequired('${idA}', '${escapeAttr(item.matched_template_id)}')`
            : `approveAIClassification('${idA}')`;
        const approveAttrs = approveDisabled
            ? `aria-disabled="true" title="לא ניתן לאשר מסמך שלא נדרש — יש לשייך מחדש או לדחות"`
            : `onclick="${approveHandler}"`;
        primaryHtml = `<div class="ai-ap-primary-actions">
            <div class="ai-ap-primary-actions__row" style="gap: 6px;">
                <button class="ai-ap-btn ai-ap-btn--primary-success" style="flex: 1;" ${approveAttrs}>${escapeHtml(approveLabel)}</button>
                <button class="ai-ap-btn ai-ap-btn--neutral" style="flex: 1;" onclick="showAIReassignModal('${idA}')">שייך מחדש</button>
            </div>
            ${destructiveBtn('ai-ap-primary-actions__tier2')}
            ${cancelReReviewBtn}
        </div>`;
    } else if (variant === 'issuer') {
        const missingDocs = item.missing_docs || [];
        const relatedIds = RELATED_TEMPLATES[item.matched_template_id] || [item.matched_template_id];
        const sameTypeDocs = missingDocs.filter(d => relatedIds.includes(d.template_id));
        if (sameTypeDocs.length === 0) {
            // Fallback to unmatched layout: single assign button (disabled until combobox picks) + destructive below.
            primaryHtml = `<div class="ai-ap-primary-actions">
                <button class="ai-ap-btn ai-ap-btn--primary-success ai-ap-btn--full btn-ai-assign-confirm" disabled onclick="assignAIUnmatched('${idA}', this)">שייך</button>
                ${destructiveBtn('ai-ap-primary-actions__tier2')}
                ${cancelReReviewBtn}
            </div>`;
        } else {
            primaryHtml = `<div class="ai-ap-primary-actions">
                <div class="ai-ap-primary-actions__row" style="gap: 6px;">
                    <button class="ai-ap-btn ai-ap-btn--primary-success btn-ai-comparison-assign" style="flex: 1;" disabled onclick="quickAssignSelected('${idA}')">אישור ושיוך</button>
                    <button class="ai-ap-btn ai-ap-btn--neutral" style="flex: 1;" onclick="showAIReassignModal('${idA}')">לא מצאתי ברשימה</button>
                </div>
                ${destructiveBtn('ai-ap-primary-actions__tier2')}
                ${cancelReReviewBtn}
            </div>`;
        }
    } else if (variant === 'unmatched') {
        primaryHtml = `<div class="ai-ap-primary-actions">
            <button class="ai-ap-btn ai-ap-btn--primary-success ai-ap-btn--full btn-ai-assign-confirm" disabled onclick="assignAIUnmatched('${idA}', this)">שייך</button>
            ${destructiveBtn('ai-ap-primary-actions__tier2')}
            ${cancelReReviewBtn}
        </div>`;
    } else if (variant === 'on-hold') {
        primaryHtml = `<div class="ai-ap-primary-actions">
            <button class="ai-ap-btn ai-ap-btn--warning ai-ap-btn--full" onclick="startReReview('${idA}')">סיים את ההמתנה</button>
        </div>`;
    } else if (variant === 'approved' || variant === 'rejected' || variant === 'reassigned') {
        // Neutral "change my mind" + (approved only) neutral "also matches" — both gray, not destructive.
        const alsoMatch = variant === 'approved'
            ? `<button class="ai-ap-btn ai-ap-btn--neutral ai-ap-btn--full ai-ap-primary-actions__tier2" onclick="showAIAlsoMatchModal('${idA}')">📋 הקובץ תואם למסמך נוסף</button>`
            : '';
        primaryHtml = `<div class="ai-ap-primary-actions">
            <button class="ai-ap-btn ai-ap-btn--neutral ai-ap-btn--full" onclick="startReReview('${idA}')">🔄 שנה החלטה</button>
            ${alsoMatch}
        </div>`;
    }

    // --- Pending-question secondary block (non-on_hold) ---
    const pendingQBlock = (variant !== 'on-hold' && item.pending_question)
        ? `<div class="ai-ap-pending-question" style="background: var(--info-50); border-radius: 4px; padding: 6px 8px; font-size: 11px; color: var(--info-700); margin-top: 6px;">💬 שאלה נשמרה: ${escapeHtml(item.pending_question)}</div>`
        : '';

    // --- Secondary actions (split, contract-period, overflow) ---
    const secondaryBtns = [];
    if (item.page_count && item.page_count >= 2) {
        secondaryBtns.push(`<button class="ai-ap-btn ai-ap-btn--ghost ai-ap-btn--small" onclick="openSplitModal('${idA}')">✂️ פיצול PDF</button>`);
    }
    if (['T901', 'T902'].includes(item.matched_template_id)) {
        const cp = item.contract_period;
        const rid = idA;
        const year = item.year || new Date().getFullYear();
        if (cp && cp.coversFullYear) {
            secondaryBtns.push(`<span class="ai-ap-contract-full" style="background: var(--success-50); color: var(--success-700); padding: 4px 8px; border-radius: 3px; font-size: 11px;">📅 חוזה שנתי מלא ✓</span>`);
        } else {
            const hasStart = cp && cp.startDate;
            const hasEnd = cp && cp.endDate;
            const startMonth = hasStart ? new Date(cp.startDate).getMonth() + 1 : null;
            const endMonth = hasEnd ? new Date(cp.endDate).getMonth() + 1 : null;
            const startVal = hasStart ? cp.startDate.substring(0, 7) : '';
            const endVal = hasEnd ? cp.endDate.substring(0, 7) : '';
            const startLabel = startMonth ? `${String(startMonth).padStart(2, '0')}.${year}` : '__.__';
            const endLabel = endMonth ? `${String(endMonth).padStart(2, '0')}.${year}` : '__.__';
            const statusText = cp ? 'חוזה חלקי' : 'לא זוהו תאריכים';
            let reqBtns = '';
            if (startMonth && startMonth > 1) {
                reqBtns += `<button class="ai-ap-btn ai-ap-btn--ghost ai-ap-btn--small btn-request-period" data-record-id="${rid}" data-gap="before" onclick="event.stopPropagation(); requestMissingPeriod('${rid}', 1, ${startMonth - 1}, this)">+ בקש חוזה ${formatPeriodLabel(1, startMonth - 1, year)}</button>`;
            }
            if (endMonth && endMonth < 12) {
                reqBtns += `<button class="ai-ap-btn ai-ap-btn--ghost ai-ap-btn--small btn-request-period" data-record-id="${rid}" data-gap="after" onclick="event.stopPropagation(); requestMissingPeriod('${rid}', ${endMonth + 1}, 12, this)">+ בקש חוזה ${formatPeriodLabel(endMonth + 1, 12, year)}</button>`;
            }
            secondaryBtns.push(`<span class="ai-ap-contract-partial ai-contract-period-banner" data-record-id="${rid}" style="font-size: 11px;">📅 ${statusText}:
                מ <span class="contract-date-editable" data-field="start" data-value="${escapeAttr(startVal)}" onclick="event.stopPropagation(); editContractDate('${rid}', 'start', this)" title="לחץ לעריכה">${startLabel}</span>
                עד <span class="contract-date-editable" data-field="end" data-value="${escapeAttr(endVal)}" onclick="event.stopPropagation(); editContractDate('${rid}', 'end', this)" title="לחץ לעריכה">${endLabel}</span>
                ${reqBtns}
            </span>`);
        }
    }

    // Overflow menu
    const qLabel = item.pending_question ? 'ערוך שאלה' : 'הוסף שאלה';
    const overflowItems = [];
    if (variant === 'approved' || variant === 'rejected' || variant === 'reassigned') {
        overflowItems.push(`<button class="ai-ap-overflow__item" onclick="startReReview('${idA}'); _closePanelOverflow();">שנה החלטה</button>`);
        if (variant === 'approved') {
            overflowItems.push(`<button class="ai-ap-overflow__item" onclick="showAIAlsoMatchModal('${idA}'); _closePanelOverflow();">הקובץ תואם למסמך נוסף</button>`);
        }
        overflowItems.push(`<button class="ai-ap-overflow__item" onclick="openAddQuestionDialog('${idA}'); _closePanelOverflow();">${qLabel}</button>`);
    } else {
        // pending (non-on_hold) + on-hold
        overflowItems.push(`<button class="ai-ap-overflow__item" onclick="openAddQuestionDialog('${idA}'); _closePanelOverflow();">${qLabel}</button>`);
    }

    const overflowHtml = `<div class="ai-ap-overflow">
        <button class="ai-ap-overflow__btn" onclick="_togglePanelOverflow(this, event)" title="פעולות נוספות">⋮</button>
        <div class="ai-ap-overflow__menu">${overflowItems.join('')}</div>
    </div>`;
    secondaryBtns.push(overflowHtml);

    const secondaryHtml = `<div class="ai-ap-secondary-actions" style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">${secondaryBtns.join('')}</div>`;

    return primaryHtml + pendingQBlock + secondaryHtml;
}

// DL-334: Overflow menu toggles + document-click close handler (bound once).
// DL-339 v1.4: menu promoted to position:fixed on open, coordinates computed from the
// button's viewport rect, so it escapes the .ai-actions-panel overflow:auto clip.
function _togglePanelOverflow(btn, event) {
    if (event) event.stopPropagation();
    const wrap = btn.closest('.ai-ap-overflow');
    if (!wrap) return;
    const wasOpen = wrap.classList.contains('open');
    _closePanelOverflow();
    if (!wasOpen) {
        const menu = wrap.querySelector('.ai-ap-overflow__menu');
        if (menu) {
            const r = btn.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = `${Math.round(r.bottom + 4)}px`;
            // Align menu's inline-end to the button's inline-end (right edge in RTL).
            menu.style.right = `${Math.round(window.innerWidth - r.right)}px`;
            menu.style.left = 'auto';
            menu.style.insetInlineEnd = 'auto';
            menu.style.zIndex = '10000';
        }
        wrap.classList.add('open');
    }
}
function _closePanelOverflow() {
    document.querySelectorAll('.ai-ap-overflow.open').forEach(el => {
        el.classList.remove('open');
        const menu = el.querySelector('.ai-ap-overflow__menu');
        if (menu) {
            menu.style.position = '';
            menu.style.top = '';
            menu.style.right = '';
            menu.style.left = '';
            menu.style.insetInlineEnd = '';
            menu.style.zIndex = '';
        }
    });
}
if (!window._aiPanelOverflowHandlerInstalled) {
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.ai-ap-overflow')) _closePanelOverflow();
    });
    // Close on any scroll so the fixed menu doesn't detach from its trigger.
    document.addEventListener('scroll', () => _closePanelOverflow(), true);
    window._aiPanelOverflowHandlerInstalled = true;
}

// DL-334: Desktop reject-notes sub-panel — scoped to .ai-ap-primary-actions.
function showPanelRejectNotes(recordId) {
    const panel = findItemActionsEl(recordId);
    if (!panel) return false;
    const actionsDiv = panel.querySelector('.ai-ap-primary-actions');
    if (!actionsDiv) return false;

    actionsDiv.dataset.originalHtml = actionsDiv.innerHTML;
    actionsDiv.innerHTML = `
        <div class="ai-ap-reject-notes">
            <select class="ai-reject-reason-select" style="width: 100%; height: 30px; border: 0.5px solid var(--gray-200); border-radius: 3px; font-size: 12px; padding: 0 8px;">
                <option value="">בחר סיבה...</option>
                ${Object.entries(REJECTION_REASONS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}
            </select>
            <textarea class="ai-reject-notes-text" placeholder="הערות נוספות (אופציונלי)" rows="2" style="width: 100%; margin-top: 6px; border: 0.5px solid var(--gray-200); border-radius: 3px; font-size: 12px; padding: 6px 8px; min-height: 60px;"></textarea>
            <div style="display: flex; gap: 6px; margin-top: 6px;">
                <button class="ai-ap-btn ai-ap-btn--danger-ghost ai-reject-confirm-btn" style="flex: 1;" disabled>מסמך לא רלוונטי</button>
                <button class="ai-ap-btn ai-ap-btn--ghost ai-reject-cancel-btn" style="width: 60px;">ביטול</button>
            </div>
        </div>`;

    const select = actionsDiv.querySelector('.ai-reject-reason-select');
    const confirmBtn = actionsDiv.querySelector('.ai-reject-confirm-btn');
    const cancelBtn = actionsDiv.querySelector('.ai-reject-cancel-btn');

    function restore() {
        if (actionsDiv.dataset.originalHtml != null) {
            actionsDiv.innerHTML = actionsDiv.dataset.originalHtml;
            delete actionsDiv.dataset.originalHtml;
        }
        document.removeEventListener('keydown', escHandler);
    }
    function escHandler(e) { if (e.key === 'Escape') restore(); }
    document.addEventListener('keydown', escHandler);

    select.addEventListener('change', () => { confirmBtn.disabled = !select.value; });
    cancelBtn.addEventListener('click', restore);
    confirmBtn.addEventListener('click', async () => {
        const reason = select.value;
        const notes = actionsDiv.querySelector('.ai-reject-notes-text').value.trim();
        document.removeEventListener('keydown', escHandler);
        await executeReject(recordId, reason, notes);
    });
    return true;
}

// DL-334: Loading overlay over primary-actions only.
function showPanelLoading(recordId, on, text) {
    const panel = findItemActionsEl(recordId);
    if (!panel) return;
    const actions = panel.querySelector('.ai-ap-primary-actions');
    if (!actions) return;
    let overlay = actions.querySelector('.ai-ap-transient-loading');
    if (on) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'ai-ap-transient-loading';
            overlay.innerHTML = `<div class="spinner"></div><span>${escapeHtml(text || 'מעבד...')}</span>`;
            actions.style.position = actions.style.position || 'relative';
            actions.appendChild(overlay);
        }
    } else if (overlay) {
        overlay.remove();
    }
}

function getCardState(item) {
    // DL-334: on_hold is a first-class state UNLESS user is re-reviewing it (see _aiReReviewing)
    if (item && item.review_status === 'on_hold' && !_aiReReviewing.has(item.id)) return 'on_hold';
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
    // DL-334: Desktop-or-mobile-targetable — use panel scope on desktop, fat card on mobile.
    const card = findItemActionsEl(recordId) || document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;
    // Deselect all radios in this card/panel
    card.querySelectorAll('.ai-comparison-radio, .ai-ap-radio-item').forEach(r => r.classList.remove('selected'));
    const wrap = radioEl.closest('.ai-comparison-radio') || radioEl.closest('.ai-ap-radio-item');
    if (wrap) wrap.classList.add('selected');
    // Enable assign button
    const assignBtn = card.querySelector('.btn-ai-comparison-assign');
    if (assignBtn) assignBtn.disabled = false;
}

function quickAssignSelected(recordId) {
    // DL-334: Desktop-or-mobile-targetable.
    const card = findItemActionsEl(recordId) || document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;
    const selectedRadio = card.querySelector('input[type="radio"]:checked');
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

// DL-330: mobile uses legacy full grouped-accordion rendering; desktop uses 3-pane split
function isAIReviewMobileLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
}

// DL-330: Build the full client accordion HTML block (header + body + doc cards).
// `open` controls the initial .open class. Used both on mobile (all clients) and
// on desktop pane 2 (selected client only, always open).
function buildClientAccordionHtml(clientName, clientItems, open) {
    let pendingCount = 0, reviewedCount = 0;
    for (const i of clientItems) {
        if ((i.review_status || 'pending') === 'pending') pendingCount++;
        else reviewedCount++;
    }

    let badgesHtml = '';
    if (pendingCount > 0) {
        badgesHtml = `<span class="ai-accordion-stat-badge badge-matched">${pendingCount} מסמכים ממתינים</span>`;
    }

    const clientId = clientItems[0].client_id;
    const docManagerBtn = clientId
        ? `<a href="../document-manager.html?client_id=${encodeURIComponent(clientId)}"
             target="_blank" class="ai-doc-manager-link"
             onclick="event.stopPropagation()" title="לניהול המסמכים">
             ${icon('folder-open', 'icon-xs')}
           </a>`
        : '';

    let html = `
        <div class="ai-accordion${open ? ' open' : ''}" data-client="${escapeHtml(clientName)}" data-client-id="${escapeAttr(clientId || '')}">
            <div class="ai-accordion-header" onclick="toggleAIAccordion(this)">
                <div class="ai-accordion-title">
                    ${icon('user', 'icon-sm')}
                    ${escapeHtml(clientName)}
                </div>
                <div class="ai-accordion-stats">
                    ${badgesHtml}
                </div>
                <div class="ai-accordion-actions">
                    ${docManagerBtn}
                    <span class="ai-accordion-icon">▾</span>
                </div>
            </div>
            <div class="ai-accordion-body">
    `;

    // DL-199: Client communication notes timeline (in-place expand)
    const clientNotesRaw = clientItems.find(i => i.client_notes)?.client_notes;
    if (clientNotesRaw) {
        let cnArr = [];
        try { cnArr = JSON.parse(clientNotesRaw.replace(/[\n\r\t]/g, m => m === '\n' ? '\\n' : m === '\r' ? '\\r' : '\\t')); if (!Array.isArray(cnArr)) cnArr = []; } catch(e) {}
        const replyMap = {};
        for (const n of cnArr) {
            if (n.type === 'office_reply' && n.reply_to) replyMap[n.reply_to] = n;
        }
        cnArr = cnArr.filter(n => n.type !== 'office_reply' && n.type !== 'batch_questions_sent');
        if (cnArr.length > 0) {
            const sorted = [...cnArr].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const cnReportId = clientItems[0]?.report_record_id || '';
            const cnYear = clientItems[0]?.year || '';
            const renderEntry = n => {
                const isEmail = n.source === 'email';
                const iconName = isEmail ? 'mail' : 'pencil';
                const iconClass = isEmail ? 'cn-icon--email' : 'cn-icon--manual';
                const rawDate = n.date || '';
                const dateStr = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/) ? rawDate.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3-$2-$1') : rawDate;
                const nId = n.id ? escapeAttr(String(n.id)) : '';
                const replyBtn = nId
                    ? `<button class="ai-cn-action-btn" title="הגב" onclick="event.stopPropagation();showReplyInput('${nId}','${escapeAttr(cnReportId)}',this.closest('.ai-cn-entry'))">${icon('message-square', 'icon-xs')}</button>`
                    : '';
                const reply = nId ? replyMap[nId] : null;
                const replyHtml = reply
                    ? `<div class="cn-office-reply">
                        <div class="cn-reply-label">${icon('corner-down-left', 'icon-xs')} תגובת המשרד</div>
                        <div class="cn-reply-text">${escapeHtml(reply.summary)}</div>
                        <div class="cn-reply-date">${(reply.date || '').slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3-$2-$1')}</div>
                    </div>` : '';
                return `<div class="ai-cn-entry" data-note-id="${nId}" data-report-id="${escapeAttr(cnReportId)}" data-client-name="${escapeAttr(clientName)}" data-year="${escapeAttr(cnYear)}">
                    ${icon(iconName, `icon-sm ${iconClass}`)}
                    <span class="ai-cn-date">${escapeHtml(dateStr)}</span>
                    <span class="ai-cn-summary">${escapeHtml(n.raw_snippet || n.summary || '')}</span>
                    ${replyBtn}
                    ${replyHtml}
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
                ${hasMore ? `<span class="ai-cn-toggle" onclick="toggleClientNotes(this)">הצג הכל ▼</span>` : ''}
            </div>`;
        }
    }

    const allDocs = (clientItems[0].all_docs || []);
    const groupMissingDocs = (clientItems[0].missing_docs || []);
    const displayDocs = allDocs.length > 0 ? allDocs : groupMissingDocs;
    const docsReceivedCount = clientItems[0].docs_received_count || 0;
    const docsTotalCount = clientItems[0].docs_total_count || displayDocs.length;
    const hasStatusVariation = allDocs.length > 0 && docsReceivedCount > 0;

    if (displayDocs.length > 0) {
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
        let categoriesHtml = '<div class="ai-missing-category-tags">';
        for (const group of catGroups) categoriesHtml += group.docs.map(d => renderDocTag(d)).join('');
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

    html += `<div class="ai-accordion-content">`;
    for (const item of clientItems) html += renderAICard(item);
    html += `</div></div></div>`;
    return html;
}

// DL-330: Build a compact client-row for desktop pane 1. Reuses .ai-accordion-header
// look (per user requirement "exactly like today") but click selects the client into pane 2.
function buildClientListRowHtml(clientName, clientItems, isActive) {
    let pendingCount = 0, reviewedCount = 0;
    for (const i of clientItems) {
        if ((i.review_status || 'pending') === 'pending') pendingCount++;
        else reviewedCount++;
    }
    const total = pendingCount + reviewedCount;

    const clientId = clientItems[0].client_id;
    const docManagerBtn = clientId
        ? `<a href="../document-manager.html?client_id=${encodeURIComponent(clientId)}"
             target="_blank" class="ai-doc-manager-link"
             onclick="event.stopPropagation()" title="לניהול המסמכים">
             ${icon('folder-open', 'icon-xs')}
           </a>`
        : '';

    // DL-332: zero-pending clients render nothing in the pending slot
    const pendingHtml = pendingCount > 0
        ? `<span class="ai-client-pending-num" title="${pendingCount} ממתינים">${pendingCount}</span>`
        : '';

    return `
        <div class="ai-client-row ai-accordion-header${isActive ? ' active' : ''}"
             data-client="${escapeHtml(clientName)}"
             data-client-id="${escapeAttr(clientId || '')}"
             onclick="selectClient(this.dataset.client)">
            <div class="ai-accordion-actions">${docManagerBtn}</div>
            <div class="ai-accordion-title" style="min-width: 0; flex: 1;">
                <div style="min-width: 0;">
                    <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;">${escapeHtml(clientName)}</div>
                    <div class="ai-client-progress">${reviewedCount}/${total} נבדקו</div>
                </div>
            </div>
            <div class="ai-accordion-stats">${pendingHtml}</div>
        </div>
    `;
}

// DL-330: Initialize inline comboboxes in a freshly-rendered subtree.
function initAIReviewComboboxes(container) {
    if (!container) return;
    container.querySelectorAll('.doc-combobox-container').forEach(el => {
        const recordId = el.dataset.recordId;
        const itemData = aiClassificationsData.find(i => i.id === recordId);
        const ownDocs = itemData ? (itemData.all_docs || itemData.missing_docs || []) : [];
        const otherDocsArr = itemData?.other_report_docs || [];
        const hasBothTypes = otherDocsArr.length > 0;
        createDocCombobox(el, ownDocs, {
            allowCreate: true,
            onSelect: (templateId) => {
                const btn = el.closest('.ai-card-actions')?.querySelector('.btn-ai-assign-confirm');
                if (btn) btn.disabled = !templateId;
            },
            ...(hasBothTypes ? {
                otherDocs: otherDocsArr,
                ownFilingType: itemData.filing_type || 'annual_report',
                otherFilingType: itemData.other_filing_type || (itemData.filing_type === 'annual_report' ? 'capital_statement' : 'annual_report'),
            } : {}),
        });
    });
}

// DL-330: 3-pane desktop selector. Called from client-row onclick.
function selectClient(clientName) {
    if (!clientName) return;
    if (isAIReviewMobileLayout()) return;  // mobile uses accordion toggle
    selectedClientName = clientName;

    // Update .active class on pane 1 without re-rendering
    const clientsPane = document.getElementById('aiClientsPane');
    if (clientsPane) {
        clientsPane.querySelectorAll('.ai-client-row').forEach(row => {
            row.classList.toggle('active', row.dataset.client === clientName);
        });
    }

    // Re-render pane 2
    const docsPane = document.getElementById('aiDocsPane');
    if (!docsPane) return;
    const clientItems = aiClassificationsData.filter(i => (i.client_name || 'לא ידוע') === clientName);
    if (clientItems.length > 0) {
        // DL-334: desktop uses the new thin-row cockpit layout (mobile still uses accordion).
        docsPane.innerHTML = buildDesktopClientDocsHtml(clientName, clientItems);
        initAIReviewComboboxes(docsPane);
        safeCreateIcons(docsPane);
        // DL-341: surface done-prompt when the just-selected client is already fully reviewed.
        const pendingLeft = clientItems.filter(i => (i.review_status || 'pending') === 'pending').length;
        if (pendingLeft === 0) {
            showClientReviewDonePrompt(clientName);
        }
    } else {
        docsPane.innerHTML = '';
    }

    // Fresh client → clear stale preview
    resetPreviewPanel();

    // DL-334: Auto-select first pending/on_hold doc into the cockpit.
    if (clientItems.length > 0) {
        const firstPending = clientItems.find(i => !i.review_status || i.review_status === 'pending' || i.review_status === 'on_hold');
        if (firstPending) {
            selectDocument(firstPending.id);
        } else {
            // No pending — clear actions panel to empty state (Workstream B will replace with renderer).
            const panel = document.getElementById('aiActionsPanel');
            if (panel) panel.innerHTML = '';
            if (typeof renderActionsPanel === 'function') renderActionsPanel(null);
        }
    }
}

function renderAICards(items, allFilteredItems) {
    const clientsPane = document.getElementById('aiClientsPane');
    const docsPane = document.getElementById('aiDocsPane');
    const emptyState = document.getElementById('aiEmptyState');
    const placeholder = document.getElementById('aiDocsPlaceholder');
    const isMobile = isAIReviewMobileLayout();

    // Preserve state across re-renders
    const prevOpenClient = isMobile
        ? (clientsPane?.querySelector('.ai-accordion.open')?.dataset.client || null)
        : selectedClientName;

    if (!items || items.length === 0) {
        const clientsList = document.getElementById('aiClientsList');
        const clientsHeader = document.getElementById('aiClientsHeader');
        if (clientsHeader) clientsHeader.textContent = '';
        if (clientsList) clientsList.innerHTML = '';
        else if (clientsPane) clientsPane.innerHTML = '';
        if (docsPane) docsPane.innerHTML = '';
        const sb = document.getElementById('aiSummaryBar');
        if (sb) sb.style.display = 'none';

        if (aiClassificationsData.length === 0) {
            if (emptyState) {
                emptyState.style.display = 'block';
                (isMobile ? (clientsList || clientsPane) : docsPane)?.appendChild(emptyState);
            }
        } else {
            if (emptyState) emptyState.style.display = 'none';
            const target = clientsList || clientsPane;
            if (target) {
                target.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">${icon('filter-x', 'icon-2xl')}</div>
                        <p>אין תוצאות לסינון הנוכחי</p>
                    </div>
                `;
            }
        }
        if (clientsPane) safeCreateIcons(clientsPane);
        return;
    }

    // DL-330: clear any inline display (was 'block' — overrode the CSS 'display: flex' that makes the toolbar-top + scroll-list layout work)
    if (clientsPane) clientsPane.style.display = '';
    if (emptyState) emptyState.style.display = 'none';

    // Group by client_name
    const groups = {};
    for (const item of items) {
        const clientName = item.client_name || 'לא ידוע';
        if (!groups[clientName]) groups[clientName] = [];
        groups[clientName].push(item);
    }

    // DL-268 + DL-330: Summary bar extended with overall X/Y reviewed
    const allItems = allFilteredItems || items;
    const allGroups = {};
    for (const i of allItems) { const cn = i.client_name || 'לא ידוע'; if (!allGroups[cn]) allGroups[cn] = []; allGroups[cn].push(i); }
    const totalPending = allItems.filter(i => (i.review_status || 'pending') === 'pending').length;
    const totalReviewed = allItems.length - totalPending;
    const totalAll = allItems.length;
    const clientsWithPending = Object.entries(allGroups).filter(([, ci]) => ci.some(i => (i.review_status || 'pending') === 'pending')).length;
    const summaryStr = totalAll > 0
        ? `${totalPending} מסמכים ממתינים · ${clientsWithPending} לקוחות · ${totalReviewed}/${totalAll} נבדקו`
        : '';
    // DL-330 redesign: structured summary — drops the "N מסמכים ממתינים" line per user request; keeps
    // clients-waiting count + reviewed/total with a progress bar. Rendered into .ai-clients-summary.
    const reviewedPct = totalAll > 0 ? Math.round((totalReviewed / totalAll) * 100) : 0;
    const summaryHtml = totalAll > 0
        ? `
            <div class="ai-summary-primary">${clientsWithPending} לקוחות ממתינים</div>
            <div class="ai-summary-progress">
                <div class="ai-summary-progress-labels">
                    <span class="ai-summary-progress-text">${totalReviewed} / ${totalAll} מסמכים נבדקו</span>
                    <span class="ai-summary-progress-pct">${reviewedPct}%</span>
                </div>
                <div class="ai-summary-progress-track"><div class="ai-summary-progress-fill" style="width:${reviewedPct}%"></div></div>
            </div>
        `
        : '';
    // Legacy summary bar (hidden by DL-330 CSS but kept in DOM for backwards compat)
    const summaryBar = document.getElementById('aiSummaryBar');
    const summaryText = document.getElementById('aiSummaryText');
    if (summaryBar && summaryText) {
        if (totalAll > 0) {
            summaryText.textContent = summaryStr;
            summaryBar.style.display = 'block';
        } else {
            summaryBar.style.display = 'none';
        }
    }

    // DL-330: write structured summary (stat + progress bar) into the persistent toolbar header.
    // Fall back to prepending into pane 1 only if the toolbar isn't present (defensive).
    const clientsHeader = document.getElementById('aiClientsHeader');
    if (clientsHeader) clientsHeader.innerHTML = summaryHtml;
    const clientsList = document.getElementById('aiClientsList');
    const renderTarget = clientsList || clientsPane;

    if (isMobile) {
        // Mobile: render legacy grouped accordions into the clients list (docs/detail panes hidden by CSS)
        let html = '';
        for (const [clientName, clientItems] of Object.entries(groups)) {
            html += buildClientAccordionHtml(clientName, clientItems, false);
        }
        if (renderTarget) {
            renderTarget.innerHTML = html;
            if (prevOpenClient) {
                const el = renderTarget.querySelector(`.ai-accordion[data-client="${CSS.escape(prevOpenClient)}"]`);
                if (el) el.classList.add('open');
            }
            initAIReviewComboboxes(renderTarget);
            safeCreateIcons(renderTarget);
        }
    } else {
        // Desktop 3-pane
        // Auto-pick selectedClientName if absent or stale
        if (!selectedClientName || !groups[selectedClientName]) {
            selectedClientName = Object.entries(groups).find(([, ci]) => ci.some(i => (i.review_status || 'pending') === 'pending'))?.[0]
                || Object.keys(groups)[0]
                || null;
        }

        // Pane 1: client rows go into the scrollable list (toolbar stays pinned above, untouched)
        let listHtml = '';
        for (const [clientName, clientItems] of Object.entries(groups)) {
            listHtml += buildClientListRowHtml(clientName, clientItems, clientName === selectedClientName);
        }
        if (renderTarget) {
            renderTarget.innerHTML = listHtml;
            safeCreateIcons(renderTarget);
        }

        // Pane 2: selected client — DL-334 thin-row cockpit (mobile path above keeps accordion).
        if (docsPane) {
            if (selectedClientName && groups[selectedClientName]) {
                docsPane.innerHTML = buildDesktopClientDocsHtml(selectedClientName, groups[selectedClientName]);
                initAIReviewComboboxes(docsPane);
                safeCreateIcons(docsPane);
                // Re-apply .active row if the previously-active item is still in the list.
                const activeId = window.activePreviewItemId;
                if (activeId && groups[selectedClientName].some(i => String(i.id) === String(activeId))) {
                    const row = docsPane.querySelector(`.ai-doc-row[data-id="${CSS.escape(String(activeId))}"]`);
                    if (row) row.classList.add('active');
                }
            } else {
                docsPane.innerHTML = `<div class="ai-docs-placeholder">${icon('users', 'icon-2xl')}<p>בחר לקוח כדי להציג את המסמכים</p></div>`;
                safeCreateIcons(docsPane);
            }
        }
    }

    // DL-306: deep-link from PA banner — auto-select matching client once per page load
    if (!window.__dl306DeepLinkHandled) {
        try {
            const deepLinkClient = new URLSearchParams(window.location.search).get('client');
            if (deepLinkClient) {
                // The deep-link param is a client_id; map to client_name
                const match = allItems.find(i => i.client_id === deepLinkClient);
                const deepClientName = match?.client_name;
                if (deepClientName && groups[deepClientName]) {
                    window.__dl306DeepLinkHandled = true;
                    if (isMobile) {
                        const target = clientsPane?.querySelector(`.ai-accordion[data-client-id="${CSS.escape(deepLinkClient)}"]`);
                        if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            if (!target.classList.contains('open')) {
                                const header = target.querySelector('.ai-accordion-header');
                                if (header) toggleAIAccordion(header);
                            }
                        }
                    } else {
                        selectClient(deepClientName);
                        const row = clientsPane?.querySelector(`.ai-client-row[data-client-id="${CSS.escape(deepLinkClient)}"]`);
                        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            }
        } catch (e) { /* no-op */ }
    }

    // DL-210: review-done prompt when all client items are reviewed
    for (const [clientName, clientItems] of Object.entries(groups)) {
        const pendingLeft = clientItems.filter(i => (i.review_status || 'pending') === 'pending').length;
        if (pendingLeft === 0 && clientItems.length > 0) {
            showClientReviewDonePrompt(clientName);
        }
    }
}

// DL-271: Append rental contract period to display name
// DL-271: Format period label as MM.YYYY-MM.YYYY
function formatPeriodLabel(startMonth, endMonth, year) {
    const s = String(startMonth).padStart(2, '0');
    const e = String(endMonth).padStart(2, '0');
    return `${s}.${year}-${e}.${year}`;
}

function appendContractPeriod(name, item) {
    if (!['T901', 'T902'].includes(item.matched_template_id) || !item.contract_period) return name;
    const cp = item.contract_period;
    if (cp.coversFullYear) return name;
    const startM = String(new Date(cp.startDate).getMonth() + 1).padStart(2, '0');
    const endM = String(new Date(cp.endDate).getMonth() + 1).padStart(2, '0');
    const year = item.year || new Date(cp.endDate).getFullYear();
    return `${name} ${formatPeriodLabel(parseInt(startM), parseInt(endM), year)}`;
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
        ${icon('eye', 'icon-sm')} תצוגה מקדימה
    </button>`;

    // DL-320: decorative "?" robot help icon removed per NN/G tooltip guidelines
    let classificationHtml = '';
    let actionsHtml = '';

    if (state === 'full') {
        // State A: Full match — green border, short name from API
        const docDisplayName = appendContractPeriod(item.matched_short_name || item.matched_template_name || 'לא ידוע', item);
        classificationHtml = `
            <span class="ai-classification-type">
                <span class="ai-confidence-prefix">🤖 AI חושב שזה:</span>
                <span class="ai-template-match">${renderDocLabel(docDisplayName)}</span>
            </span>
        `;
        const approveDisabled = item.is_unrequested;
        const addToRequired = item.is_unrequested && !!item.matched_template_id;
        actionsHtml = `
            <button class="btn btn-success btn-sm" ${addToRequired
                ? `onclick="approveAIClassificationAddRequired('${escapeAttr(item.id)}', '${escapeAttr(item.matched_template_id)}')"`
                : approveDisabled
                    ? 'aria-disabled="true" title="לא ניתן לאשר מסמך שלא נדרש — יש לשייך מחדש או לדחות"'
                    : `onclick="approveAIClassification('${escapeAttr(item.id)}')"`}>
                ${icon('check', 'icon-sm')} ${addToRequired ? 'נכון - הוסף מסמך זה לרשימת המסמכים הדרושים' : 'נכון'}
            </button>
            <button class="btn btn-link btn-sm" onclick="showAIReassignModal('${escapeAttr(item.id)}')">
                ${icon('arrow-right-left', 'icon-sm')} לא נכון, שייך מחדש
            </button>
            <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                ${icon('x', 'icon-sm')} מסמך לא רלוונטי
            </button>
        `;

    } else if (state === 'issuer-mismatch') {
        // State B: Issuer mismatch — amber border, type + badge, issuer info, validation area
        const templateName = appendContractPeriod(item.matched_short_name || item.matched_template_name || item.matched_template_id || '', item);
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
                    ${icon('check', 'icon-sm')} אישור ושיוך
                </button>
                <button class="btn btn-link btn-sm" onclick="showAIReassignModal('${escapeAttr(item.id)}')">
                    ${icon('arrow-right-left', 'icon-sm')} לא מצאתי ברשימה
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                    ${icon('x', 'icon-sm')} מסמך לא רלוונטי
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
                        ${icon('check', 'icon-sm')} שייך
                    </button>
                </div>
                <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                    ${icon('x', 'icon-sm')} מסמך לא רלוונטי
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
        const docDisplayName = appendContractPeriod(item.matched_short_name || item.matched_template_name || 'לא ידוע', item);
        classificationHtml = `
            <span class="ai-classification-type">
                <span class="ai-confidence-prefix">🤖 AI חושב שזה:</span>
                <span class="ai-template-match">${renderDocLabel(docDisplayName)}</span>
            </span>
        `;
        const fuzzyApproveDisabled = item.is_unrequested;
        const fuzzyAddToRequired = item.is_unrequested && !!item.matched_template_id;
        actionsHtml = `
            <button class="btn btn-success btn-sm" ${fuzzyAddToRequired
                ? `onclick="approveAIClassificationAddRequired('${escapeAttr(item.id)}', '${escapeAttr(item.matched_template_id)}')"`
                : fuzzyApproveDisabled
                    ? 'aria-disabled="true" title="לא ניתן לאשר מסמך שלא נדרש — יש לשייך מחדש או לדחות"'
                    : `onclick="approveAIClassification('${escapeAttr(item.id)}')"`}>
                ${icon('check', 'icon-sm')} ${fuzzyAddToRequired ? 'נכון - הוסף מסמך זה לרשימת המסמכים הדרושים' : 'נכון'}
            </button>
            <button class="btn btn-link btn-sm" onclick="showAIReassignModal('${escapeAttr(item.id)}')">
                ${icon('arrow-right-left', 'icon-sm')} לא נכון, שייך מחדש
            </button>
            <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                ${icon('x', 'icon-sm')} מסמך לא רלוונטי
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
                    ${icon('check', 'icon-sm')} שייך
                </button>
            </div>
            <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                ${icon('x', 'icon-sm')} מסמך לא רלוונטי
            </button>
        `;
    }

    // DL-237: Split banner for multi-page PDFs — own row above actions
    const splitBannerHtml = (item.page_count && item.page_count >= 2) ? `
            <div class="ai-split-banner">
                <button class="btn btn-outline btn-sm ai-split-btn"
                    onclick="event.stopPropagation(); openSplitModal('${escapeAttr(item.id)}')"
                    title="פיצול PDF — ${item.page_count} עמודים">
                    ${icon('scissors', 'icon-sm')} פיצול PDF
                </button>
            </div>` : '';

    // DL-269/270: Contract period banner for T901/T902 — editable dates
    let contractPeriodBannerHtml = '';
    if (['T901', 'T902'].includes(item.matched_template_id)) {
        const cp = item.contract_period;
        const rid = escapeAttr(item.id);
        const year = item.year || new Date().getFullYear();

        if (cp && cp.coversFullYear) {
            // Full year — info only
            contractPeriodBannerHtml = `
            <div class="ai-contract-period-banner" style="background:#f0fdf4;border-color:#22c55e33;color:#166534;">
                <span class="period-label">📅 חוזה שנתי מלא ✓</span>
            </div>`;
        } else {
            // Partial or no dates — editable
            const hasStart = cp && cp.startDate;
            const hasEnd = cp && cp.endDate;
            const startMonth = hasStart ? new Date(cp.startDate).getMonth() + 1 : null;
            const endMonth = hasEnd ? new Date(cp.endDate).getMonth() + 1 : null;
            const startVal = hasStart ? cp.startDate.substring(0, 7) : ''; // YYYY-MM for input
            const endVal = hasEnd ? cp.endDate.substring(0, 7) : '';
            const startLabel = startMonth ? `${String(startMonth).padStart(2,'0')}.${year}` : '__.__';
            const endLabel = endMonth ? `${String(endMonth).padStart(2,'0')}.${year}` : '__.__';
            const statusText = cp ? 'חוזה חלקי' : 'לא זוהו תאריכים';

            // Missing period calculation — check gaps before start AND after end
            let requestBtnsHtml = '';
            if (startMonth && startMonth > 1) {
                const beforeLabel = formatPeriodLabel(1, startMonth - 1, year);
                requestBtnsHtml += `
                <button class="btn btn-outline btn-sm btn-request-period" data-record-id="${rid}" data-gap="before"
                    onclick="event.stopPropagation(); requestMissingPeriod('${rid}', 1, ${startMonth - 1}, this)"
                    title="בקש חוזה לתקופה שלפני">
                    ${icon('plus', 'icon-sm')} בקש חוזה ${beforeLabel}
                </button>`;
            }
            if (endMonth && endMonth < 12) {
                const afterLabel = formatPeriodLabel(endMonth + 1, 12, year);
                requestBtnsHtml += `
                <button class="btn btn-outline btn-sm btn-request-period" data-record-id="${rid}" data-gap="after"
                    onclick="event.stopPropagation(); requestMissingPeriod('${rid}', ${endMonth + 1}, 12, this)"
                    title="בקש חוזה לתקופה שאחרי">
                    ${icon('plus', 'icon-sm')} בקש חוזה ${afterLabel}
                </button>`;
            }

            contractPeriodBannerHtml = `
            <div class="ai-contract-period-banner" data-record-id="${rid}">
                <span class="period-label">📅 ${statusText}:
                    מ
                    <span class="contract-date-editable" data-field="start" data-value="${escapeAttr(startVal)}"
                        onclick="event.stopPropagation(); editContractDate('${rid}', 'start', this)"
                        title="לחץ לעריכה">${startLabel}</span>
                    עד
                    <span class="contract-date-editable" data-field="end" data-value="${escapeAttr(endVal)}"
                        onclick="event.stopPropagation(); editContractDate('${rid}', 'end', this)"
                        title="לחץ לעריכה">${endLabel}</span>
                </span>
                ${requestBtnsHtml}
            </div>`;
        }
    }

    return `
        <div class="ai-review-card ${cardClass}" data-id="${escapeAttr(item.id)}" ${item.is_unrequested ? 'data-unrequested="true"' : ''}>
            <div class="ai-card-top" onclick="loadDocPreview('${escapeAttr(item.id)}')">
                <div class="ai-file-info">
                    <span class="ai-file-source-label">📎 קובץ מקור:</span>
                    <span class="ai-file-name clickable-preview" ${senderTooltip ? `title="${escapeAttr(senderTooltip)}"` : ''}>${escapeHtml(item.attachment_name || 'ללא שם')}</span>
                    ${item.filing_type ? `<span class="ai-filing-type-badge ai-ft-${escapeAttr(item.filing_type)}">${escapeHtml(FILING_TYPE_LABELS[item.filing_type] || item.filing_type)}</span>` : ''}
                    ${item.is_duplicate ? '<span class="ai-duplicate-badge" title="קובץ כפול — אותו קובץ כבר קיים במערכת">כפול</span>' : ''}
                    ${item.is_unrequested && !item.pre_questionnaire ? '<span class="ai-unrequested-badge" title="מסמך שלא נדרש מהלקוח">לא נדרש</span>' : ''}
                    ${item.pre_questionnaire ? '<span class="ai-pre-questionnaire-badge" title="הלקוח טרם מילא את השאלון — הסיווג בוצע מול הקטלוג המלא">טרם מולא שאלון</span>' : ''}
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
            ${contractPeriodBannerHtml}
            ${item.pending_question ? `<div class="batch-q-inline-badge" style="margin:0 var(--sp-5) var(--sp-2)">${icon('message-circle','icon-xs')} שאלה נשמרה: ${escapeHtml(item.pending_question.substring(0,80))}${item.pending_question.length>80?'…':''}</div>` : ''}
            <div class="ai-card-actions">
                ${actionsHtml}
                <div class="row-overflow-dropdown">
                    <button class="action-btn overflow" onclick="toggleRowMenu(this, event)" title="פעולות נוספות">⋮</button>
                    <div class="row-menu">
                        <button onclick="closeAllRowMenus(); openAddQuestionDialog('${escapeAttr(item.id)}')">${icon('message-circle', 'icon-sm')} ${item.pending_question ? 'ערוך שאלה' : 'הוסף שאלה'}</button>
                    </div>
                </div>
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
        ${icon('eye', 'icon-sm')} תצוגה מקדימה
    </button>`;

    // DL-335: on_hold renders its own special card layout — early return
    if (reviewStatus === 'on_hold') {
        return renderOnHoldCard(item);
    }

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

    // Classification info — use API-resolved short name + period.
    // For rejected: fall back to filename (the match was dismissed).
    // For reassigned: look up the new target doc (shares onedrive_item_id) and show its name.
    let displayName;
    if (reviewStatus === 'rejected') {
        displayName = item.attachment_name || item.matched_short_name || item.matched_template_name || 'לא ידוע';
    } else if (reviewStatus === 'reassigned') {
        const siblings = [...(item.all_docs || []), ...(item.other_report_docs || [])];
        const target = item.onedrive_item_id
            ? siblings.find(d => d.onedrive_item_id === item.onedrive_item_id && d.status === 'Received')
            : null;
        const targetName = target?.name_short || target?.name;
        displayName = appendContractPeriod(
            targetName || item.matched_short_name || item.matched_template_name || item.attachment_name || 'לא ידוע',
            item
        );
    } else {
        displayName = appendContractPeriod(item.matched_short_name || item.matched_template_name || 'לא ידוע', item);
    }

    // DL-271: Request missing period buttons on reviewed rental contract cards
    let reviewedPeriodBtns = '';
    if (['T901', 'T902'].includes(item.matched_template_id) && item.contract_period && !item.contract_period.coversFullYear) {
        const cp = item.contract_period;
        const rid = escapeAttr(item.id);
        const startMonth = new Date(cp.startDate).getMonth() + 1;
        const endMonth = new Date(cp.endDate).getMonth() + 1;
        const year = item.year || new Date(cp.endDate).getFullYear();
        let btns = '';
        if (startMonth > 1) {
            btns += `<button class="btn btn-outline btn-sm btn-request-period" data-record-id="${rid}" onclick="event.stopPropagation(); requestMissingPeriod('${rid}', 1, ${startMonth - 1}, this)">${icon('plus', 'icon-sm')} בקש חוזה ${formatPeriodLabel(1, startMonth - 1, year)}</button>`;
        }
        if (endMonth < 12) {
            btns += `<button class="btn btn-outline btn-sm btn-request-period" data-record-id="${rid}" onclick="event.stopPropagation(); requestMissingPeriod('${rid}', ${endMonth + 1}, 12, this)">${icon('plus', 'icon-sm')} בקש חוזה ${formatPeriodLabel(endMonth + 1, 12, year)}</button>`;
        }
        if (btns) {
            reviewedPeriodBtns = `<div class="ai-contract-period-banner" data-record-id="${rid}">${btns}</div>`;
        }
    }

    // DL-320: post-approve "הקובץ תואם למסמך נוסף" button — multi-match entry point
    // (moved from pre-approve cards; reuses DL-314 showAIAlsoMatchModal as-is)
    const isApproved = reviewStatus === 'approved';


    const alsoMatchBtn = isApproved
        ? `<button class="btn btn-outline btn-sm ai-also-match-btn" onclick="showAIAlsoMatchModal('${escapeAttr(item.id)}')">
               ${icon('copy-plus', 'icon-sm')} הקובץ תואם למסמך נוסף
           </button>`
        : '';

    // Change Decision button — all reviewed cards can be re-reviewed (reassign safe via onedrive_item_id)
    const canChangeDecision = true;
    const actionsHtml = canChangeDecision
        ? `${alsoMatchBtn}
           <button class="ai-change-decision-btn" onclick="startReReview('${escapeAttr(item.id)}')">
               ${icon('rotate-ccw', 'icon-sm')} שנה החלטה
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
            ${reviewedPeriodBtns}
            <div class="ai-card-actions">
                <div class="row-overflow-dropdown">
                    <button class="action-btn overflow" onclick="toggleRowMenu(this, event)" title="פעולות נוספות">⋮</button>
                    <div class="row-menu">
                        ${canChangeDecision ? `<button onclick="closeAllRowMenus(); startReReview('${escapeAttr(item.id)}')">${icon('rotate-ccw', 'icon-sm')} שנה החלטה</button>` : ''}
                        ${isApproved ? `<button onclick="closeAllRowMenus(); showAIAlsoMatchModal('${escapeAttr(item.id)}')">${icon('copy-plus', 'icon-sm')} הקובץ תואם למסמך נוסף</button>` : ''}
                        <button onclick="closeAllRowMenus(); openAddQuestionDialog('${escapeAttr(item.id)}')">${icon('message-circle', 'icon-sm')} ${item.pending_question ? 'ערוך שאלה' : 'הוסף שאלה'}</button>
                    </div>
                </div>
                ${item.pending_question ? `<div class="batch-q-inline-badge">${icon('message-circle','icon-xs')} שאלה נשמרה: ${escapeHtml(item.pending_question.substring(0, 80))}${item.pending_question.length > 80 ? '…' : ''}</div>` : ''}
            </div>
        </div>
    `;
}

// DL-335: Render a card in on_hold (waiting for client reply) state
function renderOnHoldCard(item) {
    const senderEmail = item.sender_email || '';
    const receivedAt = item.received_at ? formatAIDate(item.received_at) : '';
    const senderTooltipParts = [senderEmail, receivedAt].filter(Boolean);
    const senderTooltip = senderTooltipParts.join(' | ');

    const viewFileBtn = `<button class="btn btn-ghost btn-sm ai-preview-btn"
        onclick="event.stopPropagation(); loadDocPreview('${escapeAttr(item.id)}')"
        title="תצוגה מקדימה">
        ${icon('eye', 'icon-sm')} תצוגה מקדימה
    </button>`;

    const displayName = appendContractPeriod(item.matched_short_name || item.matched_template_name || 'לא ידוע', item);

    // Resolve question-sent date: prefer reviewed_at, fallback to batch_questions_sent entry in client_notes
    let questionSentDate = item.reviewed_at || null;
    let clientReplyHtml = '';
    if (item.client_notes) {
        let cnArr = [];
        try {
            cnArr = JSON.parse(item.client_notes.replace(/[\n\r\t]/g, m => m === '\n' ? '\\n' : m === '\r' ? '\\r' : '\\t'));
            if (!Array.isArray(cnArr)) cnArr = [];
        } catch(e) {}
        const bqEntry = cnArr.find(n => n.type === 'batch_questions_sent' &&
            Array.isArray(n.items) && n.items.some(i => i.attachment_name === item.attachment_name));
        if (bqEntry?.date && !questionSentDate) questionSentDate = bqEntry.date;
        // Most recent inbound reply after the question was sent
        const replies = cnArr.filter(n =>
            n.source === 'email' &&
            n.type !== 'batch_questions_sent' &&
            n.type !== 'office_reply' &&
            (!questionSentDate || (n.date || '') > questionSentDate)
        ).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        if (replies.length > 0) {
            const r = replies[0];
            const rDate = r.date ? ` (${formatAIDate(r.date)})` : '';
            clientReplyHtml = `<div class="ai-held-reply">
                <div class="ai-held-reply-label">${icon('mail', 'icon-xs')} תגובת הלקוח${rDate}:</div>
                <div class="ai-held-reply-text">${escapeHtml(r.raw_snippet || r.summary || '')}</div>
            </div>`;
        }
    }

    const sentDateStr = questionSentDate ? ` בתאריך ${formatAIDate(questionSentDate)}` : '';
    const heldQuestionHtml = item.pending_question
        ? `<div class="ai-held-question">
            <div class="ai-held-question-label">${icon('message-circle', 'icon-xs')} שאלה שנשלחה ללקוח${sentDateStr}:</div>
            ${escapeHtml(item.pending_question)}
          </div>${clientReplyHtml}`
        : '';

    return `
        <div class="ai-review-card reviewed-on-hold" data-id="${escapeAttr(item.id)}" data-review-status="on_hold">
            <div class="ai-card-top" onclick="loadDocPreview('${escapeAttr(item.id)}');">
                <div class="ai-file-info">
                    <span class="ai-review-lozenge lozenge-on-hold">${icon('clock', 'icon-xs')} ממתין ללקוח</span>
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
                ${heldQuestionHtml}
            </div>
            <div class="ai-card-actions">
                <button class="btn btn-outline btn-sm" onclick="startReReview('${escapeAttr(item.id)}')">
                    ${icon('check-circle', 'icon-xs')} סיים המתנה — טפל במסמך
                </button>
            </div>
        </div>
    `;
}

// DL-086: Re-review — restore action buttons on a reviewed card
function startReReview(recordId) {
    const item = aiClassificationsData.find(i => i.id === recordId);
    if (!item) return;

    // DL-320: cascade revert when this file is linked to other doc records (DL-314 multi-match).
    // Changing the primary decision should also clear all sibling records that were linked to this file.
    const sharedCount = (item.shared_ref_count | 0);
    if (sharedCount > 1) {
        const ownDocId = item.matched_doc_record_id || '';
        const titles = Array.isArray(item.shared_with_titles)
            ? item.shared_with_titles.filter(t => t && t !== (item.issuer_name || item.matched_short_name || ''))
            : [];
        const extra = sharedCount - 1;
        const titlesStr = titles.length ? `: ${titles.join(', ')}` : '';
        const msg = `שינוי ההחלטה יסיר גם ${extra} קישורים נוספים${titlesStr}. להמשיך?`;
        showConfirmDialog(msg, () => { cascadeRevertAIClassification(recordId); }, 'המשך ונקה', true);
        return;
    }

    // DL-334: Desktop path — flip _aiReReviewing + re-render via cockpit actions panel.
    // (Desktop-or-mobile-targetable: desktop short-circuit; mobile falls through below.)
    if (!isAIReviewMobileLayout()) {
        _aiReReviewing.add(recordId);
        refreshItemDom(item);
        return;
    }

    // DL-334 mobile-only path follows.
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
                ${icon('check', 'icon-sm')} נכון
            </button>
            <button class="btn btn-link btn-sm" onclick="showAIReassignModal('${escapeAttr(recordId)}')">
                ${icon('arrow-right-left', 'icon-sm')} לא נכון, שייך מחדש
            </button>
            <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(recordId)}')">
                ${icon('x', 'icon-sm')} מסמך לא רלוונטי
            </button>
            <button class="btn btn-ghost btn-sm" onclick="cancelReReview('${escapeAttr(recordId)}')">
                ביטול
            </button>
        `;
    } else {
        // unmatched or issuer-mismatch — show reject + reassign
        actionsHtml = `
            <button class="btn btn-link btn-sm" onclick="showAIReassignModal('${escapeAttr(recordId)}')">
                ${icon('arrow-right-left', 'icon-sm')} לא נכון, שייך מחדש
            </button>
            <button class="btn btn-outline-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(recordId)}')">
                ${icon('x', 'icon-sm')} מסמך לא רלוונטי
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

// DL-320: Cascade revert — clear primary + all sibling records sharing the same OneDrive file,
// archive the file, and reset the classification to pending so admin can re-decide fresh.
async function cascadeRevertAIClassification(recordId) {
    setCardLoading(recordId, 'מנקה קישורים ומאפס...');
    try {
        const response = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: recordId,
                action: 'revert_cascade'
            })
        }, FETCH_TIMEOUTS.mutate);

        const data = await parseAIResponse(response);
        clearCardLoading(recordId);
        if (!data.ok) throw new Error(formatAIResponseError(data));

        const clearedCount = Array.isArray(data.cleared_doc_ids) ? data.cleared_doc_ids.length : 0;
        showAIToast(`נוקו ${clearedCount} רשומות. ניתן להחליט מחדש.`, 'success');
        // Force full reload — siblings across the page also changed
        aiReviewLoadedAt = 0;
        loadAIClassifications(true, false);
    } catch (error) {
        clearCardLoading(recordId);
        showModal('error', 'שגיאה', humanizeError(error));
    }
}

// DL-086: Cancel re-review — re-render the card in reviewed state
function cancelReReview(recordId) {
    const item = aiClassificationsData.find(i => i.id === recordId);
    if (!item) return;

    // DL-334: Desktop path — clear re-review flag + re-render via cockpit.
    // (Desktop-or-mobile-targetable: desktop short-circuit; mobile falls through.)
    if (!isAIReviewMobileLayout()) {
        _aiReReviewing.delete(recordId);
        refreshItemDom(item);
        return;
    }

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

    // Close all other accordions — only one open at a time (scoped to whichever pane the accordion lives in)
    const scope = accordion.closest('#aiClientsPane, #aiDocsPane') || document;
    scope.querySelectorAll('.ai-accordion.open').forEach(el => el.classList.remove('open'));

    // Toggle the clicked one (re-open if it wasn't already open)
    if (!isOpen) {
        accordion.classList.add('open');
        // DL-278: scroll after previous accordion finishes collapsing (300ms transition)
        // so the layout has settled and scroll position is accurate
        setTimeout(() => accordion.scrollIntoView({ behavior: 'smooth', block: 'start' }), 320);
    }
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
    // DL-334: Desktop-or-mobile-targetable — overlay on actions panel primary-actions on desktop,
    // whole-card overlay on mobile fat card.
    if (!isAIReviewMobileLayout()) {
        showPanelLoading(recordId, true, text);
        return;
    }
    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (!card) return;
    card.classList.add('ai-loading');
    const overlay = document.createElement('div');
    overlay.className = 'ai-card-loading-overlay';
    overlay.innerHTML = `<div class="spinner"></div><span>${text || 'מעבד...'}</span>`;
    card.appendChild(overlay);
}

function clearCardLoading(recordId) {
    // DL-334: Desktop-or-mobile-targetable.
    if (!isAIReviewMobileLayout()) {
        showPanelLoading(recordId, false);
        return;
    }
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
            showModal('error', 'שגיאה', humanizeError(error));
        }
    }, { confirmText: 'נכון', btnClass: 'btn-success' });
}

// DL-319: Approve unrequested doc and atomically create the required-doc row
async function approveAIClassificationAddRequired(recordId, templateId) {
    showInlineConfirm(recordId, 'לאשר ולהוסיף לרשימת המסמכים הדרושים?', async () => {
        setCardLoading(recordId, 'מאשר ומוסיף לרשימה...');

        try {
            const response = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: authToken,
                    classification_id: recordId,
                    action: 'approve',
                    create_if_missing: true,
                    template_id: templateId
                })
            }, FETCH_TIMEOUTS.mutate);

            const data = await parseAIResponse(response);
            clearCardLoading(recordId);

            // Same conflict handling as approveAIClassification (DL-222)
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
            const resolvedDocId = data.doc_id || approvedItem?.matched_doc_record_id;
            if (resolvedDocId && approvedItem) {
                updateClientDocState(approvedItem.client_name, resolvedDocId);
            }
            transitionCardToReviewed(recordId, 'approved', data);
            showAIToast(formatAISuccessToast(data), 'success');
        } catch (error) {
            clearCardLoading(recordId);
            showModal('error', 'שגיאה', humanizeError(error));
        }
    }, { confirmText: 'נכון - הוסף', btnClass: 'btn-success' });
}

// DL-270: Inline click-to-edit contract period dates
function editContractDate(recordId, field, el) {
    if (el.querySelector('input')) return; // already editing
    const currentVal = el.dataset.value || '';
    const input = document.createElement('input');
    input.type = 'month';
    input.value = currentVal;
    input.className = 'contract-date-input';
    input.onclick = (e) => e.stopPropagation();

    const finishEdit = () => {
        const newVal = input.value; // YYYY-MM
        if (!newVal) {
            // Cancelled — restore original text
            el.textContent = currentVal ? `${new Date(currentVal + '-01').getMonth() + 1}/${new Date(currentVal + '-01').getFullYear()}` : '__/__';
            return;
        }
        el.dataset.value = newVal;
        const m = new Date(newVal + '-01').getMonth() + 1;
        const y = new Date(newVal + '-01').getFullYear();
        el.textContent = `${m}/${y}`;

        // Get both dates from the banner
        const banner = el.closest('.ai-contract-period-banner');
        if (!banner) return;
        const spans = banner.querySelectorAll('.contract-date-editable');
        const startSpan = [...spans].find(s => s.dataset.field === 'start');
        const endSpan = [...spans].find(s => s.dataset.field === 'end');
        const startVal = startSpan?.dataset.value || '';
        const endVal = endSpan?.dataset.value || '';

        if (startVal && endVal) {
            saveContractPeriod(recordId, startVal + '-01', endVal + '-28'); // day doesn't matter much, backend uses month
        }
    };

    input.addEventListener('change', finishEdit);
    input.addEventListener('blur', () => { if (!input.value && !currentVal) el.textContent = '__/__'; });
    el.textContent = '';
    el.appendChild(input);
    input.focus();
}

async function saveContractPeriod(recordId, startDate, endDate) {
    try {
        // Normalize end date to last day of month
        const endD = new Date(endDate);
        const lastDay = new Date(endD.getFullYear(), endD.getMonth() + 1, 0).getDate();
        const normalizedEnd = `${endDate.substring(0, 8)}${String(lastDay).padStart(2, '0')}`;

        const response = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: recordId,
                action: 'update-contract-period',
                start_date: startDate,
                end_date: normalizedEnd
            })
        }, FETCH_TIMEOUTS.mutate);

        const data = await response.json();
        if (!data.ok) {
            showAIToast(data.error || 'שגיאה בעדכון תאריכים', 'error');
            return;
        }

        // Update local data
        const item = aiClassificationsData.find(i => i.id === recordId);
        if (item) item.contract_period = data.contract_period;

        // Recalculate request button
        const banner = document.querySelector(`.ai-contract-period-banner[data-record-id="${recordId}"]`);
        if (banner && data.contract_period) {
            const cp = data.contract_period;
            const endMonth = new Date(cp.endDate).getMonth() + 1;
            const year = item?.year || new Date(cp.endDate).getFullYear();
            const existingBtn = banner.querySelector('.btn-request-period');

            if (cp.coversFullYear) {
                // Switch to full-year style
                banner.style.background = '#f0fdf4';
                banner.style.borderColor = '#22c55e33';
                banner.style.color = '#166534';
                banner.querySelector('.period-label').textContent = '📅 חוזה שנתי מלא ✓';
                if (existingBtn) existingBtn.remove();
            } else if (endMonth < 12) {
                const missingLabel = `${endMonth + 1}-12/${year}`;
                if (existingBtn) {
                    existingBtn.innerHTML = `${icon('plus', 'icon-sm')} בקש חוזה ${missingLabel}`;
                    existingBtn.disabled = false;
                    safeCreateIcons();
                } else {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-outline btn-sm btn-request-period';
                    btn.dataset.recordId = recordId;
                    btn.onclick = (e) => { e.stopPropagation(); requestRemainingContract(recordId, btn); };
                    btn.innerHTML = `${icon('plus', 'icon-sm')} בקש חוזה ${missingLabel}`;
                    banner.appendChild(btn);
                    safeCreateIcons();
                }
            } else if (existingBtn) {
                existingBtn.remove();
            }
        }

        showAIToast('תאריכי חוזה עודכנו', 'success');
    } catch (error) {
        showAIToast(error.message, 'error');
    }
}

// DL-269/271: Request missing contract period (before or after)
async function requestMissingPeriod(recordId, startMonth, endMonth, btn) {
    try {
        if (btn) { btn.disabled = true; btn.innerHTML = `${icon('loader', 'icon-sm spin')} מבקש...`; safeCreateIcons(); }

        const response = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: recordId,
                action: 'request-remaining-contract',
                missing_start_month: startMonth,
                missing_end_month: endMonth
            })
        }, FETCH_TIMEOUTS.mutate);

        const data = await response.json();
        if (!data.ok) {
            if (btn) { btn.disabled = false; btn.innerHTML = `${icon('plus', 'icon-sm')} בקש חוזה`; safeCreateIcons(); }
            showModal('error', 'שגיאה', data.error || 'Unknown error');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `${icon('check', 'icon-sm')} נוסף`;
            btn.classList.remove('btn-outline');
            btn.classList.add('btn-success');
            safeCreateIcons();
        }
        showAIToast(`נוסף מסמך חסר: חוזה שכירות ${data.period_label}`, 'success');
    } catch (error) {
        if (btn) { btn.disabled = false; btn.innerHTML = `${icon('plus', 'icon-sm')} בקש חוזה`; safeCreateIcons(); }
        showModal('error', 'שגיאה', humanizeError(error));
    }
}
// Backwards compat
function requestRemainingContract(recordId, btn) { requestMissingPeriod(recordId, null, null, btn); }

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
        showModal('error', 'שגיאה', humanizeError(error));
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
        showModal('error', 'שגיאה', humanizeError(error));
    }
}

async function rejectAIClassification(recordId) {
    // DL-334: desktop uses cockpit actions panel; mobile falls through to fat-card flow.
    if (!isAIReviewMobileLayout()) {
        if (showPanelRejectNotes(recordId)) return;
    }
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
        showModal('error', 'שגיאה', humanizeError(error));
    }
}

// DL-239: Track selected report for cross-filing-type reassign
let aiReassignSelectedReportId = null;
let _aiReassignExpandedTarget = null;

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
        fileInfoEl.innerHTML = `${icon('file', 'icon-sm')} ${escapeHtml(item.attachment_name || 'ללא שם')}`;
    } else {
        fileInfoEl.textContent = '';
    }

    // DL-239: Hide external toggle (now inside combobox dropdown)
    const toggleContainer = document.getElementById('aiReassignFtToggle');
    if (toggleContainer) { toggleContainer.style.display = 'none'; toggleContainer.innerHTML = ''; }

    const comboContainer = document.getElementById('aiReassignComboboxContainer');
    const currentMatchId = item ? item.matched_template_id : null;

    _aiReassignExpandedTarget = null;
    document.getElementById('aiReassignConfirmBtn').disabled = true;
    createDocCombobox(comboContainer, ownDocs, {
        currentMatchId,
        allowCreate: true,
        onSelect: (templateId) => {
            _aiReassignExpandedTarget = null;
            const expandedPicker = document.getElementById('aiReassignExpandedPicker');
            if (expandedPicker) { expandedPicker.style.display = 'none'; expandedPicker.innerHTML = ''; }
            document.getElementById('aiReassignConfirmBtn').disabled = !templateId;
        },
        onExpand: () => {
            _aiReassignExpandedTarget = null;
            const picker = document.getElementById('aiReassignExpandedPicker');
            if (!picker) return;
            picker.style.display = '';
            _buildDocTemplatePicker(picker, item, {
                onPick: (target) => {
                    _aiReassignExpandedTarget = target;
                    document.getElementById('aiReassignConfirmBtn').disabled = !target;
                },
            });
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
    const expandedPicker = document.getElementById('aiReassignExpandedPicker');
    if (expandedPicker) { expandedPicker.style.display = 'none'; expandedPicker.innerHTML = ''; }
    _aiReassignExpandedTarget = null;
    aiCurrentReassignId = null;
}

async function confirmAIReassign() {
    if (!aiCurrentReassignId) return;
    const recordId = aiCurrentReassignId;
    const item = aiClassificationsData.find(i => i.id === recordId);

    // DL-336: If user picked from the expanded template picker, use that
    if (_aiReassignExpandedTarget) {
        const t = _aiReassignExpandedTarget;
        closeAIReassignModal();
        await submitAIReassign(recordId, t.template_id, t.doc_record_id || '', null, t.new_doc_name || '', false, null);
        return;
    }

    const combobox = document.querySelector('#aiReassignComboboxContainer .doc-combobox');
    const templateId = combobox ? combobox.dataset.selectedValue : '';
    const docRecordId = combobox ? combobox.dataset.selectedDocId : '';
    const newDocName = combobox ? (combobox.dataset.newDocName || '') : '';
    if (!templateId) return;

    // DL-239: Capture selected report ID for cross-type reassign before closing
    const selectedReportId = aiReassignSelectedReportId;
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
        showModal('error', 'שגיאה', humanizeError(error));
    }
}

// =============================================================================
// DL-314: Multi-template match ("גם תואם ל...")
// =============================================================================
// One AI Review file → N doc records. Admin picks additional templates via a
// checkbox modal. POSTs action='also_match' with additional_targets[].
// Server shares one onedrive_item_id across all target records.

// DL-336: Reusable template picker (search + categories + variable wizard + chip feedback).
// Uses container-relative selectors to avoid conflicts with PA picker (which uses global IDs).
function _buildDocTemplatePicker(container, item, opts) {
    const onPick = opts && opts.onPick ? opts.onPick : () => {};

    function renderPick(cached) {
        const filingType = item.filing_type || 'annual_report';
        const relevant = cached.apiTemplates.filter(t => !t.filing_type || t.filing_type === filingType);
        const groups = {};
        for (const tpl of relevant) {
            const cid = tpl.category || 'other';
            if (!groups[cid]) groups[cid] = [];
            groups[cid].push(tpl);
        }
        let listHtml = '';
        for (const cat of cached.apiCategories) {
            const catTpls = groups[cat.id];
            if (!catTpls || catTpls.length === 0) continue;
            const items = catTpls.map(tpl => {
                const display = _paFormatTemplateTitle(tpl, item, null);
                return `<div class="pa-add-doc-option" data-template-id="${escapeAttr(tpl.template_id)}">${escapeHtml(display)}</div>`;
            }).join('');
            listHtml += `<div class="pa-add-doc-cat">${escapeHtml((cat.emoji || '') + ' ' + (cat.name_he || ''))}</div>${items}`;
        }
        if (!listHtml) listHtml = `<div class="pa-add-doc-empty">אין תבניות זמינות</div>`;

        container.innerHTML = `
            <input type="text" class="pa-add-doc-search" placeholder="🔍 חפש מסמך..." dir="rtl" autocomplete="off">
            <div class="pa-add-doc-list" style="max-height:220px;overflow-y:auto;">${listHtml}</div>
            <div class="pa-add-doc-divider">או מסמך מותאם אישית</div>
            <div class="pa-add-doc-custom">
                <input type="text" class="ai-tpl-custom-input" placeholder="שם המסמך..." dir="rtl">
                <button type="button" class="pa-add-doc-custom-btn">${icon('plus', 'icon-xs')} הוסף</button>
            </div>`;
        safeCreateIcons(container);

        const searchEl = container.querySelector('.pa-add-doc-search');
        const listEl = container.querySelector('.pa-add-doc-list');
        searchEl.addEventListener('input', () => {
            const q = searchEl.value.trim().toLowerCase();
            listEl.querySelectorAll('.pa-add-doc-option').forEach(o => {
                o.style.display = (!q || o.textContent.toLowerCase().includes(q)) ? '' : 'none';
            });
            listEl.querySelectorAll('.pa-add-doc-cat').forEach(c => {
                let sib = c.nextElementSibling, hasVisible = false;
                while (sib && !sib.classList.contains('pa-add-doc-cat')) {
                    if (sib.classList.contains('pa-add-doc-option') && sib.style.display !== 'none') { hasVisible = true; break; }
                    sib = sib.nextElementSibling;
                }
                c.style.display = hasVisible ? '' : 'none';
            });
        });

        listEl.querySelectorAll('.pa-add-doc-option').forEach(opt => {
            opt.addEventListener('click', () => pickTemplate(opt.dataset.templateId, cached));
        });

        const customInput = container.querySelector('.ai-tpl-custom-input');
        const customBtn = container.querySelector('.pa-add-doc-custom-btn');
        const submitCustom = () => {
            const name = customInput.value.trim();
            if (!name) { customInput.style.borderColor = 'var(--danger-500)'; customInput.focus(); return; }
            customInput.style.borderColor = '';
            showChip(name, { template_id: 'general_doc', new_doc_name: name });
        };
        customBtn.addEventListener('click', submitCustom);
        customInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitCustom(); } });
    }

    function pickTemplate(templateId, cached) {
        const tpl = cached.apiTemplates.find(t => t.template_id === templateId);
        if (!tpl) return;
        const autoVars = ['year', 'spouse_name'];
        const userVars = (tpl.variables || []).filter(v => !autoVars.includes(v));
        if (userVars.length > 0) {
            renderVars(tpl, userVars, cached);
        } else {
            const display = _paFormatTemplateTitle(tpl, item, {});
            showChip(display, { template_id: tpl.template_id });
        }
    }

    function renderVars(tpl, userVars, cached) {
        const initialTitle = _paFormatTemplateTitle(tpl, item, null);
        const fields = userVars.map(v => {
            const label = _PA_VAR_LABELS[v] || v;
            return `<div class="pa-add-doc-var-row">
                <label>${escapeHtml(label)}</label>
                <input type="text" class="pa-add-doc-var-input" data-var="${escapeAttr(v)}" dir="rtl" placeholder="${escapeHtml(label)}">
            </div>`;
        }).join('');
        container.innerHTML = `
            <div class="pa-add-doc-step-title">${icon('file-text', 'icon-xs')} <span class="ai-tpl-step-title-text">${escapeHtml(initialTitle)}</span></div>
            <div class="pa-add-doc-vars">${fields}</div>
            <div class="pa-add-doc-actions">
                <button type="button" class="btn btn-sm ai-tpl-back-btn">${icon('arrow-right', 'icon-xs')} חזור</button>
                <button type="button" class="btn btn-sm btn-primary ai-tpl-confirm-btn">הבא ${icon('arrow-left', 'icon-xs')}</button>
            </div>`;
        safeCreateIcons(container);
        const inputs = container.querySelectorAll('.pa-add-doc-var-input');
        const titleText = container.querySelector('.ai-tpl-step-title-text');
        const updateTitle = () => {
            const collected = {};
            inputs.forEach(inp => { collected[inp.dataset.var] = inp.value.trim(); });
            if (titleText) titleText.textContent = _paFormatTemplateTitle(tpl, item, collected);
        };
        inputs.forEach((inp, i) => {
            inp.addEventListener('input', updateTitle);
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); if (i < inputs.length - 1) inputs[i + 1].focus(); else confirmVars(); }
            });
        });
        if (inputs.length) setTimeout(() => inputs[0].focus(), 50);
        container.querySelector('.ai-tpl-back-btn').addEventListener('click', () => renderPick(cached));
        container.querySelector('.ai-tpl-confirm-btn').addEventListener('click', confirmVars);
        function confirmVars() {
            const collected = {};
            let missing = null;
            inputs.forEach(inp => {
                const val = inp.value.trim();
                if (!val && !missing) { missing = inp; }
                else { inp.style.borderColor = ''; }
                collected[inp.dataset.var] = val;
            });
            if (missing) { missing.style.borderColor = 'var(--danger-500)'; missing.focus(); return; }
            const { nameHe } = _paResolveTemplateName(tpl, collected, item);
            showChip(nameHe || _paFormatTemplateTitle(tpl, item, collected), { template_id: tpl.template_id, new_doc_name: nameHe });
        }
    }

    function showChip(label, target) {
        container.innerHTML = `
            <div class="ai-picker-chip">
                <span class="ai-picker-chip-label">${escapeHtml(label)}</span>
                <button type="button" class="ai-picker-chip-clear" aria-label="הסר">×</button>
            </div>`;
        container.querySelector('.ai-picker-chip-clear').addEventListener('click', () => {
            onPick(null);
            ensurePaTemplatesLoaded(item.client_id, item.report_record_id, item.filing_type)
                .then(cached => renderPick(cached))
                .catch(() => {});
        });
        onPick(target);
    }

    container.innerHTML = `<div class="pa-add-doc-empty">טוען...</div>`;
    ensurePaTemplatesLoaded(item.client_id, item.report_record_id, item.filing_type)
        .then(cached => renderPick(cached))
        .catch(err => {
            console.error('DL-336: template fetch failed', err);
            container.innerHTML = `<div class="pa-add-doc-empty" style="color:var(--danger-600);">שגיאה בטעינת תבניות</div>`;
        });
}

function showAIAlsoMatchModal(recordId) {
    const item = aiClassificationsData.find(i => i.id === recordId);
    if (!item) return;

    const ownDocs = item.all_docs || item.missing_docs || [];
    const otherDocs = item.other_report_docs || [];
    const primaryTemplateId = item.matched_template_id;

    // Only show templates the admin can actually link TO: status must not already
    // be Received (those would conflict; v1 aborts whole batch on conflict).
    // Exclude the primary matched template — that one gets the standard approve.
    const buildRow = (d, ft) => {
        const isReceived = (d.status || '').toLowerCase() === 'received';
        const isPrimary = d.template_id === primaryTemplateId && ft === item.filing_type;
        if (isReceived || isPrimary) return null;
        const docId = d.doc_record_id || '';
        const label = d.name_short || d.name || d.template_id;
        const person = d.person || 'client';
        const personLabel = person === 'spouse' ? 'בן/בת זוג' : 'לקוח';
        return `
            <label class="ai-also-match-row" data-template-id="${escapeAttr(d.template_id)}" data-doc-record-id="${escapeAttr(docId)}" data-filing-type="${escapeAttr(ft)}" data-report-id="${escapeAttr(ft === item.filing_type ? (item.report_record_id || '') : (item.other_report_id || ''))}">
                <input type="checkbox" class="ai-also-match-checkbox">
                <span class="ai-also-match-person">${escapeHtml(personLabel)}</span>
                <span class="ai-also-match-label">${renderDocLabel(label)}</span>
            </label>
        `;
    };

    const ownRows = ownDocs.map(d => buildRow(d, item.filing_type)).filter(Boolean).join('');
    const otherFt = item.other_filing_type || (item.filing_type === 'annual_report' ? 'capital_statement' : 'annual_report');
    const otherRows = otherDocs.map(d => buildRow(d, otherFt)).filter(Boolean).join('');
    const otherFtLabel = otherFt === 'capital_statement' ? 'הצהרת הון' : 'דוח שנתי';

    const existing = document.getElementById('aiAlsoMatchModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'aiAlsoMatchModal';
    overlay.className = 'ai-modal-overlay';
    overlay.innerHTML = `
        <div class="ai-modal-panel ai-also-match-panel" dir="rtl" style="max-width:560px;">
            <div class="ai-modal-header">
                <h3 style="margin:0;">גם תואם ל...</h3>
                <button class="ai-modal-close" onclick="closeAIAlsoMatchModal()" aria-label="סגור">×</button>
            </div>
            <div class="ai-modal-body">
                <p style="margin:0 0 12px 0;font-size:14px;color:var(--text-secondary);">
                    בחר מסמכים נוספים שאותו קובץ מכסה. ייווצרו רשומות נפרדות עבור כל מסמך, אך כולן יצביעו על אותו קובץ OneDrive.
                </p>
                <div class="ai-also-match-file" style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:12px;font-size:13px;">
                    <i data-lucide="file" class="icon-sm" style="display:inline;vertical-align:middle;"></i>
                    ${escapeHtml(item.attachment_name || 'ללא שם')}
                </div>
                <input type="text" id="aiAlsoMatchSearch" placeholder="חיפוש מסמך..." dir="rtl"
                    style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border-subtle);border-radius:6px;font-size:13px;margin-bottom:8px;background:var(--bg-primary);color:var(--text-primary);">
                <div class="ai-also-match-list" style="max-height:240px;overflow-y:auto;">
                    ${ownRows || '<div style="padding:12px;color:var(--text-secondary);font-size:13px;">אין מסמכים חסרים בדוח זה</div>'}
                    ${otherRows ? `
                        <div class="ai-also-match-divider" style="margin:12px 0 6px 0;padding:4px 0;border-top:1px solid var(--border-subtle);font-size:12px;color:var(--text-secondary);">
                            ${escapeHtml(otherFtLabel)}
                        </div>
                        ${otherRows}
                    ` : ''}
                </div>
                <div style="margin-top:10px;border-top:1px solid var(--border-subtle);padding-top:10px;">
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">הוסף מסמך נוסף:</div>
                    <div id="aiAlsoMatchComboboxContainer"></div>
                </div>
            </div>
            <div class="ai-modal-footer">
                <button class="btn btn-success btn-sm" id="aiAlsoMatchConfirmBtn" onclick="confirmAIAlsoMatch('${escapeAttr(recordId)}')" disabled>
                    ${icon('link-2', 'icon-sm')} שייך
                </button>
                <button class="btn btn-ghost btn-sm" onclick="closeAIAlsoMatchModal()">ביטול</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const confirmBtn = overlay.querySelector('#aiAlsoMatchConfirmBtn');
    const list = overlay.querySelector('.ai-also-match-list');

    const updateConfirmBtn = () => {
        const anyChecked = overlay.querySelectorAll('.ai-also-match-checkbox:checked').length > 0;
        const hasPick = !!(overlay._pickerTarget);
        confirmBtn.disabled = !(anyChecked || hasPick);
    };

    // Enable confirm when any checkbox row is checked
    overlay.querySelectorAll('.ai-also-match-checkbox').forEach(cb => {
        cb.addEventListener('change', updateConfirmBtn);
    });

    // Search filter
    overlay.querySelector('#aiAlsoMatchSearch').addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        list.querySelectorAll('.ai-also-match-row').forEach(row => {
            const text = row.querySelector('.ai-also-match-label')?.textContent?.toLowerCase() || '';
            row.style.display = (!q || text.includes(q)) ? '' : 'none';
        });
    });

    // Template picker for adding an additional doc (DL-336: search + categories + variable wizard + chip)
    const comboboxContainer = overlay.querySelector('#aiAlsoMatchComboboxContainer');
    overlay._pickerTarget = null;
    _buildDocTemplatePicker(comboboxContainer, item, {
        onPick: (target) => {
            overlay._pickerTarget = target;
            updateConfirmBtn();
        },
    });

    overlay.classList.add('show');
    safeCreateIcons();
}

function closeAIAlsoMatchModal() {
    const el = document.getElementById('aiAlsoMatchModal');
    if (el) el.remove();
}

async function confirmAIAlsoMatch(recordId) {
    const overlay = document.getElementById('aiAlsoMatchModal');
    if (!overlay) return;
    const checked = Array.from(overlay.querySelectorAll('.ai-also-match-row')).filter(row =>
        row.querySelector('.ai-also-match-checkbox')?.checked
    );

    const additional_targets = checked.map(row => {
        const t = {
            template_id: row.dataset.templateId,
            doc_record_id: row.dataset.docRecordId || undefined,
            target_report_id: row.dataset.reportId || undefined,
        };
        if (row.dataset.templateId === 'general_doc' && row.dataset.newDocName) {
            t.new_doc_name = row.dataset.newDocName;
        }
        return t;
    }).filter(t => t.template_id !== 'general_doc' || t.new_doc_name);

    // Also pick up template picker selection (DL-336)
    const pickerTarget = overlay._pickerTarget;
    if (pickerTarget) {
        const item = aiClassificationsData.find(i => i.id === recordId);
        additional_targets.push({
            template_id: pickerTarget.template_id,
            doc_record_id: pickerTarget.doc_record_id || undefined,
            target_report_id: item?.report_record_id || undefined,
            ...(pickerTarget.new_doc_name ? { new_doc_name: pickerTarget.new_doc_name } : {}),
        });
    }

    if (additional_targets.length === 0) return;
    closeAIAlsoMatchModal();
    setCardLoading(recordId, `משייך ל-${additional_targets.length} מסמכים...`);

    try {
        const response = await fetchWithTimeout(ENDPOINTS.REVIEW_CLASSIFICATION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: recordId,
                action: 'also_match',
                additional_targets,
            }),
        }, FETCH_TIMEOUTS.mutate);

        const data = await parseAIResponse(response);
        clearCardLoading(recordId);

        if (data._conflict || (data.conflicts && data.conflicts.length > 0)) {
            const lines = (data.conflicts || []).map(c => `• ${(c.doc_title || c.template_id).replace(/<[^>]+>/g, '')}`).join('\n');
            showModal('error', 'מסמכים כבר קיימים', `לא ניתן לשייך — המסמכים הבאים כבר התקבלו:\n${lines}\n\nבטל את הסימון שלהם או השתמש ב"שינוי שיוך" פרטני.`);
            return;
        }

        if (!data.ok) throw new Error(formatAIResponseError(data));

        showAIToast(`שויך ל-${data.linked_count || additional_targets.length} מסמכים`, 'success');
        transitionCardToReviewed(recordId, 'approved', data);
    } catch (error) {
        clearCardLoading(recordId);
        showModal('error', 'שגיאה', humanizeError(error));
    }
}

async function assignAIUnmatched(recordId, btnEl) {
    // DL-339 v1.5: audit this desktop-or-mobile call site — the panel scope is
    // .ai-actions-panel (DL-339 pane-2 location), the mobile fat-card scope is
    // .ai-card-actions. Without this fallback the combobox lookup below throws
    // on every desktop [שייך] click in State D / State B fallback.
    const actionsContainer = btnEl.closest('.ai-card-actions') || btnEl.closest('.ai-actions-panel');
    if (!actionsContainer) return;
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

    // DL-334: Desktop path — clear re-review flag and refresh via cockpit.
    // (Desktop-or-mobile-targetable: desktop swaps thin row + panel; mobile swaps fat card.)
    if (!isAIReviewMobileLayout() && item) {
        _aiReReviewing.delete(recordId);
        refreshItemDom(item);
    } else {
        const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
        if (card) {
            const tmpDiv = document.createElement('div');
            tmpDiv.innerHTML = renderReviewedCard(item || { id: recordId, review_status: newReviewStatus }, newReviewStatus);
            const newCard = tmpDiv.firstElementChild;
            card.replaceWith(newCard);
        }
    }

    recalcAIStats();
    safeCreateIcons();

    // DL-340: Keep preview frame badge + border in sync when the active doc is transitioned
    if (activePreviewItemId === recordId) {
        applyPreviewReviewState(newReviewStatus);
    }

    // DL-210: Check if all items for this client are now reviewed
    if (item) {
        const clientName = item.client_name;
        const clientItems = aiClassificationsData.filter(i => i.client_name === clientName);
        const pendingItems = clientItems.filter(i => (i.review_status || 'pending') === 'pending');
        if (pendingItems.length === 0 && clientItems.length > 0) {
            // DL-323: user just took an action on this client → scroll to confirm
            showClientReviewDonePrompt(clientName, true);
        } else if (!isAIReviewMobileLayout() && pendingItems.length > 0) {
            // DL-341: auto-advance to next pending doc in same client (desktop only;
            // mobile keeps the fat-card in-place swap metaphor).
            const nextPending = pendingItems.slice().sort(compareDocRows)[0];
            if (nextPending && String(nextPending.id) !== String(recordId)) {
                selectDocument(nextPending.id);
            }
        }
    }
}

// DL-210: Show "mark review as done?" prompt when all client items are reviewed
// DL-323: userInitiated=true only when called from a user action (approve/reject/reassign).
// Render path (renderAICards) passes false so the page doesn't auto-scroll on every refresh
// to whichever already-completed client happens to be last in the list.
function _buildClientReviewDonePromptEl(clientName) {
    const clientItems = aiClassificationsData.filter(i => i.client_name === clientName);
    const approved = clientItems.filter(i => i.review_status === 'approved').length;
    const rejected = clientItems.filter(i => i.review_status === 'rejected').length;
    const reassigned = clientItems.filter(i => i.review_status === 'reassigned').length;
    const onHold = clientItems.filter(i => i.review_status === 'on_hold').length;

    const statParts = [];
    if (approved) statParts.push(`${approved} אושרו`);
    if (reassigned) statParts.push(`${reassigned} שויכו`);
    if (rejected) statParts.push(`${rejected} נדחו`);
    if (onHold) statParts.push(`${onHold} ממתינים לתשובת`);

    // DL-335: only show send-questions button if there are questions NOT yet on_hold
    const hasPendingQuestions = !_batchQuestionsSentClients.has(clientName) &&
        clientItems.some(i => i.pending_question && i.review_status !== 'on_hold');

    const prompt = document.createElement('div');
    prompt.className = 'ai-review-done-prompt';
    prompt.innerHTML = `
        <div class="ai-review-done-content">
            ${icon('check-circle-2', 'icon-md ai-review-done-icon')}
            <div class="ai-review-done-text">
                <strong>כל המסמכים נבדקו!</strong>
                <span class="ai-review-done-stats">${statParts.join(' · ')}</span>
            </div>
            ${hasPendingQuestions ? `
            <div class="ai-review-send-stack" style="display:flex;flex-direction:column;gap:6px;align-items:stretch;">
                <button class="btn btn-success btn-sm ai-review-done-btn" onclick="dismissAndSendQuestions('${escapeOnclick(clientName)}')">
                    ${icon('send', 'icon-xs')}
                    סיום בדיקה ושליחת שאלות
                </button>
                <button class="btn btn-link btn-sm" style="font-size:12px;padding:2px 4px;" onclick="previewBatchQuestions('${escapeOnclick(clientName)}')">
                    ${icon('eye', 'icon-xs')}
                    תצוגה מקדימה של השליחה
                </button>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="openBatchQuestionsModal('${escapeOnclick(clientName)}')">
                ${icon('pencil', 'icon-xs')}
                ערוך שאלות
            </button>
            ` : `
            <button class="btn btn-success btn-sm ai-review-done-btn" onclick="dismissClientReview('${escapeOnclick(clientName)}')">
                ${icon('check', 'icon-xs')}
                סיום בדיקה
            </button>
            `}
        </div>
    `;
    return prompt;
}

// DL-341: Desktop path — inject prompt into pane 2 above the doc list.
// DL-334 removed the accordion on desktop, so the old accordion-scoped render no-oped silently.
function _showClientReviewDonePromptDesktop(clientName, userInitiated) {
    const pane2 = document.querySelector('.ai-review-docs');
    if (!pane2) return;

    // Always strip any stale prompt (e.g. from a previously-selected client).
    const existing = pane2.querySelector(':scope > .ai-review-done-prompt');
    if (existing) existing.remove();

    // Only render for the client whose docs are currently visible. The render loop
    // calls this for every 0-pending client, but pane 2 only ever shows ONE client.
    if (typeof selectedClientName !== 'undefined' && selectedClientName && clientName !== selectedClientName) {
        return;
    }

    const prompt = _buildClientReviewDonePromptEl(clientName);
    const docList = pane2.querySelector('.ai-doc-list');
    if (docList) {
        pane2.insertBefore(prompt, docList);
    } else {
        pane2.prepend(prompt);
    }

    if (userInitiated) {
        try { pane2.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { pane2.scrollTop = 0; }
    }

    safeCreateIcons();
}

function _showClientReviewDonePromptMobile(clientName, userInitiated) {
    const accordion = document.querySelector(`.ai-accordion[data-client="${CSS.escape(clientName)}"]`);
    if (!accordion) return;

    if (userInitiated) {
        accordion.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const existing = accordion.querySelector('.ai-review-done-prompt');
    if (existing) existing.remove();

    const prompt = _buildClientReviewDonePromptEl(clientName);
    const header = accordion.querySelector('.ai-accordion-header');
    if (header) header.after(prompt);

    const statsEl = accordion.querySelector('.ai-accordion-stats');
    if (statsEl) {
        statsEl.innerHTML = `<span class="ai-accordion-stat-badge badge-success">✓ הושלם</span>`;
    }

    safeCreateIcons();
}

function showClientReviewDonePrompt(clientName, userInitiated = false) {
    if (isAIReviewMobileLayout()) {
        return _showClientReviewDonePromptMobile(clientName, userInitiated);
    }
    return _showClientReviewDonePromptDesktop(clientName, userInitiated);
}

// DL-328: Compose batch clarification questions for a client's AI Review batch
// DL-328: Save/edit a pending question on a single classification record (persisted to Airtable)
function openAddQuestionDialog(itemId) {
    const item = aiClassificationsData.find(i => i.id === itemId);
    if (!item) return;

    document.querySelectorAll('.add-question-overlay').forEach(el => el.remove());

    const existing = item.pending_question || '';
    const overlay = document.createElement('div');
    overlay.className = 'ai-modal-overlay add-question-overlay';
    overlay.innerHTML = `
        <div class="ai-modal-panel" dir="rtl" style="max-width:480px;width:90vw;">
            <div class="msg-compose-header" style="display:flex;align-items:center;justify-content:space-between;padding:16px;">
                <div style="font-weight:600;font-size:15px;">${existing ? 'ערוך שאלה' : 'הוסף שאלה'}</div>
                <button type="button" class="aq-close" style="background:transparent;border:none;font-size:20px;cursor:pointer;color:#6b7280;padding:4px 8px;">✕</button>
            </div>
            <div style="padding:0 16px 8px;font-size:13px;color:#6b7280;">
                ${escapeHtml(item.attachment_name || 'מסמך')}
            </div>
            <div style="padding:0 16px 16px;">
                <textarea class="aq-text" style="width:100%;min-height:100px;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;font-family:inherit;font-size:14px;box-sizing:border-box;" dir="rtl" placeholder="הקלד שאלה ללקוח…">${escapeHtml(existing)}</textarea>
            </div>
            <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--border-color,#e5e7eb);">
                <button type="button" class="btn btn-primary btn-sm aq-save">שמור שאלה</button>
                ${existing ? `<button type="button" class="btn btn-ghost btn-sm aq-clear" style="color:var(--danger-600,#dc2626)">מחק שאלה</button>` : ''}
                <button type="button" class="btn btn-ghost btn-sm aq-cancel">ביטול</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const textarea = overlay.querySelector('.aq-text');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    function close() {
        overlay.classList.remove('show');
        setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 200);
    }

    async function saveQuestion(text) {
        const saveBtn = overlay.querySelector('.aq-save');
        if (saveBtn) saveBtn.disabled = true;
        try {
            const resp = await fetchWithTimeout(ENDPOINTS.SAVE_CLASSIFICATION_QUESTION, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify({ classification_id: itemId, question: text || null }),
            }, FETCH_TIMEOUTS.load);
            const data = await resp.json();
            if (!resp.ok || !data.ok) { showAIToast(data.error || 'שגיאה בשמירה', 'danger'); if (saveBtn) saveBtn.disabled = false; return; }

            item.pending_question = text || '';

            // If the card is still pending and a question was added, auto-reject with has_question
            const isPending = !item.review_status || item.review_status === 'pending';
            if (text && isPending) {
                close();
                item.notes = JSON.stringify({ reason: 'has_question', text: '' });
                await executeReject(itemId, 'has_question', '');
            } else {
                // Already reviewed — just re-render the card with updated badge
                // DL-334: Desktop-or-mobile-targetable — refresh both fat-card (mobile)
                // and thin row + panel (desktop).
                if (!isAIReviewMobileLayout()) {
                    refreshItemDom(item);
                } else {
                    const card = document.querySelector(`.ai-review-card[data-id="${itemId}"]`);
                    if (card) {
                        const isReviewed = item.review_status && item.review_status !== 'pending';
                        const tmpDiv = document.createElement('div');
                        tmpDiv.innerHTML = isReviewed ? renderReviewedCard(item, item.review_status) : renderAICard(item);
                        card.replaceWith(tmpDiv.firstElementChild);
                    }
                }
                showAIToast(text ? 'השאלה נשמרה' : 'השאלה נמחקה');
                close();
            }
        } catch (_err) {
            showAIToast('שגיאה בתקשורת עם השרת', 'danger');
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    overlay.querySelector('.aq-save').addEventListener('click', () => saveQuestion(textarea.value.trim()));
    overlay.querySelector('.aq-cancel').addEventListener('click', close);
    overlay.querySelector('.aq-close').addEventListener('click', close);
    const clearBtn = overlay.querySelector('.aq-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => saveQuestion(''));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// DL-328: Compose + send batch questions email.
// Pre-populates from pending_question fields saved on individual classification records.
function openBatchQuestionsModal(clientName) {
    const clientItems = aiClassificationsData.filter(i => i.client_name === clientName);
    const reportId = clientItems[0]?.report_record_id;
    if (!reportId) { showAIToast('לא נמצא מזהה תיק', 'danger'); return; }

    document.querySelectorAll('.ai-modal-overlay.batch-questions-overlay').forEach(el => el.remove());

    // Items that already have a saved question — pre-populate one card each
    const preloaded = clientItems.filter(i => i.pending_question);

    const optionsHtml = clientItems.map((item, idx) => {
        const label = item.attachment_name || 'מסמך ללא שם';
        const suffix = item.matched_short_name ? ' — ' + item.matched_short_name : '';
        return `<option value="${idx}">${escapeHtml(label + suffix)}</option>`;
    }).join('');

    function buildCardHtml(num, isFirst, selectedIdx, prefillText) {
        const selVal = selectedIdx != null ? String(selectedIdx) : '';
        const textVal = prefillText ? escapeHtml(prefillText) : '';
        return `<div class="batch-q-card" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <span style="font-size:13px;font-weight:600;color:#6b7280">שאלה ${num}</span>
                <button type="button" class="btn btn-ghost btn-sm batch-q-remove" style="padding:2px 8px;font-size:12px;${isFirst && !prefillText ? 'display:none' : ''}">הסר</button>
            </div>
            <select class="batch-q-file" style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;font-family:inherit;" dir="rtl">
                <option value="">בחר מסמך…</option>
                ${optionsHtml}
            </select>
            <textarea class="batch-q-text" style="width:100%;min-height:72px;padding:8px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;font-family:inherit;font-size:14px;" dir="rtl" placeholder="הקלד שאלה…">${textVal}</textarea>
        </div>`;
    }

    // Build initial cards: one per preloaded question, or one empty card
    let initialCardsHtml = '';
    if (preloaded.length > 0) {
        initialCardsHtml = preloaded.map((item, i) => {
            const idx = clientItems.indexOf(item);
            return buildCardHtml(i + 1, i === 0, idx, item.pending_question);
        }).join('');
    } else {
        initialCardsHtml = buildCardHtml(1, true, null, null);
    }

    const overlay = document.createElement('div');
    overlay.className = 'ai-modal-overlay batch-questions-overlay';
    overlay.innerHTML = `
        <div class="ai-modal-panel" dir="rtl" style="max-width:640px;width:90vw;max-height:85vh;display:flex;flex-direction:column;">
            <div class="msg-compose-header" style="display:flex;align-items:center;justify-content:space-between;padding:16px;">
                <div style="font-weight:600;font-size:16px;">שאלות ללקוח — ${escapeHtml(clientName)}</div>
                <button type="button" class="batch-q-close" style="background:transparent;border:none;font-size:20px;cursor:pointer;color:#6b7280;padding:4px 8px;">✕</button>
            </div>
            <div class="batch-q-body" style="flex:1 1 auto;overflow-y:auto;padding:0 16px 16px;display:flex;flex-direction:column;gap:8px;">
                ${initialCardsHtml}
                <button type="button" class="btn btn-ghost btn-sm batch-q-add" style="align-self:flex-start;margin-top:4px;">+ הוסף שאלה</button>
            </div>
            <div class="batch-q-footer" style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--border-color,#e5e7eb);flex-wrap:wrap;">
                <button type="button" class="btn btn-primary btn-sm batch-q-save">${icon('save','icon-xs')} שמור</button>
                <button type="button" class="btn btn-ghost btn-sm batch-q-cancel">ביטול</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const body = overlay.querySelector('.batch-q-body');
    const addBtn = overlay.querySelector('.batch-q-add');
    const saveBtn = overlay.querySelector('.batch-q-save');
    const cancelBtn = overlay.querySelector('.batch-q-cancel');
    const closeBtn = overlay.querySelector('.batch-q-close');

    // Set select values for pre-populated cards (can't set via HTML attribute for <select>)
    if (preloaded.length > 0) {
        body.querySelectorAll('.batch-q-file').forEach((select, i) => {
            const idx = clientItems.indexOf(preloaded[i]);
            if (idx >= 0) select.value = String(idx);
        });
    }

    function renumberCards() {
        const cards = body.querySelectorAll('.batch-q-card');
        cards.forEach((card, idx) => {
            card.querySelector('span').textContent = `שאלה ${idx + 1}`;
            const removeBtn = card.querySelector('.batch-q-remove');
            removeBtn.style.display = cards.length > 1 ? '' : 'none';
        });
    }

    function collectQuestions() {
        return Array.from(body.querySelectorAll('.batch-q-card')).map(card => {
            const select = card.querySelector('.batch-q-file');
            const textarea = card.querySelector('.batch-q-text');
            const idx = parseInt(select.value, 10);
            const item = !isNaN(idx) && idx >= 0 ? clientItems[idx] : null;
            return {
                file_id: item?.id || '',
                attachment_name: item?.attachment_name || '',
                short_name: item?.matched_short_name || '',
                question: textarea.value.trim(),
            };
        });
    }

    function validateQuestions(qs) {
        return qs.length >= 1 && qs.some(q => q.question.length > 0);
    }

    function close() {
        overlay.classList.remove('show');
        setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 200);
    }

    function wireRemoveBtn(card) {
        card.querySelector('.batch-q-remove').addEventListener('click', () => {
            card.remove();
            renumberCards();
        });
    }

    body.querySelectorAll('.batch-q-card').forEach(card => wireRemoveBtn(card));

    addBtn.addEventListener('click', () => {
        const cardCount = body.querySelectorAll('.batch-q-card').length;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = buildCardHtml(cardCount + 1, false, null, null);
        const newCard = tempDiv.firstElementChild;
        body.insertBefore(newCard, addBtn);
        wireRemoveBtn(newCard);
        renumberCards();
    });


    saveBtn.addEventListener('click', async () => {
        const qs = collectQuestions();
        // Build target map: file_id → question text (drop cards without a valid file_id)
        const target = new Map();
        for (const q of qs) {
            if (!q.file_id) continue;
            target.set(q.file_id, q.question);
        }
        // Determine previously-persisted IDs so we can clear any that were removed
        const previouslySet = new Set(
            clientItems.filter(i => i.pending_question).map(i => i.id)
        );

        const ops = [];
        for (const [fileId, text] of target.entries()) {
            const trimmed = text.trim();
            const item = clientItems.find(i => i.id === fileId);
            if (!item) continue;
            const prior = item.pending_question || '';
            if (prior === trimmed) continue; // no-op
            ops.push({ fileId, text: trimmed || null, item });
        }
        for (const id of previouslySet) {
            if (!target.has(id)) {
                const item = clientItems.find(i => i.id === id);
                if (item) ops.push({ fileId: id, text: null, item });
            }
        }

        saveBtn.disabled = true;
        try {
            const results = await Promise.all(ops.map(op =>
                fetchWithTimeout(ENDPOINTS.SAVE_CLASSIFICATION_QUESTION, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ classification_id: op.fileId, question: op.text }),
                }, FETCH_TIMEOUTS.load).then(r => r.json()).then(d => ({ op, d }))
            ));
            const failed = results.find(r => !r.d || r.d.ok === false);
            if (failed) {
                showAIToast(failed.d?.error || 'שגיאה בשמירה', 'danger');
                saveBtn.disabled = false;
                return;
            }
            // Apply locally + re-render affected cards
            // DL-334: Desktop-or-mobile-targetable — refresh both fat-card (mobile)
            // and thin row + panel (desktop).
            for (const { op } of results) {
                op.item.pending_question = op.text || '';
                if (!isAIReviewMobileLayout()) {
                    refreshItemDom(op.item);
                } else {
                    const card = document.querySelector(`.ai-review-card[data-id="${op.item.id}"]`);
                    if (card) {
                        const isReviewed = op.item.review_status && op.item.review_status !== 'pending';
                        const tmpDiv = document.createElement('div');
                        tmpDiv.innerHTML = isReviewed ? renderReviewedCard(op.item, op.item.review_status) : renderAICard(op.item);
                        card.replaceWith(tmpDiv.firstElementChild);
                    }
                }
            }
            close();
            showAIToast('השאלות נשמרו');
            showClientReviewDonePrompt(clientName);
        } catch (_err) {
            showAIToast('שגיאה בתקשורת עם השרת', 'danger');
            saveBtn.disabled = false;
        }
    });

    cancelBtn.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// DL-328: Collect saved questions for a client and send, then dismiss the review.
async function dismissAndSendQuestions(clientName) {
    const clientItems = aiClassificationsData.filter(i => i.client_name === clientName);
    const reportId = clientItems[0]?.report_record_id;
    if (!reportId) { showAIToast('לא נמצא מזהה תיק', 'danger'); return; }

    const questions = clientItems
        .filter(i => i.pending_question)
        .map(item => ({
            file_id: item.id,
            attachment_name: item.attachment_name || '',
            short_name: item.matched_short_name || '',
            question: item.pending_question,
        }));

    if (questions.length === 0) {
        showAIToast('אין שאלות שמורות לשליחה', 'danger');
        return;
    }

    const btn = document.querySelector(`.ai-accordion[data-client="${CSS.escape(clientName)}"] .ai-review-done-btn`);
    if (btn) btn.disabled = true;

    try {
        const resp = await fetchWithTimeout(ENDPOINTS.SEND_BATCH_QUESTIONS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ report_id: reportId, questions }),
        }, FETCH_TIMEOUTS.load);
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
            showAIToast(data.error || 'שגיאה בשליחה', 'danger');
            if (btn) btn.disabled = false;
            return;
        }
        _batchQuestionsSentClients.add(clientName);
        // DL-335: flip held items to on_hold in local data so they re-render immediately
        const heldCount = data.held_count || 0;
        const sentAt = new Date().toISOString();
        aiClassificationsData.forEach(i => {
            if (i.client_name === clientName && i.pending_question) {
                i.review_status = 'on_hold';
                i.reviewed_at = sentAt;
            }
        });
        if (data.queued) {
            showAIToast('השאלות נשלחו לבוקר — יישלחו ב־08:00', 'info');
        } else {
            showAIToast('השאלות נשלחו ללקוח');
        }
        // DL-335: only dismiss rows that are NOT on_hold; held cards stay in AI Review
        dismissClientReview(clientName, { keepOnHold: true });
    } catch (_err) {
        showAIToast('שגיאה בתקשורת עם השרת', 'danger');
        if (btn) btn.disabled = false;
    }
}

// DL-328: Preview the batch questions email without sending.
function previewBatchQuestions(clientName) {
    const clientItems = aiClassificationsData.filter(i => i.client_name === clientName);
    const reportId = clientItems[0]?.report_record_id;
    if (!reportId) { showAIToast('לא נמצא מזהה תיק', 'danger'); return; }

    const questions = clientItems
        .filter(i => i.pending_question)
        .map(item => ({
            file_id: item.id,
            attachment_name: item.attachment_name || '',
            short_name: item.matched_short_name || '',
            question: item.pending_question,
        }));

    if (questions.length === 0) {
        showAIToast('אין שאלות שמורות לתצוגה מקדימה', 'danger');
        return;
    }

    window.showEmailPreviewModal({
        reportId,
        clientName,
        getToken: () => authToken,
        endpoint: ENDPOINTS.SEND_BATCH_QUESTIONS,
        extraPayload: { questions },
    });
}

// DL-210: Remove all reviewed cards for this client from the UI + delete from Airtable
// DL-335: keepOnHold=true skips on_hold rows so they stay in the queue after questions are sent
async function dismissClientReview(clientName, { keepOnHold = false } = {}) {
    const accordion = document.querySelector(`.ai-accordion[data-client="${CSS.escape(clientName)}"]`);
    if (!accordion) return;

    const clientItems = aiClassificationsData.filter(i => i.client_name === clientName);

    // DL-335: when keepOnHold, only delete rows that are NOT on_hold
    const itemsToDelete = keepOnHold
        ? clientItems.filter(i => i.review_status !== 'on_hold')
        : clientItems;
    const recordIds = itemsToDelete.map(i => i.id);

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

    // DL-335: if some items are kept on hold, re-render the accordion instead of collapsing it
    const heldItems = keepOnHold ? clientItems.filter(i => i.review_status === 'on_hold') : [];
    if (heldItems.length > 0) {
        // Remove dismissed items from data; held items stay
        aiClassificationsData = aiClassificationsData.filter(i => i.client_name !== clientName || i.review_status === 'on_hold');
        // Re-render the client's accordion in-place so held cards show
        const docsPane = accordion.querySelector('.ai-accordion-cards') || accordion;
        docsPane.querySelectorAll('.ai-review-card:not([data-review-status="on_hold"])').forEach(el => el.remove());
        // Remove the done-prompt — held state replaces it
        accordion.querySelector('.ai-review-done-prompt')?.remove();
        // Update the accordion stats badge
        const statsEl = accordion.querySelector('.ai-accordion-stats');
        if (statsEl) {
            statsEl.innerHTML = `<span class="ai-accordion-stat-badge badge-warning">${heldItems.length} ממתינים לתשובה</span>`;
        }
        recalcAIStats();
        return;
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
            const cp = document.getElementById('aiClientsPane'); if (cp) cp.style.display = 'none';
            const dp = document.getElementById('aiDocsPane'); if (dp) dp.style.display = 'none';
            document.getElementById('aiEmptyState').style.display = 'block';
            safeCreateIcons();
        }

        recalcAIStats();
    }, 350);
}

function animateAndRemoveAI(recordId) {
    aiClassificationsData = aiClassificationsData.filter(item => item.id !== recordId);

    // DL-334: Desktop-or-mobile-targetable — remove thin row on desktop, fat card on mobile.
    if (!isAIReviewMobileLayout()) {
        const row = document.querySelector(`.ai-doc-row[data-id="${CSS.escape(String(recordId))}"]`);
        if (row) row.remove();
        if (window.activePreviewItemId && String(window.activePreviewItemId) === String(recordId)) {
            window.activePreviewItemId = null;
            try { renderActionsPanel(null); } catch (e) {}
        }
        if (aiClassificationsData.length === 0) {
            const cp = document.getElementById('aiClientsPane'); if (cp) cp.style.display = 'none';
            const dp = document.getElementById('aiDocsPane'); if (dp) dp.style.display = 'none';
            const es = document.getElementById('aiEmptyState'); if (es) es.style.display = 'block';
        }
        recalcAIStats();
        return;
    }

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
                const cp = document.getElementById('aiClientsPane'); if (cp) cp.style.display = 'none';
                const dp = document.getElementById('aiDocsPane'); if (dp) dp.style.display = 'none';
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
        toastIcon.innerHTML = icon('x-circle'); // DL-314: sprite
    } else {
        toastIcon.innerHTML = icon('check-circle'); // DL-314: sprite
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

// ==================== REVIEW & APPROVE QUEUE (DL-292) ====================

let pendingApprovalData = [];
let _paFilteredData = [];
let pendingApprovalLoaded = false;
let pendingApprovalLoadedAt = 0;
let _paPage = 1;
const PA_PAGE_SIZE = 20;
// DL-298: expand state for stacked cards. First 3 of each render are pre-expanded; others toggle via togglePaCard().
let _paExpanded = new Set();
// DL-299: company_links map (Hebrew name → url) for "החלף חברה" combobox in per-doc issuer edit
let paCompanyLinks = {};
// DL-299: active issuer-edit / note-popover state
let _paActiveIssuerEdit = null;   // {reportId, docId}
let _paActiveNoteDocId = null;
let _paActiveNoteReportId = null;
let _paActiveNoteOriginal = '';
const PA_COMPANY_TEMPLATES = ['T501', 'T401', 'T301']; // mirrors doc-manager COMPANY_TEMPLATES
let _paQuestionsEditState = []; // mutable copy for the questions modal
let _paQuestionsReportId = null;

function initPaYearFilter() {
    const sel = document.getElementById('paYearFilter');
    if (!sel || sel.options.length > 1) return;
    const latestTaxYear = new Date().getFullYear() - 1;
    sel.innerHTML = '';
    for (let y = latestTaxYear; y >= 2025; y--) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        if (y === latestTaxYear) opt.selected = true;
        sel.appendChild(opt);
    }
}

async function loadPendingApprovalQueue(silent = false, prefetchOnly = false) {
    if (!authToken) return;
    initPaYearFilter();
    const isFresh = pendingApprovalLoaded && (Date.now() - pendingApprovalLoadedAt < STALE_AFTER_MS);

    // DL-317: SWR — paint cached data instantly on first switchTab after a prefetch landed
    if (!prefetchOnly && pendingApprovalLoaded && !pendingApprovalEverRendered) {
        const _tR = perfStart();
        _paPage = 1;
        filterPendingApproval(true);
        pendingApprovalEverRendered = true;
        perfEnd('dl317:pendingApproval:render', _tR);
    }

    if (silent && isFresh) return;

    const year = document.getElementById('paYearFilter')?.value || String(new Date().getFullYear() - 1);
    const filingType = document.getElementById('paFilingTypeFilter')?.value || 'annual_report';

    const _tF = perfStart();
    try {
        const resp = await deduplicatedFetch(
            `${ENDPOINTS.ADMIN_PENDING_APPROVAL}?year=${encodeURIComponent(year)}&filing_type=${encodeURIComponent(filingType)}`,
            { headers: { 'Authorization': `Bearer ${authToken}` } },
            FETCH_TIMEOUTS.load
        );
        const data = await resp.json();
        if (!data.ok) {
            if (data.error === 'unauthorized') { logout(); return; }
            throw new Error(data.error || 'שגיאה בטעינת הנתונים');
        }
        pendingApprovalData = data.items || [];
        paCompanyLinks = data.company_links || {}; // DL-299: for החלף חברה combobox on issuer edit
        pendingApprovalLoaded = true;
        pendingApprovalLoadedAt = Date.now();
        // Cheap badge update runs even in prefetch
        syncPaBadge(pendingApprovalData.length);
        perfEnd('dl317:pendingApproval:fetch', _tF);

        if (!prefetchOnly) {
            const _tR = perfStart();
            _paPage = 1;
            filterPendingApproval(true); // populates _paFilteredData + renders
            pendingApprovalEverRendered = true;
            perfEnd('dl317:pendingApproval:render', _tR);
        }
        return;
    } catch (err) {
        perfEnd('dl317:pendingApproval:fetch', _tF);
        console.error('[pa-queue] load failed', err);
        if (!silent) {
            const c = document.getElementById('paCardsContainer');
            if (c) c.innerHTML = `<div class="empty-state"><p style="color:var(--danger-500);">לא ניתן לטעון את הנתונים. <button class="btn btn-secondary btn-sm" onclick="loadPendingApprovalQueue()">נסה שוב</button></p></div>`;
        }
    }
}

function syncPaBadge(count) {
    const badge = document.getElementById('pendingApprovalTabBadge');
    const bottomBadge = document.getElementById('pendingApprovalBottomBadge');
    if (!badge) return;
    badge.classList.remove('ai-badge-loading');
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-flex';
        if (bottomBadge) { bottomBadge.textContent = count; bottomBadge.style.display = 'inline-flex'; }
    } else {
        badge.style.display = 'none';
        if (bottomBadge) bottomBadge.style.display = 'none';
    }
    _reviewsPaCount = count || 0;
    _syncReviewsGroupBadge();
}

function renderPendingApprovalCards() {
    const container = document.getElementById('paCardsContainer');
    const emptyState = document.getElementById('paEmptyState');
    if (!container) return;

    const items = _paFilteredData;

    if (items.length === 0) {
        container.innerHTML = pendingApprovalData.length > 0
            ? '<div class="empty-state"><p>לא נמצאו תוצאות לחיפוש</p></div>'
            : '';
        if (emptyState) emptyState.style.display = pendingApprovalData.length === 0 ? '' : 'none';
        renderPagination('paPagination', 0, 1, PA_PAGE_SIZE, () => {});
        return;
    }
    if (emptyState) emptyState.style.display = 'none';

    const pageItems = items.slice((_paPage - 1) * PA_PAGE_SIZE, _paPage * PA_PAGE_SIZE);

    // DL-304: all cards collapsed by default (previously auto-expanded first 3 of current page).
    container.innerHTML = pageItems.map(item => buildPaCard(item)).join('');
    renderPagination('paPagination', items.length, _paPage, PA_PAGE_SIZE, (p) => { _paPage = p; renderPendingApprovalCards(); });
    safeCreateIcons(container);
    bindPaLinkHoverAll(container);
}

// DL-302: idempotent — guard via data-link-bound so re-renders don't stack listeners.
function bindPaLinkHoverAll(scope) {
    (scope || document).querySelectorAll('.pa-card__body').forEach(body => {
        if (body.dataset.linkBound === '1') return;
        body.dataset.linkBound = '1';
        bindPaLinkHover(body);
    });
}

// DL-301: client-side search filter for PA queue
function filterPendingApproval(keepPage) {
    const input = document.getElementById('paSearchInput');
    const search = (input?.value || '').toLowerCase().trim();
    const clearBtn = document.getElementById('paSearchClear');
    if (clearBtn) clearBtn.style.display = search ? '' : 'none';

    _paFilteredData = pendingApprovalData.filter(item => {
        if (!search) return true;
        const name   = (item.client_name  || '').toLowerCase();
        const email  = (item.client_email || '').toLowerCase();
        const spouse = (item.spouse_name  || '').toLowerCase();
        return name.includes(search) || email.includes(search) || spouse.includes(search);
    });

    if (!keepPage) _paPage = 1;
    renderPendingApprovalCards();
}

function clearPaSearch() {
    const input = document.getElementById('paSearchInput');
    if (input) input.value = '';
    filterPendingApproval();
}

// DL-298: toggle expand/collapse state for a single card; only re-renders that card.
function togglePaCard(reportId, ev) {
    if (ev) ev.stopPropagation();
    if (_paExpanded.has(reportId)) _paExpanded.delete(reportId);
    else _paExpanded.add(reportId);
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return;
    const card = document.querySelector(`.pa-card[data-report-id="${CSS.escape(reportId)}"]`);
    if (card) {
        card.outerHTML = buildPaCard(item);
        safeCreateIcons(document.getElementById('paCardsContainer') || document);
        bindPaLinkHoverAll(document.getElementById('paCardsContainer') || document);
    }
}

// DL-298: stacked full-width card. Collapsed header always visible; body expanded when in _paExpanded set.
function buildPaCard(item) {
    const escapedName = escapeHtml(item.client_name || '');
    const relDate = item.submitted_at ? formatRelativeTime(item.submitted_at) : '';
    const qs = Array.isArray(item.answers_summary) ? item.answers_summary : [];
    const answersAll = Array.isArray(item.answers_all) ? item.answers_all : qs;
    const docs = Array.isArray(item.doc_chips) ? item.doc_chips : (Array.isArray(item.docs) ? item.docs : []);
    const questions = Array.isArray(item.client_questions) ? item.client_questions.filter(q => q && (q.text || '').trim()) : [];
    const qCount = questions.length;
    const notesText = [(item.notes || '').trim(), (item.client_notes || '').trim()].filter(Boolean).join('\n\n');
    // DL-300 follow-up: ✨ issuer suggestion feature disabled pending UX rework
    // (accept flow clobbered full doc-row labels instead of re-composing with template prefix).
    const suggestionCount = 0;
    const isExpanded = _paExpanded.has(item.report_id);

    // DL-295: priority age badge — red >7d, yellow 3–7d, none <3d
    const ageDays = item.submitted_at
        ? Math.floor((Date.now() - new Date(item.submitted_at).getTime()) / 86400000)
        : 0;
    const priorityCls = ageDays > 7 ? 'pa-card__priority--high'
        : (ageDays >= 3 ? 'pa-card__priority--med' : '');
    const priorityHtml = priorityCls
        ? `<span class="pa-card__priority ${priorityCls}">${ageDays} ימים</span>`
        : '';

    // DL-299 follow-up: all count badges removed per request. Only the folder-open link + chevron remain.
    const countBadges = '';

    const clientId = item.client_id || '';
    const docMgrLink = clientId
        ? `<a href="../document-manager.html?client_id=${encodeURIComponent(clientId)}" target="_blank" class="ai-doc-manager-link" onclick="event.stopPropagation()" title="לניהול המסמכים">${icon('folder-open', 'icon-xs')}</a>`
        : '';

    const header = `<div class="pa-card__header" onclick="togglePaCard('${item.report_id}', event)">
        <div class="pa-card__header-main">
            <div class="pa-card__name">${escapedName}</div>
            <div class="pa-card__meta">
                ${priorityHtml}
            </div>
        </div>
        <div class="pa-card__header-badges">${countBadges}</div>
        <div class="pa-card__header-actions">
            ${docMgrLink}
            <button class="pa-card__chevron" aria-label="${isExpanded ? 'כווץ' : 'הרחב'}" onclick="togglePaCard('${item.report_id}', event)">
                ${icon(isExpanded ? 'chevron-up' : 'chevron-down', 'icon-sm')}
            </button>
        </div>
    </div>`;

    // DL-306: pre-uploaded docs indicator — banner shown when client has unclassified docs
    const preuploadedCount = Number(item.pending_reviews_count) || 0;
    const preuploadedBanner = (preuploadedCount > 0 && clientId) ? `<div class="preuploaded-banner" role="status">
        ${icon('info')}
        <div class="preuploaded-banner__text">
            <strong>הלקוח כבר שלח מסמכים שממתינים לסיווג</strong>
            <span>מומלץ לעבור עליהם לפני אישור ושליחה.</span>
        </div>
        <a href="index.html?tab=ai-review&client=${escapeAttr(clientId)}" target="_blank" rel="noopener" class="btn btn-sm preuploaded-banner__btn">פתח ב־AI Review</a>
    </div>` : '';

    const body = isExpanded ? `<div class="pa-card__body">
        ${preuploadedBanner}
        ${buildPaPreviewBody(item)}
        <div class="pa-card__actions" onclick="event.stopPropagation()">
            <button class="btn btn-sm btn-success pa-btn-approve" onclick="approveAndSendFromQueue('${item.report_id}', '${escapedName.replace(/'/g, "\\'")}')">
                ${icon('send', 'icon-xs')} אשר ושלח
            </button>
            <button class="btn btn-sm btn-outline pa-btn-advance"
                    title="מעביר את הלקוח לשלב איסוף מסמכים. לא יישלח לו מייל."
                    onclick="advanceToCollectingDocs('${item.report_id}', '${escapedName.replace(/'/g, "\\'")}')">
                ${icon('mail-x', 'icon-xs')} אשר מבלי לשלוח
            </button>
            <button class="btn btn-sm btn-outline pa-btn-preview" onclick="previewApproveEmail('${item.report_id}', '${escapedName.replace(/'/g, "\\'")}')">
                ${icon('eye', 'icon-xs')} תצוגה מקדימה
            </button>
            <button class="btn btn-sm btn-outline pa-btn-questions" onclick="openQuestionsForClient('${item.report_id}')">
                ${icon('message-circle', 'icon-xs')} שאל את הלקוח${qCount > 0 ? ` <span class="pa-questions-badge">${qCount}</span>` : ''}
            </button>
        </div>
    </div>` : '';

    // DL-302: SSOT for orphan detection on the PA card. Comma-joined set of every
    // template id that any question_mappings row produces for this filing type.
    // Empty payload (older cached responses) → frontend falls back to "doc has no
    // template id at all" definition.
    const mappedTids = Array.isArray(item.mapped_template_ids) ? item.mapped_template_ids.join(',') : '';
    return `<div class="pa-card pa-card--stack${isExpanded ? ' pa-card--expanded' : ' pa-card--collapsed'}" data-report-id="${item.report_id}" data-mapped-tids="${escapeAttr(mappedTids)}">
        ${header}
        ${body}
    </div>`;
}

// DL-298: removed loadPaPreview — the card IS the preview; use togglePaCard() instead.

// Show/hide "No" answers in preview (per-report state)
const _paShowNoAnswers = new Set();

function togglePaShowNo(reportId) {
    if (_paShowNoAnswers.has(reportId)) _paShowNoAnswers.delete(reportId);
    else _paShowNoAnswers.add(reportId);
    // DL-298: re-render the single card in place
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return;
    const card = document.querySelector(`.pa-card[data-report-id="${CSS.escape(reportId)}"]`);
    if (card) {
        card.outerHTML = buildPaCard(item);
        safeCreateIcons(document.getElementById('paCardsContainer') || document);
        bindPaLinkHoverAll(document.getElementById('paCardsContainer') || document);
    }
}

function buildPaPreviewHeader(item) {
    const FILING_TYPE_LABELS = { annual_report: 'דוח שנתי', capital_statement: 'הצהרת הון' };
    const filingLabel = FILING_TYPE_LABELS[item.filing_type] || item.filing_type || '';
    const relDate = item.submitted_at ? formatRelativeTime(item.submitted_at) : '';

    const answersCount = Array.isArray(item.answers_all) ? item.answers_all.length
        : (Array.isArray(item.answers_summary) ? item.answers_summary.length : 0);
    const docsCount = Array.isArray(item.doc_chips) ? item.doc_chips.length : 0;
    const notesCount = ((item.notes || '').trim() || (item.client_notes || '').trim()) ? 1 : 0;
    const questionsCount = Array.isArray(item.client_questions)
        ? item.client_questions.filter(q => q && (q.text || '').trim()).length : 0;

    return `<div class="pa-preview-header">
        <div class="pa-preview-header-top">
            <div class="pa-preview-client-name">${escapeHtml(item.client_name || '')}</div>
            <span class="pa-preview-client-id">${escapeHtml(item.client_id || '')}</span>
        </div>
        <div class="pa-preview-header-meta">
            ${escapeHtml(filingLabel)} · ${escapeHtml(String(item.year || ''))}${relDate ? ` · הוגש ${escapeHtml(relDate)}` : ''}${item.spouse_name ? ` · ${escapeHtml(item.spouse_name)}` : ''}
        </div>
        <div class="pa-preview-stats">
            <span class="pa-preview-stat" title="תשובות שאלון">${icon('file-text', 'icon-xs')} ${answersCount}</span>
            <span class="pa-preview-stat" title="מסמכים">${icon('folder', 'icon-xs')} ${docsCount}</span>
            <span class="pa-preview-stat${notesCount ? '' : ' pa-preview-stat--empty'}" title="הערות">${icon('message-square', 'icon-xs')} ${notesCount}</span>
            <span class="pa-preview-stat${questionsCount ? '' : ' pa-preview-stat--empty'}" title="שאלות ללקוח">${icon('message-circle', 'icon-xs')} ${questionsCount}</span>
        </div>
    </div>`;
}

function buildPaPreviewBody(item) {
    const answersAll = Array.isArray(item.answers_all) ? item.answers_all
        : (Array.isArray(item.answers_summary) ? item.answers_summary : []);
    const notesText = [(item.notes || '').trim(), (item.client_notes || '').trim()].filter(Boolean).join('\n\n');
    const questions = Array.isArray(item.client_questions) ? item.client_questions.filter(q => q && (q.text || '').trim()) : [];
    const docGroups = Array.isArray(item.doc_groups) ? item.doc_groups : [];
    const showNo = _paShowNoAnswers.has(item.report_id);

    // Partition answers: yes (✓ כן), no (✗ לא), free-text
    const yesAnswers = [];
    const noAnswers = [];
    const freeAnswers = [];
    for (const a of answersAll) {
        if (a.value === '✓ כן' || a.value === '✓ Yes') yesAnswers.push(a);
        else if (a.value === '✗ לא' || a.value === '✗ No') noAnswers.push(a);
        else freeAnswers.push(a);
    }

    // ========== Q&A SECTION (left column) ==========
    let qaHtml = '';
    if (answersAll.length > 0) {
        qaHtml += `<div class="pa-preview-section">
            <div class="pa-preview-section-title">
                <span>${icon('file-text', 'icon-sm')} תשובות שאלון</span>
                <button class="pa-print-btn" onclick="event.stopPropagation(); printPaQuestionnaire('${item.report_id}')" title="הדפס שאלון">
                    ${icon('printer', 'icon-xs')} הדפסה
                </button>
            </div>`;

        // DL-299 follow-up: "✓ כן" chip block removed (noisy; reviewer only needs free-text answers + optional "לא" reveal)

        if (freeAnswers.length > 0) {
            qaHtml += `<div class="pa-preview-subsection">
                <div class="pa-preview-subtitle">תשובות פתוחות (${freeAnswers.length})</div>
                <div class="pa-preview-qa">
                    ${freeAnswers.map((a, i) => {
                        // DL-302: cross-highlight metadata. template_ids is a comma-joined list
                        // (server attaches it from question_mappings). Selectable + focusable for
                        // keyboard parity with the desktop hover.
                        const tids = Array.isArray(a.template_ids) ? a.template_ids.join(',') : '';
                        const linkAttr = tids
                            ? ` data-template-ids="${escapeAttr(tids)}" tabindex="0" role="button" aria-label="${escapeAttr('הדגש מסמכים מקושרים')}"`
                            : '';
                        return `<div class="pa-preview-qa-row" data-answer-idx="${i}"${linkAttr}>
                        <span class="pa-preview-qa-label">${escapeHtml(a.label)}</span>
                        <span class="pa-preview-qa-value">${escapeHtml(a.value)}</span>
                    </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        if (noAnswers.length > 0) {
            qaHtml += `<div class="pa-preview-subsection">
                <button class="pa-preview-toggle" onclick="togglePaShowNo('${item.report_id}')">
                    ${icon(showNo ? 'chevron-up' : 'chevron-down', 'icon-xs')}
                    ${showNo ? 'הסתר' : 'הצג'} תשובות "לא" (${noAnswers.length})
                </button>
                ${showNo ? `<div class="pa-yes-chips-grid" style="margin-top:var(--sp-2);">
                    ${noAnswers.map(a => `<span class="pa-yes-chip pa-yes-chip--no">${escapeHtml(a.label)}</span>`).join('')}
                </div>` : ''}
            </div>`;
        }

        qaHtml += `</div>`;
    }

    // ========== DOC LIST (right column) — per-person / per-category ==========
    let docsHtml = '';
    if (docGroups.length > 0) {
        docsHtml = `<div class="pa-preview-section">
            <div class="pa-preview-section-title">${icon('folder', 'icon-sm')} רשימת מסמכים</div>
            ${docGroups.map(group => {
                const personLabel = group.person_label || (group.person === 'spouse' ? `מסמכים של ${item.spouse_name || 'בן/בת הזוג'}` : `מסמכים של ${item.client_name}`);
                const cats = Array.isArray(group.categories) ? group.categories : [];
                const personKey = group.person === 'spouse' ? 'spouse' : 'client';
                return `<div class="pa-preview-person-section">
                    <div class="pa-preview-person-title">📂 ${escapeHtml(personLabel)}</div>
                    ${cats.map(cat => {
                        const catDocs = Array.isArray(cat.docs) ? cat.docs : [];
                        if (catDocs.length === 0) return '';
                        return `<div class="pa-preview-category">
                            <div class="pa-preview-category-title">${cat.emoji || '📄'} ${escapeHtml(cat.name || cat.name_he || '')}</div>
                            ${catDocs.map(d => renderPaDocTagRow(d, item.report_id)).join('')}
                        </div>`;
                    }).join('')}
                    ${renderPaAddDocRow(item.report_id, personKey)}
                </div>`;
            }).join('')}
        </div>`;
    }

    // DL-295: 2-column grid wrapper — CSS collapses to single column <1024px
    let html = '';
    if (qaHtml || docsHtml) {
        html += `<div class="pa-preview-cols">
            <div class="pa-preview-col pa-preview-col--qa">${qaHtml}</div>
            <div class="pa-preview-col pa-preview-col--docs">${docsHtml}</div>
        </div>`;
    }

    // ========== NOTES ==========
    // DL-299 follow-up: the JSON communication thread lives in `item.client_notes`
    // (same field dashboard's `/admin-recent-messages` parses). `item.notes` is
    // the office free-text bookkeeper field. Mirror dashboard's pairing logic.
    const rawThread = (item.client_notes || '').trim();
    const plainOfficeNotes = (item.notes || '').trim();

    let noteItems = [];
    if (rawThread) {
        try {
            const parsed = JSON.parse(rawThread);
            if (Array.isArray(parsed)) noteItems = parsed;
            else if (parsed && typeof parsed === 'object') noteItems = [parsed];
        } catch {
            // Salvage on malformed JSON — never show raw to the user
            const matches = rawThread.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || [];
            for (const m of matches) { try { noteItems.push(JSON.parse(m)); } catch { /* skip */ } }
        }
    }
    // Partition (mirrors dashboard.ts:197–214): client messages = parents, office_reply children linked via reply_to
    const clientMsgs = noteItems
        .filter(n => n && !n.hidden_from_dashboard && n.source === 'email' && n.type !== 'office_reply');
    const repliesByParent = new Map();
    for (const n of noteItems) {
        if (n && !n.hidden_from_dashboard && n.type === 'office_reply' && n.reply_to) {
            if (!repliesByParent.has(n.reply_to)) repliesByParent.set(n.reply_to, []);
            repliesByParent.get(n.reply_to).push(n);
        }
    }
    // Sort each thread oldest-first (matches dashboard behaviour)
    for (const arr of repliesByParent.values()) {
        arr.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    }
    // Sort parents date-desc (newest conversation first) — matches dashboard listing order
    clientMsgs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    let messagesHtml = '';
    if (clientMsgs.length > 0) {
        messagesHtml = clientMsgs.map(m => {
            const date = m.date ? formatRelativeTime(m.date) : '';
            const text = (m.raw_snippet || m.summary || m.text || '').toString().trim();
            if (!text) return '';
            const replies = repliesByParent.get(m.id) || [];
            const repliesHtml = replies.length > 0
                ? `<div class="msg-thread-replies">${replies.map((r, i) => {
                        const rText = (r.summary || r.raw_snippet || r.text || '').toString().trim();
                        return `<div class="msg-office-reply">
                            <div class="msg-reply-label">${icon('corner-down-left', 'icon-xs')} ${replies.length > 1 ? `תגובת המשרד #${i + 1}` : 'תגובת המשרד'}</div>
                            <div class="msg-reply-text">${escapeHtml(rText)}</div>
                            <div class="msg-reply-date">${escapeHtml(r.date ? formatRelativeTime(r.date) : '')}</div>
                        </div>`;
                    }).join('')}</div>`
                : '';
            return `<div class="msg-row pa-notes-msg-row">
                <div class="msg-content">
                    <div class="msg-meta">
                        <span class="msg-client">${escapeHtml(m.sender_email || item.client_name || 'הלקוח')}</span>
                        <span class="msg-date">${escapeHtml(date)}</span>
                    </div>
                    <div class="msg-summary">"${escapeHtml(text)}"</div>
                    ${repliesHtml}
                </div>
            </div>`;
        }).filter(Boolean).join('');
    }

    // Office free-text notes only if plain text (never dump raw JSON if admin put a thread here by accident)
    const officeNotesIsJson = /^\s*[\[\{]/.test(plainOfficeNotes);
    const plainNotes = officeNotesIsJson ? '' : plainOfficeNotes;

    if (messagesHtml || plainNotes) {
        html += `<div class="pa-preview-section">
            <div class="pa-preview-section-title">${icon('message-square', 'icon-sm')} הערות</div>
            ${messagesHtml ? `<div class="pa-notes-messages">${messagesHtml}</div>` : ''}
            ${plainNotes ? `<div class="pa-preview-notes">${escapeHtml(plainNotes)}</div>` : ''}
        </div>`;
    }

    // ========== QUESTIONS FOR CLIENT ==========
    if (questions.length > 0) {
        html += `<div class="pa-preview-section">
            <div class="pa-preview-section-title">${icon('message-circle', 'icon-sm')} שאלות ללקוח (${questions.length})</div>
            ${questions.map((q, i) => `<div class="pa-preview-question">
                <span class="pa-preview-qnum">${i + 1}.</span>
                <div style="flex:1;">
                    <div>${escapeHtml(q.text || '')}</div>
                    ${q.answer ? `<div class="pa-preview-answer">↳ ${escapeHtml(q.answer)}</div>` : ''}
                </div>
            </div>`).join('')}
        </div>`;
    }

    return html || `<div class="pa-preview-empty"><p>אין נתונים לתצוגה</p></div>`;
}

// DL-295/298/299: inline doc status menu + ✨ suggestion chip + pencil edit + note popover
// DL-299 follow-up 2: reverted — show full d.name (user preferred the verbose client-facing text)
function renderPaDocTagRow(d, reportId) {
    const status = d.status || 'Required_Missing';
    const statusCls = status.toLowerCase().replace(/_/g, '-');
    const docRecordId = d.doc_record_id || d.id || '';
    const nameHtml = renderDocLabel(d.name || '');
    // DL-300 follow-up: ✨ issuer suggestion feature disabled pending UX rework.
    const suggestionRaw = '';
    // DL-299 follow-up: hide chip ONLY when the stored `issuer_name` field already
    // equals the suggestion (a true no-op). Do NOT compare against `d.name` because
    // the full resolved template text may transitively include the issuer substring.
    const _paNormalizeIssuer = (s) => String(s || '')
        .replace(/<\/?b>/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/[\u2013\u2014\-–—]/g, '-')
        .trim()
        .toLowerCase();
    const issuerCurrentNorm = _paNormalizeIssuer(d.issuer_name || '');
    const suggestionNorm = _paNormalizeIssuer(suggestionRaw);
    // Redundant iff: suggestion exists AND issuer_name exists AND they match after normalization
    const suggestion = (suggestionRaw && !(issuerCurrentNorm && issuerCurrentNorm === suggestionNorm))
        ? suggestionRaw : '';
    const docId = d.doc_id || d.doc_record_id || d.id || '';
    const templateId = d.template_id || '';
    const hasNote = !!(d.bookkeepers_notes && String(d.bookkeepers_notes).trim());
    const suggestChip = suggestion
        ? `<button class="pa-doc-row__suggest pa-suggest-chip"
            title="${escapeHtml('שנה שם לגורם המנפיק: ' + suggestion)}"
            data-doc-id="${escapeAttr(docId)}"
            data-suggestion="${escapeAttr(suggestion)}"
            data-report-id="${escapeAttr(reportId)}"
            onclick="event.stopPropagation(); acceptIssuerSuggestion(this)">
            <span class="pa-suggest-chip__icon">✨</span>
            <strong>${escapeHtml(suggestion.length > 22 ? suggestion.slice(0, 22) + '…' : suggestion)}</strong>
            <span class="pa-suggest-chip__check">✓</span>
        </button>`
        : '';
    // DL-299: pencil (manual issuer edit) — always shown; COMPANY_TEMPLATES get a "החלף חברה" combobox
    const pencilBtn = `<button class="pa-doc-row__edit"
        title="ערוך שם"
        data-report-id="${escapeAttr(reportId)}"
        data-doc-id="${escapeAttr(docId)}"
        data-template-id="${escapeAttr(templateId)}"
        onclick="event.stopPropagation(); openPaIssuerEdit(this)">
        ${icon('pencil', 'icon-xs')}
    </button>`;
    // DL-299: per-doc bookkeepers_notes popover
    const noteBtn = `<button class="pa-doc-row__note ${hasNote ? 'pa-doc-row__note--has-content' : ''}"
        title="${hasNote ? 'ערוך הערה' : 'הוסף הערה'}"
        data-report-id="${escapeAttr(reportId)}"
        data-doc-id="${escapeAttr(docId)}"
        onclick="event.stopPropagation(); openPaDocNotePopover(event, this)">
        ${icon(hasNote ? 'message-square-text' : 'message-square', 'icon-xs')}
    </button>`;
    // DL-299 follow-up: drop the X/status chip — all docs at Pending_Approval are
    // Required_Missing. Show ✓ icon for Received; text label for other non-Missing states.
    const statusLabelInline = status === 'Received'
        ? `<span class="pa-doc-row__status-label pa-doc-row__status-label--received" title="התקבל">${icon('check', 'icon-xs')}</span>`
        : (status && status !== 'Required_Missing')
        ? `<span class="pa-doc-row__status-label" title="${escapeHtml(statusLabel(status, true))}">${escapeHtml(statusLabel(status, true))}</span>`
        : '';
    const rowCls = status === 'Waived' ? 'pa-preview-doc-row pa-preview-doc-row--waived'
                 : status === 'Received' ? 'pa-preview-doc-row pa-preview-doc-row--received'
                 : 'pa-preview-doc-row';
    // DL-302: data-template-id powers the answer↔doc cross-highlight. `d.type` is the
    // SSOT template id (e.g. "T501"). Orphan flagging happens at wire-up time.
    const docTemplateId = d.type || d.template_id || '';
    return `<div class="${rowCls}" data-doc-id="${escapeAttr(docId)}" data-report-id="${escapeAttr(reportId)}" data-template-id="${escapeAttr(docTemplateId)}" tabindex="0">
        <span class="pa-preview-doc-name pa-doc-tag-clickable"
              data-report-id="${escapeAttr(reportId)}"
              data-doc-record-id="${escapeAttr(docRecordId)}"
              data-status="${escapeAttr(status)}"
              onclick="openPaDocTagMenu(event, this)">${nameHtml}</span>
        ${statusLabelInline}
        ${suggestChip}
        <span class="pa-doc-row__actions">${pencilBtn}${noteBtn}</span>
    </div>`;
}

// ============================================================================
// DL-302: PA card answer ↔ doc hover cross-highlight (brushing & linking)
// Hover/focus a free-text answer → tint matching doc rows by template id.
// Hover/focus a doc row → reverse-highlight the source answer(s).
// Touch (coarse pointer): tap to pin, tap outside / same row to clear.
// Orphan docs (no source answer): tooltip "אין שאלה מתאימה", no highlight.
// ============================================================================
const _paLinkState = { pinned: null, isCoarse: false };

function _paLinkResolveCard(el) {
    return el.closest('.pa-preview-cols') || el.closest('.pa-preview-body') || document;
}

function _paLinkClear(scope) {
    const root = scope || document;
    root.querySelectorAll('.pa-link-highlight').forEach(n => n.classList.remove('pa-link-highlight'));
}

function _paLinkApply(sourceEl) {
    const card = _paLinkResolveCard(sourceEl);
    _paLinkClear(card);
    sourceEl.classList.add('pa-link-highlight');
    let templateIds = [];
    if (sourceEl.classList.contains('pa-preview-qa-row')) {
        const raw = sourceEl.getAttribute('data-template-ids') || '';
        templateIds = raw.split(',').map(s => s.trim()).filter(Boolean);
        templateIds.forEach(tid => {
            card.querySelectorAll(`.pa-preview-doc-row[data-template-id="${CSS.escape(tid)}"]`)
                .forEach(n => n.classList.add('pa-link-highlight'));
        });
    } else if (sourceEl.classList.contains('pa-preview-doc-row')) {
        const tid = sourceEl.getAttribute('data-template-id') || '';
        if (!tid) return;
        card.querySelectorAll('.pa-preview-qa-row[data-template-ids]').forEach(row => {
            const ids = (row.getAttribute('data-template-ids') || '').split(',').map(s => s.trim());
            if (ids.includes(tid)) row.classList.add('pa-link-highlight');
        });
    }
}

function _paLinkOn(sourceEl) {
    if (!sourceEl) return;
    _paLinkApply(sourceEl);
}

function _paLinkOff(sourceEl) {
    // On mobile, only clear via the dedicated outside-click path.
    if (_paLinkState.pinned) return;
    _paLinkClear(_paLinkResolveCard(sourceEl));
}

function _paLinkAnnotateOrphans(card) {
    // Orphan = no mapping exists in the system at all (uploaded, AI-classified,
    // or DL-301 add-doc). NOT "no rendered answer matches" — many docs come
    // from yes/no questions whose source row is filtered out of freeAnswers
    // (DL-299), and those should stay un-marked.
    // Source: data-mapped-tids on the card root, set by buildPaCard from the
    // backend `mapped_template_ids` payload.
    const cardRoot = card.closest('.pa-card') || card;
    const mappedRaw = cardRoot.getAttribute('data-mapped-tids') || '';
    if (mappedRaw) {
        const mapped = new Set(mappedRaw.split(',').map(s => s.trim()).filter(Boolean));
        card.querySelectorAll('.pa-preview-doc-row[data-template-id]').forEach(row => {
            const tid = row.getAttribute('data-template-id');
            if (!tid || !mapped.has(tid)) {
                row.classList.add('pa-preview-doc-row--orphan');
                if (!row.hasAttribute('title')) row.setAttribute('title', 'אין שאלה מתאימה');
            }
        });
        return;
    }
    // Fallback (no backend list yet — old cached payload): only mark docs with
    // no template id at all, never mark mapped-but-unrendered docs as orphans.
    card.querySelectorAll('.pa-preview-doc-row').forEach(row => {
        const tid = row.getAttribute('data-template-id');
        if (!tid) row.classList.add('pa-preview-doc-row--orphan');
    });
}

function bindPaLinkHover(rootEl) {
    if (!rootEl) return;
    _paLinkState.isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    _paLinkAnnotateOrphans(rootEl);

    const isLinkable = (el) =>
        el && (
            (el.classList.contains('pa-preview-qa-row') && el.hasAttribute('data-template-ids'))
            || (el.classList.contains('pa-preview-doc-row') && el.getAttribute('data-template-id')
                && !el.classList.contains('pa-preview-doc-row--orphan'))
        );

    rootEl.addEventListener('mouseover', (e) => {
        if (_paLinkState.isCoarse || _paLinkState.pinned) return;
        const row = e.target.closest('.pa-preview-qa-row, .pa-preview-doc-row');
        if (isLinkable(row)) _paLinkOn(row);
    });
    rootEl.addEventListener('mouseout', (e) => {
        if (_paLinkState.isCoarse || _paLinkState.pinned) return;
        const row = e.target.closest('.pa-preview-qa-row, .pa-preview-doc-row');
        if (!row) return;
        const next = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.pa-preview-qa-row, .pa-preview-doc-row');
        if (next === row) return;
        _paLinkOff(row);
    });
    rootEl.addEventListener('focusin', (e) => {
        if (_paLinkState.pinned) return;
        const row = e.target.closest('.pa-preview-qa-row, .pa-preview-doc-row');
        if (isLinkable(row)) _paLinkOn(row);
    });
    rootEl.addEventListener('focusout', (e) => {
        if (_paLinkState.pinned) return;
        const row = e.target.closest('.pa-preview-qa-row, .pa-preview-doc-row');
        if (row) _paLinkOff(row);
    });
    // Touch: tap to pin, tap same row again to clear. Outside tap handled below.
    rootEl.addEventListener('click', (e) => {
        if (!_paLinkState.isCoarse) return;
        // Don't hijack the existing doc-tag menu / pencil / note buttons
        if (e.target.closest('.pa-doc-tag-clickable, .pa-doc-row__edit, .pa-doc-row__note, .pa-doc-row__suggest, button')) return;
        const row = e.target.closest('.pa-preview-qa-row, .pa-preview-doc-row');
        if (!isLinkable(row)) return;
        if (_paLinkState.pinned === row) {
            _paLinkState.pinned = null;
            _paLinkClear(rootEl);
        } else {
            _paLinkState.pinned = row;
            _paLinkApply(row);
        }
    });
    document.addEventListener('click', (e) => {
        if (!_paLinkState.pinned) return;
        if (rootEl.contains(e.target)) return;
        _paLinkState.pinned = null;
        _paLinkClear(rootEl);
    });
}

function openPaDocTagMenu(event, tagEl) {
    event.stopPropagation();

    // Toggle: re-clicking the currently-open tag closes the menu.
    if (tagEl.classList.contains('ai-doc-tag-active')) {
        closeDocTagMenu();
        return;
    }
    closeDocTagMenu();

    const currentStatus = tagEl.dataset.status || 'Required_Missing';
    const docRecordId = tagEl.dataset.docRecordId;
    const reportId = tagEl.dataset.reportId;
    if (!docRecordId || !reportId) return;

    const options = [
        { status: 'Required_Missing', label: 'חסר', icon: '○' },
        { status: 'Received', label: 'התקבל', icon: '✓' },
        { status: 'Waived', label: 'לא נדרש', icon: '—' },
    ].filter(o => o.status !== currentStatus);

    const menu = document.createElement('div');
    menu.className = 'ai-doc-tag-menu';
    menu.innerHTML = options.map(o =>
        `<button class="ai-doc-tag-menu-item" data-new-status="${o.status}" onclick="selectPaDocTagStatus(event, this)">
            <span class="ai-doc-tag-menu-icon">${o.icon}</span> ${o.label}
        </button>`
    ).join('');

    // Position absolute (document-relative) so the menu scrolls with the page.
    const rect = tagEl.getBoundingClientRect();
    const sx = window.scrollX || window.pageXOffset || 0;
    const sy = window.scrollY || window.pageYOffset || 0;
    menu.style.position = 'absolute';
    menu.style.top = (rect.bottom + sy + 4) + 'px';
    menu.style.left = (rect.left + sx) + 'px';
    menu.dataset.docRecordId = docRecordId;
    menu.dataset.reportId = reportId;

    document.body.appendChild(menu);
    tagEl.classList.add('ai-doc-tag-active');

    requestAnimationFrame(() => {
        document._docTagMenuClose = (e) => {
            if (menu.contains(e.target)) return;
            // Click on the same tag that opened the menu: suppress the bubble
            // onclick so it doesn't re-open right after we close.
            if (tagEl.contains(e.target)) {
                e.stopImmediatePropagation();
            }
            closeDocTagMenu();
        };
        document.addEventListener('click', document._docTagMenuClose, { capture: true });
    });
}

function selectPaDocTagStatus(event, btnEl) {
    event.stopPropagation();
    const menu = btnEl.closest('.ai-doc-tag-menu');
    const docRecordId = menu.dataset.docRecordId;
    const reportId = menu.dataset.reportId;
    const newStatus = btnEl.dataset.newStatus;
    closeDocTagMenu();
    updatePaDocStatusInline(reportId, docRecordId, newStatus);
}

function applyPaDocStatusChange(reportId, docRecordId, newStatus) {
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return null;
    let previousStatus = null;
    // Update doc_groups (preview source)
    const groups = Array.isArray(item.doc_groups) ? item.doc_groups : [];
    for (const g of groups) {
        const cats = Array.isArray(g.categories) ? g.categories : [];
        for (const cat of cats) {
            const docs = Array.isArray(cat.docs) ? cat.docs : [];
            for (const d of docs) {
                if ((d.doc_record_id || d.id) === docRecordId) {
                    previousStatus = d.status || 'Required_Missing';
                    d.status = newStatus;
                }
            }
        }
    }
    // Update doc_chips (master card source)
    const chips = Array.isArray(item.doc_chips) ? item.doc_chips : [];
    for (const c of chips) {
        if ((c.doc_id || c.id) === docRecordId) c.status = newStatus;
    }
    return previousStatus;
}

async function updatePaDocStatusInline(reportId, docRecordId, newStatus) {
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return;

    const previousStatus = applyPaDocStatusChange(reportId, docRecordId, newStatus);
    if (previousStatus === null || previousStatus === newStatus) return;

    // DL-298: re-render the single stacked card in place (no preview panel anymore)
    const card = document.querySelector(`.pa-card[data-report-id="${CSS.escape(reportId)}"]`);
    if (card) {
        card.outerHTML = buildPaCard(item);
        safeCreateIcons(document.getElementById('paCardsContainer') || document);
    }

    const payload = {
        data: {
            fields: [{ type: 'HIDDEN_FIELDS', value: { report_record_id: reportId } }],
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
        showAIToast(statusLabels[newStatus] || 'הסטטוס עודכן', 'success');
    } catch (err) {
        // Rollback
        applyPaDocStatusChange(reportId, docRecordId, previousStatus);
        const card2 = document.querySelector(`.pa-card[data-report-id="${CSS.escape(reportId)}"]`);
        if (card2) {
            card2.outerHTML = buildPaCard(item);
            safeCreateIcons(document.getElementById('paCardsContainer') || document);
        }
        showAIToast('שגיאה בעדכון סטטוס המסמך', 'danger');
        console.error('DL-295: PA status update failed', err);
    }
}

// DL-298: removed buildPaPreviewFooter + buildPaPreviewHtml (no preview panel; card renders body inline).

// ==================== DL-301: PA card add-doc affordance ====================
// Lazy-fetched template catalog, keyed by client_id. Shape: { apiTemplates, apiCategories, filingType }
const _paTemplateCache = new Map();
// Active popover state
let _paAddDocState = null;
// Key for the templates/categories dataset we last fetched per report; reset when report switches
const _paTemplatePending = new Map(); // clientId -> Promise

async function ensurePaTemplatesLoaded(clientId, reportId, filingType) {
    if (!clientId || !reportId) throw new Error('missing client/report');
    const cached = _paTemplateCache.get(clientId);
    if (cached && cached.filingType === filingType) return cached;
    if (_paTemplatePending.has(clientId)) return _paTemplatePending.get(clientId);

    const p = (async () => {
        const resp = await fetchWithTimeout(
            `${ENDPOINTS.GET_CLIENT_DOCUMENTS}?report_id=${encodeURIComponent(reportId)}&mode=office`,
            { headers: { 'Authorization': `Bearer ${authToken}` } },
            FETCH_TIMEOUTS.quick
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const entry = {
            apiTemplates: Array.isArray(data.templates) ? data.templates : [],
            apiCategories: Array.isArray(data.categories_list) ? data.categories_list : [],
            filingType
        };
        _paTemplateCache.set(clientId, entry);
        return entry;
    })();
    _paTemplatePending.set(clientId, p);
    try { return await p; } finally { _paTemplatePending.delete(clientId); }
}

function renderPaAddDocRow(reportId, person) {
    return `<div class="pa-preview-doc-row pa-preview-doc-row--add"
        data-report-id="${escapeAttr(reportId)}"
        data-person="${escapeAttr(person)}"
        role="button" tabindex="0"
        onclick="openPaAddDocPopover(event, this)"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPaAddDocPopover(event, this);}">
        <span class="pa-add-doc-icon">${icon('plus', 'icon-xs')}</span>
        <span class="pa-add-doc-label">הוסף מסמך</span>
    </div>`;
}

function _paStripBold(s) { return (s || '').replace(/<\/?b>/g, '').replace(/\*\*/g, ''); }

function _paResolveTemplateName(tpl, collectedValues, item) {
    const vals = {
        year: item.year || '',
        spouse_name: item.spouse_name || '',
        ...(collectedValues || {})
    };
    let nameHe = tpl.name_he || '';
    let nameEn = tpl.name_en || '';
    for (const [k, v] of Object.entries(vals)) {
        const re = new RegExp(`\\{${k}\\}`, 'g');
        nameHe = nameHe.replace(re, v);
        nameEn = nameEn.replace(re, v);
    }
    return { nameHe: _paStripBold(nameHe), nameEn: _paStripBold(nameEn) };
}

function _paComputeIssuerKey(collectedValues) {
    const autoVars = ['year', 'spouse_name'];
    const parts = Object.entries(collectedValues || {})
        .filter(([k]) => !autoVars.includes(k))
        .map(([, v]) => (v || '').toString().trim())
        .filter(Boolean);
    return parts.join(' ').trim();
}

function paDocIsDuplicate(item, pendingDoc) {
    const groups = Array.isArray(item.doc_groups) ? item.doc_groups : [];
    const targetTpl = (pendingDoc.template_id || '').toLowerCase();
    const targetKey = (pendingDoc.issuer_key || '').toLowerCase();
    const targetName = (pendingDoc.issuer_name || '').toLowerCase().trim();
    for (const g of groups) {
        for (const cat of (g.categories || [])) {
            for (const d of (cat.docs || [])) {
                if (d.status === 'Waived') continue;
                const dType = (d.type || '').toLowerCase();
                if (targetTpl === 'general_doc') {
                    // Custom: match on general_doc name case-insensitive
                    if (dType === 'general_doc') {
                        const dName = ((d.issuer_name || d.name || '') + '').toLowerCase().trim();
                        if (dName === targetName) return true;
                    }
                } else {
                    if (dType !== targetTpl) continue;
                    const dKey = ((d.issuer_key || '') + '').toLowerCase();
                    if (dKey === targetKey) return true;
                }
            }
        }
    }
    return false;
}

function closePaAddDocPopover() {
    const pop = document.getElementById('paAddDocPopover');
    if (pop) pop.remove();
    if (document._paAddDocClose) {
        document.removeEventListener('click', document._paAddDocClose, { capture: true });
        document._paAddDocClose = null;
    }
    if (document._paAddDocKey) {
        document.removeEventListener('keydown', document._paAddDocKey);
        document._paAddDocKey = null;
    }
    _paAddDocState = null;
}

function openPaAddDocPopover(event, rowEl) {
    if (event) event.stopPropagation();
    if (_paAddDocState) { closePaAddDocPopover(); }

    const reportId = rowEl.dataset.reportId;
    const person = rowEl.dataset.person || 'client';
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return;

    _paAddDocState = {
        reportId, person,
        step: 'pick',
        selectedTpl: null,
        collectedValues: null,
        pendingDoc: null,
        loaded: false
    };

    const pop = document.createElement('div');
    pop.id = 'paAddDocPopover';
    pop.className = 'pa-add-doc-popover';
    pop.onclick = (e) => e.stopPropagation();
    pop.innerHTML = `
        <button type="button" class="pa-add-doc-close" aria-label="סגור" title="סגור" onclick="closePaAddDocPopover()">
            ${icon('x', 'icon-xs')}
        </button>
        <div class="pa-add-doc-body" id="paAddDocBody"><div class="pa-add-doc-loading">טוען תבניות…</div></div>`;
    document.body.appendChild(pop);
    safeCreateIcons(pop);

    // Position (absolute, document-relative so popover scrolls with the page)
    const rect = rowEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sx = window.scrollX || window.pageXOffset || 0;
    const sy = window.scrollY || window.pageYOffset || 0;
    const POP_W = 340;
    const POP_H = 420;
    const GAP = 6;
    const PAD = 8;
    const openBelow = (vh - rect.bottom - GAP) >= POP_H;
    pop.style.top = openBelow
        ? (rect.bottom + sy + GAP) + 'px'
        : (rect.top + sy - POP_H - GAP) + 'px';
    pop.style.bottom = '';
    // Anchor to the row's right edge in viewport coords, clamped within viewport
    const rightInViewport = Math.max(PAD, Math.min(vw - rect.right, vw - POP_W - PAD));
    pop.style.left = (vw - rightInViewport - POP_W + sx) + 'px';
    pop.style.right = 'auto';

    // Bind close handlers
    requestAnimationFrame(() => {
        document._paAddDocClose = (e) => {
            const p = document.getElementById('paAddDocPopover');
            if (p && !p.contains(e.target) && !rowEl.contains(e.target)) closePaAddDocPopover();
        };
        document._paAddDocKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); closePaAddDocPopover(); }
        };
        document.addEventListener('click', document._paAddDocClose, { capture: true });
        document.addEventListener('keydown', document._paAddDocKey);
    });

    // Fetch + render
    ensurePaTemplatesLoaded(item.client_id, item.report_id, item.filing_type)
        .then(() => {
            if (!_paAddDocState) return;
            _paAddDocState.loaded = true;
            _paRenderAddDocPick();
        })
        .catch((err) => {
            console.error('DL-301: template fetch failed', err);
            const p = document.getElementById('paAddDocPopover');
            if (p) p.innerHTML = `<div class="pa-add-doc-error">שגיאה בטעינת תבניות. נסה שוב.</div>`;
        });
}

function _paRenderAddDocPick() {
    const st = _paAddDocState;
    if (!st) return;
    const pop = document.getElementById('paAddDocPopover');
    if (!pop) return;
    const item = pendingApprovalData.find(i => i.report_id === st.reportId);
    if (!item) return;
    const cached = _paTemplateCache.get(item.client_id);
    if (!cached) return;

    const body = document.getElementById('paAddDocBody') || pop;
    const filingType = item.filing_type || 'annual_report';
    const relevant = cached.apiTemplates
        .filter(t => !t.filing_type || t.filing_type === filingType)
        .filter(t => _paTemplateMatchesPerson(t, st.person));

    // Group by category, preserving order from apiCategories
    const groups = {};
    for (const tpl of relevant) {
        const cid = tpl.category || 'other';
        if (!groups[cid]) groups[cid] = [];
        groups[cid].push(tpl);
    }

    const personSelector = item.spouse_name
        ? `<div class="pa-add-doc-person">
            <button type="button" class="pa-add-doc-person-btn${st.person === 'client' ? ' active' : ''}" data-person="client" onclick="paAddDocSetPerson('client')">👤 ${escapeHtml(item.client_name || 'לקוח')}</button>
            <button type="button" class="pa-add-doc-person-btn${st.person === 'spouse' ? ' active' : ''}" data-person="spouse" onclick="paAddDocSetPerson('spouse')">👥 ${escapeHtml(item.spouse_name)}</button>
        </div>`
        : '';

    let listHtml = '';
    for (const cat of cached.apiCategories) {
        const catTpls = groups[cat.id];
        if (!catTpls || catTpls.length === 0) continue;
        const items = catTpls.map(tpl => {
            const display = _paFormatTemplateTitle(tpl, item, null);
            return `<div class="pa-add-doc-option" data-template-id="${escapeAttr(tpl.template_id)}" onclick="paAddDocPickTemplate('${escapeAttr(tpl.template_id)}')">${escapeHtml(display)}</div>`;
        }).join('');
        listHtml += `<div class="pa-add-doc-cat">${escapeHtml((cat.emoji || '') + ' ' + (cat.name_he || ''))}</div>${items}`;
    }
    if (!listHtml) listHtml = `<div class="pa-add-doc-empty">אין תבניות זמינות</div>`;

    body.innerHTML = `
        ${personSelector}
        <input type="text" class="pa-add-doc-search" id="paAddDocSearch" placeholder="🔍 חפש מסמך..." dir="rtl" autocomplete="off" oninput="paAddDocFilter(this.value)">
        <div class="pa-add-doc-list" id="paAddDocList">${listHtml}</div>
        <div class="pa-add-doc-divider">או מסמך מותאם אישית</div>
        <div class="pa-add-doc-custom">
            <input type="text" id="paAddDocCustomInput" placeholder="שם המסמך..." dir="auto"
                onkeydown="if(event.key==='Enter'){event.preventDefault();paAddCustomDocSubmit();}">
            <button type="button" class="pa-add-doc-custom-btn" onclick="paAddCustomDocSubmit()">
                ${icon('plus', 'icon-xs')} הוסף
            </button>
        </div>
        <div class="pa-add-doc-warning" id="paAddDocWarning" style="display:none;"></div>`;

    safeCreateIcons(pop);
    const search = document.getElementById('paAddDocSearch');
    if (search) setTimeout(() => search.focus(), 50);
}

// DL-301: template scope filter.
// Airtable `scope` values (verified live): CLIENT, SPOUSE, PERSON, GLOBAL_SINGLE, empty.
//  - CLIENT       → client only
//  - SPOUSE       → spouse only
//  - PERSON       → either (disability/maternity — whoever the event applies to)
//  - GLOBAL_SINGLE→ either (single-per-report like T002 ID update)
//  - empty        → either (defensive default)
function _paTemplateMatchesPerson(tpl, person) {
    const scope = (tpl.scope || '').toString().trim().toUpperCase();
    if (scope === 'CLIENT') return person === 'client';
    if (scope === 'SPOUSE') return person === 'spouse';
    return true; // PERSON, GLOBAL_SINGLE, empty, unknown → show for either
}

function paAddDocSetPerson(person) {
    if (!_paAddDocState) return;
    if (_paAddDocState.person === person) return;
    _paAddDocState.person = person;
    // Re-render pick step so the template list re-filters by scope
    if (_paAddDocState.step === 'pick' || !_paAddDocState.step) {
        _paRenderAddDocPick();
    }
}

function paAddDocFilter(query) {
    const list = document.getElementById('paAddDocList');
    if (!list) return;
    const q = (query || '').trim().toLowerCase();
    const options = list.querySelectorAll('.pa-add-doc-option');
    const cats = list.querySelectorAll('.pa-add-doc-cat');
    // First pass: show/hide options
    options.forEach(o => {
        const txt = (o.textContent || '').toLowerCase();
        o.style.display = (!q || txt.includes(q)) ? '' : 'none';
    });
    // Second pass: hide category label if no visible option follows until next cat/end
    cats.forEach(c => {
        let sib = c.nextElementSibling;
        let hasVisible = false;
        while (sib && !sib.classList.contains('pa-add-doc-cat')) {
            if (sib.classList.contains('pa-add-doc-option') && sib.style.display !== 'none') {
                hasVisible = true; break;
            }
            sib = sib.nextElementSibling;
        }
        c.style.display = hasVisible ? '' : 'none';
    });
}

function paAddDocPickTemplate(templateId) {
    const st = _paAddDocState;
    if (!st) return;
    const item = pendingApprovalData.find(i => i.report_id === st.reportId);
    if (!item) return;
    const cached = _paTemplateCache.get(item.client_id);
    const tpl = cached && cached.apiTemplates.find(t => t.template_id === templateId);
    if (!tpl) return;

    st.selectedTpl = tpl;
    const autoVars = ['year', 'spouse_name'];
    const userVars = (tpl.variables || []).filter(v => !autoVars.includes(v));

    if (userVars.length > 0) {
        st.step = 'variables';
        _paRenderAddDocVariables(userVars);
    } else {
        st.collectedValues = {};
        _paEnterPreview();
    }
}

// DL-301: mirrors VAR_LABELS in document-manager.js (keep in sync)
const _PA_VAR_LABELS = {
    issuer_name: 'שם החברה / המנפיק',
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
    client_name: 'שם המבוטח',
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
    year: 'שנה',
    year_plus_1: 'שנה עוקבת',
    survivor_details: 'פרטי שארים',
    relationship_details: 'פרטי ההנצחה',
    medical_details: 'פרטים רפואיים'
};

function _paFormatTemplateTitle(tpl, item, collectedValues) {
    const labels = _PA_VAR_LABELS;
    const vals = { year: item.year || '', spouse_name: item.spouse_name || '', ...(collectedValues || {}) };
    let name = (tpl.name_he || '');
    name = name.replace(/\{([^}]+)\}/g, (_, key) => {
        const v = (vals[key] || '').toString().trim();
        if (v) return v;
        return `[${labels[key] || key}]`;
    });
    return _paStripBold(name);
}

function _paRenderAddDocVariables(userVars) {
    const st = _paAddDocState;
    const pop = document.getElementById('paAddDocPopover');
    if (!pop || !st || !st.selectedTpl) return;
    const item = pendingApprovalData.find(i => i.report_id === st.reportId);
    const initialTitle = _paFormatTemplateTitle(st.selectedTpl, item, null);
    const body = document.getElementById('paAddDocBody') || pop;

    const fields = userVars.map(v => {
        const label = _PA_VAR_LABELS[v] || v;
        return `<div class="pa-add-doc-var-row">
            <label>${escapeHtml(label)}</label>
            <input type="text" class="pa-add-doc-var-input" data-var="${escapeAttr(v)}" dir="rtl" placeholder="${escapeHtml(label)}">
        </div>`;
    }).join('');

    body.innerHTML = `
        <div class="pa-add-doc-step-title" id="paAddDocStepTitle">${icon('file-text', 'icon-xs')} <span id="paAddDocStepTitleText">${escapeHtml(initialTitle)}</span></div>
        <div class="pa-add-doc-vars">${fields}</div>
        <div class="pa-add-doc-warning" id="paAddDocWarning" style="display:none;"></div>
        <div class="pa-add-doc-actions">
            <button type="button" class="btn btn-sm" onclick="paAddDocBackToPick()">
                ${icon('arrow-right', 'icon-xs')} חזור
            </button>
            <button type="button" class="btn btn-sm btn-primary" onclick="paAddDocConfirmVariables()">
                הבא ${icon('arrow-left', 'icon-xs')}
            </button>
        </div>`;
    safeCreateIcons(pop);
    const inputs = pop.querySelectorAll('.pa-add-doc-var-input');
    if (inputs.length) setTimeout(() => inputs[0].focus(), 50);
    const titleText = document.getElementById('paAddDocStepTitleText');
    const updateTitle = () => {
        if (!titleText) return;
        const collected = {};
        inputs.forEach(inp => { collected[inp.dataset.var] = (inp.value || '').trim(); });
        titleText.textContent = _paFormatTemplateTitle(st.selectedTpl, item, collected);
    };
    inputs.forEach((inp, i) => {
        inp.addEventListener('input', updateTitle);
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (i < inputs.length - 1) inputs[i + 1].focus();
                else paAddDocConfirmVariables();
            }
        });
    });
}

function paAddDocConfirmVariables() {
    const st = _paAddDocState;
    if (!st || !st.selectedTpl) return;
    const autoVars = ['year', 'spouse_name'];
    const userVars = (st.selectedTpl.variables || []).filter(v => !autoVars.includes(v));
    const collected = {};
    const inputs = document.querySelectorAll('.pa-add-doc-var-input');
    let missing = null;
    for (const inp of inputs) {
        const v = inp.dataset.var;
        const val = (inp.value || '').trim();
        if (!val) { missing = inp; break; }
        inp.style.borderColor = '';
        collected[v] = val;
    }
    if (missing) {
        missing.style.borderColor = 'var(--danger-500)';
        missing.focus();
        _paShowAddDocWarning('יש למלא את כל השדות');
        return;
    }
    // Ensure we have all userVars keys
    for (const v of userVars) if (!(v in collected)) { return; }
    st.collectedValues = collected;
    _paEnterPreview();
}

function paAddDocBackToPick() {
    if (!_paAddDocState) return;
    _paAddDocState.step = 'pick';
    _paAddDocState.selectedTpl = null;
    _paAddDocState.collectedValues = null;
    _paAddDocState.pendingDoc = null;
    _paRenderAddDocPick();
}

function paAddCustomDocSubmit() {
    const st = _paAddDocState;
    if (!st) return;
    const input = document.getElementById('paAddDocCustomInput');
    const name = (input ? input.value : '').trim();
    if (!name) {
        _paShowAddDocWarning('יש להזין שם מסמך');
        if (input) input.focus();
        return;
    }
    st.selectedTpl = null;
    st.collectedValues = null;
    st.pendingDoc = {
        template_id: 'general_doc',
        category: 'general',
        person: st.person,
        issuer_name: name,
        issuer_name_en: name,
        issuer_key: name
    };
    st._customDisplay = name;
    _paEnterPreview();
}

function _paShowAddDocWarning(msg) {
    const w = document.getElementById('paAddDocWarning');
    if (!w) return;
    w.textContent = msg;
    w.style.display = 'block';
}

function _paEnterPreview() {
    const st = _paAddDocState;
    if (!st) return;
    const item = pendingApprovalData.find(i => i.report_id === st.reportId);
    if (!item) return;

    let pendingDoc;
    let displayName;
    let categoryLabel = '';
    if (st.selectedTpl) {
        const { nameHe, nameEn } = _paResolveTemplateName(st.selectedTpl, st.collectedValues || {}, item);
        const issuerKey = _paComputeIssuerKey(st.collectedValues || {});
        pendingDoc = {
            template_id: st.selectedTpl.template_id,
            category: st.selectedTpl.category || 'general',
            person: st.person,
            issuer_name: nameHe,
            issuer_name_en: nameEn,
            issuer_key: issuerKey
        };
        displayName = nameHe;
        const cached = _paTemplateCache.get(item.client_id);
        const catInfo = cached && cached.apiCategories.find(c => c.id === pendingDoc.category);
        if (catInfo) categoryLabel = `${catInfo.emoji || '📄'} ${catInfo.name_he || ''}`;
    } else if (st.pendingDoc) {
        pendingDoc = { ...st.pendingDoc, person: st.person };
        displayName = pendingDoc.issuer_name;
        categoryLabel = 'מסמך מותאם אישית';
    } else {
        return;
    }

    st.step = 'preview';
    st.pendingDoc = pendingDoc;

    const isDup = paDocIsDuplicate(item, pendingDoc);
    const personLabel = st.person === 'spouse'
        ? (item.spouse_name ? `👥 ${item.spouse_name}` : '👥 בן/בת הזוג')
        : `👤 ${item.client_name || 'לקוח'}`;

    const pop = document.getElementById('paAddDocPopover');
    if (!pop) return;
    const body = document.getElementById('paAddDocBody') || pop;
    body.innerHTML = `
        <div class="pa-add-doc-step-title">${icon('eye', 'icon-xs')} תצוגה מקדימה</div>
        <div class="pa-add-doc-preview">
            <div class="pa-add-doc-preview-name">${escapeHtml(displayName)}</div>
            <div class="pa-add-doc-preview-meta">
                ${categoryLabel ? `<span>${escapeHtml(categoryLabel)}</span>` : ''}
                <span>${escapeHtml(personLabel)}</span>
            </div>
        </div>
        <div class="pa-add-doc-warning" id="paAddDocWarning" style="${isDup ? '' : 'display:none;'}">${isDup ? 'מסמך זה כבר קיים ברשימה' : ''}</div>
        <div class="pa-add-doc-actions">
            <button type="button" class="btn btn-sm" onclick="paAddDocBackToPick()">
                ${icon('arrow-right', 'icon-xs')} חזור
            </button>
            <button type="button" class="btn btn-sm btn-success" id="paAddDocConfirmBtn" onclick="paAddDocConfirm()" ${isDup ? 'disabled' : ''}>
                ${icon('check', 'icon-xs')} הוסף לרשימה
            </button>
        </div>`;
    safeCreateIcons(pop);
}

function _paApplyOptimisticAdd(item, pendingDoc, placeholderId) {
    const cached = _paTemplateCache.get(item.client_id);
    const catInfo = cached && cached.apiCategories.find(c => c.id === pendingDoc.category);
    const catName = catInfo ? (catInfo.name_he || catInfo.name || '') : (pendingDoc.category || 'מסמך');
    const catEmoji = catInfo ? (catInfo.emoji || '📄') : '📄';

    // Find or create person group
    const groups = Array.isArray(item.doc_groups) ? item.doc_groups : (item.doc_groups = []);
    let group = groups.find(g => g.person === pendingDoc.person);
    if (!group) {
        group = {
            person: pendingDoc.person,
            person_label: pendingDoc.person === 'spouse'
                ? `מסמכים של ${item.spouse_name || 'בן/בת הזוג'}`
                : `מסמכים של ${item.client_name}`,
            categories: []
        };
        groups.push(group);
    }
    // Find or create category
    let cat = (group.categories || []).find(c => (c.id === pendingDoc.category) || (c.name === catName));
    if (!cat) {
        cat = { id: pendingDoc.category, name: catName, emoji: catEmoji, docs: [] };
        (group.categories = group.categories || []).push(cat);
    }
    const newDoc = {
        doc_record_id: placeholderId,
        doc_id: placeholderId,
        id: placeholderId,
        type: pendingDoc.template_id,
        category: pendingDoc.category,
        person: pendingDoc.person,
        issuer_name: pendingDoc.issuer_name,
        issuer_name_en: pendingDoc.issuer_name_en,
        issuer_key: pendingDoc.issuer_key,
        name: pendingDoc.issuer_name,
        name_short: pendingDoc.issuer_name,
        status: 'Required_Missing'
    };
    cat.docs = cat.docs || [];
    cat.docs.push(newDoc);

    // Mirror into doc_chips (flat master list)
    const chips = Array.isArray(item.doc_chips) ? item.doc_chips : (item.doc_chips = []);
    chips.push({
        doc_id: placeholderId,
        name: pendingDoc.issuer_name,
        name_short: pendingDoc.issuer_name,
        category_emoji: catEmoji,
        status: 'Required_Missing',
        issuer_name_suggested: ''
    });
}

function _paRollbackOptimisticAdd(item, placeholderId) {
    for (const g of (item.doc_groups || [])) {
        for (const cat of (g.categories || [])) {
            if (!Array.isArray(cat.docs)) continue;
            cat.docs = cat.docs.filter(d => (d.doc_record_id || d.doc_id || d.id) !== placeholderId);
        }
    }
    if (Array.isArray(item.doc_chips)) {
        item.doc_chips = item.doc_chips.filter(c => c.doc_id !== placeholderId);
    }
}

async function paAddDocConfirm() {
    const st = _paAddDocState;
    if (!st || !st.pendingDoc) return;
    const item = pendingApprovalData.find(i => i.report_id === st.reportId);
    if (!item) return;

    // Re-check duplicate (state may have changed)
    if (paDocIsDuplicate(item, st.pendingDoc)) {
        _paShowAddDocWarning('מסמך זה כבר קיים ברשימה');
        const btn = document.getElementById('paAddDocConfirmBtn');
        if (btn) btn.disabled = true;
        return;
    }

    const pendingDoc = { ...st.pendingDoc, person: st.person };
    const placeholderId = `pa-new-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Close popover first
    closePaAddDocPopover();

    // Optimistic local update + re-render
    _paApplyOptimisticAdd(item, pendingDoc, placeholderId);
    const card = document.querySelector(`.pa-card[data-report-id="${CSS.escape(item.report_id)}"]`);
    if (card) {
        card.outerHTML = buildPaCard(item);
        safeCreateIcons(document.getElementById('paCardsContainer') || document);
    }

    const payload = {
        data: {
            fields: [{
                type: 'HIDDEN_FIELDS',
                value: {
                    report_record_id: item.report_id,
                    client_name: item.client_name || '',
                    spouse_name: item.spouse_name || '',
                    year: item.year || ''
                }
            }],
            extensions: {
                docs_to_create: [{
                    issuer_name: pendingDoc.issuer_name,
                    issuer_name_en: pendingDoc.issuer_name_en || '',
                    template_id: pendingDoc.template_id,
                    category: pendingDoc.category,
                    person: pendingDoc.person,
                    issuer_key: pendingDoc.issuer_key || ''
                }],
                send_email: false
            }
        }
    };

    try {
        const resp = await fetchWithTimeout(ENDPOINTS.EDIT_DOCUMENTS, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        }, FETCH_TIMEOUTS.mutate);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        showAIToast('המסמך נוסף בהצלחה', 'success');
    } catch (err) {
        console.error('DL-301: add-doc failed', err);
        _paRollbackOptimisticAdd(item, placeholderId);
        const card2 = document.querySelector(`.pa-card[data-report-id="${CSS.escape(item.report_id)}"]`);
        if (card2) {
            card2.outerHTML = buildPaCard(item);
            safeCreateIcons(document.getElementById('paCardsContainer') || document);
        }
        showAIToast('שגיאה בהוספת המסמך', 'danger');
    }
}

// ==================== /DL-301 ====================

function statusLabel(status, verbose = false) {
    if (verbose) {
        const m = { 'Received': 'התקבל', 'Required_Missing': 'חסר', 'Requires_Fix': 'דרוש תיקון', 'Waived': 'פטור' };
        return m[status] || status;
    }
    const map = { 'Received': '✓', 'Required_Missing': '✗', 'Requires_Fix': '⚠', 'Waived': '−' };
    return map[status] || status;
}

// DL-298: removed loadPaMobilePreview + closePaMobilePreview (mobile now uses stacked inline cards like desktop).

// DL-293: Accept a single AI-suggested issuer_name on the Review & Approve card.
async function acceptIssuerSuggestion(btn) {
    if (!btn || btn.disabled) return;
    const docId = btn.dataset.docId;
    const suggestion = btn.dataset.suggestion;
    const reportId = btn.dataset.reportId;
    if (!docId || !suggestion || !reportId) return;

    btn.disabled = true;
    btn.classList.add('pa-suggest-chip--applying');

    const item = pendingApprovalData.find(i => i.report_id === reportId);
    const payload = {
        data: {
            fields: [{ type: 'HIDDEN_FIELDS', value: { report_record_id: reportId } }],
            extensions: {
                name_updates: [{ id: docId, issuer_name: suggestion }],
                send_email: false,
            },
        },
    };

    try {
        const response = await fetchWithTimeout(ENDPOINTS.EDIT_DOCUMENTS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify(payload),
        }, FETCH_TIMEOUTS.mutate);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        // Local state update — clear suggestion across whichever chip source the render uses.
        const chipArrays = [];
        if (item && Array.isArray(item.doc_chips)) chipArrays.push(item.doc_chips);
        if (item && Array.isArray(item.docs)) chipArrays.push(item.docs);
        for (const arr of chipArrays) {
            const doc = arr.find(d => d.doc_id === docId);
            if (doc) {
                doc.issuer_name_suggested = '';
                if ('name' in doc) doc.name = suggestion;
                if ('short_name_he' in doc) doc.short_name_he = suggestion;
            }
        }
        btn.classList.add('pa-suggest-chip--accepted');
        setTimeout(() => { btn.remove(); renderPendingApprovalCards(); }, 220);
        showAIToast('שם הגורם המנפיק עודכן', 'success');
    } catch (err) {
        console.error('[DL-293] acceptIssuerSuggestion failed', err);
        btn.disabled = false;
        btn.classList.remove('pa-suggest-chip--applying');
        showAIToast('שגיאה בעדכון שם הגורם המנפיק', 'danger');
    }
}

// DL-293: Accept all pending issuer_name suggestions for one report in a single batch.
async function acceptAllIssuerSuggestions(reportId) {
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return;
    const source = Array.isArray(item.doc_chips) ? item.doc_chips
                 : Array.isArray(item.docs) ? item.docs : [];
    const updates = source
        .filter(d => (d.issuer_name_suggested || '').trim())
        .map(d => ({ id: d.doc_id, issuer_name: d.issuer_name_suggested.trim() }));
    if (updates.length === 0) return;

    const payload = {
        data: {
            fields: [{ type: 'HIDDEN_FIELDS', value: { report_record_id: reportId } }],
            extensions: { name_updates: updates, send_email: false },
        },
    };

    try {
        const response = await fetchWithTimeout(ENDPOINTS.EDIT_DOCUMENTS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify(payload),
        }, FETCH_TIMEOUTS.mutate);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const chipArrays = [];
        if (Array.isArray(item.doc_chips)) chipArrays.push(item.doc_chips);
        if (Array.isArray(item.docs)) chipArrays.push(item.docs);
        for (const upd of updates) {
            for (const arr of chipArrays) {
                const doc = arr.find(d => d.doc_id === upd.id);
                if (doc) {
                    doc.issuer_name_suggested = '';
                    if ('name' in doc) doc.name = upd.issuer_name;
                    if ('short_name_he' in doc) doc.short_name_he = upd.issuer_name;
                }
            }
        }
        renderPendingApprovalCards();
        showAIToast(`${updates.length} שמות עודכנו`, 'success');
    } catch (err) {
        console.error('[DL-293] acceptAllIssuerSuggestions failed', err);
        showAIToast('שגיאה בעדכון השמות', 'danger');
    }
}

// DL-308: Read-only email preview modal before approve-and-send fires.
function previewApproveEmail(reportId, clientName) {
  if (typeof window.showEmailPreviewModal !== 'function') {
    console.error('[DL-308] email-preview-modal helper not loaded');
    if (typeof showAIToast === 'function') showAIToast('שגיאה בטעינת התצוגה המקדימה', 'danger');
    return;
  }
  return window.showEmailPreviewModal({
    reportId,
    clientName,
    getToken: () => authToken,
    endpoint: ENDPOINTS.APPROVE_AND_SEND,
  });
}

async function approveAndSendFromQueue(reportId, clientName) {
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return;

    const sentDate = item.docs_first_sent_at ? new Date(item.docs_first_sent_at).toLocaleDateString('he-IL') : null;
    const msg = sentDate
        ? `נשלח כבר ב-${sentDate}. לשלוח שוב ל-${clientName}?`
        : `לאשר ולשלוח רשימת מסמכים ל-${clientName}?`;

    showConfirmDialog(msg, async () => {
        // DL-304 follow-up: lock current height so the max-height transition has
        // something to animate from (pattern borrowed from AI-review removeCard).
        const card = document.querySelector(`.pa-card[data-report-id="${reportId}"]`);
        if (card) {
            card.style.maxHeight = card.offsetHeight + 'px';
            card.offsetHeight; // force reflow before toggling class
            card.classList.add('pa-card--sending');
        }

        try {
            const resp = await fetchWithTimeout(
                `${ENDPOINTS.APPROVE_AND_SEND}?report_id=${encodeURIComponent(reportId)}&confirm=1&respond=json`,
                { headers: { 'Authorization': `Bearer ${authToken}` } },
                FETCH_TIMEOUTS.mutate
            );
            const data = await resp.json();

            if (data.ok) {
                showAIToast('נשלח ל' + clientName, 'success');
                // DL-304: also advance the dashboard client row stage 3 → 4 so the
                // stage-3 card count + filtered table update without a manual refresh.
                const dashClient = clientsData.find(c => c.report_id === reportId);
                if (dashClient && dashClient.stage === 'Pending_Approval') {
                    dashClient.stage = 'Collecting_Docs';
                    if (typeof recalculateStats === 'function') recalculateStats();
                    _clientsBaseKey = '';
                    const currentStageFilter = document.getElementById('stageFilter')?.value || '';
                    toggleStageFilter(currentStageFilter, false);
                }
                // DL-304 follow-up: match AI-review pattern — after slide-out ends,
                // remove the card node directly (no full re-render of the list, so
                // siblings don't flash/reposition). Update the backing arrays so
                // counts + future re-renders stay in sync.
                setTimeout(() => {
                    if (card) card.remove();
                    pendingApprovalData = pendingApprovalData.filter(i => i.report_id !== reportId);
                    _paFilteredData    = _paFilteredData.filter(i => i.report_id !== reportId);
                    _paExpanded.delete(reportId);
                    syncPaBadge(pendingApprovalData.length);
                    // Empty-state fallback
                    const container = document.getElementById('paCardsContainer');
                    const emptyState = document.getElementById('paEmptyState');
                    if (_paFilteredData.length === 0) {
                        if (pendingApprovalData.length === 0 && container) container.innerHTML = '';
                        if (emptyState) emptyState.style.display = pendingApprovalData.length === 0 ? '' : 'none';
                        if (pendingApprovalData.length > 0 && container) {
                            container.innerHTML = '<div class="empty-state"><p>לא נמצאו תוצאות לחיפוש</p></div>';
                        }
                    }
                }, 360);
            } else {
                if (card) { card.classList.remove('pa-card--sending'); card.style.maxHeight = ''; }
                showAIToast(data.error || 'שגיאה בשליחה', 'danger');
            }
        } catch (err) {
            if (card) { card.classList.remove('pa-card--sending'); card.style.maxHeight = ''; }
            console.error('[pa-queue] approve failed', err);
            showAIToast('שגיאה בשליחה', 'danger');
        }
    }, sentDate ? 'שלח שוב' : 'אשר ושלח', false);
}

// DL-308: Silent stage 3→4 advance without sending doc-request email.
async function advanceToCollectingDocs(reportId, clientName) {
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return;
    const msg = `להעביר את ${clientName} לשלב איסוף מסמכים?\n\u26a0 לא יישלח אליו מייל עם רשימת המסמכים.`;
    showConfirmDialog(msg, async () => {
        const card = document.querySelector(`.pa-card[data-report-id="${reportId}"]`);
        if (card) {
            card.style.maxHeight = card.offsetHeight + 'px';
            card.offsetHeight;
            card.classList.add('pa-card--sending');
        }
        try {
            const resp = await fetchWithTimeout(ENDPOINTS.ADMIN_CHANGE_STAGE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify({ token: authToken, report_id: reportId, target_stage: 'Collecting_Docs' })
            }, FETCH_TIMEOUTS.mutate);
            const data = await resp.json();
            if (data.ok) {
                showAIToast(`${clientName} הועבר לאיסוף מסמכים — ללא מייל`, 'info');
                const dashClient = clientsData.find(c => c.report_id === reportId);
                if (dashClient && dashClient.stage === 'Pending_Approval') {
                    dashClient.stage = 'Collecting_Docs';
                    if (typeof recalculateStats === 'function') recalculateStats();
                    _clientsBaseKey = '';
                    const currentStageFilter = document.getElementById('stageFilter')?.value || '';
                    toggleStageFilter(currentStageFilter, false);
                }
                setTimeout(() => {
                    if (card) card.remove();
                    pendingApprovalData = pendingApprovalData.filter(i => i.report_id !== reportId);
                    _paFilteredData = _paFilteredData.filter(i => i.report_id !== reportId);
                    _paExpanded.delete(reportId);
                    syncPaBadge(pendingApprovalData.length);
                    const container = document.getElementById('paCardsContainer');
                    const emptyState = document.getElementById('paEmptyState');
                    if (_paFilteredData.length === 0) {
                        if (pendingApprovalData.length === 0 && container) container.innerHTML = '';
                        if (emptyState) emptyState.style.display = pendingApprovalData.length === 0 ? '' : 'none';
                        if (pendingApprovalData.length > 0 && container) {
                            container.innerHTML = '<div class="empty-state"><p>לא נמצאו תוצאות לחיפוש</p></div>';
                        }
                    }
                }, 360);
            } else {
                if (card) { card.classList.remove('pa-card--sending'); card.style.maxHeight = ''; }
                showAIToast(data.error || 'שגיאה', 'danger');
            }
        } catch (err) {
            if (card) { card.classList.remove('pa-card--sending'); card.style.maxHeight = ''; }
            console.error('[DL-308] advance failed', err);
            showAIToast('שגיאה', 'danger');
        }
    }, 'אשר מבלי לשלוח', false);
}

function openQuestionsForClient(reportId) {
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return;
    _paQuestionsReportId = reportId;
    _paQuestionsEditState = Array.isArray(item.client_questions)
        ? item.client_questions.map(q => ({ ...q }))
        : [];
    renderPaQuestionsModal();
    document.getElementById('paQuestionsModal').classList.add('show');
    safeCreateIcons();
}

function closePaQuestionsModal() {
    document.getElementById('paQuestionsModal').classList.remove('show');
    _paQuestionsReportId = null;
    _paQuestionsEditState = [];
}

function renderPaQuestionsModal() {
    const body = document.getElementById('paQuestionsModalBody');
    if (!body) return;
    const qs = _paQuestionsEditState;
    if (qs.length === 0) {
        body.innerHTML = `<p style="color:var(--gray-500);margin-bottom:var(--sp-4);">אין שאלות ללקוח עדיין.</p>
            <button class="btn btn-ghost btn-sm" onclick="addPaQuestion()">${icon('plus', 'icon-sm')} הוסף שאלה</button>`;
        safeCreateIcons(body);
        return;
    }
    body.innerHTML = qs.map((q, idx) => `<div class="pa-question-item" data-idx="${idx}">
        <span class="pa-question-num">${idx + 1}</span>
        <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
            <textarea class="pa-question-input" rows="2" placeholder="שאלה ללקוח..." oninput="updatePaQuestion(${idx}, 'text', this.value)">${escapeHtml(q.text || '')}</textarea>
            ${q.answer ? `<div class="pa-question-answer">↳ תשובה: ${escapeHtml(q.answer)}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="deletePaQuestion(${idx})">${icon('trash-2', 'icon-sm')}</button>
    </div>`).join('') +
    `<button class="btn btn-ghost btn-sm" style="margin-top:var(--sp-3)" onclick="addPaQuestion()">${icon('plus', 'icon-sm')} הוסף שאלה</button>`;
    safeCreateIcons(body);
}

function addPaQuestion() {
    _paQuestionsEditState.push({ id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), text: '', answer: '' });
    renderPaQuestionsModal();
}

function deletePaQuestion(idx) {
    _paQuestionsEditState.splice(idx, 1);
    renderPaQuestionsModal();
}

function updatePaQuestion(idx, field, value) {
    if (_paQuestionsEditState[idx]) _paQuestionsEditState[idx][field] = value;
}

async function savePaClientQuestions() {
    const reportId = _paQuestionsReportId;
    if (!reportId) return;
    const saveBtn = document.getElementById('paQuestionsModalSaveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'שומר...'; }
    try {
        const resp = await fetchWithTimeout(
            ENDPOINTS.EDIT_DOCUMENTS,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify({ report_id: reportId, client_questions: _paQuestionsEditState }),
            },
            FETCH_TIMEOUTS.mutate
        );
        const data = await resp.json();
        if (data.ok) {
            // Update local cache
            const item = pendingApprovalData.find(i => i.report_id === reportId);
            if (item) item.client_questions = [..._paQuestionsEditState];
            closePaQuestionsModal();
            renderPendingApprovalCards();
            showAIToast('שאלות נשמרו', 'success');
        } else {
            showAIToast(data.error || 'שגיאה בשמירה', 'danger');
        }
    } catch (err) {
        console.error('[pa-queue] save questions failed', err);
        showAIToast('שגיאה בשמירה', 'danger');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = `${icon('save', 'icon-sm')} שמור`; safeCreateIcons(saveBtn); }
    }
}

// ==================== DL-299: Per-doc manual issuer edit (pencil → inline input + ✓/✗ + החלף חברה for COMPANY_TEMPLATES) ====================

function _paFindDoc(reportId, docId) {
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return { item: null, doc: null };
    for (const g of (item.doc_groups || [])) {
        for (const cat of (g.categories || [])) {
            for (const doc of (cat.docs || [])) {
                if ((doc.doc_id || doc.doc_record_id || doc.id) === docId) return { item, doc };
            }
        }
    }
    return { item, doc: null };
}

function openPaIssuerEdit(btn) {
    const reportId = btn.dataset.reportId;
    const docId = btn.dataset.docId;
    const templateId = btn.dataset.templateId || '';
    const row = btn.closest('.pa-preview-doc-row');
    if (!row) return;

    // Close any previously open edit
    if (_paActiveIssuerEdit) cancelPaIssuerEdit();
    _paActiveIssuerEdit = { reportId, docId, rowEl: row, originalHtml: row.innerHTML };

    const { doc } = _paFindDoc(reportId, docId);
    // DL-304: keep <b>...</b> markers visible in the edit input so the admin can see
    // which part is bold and preserve/adjust it. Saving writes the raw value back —
    // display uses renderDocLabel() which turns `<b>`/`</b>` back into real bold.
    const currentName = (doc && doc.name ? doc.name : '');
    const showSwap = PA_COMPANY_TEMPLATES.includes(templateId) && Object.keys(paCompanyLinks).length > 0;

    row.innerHTML = `<div class="pa-issuer-edit-row">
        <textarea class="pa-issuer-edit-input" id="paIssuerInput-${escapeAttr(docId)}" dir="auto" rows="1" oninput="_paIssuerEditAutoGrow(this)">${escapeHtml(currentName)}</textarea>
        <button class="pa-issuer-edit-save" title="שמור" onclick="savePaIssuerEdit('${escapeAttr(reportId)}', '${escapeAttr(docId)}')">${icon('check', 'icon-xs')}</button>
        <button class="pa-issuer-edit-cancel" title="ביטול" onclick="cancelPaIssuerEdit()">${icon('x', 'icon-xs')}</button>
        ${showSwap ? `<button class="pa-issuer-swap-toggle" onclick="togglePaIssuerSwap('${escapeAttr(docId)}')" type="button">החלף חברה ▼</button>` : ''}
    </div>
    ${showSwap ? `<div class="pa-issuer-swap-combo" id="paIssuerSwap-${escapeAttr(docId)}" style="display:none;">
        <input type="text" class="pa-issuer-swap-filter" placeholder="חפש חברה..." oninput="filterPaIssuerSwap('${escapeAttr(docId)}', this.value)" />
        <div class="pa-issuer-swap-list" id="paIssuerSwapList-${escapeAttr(docId)}">${_paBuildIssuerSwapList(docId, '')}</div>
    </div>` : ''}`;
    safeCreateIcons(row);

    const input = document.getElementById('paIssuerInput-' + docId);
    if (input) {
        _paIssuerEditAutoGrow(input);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); savePaIssuerEdit(reportId, docId); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelPaIssuerEdit(); }
        });
    }
}

function _paIssuerEditAutoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight + 2) + 'px';
}

function _paBuildIssuerSwapList(docId, filter) {
    const names = Object.keys(paCompanyLinks).sort((a, b) => a.localeCompare(b, 'he'));
    const f = (filter || '').trim().toLowerCase();
    const matched = f ? names.filter(n => n.toLowerCase().includes(f)) : names;
    if (matched.length === 0) return `<div class="pa-issuer-swap-empty">אין תוצאות</div>`;
    return matched.slice(0, 50).map(n =>
        `<button class="pa-issuer-swap-option" onclick="pickPaIssuerSwap('${escapeAttr(docId)}', ${JSON.stringify(n).replace(/"/g, '&quot;')})">${escapeHtml(n)}</button>`
    ).join('');
}

function togglePaIssuerSwap(docId) {
    const combo = document.getElementById('paIssuerSwap-' + docId);
    if (!combo) return;
    combo.style.display = combo.style.display === 'none' ? '' : 'none';
    if (combo.style.display === '') {
        const filterInput = combo.querySelector('.pa-issuer-swap-filter');
        if (filterInput) filterInput.focus();
    }
}

function filterPaIssuerSwap(docId, value) {
    const list = document.getElementById('paIssuerSwapList-' + docId);
    if (list) list.innerHTML = _paBuildIssuerSwapList(docId, value);
}

function pickPaIssuerSwap(docId, name) {
    const input = document.getElementById('paIssuerInput-' + docId);
    if (input) {
        input.value = name;
        input.focus();
    }
    const combo = document.getElementById('paIssuerSwap-' + docId);
    if (combo) combo.style.display = 'none';
}

function cancelPaIssuerEdit() {
    if (!_paActiveIssuerEdit) return;
    const { rowEl, originalHtml } = _paActiveIssuerEdit;
    _paActiveIssuerEdit = null;
    if (rowEl) {
        rowEl.innerHTML = originalHtml;
        safeCreateIcons(rowEl);
    }
}

async function savePaIssuerEdit(reportId, docId) {
    const input = document.getElementById('paIssuerInput-' + docId);
    if (!input) return;
    const newName = input.value.trim();
    if (!newName) { showAIToast('שם ריק', 'warning'); return; }

    const { item, doc } = _paFindDoc(reportId, docId);
    if (!item || !doc) { cancelPaIssuerEdit(); return; }
    const originalName = doc.name || '';
    const hadSuggestion = !!(doc.issuer_name_suggested || '').trim();

    // Optimistic local update
    doc.name = newName;
    if (hadSuggestion) doc.issuer_name_suggested = '';
    // Sync doc_chips parallel array (card header count consistency)
    const chips = Array.isArray(item.doc_chips) ? item.doc_chips : [];
    const chipEntry = chips.find(c => (c.doc_id || c.id) === docId);
    if (chipEntry) {
        chipEntry.name = newName;
        if (hadSuggestion) chipEntry.issuer_name_suggested = '';
    }

    // Exit edit mode (re-render whole card to reflect updated name + chip count)
    _paActiveIssuerEdit = null;
    const card = document.querySelector(`.pa-card[data-report-id="${CSS.escape(reportId)}"]`);
    if (card) {
        card.outerHTML = buildPaCard(item);
        safeCreateIcons(document.getElementById('paCardsContainer') || document);
    }

    const payload = {
        data: {
            fields: [{ type: 'HIDDEN_FIELDS', value: { report_record_id: reportId } }],
            extensions: { name_updates: [{ id: docId, issuer_name: newName }], send_email: false },
        },
    };
    try {
        const resp = await fetchWithTimeout(ENDPOINTS.EDIT_DOCUMENTS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify(payload),
        }, FETCH_TIMEOUTS.mutate);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        showAIToast('שם עודכן', 'success');
    } catch (err) {
        // Rollback
        doc.name = originalName;
        if (hadSuggestion) doc.issuer_name_suggested = doc.issuer_name_suggested || '';
        if (chipEntry) { chipEntry.name = originalName; }
        const card2 = document.querySelector(`.pa-card[data-report-id="${CSS.escape(reportId)}"]`);
        if (card2) {
            card2.outerHTML = buildPaCard(item);
            safeCreateIcons(document.getElementById('paCardsContainer') || document);
        }
        showAIToast('שגיאה בעדכון השם', 'danger');
        console.error('[DL-299] savePaIssuerEdit failed', err);
    }
}

// ==================== DL-299: Per-doc bookkeepers_notes popover (immediate save on close) ====================

function openPaDocNotePopover(event, btn) {
    event.stopPropagation();
    const reportId = btn.dataset.reportId;
    const docId = btn.dataset.docId;
    const popover = document.getElementById('paNotePopover');
    const textarea = document.getElementById('paNotePopoverText');
    if (!popover || !textarea) return;

    // Toggle off if same doc clicked again
    if (_paActiveNoteDocId === docId) { closePaDocNotePopover(); return; }
    if (_paActiveNoteDocId) closePaDocNotePopover();

    const { doc } = _paFindDoc(reportId, docId);
    const currentNote = doc ? (doc.bookkeepers_notes || '') : '';
    _paActiveNoteDocId = docId;
    _paActiveNoteReportId = reportId;
    _paActiveNoteOriginal = currentNote;
    textarea.value = currentNote;

    // Position anchored to button (flip-above when near viewport bottom) — mirrors doc-manager openNotePopover math
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const POP_W = 300;
    const POP_H = 160;
    const GAP = 6;
    const PAD = 8;
    if (vh - rect.bottom - GAP >= POP_H) {
        popover.style.top = (rect.bottom + GAP) + 'px';
        popover.style.bottom = '';
    } else {
        popover.style.top = '';
        popover.style.bottom = (vh - rect.top + GAP) + 'px';
    }
    const right = Math.max(PAD, Math.min(vw - rect.right, vw - POP_W - PAD));
    popover.style.right = right + 'px';
    popover.style.left = 'auto';
    popover.style.display = 'block';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // Bind one-shot outside-click + Esc handlers
    requestAnimationFrame(() => {
        document._paNoteCloseHandler = (e) => {
            if (!popover.contains(e.target) && !btn.contains(e.target)) closePaDocNotePopover();
        };
        document._paNoteKeyHandler = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancelPaDocNotePopover(); }
        };
        document.addEventListener('click', document._paNoteCloseHandler, { capture: true });
        document.addEventListener('keydown', document._paNoteKeyHandler);
    });
}

function _paTeardownNotePopoverHandlers() {
    if (document._paNoteCloseHandler) {
        document.removeEventListener('click', document._paNoteCloseHandler, { capture: true });
        document._paNoteCloseHandler = null;
    }
    if (document._paNoteKeyHandler) {
        document.removeEventListener('keydown', document._paNoteKeyHandler);
        document._paNoteKeyHandler = null;
    }
}

function cancelPaDocNotePopover() {
    const popover = document.getElementById('paNotePopover');
    if (popover) popover.style.display = 'none';
    _paActiveNoteDocId = null;
    _paActiveNoteReportId = null;
    _paActiveNoteOriginal = '';
    _paTeardownNotePopoverHandlers();
}

async function closePaDocNotePopover() {
    const docId = _paActiveNoteDocId;
    const reportId = _paActiveNoteReportId;
    const originalNote = _paActiveNoteOriginal;
    const popover = document.getElementById('paNotePopover');
    const textarea = document.getElementById('paNotePopoverText');
    if (!popover || !textarea || !docId || !reportId) {
        cancelPaDocNotePopover();
        return;
    }
    const newText = textarea.value;
    popover.style.display = 'none';
    _paActiveNoteDocId = null;
    _paActiveNoteReportId = null;
    _paActiveNoteOriginal = '';
    _paTeardownNotePopoverHandlers();

    if (newText === originalNote) return; // no change

    const { item, doc } = _paFindDoc(reportId, docId);
    if (!doc) return;

    // Optimistic update — mutate local + swap icon state
    doc.bookkeepers_notes = newText;
    const btn = document.querySelector(`.pa-preview-doc-row[data-doc-id="${CSS.escape(docId)}"] .pa-doc-row__note`);
    if (btn) {
        const has = !!newText.trim();
        btn.classList.toggle('pa-doc-row__note--has-content', has);
        btn.innerHTML = `${icon(has ? 'message-square-text' : 'message-square', 'icon-xs')}`;
        btn.title = has ? 'ערוך הערה' : 'הוסף הערה';
        safeCreateIcons(btn);
    }

    const payload = {
        data: {
            fields: [{ type: 'HIDDEN_FIELDS', value: { report_record_id: reportId } }],
            extensions: { note_updates: [{ id: docId, note: newText }], send_email: false },
        },
    };
    try {
        const resp = await fetchWithTimeout(ENDPOINTS.EDIT_DOCUMENTS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify(payload),
        }, FETCH_TIMEOUTS.mutate);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        showAIToast('הערה נשמרה', 'success');
    } catch (err) {
        // Rollback
        doc.bookkeepers_notes = originalNote;
        if (btn) {
            const has = !!originalNote.trim();
            btn.classList.toggle('pa-doc-row__note--has-content', has);
            btn.innerHTML = `${icon(has ? 'message-square-text' : 'message-square', 'icon-xs')}`;
            safeCreateIcons(btn);
        }
        showAIToast('שגיאה בשמירת ההערה', 'danger');
        console.error('[DL-299] closePaDocNotePopover save failed', err);
    }
}

// ==================== DL-299: Questionnaire print from PA card ====================

function printPaQuestionnaire(reportId) {
    const item = pendingApprovalData.find(i => i.report_id === reportId);
    if (!item) return;
    if (typeof window.printQuestionnaireSheet !== 'function') {
        showAIToast('מודול ההדפסה לא נטען', 'danger');
        return;
    }
    const FILING_TYPE_LABELS_LOCAL = { annual_report: 'דוח שנתי', capital_statement: 'הצהרת הון' };
    const answers = Array.isArray(item.answers_all) ? item.answers_all
                  : (Array.isArray(item.answers_summary) ? item.answers_summary : []);
    const notesText = [(item.notes || '').trim(), (item.client_notes || '').trim()].filter(Boolean).join('\n\n');
    window.printQuestionnaireSheet({
        clientName: item.client_name || '',
        year: item.year || '',
        email: item.client_email || '',
        phone: item.client_phone || '',
        submissionDate: item.submitted_at || null,
        filingTypeLabel: FILING_TYPE_LABELS_LOCAL[item.filing_type] || item.filing_type || 'דוח שנתי',
        answers,
        clientQuestions: Array.isArray(item.client_questions) ? item.client_questions : [],
        reportNotes: notesText,
    });
}

// ==================== REMINDERS TAB ====================

let remindersData = [];
let reminderLoaded = false;
let reminderLoadedAt = 0;
let reminderDefaultMax = null; // null = unlimited
let activeCardFilter = 'scheduled';

async function loadReminders(silent = false, prefetchOnly = false) {
    if (!authToken) return;
    // DL-247: SWR — skip if fresh (POST-based, no deduplicatedFetch)
    const isFresh = reminderLoaded && (Date.now() - reminderLoadedAt < STALE_AFTER_MS);

    // DL-317: SWR — paint cached data instantly on first switchTab after a prefetch landed
    if (!prefetchOnly && reminderLoaded && !remindersEverRendered) {
        const _tR = perfStart();
        filterReminders();
        remindersEverRendered = true;
        perfEnd('dl317:reminders:render', _tR);
    }

    if (silent && isFresh) return;

    const _tF = perfStart();
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
        // Cheap stats update runs even in prefetch
        updateReminderStats(data.stats || {});
        perfEnd('dl317:reminders:fetch', _tF);

        if (!prefetchOnly) {
            const _tR = perfStart();
            filterReminders();
            remindersEverRendered = true;
            perfEnd('dl317:reminders:render', _tR);
        }
        return;
    } catch (error) {
        perfEnd('dl317:reminders:fetch', _tF);

        console.error('Reminders load failed');
        if (!silent) {
            document.getElementById('reminderTableContainer').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">${icon('alert-triangle', 'icon-2xl')}</div>
                    <p style="color: var(--danger-500);">לא ניתן לטעון את התזכורות. נסה שוב.</p>
                    <button class="btn btn-secondary mt-4" onclick="loadReminders()">
                        ${icon('refresh-cw', 'icon-sm')} נסה שוב
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
                <div class="empty-state-icon">${icon('bell', 'icon-2xl')}</div>
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
        ${icon('chevron-left', 'icon-sm reminder-chevron')}
        <input type="checkbox" class="reminder-section-select-all" onclick="event.stopPropagation()" onchange="toggleSectionSelectAll(this)" title="בחר הכל">
        ${icon('clipboard-list', 'icon-sm')}
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
        ${icon('chevron-left', 'icon-sm reminder-chevron')}
        <input type="checkbox" class="reminder-section-select-all" onclick="event.stopPropagation()" onchange="toggleSectionSelectAll(this)" title="בחר הכל">
        ${icon('folder-open', 'icon-sm')}
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
                <td${isSuppressed ? '' : ` class="reminder-date-cell editable-date" title="לחץ לעריכת תאריך" onclick="editReminderDate('${escapeAttr(r.report_id)}', this)" tabindex="0" role="button" aria-label="ערוך תאריך" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();editReminderDate('${escapeAttr(r.report_id)}',this);}"`}>${isSuppressed ? '-' : `<span class="reminder-date ${dateClass}">${nextDate}${icon('pencil', 'edit-pencil')}</span>`}</td>
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
                                ${icon('send', 'icon-sm')}
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
                        <span class="reminder-date ${dateClass}">${nextDate} ${icon('pencil', 'edit-pencil')}</span>
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
                        ${icon('send', 'icon-sm')}
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
        showModal('error', 'שגיאה', humanizeError(error));
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
        showModal('error', 'שגיאה', humanizeError(error));
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
// Modal logic lives in frontend/assets/js/client-detail-modal.js (DL-293).
// This wrapper injects the dashboard-specific context (authToken, toast, onSaved).

function openClientDetailModal(reportId) {
    return openClientDetailModalShared(reportId, {
        authToken,
        toast: showAIToast,
        onSaved: (updated, prev) => {
            // Optimistic update in clientsData
            const client = clientsData.find(c => c.report_id === updated.report_id);
            if (client) {
                client.name = updated.name;
                client.email = updated.email;
                client.cc_email = updated.cc_email;
                client.phone = updated.phone;
                filterClients();
            }
            const changes = buildClientDetailChanges(updated, prev);
            if (changes.length > 0) {
                showAIToast('פרטי הלקוח עודכנו בהצלחה', 'success');
                const toastEl = document.getElementById('aiToastText');
                if (toastEl) {
                    toastEl.innerHTML = `פרטי הלקוח עודכנו בהצלחה<br><span style="font-size:0.85em;opacity:0.85">${changes.join('<br>')}</span>`;
                }
            } else {
                showAIToast('לא בוצעו שינויים', 'success');
            }
        }
    });
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
    document.querySelectorAll('.row-menu.open').forEach(m => {
        m.classList.remove('open');
        // Return portaled menu to its original DOM position (escape from body)
        if (m._portalParent) {
            m._portalParent.insertBefore(m, m._portalSibling || null);
            delete m._portalParent;
            delete m._portalSibling;
        }
    });
    const ctx = document.getElementById('clientContextMenu');
    if (ctx) { ctx.style.display = 'none'; ctx.classList.remove('open'); }
    // Close all tab dropdowns
    document.querySelectorAll('.tab-dropdown-menu.open').forEach(m => {
        m.classList.remove('open');
        const btn = m.closest('.tab-dropdown-wrapper')?.querySelector(':scope > .tab-item');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    });
}

function toggleRowMenu(btn, e) {
    e.stopPropagation();
    // Support portaled menus (moved to body) by storing reference on button
    const menu = btn._rowMenu || btn.nextElementSibling;
    if (!menu) return;
    btn._rowMenu = menu;
    const wasOpen = menu.classList.contains('open');
    closeAllRowMenus();
    if (!wasOpen) {
        // Portal: append to body so overflow:hidden on card ancestors never clips it
        menu._portalParent = menu.parentNode;
        menu._portalSibling = menu.nextSibling;
        document.body.appendChild(menu);
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
            items += `<button onclick="sendSingle('${rid}'); closeAllRowMenus();">${icon('send')} שלח שאלון</button>`;
        }
        if (stage === 'Waiting_For_Answers' || stage === 'Collecting_Docs') {
            items += `<button onclick="sendDashboardReminder('${rid}', '${cName}'); closeAllRowMenus();">${icon('bell-ring')} שלח תזכורת</button>`;
        }
        if (stage === 'Send_Questionnaire' || stage === 'Waiting_For_Answers') {
            items += `<button onclick="openAssistedQuestionnaire('${rid}', '${cName}'); closeAllRowMenus();">${icon('user-pen')} מלא שאלון במקום הלקוח</button>`;
        }
        if (stageNum >= 3) {
            items += `<button onclick="viewQuestionnaire('${rid}'); closeAllRowMenus();">${icon('file-text')} צפה בשאלון</button>`;
        }
        items += `<button onclick="viewClient('${rid}'); closeAllRowMenus();">${icon('external-link')} צפייה כלקוח</button>`;
        const ctxClient = clientsData.find(c => c.report_id === rid);
        if (ctxClient) {
            const ctxOtherType = getClientOtherFilingType(ctxClient.email, ctxClient.year);
            if (ctxOtherType) {
                const ctxLabel = FILING_TYPE_LABELS[ctxOtherType];
                items += `<button onclick="addSecondFilingType('${rid}'); closeAllRowMenus();">${icon('file-plus')} הוסף ${ctxLabel}</button>`;
            }
        }
        items += `<hr>`;
        items += `<button class="danger" onclick="deactivateClient('${rid}', '${cName}'); closeAllRowMenus();">${icon('archive')} העבר לארכיון</button>`;
    } else {
        items += `<button onclick="viewClient('${rid}'); closeAllRowMenus();">${icon('external-link')} צפייה כלקוח</button>`;
        items += `<hr>`;
        items += `<button onclick="reactivateClient('${rid}'); closeAllRowMenus();">${icon('archive-restore')} הפעל מחדש</button>`;
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
        archiveBtn.innerHTML = `${icon('archive-restore', 'icon-sm')} הפעל מחדש`;
        archiveBtn.className = 'btn btn-sm btn-outline-success';
    } else {
        archiveBtn.innerHTML = `${icon('archive', 'icon-sm')} העבר לארכיון`;
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
    window.open(`https://docs.moshe-atsits.com/view-documents.html?report_id=${encodeURIComponent(reportId)}`, '_blank');
}

// DL-284: Open questionnaire landing page on behalf of a client (office-assisted filling)
function openAssistedQuestionnaire(reportId, clientName) {
    showConfirmDialog(
        `פתח שאלון במקום הלקוח "${clientName}"? הפעולה תירשם ביומן המערכת.`,
        async () => {
            showLoading('מכין קישור...');
            try {
                const response = await fetchWithTimeout(ENDPOINTS.ADMIN_ASSISTED_LINK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: authToken, report_id: reportId }),
                }, FETCH_TIMEOUTS.mutate);
                const data = await response.json();
                hideLoading();
                if (!data.ok || !data.url) {
                    showAIToast(data.error || 'שגיאה בפתיחת השאלון', 'error');
                    return;
                }
                window.open(data.url, '_blank', 'noopener,noreferrer');
            } catch (err) {
                hideLoading();
                showAIToast('שגיאה בפתיחת השאלון: ' + err.message, 'error');
            }
        },
        'פתח שאלון'
    );
}

function viewClientDocs(reportId, newTab = false) {
    const client = clientsData.find(c => c.report_id === reportId);
    const clientId = client?.client_id;
    if (clientId) {
        const ft = client.filing_type || activeEntityTab || '';
        const tabParam = ft ? `&tab=${encodeURIComponent(ft)}` : '';
        const url = `../document-manager.html?client_id=${encodeURIComponent(clientId)}${tabParam}`;
        if (newTab) window.open(url, '_blank');
        else window.location.href = url;
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
        success: `${icon('circle-check', 'icon-2xl')}`,
        error: `${icon('circle-alert', 'icon-2xl')}`,
        warning: `${icon('alert-triangle', 'icon-2xl')}`
    };
    document.getElementById('modalIcon').innerHTML = icons[type] || `${icon('circle-check', 'icon-2xl')}`;
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

/** Escape HTML but preserve <b></b> tags for SSOT doc name formatting.
 *  Balances unclosed <b> tags — an unbalanced tag inside innerHTML triggers the
 *  HTML parser's adoption agency algorithm and reconstructs <b> into subsequent
 *  sibling block elements (e.g. .ai-doc-row children), breaking their layout.
 *  Seen when backend labels were truncated mid-tag. */
function renderDocLabel(name) {
    let html = escapeHtml(name).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
    const opens = (html.match(/<b>/g) || []).length;
    const closes = (html.match(/<\/b>/g) || []).length;
    if (opens > closes) html += '</b>'.repeat(opens - closes);
    else if (closes > opens) html = '<b>'.repeat(closes - opens) + html;
    return html;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ==================== INLINE CONFIRM (AI Review cards) ====================

function showInlineConfirm(recordId, message, onConfirm, opts = {}) {
    // DL-334: On desktop there is no fat-card — the panel buttons themselves are the
    // affordance, so treat them as the confirm and invoke onConfirm immediately.
    if (!isAIReviewMobileLayout()) {
        try { onConfirm && onConfirm(); } catch (e) { console.error(e); }
        return;
    }
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
    // DL-334: Desktop has no inline-confirm overlay to restore (see showInlineConfirm).
    if (!isAIReviewMobileLayout()) return;
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
                ${icon('merge', 'icon-sm')} מזג קבצים
            </button>
            <button class="btn btn-outline" id="conflictKeepBothBtn">
                ${icon('copy-plus', 'icon-sm')} שמור שניהם
            </button>
            <button class="btn confirm-btn-danger" id="conflictOverrideBtn">
                ${icon('replace', 'icon-sm')} החלף קובץ
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
    setupTabDropdownHover();
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

async function loadQuestionnaires(silent = false, prefetchOnly = false) {
    if (!authToken) return;
    initQuestionnaireYearFilter();
    // DL-247: SWR — skip if fresh, otherwise fetch silently
    const isFresh = questionnaireLoaded && (Date.now() - questionnaireLoadedAt < STALE_AFTER_MS);

    // DL-317: SWR — paint cached data instantly on first switchTab after a prefetch landed
    if (!prefetchOnly && questionnaireLoaded && !questionnairesEverRendered) {
        const _tR = perfStart();
        filterQuestionnaires();
        questionnairesEverRendered = true;
        perfEnd('dl317:questionnaires:render', _tR);
    }

    if (silent && isFresh) return;

    const _tF = perfStart();
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
        // Cheap stats update runs even in prefetch
        updateQuestionnaireStats();
        perfEnd('dl317:questionnaires:fetch', _tF);

        if (!prefetchOnly) {
            const _tR = perfStart();
            filterQuestionnaires();
            questionnairesEverRendered = true;
            perfEnd('dl317:questionnaires:render', _tR);
        }
        return;
    } catch (error) {
        perfEnd('dl317:questionnaires:fetch', _tF);
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
                <div class="empty-state-icon">${icon('file-text', 'icon-2xl')}</div>
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
                    <td>${stage ? `<span class="stage-badge ${stage.class}">${icon(stage.icon, 'icon-sm')} ${stage.label}</span>` : '—'}</td>
                    <td>${date}</td>
                    <td class="qa-actions-cell" onclick="event.stopPropagation();">
                        <div class="qa-actions-inner">
                            <button class="action-btn view" onclick="navigateToDocManager('${id}')" title="מנהל מסמכים">
                                ${icon('folder-open', 'icon-sm')}
                            </button>
                            <button class="action-btn" style="background:var(--gray-100);color:var(--gray-600);" onclick="printSingleQuestionnaire('${id}')" title="הדפס שאלון">
                                ${icon('printer', 'icon-sm')}
                            </button>
                            <button class="expand-toggle" id="toggle-${id}" onclick="toggleQuestionnaireDetail('${id}')" title="הצג/הסתר תשובות">
                                ${icon('chevron-left', 'icon-sm')}
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
                    ${stage ? `<span class="stage-badge ${stage.class}">${icon(stage.icon, 'icon-sm')} ${stage.label}</span>` : ''}
                </div>
            </div>
            <div class="mobile-card-secondary">
                ${spouse !== '—' ? `<span class="mobile-card-detail"><span class="label">בן/בת זוג</span> ${escapeHtml(spouse)}</span>` : ''}
                <span class="mobile-card-detail"><span class="label">הגשה</span> ${date}</span>
            </div>
            <div class="mobile-card-actions">
                <button class="action-btn view" onclick="navigateToDocManager('${id}')" title="מנהל מסמכים">
                    ${icon('folder-open', 'icon-sm')}
                </button>
                <button class="action-btn" style="background:var(--gray-100);color:var(--gray-600);" onclick="printSingleQuestionnaire('${id}')" title="הדפס שאלון">
                    ${icon('printer', 'icon-sm')}
                </button>
                <button class="expand-toggle" id="toggle-m-${id}" onclick="toggleQuestionnaireCardDetail('${id}')" title="הצג/הסתר תשובות">
                    ${icon('chevron-left', 'icon-sm')}
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
        const iconEl = toggle.querySelector('i, svg');
        if (iconEl) {
            iconEl.outerHTML = icon(detail.classList.contains('open') ? 'chevron-down' : 'chevron-left'); // DL-314: sprite
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
                ${icon(qaHideNoAnswers ? 'eye' : 'eye-off', 'icon-sm')}
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
                ${icon('help-circle', 'icon-sm')} שאלות הלקוח (${clientQuestions.length})
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
        showModal('error', 'שגיאה בפיצול', humanizeError(err));
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
