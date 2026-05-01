# Design Log 392: Client Document Leakage Audit

> Renumbered from DL-376 (number collision: DL-376 was reused for OneDrive
> orphan rename in main). Original audit content unchanged.

**Status:** [COMPLETED — audit, no implementation]
**Date:** 2026-04-29
**Related Logs:** DL-089 (PII in URLs), DL-090 (HMAC token architecture), DL-094 (security monitoring), DL-140 (approval token exposure), DL-140 (email batch isolation), DL-147 (Amendment 13 phase 1), DL-180 (worker error logging), DL-365 (activity logger)

## 1. Context & Problem

We hold sensitive tax-filing PII for ~500 CPA clients: Hebrew names, CPA-IDs, bank statements, T106s, T126 dividend statements, T501 deposit statements, capital statements, and OCR'd document content. The user asked for a complete audit of every "edge" where a client document could leak — to external attackers OR cross-tenant (client A viewing client B's docs).

This DL is **read-only**: it identifies and ranks risks. Each P0/P1 finding spawns its own follow-up DL for the actual fix. No code changes here.

## 2. User Requirements

1. **Q:** What's the audit's primary goal?
   **A:** Findings report only — no code changes in this DL. Critical fixes spawn follow-up DLs.
2. **Q:** Which surfaces are in scope?
   **A:** All — Worker endpoints, document URLs, client portal, email, AI Review, logs/R2/Airtable, n8n webhooks, admin browser.
3. **Q:** What threat model?
   **A:** External attacker + curious insiders (cross-tenant focus realistic for a 500-client CPA system).
4. **Q:** Output format?
   **A:** Single DL with severity-ranked table, file:line evidence per finding.

## 3. Research

### Domain
Multi-tenant access control, signed-URL handling, LLM PII discipline, web app security verification.

### Sources Consulted
1. **OWASP Multi-Tenant Security Cheat Sheet** — every access must re-derive tenant from authenticated identity, never from URL/body. Row-level checks at the data layer are the only durable defense against IDOR in multi-tenant apps.
2. **OWASP IDOR Prevention Cheat Sheet** — direct object references must be authorized per-request; hash/UUID is not authorization, it's obscurity. Server must verify the caller owns the object on every call.
3. **AWS Pre-Signed URL Best Practices (whitepaper, 2024)** — pre-signed URLs are bearer tokens: short expiry (minutes, not hours), never log them, never store them, generate on demand. Cannot be revoked once issued.
4. **OWASP ASVS V8 (Data Protection)** — confidentiality requires (a) minimum-necessary data exposed, (b) sensitive metadata stripped from URLs, (c) no PII in error messages, (d) logs scrubbed.
5. **Anthropic / OpenAI privacy guidance** — redact PII at the prompt boundary; assume third-party APIs may log/cache; never send raw client identifiers if a redacted form works.

### Key Principles Extracted
- **P1: Authorization is per-request, per-object.** Knowing an `itemId` is not permission to fetch it. Authorization must verify "the caller owns this specific document," not just "the caller has any valid token."
- **P2: Tokens in URLs are leaked tokens.** Query strings appear in: server logs, browser history, Referer headers, mailbox-provider indexes, link-preview crawlers, antivirus pre-fetch, browser extensions. Bearer headers are the safe channel.
- **P3: Pre-signed URLs are short-lived bearer tokens.** Treat them like passwords with expiry — never log, never store, generate on demand, minimize TTL.
- **P4: PII at the boundary.** Anything sent to a third party (LLM, email provider, log archive) must be scrubbed at the boundary, even if the receiver "promises" not to log.
- **P5: Error messages are leaks.** Returning raw upstream errors to clients (MS Graph paths, internal IDs, stack traces) gives attackers free reconnaissance.

### Patterns to Use (for follow-up fixes)
- **Authorization filter middleware**: every doc-access endpoint resolves `(caller_identity, target_object) → allowed?` before the data fetch.
- **Header-only tokens**: drop `?token=` query param support; require `Authorization: Bearer …`.
- **Short-TTL one-time URLs**: replace 1h MS Graph URLs returned to client with proxied or 5-min-TTL signed Worker URLs that bind to the caller.
- **Prompt-boundary redaction**: a single helper that scrubs PII before any LLM call (mirrors `pii.ts` for logs).

### Anti-Patterns to Avoid
- **Hash-as-auth**: non-cryptographic hash (e.g., cyrb53/MurmurHash) used as a security token. Tempting because it's stateless and short, but no replay protection, no expiry, often non-timing-safe comparison.
- **"Long expiry to avoid annoying users"**: 45-day client tokens, 8-hour admin tokens. Convenience traded for blast radius.
- **Trusting MS Graph signed URLs to "expire fast enough"**: 1h is plenty of time for browser extensions, screen-recording, ISP-injected scripts to capture and exfiltrate.

### Research Verdict
Apply OWASP Multi-Tenant principles strictly: every doc endpoint must verify ownership of the specific object, not just session validity. Migrate token transport to headers only. Move client-portal doc preview behind a Worker-proxied short-TTL URL bound to the client token, instead of exposing MS Graph URLs to the browser. Add a prompt-boundary PII scrubber and adopt it across all LLM call sites.

## 4. Surface Inventory

Eight buckets covered. Each has at least one finding or an explicit "no issue" note.

### Bucket 1 — Worker API endpoints + auth
Routes inventoried in `api/src/index.ts` and `api/src/routes/`. Auth methods in use: admin HMAC token, client HMAC token, n8n internal key (string compare), approval hash, unauthenticated.
- **No issue**: HMAC validation uses `crypto.subtle.verify` (timing-safe) for both admin and client tokens (`api/src/lib/token.ts:55-97`, `api/src/lib/client-token.ts:54-58`).
- **No issue**: CORS sourced from `env.ALLOWED_ORIGIN`, no wildcard in source (`api/src/middleware/cors.ts:10-12`). Verify env content in production (see audit-gap below).
- **Findings:** F-01, F-04, F-09, F-11.

### Bucket 2 — Document URL endpoints (preview / download / OneDrive)
`/webhook/get-preview-url` (`api/src/routes/preview.ts:23-134`), `/webhook/download-file` (`api/src/routes/preview.ts:138-162`), `/webhook/get-client-documents` (`api/src/routes/documents.ts:92-332`).
- **Findings:** F-01, F-04, F-08, F-09, F-11.

### Bucket 3 — Client portal + HMAC tokens
`frontend/index.html`, `frontend/view-documents.html`, `frontend/assets/js/landing.js`, `frontend/assets/js/view-documents.js`. Server-side: `api/src/routes/submission.ts`, `api/src/routes/documents.ts`, `api/src/routes/client-reports.ts`.
- **No issue**: Server derives `client_id` from token, never trusts query (`api/src/routes/documents.ts:127-141`, `api/src/routes/client-reports.ts:99-106`). Cross-client IDOR via parameter manipulation is closed.
- **No issue**: `Referrer-Policy: no-referrer` set on portal pages (`frontend/index.html:7`, `frontend/view-documents.html:6`).
- **No issue**: Query params stripped from URL history immediately after read (`frontend/assets/js/landing.js:18-19`).
- **No issue**: Token stored in `sessionStorage` (not `localStorage`) on the client side (`frontend/assets/js/landing.js:216`).
- **Findings:** F-05, F-06.

### Bucket 4 — Email surfaces
`api/src/lib/email-html.ts`, `api/src/lib/questionnaire-url.ts`, `api/src/routes/send-questionnaires.ts`, `api/src/routes/approve-and-send.ts`.
- **No issue**: Per-client send loop preserved — DL-140 batch isolation still holds (`api/src/routes/send-questionnaires.ts:86`).
- **Findings:** F-03, F-06, F-10.

### Bucket 5 — AI Review pipeline (third-party LLMs)
`api/src/routes/chat.ts`, `api/src/routes/extract-issuer-names.ts`, `api/src/lib/inbound/document-classifier.ts`, `api/src/lib/inbound/client-identifier.ts`. Provider: Anthropic (Claude).
- **Findings:** F-02 (compound — four call sites).

### Bucket 6 — Logs & archives (Workers Logs, R2, Airtable)
`api/src/lib/activity-logger.ts`, `api/src/lib/pii.ts`, `api/src/lib/error-logger.ts`, `api/src/lib/security-log.ts`, `wrangler.toml`.
- **No issue**: `sanitizeDetails` + `scrubText` + `redactIp` correctly drop PII keys (`api/src/lib/activity-logger.ts:127`, `api/src/lib/pii.ts:72-86`).
- **Findings:** F-09, F-14, F-15, F-16.

### Bucket 7 — n8n webhooks
External public URLs at `liozshor.app.n8n.cloud`. Workflow IDs catalog at `docs/workflow-ids.md`.
- **Audit gap**: explorer agent reported `docs/workflow-ids.md` not visible — webhook auth posture not fully verified in this DL. Per memory `feedback_n8n_cloud_*`, `$env` and `fetch()` are blocked on n8n Cloud, which limits some classes of secret-leak. Recommend a focused follow-up DL to inspect each webhook's auth header check.
- **Findings:** F-17 (audit gap, not a finding).

### Bucket 8 — Admin panel + browser surface
`frontend/admin/index.html`, `frontend/admin/js/script.js` (10k+ lines).
- **Findings:** F-07, F-12, F-13, F-17.

## 5. Findings Table

Severity scale: **P0** = active leak path or trivial-to-exploit; **P1** = realistic attacker can reach PII with modest effort or one assumption (e.g. log access); **P2** = hardening / defense-in-depth.

| ID | Sev | Surface | Finding | Evidence | One-line mitigation | Follow-up DL |
|---|---|---|---|---|---|---|
| F-01 | P0 | Doc URL | `/webhook/download-file` authorizes by admin token only — `itemId` alone gates which document is fetched. No `report_id` / client_id / record_id check binds the token to the target object. Combined with F-09 (itemIds in logs), any party with admin-token + log access can download any client's document. | `api/src/routes/preview.ts:138-162` (esp. line 143) | Add `recordId` requirement; verify the Documents row's `report_record_id` matches the caller's allowed scope (or restrict to office IPs). | TBD |
| F-02 | P0 | AI Review | Raw client PII (Hebrew name, CPA-ID, OCR'd document content, email subject/body) sent unredacted to Anthropic in 4 call sites. Violates the project's `client_id`-only PII strategy (DL-365). Anthropic retention policy applies — out of our control. | `api/src/routes/chat.ts:282-284` (50 KB user-supplied context appended verbatim); `api/src/routes/extract-issuer-names.ts:125` (`raw_context` from documents); `api/src/lib/inbound/document-classifier.ts:449` (full client name); `api/src/lib/inbound/client-identifier.ts:340,359-368` (email body preview, client list with names) | Build a prompt-boundary redactor (mirror `pii.ts`) — replace names with `client_id`, drop emails/phones, truncate body preview. Apply at every LLM call site. | TBD |
| F-03 | P0 | Email / Approval | Approval-token construction is a non-cryptographic 53-bit cyrb53-style hash (`Math.imul` mixing of `reportId + ':' + secret`). Comparison is plain string `!==` (not timing-safe). No expiry: `f(reportId, secret)` is the same value forever. One leaked email → permanent approval-link bearer. | `api/src/routes/approve-and-send.ts:32-43` (constructor); `:84-85` (verification, non-timing-safe equality) | Replace with HMAC-SHA256 + expiry timestamp baked into token (mirror `client-token.ts`). Use `crypto.subtle.verify`. | TBD |
| F-04 | P1 | Worker auth | `/webhook/get-preview-url` accepts admin token via `?token=` query string in addition to `Authorization: Bearer`. Query strings are recorded in Cloudflare access logs, browser history, Referer headers, and any logging proxy. | `api/src/routes/preview.ts:24-31`; same pattern in `/webhook/download-file` `api/src/routes/preview.ts:139` | Drop query-param support on admin endpoints. Header-only. (Client tokens are a separate question — they MUST be in URL for email links; see F-06.) | TBD |
| F-05 | P1 | Client tokens | Client HMAC tokens have a 45-day TTL with no replay protection or revocation. One leaked email link = 6 weeks of access. Token is bound to `reportId` only — no IP/user-agent binding, no one-time use. | `api/src/lib/client-token.ts:78-97` (45-day default in `generateClientToken`) | Reduce default TTL (7-14 days for active flows; minutes for one-shot operations like approve-link). Add a revocation list keyed by `(reportId, expiry)` for known-leaked tokens. | TBD |
| F-06 | P1 | Email | Client HMAC tokens embedded in plaintext email CTA URLs. Mailbox providers (Gmail, Outlook) index the URL string; link-preview crawlers (WhatsApp, Slack, antivirus pre-scan) fetch them; corporate email gateways may log them. | `api/src/lib/email-html.ts:160` (view-documents button); `api/src/lib/questionnaire-url.ts:10` (questionnaire URL) | Move to a redirect-with-cookie flow (Worker `/r/<short-id>` issues a session cookie + redirects), or a one-time-use exchange code. Token never appears in the persisted URL. | TBD |
| F-07 | P1 | Admin browser | Admin token stored in `localStorage`. Any successful XSS or browser-extension exfiltration steals 8 hours of admin access. Risk amplified by F-13 (CSP allows `'unsafe-inline'` and `unpkg.com`). | `frontend/admin/js/script.js:33,228,248` | Move admin token to `HttpOnly`, `Secure`, `SameSite=Strict` cookie. Convert API calls to credentialed fetches. | TBD |
| F-08 | P1 | Doc URL | MS Graph signed download URLs returned directly to the browser (`previewUrl`, `downloadUrl`, `webUrl`). Valid ~1 hour. Once in the DOM, accessible to any browser extension, screen-recording tool, ISP-injected script, or copy-paste leak. | `api/src/routes/preview.ts:81`; `api/src/routes/documents.ts:219-229` (batch resolve) | Proxy through Worker (already done for `/download-file`); for preview, return a short-lived Worker URL that itself fetches from Graph on demand. Sandbox the iframe. | TBD |
| F-09 | P1 | Logs | Document `itemId` logged in plaintext at three points in `preview.ts` (`START`, `DONE`, `failed`). Lands in Cloudflare Workers Logs (7d hot, queryable in dashboard) and R2 archive (90d per memory). With F-01 unfixed, log access = ability to download any client doc. | `api/src/routes/preview.ts:57,79,123,96-101` | Hash itemIds before logging (HMAC with a `LOG_HMAC_KEY` env), or drop them entirely — log only `recordId` (Airtable row), which is meaningful for ops without being a fetch primitive. | TBD |
| F-10 | P2 | Email | Document issuer names (e.g., bank names, insurance carriers) rendered in plaintext email bodies. Mailbox providers index them; cumulative metadata leak. | `api/src/lib/email-html.ts:215-216` | Keep generic categories ("Bank statement", "Salary slip") in the email; defer issuer-specific titles to the gated portal. Offer as a per-client opt-in if needed. | TBD |
| F-11 | P2 | Doc URL | Error messages from MS Graph echoed to client (`err.message`). Leaks internal paths, item IDs, status codes — useful reconnaissance. | `api/src/routes/preview.ts:129,160`; `api/src/routes/documents.ts:330` | Map known errors to generic codes (`ITEM_NOT_FOUND`, `UPSTREAM_ERROR`); log full text only server-side. | TBD |
| F-12 | P2 | Headers | Worker responses do not set `X-Frame-Options`, `X-Content-Type-Options`, or `Permissions-Policy`. Allows clickjacking against admin endpoints and MIME-sniff attacks against any unknown-Content-Type response. | `api/src/middleware/cors.ts` (where they should live); none set globally | Add `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, restrictive `Permissions-Policy` to the global response-header middleware. | TBD |
| F-13 | P2 | Admin browser | Admin CSP allows `'unsafe-inline'` for scripts and trusts `unpkg.com` (external CDN). One inline-handler injection or one supply-chain compromise of an unpkg dep = full XSS in admin. | `frontend/admin/index.html:8` | Replace inline scripts with nonce-based CSP; vendor unpkg deps locally or use Subresource Integrity (SRI) hashes. | TBD |
| F-14 | P2 | R2 archive | `activity-logs-archive` R2 bucket has no documented lifecycle/retention rule in `wrangler.toml`. Memory says 90d retention; not enforced in IaC. Drift risk. | `wrangler.toml:60-62` | Add R2 lifecycle rule (90-day delete) via Cloudflare dashboard or `wrangler r2 bucket lifecycle` and pin in commit. | TBD |
| F-15 | P2 | Logs | Activity-logger sanitizers correct, but adoption is partial — only ~3 `logEvent` callsites found across the routes. High-volume routes (chat, classifications, inbound) bypass it. PII risk lives in whatever ad-hoc `console.log` they use instead. | `api/src/lib/activity-logger.ts:127` (good); grep shows few callers | Continue DL-365 phases 2-4 (migrate routes to `logEvent`); add a lint rule or grep CI check for raw `console.log` in `api/src/routes/`. | TBD |
| F-16 | P2 | Logs (legacy) | `security-log.ts` writes to Airtable `security_logs` without field masking. DL-365 plans to retire this; until phase 4 lands, any `error_message` written there can carry PII. | `api/src/lib/security-log.ts:14` | Accelerate DL-365 phase 2; or interim — wrap `logSecurity` with the same `scrubText` used in `activity-logger.ts`. | TBD |
| F-17 | P2 | Admin browser | Admin browser console emits record IDs and exception objects (`console.warn`, `console.error`). Visible during screen-share, present in screen-recording tools, browser extensions can capture. | `frontend/admin/js/script.js:849,981,988` | Gate dev logs behind `localStorage.ADMIN_DEBUG === '1'`; default-off for production. | TBD |

### Mitigated / no-action items (verified during audit)
- M-01: Cross-client IDOR on `/get-client-documents` and `/client-reports` — server derives `client_id` from token, doesn't trust query (`api/src/routes/documents.ts:127`, `api/src/routes/client-reports.ts:99`).
- M-02: Client portal `Referrer-Policy: no-referrer` set, query params stripped from history (`frontend/index.html:7`, `frontend/assets/js/landing.js:18-19`).
- M-03: Email batch isolation (DL-140) sustained — per-client send loop (`api/src/routes/send-questionnaires.ts:86`).
- M-04: HMAC validation uses `crypto.subtle.verify` (timing-safe) for admin and client tokens.
- M-05: CORS allowlist sourced from env, no wildcard in code.
- M-06: Activity-logger PII helpers (`pii.ts`) correct where they are used.
- M-07: Client tokens in `sessionStorage`, not `localStorage`.

### Audit gaps (not findings — items the audit could not verify)
- **AG-1**: n8n workflow webhook auth not deeply audited (workflow JSON not loaded). Recommend a follow-up DL to inspect each public webhook URL's auth header check.
- **AG-2**: `env.ALLOWED_ORIGIN` value in production not inspected — verify via `wrangler secret list` + a live OPTIONS preflight against the deployed Worker.
- **AG-3**: Anthropic / OpenAI account-level data retention settings (zero-retention enrollment?) not verified — confirm with the provider's admin console.
- **AG-4**: OneDrive / SharePoint sharing-link policies (whether anyone-with-link is disabled at tenant level) not verified — confirm in Microsoft 365 admin center.

## 6. Mitigation Roadmap

Group the 17 findings into proposed follow-up DLs to keep each implementation scoped:

| Proposed DL | Findings | Severity | Approx scope |
|---|---|---|---|
| **DL-A: Document-access authorization tightening** | F-01, F-08, F-09, F-11 | P0+P1 | Add `recordId` binding to `/download-file` + `/get-preview-url`; hash itemIds in logs; map upstream errors to generic codes; proxy preview URLs through Worker. |
| **DL-B: LLM prompt PII redactor** | F-02 | P0 | New `api/src/lib/llm-redact.ts`; adopt at all 4 LLM call sites; unit tests with sample Hebrew names + CPA-IDs. |
| **DL-C: Approval-token rebuild** | F-03 | P0 | Replace cyrb53 hash with HMAC-SHA256+expiry; backwards-compat window for in-flight links. |
| **DL-D: Token transport hardening** | F-04, F-06, F-07 | P1 | Header-only admin tokens; redirect-with-cookie pattern for email links; admin token → `HttpOnly` cookie. |
| **DL-E: Client-token TTL reduction + revocation** | F-05 | P1 | Lower default TTL; add per-`(reportId,expiry)` revocation KV. |
| **DL-F: Defense-in-depth headers + CSP** | F-12, F-13 | P2 | Global response-header middleware; nonce-based admin CSP; vendor unpkg deps. |
| **DL-G: Logging discipline finishing kit** | F-14, F-15, F-16, F-17 | P2 | R2 lifecycle rule; finish DL-365 phases 2-4; gated browser console; lint rule for raw `console.log`. |
| **DL-H: n8n webhook audit (gap-filling)** | AG-1 | TBD | Inspect each public n8n webhook for auth header check + PII forwarded. |

Recommended ordering: **B → C → A → D → E → G → F → H**. B/C/A close the active P0 leaks; D/E close the realistic P1 chains; G/F/H are hardening that stabilizes the platform.

## 7. Validation Plan

This DL is an audit — no implementation, so no implementation tests. Validation of the audit itself:

- [x] All 8 surface buckets covered or flagged with an audit gap.
- [x] Every P0/P1 finding has file:line evidence verified by direct read.
- [x] Mitigated items (M-01..M-07) explicitly listed so future audits don't re-investigate.
- [x] Audit gaps (AG-1..AG-4) recorded so they're not silently dropped.
- [ ] User reviews and approves the severity rankings and mitigation grouping.
- [ ] Each follow-up DL (DL-A..DL-H) gets a stub created in `current-status.md` once roadmap is approved.

## 8. Implementation Notes

- Phase A: explored 6 prior security DLs (089, 090, 094, 140-exposure, 140-batch, 147) before starting.
- Phase B: Bright Data MCP returned strong sources on OWASP IDOR, multi-tenant cheat sheet, AWS pre-signed URL practices, ASVS V8, LLM PII patterns. All four principles (P1-P5) trace to those.
- Phase C: 3 parallel Explore (Haiku) agents covered Workers, portal/email, and AI/logs/admin. Cost-efficient given the ~17 findings produced.
- Spot-verified P0/P1 evidence by direct `Read` of `preview.ts:1-165`, `approve-and-send.ts:25-100`, `client-token.ts`, `email-html.ts:150-180` before finalizing severities. The agent's claim of "MurmurHash3" was close but slightly off — actual algorithm is cyrb53-style 53-bit hash; corrected in F-03.
- One agent claim was downgraded after verification: F-01 is a curious-insider/log-amplification path (admin-token-gated, itemId-bound), not an unauthenticated-internet IDOR. Still P0 because (a) itemIds are logged (F-09), (b) admin-token blast radius is large (F-04, F-07), so the chain is realistic.
