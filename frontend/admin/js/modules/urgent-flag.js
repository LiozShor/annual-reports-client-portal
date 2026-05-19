/**
 * DL-426 — Manual "urgent" flag on clients.
 *
 * Boolean is_urgent on the clients table, auto-created via DL-420 typecast
 * pattern on first PATCH. Surfaced on four admin queues (clients table,
 * PA queue, AI Review, messages widget) with pin-to-top sort and a red
 * 🔥 badge. WCAG 1.4.1: color is paired with the 🔥 glyph + Hebrew
 * `דחוף` tooltip/aria-label.
 *
 * Extracted into a module because frontend/admin/js/script.js is on a
 * one-way size ratchet (see CLAUDE.md / .claude/script-size-baseline.json).
 *
 * Exposed on window:
 *   - UrgentFlag.isUrgent(client)             -> boolean, defensive
 *   - UrgentFlag.badgeHtml(client)            -> string (🔥 pill) or ''
 *   - UrgentFlag.toggleButtonHtml(client)     -> per-card 🔥 toggle button
 *   - UrgentFlag.toggle(reportId, currentValue)  -> Promise: PATCH + silent refresh
 *   - UrgentFlag.sortPin(a, b)                -> -1/0/+1, urgent-first stable
 *   - UrgentFlag.menuItem(client)             -> { label, onClick, danger } for kebab
 */
(function () {
  'use strict';

  function _esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function isUrgent(client) {
    if (!client) return false;
    var v = client.is_urgent;
    if (v === true) return true;
    if (typeof v === 'string') return v.toLowerCase() === 'true';
    return false;
  }

  // Resolve urgency from the global clientsData by report_id (PA/AI/messages
  // items don't carry is_urgent directly).
  function isUrgentByReportId(reportId) {
    if (!reportId) return false;
    var arr = (typeof window.clientsData !== 'undefined' && window.clientsData) || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].report_id === reportId) return isUrgent(arr[i]);
    }
    return false;
  }

  // Same, but by client_id (used by the messages widget which groups by client).
  function isUrgentByClientId(clientId) {
    if (!clientId) return false;
    var arr = (typeof window.clientsData !== 'undefined' && window.clientsData) || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].client_id === clientId) return isUrgent(arr[i]);
    }
    return false;
  }

  // Return a synthetic { report_id, is_urgent } object for callers that have a
  // reportId but no client object — keeps badgeHtml/toggleButtonHtml simple.
  function syntheticByReportId(reportId) {
    return { report_id: reportId, is_urgent: isUrgentByReportId(reportId) };
  }

  function badgeHtml(client) {
    if (!isUrgent(client)) return '';
    return (
      '<span class="urgent-badge" ' +
      'role="img" ' +
      'title="לקוח דחוף" ' +
      'aria-label="דחוף">' +
      '🔥' +
      '</span>'
    );
  }

  function toggleButtonHtml(client) {
    if (!client) return '';
    var rid = _esc(client.report_id || '');
    var on = isUrgent(client);
    var cls = 'urgent-toggle-btn' + (on ? ' urgent-toggle-btn--on' : '');
    var tip = on ? 'הסר סימון דחוף' : 'סמן כדחוף';
    return (
      '<button type="button" class="' + cls + '" ' +
      'data-report-id="' + rid + '" ' +
      'data-current="' + (on ? '1' : '0') + '" ' +
      'onclick="event.stopPropagation(); window.UrgentFlag.toggleFromButton(this)" ' +
      'title="' + _esc(tip) + '" ' +
      'aria-label="' + _esc(tip) + '" ' +
      'aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '🔥' +
      '</button>'
    );
  }

  function _findClient(reportId) {
    var arr = (typeof window.clientsData !== 'undefined' && window.clientsData) || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].report_id === reportId) return arr[i];
    }
    return null;
  }

  function _silentRefresh() {
    // Fan out to whichever queues are currently rendered. Each render is a
    // no-op if its container/data is empty, so calling all of them is safe.
    try { if (typeof window.renderClientsTable === 'function') window.renderClientsTable(); } catch (_) {}
    try { if (typeof window.renderMessages === 'function') window.renderMessages(); } catch (_) {}
    try { if (typeof window.renderPendingApprovalCards === 'function') window.renderPendingApprovalCards(); } catch (_) {}
    try {
      // AI Review re-render uses the cached filtered list when available.
      if (typeof window.renderAICards === 'function' &&
          typeof window._aiCurrentItems !== 'undefined' &&
          typeof window._aiAllFiltered !== 'undefined') {
        window.renderAICards(window._aiCurrentItems, window._aiAllFiltered);
      } else if (typeof window.renderAIReview === 'function') {
        window.renderAIReview();
      }
    } catch (_) {}
  }

  function toggle(reportId, currentValue) {
    var token = (typeof window.authToken !== 'undefined' && window.authToken) || '';
    var newValue = !currentValue;
    var url = (window.ENDPOINTS && window.ENDPOINTS.ADMIN_UPDATE_CLIENT) ||
              'https://annual-reports-api.liozshor1.workers.dev/webhook/admin-update-client';
    var fetcher = (typeof window.fetchWithTimeout === 'function') ? window.fetchWithTimeout : window.fetch;
    console.log('[UrgentFlag] toggle →', { reportId: reportId, currentValue: currentValue, newValue: newValue, url: url, hasToken: !!token });
    var _status = 0;
    var _statusText = '';
    return fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        token: token,
        report_id: reportId,
        action: 'update',
        is_urgent: newValue
      })
    }).then(function (r) {
      _status = r.status;
      _statusText = r.statusText;
      console.log('[UrgentFlag] HTTP', _status, _statusText);
      return r.text().then(function (raw) {
        console.log('[UrgentFlag] body raw:', raw);
        try { return JSON.parse(raw); } catch (_) { return { ok: false, _raw: raw }; }
      });
    }).then(function (res) {
      console.log('[UrgentFlag] parsed response:', res);
      if (!res || res.ok === false) {
        var msg = 'שמירת דחיפות נכשלה' + (res && res.error ? ' — ' + res.error : '') + ' (HTTP ' + _status + ')';
        console.error('[UrgentFlag] save FAILED:', { status: _status, statusText: _statusText, response: res });
        if (typeof window.showAIToast === 'function') window.showAIToast(msg, 'error');
        return false;
      }
      var c = _findClient(reportId);
      if (c) c.is_urgent = newValue;
      _silentRefresh();
      if (typeof window.showAIToast === 'function') {
        window.showAIToast(newValue ? 'הלקוח סומן כדחוף' : 'סימון דחיפות הוסר', 'success');
      }
      return true;
    }).catch(function (err) {
      console.error('[UrgentFlag] fetch threw:', err);
      if (typeof window.showAIToast === 'function') {
        window.showAIToast('שמירת דחיפות נכשלה — ' + (err && err.message ? err.message : 'network error'), 'error');
      }
      return false;
    });
  }

  function toggleFromButton(btn) {
    if (!btn) return;
    var rid = btn.getAttribute('data-report-id') || '';
    var cur = btn.getAttribute('data-current') === '1';
    if (!rid) return;
    btn.disabled = true;
    toggle(rid, cur).then(function () { btn.disabled = false; });
  }

  // Stable comparator: urgent first, equal otherwise. Callers chain with
  // existing comparators using `||`, e.g. `urgentSort(a,b) || bounceSort(a,b)`.
  function sortPin(a, b) {
    var ua = isUrgent(a) ? 1 : 0;
    var ub = isUrgent(b) ? 1 : 0;
    return ub - ua; // urgent (1) before non-urgent (0)
  }

  // Comparator using reportId/clientId lookup against clientsData. Returns
  // negative when `a` is urgent and `b` is not, etc.
  function cmpByReportId(a, b) {
    var ua = isUrgentByReportId(a && a.report_id) ? 1 : 0;
    var ub = isUrgentByReportId(b && b.report_id) ? 1 : 0;
    return ub - ua;
  }
  function cmpByClientId(a, b) {
    var ua = isUrgentByClientId(a && a.client_id) ? 1 : 0;
    var ub = isUrgentByClientId(b && b.client_id) ? 1 : 0;
    return ub - ua;
  }

  // Helper combining the badge + toggle in one call site (single string).
  // Returns `${badge}${toggle}` or empty string. Saves several lines at call
  // sites and centralizes the pa-card / ai-client-row / mobile-card pattern.
  function badgeAndToggleByReportId(reportId) {
    var s = syntheticByReportId(reportId);
    return badgeHtml(s) + toggleButtonHtml(s);
  }

  // DL-426: urgent-only filter toggle for the main clients table.
  function toggleFilter() {
    window._urgentFilterActive = !window._urgentFilterActive;
    var btn = document.getElementById('urgentFilterBtn');
    if (btn) {
      btn.setAttribute('aria-pressed', window._urgentFilterActive ? 'true' : 'false');
      btn.classList.toggle('btn-primary', window._urgentFilterActive);
      btn.classList.toggle('btn-ghost', !window._urgentFilterActive);
    }
    if (typeof window.filterClients === 'function') window.filterClients();
  }
  window.toggleUrgentFilter = toggleFilter;

  window.UrgentFlag = {
    isUrgent: isUrgent,
    isUrgentByReportId: isUrgentByReportId,
    isUrgentByClientId: isUrgentByClientId,
    syntheticByReportId: syntheticByReportId,
    badgeHtml: badgeHtml,
    toggleButtonHtml: toggleButtonHtml,
    badgeAndToggleByReportId: badgeAndToggleByReportId,
    toggle: toggle,
    toggleFromButton: toggleFromButton,
    sortPin: sortPin,
    cmpByReportId: cmpByReportId,
    cmpByClientId: cmpByClientId
  };
})();
