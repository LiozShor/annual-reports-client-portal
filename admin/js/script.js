// Configuration
const API_BASE = 'https://liozshor.app.n8n.cloud/webhook';
const ADMIN_TOKEN_KEY = 'QKiwUBXVH@%#1gD7t@rB]<,dM.[NC5b_';
const SESSION_FLAG_KEY = 'admin_session_active';

// State
let authToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
let clientsData = [];
let importData = [];
let existingEmails = new Set();

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

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
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

        // Render table
        renderClientsTable(clientsData);

        // Ensure the correct stat card is active based on current filter
        const currentStageFilter = document.getElementById('stageFilter').value;
        toggleStageFilter(currentStageFilter, false); // Pass false to prevent re-filtering
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
                <div class="empty-state-icon"><i class="fa-solid fa-folder-open"></i></div>
                <p>לא נמצאו לקוחות</p>
            </div>
        `;
        return;
    }

    const stageLabels = {
        '1-Send_Questionnaire': { text: '<i class="fa-solid fa-clipboard-list"></i> ממתין לשליחה', class: 'stage-1' },
        '2-Waiting_For_Answers': { text: '<i class="fa-solid fa-hourglass-half"></i> ממתין לתשובה', class: 'stage-2' },
        '3-Collecting_Docs': { text: '<i class="fa-solid fa-folder-open"></i> אוסף מסמכים', class: 'stage-3' },
        '4-Review': { text: '<i class="fa-solid fa-magnifying-glass"></i> בבדיקה', class: 'stage-4' },
        '5-Completed': { text: '<i class="fa-solid fa-check-circle"></i> הושלם', class: 'stage-5' }
    };

    let html = `
        <table>
            <thead>
                <tr>
                    <th>שם</th>
                    <th>אימייל</th>
                    <th>שנה</th>
                    <th>שלב</th>
                    <th>מסמכים</th>
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

        html += `
            <tr>
                <td>
                    <strong 
                        class="client-link" 
                        style="cursor: pointer; color: var(--primary-color); text-decoration: underline;"
                        onclick="viewClientDocs('${client.report_id}', '${escapeHtml(client.name)}', '${escapeHtml(client.email || '')}', '${client.year}')"
                    >
                        ${escapeHtml(client.name)}
                    </strong>
                </td>
                <td>${escapeHtml(client.email)}</td>
                <td>${client.year}</td>
                <td><span class="stage-badge ${stage.class}">${stage.text}</span></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <span>${docsReceived}/${docsTotal}</span>
                    </div>
                </td>
                <td>
                    <button class="action-btn view" onclick="viewClient('${client.report_id}')" title="צפה בתיק"><i class="fa-solid fa-eye"></i></button>
                    ${client.stage === '1-Send_Questionnaire' ?
                `<button class="action-btn send" onclick="sendSingle('${client.report_id}')" title="שלח שאלון"><i class="fa-solid fa-paper-plane"></i></button>` :
                ''}
                </td>
            </tr>
        `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
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
        btnManual.className = 'btn btn-outline';
        btnManual.disabled = false;
    } else {
        btnImport.className = 'btn btn-outline';
        btnImport.disabled = false;
        btnManual.className = 'btn btn-primary';
        btnManual.disabled = true;
    }
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
                <div class="empty-state-icon"><i class="fa-solid fa-check-circle"></i></div>
                <p>אין לקוחות ממתינים לשליחת שאלון</p>
            </div>
        `;
        document.getElementById('sendActions').style.display = 'none';
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
    const icons = { success: '<i class="fa-solid fa-check-circle"></i>', error: '<i class="fa-solid fa-circle-exclamation"></i>', warning: '<i class="fa-solid fa-triangle-exclamation"></i>' };
    document.getElementById('modalIcon').innerHTML = icons[type] || '<i class="fa-solid fa-check-circle"></i>';
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').textContent = body;

    if (stats) {
        let statsHtml = '';
        if (stats.created !== undefined) {
            statsHtml += `<div class="modal-stat"><div class="modal-stat-number">${stats.created}</div><div class="modal-stat-label">נוצרו</div></div>`;
        }
        if (stats.skipped !== undefined) {
            statsHtml += `<div class="modal-stat"><div class="modal-stat-number" style="color: #f59e0b">${stats.skipped}</div><div class="modal-stat-label">נדלגו</div></div>`;
        }
        if (stats.sent !== undefined) {
            statsHtml += `<div class="modal-stat"><div class="modal-stat-number">${stats.sent}</div><div class="modal-stat-label">נשלחו</div></div>`;
        }
        document.getElementById('modalStats').innerHTML = statsHtml;
    } else {
        document.getElementById('modalStats').innerHTML = '';
    }

    document.getElementById('resultModal').classList.add('visible');
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

// Initialize
checkAuth();
