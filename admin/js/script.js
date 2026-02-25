// Configuration
const API_BASE = 'https://liozshor.app.n8n.cloud/webhook';
const ADMIN_TOKEN_KEY = 'QKiwUBXVH@%#1gD7t@rB]<,dM.[NC5b_';
const SESSION_FLAG_KEY = 'admin_session_active';

// State
let authToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
let clientsData = [];
let importData = [];
let existingEmails = new Set();
let reviewQueueData = [];

// ==================== SSOT CONSTANTS ====================

const STAGES = {
    '1-Send_Questionnaire':  { num: 1, label: 'ממתין לשליחה',  icon: 'clipboard-list', class: 'stage-1' },
    '2-Waiting_For_Answers': { num: 2, label: 'ממתין לתשובה',  icon: 'hourglass',      class: 'stage-2' },
    '3-Collecting_Docs':     { num: 3, label: 'אוסף מסמכים',   icon: 'folder-open',    class: 'stage-3' },
    '4-Review':              { num: 4, label: 'בבדיקה',        icon: 'search',         class: 'stage-4' },
    '5-Completed':           { num: 5, label: 'הושלם',         icon: 'circle-check',   class: 'stage-5' }
};

const STAGE_NUM_TO_KEY = Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [v.num, k]));

const SORT_CONFIG = {
    name:    { accessor: c => c.name || '',    type: 'string' },
    stage:   { accessor: c => STAGES[c.stage]?.num || 0, type: 'number' },
    docs:    { accessor: c => c.docs_total > 0 ? c.docs_received / c.docs_total : 0, type: 'number' },
    missing: { accessor: c => (c.docs_total || 0) - (c.docs_received || 0), type: 'number' }
};

let currentSort = { column: null, direction: 'asc' };

// ==================== AUTH ====================

async function login() {
    const password = document.getElementById('passwordInput').value;
    if (!password) return;

    showLoading('מאמת...');

    try {
        const response = await fetchWithTimeout(`${API_BASE}/admin-auth`, {
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
            loadDashboard();
            if (typeof lucide !== 'undefined') lucide.createIcons();
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
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_FLAG_KEY);
    authToken = '';
    location.reload();
}

// Check if already logged in
async function checkAuth() {
    if (!authToken) return;

    // If session already active in this browser window, skip API call
    if (sessionStorage.getItem(SESSION_FLAG_KEY) === 'true') {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('app').classList.add('visible');
        loadDashboard();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    // New tab/window - verify token with API
    try {
        const response = await fetchWithTimeout(`${API_BASE}/admin-verify?token=${authToken}`, {}, FETCH_TIMEOUTS.quick);
        const data = await response.json();

        if (data.ok) {
            sessionStorage.setItem(SESSION_FLAG_KEY, 'true');
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('app').classList.add('visible');
            loadDashboard();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        } else {
            localStorage.removeItem(ADMIN_TOKEN_KEY);
            sessionStorage.removeItem(SESSION_FLAG_KEY);
            authToken = '';
        }
    } catch (error) {
        // Token invalid, stay on login
    }
}

// Enter key to login
document.getElementById('passwordInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});

// ==================== TABS ====================

function switchTab(tabName, evt) {
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    if (evt && evt.currentTarget) evt.currentTarget.classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Silent refresh on every tab switch
    if (tabName === 'dashboard' || tabName === 'review') {
        loadDashboard(true);
    } else if (tabName === 'send') {
        loadPendingClients(true);
    } else if (tabName === 'ai-review') {
        loadAIClassifications(aiReviewLoaded);
    } else if (tabName === 'reminders') {
        loadReminders(reminderLoaded);
    }
}

// ==================== DASHBOARD ====================

async function loadDashboard(silent = false) {
    if (!silent) showLoading('טוען נתונים...');

    try {
        const year = document.getElementById('yearFilter')?.value || '2025';
        const response = await fetchWithTimeout(`${API_BASE}/admin-dashboard?token=${authToken}&year=${year}`, {}, FETCH_TIMEOUTS.load);
        const data = await response.json();

        if (!silent) hideLoading();

        if (!data.ok) {
            if (data.error === 'unauthorized') {
                logout();
                return;
            }
            throw new Error(data.error);
        }

        // Update stats
        document.getElementById('stat-total').textContent = data.stats.total || 0;
        document.getElementById('stat-stage1').textContent = data.stats.stage1 || 0;
        document.getElementById('stat-stage2').textContent = data.stats.stage2 || 0;
        document.getElementById('stat-stage3').textContent = data.stats.stage3 || 0;
        document.getElementById('stat-stage4').textContent = data.stats.stage4 || 0;
        document.getElementById('stat-stage5').textContent = data.stats.stage5 || 0;

        // Store clients data
        clientsData = data.clients || [];
        existingEmails = new Set(clientsData.map(c => c.email?.toLowerCase()));

        // Store review queue data
        reviewQueueData = data.review_queue || [];
        const badge = document.getElementById('reviewCountBadge');
        if (reviewQueueData.length > 0) {
            badge.textContent = reviewQueueData.length;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
        document.getElementById('reviewHeaderCount').textContent = `${reviewQueueData.length} לקוחות בתור`;
        renderReviewTable(reviewQueueData);

        // Render table
        renderClientsTable(clientsData);

        // Ensure the correct stat card is active based on current filter
        const currentStageFilter = document.getElementById('stageFilter').value;
        toggleStageFilter(currentStageFilter, false); // Pass false to prevent re-filtering

        if (typeof lucide !== 'undefined') lucide.createIcons();

        // Load AI review badge count (async, non-blocking)
        loadAIReviewCount();
        loadReminderCount();
    } catch (error) {
        if (!silent) hideLoading();
        console.error('Dashboard error:', error);
        if (!silent) showModal('error', 'שגיאה', 'לא ניתן לטעון את הנתונים');
    }
}

function renderClientsTable(clients) {
    const container = document.getElementById('clientsTableContainer');

    if (!clients || clients.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="folder-open" class="icon-2xl"></i></div>
                <p>לא נמצאו לקוחות</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    function sortAttr(col) {
        if (currentSort.column !== col) return 'none';
        return currentSort.direction === 'asc' ? 'ascending' : 'descending';
    }

    let html = `
        <table>
            <thead>
                <tr>
                    <th><button class="th-sort-btn" onclick="toggleSort('name')" aria-sort="${sortAttr('name')}">שם <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th><button class="th-sort-btn" onclick="toggleSort('stage')" aria-sort="${sortAttr('stage')}">שלב <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th><button class="th-sort-btn" onclick="toggleSort('docs')" aria-sort="${sortAttr('docs')}">מסמכים <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
                    <th><button class="th-sort-btn" onclick="toggleSort('missing')" aria-sort="${sortAttr('missing')}">חסרים <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span></button></th>
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

        html += `
            <tr>
                <td>
                    <div class="client-name-cell">
                        <strong
                            class="client-link"
                            onclick="viewClientDocs('${client.report_id}', '${escapeHtml(client.name)}', '${escapeHtml(client.email || '')}', '${client.year}')"
                            title="${escapeHtml(client.email || '')}"
                        >
                            ${escapeHtml(client.name)}
                        </strong>
                        <a class="client-view-link" href="javascript:void(0)" onclick="event.stopPropagation(); viewClient('${client.report_id}')" title="צפייה כלקוח">
                            <i data-lucide="external-link" class="icon-xs"></i>
                        </a>
                    </div>
                </td>
                <td>
                    <span id="stage-badge-${escapeAttr(client.report_id)}" class="stage-badge ${stage.class} clickable"
                        onclick="openStageDropdown(event, '${escapeAttr(client.report_id)}', '${escapeAttr(client.stage)}')"
                        title="לחץ לשינוי שלב">
                        <i data-lucide="${stage.icon}" class="icon-sm"></i> ${stage.label} <span class="stage-caret">&#x25BE;</span>
                    </span>
                </td>
                <td>
                    <div class="docs-progress-cell">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <span class="docs-count">${docsReceived}/${docsTotal}</span>
                    </div>
                </td>
                <td>
                    <span class="missing-count ${missingCount > 0 ? 'has-missing' : 'all-done'}">${missingCount > 0 ? missingCount : '✓'}</span>
                </td>
                <td>
                    ${client.stage === '1-Send_Questionnaire' ?
                `<button class="action-btn send" onclick="sendSingle('${client.report_id}')" title="שלח שאלון"><i data-lucide="send" class="icon-sm"></i></button>` :
                ''}
                    ${(client.stage === '2-Waiting_For_Answers' || client.stage === '3-Collecting_Docs') ?
                `<button class="action-btn reminder-set-btn" onclick="setManualReminder('${escapeAttr(client.report_id)}', '${escapeHtml(client.name)}')" title="הגדר תזכורת"><i data-lucide="bell-plus" class="icon-sm"></i></button>` :
                ''}
                </td>
            </tr>
        `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function filterClients() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const stage = document.getElementById('stageFilter').value;
    const year = document.getElementById('yearFilter').value;

    let filtered = clientsData;

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

    filtered = sortClients(filtered);
    renderClientsTable(filtered);
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

    // Position below badge (RTL-aware)
    dropdown.style.top = (rect.bottom + 6) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
    dropdown.style.left = 'auto';
    dropdown.style.display = 'block';

    if (typeof lucide !== 'undefined') lucide.createIcons();

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
        const response = await fetchWithTimeout(`${API_BASE}/admin-change-stage`, {
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

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function recalculateStats() {
    const counts = { total: 0, stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0 };

    for (const client of clientsData) {
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
}

// Close stage dropdown on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeStageDropdown();
});

function refreshData() {
    loadDashboard();
}

// Load AI review pending count for tab badge
async function loadAIReviewCount() {
    const badge = document.getElementById('aiReviewTabBadge');
    try {
        const resp = await fetchWithTimeout(`${API_BASE}/get-pending-classifications?token=${authToken}`, {}, FETCH_TIMEOUTS.quick);
        const data = await resp.json();
        badge.classList.remove('ai-badge-loading');
        if (data.ok && data.stats && data.stats.total_pending > 0) {
            badge.textContent = data.stats.total_pending;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
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

        importData.push({ name, email, status, statusText });
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

async function performServerImport(clients, year, successMessage) {
    showLoading(clients.length > 1 ? `מייבא ${clients.length} לקוחות...` : 'מוסיף לקוח...');

    try {
        const response = await fetchWithTimeout(`${API_BASE}/admin-bulk-import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                year: parseInt(year),
                clients: clients
            })
        }, FETCH_TIMEOUTS.slow);

        const data = await response.json();
        hideLoading();

        if (!data.ok) {
            throw new Error(data.error || 'Import failed');
        }

        showModal('success', 'הפעולה הושלמה!',
            successMessage || `הנתונים נשמרו בהצלחה.`,
            { created: data.created, skipped: data.skipped }
        );

        return true;

    } catch (error) {
        hideLoading();
        showModal('error', 'שגיאה', 'שגיאה בשמירת הנתונים: ' + error.message);
        return false;
    }
}

async function startImport() {
    const validClients = importData.filter(c => c.status === 'valid');
    if (validClients.length === 0) return;

    const year = document.getElementById('importYear').value;

    const success = await performServerImport(
        validClients.map(c => ({ name: c.name, email: c.email })),
        year,
        'הלקוחות נוספו בהצלחה למערכת.'
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

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function addManualClient() {
    const name = document.getElementById('manualName').value.trim();
    const email = document.getElementById('manualEmail').value.trim().toLowerCase();
    const year = document.getElementById('manualYear').value;

    if (!name || !email) {
        showModal('warning', 'חסרים נתונים', 'נא להזין שם ואימייל');
        return;
    }
    if (!isValidEmail(email)) {
        showModal('warning', 'אימייל לא תקין', 'כתובת האימייל אינה תקינה');
        return;
    }
    // Optional: warning if already exists in dashboard list
    if (existingEmails.has(email)) {
        if (!confirm('כתובת המייל הזו כבר קיימת ברשימת הלקוחות. האם להוסיף בכל זאת?')) return;
    }

    const success = await performServerImport(
        [{ name, email }],
        year,
        'הלקוח נוסף בהצלחה למערכת.'
    );

    if (success) {
        document.getElementById('manualName').value = '';
        document.getElementById('manualEmail').value = '';
        loadDashboard();
    }
}

// ==================== SEND QUESTIONNAIRES ====================

let pendingClients = [];

async function loadPendingClients(silent = false) {
    if (!silent) showLoading('טוען לקוחות ממתינים...');

    try {
        const year = document.getElementById('sendYearFilter').value;
        const response = await fetchWithTimeout(`${API_BASE}/admin-pending?token=${authToken}&year=${year}`, {}, FETCH_TIMEOUTS.load);
        const data = await response.json();

        if (!silent) hideLoading();

        if (!data.ok) throw new Error(data.error);

        pendingClients = data.clients || [];
        renderPendingClients();

    } catch (error) {
        if (!silent) hideLoading();
        if (!silent) showModal('error', 'שגיאה', 'לא ניתן לטעון את הרשימה');
    }
}

function renderPendingClients() {
    const container = document.getElementById('pendingClientsContainer');

    if (pendingClients.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="circle-check" class="icon-2xl"></i></div>
                <p>אין לקוחות ממתינים לשליחת שאלון</p>
            </div>
        `;
        document.getElementById('sendActions').style.display = 'none';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    let html = `
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
                <td>${escapeHtml(client.name)}</td>
                <td>${escapeHtml(client.email)}</td>
            </tr>
        `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
    document.getElementById('sendActions').style.display = 'block';
    updateSelectedCount();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll').checked;
    document.querySelectorAll('.client-checkbox').forEach(cb => cb.checked = selectAll);
    updateSelectedCount();
}

function updateSelectedCount() {
    const selected = document.querySelectorAll('.client-checkbox:checked').length;
    document.getElementById('selectedCount').textContent = selected;
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
    if (!confirm(`האם לשלוח שאלון ל-${reportIds.length} לקוחות?`)) return;
    await sendQuestionnaires(reportIds);
}

async function sendSingle(reportId) {
    await sendQuestionnaires([reportId]);
}

let _sendQuestionnairesLocked = false;

async function sendQuestionnaires(reportIds) {
    if (_sendQuestionnairesLocked) return;
    _sendQuestionnairesLocked = true;
    showLoading(`שולח ${reportIds.length} שאלונים...`);

    try {
        const response = await fetchWithTimeout(`${API_BASE}/admin-send-questionnaires`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                report_ids: reportIds
            })
        }, FETCH_TIMEOUTS.slow);

        const data = await response.json();
        hideLoading();

        if (!data.ok) throw new Error(data.error);

        showModal('success', 'נשלח בהצלחה!',
            `השאלונים נשלחו ללקוחות.`,
            { sent: data.sent }
        );

        loadDashboard();
        loadPendingClients();

    } catch (error) {
        hideLoading();
        showModal('error', 'שגיאה', getErrorMessage(error, 'he'));
    } finally {
        _sendQuestionnairesLocked = false;
    }
}

// ==================== REVIEW QUEUE ====================

function renderReviewTable(queue) {
    const container = document.getElementById('reviewTableContainer');

    if (!queue || queue.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="inbox" class="icon-2xl"></i></div>
                <p>אין לקוחות מוכנים לבדיקה כרגע</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    const now = new Date();

    let html = `
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
                        onclick="viewClientDocs('${client.report_id}', '${escapeHtml(client.name)}', '${escapeHtml(client.email || '')}', '${client.year}')"
                    >
                        ${escapeHtml(client.name)}
                    </strong>
                </td>
                <td>${escapeHtml(client.email)}</td>
                <td>${client.year}</td>
                <td>${client.docs_received}/${client.docs_total}</td>
                <td>${dateStr}</td>
                <td><span class="waiting-badge ${waitingClass}">${waitingText}</span></td>
                <td>
                    <button class="action-btn view" onclick="viewClient('${client.report_id}')" title="צפה בתיק"><i data-lucide="eye" class="icon-sm"></i></button>
                    <button class="action-btn complete" onclick="markComplete('${client.report_id}', '${escapeHtml(client.name)}')" title="סמן כהושלם"><i data-lucide="circle-check" class="icon-sm"></i></button>
                </td>
            </tr>
        `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

let _markCompleteLocked = false;

async function markComplete(reportId, name) {
    if (_markCompleteLocked) return;
    if (!confirm(`לסמן את "${name}" כהושלם?`)) return;
    _markCompleteLocked = true;

    showLoading('מעדכן...');

    try {
        const response = await fetchWithTimeout(`${API_BASE}/admin-mark-complete`, {
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
}

function exportReviewToExcel() {
    if (!reviewQueueData.length) return;

    const now = new Date();
    const exportData = reviewQueueData.map((c, i) => {
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
    XLSX.utils.book_append_sheet(wb, ws, 'מוכנים לבדיקה');
    XLSX.writeFile(wb, `review_queue_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// ==================== DOC SEARCH COMBOBOX ====================

function createDocCombobox(container, docs, { currentMatchId = null, onSelect = null, allowCreate = false } = {}) {
    // Group docs by category, skip empty categories
    const groups = [];
    let currentCat = null;
    for (const doc of docs) {
        if (doc.category !== currentCat) {
            currentCat = doc.category;
            groups.push({ category: doc.category, name: doc.category_name || doc.category, emoji: doc.category_emoji || '', docs: [] });
        }
        groups[groups.length - 1].docs.push(doc);
    }

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

        if (allowCreate) {
            html += `<div class="doc-combobox-create-btn" data-action="create">+ \u05d4\u05d5\u05e1\u05e3 \u05de\u05e1\u05de\u05da \u05d7\u05d3\u05e9</div>`;
        }

        for (const group of groups) {
            const filtered = group.docs.filter(d =>
                !filter || matchesFilter(d.name, filter)
            );
            if (filtered.length === 0) continue;
            hasResults = true;

            html += `<div class="doc-combobox-category">${escapeHtml(group.emoji)} ${escapeHtml(group.name)}</div>`;
            for (const doc of filtered) {
                const isCurrent = currentMatchId && doc.template_id === currentMatchId;
                const cls = isCurrent ? ' current-match' : '';
                const badge = isCurrent ? `<span class="current-badge">\u25c0 \u05e0\u05d5\u05db\u05d7\u05d9</span>` : '';
                html += `<div class="doc-combobox-option${cls}" data-value="${escapeAttr(doc.template_id)}" data-doc-id="${escapeAttr(doc.doc_record_id || '')}" data-name="${escapeAttr(doc.name || '')}">${escapeHtml(doc.name || '')}${badge}</div>`;
            }
        }

        if (!hasResults && !allowCreate) {
            html = `<div class="doc-combobox-empty">\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05ea\u05d5\u05e6\u05d0\u05d5\u05ea</div>`;
        } else if (!hasResults && allowCreate) {
            html += `<div class="doc-combobox-empty">\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05ea\u05d5\u05e6\u05d0\u05d5\u05ea \u2014 \u05e0\u05e1\u05d4 \u05dc\u05d4\u05d5\u05e1\u05d9\u05e3 \u05de\u05e1\u05de\u05da \u05d7\u05d3\u05e9</div>`;
        }

        dropdown.innerHTML = html;

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

    function open() {
        if (inCreateMode) return;
        combobox.classList.add('open');
        positionDropdown();
        renderOptions(input.classList.contains('has-value') ? '' : input.value);
    }

    function close() {
        combobox.classList.remove('open');
    }

    input.addEventListener('focus', open);
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
                input.value = doc.name || val;
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

async function loadAIClassifications(silent = false) {
    if (!silent) showLoading('טוען סיווגים...');

    try {
        const response = await fetchWithTimeout(`${API_BASE}/get-pending-classifications?token=${authToken}`, {}, FETCH_TIMEOUTS.load);
        const data = await response.json();

        if (!silent) hideLoading();

        if (!data.ok) {
            if (data.error === 'unauthorized') {
                logout();
                return;
            }
            throw new Error(data.error || 'שגיאה בטעינת הנתונים');
        }

        aiClassificationsData = data.items || [];
        aiReviewLoaded = true;
        updateAIStats(data.stats || {});
        applyAIFilters();

        // Update tab badge
        const badge = document.getElementById('aiReviewTabBadge');
        const total = data.stats?.total_pending || 0;
        if (total > 0) {
            badge.textContent = total;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (error) {
        if (!silent) hideLoading();
        console.error('AI Review load error:', error);
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
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

function updateAIStats(stats) {
    document.getElementById('ai-stat-pending').textContent = stats.total_pending || 0;
    document.getElementById('ai-stat-matched').textContent = stats.matched || 0;
    document.getElementById('ai-stat-unmatched').textContent = stats.unmatched || 0;

    // Repurpose 4th stat: "ביטחון גבוה" → "מנפיק שונה"
    const mismatchCount = aiClassificationsData.filter(i =>
        i.matched_template_id && i.issuer_match_quality === 'mismatch'
    ).length;
    document.getElementById('ai-stat-high-confidence').textContent = mismatchCount;

    // Update 4th stat label and styling
    const highConfItem = document.getElementById('ai-stat-high-confidence').closest('.ai-stat-item');
    if (highConfItem) {
        const label = highConfItem.querySelector('.ai-stat-label');
        if (label) label.textContent = 'מנפיק שונה';
        highConfItem.classList.remove('ai-stat-high-conf');
        highConfItem.classList.add('ai-stat-mismatch');
        const icon = highConfItem.querySelector('.icon-sm');
        if (icon) icon.setAttribute('data-lucide', 'alert-triangle');
    }
}

function applyAIFilters() {
    const searchText = (document.getElementById('aiSearchInput').value || '').trim().toLowerCase();
    const confidenceFilter = document.getElementById('aiConfidenceFilter').value;
    const typeFilter = document.getElementById('aiTypeFilter').value;

    let filtered = aiClassificationsData;

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

    renderAICards(filtered);
}

const AI_DOC_NAMES = {
    T001:'אישור תושב', T002:'ספח תעודת זהות', T003:'מסמכי שינוי מצב משפחתי',
    T101:'אישור ועדת השמה', T102:'אישור קצבת ילד נכה',
    T201:'טופס 106', T202:'טופס 106 (בן/בת זוג)',
    T301:'אישור קצבה ביטוח לאומי', T302:'אישור קצבה ביטוח לאומי (בן/בת זוג)',
    T303:'אישור קצבת נכות', T304:'אישור דמי לידה',
    T305:'אישור קצבת שאירים', T306:'אישור קצבת שאירים (בן/בת זוג)',
    T401:'אישור משיכת ביטוח', T402:'אישור משיכת ביטוח (נוסף)',
    T501:'אישור שנתי קופת גמל', T601:'טופס 867',
    T701:'דוח רווחי קריפטו', T801:'אישור זכייה',
    T901:'חוזה שכירות (הכנסה)', T902:'חוזה שכירות (הוצאה)',
    T1001:'רשימת מלאי', T1101:'אישור ניכוי מס הכנסה', T1102:'אישור ניכוי ביטוח לאומי',
    T1201:'קבלות תרומה', T1301:'תעודת שחרור צבאי',
    T1401:'קבלות הוצאות אבל', T1402:'מסמכי מוסד', T1403:'מסמכי פטור ממס',
    T1501:'תעודת השכלה', T1601:'אסמכתאות הכנסה מחול', T1602:'דוח מס מחול',
    T1701:'מסמכי הכנסה אחרת'
};

// Client/spouse template pairs — same document type, different person
const RELATED_TEMPLATES = {
    T201: ['T201', 'T202'], T202: ['T201', 'T202'],
    T301: ['T301', 'T302'], T302: ['T301', 'T302'],
    T305: ['T305', 'T306'], T306: ['T305', 'T306'],
};

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
    const selectedRadio = card.querySelector('.ai-comparison-radio-list input[type="radio"]:checked');
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

    if (!items || items.length === 0) {
        container.innerHTML = '';

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
        if (typeof lucide !== 'undefined') lucide.createIcons();
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

    let html = '';

    for (const [clientName, clientItems] of Object.entries(groups)) {
        // Count by card state for accordion badges
        let identifiedCount = 0; // full + fuzzy
        let mismatchCount = 0;   // issuer-mismatch
        let unmatchedCount = 0;  // unmatched
        for (const i of clientItems) {
            const s = getCardState(i);
            if (s === 'full' || s === 'fuzzy') identifiedCount++;
            else if (s === 'issuer-mismatch') mismatchCount++;
            else unmatchedCount++;
        }

        // Build accordion stat badges (only show if count > 0)
        let badgesHtml = '';
        if (identifiedCount > 0) badgesHtml += `<span class="ai-accordion-stat-badge badge-matched">✅ ${identifiedCount} זוהו</span>`;
        if (mismatchCount > 0) badgesHtml += `<span class="ai-accordion-stat-badge badge-mismatch">⚠️ ${mismatchCount} מנפיק שונה</span>`;
        if (unmatchedCount > 0) badgesHtml += `<span class="ai-accordion-stat-badge badge-unmatched">❌ ${unmatchedCount} לא זוהו</span>`;

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
                    <span class="ai-accordion-icon">▾</span>
                </div>
                <div class="ai-accordion-body">
        `;

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

            let categoriesHtml = '';
            for (const group of catGroups) {
                const tagsHtml = group.docs.map(d => {
                    const id = d.template_id || d.name || '';
                    const label = d.name || AI_DOC_NAMES[id] || id;
                    const isReceived = d.status === 'Received';
                    const tagClass = isReceived ? 'ai-doc-tag-received' : 'ai-missing-doc-tag';
                    const prefix = isReceived ? '&#x2713; ' : '';
                    return `<span class="${tagClass}">${prefix}${escapeHtml(label)}</span>`;
                }).join('');
                categoriesHtml += `
                    <div class="ai-missing-category">${escapeHtml(group.emoji)} ${escapeHtml(group.name)}</div>
                    <div class="ai-missing-category-tags">${tagsHtml}</div>
                `;
            }

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

    // Initialize inline comboboxes (unmatched + mismatch fallback)
    container.querySelectorAll('.doc-combobox-container').forEach(el => {
        const recordId = el.dataset.recordId;
        let docs = [];
        try { docs = JSON.parse(el.dataset.docs); } catch (e) { /* skip */ }
        createDocCombobox(el, docs, {
            allowCreate: true,
            onSelect: (templateId) => {
                const btn = el.closest('.ai-card-actions').querySelector('.btn-ai-assign-confirm');
                if (btn) btn.disabled = !templateId;
            }
        });
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderAICard(item) {
    const state = getCardState(item);
    const rawConfidence = item.ai_confidence || 0;
    const confidencePercent = Math.round(rawConfidence * 100);
    const confidenceClass = rawConfidence >= 0.85 ? 'ai-confidence-high' :
                           rawConfidence >= 0.50 ? 'ai-confidence-medium' : 'ai-confidence-low';
    const cardClass = 'match-' + state;

    const fileIcon = getAIFileIcon(item.attachment_content_type || item.attachment_name || '');
    const receivedAt = item.received_at ? formatAIDate(item.received_at) : '';
    const senderEmail = item.sender_email || '';
    const senderTooltipParts = [senderEmail, receivedAt].filter(Boolean);
    const senderTooltip = senderTooltipParts.join(' | ');

    const missingDocs = item.missing_docs || [];

    const viewFileBtn = item.file_url
        ? `<a href="${escapeAttr(item.file_url)}" target="_blank" class="btn btn-ghost btn-sm">
               <i data-lucide="external-link" class="icon-sm"></i> פתח בקובץ
           </a>`
        : '';

    const evidenceIcon = item.ai_reason
        ? `<span class="ai-evidence-trigger" data-tooltip="${escapeAttr(item.ai_reason)}"><i data-lucide="bot" class="icon-sm"></i>?</span>`
        : '';

    let classificationHtml = '';
    let actionsHtml = '';

    if (state === 'full') {
        // State A: Full match — green border, raw confidence, doc name
        const templateLabel = AI_DOC_NAMES[item.matched_template_id] || item.matched_template_name || '';
        const docName = item.matched_doc_name || '';
        // Always show template type; append doc name if it adds info beyond the template label
        const docDisplayName = templateLabel && docName && !docName.includes(templateLabel)
            ? `${templateLabel} – ${docName}`
            : (docName || templateLabel);
        classificationHtml = `
            <span class="ai-confidence-badge ${confidenceClass}">${confidencePercent}%</span>
            <span class="ai-template-match">${escapeHtml(docDisplayName)}</span>
        `;
        const approveDisabled = item.is_unrequested;
        actionsHtml = `
            <button class="btn btn-success btn-sm" ${approveDisabled
                ? 'aria-disabled="true" title="לא ניתן לאשר מסמך שלא נדרש — יש לשייך מחדש או לדחות"'
                : `onclick="approveAIClassification('${escapeAttr(item.id)}')"`}>
                <i data-lucide="check" class="icon-sm"></i> אשר
            </button>
            <button class="btn btn-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                <i data-lucide="x" class="icon-sm"></i> דחה
            </button>
            <button class="btn btn-ghost btn-sm" onclick="showAIReassignModal('${escapeAttr(item.id)}', ${escapeAttr(JSON.stringify(missingDocs))})">
                <i data-lucide="arrow-right-left" class="icon-sm"></i> שייך מחדש
            </button>
        `;

    } else if (state === 'issuer-mismatch') {
        // State B: Issuer mismatch — amber border, type confidence with prefix, comparison box
        const templateName = AI_DOC_NAMES[item.matched_template_id] || item.matched_template_name || item.matched_template_id || '';
        const aiIssuer = item.issuer_name || 'לא ידוע';

        // Filter same-type docs (including client/spouse pairs) from missing_docs
        const relatedIds = RELATED_TEMPLATES[item.matched_template_id] || [item.matched_template_id];
        const sameTypeDocs = missingDocs.filter(d => relatedIds.includes(d.template_id));

        let comparisonHtml;
        if (sameTypeDocs.length > 0) {
            // Radio list of same-type required docs
            const radiosHtml = sameTypeDocs.map(d => {
                const docName = d.name || AI_DOC_NAMES[d.template_id] || d.template_id;
                return `
                    <label class="ai-comparison-radio">
                        <input type="radio" name="compare_${escapeAttr(item.id)}"
                            data-template-id="${escapeAttr(d.template_id)}"
                            data-doc-record-id="${escapeAttr(d.doc_record_id || '')}"
                            data-doc-name="${escapeAttr(docName)}"
                            onchange="handleComparisonRadio('${escapeAttr(item.id)}', this)">
                        ${escapeHtml(docName)}
                    </label>
                `;
            }).join('');

            comparisonHtml = `
                <div class="ai-issuer-comparison">
                    <div class="ai-comparison-header">📥 התקבל מ: <span class="ai-issuer-value">${escapeHtml(aiIssuer)}</span></div>
                    <div class="ai-comparison-divider"></div>
                    <div class="ai-comparison-header">📋 נדרשים (${sameTypeDocs.length}):</div>
                    <div class="ai-comparison-radio-list">
                        ${radiosHtml}
                    </div>
                </div>
            `;

            actionsHtml = `
                <button class="btn btn-primary btn-sm btn-ai-comparison-assign" disabled
                    onclick="quickAssignSelected('${escapeAttr(item.id)}')">
                    <i data-lucide="check" class="icon-sm"></i> שייך
                </button>
                <button class="btn btn-ghost btn-sm" onclick="showAIReassignModal('${escapeAttr(item.id)}', ${escapeAttr(JSON.stringify(missingDocs))})">
                    <i data-lucide="arrow-right-left" class="icon-sm"></i> שייך מחדש
                </button>
                <button class="btn btn-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                    <i data-lucide="x" class="icon-sm"></i> דחה
                </button>
            `;
        } else {
            // Edge case: no same-type docs in missing — fall back to full combobox
            comparisonHtml = `
                <div class="ai-issuer-comparison">
                    <div class="ai-comparison-header">📥 התקבל מ: <span class="ai-issuer-value">${escapeHtml(aiIssuer)}</span></div>
                    <div class="ai-comparison-divider"></div>
                    <div class="ai-comparison-header">⚠️ כל מסמכי ${escapeHtml(templateName)} כבר התקבלו</div>
                </div>
            `;
            actionsHtml = `
                <div class="ai-assign-section">
                    <span class="ai-assign-label">שייך ל:</span>
                    <div class="doc-combobox-container" data-record-id="${escapeAttr(item.id)}" data-docs='${escapeAttr(JSON.stringify(missingDocs))}'></div>
                    <button class="btn btn-primary btn-sm btn-ai-assign-confirm" disabled
                        onclick="assignAIUnmatched('${escapeAttr(item.id)}', this)">
                        <i data-lucide="check" class="icon-sm"></i> שייך
                    </button>
                </div>
                <button class="btn btn-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                    <i data-lucide="x" class="icon-sm"></i> דחה
                </button>
            `;
        }

        classificationHtml = `
            <span class="ai-confidence-prefix">סוג מסמך:</span>
            <span class="ai-confidence-badge ${confidenceClass}">${confidencePercent}%</span>
            <span class="ai-template-match">${escapeHtml(templateName)}</span>
            ${comparisonHtml}
        `;

    } else if (state === 'fuzzy') {
        // State C: Fuzzy match — green border, doc name, hint line
        const templateLabel = AI_DOC_NAMES[item.matched_template_id] || item.matched_template_name || '';
        const docName = item.matched_doc_name || '';
        const docDisplayName = templateLabel && docName && !docName.includes(templateLabel)
            ? `${templateLabel} – ${docName}`
            : (docName || templateLabel);
        const aiIssuer = item.issuer_name || '';
        // Extract doc issuer from matched_doc_name (after – separator)
        const docIssuer = (item.matched_doc_name || '').split('–').slice(1).join('–').trim()
                       || (item.matched_doc_name || '').split('-').slice(1).join('-').trim()
                       || '';
        const fuzzyHintHtml = aiIssuer && docIssuer
            ? `<div class="ai-fuzzy-hint">💡 ${escapeHtml(aiIssuer)} ≈ ${escapeHtml(docIssuer)}</div>`
            : '';

        classificationHtml = `
            <span class="ai-confidence-badge ${confidenceClass}">${confidencePercent}%</span>
            <span class="ai-template-match">${escapeHtml(docDisplayName)}</span>
            ${fuzzyHintHtml}
        `;
        const fuzzyApproveDisabled = item.is_unrequested;
        actionsHtml = `
            <button class="btn btn-success btn-sm" ${fuzzyApproveDisabled
                ? 'aria-disabled="true" title="לא ניתן לאשר מסמך שלא נדרש — יש לשייך מחדש או לדחות"'
                : `onclick="approveAIClassification('${escapeAttr(item.id)}')"`}>
                <i data-lucide="check" class="icon-sm"></i> אשר
            </button>
            <button class="btn btn-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                <i data-lucide="x" class="icon-sm"></i> דחה
            </button>
            <button class="btn btn-ghost btn-sm" onclick="showAIReassignModal('${escapeAttr(item.id)}', ${escapeAttr(JSON.stringify(missingDocs))})">
                <i data-lucide="arrow-right-left" class="icon-sm"></i> שייך מחדש
            </button>
        `;

    } else {
        // State D: Unmatched — amber border, show AI reason inline
        const reasonHtml = item.ai_reason
            ? `<div class="ai-reason-inline">${escapeHtml(item.ai_reason)}</div>`
            : '';
        classificationHtml = `
            <span class="ai-confidence-badge ai-confidence-low">--</span>
            <span class="ai-template-unmatched">לא זוהה</span>
            ${reasonHtml}
        `;
        actionsHtml = `
            <div class="ai-assign-section">
                <span class="ai-assign-label">שייך ל:</span>
                <div class="doc-combobox-container" data-record-id="${escapeAttr(item.id)}" data-docs='${escapeAttr(JSON.stringify(missingDocs))}'></div>
                <button class="btn btn-primary btn-sm btn-ai-assign-confirm" disabled
                    onclick="assignAIUnmatched('${escapeAttr(item.id)}', this)">
                    <i data-lucide="check" class="icon-sm"></i> שייך
                </button>
            </div>
            <button class="btn btn-danger btn-sm" onclick="rejectAIClassification('${escapeAttr(item.id)}')">
                <i data-lucide="x" class="icon-sm"></i> דחה
            </button>
        `;
    }

    return `
        <div class="ai-review-card ${cardClass}" data-id="${escapeAttr(item.id)}" ${item.is_unrequested ? 'data-unrequested="true"' : ''}>
            <div class="ai-card-top">
                <div class="ai-file-info">
                    <i data-lucide="${fileIcon}" class="icon-sm"></i>
                    <span class="ai-file-name" ${senderTooltip ? `title="${escapeAttr(senderTooltip)}"` : ''}>${escapeHtml(item.attachment_name || 'ללא שם')}</span>
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
            <div class="ai-card-actions">
                ${actionsHtml}
            </div>
        </div>
    `;
}

function toggleAIAccordion(header) {
    const accordion = header.closest('.ai-accordion');
    accordion.classList.toggle('open');
}

// AI Review Actions
async function parseAIResponse(response) {
    const text = await response.text();
    if (!text) throw new Error('השרת לא החזיר תשובה — ייתכן שגיאה פנימית. נסה שוב.');
    try {
        return JSON.parse(text);
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
            const response = await fetchWithTimeout(`${API_BASE}/review-classification`, {
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

            if (!data.ok) throw new Error(formatAIResponseError(data));

            animateAndRemoveAI(recordId);
            showAIToast(formatAISuccessToast(data), 'success');
        } catch (error) {
            clearCardLoading(recordId);
            showModal('error', 'שגיאה', error.message);
        }
    }, { confirmText: 'אשר', btnClass: 'btn-success' });
}

async function rejectAIClassification(recordId) {
    showInlineConfirm(recordId, 'לדחות את הסיווג?', async () => {
        setCardLoading(recordId, 'דוחה סיווג...');

        try {
            const response = await fetchWithTimeout(`${API_BASE}/review-classification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: authToken,
                    classification_id: recordId,
                    action: 'reject'
                })
            }, FETCH_TIMEOUTS.mutate);

            const data = await parseAIResponse(response);
            clearCardLoading(recordId);

            if (!data.ok) throw new Error(formatAIResponseError(data));

            animateAndRemoveAI(recordId);
            showAIToast(formatAISuccessToast(data), 'danger');
        } catch (error) {
            clearCardLoading(recordId);
            showModal('error', 'שגיאה', error.message);
        }
    }, { confirmText: 'דחה', danger: true });
}

function showAIReassignModal(recordId, missingDocs) {
    if (typeof missingDocs === 'string') {
        try { missingDocs = JSON.parse(missingDocs); } catch (e) { missingDocs = []; }
    }

    aiCurrentReassignId = recordId;

    const item = aiClassificationsData.find(i => i.id === recordId);
    const fileInfoEl = document.getElementById('aiReassignFileInfo');
    if (item) {
        fileInfoEl.innerHTML = `<i data-lucide="file" class="icon-sm" style="display:inline;vertical-align:middle;"></i> ${escapeHtml(item.attachment_name || 'ללא שם')}`;
    } else {
        fileInfoEl.textContent = '';
    }

    const comboContainer = document.getElementById('aiReassignComboboxContainer');
    const currentMatchId = item ? item.matched_template_id : null;

    document.getElementById('aiReassignConfirmBtn').disabled = true;
    createDocCombobox(comboContainer, missingDocs, {
        currentMatchId,
        allowCreate: true,
        onSelect: (templateId) => {
            document.getElementById('aiReassignConfirmBtn').disabled = !templateId;
        }
    });

    document.getElementById('aiReassignModal').classList.add('show');
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
    closeAIReassignModal();

    if (templateId === '__NEW__' && newDocName.trim()) {
        await submitAIReassign(recordId, 'general_doc', '', null, newDocName.trim());
    } else {
        await submitAIReassign(recordId, templateId, docRecordId);
    }
}

async function submitAIReassign(recordId, templateId, docRecordId, loadingText, newDocName) {
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

        const response = await fetchWithTimeout(`${API_BASE}/review-classification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, FETCH_TIMEOUTS.mutate);

        const data = await parseAIResponse(response);
        clearCardLoading(recordId);

        if (!data.ok) throw new Error(formatAIResponseError(data));

        animateAndRemoveAI(recordId);
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

    if (templateId === '__NEW__' && newDocName.trim()) {
        showInlineConfirm(recordId, `ליצור מסמך "${newDocName.trim()}"?`, async () => {
            await submitAIReassign(recordId, 'general_doc', '', 'יוצר ומשייך...', newDocName.trim());
        }, { confirmText: 'צור ושייך' });
    } else {
        showInlineConfirm(recordId, 'לשייך?', async () => {
            await submitAIReassign(recordId, templateId, docRecordId, 'משייך...');
        }, { confirmText: 'שייך' });
    }
}

function animateAndRemoveAI(recordId) {
    aiClassificationsData = aiClassificationsData.filter(item => item.id !== recordId);

    const card = document.querySelector(`.ai-review-card[data-id="${recordId}"]`);
    if (card) {
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
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }

            recalcAIStats();
        }, 350);
    } else {
        recalcAIStats();
    }
}

function recalcAIStats() {
    const total = aiClassificationsData.length;
    const matched = aiClassificationsData.filter(i => !!i.matched_template_id).length;
    const unmatched = total - matched;
    const mismatchCount = aiClassificationsData.filter(i =>
        i.matched_template_id && i.issuer_match_quality === 'mismatch'
    ).length;

    document.getElementById('ai-stat-pending').textContent = total;
    document.getElementById('ai-stat-matched').textContent = matched;
    document.getElementById('ai-stat-unmatched').textContent = unmatched;
    document.getElementById('ai-stat-high-confidence').textContent = mismatchCount;

    // Update tab badge
    const badge = document.getElementById('aiReviewTabBadge');
    if (total > 0) {
        badge.textContent = total;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
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

function showAIToast(message, type) {
    const toast = document.getElementById('aiToast');
    const toastText = document.getElementById('aiToastText');
    const toastIcon = document.getElementById('aiToastIcon');

    toastText.textContent = message;
    toast.className = 'ai-toast ai-toast-' + (type || 'success');

    if (type === 'danger') {
        toastIcon.setAttribute('data-lucide', 'x-circle');
    } else {
        toastIcon.setAttribute('data-lucide', 'check-circle');
    }

    toast.classList.add('show');
    if (typeof lucide !== 'undefined') lucide.createIcons();

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ==================== REMINDERS TAB ====================

let remindersData = [];
let reminderLoaded = false;

async function loadReminders(silent = false) {
    if (!silent) showLoading('טוען תזכורות...');

    try {
        const response = await fetchWithTimeout(`${API_BASE}/admin-reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: authToken, action: 'list' })
        }, FETCH_TIMEOUTS.load);
        const data = await response.json();

        if (!silent) hideLoading();

        if (!data.ok) {
            if (data.error === 'unauthorized') { logout(); return; }
            throw new Error(data.error || 'שגיאה בטעינת הנתונים');
        }

        remindersData = data.items || [];
        reminderLoaded = true;
        updateReminderStats(data.stats || {});
        filterReminders();

        // Update tab badge
        const badge = document.getElementById('reminderTabBadge');
        const dueCount = data.stats?.due_this_week || 0;
        if (dueCount > 0) {
            badge.textContent = dueCount;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (error) {
        if (!silent) hideLoading();
        console.error('Reminders load error:', error);
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
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

async function loadReminderCount() {
    const badge = document.getElementById('reminderTabBadge');
    try {
        const resp = await fetchWithTimeout(`${API_BASE}/admin-reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: authToken, action: 'list', stats_only: true })
        }, FETCH_TIMEOUTS.quick);
        const data = await resp.json();
        if (data.ok && data.stats && data.stats.due_this_week > 0) {
            badge.textContent = data.stats.due_this_week;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {
        badge.style.display = 'none';
    }
}

function updateReminderStats(stats) {
    document.getElementById('reminder-stat-scheduled').textContent = stats.scheduled || 0;
    document.getElementById('reminder-stat-due').textContent = stats.due_this_week || 0;
    document.getElementById('reminder-stat-suppressed').textContent = stats.suppressed || 0;
    document.getElementById('reminder-stat-exhausted').textContent = stats.exhausted || 0;
}

function isExhausted(r) {
    const max = r.reminder_max != null ? r.reminder_max : 3;
    return r.reminder_count >= max && !r.reminder_suppress;
}

function getReminderStatus(r) {
    if (r.reminder_suppress === 'forever') return { label: 'מושתק לצמיתות', class: 'reminder-status-suppressed', key: 'suppressed' };
    if (r.reminder_suppress === 'this_month') return { label: 'מושתק החודש', class: 'reminder-status-suppressed', key: 'suppressed' };
    if (isExhausted(r)) return { label: 'מוצה', class: 'reminder-status-exhausted', key: 'exhausted' };
    return { label: 'פעיל', class: 'reminder-status-active', key: 'active' };
}

function filterReminders() {
    const search = (document.getElementById('reminderSearchInput').value || '').trim().toLowerCase();
    const typeFilter = document.getElementById('reminderTypeFilter').value;
    const statusFilter = document.getElementById('reminderStatusFilter').value;

    let filtered = remindersData;

    if (search) {
        filtered = filtered.filter(r => (r.name || '').toLowerCase().includes(search));
    }

    if (typeFilter) {
        filtered = filtered.filter(r => r.reminder_type === typeFilter);
    }

    if (statusFilter) {
        filtered = filtered.filter(r => getReminderStatus(r).key === statusFilter);
    }

    // Sort by next_date ascending (nulls last)
    filtered.sort((a, b) => {
        const da = a.reminder_next_date || '9999';
        const db = b.reminder_next_date || '9999';
        return da.localeCompare(db);
    });

    renderRemindersTable(filtered);
}

function renderRemindersTable(items) {
    const container = document.getElementById('reminderTableContainer');

    if (!items || items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="bell" class="icon-2xl"></i></div>
                <p>${remindersData.length === 0 ? 'אין תזכורות מתוזמנות' : 'אין תוצאות לסינון הנוכחי'}</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    let html = `
        <table>
            <thead>
                <tr>
                    <th><input type="checkbox" id="reminderSelectAll" onchange="toggleReminderSelectAll()"></th>
                    <th>שם</th>
                    <th>סוג</th>
                    <th>שלב</th>
                    <th>מסמכים</th>
                    <th>תאריך הבא</th>
                    <th>נשלחו/מקס</th>
                    <th>סטטוס</th>
                    <th>פעולות</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const r of items) {
        const stage = STAGES[r.stage] || { label: r.stage, icon: 'help-circle', class: '' };
        const status = getReminderStatus(r);
        const max = r.reminder_max != null ? r.reminder_max : 3;
        const nextDate = r.reminder_next_date ? formatDateHe(r.reminder_next_date) : '-';
        const isDue = r.reminder_next_date && r.reminder_next_date <= today;
        const isDueSoon = r.reminder_next_date && r.reminder_next_date <= weekFromNow && !isDue;
        const dateClass = isDue ? 'reminder-date-due' : isDueSoon ? 'reminder-date-soon' : '';
        const docsReceived = r.docs_received || 0;
        const docsTotal = r.docs_total || 0;
        const progressPercent = docsTotal > 0 ? Math.round((docsReceived / docsTotal) * 100) : 0;

        html += `
            <tr>
                <td><input type="checkbox" class="reminder-checkbox" value="${escapeAttr(r.report_id)}" onchange="updateReminderSelectedCount()"></td>
                <td>
                    <strong class="client-link" onclick="viewClientDocs('${escapeAttr(r.report_id)}', '${escapeHtml(r.name)}', '${escapeHtml(r.email || '')}', '${r.year}')">
                        ${escapeHtml(r.name)}
                    </strong>
                </td>
                <td><span class="reminder-type-badge reminder-type-${r.reminder_type || 'A'}">${r.reminder_type || 'A'}</span></td>
                <td><span class="stage-badge ${stage.class}"><i data-lucide="${stage.icon}" class="icon-sm"></i> ${stage.label}</span></td>
                <td>
                    ${r.reminder_type === 'B' ? `
                        <div class="docs-progress-cell">
                            <div class="progress-bar"><div class="progress-fill" style="width: ${progressPercent}%"></div></div>
                            <span class="docs-count">${docsReceived}/${docsTotal}</span>
                        </div>
                    ` : '-'}
                </td>
                <td><span class="reminder-date ${dateClass}">${nextDate}</span></td>
                <td>${r.reminder_count}/${max}</td>
                <td><span class="reminder-status ${status.class}">${status.label}</span></td>
                <td>
                    <div class="reminder-row-actions">
                        ${!r.reminder_suppress ? `
                            <button class="action-btn send" onclick="reminderAction('send_now', '${escapeAttr(r.report_id)}')" title="שלח עכשיו">
                                <i data-lucide="send" class="icon-sm"></i>
                            </button>
                            <button class="action-btn reminder-suppress-btn" onclick="reminderAction('suppress_this_month', '${escapeAttr(r.report_id)}')" title="השתק החודש">
                                <i data-lucide="bell-minus" class="icon-sm"></i>
                            </button>
                        ` : `
                            <button class="action-btn send" onclick="reminderAction('unsuppress', '${escapeAttr(r.report_id)}')" title="הפעל מחדש">
                                <i data-lucide="bell" class="icon-sm"></i>
                            </button>
                        `}
                        <button class="action-btn reminder-date-btn" onclick="showReminderDatePicker('${escapeAttr(r.report_id)}', '${r.reminder_next_date || ''}')" title="שנה תאריך">
                            <i data-lucide="calendar" class="icon-sm"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
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

function toggleReminderSelectAll() {
    const checked = document.getElementById('reminderSelectAll').checked;
    document.querySelectorAll('.reminder-checkbox').forEach(cb => cb.checked = checked);
    updateReminderSelectedCount();
}

function updateReminderSelectedCount() {
    const count = document.querySelectorAll('.reminder-checkbox:checked').length;
    document.getElementById('reminderSelectedCount').textContent = count;
    document.getElementById('reminderBulkActions').style.display = count > 0 ? 'flex' : 'none';
}

async function reminderAction(action, reportId) {
    await executeReminderAction(action, [reportId]);
}

async function reminderBulkAction(action) {
    const reportIds = Array.from(document.querySelectorAll('.reminder-checkbox:checked')).map(cb => cb.value);
    if (reportIds.length === 0) return;

    if (action === 'send_now' && !confirm(`לשלוח תזכורת ל-${reportIds.length} לקוחות?`)) return;
    if (action === 'suppress_forever' && !confirm(`להשתיק לצמיתות ${reportIds.length} לקוחות?`)) return;

    await executeReminderAction(action, reportIds);
}

async function executeReminderAction(action, reportIds, value) {
    showLoading('מעדכן...');

    try {
        const body = { token: authToken, action, report_ids: reportIds };
        if (value !== undefined) body.value = value;

        const response = await fetchWithTimeout(`${API_BASE}/admin-reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, FETCH_TIMEOUTS.mutate);

        const data = await response.json();
        hideLoading();

        if (!data.ok) throw new Error(data.error || 'שגיאה לא ידועה');

        const actionLabels = {
            send_now: 'תזכורת נשלחה',
            suppress_this_month: 'הושתק החודש',
            suppress_forever: 'הושתק לצמיתות',
            unsuppress: 'הופעל מחדש',
            change_date: 'תאריך עודכן',
            set_max: 'מקסימום עודכן'
        };
        showAIToast(actionLabels[action] || 'עודכן בהצלחה', 'success');
        loadReminders(true);
    } catch (error) {
        hideLoading();
        showModal('error', 'שגיאה', error.message);
    }
}

function setManualReminder(reportId, clientName) {
    const today = new Date().toISOString().split('T')[0];
    showConfirmDialog(
        `להגדיר תזכורת ל-${clientName}?`,
        () => executeReminderAction('change_date', [reportId], today),
        'הגדר תזכורת'
    );
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

// ==================== UTILITIES ====================

function viewClient(reportId) {
    // Admin token is already in localStorage (same origin) — view-documents.html reads it directly
    window.open(`https://liozshor.github.io/annual-reports-client-portal/view-documents.html?report_id=${reportId}`, '_blank');
}

function viewClientDocs(reportId, name, email, year) {
    // Navigate in same tab
    const params = new URLSearchParams({
        report_id: reportId || '',
        client_name: name,
        email: email, // Optional, might be useful
        year: year
    });
    // Add spouse if available (fetching from spouseName if we had it, but currently we rely on URL params or fetching in next page)
    // Note: The renderClientsTable logic doesn't seemingly pass spouse_name directly.
    // We'll pass what we have. Document manager usually fetches details or uses params for display.
    // If 'spouse_name' is missing in clientsData, we can't pass it yet.
    // However, document-manager fetches get-documents which might return spouse name?
    // Let's check: document-manager.js uses params.get('spouse_name') for display.
    // Admin dashboard 'clientsData' might not have spouse_name?
    // Checking dashboard response... usually has 'name', 'email', 'year', 'stage'.
    // If spouse_name isn't in dashboard data, it will be '-' on the next page until we fetch it there.
    // We will proceed with available data.

    window.location.href = `../document-manager.html?${params.toString()}`;
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

function showLoading(text) {
    document.getElementById('loadingText').textContent = text || 'מעבד...';
    document.getElementById('loadingOverlay').classList.add('visible');

    // Safety timeout: auto-hide after 25s and show error
    clearTimeout(_loadingSafetyTimer);
    _loadingSafetyTimer = setTimeout(function () {
        hideLoading();
        showModal('error', 'שגיאה', 'הפעולה ארכה זמן רב מדי. אנא נסו שוב.');
    }, 25000);
}

function hideLoading() {
    clearTimeout(_loadingSafetyTimer);
    _loadingSafetyTimer = null;
    document.getElementById('loadingOverlay').classList.remove('visible');
}

function showModal(type, title, body, stats = null) {
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
            statsHtml += `<div class="modal-stat"><div class="modal-stat-number" style="color: var(--warning-500)">${stats.skipped}</div><div class="modal-stat-label">נדלגו</div></div>`;
        }
        if (stats.sent !== undefined) {
            statsHtml += `<div class="modal-stat"><div class="modal-stat-number">${stats.sent}</div><div class="modal-stat-label">נשלחו</div></div>`;
        }
        document.getElementById('modalStats').innerHTML = statsHtml;
    } else {
        document.getElementById('modalStats').innerHTML = '';
    }

    document.getElementById('resultModal').classList.add('visible');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeModal() {
    document.getElementById('resultModal').classList.remove('visible');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
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

    if (typeof lucide !== 'undefined') lucide.createIcons();
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
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeConfirmDialog(confirmed) {
    document.getElementById('confirmDialog').classList.remove('show');
    const cb = _confirmCallback;
    _confirmCallback = null;
    if (confirmed && cb) cb();
}

// ==================== INIT ====================

// Initialize Lucide icons and offline detection when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    initOfflineDetection();
});

// Initialize
checkAuth();
