// ===========================================
// Document Review - AI Classification Review
// ===========================================

// Configuration
const API_BASE = 'https://liozshor.app.n8n.cloud/webhook';
const ADMIN_TOKEN_KEY = 'QKiwUBXVH@%#1gD7t@rB]<,dM.[NC5b_';
const SESSION_FLAG_KEY = 'admin_session_active';

// State
let authToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
let classificationsData = [];
let currentReassignId = null;

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
            loadClassifications();
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

async function checkAuth() {
    if (!authToken) return;

    if (sessionStorage.getItem(SESSION_FLAG_KEY) === 'true') {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('app').classList.add('visible');
        loadClassifications();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin-verify?token=${authToken}`);
        const data = await response.json();

        if (data.ok) {
            sessionStorage.setItem(SESSION_FLAG_KEY, 'true');
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('app').classList.add('visible');
            loadClassifications();
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

document.getElementById('passwordInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});

// ==================== DATA LOADING ====================

async function loadClassifications() {
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

        classificationsData = data.items || [];
        updateStats(data.stats || {});
        applyFilters();
    } catch (error) {
        hideLoading();
        console.error('Load error:', error);
        showError('לא ניתן לטעון את הסיווגים. נסה שוב.');
    }
}

// ==================== STATS ====================

function updateStats(stats) {
    document.getElementById('stat-pending').textContent = stats.total_pending || 0;
    document.getElementById('stat-matched').textContent = stats.matched || 0;
    document.getElementById('stat-unmatched').textContent = stats.unmatched || 0;
    document.getElementById('stat-high-confidence').textContent = stats.high_confidence || 0;
}

// ==================== FILTERING ====================

function applyFilters() {
    const searchText = (document.getElementById('searchInput').value || '').trim().toLowerCase();
    const confidenceFilter = document.getElementById('confidenceFilter').value;
    const typeFilter = document.getElementById('typeFilter').value;

    let filtered = classificationsData;

    // Search by client name
    if (searchText) {
        filtered = filtered.filter(item =>
            (item.client_name || '').toLowerCase().includes(searchText)
        );
    }

    // Filter by confidence level
    if (confidenceFilter) {
        filtered = filtered.filter(item => {
            const conf = item.ai_confidence || 0;
            if (confidenceFilter === 'high') return conf >= 0.85;
            if (confidenceFilter === 'medium') return conf >= 0.50 && conf < 0.85;
            if (confidenceFilter === 'low') return conf < 0.50;
            return true;
        });
    }

    // Filter by matched/unmatched
    if (typeFilter) {
        filtered = filtered.filter(item => {
            if (typeFilter === 'matched') return !!item.matched_template_id;
            if (typeFilter === 'unmatched') return !item.matched_template_id;
            return true;
        });
    }

    renderCards(filtered);
}

// ==================== RENDERING ====================

function renderCards(items) {
    const container = document.getElementById('cardsContainer');
    const emptyState = document.getElementById('emptyState');

    if (!items || items.length === 0) {
        container.innerHTML = '';

        if (classificationsData.length === 0) {
            // No data at all - show empty state
            container.style.display = 'none';
            emptyState.style.display = 'block';
        } else {
            // Data exists but filtered out
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
        if (!groups[clientName]) {
            groups[clientName] = [];
        }
        groups[clientName].push(item);
    }

    let html = '';

    for (const [clientName, clientItems] of Object.entries(groups)) {
        html += `
            <div class="client-group">
                <div class="client-group-header">
                    <div class="client-group-title">
                        <i data-lucide="user" class="icon-sm"></i>
                        ${escapeHtml(clientName)}
                    </div>
                    <span class="client-group-count">${clientItems.length} מסמכים</span>
                </div>
        `;

        for (const item of clientItems) {
            html += renderCard(item);
        }

        html += '</div>';
    }

    container.innerHTML = html;

    // Wire up assign dropdowns for enabling their buttons
    container.querySelectorAll('.assign-select-inline').forEach(select => {
        select.addEventListener('change', function() {
            const btn = this.closest('.card-actions').querySelector('.btn-assign-confirm');
            if (btn) {
                btn.disabled = !this.value;
            }
        });
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderCard(item) {
    const isMatched = !!item.matched_template_id;
    const confidence = item.ai_confidence || 0;
    const confidencePercent = Math.round(confidence * 100);
    const confidenceClass = confidence >= 0.85 ? 'confidence-high' :
                           confidence >= 0.50 ? 'confidence-medium' : 'confidence-low';
    const cardClass = isMatched ? 'matched' : 'unmatched';

    // File icon based on content type
    const fileIcon = getFileIcon(item.attachment_content_type || item.attachment_name || '');

    // Format file size
    const fileMeta = formatFileMeta(item.attachment_size, item.attachment_content_type);

    // Format received date
    const receivedAt = item.received_at ? formatDate(item.received_at) : '';

    // Sender info
    const senderEmail = item.sender_email || '';

    // Missing docs for this client
    const missingDocs = item.missing_docs || [];
    const missingDocsHtml = missingDocs.length > 0
        ? missingDocs.map(d => `<span class="missing-doc-tag">${escapeHtml(d.template_id || '')} ${escapeHtml(d.name || '')}</span>`).join(' ')
        : '<span style="color: var(--gray-400)">אין מסמכים חסרים</span>';

    // Classification display
    let classificationHtml;
    if (isMatched) {
        const templateDisplay = item.matched_template_id ? `${item.matched_template_id} – ` : '';
        classificationHtml = `
            <span class="confidence-badge ${confidenceClass}">${confidencePercent}%</span>
            <span class="template-match">${escapeHtml(templateDisplay)}${escapeHtml(item.matched_template_name || '')}</span>
        `;
    } else {
        classificationHtml = `
            <span class="confidence-badge confidence-low">--</span>
            <span class="template-unmatched">לא זוהה</span>
        `;
    }

    // Action buttons
    let actionsHtml;
    if (isMatched) {
        actionsHtml = `
            <button class="btn btn-success btn-sm" onclick="approveClassification('${escapeAttr(item.id)}')">
                <i data-lucide="check" class="icon-sm"></i> אשר
            </button>
            <button class="btn btn-danger btn-sm" onclick="rejectClassification('${escapeAttr(item.id)}')">
                <i data-lucide="x" class="icon-sm"></i> דחה
            </button>
            <button class="btn btn-ghost btn-sm" onclick="showReassignModal('${escapeAttr(item.id)}', ${escapeAttr(JSON.stringify(missingDocs))})">
                <i data-lucide="arrow-right-left" class="icon-sm"></i> שייך מחדש
            </button>
        `;
    } else {
        // Unmatched: show assign dropdown instead of approve
        const optionsHtml = missingDocs.map(d =>
            `<option value="${escapeAttr(d.template_id || '')}">${escapeHtml(d.template_id || '')} – ${escapeHtml(d.name || '')}</option>`
        ).join('');

        actionsHtml = `
            <div class="assign-section">
                <span class="assign-label">שייך ל:</span>
                <select class="assign-select-inline" data-record-id="${escapeAttr(item.id)}">
                    <option value="">-- בחר מסמך --</option>
                    ${optionsHtml}
                </select>
                <button class="btn btn-primary btn-sm btn-assign-confirm" disabled
                    onclick="assignUnmatched('${escapeAttr(item.id)}', this)">
                    <i data-lucide="check" class="icon-sm"></i> שייך
                </button>
            </div>
            <button class="btn btn-danger btn-sm" onclick="rejectClassification('${escapeAttr(item.id)}')">
                <i data-lucide="x" class="icon-sm"></i> דחה
            </button>
        `;
    }

    // View file button
    const viewFileBtn = item.file_url
        ? `<a href="${escapeAttr(item.file_url)}" target="_blank" class="btn btn-ghost btn-sm">
               <i data-lucide="external-link" class="icon-sm"></i> צפה בקובץ
           </a>`
        : '';

    return `
        <div class="review-card ${cardClass}" data-id="${escapeAttr(item.id)}">
            <div class="card-top">
                <div class="file-info">
                    <i data-lucide="${fileIcon}" class="icon-sm"></i>
                    <span class="file-name">${escapeHtml(item.attachment_name || 'ללא שם')}</span>
                    <span class="file-meta">${escapeHtml(fileMeta)}</span>
                </div>
                ${viewFileBtn}
            </div>

            <div class="card-body-review">
                <div class="sender-info">
                    ${senderEmail ? `<span class="sender-detail"><i data-lucide="mail" class="icon-sm"></i> ${escapeHtml(senderEmail)}</span>` : ''}
                    ${receivedAt ? `<span class="sender-detail"><i data-lucide="calendar" class="icon-sm"></i> ${escapeHtml(receivedAt)}</span>` : ''}
                </div>

                <div class="classification-result">
                    <div class="classification-label">
                        ${classificationHtml}
                    </div>
                    ${item.ai_reason ? `<div class="evidence">${escapeHtml(item.ai_reason)}</div>` : ''}
                    ${item.issuer_name ? `<div class="issuer-info"><i data-lucide="building-2" class="icon-sm"></i> ${escapeHtml(item.issuer_name)}</div>` : ''}
                </div>

                <div class="missing-docs-context">
                    <span class="context-label">מסמכים חסרים:</span>
                    ${missingDocsHtml}
                </div>
            </div>

            <div class="card-actions">
                ${actionsHtml}
            </div>
        </div>
    `;
}

// ==================== ACTIONS ====================

async function approveClassification(recordId) {
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

        if (!data.ok) {
            throw new Error(data.error || 'שגיאה באישור הסיווג');
        }

        animateAndRemove(recordId);
        showToast('הסיווג אושר בהצלחה', 'success');
    } catch (error) {
        hideLoading();
        showError(error.message);
    }
}

async function rejectClassification(recordId) {
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

        if (!data.ok) {
            throw new Error(data.error || 'שגיאה בדחיית הסיווג');
        }

        animateAndRemove(recordId);
        showToast('הסיווג נדחה', 'danger');
    } catch (error) {
        hideLoading();
        showError(error.message);
    }
}

function showReassignModal(recordId, missingDocs) {
    // If missingDocs was passed as a string (from onclick), parse it
    if (typeof missingDocs === 'string') {
        try {
            missingDocs = JSON.parse(missingDocs);
        } catch (e) {
            missingDocs = [];
        }
    }

    currentReassignId = recordId;

    // Find the item to display its filename
    const item = classificationsData.find(i => i.id === recordId);
    const fileInfoEl = document.getElementById('reassignFileInfo');
    if (item) {
        fileInfoEl.innerHTML = `<i data-lucide="file" class="icon-sm" style="display:inline;vertical-align:middle;"></i> ${escapeHtml(item.attachment_name || 'ללא שם')}`;
    } else {
        fileInfoEl.textContent = '';
    }

    // Populate dropdown
    const select = document.getElementById('reassignSelect');
    select.innerHTML = '<option value="">-- בחר מסמך --</option>';
    for (const doc of missingDocs) {
        const opt = document.createElement('option');
        opt.value = doc.template_id || '';
        opt.textContent = `${doc.template_id || ''} – ${doc.name || ''}`;
        select.appendChild(opt);
    }

    // Reset confirm button
    document.getElementById('reassignConfirmBtn').disabled = true;
    select.onchange = function () {
        document.getElementById('reassignConfirmBtn').disabled = !this.value;
    };

    document.getElementById('reassignModal').classList.add('show');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeReassignModal() {
    document.getElementById('reassignModal').classList.remove('show');
    currentReassignId = null;
}

async function confirmReassign() {
    const templateId = document.getElementById('reassignSelect').value;
    if (!templateId || !currentReassignId) return;

    closeReassignModal();
    await submitReassign(currentReassignId, templateId);
}

async function submitReassign(recordId, templateId) {
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

        if (!data.ok) {
            throw new Error(data.error || 'שגיאה בשיוך מחדש');
        }

        animateAndRemove(recordId);
        showToast('המסמך שויך מחדש בהצלחה', 'success');
    } catch (error) {
        hideLoading();
        showError(error.message);
    }
}

async function assignUnmatched(recordId, btnEl) {
    // Find the select in the same card-actions container
    const actionsContainer = btnEl.closest('.card-actions');
    const select = actionsContainer.querySelector('.assign-select-inline');
    const templateId = select ? select.value : '';

    if (!templateId) return;

    await submitReassign(recordId, templateId);
}

// ==================== CARD ANIMATION ====================

function animateAndRemove(recordId) {
    // Remove from data
    classificationsData = classificationsData.filter(item => item.id !== recordId);

    // Animate card out
    const card = document.querySelector(`.review-card[data-id="${recordId}"]`);
    if (card) {
        card.classList.add('removing');
        setTimeout(() => {
            card.remove();

            // Check if parent group is now empty
            document.querySelectorAll('.client-group').forEach(group => {
                if (group.querySelectorAll('.review-card').length === 0) {
                    group.remove();
                }
            });

            // Check if everything is empty
            if (classificationsData.length === 0) {
                document.getElementById('cardsContainer').style.display = 'none';
                document.getElementById('emptyState').style.display = 'block';
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }

            // Recalculate stats locally
            recalcStats();
        }, 350);
    } else {
        // Card not in DOM, just update stats
        recalcStats();
    }
}

function recalcStats() {
    const total = classificationsData.length;
    const matched = classificationsData.filter(i => !!i.matched_template_id).length;
    const unmatched = total - matched;
    const highConf = classificationsData.filter(i => (i.ai_confidence || 0) >= 0.85).length;

    document.getElementById('stat-pending').textContent = total;
    document.getElementById('stat-matched').textContent = matched;
    document.getElementById('stat-unmatched').textContent = unmatched;
    document.getElementById('stat-high-confidence').textContent = highConf;
}

// ==================== UTILITIES ====================

function getFileIcon(contentTypeOrName) {
    const str = (contentTypeOrName || '').toLowerCase();
    if (str.includes('pdf')) return 'file-text';
    if (str.includes('word') || str.includes('.doc')) return 'file-type';
    if (str.includes('excel') || str.includes('sheet') || str.includes('.xls')) return 'file-spreadsheet';
    if (str.includes('image') || str.includes('.png') || str.includes('.jpg') || str.includes('.jpeg')) return 'image';
    return 'file';
}

function formatFileMeta(size, contentType) {
    const parts = [];
    if (size) {
        if (size < 1024) parts.push(`${size}B`);
        else if (size < 1024 * 1024) parts.push(`${Math.round(size / 1024)}KB`);
        else parts.push(`${(size / (1024 * 1024)).toFixed(1)}MB`);
    }
    if (contentType) {
        // Simplify content type for display
        const short = contentType.replace('application/', '').replace('image/', '').split(';')[0];
        parts.push(short);
    }
    return parts.join(' \u2022 ');
}

function formatDate(dateStr) {
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('he-IL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function escapeAttr(text) {
    if (typeof text !== 'string') text = String(text || '');
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showLoading(text) {
    document.getElementById('loadingText').textContent = text || 'מעבד...';
    document.getElementById('loadingOverlay').classList.add('visible');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('visible');
}

function showToast(message, type) {
    const toast = document.getElementById('toast');
    const toastText = document.getElementById('toastText');
    const toastIcon = document.getElementById('toastIcon');

    toastText.textContent = message;
    toast.className = 'toast toast-' + (type || 'success');

    // Update icon
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

function showError(message) {
    const container = document.getElementById('cardsContainer');
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="alert-triangle" class="icon-2xl"></i></div>
            <p style="color: var(--danger-500);">${escapeHtml(message)}</p>
            <button class="btn btn-secondary mt-4" onclick="loadClassifications()">
                <i data-lucide="refresh-cw" class="icon-sm"></i> נסה שוב
            </button>
        </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
});

checkAuth();
