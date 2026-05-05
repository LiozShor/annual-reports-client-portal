# Design Log 404: Merge Two Clients Into One
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-05
**Related Logs:** DL-183 (CC on questionnaire), DL-184 (CC admin UI), DL-352 (doc-owner tabs), DL-366 (kebab add CC + resend), DL-208 (client switcher), DL-162 (spouse checkbox), DL-080 (doc-manager spouse fix), DL-110 (client_questions JSON), DL-330 (AI Review group-by-client), DL-355 (OneDrive filename SSOT), DL-356 (preview self-heal), DL-365 (activity logger), DL-369 (move-classification-client picker), DL-374 (webUrl plumbing), DL-390 (weekend skip)

## 1. Context & Problem

The office sometimes discovers — only after both questionnaires are filled — that two separately-onboarded clients are actually a married couple and should be a single household for the rest of the pipeline. Today there is no merge primitive: the office must manually copy data, hide one record, and remember to keep BCC'ing the spouse on every future email. This is error-prone (forgotten reminders, lost documents, missed answers) and it leaks duplicate records into queue counters and stat cards.

**Outcome:** one-click merge from the dashboard kebab menu that consolidates two clients into a single ongoing pipeline with bilateral email delivery (To + CC), a unioned document set physically moved to one OneDrive folder, and a merged display name — while preserving both original questionnaires verbatim for audit/print.

## 2. User Requirements

1. **Q:** Which record survives the merge?
   **A:** Always the older record (lowest `clients.createdTime`). Deterministic, no admin choice.
2. **Q:** How are questionnaire answers + documents combined?
   **A:** Save both questionnaires verbatim; print path renders both sequentially. Documents (received): union onto winner, retain `person` flag (DL-352 doc-owner tabs cover render).
3. **Q:** Email/CC contract?
   **A:** Main = To, other = CC, on every email type (questionnaire, reminders, batch status, comments). Extends DL-183 to all outbound. `replyToMessage` deferred.
4. **Q:** What happens to the loser record?
   **A:** Soft-archive: `is_active=false` + `merged_into=<winner_client_id>`; hidden from queues, restorable via direct Airtable edit.
5. **Q:** Where is merge triggered?
   **A:** Kebab menu on dashboard client row (alongside DL-366 actions).
6. **Q:** Stage rule when records differ?
   **A:** Lower (earlier) stage wins — never skip office gates.
7. **Q:** Reminder schedule?
   **A:** Cancel both pending reminders, recompute fresh from winner's stage-entry timestamp via existing helper + DL-390 weekend skip.
8. **Q:** OneDrive files?
   **A:** Physical move into winner's folder; on filename collision, append ` (2)` before the extension. Empty loser folder kept for audit (not deleted).
9. **Q:** Merged display name?
   **A:** Pre-fill `<winner.name> & <loser.name>`; admin can edit in confirm dialog.
10. **Q:** Spouse name on winner's report?
    **A:** Auto-set `winner.report.spouse_name = loser.name` if previously blank; if already set to a different value, log warning and keep existing.

## 3. Research

### Domain
CRM duplicate-record consolidation / contact merge. Sources gathered via Tavily on 2026-05-05.

### Sources Consulted
1. **Stacksync — *Eliminating Duplicate Records When You Sync CRM Systems*** — Field-level survivorship rules; `created_date: earliest` is the de-facto winner-pick heuristic. Drives our oldest-wins rule.
2. **Salesforce AppExchange — *Best Practices Guide to Deduplication and Merging*** — "Keep the oldest duplicate as the base record" + Golden ID pattern for unmergeable cases. Validates our soft-archive + `merged_into` pointer.
3. **HubSpot Knowledge Base — *Merge records*** — Workflow unenrollment on merge; secondary email permanently associated; primary record_id preserved. Justifies cancel-and-recompute on reminders + keeping winner's Airtable record_id intact.
4. **Insycle — *HubSpot Merge Duplicates Module Overview*** — Synthetic merge keeps master Record ID; Run ID for audit cross-reference. Mirrored as `idempotency_key` in our activity log payload.
5. **Alok Necessary — *Idempotency in Distributed Systems*** — Idempotency-key + completed-state check; two-phase reservation pattern. Drives our KV lock + early-return when `loser.merged_into` already set.

### Key Principles Extracted
- **Field-level survivorship + oldest wins** — deterministic, reversible via `merged_into` pointer.
- **Synthetic merge preserves Record ID** — winner's `clients` and `reports` rows keep their IDs; URLs survive.
- **Re-point all related child records** — HubSpot lesson: missed associations = data loss. Re-point loser's `documents`, `pending_classifications`, `email_events`, `client_notes` text + per-doc notes.
- **Idempotency key + commit point** — single explicit commit step (`merged_into` PATCH on loser) so partial failures upstream are retry-safe.
- **Workflow unenrollment** — cancel and recompute reminders rather than "merge schedules".
- **Audit trail with no PII** — `client_id` only in activity-logger payload (DL-365 sanitization rule).

### Patterns to Use
- **KV lock + idempotency-key:** `lock:merge:<winner>:<loser>` (10s TTL) + idempotent no-op when `loser.merged_into` matches.
- **Re-point before commit:** OneDrive move → Airtable child re-point → set `merged_into` last.
- **Searchable client picker (DL-369):** reuse the `move-classification-client` modal pattern for the merge dialog's "pick the other client".
- **OneDrive filename collision suffix:** ` (N)` before extension, single-PATCH rename + move (`name` + `parentReference.id` together).

### Anti-Patterns to Avoid
- **Hard delete of loser** — destroys attribution and breaks downstream sync (HubSpot/Salesforce both warn).
- **Email-only auto-detect of duplicates** — collision risk on shared family/domain addresses (Stacksync). Merge stays explicit, admin-initiated.
- **Field-by-field auto-merge with conflict toast** — user explicitly rejected this in Phase A; both questionnaires must survive verbatim.

### Research Verdict
The user's Phase A choices align with industry-standard CRM merge playbooks. Implementation risk is mechanical (correct child re-pointing, OneDrive collision handling, idempotency on retry) — not architectural.

## 4. Codebase Analysis

- **Existing Solutions Found:**
  - `clients.cc_email` (Airtable) — DL-183 wired into questionnaire send only.
  - `clients.is_active` (checkbox) — already filtered in `api/src/routes/reminders.ts:24-30`.
  - `documents.person` (singleSelect: client/spouse) — DL-352 tabs already render per-owner.
  - `reports.client_questions` (JSON, DL-110) — array of `{id, text, answer}`.
  - `MSGraphClient` already supports `sendMail`/`sendMailDeferred` with optional `ccAddress` (`api/src/lib/ms-graph.ts:195-275`).
  - `api/src/routes/admin-assisted-link.ts:22-97` — auth-pattern template for new admin POST routes.
  - DL-369 client-picker modal pattern (`move-classification-client`) — reuse for the merge picker.
  - `buildPaPreviewBody` (`frontend/admin/js/script.js:10416`) — questionnaire body render. Print path also reads `client_questions` at `script.js:15113` and `15360-15366`.
  - `api/src/lib/reminders.ts` — existing helper for `reminder_next_date` recompute (DL-390 weekend skip).
  - DL-374 `webUrl` plumbing — re-fetch + persist after OneDrive move.
- **Reuse Decision:** all of the above are reused. New code is limited to (1) the orchestrator helper `merge-clients.ts`, (2) the route file, (3) the frontend dialog (kebab item + modal + endpoint call). Schema additions are 3 fields written via Airtable typecast — no manual schema work.
- **Relevant Files:** see §6 "Files to Change".
- **Existing Patterns:** Worker route → lib helper → MSGraphClient/Airtable. Frontend `.ai-modal-overlay` custom modals (NEVER native `confirm`). Cache-bust via `script.js?v=`. Module split if monolith ratchet blocks.
- **Alignment with Research:** strong — every researched principle has a corresponding implementation hook.
- **Dependencies:** Airtable v2 (existing PAT), MS Graph (existing OneDrive scope), Cloudflare KV (existing namespace), Workers Logs + R2 (DL-365 activity-logger).

## 5. Technical Constraints & Risks

- **Security:** auth on the new route mirrors `admin-assisted-link.ts` (admin token / `X-N8N-Key` constant-time compare). Activity-log payload contains `client_id` only — no names, no emails (DL-365 PII rule).
- **Operational Risks:**
  - Race on double-click → KV lock `lock:merge:<winner>:<loser>` (10s TTL) + early-return if `loser.merged_into` already set.
  - Partial OneDrive move failure → idempotent retry: pre-fetch `parentReference.id` per item; structured error `{ ok:false, code:'partial_onedrive_move', moved, total, failed_item_ids }`; commit point (`merged_into` PATCH) is last so retry is safe.
  - Filename collision on move → loser's colliding file renamed to `<basename> (2).<ext>` in the same MS Graph PATCH (single round-trip).
  - Empty loser OneDrive folder kept (audit-preserve, not deleted).
  - Cross-filing-type merge → endpoint rejects with `cross_filing_type` (annual ↔ capital_statements is out of scope for v1).
  - Reminder timing skew → cancel both, recompute on winner via existing helper.
  - Email duplication during merge window → KV lock also gates outbound mail handlers if `report_id` matches an active merge lock.
  - Spouse_name conflict → don't overwrite an existing non-blank value; surface `spouse_name_conflict` warning in result.
- **Breaking Changes:** none — extending email CC to non-questionnaire types only adds CC headers when `cc_email` is non-empty (no new sends). Inbound identifier extensions are additive (extra match tier).
- **Mitigations:** see Operational Risks above. Monolith size ratchet enforced via existing pre-commit hook; if blocked, extract dialog to `frontend/admin/js/modules/merge-clients.js` per DL-399 precedent. PII guard runs on `.agent/` commit.

## 6. Proposed Solution

### Success Criteria
Admin clicks the "merge" kebab item, picks the other client in the modal, optionally edits the pre-filled merged name, confirms — and within ~5–10 seconds the dashboard shows a single merged client with both source questionnaires preserved, all received documents physically in winner's OneDrive folder, `cc_email` populated, reminders recomputed, and the loser hidden from all queues. Inbound emails from either address resolve to the merged household.

### Logic Flow (orchestrator `mergeClients()`)
1. Load both `clients` rows + their active `reports` rows for the current `year`.
2. Reject if `filing_type` differs → `{ ok:false, code:'cross_filing_type' }`.
3. Pick winner = the one with the older `createdTime`.
4. Acquire KV lock `lock:merge:<winner>:<loser>` (10s TTL); abort on contention.
5. Idempotent no-op if `loser.merged_into === winner.client_id` already.
6. Compute merged stage = lower of the two; if winner is later, downgrade winner's report to that earlier stage and clear `docs_completed_at` per DL-364 invariant when applicable.
7. **Physical OneDrive move** of every loser-owned `documents` row's file into winner's report folder via `MSGraphClient.PATCH /me/drive/items/{id}` with `parentReference.id`. On collision, include `name: "<basename> (2).<ext>"` in the same PATCH. Pre-fetch current `parentReference.id` and skip already-moved items (idempotent retry). Persist any returned `webUrl` change to `documents.file_url` (DL-374 pattern). Track counters `{moved, renamed, skipped, failed}`.
8. Re-point children in Airtable, each PATCH guarded by current link still pointing at the loser:
   - `documents.report` → winner_report_id
   - `pending_classifications.report` → winner_report_id
   - `email_events.report` → winner_report_id
   - `clients.client_notes` (multilineText) — append loser's text to winner's with separator `\n\n— [merged from <loser_client_id> on <date>] —\n\n` (no PII fields appended; just the existing free-form text).
9. Append loser's report_id to `winner.report.merged_from_report_ids` (CSV).
10. Set `winner.name = <merged_name>` (from request body; falls back to `<winner.name> & <loser.name>` if omitted; reject empty-after-trim).
11. Set `winner.report.spouse_name = loser.name` only if currently blank; otherwise emit `spouse_name_conflict` warning and keep existing.
12. Set `winner.cc_email = loser.email` only if winner has no existing `cc_email`; otherwise emit warning and skip.
13. Set `loser.merged_into = winner.client_id`, `loser.is_active = false`, `loser.merged_at = now()`. **This is the commit point.**
14. Cancel pending reminders on both reports; recompute fresh on winner via `reminders.ts` helper (DL-390 weekend skip applies).
15. `logEvent({ event_type:'client_merged', category:'admin_action', winner_client_id, loser_client_id, winner_report_id, loser_report_id, actor, docs_moved, onedrive_moved, onedrive_renamed, idempotency_key })`.
16. Release KV lock; return structured result with counters + any warnings.

### Data Structures / Schema Changes
Three new Airtable fields, written via typecast on first PATCH (no manual schema work):
- `clients.merged_into` (singleLineText) — winner client_id of merge target, or empty.
- `clients.merged_at` (singleLineText ISO timestamp).
- `reports.merged_from_report_ids` (singleLineText, comma-separated source report IDs for the questionnaire-print fan-out).

Activity-logger event_type added: `client_merged` (category `admin_action`).

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/merge-clients.ts` | Create | Pure `mergeClients()` orchestrator (steps 1–16 above). Unit-testable — pulls dependencies through env. |
| `api/src/routes/admin-merge-clients.ts` | Create | `POST /webhook/admin-merge-clients` — auth, body parse, delegate, return result. |
| `api/src/index.ts` | Modify | Register new route. |
| `api/src/routes/dashboard.ts` | Modify | Filter line 43-45: add `{merged_into}=BLANK()` to `filterByFormula`. |
| `api/src/routes/send-batch-questions.ts` | Modify | Lines ~81-84: fetch `client.cc_email`, pass to `graph.sendMailDeferred`. |
| `api/src/routes/reminders.ts` | Modify | Send handler: same cc_email pattern. |
| `api/src/routes/approve-and-send.ts` | Modify | Doc-list email send: same cc_email pattern. |
| `api/src/inbound/client-identifier.ts` | Modify | Add Tier 1.5 cc_email match (skip if `is_active=false`). Add `merged_into` follow-through when matched row is inactive. New `match_method='merged_redirect'` enum value. |
| `frontend/admin/js/script.js` (or `frontend/admin/js/modules/merge-clients.js` if ratchet blocks) | Modify / Create | Kebab item in `openClientContextMenu` (lines 14063-14099); new `openMergeClientsDialog(reportId, clientName)`; searchable picker; side-by-side preview auto-resolved by `createdTime`; editable merged-name input pre-filled `<A> & <B>`; POST endpoint; silent refresh; toast. |
| Print path in `frontend/admin/js/script.js` (around line 15113 / 15360-15366 + `buildPaPreviewBody:10416`) | Modify | When `report.merged_from_report_ids` non-empty, fetch each source report's `client_questions` and render sequentially with section headers `[H:source]: <name>`. |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=` (and `style.css?v=` if CSS rules added). |
| `frontend/admin/css/style.css` | Modify | (only if new modal-specific rules needed beyond `.ai-modal-*`). |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-404 row. |
| `.agent/current-status.md` | Modify | (Phase E) Active TODOs from unchecked Section 7 items. |

**Out of scope (deferred):**
- Cross-filing-type merge (annual ↔ capital_statements) — endpoint rejects with `cross_filing_type`.
- Un-merge / restore — soft-archive preserves enough state for manual Airtable edit.
- `replyToMessage` CC support — office-typed replies remain single-recipient until a follow-up DL.
- Deletion of the empty loser OneDrive folder (audit-preserve).

### Final Step
- Update design log status to `[IMPLEMENTED — NEED TESTING]`.
- Update INDEX.md row status.
- Copy unchecked Section 7 items to `.agent/current-status.md` Active TODOs.
- Invoke `git-ship` for commit/push/merge.
- Run `bash .claude/workflows/deploy-worker.sh` from canonical clone.

## 7. Validation Plan

- [ ] **Smoke (happy path):** create two QA test clients in Airtable, fill both questionnaires, run merge from kebab. Verify: winner = older `createdTime`, loser is `is_active=false` + `merged_into=<winner>`, winner `name` is the ampersand-merged form (or whatever admin typed), winner.report `spouse_name` populated when previously blank, `cc_email` populated on winner, all docs visible in winner's doc-manager (split across `person` tabs).
- [ ] **Custom merged name:** in the dialog, override the pre-filled `"A & B"` with a free-form name; verify it lands on `clients.name` exactly as typed and propagates to dashboard list, doc-manager header, AI Review accordion, and outgoing email greetings.
- [ ] **Spouse name conflict warning:** pre-set winner.report.spouse_name to a different non-empty value before merge; merge completes but result includes `spouse_name_conflict`; existing value preserved; toast surfaces it.
- [ ] **OneDrive physical move:** before merge, note loser's folder contents. After merge, winner's folder contains all loser's files; loser's folder is empty. Doc preview links still work (DL-356 self-heal does not trigger).
- [ ] **OneDrive collision:** seed both clients with identically-named files. After merge, winner's folder contains both — original + ` (2).pdf` variant. Both preview-able from doc-manager.
- [ ] **OneDrive partial-failure retry:** simulate by killing the request mid-move (or temporarily revoking permission to one item). Endpoint returns `partial_onedrive_move` with counts. Re-running the same merge call (same idempotency key) only retries un-moved items and completes the rest cleanly.
- [ ] **Email contract:** send a test reminder + batch-status + approve-and-send to the merged client; inspect SENT mail in Outlook (gws CLI per `docs/gws-cli.md`). Confirm To + CC headers on each. Reply (`replyToMessage`) verified deferred.
- [ ] **Stage rule:** merge a Stage-4 with a Stage-2 → merged stage is Stage-2 (lower wins). Verify reminder recompute fired (`reminder_next_date` updated, weekend-skip per DL-390).
- [ ] **Questionnaire print:** open merged winner's PA tab — both source questionnaires render sequentially with section headers.
- [ ] **Idempotency:** click merge button twice rapidly — second call returns prior result, no duplicate side effects.
- [ ] **Cross-filing-type rejection:** attempt merge across annual + capital_statements → endpoint returns `cross_filing_type`, frontend toasts the structured message.
- [ ] **Queue counters:** dashboard stat cards + queue tabs do NOT count the loser. `recalculateStats()` matches tab badges (DL-364 invariant).
- [ ] **Inbound from cc_email:** send a test email from the loser's old address to the office inbox. Verify processor identifies it as the WINNER (check `email_events.client` link + `match_method`); resulting `pending_classification` lands under the winner in AI Review.
- [ ] **Inbound merged-redirect path:** temporarily blank `clients.cc_email` on the merged row, send another test from the loser's old address. Verify identifier falls through to `merged_into` pointer and still resolves to the winner; `match_method='merged_redirect'` logged.
- [ ] **Pending classifications carry over:** before merge, ensure both records have at least one `pending_classifications` row. After merge, both appear under the winner's AI Review accordion; previously-attached OneDrive files preview correctly.
- [ ] **Activity log:** `client_merged` event in Workers Logs (verify via `node scripts/query-worker-logs.mjs --since=15m --search=client_merged`). No PII in payload (only client_ids).
- [ ] **Silent refresh:** after merge, both clients' rows update in-place (winner shows merged data, loser disappears) without page reload (P6 rule).
- [ ] **Monolith ratchet:** `python3 .claude/hooks/script-size-ratchet.py` passes (extract to module if needed).
- [ ] **PII guard on .agent files:** `python3 .claude/hooks/agent-pii-guard.py .agent/design-logs/admin-ui/404-merge-clients.md` passes.

## 8. Implementation Notes

**Phase D Step 0 findings (2026-05-05):**
- Questionnaire body render: `buildPaPreviewBody` at `frontend/admin/js/script.js:10416`; header at 10387. Print path also reads `client_questions` at `script.js:15113` and `15360-15366`. The merge-aware extension splices in at the body render — when `report.merged_from_report_ids` is non-empty, fetch each source report's `client_questions` from a new (or existing) read endpoint and render under section headers in chronological order.
- `client_notes` storage: `clients.client_notes` is a `multilineText` field on the clients table (`docs/airtable-schema.md:96`) — free-form admin notes. NOT a JSON array, NOT a separate table. Merge appends loser's text to winner's with a separator marker (no PII added). The per-classification chat-bubble notes (DL-360, DL-362) live on `pending_classifications.client_notes` as a JSON array and are carried over for free when `pending_classifications.report` is re-pointed in Logic-Flow step 8.

**Phase D dispatch results (2026-05-05, subagent-driven-development):**

Wave 1 (parallel): T2 lib, T4 cc_email, T5 inbound, T6 dashboard filter, T7 print path. All DONE.
Wave 2 (parallel): T3 route, T8 frontend dialog. All DONE.
Type-check after both waves: 0 new errors (2 pre-existing errors in `index.ts:132` and `lib/activity-logger.ts:16` unchanged). Ratchet: PASS (script.js 16217 lines, no baseline change).

**Deviations from spec, recorded:**

1. **`reminders.ts` is n8n-delegated, not a direct Worker mail sender.** Spec §6 Email gating extensions listed `reminders.ts` as needing the cc_email plumbing. The T4 implementer found that the Worker `reminders.ts` route's `send_now` action calls an n8n webhook (`/send-reminder-manual`) — actual reminder mail is sent inside an n8n workflow, not from the Worker. Worker-side cc_email plumbing was therefore applied only to `send-batch-questions.ts` and `approve-and-send.ts` (the two files that DO call `graph.sendMail`/`sendMailDeferred` directly). **Follow-up DL needed:** the n8n workflow that handles `/send-reminder-manual` must be updated to read `cc_email` from the report and add a `cc` recipient on its mail node — out of scope for DL-404 (Worker-only). Tracking as DL-405 candidate.

2. **`replyToMessage` CC support deferred** as planned (spec out-of-scope §6). No change.

3. **Auth env var names corrected by T3.** Spec referenced `ADMIN_TOKEN` and `N8N_KEY`; the actual codebase uses `SECRET_KEY` (JWT, verified via `verifyToken`) and `N8N_INTERNAL_KEY` (timing-safe compared). Route mirrors `admin-assisted-link.ts`.

4. **`ExecutionContext` threading.** T2 initially synthesized a stub `ctx` for `MSGraphClient` token caching. T3 corrected this by adding `ctx: ExecutionContext` to `mergeClients()` signature and threading the real `c.executionCtx` from Hono. Token caching now defers properly via `waitUntil`.

5. **Frontend module split (T8) instead of inline addition.** Per the monolith size ratchet, `frontend/admin/js/script.js` is on a one-way size ratchet. T8 chose to extract the dialog into `frontend/admin/js/modules/merge-clients.js` (432 lines new), keeping script.js at net-zero (16217 lines). Mirrors the DL-399 / T7 (`print-merged-questionnaires.js`) precedent.

6. **T7 print path also extracted to a module** (`frontend/admin/js/modules/print-merged-questionnaires.js`, 165 lines new). Same ratchet reasoning. Three surgical edits in script.js (`buildPaPreviewBody`, `printPaQuestionnaire`, `generateQuestionnairePrintHTML`) call into the module via `window.buildMergedQuestionnaireSections` / `window.buildMergedPrintSections`.

7. **T8 committed independently** as `a130c5c5`. The `git-ship` skill was not invoked for that commit. Commit content is clean (frontend-only, scoped to T8 files, conventional message + co-author tag). Remaining 12 files (T2/T3/T4/T5/T6/T7 + DL/INDEX) are still uncommitted in working tree at the time of this note; controller will commit them via `git-ship` in Phase E.

**Files actually changed:**

| File | Owner | Action | Lines |
|------|-------|--------|-------|
| `api/src/lib/merge-clients.ts` | T2 | Create | 622 |
| `api/src/routes/admin-merge-clients.ts` | T3 | Create | 107 |
| `api/src/index.ts` | T3 | Modify | +2 |
| `api/src/routes/send-batch-questions.ts` | T4 | Modify | +2 |
| `api/src/routes/approve-and-send.ts` | T4 | Modify | +2 |
| `api/src/lib/inbound/client-identifier.ts` | T5 | Modify | +75 |
| `api/src/lib/inbound/types.ts` | T5 | Modify | +2 |
| `api/src/routes/dashboard.ts` | T6 | Modify | +6 |
| `frontend/admin/js/modules/print-merged-questionnaires.js` | T7 | Create | 165 |
| `frontend/admin/js/script.js` (print sections) | T7 | Modify | net 0 |
| `frontend/shared/print-questionnaire.js` | T7 | Modify | +9 |
| `frontend/admin/js/modules/merge-clients.js` | T8 | Create | 432 |
| `frontend/admin/js/script.js` (kebab section) | T8 | Modify | +10 |
| `frontend/shared/endpoints.js` | T8 | Modify | +3 |
| `frontend/admin/index.html` | T7+T8 | Modify | cache-bust to v=416, two new module includes |

