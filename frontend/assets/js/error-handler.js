/* ===========================================
   ERROR HANDLER - Shared Error Module
   Centralized error classification, bilingual messages, and UI rendering.
   =========================================== */

// --- Error Types ---
const ErrorType = {
    NETWORK: 'network',
    TIMEOUT: 'timeout',
    HTTP_CLIENT: 'http_client',   // 4xx
    HTTP_SERVER: 'http_server',   // 5xx
    AUTH: 'auth',                 // 401/403
    NOT_FOUND: 'not_found',      // 404
    PARSE: 'parse',              // JSON parse failure
    OFFLINE: 'offline',
    CIRCUIT_OPEN: 'circuit_open',
    UNKNOWN: 'unknown'
};

// --- Bilingual Message Catalog ---
const ERROR_MESSAGES = {
    [ErrorType.NETWORK]: {
        he: 'לא ניתן להתחבר לשרת. בדקו את חיבור האינטרנט.',
        en: 'Cannot connect to server. Check your internet connection.'
    },
    [ErrorType.TIMEOUT]: {
        he: 'הפעולה לקחה יותר מדי זמן. נסו שוב.',
        en: 'The request took too long. Please try again.'
    },
    [ErrorType.HTTP_CLIENT]: {
        he: 'הבקשה אינה תקינה. אנא נסו שוב או פנו למשרד.',
        en: 'The request was invalid. Please try again or contact the office.'
    },
    [ErrorType.HTTP_SERVER]: {
        he: 'שגיאת שרת. אנא נסו שוב בעוד מספר דקות.',
        en: 'Server error. Please try again in a few minutes.'
    },
    [ErrorType.AUTH]: {
        he: 'שגיאת הרשאה. יש להתחבר מחדש.',
        en: 'Authorization error. Please log in again.'
    },
    [ErrorType.NOT_FOUND]: {
        he: 'הנתונים המבוקשים לא נמצאו.',
        en: 'The requested data was not found.'
    },
    [ErrorType.PARSE]: {
        he: 'תשובה לא תקינה מהשרת. נסו שוב.',
        en: 'Invalid response from server. Please try again.'
    },
    [ErrorType.OFFLINE]: {
        he: 'אין חיבור לאינטרנט. חלק מהפעולות לא זמינות.',
        en: 'No internet connection. Some features are unavailable.'
    },
    [ErrorType.CIRCUIT_OPEN]: {
        he: 'השירות אינו זמין זמנית. נסו שוב בעוד רגע.',
        en: 'Service temporarily unavailable. Please try again shortly.'
    },
    [ErrorType.UNKNOWN]: {
        he: 'אירעה שגיאה. נסו שוב או פנו למשרד.',
        en: 'An error occurred. Please try again or contact the office.'
    }
};

const CONTACT_INFO = {
    he: 'ליצירת קשר עם המשרד: reports@moshe-atsits.co.il',
    en: 'Contact the office: reports@moshe-atsits.co.il'
};

// --- Error Classification ---

/**
 * Classify an error into a known ErrorType.
 * @param {Error} error - The caught error
 * @param {Response} [response] - Optional fetch Response object
 * @returns {string} ErrorType value
 */
function classifyError(error, response) {
    // Offline check
    if (!navigator.onLine) return ErrorType.OFFLINE;

    // Timeout (AbortError from AbortSignal.timeout or AbortController)
    if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        return ErrorType.TIMEOUT;
    }

    // Network errors (TypeError from fetch = network failure)
    if (error instanceof TypeError && !response) {
        return ErrorType.NETWORK;
    }

    // HTTP status-based classification
    if (response) {
        const status = response.status;
        if (status === 401 || status === 403) return ErrorType.AUTH;
        if (status === 404) return ErrorType.NOT_FOUND;
        if (status >= 400 && status < 500) return ErrorType.HTTP_CLIENT;
        if (status >= 500) return ErrorType.HTTP_SERVER;
    }

    // JSON parse errors
    if (error instanceof SyntaxError) return ErrorType.PARSE;

    // Circuit breaker open
    if (error && error.name === 'CircuitOpenError') return ErrorType.CIRCUIT_OPEN;

    return ErrorType.UNKNOWN;
}

/**
 * Get a bilingual error message.
 * Accepts either an ErrorType string or an Error object (auto-classified).
 * @param {string|Error} errorOrType - ErrorType string or Error object
 * @param {string} [lang='he'] - Language code
 * @returns {string} The error message
 */
function getErrorMessage(errorOrType, lang) {
    var type = errorOrType;
    // If passed an Error object, classify it first
    if (errorOrType && typeof errorOrType === 'object' && errorOrType instanceof Error) {
        type = classifyError(errorOrType);
    } else if (errorOrType && typeof errorOrType === 'object') {
        type = classifyError(errorOrType);
    }
    const msgs = ERROR_MESSAGES[type] || ERROR_MESSAGES[ErrorType.UNKNOWN];
    return msgs[lang] || msgs.he;
}

/**
 * Get bilingual contact info string.
 * @param {string} [lang='he']
 * @returns {string}
 */
function getContactMessage(lang) {
    return CONTACT_INFO[lang] || CONTACT_INFO.he;
}

// --- UI Rendering Functions ---

/**
 * Render an error state with retry button into a container.
 * @param {HTMLElement} container - DOM element to render into
 * @param {Error|string} errorOrType - Error object or ErrorType string
 * @param {Object} [options]
 * @param {string} [options.lang='he'] - Language
 * @param {Function} [options.onRetry] - Retry callback
 * @param {boolean} [options.showContact=true] - Show office contact info
 */
function showErrorWithRetry(container, errorOrType, { lang = 'he', onRetry, showContact = true } = {}) {
    if (!container) return;

    // Support both calling conventions:
    // showErrorWithRetry(el, error, { lang, onRetry })
    // showErrorWithRetry(el, { errorType, lang, onRetry })  [legacy]
    var errorType;
    if (errorOrType && typeof errorOrType === 'object' && !(errorOrType instanceof Error) && errorOrType.errorType) {
        // Legacy object form
        errorType = errorOrType.errorType;
        lang = errorOrType.lang || lang;
        onRetry = errorOrType.onRetry || onRetry;
        showContact = errorOrType.showContact !== undefined ? errorOrType.showContact : showContact;
    } else {
        errorType = (errorOrType instanceof Error || (errorOrType && typeof errorOrType === 'object'))
            ? classifyError(errorOrType)
            : (errorOrType || ErrorType.UNKNOWN);
    }

    const isHe = lang === 'he';
    const message = getErrorMessage(errorType, lang);
    const retryLabel = isHe ? 'נסו שוב' : 'Try Again';
    const contactMsg = showContact ? getContactMessage(lang) : '';

    const iconName = errorType === ErrorType.OFFLINE ? 'wifi-off' :
                     errorType === ErrorType.TIMEOUT ? 'clock' : 'alert-triangle';

    container.innerHTML = `
        <div class="error-state error-state-enhanced" role="alert" aria-live="assertive">
            <div class="error-state-icon">
                <i data-lucide="${iconName}" class="icon-lg"></i>
            </div>
            <p class="error-state-message">${_escapeHtmlErr(message)}</p>
            ${showContact ? `<p class="error-state-contact">${_escapeHtmlErr(contactMsg)}</p>` : ''}
            ${onRetry ? `<button class="btn btn-primary btn-sm error-retry-btn" type="button">${retryLabel}</button>` : ''}
        </div>
    `;

    if (onRetry) {
        const btn = container.querySelector('.error-retry-btn');
        if (btn) btn.addEventListener('click', onRetry);
    }

    // Re-init Lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Show a small inline error message near a specific element.
 * @param {HTMLElement} element - The element to show the error near
 * @param {string} message - Error message text
 * @param {string} [type='danger'] - CSS type class
 */
function showInlineError(element, message, type = 'danger') {
    if (!element) return;
    // Remove existing inline error if any
    clearInlineError(element);

    const errorEl = document.createElement('div');
    errorEl.className = `inline-error inline-error-${type}`;
    errorEl.setAttribute('role', 'alert');
    errorEl.textContent = message;
    element.insertAdjacentElement('afterend', errorEl);
}

/**
 * Clear inline error near an element.
 * @param {HTMLElement} element
 */
function clearInlineError(element) {
    if (!element) return;
    const existing = element.nextElementSibling;
    if (existing && existing.classList.contains('inline-error')) {
        existing.remove();
    }
}

// --- Offline Banner ---
let _offlineBannerEl = null;

/**
 * Initialize offline detection. Call once on page load.
 * Shows/hides a persistent banner when connectivity changes.
 * @param {string} [lang='he']
 */
function initOfflineDetection(lang = 'he') {
    window.addEventListener('offline', () => _showOfflineBanner(lang));
    window.addEventListener('online', _hideOfflineBanner);

    // Check initial state
    if (!navigator.onLine) _showOfflineBanner(lang);
}

function _showOfflineBanner(lang) {
    if (_offlineBannerEl) return; // already showing

    const isHe = lang === 'he';
    _offlineBannerEl = document.createElement('div');
    _offlineBannerEl.className = 'offline-banner';
    _offlineBannerEl.setAttribute('role', 'alert');
    _offlineBannerEl.innerHTML = `
        <i data-lucide="wifi-off" class="icon-sm"></i>
        <span>${isHe ? 'אין חיבור לאינטרנט' : 'No internet connection'}</span>
    `;
    document.body.prepend(_offlineBannerEl);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _hideOfflineBanner() {
    if (_offlineBannerEl) {
        _offlineBannerEl.remove();
        _offlineBannerEl = null;
    }
}

// --- Loading Escalation ---

/**
 * Show escalating loading text after a delay.
 * Returns a cleanup function to cancel the escalation.
 * @param {HTMLElement} loadingEl - The loading container element
 * @param {Object} [options]
 * @param {number} [options.delay=5000] - ms before showing escalation text
 * @param {string} [options.lang='he']
 * @returns {Function} Cleanup function to call when loading completes
 */
function startLoadingEscalation(loadingEl, { delay = 5000, lang = 'he' } = {}) {
    if (!loadingEl) return () => {};

    const isHe = lang === 'he';
    const escalationText = isHe
        ? 'נמשך יותר מהצפוי...'
        : 'Taking longer than expected...';

    const timerId = setTimeout(() => {
        let escalationEl = loadingEl.querySelector('.loading-escalation');
        if (!escalationEl) {
            escalationEl = document.createElement('p');
            escalationEl.className = 'loading-escalation';
            loadingEl.appendChild(escalationEl);
        }
        escalationEl.textContent = escalationText;
    }, delay);

    return function cleanup() {
        clearTimeout(timerId);
        const el = loadingEl.querySelector('.loading-escalation');
        if (el) el.remove();
    };
}

// --- Stale Data Banner ---

/**
 * Show a banner indicating cached/stale data is being displayed.
 * @param {HTMLElement} container - Where to prepend the banner
 * @param {Object} options
 * @param {number} options.cachedAt - Timestamp of cached data
 * @param {string} [options.lang='he']
 * @param {Function} [options.onRefresh] - Callback for refresh button
 */
function showStaleBanner(container, { cachedAt, lang = 'he', onRefresh } = {}) {
    if (!container) return;

    // Remove existing stale banner
    const existing = container.querySelector('.stale-data-banner');
    if (existing) existing.remove();

    const isHe = lang === 'he';
    const minutesAgo = Math.round((Date.now() - cachedAt) / 60000);
    const timeText = minutesAgo < 1
        ? (isHe ? 'לפני פחות מדקה' : 'less than a minute ago')
        : (isHe ? `לפני ${minutesAgo} דקות` : `${minutesAgo} minutes ago`);

    const banner = document.createElement('div');
    banner.className = 'stale-data-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `
        <i data-lucide="clock" class="icon-sm"></i>
        <span>${isHe ? `מציג נתונים מ${timeText}` : `Showing data from ${timeText}`}</span>
        ${onRefresh ? `<a href="javascript:void(0)" class="stale-refresh-link">${isHe ? 'רענן' : 'Refresh'}</a>` : ''}
    `;

    if (onRefresh) {
        const link = banner.querySelector('.stale-refresh-link');
        if (link) link.addEventListener('click', onRefresh);
    }

    container.prepend(banner);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --- Utility ---
function _escapeHtmlErr(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
