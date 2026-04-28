/**
 * Bridge shim — delegates to React island (DL-306).
 * Public API preserved: openClientDetailModalShared + closeClientDetailModal
 * The React bundle (react-dist/client-detail.js) must load before this script.
 */

const CLIENT_DETAIL_CONTAINER_ID = 'react-client-detail-root'

// The React island renders `.ai-modal-overlay` without the `.show` class
// the static CSS (style.css L2820, document-manager.css L2440) requires.
// Force-show overlays inside the React root.
;(function injectReactModalCss() {
  if (document.getElementById('react-client-detail-modal-css')) return
  const s = document.createElement('style')
  s.id = 'react-client-detail-modal-css'
  // Force-show overlay (React doesn't add `.show`) AND alias the React island's
  // header/body/footer classes to the design-system panel-* equivalents so the
  // modal picks up the proper SSOT styling.
  s.textContent = [
    '#' + 'react-client-detail-root .ai-modal-overlay { display: flex !important; }',
    '#' + 'react-client-detail-root .ai-modal-header  { padding: var(--sp-6) var(--sp-6) 0; display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); font-size: var(--text-xl); font-weight: 700; color: var(--gray-800); }',
    '#' + 'react-client-detail-root .ai-modal-title   { margin: 0; font-size: inherit; font-weight: inherit; color: inherit; }',
    '#' + 'react-client-detail-root .ai-modal-close   { background: transparent; border: none; cursor: pointer; padding: var(--sp-2); font-size: 1.25rem; color: var(--gray-500); border-radius: var(--radius-md); }',
    '#' + 'react-client-detail-root .ai-modal-close:hover { background: var(--gray-100); color: var(--gray-800); }',
    '#' + 'react-client-detail-root .ai-modal-body    { padding: var(--sp-5) var(--sp-6); color: var(--gray-600); line-height: 1.7; }',
    '#' + 'react-client-detail-root .ai-modal-footer  { padding: 0 var(--sp-6) var(--sp-6); display: flex; gap: var(--sp-3); justify-content: flex-end; }',
  ].join('\n')
  document.head.appendChild(s)
})()

// Defensive: top-level `const` in shared/constants.js does NOT attach to
// window in some browser/CSP configs we're seeing in production. Force-set
// the globals the React bundle reads, using the lexical references that ARE
// available in this shim's scope. Safe no-op if already set.
function ensureReactBundleGlobals() {
  const before = {
    API_BASE: window.API_BASE,
    ADMIN_TOKEN_KEY: window.ADMIN_TOKEN_KEY,
    ENDPOINTS: !!window.ENDPOINTS,
  }
  try {
    if (typeof CF_BASE !== 'undefined' && !window.API_BASE) {
      window.API_BASE = CF_BASE
    }
    if (typeof ADMIN_TOKEN_KEY !== 'undefined' && !window.ADMIN_TOKEN_KEY) {
      window.ADMIN_TOKEN_KEY = ADMIN_TOKEN_KEY
    }
    if (typeof ENDPOINTS !== 'undefined' && !window.ENDPOINTS) {
      window.ENDPOINTS = Object.assign({}, ENDPOINTS, {
        adminUpdateClient: ENDPOINTS.ADMIN_UPDATE_CLIENT,
      })
    }
  } catch (e) {
    console.error('[client-detail-modal] ensureReactBundleGlobals threw', e)
  }
  console.log('[client-detail-modal] globals before:', before, 'after:', {
    API_BASE: window.API_BASE,
    ADMIN_TOKEN_KEY: window.ADMIN_TOKEN_KEY,
    ENDPOINTS: !!window.ENDPOINTS,
    GET_CLIENT_REPORTS: window.ENDPOINTS && window.ENDPOINTS.GET_CLIENT_REPORTS,
  })
}

function openClientDetailModalShared(reportId, ctx) {
  console.log('[client-detail-modal] open called for reportId:', reportId)
  ensureReactBundleGlobals()

  console.log('[client-detail-modal] mountClientDetail typeof:', typeof window.mountClientDetail)

  // Remove any stale root from a previous open
  closeClientDetailModal(true)

  const el = document.createElement('div')
  el.id = CLIENT_DETAIL_CONTAINER_ID
  document.body.appendChild(el)
  console.log('[client-detail-modal] container appended; in DOM:', !!document.getElementById(CLIENT_DETAIL_CONTAINER_ID))

  if (typeof window.mountClientDetail !== 'function') {
    console.error('[client-detail-modal] window.mountClientDetail is NOT a function — react-dist/client-detail.js failed to load or expose it')
    el.innerHTML = '<div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999"><div style="background:white;padding:24px;border-radius:8px">React bundle not loaded. Check console.</div></div>'
    return
  }

  try {
    window.mountClientDetail(el, {
      reportId,
      ctx: {
        onClose: () => closeClientDetailModal(true),
        onSaved: ctx?.onSaved ?? null,
      },
    })
    console.log('[client-detail-modal] mountClientDetail returned ok')
    setTimeout(() => {
      const overlay = el.querySelector('.ai-modal-overlay')
      console.log('[client-detail-modal] post-mount overlay:', !!overlay, 'children:', el.childElementCount, 'innerHTML.len:', el.innerHTML.length)
    }, 200)
  } catch (e) {
    console.error('[client-detail-modal] mountClientDetail threw', e)
  }
}

function closeClientDetailModal(skipDirtyCheck) {
  const el = document.getElementById(CLIENT_DETAIL_CONTAINER_ID)
  if (!el) return

  // skipDirtyCheck = true  → called from inside React's onClose callback (after
  //   the component has already run its own confirm dialog); safe to unmount.
  // skipDirtyCheck = false/undefined → called from outside (e.g. an external
  //   close button). In v1 the dirty-check lives entirely inside the React
  //   component and is only reachable via the in-modal ✕ button, so there is no
  //   clean way to trigger it from here. We force-unmount in both branches for
  //   now; a future iteration can expose a requestClose() handle on the root.
  window.unmountClientDetail(el)
}
