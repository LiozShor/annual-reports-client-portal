# Design Log 399: Email Bounce / NDR Handling
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-03
**Related Logs:** None directly. Adjacent: DL-365 (activity-logger — used for bounce events), DL-264/389 (email-send paths whose bounces we now intercept), DL-127 (email design palette reused for warning badge).

## 1. Context & Problem

Bounce / NDR (Non-Delivery Report) emails returning from `postmaster` / `MAILER-DAEMON` (recipient does not exist, domain DNS invalid, mailbox not found) are currently **silently swallowed** by `api/src/lib/inbound/processor.ts:77-88` (regex `/undeliverable/i` is in `AUTO_REPLY_SUBJECT_PATTERNS`) and short-circuited as `'Completed'` at L929-932. The system never identifies the bad recipient, never clears the email from the client record, never reverts the stage, and never tells the office.

Two real Outlook NDR examples in the inbox motivated this DL:
- **DNS failure:** the recipient's domain DNS record does not exist ("מערכת שמות התחומים (DNS) דיווחה שהתחום של הנמען לא קיים").
- **Mailbox not found:** the local part doesn't exist on the recipient's domain ("לא נמצא ב-…").

Office workflow blocks silently: questionnaire flagged "sent" but client never gets it, never replies, never moves out of Stage 2 — until a person manually notices weeks later.

## 2. User Requirements

1. **Q:** Detection strategy?
   **A:** Subject + sender + body parse (regex over the postmaster NDR body; extract failed recipient).
2. **Q:** Stage revert scope?
   **A:** Stage 2 → Stage 1 only. Other stages: clear email + warn, do not touch stage.
3. **Q:** "Delete email" semantics?
   **A:** Move to `last_bounced_email` audit field + clear `email`.
4. **Q:** Admin-panel surfacing?
   **A:** Red warning badge (with reason in tooltip) AND pin bounced clients to top of table.

## 3. Research

### Domain
Email deliverability — bounce / NDR detection over Microsoft Graph mail (no DSN headers exposed) + downstream CRM state mutation.

### Sources Consulted

1. **Stack Overflow — *Bounce mail detection with help of Microsoft Graph API*** — confirms MS Graph does NOT expose `Content-Type: message/delivery-status` headers via the standard `messages` endpoint. Body-text regex or raw MIME via `/messages/{id}/$value` are the only options.
2. **DNSimple — *Understanding Email Bounces*** — taxonomy: 5xx DSN = hard bounce (permanent), 4xx = soft bounce (transient). Hard bounces should be removed from the active list immediately.
3. **Salesforce Help — *Enable Email Bounce Handling*** — confirms standard CRM pattern: parse 4xx/5xx codes, mark hard-bounced, surface visibly to user. Soft bounces tracked separately and only escalated after repeat failures.

### Key Principles Extracted

- **Hard bounce → immediate action, soft bounce → log only.** Phase 1 acts only on hard bounces; matches both screenshot cases.
- **Preserve the audit trail.** Don't wipe — relocate the bad address to `last_bounced_email` so office can see what happened.
- **Visibility before automation.** Office must SEE the bounce; the system clears the email but does NOT auto-resend.

### Patterns to Use

- **Body-regex extraction with multiple language patterns** (EN + HE) — both screenshots use Hebrew NDR templates from Outlook/Exchange.
- **Color + icon + text** for the admin badge — per `docs/email-design-rules.md` §3 Status Indicators (palette `#fee2e2` / `#991b1b` / ⚠).
- **Two-condition gate** for false-positive avoidance: subject match AND successful recipient extraction.

### Anti-Patterns to Avoid

- **Silent swallow** (current state) — bounce vanishes into `'Completed'` event.
- **Auto-resend on bounce** — masks the underlying address problem; office must intervene first.
- **Color-only warning** — accessibility fail; we use color + icon + text.

### Research Verdict

Body-text regex over the visible NDR is sufficient for the two real cases (Outlook/Exchange NDRs are templated and parse cleanly). Raw-MIME fetch is overkill for Phase 1; revisit if false-negative rate proves high.

## 4. Codebase Analysis

- **Existing Solutions Found:**
  - `api/src/lib/inbound/processor.ts:77-88` — `AUTO_REPLY_SUBJECT_PATTERNS` already includes `/undeliverable/i`. The detection seed already exists; it just terminates in the wrong place.
  - `api/src/lib/inbound/processor.ts:94-139` — `extractMetadata()` is the natural place to attach `bounceInfo`.
  - `api/src/lib/inbound/processor.ts:929-932` — auto-reply short-circuit; bounce branch goes immediately before this.
  - `api/src/lib/activity-logger.ts` — `logEvent()` already used for inbound events; reuse for `email_bounce_handled`, `email_bounce_unmatched`, `stage_reverted_on_bounce`.
- **Reuse Decision:**
  - REUSE: `AUTO_REPLY_SUBJECT_PATTERNS` infrastructure, `extractMetadata()`, `logEvent()`, existing `airtable.updateRecord` helper, existing `escapeHtml` in `script.js`.
  - NEW: `bounce-detector.ts` (pure parser, easily unit-testable), `bounce-handler.ts` (Airtable mutations + activity logging).
- **Relevant Files:**
  - `api/src/lib/inbound/processor.ts` — wiring point.
  - `frontend/admin/js/script.js` — `renderClientsTable()` L1613, row HTML L1665-1734, stage badge L1683-1687 (desktop) / L1759-1762 (mobile), `sortClients()` L1926, `SORT_CONFIG` L150-156.
  - `docs/airtable-schema.md` — schema doc to update with new `clients` fields.
  - `docs/email-design-rules.md` — design palette source for the badge.
- **Existing Patterns:**
  - Activity logging via `logEvent()` (DL-365) is the canonical telemetry path — same pattern reused.
  - Stage mutations go through `airtable.updateRecord('reports', ...)`; no separate helper needed for one call site.
  - Cache-bust pattern (`?v=NNN`) on `frontend/admin/index.html` after any `script.js` edit (Monolith ratchet rule).
- **Alignment with Research:** matches Salesforce/DNSimple "remove hard bounces immediately + surface to user" pattern. Diverges from full DSN-code parsing only because Graph hides the codes — we use body-text proxies.
- **Dependencies:** Airtable `clients` table needs 4 new fields (manual schema migration). No external services, no new packages.

## 5. Technical Constraints & Risks

- **Security:** Bounce body contains a real email address (the failed recipient). We store it in a dedicated `last_bounced_email` audit field — by-design exposure. Never log full NDR body to activity-logger.
- **Operational Risks:**
  - Regex false-positive could clear a valid email. Mitigation: require BOTH subject pattern AND successful recipient extraction AND match against an existing client `email`.
  - Replay of the same NDR (rare, MS Graph dedup is decent). Mitigation: idempotency guard `if (client.last_bounced_email === bounce.failedRecipient && client.email === '') skip`.
  - Manual Airtable schema step — code will fail at runtime if fields missing. Mitigation: ship schema additions BEFORE deploying the Worker.
- **Breaking Changes:** None. New behavior is purely additive in the auto-reply branch. Existing out-of-office handling untouched.
- **Mitigations:**
  - Unit fixtures from both real screenshots — guarantee detection correctness.
  - Negative fixture (out-of-office body) — guarantees no false positive.
  - Activity-log `email_bounce_unmatched` for diagnosability when the recipient extraction succeeds but no client matches.

## 6. Proposed Solution

### Success Criteria

When an NDR for `recipient@bad-domain.tld` arrives in `reports@`, the matching client's `email` is cleared, the bounce is recorded in audit fields, any active Stage-2 report is reverted to Stage 1, and the client appears at the top of the admin table with a red ⚠ button. The Stage-1 stat card ("ממתינים לשליחה") now flags attention (matching the existing Stage-3 "התקבל שאלון טרם נשלחו מסמכים" attention pattern from DL-187). The ⚠ button is **clickable** and opens a modal with the bounce reason + bad address. When office fixes the email inline AND the client is in Stage 1, a confirm dialog asks "Send questionnaire?" so the natural recovery action is one click away. Clients who never had an email at all get a softer grey ✉ indicator with "אין כתובת מייל" tooltip — visible but not pinned to top, no stat-card alert (different urgency from a real bounce).

### Logic Flow

1. Inbound webhook fires `processor.ts` for new mail.
2. `extractMetadata()` runs `detectBounce(subject, fromAddress, bodyText)` → sets `metadata.bounceInfo` (or null).
3. If `metadata.bounceInfo?.isHard`: route to `handleHardBounce()` and return; otherwise fall through to existing auto-reply handling.
4. `handleHardBounce()`:
   a. Find clients where `LOWER({email}) = ` failed recipient (lowercased).
   b. If 0 matches → log `email_bounce_unmatched`, return.
   c. Per match (idempotent — skip if already cleared): clear `email`, set `email_bounced=true`, write `last_bounced_email` / `email_bounce_reason` / `email_bounce_at`.
   d. Find `reports` for client where `stage='Waiting_For_Answers'` → revert to `Send_Questionnaire` + log `stage_reverted_on_bounce`.
   e. Log `email_bounce_handled`.
5. Admin frontend on next fetch: `email_bounced` clients sorted to top, red badge rendered next to stage badge with tooltip from `last_bounced_email` + `email_bounce_reason`.
6. Office edits client email to a new address → existing edit-client route sets `email_bounced=false` (audit fields preserved) → next refresh removes badge and the client falls back to its normal sort position.

### Data Structures / Schema Changes

Airtable `clients` table (`tblFFttFScDRZ7Ah5`) — 4 new fields, manually added in UI before deploy:

| Field | Type | Purpose |
|---|---|---|
| `email_bounced` | Checkbox | True while bounce is unresolved. Drives badge + sort. |
| `last_bounced_email` | Single-line text | The bad address (audit trail). |
| `email_bounce_reason` | Long text | Human-readable reason (e.g. "DNS not found", "Mailbox not found"). |
| `email_bounce_at` | Date (with time) | When NDR was processed. |

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/bounce-detector.ts` | Create | `detectBounce()` + `BounceInfo` type. Pattern arrays for subject / sender / recipient extraction, both EN + HE. |
| `api/src/lib/inbound/bounce-handler.ts` | Create | `handleHardBounce()` — Airtable mutations, stage revert, activity logging. |
| `api/test/bounce-detector.test.ts` | Create | Unit tests with fixtures from both real NDR bodies + an out-of-office negative fixture. |
| `api/src/lib/inbound/processor.ts` | Modify | Wire `detectBounce()` in `extractMetadata()`; add bounce branch before auto-reply short-circuit. |
| `api/src/routes/clients.ts` (or wherever edit-client lives — locate during implementation) | Modify | When `email` is updated to a non-empty value AND `email_bounced=true`, also clear `email_bounced=false`. |
| `frontend/admin/js/script.js` | Modify | (e) **Send-questionnaire row-action button is disabled when `client.email` is empty** — specifically the green paper-plane (`send` / paper-plane icon) button rendered in the "פעולות" (Actions) column of `renderClientsTable()`. Locate the row-action button render (greppable by the paper-plane icon name + the existing send-questionnaire click handler) and gate on `!!client.email`: when empty, render with `disabled` attribute, opacity ~0.4, cursor:not-allowed, `title="אין כתובת מייל"`, and skip the click handler. Also gate the bulk-send selection: a client with empty `email` cannot be selected for bulk send. Confirm dialog from (c) is the recovery path that fills the email and then re-enables this button on next refresh. (a) ⚠ **clickable button** in `renderClientsTable()` row HTML (desktop L1683 + mobile L1759 — both surfaces) opening a `showModal()` with `last_bounced_email` + `email_bounce_reason` + `email_bounce_at`. (b) Pin-to-top in `sortClients()` L1926. (c) After existing edit-client save: if response shows the saved client is in `Send_Questionnaire` stage, fire `showConfirmDialog('Send questionnaire?', ...)` that calls the existing send-questionnaires path on confirm. (d) Stage-1 stat card "ממתינים לשליחה" now uses the existing `.needs-attention` class from DL-187 (`@keyframes stage3-bounce` 4px bounce + amber-600) when its count > 0 AND any client in stage 1 has `email_bounced=true`. Locate the Stage-1 stat-card render and toggle the class — DO NOT modify the keyframes. |
| `frontend/admin/index.html` | Modify | Bump `?v=NNN` on `script.js`. |
| `docs/airtable-schema.md` | Modify | Document the 4 new `clients` fields. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-399 entry. |
| `.agent/current-status.md` | Modify | Copy unchecked Section 7 items to Active TODOs. |

### Final Step

- Update status to `[IMPLEMENTED — NEED TESTING]` once code lands and unit tests pass locally.
- Per "Ask before merge and push" feedback rule: pause after commit; do NOT auto-merge.

## 7. Validation Plan

- [ ] Manual: 4 Airtable fields added to `clients` table (`email_bounced`, `last_bounced_email`, `email_bounce_reason`, `email_bounce_at`).
- [ ] Unit: `detectBounce()` against fixture of DNS-failure NDR body — `isHard:true`, `reasonCode:'dns_not_found'`, correct `failedRecipient`.
- [ ] Unit: `detectBounce()` against fixture of mailbox-not-found NDR body — `isHard:true`, `reasonCode:'mailbox_not_found'`, correct `failedRecipient`.
- [ ] Unit: `detectBounce()` against out-of-office body — returns `null` (no false positive).
- [ ] TypeScript: `./node_modules/.bin/tsc --noEmit` passes from `api/`.
- [ ] Wrangler dry-run: `CLOUDFLARE_API_TOKEN="" npx wrangler deploy --dry-run -c wrangler.toml` succeeds.
- [ ] Integration: send real test mail from `reports@` to `nonexistent@example.invalid`; confirm NDR bounces back, `email_bounce_handled` activity log entry appears, client `email` field cleared, `last_bounced_email` populated.
- [ ] Integration: a Stage-2 client receives a bounce → `reports.stage` flips to `Send_Questionnaire`; activity log entry `stage_reverted_on_bounce`.
- [ ] UI desktop: bounced client at top of table with ⚠ red **clickable button**; click opens modal showing `last_bounced_email` + reason + `email_bounce_at`.
- [ ] UI mobile: same button visible on the mobile card layout (Duplicate-Path Audit rule).
- [ ] UI: Stage-1 stat card ("ממתינים לשליחה") shows the DL-187 `.needs-attention` bounce animation when any stage-1 client is bounced.
- [ ] UX: office edits client email → button disappears, client returns to normal sort position on next refresh.
- [ ] UX: after office sets a new email AND client is in Stage 1 → confirm dialog "Send questionnaire?" → on confirm, hits the existing send-questionnaires route.
- [ ] Idempotency: replay same NDR webhook twice → only one set of mutations; second is a no-op (no duplicate stage flip, no duplicate log entry).
- [ ] Regression: real out-of-office reply still classified as auto-reply, NOT bounce.

## 8. Implementation Notes

**Implementer dispatch:** Wave 1 = T1 (detector + tests, sonnet) + T3 (edit-client flag-clear, sonnet) + T4 (frontend, opus) in parallel; Wave 2 = T2 (handler + processor wiring, opus) serial after T1.

**Deviations from plan, all approved:**

1. **Test runner — `node:test` not vitest.** Project uses `node --test` against `*.test.mjs` files (matching the existing `batch-sanitize.ts`/`.mjs` dual-file pattern). T1 created `bounce-detector.ts` plus a runtime sibling `bounce-detector.mjs` and `api/test/bounce-detector.test.mjs`. 3/3 fixtures pass.
2. **`handleHardBounce` signature dropped `env` and `ctx`.** The project's `logEvent(input)` is single-arg (uses AsyncLocalStorage internally — no env/ctx needed at call sites). Passing them would have been dead weight. Function is `handleHardBounce(airtable, bounce, messageId)`.
3. **`logEvent` category `'INBOUND'` (uppercase).** Matches the existing `EventCategory` union in `activity-logger.ts` — confirmed via grep of existing call sites in `processor.ts`.
4. **Airtable client method `listAllRecords` (not `findRecords`).** Project's actual method name. Filter syntax: `{ filterByFormula: '...' }`.
5. **Reports lookup uses CPA-NNN string (`client_id` formula field), not record ID.** Looked up the client's `client_id` field value first, then `{client_id}='${cpaId}'` against `reports`. Same pattern as `classifications.ts` and `client-reports.ts`.
6. **Frontend extracted to module, not inlined.** `frontend/admin/js/script.js` ratchet was at zero headroom (16223/16223). T4 created `frontend/admin/js/modules/bounce-warning.js` (188 lines) per the project's "Module Extraction" escape hatch. Baseline auto-shrank to 16220 (allowed — append-only-DOWN). Module exposes helpers on `window`: `bounceBadgeHTML`, `openBounceModal`, `hasBouncedInStage1`, `hasEmail`, `sendQuestionnaireBtnHTML`, `filterClientsWithEmail`, `shouldPromptResendOnSave`.
7. **Bounce-detail modal uses custom `.ai-modal-overlay` panel, not `showModal()`.** `showModal` writes via `textContent` (script.js:14338) and would not render the structured label/value grid + remediation hint required by the spec. Custom panel follows the documented `.ai-modal-overlay` / `.ai-modal-panel` fallback pattern. No native `alert/confirm` introduced.
8. **Bulk-send empty-email skip uses toast-and-proceed UX** (`showAIToast('דילגתי על N לקוחות ללא כתובת מייל', 'info')`) rather than silent skip — matches existing patterns in adjacent bulk actions.
9. **Stage-1 needs-attention class** wired by toggling `.stat-card.stage-1` with a CSS rule extension that reuses the existing `@keyframes stage3-bounce` keyframes — keyframes themselves untouched per spec.

**Discovered + fixed mid-flight:**
- **`email_events.processing_status` was missing the `'Bounced'` option.** Added via pyairtable `typecast=True` seed-record probe. Verified options now include: `Detected, Downloaded, Classified, Uploaded, Airtable_Updated, Completed, Failed, NeedsHuman, Discarded, PasswordReply, Bounced`. Documented in `docs/airtable-schema.md`.

**Files changed:**

| Layer | File | Action |
|---|---|---|
| Backend | `api/src/lib/inbound/bounce-detector.ts` | Created |
| Backend | `api/src/lib/inbound/bounce-detector.mjs` | Created (runtime sibling) |
| Backend | `api/src/lib/inbound/bounce-handler.ts` | Created |
| Backend | `api/src/lib/inbound/processor.ts` | Modified — `extractMetadata` populates `bounceInfo`; bounce branch precedes auto-reply short-circuit |
| Backend | `api/src/lib/inbound/types.ts` | Modified — `EmailMetadata.bounceInfo` |
| Backend | `api/src/routes/client.ts:204-205` | Modified — clear `email_bounced=false` on email update |
| Tests | `api/test/bounce-detector.test.mjs` | Created — 3 fixtures |
| Frontend | `frontend/admin/js/modules/bounce-warning.js` | Created (188 lines) |
| Frontend | `frontend/admin/js/script.js` | Modified — desktop+mobile badge wiring, sort prepend, paper-plane disable, edit-save confirm hook, stage-1 stat-card class toggle, send/bulk gating |
| Frontend | `frontend/admin/css/style.css` | Modified — `.needs-attention` extended to `.stat-card.stage-1` |
| Frontend | `frontend/admin/index.html` | Modified — `script.js?v=403`→`?v=404`; module added with `?v=1` |
| Schema | Airtable `clients` (live) | 4 new fields: `email_bounced`, `last_bounced_email`, `email_bounce_reason`, `email_bounce_at` |
| Schema | Airtable `email_events.processing_status` (live) | New option `Bounced` |
| Docs | `docs/airtable-schema.md` | Modified — clients fields + email_events option documented |
| Ratchet | `.claude/script-size-baseline.json` | Auto-shrunk by hook (16223 → 16220) |

**Verification commands run:**
- `cd api && ./node_modules/.bin/tsc --noEmit` — zero new errors (two pre-existing errors in `src/index.ts` and `src/lib/activity-logger.ts` are untouched and unrelated).
- `cd api && CLOUDFLARE_API_TOKEN="" npx wrangler deploy --dry-run -c wrangler.toml` — succeeds (2268 KiB).
- `cd api && npm test` — 10/10 pass (existing tests + 3 new bounce-detector tests).

**Live integration tests still pending** — see Section 7 unchecked items, copied to `.agent/current-status.md`.
