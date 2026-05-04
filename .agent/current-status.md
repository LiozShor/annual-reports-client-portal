# Annual Reports CRM - Current Status

**Last Updated:** 2026-05-04 (DL-401 — IMPLEMENTED, NEED TESTING. Unidentified-inbound doc rows in AI Review are now clickable for in-app preview, matching classified rows.)

## OPEN: DL-401 — Unidentified inbound doc rows clickable

DL: `.agent/design-logs/ai-review/401-unidentified-doc-row-clickable.md`

Open-test items from Section 7 (frontend-only; Pages auto-deploys on push):

- [ ] Pre-commit ratchet on `script.js`: net line count delta == 0 (in-place line replacement).
- [ ] Live admin AI Review tab — open the current unidentified card → click the `image009.png` row → preview pane opens showing the image; row gets active highlight.
- [ ] Hover an unidentified row → cursor changes to pointer (no longer `default`); opacity is full (no longer 0.85).
- [ ] Click the small ↗ OneDrive icon in an unidentified row → OneDrive opens in new tab; row click does NOT also fire (existing `event.stopPropagation()`).
- [ ] Regression: open a classified card, click any doc row — same behavior as before (no change).
- [ ] Mobile (narrow viewport) — row click triggers `loadDocPreview` via DL-334 mobile short-circuit.
- [ ] Hard-refresh — confirm `script.js?v=414` is served.

## OPEN: DL-400 — Edit-client modal row disappears on save

DL: `.agent/design-logs/admin-ui/400-edit-client-modal-row-disappears-on-save.md`

Open-test items from Section 7 (frontend-only; Pages auto-deploys on push):

- [ ] Edit only `phone` on a real client → row stays visible, name/email/cc_email unchanged.
- [ ] Edit only `name` → row stays visible, other fields preserved.
- [ ] Edit only `email` → row stays visible, other fields preserved.
- [ ] Edit only `cc_email` → row stays visible, other fields preserved.
- [ ] Edit two fields at once → both update, row visible.
- [ ] Active search term during save → row remains in filtered view if still matches.
- [ ] Hard reload after save → values match Airtable (server write succeeded).
- [ ] Cancel button → no change to local state.
- [ ] Hard-refresh → confirm `script.js?v=407` is served.

## Recent (last 7 days)

- **2026-05-03 · DL-398 — COMPLETED.** Admin dashboard stat cards show small muted percentage next to count for stages 1–8 (% of `counts.total` active clients, whole numbers, parenthesized superscript). Total card unchanged. JS-only injection inside `recalculateStats()` — single render path. Cache-bust script.js v=403→405, style.css v=384→386 (initial render glued count to percent — fixed in followup commit `d082b1f7` with parens + 0.45em font + vertical-align 0.35em). User confirmed live. DL: `.agent/design-logs/admin-ui/398-stat-card-percentage.md`.
## Recent (last 7 days)

- **2026-05-03 · DL-399 COMPLETED.** Email bounce / NDR handling shipped + live-verified end-to-end. Worker version `40392bcc-7d21-45e0-9abc-1c92f01c67c6`. New `bounce-detector.ts` parses Outlook NDRs (Hebrew + EN subject prefixes, body recipient extraction with office+sender domain exclusion) before the auto-reply short-circuit; `bounce-handler.ts` clears the matched client's email, writes 4 audit fields, reverts Stage-2 reports to Stage-1, logs to activity-logger. Frontend (extracted to `modules/bounce-warning.js` due to monolith size ratchet): clickable warning button next to the stage badge (desktop + mobile) opens a bounce-detail modal; pin bounced clients to top of table; Stage-1 stat-card pulses blue (distinct from Stage-3 amber); paper-plane row button + bulk-send gated on non-empty email; post-edit-save confirm in Stage-1. Schema: 4 new fields on the clients table, `Bounced` option on `email_events.processing_status`. Mid-flight fixes folded in: regex anchors broken by Hebrew NDR subject prefix → word-boundaries; sender-NDR-robot fallback defaults to isHard true; recipient-extraction fallback excludes office + sender domains; admin-dashboard route extended to expose the 4 bounce fields per client; bounce-modal lookup switched from `window.clientsData` (was let-scoped, undefined inside the module) to button data-* attrs; nav count badges enlarged 11px → 14px. DL: `.agent/design-logs/admin-ui/399-email-bounce-handling.md`.
- **2026-05-03 · review-tab additions (shipped alongside DL-399).** Review-queue tab now: (a) waiting badge renders months instead of days when over 31 days; (b) pagination via the existing renderPagination helper (DL-256), PAGE_SIZE=50, FIFO numbering preserved across pages; (c) search bar filters by name OR email, resets to page 1; (d) X-clear button inside the input (RTL-aware via inset-inline-end). All new logic in `frontend/admin/js/modules/review-tab.js`. Cache-bust script.js v=413, review-tab.js v=1.
- **2026-05-03 · DL-397 — COMPLETED.** Capture contract months on manual T901/T902 assign across 3 flows (reassign modal / chip "assign to this doc" / add-doc inline prompt). Backend `reassign` action atomically persists `matched_template_id` + optional `contract_period` in Step 5 PATCH. Live-verified: (a) Reassign modal — selected T901, filled months, saved successfully; (b) Add-doc popover — T902 chip created via "+", inline prompt with months popped, submit produced `חוזה שכירות (הוצאה) 01.2025-09.2025.pdf` in OneDrive (after follow-up); (c) Chip-menu sub-popover — "📎 שייך…" on a Required_Missing T902 chip rendered the months mini-form and saved. **Follow-up fix**: Step 6 OneDrive rename (`getRentalPeriodLabel()`) reads `clsFields` snapshot loaded at Step 2 — without sync, manual reassign produced filenames missing the period suffix. Now sync `clsFields.matched_template_id` and `contract_period` in-memory when building Step 5 PATCH. Cache-bust v=400→403 (rebase race + follow-up bumps). Worker `4867ed44-45e7-45b0-92a9-fc5d02a0101c`. DL: `.agent/design-logs/ai-review/397-manual-assign-contract-months-and-stale-template-id.md`.
- **2026-05-03 · DL-396 — COMPLETED.** Dashboard "הודעות אחרונות מלקוחות" panel groups multiple emails per client into one card. Two ships in one day: (a) v=401 baseline grouping by `client_name|client_id` composite key with collapsible expanded body; (b) v=402 follow-up UX redesign driven by `/tech-researcher` (PatternFly notification-drawer + iOS WWDC18 grouped notifications + Smashing 2025 notifications UX) — header shows latest snippet ONCE, header IS action surface (✓-all + 💬-reply-latest + 📁), older rows dim with hidden client name, soft counter pill, trailing-edge chevron, iOS stack-peek ghost. Group-level ✓ via new `markGroupHandled` (Promise.all of existing `delete-client-note`). Frontend-only. Branches `claude-session-20260503-115728` (c6cab9ae) + `DL-396-followup-ux-redesign` (22da373a). DL: `.agent/design-logs/admin-ui/396-recent-messages-group-by-client.md`.

## NEXT (deferred): allow multi-instance template adds (needs fresh DL number — 398 consumed by stat-card percentages)

User wants: removing the "מסמך זה כבר קיים ברשימה" guard from add-doc popover so admin can deliberately create N instances of the same template (rental property #1, #2, …; multiple invoices from different issuers). Touch points: `_paAddDocConfirm` / `addAIDoc` in `frontend/admin/js/script.js`; UX decision (warn-and-confirm vs. just allow).

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
