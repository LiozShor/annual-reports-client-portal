/**
 * Bridge shim — delegates to React island (DL-306).
 * Public API preserved: openClientDetailModalShared + closeClientDetailModal
 * The React bundle (react-dist/client-detail.js) must load before this script.
 */

const CLIENT_DETAIL_CONTAINER_ID = 'react-client-detail-root'

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

  // Remove any stale root from a previous open
  closeClientDetailModal(true)

  const el = document.createElement('div')
  el.id = CLIENT_DETAIL_CONTAINER_ID
  document.body.appendChild(el)

  window.mountClientDetail(el, {
    reportId,
    ctx: {
      onClose: () => closeClientDetailModal(true),
      onSaved: ctx?.onSaved ?? null,
    },
  })
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
