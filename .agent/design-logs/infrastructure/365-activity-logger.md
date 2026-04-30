# Design Log 365: Activity Logger — Cloudflare-Native Replacement for Airtable security_logs

**Branch:** `DL-365-activity-logger`
**Status:** [BEING IMPLEMENTED — DL-365] (Phases 1+2 COMPLETE — verified live 2026-04-29; Phase 3 implemented 2026-04-30 — needs deploy + smoke test; Phase 4 pending)
**Date:** 2026-04-28
**Related:** DL-094 (existing security_logs, to deprecate), DL-180 (observability research, reused)

---

## Context

The current logger (DL-094) stores only auth events (AUTH_SUCCESS/FAIL, TOKEN_*) in Airtable table `security_logs`. The user is dissatisfied for four confirmed reasons:

1. **Too narrow** — only auth events; nothing for inbound mail, AI classifications, approvals, reviews, button clicks
2. **Bad UX** — Airtable is clunky for log queries, no real-time tail, no per-client timeline
3. **Wrong storage** — eats Airtable record quota, pollutes business-data base
4. **No correlation** — can't see one client's journey (email arrived → AI classified → admin approved → email sent) as a single timeline

We will replace it with a **Cloudflare-native** activity log: structured `console.log()` JSON → Workers Logs (7-day hot, queryable in CF dashboard) → Logpush to R2 (90-day archive). A dev-only React island viewer at `/admin/dev/activity` will render filterable timelines, gated by an extra `DEV_PASSWORD` on top of normal admin login. PII is redacted by default (client_id + masked email + hashed phone); full PII only when an event explicitly opts in.

---

## User Requirements (Q&A from Phase A)

1. **Q:** Primary frustration with current setup?
   **A:** All four — too narrow, bad UX, wrong storage, no correlation.
2. **Q:** Storage backend?
   **A:** Cloudflare Workers Logs + Logpush → R2 (Recommended).
3. **Q:** Event sources?
   **A:** All four — Workers backend, n8n executions, admin UI clicks, client portal activity.
4. **Q:** Viewer location?
   **A:** Hidden admin route `/admin/dev/activity` with separate `DEV_PASSWORD` gate, dev-only.
5. **Q:** Retention?
   **A:** 7d hot (CF Logs) + 90d R2 archive (Recommended).
6. **Q:** PII policy?
   **A:** **Client-ID-only logs + viewer joins to Airtable at render time.** Logs/R2 archive store `client_id: "rec123"` and never names/emails/phones. The dev viewer batch-fetches `/admin-clients-lookup?ids=...` on render and shows "Moshe Cohen <moshe@x.co.il>" in the UI. PII never persists in the log stream.
7. **Q:** Migration of DL-094 Airtable logger?
   **A:** Dual-write 2 weeks → deprecate (Recommended).

---

## Research Summary (Phase B)

**Domain:** Observability / Audit Trails / Frontend Telemetry. Builds on DL-180.

**Sources consulted (incremental to DL-180):**

1. **Cloudflare Workers Logs + Logpush docs** — Structured JSON via `console.log()` is auto-indexed; use `console.error` / `console.warn` for severity; Logpush to R2 needs `[observability] logpush = true` plus a logpush job created via dashboard or API.
2. **MDN + analysis of `sendBeacon` vs `fetch keepalive`** — `sendBeacon` is POST-only, no headers, 64KiB cap; `fetch({keepalive:true})` allows custom headers (we need `Authorization: Bearer <token>`). **Verdict: use `fetch keepalive`** for admin clicks (need auth), reserve `sendBeacon` for unauthenticated client-portal page-view pings only. Trigger telemetry on `visibilitychange`, not `unload`.
3. **GDPR / PII audit-log redaction patterns** (DEV.to, OpenObserve, OpenTelemetry redaction docs) — Redact at ingest, not at read. Mask emails (`l***@gmail.com`), hash phones (HMAC-SHA256, truncated). Israeli PPA Amendment 13 (already noted in DL-094) → 90-day retention is defensible for operational logs.

**Key principles applied:**

- **Structured-first** — every event is JSON with stable field names so CF dashboard query builder works (`event_type = "approve_send"`, `actor = "rec123"`).
- **Fire-and-forget on the hot path** — never block a user request on logging. Use `ctx.waitUntil()` server-side; `fetch keepalive` client-side.
- **Redact early** — payloads are sanitized in the logger entry function, not by the viewer. R2 archive must be safe to hand a developer.
- **Correlation via `request_id`** — every event in one request shares a UUID, so the timeline can stitch them.
- **Cumulative knowledge** — DL-180 already covered Workers Logs basics, error categories (VALIDATION/BUSINESS/DEPENDENCY/INFRA/UNKNOWN), and `[observability]` config. We extend it with the new `event_type` taxonomy and PII rules.

**Anti-patterns avoided:**

- Storing logs in Airtable (current pain — quota, query UX).
- Using `passThroughOnException()` (DL-180 anti-pattern, hides bugs).
- Synchronous logging on the request path.
- Logging full PII into the R2 archive.

---

## Codebase Findings (Phase C)

(From Explore agent map.)

**Existing patterns to reuse:**

- `api/src/lib/error-logger.ts` — `logError(ctx, env, {endpoint, error, category, details})` with fire-and-forget `waitUntil()` already at **32 call sites across 22 files**. We extend this module rather than create a new one.
- `api/src/lib/security-log.ts:5` — `logSecurity()` posts to Airtable. We rewrite this internal sink to emit structured `console.log` instead of an Airtable HTTP call, keeping the same outward signature so all 32 callers stay unchanged.
- `api/src/lib/token.ts` `verifyToken()` — reused for admin auth on `/webhook/events` and viewer endpoints.
- Hono router at `api/src/index.ts:39` — mount new `events` and `admin-dev-activity` routes alongside existing ones.
- React island bridge — `frontend/admin/react/src/islands/client-detail.tsx` is the pattern; new `activity-viewer.tsx` follows the same `window.mountActivityViewer` contract documented in `frontend/admin/react/README.md`.
- Tab system in `frontend/admin/js/script.js:329` `switchTab()` — add a hidden `dev_activity` tab.

**Greenfield (no existing code):**

- Frontend `sendBeacon` / `fetch keepalive` telemetry — new helper in `frontend/shared/`.
- R2 bucket + Logpush job — wrangler.toml needs `[[r2_buckets]]` + `logpush = true`.
- `DEV_PASSWORD` secret + verification endpoint.

---

## Proposed Solution

### Success Criteria
A developer can open `/admin/dev/activity`, enter the dev password, and see a real-time, filterable timeline of every server event (inbound emails, AI classifications, admin approvals, client logins, doc uploads) plus admin UI clicks — with all PII masked unless the event opted in.

### Architecture (one diagram)

```
┌─ Workers (api/) ──┐    ┌─ n8n workflows ──┐    ┌─ Admin UI ──┐    ┌─ Client portal ──┐
│ logEvent({...})   │    │ HTTP Request →   │    │ telemetry() │    │ sendBeacon →     │
│   ↓ console.log   │    │ /webhook/events  │    │ → fetch     │    │ /webhook/events  │
└──────┬────────────┘    └────────┬─────────┘    │   keepalive │    │ (unauthed,       │
       │                          │              │ → /webhook/ │    │  HMAC client     │
       │                          │              │   events    │    │  token)          │
       │                          ↓              └──────┬──────┘    └────────┬─────────┘
       │            ┌──── /webhook/events handler ──────┴────────────────────┘
       │            │  - verify auth (admin token | client HMAC | n8n shared secret)
       │            │  - sanitize PII (email mask, phone hash)
       │            │  - emit console.log(JSON.stringify(event))
       │            └────┐
       ↓                 ↓
   ┌─ Cloudflare Workers Logs (7d hot, dashboard query builder) ─┐
   │  $event_type, $actor, $client_id, $request_id, $duration_ms │
   └──────────┬───────────────────────────────────────────────────┘
              ↓ (Logpush job, JSON gzipped, every 5 min)
   ┌─ R2 bucket activity-logs-archive (90d) ─┐
   │  /year=YYYY/month=MM/day=DD/*.json.gz   │
   └─────────────────────────────────────────┘
              ↑
   ┌─ Dev viewer ────────────────────────────────────────────┐
   │  /admin/dev/activity (hidden admin route, DEV_PASSWORD) │
   │  React island → GET /webhook/admin-dev-activity         │
   │    - last 7d: query Workers Logs API                    │
   │    - >7d:    list R2 keys, range-fetch, parse           │
   └─────────────────────────────────────────────────────────┘
```

### Event Schema (canonical)

```ts
interface ActivityEvent {
  ts: string;              // ISO 8601
  request_id: string;      // crypto.randomUUID(), shared by events in one request
  event_type: string;      // see taxonomy below
  category: 'AUTH' | 'INBOUND' | 'AI' | 'ADMIN' | 'CLIENT' | 'EMAIL' | 'WORKFLOW' | 'ERROR';
  severity: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  source: 'worker' | 'n8n' | 'admin-ui' | 'client-portal';
  actor?: string;          // 'admin' | 'cpa-204' | 'system' | client recordId
  actor_ip?: string;       // last octet zeroed
  client_id?: string;      // recXXX (Airtable record id — not PII)
  endpoint?: string;       // 'POST /webhook/approve-and-send'
  duration_ms?: number;
  status?: number;
  pii_masked: true;        // always true unless explicitly false
  details?: object;        // event-specific, must be sanitized
  error?: { category, message, stack? };  // only on errors
}
```

### Event Type Taxonomy (initial)

| Category | Event types |
|----------|-------------|
| AUTH | `auth_success`, `auth_fail`, `token_invalid`, `token_expired`, `dev_login` |
| INBOUND | `email_received`, `email_classified`, `email_dlq`, `attachment_extracted` |
| AI | `ai_classify_start`, `ai_classify_done`, `ai_classify_review`, `ai_extract_issuer` |
| ADMIN | `tab_switch`, `client_open`, `doc_approve`, `doc_reject`, `batch_send`, `reminder_send`, `assisted_link_open` |
| CLIENT | `portal_login`, `portal_doc_upload`, `portal_form_submit`, `portal_page_view` |
| EMAIL | `email_send`, `email_bounce`, `reminder_email_send` |
| WORKFLOW | `n8n_run_start`, `n8n_run_done`, `n8n_run_error` |
| ERROR | `worker_error`, `dependency_error`, `infra_error` |

### PII Strategy: client_id only + viewer-side join

**Storage rule:** logs and R2 archive contain ONLY opaque identifiers — never names, emails, phone numbers, or document filenames in clear text. Free-text `details` are sanitized.

| Field | Rule (in logger `sanitize()`) |
|-------|-------------------------------|
| email | dropped — replaced with `client_id` lookup key |
| phone | dropped |
| Hebrew name | dropped |
| client_id | passed through (opaque Airtable record ID — not PII on its own) |
| actor (admin/system) | passed through (`"admin"`, `"system"`, `"cpa-204"` — role labels, not personal data) |
| ip | last octet → `0` (`192.168.1.0`) |
| document filename | dropped — replaced with `doc_id` (Airtable record ID) |
| free-text `details` | run through regex scrubber (email + phone patterns → `[redacted]`) as a safety net |

**Render rule (dev viewer only):** the React island collects all `client_id` values on the visible page, batch-calls `GET /webhook/admin-clients-lookup?ids=rec1,rec2,...` (admin-token + dev-token gated), receives `{rec1: {name, email, phone}, ...}`, and renders human-readable info next to each row. PII flows admin → admin only, never into persistent storage.

**Why this is better than masking:**
- R2 archive is safe to export, share with auditors, or hand to a developer.
- Viewer still shows full names — no debugging pain.
- Israeli PPA Amendment 13 + GDPR friendly: log retention does not store personal data.
- If someone exfiltrates the R2 bucket, they get opaque rec IDs that are useless without Airtable access.

### Files to Change / Create

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/activity-logger.ts` | **CREATE** | New `logEvent(ctx, env, event)` API. Sanitizes PII, emits `console.log(JSON.stringify(...))`. Re-exports from `error-logger.ts` so existing `logError()` keeps working but routes through new path. |
| `api/src/lib/security-log.ts` | MODIFY | Internal `logSecurity()` swap: stop posting to Airtable, call `logEvent()` instead. **Dual-write phase 1:** also keep the Airtable POST for 2 weeks behind a `LEGACY_LOG_TO_AIRTABLE` flag. |
| `api/src/lib/error-logger.ts` | MODIFY | Wrap `logError()` to also emit a structured event via `logEvent()` (in addition to current security-log call). |
| `api/src/lib/pii.ts` | **CREATE** | `maskEmail()`, `hashPhone()`, `maskFilename()`, `redactIp()`, `sanitizeDetails()`. |
| `api/src/routes/events.ts` | **CREATE** | `POST /webhook/events`. Auth: admin token OR client HMAC OR n8n shared secret. Calls `logEvent()`. Returns `{ok:true}` fast. |
| `api/src/routes/admin-dev-activity.ts` | **CREATE** | `POST /webhook/admin-dev-verify` (validates `DEV_PASSWORD`, returns 30-min dev token). `GET /webhook/admin-dev-activity` (queries Workers Logs API + R2 for older). `POST /webhook/admin-clients-lookup` (batch fetch names/emails by `client_id[]` for the viewer-side PII join). All require admin token + dev token. |
| `api/src/index.ts` | MODIFY | Mount the two new routers. |
| `api/wrangler.toml` | MODIFY | Add `[[r2_buckets]] binding="ACTIVITY_LOGS"`. Add `logpush = true` under `[observability]`. |
| `api/src/types.ts` (or `Env`) | MODIFY | Add `ACTIVITY_LOGS: R2Bucket`, `DEV_PASSWORD: string`, `PII_HASH_KEY: string`, `N8N_INTERNAL_KEY: string`. |
| `frontend/shared/telemetry.js` | **CREATE** | `logUiEvent(type, details)` — uses `fetch('/webhook/events', {keepalive:true, method:'POST', headers:{Authorization}})`. Fires on `visibilitychange` for batched events. |
| `frontend/admin/js/script.js` | MODIFY | Import `telemetry.js`. Hook `switchTab()` (line 329), approve/reject buttons, batch-send, reminder-send. Add hidden `dev_activity` tab + `mountActivityViewer` call. Bump `?v=NNN` cache version. |
| `frontend/admin/index.html` | MODIFY | Add `<script>` + `<link>` for the new island. Add hidden tab markup. |
| `frontend/admin/react/src/islands/activity-viewer.tsx` | **CREATE** | React island. Filters (date range, actor, event_type, client). Per-client timeline view. Real-time tail (poll every 5s while on tab). Password gate UI. |
| `frontend/admin/react/vite.config.ts` | MODIFY | Add `activity-viewer` as a second build entry. |
| Client portal pages (`frontend/portal/*.html` or wherever) | MODIFY | Add `<script src="/shared/telemetry.js">` + portal-specific event hooks (login, doc upload, form submit). |
| n8n workflows (7 nodes, 6 workflows from DL-094 + new ones for inbound/AI/email) | UPDATE via MCP | Replace Airtable `httpRequest()` POST with `httpRequest()` to `/webhook/events`. Add to inbound/AI/email workflows for full coverage. |
| Cloudflare dashboard | MANUAL | Create R2 bucket `activity-logs-archive`. Create Logpush job: dataset=`workers_trace_events`, destination=R2, filter=`Outcome != "exception" OR Outcome = "exception"` (all). |
| `.agent/design-logs/security/094-security-monitoring-logging.md` | MODIFY | Mark `[SUPERSEDED by DL-365]` once dual-write phase ends. |
| `.agent/current-status.md` | MODIFY | Add Section 7 test items. |
| `docs/architecture/system-overview.mmd` | MODIFY | Add R2 archive box + new `/webhook/events` ingress. |
| `docs/airtable-schema.md` | MODIFY | Mark `security_logs` table as deprecated (post dual-write). |
| `docs/privacy-compliance.md` | MODIFY | Update with R2 retention + redaction rules. |

### Phased Rollout

**Phase 1 — Foundation (1 session, no traffic yet):**
- Create `pii.ts`, `activity-logger.ts`, `events.ts` route
- Update `wrangler.toml` (R2 + logpush) — needs manual R2 bucket creation
- Update `Env` types
- Deploy. Test `console.log` emission via `wrangler tail`.

**Phase 2 — Server-side instrumentation (1 session):**
- Wrap `logError()` to also call `logEvent()`
- Modify `logSecurity()` for dual-write
- Add `logEvent()` calls at key spots: inbound processor (`processor.ts:428,1068`), classifications (`classifications.ts:539,2041,2445`), approve-and-send (line 263), upload-document (line 125)

**Phase 3 — Admin UI telemetry + viewer (1 session):**
- `frontend/shared/telemetry.js` + admin script.js hooks
- Cache-bust script.js version
- React island scaffold + Vite build entry
- Dev-password endpoint + viewer UI

**Phase 4 — Client portal + n8n (1 session):**
- Portal page hooks
- Update n8n workflows via MCP

**Phase 5 — Migration (after 2 weeks of dual-write):**
- Verify new system has full coverage
- Strip `LEGACY_LOG_TO_AIRTABLE` paths
- Deactivate `[MONITOR] Security Alerts` and `[MONITOR] Log Cleanup` n8n workflows OR repoint them at the new event stream
- Mark Airtable `security_logs` deprecated

---

## Technical Constraints & Risks

- **64KiB cap on `sendBeacon`** — only used for client portal page-view pings; admin uses `fetch keepalive`.
- **Workers Logs 256KB per entry** — events with large `details` must be truncated server-side.
- **R2 cost** — at ~1000 req/day × maybe 5 events each = 5000/day = ~150K/month. Paid Workers tier includes 20M/month, R2 storage <1GB/year. **<$1/month estimated.**
- **CF Logs API** — for the viewer to read 7d hot logs we need the Cloudflare API token; this lives only in the Worker (`env.CF_API_TOKEN`), never client-side.
- **Risk: forgetting to redact** — mitigated by central `sanitize()` in `logEvent()`, no caller can bypass.
- **Risk: dual-write doubles Airtable write load for 2 weeks** — at our volume (~10 auth events/hour) negligible.
- **Risk: telemetry beacons fail silently** — fine, telemetry is best-effort.
- **Breaking changes:** none — `logError()` signature unchanged. Existing security_logs table stays for 2 weeks.

---

## Validation Plan (Section 7)

- [ ] Phase 1: `wrangler tail` shows structured JSON log when calling `/webhook/events` from curl.
- [ ] Phase 1: R2 bucket `activity-logs-archive` exists; Logpush job created and "Active".
- [ ] Phase 1: After 5 min idle traffic, R2 bucket has at least one `.json.gz` file.
- [ ] Phase 2: Trigger an admin login → CF Logs dashboard query `event_type = "auth_success"` returns the event.
- [ ] Phase 2: Trigger an inbound email → events `email_received` + `email_classified` appear with the same `request_id`.
- [ ] Phase 2: Confirm dual-write — Airtable `security_logs` still receives auth events.
- [ ] Phase 3: PII check — trigger an event involving a known client; confirm CF Logs entry contains `client_id: rec...` only (no email, no name, no phone). Inspect a downloaded R2 archive file and grep for the email/name — must return zero hits.
- [ ] Phase 3: Viewer renders human names — open `/admin/dev/activity`, confirm rows show "Moshe Cohen <moshe@...>" pulled via `/admin-clients-lookup`. Block: revoke admin token → lookup endpoint returns 401.
- [ ] Phase 3: Open `/admin/dev/activity` without dev password → blocked. With dev password → loads timeline.
- [ ] Phase 3: Tab switches in admin panel produce `tab_switch` events visible in viewer within 5s.
- [ ] Phase 3: Approve a client batch → see chained events `doc_approve` → `email_send` correlated by `request_id`.
- [ ] Phase 4: Client portal login → `portal_login` event appears.
- [ ] Phase 4: n8n workflow run → `n8n_run_start` + `n8n_run_done` events.
- [ ] Phase 5: After 2 weeks — toggle `LEGACY_LOG_TO_AIRTABLE=false`, confirm no regression.
- [ ] Verify no regression: existing `logError()` callers still produce error logs visible in CF dashboard.

---

## Housekeeping (final task in Phase D)

- Update DL-365 status → `[IMPLEMENTED — NEED TESTING]`
- Append unchecked Section 7 items to `.agent/current-status.md` Active TODOs
- Update `docs/architecture/system-overview.mmd`
- Commit + push branch `DL-365-activity-logger`
- `wrangler deploy` from `api/` (Workers code touched)
- Pause for explicit merge-to-main approval (per `feedback_ask_before_merge_push.md`)

---

## Implementation Notes

- 2026-04-28 — Phase 1 (Foundation) implementation started. Tasks T1 (pii.ts), T2 (activity-logger.ts), T3 (Env types), T4 (events route), T5 (router mount), T6 (wrangler.toml R2+logpush), T7 (this file).
- 2026-04-29 — **Phase 2 (server-side instrumentation) implemented.** Plan: `~/.claude/plans/velvet-wandering-quasar.md`. Changes:
  - `api/src/lib/security-log.ts` — `logSecurity()` now dual-writes: always emits a structured event via `logEvent()`, only POSTs to Airtable when `env.LEGACY_LOG_TO_AIRTABLE !== 'false'`. Added `mapCategory()` + `mapSeverity()` helpers.
  - `api/src/lib/error-logger.ts` — `logError()` synchronously emits `event_type: 'worker_error'` via `logEvent()` BEFORE the existing `ctx.waitUntil()` Airtable+alert path. Added optional `request_id` to opts.
  - `api/src/lib/types.ts` — added `LEGACY_LOG_TO_AIRTABLE?: string` to `Env`.
  - `api/wrangler.toml` — added `LEGACY_LOG_TO_AIRTABLE = "true"` under `[vars]`.
  - `api/src/index.ts` — Hono middleware threads `request_id` (from `x-request-id` header or new UUID) onto the context for every request.
  - **Signature change:** `logSecurity(ctx, airtable, fields)` → `logSecurity(ctx, env, airtable, fields, request_id?)`. Updated all 24 call sites across 11 files (auth, approve-and-send, admin-assisted-link, edit-documents, documents, client-reports, submission, reset, classifications, reminders, processor).
  - **New business-event sites:**
    - `processor.ts` `summarizeAndSaveNote()` — `event_type: 'inbound_note_saved'`, `category: 'INBOUND'`.
    - `processor.ts` `processAttachmentWithClassification()` end — `event_type: 'attachment_classified'`, `category: 'AI'`.
    - `classifications.ts` `/get-client-classifications` — `event_type: 'classifications_listed'`, `category: 'AI'`, `duration_ms`.
    - `classifications.ts` `/review-classification` — `event_type: 'doc_approve' | 'doc_reject' | 'doc_reassign'`, `category: 'ADMIN'`.
    - `approve-and-send.ts` — `event_type: 'batch_send'`, `category: 'EMAIL'`, `details.doc_count`.
    - `upload-document.ts` — `event_type: 'doc_upload'`, `category: 'CLIENT'`.
  - `assign-unidentified` already covered via `logSecurity` dual-write (`INBOUND_DISCARDED` / `INBOUND_MANUAL_ASSIGN` event types).
  - TypeScript typecheck clean (only pre-existing unrelated errors in `backfill.ts`, `classifications.ts:1085/2693`, `edit-documents.ts:18`).
- 2026-04-30 — **Phase 3 (admin UI telemetry + dev viewer) implemented.** Plan: `~/.claude/plans/immutable-jingling-clarke.md`. Changes:
  - `api/src/routes/admin-dev-activity.ts` — **NEW**. Three endpoints: `POST /webhook/admin-dev-verify` (DEV_PASSWORD → 30-min HMAC dev-token signed with PII_HASH_KEY), `GET /webhook/admin-dev-activity` (CF Logs API hot-tier + R2 archive fallback, filters: since/until/event_type/client_id/actor/limit), `POST /webhook/admin-clients-lookup` (batch Airtable fetch → `{name, email_masked, phone_hash}` for viewer-side PII join). All three emit their own `dev_login`/`dev_query`/`dev_lookup` events (audit-the-auditor).
  - `api/src/lib/pii.ts` — added `maskEmail()` and `hashPhone()` helpers used by the lookup endpoint.
  - `api/src/lib/airtable.ts` — added `batchGetRecords()`: fetches up to 200 records by ID using `RECORD_ID()` formula chunks of 10.
  - `api/src/lib/types.ts` — added `CF_ACCOUNT_ID?: string` and `CF_API_TOKEN?: string` to `Env`.
  - `api/src/index.ts` — mounted `adminDevActivity` router under `/webhook`.
  - `frontend/shared/telemetry.js` — **NEW**. `window.logUiEvent(type, details)` queues events, flushes via `fetch keepalive` to `/webhook/events` with admin Bearer token. Auto-flushes on `visibilitychange=hidden`.
  - `frontend/admin/js/script.js` — telemetry hooks added to `switchTab()` (`tab_switch`), `approveAIClassification()` (`doc_approve_click`), `approveAndSendFromQueue()` (`batch_send_click`), `sendDashboardReminder()` (`reminder_send_click`). Added `_mountActivityViewer()` helper + `initDevTab` IIFE that reveals the hidden tab when `?dev=1` is in the URL. Cache-busted v381→v382.
  - `frontend/admin/index.html` — added hidden `<button id="dev-activity-tab-btn">` tab, `<div id="tab-dev_activity">` content div with `<div id="activity-viewer-root">`, `<script>` tags for telemetry.js and activity-viewer.js (both v=1).
  - `frontend/admin/react/src/islands/activity-viewer.tsx` — **NEW** React island (`window.mountActivityViewer` / `window.unmountActivityViewer`). Components: DevPasswordGate, FilterBar (presets + datetime/event_type/client_id/actor/live-tail toggle), Timeline (5s poll when live=true + visible), EventRow (expand to JSON). Viewer-side PII join via `/admin-clients-lookup`.
  - `frontend/admin/react/vite.config.ts` — reverted to single-entry (client-detail.tsx). Multi-entry IIFE not supported by Vite lib mode.
  - `frontend/admin/react/vite.config.activity.ts` — **NEW** second config for activity-viewer island (emptyOutDir:false).
  - `frontend/admin/react/package.json` — `build` script now runs both Vite configs sequentially.
  - `frontend/admin/react/src/types/globals.d.ts` — added `mountActivityViewer`, `unmountActivityViewer`, `logUiEvent`, `_telemetryFlush` to Window interface.
  - Both islands build clean: client-detail.js 190KB, activity-viewer.js 152KB.
  - **Pending before deploy:** `wrangler secret put DEV_PASSWORD` + `wrangler secret put PII_HASH_KEY` (if not already set). Optionally also `wrangler secret put CF_ACCOUNT_ID` + `wrangler secret put CF_API_TOKEN` for hot-tier query (endpoint falls back to R2-only if absent).
- Phase 4 deferred (client portal hooks + n8n workflow updates).
