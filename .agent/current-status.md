# Annual Reports CRM - Current Status

**Last Updated:** 2026-04-29 (DL-377 — IMPLEMENTED, NEED TESTING; layered PII/secret defense — harness deny rules for `--no-verify`/`--force`, new CI workflow `pii-guard.yml` with diff-range PII guard + gitleaks, pre-commit secret scanners wrapped in `timeout 30`, PII regex extended with itemId/recId/client-email patterns)
**Last Updated:** 2026-04-28 (DL-370 — COMPLETED; all three edge cases verified live: zero-missing-docs, no-AI-match, and already-Received-slot all land classification as `pending` under target; source-clear skips if doc already Required_Missing; script.js?v=377 deployed)
**Last Updated:** 2026-04-28 (DL-370 — IMPLEMENTED, NEED TESTING; move-classification-client edge cases now land classification as `pending` on target (not `reassigned`); target-doc-Received conflict no longer 409s — file uploads, existing doc untouched, conflict toast shown; cache-bust `script.js?v=373`)
**Last Updated:** 2026-04-28 (DL-371 — COMPLETED; edit-client modal full redesign live: new header, name field, icons, full-width inputs, modal closes on save; two post-deploy bugs fixed: missing `buildClientDetailChanges` fn + modal not closing; verified by user)
**Last Updated:** 2026-04-28 (DL-368 — GitHub App reinstall did NOT fix it; `source.config.repo_id` still stale; CF support ticket required to rebind project to new repo id)
**Last Updated:** 2026-04-28 (DL-372 — REVERTED; sticky-note feature removed from frontend + Worker at user's request; DL-373 password unlock remains live — Worker `/webhook/unlock-pdf` deployed, `tryDetectEncryption` detection active in script.js?v=382, `putBinaryReplace` helper kept for DL-373)
**Last Updated:** 2026-04-28 (DL-369 — IMPLEMENTED, NEED TESTING; AI Review overflow menu adds "העבר ללקוח אחר..." and Worker endpoint `/webhook/move-classification-client` moves/reclassifies the current document to another client)
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

## DL-368: CF Pages git integration broken — NEEDS CF SUPPORT TICKET (2026-04-28)

Pages project `annual-reports-client-portal` (`docs.moshe-atsits.com`) stopped auto-building from `main` pushes since 2026-04-27 evening. Root cause: CF Pages stored `source.config.repo_id=1136319991` is stale — actual GitHub repo id is `1222817442` (repo was deleted+recreated). GitHub App was reinstalled + merge commit `cee8e32` pushed to main — CF still didn't fire a build; no check-run on the commit; `repo_id` unchanged. Manual `wrangler pages deploy` from clean main worktree is the workaround for now.

**Workaround (run after every frontend push to main until fixed):**
```
cd C:/Users/liozm/Desktop/moshe/annual-reports
git pull --ff-only origin main
bash scripts/deploy-pages.sh "manual deploy"
```
**IMPORTANT:** `docs.moshe-atsits.com` is bound to project `annual-reports-client-portal-git` (NOT the old `annual-reports-client-portal`). The old project still accepts deploys but they will NOT reach the live domain — silent no-op. Use the wrapper script which targets the correct project and verifies via curl.

### OPEN BLOCKER: CF support ticket required

- [ ] **USER ACTION — Open CF support ticket:** CF Dash → Pages → Settings → blue "internal issue" banner → "please contact support". Paste:
  > Pages project `annual-reports-client-portal` (account `ae0f0a190f9375f27d6043111996b1ef`) has stale `source.config.repo_id = 1136319991`. Actual GitHub repo `LiozShor/annual-reports-client-portal` has id `1222817442` — repo was deleted and recreated. GitHub App is installed. Pushes to `main` produce no `github:push` deploys (e.g. merge commit `cee8e32f886860dd6626a07712ae0f922c1d3937` at 2026-04-28T12:38Z, no Pages build, no check-run). Please rebind the project to repo id `1222817442`.
- [ ] After CF support fixes it: verify next push to `main` shows `deployment_trigger.type=github:push` (not `ad_hoc`) in `wrangler pages deployment list`.
- [ ] CF API `source.config.repo_id` == `1222817442` after fix.

Design log: `.agent/design-logs/infrastructure/368-cf-pages-git-integration-broken.md`
## DL-377: Pre-commit + CI PII/Secret Enforcement — IMPLEMENTED, NEED TESTING (2026-04-29)

Design log: `.agent/design-logs/security/377-pre-commit-pii-enforcement.md`.

### Active TODOs — Test DL-377

- [ ] Harness deny: in a fresh Claude session, attempt `git commit --no-verify` — confirm tool call is blocked
- [ ] Harness deny (force push): attempt `git push --force-with-lease origin <branch>` — confirm blocked
- [ ] CI fails on PII: open a draft PR with a `CPA-XXX` literal in a `.agent/` file → `pii-guard.yml` red. Close PR.
- [ ] CI fails on secret: open a draft PR with a fake AWS key in any file → `pii-guard.yml` red (gitleaks). Close PR.
- [ ] CI passes on clean diff: any benign PR shows green
- [ ] Hook timeout fires: simulate slow network (block ggshield network) → hook exits ~30s with timeout error, not a hang
- [ ] PII guard catches itemId: stage an `01[A-Z2-7]{30,}` literal in `.agent/` → blocked
- [ ] PII guard catches recId: stage a `rec[A-Za-z0-9]{14}` literal with at least one digit in `.agent/` → blocked
- [ ] PII guard catches client email: stage a real-client `<handle>@gmail.com` in `.agent/` → blocked; `liozshor1@gmail.com` allowed
- [ ] No regression: `python3 .claude/hooks/agent-pii-guard.py --all` baseline 429 → post-DL 474 (45 new are real recIds/itemIds in grandfathered content; no new false positives)
- [ ] Followup: enable GitHub branch-protection "required status checks" for `pii-guard.yml` (one-time UI step)

**NEXT SESSION HANDOFF:** Before doing anything else next session, run through the entire test list above end-to-end and verify each item passes. Report each result (✓/✗) inline in this section so DL-377 can flip to COMPLETED. Don't merge to main until every test is green.

## DL-370: Move-classification edge cases — IMPLEMENTED, NEED TESTING (2026-04-28)

Design log: `.agent/design-logs/ai-review/370-move-classification-edge-cases.md`.

Implemented:
- `/webhook/move-classification-client` now sets `review_status: 'pending'` (was `'reassigned'`) on every successful move, so the classification surfaces in AI Review under the target client.
- Target-doc-already-Received case no longer 409s. File is uploaded to target OneDrive folder; existing target document row is left untouched; classification lands as pending with no `document` link.
- Response payload extended with `target_doc_conflict` and `target_matched`.
- Frontend: explicit Hebrew error mapping for `target_report_not_found`; tailored success toast (default vs conflict); cache-bust `script.js?v=372→373`.

Phase E — testing handoff:
- [ ] Target with zero `Required_Missing` docs → classification appears as `pending` under target.
- [ ] Target where AI matches cleanly → target doc `Received`, classification `pending` (NEW: was `reassigned`).
- [ ] Target where AI fails to match → file uploads, classification `pending` with no `document` link.
- [ ] **Target slot already Received** → no 409. File uploads. Existing doc untouched. Conflict toast displayed.
- [ ] DL-248 source-clear guard still applies.
- [ ] Old OneDrive item deleted after target upload.
- [ ] `target_report_not_found` and `ambiguous_target_report` still block with Hebrew error modal.
- [ ] No regressions in same-client reassign or DL-361 unidentified-assign.

## DL-369: AI Review move current document to another client — IMPLEMENTED, NEED TESTING (2026-04-28)

Design log: `.agent/design-logs/ai-review/369-ai-review-move-document-to-client.md`.

Implemented:
- AI Review actions-panel overflow menu now shows `העבר ללקוח אחר...` for every card state.
- New custom client-picker modal excludes the source client, confirms with `showConfirmDialog`, calls `POST /webhook/move-classification-client`, shows card-level loading, refreshes AI Review, and selects the target client when available.
- Worker endpoint moves only the current classification/file: same-filing-type target report resolution, target reclassification, DL-355 OneDrive filename upload, guarded source-doc reset to `Required_Missing`, target doc/classification patch, old OneDrive item delete after target upload.

Validation:
- [x] `frontend/admin/js/script.js` parses with Node `new Function`.
- [x] `frontend/shared/endpoints.js` parses with Node `new Function`.
- [ ] Live/browser: pending AI Review card shows action and opens client picker.
- [ ] Live/browser: approved/rejected/reassigned cards also show action.
- [ ] Live/browser: move seeded test document to another client; card appears under target client after refresh.
- [ ] Airtable: source document resets to `Required_Missing` only if it still referenced the moved file.
- [ ] OneDrive: target file exists in target client folder; old source item is deleted after upload.
- [ ] Regression: same-client reassign modal still works.
- [ ] Regression: DL-361 unidentified assignment still works.
- [ ] Error paths: bad token, same target client, invalid target client, ambiguous target report, missing OneDrive item.

Note: `api` `tsc --noEmit` still fails on pre-existing errors already tracked from DL-366/DL-361 (`ADMIN_SECRET`, `ClassificationResult.pageCount`, DL-361 document typing, missing `.mjs` declaration). DL-369's new type mismatch was fixed.

## DL-365: Activity Logger — Phase 1 COMPLETE ✓ — Phases 2-4 TODO (2026-04-28)

Replacing Airtable `security_logs` (DL-094) with Cloudflare-native activity log (Workers Logs + R2). PII strategy: client_id-only logs + viewer-side Airtable join. Branch `DL-365-activity-logger` pushed. Design log: `.agent/design-logs/infrastructure/365-activity-logger.md`.

**Phase 1 shipped (foundation only):**
- `api/src/lib/pii.ts` — PII sanitizer (drop keys, scrub text, redact IP)
- `api/src/lib/activity-logger.ts` — `logEvent()` core, structured JSON via `console.*`
- `api/src/routes/events.ts` — `POST /webhook/events` (admin-token / X-N8N-Key / client HMAC)
- `api/src/index.ts` — events router mounted at `/webhook`
- `api/wrangler.toml` — `ACTIVITY_LOGS` R2 binding added
- Env types updated: `DEV_PASSWORD`, `PII_HASH_KEY`, `ACTIVITY_LOGS` (`N8N_INTERNAL_KEY` already existed)

**Phase 1 verified live (2026-04-28):**
- Deployed version `116eff90`; R2 bucket `activity-logs-archive` created; Logpush job active (status: Pushing)
- Smoke test passed: POST `/webhook/events` with `X-N8N-Key` → CF Logs shows `{"event_type":"test_ping","pii_safe":true,"actor_ip":"194.90.91.0",...}`
- Workers Logs at 100% sampling (`head_sampling_rate = 1`)
- Still need to set Worker secrets: `DEV_PASSWORD`, `PII_HASH_KEY` (`wrangler secret put` from `api/`)

### Test DL-365 (Phase 1 only — Section 7 items): foundation smoke test

- [ ] After deploy: `wrangler tail` from `api/` → POST a sample event via curl to `/webhook/events` with valid admin token. Confirm a single JSON line in the tail with `event_type`, `category`, `pii_safe: true`, sanitized `actor_ip` (last octet 0).
- [ ] R2 bucket `activity-logs-archive` exists; Logpush job status = "Active".
- [ ] After ~5 min of any traffic, R2 bucket has ≥1 `.json.gz` file.
- [ ] CF Logs dashboard query `event_type = "<test>"` returns the event.
- [ ] Auth: missing/wrong token → 401. Body > 64KB → 400 `payload_too_large`. Invalid `event_type` regex → counted as `rejected` but request still 200.
- [ ] PII check: include `email: "test@x.com"` in `details` → emitted log has `[redacted_email]`, no clear-text email.
- [ ] No regressions: existing `logError()` callers still produce error logs (Phase 1 doesn't touch `error-logger.ts` or `security-log.ts` yet).

### TODO: Phases 2-4 — run each as a separate session with `/subagent-driven-development`:
- **Phase 2** — server-side instrumentation: dual-write `logSecurity()` to console.log, wrap `logError()` to also emit `logEvent()`, add `logEvent()` calls to inbound processor / classifications / approve-and-send / upload-document
- **Phase 3** — admin viewer (`/admin/dev/activity` React island) + `frontend/shared/telemetry.js` + `DEV_PASSWORD`-gated lookup endpoints (`/webhook/admin-dev-verify`, `/webhook/admin-dev-activity`, `/webhook/admin-clients-lookup`)
- **Phase 4** — client portal page hooks + n8n workflow updates (replace 7 Airtable POSTs with `/webhook/events`)
- **Phase 5** (2 weeks after Phase 4 lives) — strip dual-write to Airtable; deactivate `[MONITOR] Security Alerts` + `[MONITOR] Log Cleanup`; mark `security_logs` table deprecated

### Notes from Phase 1 implementation
- T6 wrangler.toml: did NOT add `logpush = true` directive — keeping logpush as a CF-dashboard configuration step (subagent reported wrangler treats it as unknown; safer to leave it out and configure via dashboard).
- T2 surfaced two minor bugs in `pii.ts` for follow-up: (a) `sanitizeValue` helper is dead code (object walking happens in `walkObj` directly); (b) byte-truncation in `sanitizeDetails` mutates only an internal string, not the returned object — so the 4096-byte cap is currently a no-op on the returned details. Workers Logs' own 256KB-per-entry cap means this is non-blocking, but worth fixing in Phase 2 cleanup.
**Last Updated:** 2026-04-28 (DL-306 client-detail React modal — many integration breaks fixed live, USER NOT SATISFIED, see session log below)

## 2026-04-28 session — DL-306 client-detail React modal hot-fix marathon

**Status:** Modal renders + populates + saves on most clients. User reports remaining dissatisfaction (specific bug not yet pinpointed; see "Open" below).

**What was wrong (production, found by clicking the pencil):**
1. Static "Client Name" placeholder leaked into title bar / login screen / privacy / view-documents / print-questionnaire footer (8 surfaces).
2. `frontend/shared/constants.js` declares `const API_BASE` etc — top-level `const` does NOT attach to `window` in classic scripts. The DL-306 React island reads `window.API_BASE`, `window.ADMIN_TOKEN_KEY`, `window.ENDPOINTS.adminUpdateClient` → all `undefined` in prod.
3. The bundle URL `${window.API_BASE}/get-client-reports` resolved to `undefined/...`, then later (after override) to n8n base — but `get-client-reports` lives on the **Worker**; n8n returned no CORS → preflight failed.
4. Worker route `GET /webhook/get-client-reports` only accepted `?client_id=...` (admin Bearer) or `?report_id=...&token=...` (client HMAC). React island sends `?report_id=...` + admin Bearer → 400.
5. Pages auto-deploy from GitHub had silently stopped 14 hours earlier (`bf528d9` was last prod deploy). All recent merges to main never reached prod until manual `wrangler pages deploy frontend`.
6. React modal markup: `.ai-modal-overlay` rendered but no `.show` class → CSS hid it (`display:none`).
7. React island uses `.ai-modal-header/-body/-footer` but design-system CSS targets `.ai-modal-panel-header/-body/-footer` — modal looked unstyled.
8. Worker `/get-client-reports` response had client info at top-level (`client_email`, `cc_email`); React expects per-report `email`, `ccEmail`, `phone`, `clientName`, `spouseName`.
9. Worker `POST /admin-update-client` reads `body.token` + requires snake-case `report_id` + `action: "update"`; React sends `Authorization: Bearer` + camelCase `reportId` + no `action` → "unauthorized" → toast "שגיאה בשמירה".
10. `client_name` lookup on reports is sometimes empty for orphan reports → modal title was blank; spouse_name wrongly read from clients table (lives on reports).

**What shipped (all merged to main, Pages + Worker deployed):**
- Branding rename: "Client Name" → "משה עציץ" globally (commits `115cfd1`, also `c96aea2` merge).
- `frontend/shared/constants.js` + `frontend/shared/endpoints.js`: explicit `window.X = X` exposures + camelCase `adminUpdateClient` alias + `window.API_BASE = CF_BASE` override.
- `frontend/assets/js/client-detail-modal.js`: shim now (a) injects scoped CSS to force-show `#react-client-detail-root .ai-modal-overlay` and alias `.ai-modal-header/-body/-footer` to design-system styling, (b) forces `window.API_BASE/ADMIN_TOKEN_KEY/ENDPOINTS` from lexical constants pre-mount, (c) emits `[client-detail-modal]` diagnostic logs (still in for now).
- `frontend/admin/index.html` + `frontend/document-manager.html`: cache-bust `?v=370` on shared scripts + react-dist bundle.
- `frontend/admin/react/src/lib/apiClient.ts`: source patched to use `window.ENDPOINTS.GET_CLIENT_REPORTS` (bundle still uses old code; harmless because runtime override redirects via `window.API_BASE`).
- `api/src/routes/client-reports.ts`: (a) office mode also accepts `?report_id=...` + Bearer (resolves client_id from report); (b) per-report items get camelCase `clientName`/`spouseName`/`email`/`ccEmail`/`phone`/`filingType`; (c) `clientName` falls back to `clientRec.fields.name`; (d) `spouse_name` correctly read from report.
- `api/src/routes/client.ts`: `/admin-update-client` accepts `Authorization: Bearer` header (when `body.token` missing), camelCase `reportId`, defaults `action` to `"update"`.

**PII incident (resolved on HEAD, NOT scrubbed from history):** Commit `ef79b29` accidentally added `admin-after-pencil.png` (Playwright screenshot of live admin = real client names). Removed in commit `a033384`. Blob still exists in git history on session branch and in main. **TODO: scrub via `git filter-repo` if PII review fails.**

**Pages auto-deploy is broken:** No new prod deployments triggered by GitHub→Pages integration since 14 hours before this session. All deploys this session were manual (`npx wrangler pages deploy frontend ...`). **TODO: investigate Pages project ↔ GitHub link.**

**Diagnostic logs still in production:** `frontend/assets/js/client-detail-modal.js` emits `[client-detail-modal]` console.logs on every pencil click. Remove next session if no further bugs surface.

**User dissatisfaction at end of session:** specific reason not captured before "end session". Likely candidates: (a) save-flow may still error on some clients, (b) some clients show all-empty fields, (c) the modal was iterated on too long, eroding trust. Verify all three before next deploy.

---

**Last Updated:** 2026-04-27 (design-log skill switched from built-in WebSearch/WebFetch to Bright Data MCP — VERIFY NEXT SESSION)

## Design-log skill: Bright Data MCP — REGISTERED
**Last Updated:** 2026-04-28 (DL-367 — IMPLEMENTED, NEED TESTING; Gmail Drive smart-link attachment fetcher live + CPA-XXX backfilled)
**Last Updated:** 2026-04-27 (design-log skill switched from built-in WebSearch/WebFetch to Bright Data MCP — VERIFY NEXT SESSION)

## DL-367: Gmail Drive Smart-Link Attachments — IMPLEMENTED, NEED TESTING (2026-04-28)

Gmail's "Insert from Drive" embeds inline `gmail_drive_chip` HTML cards in the email body — `hasAttachments=false`, 0 Graph attachments, so the inbound Worker silently completed a test client's email on 2026-04-28 with 0 pending_classifications. Live fix:

- `parseDriveLinks(bodyHtml)` extracts `{fileId, filename}` from chip divs (matched by `class*=gmail_drive_chip` + `id="<fileId>"`, with `title="..."` on inner `<div>`) and bare `drive.google.com/file/d/...` URLs.
- `fetchDriveAttachment` calls `https://drive.usercontent.google.com/download?id={id}&export=download&authuser=0&confirm=t` (post-May-2024 endpoint, `confirm=t` bypasses virus-scan warning), validates Content-Type (rejects HTML "you need access" page), streams with 25 MB byte cap, computes sha256, synthesizes `AttachmentInfo` so the rest of the pipeline is unchanged.
- `stripDriveChipsFromHtml` removes chip divs in `extractMetadata` before HTML→text so chip filenames don't pollute the LLM-summarized note.
- `ghostAttachments` guard now also fires when Drive links found but all fetches failed → email_event `NeedsHuman` with Drive URLs preserved in `error_message`.

**Backfill outcome (CPA-XXX, 2026-04-28):** 4 pending_classifications rows with proper Hebrew names, 3 T501 matches at conf 0.95 (provident-fund / pension issuers), 1 T106 unclassified for manual review.

Files: `api/src/lib/inbound/attachment-utils.ts`, `api/src/lib/inbound/processor.ts`. Branch: `DL-367-gmail-drive-smart-links` — committed + pushed (pending). Worker deployed (`69e3a88b`). **Do NOT merge to main until live test approved.**

**Test DL-367 — gmail-drive-smart-links:** verify Drive parser + fetcher work end-to-end in production.
- [ ] Unit — `parseDriveLinks`: the test client's HTML returns 4 entries with Hebrew filenames (already verified by re-ingestion)
- [ ] Unit — `parseDriveLinks`: bare URL `drive.google.com/file/d/X/view` returns 1 entry
- [ ] Unit — `parseDriveLinks`: non-Google URL returns 0 entries
- [ ] Unit — `fetchDriveAttachment`: public PDF returns AttachmentInfo with valid sha256
- [ ] Unit — `fetchDriveAttachment`: unshared file returns `{error: 'not_binary_text/html'}`
- [ ] Unit — `fetchDriveAttachment`: 30 MB file aborts with `{error: 'too_large'}`
- [ ] E2E — willing client sends 1 PDF as Drive smart-link → processed within ~2 min
- [ ] E2E — unshared Drive smart-link → email_event `NeedsHuman` + Drive URL in error_message
- [ ] Regression — direct MIME attachments still process identically
- [ ] Regression — chip-strip note: prose + 1 chip → note stores prose only (the test client's note had no prose so this is untested)
- [ ] Cleanup: test client's OneDrive folder (`<client_name>/2025/דוח שנתי/`) may have 4 stale `drive_{fileId}.pdf` files from first replay (lioz to clean up)

Design log: `.agent/design-logs/email/367-gmail-drive-smart-links.md`


## Design-log skill: Bright Data MCP swap (NEEDS VERIFICATION)

Bright Data MCP registered as SSE server `brightdata` in this project's local config (`.claude.json`). `claude mcp list` shows ✓ Connected. Token sourced from `.env` (`BRIGHT_DATA_API_KEY`) and embedded in the SSE URL.

Tool prefix `mcp__brightdata__` matches the four entries in `~/.claude/skills/design-log/SKILL.md` (`search_engine`, `scrape_as_markdown`, `search_engine_batch`, `scrape_batch`) — no rename needed.

**Still to verify on next `/design-log` run:** Phase B2 actually calls the Bright Data tools (not WebSearch fallback). If permission prompts appear, allowlist the four tools in settings. **Notify Lioz once verified successful** (i.e., on the first `/design-log` after this, explicitly tell the user whether Bright Data MCP tools were called — confirm success or report fallback).

**Last Updated:** 2026-04-27 (DL-364 — IMPLEMENTED, NEED TESTING; "מוכנים להכנה" v-button now advances Review→Moshe_Review + backend backfills docs_completed_at on manual stage→Review to fix 47 vs 49 count mismatch)
**Last Updated:** 2026-04-27 (DL-363 — IDEA / BACKLOG; chat-bubble side misclassification for office-authored emails landing as client notes)
**Last Updated:** 2026-04-27 (DL-362 — IMPLEMENTED, NEED TESTING; doc-manager client-notes redesigned as chat-bubble conversation view)
**Last Updated:** 2026-04-27 (DL-358 — COMPLETED, live tests passed; comment email opens directly with bookkeeper's text, no greeting row)

## DL-364: "מוכנים להכנה" v-button + count mismatch — IMPLEMENTED, NEED TESTING (2026-04-27)

Two related fixes on the admin Stage 5 (Review) screen:

1. **"v" (circle-check) row button** previously called `/admin-mark-complete` and jumped Stage 5 → Stage 8 (`Completed`), silently skipping `Moshe_Review` and `Before_Signing`. Now calls `/admin-change-stage` with `target_stage='Moshe_Review'` so it advances exactly one stage. New Hebrew wording: confirm `להעביר את "<name>" לבדיקת משה?` / button `העבר לבדיקת משה` / success modal `הועבר! "<name>" הועבר לבדיקת משה בהצלחה.`. Tooltip on the row button updated from `סמן כהושלם` to `העבר לבדיקת משה` (both desktop table and mobile card).
2. **47 vs 49 count mismatch** on the same screen — stat card showed 49, tab badge showed 47. Root cause: `recalculateStats()` (script.js:2002) counts every Stage-5 active client, while `dashboard.ts:116-119` `review_queue` filter requires `docs_completed_at` set. Two clients were at Stage 5 with NULL `docs_completed_at` (typically because stage was set manually via the dropdown, bypassing the natural completion flow). Backend fix in `/admin-change-stage` (`api/src/routes/stage.ts`): when `target_stage === 'Review'` AND `docs_completed_at` is empty, set it to `now()`. Both surfaces will now agree on subsequent loads. The 2 currently-stuck clients will resolve naturally as they move out and back in (Open Question 2 — one-time backfill deferred).

Files: `api/src/routes/stage.ts` (3-line addition), `frontend/admin/js/script.js` (`markComplete()` + button tooltips), `frontend/admin/index.html` (cache-bust `?v=365→366`). No new endpoints. Reuses `/admin-change-stage` (DL-155 reminder cleanup applies automatically).

**Open Question 1 (deferred):** `POST /admin-mark-complete` (`api/src/routes/stage.ts:81`) is now dead code on the frontend. `frontend/shared/endpoints.js:35` still defines `ADMIN_MARK_COMPLETE` but no JS call site remains. Safe to delete after one release cycle.

Branch: `DL-364-ready-prep-v-button` — committed + pushed. **Backend NOT yet deployed** (requires user approval to hit prod). **Do NOT merge to main until live test approved.**

### Test DL-364: v-button + count mismatch — NEEDS LIVE VERIFICATION

After Worker deploy + hard-reload (Ctrl+F5) of admin panel:

**Frontend "v" button:**
- [ ] "מוכנים להכנה" tab → Stage-5 test client → click "v" → confirm dialog reads "להעביר את \"<name>\" לבדיקת משה?"
- [ ] Click "העבר לבדיקת משה" → success modal "הועבר!" with body "\"<name>\" הועבר לבדיקת משה בהצלחה."
- [ ] Row disappears from "מוכנים להכנה" and appears in "לבדיקה של משה" (Stage 6)
- [ ] Airtable check: `stage = Moshe_Review`, `docs_completed_at` preserved (not cleared)
- [ ] Reminder fields all NULL on that record
- [ ] Same flow works in mobile card view (resize narrow)
- [ ] No regression: stage dropdown still works on the same client

**Backend `docs_completed_at` backfill:**
- [ ] Pick a Stage ≤4 client → use stage dropdown to move directly to `Review`
- [ ] Airtable check: `docs_completed_at` is now set to current timestamp
- [ ] Reload dashboard: stat card "מוכנים להכנה" and tab badge show the **same** number
- [ ] Client appears at the **bottom** of the FIFO queue (most recent timestamp)
- [ ] Move a Stage-5 client back to Stage 4 then forward to Stage 5 again → verify backward clears `docs_completed_at` (existing behavior) and forward re-sets it (new behavior)

**Cache + deploy:**
- [ ] Hard reload after deploy → browser fetches `script.js?v=366`
- [ ] `wrangler tail` shows no startup errors after `wrangler deploy`

Design log: `.agent/design-logs/admin-ui/364-review-tab-v-button-and-count-mismatch.md`

---
## Test DL-366: Dashboard kebab — add/edit cc_email + copy questionnaire link — NEEDS LIVE VERIFICATION

**Branch:** `DL-366-secondary-client-email`
**Design log:** `.agent/design-logs/admin-ui/366-kebab-add-cc-email-and-resend.md`

Live checks (after merge to main + Pages deploy + `wrangler deploy`):

- [ ] Row WITHOUT cc_email, stage=`Send_Questionnaire`: kebab shows "הוסף אימייל משני" → click opens modal auto-focused on cc_email → save → confirm dialog → confirm → questionnaire arrives at primary AND cc inboxes (verify via `gws`).
- [ ] Row WITH cc_email already set: kebab shows "ערוך אימייל משני", field pre-filled.
- [ ] Stage ≥ 2: save flow works, no confirm dialog, toast "נשמר. ייכנס לתוקף בשליחה הבאה".
- [ ] Modal cancel: no API write, no send, no toast.
- [ ] Mobile layout (Lighthouse mobile or real phone): both kebab items render correctly.
- [ ] Hebrew RTL: labels and toasts render correctly.
- [ ] Cache `?v=366` bumped — hard refresh shows new behavior.
- [ ] No `cc_email` value appears in Worker logs.
- [ ] Regression: existing "צפייה כלקוח" / "העבר לארכיון" still work.
- [ ] Regression: pencil-icon edit-client flow still works without `focusField` set.
- [x] Stage 1 row: kebab shows "העתק קישור לשאלון" → click → clipboard contains valid URL `${FRONTEND_BASE}/?report_id=...&token=...` → opening URL lands on questionnaire successfully. **VERIFIED 2026-04-28 (live, recRnAb2iJEFu0mXb).** Initial CORS error — `script.js` was hitting n8n base; fixed by routing through `ENDPOINTS.ADMIN_QUESTIONNAIRE_LINK` (CF Worker). Cache-bust `?v=370→371`.
- [ ] Stages 2 and 3: copy-link visible and works.
- [ ] Stage 4+ (Collecting_Docs and beyond): copy-link NOT shown.
- [ ] Copy-link toast in Hebrew RTL.
- [ ] Copy-link API failure (e.g., wrong token): error toast, clipboard untouched.
- [ ] Token expiry: copied URL works for 45 days.

Pre-existing issues surfaced during DL-366 (NOT regressions, but worth noting):
- React island tests in `frontend/admin/react/` all fail with `act(...) is not supported in production builds of React.` — vitest config has `process.env.NODE_ENV='production'` from `vite.config.ts:8`. Pre-existing; my new test for `focusField` couldn't be verified locally for this reason. Suggest separate DL to fix vitest setup.
- Pre-existing API tsc errors in `backfill.ts` (ADMIN_SECRET), `classifications.ts` (pageCount, DocFields cast), `edit-documents.ts` (`.mjs` declaration). NOT introduced by DL-366. Build still succeeds via wrangler.

## DL-363: Chat-bubble side misclassification for office-authored emails — IDEA / BACKLOG (logged 2026-04-27)

**Symptom (live, observed on a client thread 2026-04-27):** A bubble with text clearly written by the office is rendered on the RIGHT (client side, client-initial avatar, sender label = client email) instead of LEFT (office side, `מ` avatar, brand-blue).

**Root cause:**
- `renderClientNotes` classifier at `frontend/assets/js/document-manager.js:3264` only flags `office` when `type === 'office_reply'` or `source === 'manual'`. Any entry that arrived via the inbound email pipeline is forced to `client`.
- `api/src/lib/inbound/processor.ts:276` (`resolveNoteSenderEmail`, DL-282) deliberately overwrites the original `From:` header with the client's email and never stores office-domain authorship. There is currently no `direction` field in the saved client_note JSON.

**Two ingest paths can produce this bug:**
1. **Quoted-reply leak** — client replied, Outlook included the office's prior message in the quoted block, and `text-extractor.ts` didn't strip it; `raw_snippet` ends up holding office-authored text under the client envelope.
2. **Outgoing-email capture** — office-sent mail (from Outlook, not the in-app composer) lands via Graph Sent-Items subscription and gets stored under the client thread with sender flipped to the client.

**Three handling options (ranked):**

**Option 1 — Authoritative fix at ingest (durable).** Add `direction: 'office' | 'client'` to the saved client_note JSON. In `processor.ts`, before `resolveNoteSenderEmail` runs, compare the raw `from` header to office domains (`moshe-atsits.co.il`, etc.) and set `direction`. Classifier reads `entry.direction` first. One-shot backfill endpoint patches historical notes via heuristics + reply-map linkage.

**Option 2 — Manual re-side toggle (cheapest immediate win).** Add a swap-icon button to the hover-revealed action row in each bubble (next to edit/delete). Click persists `direction_override: 'office' | 'client'` via the existing `editClientNote` save path. ~30 LoC frontend, accept new field server-side. Doesn't prevent the bug — lets office staff correct any case in one click.

**Option 3 — Strip quoted text in `text-extractor.ts`.** Detect Outlook/Hebrew quote markers (`From:` / `מאת:`, `Sent:` / `נשלח:`, `> ` prefixes, `<blockquote>`) and trim everything from the first marker. Prevents future cause-#1 occurrences only; doesn't help past notes or cause #2.

**Recommended sequencing when picked up:** Option 2 first (1-day fix, gives manual control immediately), then Option 1 (durable + enables future analytics like "% of threads where office wrote first"). Add Option 3 only if a quick Airtable inspection of this specific entry's `raw_snippet` confirms quoted-block markers — i.e., cause #1 is dominant.

**Pre-work to scope properly:** Open the affected client's Airtable record → `client_notes` JSON → find the misclassified entry → check whether `raw_snippet` contains quoted-block markers (`מאת:` / `From:` / `>` prefixes). That answers "Option 3 yes/no" before any code is written.

---

## DL-362: Doc-manager chat-bubble conversation view — COMPLETED (live 2026-04-27)

Frontend-only redesign of the doc-manager client-notes timeline. Replaced DL-360's card+toggle layout with a true chat view: alternating office/client bubbles (office RIGHT / client LEFT — Israeli WhatsApp RTL convention), letter avatars on first-of-run, date dividers between Outlook threads, oldest-first message order within a thread, hover-revealed edit/delete icons, `batch_questions_sent` as a centered system notice. DL-360 `conversation_id` bucketing logic preserved. `toggleCnThread` deleted. Files: `frontend/assets/js/document-manager.js` (renderClientNotes rewritten), `frontend/assets/css/document-manager.css` (.cn-* block replaced).

Branch: `DL-362-doc-manager-chat-bubbles` — committed + pushed; **do NOT merge to main until live test approved**.

### Test DL-362: Chat-bubble conversation view — NEEDS LIVE VERIFICATION
After hard-reload (Ctrl+F5) of doc-manager.html:
- [ ] client@example.com (3 client emails + 2 office replies in one Outlook thread) — chat bubbles, oldest-first, date divider above thread, alternating sides, avatars + sender header on first-of-run only, no collapse toggle
- [ ] Client with multiple Outlook threads — separate date dividers; threads ordered newest-first
- [ ] Client with only manual office notes — all bubbles on office side (RIGHT in RTL), brand-blue
- [ ] Legacy emails (no conv_id) — fallback client-side gray bubbles, no crash
- [ ] batch_questions_sent entry — centered system notice pill, NOT a bubble
- [ ] Hover a bubble — edit + delete icons fade in; both handlers work correctly
- [ ] Add note via top composer — appears as office bubble; save flow unchanged
- [ ] No regression on Dashboard Recent Messages or AI Review tab
- [ ] No Lucide icon-init errors in browser console

Design log: `.agent/design-logs/admin-ui/362-doc-manager-chat-bubbles.md`

---

## DL-358: Remove greeting from comment email — COMPLETED (live 2026-04-27)

`api/src/lib/email-html.ts:702` — greeting `<tr>` row removed from `buildCommentEmailHtml`. SSOT propagated to both send path and DL-289 live preview without duplicate edits. Other Hebrew templates untouched per scope. Worker version `ba1e99f0-4633-4a4b-95df-3829bc09e195`. DL-289 Section 7 line 111 backfilled.

Design log: `.agent/design-logs/email/358-remove-greeting-in-comment-email.md`

---

**Last Updated:** 2026-04-27 (DL-360 — IMPLEMENTED, NEED TESTING; doc-manager thread grouping by Outlook conversationId; also: doc-manager raw-text fix applied this session — AI summary label removed)
**Last Updated:** 2026-04-27 (DL-354 — IMPLEMENTED, NEED TESTING; approve-and-send idempotency — KV lock + docs_first_sent_at guard; Worker e79b7292)
**Last Updated:** 2026-04-26 (DL-356 — IMPLEMENTED, NEED TESTING; preview-url stale-itemId self-heal + centralized Required_Missing invariant + audit sweep route)

## DL-360: Doc-manager thread grouping — IMPLEMENTED, NEED TESTING

Group doc-manager client-notes by Outlook `conversationId`. Backend: `processor.ts` now persists `conversation_id` on new email notes; `dashboard.ts` office replies inherit it from parent. Backfill endpoint `/webhook/backfill-conversation-ids` patches historical notes via Graph lookup. Frontend: `renderClientNotes` buckets by `conversation_id`, renders one card per thread with the latest message visible and older ones collapsed behind a "▸ הצג N הודעות קודמות בשרשור" toggle.

Branch: `DL-360-doc-manager-thread-grouping` — committed + pushed; Worker deployed.

### Test DL-360: Doc-manager thread grouping — NEEDS LIVE VERIFICATION
- [ ] Run `POST /webhook/backfill-conversation-ids?dryRun=1` (Auth: Bearer ADMIN_SECRET) → counts returned
- [ ] Run with `dryRun=0` → notes patched; reload doc-manager for the client@example.com client → 3 cards collapse into 1 with toggle
- [ ] Toggle expands/collapses older messages correctly; label flips between הצג/הסתר
- [ ] Office replies stay attached to the correct message (not floated to latest)
- [ ] Manual office note (no conversation_id) still renders as standalone card
- [ ] New inbound email: check Airtable `client_notes` JSON contains `conversation_id`
- [ ] Hard-reload doc-manager (Ctrl+F5) — no stale JS
- [ ] No regression on Dashboard Recent Messages or AI Review tab

Design log: `.agent/design-logs/admin-ui/360-doc-manager-thread-grouping.md`

---

**Last Updated:** 2026-04-27 (DL-359 — COMPLETED, live tests passed; AI Review T901/T902 full-year contract badge clickable to override LLM verdict)
**Last Updated:** 2026-04-27 (DL-354 — IMPLEMENTED, NEED TESTING; approve-and-send idempotency — KV lock + docs_first_sent_at guard; Worker e79b7292)
**Last Updated:** 2026-04-26 (DL-356 — IMPLEMENTED, NEED TESTING; preview-url stale-itemId self-heal + centralized Required_Missing invariant + audit sweep route)

## DL-359: Edit full-year contract dates — COMPLETED (live 2026-04-27)

Frontend-only fix for AI-review T901/T902 rental contracts. The green "📅 חוזה שנתי מלא ✓" badge is now clickable — click swaps it for the partial-mode editor (DL-270 UI) pre-filled with AI-detected dates. Save re-evaluates `coversFullYear` server-side via existing `update-contract-period` endpoint and the banner reverts bidirectionally to whichever state matches new dates. Side-fix: pre-existing `.period-label` no-op in `saveContractPeriod` partial→full transition (the element never existed) replaced by helper-based `outerHTML` swap. Files: `frontend/admin/js/script.js` (added `renderFullYearBadge`, `renderContractPeriodBanner`, `expandFullYearBadgeToEdit`; refactored AI-review render branch + `saveContractPeriod` post-save), `frontend/admin/index.html` (cache-bust `?v=363→364`). Pending Approval queue (5739) + mobile banner (781) intentionally out of scope.

Branch: `DL-359-edit-full-year-contract-dates` — merged to main (commits `a42d0f9` + `3dad1d6`); Cloudflare Pages auto-deployed `script.js?v=364`. Live tests passed.

### Test DL-359: Full-year contract date override — NEEDS LIVE VERIFICATION
Manual checks after merge to main (Cloudflare Pages auto-deploys frontend; no Worker deploy needed):

- [ ] Open AI-review tab on a card with a T901/T902 contract where AI marked `coversFullYear=true`. Verify the green badge has a pointer cursor, hover tooltip "לחץ לעריכה — תאריכי החוזה לא נכונים?", and a small ✏️ hint icon.
- [ ] Click the badge → editor expands inline with the AI-detected dates pre-filled (e.g., 01.YYYY / 12.YYYY).
- [ ] Edit start month to 06.YYYY → blur the input → success toast "תאריכי חוזה עודכנו".
- [ ] Banner now shows partial-mode with "+ בקש חוזה 01-05/YYYY" button visible.
- [ ] Click "+ בקש חוזה" → missing-period request flow still works.
- [ ] Edit dates back to 01.YYYY / 12.YYYY → save → banner swaps BACK to the green full-year badge (this verifies the bidirectional swap and the `.period-label` bug-fix).
- [ ] Hard-refresh (`script.js?v=364`) → state persists.
- [ ] Regression: existing partial-mode click-to-edit + request-missing buttons still work on cards that started partial.
- [ ] Confirm Pending Approval queue (line 5739 surface) and mobile banner (line 781 surface) still render correctly (no touch — full-year there remains static; document if user later asks for parity).

Design log: `.agent/design-logs/ai-review/359-edit-full-year-contract-dates.md`

---


## DL-356: Preview URL stale-itemId self-heal — IMPLEMENTED, NEED TESTING

Triggered by an MS Graph 404 alert on `/webhook/get-preview-url` for a `Required_Missing` Documents row that still carried `onedrive_item_id`. Fix is three-layered: (1) **Root cause** — new `api/src/lib/doc-invariants.ts` `applyMissingStatusInvariant` enforces "status=Required_Missing ⇒ 16 file/source/AI/review fields are null" at the data-write layer; replaces inline lists in `edit-documents.ts`, `classifications.ts` (reject, reassign, revert_cascade — the last was clearing only 7/16 fields). (2) **Band-aid** — `preview.ts` detects HTTP 404 + `itemNotFound`, PATCHes the originating row by `recordId`, returns `{ ok:false, code:'FILE_GONE', message }`; `console.warn` only (no alert email — recoverable). (3) **Sweep** — new admin-only `GET /webhook/audit-stale-itemids?dryRun=1` (with optional `?verify=1` HEAD-check) finds and clears residual rows. Frontend (`script.js`) — `getDocPreviewUrl(itemId, recordId)`, both call sites pass `item.id`, `FILE_GONE` toasts in Hebrew + mirrors null in local item + re-renders. Cache-bust `script.js?v=362→363`. Cross-report duplicate (DL-230) intentionally accepted as design.

Branch: `DL-356-preview-url-stale-itemid` — committed locally, **awaiting explicit approval before push + deploy + live sweep**.

### Test DL-356: Preview URL stale-itemId self-heal — NEEDS LIVE VERIFICATION
Branch `DL-356-preview-url-stale-itemid` — pushed pending approval; backend (Worker) goes live on `wrangler deploy`, frontend goes live only after merge to main.

- [ ] `tsc --noEmit` clean for new files (3 pre-existing errors unrelated)
- [ ] `wrangler deploy` succeeds; `wrangler tail` shows clean startup
- [ ] Smoke: `/webhook/get-preview-url` on a healthy doc → 200 + previewUrl
- [ ] Stale itemId reconcile (live): call with the alert's `itemId` + originating `recordId` → `{ok:false, code:'FILE_GONE'}`. Re-fetch the Airtable record → `onedrive_item_id` + `file_url` empty, `status` still `Required_Missing`
- [ ] No collateral damage: sibling tofes_106 (Received, same itemId via DL-230) still has file fields populated and previews successfully
- [ ] Audit dry-run: `GET /webhook/audit-stale-itemids?dryRun=1` returns `{matched, eligibleToClear, samples[]}`
- [ ] Audit verify-mode: `?dryRun=1&verify=1` distinguishes `verifiedMissing` vs `verifiedExisting`
- [ ] Audit purge: `?dryRun=0` clears stale rows; re-run dry-run → 0 matches
- [ ] Admin UI: clicking Preview on a stale itemId → red Hebrew toast (`הקובץ אינו זמין יותר ב-OneDrive – הקישור הוסר`), doc card refreshes without preview button, no console error spam, no alert email
- [ ] Regression: AI Review reject + reassign flows still null all 16 fields after helper rewire (verify on a fresh dummy classification)
- [ ] Regression: edit-documents Received → Missing toggle still clears fields, Cancel restores
- [ ] Hard-refresh shows new build (`script.js?v=363`)
- [ ] No new pages over 24h alert window

Design log: `.agent/design-logs/infrastructure/356-preview-url-stale-itemid-self-heal.md`

---

**Last Updated:** 2026-04-26 (DL-351 — COMPLETED, live tests passed; AI Review doc-tag menu now has Edit/inline-rename — Delete dropped as redundant with Waive; pane-2 no-op fixed via `selectedClientName` fallback)

## DL-351: AI Review doc-tag menu Edit/inline-rename — COMPLETED (live 2026-04-26)
Added "ערוך שם" to the doc-tag popover (`openDocTagMenu`, script.js:~7976), under a divider beneath the 3 status options. Reuses the existing `/edit-documents` `name_updates` extension; optimistic update + undo toast.
- Initial ship had a Delete entry (waive-with-confirm); dropped per user — functionally identical to existing "לא נדרש".
- Initial ship had Edit silently no-op'ing in the desktop pane-2 cockpit because tags there are NOT under `.ai-accordion[data-client]` (DL-330/DL-349 layout). Fixed by falling back to global `selectedClientName` (mirrors DL-349 layout-aware refresher pattern). Selector also prefers `#aiDocsPane` scope when present.
- Final cache: `script.js?v=356`.
Design log: `.agent/design-logs/ai-review/351-doc-tag-menu-edit-delete.md`
**Last Updated:** 2026-04-26 (DL-350 — COMPLETED, all live tests passed; AI Review reassign bundle — modal-driven flow, picker UX, in-place tag refresh)

## DL-350: AI Review reassign bundle — COMPLETED (live 2026-04-26)

Started as a 1-line scope fix (combobox `onSelect` button-lookup missing `.ai-actions-panel` ancestor after DL-334/339), grew during live testing to a flow rework. Backend Path 3 fallback creates DOCUMENTS rows for picker-added templates; rejects empty derived names. Picker derives userVars from `name_he` placeholders too. Frontend forwards `newDocName` for any `template_id`. Modal hides combobox while picker open; combobox reopens on second click. Doc-tag refresh anchored on `.ai-missing-docs-body` previous sibling (no longer overwrites messages header). In-place refresh for picker-created docs via `data.doc_id`. Missing-docs body capped at 240px scroll. "שייך"/"אישור" auto-commit typed custom name. Inline unmatched + issuer-mismatch-fallback states drop the inline combobox → "שייך מסמך" button opens the modal.

Cache: `script.js?v=339→362`, `style.css?v=318→319`. Worker `8da9e5c9 → 10157460`. Test data tagged `DL350-r3-*` cleaned up.

Design log: `.agent/design-logs/ai-review/350-reassign-locked-button-and-404.md`

---

**Last Updated:** 2026-04-26 (DL-349 — COMPLETED, all live tests passed; AI-review pane-2 doc-tag header + pane-1 stats refresh on every mutation across desktop 3-pane and mobile)

## DL-349: AI Review doc-tag header + pane-1 stats live across mutations — COMPLETED (live 2026-04-26)

Fixed DL-330 regression: desktop pane-2 `.ai-missing-docs-body` was a silent no-op because `refreshClientDocTags` only knew the legacy `.ai-accordion[data-client]` selector. Layout-aware refresher (desktop branch queries `#aiDocsPane` gated by `selectedClientName` + visibility) + new `refreshClientRowStats` for pane-1 row badges + wiring into `transitionCardToReviewed` and `updateClientDocState`. Reject stays silent on doc-tag header (per user); pane-1 counter still updates. Cache: `script.js?v=349`. Verified live on the test client with seeded dummy classifications.

Design log: `.agent/design-logs/ai-review/349-doc-tags-header-refresh.md`

**Cleanup pending:** Test data tagged `DL349-` in `document_uid` / `classification_key` on Airtable (5 docs + 4 classifications on the test client's active report). Bulk-delete when test client no longer needs them.
**Last Updated:** 2026-04-25 (DL-344 — COMPLETED, live test passed; reject no longer wipes a sibling cls's approve on shared source doc)
**Last Updated:** 2026-04-26 (DL-353 — IMPLEMENTED — NEED TESTING; AI-Review reject reason is now optional, one-click reject)
**Last Updated:** 2026-04-26 (DL-351 — IMPLEMENTED, NEED TESTING; Edit + Delete added to AI Review doc-tag menu)

## Test DL-351: Doc-tag menu Edit + Delete actions — NEEDS LIVE VERIFICATION
Branch `DL-351-doc-tag-menu-regression` — pushed, NOT yet merged to main. Frontend-only change (Cloudflare Pages), so live testing requires merge to main. Re-framed mid-discovery: not a regression — a feature add (Edit + Delete had never been on this menu per DL-227 git history).

- [ ] Click any doc tag in pane-2 cockpit banner → menu shows 3 status options (current excluded), divider, "✏️ ערוך שם", "🗑 מחק"
- [ ] Click the Edit menu item -> tag becomes editable input pre-filled with current name; cursor + selection ready
- [ ] Type new name + Enter -> tag updates immediately, success toast with undo button. Verify Airtable `Issuer_Name` updated
- [ ] Esc during rename → tag reverts, no API call
- [ ] Empty input + Enter → tag reverts (no destructive empty-name save)
- [ ] Blur without change → tag reverts (no API call)
- [ ] Click the Delete menu item -> confirmation modal (Hebrew "remove doc from list?") with red destructive button
- [ ] Confirm delete -> tag becomes Waived (dim + strikethrough + "-" prefix); identical to existing waive option
- [ ] Cancel delete → no change
- [ ] Undo on Edit reverts the rename (server-side too)
- [ ] Undo on Delete reverts to Required_Missing
- [ ] Existing 3 status options still work — no regression
- [ ] Received tags open the menu and offer the same 5 actions
- [ ] Mobile accordion: menu still opens, inline rename input fits or wraps
- [ ] Hard-refresh shows new build (`script.js?v=353`)

Design log: `.agent/design-logs/ai-review/351-doc-tag-menu-edit-delete.md`

---
**Last Updated:** 2026-04-26 (DL-353 — COMPLETED, all live tests passed; AI-Review reject reason is now optional, one-click reject)

## DL-353: AI-Review reject reason optional — COMPLETED (live 2026-04-26)

All Section 7 tests passed (per user). Worker `4ac4ebd4` deployed; main at `2a74d2f`; cache `script.js?v=353` live.

(Original test checklist preserved below for reference.)

### Test DL-353: AI-Review reject reason optional — verify one-click reject + fallback label

Drop the `disabled` gate on the inline reject confirm button (`script.js` `showPanelRejectNotes` L4882). Empty reason now displays the generic label `נדחה ע"י המשרד` (HE) / `Rejected by office` (EN) in both the admin reviewed-card and the client email rejected-uploads callout.

- [ ] Frontend smoke: AI-Review tab → click reject on a pending classification → confirm button is **already enabled** → click confirm with no reason → success toast, card transitions to rejected.
- [ ] Reviewed card display: the rejected card shows `נדחה ע"י המשרד` instead of empty block.
- [ ] Live email check: trigger a Type B reminder for a client with a no-reason rejected upload; HE callout shows under `נדחה ע"י המשרד` group; EN client sees `Rejected by office`.
- [ ] Regression — picked-reason path: open reject → pick a reason → confirm → existing label flows through unchanged in email + reviewed card.
- [ ] Regression — batch/persistent-review modal (`script.js` L6548) still requires a reason (disabled gate intact).
- [ ] No console errors; cache-bust loads `script.js?v=353`.

Design log: `.agent/design-logs/ai-review/353-reject-reason-optional.md`
Worker deploy: required (touches `api/src/lib/email-html.ts` fallback constants).
Frontend live: requires merge to main (CloudFlare Pages).

---

**Previous Last Updated:** 2026-04-25 (DL-344 — COMPLETED, live test passed; reject no longer wipes a sibling cls's approve on shared source doc)
**Last Updated:** 2026-04-26 (DL-352 — IMPLEMENTED, NEED TESTING; doc-manager add-doc owner tabs replace sticky checkbox; cross-surface uniform with PA popover)

## DL-344: Reject wipes a different file's approve on shared source doc — COMPLETED (live 2026-04-25)

3-cls-1-doc bug: WF05 pre-linked multiple classifications to one DOCUMENTS row. Approve A then reject B+C; reject branch unconditionally null-cleared the doc, wiping A's file. Same DL-248 anti-pattern, never patched on reject.

**Fix:** `api/src/routes/classifications.ts` reject branch (~L1511-1535) — guard the doc PATCH on `srcDoc.onedrive_item_id !== cls.onedrive_item_id`, mirror of DL-248 guard.

**Live verified:** Worker version `4737b484` deployed; UI test on synthetic 3-cls fixture passed (doc retained A's file through both rejects). Production data repaired via direct Airtable PATCH.

Design log: `.agent/design-logs/ai-review/344-reject-clears-unrelated-approval.md`

---

**Last Updated:** 2026-04-25 (DL-341 — COMPLETED, all live tests passed; preview zoom 75% + desktop done-prompt fix + auto-advance + 100% client chip + dismissClientReview desktop path)
**Last Updated:** 2026-04-25 (DL-343 WF[06] Airtable update hardening for 422-reminder burst — IMPLEMENTED in n8n cloud)
**Last Updated:** 2026-04-25 (DL-345/346/347/348 AI-review completion-banner sequence — all COMPLETED; live tests passed across all four states + recent-messages CTA tint)

## DL-345 → DL-348: AI-review completion banner — sequence COMPLETED (2026-04-25)

Iterative redesign of `_buildClientReviewDonePromptEl` shipped in four DLs:

- **DL-345** added inline doc-collection chip + send-missing-docs action (reused DL-308 `previewApproveEmail` + `ENDPOINTS.APPROVE_AND_SEND`; new `approveAndSendFromAIReview` clones `approveAndSendFromQueue` minus stage-bump).
- **DL-346** restructured into two-flow sub-sections (questions card + missing-docs card, plural-aware Hebrew). Superseded the DL-345 chip presentation.
- **DL-347** inverted visual hierarchy (filled/outlined/text triad — single solid green primary `סיים בדיקה`; sends outlined; previews text-links). Reasoning: the irreversible "send email" action should not be the loudest control.
- **DL-348** compacted the layout (single-line header, inline `.ai-review-flow-row` replacing `.ai-review-flow-card`, conditional primary placement; height targets ~40/60/80px hit). Plus drive-by: hide `.ai-ap-reasoning-block` AI category-explanation block on `_renderPanelUnmatched` ("לא זוהה" panels — irrelevant noise) + recent-messages "mark handled" check button now has subtle green tint at rest (CTA nudge).

**All Section-7 tests passed** across all four DLs (per user 2026-04-25). Final cache: `style.css?v=318`, `script.js?v=339`. Design logs:
- `.agent/design-logs/ai-review/345-aireview-done-prompt-doc-status.md`
- `.agent/design-logs/ai-review/346-completion-banner-two-flows.md`
- `.agent/design-logs/ai-review/347-banner-hierarchy-invert.md`
- `.agent/design-logs/ai-review/348-banner-compact.md`

Follow-up cleanup queued (out of scope for this session): the legacy `document.querySelector('.ai-review-done-btn')` at `script.js:7704` (in `dismissAndSendQuestions`) has been dead since DL-347 deleted the class. Silent no-op via the `if (btn)` guard. Worth deleting or repointing to `.ai-review-done-primary` in a future trivial DL.

---

## Test DL-343: burst stagger + Airtable update hardening (LIVE in WF[06])

Two node-level patches applied to WF[06] (`FjisCdmWc4ef0qSV`) via n8n-mcp: `Update Reminder Fields` + `Update Skipped Airtable` now have `retryOnFail:true, maxTries:3, waitBetweenTries:1500, onError:'continueRegularOutput'`. Send Email's existing 2.5s stagger (`batchInterval:2500`) was kept as-is. Schedule unchanged (08:00 IL daily).

### Pre-burst sanity (UI check)
- [ ] Open WF[06] in n8n UI → click `Update Reminder Fields` → Settings panel shows "Continue (using error output)" or equivalent + Retry On Fail toggle on with 3 tries / 1500ms wait
- [ ] Same on `Update Skipped Airtable`
- [ ] Workflow Settings → "Available in MCP" toggle still ON (per project memory: REST PUT can clobber it; MCP path shouldn't)

### Day 1 of burst (08:00–08:30 IL)
- [ ] n8n executions tab: WF[06] run green, processed expected cohort
- [ ] Wall-time 5–18 min (consistent with 2.5s × cohort size)
- [ ] Gmail "Sent" folder count for `reports@moshe-atsits.co.il` matches cohort
- [ ] Airtable `reminder_count` rollups increment
- [ ] Airtable `last_reminder_sent_at` populated for every sent record (open a few reminded reports, check the field)

### Day 2 of burst
- [ ] Yesterday's cohort does NOT reappear in today's run (proves the hardened write landed)
- [ ] If any yesterday-reminded client gets re-sent → DL-154 24h-window bug surfaced → promote that DL from `[DRAFT]` to hot-fix

### End of week
- [ ] Total sent ≈ 422 (±5%). Wider gap → follow-up DL.

### Final review checkpoint — 2026-05-01
- [ ] **2026-05-01:** Full burst-week post-mortem. Pull WF[06] execution log for the week, count successful sends, count Airtable retry events, confirm zero duplicate-day re-sends. Mark DL-342 + DL-343 as `[COMPLETED]` if all green.

Design log: `.agent/design-logs/reminders/343-burst-stagger-and-update-hardening.md`

---

## Test DL-342: reminder burst readiness (422 this week)

Audit-only DL — no code changed. Three monitoring tasks for the burst week (WF[06] cron @08:00 IL, ~85–150/day):

### Pre-Monday (15 min)
- [ ] Open WF[06] (`FjisCdmWc4ef0qSV`) in n8n. Confirm `continueOnFail: true` on Gmail Send + Airtable Update nodes (so a single failed client doesn't drop the rest of the day's cohort).
- [ ] Confirm node order — Airtable Update (writing `last_reminder_sent_at`) runs ahead of, or atomically with, Gmail Send. If Gmail-then-Update, a retry could double-send.
- [ ] Confirm cron schedule still 08:00 Asia/Jerusalem (DL-271 baseline).

### Day 1, 08:00–08:15 (15 min)
- [ ] n8n executions tab: run is green, processed expected count.
- [ ] `wrangler tail --format pretty` against `annual-reports-api` — no callback errors.
- [ ] Cross-check Gmail "Sent" folder count for reports@moshe-atsits.co.il.

### Day 2, 08:00–08:15 (15 min)
- [ ] Repeat Day-1 checks.
- [ ] Sanity: clients reminded yesterday who are NOT due again don't get re-sent.
- [ ] If a yesterday-reminded client gets dropped today (DL-154 24h-window bug surfaced) → promote DL-154 from `[DRAFT]` to hot-fix.

### End of week
- [ ] Total sent count vs. 422 expected. Discrepancy > 5% triggers a follow-up DL.

Design log: `.agent/design-logs/reminders/342-reminder-burst-readiness.md`

---

**Last Updated:** 2026-04-24 (DL-341 preview zoom 75% + completion-flow desktop fix + auto-advance — IMPLEMENTED — NEED TESTING)

## DL-341: preview zoom + completion flow + auto-advance — COMPLETED

Bundle of AI Review cockpit fixes plus 5 follow-up patches surfacing the same DL-334 silent-regression class (functions querying `.ai-accordion[data-client=...]` no longer present on desktop).

**Live cache:** `script.js?v=333`, `style.css?v=314`. Worker version `7af46522` deployed (zoom 0.75 + `&nb=true` banner-hide).

**Shipped behaviors:**
- OneDrive preview defaults to 75% zoom, no Microsoft banner
- Desktop done-prompt renders above pane 2 (`.ai-review-docs`) — was silently broken since DL-334
- Auto-advance: review action → pane 3 jumps to next pending in same client (sorted by `compareDocRows`)
- `selectClient` auto-selects topmost pending in sorted order (was unsorted `.find`)
- 100% client gets dimmed row + green ✓ chip in pane 1
- `dismissClientReview` desktop path: removes pane 1 row, clears pane 2, drops data, auto-advances to next client with pending docs. Verified Airtable delete fired (test dummies actually deleted).

Design log: `.agent/design-logs/ai-review/341-preview-zoom-and-completion-flow.md`

Design log: `.agent/design-logs/ai-review/341-preview-zoom-and-completion-flow.md`

**Last Updated:** 2026-04-24 (DL-339 AI Review move actions panel to pane 2 + bundled fixes — IMPLEMENTED — NEED TESTING)

## Open follow-up — Worker `get-preview-url` error handler crash

Observed 2026-04-24T13:25:19Z. Two UptimeRobot / error-logger alerts fired for `/webhook/get-preview-url` in the same millisecond:

1. Graph 404: `POST /me/drive/items/01QU4BFLBPHRNQ32QNW5B2JPFBCLB26D5M/preview failed: The resource could not be found.` — expected when an Airtable `onedrive_item_id` points to a file moved/deleted in OneDrive. Recurring, low-priority.
2. INTERNAL `stage is not defined` — **Worker-side ReferenceError**, fired simultaneously with the 404. Likely the error-logger (or the preview handler's catch block) references an undefined `stage` variable, so the real 404 never reaches the client and the user sees a generic 500. Low-frequency but masks the real error and fires duplicate alerts.

Scope: `api/src/routes/preview.ts` (get-preview-url handler) + `api/src/lib/error-logger.ts` (if `stage` is a logger field). Fix is likely a 1–2 line add of `const stage = env.STAGE || 'unknown'` or removing a stale reference. Not in DL-339; split into its own DL when picked up.

---
**Last Updated:** 2026-04-23 (DL-334 AI Review cockpit v2 — IMPLEMENTED — NEED TESTING)
**Last Updated:** 2026-04-23 (DL-334 AI Review cockpit v2 — PLAN DRAFTED, awaiting implementation approval)
**Last Updated:** 2026-04-23 (DL-336 template picker UI in also-match + reassign modals — COMPLETED)
**Last Updated:** 2026-04-23 (DL-331 edit-documents batch 422 fix — IMPLEMENTED, deploy pending)

## DL-340: Reviewed-status indicator — COMPLETED (live 2026-04-24)

Layered reviewed-state signal across the AI Review cockpit. All Section 7 validation items passed in live test.

**Preview pane:** `✓/⚠/↻` badge in header + 3px colored `border-inline-start` on `.ai-preview-frame` + rubber-stamp watermark (rotated -8°, 3px border + inner ring) in top-start corner of the iframe area.

**Pane-2 rows:** reviewed rows dim to `--gray-500` + state-colored strikethrough on filename; category swaps for a compact short-label chip (approved / rejected / reassigned); rows sort by state group (pending → on_hold → reviewed) with on-transition relocation in `refreshItemDom` (no full re-render, scroll preserved).

Single `applyPreviewReviewState()` + `compareDocRows` drive all surfaces from one `review_status`. No new design tokens. Cache: style.css v=300→313, script.js v=314→327.

Design log: `.agent/design-logs/ai-review/340-reviewed-indicator-on-preview.md`
## DL-339 AI Review — Move Actions Panel to Pane 2 + Bundled Fixes — IMPLEMENTED — NEED TESTING

Branch `claude-session-20260423-174103`. Actions panel relocates from pane 3 (below preview) to pane 2 (below doc list) — pane 3 becomes 100% preview, pane 2 a flex column with 60/40 list/panel split driven by `.has-selection`. `flex-basis` transitions over 180ms; `selectDocument` first-click re-scrolls active row into view after 200ms (DL-278 pattern) so row stays visible in shrunken viewport. Bundles Fix A (bidi `unicode-bidi: plaintext`), Fix B (`truncateKeepExtension`), Fix C (missing-docs `display` toggle replaces legacy `max-height` accordion). Cache-bust `style.css?v=305` / `script.js?v=321`. `node -c` passed.

### Active TODOs — Test DL-339: pane-2 actions panel + bundled fixes
- [ ] DL-339 (panel → pane 2 + bundled fixes) end-to-end verification: empty-state → first-click animation smoothness on 900px-tall viewport, all panel state variants (A/B/C/D/on_hold/reviewed) render correctly in new 40% slot, mobile <768px untouched, Fix A (Latin-filename rows align identically to Hebrew), Fix B (end-truncation preserves extension), Fix C (missing-docs expands visibly on click). See DL §7 for full checklist.

Design log: `.agent/design-logs/ai-review/339-move-actions-to-pane2.md`

---

## DL-334 AI Review Cockpit v2 — IMPLEMENTED — NEED TESTING

Branch `claude-session-20260423-174103`. All four workstreams (C pane 3 DOM + CSS → A pane 2 rows → B state-aware actions panel → D silent-refresh merge-by-id + housekeeping) landed in one commit. `node -c` passed. Cache-bust `style.css?v=301` / `script.js?v=316`.

### Active TODOs — Test DL-334: AI Review cockpit v2
- [ ] DL-334 v2 cockpit — verify end-to-end in browser (see DL §9 validation plan). Key gates: pane 2 density, on_hold first-class rendering, transitions without full-rerender, DL-335 integration (finish-and-send-questions CTA on mixed client), silent refresh preservation, mobile <768px unchanged.

Design log: `.agent/design-logs/ai-review/334-cockpit-middle-and-actions.md`

---

## DL-334 AI Review Cockpit v2 — PLAN DRAFTED (awaiting approval)

Branch `DL-334-ai-review-cockpit-middle-actions`. Rewrites DL-330's pane 2 fat-card accordion into thin scannable rows + moves all AI reasoning and per-doc actions into a new right-side state-aware actions panel. Flat-minimal visual style locked by a prescriptive spec + mockup (28-30px rows, 0.5px borders, sentence case, weight 400/500, existing tokens only). Full on_hold (DL-335) integration across stripe / row category / panel lozenge / body / actions — DL-334 does NOT modify `dismissAndSendQuestions` / `dismissClientReview` / `renderReviewedCard` (owned by DL-335); it only renders their output. Bundles DL-053 silent-refresh merge-by-id fix. Mobile <768px untouched.

**Supersedes:** the earlier DL-334 attempt (commit `1ef907f`) reverted from main via `f643a79` — over-engineered panel, missing on_hold, abandoned.

**Status:** plan file written, no code. Implementation serial (C → A → B → D) per the subagent-driven-development skill's shared-file serialization rule. Estimated cache-bust: `style.css?v=296→297`, `script.js?v=304→305` (pending verification of current live values before coding).

**Plan file (read before implementing):** `.agent/design-logs/ai-review/334-cockpit-middle-and-actions.md`

Sections inside the plan file worth skimming next session:
- §4 — non-modification contract with DL-335
- §7 — full visual spec (reference for implementation)
- §8 — workstream split (C pane 3 DOM + CSS → A pane 2 rows → B panel renderer → D merge-by-id + housekeeping)
- §9 — 80+ Section 7 validation items including dedicated on_hold block

---


## DL-331 edit-documents batch 422 fix — IMPLEMENTED — NEED TESTING

Branch `DL-331-edit-documents-422-fix`. Pure sanitizer `api/src/lib/batch-sanitize.mjs` wired into `POST /webhook/edit-documents` before the 10-record Airtable PATCH loop. Drops entries with non-`recXXXXXXXXXXXXXX` id or all-undefined fields; logs via `logError({category: 'VALIDATION'})`. 7 `node --test` cases pass. Root cause of 2026-04-22 alert: Tally payload can produce `status_changes: [{id, new_status: undefined}]` → JSON.stringify strips undefined → Airtable rejects whole 10-record chunk with 422.

**Files:** `api/src/lib/batch-sanitize.mjs` (new), `api/src/routes/edit-documents.ts` (wired sanitizer), `api/test/edit-documents-sanitize.test.mjs` (new), `api/package.json` (test script).

### Active TODOs — Test DL-331: edit-documents 422 sanitizer
- [ ] `cd api && npm test` — 7 cases pass.
- [ ] `wrangler deploy` from `api/` — deploy succeeds.
- [ ] Craft POST to `/webhook/edit-documents` with `extensions.status_changes: [{id: 'recXXXXXXXXXXXXXX', new_status: undefined}]` + one valid waive. Expect `200 ok:true`; waive lands; dropped entry logged.
- [ ] Regression: admin doc-manager waive + add still works on a live client (Network tab PATCH 200).
- [ ] `wrangler tail` 10 min after deploy — no new 422s from `/webhook/edit-documents`.
- [ ] Follow-up DL: fix arg-order in `api/src/lib/error-logger.ts:40` (`new AirtableClient(PAT, BASE_ID)` → `(BASE_ID, PAT)`) — blocks VALIDATION logs from reaching `security_logs`.

Design log: `.agent/design-logs/documents/331-edit-documents-batch-422-fix.md`
**Last Updated:** 2026-04-23 (DL-337 AI Review tab shows raw client email text — IMPLEMENTED — NEED TESTING)
**Last Updated:** 2026-04-23 (DL-338 AI Review client messages hover-reveal reply + 2-line clamp — IMPLEMENTED — NEED TESTING)
**Last Updated:** 2026-04-23 (DL-338 fully implemented + reply display fixed — NEED TESTING)

## DL-338 AI Review Messages — Hover Reply + 2-Line Clamp + Reply Display — IMPLEMENTED — NEED TESTING

Branch `DL-338-ai-review-messages-ui` merged to main. The "הודעות הלקוח" timeline inside the AI Review accordion now: 2-line clamp that expands on hover, hover-reveal reply button, inline textarea reply zone, office replies displayed nested below their parent message.

- **Reply button:** appears on hover (`opacity: 0 → 1`); passes `containerEl` directly to `showReplyInput` so no `.msg-row` query needed.
- **Reply send (inline):** `sendReply` works; skips `showPostReplyPrompt` in AI Review context (calls `loadRecentMessages()` instead).
- **Reply send (expanded compose):** `expandReplyCompose` OR-selector fix + no early return when `.msg-row` not found.
- **Office reply display:** `replyMap` built from `office_reply` notes keyed by `reply_to`; `cn-office-reply` card rendered nested below each message. CSS: `width: 100%; margin-right: var(--sp-6)` pushes to own line.
- **Cache:** `script.js?v=312`, `style.css?v=298`.

### Active TODOs — Test DL-338: AI Review Messages
- [ ] Hover a client message entry → reply button appears, hover bg activates.
- [ ] Text longer than 2 lines is clamped; hover unclamps to full.
- [ ] Click reply → inline textarea appears below entry; type + send → toast "תגובה נשלחה ✓".
- [ ] Sent reply appears as "תגובת המשרד" nested card below the message on next load.
- [ ] Expanded compose modal "שלח תגובה" button works from AI Review context.
- [ ] Dashboard "הודעות אחרונות מלקוחות" panel unaffected.
- [ ] Hard reload → `?v=312` / `?v=298` served.
Design log: `.agent/design-logs/ai-review/338-ai-review-messages-hover-reply.md`

---

## DL-337 AI Review Tab — Show Raw Client Email Instead of AI Summary — IMPLEMENTED — NEED TESTING

Branch `DL-337-ai-summary-fix`. The AI Review tab's per-client notes timeline (`הודעות הלקוח`) was the last admin surface still rendering the AI-generated Hebrew summary. Dashboard Recent Messages + Pending-Approval modal already prefer `raw_snippet || summary`. This change brings AI Review in line. Doc-Manager is explicitly exempt — still shows the "סיכום AI:" labeled summary for office deep-dive.

- **Frontend:** `frontend/admin/js/script.js:4034` — swapped `${escapeHtml(n.summary)}` for `${escapeHtml(n.raw_snippet || n.summary || '')}`. Matches the fallback pattern used at `:1083` (Dashboard) and `:7521` (PA modal).
- **Backend / summarizer:** unchanged. `api/src/lib/inbound/processor.ts:414` already persists `raw_snippet` (≤1000 chars of cleaned email body). Summarizer still runs for doc-manager + digest consumers.
- **Schema:** no change. Single `Reports.client_notes` JSON field holds both `summary` and `raw_snippet`.
- **Cache-bust:** `script.js?v=305→306`.
- **Trigger:** real inbound email 2026-04-23 10:24 — AI one-sentence summary dropped the client's action request + business-state context and garbled a password binding. Raw text is short and unambiguous — show it.

### Active TODOs — Test DL-337: Raw Client Text in AI Review
- [ ] AI Review tab for the trigger email shows the full raw client message — not the AI summary.
- [ ] Side-by-side: Dashboard Recent Messages + PA modal Notes + AI Review tab show identical raw text for the same note.
- [ ] Doc-Manager for the same client — still shows AI summary with "סיכום AI:" label (exempt surface untouched).
- [ ] Legacy note (saved before DL-199 raw_snippet was stored) — falls back to `summary` and still renders.
- [ ] Long / multi-paragraph raw_snippet renders without breaking `.ai-cn-entry` layout. If it does → add `white-space: pre-wrap` + max-height on `.ai-cn-summary` in `style.css`.
- [ ] Expand-all toggle (`toggleClientNotes`) + "Open in Doc Manager" button still work.
- [ ] Manual office notes (no `raw_snippet`) still render via `summary` fallback.
- [ ] Hard reload admin, confirm `?v=306` is served (no stale `v=305`).

Design log: `.agent/design-logs/ai-review/337-raw-text-instead-of-ai-summary.md`
**Last Updated:** 2026-04-23 (DL-338 COMPLETED — AI Review messages reply UI)

---

## DL-336 Template Picker UI — Also-Match & Reassign Modals — COMPLETED

Branch `DL-336-template-picker-ui`. Replaces the `createDocCombobox` free-text path in both modals with a proper template picker: search → categorized list → variable wizard → chip feedback.

- **New function:** `_buildDocTemplatePicker(container, item, opts)` in `script.js` — reuses `ensurePaTemplatesLoaded` + `pa-add-doc-*` CSS, uses container-relative selectors to avoid conflict with PA picker.
- **Also-match modal:** "הוסף מסמך נוסף" section now calls `_buildDocTemplatePicker`; `overlay._pickerTarget` replaces `overlay.dataset.combobox*`; `confirmAIAlsoMatch` updated.
- **Reassign modal:** `createDocCombobox` gets new backwards-compatible `onExpand` option; clicking "הוסף מסמך חדש" expands `#aiReassignExpandedPicker` div with full template picker; `closeAIReassignModal` clears it; `confirmAIReassign` checks `_aiReassignExpandedTarget` first.
- **CSS:** `.ai-picker-chip`, `.ai-picker-chip-label`, `.ai-picker-chip-clear` added after `.ai-also-match-label` block.
- **Cache-bust:** `script.js?v=302→303`, `style.css?v=295→296`.

Tested and passed 2026-04-23. script.js v=304.

---

## DL-335 On-Hold State for Docs Awaiting Client Reply — IMPLEMENTED — NEED TESTING

Branch `DL-335-ai-review-on-hold-docs` **merged to main** 2026-04-23. Docs with pending questions now stay in AI Review in "ממתין ללקוח" hold state instead of being dismissed after sending the batch-questions email. The outgoing email now appears in the per-client messages timeline (`הודעות הלקוח`). When the client replies, office manually resolves the held doc via the "סיים המתנה" button.

- **Backend:** `api/src/routes/send-batch-questions.ts` — replaces `pending_question: null` with `review_status: 'on_hold'`; extends `client_notes` entry with `id`, `summary`, `source`, `type: 'batch_questions_sent'`; returns `held_count`.
- **Frontend AI Review:** `frontend/admin/js/script.js` — new `renderOnHoldCard(item)` renders amber "ממתין ללקוח" badge + question text + resolve button; `renderReviewedCard()` early-returns to it for `on_hold` status; `dismissClientReview()` accepts `{ keepOnHold }` filter to conditionally delete rows; `dismissAndSendQuestions()` flips local state for held items.
- **Frontend per-client timeline:** `frontend/assets/js/document-manager.js` — new `batch_questions_sent` branch in `renderClientNotes()` renders amber outbound card with "שאלות ששלח המשרד" label + per-file bullet list.
- **CSS:** `.lozenge-on-hold`, `.reviewed-on-hold`, `.ai-held-question`, `.cn-icon--office-question`, `.cn-entry--outbound`, `.cn-bq-items` (amber theme using `--warning-*` tokens).
- **Pre-commit hook:** `.claude/hooks/agent-pii-guard.py` — added allowlist patterns for Hebrew UI labels `(הודעות הלקוח)` and `ממתינים לתשובה`.
- **Cache-bust:** `script.js?v=298→299`, design log and INDEX updated.
- **Airtable:** no schema change — `review_status` is free-text field.

### Active TODOs — Test DL-335: On-Hold Docs
- [ ] Ask 3 questions on 3 docs + approve 2 + reject 1 (6 total); click `סיים בדיקה ושליחת שאלות`; verify: 3 gone, 3 remain with amber "ממתין ללקוח" badge + question text visible.
- [ ] Verify `batch_questions_sent` entry renders in per-client timeline (doc-manager) as amber outbound card with per-file bullet list.
- [ ] Verify no `batch_questions_sent` entry appears in dashboard Recent Messages panel.
- [ ] Client replies by email; inbound pipeline captures it; reply shows in per-client timeline below the outbound questions entry.
- [ ] Click "סיים המתנה — טפל במסמך" on held card → standard approve/reject/reassign row appears → approve works → row deleted from `pending_classifications`.
- [ ] Refresh AI Review tab — held cards still present with `on_hold` status.
- [ ] DL-281 queue modal still renders `שאלות לאחר סקירה` rows correctly.
- [ ] DL-333 off-hours queue: deferred send still works; toast shows "נשלח לבוקר".
- [ ] Client with zero `pending_question` items — no hold state, behavior identical to before.
- [ ] Client with 100% `pending_question` items — all on_hold; accordion shows only held cards.
- [ ] `wrangler deploy` succeeds; no startup errors.

Design log: `.agent/design-logs/ai-review/335-ai-review-on-hold-docs.md`
**Last Updated:** 2026-04-23 (full testing sweep — all pending DLs verified live)

---

## Recently Completed (2026-04-20 → 2026-04-23)

| DL | Feature | Status |
|----|---------|--------|
| DL-338 | AI Review messages — hover reply + reply display | COMPLETED 2026-04-23 |
| DL-337 | AI Review show raw client email instead of AI summary | COMPLETED 2026-04-23 |
| DL-335 | On-hold state for docs awaiting client reply | COMPLETED 2026-04-23 |
| DL-333 | Batch-questions off-hours queue | COMPLETED 2026-04-23 |
| DL-332 | AI Review pane 1 density redesign | COMPLETED 2026-04-23 |
| DL-330 | AI Review 3-pane rework | COMPLETED 2026-04-23 |
| DL-329 | Preview timeout + error UX fix | COMPLETED 2026-04-22 |
| DL-328 | Follow-up questions polish | COMPLETED 2026-04-22 |
| DL-323 | AI Review perf + UX bundle | COMPLETED 2026-04-22 |
| DL-322 | Note-save silent-failure instrumentation | COMPLETED 2026-04-23 |
| DL-321 | Classifier non-document verdict | COMPLETED 2026-04-23 |
| DL-320 | "Also matches" UX + robot icon removal | COMPLETED 2026-04-23 |
| DL-319 | Approve-as-Required button | COMPLETED 2026-04-23 |
| DL-317 | Fetch-only prefetch for heavy tab loaders | COMPLETED 2026-04-23 |
| DL-315 | Classifier fallback for pre-questionnaire docs | COMPLETED 2026-04-23 |
| DL-314 | Multi-template match in AI Review + SVG sprite icons | COMPLETED 2026-04-23 |
| DL-313 | Hover tab dropdowns | COMPLETED 2026-04-20 |
| DL-311 | Admin panel slowness | COMPLETED 2026-04-20 |
| DL-310 | Remove raw-answer note append | COMPLETED 2026-04-20 |
| DL-308 | Approve & send email preview | COMPLETED 2026-04-20 |

---

## Active TODOs

### Needs browser testing
- [ ] **Test DL-352: Add-doc owner tabs** — verify segmented control replaces the sticky checkbox in doc-manager and behaves uniformly with the PA popover.
   - [ ] Doc-manager (client with spouse): tabs visible above combobox, default = client name highlighted
   - [ ] Switch to spouse tab → combobox re-renders without CLIENT-only templates; PERSON / GLOBAL_SINGLE / empty remain
   - [ ] Search input value preserved across tab switch
   - [ ] Pick template under spouse tab → chip shows `(בן/בת זוג)`
   - [ ] Add custom doc under spouse tab → chip shows `(בן/בת זוג)`
   - [ ] Reload page → default reverts to client tab (no sticky state)
   - [ ] Doc-manager (no spouse) → tabs hidden, behavior unchanged
   - [ ] PA popover regression check — tabs still work when spouse exists, hidden otherwise
   - [ ] Save flow: API receives correct `person` per doc on both surfaces
   - [ ] Hebrew RTL rendering + keyboard a11y (Tab/Enter on each tab)
   Design log: `.agent/design-logs/admin-ui/352-add-doc-owner-tabs.md`
- [ ] **DL-299** — PA card issuer edit + note popover + print (`admin-ui/299`)
- [ ] **DL-298** — PA queue stacked cards (`admin-ui/298`)
- [ ] **DL-297** — Doc-manager sticky header + editable stage (`admin-ui/297`)
- [ ] **DL-293** — Doc-manager full client edit (`admin-ui/293`)
- [ ] **DL-290** — Reminder "ממתין לסיווג" count matches AI Review badge (`admin-ui/290`)
- [ ] **DL-288** — Queued-subtitle stale flash (`admin-ui/288`)
- [ ] **DL-280** — Mobile bottom nav FOUC fix (`admin-ui/280`)

### Draft / not started
- [ ] **DL-316** — AI Review React port scoping (DRAFT)

---

## Blocked / Deferred

| Item | Trigger Condition |
|------|-------------------|
| DL-182 CS Tally completion | Moshe provides content decisions |
| DL-166 Filing Type Tabs | CS Tally forms + templates populated |
| Custom domain migration | Business decision to purchase domain |
| WF05 convertOfficeToPdf() | Needs MSGraphClient binary GET — low priority |

---

## Stakeholder Backlog
See `docs/meeting-with-natan-action-items.md` for Natan's feature requests.
