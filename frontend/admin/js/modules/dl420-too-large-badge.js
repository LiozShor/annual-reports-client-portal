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
