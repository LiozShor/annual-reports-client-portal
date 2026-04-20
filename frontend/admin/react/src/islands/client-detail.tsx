import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from '@/lib/queryClient'
import { ClientDetailModal } from '@/components/ClientDetailModal'
import type { ClientDetailContext } from '@/types/client'

// Import design-system CSS from the host admin panel
// These paths resolve relative to the HOST page (not bundled) — the host loads them separately.
// We do NOT import CSS here; the host page already loads admin CSS before this bundle.

interface MountProps {
  reportId: string
  ctx?: ClientDetailContext
}

const rootMap = new WeakMap<HTMLElement, ReturnType<typeof createRoot>>()

window.mountClientDetail = function (element: HTMLElement, props: MountProps): void {
  // Unmount any previous root on this element (idempotent)
  const existing = rootMap.get(element)
  if (existing) {
    existing.unmount()
  }

  function handleClose() {
    window.unmountClientDetail(element)
    props.ctx?.onClose?.()
  }

  const root = createRoot(element)
  rootMap.set(element, root)

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ClientDetailModal reportId={props.reportId} onClose={handleClose} />
        {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </StrictMode>
  )
}

window.unmountClientDetail = function (element: HTMLElement): void {
  const root = rootMap.get(element)
  if (root) {
    root.unmount()
    rootMap.delete(element)
    // Remove the element from the DOM if it's still attached
    element.remove()
  }
}
