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
    ADMIN_RECENT_MESSAGES:     `${CF_BASE}/admin-recent-messages`,
    ADMIN_SEND_COMMENT:        `${CF_BASE}/admin-send-comment`,
    ADMIN_COMMENT_PREVIEW:     `${CF_BASE}/admin-comment-preview`,
    ADMIN_QUEUED_EMAILS:       `${CF_BASE}/admin-queued-emails`,

    // --- Client management (migrated to Cloudflare Workers — DL-171) ---
    ADMIN_UPDATE_CLIENT:       `${CF_BASE}/admin-update-client`,
    ADMIN_TOGGLE_ACTIVE:       `${CF_BASE}/admin-toggle-active`,
    ADMIN_BULK_IMPORT:         `${CF_BASE}/admin-bulk-import`,

    // --- Stage & workflow (migrated to Cloudflare Workers — DL-171) ---
    ADMIN_CHANGE_STAGE:        `${CF_BASE}/admin-change-stage`,
    ADMIN_MARK_COMPLETE:       `${CF_BASE}/admin-mark-complete`,
    ADMIN_YEAR_ROLLOVER:       `${CF_BASE}/admin-year-rollover`,

    // --- Questionnaires ---
    ADMIN_SEND_QUESTIONNAIRES: `${CF_BASE}/admin-send-questionnaires`,
    ADMIN_QUESTIONNAIRES:      `${CF_BASE}/admin-questionnaires`,
    ADMIN_ASSISTED_LINK:       `${CF_BASE}/admin-assisted-link`,
    CHECK_EXISTING_SUBMISSION: `${CF_BASE}/check-existing-submission`,
    RESET_SUBMISSION:          `${CF_BASE}/reset-submission`,

    // --- Documents (migrated — DL-172, DL-174) ---
    GET_CLIENT_DOCUMENTS:      `${CF_BASE}/get-client-documents`,
    EDIT_DOCUMENTS:            `${CF_BASE}/edit-documents`,
    UPLOAD_DOCUMENT:           `${CF_BASE}/upload-document`,
    APPROVE_AND_SEND:          `${CF_BASE}/approve-and-send`,
    GET_PREVIEW_URL:           `${CF_BASE}/get-preview-url`,

    // --- Classification (migrated to Cloudflare Workers — DL-173) ---
    GET_PENDING_CLASSIFICATIONS: `${CF_BASE}/get-pending-classifications`,
    REVIEW_CLASSIFICATION:     `${CF_BASE}/review-classification`,
    DISMISS_CLASSIFICATIONS:   `${CF_BASE}/dismiss-classifications`,

    // --- Notifications (migrated to Cloudflare Workers — DL-174, hybrid) ---
    ADMIN_REMINDERS:           `${CF_BASE}/admin-reminders`,

    // --- Chat (DL-179) ---
    ADMIN_CHAT:                `${CF_BASE}/admin-chat`,
    ADMIN_SEND_FEEDBACK:       `${CF_BASE}/admin-send-feedback`,

    // --- Client reports (DL-218) ---
    GET_CLIENT_REPORTS:        `${CF_BASE}/get-client-reports`,
};
