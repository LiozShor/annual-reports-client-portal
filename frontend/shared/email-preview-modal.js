/**
 * Shared Email Preview Modal Helper (DL-308)
 *
 * Read-only email preview modal used by both the admin PA card
 * (frontend/admin/js/script.js) and the doc-manager
 * (frontend/assets/js/document-manager.js) before the user clicks
 * approve-and-send.
 *
 * Reuses DL-289 iframe-in-box modal DOM/CSS classes (from
 * frontend/admin/css/style.css lines 3212-3238). No new CSS required.
 *
 * Exposed globally so classic <script> tags can use it:
 *   window.showEmailPreviewModal({ reportId, clientName, getToken, endpoint })
 *
 * `endpoint` is the full URL to the approve-and-send Worker route
 * (e.g. ENDPOINTS.APPROVE_AND_SEND). Helper appends `?report_id=...&preview=1`.
 */
(function () {
  'use strict';

  window.showEmailPreviewModal = async function ({ reportId, clientName, getToken, endpoint, extraPayload, actionLabel, onAction }) {
    // 1) Idempotency: close any pre-existing preview overlay first.
    const existing = document.querySelector('.ai-modal-overlay.email-preview-overlay');
    if (existing) {
      existing.remove();
    }
    if (window._emailPreviewKeyHandler) {
      document.removeEventListener('keydown', window._emailPreviewKeyHandler);
      window._emailPreviewKeyHandler = null;
    }

    // 2) Build DOM (RTL, Hebrew-first, reuses DL-289 classes).
    const safeName = (clientName == null ? '' : String(clientName));
    const overlay = document.createElement('div');
    overlay.className = 'ai-modal-overlay email-preview-overlay';
    overlay.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'ai-modal-panel email-preview-modal';
    panel.setAttribute('dir', 'rtl');
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.maxWidth = '900px';
    panel.style.width = '90vw';
    panel.style.height = '80vh';

    // Header: title on right (RTL start), close X on left (RTL end).
    const header = document.createElement('div');
    header.className = 'msg-compose-header';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.fontSize = '16px';
    title.textContent = `תצוגה מקדימה — ${safeName}`;

    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'סגור');
    closeX.textContent = '✕';
    closeX.style.background = 'transparent';
    closeX.style.border = 'none';
    closeX.style.fontSize = '20px';
    closeX.style.cursor = 'pointer';
    closeX.style.color = 'var(--text-secondary, #666)';
    closeX.style.padding = '4px 8px';
    closeX.style.lineHeight = '1';

    header.appendChild(title);
    header.appendChild(closeX);

    // Body
    const body = document.createElement('div');
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.alignItems = 'stretch';
    body.style.flex = '1 1 auto';
    body.style.minHeight = '0';
    body.style.padding = '16px';
    body.style.gap = '12px';

    // Subject line (selectable)
    const subjectRow = document.createElement('div');
    subjectRow.style.display = 'flex';
    subjectRow.style.gap = '8px';
    subjectRow.style.alignItems = 'baseline';
    subjectRow.style.flexWrap = 'wrap';
    const subjectLabel = document.createElement('span');
    subjectLabel.textContent = 'נושא:';
    subjectLabel.style.color = 'var(--text-secondary, #666)';
    const subjectSpan = document.createElement('span');
    subjectSpan.style.fontWeight = '700';
    subjectSpan.style.userSelect = 'text';
    subjectSpan.textContent = '—';
    subjectRow.appendChild(subjectLabel);
    subjectRow.appendChild(subjectSpan);

    // Iframe wrap + loading badge
    const wrap = document.createElement('div');
    wrap.className = 'msg-compose-preview-wrap';
    wrap.style.position = 'relative';
    wrap.style.flex = '1 1 auto';
    wrap.style.alignSelf = 'stretch';
    wrap.style.width = '100%';
    wrap.style.minHeight = '0';
    wrap.style.overflow = 'auto';
    wrap.style.background = '#fff';

    const iframe = document.createElement('iframe');
    iframe.className = 'msg-preview-iframe';
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('srcdoc', '');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.minHeight = '500px';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.style.background = '#fff';

    const loading = document.createElement('div');
    loading.className = 'msg-preview-loading';
    loading.textContent = 'טוען…';

    wrap.appendChild(iframe);
    wrap.appendChild(loading);

    body.appendChild(subjectRow);
    body.appendChild(wrap);

    // Footer
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.alignItems = 'center';
    footer.style.justifyContent = 'space-between';
    footer.style.padding = '12px 16px';
    footer.style.borderTop = '1px solid var(--border-color, #e5e7eb)';
    footer.style.gap = '12px';

    const hasAction = typeof onAction === 'function' && actionLabel;

    if (!hasAction) {
      // Read-only mode: hint + close button (original behavior)
      const hint = document.createElement('div');
      hint.textContent = 'זוהי תצוגה בלבד — המייל לא נשלח';
      hint.style.color = 'var(--text-secondary, #666)';
      hint.style.fontSize = '13px';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn btn-secondary';
      closeBtn.textContent = 'סגור';

      footer.appendChild(hint);
      footer.appendChild(closeBtn);

      // closeBtn wired below via the shared close() reference after it's defined
      footer._closeBtn = closeBtn;
    } else {
      // Action mode: error bar (hidden) + cancel + primary action button
      const errorBar = document.createElement('div');
      errorBar.style.display = 'none';
      errorBar.style.color = '#b91c1c';
      errorBar.style.background = '#fee2e2';
      errorBar.style.border = '1px solid #fca5a5';
      errorBar.style.borderRadius = '6px';
      errorBar.style.padding = '8px 12px';
      errorBar.style.fontSize = '13px';
      errorBar.style.flex = '1 1 auto';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'ביטול';

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'btn btn-primary';
      actionBtn.textContent = actionLabel;

      const btnWrap = document.createElement('div');
      btnWrap.style.display = 'flex';
      btnWrap.style.gap = '8px';
      btnWrap.style.alignItems = 'center';

      btnWrap.appendChild(cancelBtn);
      btnWrap.appendChild(actionBtn);

      footer.appendChild(errorBar);
      footer.appendChild(btnWrap);

      footer._cancelBtn = cancelBtn;
      footer._actionBtn = actionBtn;
      footer._errorBar = errorBar;
    }

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Reveal: same pattern as DL-289 (flip display then add .show next frame).
    requestAnimationFrame(() => {
      overlay.style.display = '';
      overlay.classList.add('show');
      try { closeX.focus(); } catch (e) { /* noop */ }
    });

    // 4) Close wiring
    function close() {
      overlay.classList.remove('show');
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (window._emailPreviewKeyHandler) {
        document.removeEventListener('keydown', window._emailPreviewKeyHandler);
        window._emailPreviewKeyHandler = null;
      }
    }

    closeX.addEventListener('click', close);
    if (footer._closeBtn) {
      footer._closeBtn.addEventListener('click', close);
    }
    if (footer._cancelBtn) {
      footer._cancelBtn.addEventListener('click', close);
    }
    if (footer._actionBtn) {
      footer._actionBtn.addEventListener('click', async function () {
        const actionBtn = footer._actionBtn;
        const errorBar = footer._errorBar;

        // Disable + spinner text
        actionBtn.disabled = true;
        actionBtn.textContent = 'שולח...';
        errorBar.style.display = 'none';

        try {
          await onAction();
          // Success: replace modal body with success state
          body.innerHTML = '';
          body.style.alignItems = 'center';
          body.style.justifyContent = 'center';
          body.innerHTML = `<div style="text-align:center;padding:32px 16px;">
            <div style="font-size:48px;color:#16a34a;margin-bottom:12px;">✓</div>
            <div style="font-size:18px;font-weight:600;color:#16a34a;">הבקשה נשלחה ללקוח</div>
          </div>`;
          footer.style.display = 'none';
          setTimeout(function () { close(); }, 1200);
        } catch (err) {
          // Error: show inline error bar, re-enable button
          errorBar.textContent = err && err.message ? err.message : 'אירעה שגיאה, נסה שנית';
          errorBar.style.display = 'block';
          actionBtn.disabled = false;
          actionBtn.textContent = actionLabel;
        }
      });
    }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    window._emailPreviewKeyHandler = function (e) {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', window._emailPreviewKeyHandler);

    // 3) Fetch + render
    function renderError(msg) {
      wrap.innerHTML = `<div class="email-preview-error" style="padding:20px;color:var(--danger-600,#b91c1c)">שגיאה בטעינת התצוגה: ${msg}</div>`;
    }

    try {
      let resp;
      if (extraPayload) {
        resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ report_id: reportId, preview: true, ...extraPayload }),
        });
      } else {
        const sep = endpoint.indexOf('?') === -1 ? '?' : '&';
        const url = `${endpoint}${sep}report_id=${encodeURIComponent(reportId)}&preview=1`;
        resp = await fetch(url, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
      }
      let data = {};
      try { data = await resp.json(); } catch (_) { data = {}; }

      if (!resp.ok || !data.ok) {
        renderError(data.error || resp.status);
        return;
      }

      subjectSpan.textContent = data.subject || '';
      iframe.setAttribute('srcdoc', data.html || '');
      loading.style.display = 'none';
    } catch (err) {
      wrap.innerHTML = `<div class="email-preview-error" style="padding:20px;color:var(--danger-600,#b91c1c)">שגיאה בתקשורת עם השרת</div>`;
    }
  };
})();
