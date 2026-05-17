# DL-415: AI-Review Reassign + Merge Flow — Period Propagation, Label Dedup, Period-Aware Trigger

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-17
**Related Logs:** DL-397 (capture months on manual assign + persist `matched_template_id`), DL-385 (lenient `MM.YYYY` parser + T901↔T902 swap), DL-386 (add doc from AI review), DL-231 (keep-both missing document_keys), DL-410 (silent refresh `periodLabel`), DL-359 (edit full-year contract dates), DL-269/270/271 (partial contract banner)

---

## 1. Context & Problem

Live test session on CPA-XXX (report `recXXXXXXXXXXXXX`, 2025 annual, stage `Collecting_Docs`) found **six** related bugs in the AI-review **[H:reassign]** (reassign) + duplicate-file confirmation flow for contract docs T901 (`[H:income]`) and T902 (`[H:expense]`). All bugs share the same code paths in `api/src/routes/classifications.ts` (reassign + keep_both write paths) and `frontend/admin/js/script.js` (target dropdown label builder + merge dialog).

Background: **DL-397** correctly persists `matched_template_id` + `contract_period` on the **CLASSIFICATIONS** record at reassign time. The current gap: that data is **never propagated onto the DOCUMENTS row** that gets created/updated as part of the same reassign. Result: every reassign drops the period from the doc-level state; OneDrive filename is correct (uses `getRentalPeriodLabel`), but admin/portal UI and downstream rollups see a generic doc.

### The six bugs (verified live)

| # | Surface | Symptom |
|---|---|---|
| 1 | [H:reassign] → existing missing placeholder (generic T902, no encoded period) | INSERTs a new generic Documents row instead of UPDATEing the chosen placeholder; period from modal dropped on the doc row. OneDrive filename has the period. |
| 2 | [H:reassign] → "Keep both" branch of merge dialog | New row's `issuer_name`/`document_key` are cloned from target's period (e.g. `01.2025-01.2025 — [H:part] 2`), ignoring the modal's NEW period (e.g. `06.2025-07.2025`). |
| 3 | `pending_classifications.expected_filename` | Not regenerated when `matched_template_id` flips on reassign (e.g. T501 → T902). Stays as old template's filename. |
| 4 | Template-stub generation creates duplicate generic placeholders (2 identical missing T902 rows, neither carrying a period) | User can't disambiguate them in the dropdown; system can't tell which one to fill. |
| 5 | [H:reassign] target dropdown + merge dialog title | Period text triple-renders: `…([H:expense]) 01.2025-01.2025 01.2025-01.2025 01.2025-01.2025`. Multiple concatenation sources stitched together. |
| 6 | Merge dialog trigger | Fires whenever the target row has a Received file, regardless of period overlap. Friction for the common case where periods clearly don't overlap (so the user obviously wants a separate row). |

### What already works (and explains the partial bug surface)

- **DL-386 add-required-doc → [H:reassign]** path correctly writes the period via `dl410-silent-refresh.js`'s `periodLabel()`. This is the canonical working pattern to mirror.
- **OneDrive rename** uses `getRentalPeriodLabel(clsFields)` at `classifications.ts:1783` — the helper exists, just isn't called from reassign/keep_both.
- **DL-397** writes `matched_template_id` + `contract_period` to the classification record; the data is sitting there waiting to be read.

---

## 2. User Requirements (Q&A)

1. **Q:** When user picks a GENERIC missing T901/T902 placeholder and supplies a period in the modal — what happens to the placeholder?
   **A:** Fill it: write period into placeholder's `issuer_name` + `document_key`, status → Received. (UPDATE in place; no new row.)
2. **Q:** "Keep both" — where should the new row's period come from?
   **A:** From the modal input (the NEW doc's period), not from the target's period.
3. **Q:** Should the merge dialog be period-aware?
   **A:** Yes — fire only when new period overlaps target's (or both are periodless). If period parsing fails, fall back to current behavior.
4. **Q:** Scope?
   **A:** All 6 bugs together — they share the same code paths.
5. **Q:** Label single-source-of-truth?
   **A:** `issuer_name` only (strip `<b>` tags, keep period inline). Matches how T901 missing rows with `01.2025-11.2025` already look on admin chip tags.

---

## 3. Research

### Domain
Admin-override write paths where metadata captured at the action moment (modal inputs) must propagate atomically to multiple persistence layers (classifications record, documents row, OneDrive filename). Conflict-resolution UX for file uploads (overwrite / keep-both / merge). Interval-overlap detection for date ranges. Single-source-of-truth label rendering.

### Sources Consulted
1. **DL-397 (in-repo)** — already extracted `buildContractPeriod()` and added `matched_template_id` to Step 5 PATCH on reassign. DL-415 extends the same Step 5 PATCH to ALSO update the DOCUMENTS row consistently.
2. **DL-231 (in-repo)** — established `_partN` suffixing for keep_both `document_uid`/`document_key`. DL-415 keeps the `_partN` pattern for distinct-period clones but switches the period source to the modal's new period.
3. **DL-410 `periodLabel()` (in-repo, `modules/dl410-silent-refresh.js:24-29`)** — canonical correct frontend pattern; called exactly once per render.
4. **shadcn.io File Conflict Dialog block** (https://shadcn.io/blocks/dialog-file-conflict) — industry-standard pattern: side-by-side metadata comparison + keep-both/replace/skip. Confirms our three-button dialog shape is right; reinforces "surface the metadata that actually differs" (i.e. show periods).
5. **KDE file-conflict redesign discussion** (https://discuss.kde.org/t/simplify-the-file-conflict-overwrite-dialog-redesign/5938) — recommends showing size + timestamp at-a-glance so user can decide. Applied: dialog title should display the **period** clearly so the user understands what's being compared.
6. **Interval overlap (Stack Overflow / OneStopDataAnalysis)** — classic predicate: intervals `[a,b]` and `[c,d]` overlap iff `a ≤ d ∧ c ≤ b`. No edge cases for monthly ISO dates.

### Key Principles Extracted
- **Atomic propagation**: at the moment of reassign, write `matched_template_id` + `contract_period` to classification AND `issuer_name` + `document_key` (with period suffix) to documents row in the same handler. No half-states.
- **SSOT for label rendering**: ONE source per label. `issuer_name` (with embedded `<b>MM.YYYY-MM.YYYY</b>` tags) is the canonical form. Strip tags for rendering but never append additional period from elsewhere.
- **Lenient input, strict storage** (DL-385 carry-over): modal accepts `MM.YYYY`/`M.YY`/etc; storage uses ISO `YYYY-MM-DD` JSON in `contract_period`; display uses `MM.YYYY-MM.YYYY` derived once.
- **Period-aware conflict trigger**: only ask the user "merge/keep-both/replace" when the conflict is real (overlapping periods or both periodless). Otherwise proceed directly to keep-both with the new period.
- **Reuse existing helpers**: `getRentalPeriodLabel()` (server) and `periodLabel()` (client) already exist and are correct — just call them from the missing surfaces.
- **In-place UPDATE over INSERT-new** when a user-chosen target exists: matches the user's expressed intent ("I picked THIS placeholder, fill it") and avoids the duplicate-row proliferation seen on CPA-XXX.

### Anti-Patterns to Avoid
- **Multiple period sources stitched into one label** (the current dropdown bug). One source, full stop.
- **Server-side "if missing, derive" period writes**: always write the explicit value from the request — predictable, debuggable.
- **Relaxing the conflict trigger to never fire**: keep the dialog for overlapping periods; only suppress it for clearly-non-overlapping cases.
- **Schema change on Documents table to add a `contract_period` field**: out of scope. Period stays encoded in `issuer_name`/`document_key`, consistent with existing T901 missing rows.

### Verdict
Two atomic backend extensions (reassign UPDATE branch + keep_both INSERT branch) reuse `getRentalPeriodLabel()` to apply period suffix; one frontend cleanup of the label builder to consume `issuer_name` only; one new overlap predicate to gate the merge dialog. Plus a stub-dedupe pass to address bug #4.

---

## 4. Codebase Analysis

### Server (`api/src/routes/classifications.ts`)
- **`getRentalPeriodLabel(clsFields)`** at L877-893 — returns `{ html: '<b>MM.YYYY-MM.YYYY</b>', filename: 'MM.YYYY-MM.YYYY' }` from `clsFields.contract_period`. Called from approve flow (L1783). **REUSE.**
- **`buildContractPeriod(startDate, endDate)`** at L106-122 — validates + serializes. **REUSE.**
- **Reassign UPDATE branch** at L2024-2139 (`reassignMode === 'standard'`) — `airtable.updateRecord(TABLES.DOCUMENTS, targetDoc.id, { … })` at L2124. **Writes file fields only; never rewrites `issuer_name`/`document_key`.** Bug #1 lives here.
- **Reassign INSERT branch ("Path 3")** at L1955-2014, create at L1999. Builds `issuer_name` and `document_key` without period. Bug #1 also touches here in the case where no target row exists.
- **General_doc create** at L1931-1952. Builds `issuer_name = issuerNameWithSpouse`, `document_key = docUid` (no period). Bug #1 corollary.
- **Keep_both** at L2063-2109, create at L2106. `baseTitle` taken from target (carries old period), `suffixedTitle = baseTitle + ' — [H:part] N'`, `document_key = origKey + '_partN'`. Bug #2 lives here.
- **Step 5 PATCH** at ~L2165 — already writes `matched_template_id` and `contract_period` to classification. Bug #3 (expected_filename) addressable here by adding a derived `expected_filename` field.
- **Template-stub generation** — separate pipeline (likely in `inbound`/`reports` route or a worker). Need to find and add a dedupe pass for bug #4. (Will locate during implementation.)

### Frontend (`frontend/admin/js/script.js`)
- **`submitAIReassign`** at L7992 — already forwards `extras.contract_period` (L8014-8017) correctly. No change needed.
- **`createDocCombobox` option render** at L3560 — uses `getDisplayName(doc)` which reads `doc.name_short`. `name_short` is server-derived and already contains the period (via short-name code path); the dropdown option additionally formats from `doc.contract_period`, producing the triple-render. Bug #5 lives here.
- **`renderDocLabel`** at L14286-14292 — escapes/unescapes `<b>` tags. Not the duplication source itself but part of the rendering pipeline.
- **Merge dialog (`showApproveConflictDialog`)** at L14402 — opens from `submitAIReassign` at L8033 when server returns `requires_force_overwrite`. Title builder also concatenates period (bug #5 echo). Three buttons → `resubmitReassign(..., mode, ...)` with `mode ∈ {merge, keep_both, override}` (L14439-14441). Keep-both POST body at L7346-7355 sends `approve_mode: 'keep_both'`.
- **`renderContractMonthsInput`** at L6922 — months input mini-form (DL-397). Already correct; called from reassign modal, chip menu, full-year badge editor.
- **`periodLabel()`** at `frontend/admin/js/modules/dl410-silent-refresh.js:24-29` — canonical client-side period formatter. **REUSE** (already exported; or duplicate the 6-line function inline if module import is awkward).

### Existing Patterns
- DL-397 atomic Step 5 PATCH — extend the same surface with documents-row update.
- DL-410 `periodLabel()` single-call rendering — adopt for dropdown label builder.
- DL-231 `_partN` suffix on keep_both — keep the suffix; replace the period source.

---

## 5. Constraints & Risks

- **Security:** No new PII surface. Same admin-token auth as existing reassign. All inputs already validated server-side.
- **Atomicity:** New documents-row update happens INSIDE the existing reassign handler. If Airtable rejects the combined patch, the whole reassign fails — admin retries cleanly. No half-states.
- **Backward compatibility:** Pure additive on server: existing classifications that already have correct `issuer_name` with embedded period continue to render fine. Existing keep_both rows with `_partN` suffix and inherited period are NOT migrated retroactively (out of scope; user can re-do them manually).
- **Cache-bust:** `frontend/admin/index.html` `script.js?v=NNN` bump required (consult current value before commit).
- **TS check (Windows):** `cd api && ./node_modules/.bin/tsc --noEmit` — never `npx tsc` per `feedback_windows_cmd`.
- **Worker deploy:** after main merge `bash .claude/workflows/deploy-worker.sh` from canonical clone (not session worktree).
- **Monolith ratchet:** `script.js` changes must stay below the baseline; this DL only touches a few short blocks (label builder + dialog trigger), expected delta negligible.
- **Stub-dedupe (bug 4) risk:** if dedupe removes a row that an admin already linked elsewhere, data loss. Mitigation: only dedupe at *stub-generation* time (before any human touches the rows), and only when both rows are `Required_Missing` + identical type/person/no-period.
- **Overlap predicate edge cases:** "periodless target vs period-supplied modal" → treat as overlap (so we still prompt, conservative). "Both periodless" → treat as overlap (conservative, prompt). Only "both periods present AND `a > d` or `c > b`" suppresses the dialog.

---

## 6. Proposed Solution

### Success Criteria
1. [H:reassign] to a generic missing T901/T902 placeholder UPDATEs that placeholder in place: status → Received, `issuer_name` gets `<b>MM.YYYY-MM.YYYY</b>` suffix from the modal period, `document_key` gets `_M-M` suffix. No new row inserted.
2. Keep-both creates a new row whose `issuer_name` and `document_key` carry the MODAL's period (not the target's), with `_partN` suffix appended to disambiguate from the original.
3. `pending_classifications.expected_filename` is regenerated whenever a reassign changes `matched_template_id` — reflects the new template's short name + period.
4. Stub generation deduplicates: at most ONE generic missing placeholder per (template, person, periodless) tuple per report.
5. [H:reassign] target dropdown and merge dialog title each show the period exactly ONCE in every option/title.
6. Merge dialog fires only when periods overlap (or one side is periodless / unparseable). Non-overlapping periods auto-keep-both with the modal period.

### Logic Flow

**Backend — `api/src/routes/classifications.ts`:**

A. **Extract a shared helper `applyPeriodSuffixToDocFields(docFields, clsFields)`** near `getRentalPeriodLabel`:
   - Read `clsFields.contract_period`; if missing → no-op.
   - Strip any existing `<b>…</b>` period suffix from `docFields.issuer_name` (regex `\s*<b>\d{2}\.\d{4}-\d{2}\.\d{4}<\/b>$`).
   - Append fresh `' ' + html` (where `html = getRentalPeriodLabel(clsFields).html`).
   - Replace `document_key` period suffix (`_\d+-\d+$`) with `_<startM>-<endM>` derived from `contract_period`.

B. **Reassign UPDATE branch (L2124):** when `isRentalTemplate(reassign_template_id)` AND `clsFields.contract_period` valid → call `applyPeriodSuffixToDocFields()` on the update payload BEFORE the Airtable patch. Adds `issuer_name`, `document_key`, `issuer_name_en` to the patch.

C. **Reassign INSERT (Path 3, L1999) + general_doc create (L1939):** same helper invocation on the create payload.

D. **Keep_both (L2079-2090):** new logic —
   - Compute `baseTitle` by stripping period from target's `issuer_name`.
   - Compute `baseKey` by stripping period from target's `document_key`.
   - Derive new period suffix from `clsFields.contract_period` (NOT from target's period).
   - Construct `suffixedTitle = baseTitle + ' ' + newPeriodHtml + ' — [H:part] ' + partNumber` (period FIRST, then part-N).
   - `document_key = baseKey + '_' + newPeriodMonths + '_part' + partNumber`.
   - If `clsFields.contract_period` missing, fall back to current `_partN`-only behavior.

E. **`expected_filename` regen (Step 5 PATCH, ~L2165):** when `action === 'reassign'` AND `reassign_template_id !== clsFields.matched_template_id`, recompute `expected_filename` via existing filename builder (locate via search for `expected_filename` writes elsewhere; reuse).

F. **Overlap predicate `periodsOverlap(p1, p2)`:** near `buildContractPeriod`. Returns `true` if both missing, both present and `p1.startDate <= p2.endDate && p2.startDate <= p1.endDate`, OR either missing/unparseable. Returns `false` only when both present and non-overlapping.

G. **Apply overlap predicate at conflict-detection site:** the place where reassign decides `requires_force_overwrite`. If target has a Received file BUT new period and target period are both present AND non-overlapping → skip the prompt, auto-execute as keep_both with the new period.

H. **Stub-dedupe pass (bug 4):** locate the stub generator (likely `api/src/routes/reports.ts` or a worker that fans out templates). On generation, before insert, dedupe by `(template_id, person, no-period)` keeping the first. Backfill cleanup is out of scope (user can waive duplicates manually).

**Frontend — `frontend/admin/js/script.js`:**

I. **Label builder fix (L3560 area + L14402 dialog title):** introduce `formatDocOptionLabel(doc)` that returns ONE string built from `doc.issuer_name` (or `doc.name_short` if it's the only thing populated, picking whichever is canonical) — strip `<b>` tags for plain text rendering or preserve them via `renderDocLabel` ONCE. Never concatenate additional period from `doc.contract_period`. Use this single helper in both the combobox option render and the dialog title.

J. **Cache-bust:** bump `script.js?v=NNN` in `frontend/admin/index.html` (check current value at impl time).

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | New `applyPeriodSuffixToDocFields()` helper. Hook into reassign UPDATE (L2124), reassign INSERT/general_doc create (L1939, L1999), and keep_both (L2079-2106). Add `expected_filename` regen at Step 5 PATCH (~L2165). Add `periodsOverlap()` predicate and gate conflict-detect against it. |
| `api/src/routes/reports.ts` *(or wherever template stubs are generated; locate during impl)* | Modify | Dedupe pass: at most one generic missing placeholder per (template, person, periodless). |
| `frontend/admin/js/script.js` | Modify | New `formatDocOptionLabel(doc)` helper. Replace label construction in combobox option render (~L3560) and merge dialog title (~L14402). |
| `frontend/admin/index.html` | Modify | Cache-bust bump on `script.js?v=NNN`. |
| `.agent/design-logs/INDEX.md` | Modify | Append row 415. |

### Out of Scope (deferred)
- Retroactive cleanup of existing CPA-XXX-style duplicates (manual via admin).
- Documents-table schema change to add a structured `contract_period` field.
- Auto-merge of PDF binaries on the "merge" branch (existing behavior unchanged).
- Pending-approval queue 5739 & mobile banner 781 (consistent with DL-385 scope cap).

### Final Step (always)
- Status → `[IMPLEMENTED — NEED TESTING]`.
- Update `.agent/design-logs/INDEX.md` row 415.
- Copy unchecked Section 7 items to `.agent/current-status.md`.
- Invoke `git-ship` skill (ask before merging to main).
- After merge to main: `bash .claude/workflows/deploy-worker.sh` (canonical clone) for the Worker change. Frontend deploys via Pages auto-deploy.

---

## 7. Validation Plan

- [ ] **Bug 1a — [H:reassign] to generic placeholder (UPDATE in place):** on CPA-XXX, generate a fresh missing T902 stub (no period). Assign a doc with period 02.2025–04.2025 via [H:reassign]. Verify: the chosen placeholder row now has `issuer_name = …([H:expense]) <b>02.2025-04.2025</b>`, `document_key = …_T902_client_2-4`, status=Received. **No new Documents row created.**
- [ ] **Bug 1b — [H:reassign] when no target row exists (Path 3 INSERT):** assign a doc to a template that has no matching missing row; verify the new row carries the period suffix in `issuer_name` + `document_key`.
- [ ] **Bug 2 — Keep-both uses MODAL period, not target period:** with an existing Received T902 row at period `01.2025-01.2025`, assign a new doc to same template with period `06.2025-07.2025`, click "Keep both". Verify the new row's `issuer_name = …([H:expense]) <b>06.2025-07.2025</b> — [H:part] 2` and `document_key = …_6-7_part2`. Target's `01.2025-01.2025` row unchanged.
- [ ] **Bug 3 — `expected_filename` regen:** classify a doc as T501; manually reassign to T902 with period; verify `pending_classifications.expected_filename` matches `getTemplateShortName('T902') + ' 06.2025-07.2025.pdf'`.
- [ ] **Bug 4 — Stub dedupe:** generate fresh report stubs for a client with a T902 expected — verify exactly ONE generic missing T902 row per person. Existing duplicates remain (out of scope) but no new ones appear.
- [ ] **Bug 5 — Label single-render:** open [H:reassign] modal on a doc; verify each option in target dropdown shows period exactly once. Open merge dialog; verify title shows period exactly once.
- [ ] **Bug 6 — Period-aware merge trigger (overlap = prompt):** with existing T902 received at `01.2025-06.2025`, assign new with `03.2025-08.2025` → overlap → dialog fires.
- [ ] **Bug 6 — Period-aware merge trigger (no overlap = silent keep-both):** with existing T902 received at `01.2025-01.2025`, assign new with `06.2025-07.2025` → no overlap → no dialog → new row created directly with modal period.
- [ ] **Regression — OneDrive filename:** all flows above produce the correctly-named file in OneDrive (`[H:rental-contract] ([H:expense]) MM.YYYY-MM.YYYY.pdf`).
- [ ] **Regression — DL-397 contract-months input:** reassign modal still reveals months input on T901/T902; chip menu and add-doc popover unchanged.
- [ ] **Regression — DL-386 add-required-doc:** still creates row with embedded period correctly.
- [ ] **Regression — non-rental reassign:** reassign to T501 etc. — no period logic kicks in; behavior unchanged.
- [ ] **TS check:** `cd api && ./node_modules/.bin/tsc --noEmit` passes (only pre-existing errors remain).
- [ ] **Cache-bust:** DevTools shows the bumped `script.js?v=NNN`.
- [ ] **Worker deploy:** `bash .claude/workflows/deploy-worker.sh` succeeds; `/health` returns 200.
- [ ] **Activity log:** `node scripts/query-worker-logs.mjs --since=1h --search="doc_reassign"` shows events with the new period in payload.
- [ ] **End-to-end live test on CPA-XXX:** repeat the four scenarios that surfaced the bugs originally; all six should now behave correctly.

---

## 8. Implementation Notes

**Server — `api/src/routes/classifications.ts`:**

- **New helpers near `buildContractPeriod` (module scope):**
  - `applyPeriodSuffixToDocFields(docFields, clsFields)` — strips any prior `<b>MM.YYYY-MM.YYYY</b>` from `issuer_name`/`issuer_name_en` and any `_M-M(_partN)?` segment from `document_key`/`document_uid`, then re-applies the current period. Importantly, the issuer-name path **inserts the period BEFORE any trailing `— [H:part] N`** so keep_both rows render as `<title> <b>MM.YYYY-MM.YYYY</b> — [H:part] 2` (matching the established T901 missing-row format), and the key path keeps the `_partN` suffix in place.
  - `parseIssuerNamePeriod(issuerName)` — pulls `<b>MM.YYYY-MM.YYYY</b>` out of an issuer string into an ISO range `{startDate, endDate}` (`YYYY-MM-01` to last-of-month).
  - `periodsOverlap(a, b)` — classic `a.startDate <= b.endDate && b.startDate <= a.endDate`. Conservative: returns `true` on any missing input, so the legacy prompt still fires when periods can't be parsed.

- **`force_overwrite` + `approve_mode` promoted to `let`** at the body destructure so the period-aware conflict gate can mutate them server-side.

- **Step 3 conflict guard (period-aware):** when target is Received with a file, parse target's embedded period via `parseIssuerNamePeriod` + the request's `contract_period`; if both present and non-overlapping → silently promote to `force_overwrite=true, approve_mode='keep_both'` instead of returning 409. If either period is missing/unparseable, the legacy 409 still fires.

- **Reassign action — early sync block (NEW, top of `else if (action === 'reassign')`):** runs `buildContractPeriod()` on the request's `contract_period` and writes onto in-memory `clsFields.matched_template_id` + `clsFields.contract_period` BEFORE Step 4 target operations. This is what lets Step 4's `applyPeriodSuffixToDocFields` see the modal-supplied period. DL-397's existing Step-5 sync stays (idempotent).

- **Path 2 (general_doc create):** wrapped fields literal in `applyPeriodSuffixToDocFields(..., clsFields)` for defense-in-depth (no-op for non-rental templates).

- **Path 3 (search-by-template):** rewritten to **prefer `Required_Missing` placeholders** over Received rows. Originally also auto-waived sibling generic stubs as a bug-4 dedup-on-fill behavior, but reverted (see Bug 4 design pivot below) — sibling stubs can represent distinct future contracts and the system shouldn't decide for the user.

- **Path 3 create-on-the-fly:** same `applyPeriodSuffixToDocFields` wrap.

- **Standard reassign UPDATE branch:** now includes `issuer_name` / `issuer_name_en` / `document_key` / `document_uid` in the patch when target template is T901/T902 + contract_period present. Uses target's current values as the starting input to the helper so the strip-then-reapply produces correct output regardless of whether the target was a periodless stub or a period-carrying row.

- **Keep_both:** `baseTitle` now strips both `— [H:part] N` AND any prior `<b>MM.YYYY-MM.YYYY</b>` before counting siblings. `baseKey_r` strips `_M-M(_partN)?` from the target's UID. New row is constructed with `_partN` suffix, then `applyPeriodSuffixToDocFields(newDocFields, clsFields)` stamps the MODAL'S new period (via the early-synced `clsFields.contract_period`) in. The `existingDocs` filter switched from `{issuer_name} = '<stripped>'` (which would never match because target's issuer_name includes the period) to `FIND('<stripped>', {issuer_name})` so siblings are correctly counted across different periods of the same base title.

- **Step 6 OneDrive rename (reassign branch):** after computing `newFilename` via `resolveOneDriveFilename`, also PATCH `classifications.expected_filename` so the AI-review tab reflects the new target (fixes T501→T902 staleness). Non-fatal on failure.

**Frontend — `frontend/admin/js/modules/dl410-silent-refresh.js`:**

- **New `stripPeriod(s)` helper** strips both `<b>MM.YYYY-MM.YYYY</b>` and bare ` MM.YYYY-MM.YYYY` from a label.
- **`insertReassignedDocAndRefresh`** now calls `stripPeriod(data.matched_short_name || data.doc_title)` before appending the canonical period. Eliminates the triple-render: `buildShortName` on the server substitutes the period into the short_name_he pattern (yielding period × 1 in `matched_short_name`), and the helper used to append AGAIN; with the strip-first guard the final `name_short` carries the period exactly once. Cache-bust `?v=3 → ?v=4`.

**Build & deploy:**

- `cd api && ./node_modules/.bin/tsc --noEmit` — only the two pre-existing errors (DL-397 notes) remain: `src/index.ts:132` Response shape, `src/lib/activity-logger.ts:16` `node:async_hooks`. No new errors.
- No `frontend/admin/js/script.js` line touches → no monolith ratchet impact.
- Cache-bust applied to `dl410-silent-refresh.js` only (script.js not modified).
- After merge to main: `bash .claude/workflows/deploy-worker.sh` from canonical clone.

**Out of scope (deferred):**

- Retroactive cleanup of pre-DL-415 corrupt rows on Documents table (admin can re-do them or run a one-shot fix script later).
- `frontend/admin/js/script.js`'s `formatDocOptionLabel` extraction — proved unnecessary once `name_short` from the server is reliable (period × 1 via `buildShortName`) and the DL-410 helper no longer compounds. If pre-existing corrupt rows surface in the dropdown, revisit with a client-side strip in `getDisplayName`.
- Stub generator (questionnaire/n8n workflow path that creates the initial Required_Missing rows) — bug 4 fix lives at the fill-time path; preventing duplicate STUBS at creation time is a separate concern. Existing T902 dupes on CPA-XXX will be Waived on the next reassign-fill.

**Bug 4 design pivot (during live testing):**

Original spec called for auto-waiving sibling generic stubs when one is filled (Path 1 + Path 3). After implementing both paths and setting up a live test on CPA-XXX with two duplicate generic T902 stubs, the user pushed back: duplicate-looking generic stubs may legitimately represent distinct upcoming contracts (e.g. two rental properties pending). Auto-waiving is a destructive guess the system shouldn't make. **Both auto-dedup paths reverted.** Sibling stubs stay `Required_Missing` after fill; office can waive manually if they're truly noise. The original "Bug 4" symptom (CPA-XXX having 2 identical missing T902 rows) is therefore acknowledged but treated as expected: the stub generator can legitimately emit per-instance placeholders.

**Research principles applied:**

- **Atomic propagation** (DL-397 carry-over): `applyPeriodSuffixToDocFields` is invoked inside the same handler that writes the classification record — no half-state where the cls has the period but the doc row doesn't.
- **SSOT for label rendering**: `issuer_name` (with `<b>...</b>`) is the canonical form, written once via the helper. `buildShortName` extracts it for `name_short`, no other code appends.
- **Reuse over reinvent**: `getRentalPeriodLabel()` was already producing the canonical HTML and filename suffix — the new helper just packages strip+reapply around the same data.
- **Period-aware conflict trigger** (shadcn.io / KDE source pattern): the dialog still fires when conflict is real (overlapping or unparseable), but silent keep_both for clearly-different periods kills the friction the user surfaced.
- **In-place UPDATE over INSERT-new** when a user-chosen target is a missing placeholder: matches user intent ("I picked THIS row, fill it") and stops the duplicate proliferation we saw on CPA-XXX.
