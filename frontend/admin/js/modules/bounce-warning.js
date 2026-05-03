/**
 * DL-399 — Email Bounce / NDR Handling (T4 admin UI bits).
 *
 * Extracted from script.js because the monolith is on a hard append-only-down
 * size ratchet (see CLAUDE.md / .claude/script-size-baseline.json). All new
 * bounce-warning UI logic lives here; script.js only calls these helpers.
 *
 * Exposed on window:
 *   - bounceBadgeHTML(client)            -> string (red ⚠ for bounced; soft grey ✉ for never-had-email)
 *   - openBounceModal(reportId)          -> opens modal with bounce details
 *   - hasBouncedInStage1(clients)        -> boolean
 *   - hasEmail(client)                   -> boolean (trim-aware)
 *   - sendQuestionnaireBtnHTML(client, rid)  -> action-btn HTML for row
 *   - filterClientsWithEmail(reportIds)  -> { sendable, skipped }
 *   - shouldPromptResendOnSave(updated, prev)  -> boolean
 *
 * No native alert()/confirm() — uses showAIToast / showConfirmDialog and a
 * custom .ai-modal-overlay panel for the bounce-detail modal.
 */
(function () {
  'use strict';

  function _esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function _icon(name, size) {
    if (typeof window.icon === 'function') return window.icon(name, size || 'icon-sm');
    return '<i data-lucide="' + name + '"></i>';
  }

  function hasEmail(client) {
    if (!client) return false;
    var e = client.email;
    return !!(e && String(e).trim());
  }

  function bounceBadgeHTML(client) {
    if (!client) return '';
    if (client.email_bounced === true) {
      var rid = client.report_id || '';
      var bad = client.last_bounced_email ? String(client.last_bounced_email) : '';
      var reason = client.email_bounce_reason ? String(client.email_bounce_reason) : '';
      var when = client.email_bounce_at ? String(client.email_bounce_at) : '';
      var tipParts = ['כתובת מייל לא תקינה'];
      if (bad) tipParts.push(bad);
      if (reason) tipParts.push(reason);
      tipParts.push('לחץ לפרטים');
      var tip = _esc(tipParts.join(' · '));
      return (
        '<button type="button" class="bounce-warning-badge" ' +
        'data-report-id="' + _esc(rid) + '" ' +
        'data-bounce-email="' + _esc(bad) + '" ' +
        'data-bounce-reason="' + _esc(reason) + '" ' +
        'data-bounce-at="' + _esc(when) + '" ' +
        'onclick="event.stopPropagation(); openBounceModalFromButton(this)" ' +
        'title="' + tip + '" ' +
        'aria-label="כתובת מייל לא תקינה" ' +
        'style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:bold;cursor:pointer;border:none;margin-inline-start:8px;display:inline-flex;align-items:center;gap:4px;">' +
        _icon('alert-triangle', 'icon-xs') +
        '</button>'
      );
    }
    // Soft indicator for never-had-email clients (no pin, no stat-card alert).
    if (!hasEmail(client)) {
      return (
        '<span class="no-email-indicator" ' +
        'title="אין כתובת מייל" ' +
        'aria-label="אין כתובת מייל" ' +
        'style="background:#f3f4f6;color:#6b7280;padding:2px 6px;border-radius:8px;font-size:11px;font-weight:normal;margin-inline-start:8px;display:inline-flex;align-items:center;gap:3px;">' +
        _icon('mail', 'icon-xs') +
        '</span>'
      );
    }
    return '';
  }

  function _formatBounceAt(v) {
    if (!v) return '—';
    try {
      var d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleString('he-IL');
    } catch (_) {
      return String(v);
    }
  }

  function openBounceModalFromButton(btn) {
    if (!btn) return;
    openBounceModal({
      reportId: btn.getAttribute('data-report-id') || '',
      lastBouncedEmail: btn.getAttribute('data-bounce-email') || '',
      reason: btn.getAttribute('data-bounce-reason') || '',
      at: btn.getAttribute('data-bounce-at') || '',
    });
  }

  function openBounceModal(arg) {
    // Back-compat: callers may still pass a reportId string. Prefer the data-attr object form.
    var reportId, lastBounced, reason, when;
    if (typeof arg === 'string') {
      reportId = arg;
      lastBounced = '';
      reason = '—';
      when = _formatBounceAt('');
    } else {
      reportId = (arg && arg.reportId) || '';
      lastBounced = (arg && arg.lastBouncedEmail) || '';
      reason = (arg && arg.reason) || '—';
      when = _formatBounceAt(arg && arg.at);
    }

    // Build/reuse a dedicated overlay so we don't fight #modal which uses textContent.
    var overlay = document.getElementById('bounceDetailModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'bounceDetailModal';
      overlay.className = 'ai-modal-overlay';
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeBounceModal();
      });
      document.body.appendChild(overlay);
    }

    overlay.innerHTML =
      '<div class="ai-modal-panel" style="max-width:480px">' +
        '<div class="ai-modal-panel-header">' +
          '<h3 style="margin:0;color:#991b1b;display:flex;align-items:center;gap:8px">' +
            _icon('alert-triangle', 'icon-md') +
            'כתובת מייל לא תקינה' +
          '</h3>' +
          '<button type="button" class="ai-modal-close" onclick="closeBounceModal()" aria-label="סגור">×</button>' +
        '</div>' +
        '<div class="ai-modal-panel-body">' +
          '<div style="display:grid;grid-template-columns:auto 1fr;gap:8px 12px;font-size:14px">' +
            '<div style="font-weight:600;color:var(--gray-600)">כתובת:</div>' +
            '<div style="word-break:break-all">' + _esc(lastBounced) + '</div>' +
            '<div style="font-weight:600;color:var(--gray-600)">סיבה:</div>' +
            '<div>' + _esc(reason) + '</div>' +
            '<div style="font-weight:600;color:var(--gray-600)">מועד:</div>' +
            '<div>' + _esc(when) + '</div>' +
          '</div>' +
          '<div style="margin-top:16px;padding:10px;background:#fef3c7;border-radius:6px;font-size:13px;color:#78350f">' +
            'יש לעדכן את כתובת המייל של הלקוח ולשלוח את השאלון מחדש.' +
          '</div>' +
        '</div>' +
        '<div class="ai-modal-panel-footer">' +
          '<button type="button" class="btn btn-primary" onclick="closeBounceModal(); openClientDetailModal(\'' + _esc(reportId) + '\', { focusField: \'email\' })">עריכת כתובת מייל</button>' +
          '<button type="button" class="btn btn-ghost" onclick="closeBounceModal()">סגור</button>' +
        '</div>' +
      '</div>';

    overlay.classList.add('show');
    if (typeof window.safeCreateIcons === 'function') window.safeCreateIcons(overlay);
  }

  function closeBounceModal() {
    var overlay = document.getElementById('bounceDetailModal');
    if (overlay) overlay.classList.remove('show');
  }

  function hasBouncedInStage1(clients) {
    if (!clients || !clients.length) return false;
    for (var i = 0; i < clients.length; i++) {
      var c = clients[i];
      if (c && c.is_active !== false && c.stage === 'Send_Questionnaire' && c.email_bounced === true) {
        return true;
      }
    }
    return false;
  }

  function sendQuestionnaireBtnHTML(client, rid) {
    if (!client) return '';
    var has = hasEmail(client);
    if (has) {
      return '<button class="action-btn send" onclick="sendSingle(\'' + _esc(rid) + '\')" title="שלח שאלון">' +
        _icon('send', 'icon-sm') + '</button>';
    }
    return '<button class="action-btn send" disabled aria-disabled="true" ' +
      'style="opacity:0.4;cursor:not-allowed" ' +
      'title="אין כתובת מייל">' +
      _icon('send', 'icon-sm') + '</button>';
  }

  /**
   * Filter a list of report_ids down to those whose client has a non-empty email.
   * Returns { sendable: [...], skipped: [...] } — caller can toast about skipped.
   */
  function filterClientsWithEmail(reportIds) {
    var clients = (typeof window.clientsData !== 'undefined' && window.clientsData) || [];
    var byId = {};
    for (var i = 0; i < clients.length; i++) {
      if (clients[i] && clients[i].report_id) byId[clients[i].report_id] = clients[i];
    }
    var sendable = [];
    var skipped = [];
    for (var j = 0; j < reportIds.length; j++) {
      var c = byId[reportIds[j]];
      if (c && hasEmail(c)) sendable.push(reportIds[j]);
      else skipped.push(reportIds[j]);
    }
    return { sendable: sendable, skipped: skipped };
  }

  /**
   * After an edit-client save, decide whether to prompt "Send questionnaire?"
   * Conditions: stage 1 + email was just changed to a non-empty value.
   */
  function shouldPromptResendOnSave(updated, prev) {
    if (!updated) return false;
    var newEmail = (updated.email || '').trim();
    var oldEmail = ((prev && prev.email) || '').trim();
    if (!newEmail) return false;
    if (newEmail === oldEmail) return false;
    // Stage check — read fresh from clientsData (the modal payload may not include stage).
    var clients = (typeof window.clientsData !== 'undefined' && window.clientsData) || [];
    var c = clients.find ? clients.find(function (x) { return x.report_id === updated.reportId; }) : null;
    if (!c) return false;
    return c.stage === 'Send_Questionnaire';
  }

  // Expose
  window.bounceBadgeHTML = bounceBadgeHTML;
  window.openBounceModal = openBounceModal;
  window.openBounceModalFromButton = openBounceModalFromButton;
  window.closeBounceModal = closeBounceModal;
  window.hasBouncedInStage1 = hasBouncedInStage1;
  window.hasEmail = hasEmail;
  window.sendQuestionnaireBtnHTML = sendQuestionnaireBtnHTML;
  window.filterClientsWithEmail = filterClientsWithEmail;
  window.shouldPromptResendOnSave = shouldPromptResendOnSave;
})();
