# Design Log 417: Stuck Inbound Email Events — Diagnose + Monitor
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-17
**Related Logs:** DL-287 (CF Queues inbound), DL-365 (Activity logger), DL-399 (Bounce handler), DL-406 (Aging colors), DL-409 (Inbound dedup), DL-405 (Modules pattern)

## 1. Context & Problem

Office reported that `email_events` rows (Airtable `tblJAPEcSJpzdEBcW`) sit with `processing_status ≠ Completed` and they can't tell whether the client's documents or message actually made it through the pipeline. Today these rows are only visible by opening the Airtable view directly — there is **no admin surface, no alert, no reprocess button**. We need:

1. A **one-shot diagnosis** for every currently-stuck row: did the attachments land in OneDrive? Did the body summary land in `reports.client_notes`? Are there R2 / Workers Logs traces?
2. **Permanent monitoring** so future stuck rows don't accumulate silently.

If nothing changes: stuck rows accumulate invisibly, occasional client doc loss goes unnoticed until the client complains, and we can't tell post-hoc whether the data was preserved elsewhere.

## 2. User Requirements

1. **Q:** What's the goal of this investigation?
   **A:** Diagnosis + permanent monitoring.
2. **Q:** Which "memories" should we check for each stuck email?
   **A:** Airtable (client_notes / documents / pending_classifications), OneDrive client folder, R2 activity-logs-archive (90d), Workers Logs (7d hot tier).
3. **Q:** What time window of email_events are we looking at?
   **A:** All non-Completed rows in the view (regardless of age).
4. **Q:** Which processing_status values count as "not completed"?
   **A:** Anything except `Completed` — bucket by status in the report.

## 3. Research

### Domain

Dead-letter queue (DLQ) visibility and stuck-row reconciliation in event-driven pipelines.

### Sources Consulted

1. **AxonOps — Dead Letter Queues (Kafka)** — Classify errors into Transient / Recoverable / Corrupt / Poison; only Recoverable goes to "fix → reprocess." This DL maps `Failed`/`Detected` to Recoverable, `Bounced`/`Discarded` to terminal.
2. **OneUptime — How to Handle SQS DLQ Messages (Dec 2025)** — "Always diagnose root cause before reprocessing to avoid immediately re-failing." Also: "Archive before deleting — store DLQ messages in S3 for audit trails." Already satisfied by our R2 90d archive (DL-365).
3. **ranthebuilder.cloud — SQS DLQ best practices (Sep 2025)** — Self-healing redrive via scheduled job is only safe AFTER root-cause classification; manual diagnosis dashboard precedes any auto-replay.
4. **Superstream — Kafka DLQ monitoring** — Key metrics: message volume, age of oldest message, error-type distribution. Drives the widget's bucket-counts + aging-tint design.

### Key Principles Extracted

- **Diagnose before reprocess.** Track A produces evidence, Track B surfaces it, Track C (deferred) is the action.
- **Bucket by error category, not just by raw status.** `NeedsHuman` is action-required-by-design, not a bug — it already has UI in AI-Review. Don't conflate it with `Failed`.
- **Surface oldest-stuck first.** Aging-tint via DL-406 palette flags rows that have been sitting >24h.
- **Stamp terminal state on DLQ exhaustion** so the audit trail in Airtable matches the actual delivery outcome.

### Patterns to Use

- **Read-only diagnostic script first** (`scripts/dl417-diagnose-stuck-emails.mjs`) — same shape as DL-287 verification scripts and DL-365 log queries.
- **Module-first frontend** (`frontend/admin/js/modules/stuck-emails-widget.js`) — monolith-ratchet-safe (DL-405, DL-406, DL-399 patterns).
- **Share `aging-colors.js` palette** (DL-406) — don't introduce a parallel aging convention.
- **Cheap-presence checks in the route, expensive R2 probes only in the script.** Keeps the admin endpoint snappy.

### Anti-Patterns to Avoid

- **Auto-replay from the widget without root-cause classification** — violates Tavily research principle, can re-trigger the original failure loop.
- **Adding `email_events` writes to `script.js`** — breaks the monolith ratchet; module-only.
- **Creating a new Airtable status value** — `processing_status` already has all 7 options (`Bounced` added in DL-399); `error_message` already used at `processor.ts:1371`.

### Research Verdict

Three-track delivery (A diagnose, B surface, C reprocess-deferred) matches industry DLQ best practices and aligns with the existing DL-287/DL-365/DL-406 patterns. No new schema; no auto-replay in scope.

## 4. Codebase Analysis

### Existing Solutions Found

- **`upsertEmailEvent()`** at `api/src/lib/inbound/processor.ts:150–178` — keyed on `source_message_id`, idempotent; reusable from DLQ consumer.
- **`logEvent()`** in `api/src/lib/activity-logger.ts` — emits to R2 archive; already fires `inbound_note_saved`, `attachment_classified`, `attachment_duplicate_skipped`, `email_bounce_handled`, `pdf_password_reply_received`.
- **`aging-colors.js`** (DL-406) — `ageTier(iso, tiers)` + palette CSS classes (`aging-day1`/`aging-aging`/`aging-stale`).
- **`scripts/query-worker-logs.mjs`** (DL-365) — already wraps CF Observability API; reuse for hot-tier checks.
- **R2 access pattern** — `aws s3 ls s3://activity-logs-archive/ --endpoint-url=$R2_S3_ENDPOINT` (memory: `reference_r2_archive_access.md`).
- **Admin auth middleware** — same pattern as `/webhook/admin-*` routes (admin token check).

### Reuse Decision

- **Reuse:** `upsertEmailEvent`, `logEvent`/`logError`, `aging-colors.js`, `query-worker-logs.mjs`, R2 AWS-CLI access, admin token middleware.
- **New:** diagnosis script (Track A), `admin-stuck-emails.ts` route + index.ts mount (Track B), DLQ stamp extension (Track B), `stuck-emails-widget.js` module + CSS (Track B).
- **Not extended:** AI-Review tab (already covers `NeedsHuman` via `pending_classifications` — widget links there).

### Relevant Files

- `api/src/lib/inbound/processor.ts` — full status-write map (rows 150, 974, 979, 1043, 1064, 1117, 1127, 1348, 1361, 1370, 885)
- `api/src/lib/inbound/dlq-consumer.ts:24-53` — currently logs + alerts, doesn't stamp Airtable
- `api/wrangler.toml:63-84` — queue + DLQ binding (max_retries=3)
- `api/src/routes/inbound-email.ts` — producer (creates no row, just enqueues)
- `frontend/admin/js/modules/aging-colors.js` — palette reuse
- `frontend/admin/js/modules/bounce-warning.js` — sibling-pattern reference

### Existing Patterns

- Module extraction to satisfy script.js ratchet: DL-405 (`client-row-actions.js`), DL-406 (`aging-colors.js`), DL-399 (`bounce-warning.js`), DL-413 (`xlsx-loader.js`).
- Admin route auth via `Authorization: Bearer <ADMIN_TOKEN>` header.
- Silent refresh after any mutation (CLAUDE.md P6).

### Alignment with Research

Codebase already has the R2 archive (matches "archive before deleting") and the activity logger (matches "include error context"). The missing piece research demanded — **monitoring DLQ depth + age** — is exactly what Track B's widget delivers.

### Dependencies

- Airtable REST API (no new scope additions)
- MS Graph (read-only OneDrive listing for Track A)
- R2 via AWS-S3 API (Track A, read-only)
- CF Observability API (Track A optional, read-only)

## 5. Technical Constraints & Risks

- **Security:** Admin endpoint uses existing admin-token middleware; no new auth surface. Audit report kept in `tmp/` (gitignored); Airtable recIds are needed for the audit's value but trip the `.agent/` PII guard, so the report stays local. The committed DL contains only counts, not recIds.
- **Operational Risks:** DLQ-stamp extension must be fail-open (if Airtable upsert errors, still ack — never re-fail a DLQ message because of a downstream write). Live admin endpoint hit O(N) Airtable list calls; cap result count (`pageSize=100`, `since=30d` default).
- **Breaking Changes:** None. No schema changes. Widget is additive to dashboard.
- **Mitigations:** DLQ stamp wrapped in `try/catch` with `logError(category=DEPENDENCY)` on failure, then ack. Route paginates and caches via Workers cache API with 60s TTL for the count summary. Monolith ratchet enforced — no edits to `script.js`; widget is a new module.

## 6. Proposed Solution

### Success Criteria

(1) Audit report (kept in `tmp/`, not committed — contains Airtable recIds) lists every current non-Completed `email_events` row with a per-row verdict of where the data ended up. (2) Admin dashboard shows a "Stuck Emails" card (Hebrew label in the live widget) with live bucket counts, aging tints, and a modal listing rows with Airtable deep-links. (3) Newly-DLQ'd emails get `Failed` + `error_message` stamped automatically.

### Logic Flow

**Track A (script):**
1. List all `email_events` where `processing_status != Completed` (Airtable).
2. Bucket: `Failed`+`Detected` → stuck; `NeedsHuman`+`PasswordReply` → action-required; `Bounced`+`Discarded` → terminal-expected.
3. For each row: fetch linked `report`, `pending_classifications[]`; check `reports.client_notes` JSON for body summary; probe OneDrive (client folder or "לקוח לא מזוהה"); grep R2 archive by `source_message_id`.
4. Emit per-row verdict: `✅ data preserved` / `⚠️ partial` / `❌ silent drop`.

**Track B (Worker route):**
1. `GET /webhook/admin/stuck-emails?bucket=stuck|action-required|all&since=30d`
2. List Airtable email_events filtered by `processing_status != Completed` and `received_at >= since`.
3. For each row, do cheap reverse-link presence checks (NOT R2). Return shape: `{counts: {...}, rows: [...]}`.
4. Cache 60s in CF Cache API.

**Track B (widget):**
1. Load `stuck-emails-widget.js` on dashboard mount.
2. Fetch `/webhook/admin/stuck-emails?bucket=all&since=7d` → render card with bucket-counts and aging tints.
3. Card click → modal lists rows; each row links to Airtable record + (for `NeedsHuman`) jumps to AI-Review tab.

**Track B (DLQ stamp):**
1. In `dlq-consumer.ts`, before the existing log+alert+ack, parse the failed message body for `source_message_id`.
2. Call `upsertEmailEvent({source_message_id, processing_status: 'Failed', error_message: dlqReason})`.
3. Fail-open `try/catch`; ack always.

### Data Structures / Schema Changes

None. `email_events.processing_status` and `error_message` already exist.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `.agent/design-logs/infrastructure/417-stuck-email-events-diagnose-and-monitor.md` | Create | This DL |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-417 row |
| `scripts/dl417-diagnose-stuck-emails.mjs` | Create | Track A diagnostic |
| `tmp/dl417-stuck-email-events-2026-05-17.md` | Create (generated) | Audit output (kept local, recIds trip PII guard) |
| `api/src/routes/admin-stuck-emails.ts` | Create | Worker route |
| `api/src/index.ts` | Modify | Mount route (one line) |
| `api/src/lib/inbound/dlq-consumer.ts` | Modify | Stamp `Failed` on Airtable before ack |
| `frontend/admin/js/modules/stuck-emails-widget.js` | Create | Dashboard card + modal |
| `frontend/admin/index.html` | Modify | `<script>` tag + cache-bust |
| `frontend/admin/style.css` | Modify | Card styling (reuse aging palette) |
| `docs/airtable-schema.md` | Modify | Clarify 7-status semantics |

### Final Step

- Update design log status to `[IMPLEMENTED — NEED TESTING]`.
- Update INDEX.md.
- Copy unchecked Section 7 items to `.agent/current-status.md`.
- Invoke `git-ship` for commit/push.

## 7. Validation Plan

- [ ] Track A: run `node scripts/dl417-diagnose-stuck-emails.mjs` from canonical clone; audit report generated under `tmp/`
- [ ] Track A: manually cross-check ≥3 rows of each bucket vs. Airtable + OneDrive — script verdict matches reality
- [ ] Track B: TypeScript compile clean (`./node_modules/.bin/tsc --noEmit` from `api/`)
- [ ] Track B: `bash .claude/workflows/deploy-worker.sh` succeeds and `/webhook/health` returns 200
- [ ] Track B: `curl -H "Authorization: Bearer $ADMIN_TOKEN" $WORKER_URL/webhook/admin/stuck-emails?bucket=all` returns `{counts, rows}` JSON
- [ ] Track B: open admin panel → widget shows on dashboard with counts matching Airtable view
- [ ] Track B: click row → modal opens → Airtable deep-link works
- [ ] Track B: inject malformed message to producer → after ~2 min DLQ exhaustion → `email_events` row has `Failed` + `error_message`
- [ ] End-to-end: forward real auto-reply → confirms `Completed` within 60s (no widget delta)
- [ ] End-to-end: forward email from unknown sender → widget `NeedsHuman` count increments live (silent refresh works)

## 8. Implementation Notes

**Deviation from plan:** Per mid-implementation user instruction ("i want only my me. dev=1"), the admin UI changed from a dashboard card visible to all users to a **dev-only floating panel** gated behind `?dev=1` URL param (DL-365 Phase 3 pattern). Self-contained module — no `script.js` edits, no `style.css` edits, no `index.html` markup changes beyond a single `<script>` tag. Renders a fixed-position toggle button (top-left) + slide-in side panel with bucket filter pills, aging tints, sender masking, badge indicators, and per-row "Open in Airtable" link.

**Track A run output (2026-05-17):** 32 non-Completed rows scanned. Buckets: STUCK=8 (Failed/Detected), ACTION_REQUIRED=22 (NeedsHuman/PasswordReply), TERMINAL_EXPECTED=2. Notable finding: 2 STUCK rows from 2026-05-05 failed with `422 UNKNOWN_FIELD_NAME: "merged_into"` — these are DL-404 dead-letters that this DL's monitoring would have caught instantly (recIds in `tmp/dl417-stuck-email-events-2026-05-17.md`). Several NeedsHuman rows trace to Drive-link `too_large` errors (pre-DL-414 cap); worth re-running after DL-414's 50 MB raise to see if they auto-resolve.

**Research principles actually applied:**
- "Diagnose before reprocess" — Track A produces verdicts; no auto-replay shipped.
- "Bucket by error category" — `stuck` / `action-required` / `terminal` separation in route + widget; `NeedsHuman` is intentionally not in `stuck`.
- "Surface oldest-stuck first" — widget sorts by `received_at desc` and shows age in TIERS palette.
- "Stamp terminal state on DLQ exhaustion" — DLQ consumer now `upsertEmailEvent({ source_message_id, processing_status: 'Failed', error_message, last_error_step: 'dlq_exhausted' })` via `ctx.waitUntil` (fail-open, ack always preserved).

**Files actually changed (Phase D):**
- `scripts/dl417-diagnose-stuck-emails.mjs` (new, 270 lines)
- `tmp/dl417-stuck-email-events-2026-05-17.md` (generated; kept local — Airtable recIds trip the .agent/ PII guard)
- `api/src/routes/admin-stuck-emails.ts` (new, 130 lines)
- `api/src/index.ts` (+2 lines: import + mount)
- `api/src/lib/inbound/dlq-consumer.ts` (+30 lines: `stampDlqFailureOnAirtable` helper + `ctx.waitUntil` call)
- `frontend/admin/js/modules/stuck-emails-widget.js` (new, 200 lines)
- `frontend/admin/index.html` (+1 line: `<script>` tag)
- `.agent/design-logs/infrastructure/417-stuck-email-events-diagnose-and-monitor.md` (this DL)
- `.agent/design-logs/INDEX.md` (DL-417 row added)

**TypeScript check:** `./node_modules/.bin/tsc --noEmit` from `api/` — new files compile clean. Two pre-existing errors (`src/index.ts:134`, `src/lib/activity-logger.ts:16`) are not from this DL.

**PII guard:** the audit file was originally written to `.agent/audits/` and tripped the pre-commit guard on Airtable recIds; relocated to `tmp/` (untracked) to keep the actionable recIds locally accessible while leaving nothing PII-adjacent in `.agent/`. Script default output path updated to `tmp/` so future runs don't re-trip the hook.

**Deferred / out of scope for this DL:**
- Track C reprocess endpoint (still recommended as a follow-up DL after a few weeks of widget data).
- Invisible-stuck detection (rows that never reached `processor.ts:1043` because the consumer crashed pre-row-creation) — would need an R2 cross-reference of `inbound_received` events with no matching `email_event`.
- Backfilling the historical NeedsHuman Drive-fetch failures now that DL-414 raised the upload cap to 50 MB.
