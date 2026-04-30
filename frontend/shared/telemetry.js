/**
 * DL-365 Phase 3 — frontend telemetry helper.
 *
 * Queues UI events and flushes them to POST /webhook/events using
 * fetch keepalive so the beacon survives page unload.
 *
 * Usage:
 *   window.logUiEvent('tab_switch', { tab: 'dashboard' })
 *
 * Auth: reads ADMIN_TOKEN_KEY from localStorage (set by admin login).
 * Best-effort: all errors are swallowed.
 */
(function () {
  'use strict';

  // Max queue size before an automatic flush
  const MAX_QUEUE = 32;

  const _queue = [];
  let _flushScheduled = false;

  function getAdminToken() {
    try {
      const key = (typeof ADMIN_TOKEN_KEY !== 'undefined') ? ADMIN_TOKEN_KEY : 'admin_token';
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  function getApiBase() {
    try {
      return (typeof window.API_BASE !== 'undefined')
        ? window.API_BASE.replace(/\/webhook$/, '') // strip trailing /webhook if present
        : '';
    } catch {
      return '';
    }
  }

  function flush() {
    _flushScheduled = false;
    if (_queue.length === 0) return;

    const token = getAdminToken();
    if (!token) {
      _queue.length = 0; // no auth → discard
      return;
    }

    const events = _queue.splice(0);
    const base = getApiBase();
    const url = base ? base + '/webhook/events' : '/webhook/events';

    try {
      fetch(url, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ events }),
      }).catch(function () { /* best-effort */ });
    } catch {
      // swallow
    }
  }

  function scheduleFlush() {
    if (_flushScheduled) return;
    _flushScheduled = true;
    // Batch up micro-events within the same JS task
    setTimeout(flush, 0);
  }

  /**
   * logUiEvent(type, details?)
   * type    — event_type string matching the taxonomy (e.g. 'tab_switch')
   * details — optional object with extra context
   */
  function logUiEvent(type, details) {
    if (typeof type !== 'string' || !type) return;
    try {
      _queue.push({
        event_type: type,
        category: 'ADMIN',
        source: 'admin-ui',
        ts: new Date().toISOString(),
        details: details || undefined,
      });
      if (_queue.length >= MAX_QUEUE) {
        flush();
      } else {
        scheduleFlush();
      }
    } catch {
      // never throw
    }
  }

  // Flush remaining events on page hide (most reliable unload hook)
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
  } catch { /* swallow */ }

  // Expose globally
  window.logUiEvent = logUiEvent;
  window._telemetryFlush = flush; // exposed for testing
})();
