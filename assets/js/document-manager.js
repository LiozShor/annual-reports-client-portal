/* ===========================================
   DOCUMENT MANAGER JAVASCRIPT - document-manager.html
   SSOT: all data (docs, categories, templates) from API (Airtable)
   =========================================== */

// SEC-004: Only read report_id from URL — client data fetched from API
const params = new URLSearchParams(window.location.search);
const REPORT_ID = params.get('report_id');
let CLIENT_NAME = '';
let SPOUSE_NAME = '';
let YEAR = '';
let CURRENT_STAGE = '';
let DOCS_FIRST_SENT_AT = null;
const API_BASE = 'https://liozshor.app.n8n.cloud/webhook';

// Admin auth token — required for this office-only page
const ADMIN_TOKEN = localStorage.getItem('admin_token') || '';
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

/** Sanitize HTML: allow only <b> and <strong> tags, escape everything else */
function sanitizeDocHtml(html) {
    if (!html) return '';
    const el = document.createElement('div');
    el.textContent = html;
    let safe = el.innerHTML;
    safe = safe.replace(/&lt;b&gt;/gi, '<b>').replace(/&lt;\/b&gt;/gi, '</b>');
    safe = safe.replace(/&lt;strong&gt;/gi, '<strong>').replace(/&lt;\/strong&gt;/gi, '</strong>');
    return safe;
}

// Enhanced operations state
let markedForRestore = new Set();   // doc IDs to un-waive
let statusChanges = new Map();      // docId → newStatus
let noteChanges = new Map();        // docId → noteText
let nameChanges = new Map();        // docId → newName
let sendEmailOnSave = false;
let currentDropdownDocId = null;    // currently open status dropdown target
let activeStatusFilter = '';        // currently active status filter (empty = show all)

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
    survivor_details: 'פרטי שארים',
    relationship_details: 'פרטי ההנצחה',
    medical_details: 'פרטים רפואיים'
};

// Hebrew status labels
const STATUS_LABELS = {
    'Required_Missing': 'חסר',
    'Received': 'התקבל',
    'Requires_Fix': 'נדרש תיקון',
    'Waived': 'ויתור'
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

// Check if we have a report ID (if not, show "Not Started" state)
if (!REPORT_ID || REPORT_ID === 'null' || REPORT_ID === 'undefined') {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('not-started-view').style.display = 'block';
    // Init icons for the not-started view
    setTimeout(initIcons, 50);
} else {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadDocuments);
    } else {
        loadDocuments();
    }
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

// Load documents
async function loadDocuments() {
    const loadingEl = document.getElementById('loading');
    const cleanupEscalation = startLoadingEscalation(loadingEl);

    try {
        const response = await retryWithBackoff(
            () => fetchWithTimeout(`${API_BASE}/get-client-documents?report_id=${REPORT_ID}&mode=office`, {
                headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
            }, FETCH_TIMEOUTS.load),
            { maxRetries: 1 }
        );
        cleanupEscalation();
        const data = await response.json();

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
        }
        if (data.year) {
            YEAR = data.year;
            const yearEl = document.getElementById('year');
            if (yearEl) yearEl.textContent = YEAR;
        }
        if (data.stage) CURRENT_STAGE = data.stage;
        DOCS_FIRST_SENT_AT = data.docs_first_sent_at || null;
        updateSentBadge();

        // Handle case where report is found but stage is 1 (Not Started)
        if (data.stage && (data.stage.startsWith('1') || data.stage.startsWith('2'))) {
            if ((!data.groups || data.document_count === 0) && data.stage.startsWith('1')) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('not-started-view').style.display = 'block';
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

        initDocumentDropdown();
        displayDocuments();
        updateStats();
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
        setTimeout(initIcons, 50);
    } catch (error) {
        cleanupEscalation();
        console.error('Document manager load failed');
        document.getElementById('loading').style.display = 'none';
        showAlert(getErrorMessage(error, 'he'), 'error');
    }
}

// Populate document dropdown from Airtable templates (SSOT)
function initDocumentDropdown() {
    const select = document.getElementById('docTypeSelect');
    let html = '<option value="">-- בחר מסמך מהרשימה --</option>\n';

    // Build set of existing active template IDs (no user vars = single instance)
    const existingTemplateIds = new Set();
    for (const doc of currentDocuments) {
        if (doc.status !== 'Waived') {
            existingTemplateIds.add(doc.type);
        }
    }

    // Group templates by category
    const groups = {};
    for (const tpl of apiTemplates) {
        const catId = tpl.category || 'other';
        if (!groups[catId]) groups[catId] = [];
        groups[catId].push(tpl);
    }

    // Build optgroups using category order from API
    for (const cat of apiCategories) {
        const catTemplates = groups[cat.id];
        if (!catTemplates || catTemplates.length === 0) continue;

        let groupHtml = '';
        for (const tpl of catTemplates) {
            // Skip templates that already exist and have no user variables
            const userVars = (tpl.variables || []).filter(v => v !== 'year' && v !== 'spouse_name');
            if (userVars.length === 0 && existingTemplateIds.has(tpl.template_id)) {
                continue;
            }

            const displayName = stripBold(tpl.name_he
                .replace(/\{year\}/g, YEAR || 'YYYY')
                .replace(/\{[^}]+\}/g, '[...]'));
            groupHtml += `<option value="${tpl.template_id}">${displayName}</option>`;
        }

        if (groupHtml) {
            html += `<optgroup label="${cat.emoji} ${cat.name_he}">${groupHtml}</optgroup>`;
        }
    }

    select.innerHTML = html;
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
                        <span class="document-icon"><i data-lucide="file-text" class="icon-sm"></i></span>
                        <div class="document-name" id="docname-${doc.id}">${sanitizeDocHtml(displayName)}</div>
                        <button type="button" class="name-edit-btn${isWaived ? ' action-hidden' : ''}"
                            ${!isWaived ? `onclick="startNameEdit('${doc.id}')"` : ''}
                            title="שנה שם מסמך"><i data-lucide="pencil" class="icon-xs"></i></button>
                        <button type="button" class="delete-toggle${isWaived ? ' action-hidden' : ''} ${!isWaived && markedForRemoval.has(doc.id) ? 'active' : ''}"
                            ${!isWaived ? `onclick="toggleRemoval('${doc.id}')" id="delete-btn-${doc.id}"` : ''}
                            aria-label="סמן להסרה"
                            title="הסר מסמך"><i data-lucide="trash-2" class="icon-sm"></i></button>
                        <button class="note-btn ${hasNote ? 'has-note' : ''} ${noteChanges.has(doc.id) ? 'note-modified' : ''}"
                                onclick="toggleNote('${doc.id}')"
                                title="הערת משרד"><i data-lucide="${hasNote ? 'message-square-text' : 'message-square'}" class="icon-sm"></i></button>
                        <span class="file-links-slot">${doc.file_url && (effectiveStatus === 'Received' || effectiveStatus === 'Requires_Fix')
                            ? `<a href="${escapeHtml(sanitizeUrl(doc.file_url))}" target="_blank" rel="noopener noreferrer"
                                    class="file-action-btn" title="צפה בקובץ" aria-label="צפה בקובץ"><i data-lucide="external-link" class="icon-sm"></i></a>
                               <a href="${doc.download_url ? escapeHtml(sanitizeUrl(doc.download_url)) : '#'}" ${doc.download_url ? 'download' : ''} rel="noopener noreferrer"
                                    class="file-action-btn${doc.download_url ? '' : ' action-hidden'}" title="הורד קובץ" aria-label="הורד קובץ"><i data-lucide="download" class="icon-sm"></i></a>`
                            : `<span class="file-action-btn action-hidden"><i data-lucide="external-link" class="icon-sm"></i></span>
                               <span class="file-action-btn action-hidden"><i data-lucide="download" class="icon-sm"></i></span>`
                        }</span>
                        ${isWaived
                            ? `<span class="badge ${status.class}">${status.text}</span>`
                            : `<span class="badge ${status.class} clickable"
                                    onclick="openStatusDropdown(event, '${doc.id}', '${effectiveStatus}')"
                                    id="badge-${doc.id}"
                                    title="לחץ לשינוי סטטוס">${status.text} &#x25BE;</span>`
                        }
                    </div>
                    <div class="note-editor" id="note-${doc.id}" style="display:${hasNote ? 'block' : 'none'};">
                        <textarea class="note-textarea" id="notetext-${doc.id}"
                                  oninput="trackNoteChange('${doc.id}')"
                                  placeholder="הערת משרד...">${escapeHtml(doc.bookkeepers_notes || '')}</textarea>
                    </div>
                </div>`;
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
            return { text: 'ויתור', class: 'badge-neutral' };
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
}

function closeStatusDropdown() {
    document.getElementById('statusDropdown').style.display = 'none';
    currentDropdownDocId = null;
}

// Per-document notes
function toggleNote(docId) {
    const editor = document.getElementById(`note-${docId}`);
    if (!editor) return;

    const isVisible = editor.style.display !== 'none';
    editor.style.display = isVisible ? 'none' : 'block';

    if (!isVisible) {
        const textarea = document.getElementById(`notetext-${docId}`);
        if (textarea) textarea.focus();
    }
}

function trackNoteChange(docId) {
    const textarea = document.getElementById(`notetext-${docId}`);
    if (!textarea) return;

    const newText = textarea.value;
    const doc = currentDocuments.find(d => d.id === docId);
    const originalNote = doc ? (doc.bookkeepers_notes || '') : '';

    if (newText === originalNote) {
        noteChanges.delete(docId);
    } else {
        noteChanges.set(docId, newText);
    }

    // Update note button icon
    const btn = document.querySelector(`#doc-${docId} .note-btn`);
    if (btn) {
        const hasContent = newText.trim().length > 0;
        const iconName = hasContent ? 'message-square-text' : 'message-square';
        btn.innerHTML = `<i data-lucide="${iconName}" class="icon-sm"></i>`;
        btn.classList.toggle('has-note', hasContent);
        btn.classList.toggle('note-modified', noteChanges.has(docId));
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    updateEditBar();
}

// Inline document name editing
function startNameEdit(docId) {
    const nameEl = document.getElementById(`docname-${docId}`);
    if (!nameEl) return;

    const currentName = nameChanges.get(docId) || currentDocuments.find(d => d.id === docId)?.name || '';
    const inputVal = htmlToMarkdown(currentName);
    nameEl.innerHTML = `
        <div class="name-edit-row">
            <div style="flex:1;">
                <input type="text" class="name-edit-input" id="nameinput-${docId}" dir="auto">
                <div class="name-preview" id="namepreview-${docId}" dir="auto"></div>
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
        document.getElementById(`namepreview-${docId}`).innerHTML = sanitizeDocHtml(markdownToHtml(inputVal));
        input.focus();
        // Place cursor at end (left side in RTL) so חברת בע"מ** is visible, not scrolled out
        const len = inputVal.length;
        input.setSelectionRange(len, len);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveNameEdit(docId); }
            if (e.key === 'Escape') { e.preventDefault(); cancelNameEdit(docId); }
        });
        input.addEventListener('input', () => {
            const preview = document.getElementById(`namepreview-${docId}`);
            if (preview) preview.innerHTML = sanitizeDocHtml(markdownToHtml(input.value));
        });
    }

    // Hide pencil button while editing
    const pencilBtn = document.querySelector(`#doc-${docId} .name-edit-btn`);
    if (pencilBtn) pencilBtn.style.display = 'none';
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
    if (nameEl) nameEl.innerHTML = sanitizeDocHtml(converted || doc.name);

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
    if (nameEl) nameEl.innerHTML = sanitizeDocHtml(nameChanges.get(docId) || doc.name);

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

// Build metadata object for a template with collected variable values
function buildDocMeta(tpl, collectedValues) {
    let nameHe = tpl.name_he;
    let nameEn = tpl.name_en || '';
    for (const [key, val] of Object.entries(collectedValues)) {
        nameHe = nameHe.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
        nameEn = nameEn.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
    }
    // Determine person based on scope
    const person = (tpl.scope === 'SPOUSE') ? 'spouse' : 'client';
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

// Handle document selection from dropdown
document.getElementById('docTypeSelect').addEventListener('change', function (e) {
    const templateId = e.target.value;
    if (!templateId) return;

    const tpl = apiTemplates.find(t => t.template_id === templateId);
    if (!tpl) return;

    // Check if template has variables beyond 'year' and auto-filled ones
    const autoVars = ['year', 'spouse_name'];
    const userVars = (tpl.variables || []).filter(v => !autoVars.includes(v));

    // Pre-fill auto variables
    const collectedValues = { year: YEAR || '' };
    if ((tpl.variables || []).includes('spouse_name')) {
        collectedValues.spouse_name = SPOUSE_NAME || '';
    }

    if (userVars.length > 0) {
        // Show detail input for the first user variable
        pendingTemplate = { tpl, userVars, collectedValues };
        promptNextVariable();
    } else {
        // No user variables needed — generate name directly
        let displayName = tpl.name_he;
        for (const [key, val] of Object.entries(collectedValues)) {
            displayName = displayName.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
        }
        displayName = stripBold(displayName);

        if (docsToAdd.has(displayName)) {
            showAlert('מסמך זה כבר נמצא ברשימה', 'error');
        } else {
            docsToAdd.set(displayName, buildDocMeta(tpl, collectedValues));
            updateSelectedDocs();
            updateStats();
        }
        e.target.value = '';
    }
});

// Prompt user for the next variable value
function promptNextVariable() {
    if (!pendingTemplate) return;

    const { tpl, userVars, collectedValues } = pendingTemplate;

    // Find the first variable not yet collected
    const nextVar = userVars.find(v => !(v in collectedValues));
    if (!nextVar) {
        // All variables collected — generate name
        let name = tpl.name_he;
        for (const [key, val] of Object.entries(collectedValues)) {
            name = name.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
        }
        name = stripBold(name);

        if (docsToAdd.has(name)) {
            showAlert('מסמך זה כבר נמצא ברשימה', 'error');
        } else {
            docsToAdd.set(name, buildDocMeta(tpl, collectedValues));
            updateSelectedDocs();
            updateStats();
        }

        document.getElementById('detailInput').classList.remove('show');
        document.getElementById('docTypeSelect').value = '';
        pendingTemplate = null;
        return;
    }

    // Show input for this variable
    const label = VAR_LABELS[nextVar] || nextVar;
    document.getElementById('detailLabel').textContent = label + ':';
    document.getElementById('detailValue').placeholder = '';
    document.getElementById('detailValue').value = '';
    document.getElementById('detailInput').classList.add('show');
    document.getElementById('detailValue').focus();
}

// Add document with detail
function addDocumentWithDetail() {
    const detail = document.getElementById('detailValue').value.trim();

    if (!detail) {
        showAlert('יש להזין את הפרטים הנדרשים', 'error');
        return;
    }

    if (!pendingTemplate) return;

    const { userVars, collectedValues } = pendingTemplate;
    const nextVar = userVars.find(v => !(v in collectedValues));
    if (!nextVar) return;

    collectedValues[nextVar] = detail;

    // Check if more variables needed
    promptNextVariable();
}

// Update selected documents display
function updateSelectedDocs() {
    const container = document.getElementById('selectedDocs');

    if (docsToAdd.size === 0) {
        container.className = 'selected-docs empty';
        container.innerHTML = '';
        return;
    }

    container.className = 'selected-docs';

    container.innerHTML = Array.from(docsToAdd.keys()).map(doc => {
        const safeArg = encodeURIComponent(doc);
        return `
            <div class="doc-tag">
                <span>${escapeHtml(doc)}</span>
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

    const total = currentDocuments.length;
    if (total === 0) {
        overview.style.display = 'none';
        return;
    }
    overview.style.display = 'block';

    // Count each status (use effective status accounting for pending changes)
    let received = 0, missing = 0, fix = 0, waived = 0;
    for (const doc of currentDocuments) {
        const effectiveStatus = statusChanges.get(doc.id) || doc.status;
        switch (effectiveStatus) {
            case 'Received': received++; break;
            case 'Requires_Fix': fix++; break;
            case 'Waived': waived++; break;
            default: missing++; break;
        }
    }

    // Update count boxes
    document.getElementById('countTotal').textContent = total;
    document.getElementById('countReceived').textContent = received;
    document.getElementById('countMissing').textContent = missing;
    document.getElementById('countFix').textContent = fix;
    document.getElementById('countWaived').textContent = waived;

    // Update progress bar segments
    const pctReceived = (received / total) * 100;
    const pctFix = (fix / total) * 100;
    const pctMissing = (missing / total) * 100;
    const pctWaived = (waived / total) * 100;

    document.getElementById('segReceived').style.width = pctReceived + '%';
    document.getElementById('segFix').style.width = pctFix + '%';
    document.getElementById('segMissing').style.width = pctMissing + '%';
    document.getElementById('segWaived').style.width = pctWaived + '%';

    // Green glow when 100% complete (all received or waived, none missing/fix)
    const progressBar = document.getElementById('progressBarStacked');
    progressBar.classList.toggle('complete', missing === 0 && fix === 0 && received > 0);

    // Summary text: "X מתוך Y (Z%)"
    const activeTotal = total - waived;
    const completePct = activeTotal > 0 ? Math.round((received / activeTotal) * 100) : 0;
    document.getElementById('statusSummaryText').textContent =
        `${received} מתוך ${activeTotal} (${completePct}%)`;

    // Show edit session bar only when there are pending changes
    const hasChanges = markedForRemoval.size > 0 || docsToAdd.size > 0 ||
        markedForRestore.size > 0 || statusChanges.size > 0 || noteChanges.size > 0 || nameChanges.size > 0;
    document.getElementById('editSessionBar').style.display = hasChanges ? 'block' : 'none';

    // Mutually exclusive: save+reset row shown when changes pending, approve-send row when clean
    const saveResetRow = document.getElementById('save-reset-row');
    const approveSendRow = document.getElementById('approve-send-row');
    if (saveResetRow) saveResetRow.style.display = hasChanges ? 'contents' : 'none';
    if (approveSendRow) approveSendRow.style.display = hasChanges ? 'none' : '';
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

    applyStatusFilter();
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
        // Normalize: anything not Received/Requires_Fix/Waived is treated as Required_Missing
        let normalizedStatus = effectiveStatus;
        if (normalizedStatus !== 'Received' && normalizedStatus !== 'Requires_Fix' && normalizedStatus !== 'Waived') {
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
    const notes = (document.getElementById('notes')?.value ?? '').trim();

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
        nameChanges.size > 0;

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
            summary += `<li class="change-restore">${stripHtml(doc.name)}</li>`;
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
            summary += `<li class="change-add">${escapeHtml(doc)}</li>`;
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
                summary += `<li class="change-status">${stripHtml(doc.name)} — שונה ל: ${toLabel}</li>`;
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

    const customDoc = document.getElementById('customDoc').value.trim();
    const notes = document.getElementById('notes').value.trim();

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
                person: 'client',
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
        const response = await fetchWithTimeout(`${API_BASE}/edit-documents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_TOKEN}`
            },
            body: JSON.stringify(payload)
        }, FETCH_TIMEOUTS.mutate);

        if (response.ok) {
            document.getElementById('content').style.display = 'none';
            document.getElementById('success-message').style.display = 'block';
            window.scrollTo(0, 0);
            if (typeof lucide !== 'undefined') lucide.createIcons();
        } else {
            throw new Error('Server error');
        }
    } catch (error) {
        console.error('Save operation failed');
        showAlert(getErrorMessage(error, 'he'), 'error');
    } finally {
        _submitLocked = false;
    }
}

// Reset form
function resetForm() {
    markedForRemoval.clear();
    markedForRestore.clear();
    statusChanges.clear();
    noteChanges.clear();
    docsToAdd.clear();
    sendEmailOnSave = false;
    document.getElementById('customDoc').value = '';
    document.getElementById('notes').value = '';
    document.getElementById('detailInput').classList.remove('show');
    document.getElementById('docTypeSelect').value = '';
    pendingTemplate = null;

    // Reset status filter
    activeStatusFilter = '';
    const boxes = document.querySelectorAll('.status-count-box');
    boxes.forEach(box => box.classList.remove('active'));
    const totalBox = document.querySelector('.status-count-box[data-status=""]');
    if (totalBox) totalBox.classList.add('active');

    // Re-render documents to clear all visual states
    displayDocuments();
    updateSelectedDocs();
    updateStats();
    showAlert('הטופס אופס בהצלחה', 'success');
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
        const response = await fetchWithTimeout(`${API_BASE}/admin-send-questionnaires`, {
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

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

// Generate approval token (murmur-hash style, deterministic)
function generateApprovalToken(reportId, secret) {
    const str = reportId + ':' + secret;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
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

function approveAndSendToClient() {
    const sentDate = DOCS_FIRST_SENT_AT
        ? new Date(DOCS_FIRST_SENT_AT).toLocaleDateString('he-IL')
        : null;
    const message = sentDate
        ? `הרשימה נשלחה ב-${sentDate}. לשלוח שוב ל-${CLIENT_NAME}?`
        : `שלח רשימת מסמכים ל-${CLIENT_NAME}?`;
    showConfirmDialog(
        message,
        async () => {
            const token = generateApprovalToken(REPORT_ID, 'MOSHE_1710');
            const url = `${API_BASE}/approve-and-send?report_id=${REPORT_ID}&token=${token}&confirm=1&respond=json`;
            showToast('שולח רשימת מסמכים...', 'info');
            try {
                const res = await fetchWithTimeout(url, {}, FETCH_TIMEOUTS.mutate);
                const data = await res.json();
                if (data.ok) {
                    if (!DOCS_FIRST_SENT_AT) DOCS_FIRST_SENT_AT = new Date().toISOString();
                    if (!CURRENT_STAGE || CURRENT_STAGE.charAt(0) < '3') CURRENT_STAGE = '3-Collecting_Docs';
                    updateSentBadge();
                    showToast('רשימת המסמכים נשלחה ללקוח בהצלחה!', 'success');
                } else {
                    showToast('שגיאה בשליחת המייל. נסה שנית.', 'error');
                }
            } catch (e) {
                showToast('שגיאה בשליחת המייל. נסה שנית.', 'error');
            }
        },
        sentDate ? 'שלח שוב' : 'שלח ללקוח',
        false
    );
}

function updateSentBadge() {
    const el = document.getElementById('sentBadge');
    if (!el) return;
    const stageNum = parseInt((CURRENT_STAGE || '').charAt(0), 10);
    if (DOCS_FIRST_SENT_AT) {
        const date = new Date(DOCS_FIRST_SENT_AT).toLocaleDateString('he-IL');
        el.innerHTML = `<span class="badge badge-success">נשלח ללקוח ${date}</span>`;
        el.style.display = '';
    } else if (stageNum >= 3) {
        el.innerHTML = `<span class="badge badge-neutral">טרם נשלח ללקוח</span>`;
        el.style.display = '';
    } else {
        el.style.display = 'none';
    }
}

// Close detail input and status dropdown when clicking outside
document.addEventListener('click', function (e) {
    const detailInput = document.getElementById('detailInput');
    const select = document.getElementById('docTypeSelect');

    if (detailInput.classList.contains('show') &&
        !detailInput.contains(e.target) &&
        !select.contains(e.target)) {
        detailInput.classList.remove('show');
        select.value = '';
        pendingTemplate = null;
    }

    // Close status dropdown on outside click
    const dropdown = document.getElementById('statusDropdown');
    if (dropdown && dropdown.style.display === 'block' && !dropdown.contains(e.target)) {
        closeStatusDropdown();
    }
});
