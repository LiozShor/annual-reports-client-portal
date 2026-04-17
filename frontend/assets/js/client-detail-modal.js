// Shared client detail modal (DL-293) — used by admin dashboard + document-manager.
// Expects these globals/utilities to be loaded on the page:
//   ENDPOINTS.ADMIN_UPDATE_CLIENT, fetchWithTimeout, FETCH_TIMEOUTS,
//   showConfirmDialog, escapeHtml.
// Expects modal markup with IDs: clientDetailModal, clientDetailReportId,
//   clientDetailName, clientDetailEmail, clientDetailCcEmail, clientDetailPhone,
//   clientDetailLoading, clientDetailFields, clientDetailSavingOverlay.
//
// ctx shape: { authToken, toast: (msg, type) => void, onSaved?: (client, prev) => void }

function _cdmEl(id) { return document.getElementById(id); }

function _cdmIsValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function openClientDetailModalShared(reportId, ctx) {
    window._clientDetailCtx = ctx || {};
    _cdmEl('clientDetailReportId').value = reportId;
    _cdmEl('clientDetailName').value = '';
    _cdmEl('clientDetailEmail').value = '';
    _cdmEl('clientDetailCcEmail').value = '';
    _cdmEl('clientDetailPhone').value = '';
    window._clientDetailSnapshot = null;

    _cdmEl('clientDetailLoading').style.display = '';
    _cdmEl('clientDetailFields').style.display = 'none';
    _cdmEl('clientDetailSavingOverlay').style.display = 'none';
    _cdmEl('clientDetailModal').classList.add('show');

    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_UPDATE_CLIENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: ctx.authToken, report_id: reportId, action: 'get' })
        }, FETCH_TIMEOUTS.load);
        const data = await response.json();

        if (!data.ok) throw new Error(data.error || 'שגיאה בטעינה');

        _cdmEl('clientDetailName').value = data.client.name || '';
        _cdmEl('clientDetailEmail').value = data.client.email || '';
        _cdmEl('clientDetailCcEmail').value = data.client.cc_email || '';
        _cdmEl('clientDetailPhone').value = data.client.phone || '';

        window._clientDetailSnapshot = {
            name: data.client.name || '',
            email: data.client.email || '',
            cc_email: data.client.cc_email || '',
            phone: data.client.phone || ''
        };

        _cdmEl('clientDetailLoading').style.display = 'none';
        _cdmEl('clientDetailFields').style.display = '';
    } catch (error) {
        closeClientDetailModal(true);
        if (ctx && ctx.toast) ctx.toast('שגיאה בטעינת פרטי לקוח: ' + error.message, 'danger');
    }
}

function closeClientDetailModal(skipDirtyCheck) {
    const snap = window._clientDetailSnapshot;
    if (!skipDirtyCheck && snap) {
        const name = _cdmEl('clientDetailName').value.trim();
        const email = _cdmEl('clientDetailEmail').value.trim().toLowerCase();
        const cc_email = _cdmEl('clientDetailCcEmail').value.trim().toLowerCase();
        const phone = _cdmEl('clientDetailPhone').value.trim();
        const isDirty = name !== snap.name || email !== snap.email
            || cc_email !== snap.cc_email || phone !== snap.phone;
        if (isDirty) {
            showConfirmDialog('יש שינויים שלא נשמרו. לסגור בלי לשמור?', _doCloseClientDetailModal, 'סגור בלי לשמור', true);
            return;
        }
    }
    _doCloseClientDetailModal();
}

function _doCloseClientDetailModal() {
    _cdmEl('clientDetailModal').classList.remove('show');
    _cdmEl('clientDetailReportId').value = '';
    _cdmEl('clientDetailName').value = '';
    _cdmEl('clientDetailEmail').value = '';
    _cdmEl('clientDetailCcEmail').value = '';
    _cdmEl('clientDetailPhone').value = '';
    window._clientDetailSnapshot = null;
    window._clientDetailCtx = null;
}

async function saveClientDetails() {
    const ctx = window._clientDetailCtx || {};
    const reportId = _cdmEl('clientDetailReportId').value;
    const name = _cdmEl('clientDetailName').value.trim();
    const email = _cdmEl('clientDetailEmail').value.trim().toLowerCase();
    const cc_email = _cdmEl('clientDetailCcEmail').value.trim().toLowerCase();
    const phone = _cdmEl('clientDetailPhone').value.trim();

    if (!name) {
        if (ctx.toast) ctx.toast('יש להזין שם', 'warning');
        return;
    }
    if (!_cdmIsValidEmail(email)) {
        if (ctx.toast) ctx.toast('כתובת אימייל לא תקינה', 'warning');
        return;
    }

    _cdmEl('clientDetailSavingOverlay').style.display = '';
    try {
        const response = await fetchWithTimeout(ENDPOINTS.ADMIN_UPDATE_CLIENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: ctx.authToken, report_id: reportId, action: 'update', name, email, cc_email, phone })
        }, FETCH_TIMEOUTS.mutate);
        const data = await response.json();

        if (!data.ok) throw new Error(data.error || 'שגיאה בשמירה');

        const prev = window._clientDetailSnapshot;
        const updated = { name, email, cc_email, phone, report_id: reportId };

        if (typeof ctx.onSaved === 'function') {
            try { ctx.onSaved(updated, prev); } catch (e) { console.error('onSaved threw:', e); }
        }

        _doCloseClientDetailModal();
    } catch (error) {
        _cdmEl('clientDetailSavingOverlay').style.display = 'none';
        if (ctx.toast) ctx.toast('שגיאה בשמירה: ' + error.message, 'danger');
    }
}

// Helper: build Hebrew change-summary lines (used by dashboard onSaved)
function buildClientDetailChanges(updated, prev) {
    const fieldLabels = { name: 'שם', email: 'אימייל', cc_email: 'אימייל בן/בת זוג', phone: 'טלפון' };
    const lines = [];
    if (!prev) return lines;
    for (const [key, label] of Object.entries(fieldLabels)) {
        const oldVal = prev[key] || '';
        const newVal = updated[key] || '';
        if (oldVal !== newVal) {
            lines.push(`${label}: ${escapeHtml(oldVal || '—')} ← ${escapeHtml(newVal)}`);
        }
    }
    return lines;
}
