# Annual Reports CRM - Current Status

**Last Updated:** 2026-05-01 (DL-391 — IMPLEMENTED, NEED TESTING; DL-386 follow-up. Chip menu in AI review [required-docs] now offers "📎 שייך את התצוגה הפעילה למסמך זה" as the first option when (a) `aiActionsPanel.dataset.itemId` is set, (b) chip status is `Required_Missing`, (c) chip's `doc_record_id` differs from the active item's `matched_doc_record_id`. One-click — calls existing `submitAIReassign(activeItemId, templateId, docRecordId)` (script.js:7773); same path DL-386's inline prompt uses (line 11523). `renderDocTag` adds `data-template-id` to chip span. New `selectDocTagAssignToCard` handler next to `selectDocTagStatus`. No CSS / Worker / schema changes. Cache-bust `script.js?v=394→395`. **Verify:** (a) chip menu without active card → option NOT visible; (b) open a pending card preview, then click an unrelated `Required_Missing` chip → option appears as **first** item with paperclip icon, divider below it, status options + Edit name follow; (c) click → toast → success → card auto-advances; (d) `Received` / `Waived` / `Requires_Fix` chips → option NOT visible; (e) general_doc + spouse-doc chips both work; (f) PA tab unaffected (separate `openPaDocTagMenu`); (g) DevTools shows `script.js?v=395`. DL-391 at `.agent/design-logs/ai-review/390-chip-menu-assign-to-this-doc.md`. Pages deploy needed before testing.)

**Last Updated:** 2026-05-01 (DL-386 — COMPLETED; "+ [H:add-doc]" chip in AI review [H:required-docs] section, AI-aware PA add-doc popover, silent refresh, spouse selector, and inline assign prompt anchored to the freshly-added chip. Worker exposes `spouse_name` per classification. Verified live on CPA-XXX test client (with dummy spouse). DL-386 at `.agent/design-logs/ai-review/386-add-required-doc-from-ai-review.md`. **TODO (deferred follow-up):** when admin is on a pending card and clicks an existing chip in [H:required-docs], the chip's `openDocTagMenu` should also offer "[H:assign-to-this-doc]" as the first menu item (current options: "[H:hebrew]"=Received, "[H:hebrew]"=Waived, "[H:hebrew]"=edit name) — invokes `submitAIReassign(activeCardId, chip.template_id, chip.doc_record_id)`. Same affordance as the inline prompt after add, but reachable from any existing chip while a card is open in the cockpit. Touch points: `openDocTagMenu` (script.js ~line 9120), `selectDocTagStatus` handler. Gate the new option on `aiActionsPanel[data-item-id]` being set.)
**Last Updated:** 2026-05-01 — DL-368, DL-376, DL-384, DL-387, DL-388 marked done.

## Recent (last 7 days)

- **2026-05-01 · DL-388 — COMPLETED.** AI Review action-flow fixes: match-to-existing precondition guard (`onedrive_item_id`+`file_url`) with structured `no_file_to_share` error; `transitionCardToReviewed` schedules silent `loadAIClassifications` + cross-client auto-advance; mobile uses `scrollIntoView`. Cache-bust v=391→392. Follow-up: audit `classifications` rows missing `file_url`+`onedrive_item_id`.
- **2026-05-01 · DL-386 — COMPLETED.** "+ add-doc" chip in AI review; AI-aware PA popover; spouse selector; inline assign prompt. Worker exposes `spouse_name`. Deferred follow-up: `openDocTagMenu` (script.js ~9120) should offer "assign to this doc" when `aiActionsPanel[data-item-id]` is set.
- **2026-05-01 · DL-380 follow-up — LIVE.** Password-request email Hebrew copy made gender-neutral (passive voice). Worker `450e1f55`.
- **2026-04-30 · DL-385 — COMPLETED.** Partial-contract T901↔T902 swap + lenient MM.YYYY date input. New action `swap-classification`; seeder `scripts/seed-cpa210-qa.mjs`. Worker `04639687`, Pages v=388.
- **2026-04-30 · DL-387 — COMPLETED.** Reassign modal single-click custom doc submit (live `input` listener on `.ai-tpl-custom-input` enables button immediately). Cache-bust v=388→389.
- **2026-04-30 · DL-384 — COMPLETED.** Password-reply `client_note` stores stripped reply only; same flows to `pending_classifications.password_reply_raw`. Cache-bust v=382→384.
- **2026-04-30 · DL-383 — COMPLETED.** Doc-manager Waived↔Required restore: 500 fix (document_uid preserved, DL-205 invariant scoped non-Waived); waive-wins guard; real error body in toast; immediate row refresh.
- **2026-04-29 · DL-368 — COMPLETED.** CF Pages git auto-deploy restored.
- **2026-04-29 · DL-376 — COMPLETED.** OneDrive orphan backfill rename pass done.
- **2026-04-29 · DL-365 Phase 2 — SHIPPED + verified.** Server-side activity-logger instrumentation: dual-write logSecurity, logError → worker_error, new business events, request_id middleware. Queue-consumer log surface gap remains.

---

## OPEN: DL-365 — Activity Logger Phases 3-5

DL: `.agent/design-logs/infrastructure/365-activity-logger.md`

- **Phase 3** — admin viewer (`/admin/dev/activity` React island) + `frontend/shared/telemetry.js` + `DEV_PASSWORD`-gated lookup endpoints.
- **Phase 4** — client portal page hooks + n8n workflow updates (replace 7 Airtable POSTs with `/webhook/events`).
- **Phase 5** (2 weeks after Phase 4) — flip `LEGACY_LOG_TO_AIRTABLE=false`, deactivate `[MONITOR] Security Alerts` + `[MONITOR] Log Cleanup`; mark `security_logs` deprecated.

Still need Worker secrets: `DEV_PASSWORD`, `PII_HASH_KEY` (`wrangler secret put` from `api/`).

---

## OPEN: W02 regression — wrangler deploy script missing `-c wrangler.toml`

`api/package.json` deploy script needs `-c wrangler.toml` flag so `check-regressions.sh` W02 case passes honestly.
