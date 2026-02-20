# Error Handling Audit — Annual Reports Client Portal

**Audit Date:** 2026-02-20
**Files Audited:** 8 files (3 HTML pages + 3 JS files + admin HTML + admin JS)

---

## File 1: `index.html` + `assets/js/landing.js`

**Purpose:** Landing page — checks for existing submission, offers language selection or existing-process options (view docs / reset & start over).

### A) Network/API Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| L1 | `checkExistingSubmission` fetch fails (network error) | Catches error, shows Hebrew-only error via `t('err_loading')` | :yellow_circle: Poor | No English fallback. No retry button. Generic message. |
| L2 | `checkExistingSubmission` returns HTTP 4xx/5xx | `throw new Error('HTTP ${status}')` caught by generic catch | :yellow_circle: Poor | User sees same generic message for 404 vs 500. No distinction. |
| L3 | `checkExistingSubmission` response is not valid JSON | `response.json()` throws, caught by generic catch | :yellow_circle: Poor | Same generic error. |
| L4 | `resetAndContinue` fetch fails (network error) | Catches error, shows `t('err_reset')` | :yellow_circle: Poor | No retry. Previous UI destroyed (replaced with loading). No way back. |
| L5 | `resetAndContinue` returns HTTP error | Same as L4 | :yellow_circle: Poor | |
| L6 | No timeout on either fetch call | Nothing — infinite spinner possible | :red_circle: Critical | If n8n is hung, user stares at skeleton/spinner forever. |
| L7 | n8n server completely down (DNS/connection refused) | `fetch()` throws `TypeError`, caught by generic catch | :yellow_circle: Poor | Generic message, no recovery path. |
| L8 | CORS error | `fetch()` throws, caught by generic catch | :yellow_circle: Poor | Error message will be misleading (appears as load error). |

### B) Data/Validation Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| L9 | Missing URL params (`report_id`, `client_id`, `year`, `token`) | Shows `t('err_missing_params')` — Hebrew-only error | :yellow_circle: Poor | No English version. No instructions on how to get the correct link. |
| L10 | `data.ok === false` from API | Shows "Invalid link or report not found. Please contact the office." | :green_circle: Acceptable | English-only though; should be bilingual. |
| L11 | Base64 decode fails for Hebrew strings | Returns empty string silently (line 48-49) | :yellow_circle: Poor | UI shows blank text where Hebrew should be. User sees broken page. |
| L12 | API returns unexpected data shape (no `stage`, no `document_count`) | Defaults used (`stage || '1-Send_Questionnaire'`, `docCount || 0`) | :green_circle: Acceptable | Defensive defaults in place. |

### C) Client-Side Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| L13 | JavaScript fails to load/execute | Blank page — skeleton remains visible but never resolves | :red_circle: Critical | No `<noscript>` fallback. User sees skeleton forever. |
| L14 | Lucide icons library fails to load (CDN down) | Icons show as empty elements, text still readable | :green_circle: Acceptable | `typeof lucide !== 'undefined'` guard exists. |
| L15 | Tally form redirect URL is malformed | Redirects to Tally with bad params — Tally's problem | :green_circle: Acceptable | |

### D) User Flow Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| L16 | Double-click on "Delete & Start Over" button | `closeResetModal()` then `resetAndContinue()` — could fire twice if fast enough | :yellow_circle: Poor | No click debounce. Button not disabled after first click. |
| L17 | User clicks reset, it fails, wants to try again | Error state shown with no retry button | :red_circle: Critical | Dead end. Only option is reload entire page. |
| L18 | User clicks "View Documents" with stale report_id | Redirects to `view-documents.html` — error handled there | :green_circle: Acceptable | |

---

## File 2: `view-documents.html` + `assets/js/view-documents.js`

**Purpose:** Client-facing document list viewer — shows required documents grouped by category with status badges and progress bar.

### A) Network/API Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| V1 | `loadDocuments` fetch fails (network error) | `console.error` + `showError('Error loading documents / ...')` | :yellow_circle: Poor | No retry button. Loading spinner NOT hidden (line 88-91 only hits if response succeeds). |
| V2 | `loadDocuments` returns HTTP error | `throw new Error('Failed to load documents')` | :yellow_circle: Poor | Same generic bilingual string regardless of status code. |
| V3 | No timeout on fetch | Infinite spinner possible | :red_circle: Critical | Same issue as landing page. |
| V4 | n8n server down | Same generic error | :yellow_circle: Poor | |

### B) Data/Validation Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| V5 | Missing `report_id` URL parameter | `showError('Missing report ID / ...')` | :green_circle: Acceptable | Bilingual error shown. |
| V6 | `data.ok === false` | Shows `data.error` or generic bilingual fallback | :green_circle: Acceptable | |
| V7 | Empty document list (`document_count === 0`) | Shows success message "All documents received!" | :green_circle: Acceptable | |
| V8 | Missing `client_name` or `year` in data | Falls back to empty string | :yellow_circle: Poor | Subtitle shows " . Tax Year " with empty name. Not great UX. |

### C) Client-Side Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| V9 | JavaScript fails to load | Loading spinner + text shown, never resolves | :red_circle: Critical | No `<noscript>` fallback. |
| V10 | XSS via document names | `docName` rendered as innerHTML (intentional for `<b>` tags from SSOT) | :yellow_circle: Poor | API must be trusted. No sanitization. |

### D) User Flow Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| V11 | User switches language during load | Language toggle hidden until results load | :green_circle: Acceptable | |
| V12 | Loading spinner not hidden on fetch error | `loading.style.display = 'none'` only inside try block (line 48) | :red_circle: Critical | If fetch fails, both loading spinner AND error are visible. |

---

## File 3: `document-manager.html` + `assets/js/document-manager.js`

**Purpose:** Office staff document editor — list docs, mark waived, add from dropdown, notes, status changes.

### A) Network/API Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| D1 | `loadDocuments` fetch fails | `showAlert('...', 'error')` — alert auto-dismisses after 5s | :yellow_circle: Poor | Alert disappears. Loading spinner stays visible. No retry. |
| D2 | `loadDocuments` returns non-JSON | `response.json()` throws, caught by generic catch | :yellow_circle: Poor | Same transient alert. |
| D3 | `confirmSubmit` POST fails | `showAlert('...', 'error')` | :yellow_circle: Poor | User's edits are preserved (good), but no indication of what went wrong. |
| D4 | `confirmSendQuestionnaire` POST fails | Uses `alert()` for errors | :yellow_circle: Poor | Native alert is jarring. Token error uses `alert()`. |
| D5 | No timeout on ANY fetch call | Infinite states possible | :red_circle: Critical | |
| D6 | `loadDocuments` returns data but `response.json()` fails | Caught by generic catch | :yellow_circle: Poor | |

### B) Data/Validation Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| D7 | Missing REPORT_ID (null/undefined/string 'null') | Shows "Not Started" view | :green_circle: Acceptable | Handles 'null' and 'undefined' strings (line 85). |
| D8 | Stage 1 with no documents | Shows "Not Started" view | :green_circle: Acceptable | |
| D9 | No changes when clicking "Save" | Shows validation alert "No changes" | :green_circle: Acceptable | |
| D10 | Empty detail value when adding template doc | Shows alert "Enter required details" | :green_circle: Acceptable | |
| D11 | Duplicate document addition | Shows alert "Already in list" | :green_circle: Acceptable | |
| D12 | Missing CLIENT_NAME or YEAR params | Shows "-" in client bar | :yellow_circle: Poor | Confusing but not broken. |

### C) Client-Side Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| D13 | JavaScript fails | Loading spinner + "Loading documents..." forever | :red_circle: Critical | No `<noscript>`. |
| D14 | `localStorage` unavailable | `confirmSendQuestionnaire` will fail silently (token = null) | :yellow_circle: Poor | Shows "Permission error" but uses `alert()`. |

### D) User Flow Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| D15 | Double-click "Save Changes" button | No protection — could submit twice | :red_circle: Critical | Confirmation modal closes before POST. Button is re-clickable. |
| D16 | Submit fails, user can't see what happened | Alert auto-dismisses in 5s | :yellow_circle: Poor | If user scrolls down, they miss the alert entirely. |
| D17 | User reloads after successful submit | Success view disappears, page tries to reload docs | :green_circle: Acceptable | |
| D18 | Loading spinner stays visible on fetch error | `loading.style.display = 'none'` only in try block (line 147) | :red_circle: Critical | Same bug as view-documents. |

---

## File 4: `admin/index.html` + `admin/js/script.js`

**Purpose:** Admin portal — dashboard, client management, questionnaire sending, review queue, AI review.

### A) Network/API Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| A1 | `login()` fetch fails | Shows "Connection error" in Hebrew (overwrites password error div) | :yellow_circle: Poor | No retry. Loading overlay hidden. |
| A2 | `checkAuth()` fails (token verification) | Silent fail — stays on login screen | :green_circle: Acceptable | Reasonable for token check. |
| A3 | `loadDashboard()` fetch fails (non-silent) | Shows modal "Cannot load data" | :yellow_circle: Poor | No retry button in modal. Modal must be manually closed. |
| A4 | `loadDashboard()` fetch fails (silent/background) | `console.error` only | :green_circle: Acceptable | Silent refresh, expected behavior. |
| A5 | `loadPendingClients()` fails | Shows modal error | :yellow_circle: Poor | Same as A3. |
| A6 | `sendQuestionnaires()` fails | Shows modal with `error.message` | :yellow_circle: Poor | Could expose internal error details to admin user. |
| A7 | `markComplete()` fails | Shows modal with `error.message` | :yellow_circle: Poor | Same as A6. |
| A8 | `loadAIClassifications()` fails | Shows error state with retry button | :green_circle: Acceptable | Best error handling in the codebase! |
| A9 | AI review actions (approve/reject/reassign) fail | Shows modal with error message | :green_circle: Acceptable | Clear feedback. |
| A10 | `performServerImport()` fails | Shows modal with error details | :green_circle: Acceptable | |
| A11 | No timeout on ANY fetch call | Infinite loading overlays possible | :red_circle: Critical | Loading overlay blocks entire UI. |
| A12 | `loadAIReviewCount()` fails | Silently fails, badge stays hidden | :green_circle: Acceptable | Non-critical background fetch. |

### B) Data/Validation Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| A13 | Dashboard returns `unauthorized` | Calls `logout()` — redirects to login | :green_circle: Acceptable | |
| A14 | Empty client list | Shows "No clients found" empty state | :green_circle: Acceptable | |
| A15 | Manual client add — missing name/email | Shows warning modal | :green_circle: Acceptable | |
| A16 | Manual client add — invalid email | Shows warning modal | :green_circle: Acceptable | |
| A17 | Duplicate email on manual add | Shows confirm dialog | :green_circle: Acceptable | |
| A18 | Excel import — invalid file | Shows modal "Cannot read file" | :green_circle: Acceptable | |
| A19 | AI classifications — empty response | Shows "no classifications" empty state | :green_circle: Acceptable | |

### C) Client-Side Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| A20 | JavaScript fails | Login screen shows (HTML is static) but login won't work | :yellow_circle: Poor | No `<noscript>` message. |
| A21 | XLSX library fails to load (CDN) | Excel import will fail with unhelpful error | :yellow_circle: Poor | No pre-check for library availability. |
| A22 | `localStorage` unavailable | Auth token storage fails, login won't persist | :yellow_circle: Poor | No graceful fallback. |

### D) User Flow Failures

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| A23 | Double-click "Send Questionnaires" | No protection — could send twice | :red_circle: Critical | `sendQuestionnaires` has no lock. |
| A24 | Double-click "Mark Complete" | `confirm()` dialog provides some protection | :yellow_circle: Poor | But confirm can be dismissed and clicked again quickly. |
| A25 | Loading overlay stuck (fetch hangs) | No timeout — overlay blocks entire app | :red_circle: Critical | User must refresh. |
| A26 | `sendToAll` without confirmation | Has `confirm()` dialog | :green_circle: Acceptable | |

### E) Security Concerns

| # | Scenario | Current Handling | Rating | Notes |
|---|----------|-----------------|--------|-------|
| A27 | Auth token in `localStorage` | Key is obfuscated but not encrypted | :yellow_circle: Poor | Standard practice for static sites, but worth noting. |
| A28 | Token passed in URL query params (GET requests) | `admin-dashboard?token=...`, `admin-pending?token=...` | :yellow_circle: Poor | Tokens in URLs can be logged by proxies/CDNs. |
| A29 | AI review `parseAIResponse()` shows raw server error | Catches empty/invalid JSON with Hebrew messages | :green_circle: Acceptable | Good defensive parsing. |

---

## Severity Summary

| Rating | Count | Description |
|--------|-------|-------------|
| :red_circle: Critical | 11 | App hangs, blank screen, double-submit, no recovery |
| :yellow_circle: Poor | 27 | Generic errors, no retry, poor UX, missing timeouts |
| :green_circle: Acceptable | 24 | Clear message, user knows what to do |

### Critical Issues Requiring Immediate Attention

1. **No timeouts on ANY fetch call** (affects ALL 4 files) — can cause infinite spinners/loading overlays
2. **Loading spinner not hidden on error** (view-documents.js line 48, document-manager.js line 147) — both spinner and error visible
3. **No `<noscript>` fallback** on any page — blank/skeleton screen if JS fails
4. **Double-submit vulnerability** on document manager save, admin send questionnaires
5. **Admin loading overlay with no timeout** — blocks entire app with no escape

### Cross-Cutting Issues (Affect All Files)

1. No fetch timeouts anywhere
2. No retry mechanism anywhere
3. No offline detection anywhere
4. No centralized error handling — each file has its own `showError` pattern
5. Error messages are inconsistently bilingual (some Hebrew-only, some English-only, some both)
6. No loading timeout escalation ("taking longer than expected...")
7. No structured error classification (network vs auth vs validation vs unknown)
