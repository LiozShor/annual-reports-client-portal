# Error Handling Research Summary

## 1. Stability Patterns (from "Release It!" by Michael Nygard)

### Circuit Breaker
Monitors API calls for failures. After a threshold (e.g., 3 failures), the circuit "opens" and immediately rejects new requests without attempting them, giving the server time to recover. After a cooldown, a single "probe" request tests recovery. **Directly applicable** — the portal calls n8n webhooks that depend on Airtable and Microsoft Graph. When n8n is down, a circuit breaker stops users from staring at spinners.

### Bulkhead
Isolates failure domains so one failing endpoint can't take down the whole page. In a browser context: use separate concurrency limits per API endpoint group. If `/get-client-documents` is slow, the landing page's `/check-existing-submission` should still work.

### Timeout
**The single most important pattern.** Every `fetch()` must have a timeout. Without one, a hung n8n server creates a hung UI. Use `AbortSignal.timeout()` on every request. Set per-endpoint timeouts (5s for quick lookups, 15s for operations that trigger emails).

### Fail-Fast
Validate everything locally before making API calls: check URL parameters, check `navigator.onLine`, check circuit breaker state. Move failure detection as close to the user as possible.

**Key takeaway:** These patterns compose — fail-fast guard > bulkhead > circuit breaker > timeout-wrapped fetch. Each layer catches a different failure class.

---

## 2. UX Error Handling (Krug, Google Material, Nielsen Norman Group)

### Steve Krug — "Don't Make Me Think"
- **Reservoir of Goodwill:** Every frustrating error drains it. For accounting clients dealing with tax obligations, goodwill is precious.
- **Self-evident design:** Error states must be immediately understandable without thinking.
- **Recovery paths:** Never leave users at a dead end. Always offer a next action.

### Google Material Design
- **Three error types:** User input errors (inline), app errors (dialogs/banners), incompatible state errors (dialogs).
- **Summary + inline pattern:** Show a top-level summary AND individual field-level errors.
- **Color + icon + text weight:** Never rely on color alone for error indication.

### Nielsen Norman Group — The Four Qualities
1. **Visible** — The user must notice the error
2. **Precise** — State exactly what went wrong
3. **Constructive** — Offer a specific fix with low interaction cost
4. **Polite** — Never blame the user

**Reading level:** Error text should be at 7th-8th grade reading level.

**Anti-patterns to avoid:**
- Blame language ("You entered invalid data")
- Terms "invalid", "illegal", "incorrect"
- Generic "Something went wrong"
- Clearing user input on error
- Toast/snackbar for critical errors (disappears before user reads it)

---

## 3. Stripe's Error UX (Financial Context)

### Two-Layer Error Architecture
- **Internal errors:** For logging/debugging (never shown to users)
- **User-facing messages:** Safe to display, actionable, specific

### Payment Recovery (Dunning) Pattern
Directly relevant to our monthly reminder system:
- Polite, non-confrontational tone
- Specific about what's missing
- Direct link to resolve (one click)
- Progressive timing (24h, then regular intervals)
- 38% recovery rate with smart retries + automated emails

---

## 4. Web Resilience Patterns (web.dev, MDN, real-world implementations)

### Fetch Error Handling
- `fetch()` does NOT reject on HTTP errors — only on network failures
- Always check `response.ok` explicitly
- Distinguish `AbortError` (timeout) from `TypeError` (network) from HTTP errors

### Retry with Exponential Backoff
- Formula: `delay = min(baseDelay * 2^attempt + jitter, maxDelay)`
- Never retry 4xx errors (permanent failures)
- Only retry network errors and 5xx (transient failures)
- Max 2-3 retries for user-facing operations

### Offline Detection
- `navigator.onLine === false` is reliable for "definitely offline"
- `navigator.onLine === true` is NOT reliable (could be on WiFi with no internet)
- Use browser events + periodic health check probes

### Request Deduplication
- **UI layer:** Disable buttons during async operations
- **Network layer:** If same GET is already in-flight, return existing promise
- **Server layer:** Idempotency keys for POST mutations

### Loading State Transitions
Best practice: `idle -> loading -> (success | timeout-warning | error)`
- Show skeleton/spinner immediately
- After 5s: "Taking longer than expected..."
- After timeout: Show error with retry button
- Never show infinite spinner

---

## 5. Bilingual/RTL Considerations

### RTL Error Patterns
- Error icons go to the RIGHT of text (mirrored from LTR)
- Use CSS logical properties (`margin-inline-start` not `margin-left`)
- Email addresses and URLs stay LTR even in RTL context
- Hebrew has no uppercase — use bold/color for emphasis, never caps

### Bilingual Error Messages
- Detect language from user's questionnaire preference
- Show errors in the user's language only (don't mix)
- Hebrew text may be shorter/longer than English — design flexible containers
- Increase RTL font size by ~2pt for visual balance

---

## 6. Real-World Implementations

### GitHub
- Skeleton screens matching final layout
- Failed API calls show inline "Retry" links — no page reload
- Error isolation: one failed widget doesn't crash the page

### Notion
- Local-first with sync — UI reads from local storage, syncs to server
- Subtle connectivity indicator (not disruptive modals)
- Optimistic UI — actions applied locally immediately

### Linear
- Local-first architecture with instant transitions
- Background sync indicator in status bar
- Batch sync on connectivity recovery

---

## Ranked List: Most Impactful Improvements for This Portal

| Rank | Improvement | Impact | Effort |
|------|-------------|--------|--------|
| 1 | Add timeouts to ALL fetch calls | Eliminates infinite spinners | S |
| 2 | Proper error state UI (not just text) | User trust, recovery paths | M |
| 3 | Double-submit prevention | Prevents duplicate operations | S |
| 4 | Loading timeout escalation | UX during slow responses | S |
| 5 | Offline detection banner | User knows what's happening | S |
| 6 | Bilingual error messages everywhere | Consistent UX for all clients | M |
| 7 | Retry with backoff for transient failures | Recovers from blips automatically | M |
| 8 | Circuit breaker for repeated failures | Prevents hammering dead server | M |
| 9 | `<noscript>` fallback for JS-dependent pages | Graceful degradation | S |
| 10 | Centralized error handler module | Consistency across all pages | L |
