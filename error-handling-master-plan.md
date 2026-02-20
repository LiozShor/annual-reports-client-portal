# Error Handling Master Plan — Annual Reports Client Portal

---

## 1. Executive Summary

The Annual Reports Client Portal serves 500+ accounting firm clients for tax document collection. An audit of all portal files reveals **11 critical** and **27 poor-rated** error handling scenarios across 4 page groups. The most systemic issue is the complete absence of fetch timeouts — every API call can hang indefinitely, causing infinite spinners. Other critical gaps include double-submit vulnerabilities, loading states not cleared on error, and no JavaScript fallbacks. This plan proposes a centralized error handling architecture with bilingual support, a resilient fetch layer with timeouts/retry/circuit breaker, and consistent error UI components. Priority 1 fixes (5 tasks, all small) eliminate the most damaging issues. Priority 2 (8 tasks) builds the proper architecture. Priority 3 (7 tasks) adds polish.

---

## 2. Research Findings

### Key Principles (Sources: Nygard "Release It!", Krug "Don't Make Me Think", NNG, Google Material Design, Stripe)

**From "Release It!" (Stability Patterns):**
- Every outgoing request MUST have a timeout
- Circuit breakers prevent cascading failures when a backend is down
- Fail fast: validate locally before making network calls
- Bulkheads isolate failure domains so one bad endpoint can't freeze the whole page

**From UX Research (NNG, Krug, Material Design):**
- Error messages must be: **Visible, Precise, Constructive, Polite**
- Never blame the user ("You entered invalid data")
- Write at 7th-8th grade reading level
- Always provide a recovery path (retry button, contact link)
- Use inline errors + summary pattern, not just one or the other
- Don't use toast/snackbar for critical errors (they disappear)

**From Stripe (Financial Context):**
- Separate internal errors from user-facing messages
- Never expose server internals to users
- Recovery emails: polite, specific about what's missing, direct link to resolve
- 38% recovery rate with smart retries + automated reminders

**From Web Resilience Research (web.dev, MDN):**
- `fetch()` does NOT reject on HTTP errors — must check `response.ok`
- `navigator.onLine === false` is reliable; `true` is not
- Retry only transient failures (network, 5xx); never retry 4xx
- Deduplication prevents double-submit at both UI and network layers
- Loading state machine: `idle -> loading -> slow-warning -> success|error`

**Bilingual/RTL Considerations:**
- Error icons go to the RIGHT of text in RTL
- Use CSS logical properties for RTL/LTR compatibility
- Email addresses stay LTR even in RTL context
- Hebrew has no uppercase — use bold/color for emphasis

---

## 3. Current State Assessment

### Severity Breakdown

| Rating | Count | Examples |
|--------|-------|---------|
| Critical (app hangs/crashes) | 11 | No timeouts, spinner-on-error, double-submit, no JS fallback |
| Poor (bad UX, no recovery) | 27 | Generic errors, Hebrew-only, no retry, auto-dismissing alerts |
| Acceptable (clear, actionable) | 24 | Missing param checks, empty states, auth handling |

**Total scenarios audited:** 62

### Cross-Cutting Issues (Affect All Pages)
1. **No fetch timeouts** — infinite spinners/overlays possible
2. **No retry mechanism** — single failure = dead end
3. **No offline detection** — user doesn't know why things fail
4. **No centralized error handling** — each file reinvents error display
5. **Inconsistent bilingual errors** — some Hebrew-only, some English-only
6. **No loading escalation** — spinner with no "taking longer than expected"
7. **No error classification** — network vs auth vs validation treated identically

### Most Critical Bugs

| Bug | File | Impact |
|-----|------|--------|
| Loading spinner stays visible on fetch error | `view-documents.js:48`, `document-manager.js:147` | User sees both spinner AND error |
| No timeout on any fetch | All files | Infinite spinner if n8n hangs |
| Double-submit on "Save Changes" | `document-manager.js` | Duplicate operations sent |
| Double-submit on "Send Questionnaires" | `admin/script.js` | Duplicate emails sent |
| Admin loading overlay blocks everything forever | `admin/script.js` | Must refresh to escape |
| No `<noscript>` on any page | All HTML files | Blank/skeleton page if JS fails |
| Reset failure = dead end | `landing.js` | No retry, previous UI destroyed |

---

## 4. Proposed Architecture

### 4.1 — New Files

```
assets/js/
  error-handler.js     # Error classification, bilingual messages, UI components
  resilient-fetch.js   # Timeout, retry, circuit breaker, dedup, submit lock
```

Both files are vanilla JS modules imported via `<script>` tags before page-specific scripts.

### 4.2 — Error Classification System

```
Error occurs
    |
    v
[classifyError()] --> ErrorType.NETWORK
                      ErrorType.TIMEOUT
                      ErrorType.HTTP (further split by status code)
                      ErrorType.AUTH
                      ErrorType.VALIDATION
                      ErrorType.PARSE
                      ErrorType.UNKNOWN
    |
    v
[getErrorMessage(type, lang)] --> Bilingual message from catalog
    |
    v
[renderError(container, type, lang, options)] --> Appropriate UI component
```

### 4.3 — Network Resilience Stack

```
User action triggers API call
        |
        v
  [Submit Lock] ── Already locked? → Ignore click
        |
        v
  [Fail-Fast Guard] ── Missing params? → Immediate validation error
        |                  Offline? → Immediate offline message
        v
  [Request Dedup] ── Same GET in-flight? → Return existing promise
        |
        v
  [Circuit Breaker] ── Circuit OPEN? → Immediate "service unavailable"
        |
        v
  [Retry with Backoff] ── Transient failure? → Retry (max 2x)
        |
        v
  [Timeout-wrapped Fetch] ── Too slow? → Abort + count as failure
        |
        v
  [Response Validation] ── !response.ok? → Classify + display error
        |
        v
  Success → Update UI, reset failure counters
```

### 4.4 — Error UI Components

| Component | Use Case | Behavior |
|-----------|----------|----------|
| **Full-page error** | Page can't load at all | Icon + title + message + retry button + contact link |
| **Inline error** | Section within page fails | Compact icon + message + retry button |
| **Toast banner** | Transient notifications | Auto-dismisses in 5s, can be manually dismissed |
| **Offline banner** | No internet | Persistent at top of page, auto-hides on reconnect |
| **Loading escalation** | Slow response | Spinner -> "taking longer than expected" after 5s -> error after timeout |

All components are bilingual and RTL-compatible.

### 4.5 — Graceful Degradation

| Condition | Fallback |
|-----------|----------|
| JavaScript disabled | `<noscript>` with bilingual message + office email |
| API completely down | Full-page error with retry + contact office |
| API returns partial data | Show what's available, indicate what's missing |
| Cached data available | Show cached data + "stale data" warning banner |
| Single endpoint fails | Other page sections still work (error isolation) |

---

## 5. Implementation Roadmap

### Priority 1 — Critical (Eliminate crashes and dead ends)

| Task | Files | Size | What Changes |
|------|-------|------|-------------|
| **P1.1** Add timeouts to all fetch calls | landing.js, view-documents.js, document-manager.js, admin/script.js | S | Add `signal: AbortSignal.timeout(ms)` to every `fetch()`. ~20 fetch calls total. |
| **P1.2** Fix spinner-on-error bug | view-documents.js, document-manager.js | S | Move `loading.style.display = 'none'` into `finally` block or add to catch. 2 lines each. |
| **P1.3** Add `<noscript>` fallback | index.html, view-documents.html, document-manager.html, admin/index.html | S | Add bilingual `<noscript>` block to each `<body>`. Copy-paste template. |
| **P1.4** Double-submit prevention | landing.js, document-manager.js, admin/script.js | S | Disable buttons on click, re-enable on completion. ~6 buttons. |
| **P1.5** Admin loading overlay safety | admin/script.js | S | Add 25s max timeout to `showLoading()` that auto-hides + shows error modal. |

**Estimated effort:** 1-2 hours

### Priority 2 — Important (Build proper error architecture)

| Task | Files | Size | What Changes |
|------|-------|------|-------------|
| **P2.1** Create error-handler.js | New file + all HTML files | M | Error classification, bilingual message catalog, UI render functions. Add `<script>` tag to all pages. |
| **P2.2** Create resilient-fetch.js | New file + all HTML files | M | fetchWithTimeout, retryWithBackoff, CircuitBreaker, createSubmitLock. Add `<script>` tag to all pages. |
| **P2.3** Consistent bilingual errors | All JS files | M | Replace all hardcoded error strings with `getErrorMessage()` calls. |
| **P2.4** Error states with retry | landing.js, view-documents.js, document-manager.js | M | Replace `showError('text')` with structured error UI + retry button. |
| **P2.5** Loading escalation | All pages | S | Add "taking longer than expected" after 5s spinner. |
| **P2.6** Offline detection banner | All pages | S | Add `online`/`offline` event listeners + banner UI. |
| **P2.7** Retry transient failures | All fetch calls | M | Wrap fetch calls with `retryWithBackoff()`. Skip for mutations. |
| **P2.8** Sanitize admin error messages | admin/script.js | S | Replace `error.message` in modals with classified messages. |

**Estimated effort:** 4-6 hours

### Priority 3 — Nice to Have (Polish and advanced resilience)

| Task | Files | Size | What Changes |
|------|-------|------|-------------|
| **P3.1** Circuit breaker | resilient-fetch.js | M | Per-endpoint-group circuit breakers. |
| **P3.2** Session cache | view-documents.js | M | Cache API responses in sessionStorage, show stale data on failure. |
| **P3.3** Partial data graceful handling | view-documents.js, document-manager.js | M | Handle missing names, empty categories gracefully. |
| **P3.4** Error state animations | CSS | S | Fade-in for errors, slide-in for banners. |
| **P3.5** "Report Problem" action | error-handler.js | S | Pre-filled mailto link in error states (no sensitive data). |
| **P3.6** Global error boundary | All pages | M | `window.onerror` + `unhandledrejection` handlers. |
| **P3.7** Structured logging | error-handler.js | S | Console logs with error type, endpoint, timestamp. |

**Estimated effort:** 4-6 hours

---

## Appendix A: Error Message Catalog (Bilingual)

### Network Errors

| Key | Hebrew | English |
|-----|--------|---------|
| `network` | לא ניתן להתחבר לשרת. בדקו את חיבור האינטרנט ונסו שוב. | Unable to connect to the server. Check your internet connection and try again. |
| `timeout` | הבקשה לקחה יותר מדי זמן. אנא נסו שוב. | The request took too long. Please try again. |
| `offline` | נראה שאינכם מחוברים לאינטרנט. חלק מהתכונות לא יהיו זמינות. | You appear to be offline. Some features may be unavailable. |
| `slow_loading` | הטעינה לוקחת יותר מהרגיל... | Loading is taking longer than usual... |

### Server Errors

| Key | Hebrew | English |
|-----|--------|---------|
| `http_500` | שגיאה בשרת. צוות המשרד עודכן. אנא נסו שוב מאוחר יותר. | Server error. The office team has been notified. Please try again later. |
| `http_404` | המידע המבוקש לא נמצא. ייתכן שהקישור אינו תקף. | The requested information was not found. The link may be invalid. |
| `http_429` | בקשות רבות מדי. אנא המתינו רגע ונסו שוב. | Too many requests. Please wait a moment and try again. |

### Authentication Errors

| Key | Hebrew | English |
|-----|--------|---------|
| `auth` | שגיאת הרשאה. אנא התחברו מחדש. | Authorization error. Please log in again. |
| `auth_expired` | פג תוקף ההתחברות. אנא התחברו שוב. | Your session has expired. Please log in again. |

### Validation Errors

| Key | Hebrew | English |
|-----|--------|---------|
| `validation_missing_params` | הקישור חסר פרטים נדרשים. אנא השתמשו בקישור המקורי שנשלח אליכם במייל. | The link is missing required details. Please use the original link sent to you by email. |
| `validation_invalid_data` | המידע שהתקבל אינו תקין. אנא נסו לרענן את הדף. | The received data is invalid. Please try refreshing the page. |
| `validation_no_changes` | לא בוצעו שינויים. אנא בצעו שינויים לפני השמירה. | No changes were made. Please make changes before saving. |
| `validation_missing_detail` | יש להזין את הפרטים הנדרשים. | Please enter the required details. |
| `validation_duplicate_doc` | מסמך זה כבר נמצא ברשימה. | This document is already in the list. |

### Parse/Data Errors

| Key | Hebrew | English |
|-----|--------|---------|
| `parse` | תשובה לא תקינה מהשרת. אנא נסו שוב. | Invalid response from server. Please try again. |

### Generic Fallback

| Key | Hebrew | English |
|-----|--------|---------|
| `unknown` | אירעה שגיאה בלתי צפויה. אנא נסו שוב או פנו למשרד. | An unexpected error occurred. Please try again or contact the office. |

### Action Labels

| Key | Hebrew | English |
|-----|--------|---------|
| `retry` | נסו שוב | Try Again |
| `refresh` | רענון הדף | Refresh Page |
| `contact_office` | פנייה למשרד | Contact Office |
| `go_back` | חזרה | Go Back |

### Admin-Only Messages (Hebrew Only)

| Key | Hebrew |
|-----|--------|
| `admin_load_error` | לא ניתן לטעון את הנתונים. נסה לרענן. |
| `admin_send_error` | לא ניתן לשלוח. נסה שוב. |
| `admin_update_error` | לא ניתן לעדכן. נסה שוב. |
| `admin_connection_error` | שגיאת תקשורת. בדוק חיבור לאינטרנט. |
| `admin_auth_error` | שגיאת הרשאה. אנא התחבר מחדש. |

---

## Appendix B: Code Templates

### Template 1: Fetch with Timeout (Drop-in Replacement)

**Before:**
```javascript
const response = await fetch(`${API_BASE}/get-client-documents?report_id=${reportId}`);
```

**After:**
```javascript
const response = await fetch(
  `${API_BASE}/get-client-documents?report_id=${reportId}`,
  { signal: AbortSignal.timeout(10000) }
);
```

### Template 2: Fix Spinner-on-Error Bug

**Before (view-documents.js):**
```javascript
async function loadDocuments() {
  try {
    const response = await fetch(...);
    // ... process response ...
    document.getElementById('loading').style.display = 'none';
    // ... render results ...
  } catch (error) {
    showError('Error loading documents');
  }
}
```

**After:**
```javascript
async function loadDocuments() {
  try {
    const response = await fetch(..., { signal: AbortSignal.timeout(10000) });
    // ... process response ...
    document.getElementById('loading').style.display = 'none';
    // ... render results ...
  } catch (error) {
    document.getElementById('loading').style.display = 'none';
    showError(getErrorMessage(classifyError(error), currentLang));
  }
}
```

### Template 3: `<noscript>` Block

```html
<noscript>
  <div style="text-align:center; padding:40px 20px; font-family:Arial,sans-serif;">
    <div style="direction:rtl; margin-bottom:30px;">
      <h2>נדרש JavaScript</h2>
      <p>דף זה דורש הפעלת JavaScript בדפדפן שלכם.</p>
      <p>אנא הפעילו JavaScript ורעננו את הדף.</p>
    </div>
    <hr>
    <div style="direction:ltr; margin-top:30px;">
      <h2>JavaScript Required</h2>
      <p>This page requires JavaScript to be enabled in your browser.</p>
      <p>Please enable JavaScript and refresh the page.</p>
    </div>
    <p style="margin-top:30px;">
      <a href="mailto:reports@moshe-atsits.co.il">reports@moshe-atsits.co.il</a>
    </p>
  </div>
</noscript>
```

### Template 4: Double-Submit Prevention

```javascript
// At module scope
const saveLock = { locked: false };

// Before the async operation
async function handleSave() {
  if (saveLock.locked) return;
  saveLock.locked = true;

  const btn = document.querySelector('#saveBtn');
  btn.disabled = true;
  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<div class="spinner spinner-sm"></div> שומר...';

  try {
    await submitChanges();
  } finally {
    saveLock.locked = false;
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}
```

### Template 5: Loading Overlay Safety Timeout (Admin)

```javascript
let _loadingTimer = null;

function showLoading(text) {
  clearTimeout(_loadingTimer);
  document.getElementById('loadingText').textContent = text || 'מעבד...';
  document.getElementById('loadingOverlay').classList.add('visible');

  // Safety: auto-hide after 25 seconds
  _loadingTimer = setTimeout(() => {
    hideLoading();
    showModal('error', 'שגיאה', 'הפעולה לקחה יותר מדי זמן. אנא נסו שוב.');
  }, 25000);
}

function hideLoading() {
  clearTimeout(_loadingTimer);
  document.getElementById('loadingOverlay').classList.remove('visible');
}
```

### Template 6: Offline Detection Banner

```javascript
// Add to every page's init
function initOfflineDetection(lang) {
  const banner = document.createElement('div');
  banner.id = 'offlineBanner';
  banner.className = 'offline-banner';
  banner.hidden = true;
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <i data-lucide="wifi-off" class="icon-sm"></i>
    <span>${lang === 'he'
      ? 'נראה שאינכם מחוברים לאינטרנט'
      : 'You appear to be offline'}</span>
  `;
  document.body.prepend(banner);

  window.addEventListener('offline', () => { banner.hidden = false; });
  window.addEventListener('online', () => { banner.hidden = true; });

  // Check initial state
  if (!navigator.onLine) banner.hidden = false;
}
```

### Template 7: Error State with Retry Button

```javascript
function showErrorWithRetry(container, message, retryFn, lang) {
  container.innerHTML = `
    <div class="error-state" role="alert" aria-live="assertive">
      <div class="error-icon-wrapper" style="margin: 0 auto var(--sp-4);">
        <i data-lucide="alert-triangle" class="icon-lg"></i>
      </div>
      <p class="error-message">${escapeHtml(message)}</p>
      <div class="error-actions" style="margin-top: var(--sp-4);">
        <button class="btn btn-primary" id="retryBtn">
          <i data-lucide="refresh-cw" class="icon-sm"></i>
          ${lang === 'he' ? 'נסו שוב' : 'Try Again'}
        </button>
        <a href="mailto:reports@moshe-atsits.co.il" class="btn btn-secondary">
          <i data-lucide="mail" class="icon-sm"></i>
          ${lang === 'he' ? 'פנייה למשרד' : 'Contact Office'}
        </a>
      </div>
    </div>
  `;
  container.querySelector('#retryBtn').addEventListener('click', retryFn);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
```

### Template 8: CSS for Error Components

```css
/* Offline banner */
.offline-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  background: var(--warning-100);
  color: var(--warning-800);
  font-size: var(--text-sm);
  font-weight: 500;
  border-bottom: 1px solid var(--warning-300);
}

.offline-banner[hidden] {
  display: none;
}

/* Error state with retry */
.error-state {
  text-align: center;
  padding: var(--sp-8) var(--sp-4);
}

.error-state .error-icon-wrapper {
  color: var(--danger-500);
}

.error-state .error-message {
  color: var(--neutral-700);
  margin: var(--sp-2) 0;
}

.error-state .error-actions {
  display: flex;
  gap: var(--sp-3);
  justify-content: center;
  flex-wrap: wrap;
}

/* Loading escalation */
.loading-slow {
  color: var(--warning-600);
  font-size: var(--text-sm);
  margin-top: var(--sp-2);
  animation: fadeIn 0.3s ease;
}

/* Button loading state */
.btn.is-loading {
  opacity: 0.7;
  pointer-events: none;
}

/* Toast banner */
.toast-banner {
  position: fixed;
  bottom: var(--sp-4);
  left: 50%;
  transform: translateX(-50%) translateY(100px);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  background: var(--neutral-800);
  color: white;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  font-size: var(--text-sm);
  transition: transform 0.3s ease;
  z-index: 9998;
}

.toast-banner.show {
  transform: translateX(-50%) translateY(0);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```
