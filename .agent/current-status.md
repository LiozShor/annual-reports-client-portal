# Annual Reports CRM - Current Status

**Last Updated:** 2026-05-03 (DL-396 follow-up redesign — IMPLEMENTED, NEED TESTING. Dashboard recent-messages group cards rebuilt around iOS/PatternFly patterns: latest snippet only in header, group-level ✓/💬/📁 actions, dimmer older rows, soft counter pill, stack-peek ghost. Cache v=401→402. DL-395 still open.)

## OPEN: DL-396 follow-up — Group card UX redesign

DL: `.agent/design-logs/admin-ui/396-recent-messages-group-by-client.md` (Section 9)

Open-test items (deploy Pages first, then verify on live admin):

- [ ] Multi-message group: header shows client name + counter pill + relative time + chevron (icon-sm, trailing edge); preview snippet below; 3 action buttons (reply, open doc-manager, ✓ all) at the bottom of header.
- [ ] Click chevron / header / preview → expands; expanded body shows ONLY older messages (latest is NOT duplicated).
- [ ] Older rows have no client name, dimmer text (opacity 0.85), smaller font, tighter padding, dashed separator.
- [ ] Click ✓-all on header → entire group fades out; toast "סומן כטופל (N)"; all N messages hidden server-side; no group-level ✓ regression for already-handled rows.
- [ ] Click 💬 on header → reply input opens against the LATEST message of the group.
- [ ] Click 📁 on header → opens client's doc-manager in new tab.
- [ ] Per-message ✓/💬/📁 inside the older rows still work; click ✓ on an older row → row fades, group stays expanded, counter decrements on re-render.
- [ ] Stack-peek ghost: faint shadow visible behind collapsed multi-message group; disappears on hover and when expanded.
- [ ] Single-message clients: render unchanged (zero visual delta vs first ship).
- [ ] Hard-refresh — `script.js?v=402` served.

## OPEN: DL-396 — Recent messages group-by-client

DL: `.agent/design-logs/admin-ui/396-recent-messages-group-by-client.md`

Open-test items from Section 7 (deploy Pages first, then verify on live admin):

- [ ] Client with 1 message: row renders identically to before (no counter, no toggle).
- [ ] Client with 2+ messages: shows ONE card; header has chevron + client name + "N הודעות" counter + latest relative time + latest snippet preview.
- [ ] Click header → expands; ALL messages appear with full per-message reply/folder/✓ buttons.
- [ ] Office replies (DL-289 `replies[]`) nested under their parent inbound message inside the expanded view.
- [ ] Click ✓ on a message inside an expanded group → row fades; group stays expanded; counter decrements on re-render.
- [ ] Click ✓ on the LAST remaining message in a group → entire group disappears.
- [ ] Click ✓ on a 1-message (non-grouped) row → row disappears (existing behavior preserved).
- [ ] Pagination: "הצג עוד..." reveals 10 *more groups* (not 10 more messages).
- [ ] Groups sorted by latest message date desc — most recently active client at top.
- [ ] Search bar (DL-274): filters `_allMessages`; grouping recomputes; works identically.
- [ ] Reply modal (DL-289 expanded compose) opens from inside an expanded group.
- [ ] Verify with the [H:client-name] screenshots: two rows become one card, "2 הודעות" badge, 09:11 at top, "לפני 4 ימים" message visible under expand.
- [ ] Mobile (<900px): groups still readable; counter and chevron don't wrap awkwardly.
- [ ] Hard-refresh — confirm `script.js?v=401` is served.

## OPEN: DL-395 — PA review yes-answers visibility

DL: `.agent/design-logs/admin-ui/395-pa-review-show-yes-answers.md`

Open-test items from Section 7 (deploy Pages first, then verify on live admin):

- [ ] PA review for a sample client — confirm questionnaire-answers section lists has-children=✓, business-stock=✓, pension/keren-hishtalmut/life-insurance rows (with company values), no yes/free subsection split.
- [ ] Click print button on the same card — printed sheet matches the on-screen list 1:1.
- [ ] `[H:no]` toggle regression — pick a client with ≥1 `✗ [H:no]`; confirm count, expand/collapse work, no row leaks to main list.
- [ ] Empty `answers_all` client — section renders nothing.
- [ ] DL-302 cross-highlight — hover a yes-answer with `template_ids`; related doc tags highlight. Yes-answer with no templates — no error.
- [ ] Mobile <1024px — single column, no horizontal overflow.
- [ ] Hard-refresh — confirm `script.js?v=400` is served.

## Recent (last 7 days)

- **2026-05-03 · /security-deep-audit shipped + first run + HIGH fixes deployed.** Skill moved from `.agent/skills/` (invisible to harness) to `.claude/skills/security-deep-audit/`; `skills-build` SKILL.md updated with the path gotcha. First audit (43 findings, 0 CRITICAL, 10 HIGH) at `.agent/audits/security-deep-audit-2026-05-03.md`. Auto-fixed: (a) `backfill.ts:32,258` — `verifyToken()` was never awaited so `/webhook/backfill-note-sender` and `/webhook/backfill-conversation-ids` had **fully open auth** (truthy Promise made the `!verifyToken(...)` guard always-pass); (b) `extract-issuer-names.ts:212` — `N8N_INTERNAL_KEY` compared with `===` → now `timingSafeEqual` (extracted to `lib/crypto.ts`, dedup'd from `events.ts`). Worker version `8add5785` deployed, health 200. GitHub branch protection on `main` now ON: `enforce_admins=true`, force-push and deletion blocked. **Open from audit (manual UI only):** MS Graph subscription expires 2026-05-05T16:47:29Z (watch n8n `[05-SUB] Email Subscription Manager` + Worker Logs for 401/404 from Graph), Azure App reg secret expirations, Anthropic/Airtable/Tally/n8n key rotation status, Vite CVE-2026-39365 in `frontend/admin/react/`, OneDrive sharing-token literal at `attachment-utils.ts:7` (low real-world risk — public share URL, not a credential), pre-migration backup `docs/wf05-backup-pre-migration-2026-03-26.json` (rotated values, gitignore-or-delete).
- **2026-05-02 · DL-395 — IMPLEMENTED, NEED TESTING.** `buildPaPreviewBody` (`frontend/admin/js/script.js` ~10144-10182) now mirrors print sheet — drops only `✗ [H:no]`, renders rest in flat list with original-index `data-answer-idx` for DL-302 cross-highlight stability. Cache-bust v=399→400.
- **2026-05-02 · DL-394 — COMPLETED.** `also_match` now uploads a physical OneDrive copy per target (renamed via `resolveOneDriveFilename`). Each Documents record has its own `onedrive_item_id` + `file_url`. Rollback-on-failure. Cascade-revert is naturally per-card. All 4 test cases verified live. DL: `.agent/design-logs/ai-review/394-onedrive-copy-on-also-match.md`.
- **2026-05-02 · DL-391 cascade-revert 422 fix — COMPLETED.** `notification_status: null` instead of `''` (commit 94964040). Verified on main.
- **Pages cache-bust race resolved.** Pages git auto-deploy is back online (verified 2026-05-02). Manual `wrangler pages deploy` races against the git build and 502s on `/pages/assets/upload`. Memory: `reference_pages_git_autodeploy_back.md`. DL-368 marked archival once user confirms the auto-deploy is stable across multiple commits.



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

---

## 2026-05-03 — Security deep audit run

10/10 categories ran. 0 CRITICAL, 10 HIGH, 7 MEDIUM, 6 LOW, 20 INFO. 1 time-bomb (≤7d: MS Graph subscription expiring 2026-05-05), 7 manual UI checks. Report: `.agent/audits/security-deep-audit-2026-05-03.md`.
