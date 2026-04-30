# Annual Reports CRM - Current Status

**Last Updated:** 2026-04-30 (DL-385 — COMPLETED; partial-contract T901↔T902 swap (kebab `החלף חוזה מהוצאה להכנסה (וההפך)`, idempotent server action, optimistic flip + Undo toast) + lenient MM.YYYY date input above native calendar (parser accepts `5.26`, `05.2026`, `5/2026`, `052025` MMYYYY no-separator, etc.). 4 iterations, 12 QA scenarios passed live on CPA-XXX, 3 display bugs caught + fixed (stale badge after swap, no inline refresh after date save, cross-year banner using item.year). New backend action `swap-classification` in `/review-classification`. New seeder `scripts/seed-cpa210-qa.mjs` (`--dry-run` / `--cleanup`, prefix `[DL-385-QA]`). Worker version `04639687-3269-4617-92e7-275dc18884c7`, Pages `script.js?v=388` live. DL at `.agent/design-logs/ai-review/385-partial-contract-swap-and-date-input.md`.)
**Last Updated:** 2026-04-30 (DL-386 — IMPLEMENTED, NEED TESTING; "+" chip added as last item in AI review [H:required-docs] section. Click opens existing PA add-doc popover (DL-301/336) — now AI-aware via `_paResolveAddDocItem` fallback against `aiClassificationsData`. After successful add: `loadAIClassifications(true)` + `refreshClientDocTags(clientName)` (DL-053). When exactly one `.ai-review-card.preview-active` exists at click time, prompts `[H:confirm-assign-file-to-this-doc]` and runs existing `submitAIReassign` against the new `doc_record_id`. `paDocIsDuplicate` extended for AI flat shape; `_paApplyOptimisticAdd` gated to PA-only via `aiMode` flag. Cache-bust `script.js?v=387→388`, `style.css?v=382→383`. DL-386 at `.agent/design-logs/ai-review/386-add-required-doc-from-ai-review.md`. **Verify (Section 7):** (a) chip renders as last item in body on desktop 3-pane and mobile accordion, (b) click opens popover, (c) template + custom-doc paths both create the doc and add a chip within ~1s, (d) spouse client → person selector visible; spouse-doc creation works, (e) inline reassign comboboxes on AI cards include the new doc, (f) PA preview "+ [H:add-doc]" still works identically (no regression), (g) active-card flow → confirm dialog appears + reassign succeeds; cancel = doc-only, (h) no active card → no confirm dialog. Pages deploy needed before testing.)
**Last Updated:** 2026-04-30 (DL-387 — IMPLEMENTED, NEED TESTING; reassign modal single-click custom doc submit. User reported 2-click friction: had to press Enter on the typed custom name then click שייך. Root cause: DL-350's commit-then-submit branch in `confirmAIReassign` was unreachable because `aiReassignConfirmBtn` stayed disabled until `onPick` fired (which only happened after explicit chip commit). Fix: added a live `input` listener on `.ai-tpl-custom-input` inside `_buildDocTemplatePicker` that calls `onPick({template_id:'general_doc', new_doc_name, _pending:true})` while typing — enabling the button immediately. Existing `confirmAIReassign` early-return at script.js:7671 already submits identically. Cache-bust v=388→389. **Verify:** AI Review → "שייך מחדש" → "+ הוסף מסמך חדש" → type a name → click שייך once → expect success toast + reassigned to general_doc. Regression: chip path (type→Enter→שייך) and combobox-only path still work. DL-387 at `.agent/design-logs/admin-ui/387-reassign-modal-single-click-custom.md`.)
**Last Updated:** 2026-04-30 (DL-383 — COMPLETED; doc-manager Waived↔Required reliability + UX fix. Fix 500 on restore (document_uid preserved, DL-205 invariant scoped to non-Waived sources); waive-wins guard; real error body in toast; restore-checkbox→restore-btn; file-clear warning gated; immediate row refresh. Also: 4 TS errors + hook path fixed. Verify: open CPA-XXX doc-manager, restore a Waived doc, confirm green toast + no 500 + document_uid intact in Airtable. DL-383 at `.agent/design-logs/documents/383-doc-manager-recover-waived.md`.)
**Last Updated:** 2026-04-30 (DL-384 — IMPLEMENTED, NEED TESTING; password-reply client_note now stores the stripped reply (replyLines / searchLines fallback) instead of the full forwarded body, so admin "[H:hebrew]" thread shows only the actual client message. Same `passwordReplyRaw` flows to `pending_classifications.password_reply_raw` (AI Review unlock chip) — both surfaces clean. Adjacent cleanup: removed 2 dead `notesText = item.notes + item.client_notes` concats in script.js (buildPaCard, buildPaPreviewBody) and stopped dumping the JSON array into the print questionnaire sheet (`viewPrintQuestionnaireSheet`). Cache-bust `script.js?v=382→384`. **Verify:** trigger fresh PWD request → reply with `[H:hebrew] test123` → check Airtable `report.client_notes` last entry = stripped reply only; PA card thread shows only the reply; AI Review unlock chip clean; print sheet has no JSON leak. DL-384 at `.agent/design-logs/ai-review/384-password-reply-note-quote-stripping.md`.)
**Last Updated:** 2026-04-30 (DL-383 — IMPLEMENTED, NEED TESTING; doc-manager Waived↔Required reliability + UX fix. Fix 500 on restore (document_uid preserved, DL-205 invariant scoped to non-Waived sources); waive-wins guard; real error body in toast; restore-checkbox→restore-btn; file-clear warning gated; immediate row refresh. Also: 4 TS errors + hook path fixed. Verify: open CPA-XXX doc-manager, restore a Waived doc, confirm green toast + no 500 + document_uid intact in Airtable. DL-383 at `.agent/design-logs/documents/383-doc-manager-recover-waived.md`.)
**Last Updated:** 2026-04-29 (DL-365 Phase 2 SHIPPED + verified live — server-side activity-logger instrumentation. logSecurity dual-writes (Airtable + CF Logs); logError emits worker_error event; new business events: inbound_note_saved, attachment_classified, classifications_listed, doc_approve|reject|reassign, batch_send, doc_upload. request_id middleware threads correlation. Verified: auth_fail/success ✅, doc_reassign ✅, PII contract ✅. Inbound queue chain inconclusive — queue consumer logs not surfacing in CF Observability (separate investigation, not Phase 2 issue). Plan: `~/.claude/plans/velvet-wandering-quasar.md`.)
**Last Updated:** 2026-04-29 (git-ship skill updated to use `.claude/workflows/` wrappers — merge-and-push, deploy-worker, close-design-log; reduces friction on multi-step git ops.)
**Last Updated:** 2026-04-29 (Self-Improvement Infra Tiers 1+2 SHIPPED — Tier 1: regression scaffold (12 cases), MEMORY.md size guard, retry-detector hook, telemetry gitignore. Tier 2: memory timestamps backfilled (46 files), `.claude/workflows/` (deploy-worker.sh, merge-and-push.sh, close-design-log.sh), Stop-hook session telemetry, design-log skill wired to close-design-log.sh. Plan: `~/.claude/plans/snoopy-conjuring-blossom.md`. Tier 3 SHIPPED — `/consolidate-memory` skill at `.agent/skills/consolidate-memory/SKILL.md`, monthly-insights extended with self-improvement signals section.)
**Last Updated:** 2026-04-29 (DL-379 COMPLETED — encrypted-PDF lock indicator on AI Review cards live.)
**Last Updated:** 2026-04-29 (DL-377 COMPLETED — layered PII/secret defense: harness deny rules, CI pii-guard.yml + secret-scan.yml, pre-commit hook chain. Optional follow-up: enable GitHub branch-protection required status checks for pii-guard.yml.)
**Last Updated:** 2026-04-29 (DL-376 COMPLETED — OneDrive approve-rename uses issuer_name before matched_doc_name. Orphan backfill rename: TODO below.)
**Last Updated:** 2026-04-29 (DL-375 COMPLETED — download button restored on AI-review preview header.)
**Last Updated:** 2026-04-29 (DL-374 COMPLETED — AI-review open-in-new-tab uses fresh MS Graph webUrl. Doc-manager stale-URL follow-up: COMPLETED by user.)
**Last Updated:** 2026-04-29 (DL-373 COMPLETED — password-protected PDF unlock from AI Review preview live.)
**Last Updated:** 2026-04-29 (DL-371 COMPLETED — edit-client modal full redesign live.)
**Last Updated:** 2026-04-29 (DL-370 COMPLETED — move-classification edge cases verified live.)
**Last Updated:** 2026-04-29 (DL-369 COMPLETED — AI Review move-document-to-client live.)
**Last Updated:** 2026-04-29 (DL-366 COMPLETED — dashboard cc_email + copy questionnaire link live.)
**Last Updated:** 2026-04-28 (DL-365 Phase 1 COMPLETE — smoke test passed, CF Logs verified, Logpush active; Phases 2-4 queued.)
**Last Updated:** 2026-04-28 (DL-368 domain cutover COMPLETE — docs.moshe-atsits.com on annual-reports-client-portal-git. Git auto-deploy still broken — CF support ticket pending.)
**Last Updated:** 2026-04-29 (DL-381 — IMPLEMENTED, NEED TESTING; backfilled `docs_completed_at` on 2 stuck Stage-5 clients (2026-03-25 timestamps). Hard-reload admin panel → verify reviewCountBadge == stat-stage5 (both 51). Verify both clients appear in "[H:hebrew]" FIFO queue. Follow-up: delete dead `/admin-mark-complete` from stage.ts + endpoints.js.)
**Last Updated:** 2026-04-29 (DL-380 — IMPLEMENTED, NEED TESTING; one-click "request password" bilingual email from AI Review kebab; Worker `POST /webhook/request-pdf-password` (preview + send modes, idempotency guard); inbound processor auto-detects `[#PWD-TOKEN]` in reply subject → `suggested_password` chip in unlock panel; 3 new Airtable fields — run `python3 scripts/dl380-add-schema-fields.py` before deploy; Worker deploy + Pages deploy (script.js?v=381) needed before testing.)
**Last Updated:** 2026-04-29 (DL-379 — IMPLEMENTED, NEED TESTING; encrypted-PDF lock indicator on AI Review cards; detects `ai_reason` containing "password protected"; renders 🔒 "[H:hebrew]" badge + amber border on card; frontend-only, no Worker/schema change; cache-bust script.js+style.css to v=379. Pages deploy needed after merge to main.)
**Last Updated:** 2026-04-29 (Self-Improvement Infra Tier 1 SHIPPED — regression scaffold (`scripts/check-regressions.sh`, 12 cases), MEMORY.md size guard hook, retry-detector hook, telemetry gitignore. Plan: `~/.claude/plans/snoopy-conjuring-blossom.md`. **TODO: finish what we started — Tiers 2 & 3 still pending.** Tier 2 = memory timestamps + backfill, `.claude/workflows/` (deploy-worker.sh, merge-and-push.sh, close-design-log.sh), Stop-hook telemetry append. Tier 3 = `/consolidate-memory` skill + `/monthly-insights` self-improvement section. Also follow-up: W02 regression FAILs honestly until `api/package.json` deploy script gets `-c wrangler.toml`.)
**Last Updated:** 2026-04-29 (DL-376 — COMPLETED; OneDrive approve-rename now uses `sourceDoc.issuer_name` (HTML with `<b>company</b>` tags) before `matched_doc_name` so `resolveOneDriveFilename` substitutes the `{issuer}` placeholder instead of stripping it as a template-title echo. Found via CPA-XXX audit — approved 867/106/T501 files were landing in OneDrive as bare `[H:hebrew] 867.pdf`/`[H:hebrew] 106.pdf`/`[H:hebrew].pdf` (collisions adding ` 1`, ` 2`). Fix at `api/src/routes/classifications.ts:1925-1934`. Worker version `5bcb78e9-ced4-4206-85a4-1a68367850cd`. Existing orphan files in OneDrive still need a backfill rename pass — TODO.)
**Last Updated:** 2026-04-29 (DL-374 — COMPLETED; live verification passed. AI-review open-in-new-tab uses fresh MS Graph `webUrl` from `/webhook/get-preview-url`; legacy `file_url` retained as synchronous fallback so the button is visible immediately and upgraded in place. Worker version `e6e72dee-b2f0-434d-ae7e-057a0b5fec1c`, Pages script.js?v=384 live on docs.moshe-atsits.com.)
**Last Updated:** 2026-04-29 (DL-375 — COMPLETED; "Download" (Hebrew) button restored on AI-review preview header. Root cause: DL-374 added `webUrl` to `$select` on `/me/drive/items/{id}` and `@microsoft.graph.downloadUrl` (instance annotation) gets silently omitted under `$select`. Fix: drop `$select` entirely in `api/src/routes/preview.ts:62`. No frontend change. Worker version `a642bf5d-1480-4872-8632-cf680e9960dd`; live verified — `downloadUrl` returns 1196 chars; user confirmed button visible.)
**Last Updated:** 2026-04-29 (DL-374 — IMPLEMENTED, NEED TESTING; AI-review "open in new tab" anchor now uses fresh MS Graph `webUrl` from `/webhook/get-preview-url` instead of stale Airtable `file_url`. Worker `$select`s webUrl alongside downloadUrl — zero extra MS Graph calls. Cache-bust `script.js?v=382→383`. DL-356 self-heal still fires on permanent 404.)
**Last Updated:** 2026-04-29 (DL-377 — IMPLEMENTED, NEED TESTING; layered PII/secret defense — harness deny rules for `--no-verify`/`--force`, new CI workflow `pii-guard.yml` with diff-range PII guard + gitleaks, pre-commit secret scanners wrapped in `timeout 30`, PII regex extended with itemId/recId/client-email patterns)
**Last Updated:** 2026-04-28 (DL-370 — COMPLETED; all three edge cases verified live: zero-missing-docs, no-AI-match, and already-Received-slot all land classification as `pending` under target; source-clear skips if doc already Required_Missing; script.js?v=377 deployed)
**Last Updated:** 2026-04-28 (DL-370 — IMPLEMENTED, NEED TESTING; move-classification-client edge cases now land classification as `pending` on target (not `reassigned`); target-doc-Received conflict no longer 409s — file uploads, existing doc untouched, conflict toast shown; cache-bust `script.js?v=373`)
**Last Updated:** 2026-04-28 (DL-371 — COMPLETED; edit-client modal full redesign live: new header, name field, icons, full-width inputs, modal closes on save; two post-deploy bugs fixed: missing `buildClientDetailChanges` fn + modal not closing; verified by user)
**Last Updated:** 2026-04-28 (DL-368 — GitHub App reinstall did NOT fix it; `source.config.repo_id` still stale; CF support ticket required to rebind project to new repo id)
**Last Updated:** 2026-04-28 (DL-372 — REVERTED; sticky-note feature removed from frontend + Worker at user's request; DL-373 password unlock remains live — Worker `/webhook/unlock-pdf` deployed, `tryDetectEncryption` detection active in script.js?v=382, `putBinaryReplace` helper kept for DL-373)
**Last Updated:** 2026-04-28 (DL-369 — IMPLEMENTED, NEED TESTING; AI Review overflow menu adds "[H:hebrew]..." and Worker endpoint `/webhook/move-classification-client` moves/reclassifies the current document to another client)
**Last Updated:** 2026-04-28 (Pages manual deploy guardrail — current Wrangler auth token can deploy Workers but fails Pages project auth with Cloudflare code 10000; before retrying `wrangler pages deploy`, verify `pages project list/get` succeeds with the same auth context, otherwise deploy frontend via Git push or fix token permissions)
**Last Updated:** 2026-04-28 (DL-368 domain cutover COMPLETE — `docs.moshe-atsits.com` removed from old Pages project and active on new Git-backed `annual-reports-client-portal-git`; Cloudflare API validation active; SSL shown enabled in dashboard; browser verified `https://docs.moshe-atsits.com/admin/#annual` works. Remaining: resolve repository access banner + prove next push deploys via `github:push`, then delete accidental direct-upload `annual-reports-client-portal-v2`)
**Last Updated:** 2026-04-28 (CORS hotfix deployed — `api/wrangler.toml` ALLOWED_ORIGIN now includes `https://annual-reports-client-portal-git.pages.dev`; Worker deployed version `ccf0acd8-abd8-4fc9-898f-4c214a9e5f5c`; browser hard-refresh/login test pending)
**Last Updated:** 2026-04-28 (DL-368 self-service replacement created — new Pages project `annual-reports-client-portal-git` is Git Provider=Yes, bound to current repo id `1222817442`, output dir `frontend`, deployed `origin/main` commit `8849912`; still needs test push to prove future `github:push` and custom domain migration from old project)
**Last Updated:** 2026-04-28 (DL-368 API patch attempt — public Pages PATCH accepts `source.config.repo_id` but ignores repo-id rebinding on existing Git-bound project; two PATCH attempts returned success/no errors yet persisted stale `1136319991`; prevention: always verify returned `source.config.repo_id` immediately, then use new Pages project/domain migration or CF support)
**Last Updated:** 2026-04-28 (DL-368 verification — dashboard repo chip/latest PR text still misleading; CF API shows latest deploy `21c1488` is `deployment_trigger.type=ad_hoc`, `commit_dirty=false`, and project `source.config.repo_id` remains stale `1136319991`)
**Last Updated:** 2026-04-28 (Pages Git investigation guardrail — when downloading Pages config from `tmp/`, use absolute Wrangler path `C:\Users\liozm\Desktop\moshe\annual-reports\api\node_modules\.bin\wrangler.cmd` to avoid relative-path/overwrite retries)
**Last Updated:** 2026-04-28 (Bright Data MCP registered via SSE — connected; server-name prefix is `brightdata`)
**Last Updated:** 2026-04-28 (DL-366 — IMPLEMENTED, NEED TESTING; dashboard kebab adds two new actions: add/edit cc_email + auto-resend, and copy questionnaire link to clipboard)
**Last Updated:** 2026-04-28 (DL-365 Phase 1 COMPLETE — smoke test passed, CF Logs verified, Logpush active; Phases 2-4 queued)

---

## OPEN: DL-368 — CF Pages git auto-deploy broken (needs CF support ticket)

Pages project `annual-reports-client-portal-git` (`docs.moshe-atsits.com`) does not auto-build from `main` pushes. Root cause: `source.config.repo_id` stale after repo delete+recreate.

**Workaround:** run `bash scripts/deploy-pages.sh "manual deploy"` from canonical clone after every frontend push.

**USER ACTION required:**
- [ ] Open CF support ticket: CF Dash → Pages → Settings → "contact support". Paste: *"Pages project `annual-reports-client-portal-git` (account `ae0f0a190f9375f27d6043111996b1ef`) has stale `source.config.repo_id`. Pushes to `main` produce no `github:push` deploys. Please rebind to repo id `1222817442`."*
- [ ] After fix: verify `deployment_trigger.type=github:push` in `wrangler pages deployment list`.

Design log: `.agent/design-logs/infrastructure/368-cf-pages-git-integration-broken.md`

---

## OPEN: DL-376 — OneDrive orphan backfill rename

Existing files uploaded before the DL-376 fix (approved 867/106/T501 files) still have bare names like `[H:hebrew] 867.pdf` instead of issuer-substituted names. Needs a one-time backfill rename pass.

---

## OPEN: DL-365 — Activity Logger Phases 3-5

Design log: `.agent/design-logs/infrastructure/365-activity-logger.md`

**Phase 2 SHIPPED 2026-04-29** — verified live via auth + reassign + PII contract checks. Inbound queue-consumer log surface gap remains (consumer logs not visible in CF Observability — needs `[observability.logs]` config check or separate investigation).

**Phase 3** — admin viewer (`/admin/dev/activity` React island) + `frontend/shared/telemetry.js` + `DEV_PASSWORD`-gated lookup endpoints.

**Phase 4** — client portal page hooks + n8n workflow updates (replace 7 Airtable POSTs with `/webhook/events`).

**Phase 5** (2 weeks after Phase 4 lives) — flip `LEGACY_LOG_TO_AIRTABLE=false`, deactivate `[MONITOR] Security Alerts` + `[MONITOR] Log Cleanup`; mark `security_logs` deprecated.

Still need to set Worker secrets: `DEV_PASSWORD`, `PII_HASH_KEY` (`wrangler secret put` from `api/`).

---

## SHIPPED: Self-Improvement Tier 3 (2026-04-29)

- [x] `/consolidate-memory` skill — reads all memory files, surfaces duplicates/contradictions/stale (>90d unused), outputs proposal to `.agent/insights-audits/memory-consolidation-YYYY-MM-DD.md`.
- [x] `/monthly-insights` self-improvement section — regression pass-rate trend, top 5 rules that fired, top 5 rules never referenced in 30d, retry-trap fire count.

Plan: `~/.claude/plans/snoopy-conjuring-blossom.md`

---

## OPEN: W02 regression — wrangler deploy script missing `-c wrangler.toml`

`api/package.json` deploy script needs `-c wrangler.toml` flag so `check-regressions.sh` W02 case passes honestly.
