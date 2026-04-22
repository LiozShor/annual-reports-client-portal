# Design Log 322: Instrument `summarizeAndSaveNote` silent-exit paths
**Status:** [BEING IMPLEMENTED — DL-322]
**Date:** 2026-04-22
**Related Logs:** DL-180 (error logging), DL-199 (client communication notes), DL-259 (notes at all stages), DL-282 (forwarded-email note resolver), DL-287 (Cloudflare Queues)

## 1. Context & Problem

On **2026-04-21 15:05 UTC**, an inbound email from `coralhouse2@gmail.com` (Graph message `CAC7HTUAHtBT...`) arrived for client משה פרג'י (report `reccKrGdxPBaAC8Xc`, year 2025, stage `Collecting_Docs`). n8n execution **12219** validated → extracted → 202'd → Forward to Worker returned `{ok:true, status:"enqueued"}`.

The Worker consumer ran `summarizeAndSaveNote` but the note was **never written** to Airtable — `client_notes` on the report is empty. The root cause is not diagnosable post-hoc because the function has four silent-exit paths with no observability:

| # | Line | Condition | Current handling |
|---|------|-----------|------------------|
| 1 | 311 | `internet_message_id` already in `client_notes` (dedup) | `return;` — no log |
| 2 | 318 | `cleanBody.length < 10 && subject.length < 5` | `return;` — no log |
| 3 | 375 | LLM `parse_client_email` returned `skip: true` | `return;` — no log |
| 4 | 402 | Any exception in LLM call / Airtable update | `console.error` only |

Path 1 is ruled out (notes empty → no prior `message_id` could match), but paths 2/3/4 are indistinguishable.

## 2. User Requirements

1. **Q:** Where should telemetry be stored?
   **A:** logError to KV / `security_logs` (existing pattern from DL-180).
2. **Q:** Severity for LLM skip?
   **A:** `INFO` only — `skip=true` is by-design for attachment-only forwards; don't create alert-email noise.
3. **Q:** What metadata to capture?
   **A:** `message_id` + `report_id` + `client_id` + skip reason enum. **No PII** (subject / bodyPreview) and no raw LLM response.
4. **Q:** Retry/fallback on LLM exception?
   **A:** No — observability first. Revisit if logs show it's common.

## 3. Research

### Domain
Resilience Engineering — observability of silent failures in async pipelines.

### Sources Consulted
1. **Release It! (Nygard)** — "Every call to a remote system is a crack in the wall" and "If you can't see it, you can't fix it." Skip logs must be lightweight or they'll be disabled.
2. **SRE Book (Google) — ch. 6 Monitoring** — Distinguish *symptoms* from *causes*: skip events are causes, lack of note is the symptom. Log causes at the origin.
3. **OpenTelemetry SpanEvents pattern** — Record discrete branch-taken events inside a single operation instead of creating separate spans per branch; low-cost + high-signal.

### Key Principles Extracted
- **Instrument at every silent exit.** Fire-and-forget logging is cheap; uninstrumented paths are debt.
- **Severity discipline.** By-design skip ≠ error. Mixing them defeats the alert channel.
- **Structured details over free text.** JSON in the `details` field supports future querying without schema changes.

### Patterns to Use
- **Existing `logSecurity` helper** (severity `INFO`) for by-design skips — writes to Airtable `security_logs` with `typecast:true`, fire-and-forget via `ctx.waitUntil`.
- **Existing `logError` helper** (category `INTERNAL`, severity `ERROR`) for the exception path — inherits DL-180's throttled alert emails.

### Anti-Patterns to Avoid
- **Logging every skip as ERROR** — floods alert channel with attachment-only forwards.
- **New KV namespace / Airtable table** — duplicates DL-180 infra for no gain.
- **Capturing subject / bodyPreview** — PII in security_logs, violates data-minimization.

### Research Verdict
Use existing `logSecurity` for INFO-level skip events (three paths), existing `logError` for the exception path (one path). Zero new infrastructure. Uniform `event_type: INBOUND_NOTE_SKIPPED` for the three skip paths with `reason` enum in `details` for slicing.

## 4. Codebase Analysis

- **Existing Solutions Found:**
  - `api/src/lib/error-logger.ts` — `logError(ctx, env, {endpoint, error, category, details})` with throttled alert (DL-180)
  - `api/src/lib/security-log.ts` — `logSecurity(ctx, airtable, fields)` raw Airtable write, any severity
  - `SecurityLogFields` in `api/src/lib/types.ts:81-91` supports `INFO | WARNING | ERROR`
- **Reuse Decision:** Both helpers reused as-is, no new abstractions.
- **Relevant Files:**
  - `api/src/lib/inbound/processor.ts:292-404` — `summarizeAndSaveNote` (edit target)
  - `api/src/lib/inbound/processor.ts:755` — single call site (add `clientMatch.clientId` argument)
- **Existing Patterns:** 15+ call sites of `logSecurity` with `severity: 'WARNING' | 'INFO'` across routes — the INFO pattern is established (`routes/auth.ts:44`, `routes/admin-assisted-link.ts:80`).
- **Dependencies:** `security_logs` Airtable table with `typecast:true` — auto-creates the new `event_type` select option on first write.

## 5. Technical Constraints & Risks

- **Security:** Details payload contains no PII (only IDs). `message_id` is not secret. `client_id` is a CPA code, already present in other security_logs rows.
- **Risks:**
  - Alert-spam risk if LLM exceptions become frequent — DL-180's 15-min INTERNAL cooldown throttles this.
  - `security_logs` volume bump from INFO rows — Airtable row count is well within plan limits; rows are small (<500B each).
- **Breaking Changes:** None. Pure instrumentation, no behavior change.

## 6. Proposed Solution

### Success Criteria
Every future silent exit in `summarizeAndSaveNote` produces a queryable `security_logs` row with enough metadata (`message_id`, `report_id`, `client_id`, `reason`) to diagnose the cause without reproducing the event.

### Logic Flow (inside `summarizeAndSaveNote`)
1. Declare `logSkip(reason)` local closure → wraps `logSecurity` with `event_type: INBOUND_NOTE_SKIPPED`, `severity: INFO`, JSON-stringified details.
2. Dedup hit → `logSkip('dedup')` before return.
3. Body-too-short → `logSkip('body_too_short')` before return.
4. LLM skip=true → `logSkip('llm_skip')` before return.
5. `catch` block → keep existing `console.error` AND add `logError(...)` with category `INTERNAL`.

### Data Structures / Schema Changes
- New `details` JSON payload shape (not a schema change — `details` is already a free-text string):
  ```json
  { "reason": "dedup|body_too_short|llm_skip", "message_id": "...", "report_id": "rec...", "client_id": "CPA-XXX" }
  ```
- Airtable `security_logs.event_type` gains a new select option `INBOUND_NOTE_SKIPPED` via `typecast:true` on first write.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/processor.ts` | Modify | (1) import `logSecurity` from `../security-log`; (2) add `clientId: string` param to `summarizeAndSaveNote`; (3) declare `logSkip` closure; (4) call at 3 skip sites + `logError` at catch; (5) pass `clientMatch.clientId` at call site line 755 |
| `.agent/design-logs/infrastructure/320-note-save-silent-failures.md` | Create | This file |

### Final Step (Always)
- Housekeeping — update status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 unchecked items to `.agent/current-status.md` under Active TODOs.

## 7. Validation Plan
- [ ] `./node_modules/.bin/tsc --noEmit` — no new errors introduced by this change
- [ ] `wrangler deploy` from `api/` succeeds
- [ ] **Skip path (LLM):** forward an attachment-only email (no body) from a known client. Verify Airtable `security_logs` gains an `INFO` row with `event_type: INBOUND_NOTE_SKIPPED`, `details` containing `reason: llm_skip` (or `body_too_short` if the body is truly empty). No alert email sent. `client_notes` on the report remains empty.
- [ ] **Dedup path:** re-deliver the same `internetMessageId` (e.g., via Graph resubscribe replay) to a report whose `client_notes` already contains that id. Verify a `reason: dedup` row appears.
- [ ] **Exception path (optional, dev-only):** temporarily throw inside the try block; confirm an `ERROR` row with category `INTERNAL` lands in security_logs + alert email fires (throttled). Revert the throw before commit.
- [ ] **Regression:** send a normal email with real body text. Verify note IS saved to `client_notes` AND no `INBOUND_NOTE_SKIPPED` row is created for this message.
- [ ] **Retro-check coralhouse2 event:** after next inbound from this sender, inspect `security_logs` to confirm which exit path is responsible (expected: `llm_skip` — reply-with-attachments common pattern).

## 8. Implementation Notes (Post-Code)
- Path-counter approach uses a local `logSkip` closure that captures `msgId`, `report.reportRecordId`, `clientId` — avoids repetition at three call sites and keeps the signature change minimal (one added param: `clientId: string`).
- Applied **SRE "log causes, not symptoms"** principle: the silent exit is the *cause*; empty `client_notes` is the *symptom*. Logging at the exit paths makes the cause observable without touching the symptom surface.
- Applied **OpenTelemetry SpanEvent pattern conceptually**: discrete branch-taken events recorded inside the same logical operation, not separate spans.
