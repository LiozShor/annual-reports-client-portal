import type { ClientDetailContext } from './client'

export {}

declare global {
  // From frontend/shared/constants.js
  const API_BASE: string
  const ADMIN_TOKEN_KEY: string
  const STAGES: Record<string, { label: string; num: number }>

  // From frontend/shared/endpoints.js — partial; add entries as used
  const ENDPOINTS: {
    getClientReports: string
    editClient: string
    adminUpdateClient: string
    [key: string]: string
  }

  // From frontend/admin/js/error-handler.js + UI design system
  function showAIToast(message: string, type?: 'success' | 'error' | 'info'): void
  function showConfirmDialog(
    message: string,
    onConfirm: (() => void) | null,
    confirmLabel?: string,
    danger?: boolean
  ): void
  function showModal(type: string, title: string, body: string, stats?: unknown): void

  // Island bridge — defined by the island entry itself
  function mountClientDetail(
    element: HTMLElement,
    props: { reportId: string; ctx?: ClientDetailContext }
  ): void
  function unmountClientDetail(element: HTMLElement): void
}
