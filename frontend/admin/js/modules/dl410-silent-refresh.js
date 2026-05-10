/**
 * DL-410: Silent-refresh helpers for + בקש חוזה (request-remaining-contract).
 * Extracted from script.js to satisfy the monolith size ratchet.
 *
 * Exposed on window:
 *   - insertNewMissingDocAndRefresh(item, data)
 *       Inserts a new Required_Missing rental-contract doc into local
 *       aiClassificationsData state for the affected client, then re-renders
 *       the doc-tags pane, client row stats, and the source AI-review card.
 */
(function () {
  'use strict';

  function insertNewMissingDocAndRefresh(item, data) {
    if (!item || !data || !data.doc_id) return;
    try {
      var nd = {
        doc_record_id: data.doc_id,
        status: 'Required_Missing',
        template_id: item.matched_template_id,
        name: data.doc_title,
        name_short: data.doc_title,
        category: 'rental',
        person: 'client',
      };
      var arr = window.aiClassificationsData || [];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (c.client_name !== item.client_name) continue;
        (c.all_docs = c.all_docs || []).push(nd);
        (c.missing_docs = c.missing_docs || []).push(nd);
      }
      if (typeof window.refreshClientDocTags === 'function') window.refreshClientDocTags(item.client_name);
      if (typeof window.refreshClientRowStats === 'function') window.refreshClientRowStats(item.client_name);
      if (typeof window.refreshItemDom === 'function') window.refreshItemDom(item);
    } catch (e) {
      console.warn('[DL-410] silent refresh failed:', e);
    }
  }

  window.insertNewMissingDocAndRefresh = insertNewMissingDocAndRefresh;
})();
