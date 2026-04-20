/**
 * Bridge shim — delegates to React island (DL-306).
 * Public API preserved: openClientDetailModalShared + closeClientDetailModal
 * The React bundle (react-dist/client-detail.js) must load before this script.
 */

const CLIENT_DETAIL_CONTAINER_ID = 'react-client-detail-root'

function openClientDetailModalShared(reportId, ctx) {
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
