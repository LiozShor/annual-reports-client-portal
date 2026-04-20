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

  window.showEmailPreviewModal = async function ({ reportId, clientName, getToken, endpoint }) {
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
    body.style.flex = '1';
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
    wrap.style.flex = '1';
    wrap.style.minHeight = '0';

    const iframe = document.createElement('iframe');
    iframe.className = 'msg-preview-iframe';
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('srcdoc', '');

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
    closeBtn.addEventListener('click', close);
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
      const sep = endpoint.indexOf('?') === -1 ? '?' : '&';
      const url = `${endpoint}${sep}report_id=${encodeURIComponent(reportId)}&preview=1`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
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
