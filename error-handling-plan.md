# Error Handling Architecture & Implementation Plan

---

## 3.1 — Proposed Architecture

### 3.1.1 — Centralized Error Handler Module

**File:** `assets/js/error-handler.js` (imported by all pages)

```javascript
// ============================================================
// error-handler.js — Centralized error handling for the portal
// ============================================================

// --- Error Classification ---
const ErrorType = {
  NETWORK: 'network',      // fetch failed, DNS, connection refused
  TIMEOUT: 'timeout',      // request exceeded time limit
  HTTP: 'http',            // 4xx/5xx responses
  AUTH: 'auth',            // 401/403 or invalid token
  VALIDATION: 'validation',// missing params, bad data
  PARSE: 'parse',          // JSON parse error, malformed response
  UNKNOWN: 'unknown'
};

// --- Bilingual Error Messages ---
const ERROR_MESSAGES = {
  network: {
    he: 'לא ניתן להתחבר לשרת. בדקו את חיבור האינטרנט ונסו שוב.',
    en: 'Unable to connect to the server. Check your internet connection and try again.'
  },
  timeout: {
    he: 'הבקשה לקחה יותר מדי זמן. אנא נסו שוב.',
    en: 'The request took too long. Please try again.'
  },
  http_500: {
    he: 'שגיאה בשרת. צוות המשרד עודכן. אנא נסו שוב מאוחר יותר.',
    en: 'Server error. The office team has been notified. Please try again later.'
  },
  http_404: {
    he: 'המידע המבוקש לא נמצא. ייתכן שהקישור אינו תקף.',
    en: 'The requested information was not found. The link may be invalid.'
  },
  auth: {
    he: 'שגיאת הרשאה. אנא התחברו מחדש.',
    en: 'Authorization error. Please log in again.'
  },
  validation_missing_params: {
    he: 'הקישור חסר פרטים נדרשים. אנא השתמשו בקישור המקורי שנשלח אליכם במייל.',
    en: 'The link is missing required details. Please use the original link sent to you by email.'
  },
  validation_invalid_data: {
    he: 'המידע שהתקבל אינו תקין. אנא נסו לרענן את הדף.',
    en: 'The received data is invalid. Please try refreshing the page.'
  },
  parse: {
    he: 'תשובה לא תקינה מהשרת. אנא נסו שוב.',
    en: 'Invalid response from server. Please try again.'
  },
  unknown: {
    he: 'אירעה שגיאה בלתי צפויה. אנא נסו שוב או פנו למשרד.',
    en: 'An unexpected error occurred. Please try again or contact the office.'
  },
  offline: {
    he: 'נראה שאינכם מחוברים לאינטרנט. חלק מהתכונות לא יהיו זמינות.',
    en: 'You appear to be offline. Some features may be unavailable.'
  },
  slow_loading: {
    he: 'הטעינה לוקחת יותר מהרגיל...',
    en: 'Loading is taking longer than usual...'
  }
};

function classifyError(error, response) {
  if (error?.name === 'AbortError') return ErrorType.TIMEOUT;
  if (error?.name === 'TypeError' && error.message.includes('fetch'))
    return ErrorType.NETWORK;
  if (!navigator.onLine) return ErrorType.NETWORK;
  if (response) {
    if (response.status === 401 || response.status === 403) return ErrorType.AUTH;
    if (response.status >= 400) return ErrorType.HTTP;
  }
  if (error?.name === 'SyntaxError') return ErrorType.PARSE;
  return ErrorType.UNKNOWN;
}

function getErrorMessage(type, lang, response) {
  if (type === ErrorType.HTTP && response?.status === 404) {
    return ERROR_MESSAGES.http_404[lang];
  }
  if (type === ErrorType.HTTP && response?.status >= 500) {
    return ERROR_MESSAGES.http_500[lang];
  }
  return ERROR_MESSAGES[type]?.[lang] || ERROR_MESSAGES.unknown[lang];
}
```

### 3.1.2 — UI Error State Components

#### Inline Error (within sections)
```html
<div class="error-inline" role="alert" aria-live="polite">
  <div class="error-inline-icon">
    <i data-lucide="alert-circle" class="icon-sm"></i>
  </div>
  <div class="error-inline-content">
    <p class="error-inline-message">{message}</p>
    <button class="btn btn-sm btn-secondary error-retry-btn" onclick="retry()">
      <i data-lucide="refresh-cw" class="icon-xs"></i>
      <span>{retryText}</span>
    </button>
  </div>
</div>
```

#### Full-Page Error (when page can't load at all)
```html
<div class="error-fullpage" role="alert" aria-live="assertive">
  <div class="error-fullpage-icon">
    <i data-lucide="wifi-off" class="icon-2xl"></i>
  </div>
  <h2 class="error-fullpage-title">{title}</h2>
  <p class="error-fullpage-message">{message}</p>
  <div class="error-fullpage-actions">
    <button class="btn btn-primary" onclick="retry()">
      <i data-lucide="refresh-cw" class="icon-sm"></i> {retryText}
    </button>
    <a href="mailto:reports@moshe-atsits.co.il" class="btn btn-secondary">
      <i data-lucide="mail" class="icon-sm"></i> {contactText}
    </a>
  </div>
</div>
```

#### Toast/Banner (for transient notifications)
```html
<div class="toast-banner" role="status" aria-live="polite">
  <i data-lucide="info" class="icon-sm"></i>
  <span class="toast-message">{message}</span>
  <button class="toast-dismiss" aria-label="dismiss">&times;</button>
</div>
```

#### Offline Detection Banner
```html
<div class="offline-banner" id="offlineBanner" hidden role="alert">
  <i data-lucide="wifi-off" class="icon-sm"></i>
  <span id="offlineBannerText">{offlineMessage}</span>
</div>
```

#### Loading with Timeout Escalation
```javascript
function showLoadingWithEscalation(container, lang, options = {}) {
  const { slowThresholdMs = 5000, timeoutMs = 15000 } = options;

  container.innerHTML = `
    <div class="loading" id="loadingState">
      <div class="spinner"></div>
      <p class="loading-text">${lang === 'he' ? 'טוען...' : 'Loading...'}</p>
      <p class="loading-slow" hidden>
        ${ERROR_MESSAGES.slow_loading[lang]}
      </p>
    </div>
  `;

  const slowTimer = setTimeout(() => {
    const slowEl = container.querySelector('.loading-slow');
    if (slowEl) slowEl.hidden = false;
  }, slowThresholdMs);

  return {
    clearTimers: () => clearTimeout(slowTimer),
    hide: () => {
      clearTimeout(slowTimer);
      const loadingEl = container.querySelector('#loadingState');
      if (loadingEl) loadingEl.style.display = 'none';
    }
  };
}
```

All components support RTL by inheriting `dir` from `<html>` and using CSS logical properties.

### 3.1.3 — Network Resilience Layer

**File:** `assets/js/resilient-fetch.js`

```javascript
// ============================================================
// resilient-fetch.js — Fetch wrapper with timeout, retry,
// circuit breaker, and request deduplication
// ============================================================

// --- Timeout Wrapper ---
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// --- Per-Endpoint Timeout Config ---
const ENDPOINT_TIMEOUTS = {
  'check-existing-submission': 6000,
  'get-client-documents': 10000,
  'reset-submission': 10000,
  'get-documents': 10000,
  'edit-documents': 15000,
  'approve-and-send': 15000,
  'admin-auth': 8000,
  'admin-dashboard': 12000,
  'admin-pending': 8000,
  'admin-send-questionnaires': 20000,
  'admin-bulk-import': 20000,
  'admin-mark-complete': 10000,
  'get-pending-classifications': 10000,
  'review-classification': 10000
};

function getTimeout(endpoint) {
  return ENDPOINT_TIMEOUTS[endpoint] || 10000;
}

// --- Retry with Exponential Backoff ---
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 2,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    shouldRetry = () => true
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !shouldRetry(error)) throw error;

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelayMs
      );
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// --- Circuit Breaker ---
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 4;
    this.resetTimeoutMs = options.resetTimeoutMs || 20000;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        const error = new Error('Service temporarily unavailable');
        error.name = 'CircuitOpenError';
        throw error;
      }
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') this.state = 'CLOSED';
      this.failureCount = 0;
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.failureThreshold || this.state === 'HALF_OPEN') {
        this.state = 'OPEN';
      }
      throw error;
    }
  }

  getState() {
    if (this.state === 'OPEN' &&
        Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
      return 'HALF_OPEN';
    }
    return this.state;
  }
}

// --- Request Deduplication ---
const _inFlight = new Map();

function deduplicatedFetch(key, fn) {
  if (_inFlight.has(key)) return _inFlight.get(key);
  const promise = fn().finally(() => _inFlight.delete(key));
  _inFlight.set(key, promise);
  return promise;
}

// --- Submit Lock (double-click prevention) ---
function createSubmitLock(buttonEl) {
  let locked = false;
  const originalHTML = buttonEl.innerHTML;

  return {
    get isLocked() { return locked; },
    async run(asyncFn) {
      if (locked) return;
      locked = true;
      buttonEl.disabled = true;
      buttonEl.classList.add('is-loading');
      try {
        return await asyncFn();
      } finally {
        locked = false;
        buttonEl.disabled = false;
        buttonEl.classList.remove('is-loading');
        buttonEl.innerHTML = originalHTML;
      }
    }
  };
}
```

### 3.1.4 — Graceful Degradation Strategy

#### JavaScript Fails Entirely
Add `<noscript>` to every page:

```html
<noscript>
  <div style="text-align:center; padding:40px; font-family:sans-serif; direction:rtl;">
    <h2>נדרש JavaScript</h2>
    <p>דף זה דורש הפעלת JavaScript בדפדפן. אנא הפעילו JavaScript ורעננו את הדף.</p>
    <hr style="margin:20px 0;">
    <h2 style="direction:ltr;">JavaScript Required</h2>
    <p style="direction:ltr;">This page requires JavaScript to be enabled. Please enable JavaScript and refresh.</p>
    <p style="margin-top:20px;">
      <a href="mailto:reports@moshe-atsits.co.il">reports@moshe-atsits.co.il</a>
    </p>
  </div>
</noscript>
```

#### API is Down
- Show error state with retry button and office contact email
- For `view-documents`: attempt to use `sessionStorage` cache if available (stale-while-revalidate)
- Show "Showing cached data from X minutes ago" banner if using cached data

#### Partial Data Available
- If document list loads but progress data is missing, show documents without progress bar
- If client name is missing, show "Your Documents" instead of blank name
- If categories fail to load, show flat document list without grouping

### 3.1.5 — Error Prevention

#### Input Validation Before API Calls
```javascript
// Validate URL params before any fetch
function validatePageParams(required) {
  const params = new URLSearchParams(window.location.search);
  const missing = required.filter(key => !params.get(key));
  return { valid: missing.length === 0, missing };
}
```

#### Confirmation Dialogs for Destructive Actions
Already implemented for reset (landing page) and document edits (document-manager). No changes needed.

#### Disable Buttons During Async Operations
Apply `createSubmitLock` to:
- Landing page: "Delete & Start Over" button
- Document manager: "Save Changes" button, "Send Questionnaire" button
- Admin: "Send Questionnaires" buttons, "Mark Complete" buttons

---

## 3.2 — Implementation Roadmap

### Priority 1 — Critical (Do First)

| # | Task | Files | Size | Description |
|---|------|-------|------|-------------|
| P1.1 | Add timeouts to all fetch calls | All 4 JS files | S | Wrap every `fetch()` with `AbortSignal.timeout()` using per-endpoint config |
| P1.2 | Fix loading spinner not hidden on error | `view-documents.js`, `document-manager.js` | S | Move `loading.style.display = 'none'` to before try/catch or add it in catch block |
| P1.3 | Add `<noscript>` fallback | All 4 HTML files | S | Bilingual "JavaScript required" message with office contact |
| P1.4 | Double-submit prevention | `landing.js`, `document-manager.js`, `admin/script.js` | S | Add `createSubmitLock` to all buttons that trigger API calls |
| P1.5 | Admin loading overlay timeout | `admin/script.js` | S | Add max timeout (20s) to `showLoading` that auto-hides and shows error |

### Priority 2 — Important (Next Sprint)

| # | Task | Files | Size | Description |
|---|------|-------|------|-------------|
| P2.1 | Create `error-handler.js` module | New file | M | Centralized error classification, bilingual messages, error UI components |
| P2.2 | Create `resilient-fetch.js` module | New file | M | Timeout wrapper, retry with backoff, circuit breaker, dedup |
| P2.3 | Consistent bilingual error messages | All 4 JS files | M | Replace all error strings with centralized bilingual messages |
| P2.4 | Error states with retry buttons | All client-facing pages | M | Replace generic text errors with structured error UI + retry action |
| P2.5 | Loading timeout escalation | All pages | S | Show "taking longer than expected" after 5s of loading |
| P2.6 | Offline detection banner | All pages | S | Listen for online/offline events, show persistent banner |
| P2.7 | Retry on transient failures | All fetch calls | M | Add 1-2 retries with backoff for network/5xx errors |
| P2.8 | Fix admin error.message exposure | `admin/script.js` | S | Sanitize error messages before showing in modals |

### Priority 3 — Nice to Have (Future)

| # | Task | Files | Size | Description |
|---|------|-------|------|-------------|
| P3.1 | Circuit breaker per endpoint group | `resilient-fetch.js` | M | Prevent repeated calls to known-failing endpoints |
| P3.2 | Session cache for view-documents | `view-documents.js` | M | Cache last successful response in sessionStorage |
| P3.3 | Graceful degradation for partial data | `view-documents.js`, `document-manager.js` | M | Handle missing names, empty categories, etc. |
| P3.4 | Animated error state transitions | CSS | S | Fade-in for error states, slide-in for banners |
| P3.5 | "Report Problem" action in errors | `error-handler.js` | S | mailto link pre-filled with error context (no sensitive data) |
| P3.6 | Global error boundary | All pages | M | `window.onerror` and `unhandledrejection` handlers |
| P3.7 | Structured console logging | `error-handler.js` | S | JSON-structured logs with error type, endpoint, timestamp |
