# Design Log 170: Cloudflare Workers — Read-Only Endpoints (Phase 2)
**Status:** [COMPLETED]
**Date:** 2026-03-23
**Related Logs:** DL-169 (Phase 1 — Auth POC, COMPLETED)

## 1. Context & Problem
Phase 1 proved the stack (auth: 18ms vs 2-3s). Phase 2 migrates the 4 read-only endpoints — the most-felt latency since they fire on every tab switch and page load. Dashboard alone takes 3-5s on n8n.

## 2. User Requirements
1. **Q:** Build client auth now or defer Check Existing Submission?
   **A:** Build it now — all 4 endpoints together.
2. **Q:** Format Questionnaire as separate module or inline?
   **A:** Separate module (`lib/format-questionnaire.ts`).
3. **Q:** Deploy all 4 at once or one at a time?
   **A:** All at once.

## 3. Research
### Domain
See DL-169 for Cloudflare Workers + Hono research. Incremental: Airtable pagination for large datasets.

### Key Principles (from DL-169)
- Web Crypto API for HMAC — `crypto.subtle.verify()` is timing-safe
- `waitUntil()` for fire-and-forget logging
- `Promise.all()` replaces n8n Merge nodes for parallel queries

### Patterns to Use
- **Parallel Airtable queries:** `Promise.all([listRecords(...), listRecords(...)])` for dashboard
- **Shared helpers:** Extract `logSecurity`/`getClientIp` into `lib/security-log.ts`
- **Module per concern:** `client-token.ts`, `format-questionnaire.ts`

## 4. Codebase Analysis
### Existing Solutions
- `lib/token.ts` — Admin HMAC token (reuse `importKey`, `hexToBuf` helpers)
- `lib/airtable.ts` — `listRecords`, `getRecord`, `createRecords` (all needed)
- `middleware/auth.ts` — Admin auth middleware (reuse for dashboard, pending)
- `routes/auth.ts` — Pattern for `logSecurity`, `getClientIp` (extract to shared)

### Dependencies
- Airtable tables: `annual_reports` (tbls7m3hmHC4hhQVy), `questionnaires` (tblxEox8MsbliwTZI), `documents` (tblcwptR63skeODPn)
- New secret: `CLIENT_SECRET_KEY`

## 5. Technical Constraints & Risks
- **Airtable pagination:** Default 100 records/page. Dashboard has 600+ clients — need pagination loop or maxRecords. `listRecords` must handle `offset` pagination.
- **Sub-workflow inlining:** Format Questionnaire logic (120 lines) ported directly — no sub-workflow concept in Workers.
- **Client token format:** Different from admin (`expiryUnix.hmacHex` vs `base64JSON.hmacHex`). Separate module.

## 6. Proposed Solution
See plan file: `C:\Users\liozm\.claude\plans\jazzy-launching-cook.md`

### Files to Create
| File | Description |
|------|-------------|
| `src/lib/client-token.ts` | Client HMAC token verification (45d, unix seconds) |
| `src/lib/format-questionnaire.ts` | Port SUB Format Questionnaire logic |
| `src/lib/security-log.ts` | Shared logSecurity + getClientIp helpers |
| `src/routes/dashboard.ts` | GET /webhook/admin-dashboard |
| `src/routes/pending.ts` | GET /webhook/admin-pending |
| `src/routes/questionnaires.ts` | GET /webhook/admin-questionnaires |
| `src/routes/submission.ts` | GET /webhook/check-existing-submission |

### Files to Modify
| File | Change |
|------|--------|
| `src/lib/types.ts` | Add CLIENT_SECRET_KEY to Env |
| `src/index.ts` | Mount 4 new routes |
| `src/routes/auth.ts` | Use shared security-log helpers |
| `wrangler.toml` | Document CLIENT_SECRET_KEY |
| `shared/endpoints.js` | Switch 4 endpoints to CF_BASE |

## 7. Validation Plan
- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] Dashboard: stats match n8n, all clients present, review queue correct
- [ ] Dashboard: `available_years` includes all years
- [ ] Dashboard: Hebrew name sorting works
- [ ] Pending: only Send_Questionnaire + active clients returned
- [ ] Questionnaires: Q&A formatting matches n8n exactly
- [ ] Questionnaires: `client_questions` field enriched
- [ ] Questionnaires: token via query param works
- [ ] Check Existing Submission: client token validates
- [ ] Check Existing Submission: `has_submission` logic correct
- [ ] Check Existing Submission: filing type config returned
- [ ] CORS headers on all responses
- [ ] Side-by-side JSON diff Worker vs n8n for each endpoint
- [ ] Frontend: dashboard loads, tabs switch, login persists
- [ ] Latency: dashboard < 1s from Israel

## 8. Implementation Notes (Post-Code)
* Added `listAllRecords()` to Airtable client for auto-pagination (follows offset)
* Extracted `logSecurity`/`getClientIp` into shared `lib/security-log.ts`
* Dashboard: 289-304ms (was 3-5s), verify: 64ms, auth: 18ms
* First request per session ~1.5s due to cold DNS+TLS — unavoidable for new domain
* Token invalidated after redeploy — normal (Worker secrets re-bound to new version)
* All endpoints verified working in production by user
