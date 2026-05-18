# Annual Reports CRM - Current Status

**Last Updated:** 2026-05-18 (DL-422 COMPLETED — group-header reply button fixed + toggle-on-second-click, verified live by user)

## OPEN: DL-420 — Inbound never silently drops attachments

DL: `.agent/design-logs/infrastructure/420-never-silently-drop-attachments.md`
Status: **IMPLEMENTED — VERIFIED LIVE (Phase 1+2+3 + drive-link backup + admin/pc-patch endpoint)**

Hard invariant: every inbound attachment lands in BOTH OneDrive (when bytes available) AND `pending_classifications`. Phase 1 — fallback PC for classify/upload throws + too_large stub. Phase 2 — `fetchDriveAttachment` parses Content-Disposition for real filenames, `archive-expander` `skipped_too_heavy` for archives >30 MB, classifier skips `ARCHIVE_EXTENSIONS`, fallback path also uploads bytes to OneDrive. Phase 3 — Content-Length parsing surfaces real size on too_large fallback; AI Review badge renders "🚫 קובץ גדול מדי (62 MB)" + "📂 פתח בדרייב" button. Plus: drive-link backup module shows the Drive button on any `drive_*.*`-named PC (stale rows from before Phase 2). Plus: `admin/pc-patch` endpoint (N8N_INTERNAL_KEY gated, allowlisted fields) for surgical PC fixes.

Verified live on second CPA-XXX retry: 15 real-named attachments arrived; U13779324.2025.tax.zip got auto-extracted into 3 inner PCs with `📦 חולץ מ:` provenance; U9744004.2025.tax.zip (68 MB, over 50 MB Drive cap) landed as too_large fallback PC with real `attachment_size = 71663693`. Hash dedup correctly skipped the 11 attachments already represented in documents/pending_classifications from the first run.

### Active TODOs / known caveats
- [ ] **`attachments_failed_count` field not auto-creating** on email_events despite `typecast: true`. Schema permissions may differ from documents:write scope. Pre-create the field in Airtable UI or investigate further.
- [ ] **Office still needs to manually handle the 68 MB U9744004 ZIP.** Click Drive button → download → unzip → upload each inner file via admin doc-manager. Wrapper PC then gets marked rejected.
- [ ] **HTML attachments don't classify well.** Consider adding `.html` to skip-extensions or building a small HTML→text adapter (follow-up).
- [ ] **Mobile preview pane** — DL-420 too_large badge fires but the drive-backup link injection only wires the desktop preview header.
- [ ] **Drive streaming for >50 MB files (DL-421 candidate).** Stream Drive → OneDrive upload session without buffering in Worker memory. ~80-100 lines.

## OPEN: DL-419 — Inbound Large-File Passthrough (Upload Sessions + Classifier Skip)
**Last Updated:** 2026-05-18 (DL-423 implemented — verified live + locked down the "ZIP never alongside its extracted children" invariant in `archive-expander.ts` via a tripwire test that catches the realistic regression without WASM in the test runner)

## OPEN: DL-423 — ZIP never alongside its extracted children in PC queue

DL: `.agent/design-logs/documents/423-zip-extraction-no-parent-pc.md`
Status: **IMPLEMENTED — NEED TESTING**

Preventive follow-up to DL-260 + DL-420. Office expectation: successful ZIP extraction = children-only PCs; failed extraction (corrupt / password-protected / >30 MB) = raw ZIP as fallback PC. Never both. Live spot-check on CPA-XXX `U13779324.2025.tax.zip` confirmed correct behavior (3 child PCs, zero parent PC). Code in `archive-expander.ts:264–331` already correct; only gap was no regression test guarding it. Added: (a) load-bearing `INVARIANT (DL-423)` comment above the per-attachment loop pointing at the test, (b) `api/test/archive-expander-invariant.test.mjs` — structural tripwire over the `.ts` source: success branch must push `synth` not `att`; each failure branch must push raw `att`; marker present. 5 new tests pass. No behavior change, no script.js bump.

### Active TODOs (validation — Phase E)
- [x] **V1 — npm test green.** `npm test` runs 24 tests (5 new tripwire + 19 existing); all pass.
- [x] **V2 — Tripwire fires when success branch broken.** Confirmed in-session: inserted `result.attachments.push(att)` after `push(synth)`; test 2 failed as expected; source restored.
- [x] **V3 — Tripwire fires when failure-branch passthrough removed.** Confirmed in-session: removed `result.attachments.push(att)` from `extract_failed` branch; test 4 failed as expected; source restored.
- [x] **V4 — TS clean for archive-expander.ts.** `./node_modules/.bin/tsc --noEmit` shows the same 4 pre-existing errors in unrelated files; none in `archive-expander.ts` or the new test.
- [ ] **V5 — Live spot-check next inbound ZIP.** On the next ZIP-bearing email processed in production, verify AI Review shows only children (or only the raw ZIP if extraction failed), never both. (Deferred to natural inbound traffic — non-blocking.)

## OPEN: DL-419 — Inbound Large-File Passthrough (Upload Sessions + Classifier Skip)

DL: `.agent/design-logs/infrastructure/419-inbound-large-file-passthrough.md`
Status: **IMPLEMENTED — NEED TESTING (V1 passed live)**

DL-416's classifier base64 fix was insufficient — the OOM lived upstream of the classifier, in `processor.ts:processAttachment` Step 6 `uploadToOneDrive(…32MB ArrayBuffer)`. CF Workers' `fetch()` body buffer + a 32 MB body ≈ 64 MB peak per PUT pushed past the 128 MB per-isolate cap. DL-419 ships three changes: (1) new `uploadLargeFileToOneDrive` helper using MS Graph `createUploadSession` + 5 MiB chunked PUT (5 MiB = 16 × 320 KiB satisfies MS Graph's fragment-size rule); (2) classifier skip when `attachment.size > MAX_CLASSIFIABLE_BYTES` (20 MB) — pending_classifications row still created with `matched_template_id=null` + Hebrew sentinel `קובץ גדול — דרוש סיווג ידני` in `matched_doc_name`; (3) eager memory-free of `attachment.content`/`contentToUpload` after upload so V8 GC reclaims before the NEXT attachment's PUT. Deployed worker version `9d78b1cc-3452-41f2-b6c0-cb22d8959880`. V1 verified live ~15:34Z — 8-attachment email (CPA-XXX, 32 MB Drive PDF + 7 small) processed completely on first attempt: 7 classified normally with high confidence, 1 row carries the manual-sort sentinel with working SharePoint URL.

### Active TODOs (validation — Phase E)
- [ ] **V2 — Smoke, normal-size email.** Forward a 2-attachment email with both <5 MB. Both go through single-PUT (no `[DL-419] Chunked upload …` log lines), both classified by Anthropic, both pending_classifications rows have `matched_template_id` populated.
- [ ] **V3 — Edge, mid-size between thresholds.** Forward an email with a 6 MB PDF. Chunked upload engages (2 chunks visible in logs), Anthropic still classifies (size < 20 MB ceiling), `matched_template_id` populated.
- [ ] **V4 — Edge, just over the AI threshold.** Forward a 22 MB PDF. Chunked upload engages, AI classification skipped, sentinel set, row visible in AI Review.
- [ ] **V5 — Memory headroom check during V1.** Workers Logs for the 15:33Z run: `outcome=ok`, wall < 120 s, cpuTimeMs < 30000. (Logpush archive becomes queryable in ~5 min.)
- [ ] **V6 — Office reassign flow.** Click the sentinel row in AI Review and reassign it to the right template (likely T901/T902 rental contract per email body). Confirm: documents row updates with `file_url` + correct `type`; pending_classifications row dismissed normally per DL-412 flow.

## OPEN: DL-418 — Client portal falsely shows "already submitted" when docs exist without questionnaire

DL: `.agent/design-logs/client-portal/418-portal-false-submission-flag.md`
Status: **IMPLEMENTED — NEED TESTING**

`/webhook/check-existing-submission` was returning `has_submission: true` for any report with received docs, gating clients with stuck stage-2 reports out of the language picker. Stage rank is now the sole signal. Deployed to Worker 2026-05-17. API verified via curl on the stuck report (returns `has_submission: false`, `stage_rank: 2`, `document_count: 4`).

**Active TODOs (Section 7):**

- [ ] **Browser walkthrough on a real stuck client URL.** Open the client portal link for a stage-2 report that has received docs; confirm the language picker (HE/EN cards) renders and NOT the "already submitted" warning.
- [ ] **Regression: stage 3+ report still gated.** Pick any report at `Pending_Approval` or beyond and confirm the "already submitted" view still shows (correct behavior — they actually did submit).
- [ ] **Regression: stage 1 fresh report.** Pick a stage 1 report with 0 docs; confirm the language picker still shows (no change).
- [ ] **CS filing type sanity check.** Pick a `capital_statement` report and verify the same flow works through this endpoint.
- [ ] **Worker error tail (2 min post-deploy).** No spike expected — the change cannot throw.

## OPEN: DL-415 — AI-Review Reassign Period Propagation

DL: `.agent/design-logs/ai-review/415-ai-review-reassign-period-propagation.md`
Status: **IMPLEMENTED — NEED TESTING**

Six bugs surfaced via live testing on CPA-XXX in the AI-review [H:reassign] + duplicate-confirmation dialog for T901/T902 contracts. Root cause: DL-397 persists `matched_template_id` + `contract_period` on the CLASSIFICATIONS row but the period never propagated to the DOCUMENTS row (`issuer_name` / `document_key`). OneDrive filenames were correct, admin/portal weren't.

Server (`api/src/routes/classifications.ts`): new `applyPeriodSuffixToDocFields` + `parseIssuerNamePeriod` + `periodsOverlap` helpers. Reassign block now syncs `clsFields.matched_template_id` + `clsFields.contract_period` BEFORE Step 4 (target ops). Helper hooked into general_doc create, Path 3 create, standard UPDATE branch, and keep_both. Path 3 now prefers `Required_Missing` placeholders + waives duplicate generic stubs on fill (bug 4 dedup-on-fill). Keep_both strips OLD period from baseTitle/baseKey and re-applies the MODAL's period before insert. Step 3 conflict guard is now period-aware — non-overlapping periods auto-promote to silent `keep_both`. Step 6 (reassign branch) PATCHes `classifications.expected_filename` after computing newFilename so T501→T902 staleness is fixed. `force_overwrite`/`approve_mode` switched to `let` to support the auto-promotion.

Frontend (`frontend/admin/js/modules/dl410-silent-refresh.js`): new `stripPeriod()` helper, `insertReassignedDocAndRefresh` now strips `data.matched_short_name` before appending the canonical period — single-source-of-truth ends the triple-render in dropdown labels + merge dialog titles. Cache-bust `?v=3 → ?v=4`.

`tsc --noEmit` clean (only pre-existing DL-397 errors remain). No `script.js` touches → no monolith ratchet impact.

### Active TODOs (validation — Phase E)
- [ ] **Bug 1a — [H:reassign] to generic placeholder (UPDATE in place):** generate a fresh missing T902 stub for CPA-XXX (no period); assign a doc with period 02.2025–04.2025 via [H:reassign]. Verify chosen placeholder row now has `issuer_name = …([H:expense]) <b>02.2025-04.2025</b>`, `document_key = …_T902_client_2-4`, status=Received. No new Documents row created.
- [ ] **Bug 1b — [H:reassign] when no target row exists (Path 3 INSERT):** assign a doc to a T901/T902 with no matching missing placeholder; verify new row carries period suffix in `issuer_name` + `document_key`.
- [ ] **Bug 2 — Keep-both uses MODAL period, not target period:** existing Received T902 at `01.2025-01.2025`, assign new doc same template with period `06.2025-07.2025`, click "Keep both". New row's `issuer_name = …([H:expense]) <b>06.2025-07.2025</b> — [H:part] 2`, `document_key = …_6-7_part2`. Original `01.2025-01.2025` row unchanged.
- [ ] **Bug 3 — `expected_filename` regen:** classify a doc as T501; manually reassign to T902 with period; verify `pending_classifications.expected_filename` reflects new T902 short name + period.
- [ ] **Bug 4 — Stub dedup-on-fill:** CPA-XXX has 2 identical missing T902 rows today. Next reassign that picks one of them should waive the other(s) automatically. Verify via Airtable query.
- [ ] **Bug 5 — Label single-render:** open [H:reassign] modal on a doc with T902 target carrying period; verify dropdown option shows period exactly once. Trigger conflict (target Received with overlapping period) → dialog title shows period once.
- [ ] **Bug 6a — Overlap trigger:** existing T902 Received at `01.2025-06.2025`, assign new with `03.2025-08.2025` → dialog fires (overlap).
- [ ] **Bug 6b — Silent keep-both:** existing T902 Received at `01.2025-01.2025`, assign new with `06.2025-07.2025` → no dialog, new row created directly with period 06-07 and `_part2` suffix.
- [ ] **Regression — OneDrive filename:** all flows produce `[H:rental-contract] ([H:expense]) MM.YYYY-MM.YYYY.pdf`.
- [ ] **Regression — DL-397 contract-months input:** reassign modal still reveals months input on T901/T902 selection; chip menu + add-doc popover unchanged.
- [ ] **Regression — DL-386 add-required-doc:** still creates row with embedded period correctly (verified working pre-DL-415).
- [ ] **Regression — non-rental reassign (T501, T1102, etc.):** no period logic kicks in; behavior unchanged.
- [ ] **Worker deploy:** `bash .claude/workflows/deploy-worker.sh` from canonical clone after merge; `/health` returns 200.
- [ ] **Cache-bust:** `curl -sI https://docs.moshe-atsits.com/admin/index.html | grep dl410-silent-refresh.js` shows `?v=4`.
- [ ] **Activity log:** `node scripts/query-worker-logs.mjs --since=1h --search="DL-415"` shows the auto-keep_both and dup-waive log lines firing in live testing.

### Follow-up enhancement (not blocking)
- [ ] **`groupDocs` doesn't pre-sort by category — category headers can repeat in the [H:reassign] dropdown.** When CPA-XXX has multiple T902 docs with mixed categories (`housing` vs `rental`), the dropdown shows `מגורים ונדל"ן` more than once. Root cause: `groupDocs` (script.js, in `createDocCombobox`) only collapses consecutive same-category entries; input list isn't sorted by category first. Fix: `docList.slice().sort((a,b)=>(a.category||'').localeCompare(b.category||''))` before the groupDocs loop. ~1 line. Surfaced during Bug 4 setup on CPA-XXX.
- [ ] **Auto-populate [H:reassign] period inputs from selected target:** when a user picks a target in the [H:reassign] dropdown whose `issuer_name` carries `<b>MM.YYYY-MM.YYYY</b>`, the period inputs in `renderContractMonthsInput` should pre-fill with those months instead of staying blank (`MM.YYYY` placeholder). Currently the user has to retype the period that's already visible in the target label, which is friction. Plumbing: in `_dl397SyncReassignMonths` (script.js ~7912) parse the picked doc's `name`/`issuer_name` for `<b>(\d{1,2})\.(\d{4})-(\d{1,2})\.(\d{4})</b>` and pass as `defaultStart`/`defaultEnd` opts to `renderContractMonthsInput`. Small ratchet impact — likely +3 lines. Surfaced during Test 2 of DL-415 live testing on CPA-XXX.

---

## OPEN: DL-414 — Doc Upload Size Limit (10 MB → 50 MB)

DL: `.agent/design-logs/documents/414-doc-upload-size-limit.md`
Status: **IMPLEMENTED — NEED TESTING**

Office hit the 10 MB cap on a real-world tax document. Four constants flipped to 50 MB: Worker `MAX_FILE_SIZE` (`api/src/routes/upload-document.ts:26`), client `UPLOAD_MAX_SIZE` + Hebrew toast (`frontend/assets/js/document-manager.js:3103/3123`), inbound Drive-link `DRIVE_DEFAULT_MAX_BYTES` (`api/src/lib/inbound/attachment-utils.ts:124`). Cache-bust `document-manager.js?v=412→413`. Research-verified: CF Workers Pro body cap 100 MB; MS Graph single-PUT on Business OneDrive 250 MB (vs. 4 MB old-docs figure); Exchange Online inbound default ~36 MB → our 50 MB ceiling is generous. Wrangler dry-run clean. Worker deploy pending merge to main.

### Active TODOs (validation — Phase E)
- [ ] Worker deployed: `bash .claude/workflows/deploy-worker.sh` after merge to main; `curl -s https://annual-reports-api.liozshor1.workers.dev/health` returns 200.
- [ ] Cache-bust live: `curl -sI https://docs.moshe-atsits.com/document-manager.html | grep -o 'document-manager.js?v=[0-9]*'` → `?v=413`.
- [ ] Deployed JS reflects new constant: `curl -s https://docs.moshe-atsits.com/assets/js/document-manager.js | grep -o 'UPLOAD_MAX_SIZE = [0-9 *]*'` → `50 * 1024 * 1024`.
- [ ] Admin doc-manager — upload a 12 MB file: succeeds, row flips to Received, OneDrive `file_url` set.
- [ ] Admin doc-manager — upload a 45 MB file: succeeds (may take 15-30 s on slow connection).
- [ ] Admin doc-manager — upload a 60 MB file: rejected with toast `הקובץ גדול מדי (מקסימום 50MB)`.
- [ ] **Specific real-world file that triggered this DL** — end-to-end success.
- [ ] Inbound regression — forward a small (~2 MB) test attachment to `reports@moshe-atsits.co.il`: no regression on classification + OneDrive copy.
- [ ] Activity log: `node scripts/query-worker-logs.mjs --since=30m --search="upload-document"` shows `doc_upload` events with new `file_size` values.

---

## OPEN: DL-410 — Rental-Contract NaN Render + Silent Refresh

DL: `.agent/design-logs/admin-ui/410-rental-contract-nan-and-silent-refresh.md`
Status: **IMPLEMENTED — NEED TESTING**

Symptom (reported by client via screenshot): green "AI חושב שזה: [H:rental-contract] ([H:income])" pill renders `NaN.2025-NaN.2025`; clicking "+ [H:request-contract] MM.YYYY-MM.YYYY" creates the follow-up doc but doesn't refresh the UI — must reload. Fixed: NaN guards in `appendContractPeriod` (`script.js:5973`) and reviewed-card period-buttons block (`script.js:6346`) — partial cp shapes now render `__.__-__.____` placeholder; added silent refresh to `requestMissingPeriod` reusing `refreshItemDom` + `updateClientDocState` (DL-385/DL-359 pattern). Cache-bust `script.js?v=419→420`. Deleted unused `requestRemainingContract` shim to fit ratchet.

### Active TODOs (validation — Phase E)
- [ ] Live test on reported client: AI-review pill renders `MM.YYYY-MM.YYYY` (when dates present) or `__.__-__.____` (when missing). Never `NaN`.
- [ ] Reviewed-card with missing dates: "+ [H:request-contract]" buttons hidden (no NaN labels).
- [ ] Silent refresh end-to-end: pick partial T901 → click "+ [H:request-contract] MM.YYYY-MM.YYYY" → new follow-up doc appears in admin dashboard expanded row + Doc Manager (if open) without reload. Toast shows `נוסף מסמך חסר: [H:rental-contract] MM.YYYY-MM.YYYY`. No flicker, no scroll jump.
- [ ] Duplicate-press: rapid double-click → only one follow-up doc created.
- [ ] Hebrew RTL: `__.__-__.____` placeholder renders LTR-correctly inside Hebrew pill.
- [ ] Regression — DL-359 full-year badge: clicking ✓ badge still expands to editor.
- [ ] Regression — DL-385 T901↔T902 swap still works.
- [ ] Regression — DL-397 manual reassign with months still saves and renders.
- [ ] Regression — `requestRemainingContract` shim removal: no broken callers (grep confirmed zero in repo; watch for n8n/external).
- [ ] Cache-bust: `curl -sI https://docs.moshe-atsits.com/admin/index.html | grep script.js` shows `?v=420` after Pages auto-deploy.
- [ ] Activity log: `node scripts/query-worker-logs.mjs --since=1h --search="request-remaining-contract"` confirms action firing during live test.

---

## OPEN: DL-408 — Doc-Manager Rental Contracts Multi-Instance

DL: `.agent/design-logs/admin-ui/408-doc-manager-rental-multi-instance.md`
Status: **IMPLEMENTED — NEED TESTING**

Symptom (CPA-XXX): T901 ("[H:rented-out] – [H:income]") missing from add-doc dropdown. Root cause: T901's Airtable `variables` field was empty + the `userVars.length === 0 && existingTemplateIds.has(...)` filter at `document-manager.js:771` swallowed it once on the report. Fixed both: PATCHed Airtable T901 row to set `variables = "rent_income_monthly"` AND added `MULTI_INSTANCE_TEMPLATES = new Set(['T901','T902'])` allowlist bypass as defense-in-depth.

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
**Last Updated:** 2026-05-06 (DL-406 — IN PROGRESS, paused mid-Phase-D-2.)

## OPEN: DL-406 — Aging colors + pending-notes digest section

DL: `.agent/design-logs/admin-ui/406-aging-colors-pending-notes-digest.md`
Prompt artifact: `docs/dl-406-pending-notes-prompt.md`
Edit script (regenerates the WF07 JSON): `docs/dl-406-edit-wf07.py`
Frontend cache-bust: `script.js?v=419`

### Phase D-1 — frontend aging colors — SHIPPED ✓
Commit `712c8303` on main (rebased + FF-pushed). Pages auto-deploy verified — `script.js?v=419` live on docs.moshe-atsits.com. Surfaces with new aging cues:
- Messages widget rows + groups (`.msg-row` / `.msg-group`) — RTL border-inline-start stripe via `m.date`
- AI Review pending cards (`.ai-review-card`) — bg tint via `item.received_at`
- PA queue priority badge (`.pa-card__priority`) — unified palette via `item.submitted_at`, replaces DL-295 `--med`/`--high`
Moshe-Review FIFO queue intentionally untouched.

### Phase D-2 — n8n WF07 digest section — IN PROGRESS, paused
**Approach pivoted mid-implementation** from sub-workflow → inline edit of WF07 JSON (user concerned about MCP `update_workflow` blast radius on a 13-node production digest, and security harness blocks tool calls carrying real Airtable PAT / Anthropic key).

**Current state:**
- Modified WF07 JSON sitting at `C:\Users\liozm\Downloads\[07] Daily Natan Digest - DL-406.json` (regenerable via `docs/dl-406-edit-wf07.py`).
- 6 new nodes added (Query Pending Notes, Build Notes Payload, IF Has Pending Notes, Call Claude (Notes), Parse Notes Response, Return Empty Notes); existing inbox-emails sub-chain shifted right but kept (just no longer rendered).
- New Section 1 = pending-notes-from-dashboard with three urgency tiers (`urgent` / `regular` / `fyi`); old inbox-emails section removed from rendered email per user request.
- Subject line updated to lead with urgent count (Hebrew, prepends `N דחופות` ahead of approval/review counts).
- One bug fixed mid-test: `$('Return Empty Notes').first()` throws when the unran IF branch is referenced; wrapped in try/catch (latest `docs/dl-406-edit-wf07.py` already has the fix).

**Orphan to clean up:** sub-workflow `HeDd1DgXXnzM2qP0` (`[DL-406] Pending Notes Builder`) created earlier in the session before pivoting. Harmless since it has no trigger schedule, but should be archived via `mcp__claude_ai_n8n__archive_workflow` when convenient.

### Resume from here:
1. **User imports** `[07] Daily Natan Digest - DL-406.json` (Replace) → Save → Execute workflow.
2. Verify Section 1 renders pending notes (compare to dashboard widget content), and the inbox-emails section is gone.
3. If Claude prompt output is rough, iterate — `docs/dl-406-pending-notes-prompt.md` documents the design; edit `docs/dl-406-edit-wf07.py` (`SYSTEM_PROMPT` constant) and re-run to regenerate JSON.
4. After tomorrow's 15:00 / 20:00 send confirms healthy, archive the orphan sub-workflow `HeDd1DgXXnzM2qP0` and run `bash .claude/workflows/close-design-log.sh 406` to mark DL-406 `[COMPLETED]`.

### Open Section 7 items:
- [ ] Test sub-chain end-to-end: import + execute, verify urgent/regular/fyi tiers render, multi-message dedup works, polite-acknowledgement notes bucketed `fyi` (or skipped), casual `urgent` mention NOT auto-promoted
- [ ] Verify Friday/Saturday skip still works (DL-204 weekend gate untouched)
- [ ] Verify recipient routing: 15:00 → Natan, 20:00 → Moshe (per existing `israelHour < 18` check)
- [ ] Watch first real 15:00 send for Hebrew rendering / mojibake / RTL
- [ ] Mark `[COMPLETED]` after first clean live send

### Follow-ups identified 2026-05-06 (post first live digest):

**(A) Coverage mismatch — digest's 6 names vs widget's 7+ with zero overlap.** Two surfaces query Airtable with very different scopes:
| | Widget `/admin-recent-messages` | WF07 `Query Pending Notes` + `Build Notes Payload` |
|---|---|---|
| Year scope | `{year}=<currentYear>` (default 2026) | none — any year |
| Records | paginated `listAllRecords` | single `pageSize=100` GET, NO offset loop |
| Record window | none | `LAST_MODIFIED_TIME > NOW-30d` |
| `!summary` | passes through | hard skip (even after `raw_snippet` fallback) |
| `type==='office_reply'` | folded into replies map | hard skip |
| Age cap | none | >14d hard skip |
| Total cap | none | `slice(0,50)` after sort by age desc → keeps **oldest 50**, drops newest if >50 |

  **Most likely root cause (ranked):** (1) year-scope mismatch — widget shows 2026, digest is year-agnostic and pulls mostly 2025 records; (2) no pagination on the digest query (silent tail-drop if >100 reports have notes modified in last 30d); (3) `!summary` filter drops entries the widget shows blank.

  **Fix shape (needs user approval before edit):**
  - [ ] Drop `LAST_MODIFIED_TIME` filter; query `client_notes != ''` with offset-loop pagination (matches widget).
  - [ ] Decide year scope: (a) match widget current-year only, (b) union active years 2025+2026, or (c) all-years. **User to pick.**
  - [ ] Soften `!summary`: fall back to `n.subject` or empty placeholder so LLM can SKIP-classify instead of silent-drop.
  - [ ] Cap-bite logging: warn when `>50` notes after filter so we know the cap is biting.
  - [ ] Keep `>14d` and `office_reply` skips — those are correct.

**(B) LLM tone too terse — pick a candidate before re-tuning prompt.** Drafted 5 tone candidates side-by-side (verb-led terse / personal narrative / boss briefing / empathetic / mixed headline+context) using 4 sample notes. **Held in chat transcript only — not saved to a file yet.** User to pick a tone (or mix), then update `docs/dl-406-pending-notes-prompt.md` few-shot examples + `docs/dl-406-edit-wf07.py` `SYSTEM_PROMPT` constant and re-test on next morning's digest.

**Live-verify gate:** Both fixes must be tested against next morning's actual digest before marking `[COMPLETED]` — per project CLAUDE.md "tests pass ≠ done".

---




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
- **2026-05-03 · DL-397 — COMPLETED.** Capture contract months on manual T901/T902 assign across 3 flows (reassign modal / chip "assign to this doc" / add-doc inline prompt). Backend `reassign` action atomically persists `matched_template_id` + optional `contract_period` in Step 5 PATCH. Live-verified: (a) Reassign modal — selected T901, filled months, saved successfully; (b) Add-doc popover — T902 chip created via "+", inline prompt with months popped, submit produced `[H:rental-contract] ([H:expense]) 01.2025-09.2025.pdf` in OneDrive (after follow-up); (c) Chip-menu sub-popover — "📎 שייך…" on a Required_Missing T902 chip rendered the months mini-form and saved. **Follow-up fix**: Step 6 OneDrive rename (`getRentalPeriodLabel()`) reads `clsFields` snapshot loaded at Step 2 — without sync, manual reassign produced filenames missing the period suffix. Now sync `clsFields.matched_template_id` and `contract_period` in-memory when building Step 5 PATCH. Cache-bust v=400→403 (rebase race + follow-up bumps). Worker `4867ed44-45e7-45b0-92a9-fc5d02a0101c`. DL: `.agent/design-logs/ai-review/397-manual-assign-contract-months-and-stale-template-id.md`.
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
