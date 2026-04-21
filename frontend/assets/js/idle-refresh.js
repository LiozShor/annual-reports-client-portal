// DL-321: Idle-refresh prompt — show refresh suggestion when tab returns to visible after N min hidden

(function () {
  'use strict';

  /**
   * Initialise the idle-refresh behaviour.
   * @param {Object} [options]
   * @param {number} [options.idleMs=300000] – ms hidden before offering a refresh (default 5 min)
   */
  window.initIdleRefresh = function initIdleRefresh(options) {
    // Guard: prevent double-init
    if (window.__idleRefreshInitialized) return;
    window.__idleRefreshInitialized = true;

    var idleMs = (options && options.idleMs != null) ? options.idleMs : 5 * 60 * 1000;
    var lastHiddenAt = null;

    function isModalOpen() {
      return !!document.querySelector(
        '.ai-modal-overlay:not([style*="display: none"]), ' +
        '.modal-overlay:not([style*="display: none"])'
      );
    }

    function isInputFocused() {
      var el = document.activeElement;
      if (!el) return false;
      var tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        el.getAttribute('contenteditable') === 'true'
      );
    }

    function maybePromptRefresh() {
      if (lastHiddenAt === null) return;
      var elapsed = Date.now() - lastHiddenAt;
      if (elapsed < idleMs) return;

      // Reset timer regardless of whether we show the dialog
      lastHiddenAt = null;

      // Skip if a modal is already open or user is typing
      if (isModalOpen() || isInputFocused()) return;

      // Skip silently if showConfirmDialog is not yet available (module race)
      if (typeof window.showConfirmDialog !== 'function') return;

      window.showConfirmDialog(
        'ייתכן שהנתונים אינם מעודכנים — לרענן?',
        function () { window.location.reload(); },
        'רענן',
        false
      );
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        lastHiddenAt = Date.now();
      } else if (document.visibilityState === 'visible') {
        maybePromptRefresh();
      }
    });
  };
}());
