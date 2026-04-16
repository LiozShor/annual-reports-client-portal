# Design Log 044: Error Handling Architecture & Improvement
**Status:** [COMPLETED]
**Date:** 2026-02-20
**Related Logs:** 037-admin-portal-ux-refactor, 036-ai-classification-review-interface

## 1. Context & Problem

The Annual Reports Client Portal serves 500+ accounting firm clients for tax document collection. All pages are static HTML/JS hosted on GitHub Pages, communicating with n8n Cloud webhooks as the backend.

An audit of all portal files reveals **11 critical** and **27 poor-rated** error handling scenarios. The most systemic issues:
- **Zero fetch timeouts** across the entire codebase — every API call can hang indefinitely
- **Loading spinners not hidden on error** (view-documents.js, document-manager.js) — users see both spinner AND error
- **No double-submit prevention** on critical buttons (save, send questionnaires)
- **No `<noscript>` fallback** — blank pages if JS fails
- **No offline detection** — users don't know why things fail
- **Inconsistent error messages** — some Hebrew-only, some English-only, some bilingual
- **No retry mechanism** — single failure = dead end
- **Admin loading overlay with no escape** — blocks entire UI if fetch hangs

Full audit: `error-audit.md` in repo root.
Full research: `research-summary.md` in repo root.

## 2. User Requirements

1. **Q:** Should improvements be implemented incrementally or all at once?
   **A:** Incremental — P1 critical fixes first, then P2 architecture, then P3 polish.

2. **Q:** Should the error handler be a shared JS file or embedded inline per page?
   **A:** Shared JS file — new `error-handler.js` + `resilient-fetch.js` imported by all pages.

3. **Q:** Should admin portal also be upgraded?
   **A:** Yes, all pages — admin users also suffer from infinite spinners and double-submit.

4. **Q:** Should we add sessionStorage caching for view-documents?
   **A:** Yes, with stale data warning banner.

## 3. Research

### Domain
Resilience Engineering, UX Error States, Web Performance, Financial Portal UX

### Sources Consulted
1. **"Release It!" — Michael Nygard** — Circuit breaker, bulkhead, timeout, and fail-fast patterns. Every outgoing request MUST have a timeout. Circuit breakers prevent cascading failures.
2. **Nielsen Norman Group** — Error messages must be Visible, Precise, Constructive, Polite. Write at 7th-8th grade reading level. Never blame the user.
3. **"Don't Make Me Think" — Steve Krug** — Reservoir of Goodwill concept. Every frustrating error drains it. Recovery must be one-click.
4. **Google Material Design** — Three error types (input, app, state). Summary + inline pattern. Color + icon + text weight (never color alone).
5. **Stripe Error UX** — Two-layer architecture (internal vs user-facing). Never expose server internals. Dunning pattern for recovery emails.
6. **web.dev / MDN** — fetch() doesn't reject on HTTP errors. AbortSignal.timeout() for timeouts. navigator.onLine limitations.
7. **GitHub / Notion / Linear patterns** — Skeleton loading, error isolation, offline indicators, progressive enhancement.

### Key Principles Extracted
- **Every fetch needs a timeout** — the #1 stability antipattern is missing timeouts (Nygard)
- **Fail fast, fail visibly, fail usefully** — validate before calling, show clear message, offer retry
- **Never blame the user** — use "we couldn't" not "you entered invalid" (NNG)
- **Separate internal errors from user messages** — never expose server details (Stripe)
- **Error isolation** — one failing component shouldn't crash the page (GitHub pattern)
- **Loading state machine** — idle -> loading -> slow-warning -> success|error (web.dev)

### Patterns to Use
- **Timeout wrapper:** `AbortSignal.timeout()` on every fetch with per-endpoint config
- **Retry with exponential backoff:** Max 2 retries for GET requests on transient failures
- **Submit lock:** Disable buttons during async operations to prevent double-submit
- **Circuit breaker:** Per-endpoint-group failure tracking (Priority 3)
- **Error classification:** Typed errors (network/timeout/http/auth/validation/parse/unknown)
- **Bilingual message catalog:** Centralized error messages in Hebrew + English
- **Offline detection:** `online`/`offline` events + persistent banner

### Anti-Patterns to Avoid
- **Generic "Something went wrong"** — always be specific about what failed
- **Toast for critical errors** — they disappear before users read them
- **Clearing user input on error** — always preserve what the user entered
- **Retrying 4xx errors** — permanent failures should not be retried
- **Infinite spinners** — always have a timeout with escalation

### Research Verdict
Incremental approach: fix critical bugs first (timeouts, spinner bugs, double-submit), then build centralized modules, then add advanced resilience. This aligns with Nygard's philosophy of fixing the most damaging antipatterns first.

## 4. Codebase Analysis

### Relevant Files Examined

| File | Lines | Fetch Calls | Error Handling Quality |
|------|-------|-------------|----------------------|
| `assets/js/landing.js` | 290 | 2 (GET) | Poor — generic Hebrew errors, no timeout, no retry |
| `assets/js/view-documents.js` | 229 | 1 (GET) | Poor — spinner bug, no timeout, no retry |
| `assets/js/document-manager.js` | 1003 | 3 (1 GET + 2 POST) | Mixed — good validation, but no timeout, double-submit risk |
| `admin/js/script.js` | 1909 | ~15 (GET + POST) | Mixed — good AI review errors, but no timeouts, loading overlay trap |

### Existing Patterns
- **`showError(msg)`** in landing.js and view-documents.js — replaces content div with error text
- **`showAlert(msg, type)`** in document-manager.js — auto-dismissing 5s alert bar
- **`showModal(type, title, body)`** in admin — modal dialog with icon
- **`showLoading(text)` / `hideLoading()`** in admin — full-page overlay
- **Skeleton loading** in landing page (HTML skeleton placeholder)
- **Bilingual toggle** in view-documents (Hebrew/English switch)

### Alignment with Research
- **Divergence:** No timeouts anywhere (violates Nygard's #1 rule)
- **Divergence:** No error classification (all errors treated identically)
- **Divergence:** Spinner bugs violate "fail visibly" principle
- **Good:** Admin AI review has retry button and proper error states
- **Good:** Document-manager has input validation before submit
- **Good:** Landing page has base64 decoding guards

### Dependencies
- All pages depend on n8n webhook endpoints (single backend)
- Lucide icons loaded from CDN (unpkg.com)
- Admin uses XLSX library from CDN
- No build system — plain JS loaded via `<script>` tags

## 5. Technical Constraints & Risks

- **Security:** Never expose webhook URLs, auth tokens, or server error details in user-facing messages
- **Risks:** Adding `<script>` tags to all HTML files requires careful ordering (shared modules before page-specific scripts)
- **Breaking Changes:** None expected — all changes are additive or fix existing bugs
- **RTL:** All UI components must work in RTL (Hebrew) and LTR (English) modes
- **No build system:** Cannot use ES modules, bundlers, or npm. Must be plain `<script>` tags.

## 6. Proposed Solution (The Blueprint)

### Implementation Phases

**Phase 1 (Priority 1 — Critical fixes):**
1. Add `AbortSignal.timeout()` to all ~20 fetch calls across 4 JS files
2. Fix spinner-on-error bug in view-documents.js and document-manager.js
3. Add `<noscript>` blocks to all 4 HTML files
4. Add double-submit prevention to 6 critical buttons
5. Add safety timeout to admin loading overlay

**Phase 2 (Priority 2 — Architecture):**
1. Create `assets/js/error-handler.js` — error classification + bilingual messages + UI components
2. Create `assets/js/resilient-fetch.js` — timeout wrapper + retry + circuit breaker + submit lock
3. Add `<script>` tags to all 4 HTML files (before page-specific scripts)
4. Refactor all error handling to use centralized modules
5. Add offline detection banner to all pages
6. Add loading timeout escalation
7. Add sessionStorage caching to view-documents

**Phase 3 (Priority 3 — Polish):**
1. Circuit breaker per endpoint group
2. Error state animations (CSS)
3. "Report Problem" mailto action
4. Global error boundary
5. Structured console logging

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `assets/js/error-handler.js` | Create | Error classification, bilingual messages, UI render functions |
| `assets/js/resilient-fetch.js` | Create | fetchWithTimeout, retryWithBackoff, CircuitBreaker, createSubmitLock |
| `assets/js/landing.js` | Modify | Add timeouts, use centralized errors, submit lock on reset button |
| `assets/js/view-documents.js` | Modify | Fix spinner bug, add timeout, use centralized errors, add caching |
| `assets/js/document-manager.js` | Modify | Fix spinner bug, add timeouts, submit lock on save/send buttons |
| `admin/js/script.js` | Modify | Add timeouts, loading overlay safety, submit locks, sanitize error messages |
| `index.html` | Modify | Add `<noscript>`, add `<script>` for shared modules |
| `view-documents.html` | Modify | Add `<noscript>`, add `<script>` for shared modules, offline banner |
| `document-manager.html` | Modify | Add `<noscript>`, add `<script>` for shared modules |
| `admin/index.html` | Modify | Add `<noscript>`, add `<script>` for shared modules |
| `assets/css/common.css` | Modify | Add error state, offline banner, loading escalation CSS |

## 7. Validation Plan

- [ ] All pages load without JS errors
- [ ] Simulated offline: offline banner appears
- [ ] Simulated n8n down: error with retry button shows (not infinite spinner)
- [ ] Double-click save button: only one request sent
- [ ] Fetch timeout: "taking longer than expected" → error message
- [ ] Missing URL params: clear bilingual error
- [ ] view-documents.html: spinner hidden on fetch error
- [ ] document-manager.html: spinner hidden on fetch error
- [ ] Admin loading overlay: auto-hides after 25s
- [ ] All error messages are bilingual (client pages) or Hebrew (admin)
- [ ] RTL layout correct for all error states
- [ ] `<noscript>` fallback visible when JS disabled

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
