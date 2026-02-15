/* ===========================================
   DOCUMENT MANAGER JAVASCRIPT - document-manager.html
   SSOT: all data (docs, categories, templates) from API (Airtable)
   =========================================== */

// Get URL parameters
const params = new URLSearchParams(window.location.search);
const REPORT_ID = params.get('report_id');
const CLIENT_NAME = params.get('client_name');
const SPOUSE_NAME = params.get('spouse_name') || '';
const YEAR = params.get('year');
const API_BASE = 'https://liozshor.app.n8n.cloud/webhook';

// State
let currentGroups = [];
let currentDocuments = [];
let markedForRemoval = new Set();
let docsToAdd = new Set();
let pendingTemplate = null; // Template awaiting detail input
let apiTemplates = [];      // Templates from Airtable (SSOT)
let apiCategories = [];     // Categories from Airtable (SSOT)

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

// Initialize
document.getElementById('clientName').textContent = CLIENT_NAME || '-';
document.getElementById('spouseName').textContent = SPOUSE_NAME || '-';
document.getElementById('year').textContent = YEAR || '-';

// Check if we have a report ID (if not, show "Not Started" state)
if (!REPORT_ID || REPORT_ID === 'null' || REPORT_ID === 'undefined') {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('not-started-view').style.display = 'block';
} else {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadDocuments);
    } else {
        loadDocuments();
    }
}

// Show alert
function showAlert(msg, type = 'success') {
    const alert = document.getElementById('alert');
    alert.className = `alert alert-${type} show`;
    alert.textContent = msg;
    setTimeout(() => alert.classList.remove('show'), 5000);
}

// Load documents
async function loadDocuments() {
    try {
        const response = await fetch(`${API_BASE}/get-client-documents?report_id=${REPORT_ID}&mode=office`);
        const data = await response.json();

        // Handle case where report is found but stage is 1 (Not Started)
        if (data.stage && (data.stage.startsWith('1') || data.stage.startsWith('2'))) {
            if ((!data.groups || data.document_count === 0) && data.stage.startsWith('1')) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('not-started-view').style.display = 'block';
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
    } catch (error) {
        console.error(error);
        showAlert('שגיאה בטעינת מסמכים. אנא נסה לרענן את הדף.', 'error');
    }
}

// Populate document dropdown from Airtable templates (SSOT)
function initDocumentDropdown() {
    const select = document.getElementById('docTypeSelect');
    let html = '<option value="">-- בחר מסמך מהרשימה --</option>\n';

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

        html += `<optgroup label="${cat.emoji} ${cat.name_he}">`;
        for (const tpl of catTemplates) {
            // Show template name with placeholders replaced by [...]
            const displayName = tpl.name_he
                .replace(/\{year\}/g, YEAR || 'YYYY')
                .replace(/\{[^}]+\}/g, '[...]');
            html += `<option value="${tpl.template_id}">${displayName}</option>`;
        }
        html += '</optgroup>';
    }

    select.innerHTML = html;
}

// Display documents — renders pre-grouped structure from API (SSOT)
function displayDocuments() {
    const container = document.getElementById('existingDocs');

    if (currentDocuments.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <p>אין מסמכים נדרשים כרגע</p>
            </div>
        `;
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
                const status = getStatusBadge(doc.status);
                html += `
                    <div class="document-item" id="doc-${doc.id}">
                        <input type="checkbox"
                            onchange="toggleRemoval('${doc.id}')"
                            id="checkbox-${doc.id}"
                            aria-label="סמן להסרה">
                        <span class="document-icon">📄</span>
                        <div class="document-name">${doc.name}</div>
                        <span class="status-badge ${status.class}">${status.text}</span>
                        <button class="download-btn" disabled
                                title="הורדה (בקרוב)">⬇️</button>
                    </div>
                `;
            }

            html += `</div>`;
        }
    }

    container.innerHTML = html;
}

function getStatusBadge(status) {
    switch (status) {
        case 'Received':
            return { text: 'התקבל', class: 'received' };
        case 'Required_Missing':
            return { text: 'חסר', class: 'missing' };
        case 'Waived':
            return { text: 'ויתור', class: 'waived' };
        case 'Requires_Fix':
            return { text: 'נדרש תיקון', class: 'review' };
        default:
            return { text: status || 'חסר', class: 'missing' };
    }
}

// Toggle removal
function toggleRemoval(id) {
    const checkbox = document.getElementById(`checkbox-${id}`);
    const item = document.getElementById(`doc-${id}`);

    if (checkbox.checked) {
        markedForRemoval.add(id);
        item.classList.add('marked-for-removal');
    } else {
        markedForRemoval.delete(id);
        item.classList.remove('marked-for-removal');
    }

    updateStats();
}

// Handle document selection from dropdown
document.getElementById('docTypeSelect').addEventListener('change', function (e) {
    const templateId = e.target.value;
    if (!templateId) return;

    const tpl = apiTemplates.find(t => t.template_id === templateId);
    if (!tpl) return;

    // Check if template has variables beyond 'year'
    const userVars = (tpl.variables || []).filter(v => v !== 'year');

    if (userVars.length > 0) {
        // Show detail input for the first user variable
        pendingTemplate = { tpl, userVars, collectedValues: { year: YEAR || '' } };
        promptNextVariable();
    } else {
        // No variables needed — generate name directly
        const displayName = tpl.name_he.replace(/\{year\}/g, YEAR || '');

        if (docsToAdd.has(displayName)) {
            showAlert('מסמך זה כבר נמצא ברשימה', 'error');
        } else {
            docsToAdd.add(displayName);
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

        if (docsToAdd.has(name)) {
            showAlert('מסמך זה כבר נמצא ברשימה', 'error');
        } else {
            docsToAdd.add(name);
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

    container.innerHTML = Array.from(docsToAdd).map(doc => {
        const safeArg = encodeURIComponent(doc);
        return `
            <div class="doc-tag">
                <span>${escapeHtml(doc)}</span>
                <button onclick="removeSelectedDoc('${safeArg}')"
                        type="button"
                        aria-label="remove">×</button>
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
    document.getElementById('totalDocs').textContent = currentDocuments.length;
    document.getElementById('markedDocs').textContent = markedForRemoval.size;
    document.getElementById('addedDocs').textContent = docsToAdd.size;
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

    const docsToAddArray = Array.from(docsToAdd);

    if (customDocRaw) {
        const customDocs = customDocRaw
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean);

        for (const cd of customDocs) {
            if (!docsToAddArray.includes(cd)) {
                docsToAddArray.push(cd);
            }
        }
    }

    const uniqueDocsToAdd = [...new Set(docsToAddArray)];

    if (docsToRemove.length === 0 && uniqueDocsToAdd.length === 0 && !notes) {
        showAlert(TXT_NO_CHANGES, 'error');
        return;
    }

    let summary = '<div>';

    if (docsToRemove.length > 0) {
        summary += `<h4 style="color: #dc3545;">🚫 מסמכים שיוסרו מרשימת הלקוח (${docsToRemove.length}):</h4>`;
        summary += '<ul class="changes-list">';
        docsToRemove.forEach(doc => {
            // Doc names may contain <b> tags — strip for plain text display in dialog
            summary += `<li class="change-remove">🚫 ${stripHtml(doc)}</li>`;
        });
        summary += '</ul>';
    }

    if (uniqueDocsToAdd.length > 0) {
        summary += `<h4 style="color: #28a745;">➕ מסמכים שיתווספו (${uniqueDocsToAdd.length}):</h4>`;
        summary += '<ul class="changes-list">';
        uniqueDocsToAdd.forEach(doc => {
            summary += `<li class="change-add">✓ ${escapeHtml(doc)}</li>`;
        });
        summary += '</ul>';
    }

    if (notes) {
        summary += '<h4>💬 הערות:</h4>';
        summary += '<ul class="changes-list"><li>' + escapeHtml(notes) + '</li></ul>';
    }

    summary += '</div>';

    document.getElementById('changesSummary').innerHTML = summary;
    document.getElementById('confirmModal').classList.add('show');
}

// Close confirmation
function closeConfirmation() {
    document.getElementById('confirmModal').classList.remove('show');
}

// Confirm and submit
async function confirmSubmit() {
    closeConfirmation();

    const customDoc = document.getElementById('customDoc').value.trim();
    const notes = document.getElementById('notes').value.trim();

    const docsToRemoveObjs = currentDocuments.filter(doc => markedForRemoval.has(doc.id));
    const docsToRemoveNames = docsToRemoveObjs.map(d => d.name);
    const docsToRemoveIds = docsToRemoveObjs.map(d => d.id);

    const docsToAddArray = Array.from(docsToAdd);

    if (customDoc) {
        const customDocs = customDoc
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean);

        for (const cd of customDocs) {
            if (!docsToAddArray.includes(cd)) {
                docsToAddArray.push(cd);
            }
        }
    }

    const uniqueDocsToAdd = [...new Set(docsToAddArray)];

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
            ]
        }
    };

    try {
        const response = await fetch(`${API_BASE}/tally-edit-documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            document.getElementById('content').style.display = 'none';
            document.getElementById('success-message').style.display = 'block';
            window.scrollTo(0, 0);
        } else {
            throw new Error('Server error');
        }
    } catch (error) {
        console.error(error);
        showAlert('שגיאה בשמירת השינויים. אנא נסה שוב או פנה למשרד.', 'error');
    }
}

// Reset form
function resetForm() {
    markedForRemoval.clear();
    docsToAdd.clear();
    document.getElementById('customDoc').value = '';
    document.getElementById('notes').value = '';
    document.getElementById('detailInput').classList.remove('show');
    document.getElementById('docTypeSelect').value = '';
    pendingTemplate = null;

    document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('.document-item').forEach(item => {
        item.classList.remove('marked-for-removal');
    });
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
async function confirmSendQuestionnaire() {
    if (!confirm("האם אתה בטוח שברצונך לשלוח את השאלון ללקוח זה?")) return;

    const token = localStorage.getItem('QKiwUBXVH@%#1gD7t@rB]<,dM.[NC5b_');
    if (!token) {
        alert("שגיאת הרשאה: עליך להתחבר דרך פורטל הניהול.");
        return;
    }

    const btn = document.querySelector('#not-started-view button');
    const originalText = btn.textContent;
    btn.textContent = 'שולח...';
    btn.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/admin-send-questionnaires`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                report_ids: [REPORT_ID]
            })
        });

        const data = await response.json();

        if (data.ok) {
            alert("השאלון נשלח בהצלחה!");
        } else {
            alert("שגיאה בשליחה: " + (data.error || 'Unknown error'));
        }
    } catch (e) {
        alert("שגיאת תקשורת");
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close detail input when clicking outside
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
});
