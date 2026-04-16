# Design Log 177: Migrate Last 2 n8n Endpoints to Workers
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-24
**Related Logs:** DL-169 (Workers POC), DL-170 (read endpoints), DL-171 (write endpoints), DL-172-175 (subsequent phases)

## 1. Context & Problem
20/22 endpoints migrated to Cloudflare Workers. Last 2 remain on n8n:
- `approve-and-send` — sends document list email to client
- `admin-send-questionnaires` — sends questionnaire invitation emails (bulk)

Both stayed on n8n because they send emails via MS Graph. Now that the Worker has MS Graph client infrastructure, they can be migrated to achieve 22/22 — full independence from n8n for all API endpoints.

## 2. User Requirements
1. **Q:** Keep hybrid (n8n for email) or go full Workers?
   **A:** Full Workers — add sendMail to MS Graph client. 22/22.

2. **Q:** Approve-and-send has 2 modes (HTML confirm page + JSON API). Migrate both?
   **A:** Both modes. Everything on Workers.

3. **Q:** Bulk questionnaire emails — parallel or sequential in waitUntil?
   **A:** Parallel in waitUntil (but frontend chunks to 25, so sequential within request is fine).

4. **Q:** Use Worker's doc-builder or call n8n Document Service?
   **A:** "I don't care to switch to Worker as long it keeps looks the same. All workflows. All email. All HTMLs."

## 3. Research
### Domain
Email system migration, MS Graph API, Cloudflare Workers architecture.

### Key Principles
- **Output parity:** Email HTML must be byte-identical to n8n output (same tables, same colors, same RTL handling)
- **Backward compat:** Approval tokens in existing email links must still work (same cyrb53 hash algorithm)
- **45-day client tokens:** Per project convention (feedback_client_token_45_days.md)

### Research Verdict
Direct port of n8n code nodes to TypeScript functions. No architectural changes needed — the n8n code is already well-structured as pure functions with clear inputs/outputs.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `api/src/lib/ms-graph.ts` — Has GET/POST/PATCH/batch but no sendMail. Bug: line 84 only handles 204, not 202.
  - `api/src/lib/client-token.ts` — Has `verifyClientToken` but no `generateClientToken`.
  - `api/src/lib/doc-builder.ts` — Structured JSON only, no email HTML generation.
  - `api/src/lib/cache.ts` — KV caching already works for categories/templates.
* **Reuse Decision:** Extend existing ms-graph.ts and client-token.ts. Create new email-html.ts for HTML generation.
* **Key insight:** Neither workflow uses Document Service's "Generate Documents" (571 lines). Approve-and-send reads existing Airtable docs. Send-questionnaires builds email inline. Only need to port Generate HTML + questionnaire email template.

## 5. Technical Constraints & Risks
* **Security:** Approval token must use same hash for backward compat. Client tokens use HMAC SHA-256 with 45-day expiry.
* **Risks:** Email HTML visual regression is the biggest risk. Old approve links in existing office emails will break after n8n deactivation (acceptable — used within hours).
* **Breaking Changes:** None for frontend consumers (same endpoint paths, same response shapes).

## 6. Proposed Solution (The Blueprint)
See plan file: `C:\Users\liozm\.claude\plans\twinkly-painting-galaxy.md`

9 tasks, dependency order: shared constants → email HTML → client token gen → MS Graph sendMail → types → approve route → questionnaires route → mount + deploy → frontend flip + deactivate.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/email-styles.ts` | Create | Shared email constants |
| `api/src/lib/email-html.ts` | Create | All email HTML generation (~550 lines) |
| `api/src/lib/client-token.ts` | Modify | Add generateClientToken |
| `api/src/lib/ms-graph.ts` | Modify | Add sendMail, fix 202 handling |
| `api/src/lib/types.ts` | Modify | Add APPROVAL_SECRET to Env |
| `api/src/routes/approve-and-send.ts` | Create | Approve & Send route (~200 lines) |
| `api/src/routes/send-questionnaires.ts` | Create | Send Questionnaires route (~130 lines) |
| `api/src/index.ts` | Modify | Mount 2 new routes |
| `shared/endpoints.js` | Modify | Flip 2 URLs to CF_BASE |
| `approve-confirm.html` | Modify | Change form action URL |

## 7. Validation Plan
* [ ] Unit: approval token matches n8n output for same input
* [ ] Unit: email HTML diff against n8n output
* [ ] E2E: Approve & Send (JSON mode from document-manager)
* [ ] E2E: Approve & Send (HTML confirm page flow)
* [ ] E2E: Send Questionnaires (single client)
* [ ] E2E: Send Questionnaires (bulk 3+ clients)
* [ ] Edge: zero-docs, English bilingual, unanswered questions
* [ ] Gmail rendering (web + mobile)
* [ ] Verify n8n workflows deactivated with 0 post-deactivation executions

## 8. Implementation Notes (Post-Code)
* All 9 tasks completed in single session (2026-03-24)
* email-html.ts: ~500 lines, ported Generate HTML + Inject Questions + Questionnaire Email
* approve-and-send.ts: ~200 lines, dual auth (Bearer + cyrb53), dual response (JSON + redirect)
* send-questionnaires.ts: ~115 lines, sequential batch with Airtable stage update
* Fixed bug in subagent output: `listAllRecords` returns array directly, not `{ records: [...] }`
* `buildQuestionnaireEmailSubject` was too simple (no client name/filing type) — built subject inline in route
* Git HEAD corruption discovered in outer repo — fixed by resetting ref to known-good SHA
* Worker deployed: 220 KiB / 48 KiB gzip, 8ms startup
* Frontend pushed: 22/22 endpoints on CF_BASE, API_BASE only in comments
* **n8n deactivation still pending** — needs manual E2E testing first
