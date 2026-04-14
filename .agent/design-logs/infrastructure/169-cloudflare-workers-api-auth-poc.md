# Design Log 169: Cloudflare Workers API — Auth Endpoints POC
**Status:** [COMPLETED]
**Date:** 2026-03-23
**Related Logs:** DL-090 (HMAC Token Architecture), DL-167 (Skeleton Loading — Perceived Performance)

## 1. Context & Problem

Every action in the admin portal takes 2-5 seconds because every request follows:
`Browser (Israel) → n8n Cloud (Frankfurt) → Airtable API (US) → back`.

The n8n cold start adds 200-800ms, plus the Frankfurt round-trip from Israel is ~80ms each way. By moving to Cloudflare Workers (edge in Tel Aviv), we eliminate both — targeting ~100-300ms for auth and ~400-800ms for data reads.

**Strategy:** Endpoint-by-endpoint migration. The frontend has a single `shared/endpoints.js` where all 22 webhook URLs are defined. For each migrated endpoint, we swap the URL there. n8n stays for async orchestration (emails, scheduled jobs).

**This POC:** Scaffold the Workers project + migrate the two auth endpoints (`admin-auth`, `admin-verify`) as proof of concept.

## 2. User Requirements

1. **Q:** Do you have a Cloudflare account?
   **A:** Already have one.

2. **Q:** What Workers subdomain?
   **A:** `moshe-atsits` → `annual-reports-api.moshe-atsits.workers.dev`

3. **Q:** Allow localhost for local dev?
   **A:** Production origin only (`https://liozshor.github.io`).

4. **Q:** Include SECRET_KEY in files?
   **A:** Omit from all files. Only document `wrangler secret put` in README.

## 3. Research

### Domain
Edge Computing, API Migration, Web Crypto API, Cloudflare Workers Architecture

### Sources Consulted
1. **Hono Docs (Workers)** — Use `app.route()` sub-routers for multi-route apps. Secrets via `c.env.SECRET_NAME` with typed generics. `wrangler types` auto-generates the Env interface.
2. **Cloudflare Web Crypto API** — `crypto.subtle.importKey/sign/verify` replaces Node.js `crypto.createHmac`. `crypto.subtle.verify()` is internally timing-safe — no need for separate `timingSafeEqual`. `crypto.subtle.timingSafeEqual()` exists as CF extension for raw comparisons.
3. **Cloudflare Workers Latency (Israel)** — Data centers in Tel Aviv and Haifa. Measured 86ms→29ms median latency. Workers have ~0ms cold start (V8 isolates preloaded during TLS handshake).
4. **waitUntil() Pattern** — 30 seconds background execution after response sent. Gotcha: must read request body BEFORE returning response if waitUntil needs it.

### Key Principles Extracted
- **Token compatibility is non-negotiable:** Both n8n and Worker must produce/verify identical tokens during migration. Same HMAC algorithm, same base64 encoding, same hex output.
- **Web Crypto is async:** `crypto.subtle.sign()` returns a Promise, unlike Node.js sync `createHmac()`. All token operations become `async`.
- **CORS centralized:** Hono's `cors()` middleware replaces 27 manual header configurations with one line.
- **Fire-and-forget logging:** `waitUntil()` lets us log to Airtable without delaying the response.

### Patterns to Use
- **Hono sub-routers:** One file per endpoint group, mounted via `app.route()`
- **Typed Env bindings:** TypeScript interface for all secrets/vars, auto-generated via `wrangler types`
- **waitUntil() for logging:** Non-blocking Airtable writes after response

### Anti-Patterns to Avoid
- **Don't use Node.js `crypto`:** Workers runtime doesn't have it. Must use Web Crypto API.
- **Don't use `===` for signature comparison:** Even though `crypto.subtle.verify()` is timing-safe for HMAC, if we compare hex strings manually we need `timingSafeEqual`.
- **Don't block on logging:** Airtable write latency (~200-400ms) should never delay auth responses.

### Research Verdict
Use Hono + Web Crypto API. The main technical challenge is replicating the exact Node.js HMAC token format using Web Crypto. The token format `base64(JSON).hmac_sha256_hex` is straightforward — we need:
1. `btoa(JSON.stringify(payload))` to match `Buffer.from(data).toString('base64')`
2. `crypto.subtle.sign('HMAC', key, data)` → hex string to match `crypto.createHmac().digest('hex')`

**Critical finding from n8n code review:** The Airtable PAT is hardcoded in the workflow code nodes. The Worker will properly externalize this as a secret.

**CORS gap found:** Current n8n Respond nodes only allow `Content-Type` in headers — NOT `Authorization`. This works because n8n Cloud handles OPTIONS preflight automatically. The Worker must explicitly add `Authorization` to allowed headers.

## 4. Codebase Analysis

### Existing Solutions Found
- **Token format (DL-090):** `base64(JSON).hmac_sha256_hex` — admin tokens with 8h expiry
- **`shared/endpoints.js`:** Centralized URL definitions using `API_BASE` from `constants.js`
- **`shared/constants.js`:** `API_BASE = 'https://liozshor.app.n8n.cloud/webhook'`
- **Admin auth flow (`admin/js/script.js`):** `isTokenExpired()` client-side check, `login()`, `checkAuth()`

### Reuse Decision
- Token signing/verification logic: **Port from n8n** (adapt Node.js crypto → Web Crypto)
- Endpoint URL structure: **Reuse exact paths** (`/webhook/admin-auth`, `/webhook/admin-verify`)
- CORS headers: **Centralize** in Hono middleware (replaces per-node headers)
- Airtable logging: **Port pattern** from n8n, use `waitUntil()` instead of inline await

### Relevant Files
| File | Purpose |
|------|---------|
| `REInXxiZ-O6cxvldci3co` | n8n Auth & Verify workflow — source of truth for token logic |
| `shared/endpoints.js` | Frontend endpoint URLs — will add migration comment |
| `shared/constants.js` | `API_BASE` definition — will document Worker URL |
| `admin/js/script.js` | Frontend auth flow — won't be modified |

### Dependencies
- Airtable `security_logs` table (base `appqBL5RWQN9cPOyh`)
- HMAC SECRET_KEY (must match n8n exactly)
- ADMIN_PASSWORD (must match n8n)

## 5. Technical Constraints & Risks

### Security
- **Hardcoded secrets in n8n:** The current workflow has ADMIN_PASSWORD and SECRET_KEY inline. The Worker properly externalizes these as Wrangler secrets.
- **Airtable PAT exposure:** Currently hardcoded in n8n Code nodes. Worker moves to `AIRTABLE_PAT` secret.
- **Timing-safe comparison:** Use `crypto.subtle.verify()` for HMAC (inherently timing-safe) rather than string comparison.

### Risks
- **Base64 encoding mismatch:** Node.js `Buffer.from().toString('base64')` vs browser `btoa()` handle Unicode differently. Since our payload is pure ASCII JSON, this is safe — but must verify.
- **Hex output format:** Web Crypto returns `ArrayBuffer`, not hex string. Need manual conversion: `Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')`.
- **CORS on new domain:** The Worker runs on `annual-reports-api.moshe-atsits.workers.dev` — a different origin than n8n. Frontend must be pointed to the new URL.

### Breaking Changes
- None to the frontend. Only `API_BASE` URL changes (done per-endpoint in `endpoints.js`).
- n8n workflows stay active as fallback.

## 6. Proposed Solution (The Blueprint)

### Project Structure
```
api/
├── package.json          # hono, wrangler, @cloudflare/workers-types
├── wrangler.toml         # Worker config, vars (non-secret)
├── tsconfig.json         # Strict TS for Workers
└── src/
    ├── index.ts          # Hono app entry, CORS middleware, route mounting
    ├── middleware/
    │   ├── cors.ts       # CORS for https://liozshor.github.io
    │   └── auth.ts       # Token verification middleware (for protected routes in Phase 2)
    ├── lib/
    │   ├── token.ts      # HMAC token sign/verify using Web Crypto API
    │   ├── airtable.ts   # Reusable Airtable REST client (typed)
    │   └── types.ts      # Env bindings interface, shared types
    └── routes/
        ├── auth.ts       # POST /webhook/admin-auth + GET /webhook/admin-verify
        └── _template.ts  # Template for future endpoint migrations
```

### Logic Flow

#### POST /webhook/admin-auth
1. Parse `{ password }` from JSON body
2. Compare against `env.ADMIN_PASSWORD` using timing-safe comparison
3. If mismatch → `waitUntil(logSecurity('AUTH_FAIL'))` → return `{ ok: false, error: 'Invalid password' }`
4. Generate token:
   a. Build payload: `{ exp: Date.now() + 8h, iat: Date.now(), type: 'admin' }`
   b. `JSON.stringify(payload)` → `btoa()` → base64 part
   c. `crypto.subtle.sign('HMAC', key, data)` → hex string → signature part
   d. Token = `base64.signature`
5. `waitUntil(logSecurity('AUTH_SUCCESS'))` → return `{ ok: true, token }`

#### GET /webhook/admin-verify
1. Extract token from `Authorization: Bearer <token>` header, fallback to `?token=` query
2. Split on `.` → `[dataB64, signature]`
3. Decode base64 → parse JSON → check `exp > Date.now()`
4. Recompute HMAC → compare with `crypto.subtle.verify()`
5. `waitUntil(logSecurity(...))` on failure → return `{ ok: true/false }`

### Token Compatibility (Critical)

The n8n code does:
```javascript
// Sign
const data = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
const token = Buffer.from(data).toString('base64') + '.' + signature;

// Verify
const [dataB64, signature] = token.split('.');
const data = Buffer.from(dataB64, 'base64').toString();
const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
if (signature !== expectedSig) return invalid;
```

The Worker equivalent:
```typescript
// Sign
const data = JSON.stringify(payload);
const key = await crypto.subtle.importKey('raw', encoder.encode(SECRET_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
const signature = arrayBufferToHex(sigBuf);
const token = btoa(data) + '.' + signature;

// Verify
const [dataB64, signature] = token.split('.');
const data = atob(dataB64);
const sigBuf = hexToArrayBuffer(signature);
const valid = await crypto.subtle.verify('HMAC', key, sigBuf, encoder.encode(data));
```

Note: `btoa(JSON.stringify(payload))` produces identical output to `Buffer.from(JSON.stringify(payload)).toString('base64')` for ASCII-only JSON payloads (which ours always are).

### Airtable Client (lib/airtable.ts)

Reusable typed wrapper for Phase 2:
```typescript
interface AirtableClient {
  listRecords<T>(table: string, options?: ListOptions): Promise<AirtableResponse<T>>;
  getRecord<T>(table: string, recordId: string): Promise<AirtableRecord<T>>;
  updateRecord(table: string, recordId: string, fields: Record<string, unknown>): Promise<void>;
  createRecords(table: string, records: { fields: Record<string, unknown> }[]): Promise<AirtableRecord[]>;
  batchUpdate(table: string, records: { id: string; fields: Record<string, unknown> }[]): Promise<void>;
}
```

Auth endpoints only use `createRecords` (for security logging). Full client ready for Phase 2.

### CORS Configuration
```typescript
// Hono cors middleware
cors({
  origin: env.ALLOWED_ORIGIN, // https://liozshor.github.io
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // Cache preflight for 24h
})
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/package.json` | Create | Dependencies: hono, wrangler, @cloudflare/workers-types |
| `api/wrangler.toml` | Create | Worker config, vars (ALLOWED_ORIGIN, AIRTABLE_BASE_ID) |
| `api/tsconfig.json` | Create | Strict TS config for Workers runtime |
| `api/src/index.ts` | Create | Hono app entry, CORS, route mounting |
| `api/src/middleware/cors.ts` | Create | CORS middleware config |
| `api/src/middleware/auth.ts` | Create | Token verification middleware for protected routes |
| `api/src/lib/token.ts` | Create | HMAC sign/verify using Web Crypto API |
| `api/src/lib/airtable.ts` | Create | Reusable Airtable REST client |
| `api/src/lib/types.ts` | Create | Env bindings, shared types |
| `api/src/routes/auth.ts` | Create | POST /webhook/admin-auth + GET /webhook/admin-verify |
| `api/src/routes/_template.ts` | Create | Template for future migrations |
| `api/README.md` | Create | Setup, deploy, secrets, migration status |

### Final Step
- Update design log status → `[IMPLEMENTED — NEED TESTING]`
- Copy Section 7 test items to `current-status.md`

## 7. Validation Plan
- [ ] `npm install` succeeds in `api/` directory
- [ ] `wrangler dev` starts without errors (after setting `.dev.vars`)
- [ ] POST `/webhook/admin-auth` with correct password returns `{ ok: true, token: "..." }`
- [ ] POST `/webhook/admin-auth` with wrong password returns `{ ok: false, error: "Invalid password" }`
- [ ] GET `/webhook/admin-verify` with valid token returns `{ ok: true }`
- [ ] GET `/webhook/admin-verify` with expired token returns `{ ok: false }`
- [ ] GET `/webhook/admin-verify` with tampered token returns `{ ok: false }`
- [ ] Token generated by n8n is verifiable by the Worker (cross-compatibility)
- [ ] Token generated by the Worker is verifiable by n8n (cross-compatibility)
- [ ] CORS: Preflight OPTIONS returns correct headers
- [ ] CORS: Requests from non-allowed origins are rejected
- [ ] Security logs appear in Airtable `security_logs` table after auth events
- [ ] `wrangler deploy` succeeds
- [ ] Switch `API_BASE` in frontend → admin portal login works end-to-end

## 8. Implementation Notes (Post-Code)
* Deployed to `https://annual-reports-api.liozshor1.workers.dev` (subdomain `liozshor1`, not `moshe-atsits`)
* SECRET_KEY: `printf '%s'` with `%%` caused double-percent bug — fixed by re-uploading with single `%`
* CSP fix required: added Worker domain to `connect-src` in `admin/index.html`
* First request ~800ms (DNS+TLS), subsequent requests ~18-59ms
* Measured results: admin-auth 18ms, admin-verify 59ms (down from 2-3s on n8n)
