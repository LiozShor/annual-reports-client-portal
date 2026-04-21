# Design Log 314: Multi-Template Match in AI Review
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-21
**Related Logs:** DL-222 (multi-PDF approve conflict — merge/keep/override), DL-239 (cross-filing reassign), DL-248 (reassign clears unrelated approval), DL-205 (clear fields on status revert), DL-070 (reassign conflict guard), DL-235/240 (OneDrive folder restructure, archive at year level), DL-226 (dual filing classification)

## 1. Context & Problem
Admin reports some uploaded PDFs legitimately satisfy multiple template slots at once (e.g., a single bank statement covers both templates 106 and 107; a joint-account statement covers client + spouse). The current AI Review flow is strictly 1:1 — approving a classification produces exactly one document record pointing at the OneDrive file. Admin has no way to say "this same file is also templates X and Y" without re-uploading or faking duplicates.

**Intended outcome:** one AI Review card approval → N document records, all sharing the same `file_url` + `onedrive_item_id` + `file_hash`, spanning any person or filing type on the client. Reverting one record leaves siblings intact; reverting the last record moves the OneDrive file to `archive-folder` via the existing helper.

Concrete failure today: one-off bank statement containing rows for multiple tax forms → admin must either (a) ignore the multi-coverage and mark missing slots as waived (lossy), or (b) re-upload the PDF via email N times (ugly, breaks dedup via `file_hash`). Neither is acceptable.

## 2. User Requirements
1. **Q:** How should the UI let admin pick the additional templates to match?
   **A:** "Also matches..." multi-select picker on the AI Review card.
2. **Q:** OneDrive storage model for N-linked records?
   **A:** Single file, N Airtable document records pointing at the same `onedrive_item_id` / `file_url`.
3. **Q:** Allowed template combinations?
   **A:** Any two+ templates on the same client, any person (client + spouse allowed). Cross-category allowed.
4. **Q:** Allow AR ↔ CS (cross-filing) matches?
   **A:** Yes — allow. Accept the OneDrive routing caveat (file physically lives in source filing type's folder; sibling record references across).
5. **Q:** Revert/undo semantics for one of N records?
   **A:** Unlink only that one record (clear its file fields). Siblings untouched.
6. **Q:** When the LAST record sharing the file is unlinked/deleted?
   **A:** Move the OneDrive file to `archive-folder` (reuse existing `moveFileToArchive` helper).

## 3. Research
### Domain
Multi-label document classification (admin tooling), reference counting for shared file resources, document management UX for one-to-many assignment.

### Sources Consulted
1. **AWS SageMaker / Amazon Comprehend multi-label docs** — Standard pattern for one artifact → N classes is metadata records per class, not file duplication.
2. **Reference counting (Wikipedia + Convex Agent + Windows MSI shared-DLL refcount)** — Decrement on unlink; delete (or archive) physical resource at count = 0. Classic Unix inode / hard-link semantics apply.
3. **SharePoint metadata-vs-folders best practices (SharePoint Maven, Konnect, Joanne C. Klein)** — For one-to-many classification, prefer metadata records over duplicating files across folders; duplication creates update-drift and storage bloat.

### Key Principles Extracted
- **Metadata over duplication** — one physical file + N metadata records beats N copies (SharePoint / Comprehend consensus). Aligns with user's choice: single `onedrive_item_id`, N Airtable rows.
- **Reference counting must be atomic enough** — for our volume (single-admin ops, sub-10/minute) a simple `filterByFormula: {onedrive_item_id} = "X"` count check-then-act is acceptable. No distributed-lock needed.
- **Show the link, don't hide it** (DL-222 principle) — admin must see "this file is also linked to X, Y, Z" on every surface, or they'll accidentally treat siblings as independent and get surprised on revert.
- **Conflict on each target** — extending approve to N targets must run the DL-222 conflict guard N times (once per target), not once. Admin resolves per-target.

### Patterns to Use
- **Per-target conflict guard** — run DL-222 / DL-070 guard for each additional template; return an aggregated `conflicts[]` array so frontend can show one merged 3-option dialog or defer.
- **Reference-count gate on archive** — wrap every existing call site of `moveFileToArchive(onedrive_item_id)` in `if (await countSiblings(onedrive_item_id, ctx) <= 1)`.
- **Clear-on-revert (DL-205)** — scoped to the single record only; do NOT cascade to siblings.

### Anti-Patterns to Avoid
- **File duplication per template** — user rejected in Phase A. SharePoint docs back this: duplication creates update drift (re-issued statement = orphaned copies).
- **Array-field on one record** (`matched_template_ids[]` on a single doc) — would force rewrite of doc-manager, reminders, print, rollups (stage pipeline assumes 1 doc = 1 template). Too invasive for marginal gain.
- **Implicit/automatic multi-match from classifier** — out of scope. This is a MANUAL admin action only.

### Research Verdict
N document records sharing one OneDrive file is the right model. Add a lightweight reference counter (Airtable filter-query) on archive trigger points. Extend existing combobox into multi-select. No new schema fields required.

## 4. Codebase Analysis

### Existing Solutions Found (from explore-agent scan)
- **Frontend AI Review card actions** (`frontend/admin/js/script.js`):
  - `approveAIClassification(recordId)` — line 4733 (approve + conflict dialog)
  - `showAIReassignModal(recordId)` — line 5100 (opens reassign combobox)
  - `submitAIReassign(...)` — line 5169 (POST `/review-classification` action=`reassign`)
  - `transitionCardToReviewed(...)` — line ~4628
  - `createDocCombobox(container, docs, {...})` — line 3293+ (shared combobox, already supports `otherDocs` + `ownFilingType`/`otherFilingType` cross-filing toggle per DL-239)
- **Backend** (`api/src/routes/classifications.ts`):
  - POST `/review-classification` — line 413; per-action branch
  - Approve path: conflict guard lines 966-980, doc create/update lines 1066-1075
  - Reassign path: conflict guard lines 472-484, target resolution lines 1250-1278, archive-on-override line 1378-1380
  - Pending classifications feed (AI Review data source): GET `/get-pending-classifications` line 80 — emits `all_docs[]` + `other_report_docs[]` + `filing_type` / `other_filing_type` per card
- **OneDrive helper**: `moveFileToArchive(msGraph, itemId)` — already exists in `api/src/routes/classifications.ts` lines 21-56. Handles parent→year→archive-folder hop (DL-235/240-aware). Reuse as-is.
- **Doc fields**: `file_url`, `onedrive_item_id`, `file_hash`, `document_uid`, `document_key`, `review_status`, `status` (per `api/src/lib/doc-builder.ts:18`).

### Reuse Decision
- **Combobox** (`createDocCombobox`): extend with optional `multiSelect: true` mode — checkbox column, array of selected template IDs in `data-selectedValues`. Keep single-select default for reassign.
- **Conflict guard**: extract the inline guard logic (duplicated between approve and reassign paths) into a small helper `checkTargetConflict(targetDoc)` → returns `{conflict, existing_file}`. Reuse inside the new multi-match loop.
- **`moveFileToArchive`**: reuse as-is. Wrap its call sites behind a new `isLastReference(itemId)` gate.
- **Frontend conflict dialog**: DL-222's 3-option `showConfirmDialog` variant — reuse, invoked per-target with the per-target conflict.

### Relevant Files
| File | Role |
|------|------|
| `api/src/routes/classifications.ts` | Add `action='also_match'` branch + refcount gate |
| `api/src/lib/doc-builder.ts` | No field changes; possibly expose `createDocRecord()` helper if inline logic needs extraction |
| `frontend/admin/js/script.js` | New `showAIAlsoMatchModal()` + `submitAIAlsoMatch()`; small "Also matches..." button on card; extend `createDocCombobox` with `multiSelect` |
| `frontend/admin/js/script.js` (doc-manager) | Display "🔗 N-way linked" chip on document rows whose `onedrive_item_id` is shared |
| `api/src/routes/clients.ts` (or wherever `/get-client-reports` lives) | Include `shared_ref_count` or `linked_doc_record_ids[]` per doc |
| Documents table | **No schema change.** `onedrive_item_id` becomes the multi-record key. |

### Alignment with Research
- SharePoint "metadata over duplication" maps 1:1 to our Airtable-rows-per-template approach.
- Reference counting pattern matches Convex/MSI: decrement on unlink, archive at count = 0.
- We deviate from pure ref-counting in one place: we **archive** rather than **delete** on count = 0 (user choice). That's an application-level policy on top of refcount; still standard.

### Dependencies
- Airtable Documents table (`tblXXX` — already exists, no schema change)
- MS Graph `moveFileToArchive` (exists)
- Admin auth token (existing)
- No new npm packages

## 5. Technical Constraints & Risks

### Security
- No new auth surface; reuses admin token on `/review-classification`.
- Action must validate: all additional `template_ids` belong to the same `client_id` as the classification's source report (prevent cross-client leakage). Server-side guard in the handler.

### Risks
| Risk | Mitigation |
|------|-----------|
| Race: two admins revert siblings at same moment, both see `count=1`, both call `moveFileToArchive` | Single-admin system today (Natan). Accept. If it becomes an issue: make archive a POST to a Worker route that does atomic check-then-move with a short KV lock. |
| Admin unlinks sibling A not knowing B references same file, is confused when B still shows the file | UI chip "🔗 קשור ל-X מסמכים נוספים" on doc rows. Hover → list the linked template names. |
| Cross-filing (AR↔CS) link: file lives in one root; the other filing type's doc row points "across" — when AR root is reorganized, CS sibling's `file_url` would drift | `file_url` is resolved on-demand from `onedrive_item_id` in existing flow (view/download). File URL in Airtable is a cached copy. Add a background resolver if stale (out of scope; flag in Section 7). |
| Conflict-guard explosion: admin picks 4 extra templates, all 4 have received docs already → 4 conflict dialogs | v1 aborts the whole op if ANY conflict, with toast `"X מסמכים כבר קיימים, בטל את הסימון שלהם או השתמש ב'שינוי שיוך' פרטני"`. Admin uses single-target reassign/keep-both for those. Log as future refinement. |
| Archive helper fails mid-multi-record-delete leaving orphan file but zero records | Rare. On failure: log error via `logError()`, leave a "doc_file_orphan" flag somewhere. Low priority. |
| Stage-pipeline assumes one doc per template per person — we maintain that. N records = N distinct templates (no two records same template+person). Guard on frontend: filter already-satisfied templates out of the picker. | |

### Breaking Changes
- None. `onedrive_item_id` already exists and isn't currently guaranteed unique in queries; we're just starting to treat it as a shared key.
- Existing delete/revert flows at: (a) reassign-override lines 1378-1380, (b) DL-205 clear-on-revert, (c) admin doc-manager "delete file" flow — all must gain the refcount gate or they'll archive a file still referenced by siblings. **This is the biggest correctness risk.**

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Admin can click "Also matches..." on an AI Review card, pick 1+ additional templates (optionally spanning spouse / cross-filing), confirm, and see N document records created, all sharing the same OneDrive file. Reverting any single record clears only that record; reverting the final record archives the file.

### Logic Flow

**Frontend (new action: Also matches):**
1. AI Review card renders. Next to existing "Approve" button, add **"גם תואם ל..."** button.
2. Click opens modal (`showAIAlsoMatchModal(classification_id)`).
3. Modal fetches card's own report's `all_docs` + `other_report_docs`.
4. Modal renders multi-select checkbox list, grouped by person (client / spouse) and then by category. Filter out templates already satisfied.
5. Admin ticks N templates, clicks "שייך לכל המסמכים".
6. Frontend pre-checks: any ticked template has an already-Received sibling doc? → block with toast.
7. POST `/webhook/review-classification` with `action='also_match'`, body: `{ classification_id, additional_targets: [{ template_id, doc_record_id?, target_report_id? }, ...] }`.
8. On success: close modal, call `transitionCardToReviewed`. Toast `"שויך ל-N מסמכים"`.

**Backend (`action='also_match'`):**
1. Fetch classification record by `classification_id`.
2. Validate: classification must have a primary `matched_template_id` already approved OR this is the first approve.
3. Load all additional target reports → verify every `target_report_id` belongs to the same `client_id` as source report. Reject if mismatch.
4. For each `additional_target`:
   - Run `checkTargetConflict` → if conflict, abort entire batch with `{ok: false, conflicts: [...]}`.
   - Resolve target doc record (direct ID → general_doc create → template lookup).
   - Write `file_url`, `onedrive_item_id`, `file_hash`, `attachment_name`, `status='Received'`, `review_status='approved_shared'`.
   - Do NOT copy the file in OneDrive. Do NOT call `moveFileToArchive`.
5. Respond `{ ok: true, created_doc_ids: [...], shared_onedrive_item_id }`.

**Backend (reference-count gate on archive):**
1. New helper `async function countDocsSharingFile(onedriveItemId, ctx): Promise<number>` — Airtable query `filterByFormula: AND({onedrive_item_id}='${id}', {status}='Received')`.
2. New helper `async function isLastReference(onedriveItemId, ctx, excludeRecordId): Promise<boolean>` — count > 1 means false.
3. Retrofit ALL archive call sites:
   - Reassign override (classifications.ts:1378-1380)
   - DL-205 clear-on-revert handler
   - Admin doc-manager delete-file flow

**Frontend (shared-link visibility):**
- `/get-client-reports` endpoint: per doc row, add `shared_ref_count: number` and `shared_with_titles: string[]`.
- Doc-manager row: if `shared_ref_count > 1`, render small `🔗` chip with tooltip listing sibling titles.

### Data Structures / Schema Changes
- **No new Airtable fields.** Reuse `onedrive_item_id` as the shared key.
- **API response additions:** `shared_ref_count`, `shared_with_titles[]` on doc rows in `/get-client-reports`; `conflicts[]` on `/review-classification` error responses; `linked_count` on multi-match success.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | Add `action='also_match'` branch. Extract `checkTargetConflict()` helper. Add `countDocsSharingFile()` + `isLastReference()`. Gate archive calls. Validate cross-client. |
| `api/src/routes/clients.ts` (or wherever `/get-client-reports` is) | Modify | Add `shared_ref_count` + `shared_with_titles[]` per doc. |
| `api/src/routes/admin-doc-manager.ts` (or equivalent) | Modify | Gate "delete file" archive call behind `isLastReference`. |
| `frontend/admin/js/script.js` | Modify | Add `showAIAlsoMatchModal`, `submitAIAlsoMatch`. Extend combobox or new multi-select picker. Render `🔗` chip. Add "Also matches..." button. |
| `.agent/design-logs/ai-review/314-multi-template-match.md` | Create | Copy Sections 1-8 of this plan file verbatim. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-314 entry under Active Logs. |
| `docs/architecture/document-processing-flow.mmd` | Modify | Add note / branch for multi-match fanout in the approve path. |

### Final Step (Always)
- **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `.agent/current-status.md` under "Active TODOs", update INDEX, run `wrangler deploy` from `api/`, push branch, **pause for explicit merge approval** (per `feedback_ask_before_merge_push.md`).

## 7. Validation Plan

### Automated / build-time
- [ ] TypeScript compiles: `./node_modules/.bin/tsc --noEmit` from `api/`.
- [ ] Wrangler dry-run: `npx wrangler deploy --dry-run` from `api/`.
- [ ] Existing reassign / approve / conflict-dialog flows still pass (manual — no test suite).

### Live end-to-end (MANDATORY before `[COMPLETED]`)
- [ ] Pick a test client (CPA-XXX) with stage = Collecting_Docs and at least 3 missing templates on the same person.
- [ ] Upload a PDF via email → appears in AI Review as single classification.
- [ ] Approve primary template via existing flow → doc record created, OneDrive file present.
- [ ] Click "גם תואם ל..." → modal shows missing templates → select 2 → confirm.
- [ ] Verify: 2 new Airtable doc records created, all 3 records share same `onedrive_item_id`. OneDrive file NOT duplicated.
- [ ] Verify: doc-manager shows `🔗 קשור ל-2 מסמכים נוספים` chip on each of the 3 rows.
- [ ] Cross-person: Repeat with one selection being a spouse template.
- [ ] Cross-filing (AR → CS): multi-match one of its templates → verify CS doc created with same item_id.
- [ ] Revert middle record: verify sibling fields cleared, OneDrive file still present, other siblings intact.
- [ ] Revert primary (now last): verify file moved to `archive-folder` folder at correct year level.
- [ ] Conflict guard: multi-match picker preselects a template that's already Received → v1 blocks with toast.
- [ ] Cross-client leak guard: tamper POST body with `target_report_id` from DIFFERENT client → server rejects with 400.

### Regression
- [ ] Existing 1:1 approve flow works unchanged.
- [ ] Existing reassign / keep-both / override flow works unchanged (DL-222 paths).
- [ ] Existing single-file delete from doc-manager still archives correctly when no siblings.

## 8. Implementation Notes (Post-Code)

**Files changed (this session):**
- `api/src/lib/file-refcount.ts` — NEW. `countDocsSharingFile()`, `isLastReference()`, `buildSharedRefMap()`.
- `api/src/routes/classifications.ts` — added `action='also_match'` handler (fan out one file → N doc records); allow-list updated; gated existing archive calls (approve override + reassign override + reject) behind `isLastReference`.
- `api/src/routes/edit-documents.ts` — NEW archive-on-last-revert: when doc transitions to Required_Missing or Waived and no siblings remain, move OneDrive file to archive-folder via local `moveFileToArchiveInline`. Runs inside `ctx.waitUntil` so it doesn't block the response.
- `api/src/routes/documents.ts` (`/get-client-documents`) — local in-memory `shared_ref_count` + `shared_with_titles[]` per doc row, survives through `groupDocsByPerson` / `formatForOfficeMode`.
- `frontend/admin/js/script.js` — added "גם תואם ל..." button in AI Review card (`state='full'` + `state='fuzzy'`), `showAIAlsoMatchModal` / `closeAIAlsoMatchModal` / `confirmAIAlsoMatch` — checkbox list grouped by own-report + cross-filing-type (own docs + `other_report_docs`). Filters out already-Received docs and the primary matched template.
- `frontend/assets/js/document-manager.js` — `🔗 ×N` chip rendered inside `.doc-name-group` when `doc.shared_ref_count > 1`; tooltip lists sibling issuer_names.
- `frontend/admin/css/style.css` + `frontend/assets/css/document-manager.css` — minimal styling for chip + modal rows.

**Deviations from plan:**
1. **DL-205 archive gating was a no-op** — the existing clear-on-revert code (`edit-documents.ts`) was only clearing fields, never archiving. Plan assumed there was an archive call to gate. Instead, I added *new* archive-on-last-ref behavior (via waitUntil) so the "revert last sibling → file archives" contract actually holds.
2. **Duplicated `moveFileToArchive`** — the helper in `classifications.ts` is not exported. Rather than refactor (broader blast radius), I copied a trimmed inline version into `edit-documents.ts` as `moveFileToArchiveInline`. Flag for a later consolidation pass if a third call site appears.
3. **Frontend "Also matches" button not added to issuer-mismatch state** — that state already steers the admin into per-target disambiguation (radio buttons), and adding a multi-match there would confuse the intent. Admin can still multi-match after approving from mismatch state (it transitions to an approved card where the button is currently *not* re-rendered — this is a gap; see TODO below).

**Open TODOs (move to current-status.md):**
- [ ] Add "Also matches..." button to the *reviewed-approved* card state so admin can multi-match after initial approve (currently only on pre-approve).
- [ ] Live end-to-end test with CPA-XXX per Section 7 checklist before promoting to `[COMPLETED]`.
- [ ] Consider consolidating `moveFileToArchive` into `api/src/lib/onedrive-archive.ts` once a third call site appears.
- [ ] Per-target conflict resolution UI (v1 aborts whole batch) — likely a DL-315 follow-up if admin complains.
- [ ] Backfill `cross-filing file_url drift` audit: when a CS doc references an AR-root file and AR folders get reorganized, the cached `file_url` may go stale. Currently resolved on-demand via `batchResolveUrls` in `/get-client-documents`, so low priority.
