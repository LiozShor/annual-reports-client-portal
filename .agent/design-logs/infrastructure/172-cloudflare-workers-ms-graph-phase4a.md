# Design Log 172: Cloudflare Workers — MS Graph Endpoints Phase 4a
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-23
**Related Logs:** DL-169 (auth scaffold), DL-170 (read endpoints), DL-171 (write endpoints)

## 1. Context & Problem
Phases 1-3 migrated 13/22 admin endpoints from n8n to Cloudflare Workers (3-10x latency improvement). The remaining 9 endpoints include 4 that require MS Graph API access for OneDrive file operations. Phase 4a migrates the two simpler MS Graph endpoints:
- `get-preview-url` — OneDrive preview + download URLs
- `get-client-documents` — the largest endpoint (~1050 lines), powering both client and admin document views

This introduces the first external OAuth2 dependency in the Worker.

## 2. User Requirements
*Q&A from discovery phase:*
1. **Q:** OAuth2 approach — Worker manages tokens directly (KV cache) or proxy through n8n?
   **A:** Worker manages tokens directly (Option A). User will provide MS Graph credentials.

2. **Q:** Start with get-preview-url first (prove MS Graph works) or both together?
   **A:** Both together in one phase.

3. **Q:** Port the ~1050-line Build Response as-is or refactor into modules?
   **A:** Refactor into modules (doc-builder.ts with clear functions). Easier to test and reuse in Phase 4b.

4. **Q:** Use subagent-driven development or direct implementation?
   **A:** Subagent-driven development (implementer + spec/quality reviewers per task).

## 3. Research
### Domain
OAuth2 token management on edge runtimes, MS Graph API batch operations, document URL lifecycle

### Sources Consulted
1. **Cloudflare KV Documentation** — KV has no atomic operations; minimum cacheTtl reduced to 30s (Jan 2026). Eventual consistency: up to 60s for global propagation.
2. **MS Graph JSON Batching Docs** — Hard limit: 20 requests per batch. Each sub-request individually throttled. Batch returns 200 even on partial failures — must check each response's `status`.
3. **MS Graph downloadUrl/preview lifecycle** — Download URLs last ~1 hour (undocumented, community consensus). Preview URLs last ~5 minutes. Neither should be cached for reuse.

### Key Principles Extracted
- **Token refresh race condition is real but manageable** — at ~1 concurrent admin user, a simple KV lock pattern (not Durable Objects) suffices. Set lock TTL to 30s as safety valve.
- **Refresh token rotation** — MS Graph may return a new refresh token on each refresh. Must store the latest in KV; fallback to env var for initial value.
- **Batch partial failures** — never assume batch success. Check each response individually. Skip failed items gracefully.
- **Preview/download URLs are ephemeral** — always fetch on-demand, never cache in Airtable or KV.

### Patterns to Use
- **Lock key pattern:** Write `ms_graph_refreshing` flag to KV (TTL: 30s) before refresh. Other requests wait + retry. Delete lock after refresh completes.
- **Layered token read:** KV cached access token → KV refresh token (rotated) → env var refresh token (initial seed)
- **Modular doc builder:** Extract grouping/categorization into pure functions for testability and reuse in Phase 4b (get-pending-classifications).

### Anti-Patterns to Avoid
- **Durable Objects for token management** — overkill for single-admin-user system. Adds complexity and cost.
- **Caching preview/download URLs** — they expire in minutes. Always resolve on-demand.
- **Monolithic handler** — the n8n Build Response is 1050 lines. Refactoring into focused functions prevents the same problem in the Worker.

### Research Verdict
Use KV-based token management with simple lock pattern. Refactor the response builder into a doc-builder module with typed pure functions. MS Graph batch for URL resolution capped at 20 items (matching current behavior).

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `AirtableClient` (airtable.ts) — full CRUD client, reuse as-is
  - `verifyClientToken` (client-token.ts) — client token auth, reuse
  - `authMiddleware` (middleware/auth.ts) — admin token auth, reuse
  - `logSecurity` (security-log.ts) — fire-and-forget security logging, reuse
  - Route pattern (submission.ts) — established Hono route pattern with query params, error handling
* **Reuse Decision:** All existing lib modules reused. New modules: ms-graph-token.ts, ms-graph.ts, doc-builder.ts
* **Relevant Files:** wrangler.toml, types.ts, index.ts, airtable.ts, client-token.ts, auth.ts
* **Existing Patterns:** Routes export Hono sub-apps, mounted via `app.route('/webhook', ...)`. Auth via Bearer header or `?token=` query. Fire-and-forget logging via `ctx.waitUntil()`.
* **Alignment with Research:** Codebase already uses `ctx.waitUntil()` for async work (matches pattern for token refresh lock cleanup).

## 5. Technical Constraints & Risks
* **Security:** MS Graph refresh token is a high-value secret. Store in KV (encrypted at rest by Cloudflare). Initial seed from Worker secret.
* **Risks:**
  - Refresh token extraction from n8n — may need to re-authenticate via Azure AD if n8n doesn't expose it
  - Client secret identification — two candidates in secure_keys.txt, need to determine which one
  - Response shape mismatch — ~1050 lines of logic must produce identical JSON to n8n
* **Breaking Changes:** None — frontend only changes endpoint URLs in endpoints.js. Rollback = revert URLs.

## 6. Proposed Solution (The Blueprint)
### Task Breakdown (Subagent-Driven)

| # | Task | New Files | Modified Files | Complexity |
|---|------|-----------|---------------|------------|
| 1 | Infrastructure (KV, secrets, types) | — | wrangler.toml, types.ts | Simple |
| 2 | MS Graph Token Manager | ms-graph-token.ts | — | Medium |
| 3 | MS Graph Client | ms-graph.ts | — | Medium |
| 4 | Get Preview URL Route | routes/preview.ts | index.ts | Simple |
| 5 | Document Builder Module | lib/doc-builder.ts | — | Hard |
| 6 | Get Client Documents Route | routes/documents.ts | index.ts | Hard |

### Execution Order
1 → 2 → 3 → 4 (proves MS Graph works) → 5 → 6

Tasks 4 and 5 are independent but serialized for subagent safety.

### Post-Implementation
- Update `shared/endpoints.js` (2 URLs)
- `wrangler deploy`
- End-to-end testing

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/wrangler.toml` | Modify | Add KV namespace binding |
| `api/src/lib/types.ts` | Modify | Add MS Graph secrets + KV to Env |
| `api/src/lib/ms-graph-token.ts` | Create | OAuth2 token refresh + KV cache |
| `api/src/lib/ms-graph.ts` | Create | MS Graph REST client (batch, get, post, patch) |
| `api/src/lib/doc-builder.ts` | Create | Document grouping/categorization module |
| `api/src/routes/preview.ts` | Create | GET preview URL handler |
| `api/src/routes/documents.ts` | Create | GET client documents handler |
| `api/src/index.ts` | Modify | Mount 2 new routes |
| `github/.../shared/endpoints.js` | Modify | Switch 2 URLs to CF_BASE |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan
* [ ] MS Graph token refresh works (first call + cached subsequent calls)
* [ ] Token refresh lock prevents thundering herd
* [ ] Refresh token rotation stored in KV
* [ ] Get Preview URL: returns previewUrl + downloadUrl for valid OneDrive item
* [ ] Get Preview URL: invalid itemId returns clear error
* [ ] Get Preview URL: response shape matches n8n (JSON diff)
* [ ] Get Client Documents (client mode): grouped docs with safe fields only
* [ ] Get Client Documents (client mode): Waived/Removed filtered out
* [ ] Get Client Documents (office mode): all docs + templates + categories + notes
* [ ] Get Client Documents (office mode): requires Bearer admin token
* [ ] Category sort order matches Airtable sort_order
* [ ] Help text variables replaced ({year}, {company_name}, {company_url})
* [ ] Company links resolved from aliases
* [ ] OneDrive URLs resolved via MS Graph batch (max 20)
* [ ] Response shape matches n8n exactly for both modes (JSON diff)
* [ ] Client token auth works (45-day expiry, timing-safe)
* [ ] Frontend: document-manager.html loads via Worker
* [ ] Frontend: view-documents.html loads via Worker
* [ ] Frontend: preview panel works (click preview → opens)
* [ ] No regression: existing n8n endpoint still functional (rollback path)

## 8. Implementation Notes (Post-Code)
* KV minimum expirationTtl is 60s, not 30s — lock TTL updated
* Preview endpoint needed GET support (frontend uses GET with query params, not POST)
* Office mode field names: n8n returns `name`/`person_label`/`cat.name` (Hebrew-only), not `name_he`/`person_label_he`/`cat.name_he` — fixed in `formatForOfficeMode`
* Subagent-driven development worked well — 4 implementer agents (Tasks 2-6), all passed TypeScript checks
* MS Graph token refresh confirmed working via KV caching (633ms first call with token refresh, 205ms cached)
* Performance: get-client-documents 655-975ms (was 3-5s), get-preview-url 205-633ms (was 2-3s)
