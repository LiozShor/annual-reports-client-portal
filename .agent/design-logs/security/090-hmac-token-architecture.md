# Design Log 090: Security Phase 4 — HMAC Token Architecture
**Status:** [COMPLETED]
**Date:** 2026-03-04
**Related Logs:** None (first security design log; references `tmp/security-implementation-plan.md`)

## 1. Context & Problem

The system uses two token types with fundamental weaknesses:
- **Client tokens** (`questionnaire_token`): Static strings that never expire. If an email is forwarded or leaked, the attacker gets permanent access to the client's document list.
- **Admin tokens**: Already HMAC-signed with 24h expiry, but transmitted as `?token=` in URL query params for all GET requests (8 endpoints). URLs leak via browser history, proxy logs, and Referer headers. Additionally, `localStorage` key is the HMAC secret itself, and a `sessionStorage` bypass skips server-side verification entirely.

**SEC items addressed:** SEC-005, SEC-010, SEC-013, SEC-017, SEC-019

## 2. User Requirements

1. **Q:** Migration period for old static tokens?
   **A:** System is not in production yet — clean cutover, no dual-accept needed.

2. **Q:** Admin token inactivity timeout?
   **A:** 8 hours (one workday).

3. **Q:** Server-side verification frequency?
   **A:** Login only — verify once at login, trust localStorage after. Client-side expiry check as UX guard.

4. **Q:** Token scope for client tokens?
   **A:** Report-scoped — HMAC signs `report_id + expiry`, so a token for report A can't access report B.

## 3. Research

### Domain
Web Application Token Security, HMAC-based Authentication, Webhook Security

### Sources Consulted
1. **Prismatic: Securing Webhook Endpoints with HMAC** — HMAC-SHA256 is the standard for webhook auth; use timing-safe comparison, hex encoding for URL safety
2. **GitGuardian: HMAC Secrets Explained** — "Use HMAC when you control both ends" — applies directly (n8n generates + validates)
3. **Cloudflare: Token Authentication** — Token format `timestamp.signature` is the established pattern for URL-based token auth
4. **OWASP Session Management Cheat Sheet** — Server-side expiry enforcement is mandatory; client-side is UX only. 4-8h absolute timeout for admin sessions.
5. **MDN: CORS** — `Authorization` header triggers OPTIONS preflight; n8n Cloud may or may not handle it
6. **n8n Community: CORS Preflight** — n8n Cloud users report mixed results with custom headers in CORS

### Key Principles Extracted
- **HMAC > JWT** when both endpoints are controlled by the same system (no need for portable claims)
- **Server-side expiry mandatory** — client checks are UX convenience, not security
- **`crypto.timingSafeEqual()` mandatory** — standard `===` leaks timing information for byte-by-byte brute force
- **Hex encoding over base64** for URL tokens — no encoding issues with `+`, `/`, `=`
- **Scope binding** — the resource ID (report_id) MUST be part of the signed message to prevent cross-resource attacks

### Patterns to Use
- **Token format:** `{expiry_unix}.{hex_hmac_sha256(scope.expiry, secret)}`
- **Canonical string:** Fixed delimiter (`.`) between fields, deterministic construction
- **Dual-read extraction:** Accept token from Authorization header first, fall back to query param (transition period)

### Anti-Patterns to Avoid
- **Never use `===` for signature comparison** — timing side-channel attack
- **Never omit scope from signature** — allows cross-resource token reuse
- **Never use MD5/SHA-1** — SHA-256 only
- **Never rely solely on client-side expiry** — trivially bypassed

### Research Verdict
Use HMAC-SHA256 tokens with `expiry.hex_sig` format. Client tokens are report-scoped (30-day expiry). Admin tokens keep existing format but move to Authorization header and reduce to 8h expiry. The existing `Get Client Documents` endpoint already accepts `Authorization: Bearer` from the admin panel, proving n8n Cloud handles CORS preflight correctly for our domain.

## 4. Codebase Analysis

### Relevant Files
- **`admin/js/script.js`** (lines 1-100): Auth flow, 6 GET endpoints with `?token=` in URL, `checkAuth()` session bypass
- **`admin/document-types-viewer.html`** (line 302, 393): Duplicated auth logic, `?token=` in admin-verify call
- **`admin/questionnaire-mapping-editor.html`** (line 676, 789): Same duplication
- **`assets/js/landing.js`** (lines 6-22): Client token from URL, stored in sessionStorage
- **`assets/js/view-documents.js`** (lines 52-82): Dual-source token (sessionStorage client + localStorage admin)
- **`assets/js/document-manager.js`** (lines 15, 1269): Admin token from localStorage (hardcoded key)

### Existing Patterns
- Admin HMAC already exists: `base64(JSON{exp}).hex_sig` format, validated by `verifyHmacToken()` in n8n Code nodes
- `Authorization: Bearer` already works for one endpoint (Get Client Documents in office mode, line 630 of script.js)
- Client tokens: simple `===` string comparison against Airtable `questionnaire_token` field

### Alignment with Research
- Admin token signing ✅ (already HMAC-SHA256)
- Admin token transport ❌ (URL query params, not headers)
- Client tokens ❌ (static, no HMAC, no expiry)
- Timing-safe comparison ❌ (uses `===` in at least the existing `verifyHmacToken`)
- Session bypass ❌ (SEC-017 — skips verification entirely)

### Dependencies
- 6 frontend files need localStorage key rename
- ~10 n8n workflows need token extraction changes
- 3 client-facing n8n workflows need HMAC validation
- WF[01] + WF[06] need HMAC token generation

## 5. Technical Constraints & Risks

- **n8n Starter plan**: No `$vars` — secrets must stay in Code nodes
- **n8n Cloud CORS**: `Authorization` header triggers preflight. Already proven working for one endpoint (`Get Client Documents`). Low risk but will verify.
- **Airtable formula fields**: `questionnaire_link_he/en` formulas use static `questionnaire_token`. After HMAC switch, these produce invalid links. Acceptable — admin panel is the official way to send links.
- **Breaking change**: Old static tokens stop working immediately. Not an issue (system not in production).

## 6. Proposed Solution (The Blueprint)

### Overview
4 sub-phases, each independently deployable:
- **4A**: Admin token hardening (8h expiry, session bypass fix, localStorage key rename)
- **4B**: Admin GET endpoints → Authorization header
- **4C**: Client HMAC token generation (WF[01], WF[06])
- **4D**: Client HMAC token validation + frontend expiry handling

### Token Formats

**Client token (NEW):**
```
Format:  {expiry_unix}.{hex_hmac_sha256}
Signed:  HMAC-SHA256(report_id + "." + expiry_unix, CLIENT_SECRET)
Expiry:  30 days
Example: 1743724800.a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2
```

**Admin token (EXISTING FORMAT, modified expiry):**
```
Format:  {base64_json}.{hex_hmac_sha256}
Signed:  HMAC-SHA256(base64({"exp": unix_ms}), ADMIN_SECRET)
Expiry:  8 hours (was 24h)
Transport: Authorization: Bearer header (was URL query param)
```

### Sub-Phase 4A: Admin Token Hardening

| # | File/Workflow | Action | Description |
|---|---------------|--------|-------------|
| 1 | n8n Auth workflow | Modify | Change expiry `24*60*60*1000` → `8*60*60*1000` |
| 2 | `admin/js/script.js` | Modify | Add `isTokenExpired()` check in `checkAuth()`, add expiry check before session bypass |
| 3 | All 6 frontend files | Modify | Rename `ADMIN_TOKEN_KEY` from HMAC secret to `'admin_token'`, add one-time migration |

**`isTokenExpired()` helper (add to script.js, both HTML files):**
```javascript
function isTokenExpired(token) {
    if (!token) return true;
    try {
        const [payloadB64] = token.split('.');
        const payload = JSON.parse(atob(payloadB64));
        return !payload.exp || Date.now() > payload.exp;
    } catch (e) { return true; }
}
```

**Updated `checkAuth()` pattern:**
```javascript
async function checkAuth() {
    if (!authToken) return;
    // SEC-019: Client-side expiry check
    if (isTokenExpired(authToken)) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_FLAG_KEY);
        authToken = '';
        return;
    }
    // SEC-017: Session bypass allowed only after expiry check
    if (sessionStorage.getItem(SESSION_FLAG_KEY) === 'true') { ... }
    // New tab/window — verify with API (unchanged)
    ...
}
```

### Sub-Phase 4B: Admin Token → Authorization Header

**n8n side (5+ GET webhook workflows):** Update token extraction in Code nodes:
```javascript
// Accept Authorization header, fall back to query param
const headers = $input.first().json.headers || {};
const authHeader = headers.authorization || headers.Authorization || '';
const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
const token = bearerToken || $input.first().json.query?.token || '';
```

**Frontend side:** Replace `?token=${authToken}` with `Authorization: Bearer` header.

| Line | Current URL | New pattern |
|------|-------------|-------------|
| script.js:92 | `admin-verify?token=${authToken}` | `admin-verify` + Bearer header |
| script.js:145 | `admin-dashboard?token=${authToken}&year=...` | `admin-dashboard?year=...` + Bearer header |
| script.js:738 | `get-pending-classifications?token=${authToken}` | `get-pending-classifications` + Bearer header |
| script.js:1003 | `admin-pending?token=${authToken}&year=...` | `admin-pending?year=...` + Bearer header |
| script.js:1509 | `get-preview-url?token=${authToken}&itemId=...` | `get-preview-url?itemId=...` + Bearer header |
| script.js:1601 | `get-pending-classifications?token=${authToken}` | Same as line 738 |
| document-types-viewer.html:393 | `admin-verify?token=${authToken}` | `admin-verify` + Bearer header |
| questionnaire-mapping-editor.html:789 | `admin-verify?token=${authToken}` | `admin-verify` + Bearer header |

**Also update POST endpoints** to send token in body (most already do) rather than having `token` as a separate top-level field. This is already the current pattern — no change needed.

### Sub-Phase 4C: Client HMAC Token Generation

**Shared utility code (embed in n8n Code nodes):**
```javascript
const crypto = require('crypto');
const CLIENT_TOKEN_SECRET = '<generated-secret>'; // crypto.randomBytes(48).toString('base64')
const CLIENT_TOKEN_EXPIRY_DAYS = 30;

function generateClientToken(reportId) {
    const expiryUnix = Math.floor(Date.now() / 1000) + (CLIENT_TOKEN_EXPIRY_DAYS * 24 * 60 * 60);
    const message = `${reportId}.${expiryUnix}`;
    const sig = crypto.createHmac('sha256', CLIENT_TOKEN_SECRET).update(message).digest('hex');
    return `${expiryUnix}.${sig}`;
}

function validateClientToken(reportId, token) {
    if (!token || !reportId) return { valid: false, error: 'MISSING_TOKEN' };
    const dotIdx = token.indexOf('.');
    if (dotIdx === -1) return { valid: false, error: 'MALFORMED_TOKEN' };
    const expiryStr = token.substring(0, dotIdx);
    const sig = token.substring(dotIdx + 1);
    const expiryUnix = parseInt(expiryStr, 10);
    if (isNaN(expiryUnix)) return { valid: false, error: 'MALFORMED_TOKEN' };
    if (Math.floor(Date.now() / 1000) > expiryUnix) return { valid: false, error: 'TOKEN_EXPIRED' };
    const message = `${reportId}.${expiryUnix}`;
    const expected = crypto.createHmac('sha256', CLIENT_TOKEN_SECRET).update(message).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return { valid: false, error: 'INVALID_TOKEN' };
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return { valid: false, error: 'INVALID_TOKEN' };
    return { valid: true };
}
```

**WF[01] Send Questionnaires** (`9rGj2qWyvGWVf9jXhv7cy`): Replace static `questionnaire_token` lookup with `generateClientToken(report.id)` when building email URLs.

**WF[06] Reminder Scheduler** (`FjisCdmWc4ef0qSV`): Same — generate fresh HMAC token in reminder email URLs.

### Sub-Phase 4D: Client HMAC Token Validation + Frontend

**n8n workflows to update (3):**

| Workflow | ID | Current validation | New validation |
|----------|----|--------------------|----------------|
| Check Existing Submission | `QVCYbvHetc0HybWI` | `token === questionnaire_token` | `validateClientToken(report_id, token)` |
| Get Client Documents | `Ym389Q4fso0UpEZq` | `clientToken === storedToken` | `validateClientToken(report_id, token)` |
| Reset Submission | `ZTigIbycpt0ldemO` | `token === questionnaire_token` | `validateClientToken(report_id, token)` |

**Frontend error handling:**
- `landing.js`: Detect `TOKEN_EXPIRED` error → show bilingual "link expired, contact office" message
- `view-documents.js`: Same pattern for document loading errors

### Workflows NOT in workflow-ids.md (need discovery)
These admin-facing workflows serve GET endpoints but aren't documented:
- Admin Auth & Verify: `REInXxiZ-O6cxvldci3co`
- Admin Dashboard: `AueLKVnkdNUorWVYfGUMG` (from session 53 notes)
- Admin Pending: likely same workflow as Dashboard (different webhook path)

Will discover IDs via `n8n_list_workflows` during implementation.

### Files to Change

| File | Sub-Phase | Action | Description |
|------|-----------|--------|-------------|
| `admin/js/script.js` | 4A, 4B | Modify | Key rename, expiry check, session fix, Auth header on 6 GETs |
| `admin/document-types-viewer.html` | 4A, 4B | Modify | Key rename, expiry check, Auth header on verify |
| `admin/questionnaire-mapping-editor.html` | 4A, 4B | Modify | Key rename, expiry check, Auth header on verify |
| `assets/js/view-documents.js` | 4A, 4D | Modify | Key rename, expiry error handling |
| `assets/js/document-manager.js` | 4A | Modify | Key rename (2 locations) |
| `assets/js/landing.js` | 4D | Modify | Expiry error handling |
| n8n Auth workflow | 4A | Modify | 24h → 8h expiry |
| n8n 5+ GET workflows | 4B | Modify | Accept Authorization header |
| n8n WF[01] | 4C | Modify | Generate HMAC client tokens |
| n8n WF[06] | 4C | Modify | Generate HMAC client tokens |
| n8n 3 client workflows | 4D | Modify | HMAC validation |

## 7. Validation Plan

### Sub-Phase 4A
- [ ] Login → new token has 8h expiry (decode base64 payload, check `exp`)
- [ ] Open new tab → `checkAuth()` verifies with server, sets session flag
- [ ] Same tab navigate → session flag trusted (no API call)
- [ ] Manually set expired token in localStorage → client-side check catches it, shows login
- [ ] `localStorage` key is `admin_token` (not the HMAC secret)
- [ ] Old key auto-migrated to new key on first load

### Sub-Phase 4B
- [ ] All admin GET endpoints work with Authorization header
- [ ] DevTools Network tab → no `?token=` in any admin URL
- [ ] document-types-viewer.html auth works with Bearer header
- [ ] questionnaire-mapping-editor.html auth works with Bearer header

### Sub-Phase 4C
- [ ] Send questionnaire to test client → email link contains HMAC token (format: `{unix_ts}.{64hex}`)
- [ ] Send reminder → same HMAC format in URL

### Sub-Phase 4D
- [ ] Landing page with valid HMAC token → shows existing submission data
- [ ] Landing page with expired token → shows bilingual "link expired" message
- [ ] Landing page with tampered token → shows generic error
- [ ] Landing page with token from a different report_id → rejected
- [ ] View documents with valid HMAC token → loads correctly
- [ ] Reset submission with valid HMAC token → resets
- [ ] Old static token → rejected

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
