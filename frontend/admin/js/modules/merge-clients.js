/**
 * DL-404 — Merge Clients: admin dialog for merging two client records.
 *
 * Extracted into a module because script.js is on a one-way size ratchet
 * (`.claude/script-size-baseline.json`). New code goes here; script.js
 * only adds the kebab item that calls `openMergeClientsDialog`.
 *
 * Exposed on window:
 *   - openMergeClientsDialog(reportId, clientName)
 *       Opens the merge picker modal for the given client row.
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* Helpers                                                              */
    /* ------------------------------------------------------------------ */

    function _closeMergeModal() {
        const ov = document.getElementById('dl404MergeModalOverlay');
        if (ov) ov.remove();
    }

    function _escHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function _escAttr(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/'/g, '&#39;');
    }

    /** Highlight matching substring in a string (returns HTML-safe string). */
    function _highlight(text, query) {
        if (!query) return _escHtml(text);
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx < 0) return _escHtml(text);
        return (
            _escHtml(text.slice(0, idx)) +
            '<mark style="background:var(--yellow-100,#fef9c3);border-radius:2px;">' +
            _escHtml(text.slice(idx, idx + query.length)) +
            '</mark>' +
            _escHtml(text.slice(idx + query.length))
        );
    }

    /** Resolve which of two client objects is winner (older = winner). */
    function _resolveWinnerLoser(clientA, clientB) {
        const tA = new Date(clientA.created_time || clientA.createdTime || 0).getTime();
        const tB = new Date(clientB.created_time || clientB.createdTime || 0).getTime();
        // Older (smaller timestamp) wins; tie-break: A wins
        if (tA <= tB) return { winner: clientA, loser: clientB };
        return { winner: clientB, loser: clientA };
    }

    /** Build a preview card column HTML for one client. */
    function _buildPreviewCard(client, label) {
        const stageLabel = (window.STAGES && window.STAGES[client.stage])
            ? window.STAGES[client.stage].label
            : (client.stage || '—');
        const docsStr = (client.docs_total != null && client.docs_received != null)
            ? `${client.docs_received}/${client.docs_total}`
            : '—';
        return `
            <div style="flex:1; min-width:0; background:var(--gray-50,#f9fafb); border:1px solid var(--gray-200,#e5e7eb); border-radius:8px; padding:14px 16px;">
                <div style="font-size:11px; font-weight:600; color:var(--gray-500,#6b7280); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:10px;">
                    ${_escHtml(label)}
                </div>
                <div style="font-weight:600; font-size:14px; margin-bottom:4px; word-break:break-word;">${_escHtml(client.name || '—')}</div>
                <div style="font-size:12px; color:var(--gray-600,#4b5563); margin-bottom:4px; word-break:break-word;">${_escHtml(client.email || '—')}</div>
                <div style="font-size:12px; color:var(--gray-600,#4b5563); margin-bottom:4px;">שלב: ${_escHtml(stageLabel)}</div>
                <div style="font-size:12px; color:var(--gray-600,#4b5563);">מסמכים: ${_escHtml(docsStr)}</div>
            </div>`;
    }

    /* ------------------------------------------------------------------ */
    /* Phase 1 — Picker modal                                               */
    /* ------------------------------------------------------------------ */

    function openMergeClientsDialog(reportId, clientName) {
        if (!reportId) return;
        _closeMergeModal();

        // Find the source client object
        const clientsData = window.clientsData || [];
        const sourceClient = clientsData.find(c => c.report_id === reportId);

        const overlay = document.createElement('div');
        overlay.id = 'dl404MergeModalOverlay';
        overlay.className = 'ai-modal-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:9999; display:flex; align-items:center; justify-content:center;';
        overlay.onclick = (e) => { if (e.target === overlay) _closeMergeModal(); };

        const panel = document.createElement('div');
        panel.className = 'ai-modal-panel';
        panel.style.cssText = 'background:#fff; border-radius:8px; width:min(540px, 94vw); max-height:82vh; display:flex; flex-direction:column; box-shadow:0 12px 40px rgba(0,0,0,0.2);';

        panel.innerHTML = `
            <div style="padding:16px 20px; border-bottom:1px solid var(--gray-200,#e5e7eb); display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
                <div style="font-weight:600; font-size:15px; direction:rtl;">מיזוג לקוחות</div>
                <button onclick="(function(){var ov=document.getElementById('dl404MergeModalOverlay');if(ov)ov.remove();})()" style="background:none; border:none; cursor:pointer; font-size:20px; color:var(--gray-600,#4b5563); line-height:1;">×</button>
            </div>
            <div style="padding:10px 20px 0; flex-shrink:0; direction:rtl; font-size:13px; color:var(--gray-600,#4b5563);">
                בחר את הלקוח השני למיזוג עם <strong>${_escHtml(clientName || reportId)}</strong>:
            </div>
            <div style="padding:10px 20px; flex-shrink:0;">
                <input id="dl404ClientSearch" type="text" placeholder="חיפוש שם או מזהה..." autocomplete="off" dir="rtl"
                       style="width:100%; box-sizing:border-box; padding:8px 12px; font-size:14px; border:1px solid var(--gray-300,#d1d5db); border-radius:6px; direction:rtl;">
            </div>
            <div id="dl404ClientList" style="flex:1; overflow-y:auto; padding:0 12px 12px; direction:rtl;"></div>
            <div style="padding:12px 20px; border-top:1px solid var(--gray-200,#e5e7eb); display:flex; justify-content:flex-start; flex-shrink:0;">
                <button class="btn btn-secondary" onclick="(function(){var ov=document.getElementById('dl404MergeModalOverlay');if(ov)ov.remove();})()">ביטול</button>
            </div>
        `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const listEl = panel.querySelector('#dl404ClientList');
        const searchEl = panel.querySelector('#dl404ClientSearch');

        const renderList = (filter) => {
            const lower = (filter || '').trim().toLowerCase();
            const seen = new Set();
            const rows = [];
            for (const c of clientsData) {
                if (!c.client_id || seen.has(c.client_id)) continue;
                // Exclude: inactive clients and the source client itself
                if (c.is_active === false) continue;
                if (c.report_id === reportId || c.client_id === (sourceClient && sourceClient.client_id)) continue;
                seen.add(c.client_id);
                const name = c.name || '';
                const cid = c.client_id || '';
                const hay = (name + ' ' + cid).toLowerCase();
                if (lower && !hay.includes(lower)) continue;
                const nameHtml = _highlight(name, filter ? filter.trim() : '');
                const stageLabel = (window.STAGES && window.STAGES[c.stage]) ? window.STAGES[c.stage].label : (c.stage || '');
                rows.push(`
                    <div class="dl404-client-item"
                         data-report-id="${_escAttr(c.report_id)}"
                         data-client-id="${_escAttr(cid)}"
                         style="padding:8px 12px; border-radius:4px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; direction:rtl;"
                         onmouseover="this.style.background='var(--gray-100,#f3f4f6)'" onmouseout="this.style.background=''">
                        <div style="font-weight:500;">${nameHtml}</div>
                        <div style="font-size:11px; color:var(--gray-500,#6b7280); margin-right:8px;">${_escHtml(stageLabel)}</div>
                    </div>
                `);
                if (rows.length >= 60) break;
            }
            listEl.innerHTML = rows.join('') ||
                '<div style="padding:16px; text-align:center; color:var(--gray-500,#6b7280); direction:rtl;">לא נמצאו לקוחות</div>';
            listEl.querySelectorAll('.dl404-client-item').forEach(el => {
                el.addEventListener('click', () => {
                    const targetReportId = el.dataset.reportId;
                    const targetClient = clientsData.find(c => c.report_id === targetReportId);
                    if (targetClient && sourceClient) {
                        _showMergeConfirmStep(sourceClient, targetClient);
                    }
                });
            });
        };

        renderList('');
        searchEl.addEventListener('input', () => renderList(searchEl.value));
        setTimeout(() => searchEl.focus(), 50);
    }

    /* ------------------------------------------------------------------ */
    /* Phase 2 — Confirm dialog with side-by-side preview                  */
    /* ------------------------------------------------------------------ */

    function _showMergeConfirmStep(clientA, clientB) {
        _closeMergeModal();

        const { winner, loser } = _resolveWinnerLoser(clientA, clientB);
        const prefilledName = `${winner.name || ''} & ${loser.name || ''}`.trim();

        const overlay = document.createElement('div');
        overlay.id = 'dl404MergeModalOverlay';
        overlay.className = 'ai-modal-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:9999; display:flex; align-items:center; justify-content:center;';
        overlay.onclick = (e) => { if (e.target === overlay) _closeMergeModal(); };

        const panel = document.createElement('div');
        panel.className = 'ai-modal-panel';
        panel.style.cssText = 'background:#fff; border-radius:8px; width:min(620px, 96vw); max-height:90vh; display:flex; flex-direction:column; box-shadow:0 12px 40px rgba(0,0,0,0.2); overflow-y:auto;';

        panel.innerHTML = `
            <div style="padding:16px 20px; border-bottom:1px solid var(--gray-200,#e5e7eb); display:flex; align-items:center; justify-content:space-between; flex-shrink:0; position:sticky; top:0; background:#fff; z-index:1;">
                <div style="font-weight:600; font-size:15px; direction:rtl;">מיזוג לקוחות — אישור</div>
                <button id="dl404ConfirmCloseBtn" style="background:none; border:none; cursor:pointer; font-size:20px; color:var(--gray-600,#4b5563); line-height:1;">×</button>
            </div>

            <div style="padding:16px 20px; direction:rtl;">
                <!-- Side-by-side preview -->
                <div style="display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap;">
                    ${_buildPreviewCard(winner, 'ראשי (יישמר)')}
                    ${_buildPreviewCard(loser, 'משני (ימוזג)')}
                </div>

                <!-- Merged name input -->
                <div style="margin-bottom:16px;">
                    <label for="dl404MergedNameInput" style="display:block; font-size:13px; font-weight:500; color:var(--gray-700,#374151); margin-bottom:6px;">
                        שם הלקוח לאחר המיזוג
                    </label>
                    <input id="dl404MergedNameInput" type="text" dir="rtl" value="${_escAttr(prefilledName)}"
                           style="width:100%; box-sizing:border-box; padding:8px 12px; font-size:14px; border:1px solid var(--gray-300,#d1d5db); border-radius:6px;">
                </div>

                <!-- Warning note -->
                <div style="background:var(--yellow-50,#fffbeb); border:1px solid var(--yellow-200,#fde68a); border-radius:6px; padding:10px 14px; font-size:12px; color:var(--yellow-800,#92400e); margin-bottom:16px; direction:rtl;">
                    הרשומה הוותיקה יותר תיוותר כרשומה הראשית. הרשומה השנייה תועבר לארכיון ולא תופיע בתורים.
                </div>
            </div>

            <div style="padding:12px 20px; border-top:1px solid var(--gray-200,#e5e7eb); display:flex; justify-content:flex-end; gap:8px; flex-shrink:0; position:sticky; bottom:0; background:#fff; z-index:1;">
                <button id="dl404CancelBtn" class="btn btn-secondary">ביטול</button>
                <button id="dl404ConfirmBtn" class="btn btn-primary" style="background:var(--red-600,#dc2626); border-color:var(--red-600,#dc2626);">אשר מיזוג</button>
            </div>
        `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const nameInput = panel.querySelector('#dl404MergedNameInput');
        const confirmBtn = panel.querySelector('#dl404ConfirmBtn');
        const cancelBtn = panel.querySelector('#dl404CancelBtn');
        const closeBtn = panel.querySelector('#dl404ConfirmCloseBtn');

        const updateConfirmState = () => {
            const val = (nameInput.value || '').trim();
            confirmBtn.disabled = !val;
            confirmBtn.style.opacity = val ? '1' : '0.5';
            confirmBtn.style.cursor = val ? 'pointer' : 'not-allowed';
        };
        nameInput.addEventListener('input', updateConfirmState);
        updateConfirmState();

        cancelBtn.addEventListener('click', _closeMergeModal);
        closeBtn.addEventListener('click', _closeMergeModal);

        confirmBtn.addEventListener('click', async () => {
            const mergedName = (nameInput.value || '').trim();
            if (!mergedName) return;
            await _doMerge(winner, loser, mergedName);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Phase 3 — API call + feedback                                        */
    /* ------------------------------------------------------------------ */

    async function _doMerge(winner, loser, mergedName) {
        const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `merge-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // Show spinner inside confirm button
        const confirmBtn = document.getElementById('dl404ConfirmBtn');
        const cancelBtn = document.getElementById('dl404CancelBtn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'מבצע מיזוג…';
        }
        if (cancelBtn) cancelBtn.disabled = true;

        const CF_BASE = 'https://annual-reports-api.liozshor1.workers.dev/webhook';
        const mergeEndpoint = `${CF_BASE}/admin-merge-clients`;
        const authToken = window.authToken ||
            (typeof localStorage !== 'undefined' && localStorage.getItem(window.ADMIN_TOKEN_KEY || 'admin_token')) ||
            '';

        let response;
        try {
            response = await fetch(mergeEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    client_a_id: winner.client_id,
                    client_b_id: loser.client_id,
                    merged_name: mergedName,
                    idempotency_key: idempotencyKey,
                }),
            });
        } catch (networkErr) {
            _closeMergeModal();
            _toastError('שגיאת רשת — לא ניתן היה להתחבר לשרת');
            return;
        }

        let data;
        try {
            data = await response.json();
        } catch (_) {
            data = {};
        }

        // --- Success path ---
        if (response.ok && data.ok !== false) {
            _closeMergeModal();
            _toastSuccess('הלקוחות מוזגו בהצלחה');
            // Surface warnings (non-fatal) as secondary toasts
            if (data.warnings) {
                if (data.warnings.includes('spouse_name_conflict')) {
                    setTimeout(() => _toastWarn('שם בן/בת הזוג כבר קיים — הושאר כפי שהיה'), 600);
                }
                if (data.warnings.includes('cc_email_conflict')) {
                    setTimeout(() => _toastWarn('כתובת CC כבר קיימת — הושארה כפי שהיתה'), 1200);
                }
            }
            // Silent refresh of the dashboard
            if (typeof window.loadDashboard === 'function') {
                window.loadDashboard();
            }
            return;
        }

        // --- Error path ---
        _closeMergeModal();
        const code = data.code || '';
        switch (code) {
            case 'cross_filing_type':
                _toastError('לא ניתן למזג בין סוגי דיווח שונים');
                break;
            case 'lock_contention':
                _toastError('מיזוג אחר בתהליך — נסה שוב בעוד מספר שניות');
                break;
            case 'partial_onedrive_move':
                // Offer retry button with same idempotency key
                _toastErrorWithAction(
                    'חלק מהקבצים לא הועברו ב-OneDrive — לחץ למיזוג חוזר',
                    'נסה שוב',
                    () => _retryPartialMerge(winner, loser, mergedName, idempotencyKey)
                );
                break;
            case 'invalid_input':
            case 'not_found':
            case 'same_client':
                _toastError(data.error || data.message || 'שגיאה בבקשה');
                break;
            default:
                _toastError(data.error || data.message || 'שגיאה במיזוג הלקוחות');
        }
    }

    async function _retryPartialMerge(winner, loser, mergedName, idempotencyKey) {
        const CF_BASE = 'https://annual-reports-api.liozshor1.workers.dev/webhook';
        const mergeEndpoint = `${CF_BASE}/admin-merge-clients`;
        const authToken = window.authToken ||
            (typeof localStorage !== 'undefined' && localStorage.getItem(window.ADMIN_TOKEN_KEY || 'admin_token')) ||
            '';
        let response, data;
        try {
            response = await fetch(mergeEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    client_a_id: winner.client_id,
                    client_b_id: loser.client_id,
                    merged_name: mergedName,
                    idempotency_key: idempotencyKey,
                }),
            });
            data = await response.json();
        } catch (_) {
            _toastError('שגיאת רשת בניסיון החוזר');
            return;
        }
        if (response.ok && data.ok !== false) {
            _toastSuccess('המיזוג הושלם בהצלחה');
            if (typeof window.loadDashboard === 'function') window.loadDashboard();
        } else {
            _toastError(data.error || data.message || 'שגיאה במיזוג החוזר');
        }
    }

    /* ------------------------------------------------------------------ */
    /* Toast helpers (delegate to global showAIToast when available)       */
    /* ------------------------------------------------------------------ */

    function _toastSuccess(msg) {
        if (typeof window.showAIToast === 'function') {
            window.showAIToast(msg, 'success');
        }
    }

    function _toastError(msg) {
        if (typeof window.showAIToast === 'function') {
            window.showAIToast(msg, 'error');
        }
    }

    function _toastWarn(msg) {
        if (typeof window.showAIToast === 'function') {
            window.showAIToast(msg, 'warning');
        }
    }

    function _toastErrorWithAction(msg, actionLabel, onAction) {
        if (typeof window.showAIToast === 'function') {
            window.showAIToast(msg, 'error', { label: actionLabel, onClick: onAction });
        } else {
            _toastError(msg);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Expose on window                                                      */
    /* ------------------------------------------------------------------ */

    window.openMergeClientsDialog = openMergeClientsDialog;

}());
