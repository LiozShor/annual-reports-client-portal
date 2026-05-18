/**
 * DL-421 — Bulk multi-select for AI Review queue.
 *
 * Features:
 *   - Checkboxes on every pending AI-Review card (data-id, data-client, data-template)
 *   - Single-client constraint: once any card is checked, cards from other clients disable
 *   - Hard cap of 20 selections; 21st blocked with toast
 *   - Floating bulk-action bar: "N נבחרו · [מזג למסמך אחד] [העבר ללקוח אחר] [נקה]"
 *   - Merge confirm: lazy SortableJS, draggable list, template picker, POST /review-classification
 *   - Move confirm: reuses single-move client picker, POST /bulk-move-classification-client
 *   - Silent refresh after every successful POST (no page reload)
 *
 * Exposed on window:
 *   window.initBulkClassify()  — called once after first renderAICards() in script.js
 *
 * State is module-local. Uses event delegation so re-renders don't need re-init.
 */
(function () {
    'use strict';

    var MAX_BULK = 20;
    var selectedSet = new Set();   // classification IDs
    var firstClientId = null;      // snapshot on first selection
    var sortableLoaded = false;
    var sortableLoading = false;
    var sortableResolvers = [];

    // ── Helpers ──────────────────────────────────────────────────────────────

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function aiData() {
        return window.aiClassificationsData || [];
    }

    function getItem(id) {
        return aiData().find(function (i) { return i.id === id; });
    }

    function getAuthToken() {
        return typeof authToken !== 'undefined' ? authToken : (localStorage.getItem('admin_token') || '');
    }

    function silentRefresh() {
        if (typeof window.loadAIClassifications === 'function') {
            window.loadAIClassifications(false, false);
        }
    }

    // ── SortableJS lazy loader ────────────────────────────────────────────────

    function ensureSortable() {
        if (sortableLoaded) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            sortableResolvers.push({ resolve: resolve, reject: reject });
            if (sortableLoading) return;
            sortableLoading = true;
            var script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js';
            script.onload = function () {
                sortableLoaded = true;
                sortableLoading = false;
                sortableResolvers.forEach(function (r) { r.resolve(); });
                sortableResolvers = [];
            };
            script.onerror = function () {
                sortableLoading = false;
                sortableResolvers.forEach(function (r) { r.reject(new Error('SortableJS load failed')); });
                sortableResolvers = [];
            };
            document.head.appendChild(script);
        });
    }

    // ── Floating bulk bar ─────────────────────────────────────────────────────

    function getBulkBar() {
        return document.getElementById('dl421BulkBar');
    }

    function removeBulkBar() {
        var bar = getBulkBar();
        if (bar) bar.remove();
    }

    function renderBulkBar() {
        var bar = getBulkBar();
        var count = selectedSet.size;
        if (count === 0) {
            removeBulkBar();
            return;
        }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'dl421BulkBar';
            bar.className = 'floating-bulk-bar';
            bar.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
                'background:#1e293b;color:#f8fafc;border-radius:10px;padding:10px 18px;display:flex;' +
                'align-items:center;gap:12px;z-index:9998;box-shadow:0 4px 20px rgba(0,0,0,.4);' +
                'font-size:14px;white-space:nowrap;';
            document.body.appendChild(bar);
        }
        bar.innerHTML =
            '<span id="dl421BulkCount" style="font-weight:600;">' + count + ' נבחרו</span>' +
            '<button id="dl421BtnMerge" class="btn btn-sm" style="background:#4f46e5;color:#fff;border:none;" onclick="window._dl421OpenMerge()">מזג למסמך אחד</button>' +
            '<button id="dl421BtnMove"  class="btn btn-sm" style="background:#0f766e;color:#fff;border:none;" onclick="window._dl421OpenMove()">העבר ללקוח אחר</button>' +
            '<button class="btn btn-sm" style="background:transparent;color:#94a3b8;border:1px solid #475569;" onclick="window._dl421ClearAll()">נקה</button>';
    }

    // ── Checkbox state sync ───────────────────────────────────────────────────

    function syncCheckboxStates() {
        document.querySelectorAll('.ai-bulk-select').forEach(function (cb) {
            var id = cb.dataset.id;
            var client = cb.dataset.client;
            var locked = firstClientId && client && client !== firstClientId;
            var atCap = !selectedSet.has(id) && selectedSet.size >= MAX_BULK;
            cb.checked = selectedSet.has(id);
            cb.disabled = !!(locked || atCap);
            if (locked) {
                cb.title = 'פעולות בכמות הן ללקוח אחד / Bulk actions are per-client';
            } else if (atCap) {
                cb.title = 'הגעת למגבלת ' + MAX_BULK + ' פריטים';
            } else {
                cb.title = '';
            }
        });
    }

    function onCheckboxChange(cb) {
        var id = cb.dataset.id;
        var client = cb.dataset.client;

        if (cb.checked) {
            if (selectedSet.size >= MAX_BULK) {
                cb.checked = false;
                if (typeof window.showAIToast === 'function') {
                    window.showAIToast('מגבלה: ניתן לבחור עד ' + MAX_BULK + ' פריטים בו-זמנית', 'danger');
                }
                return;
            }
            if (!firstClientId) {
                firstClientId = client;
            }
            if (firstClientId && client !== firstClientId) {
                cb.checked = false;
                if (typeof window.showAIToast === 'function') {
                    window.showAIToast('פעולות בכמות הן ללקוח אחד בלבד', 'danger');
                }
                return;
            }
            selectedSet.add(id);
        } else {
            selectedSet.delete(id);
            if (selectedSet.size === 0) firstClientId = null;
        }

        syncCheckboxStates();
        renderBulkBar();
    }

    // ── Clear ─────────────────────────────────────────────────────────────────

    window._dl421ClearAll = function () {
        selectedSet.clear();
        firstClientId = null;
        syncCheckboxStates();
        removeBulkBar();
    };

    // ── Template picker (reuse combobox from reassign modal) ──────────────────

    function buildTemplatePicker(containerEl, item) {
        // Use createDocCombobox if available (same as reassign modal)
        if (typeof window.createDocCombobox === 'function' && item) {
            var ownDocs = item.all_docs || item.missing_docs || [];
            window.createDocCombobox(containerEl, ownDocs, {
                currentMatchId: item.matched_template_id || null,
                allowCreate: false,
                onSelect: function (tid) {
                    containerEl.dataset.selectedTemplate = tid || '';
                }
            });
        } else {
            containerEl.innerHTML = '<input id="dl421TemplateInput" type="text" placeholder="Template ID" style="width:100%;padding:6px 10px;border:1px solid var(--gray-300);border-radius:6px;font-size:13px;">';
            containerEl.querySelector('#dl421TemplateInput').addEventListener('input', function () {
                containerEl.dataset.selectedTemplate = this.value.trim();
            });
        }
    }

    // ── Merge modal ───────────────────────────────────────────────────────────

    window._dl421OpenMerge = function () {
        if (selectedSet.size === 0) return;
        var ids = Array.from(selectedSet);
        // Collect items sorted chronologically (default order per spec)
        var items = ids.map(function (id) { return getItem(id); }).filter(Boolean);
        items.sort(function (a, b) {
            return new Date(a.received_at || 0) - new Date(b.received_at || 0);
        });

        var refItem = items[0]; // for template picker context

        // Build modal
        closeMergeModal();
        var overlay = document.createElement('div');
        overlay.id = 'dl421MergeOverlay';
        overlay.className = 'ai-modal-overlay show';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
        overlay.onclick = function (e) { if (e.target === overlay) closeMergeModal(); };

        var listRowsHtml = items.map(function (it, i) {
            var fname = esc(it.attachment_name || it.expected_filename || ('מסמך ' + (i + 1)));
            var pages = it.page_count ? (' · ' + it.page_count + ' עמ\'') : '';
            var dateStr = it.received_at ? new Date(it.received_at).toLocaleDateString('he-IL') : '';
            return '<li class="dl421-sort-item" data-id="' + esc(it.id) + '" style="' +
                'display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--gray-200);' +
                'border-radius:6px;margin-bottom:6px;background:#fff;cursor:grab;list-style:none;">' +
                '<span style="color:var(--gray-400);font-size:16px;">⠿</span>' +
                '<span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + fname + '">' + fname + '</span>' +
                '<span style="font-size:11px;color:var(--gray-500);white-space:nowrap;">' + esc(dateStr) + esc(pages) + '</span>' +
                '</li>';
        }).join('');

        overlay.innerHTML =
            '<div class="ai-modal-panel" style="width:min(540px,94vw);max-height:85vh;display:flex;flex-direction:column;" onclick="event.stopPropagation()">' +
            '<div class="ai-modal-panel-header" style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--gray-200);">' +
            '<span style="font-weight:600;font-size:15px;">מזג ' + items.length + ' מסמכים למסמך אחד</span>' +
            '<button type="button" onclick="closeMergeModal()" style="background:none;border:none;cursor:pointer;font-size:20px;color:var(--gray-500);">×</button>' +
            '</div>' +
            '<div style="padding:14px 18px;overflow-y:auto;flex:1;">' +
            '<p style="font-size:13px;color:var(--gray-600);margin-bottom:10px;">גרור לסידור הסדר הרצוי:</p>' +
            '<ul id="dl421SortList" style="padding:0;margin:0 0 14px 0;">' + listRowsHtml + '</ul>' +
            '<div style="font-size:13px;font-weight:500;margin-bottom:6px;">בחר תבנית יעד:</div>' +
            '<div id="dl421TemplatePicker" data-selected-template="' + esc((refItem && refItem.matched_template_id) || '') + '"></div>' +
            '</div>' +
            '<div class="ai-modal-panel-footer" style="display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--gray-200);">' +
            '<button class="btn btn-secondary" onclick="closeMergeModal()">ביטול</button>' +
            '<button class="btn btn-primary" id="dl421MergeConfirmBtn" onclick="window._dl421SubmitMerge()">מזג</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        // Build template picker
        var pickerEl = document.getElementById('dl421TemplatePicker');
        if (pickerEl) buildTemplatePicker(pickerEl, refItem);

        // Init SortableJS
        ensureSortable().then(function () {
            var listEl = document.getElementById('dl421SortList');
            if (listEl && window.Sortable) {
                new window.Sortable(listEl, { animation: 150, handle: '.dl421-sort-item' });
            }
        }).catch(function () {
            if (typeof window.showAIToast === 'function') {
                window.showAIToast('לא ניתן לטעון גרירה — הסדר נקבע לפי תאריך', 'danger');
            }
        });
    };

    window.closeMergeModal = function () {
        var el = document.getElementById('dl421MergeOverlay');
        if (el) el.remove();
    };

    window._dl421SubmitMerge = async function () {
        var overlay = document.getElementById('dl421MergeOverlay');
        if (!overlay) return;

        // Collect ordered IDs from sorted list
        var listEl = document.getElementById('dl421SortList');
        var orderedIds = listEl
            ? Array.from(listEl.querySelectorAll('.dl421-sort-item')).map(function (li) { return li.dataset.id; })
            : Array.from(selectedSet);

        // Get selected template
        var pickerEl = document.getElementById('dl421TemplatePicker');
        var templateId = (pickerEl && pickerEl.dataset.selectedTemplate) || '';

        if (!templateId) {
            if (typeof window.showAIToast === 'function') {
                window.showAIToast('יש לבחור תבנית יעד למסמך הממוזג', 'danger');
            }
            return;
        }

        var confirmBtn = document.getElementById('dl421MergeConfirmBtn');
        if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'ממזג...'; }

        try {
            var mergeUrl = (window.ENDPOINTS && window.ENDPOINTS.BULK_MERGE_CLASSIFICATIONS)
                || 'https://annual-reports-api.liozshor1.workers.dev/webhook/bulk-merge-classifications';
            var resp = await fetch(mergeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getAuthToken() },
                body: JSON.stringify({
                    action: 'bulk_merge',
                    client_id: firstClientId,
                    target_template_id: templateId,
                    ordered_classification_ids: orderedIds
                })
            });
            var data = await resp.json();
            closeMergeModal();
            if (!data.ok) {
                if (typeof window.showModal === 'function') {
                    window.showModal('error', 'מיזוג נכשל', data.error || 'שגיאה לא ידועה');
                }
                return;
            }
            window._dl421ClearAll();
            silentRefresh();
            if (typeof window.showAIToast === 'function') {
                window.showAIToast(
                    'המסמכים מוזגו (' + (data.merged_page_count || '?') + ' עמ\')',
                    'success'
                );
            }
        } catch (err) {
            closeMergeModal();
            if (typeof window.showModal === 'function') {
                window.showModal('error', 'שגיאה', String(err && err.message ? err.message : err));
            }
        }
    };

    // ── Move modal ────────────────────────────────────────────────────────────

    window._dl421OpenMove = function () {
        if (selectedSet.size === 0) return;
        var ids = Array.from(selectedSet);
        var sourceClientName = '';
        var first = getItem(ids[0]);
        if (first) sourceClientName = first.client_name || firstClientId || '';

        closeMoveModal();
        var overlay = document.createElement('div');
        overlay.id = 'dl421MoveOverlay';
        overlay.className = 'ai-modal-overlay show';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
        overlay.onclick = function (e) { if (e.target === overlay) closeMoveModal(); };

        overlay.innerHTML =
            '<div class="ai-modal-panel ai-move-client-modal" style="width:min(520px,94vw);max-height:85vh;display:flex;flex-direction:column;" onclick="event.stopPropagation()">' +
            '<div class="ai-modal-panel-header" style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--gray-200);">' +
            '<span style="font-weight:600;font-size:15px;">העבר ' + ids.length + ' מסמכים ללקוח אחר</span>' +
            '<button type="button" onclick="closeMoveModal()" style="background:none;border:none;cursor:pointer;font-size:20px;color:var(--gray-500);">×</button>' +
            '</div>' +
            '<div style="padding:12px 18px 6px;">' +
            '<div style="font-size:13px;color:var(--gray-600);margin-bottom:8px;"><strong>מלקוח:</strong> ' + esc(sourceClientName) + '</div>' +
            '<label class="ai-move-client-label" for="dl421MoveSearch">בחר לקוח יעד</label>' +
            '<input id="dl421MoveSearch" class="ai-move-client-search" type="text" autocomplete="off" placeholder="חיפוש לפי שם, ת.ז או אימייל...">' +
            '</div>' +
            '<div id="dl421MoveList" class="ai-move-client-list" style="flex:1;overflow-y:auto;padding:0 18px 12px;"></div>' +
            '<div class="ai-modal-panel-footer" style="padding:12px 18px;border-top:1px solid var(--gray-200);display:flex;justify-content:flex-end;">' +
            '<button class="btn btn-secondary" onclick="closeMoveModal()">ביטול</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        var listEl = overlay.querySelector('#dl421MoveList');
        var searchEl = overlay.querySelector('#dl421MoveSearch');

        var PRE_STAGES = new Set(['Send_Questionnaire', 'Waiting_For_Answers', 'Pending_Approval']);
        var seen = new Set();
        var uniqueClients = (window.clientsData || []).filter(function (c) {
            if (!c || !c.client_id) return false;
            if (c.client_id === firstClientId) return false;
            if (c.is_active === false) return false;
            if (seen.has(c.client_id)) return false;
            seen.add(c.client_id);
            return true;
        });

        var renderList = function (filter) {
            var q = (filter || '').trim().toLowerCase();
            var rows = [];
            for (var i = 0; i < uniqueClients.length; i++) {
                var c = uniqueClients[i];
                var name = c.name || '';
                var cid = c.client_id || '';
                var email = c.email || '';
                var hay = (name + ' ' + cid + ' ' + email).toLowerCase();
                if (q && !hay.includes(q)) continue;
                var warn = PRE_STAGES.has(c.stage)
                    ? '<span class="ai-pre-questionnaire-badge">טרם מולא שאלון</span>'
                    : '';
                rows.push(
                    '<button class="ai-move-client-item" type="button" data-client-id="' + esc(cid) + '" data-client-name="' + esc(name) + '">' +
                    '<span class="ai-move-client-item__name">' + esc(name || cid) + ' ' + warn + '</span>' +
                    '<span class="ai-move-client-item__meta">' + esc(cid) + (email ? ' · ' + esc(email) : '') + '</span>' +
                    '</button>'
                );
                if (rows.length >= 80) break;
            }
            listEl.innerHTML = rows.join('') || '<div class="ai-move-client-empty">לא נמצאו לקוחות</div>';
            listEl.querySelectorAll('.ai-move-client-item').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    confirmBulkMove(ids, btn.dataset.clientId, btn.dataset.clientName, sourceClientName);
                });
            });
        };

        renderList('');
        searchEl.addEventListener('input', function () { renderList(searchEl.value); });
        setTimeout(function () { searchEl.focus(); }, 40);
    };

    window.closeMoveModal = function () {
        var el = document.getElementById('dl421MoveOverlay');
        if (el) el.remove();
    };

    function confirmBulkMove(ids, targetClientId, targetClientName, sourceClientName) {
        if (!targetClientId) return;
        var count = ids.length;
        if (typeof window.showConfirmDialog === 'function') {
            window.showConfirmDialog(
                'להעביר ' + count + ' מסמכים מ-' + (sourceClientName || firstClientId) + ' אל ' + (targetClientName || targetClientId) + '?',
                function () {
                    closeMoveModal();
                    submitBulkMove(ids, targetClientId, targetClientName);
                },
                'העבר',
                false
            );
        } else {
            closeMoveModal();
            submitBulkMove(ids, targetClientId, targetClientName);
        }
    }

    async function submitBulkMove(ids, targetClientId, targetClientName) {
        var sourceId = firstClientId;
        var bulkMoveUrl = (window.ENDPOINTS && window.ENDPOINTS.BULK_MOVE_CLASSIFICATION_CLIENT)
            || 'https://annual-reports-api.liozshor1.workers.dev/webhook/bulk-move-classification-client';
        try {
            var resp = await fetch(bulkMoveUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getAuthToken() },
                body: JSON.stringify({
                    source_client_id: sourceId,
                    target_client_id: targetClientId,
                    classification_ids: ids
                })
            });
            var data = await resp.json();
            if (!data.ok) {
                if (typeof window.showModal === 'function') {
                    window.showModal('error', 'ההעברה נכשלה', data.error || 'שגיאה לא ידועה');
                }
                return;
            }
            window._dl421ClearAll();
            silentRefresh();
            if (typeof window.showAIToast === 'function') {
                var moved = data.moved || ids.length;
                window.showAIToast('הועברו ' + moved + ' מסמכים אל ' + (targetClientName || targetClientId), 'success');
            }
        } catch (err) {
            if (typeof window.showModal === 'function') {
                window.showModal('error', 'שגיאה', String(err && err.message ? err.message : err));
            }
        }
    }

    // ── Init (called once from script.js after first renderAICards) ───────────

    window.initBulkClassify = function initBulkClassify() {
        // Event delegation on the docs pane — survives re-renders
        var docsPane = document.getElementById('aiDocsPane') || document.body;
        docsPane.addEventListener('change', function (e) {
            if (e.target && e.target.classList.contains('ai-bulk-select')) {
                onCheckboxChange(e.target);
            }
        });

        // Stop card click propagation on the checkbox itself
        docsPane.addEventListener('click', function (e) {
            if (e.target && e.target.classList.contains('ai-bulk-select')) {
                e.stopPropagation();
            }
        });

        // Keyboard: Escape to clear
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && selectedSet.size > 0) {
                window._dl421ClearAll();
            }
        });
    };
})();
