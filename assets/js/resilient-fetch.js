/* ===========================================
   RESILIENT FETCH - Shared Fetch Module
   Timeout wrappers, retry with backoff, circuit breaker,
   submit locks, and request deduplication.
   =========================================== */

// --- Timeout Configuration ---
const FETCH_TIMEOUTS = {
    quick: 6000,     // Quick lookups (check-submission, verify)
    load: 10000,     // Data loads (documents, dashboard)
    mutate: 15000,   // Write operations (save, send, approve)
    slow: 20000      // Heavy operations (bulk import, AI classification)
};

// --- Fetch With Timeout ---

/**
 * Fetch with an AbortSignal timeout.
 * @param {string} url
 * @param {RequestInit} [options={}]
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUTS.load) {
    const signal = AbortSignal.timeout(timeoutMs);

    // If caller already has a signal, use the one that aborts first
    if (options.signal) {
        const combined = AbortSignal.any([options.signal, signal]);
        options = { ...options, signal: combined };
    } else {
        options = { ...options, signal };
    }

    return fetch(url, options);
}

// --- Retry With Backoff ---

/**
 * Retry a function with exponential backoff + jitter.
 * Only retries on transient errors (network, timeout, 5xx).
 * @param {Function} fn - Async function to retry. Must return a Response.
 * @param {Object} [options]
 * @param {number} [options.maxRetries=2]
 * @param {number} [options.baseDelay=1000]
 * @param {number} [options.maxDelay=5000]
 * @returns {Promise<Response>}
 */
async function retryWithBackoff(fn, { maxRetries = 2, baseDelay = 1000, maxDelay = 5000 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fn();
            // Don't retry client errors (4xx) — they won't change
            if (response.ok || (response.status >= 400 && response.status < 500)) {
                return response;
            }
            // 5xx: retry
            lastError = new Error(`HTTP ${response.status}`);
            lastError.response = response;
        } catch (error) {
            lastError = error;
            // Don't retry non-transient errors
            if (!_isRetryable(error)) throw error;
        }

        if (attempt < maxRetries) {
            const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
            const jitter = delay * 0.5 * Math.random();
            await _sleep(delay + jitter);
        }
    }
    throw lastError;
}

function _isRetryable(error) {
    // Network errors and timeouts are retryable
    if (error instanceof TypeError) return true; // fetch network error
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
    return false;
}

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Circuit Breaker ---

class CircuitBreaker {
    /**
     * @param {Object} [options]
     * @param {number} [options.threshold=4] - Failures before opening
     * @param {number} [options.resetTimeout=20000] - ms before half-open
     */
    constructor({ threshold = 4, resetTimeout = 20000 } = {}) {
        this.threshold = threshold;
        this.resetTimeout = resetTimeout;
        this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
    }

    /**
     * Execute a function through the circuit breaker.
     * @param {Function} fn - Async function to execute
     * @returns {Promise<*>}
     */
    async call(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
                this.state = 'HALF_OPEN';
            } else {
                const err = new Error('Circuit breaker is OPEN');
                err.name = 'CircuitOpenError';
                throw err;
            }
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (error) {
            this._onFailure();
            throw error;
        }
    }

    _onSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.state = 'CLOSED';
        }
        this.failureCount = 0;
    }

    _onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
            return;
        }

        if (this.failureCount >= this.threshold) {
            this.state = 'OPEN';
        }
    }

    getState() {
        if (this.state === 'OPEN' && Date.now() - this.lastFailureTime >= this.resetTimeout) {
            return 'HALF_OPEN';
        }
        return this.state;
    }
}

// Shared circuit breaker instance for the n8n API
const apiCircuitBreaker = new CircuitBreaker({ threshold: 4, resetTimeout: 20000 });

// --- Submit Lock (Double-Submit Prevention) ---

/**
 * Create a submit lock for a button.
 * Returns a guard function that wraps async operations.
 * @param {HTMLButtonElement} button - The button to lock
 * @param {Object} [options]
 * @param {string} [options.loadingText] - Text to show while locked
 * @returns {Function} guard(asyncFn) - Wraps an async function with lock
 */
function createSubmitLock(button, { loadingText } = {}) {
    let locked = false;

    return async function guard(asyncFn) {
        if (locked) return;
        locked = true;

        const originalText = button.textContent;
        const originalHtml = button.innerHTML;
        button.disabled = true;
        button.classList.add('is-loading');
        if (loadingText) button.textContent = loadingText;

        try {
            return await asyncFn();
        } finally {
            locked = false;
            button.disabled = false;
            button.classList.remove('is-loading');
            if (loadingText) button.innerHTML = originalHtml;
        }
    };
}

// --- Request Deduplication (GET only) ---

const _inflightRequests = new Map();

/**
 * Deduplicate identical GET requests.
 * If an identical request is already in-flight, returns the same promise.
 * @param {string} url
 * @param {RequestInit} [options={}]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
async function deduplicatedFetch(url, options = {}, timeoutMs) {
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET') {
        return fetchWithTimeout(url, options, timeoutMs);
    }

    if (_inflightRequests.has(url)) {
        return _inflightRequests.get(url);
    }

    const promise = fetchWithTimeout(url, options, timeoutMs)
        .finally(() => _inflightRequests.delete(url));

    _inflightRequests.set(url, promise);
    return promise;
}

// --- Session Storage Cache (for view-documents) ---

const CACHE_PREFIX = 'ar_cache_';

/**
 * Cache a response in sessionStorage.
 * @param {string} key - Cache key
 * @param {*} data - Data to cache (will be JSON-stringified)
 */
function cacheResponse(key, data) {
    try {
        sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
            data,
            cachedAt: Date.now()
        }));
    } catch (e) {
        // sessionStorage full or unavailable — ignore
    }
}

/**
 * Get cached response from sessionStorage.
 * @param {string} key - Cache key
 * @param {number} [maxAge=300000] - Max cache age in ms (default 5 min)
 * @returns {{ data: *, cachedAt: number } | null}
 */
function getCachedResponse(key, maxAge = 300000) {
    try {
        const raw = sessionStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (Date.now() - cached.cachedAt > maxAge) {
            sessionStorage.removeItem(CACHE_PREFIX + key);
            return null;
        }
        return cached;
    } catch (e) {
        return null;
    }
}
