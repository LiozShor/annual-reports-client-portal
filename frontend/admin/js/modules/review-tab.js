/**
 * Review tab (מוכנים להכנה) — pagination + search + days→months helper.
 * Extracted from script.js to satisfy the monolith size ratchet.
 *
 * Exposed on window:
 *   - reviewState                     -> { page, search, queueCache }
 *   - goToReviewPage(p)
 *   - onReviewSearchInput(v)
 *   - clearReviewSearch()
 *   - filterReviewQueue(queue)        -> queue (filtered by current search)
 *   - paginateReviewQueue(queue, pageSize) -> { slice, fifoOffset, totalItems }
 *   - formatWaiting(diffDays)         -> Hebrew text ("היום" / "יום אחד" / "N ימים" / months)
 */
(function () {
  'use strict';

  var state = { page: 1, search: '', queueCache: [] };

  function goToReviewPage(p) {
    state.page = p;
    if (typeof window.renderReviewTable === 'function') window.renderReviewTable(state.queueCache);
  }

  function onReviewSearchInput(v) {
    state.search = (v || '').trim();
    state.page = 1;
    var btn = document.getElementById('reviewSearchClear');
    if (btn) btn.style.display = state.search ? 'inline-block' : 'none';
    if (typeof window.renderReviewTable === 'function') window.renderReviewTable(state.queueCache);
  }

  function clearReviewSearch() {
    var input = document.getElementById('reviewSearchInput');
    if (input) input.value = '';
    onReviewSearchInput('');
  }

  function filterReviewQueue(queue) {
    if (!state.search || !queue) return queue;
    var q = state.search.toLowerCase();
    return queue.filter(function (c) {
      return (c.name && c.name.toLowerCase().indexOf(q) !== -1) ||
             (c.email && c.email.toLowerCase().indexOf(q) !== -1);
    });
  }

  function paginateReviewQueue(queue, pageSize) {
    var totalItems = queue.length;
    var totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (state.page > totalPages) state.page = 1;
    var fifoOffset = (state.page - 1) * pageSize;
    var slice = queue.slice(fifoOffset, fifoOffset + pageSize);
    return { slice: slice, fifoOffset: fifoOffset, totalItems: totalItems, page: state.page };
  }

  function formatWaiting(diffDays) {
    if (diffDays === 0) return 'היום';
    if (diffDays === 1) return 'יום אחד';
    if (diffDays <= 31) return diffDays + ' ימים';
    var m = Math.floor(diffDays / 30);
    if (m === 1) return 'חודש';
    if (m === 2) return 'חודשיים';
    return m + ' חודשים';
  }

  window.reviewState = state;
  window.goToReviewPage = goToReviewPage;
  window.onReviewSearchInput = onReviewSearchInput;
  window.clearReviewSearch = clearReviewSearch;
  window.filterReviewQueue = filterReviewQueue;
  window.paginateReviewQueue = paginateReviewQueue;
  window.formatWaiting = formatWaiting;
})();
