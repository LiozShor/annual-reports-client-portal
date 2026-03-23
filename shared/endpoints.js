/* ===========================================
   SHARED ENDPOINTS — Centralized Webhook URLs
   Depends on: shared/constants.js (API_BASE)

   Migration: Endpoints are being migrated from n8n Cloud to
   Cloudflare Workers for lower latency (DL-169).
   To switch an endpoint to the Worker, change its base URL:
     const CF_BASE = 'https://annual-reports-api.liozshor1.workers.dev/webhook';
   Then replace API_BASE with CF_BASE for that endpoint.
   Keep non-migrated endpoints on API_BASE (n8n).
   =========================================== */

const CF_BASE = 'https://annual-reports-api.liozshor1.workers.dev/webhook';

const ENDPOINTS = {
    // --- Auth (migrated to Cloudflare Workers — DL-169) ---
    ADMIN_AUTH:                `${CF_BASE}/admin-auth`,
    ADMIN_VERIFY:              `${CF_BASE}/admin-verify`,

    // --- Dashboard (migrated to Cloudflare Workers — DL-170) ---
    ADMIN_DASHBOARD:           `${CF_BASE}/admin-dashboard`,
    ADMIN_PENDING:             `${CF_BASE}/admin-pending`,

    // --- Client management (migrated to Cloudflare Workers — DL-171) ---
    ADMIN_UPDATE_CLIENT:       `${CF_BASE}/admin-update-client`,
    ADMIN_TOGGLE_ACTIVE:       `${CF_BASE}/admin-toggle-active`,
    ADMIN_BULK_IMPORT:         `${CF_BASE}/admin-bulk-import`,

    // --- Stage & workflow (migrated to Cloudflare Workers — DL-171) ---
    ADMIN_CHANGE_STAGE:        `${CF_BASE}/admin-change-stage`,
    ADMIN_MARK_COMPLETE:       `${CF_BASE}/admin-mark-complete`,
    ADMIN_YEAR_ROLLOVER:       `${CF_BASE}/admin-year-rollover`,

    // --- Questionnaires ---
    ADMIN_SEND_QUESTIONNAIRES: `${API_BASE}/admin-send-questionnaires`,
    ADMIN_QUESTIONNAIRES:      `${CF_BASE}/admin-questionnaires`,
    CHECK_EXISTING_SUBMISSION: `${CF_BASE}/check-existing-submission`,
    RESET_SUBMISSION:          `${CF_BASE}/reset-submission`,

    // --- Documents ---
    GET_CLIENT_DOCUMENTS:      `${API_BASE}/get-client-documents`,
    EDIT_DOCUMENTS:            `${API_BASE}/edit-documents`,
    APPROVE_AND_SEND:          `${API_BASE}/approve-and-send`,
    GET_PREVIEW_URL:           `${API_BASE}/get-preview-url`,

    // --- Classification ---
    GET_PENDING_CLASSIFICATIONS: `${API_BASE}/get-pending-classifications`,
    REVIEW_CLASSIFICATION:     `${API_BASE}/review-classification`,

    // --- Notifications ---
    SEND_BATCH_STATUS:         `${API_BASE}/send-batch-status`,
    ADMIN_REMINDERS:           `${API_BASE}/admin-reminders`
};
