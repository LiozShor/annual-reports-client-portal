/* ===========================================
   DOCUMENT MANAGER JAVASCRIPT - document-manager.html
   =========================================== */

// Get URL parameters
const params = new URLSearchParams(window.location.search);
const REPORT_ID = params.get('report_id');
const CLIENT_NAME = params.get('client_name');
const SPOUSE_NAME = params.get('spouse_name') || '';
const YEAR = params.get('year');
const API_BASE = 'https://liozshor.app.n8n.cloud/webhook';

// State
let currentDocuments = [];
let markedForRemoval = new Set();
let docsToAdd = new Set();
let pendingDocWithDetail = null; // For documents requiring detail

// Initialize
document.getElementById('clientName').textContent = CLIENT_NAME || '-';
document.getElementById('spouseName').textContent = SPOUSE_NAME || '-';
document.getElementById('year').textContent = YEAR || '-';

// Populate document dropdown from registry
function initDocumentDropdown() {
    const select = document.getElementById('docTypeSelect');
    const optionsHtml = window.DocRegistry.getDocumentDropdownOptions({ lang: 'he', includeCategoryGroups: true });
    select.innerHTML = '<option value="">-- בחר מסמך מהרשימה --</option>\n' + optionsHtml;
}

// Run on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDocumentDropdown);
} else {
    initDocumentDropdown();
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
        const response = await fetch(`${API_BASE}/get-documents?report_id=${REPORT_ID}`);
        const data = await response.json();
        currentDocuments = data.documents || [];
        displayDocuments();
        updateStats();
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
    } catch (error) {
        console.error(error);
        showAlert('שגיאה בטעינת מסמכים. אנא נסה לרענן את הדף.', 'error');
    }
}

// Display documents
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

    container.innerHTML = currentDocuments.map(doc => `
        <div class="document-item" id="doc-${doc.id}">
            <input type="checkbox" 
                   onchange="toggleRemoval('${doc.id}')" 
                   id="checkbox-${doc.id}"
                   aria-label="סמן להסרה">
            <span class="document-icon">📄</span>
            <span class="document-name">${doc.name}</span>
        </div>
    `).join('');
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

// Handle document selection
document.getElementById('docTypeSelect').addEventListener('change', function (e) {
    const typeId = e.target.value;
    if (!typeId) return;

    const requiresDetail = window.DocRegistry.requiresDetails(typeId);

    if (requiresDetail) {
        // Show detail input
        pendingDocWithDetail = typeId;
        const schema = window.DocRegistry.getDetailsSchema(typeId);

        // Build dynamic detail inputs
        const detailInputDiv = document.getElementById('detailInput');
        const firstDetail = schema[0];

        if (firstDetail) {
            document.getElementById('detailLabel').textContent = firstDetail.label_he + ':';
            document.getElementById('detailValue').placeholder = firstDetail.placeholder_he || '';
            document.getElementById('detailValue').value = '';
            detailInputDiv.classList.add('show');
            document.getElementById('detailValue').focus();
        }
    } else {
        // Add directly without detail
        const displayName = window.DocRegistry.formatDocumentName(typeId, { year: YEAR }, { lang: 'he', mode: 'text' });

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

// Add document with detail
function addDocumentWithDetail() {
    const detail = document.getElementById('detailValue').value.trim();

    if (!detail) {
        showAlert('יש להזין את הפרטים הנדרשים', 'error');
        return;
    }

    if (!pendingDocWithDetail) return;

    // Get detail schema to determine parameter key
    const schema = window.DocRegistry.getDetailsSchema(pendingDocWithDetail);
    const firstDetail = schema[0];
    if (!firstDetail) return;

    // Build params object
    const params = { year: YEAR };
    params[firstDetail.key] = detail;

    // Format document name using registry
    const fullDocName = window.DocRegistry.formatDocumentName(pendingDocWithDetail, params, { lang: 'he', mode: 'text' });

    if (docsToAdd.has(fullDocName)) {
        showAlert('מסמך זה כבר נמצא ברשימה', 'error');
        return;
    }

    docsToAdd.add(fullDocName);
    updateSelectedDocs();
    updateStats();

    // Reset
    document.getElementById('detailInput').classList.remove('show');
    document.getElementById('docTypeSelect').value = '';
    pendingDocWithDetail = null;
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

// Open confirmation modal
function openConfirmation() {
    const TXT_NO_CHANGES = "לא בוצעו שינויים. אנא בצע שינויים לפני השמירה.";
    const TXT_REMOVE_PREFIX = "🚫 מסמכים שיוסרו מרשימת הלקוח (";
    const TXT_ADD_PREFIX = "➕ מסמכים שיתווספו (";
    const TXT_NOTES_TITLE = "💬 הערות:";

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
        summary += '<h4>' + TXT_REMOVE_PREFIX + docsToRemove.length + '):</h4>';
        summary += '<ul class="changes-list">';
        docsToRemove.forEach(doc => {
            summary += `<li class="change-remove">🚫 ${escapeHtml(doc)}</li>`;
        });
        summary += '</ul>';
    }

    if (uniqueDocsToAdd.length > 0) {
        summary += '<h4>' + TXT_ADD_PREFIX + uniqueDocsToAdd.length + '):</h4>';
        summary += '<ul class="changes-list">';
        uniqueDocsToAdd.forEach(doc => {
            summary += `<li class="change-add">✓ ${escapeHtml(doc)}</li>`;
        });
        summary += '</ul>';
    }

    if (notes) {
        summary += '<h4>' + TXT_NOTES_TITLE + '</h4>';
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
    pendingDocWithDetail = null;

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

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load on page load
window.addEventListener('DOMContentLoaded', loadDocuments);

// Close detail input when clicking outside
document.addEventListener('click', function (e) {
    const detailInput = document.getElementById('detailInput');
    const select = document.getElementById('docTypeSelect');

    if (detailInput.classList.contains('show') &&
        !detailInput.contains(e.target) &&
        !select.contains(e.target)) {
        detailInput.classList.remove('show');
        select.value = '';
        pendingDocWithDetail = null;
    }
});
