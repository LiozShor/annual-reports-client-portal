# Design Log 174: Cloudflare Workers — Phase 5 Async Hybrid
**Status:** [COMPLETED]
**Date:** 2026-03-23
**Related Logs:** DL-169 (Phase 1, COMPLETED), DL-170 (Phase 2, COMPLETED), DL-171 (Phase 3, COMPLETED), DL-172 (Phase 4a, IMPLEMENTED), DL-173 (Phase 4b, IMPLEMENTED)

## 1. Context & Problem
17/22 admin API endpoints are on Cloudflare Workers. Three remain on n8n: `admin-reminders` (3-5s), `send-batch-status` (5-10s blocking until email sent), `edit-documents` (3-5s). These are the last synchronous endpoints before Phase 6 (cleanup/optimization).

**Strategy: Hybrid.** Worker handles fast response path (Airtable reads/writes). Email building/sending stays on n8n (fired async via `waitUntil()`). This gives the same latency improvement without porting 1000+ lines of working email HTML code.

After Phase 5: **20/22 endpoints on Workers** (only `approve-and-send` and `admin-send-questionnaires` remain on n8n).

## 2. User Requirements
1. **Q:** Send Batch Status (1000+ line email builder + Document Service + MS Graph). How deep?
   **A:** Full migration with shared email module — port entire email builder + Document Service HTML to Workers as reusable `lib/email-builder.ts`.

2. **Q:** Edit Documents office email notification — skip, hybrid, or full?
   **A:** Full — port the edit summary email builder to Workers. Use existing MS Graph client.

3. **Q:** Reminders send_now (triggers [06] Reminder Scheduler)?
   **A:** Fire n8n webhook async via `waitUntil()` + shared secret. Worker responds instantly.

4. **Q:** Worker→n8n authentication for hybrid calls?
   **A:** Shared secret in `X-Internal-Key` header. New `N8N_INTERNAL_KEY` secret.

## 3. Research
### Domain
Transactional Email HTML Generation, Edge Computing Async Patterns, Cloudflare Workers Architecture

### Sources Consulted
1. **Postmark/Moosend Transactional Email Guides** — Transactional emails get highest engagement; keep under 100KB to avoid Gmail clipping; single focused CTA outperforms multiple; mobile-first single-column is baseline.
2. **W3C Internationalization (bidi) Specs** — Set `dir` per section block element (not globally); separate `<table>` per language section; Hebrew line-height 1.6; never `unicode-bidi: override`.
3. **Email on Acid / Designmodo / Litmus** — Tables remain only reliable layout; Outlook uses Word engine (no max-width, broken margin); Gmail strips `<style>` blocks; use longhand CSS; `padding` on `<td>` not `margin`.
4. **MJML / React Email / Maizzle** — All converge on composable component functions returning table fragments with inline styles. Pure TS functions are the best fit for Workers (zero deps, tree-shakeable, typed).
5. **Cloudflare Workers `waitUntil()` Docs** — 30s max after response; no built-in retry; rejected promises don't affect response; never destructure ctx; use Queues only if delivery guarantees needed.
6. **Kleppmann / Enterprise Integration Patterns** — Fire-and-forget = at-most-once delivery; acceptable for non-critical notifications; include `requestId` for idempotency if retries needed; don't build Queues until you observe actual failures.

### Key Principles Extracted
- **Pure function component model** — each function takes typed data, returns HTML string. No template engine (unnecessary dep, Workers-hostile).
- **Style constants as SSOT** — one `STYLES` object for colors/fonts/spacing. One change propagates everywhere.
- **waitUntil + .catch() logging** — fire-and-forget for send_now; log errors to console (Workers Logs). Don't block on n8n response.
- **Table-based layout only** — Gmail/Outlook ignore flexbox/grid. All CSS inline on every element.
- **Under 100KB total HTML** — Gmail clips anything larger.

### Patterns to Use
- **Component composition:** `wrapper([headerBar(), docList(), ctaButton(), footer()])` — each returns a table fragment
- **Bilingual cards (DL-076):** EN card (white bg, primary) + HE card (gray bg, secondary) with 16px spacer
- **Bulletproof buttons:** `<table>` + `<td bgcolor>` + `<a>` pattern (Outlook VML fallback)
- **Fire-and-forget webhook:** `ctx.waitUntil(fetch(...).catch(console.error))` — never await

### Anti-Patterns to Avoid
- **Template engine in Workers** — Handlebars/EJS add bundle bloat, solve wrong problem
- **CSS shorthand** — Outlook rendering bugs with `padding: 16px 0`
- **Global dir="rtl"** — breaks English sections in bilingual emails
- **`margin` for spacing** — Outlook.com drops it; use `padding` on `<td>`
- **Retry loops in waitUntil** — 30s budget; if need retries, use Queues

### Research Verdict
Full migration is viable. The Worker has MS Graph (Phase 4), Airtable client, and doc-builder. The missing pieces are: email HTML generation (build as shared module), `generateClientToken` (add to client-token.ts), `sendMail` (add to MSGraphClient), and `upsertRecords` (add to AirtableClient). Only `send_now` stays hybrid because it triggers the full reminder scheduler pipeline on n8n.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `lib/ms-graph.ts` — MSGraphClient with get/post/patch/batch. Needs `sendMail()` method.
  - `lib/doc-builder.ts` — `groupDocsByPerson()`, `buildTemplateMap()`, `buildCategoryMap()` — reusable for batch-status email doc list.
  - `lib/airtable.ts` — Full CRUD (listAll, get, update, batchUpdate, batchCreate, deleteRecords). Needs `upsertRecords()`.
  - `lib/client-token.ts` — `verifyClientToken()`. Needs `generateClientToken()` for 45-day CTA tokens.
  - `lib/audit-log.ts` — `logAudit()` via waitUntil. Reuse for edit-documents.
  - `lib/reminders.ts` — `calcReminderNextDate()`, `isReminderStage()`. Reuse for reminders route.
  - `lib/token.ts` — `verifyToken()`, `signToken()`. Reuse for all admin auth.
* **Reuse Decision:** Heavy reuse of existing libs. New: `email-builder.ts` + `email-styles.ts` (shared email module), 3 route files.
* **Alignment with Research:** Existing patterns (pure functions, typed data, inline styles in email-design-rules.md) align perfectly with research recommendations. No divergence needed.

## 5. Technical Constraints & Risks
* **Security:** Admin token auth on all 3 endpoints. Client token generation for email CTAs (45-day expiry, HMAC). Internal webhook key for Worker→n8n. `APPROVAL_SECRET` for edit email approval links.
* **Risks:**
  - Email HTML must exactly match n8n output to avoid visual regression. Test with real client data.
  - `send_now` hybrid: if n8n is down, reminders silently fail. Acceptable — admin can re-trigger.
  - Gmail 100KB clipping: batch-status emails with many docs could exceed. Monitor and truncate if needed.
* **Breaking Changes:** None — response shapes match n8n exactly. Frontend just flips URLs.

## 6. Proposed Solution (The Blueprint)
See plan file: `C:\Users\liozm\.claude\plans\quizzical-fluttering-tome.md`

### Implementation Order
1. `email-styles.ts` — style constants from email-design-rules.md
2. `email-builder.ts` — component functions + orchestrators
3. `client-token.ts` — add `generateClientToken()`
4. `airtable.ts` — add `upsertRecords()`
5. `ms-graph.ts` — add `sendMail()`
6. `types.ts` — add `N8N_INTERNAL_KEY`, `APPROVAL_SECRET` to Env
7. `routes/reminders.ts` — all actions (list, suppress, send_now hybrid, update_configs)
8. `routes/batch-status.ts` — send (full email) + dismiss
9. `routes/edit-documents.ts` — CRUD + office email
10. `index.ts` — mount 3 routes
11. Deploy + set secrets
12. n8n: add internal webhook to [06] Reminder Scheduler
13. `endpoints.js` — flip 3 URLs
14. Housekeeping

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/email-styles.ts` | Create | Color palette, font stack, spacing constants |
| `api/src/lib/email-builder.ts` | Create | Composable email components + orchestrators |
| `api/src/routes/reminders.ts` | Create | All reminder actions |
| `api/src/routes/batch-status.ts` | Create | Send + dismiss batch status |
| `api/src/routes/edit-documents.ts` | Create | Document CRUD + office email |
| `api/src/lib/client-token.ts` | Modify | Add `generateClientToken()` |
| `api/src/lib/airtable.ts` | Modify | Add `upsertRecords()` |
| `api/src/lib/ms-graph.ts` | Modify | Add `sendMail()` |
| `api/src/lib/types.ts` | Modify | Add env vars |
| `api/src/index.ts` | Modify | Mount 3 new routes |
| `api/wrangler.toml` | Modify | Document new secrets |
| `github/.../shared/endpoints.js` | Modify | Flip 3 URLs to CF_BASE |

### Final Step
* **Housekeeping:** Update design log → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Email builder: HTML renders in Gmail (table-based, inline CSS, no `<style>`)
* [ ] Email builder: RTL Hebrew sections correct (dir="rtl" per section)
* [ ] Email builder: Bilingual cards match DL-076 (EN primary, HE secondary)
* [ ] Email builder: total HTML < 100KB
* [ ] Reminders list: correct items (stages 2+4, active), stats, default_max
* [ ] Reminders suppress/unsuppress: toggles reminder_suppress field
* [ ] Reminders change_date/set_max: updates correct field
* [ ] Reminders send_now: instant response, n8n receives internal webhook
* [ ] Reminders update_configs: upserts config, returns refreshed list
* [ ] Batch status send: email built+sent, classifications deleted
* [ ] Batch status dismiss: classifications deleted, no email
* [ ] Batch status: 45-day client token in CTA works
* [ ] Edit documents: Tally-like body parsed correctly
* [ ] Edit documents: waive, restore, create, status_change, note, name updates all work
* [ ] Edit documents: auto-advance to Review at 100% completion
* [ ] Edit documents: office email sent with change cards
* [ ] Hybrid send_now: waitUntil fires after response
* [ ] Hybrid: X-Internal-Key validated by n8n
* [ ] All endpoints: response shapes match n8n (JSON diff)
* [ ] Frontend: all 3 endpoints work after URL flip
* [ ] TypeScript compiles, wrangler deploy succeeds

## 8. Implementation Notes (Post-Code)
* **Strategy changed from full to hybrid** — user correctly noted email porting was unnecessary risk for no latency gain
* **No new webhook nodes needed** — modified auth code in existing n8n workflows to accept `X-Internal-Key` header, Worker calls same webhook paths
* **Phase 4 bugs found during testing:** categories_list returned Airtable record IDs instead of category_id; variables returned as string instead of array — both fixed
* **Reminders response fix:** all mutation actions (suppress, send_now, etc.) now return refreshed items+stats list so frontend updates without page refresh
* **edit-documents hybrid:** Worker does all CRUD, n8n re-runs the same flow (idempotent) + sends office email
* **Performance:** send-batch-status dropped from 5-10s to 30ms; reminders and edit-documents noticeably faster
