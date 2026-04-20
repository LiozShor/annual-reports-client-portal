import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Stub window globals that the React island delegates to vanilla JS
window.showConfirmDialog = vi.fn((_msg, onConfirm) => {
  // By default auto-confirm in tests; override per-test as needed
  onConfirm?.()
})

window.showAIToast = vi.fn()

window.showModal = vi.fn()

// Minimal ENDPOINTS stub — add entries as needed in individual tests
window.ENDPOINTS = {
  getClientReports: '/webhook/get-client-reports',
  editClient: '/webhook/admin-update-client',
  adminUpdateClient: '/webhook/admin-update-client',
} as typeof window.ENDPOINTS

// Minimal constants
window.ADMIN_TOKEN_KEY = 'admin_auth_token'
window.API_BASE = 'http://localhost:8787/webhook'
