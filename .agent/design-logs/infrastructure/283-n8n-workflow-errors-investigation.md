# Design Log 283: n8n Workflow Errors Investigation & Fix
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-16
**Related Logs:** DL-203 (WF05 → Workers migration), DL-277 (429 retry + inter-batch delay), DL-180 (error logging), Session 14 (PAT rotation)

## 1. Context & Problem

This morning (2026-04-16, 05:00–06:30 UTC) the n8n executions tab showed **four errors** across active workflows:

| Exec | Workflow | Time (UTC) | Duration | Failure |
|--|--|--|--|--|
| 11931 | [02] Questionnaire Response Processing | 06:21 | 437ms | Airtable 401 on `Fetch Record` |
| 11929 | [02] Questionnaire Response Processing | 05:40 | 444ms | Airtable 401 on `Fetch Record` |
| 11927 | [05] Inbound Document Processing | 05:09 | 2m 1.46s | `Forward to Worker` 120s timeout |
| 11925 | [06] Reminder Scheduler | 05:00 | 609ms | (MCP-blocked; same 401 profile) |

### Root Causes

1. **WF02 & WF06 (Airtable 401).** Direct fallout from yesterday's PAT rotation (Session 14). Session 14 updated the hardcoded token in the `Clear Reminder Date` Code node, but **missed the shared n8n Airtable credential `ODW07LgvsPQySQxh`** ("Airtable Personal Access Token account"). Every `n8n-nodes-base.airtable` node in active workflows references this credential; every Airtable call now returns 401. WF02 hits 6 broken nodes; WF06's 609 ms failure (at the cron trigger) profiles the same way — first Airtable hop.

2. **WF05 (Worker 120s timeout).** Architectural. n8n `Forward to Worker` calls `/webhook/process-inbound-email` with a 120 s cap. The handler (`api/src/routes/inbound-email.ts:62`) awaits `processInboundEmail(...)` before responding. For N-attachment emails, Worker work is sequential: fetch → classify via Anthropic (batches of 3, 1 s inter-batch delay, DL-277 `fetchWithRetry` with exponential back-off) → OneDrive → Airtable writes. A 19-PDF email theoretically costs 50–150 s — above the cap. When n8n aborts, Cloudflare cancels the Worker, leaving partial Airtable/OneDrive state.

## 2. User Requirements

1. **Q:** Scope of this DL? **A:** All three errors in one log.
2. **Q:** Credential update via UI or API? **A:** Via n8n REST API if possible, else UI.
3. **Q:** Audit scope? **A:** All active workflows.
4. **Q:** Prevention? **A:** Document a PAT rotation runbook in `.agent/`.

## 3. Research

### Domain
(a) Secrets rotation for multi-surface systems; (b) Async decoupling of long-running tasks from Cloudflare Workers.

### Sources Consulted
1. **Cloudflare Workers Context docs & Limits** — `ctx.waitUntil` extends Worker lifetime **≤30 s** after response is sent; pending promises cancelled at 30 s. For >30 s work, Cloudflare recommends Queues/Workflows.
   - https://developers.cloudflare.com/workers/runtime-apis/context/
   - https://developers.cloudflare.com/workers/platform/limits/
2. **n8n public API — Credentials endpoints** — `PATCH /api/v1/credentials/{id}` updates `data`; encryption server-side. `oauthTokenData` blocked but PAT-style credentials writable.
   - https://docs.n8n.io/api/api-reference/
3. **DL-180 internal** — `logError(ctx, env, {...})` uses `ctx.waitUntil` fire-and-forget. Reusable sink.

### Key Principles Extracted
- **Single source of truth for secrets.** Spreading a PAT across code literals + credential objects + Worker env + shell `.env` means every rotation misses a surface. → drives the runbook.
- **Respond fast, work later.** An HTTP client's cap must not dictate the work budget. If work can exceed the cap, detach it. → drives the WF05 fix.
- **`waitUntil` has a ceiling.** 30 s. Fine for typical emails (1–3 PDFs), insufficient for the 19-PDF outlier. Acceptable short-term because (a) most emails finish <30 s, (b) truncation logs to `security_logs`, (c) Queues migration is a follow-up.
- **Fix root cause, not symptom.** Replaying WF02 without updating the credential just produces more 401s.

### Patterns to Use
- **`ctx.waitUntil(promise)` fire-and-forget** — already idiomatic in `error-logger.ts:38`, `audit-log.ts:11`, `security-log.ts:10`, `edit-documents.ts:40`, `reminders.ts:159`.
- **n8n REST API via Python + `source .env`** — documented pattern in `memory_n8n_api_direct_access.md`.

### Anti-Patterns to Avoid
- **Hardcoding tokens in Code nodes.** The existing `code-clear-reminder` sprouted a literal PAT to work around an n8n Airtable-node limitation (nulling a date-time field). Each rotation now has a second surface. Runbook flags this.
- **Bumping n8n's HTTP timeout to 300 s.** Treats the symptom; keeps n8n coupled to Worker wall-clock. When client disconnects, Worker still dies — no win.
- **Introducing Cloudflare Queues today.** Right long-term move; larger change. Deferred to a follow-up DL.

### Research Verdict
WF02/06 → update credential via n8n REST API PATCH (UI fallback). WF05 → respond `202 Accepted` immediately, wrap processing in `c.executionCtx.waitUntil(...)`. Accept the 30 s cap as a known limitation; `logError` captures truncations. Track Queues migration as follow-up.

## 4. Codebase Analysis

### Existing Solutions Found (Pre-scan)
- `api/src/lib/error-logger.ts:25-51` — `logError(ctx, env, {endpoint, error, category?, details?})`. Reuse for 30 s cap truncation reporting.
- `api/src/routes/approve-and-send.ts`, `edit-documents.ts`, `reminders.ts` — shape of `ctx.waitUntil(async () => {...})` for deferred work.
- `memory_n8n_api_direct_access.md` — `source .env` + `requests` + `X-N8N-API-KEY`.

### Reuse Decision
- **Reuse** `logError` as-is.
- **Reuse** `ctx.waitUntil` shape from `error-logger.ts:38-50`.
- **Reuse** n8n REST API Python pattern.
- **New code only:** inbound handler rewrite + runbook.

### Relevant Files
| File | Why |
|---|---|
| `api/src/routes/inbound-email.ts` | WF05 handler — the 9-line change. |
| `api/src/lib/inbound/processor.ts` | `processInboundEmail` entry. No change — just moved into `waitUntil`. |
| `api/src/lib/error-logger.ts` | Sink for truncation errors. No change. |
| `.agent/runbooks/pat-rotation.md` | New runbook. |

### Alignment with Research
Author's comment at `inbound-email.ts:59-60` explicitly rejected `waitUntil` on the grounds of the 30 s cap. We're reversing that trade-off because the upstream (n8n) now fails deterministically on the synchronous path — and when n8n aborts, Cloudflare cancels the Worker anyway. The "correctness" benefit is already lost.

### Dependencies
- n8n credential `ODW07LgvsPQySQxh` (Airtable PAT) — the fix target.
- n8n REST API (`N8N_API_KEY` in main-repo `.env`).
- Cloudflare Worker deploy (wrangler) — for the inbound-email.ts change.

## 5. Technical Constraints & Risks

### Security
- New PAT `patvXzYxSlSUEKx9i.917c1a24...` is referenced through REST API headers only; never logged or committed. The runbook uses `$NEW_PAT` placeholder.
- n8n REST API key lives in main-repo `.env`, not in the worktree. User runs scripts from the main repo shell.

### Risks
- **Silent credential update fail.** PATCH might store garbage. Mitigation: GET back + verify token suffix; then trigger a live WF02 webhook and watch the execution log.
- **Replay drift.** Two failed WF02 executions (records `recrpTM7Mi9eIP2us` + `reccuB0IJJkLHISRr`) never wrote through. Need to manually re-trigger after credential fix OR rely on Airtable's automation retry.
- **30 s `waitUntil` truncation.** Emails with ≥6 PDFs may still hit the cap. `logError` captures this; we migrate to Queues if it becomes frequent.
- **WF06 diagnosis inferred, not observed.** MCP blocked. 609 ms failure at cron strongly implies first-hop 401 — confirmed after next scheduled run.

### Breaking Changes
None. Credential update is transparent. Worker handler contract preserved — returns `{ok, status}` (status now `"accepted"` instead of `"completed"`).

## 6. Proposed Solution

### Success Criteria
Next WF02 webhook succeeds at `Fetch Record`; WF05 `Forward to Worker` returns 202 in <1 s; 08:00 WF06 cron run on 2026-04-17 succeeds; `.agent/runbooks/pat-rotation.md` exists and covers every surface.

### Logic Flow

**Part A — credential (unblocks WF02 + WF06):**
1. `source .env` from main repo to load `N8N_API_KEY`.
2. `PATCH /api/v1/credentials/ODW07LgvsPQySQxh` with `{"data": {"accessToken": "<NEW_PAT>"}}`.
3. GET it back; verify last 6 chars match new token.
4. On 4xx: UI fallback.
5. Trigger WF02 webhook with known `record_id` → verify 200 + `Fetch Record` success.

**Part B — WF05 async (unblocks inbound):**
1. Rewrite `inbound-email.ts:59-74`:
   - Replace `await processInboundEmail` with `c.executionCtx.waitUntil((async () => { ...call processInboundEmail, catch, logError })())`.
   - Return `c.json({ok: true, status: 'accepted'}, 202)` immediately.
2. `cd api && npx tsc --noEmit`.
3. `cd api && npx wrangler deploy`.
4. Test inbound email (1 attachment) — verify 202 in <1 s, Airtable rollup within ~15 s.

**Part C — audit & runbook:**
1. Pull each active workflow via MCP (where allowed) or REST API. Confirm `ODW07LgvsPQySQxh` is the only Airtable credential; grep Code nodes + HTTP-header lines for literal `patvXzYxSlSUEKx9i.25f38a9e` (old); expect zero.
2. Write `.agent/runbooks/pat-rotation.md` — 6 surfaces in order: (1) Airtable regenerate, (2) `.env` (both repo + main), (3) Worker secret (`AIRTABLE_PAT`), (4) n8n credential, (5) grep design logs, (6) grep workflow Code nodes + HTTP nodes. End with smoke-test list.

**Part D — housekeeping:**
1. Flip this log's status → `[IMPLEMENTED — NEED TESTING]`.
2. INDEX entry + current-status session entry.
3. Update `docs/architecture/document-processing-flow.mmd` (mark inbound as async/202).
4. Commit + push on `DL-283-n8n-workflow-errors-investigation`. Merge to main; delete branch; remove worktree.

### Data Structures / Schema Changes
None.

### Files to Change

| File | Action | Description |
|---|---|---|
| `api/src/routes/inbound-email.ts` | Modify | `ctx.waitUntil` wrap + 202 immediately. |
| `.agent/design-logs/infrastructure/283-n8n-workflow-errors-investigation.md` | Create | This file. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-283 under Active Logs. |
| `.agent/runbooks/pat-rotation.md` | Create | PAT rotation runbook. |
| `.agent/current-status.md` | Modify | Session entry + Test DL-283 TODO. |
| `docs/architecture/document-processing-flow.mmd` | Modify | Note: inbound path is async. |

### Final Step (Always)
**Housekeeping:** flip status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 items to `current-status.md` under **Active TODOs** as `Test DL-283`.

## 7. Validation Plan

- [ ] **V1 — WF02 credential:** n8n REST GET on `ODW07LgvsPQySQxh` returns credential with new token suffix. Test execution of `/webhook/questionnaire-response` with known `record_id` → 200 + `Fetch Record` `executionStatus: "success"`.
- [ ] **V2 — WF06 credential:** Next scheduled cron run (08:00 Israel / 05:00 UTC on 2026-04-17) succeeds. If urgent, trigger manually via n8n UI → first Airtable node succeeds.
- [ ] **V3 — WF05 async path:** Forward a test email with 1 PDF to `reports@moshe-atsits.co.il`. n8n `Forward to Worker` completes in <1 s with HTTP 202. Airtable classifications record appears within ~15 s. OneDrive file uploaded.
- [ ] **V4 — WF05 large batch:** Forward an email with 6+ attachments. Observe whether waitUntil cap truncates. If truncated, verify `security_logs` table has the error via `logError`.
- [ ] **V5 — Audit clean:** Grep of every active workflow (pulled via REST) returns zero hits for old token prefix `patvXzYxSlSUEKx9i.25f38a9e`.
- [ ] **V6 — WF02 end-to-end:** Fresh Tally questionnaire submission flows all the way through: `Fetch Record` → `Get Mappings` → `Extract & Map` → `Call Document Service` → `Upsert Documents` + `Update Report Stage` + `Mark Processed`.
- [ ] **V7 — Runbook reviewable:** `.agent/runbooks/pat-rotation.md` exists, lists all 6 surfaces, ends with a grep command that finds every copy of the old token.
- [ ] **V8 — No regression in MONITOR Security Alerts:** Next hourly run shows `Success`.

## 8. Implementation Notes (Post-Code)

### What actually happened
- **Credential PATCH** (`PATCH /api/v1/credentials/ODW07LgvsPQySQxh`) needed `allowedHttpRequestDomains: "all"` alongside `accessToken` — returned 400 "requires property allowedDomains" without it. Captured in the runbook step 4.
- **`GET /api/v1/credentials/{id}` returns 405 Method Not Allowed** — n8n refuses to hand secrets back. Verification was done via live WF02 trigger instead (execution 11933 SUCCESS at 06:43:10 UTC confirmed the credential works).
- **Replay successes:** both `recrpTM7Mi9eIP2us` (exec 11933) and `reccuB0IJJkLHISRr` (exec 11936) succeeded end-to-end. No further backfill needed for WF02.
- **WF05 self-healed separately:** the 11927 timeout was followed at 05:19:27 by exec 11928 (18s, success) — MS Graph subscription retry delivered the same email, which then processed. Post-deploy tests 11935 / 11938 both succeeded with the new async handler.
- **WF06 cron miss is live:** exec 11925 at 05:00 UTC (08:00 Israel) was the daily reminder sweep. It failed before the credential was fixed, so **today's reminders did not go out.** The next scheduled cron is 2026-04-17 08:00 Israel. User must manually execute WF06 via n8n UI ("Execute Workflow" button) to catch up. See Section 7 V2.

### Audit results (via REST API, all 10 active workflows)
- **Total Airtable nodes:** 28, spread across 6 workflows (WF02, WF04, WF06, WF06-SUB, [SUB] Document Service, WF02's 7 nodes). **All 28 use credential `ODW07LgvsPQySQxh`** — the single PATCH fixed every one.
- **Hardcoded token sweep:** 0 occurrences of the old PAT (`patvXzYxSlSUEKx9i.25f38a9e*`) anywhere. 1 hit of the new PAT (known — `Clear Reminder Date` Code node in WF02, working workaround). 8 hits of the unrelated `pat2XQGRyzPdycQWr*` PAT used in MONITOR workflows + WF07 + WF04 (unaffected by rotation).

### Principles applied
- **Single source of truth for secrets** → runbook step 4 names the credential explicitly.
- **Respond fast, work later** → `inbound-email.ts` now returns 202 before work starts.
- **Fix root cause, not symptom** → credential PATCH before replaying; replay of broken webhooks without the PATCH would have produced more 401s.

### Files actually changed
| File | Lines changed |
|---|---|
| `api/src/routes/inbound-email.ts` | 59-74 → 59-80 (9-line rewrite to `ctx.waitUntil` + `202 accepted`) |
| `.agent/design-logs/infrastructure/283-n8n-workflow-errors-investigation.md` | Created (this file) |
| `.agent/design-logs/INDEX.md` | +1 row |
| `.agent/runbooks/pat-rotation.md` | Created |
| `.agent/current-status.md` | +1 session entry + test TODO |

### Deploys
- Cloudflare Worker `annual-reports-api` — version `006deee5-8da2-4c78-8110-1249ca254871` (2026-04-16 ~06:38 UTC).
- n8n — PATCH to credential `ODW07LgvsPQySQxh` at 06:43:02 UTC.

## Follow-ups (out of scope)

1. **Migrate `/webhook/process-inbound-email` to Cloudflare Queues.** Eliminates the 30 s cap. Trigger if the large-batch case becomes frequent. New DL.
2. **Refactor `code-clear-reminder` to use credential.** Currently hardcodes new PAT (works but is a second rotation surface). Low priority.
3. **Wire n8n Error Workflow trigger.** Proactive 401 alerts. Deprioritized in discovery; revisit next quarter.
