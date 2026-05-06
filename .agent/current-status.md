# Annual Reports CRM - Current Status

**Last Updated:** 2026-05-06 (DL-408 implemented — rental-contract multi-instance fix; DL-405 shipped; DL-404 merge still 500s.)

## OPEN: DL-408 — Doc-Manager Rental Contracts Multi-Instance

DL: `.agent/design-logs/admin-ui/408-doc-manager-rental-multi-instance.md`
Status: **IMPLEMENTED — NEED TESTING**

Symptom (CPA-XXX): T901 ("דירה מושכרת – הכנסה") missing from add-doc dropdown. Root cause: T901's Airtable `variables` field was empty + the `userVars.length === 0 && existingTemplateIds.has(...)` filter at `document-manager.js:771` swallowed it once on the report. Fixed both: PATCHed Airtable T901 row to set `variables = "rent_income_monthly"` AND added `MULTI_INSTANCE_TEMPLATES = new Set(['T901','T902'])` allowlist bypass as defense-in-depth.

### Active TODOs (validation — Phase E)
- [ ] CPA-XXX (reporter's client) AR doc-manager: confirm T901 + T902 both render under the housing category.
- [ ] Add T901 once → fill `rent_income_monthly` → confirm T901 still in dropdown afterward (multi-instance).
- [ ] Add a second T901 with a different `rent_income_monthly` → both chips render distinctly.
- [ ] Regression: on another client, add a no-variable template NOT in the allowlist → confirm it still disappears after add.
- [ ] PA queue parity (same reporter's client in Pending Approval): add T901 twice with different `rent_income_monthly` — no duplicate warning, both chips persist.
- [ ] Cache-bust check: `curl -sI https://docs.moshe-atsits.com/document-manager.html | grep document-manager.js` shows `?v=408`.
- [ ] Hebrew RTL render check: chips show distinct property identifiers; no visual collision.
- [ ] **Open question for Natan:** any other contract templates that should be multi-instance? (Bank loan agreements? Business lease contracts?) If yes, append template_ids to `MULTI_INSTANCE_TEMPLATES` in a follow-up DL.

---

## Session 2026-05-06 — Snapshot

**Shipped + deployed:**
- **DL-405** unify right-click + kebab menus through one shared item-list helper (`frontend/admin/js/modules/client-row-actions.js`). Mobile long-press, ARIA + arrow-key nav. `script.js` net −80 lines (16217 → 16137); ratchet baseline auto-shrunk. Cache-bust `script.js?v=417`. Merged (`748cc6c6`). DL `.agent/design-logs/admin-ui/405-unify-context-menus.md` status `BEING IMPLEMENTED`. **§7 validation un-tested.**
- **DL-404 hotfix #1** — `window.clientsData` exposure (modules read `window.clientsData` but `script.js` declared it with `let` → not on window). Picker rendered "no clients found" before this. Fix: `window.clientsData = clientsData = data.clients || []`. `script.js?v=418`. Merged (`74be4a94`).
- **DL-404 hotfix #2** — picker polish: removed CPA-NNN row; exposed `window.STAGES` + `STAGE_NUM_TO_KEY` + `STAGE_LABELS` + `STAGE_ORDER` from `frontend/shared/constants.js` so picker shows Hebrew stage labels instead of raw enum. `merge-clients.js?v=2`, `constants.js?v=371`. Merged (`3cafdd28`).
- **DL-404 hotfix #3** — `api/src/lib/merge-clients.ts`: replaced `airtable.getRecord(TABLES.CLIENTS, '<client_id>')` (404s — `client_id` is a formula field, not a record id) with `listAllRecords` filter. Replaced `new Date().getFullYear()` year derivation (returned 2026 vs report year=2025 → 0 matches) with most-recent-report sort. First sort attempt used `created_at` on Reports → 422 UNKNOWN_FIELD_NAME (Reports has no `created_at`); switched to `year desc`. Worker `0769016e`. Merged (`3a352d90` + `ba2ffc1f`).
- **Airtable schema fields created** via Meta API (DL-404's lazy-typecast plan failed because `airtable.updateRecord` doesn't pass `typecast:true`):
  - `clients.merged_into` — `fldQQrkKiK5Hyv9CI` (singleLineText)
  - `clients.merged_at` — `fld2PQIRUCaqvVNXE` (dateTime, ISO, Asia/Jerusalem)
  - `reports.merged_from_report_ids` — `fldzxdRybdcP4lxlE` (multilineText)

**Test clients used:** two QA siblings (older = winner CPA-XX with ~5/49 docs at `Collecting_Docs`; newer = loser CPA-YY with 0/4 docs at `Collecting_Docs` post-questionnaire). Both have annual_report filing_type, year=2025. IDs intentionally redacted from this status file; recover from `clientsData` console dump or git log of session DLs.

**STILL BROKEN — DL-404 merge 500 after all four hotfixes.** Worker response: `{"ok":false,"code":"internal_error","message":"Internal server error"}`. Logpush ~5min latency so live error not captured before session end. **Strongest un-verified hypothesis:** `merge-clients.ts:216-217` uses `filterByFormula: \`{client_id}='${escA}'\`` against the **clients** table, but `clients.client_id` is a **formula** field. Per the airtable skill memory, formula/rollup fields cannot be matched with `=` — must use `SEARCH('CPA-XXX',{client_id})` or `FIND(...)`. Reports table also has `client_id` as a lookup field on lines 233/238 → same trap. If true: listAllRecords 422s → caught at outer catch → route returns `internal_error` 500. **Next-session step 1:** verify with one curl probe (bare `=` vs `SEARCH(...)`) and patch the four occurrences. Step 2 if not it: query Worker Logs (Logpush will have caught up) for the actual exception.

**Other open follow-ups from this session:**
- `~/.claude/skills/airtable/SKILL.md` falsely lists `created_at` as a Reports field (line 73) and claims it's common "across all four tables" (line 85). Reports has NO `created_at`. Documents DOES (verified). Pending_classifications and Templates do NOT. Fix: remove from Reports field list; change wording to "Documents has `created_at`; Reports/Pending/Templates do not". Re-verify `docs/airtable-schema.md` Reports section too.
- DL-404 lazy-typecast contract is broken in code — `airtable.updateRecord` (`api/src/lib/airtable.ts:109`) does NOT accept a typecast option, but DL-404 spec assumed PATCH would auto-create the new fields. Either extend `updateRecord` to forward `typecast:true` or strike the lazy-create promise from DL-404 docs (today the latter — manual field creation).
- Memory entries to save next session: (a) `let`/`const` top-level globals are not on `window` — modules that read `window.X` need explicit exposure; (b) Reports table has no `created_at` field; (c) DL-404 `updateRecord` never passes `typecast`, so any "typecast lazy-create" claim in DL spec is a code lie.

**DL-405 validation still pending** — see DL §7 (long-press, arrow-key nav, ARIA in DOM, group-divider counts, RTL clamp) plus DL-404 erratum smoke test (merge action visible from BOTH right-click + kebab on dashboard).

---

**Last Updated:** 2026-05-05 (DL-404 — IMPLEMENTED, NEED TESTING. One-click merge of two clients into a single household. Worker deployed, dashboard hotfix landed.)


## OPEN: DL-404 — Merge two clients into one

DL: `.agent/design-logs/admin-ui/404-merge-clients.md`
Worker version: `c8d3a351-4239-4f54-8c50-4492ad8d393b` (a6dfce42 + hotfix a1d88c5a)
Frontend cache-bust: `script.js?v=416`

Open-test items from Section 7:

- [ ] **Smoke (happy path):** create two QA test clients in Airtable, fill both questionnaires, run merge from kebab. Verify: winner = older `createdTime`, loser is `is_active=false` + `merged_into=<winner>`, winner `name` is the ampersand-merged form (or whatever admin typed), winner.report `spouse_name` populated when previously blank, `cc_email` populated on winner, all docs visible in winner's doc-manager (split across `person` tabs).
- [ ] **Custom merged name:** override the pre-filled `"A & B"` in the dialog with a free-form name; verify it lands on `clients.name` exactly as typed and propagates to dashboard list, doc-manager header, AI Review accordion, and outgoing email greetings.
- [ ] **Spouse name conflict warning:** pre-set winner.report.spouse_name to a different non-empty value before merge; merge completes but result includes `spouse_name_conflict`; existing value preserved; toast surfaces it.
- [ ] **OneDrive physical move:** before merge, note loser's folder contents. After merge, winner's folder contains all loser's files; loser's folder is empty. Doc preview links still work (DL-356 self-heal does not trigger).
- [ ] **OneDrive collision:** seed both clients with identically-named files. After merge, winner's folder contains both — original + ` (2).pdf` variant. Both preview-able from doc-manager.
- [ ] **OneDrive partial-failure retry:** simulate by killing the request mid-move (or temporarily revoking permission to one item). Endpoint returns `partial_onedrive_move` with counts. Re-running the same merge call (same idempotency key) only retries un-moved items and completes the rest cleanly.
- [ ] **Email contract:** send a test reminder + batch-status + approve-and-send to the merged client; inspect SENT mail in Outlook (gws CLI per `docs/gws-cli.md`). Confirm To + CC headers on each. Reply (`replyToMessage`) verified deferred. **Note:** `reminders.ts` is n8n-delegated — actual reminder mail is sent by the n8n workflow `/send-reminder-manual`; the n8n workflow needs a separate cc_email plumbing change (DL-405 candidate).
- [ ] **Stage rule:** merge a Stage-4 with a Stage-2 → merged stage is Stage-2 (lower wins). Verify reminder recompute fired (`reminder_next_date` updated, weekend-skip per DL-390).
- [ ] **Questionnaire print:** open merged winner's PA tab — both source questionnaires render sequentially with section headers.
- [ ] **Idempotency:** click merge button twice rapidly — second call returns prior result, no duplicate side effects.
- [ ] **Cross-filing-type rejection:** attempt merge across annual + capital_statements → endpoint returns `cross_filing_type`, frontend toasts the structured message.
- [ ] **Queue counters:** dashboard stat cards + queue tabs do NOT count the loser. `recalculateStats()` matches tab badges (DL-364 invariant).
- [ ] **Inbound from cc_email:** send a test email from the loser's old address to the office inbox. Verify processor identifies it as the WINNER (check `email_events.client` link + `match_method`); resulting `pending_classification` lands under the winner in AI Review.
- [ ] **Inbound merged-redirect path:** temporarily blank `clients.cc_email` on the merged row, send another test from the loser's old address. Verify identifier falls through to `merged_into` pointer and still resolves to the winner; `match_method='merged_redirect'` logged.
- [ ] **Pending classifications carry over:** before merge, ensure both records have at least one `pending_classifications` row. After merge, both appear under the winner's AI Review accordion; previously-attached OneDrive files preview correctly.
- [ ] **Activity log:** `client_merged` event in Workers Logs with no PII (only client_ids).
- [ ] **Silent refresh:** after merge, both clients' rows update in-place (winner shows merged data, loser disappears) without page reload (P6 rule).
- [ ] **Dashboard regression after hotfix:** `/webhook/admin-dashboard?year=2025` returns 200 (dashboard shipped on a6dfce42 caused 500 via bogus `{merged_into}` formula on the reports table; hotfix a1d88c5a removed the formula since the existing `client_is_active` lookup chain handles loser exclusion).

**Deferred / out of scope:**
- Cross-filing-type merge (annual ↔ capital_statements) — endpoint rejects with `cross_filing_type`.
- Un-merge / restore — manual Airtable edit only for v1.
- `replyToMessage` CC support — office-typed replies remain single-recipient until a follow-up DL.
- Deletion of the empty loser OneDrive folder (audit-preserve).
- **n8n reminder workflow CC** (DL-405 candidate) — Worker `reminders.ts` delegates to the n8n `/send-reminder-manual` workflow which needs its own CC wiring; out of scope for DL-404.

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

## SHIPPED: DL-400 — Edit-client modal row disappears on save (closed 2026-05-03)

## Recent (last 7 days)

- **2026-05-03 · DL-398 — COMPLETED.** Admin dashboard stat cards show small muted percentage next to count for stages 1–8 (% of `counts.total` active clients, whole numbers, parenthesized superscript). Total card unchanged. JS-only injection inside `recalculateStats()` — single render path. Cache-bust script.js v=403→405, style.css v=384→386 (initial render glued count to percent — fixed in followup commit `d082b1f7` with parens + 0.45em font + vertical-align 0.35em). User confirmed live. DL: `.agent/design-logs/admin-ui/398-stat-card-percentage.md`.

## Recent (last 7 days)

- **2026-05-03 · DL-399 COMPLETED.** Email bounce / NDR handling shipped + live-verified end-to-end. Worker version `40392bcc-7d21-45e0-9abc-1c92f01c67c6`. New `bounce-detector.ts` parses Outlook NDRs (Hebrew + EN subject prefixes, body recipient extraction with office+sender domain exclusion) before the auto-reply short-circuit; `bounce-handler.ts` clears the matched client's email, writes 4 audit fields, reverts Stage-2 reports to Stage-1, logs to activity-logger. Frontend (extracted to `modules/bounce-warning.js` due to monolith size ratchet): clickable warning button next to the stage badge (desktop + mobile) opens a bounce-detail modal; pin bounced clients to top of table; Stage-1 stat-card pulses blue (distinct from Stage-3 amber); paper-plane row button + bulk-send gated on non-empty email; post-edit-save confirm in Stage-1. Schema: 4 new fields on the clients table, `Bounced` option on `email_events.processing_status`. Mid-flight fixes folded in: regex anchors broken by Hebrew NDR subject prefix → word-boundaries; sender-NDR-robot fallback defaults to isHard true; recipient-extraction fallback excludes office + sender domains; admin-dashboard route extended to expose the 4 bounce fields per client; bounce-modal lookup switched from `window.clientsData` (was let-scoped, undefined inside the module) to button data-* attrs; nav count badges enlarged 11px → 14px. DL: `.agent/design-logs/admin-ui/399-email-bounce-handling.md`.
- **2026-05-03 · review-tab additions (shipped alongside DL-399).** Review-queue tab now: (a) waiting badge renders months instead of days when over 31 days; (b) pagination via the existing renderPagination helper (DL-256), PAGE_SIZE=50, FIFO numbering preserved across pages; (c) search bar filters by name OR email, resets to page 1; (d) X-clear button inside the input (RTL-aware via inset-inline-end). All new logic in `frontend/admin/js/modules/review-tab.js`. Cache-bust script.js v=413, review-tab.js v=1.
- **2026-05-03 · DL-397 — COMPLETED.** Capture contract months on manual T901/T902 assign across 3 flows (reassign modal / chip "assign to this doc" / add-doc inline prompt). Backend `reassign` action atomically persists `matched_template_id` + optional `contract_period` in Step 5 PATCH. Live-verified: (a) Reassign modal — selected T901, filled months, saved successfully; (b) Add-doc popover — T902 chip created via "+", inline prompt with months popped, submit produced `חוזה שכירות (הוצאה) 01.2025-09.2025.pdf` in OneDrive (after follow-up); (c) Chip-menu sub-popover — "📎 שייך…" on a Required_Missing T902 chip rendered the months mini-form and saved. **Follow-up fix**: Step 6 OneDrive rename (`getRentalPeriodLabel()`) reads `clsFields` snapshot loaded at Step 2 — without sync, manual reassign produced filenames missing the period suffix. Now sync `clsFields.matched_template_id` and `contract_period` in-memory when building Step 5 PATCH. Cache-bust v=400→403 (rebase race + follow-up bumps). Worker `4867ed44-45e7-45b0-92a9-fc5d02a0101c`. DL: `.agent/design-logs/ai-review/397-manual-assign-contract-months-and-stale-template-id.md`.
- **2026-05-03 · DL-396 — COMPLETED.** Dashboard "הודעות אחרונות מלקוחות" panel groups multiple emails per client into one card. Two ships in one day: (a) v=401 baseline grouping by `client_name|client_id` composite key with collapsible expanded body; (b) v=402 follow-up UX redesign driven by `/tech-researcher` (PatternFly notification-drawer + iOS WWDC18 grouped notifications + Smashing 2025 notifications UX) — header shows latest snippet ONCE, header IS action surface (✓-all + 💬-reply-latest + 📁), older rows dim with hidden client name, soft counter pill, trailing-edge chevron, iOS stack-peek ghost. Group-level ✓ via new `markGroupHandled` (Promise.all of existing `delete-client-note`). Frontend-only. Branches `claude-session-20260503-115728` (c6cab9ae) + `DL-396-followup-ux-redesign` (22da373a). DL: `.agent/design-logs/admin-ui/396-recent-messages-group-by-client.md`.

## NEXT (deferred): allow multi-instance template adds (needs fresh DL number — 398 consumed by stat-card percentages)

User wants: removing the "מסמך זה כבר קיים ברשימה" guard from add-doc popover so admin can deliberately create N instances of the same template (rental property #1, #2, …; multiple invoices from different issuers). Touch points: `_paAddDocConfirm` / `addAIDoc` in `frontend/admin/js/script.js`; UX decision (warn-and-confirm vs. just allow).

## SHIPPED: DL-395 — PA review yes-answers visibility (closed 2026-05-02)

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
