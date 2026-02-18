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

// ==================== AUTH ====================

async function login() {
    const password = document.getElementById('passwordInput').value;
    if (!password) return;

    showLoading('מאמת...');

    try {
        const response = await fetch(`${API_BASE}/admin-auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

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
        const response = await fetch(`${API_BASE}/admin-verify?token=${authToken}`);
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

    // Load AI review data fresh each time tab is opened
    if (tabName === 'ai-review') {
        loadAIClassifications();
    }
}

// ==================== DASHBOARD ====================

async function loadDashboard() {
    showLoading('טוען נתונים...');

    try {
        const year = document.getElementById('yearFilter')?.value || '2025';
        const response = await fetch(`${API_BASE}/admin-dashboard?token=${authToken}&year=${year}`);
        const data = await response.json();

        hideLoading();

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
    } catch (error) {
        hideLoading();
        console.error('Dashboard error:', error);
        showModal('error', 'שגיאה', 'לא ניתן לטעון את הנתונים');
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

    const stageLabels = {
        '1-Send_Questionnaire': { text: '<i data-lucide="clipboard-list" class="icon-sm"></i> ממתין לשליחה', class: 'stage-1' },
        '2-Waiting_For_Answers': { text: '<i data-lucide="hourglass" class="icon-sm"></i> ממתין לתשובה', class: 'stage-2' },
        '3-Collecting_Docs': { text: '<i data-lucide="folder-open" class="icon-sm"></i> אוסף מסמכים', class: 'stage-3' },
        '4-Review': { text: '<i data-lucide="search" class="icon-sm"></i> בבדיקה', class: 'stage-4' },
        '5-Completed': { text: '<i data-lucide="circle-check" class="icon-sm"></i> הושלם', class: 'stage-5' }
    };

    let html = `
        <table>
            <thead>
                <tr>
                    <th>שם</th>
                    <th>שלב</th>
                    <th>מסמכים</th>
                    <th>חסרים</th>
                    <th>פעולות</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const client of clients) {
        const stage = stageLabels[client.stage] || { text: client.stage, class: '' };
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
                <td><span class="stage-badge ${stage.class}">${stage.text}</span></td>
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
        const stageMap = {
            '1': '1-Send_Questionnaire',
            '2': '2-Waiting_For_Answers',
            '3': '3-Collecting_Docs',
            '4': '4-Review',
            '5': '5-Completed'
        };
        filtered = filtered.filter(c => c.stage === stageMap[stage]);
    }

    if (year) {
        filtered = filtered.filter(c => String(c.year) === year);
    }

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

function refreshData() {
    loadDashboard();
}

// Load AI review pending count for tab badge
async function loadAIReviewCount() {
    try {
        const resp = await fetch(`${API_BASE}/get-pending-classifications?token=${authToken}`);
        const data = await resp.json();
        const badge = document.getElementById('aiReviewTabBadge');
        if (data.ok && data.stats && data.stats.total_pending > 0) {
            badge.textContent = data.stats.total_pending;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {
        // Silently fail - badge stays hidden
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
        const response = await fetch(`${API_BASE}/admin-bulk-import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                year: parseInt(year),
                clients: clients
            })
        });

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

async function loadPendingClients() {
    showLoading('טוען לקוחות ממתינים...');

    try {
        const year = document.getElementById('sendYearFilter').value;
        const response = await fetch(`${API_BASE}/admin-pending?token=${authToken}&year=${year}`);
        const data = await response.json();

        hideLoading();

        if (!data.ok) throw new Error(data.error);

        pendingClients = data.clients || [];
        renderPendingClients();

    } catch (error) {
        hideLoading();
        showModal('error', 'שגיאה', 'לא ניתן לטעון את הרשימה');
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

async function sendQuestionnaires(reportIds) {
    showLoading(`שולח ${reportIds.length} שאלונים...`);

    try {
        const response = await fetch(`${API_BASE}/admin-send-questionnaires`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                report_ids: reportIds
            })
        });

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
        showModal('error', 'שגיאה', 'לא ניתן לשלוח: ' + error.message);
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

async function markComplete(reportId, name) {
    if (!confirm(`לסמן את "${name}" כהושלם?`)) return;

    showLoading('מעדכן...');

    try {
        const response = await fetch(`${API_BASE}/admin-mark-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                report_id: reportId
            })
        });

        const data = await response.json();
        hideLoading();

        if (!data.ok) throw new Error(data.error);

        showModal('success', 'הושלם!', `"${name}" סומן כהושלם בהצלחה.`);
        loadDashboard();

    } catch (error) {
        hideLoading();
        showModal('error', 'שגיאה', 'לא ניתן לעדכן: ' + error.message);
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

// ==================== AI REVIEW ====================

let aiClassificationsData = [];
let aiCurrentReassignId = null;
let aiReviewLoaded = false;

async function loadAIClassifications() {
    showLoading('טוען סיווגים...');

    try {
        const response = await fetch(`${API_BASE}/get-pending-classifications?token=${authToken}`);
        const data = await response.json();

        hideLoading();

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
        hideLoading();
        console.error('AI Review load error:', error);
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

function updateAIStats(stats) {
    document.getElementById('ai-stat-pending').textContent = stats.total_pending || 0;
    document.getElementById('ai-stat-matched').textContent = stats.matched || 0;
    document.getElementById('ai-stat-unmatched').textContent = stats.unmatched || 0;
    document.getElementById('ai-stat-high-confidence').textContent = stats.high_confidence || 0;
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
        const matchedCount = clientItems.filter(i => !!i.matched_template_id).length;
        const unmatchedCount = clientItems.length - matchedCount;
        const avgConf = clientItems.reduce((sum, i) => sum + (i.ai_confidence || 0), 0) / clientItems.length;
        const avgConfPct = Math.round(avgConf * 100);

        html += `
            <div class="ai-accordion" data-client="${escapeHtml(clientName)}">
                <div class="ai-accordion-header" onclick="toggleAIAccordion(this)">
                    <div class="ai-accordion-title">
                        <i data-lucide="user" class="icon-sm"></i>
                        ${escapeHtml(clientName)}
                    </div>
                    <div class="ai-accordion-stats">
                        <span class="ai-accordion-stat"><span class="stat-dot pending"></span> ${clientItems.length} ממתינים</span>
                        <span class="ai-accordion-stat"><span class="stat-dot matched"></span> ${matchedCount} זוהו</span>
                        <span class="ai-accordion-stat"><span class="stat-dot unmatched"></span> ${unmatchedCount} לא זוהו</span>
                        <span class="ai-accordion-stat">⌀ ${avgConfPct}%</span>
                    </div>
                    <span class="ai-accordion-icon">▾</span>
                </div>
                <div class="ai-accordion-body">
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

    // Wire up assign dropdowns
    container.querySelectorAll('.ai-assign-select-inline').forEach(select => {
        select.addEventListener('change', function() {
            const btn = this.closest('.ai-card-actions').querySelector('.btn-ai-assign-confirm');
            if (btn) btn.disabled = !this.value;
        });
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderAICard(item) {
    const isMatched = !!item.matched_template_id;
    const confidence = item.ai_confidence || 0;
    const confidencePercent = Math.round(confidence * 100);
    const confidenceClass = confidence >= 0.85 ? 'ai-confidence-high' :
                           confidence >= 0.50 ? 'ai-confidence-medium' : 'ai-confidence-low';
    const cardClass = isMatched ? 'matched' : 'unmatched';

    const fileIcon = getAIFileIcon(item.attachment_content_type || item.attachment_name || '');
    const fileMeta = formatAIFileMeta(item.attachment_size, item.attachment_content_type);
    const receivedAt = item.received_at ? formatAIDate(item.received_at) : '';
    const senderEmail = item.sender_email || '';

    const missingDocs = item.missing_docs || [];
    const missingDocsHtml = missingDocs.length > 0
        ? missingDocs.map(d => `<span class="ai-missing-doc-tag">${escapeHtml(d.name || '')}</span>`).join(' ')
        : '<span style="color: var(--gray-400)">אין מסמכים חסרים</span>';

    let classificationHtml;
    if (isMatched) {
        classificationHtml = `
            <span class="ai-confidence-badge ${confidenceClass}">${confidencePercent}%</span>
            <span class="ai-template-match">${escapeHtml(item.matched_template_name || '')}</span>
        `;
    } else {
        classificationHtml = `
            <span class="ai-confidence-badge ai-confidence-low">--</span>
            <span class="ai-template-unmatched">לא זוהה</span>
        `;
    }

    let actionsHtml;
    if (isMatched) {
        actionsHtml = `
            <button class="btn btn-success btn-sm" onclick="approveAIClassification('${escapeAttr(item.id)}')">
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
        const optionsHtml = missingDocs.map(d =>
            `<option value="${escapeAttr(d.template_id || '')}">${escapeHtml(d.name || '')}</option>`
        ).join('');

        actionsHtml = `
            <div class="ai-assign-section">
                <span class="ai-assign-label">שייך ל:</span>
                <select class="ai-assign-select-inline" data-record-id="${escapeAttr(item.id)}">
                    <option value="">-- בחר מסמך --</option>
                    ${optionsHtml}
                </select>
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

    const viewFileBtn = item.file_url
        ? `<a href="${escapeAttr(item.file_url)}" target="_blank" class="btn btn-ghost btn-sm">
               <i data-lucide="external-link" class="icon-sm"></i> צפה בקובץ
           </a>`
        : '';

    return `
        <div class="ai-review-card ${cardClass}" data-id="${escapeAttr(item.id)}">
            <div class="ai-card-top">
                <div class="ai-file-info">
                    <i data-lucide="${fileIcon}" class="icon-sm"></i>
                    <span class="ai-file-name">${escapeHtml(item.attachment_name || 'ללא שם')}</span>
                    <span class="ai-file-meta">${escapeHtml(fileMeta)}</span>
                </div>
                ${viewFileBtn}
            </div>
            <div class="ai-card-body">
                <div class="ai-sender-info">
                    ${senderEmail ? `<span class="ai-sender-detail"><i data-lucide="mail" class="icon-sm"></i> ${escapeHtml(senderEmail)}</span>` : ''}
                    ${receivedAt ? `<span class="ai-sender-detail"><i data-lucide="calendar" class="icon-sm"></i> ${escapeHtml(receivedAt)}</span>` : ''}
                </div>
                <div class="ai-classification-result">
                    <div class="ai-classification-label">
                        ${classificationHtml}
                    </div>
                    ${item.ai_reason ? `<div class="ai-evidence">${escapeHtml(item.ai_reason)}</div>` : ''}
                    ${item.issuer_name ? `<div class="ai-issuer-info"><i data-lucide="building-2" class="icon-sm"></i> ${escapeHtml(item.issuer_name)}</div>` : ''}
                </div>
                <div class="ai-missing-docs-context">
                    <span class="ai-context-label">מסמכים חסרים:</span>
                    ${missingDocsHtml}
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
async function approveAIClassification(recordId) {
    if (!confirm('לאשר את הסיווג?')) return;

    showLoading('מאשר סיווג...');

    try {
        const response = await fetch(`${API_BASE}/review-classification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: recordId,
                action: 'approve'
            })
        });

        const data = await response.json();
        hideLoading();

        if (!data.ok) throw new Error(data.error || 'שגיאה באישור הסיווג');

        animateAndRemoveAI(recordId);
        showAIToast('הסיווג אושר בהצלחה', 'success');
    } catch (error) {
        hideLoading();
        showModal('error', 'שגיאה', error.message);
    }
}

async function rejectAIClassification(recordId) {
    if (!confirm('לדחות את הסיווג? המסמך יוסר מהתור.')) return;

    showLoading('דוחה סיווג...');

    try {
        const response = await fetch(`${API_BASE}/review-classification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: recordId,
                action: 'reject'
            })
        });

        const data = await response.json();
        hideLoading();

        if (!data.ok) throw new Error(data.error || 'שגיאה בדחיית הסיווג');

        animateAndRemoveAI(recordId);
        showAIToast('הסיווג נדחה', 'danger');
    } catch (error) {
        hideLoading();
        showModal('error', 'שגיאה', error.message);
    }
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

    const select = document.getElementById('aiReassignSelect');
    select.innerHTML = '<option value="">-- בחר מסמך --</option>';
    for (const doc of missingDocs) {
        const opt = document.createElement('option');
        opt.value = doc.template_id || '';
        opt.textContent = doc.name || '';
        select.appendChild(opt);
    }

    document.getElementById('aiReassignConfirmBtn').disabled = true;
    select.onchange = function () {
        document.getElementById('aiReassignConfirmBtn').disabled = !this.value;
    };

    document.getElementById('aiReassignModal').classList.add('show');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeAIReassignModal() {
    document.getElementById('aiReassignModal').classList.remove('show');
    aiCurrentReassignId = null;
}

async function confirmAIReassign() {
    const templateId = document.getElementById('aiReassignSelect').value;
    if (!templateId || !aiCurrentReassignId) return;

    closeAIReassignModal();
    await submitAIReassign(aiCurrentReassignId, templateId);
}

async function submitAIReassign(recordId, templateId) {
    showLoading('משייך מחדש...');

    try {
        const response = await fetch(`${API_BASE}/review-classification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: authToken,
                classification_id: recordId,
                action: 'reassign',
                reassign_template_id: templateId
            })
        });

        const data = await response.json();
        hideLoading();

        if (!data.ok) throw new Error(data.error || 'שגיאה בשיוך מחדש');

        animateAndRemoveAI(recordId);
        showAIToast('המסמך שויך מחדש בהצלחה', 'success');
    } catch (error) {
        hideLoading();
        showModal('error', 'שגיאה', error.message);
    }
}

async function assignAIUnmatched(recordId, btnEl) {
    const actionsContainer = btnEl.closest('.ai-card-actions');
    const select = actionsContainer.querySelector('.ai-assign-select-inline');
    const templateId = select ? select.value : '';
    if (!templateId) return;
    await submitAIReassign(recordId, templateId);
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
    const highConf = aiClassificationsData.filter(i => (i.ai_confidence || 0) >= 0.85).length;

    document.getElementById('ai-stat-pending').textContent = total;
    document.getElementById('ai-stat-matched').textContent = matched;
    document.getElementById('ai-stat-unmatched').textContent = unmatched;
    document.getElementById('ai-stat-high-confidence').textContent = highConf;

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

function formatAIFileMeta(size, contentType) {
    const parts = [];
    if (size) {
        if (size < 1024) parts.push(`${size}B`);
        else if (size < 1024 * 1024) parts.push(`${Math.round(size / 1024)}KB`);
        else parts.push(`${(size / (1024 * 1024)).toFixed(1)}MB`);
    }
    if (contentType) {
        const short = contentType.replace('application/', '').replace('image/', '').split(';')[0];
        parts.push(short);
    }
    return parts.join(' \u2022 ');
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

// ==================== UTILITIES ====================

function viewClient(reportId) {
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

function showLoading(text) {
    document.getElementById('loadingText').textContent = text || 'מעבד...';
    document.getElementById('loadingOverlay').classList.add('visible');
}

function hideLoading() {
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

// ==================== INIT ====================

// Initialize Lucide icons when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
});

// Initialize
checkAuth();
