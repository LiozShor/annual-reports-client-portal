/**
 * DL-410: Silent-refresh helpers for rental-contract operations.
 * Extracted from script.js to satisfy the monolith size ratchet.
 *
 * Exposed on window:
 *   - insertNewMissingDocAndRefresh(item, data)
 *       For + בקש חוזה. Inserts a new Required_Missing rental-contract doc.
 *   - insertReassignedDocAndRefresh(item, data, templateId, extras)
 *       For reassign-to-T901/T902 when the server creates a brand-new Received
 *       doc that isn't yet in local all_docs. Upsert by doc_record_id; computes
 *       name_short with MM.YYYY-MM.YYYY period from extras.contract_period.
 *
 * Both helpers re-render doc-tags pane, client row stats, and the AI-review card.
 */
(function () {
  'use strict';

  function rerender(clientName, item) {
    if (typeof window.refreshClientDocTags === 'function') window.refreshClientDocTags(clientName);
    if (typeof window.refreshClientRowStats === 'function') window.refreshClientRowStats(clientName);
    if (typeof window.refreshItemDom === 'function') window.refreshItemDom(item);
  }

  function periodLabel(cp) {
    if (!cp || !cp.startDate || !cp.endDate) return '';
    var sd = String(cp.startDate);
    var ed = String(cp.endDate);
    if (sd.length < 10 || ed.length < 10) return '';
    return sd.slice(5, 7) + '.' + sd.slice(0, 4) + '-' + ed.slice(5, 7) + '.' + ed.slice(0, 4);
  }

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
      rerender(item.client_name, item);
    } catch (e) {
      console.warn('[DL-410] silent refresh (missing) failed:', e);
    }
  }

  function insertReassignedDocAndRefresh(item, data, templateId, extras) {
    if (!item || !data || !data.doc_id) return;
    try {
      var period = periodLabel(extras && extras.contract_period);
      var base = data.matched_short_name || data.doc_title || '';
      var label = period ? base + ' ' + period : base;
      var arr = window.aiClassificationsData || [];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (c.client_name !== item.client_name) continue;
        c.all_docs = c.all_docs || [];
        var existing = null;
        for (var j = 0; j < c.all_docs.length; j++) {
          if (c.all_docs[j].doc_record_id === data.doc_id) { existing = c.all_docs[j]; break; }
        }
        if (existing) {
          existing.status = 'Received';
          existing.template_id = templateId;
          existing.name = label;
          existing.name_short = label;
        } else {
          c.all_docs.push({
            doc_record_id: data.doc_id,
            status: 'Received',
            template_id: templateId,
            name: label,
            name_short: label,
            category: 'rental',
            person: 'client',
          });
        }
        // Drop from missing_docs if present (it just became Received)
        if (Array.isArray(c.missing_docs)) {
          c.missing_docs = c.missing_docs.filter(function (d) { return d && d.doc_record_id !== data.doc_id; });
        }
      }
      rerender(item.client_name, item);
    } catch (e) {
      console.warn('[DL-410] silent refresh (reassign) failed:', e);
    }
  }

  window.insertNewMissingDocAndRefresh = insertNewMissingDocAndRefresh;
  window.insertReassignedDocAndRefresh = insertReassignedDocAndRefresh;
})();
