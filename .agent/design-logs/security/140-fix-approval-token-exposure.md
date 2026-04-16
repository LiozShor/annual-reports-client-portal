# Design Log 140: Fix Approval Token Secret Exposure (C-1)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-10
**Related Logs:** DL-090 (HMAC Token Architecture), DL-092 (Approve & Send Duplicate Prevention), DL-094 (Security Monitoring), DL-105 (Inline Approve & Send)

## 1. Context & Problem

Pre-production safety audit (SAFETY-AUDIT-2026-03-10.md) found the **#1 critical vulnerability**: the approval token secret `MOSHE_1710` is hardcoded in `document-manager.js:1756`, visible to anyone who views page source. An attacker can compute valid approval tokens for ANY report_id and trigger emails to any client.

The approval flow has two entry points:
1. **Admin panel** (document-manager.js) — uses `fetch()` with hash token in query params — **THIS IS THE EXPOSURE**
2. **Office email** (approve-confirm.html) — token generated server-side by WF[02], submitted via GET form — secret not exposed through this path, but same weak hash

## 2. User Requirements

1. **Q:** Bearer token via fetch() or keep GET link?
   **A:** Bearer token via fetch() — reuses existing admin auth pattern.

2. **Q:** Keep approve-confirm.html or direct call from admin panel?
   **A:** Direct call only. No intermediate confirmation page needed.

3. **Q:** Scope — C-1 only or also H-1/H-2?
   **A:** C-1 only. Other issues in separate design logs.

## 3. Research

### Domain
Web Application Security — Client-Side Secret Exposure (CWE-798), Bearer Token Authentication

### Sources Consulted
1. **OWASP CWE-798** — Client-side secrecy is impossible. No obfuscation helps. Only mitigation: move secrets server-side entirely.
2. **RFC 6750 (OAuth 2.0 Bearer Tokens)** — Authorization header is preferred over query parameters. URLs get logged, leak via Referer, get cached.
3. **OWASP CSRF Prevention** — Bearer tokens in Authorization headers are inherently CSRF-immune (browsers don't auto-attach them). Custom headers trigger CORS preflight which blocks cross-origin forgery.

### Key Principles Extracted
- **Move secret to server-side entirely** — delete from client JS, no obfuscation
- **Authorization header > query params** — for security and CORS benefits
- **Bearer token = CSRF-immune** — no additional CSRF protection needed
- **CORS update required** — adding `Authorization` header triggers preflight; must add to `Access-Control-Allow-Headers`

### Patterns to Use
- **Reuse existing admin Bearer pattern:** `document-manager.js` already uses `Authorization: Bearer ${ADMIN_TOKEN}` for 10+ other endpoints. Approval should use the same pattern.
- **Dual-auth transition:** WF[03] accepts EITHER Bearer token OR hash token, so office email links (approve-confirm.html) still work during transition.

### Anti-Patterns to Avoid
- **Don't just obfuscate the secret** — any client-side approach is fundamentally broken
- **Don't break the email flow** — approve-confirm.html uses server-generated tokens, which aren't exposed. Don't break it as collateral damage.

### Research Verdict
Switch admin panel approval to Bearer token auth (existing pattern). Keep hash auth as a secondary path for backward compatibility with office email links. Rotate the WEBHOOK_SECRET in Global Config so the exposed `MOSHE_1710` is invalidated.

## 4. Codebase Analysis

### Existing Solutions Found
- Admin Bearer token auth is already implemented in 10+ endpoints in `document-manager.js`
- WF[03] already has a JSON response branch (`respond=json`) added in DL-105
- Admin auth validation exists in `[Admin] Auth & Verify` workflow

### Reuse Decision
- **Reuse:** Bearer token pattern from other admin endpoints (header format, error handling)
- **Reuse:** WF[03]'s existing JSON response branch
- **New:** Add Bearer token validation to WF[03]'s "Verify Token" Code node (alongside existing hash validation)

### Relevant Files
| File | Role |
|------|------|
| `github/.../assets/js/document-manager.js` | Admin panel — approval call (lines 1710-1786) |
| `github/.../approve-confirm.html` | Email-based approval page (keep working) |
| WF[03] `cNxUgCHLPZrrqLLa` — "Verify Token" node | Server-side token validation |
| WF[03] — Respond to Webhook nodes | CORS headers need `Authorization` added |

### Alignment with Research
Current Bearer token usage in the codebase follows RFC 6750 correctly (Authorization header). Adding approval to this pattern is consistent.

## 5. Technical Constraints & Risks

* **Security:** Must rotate the WEBHOOK_SECRET in Global Config (Airtable `system_config` table) since `MOSHE_1710` is now compromised (in git history).
* **CORS:** Adding `Authorization` header to approval requests triggers preflight. Must update `Access-Control-Allow-Headers` on ALL Respond to Webhook nodes in WF[03] to include `Authorization`.
* **Breaking Changes:** Office email "Approve & Send" links use approve-confirm.html with hash tokens generated server-side. These MUST keep working — WF[03] must accept both auth methods.
* **Risk:** If CORS headers are wrong, the admin panel approval will silently fail with a CORS error. Test thoroughly.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

1. **Delete `generateApprovalToken()` and `MOSHE_1710`** from document-manager.js
2. **Update `approveAndSendToClient()`** to use `fetch()` with Bearer token (POST) instead of GET with hash
3. **Update WF[03] "Verify Token" node** to accept EITHER:
   - `Authorization: Bearer {admin_token}` → validate via HMAC-SHA256 (same as other admin endpoints)
   - `?token={hash}` → validate via existing hash logic (backward compat for email links)
4. **Update WF[03] CORS headers** — add `Authorization` to `Access-Control-Allow-Headers` on JSON response nodes
5. **Rotate WEBHOOK_SECRET** in Global Config (Airtable) to invalidate the compromised `MOSHE_1710`
6. **Add security logging** for approval events (AUTH_SUCCESS/AUTH_FAIL)

### Data Flow (After Fix)

```
Admin Panel → fetch(POST, {Authorization: Bearer ADMIN_TOKEN, body: {report_id}})
    → WF[03] Webhook
    → Verify Token: check Bearer header → validate admin HMAC
    → Process approval → Send email → Respond {ok: true}

Office Email → approve-confirm.html?report_id=X&token=HASH
    → Form GET submit to WF[03]
    → Verify Token: no Bearer → check ?token param → validate hash
    → Process approval → Redirect to approve-confirm.html?result=success
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `github/.../assets/js/document-manager.js` | Modify | Delete `generateApprovalToken()`, update `approveAndSendToClient()` to use Bearer token POST |
| WF[03] "Verify Token" Code node | Modify | Add Bearer token validation path alongside existing hash validation |
| WF[03] "JSON Success" Respond node | Modify | Add `Authorization` to `Access-Control-Allow-Headers` |
| WF[03] "JSON Error" Respond node | Modify | Add `Authorization` to `Access-Control-Allow-Headers` |
| Airtable `system_config` | Modify | Rotate WEBHOOK_SECRET value |

### document-manager.js Changes (Detailed)

**Delete** (lines 1710-1722): entire `generateApprovalToken()` function

**Replace** (lines 1756-1757):
```javascript
// OLD:
const token = generateApprovalToken(REPORT_ID, 'MOSHE_1710');
const url = `${ENDPOINTS.APPROVE_AND_SEND}?report_id=${REPORT_ID}&token=${token}&confirm=1&respond=json`;
// ...
const res = await fetchWithTimeout(url, {}, FETCH_TIMEOUTS.mutate);
```
```javascript
// NEW:
const res = await fetchWithTimeout(ENDPOINTS.APPROVE_AND_SEND, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_TOKEN}`
    },
    body: JSON.stringify({ report_id: REPORT_ID, confirm: true })
}, FETCH_TIMEOUTS.mutate);
```

### WF[03] "Verify Token" Code Node Changes (Detailed)

Add Bearer token check at the top of the existing validation logic:
```javascript
// --- AUTH: Accept either Bearer admin token or hash approval token ---
const authHeader = $input.item.json.headers?.authorization || '';
const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);

if (bearerMatch) {
    // Admin Bearer token path (from document-manager.js)
    const adminToken = bearerMatch[1];
    // Validate admin HMAC token (same logic as other admin endpoints)
    const SECRET_KEY = '...'; // from Global Config
    // ... decode base64 payload, verify HMAC, check expiry ...
    // If valid: extract report_id from body/query, continue
    // If invalid: throw 401
} else {
    // Hash token path (from approve-confirm.html email links)
    // ... existing hash validation logic (unchanged) ...
}
```

### WF[03] Webhook Node Change

Current webhook is GET. Need to also accept POST for the Bearer token path. Check if n8n webhook node supports both methods, or add a second webhook trigger for POST.

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan

* [ ] **Test 1 — Admin panel approval:** Click "Approve & Send" in document-manager.html. Verify email is sent, response is `{ok: true}`, button shows success state.
* [ ] **Test 2 — CORS preflight:** Open browser DevTools → Network tab. Verify OPTIONS preflight request to `/approve-and-send` returns 200 with correct `Access-Control-Allow-Headers: Content-Type, Authorization`.
* [ ] **Test 3 — Office email link still works:** Open an existing approve-confirm.html link from a test office email. Verify it still loads and can submit (hash path still works).
* [ ] **Test 4 — Old token rejected:** Try the old URL format with a hash computed using `MOSHE_1710`. Verify it's rejected (secret was rotated).
* [ ] **Test 5 — Unauthorized rejection:** Try calling `/approve-and-send` without any token. Verify 401 response.
* [ ] **Test 6 — Cross-report rejection:** Try calling with a valid admin token but someone else's report_id. Verify it processes correctly (admin tokens are not report-scoped by design).
* [ ] **Test 7 — Security log:** After test 1, check `security_logs` Airtable table for an `AUTH_SUCCESS` event for the approval.
* [ ] **Test 8 — Source code clean:** Search `document-manager.js` for `MOSHE_1710` — verify zero matches.

## 8. Implementation Notes (Post-Code)
* **Deviation from plan:** Used GET (not POST) with Bearer token. Webhook node doesn't support multi-method — kept GET and put admin token in Authorization header. This avoids adding a second webhook node. GET + Authorization header triggers CORS preflight, handled by n8n cloud automatically for existing webhooks.
* **Secret rotated:** `MOSHE_1710` → new random secret in Global Config node.
* **Verify Token code:** Added dual-auth at top of existing node — Bearer path validates HMAC-SHA256 admin token (same logic as `[Admin] Auth & Verify`), hash path unchanged for email link backward compat.
* **CORS headers:** Added `Authorization` to `Access-Control-Allow-Headers` on both JSON Success and JSON Error respond nodes.
