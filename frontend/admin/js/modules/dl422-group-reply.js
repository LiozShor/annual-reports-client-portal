/**
 * DL-422 — Group-header reply for "הודעות אחרונות מלקוחות".
 *
 * DL-396 follow-up renders only `g.messages.slice(1)` inside `.msg-group-older`,
 * so the latest message of a multi-message group has no `.msg-row` in the DOM.
 * The group header 💬 button used to call `showReplyInput(latestNoteId, …)`,
 * which `querySelector('.msg-row[data-note-id=…]')` → null → silent return
 * (looked "stuck" to the user).
 *
 * This module exposes `window.showGroupReply(clientKey, noteId, reportId)`:
 *  - Second click while a reply zone is open → closes it (toggle).
 *  - Else: auto-expands the group, synthesizes the latest msg-row via the
 *    existing `_renderMessageRowHtml`, prepends it inside `.msg-group-older`,
 *    and delegates to `showReplyInput` with the synthesized row as containerEl.
 *
 * Kept out of script.js to stay under the monolith size ratchet.
 */
(function () {
    'use strict';

    function showGroupReply(clientKey, noteId, reportId) {
        const groupEl = document.querySelector(`.msg-group[data-client-key="${CSS.escape(clientKey)}"]`);
        if (!groupEl) return;
        const existingZone = groupEl.querySelector('.msg-reply-zone');
        if (existingZone) {
            const parentRow = existingZone.closest('.msg-row');
            existingZone.remove();
            if (parentRow) parentRow.classList.remove('expanded');
            return;
        }
        groupEl.classList.add('expanded');
        if (window._expandedClients) window._expandedClients.add(clientKey);
        const olderEl = groupEl.querySelector('.msg-group-older');
        if (!olderEl) return;
        let latestRow = olderEl.querySelector(`.msg-row[data-note-id="${CSS.escape(noteId)}"]`);
        if (!latestRow) {
            const latestMsg = window._findRecentMessage ? window._findRecentMessage(noteId) : null;
            if (!latestMsg) return;
            const tmp = document.createElement('div');
            tmp.innerHTML = window._renderMessageRowHtml(latestMsg);
            latestRow = tmp.firstElementChild;
            olderEl.prepend(latestRow);
            if (window.safeCreateIcons) window.safeCreateIcons(latestRow);
        }
        window.showReplyInput(noteId, reportId, latestRow);
    }

    window.showGroupReply = showGroupReply;
})();
