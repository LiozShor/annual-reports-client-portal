/**
 * DL-420 Phase 3 — "Too large" badge for the AI-Review preview pane.
 *
 * When a pending_classifications row was created via the DL-420 fallback path
 * for a Drive `too_large` reject, there's no OneDrive file to embed. Instead
 * of the generic "אין מזהה קובץ" error, show a tailored badge with the real
 * file size + a button to open the file in Drive or instruction to check the
 * original Outlook email.
 *
 * Exposes `window.renderDL420TooLargeBadge(item, errorMsgEl)`. Returns true
 * when the item is a DL-420 too_large fallback PC and the badge was applied;
 * caller falls through to the default error message otherwise.
 *
 * Kept out of script.js to stay under the monolith size ratchet.
 */
(function () {
    'use strict';

    function escAttr(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * For any PC whose attachment_name is the `drive_{id}.{ext}` placeholder
     * (pre-Phase-2 rows, or any future Drive smart-link attachment), inject a
     * "📂 פתח בדרייב" link into the preview header. The original Drive URL is
     * reconstructed from the embedded fileId. Idempotent — only adds once per
     * preview open.
     *
     * Helps the stale rows from before Content-Disposition parsing landed:
     * when SharePoint's preview can't render the file (because the bytes
     * don't match `.pdf`), the office clicks through to Drive instead.
     */
    var DRIVE_NAME_RE = /^drive_([A-Za-z0-9_-]{20,})\./;
    window.attachDL420DriveLink = function (item) {
        if (!item || !item.attachment_name) return;
        var m = DRIVE_NAME_RE.exec(item.attachment_name);
        if (!m) return;
        var header = document.getElementById('previewHeaderBar');
        if (!header) return;
        var existing = header.querySelector('.dl420-drive-link');
        if (existing) existing.remove();
        var a = document.createElement('a');
        a.className = 'dl420-drive-link';
        a.href = 'https://drive.google.com/file/d/' + encodeURIComponent(m[1]) + '/view';
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = 'פתח את הקובץ ב-Drive';
        a.style.cssText = 'margin-inline-start:var(--sp-2);padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;color:#2563eb;text-decoration:none;display:inline-block';
        a.textContent = '📂 פתח בדרייב';
        header.appendChild(a);
    };

    window.renderDL420TooLargeBadge = function (item, errorMsgEl) {
        if (!item || !errorMsgEl) return false;
        if (!item.ai_reason || !/^\[DL-420\]\s*Too large/i.test(item.ai_reason)) return false;

        var sizeMB = item.attachment_size ? Math.round(item.attachment_size / 1024 / 1024) : null;
        var sizeStr = sizeMB ? (sizeMB + ' MB') : 'גדול מאוד';
        var driveBtn = item.file_url
            ? '<a href="' + escAttr(item.file_url) + '" target="_blank" rel="noopener" class="btn btn-primary" style="margin-top:var(--sp-3);display:inline-block">📂 פתח בדרייב</a>'
            : '';

        errorMsgEl.innerHTML =
            '<div style="font-weight:600;color:var(--danger-700);margin-bottom:var(--sp-2)">🚫 קובץ גדול מדי (' + escHtml(sizeStr) + ')</div>'
            + '<div style="color:var(--gray-700)">הקובץ לא הורד למערכת בגלל גודלו. ניתן לפתוח אותו ישירות מ-Drive או באאוטלוק במייל המקורי.</div>'
            + driveBtn;
        return true;
    };
})();
