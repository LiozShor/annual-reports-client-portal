# Design Log 222: Multi-PDF Approve Conflict — Merge / Keep Both / Override
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-29
**Related Logs:** DL-070 (guard reassign target doc), DL-112 (webhook dedup)

## 1. Context & Problem
Clients often receive documents (e.g., 106 forms) as multiple separate PDFs. When emailed, WF05 classifies each attachment independently — both get classified as the same type (e.g., T201). The admin approves the first PDF → document status becomes "Received". When they try to approve the second PDF as the same type, the current code **silently overwrites** the first file (no warning, no conflict guard). The conflict guard only exists for `reassign` (DL-070), not for `approve`.

## 2. User Requirements
1.  **Q:** How common is this scenario?
    **A:** Very common — happens regularly with 106, pay slips, bank statements.

2.  **Q:** What should happen with the files on OneDrive?
    **A:** Merge after asking the user. Admin decides: merge, keep both, or override.

3.  **Q:** When should the handling happen?
    **A:** On second approve — when admin approves the 2nd PDF as the same type.

4.  **Q:** Should the admin see a warning/confirmation?
    **A:** Yes — confirm with preview showing file names.

5.  **Q:** For "keep both" — how to handle multiple files?
    **A:** Append suffix to title — create a second document record (e.g., "106 — חלק 2").

6.  **Q:** For merge — page order?
    **A:** Chronological by email received time.

7.  **Q:** Airtable links?
    **A:** After merge, the document record's file_url must point to the merged file. For keep-both, each record gets its own link.

## 3. Research
### Domain
Document Management Systems, PDF Processing, Admin Conflict Resolution UX

### Sources Consulted
1. **pdf-lib** (official docs + GitHub) — Pure JS PDF library, confirmed Workers-compatible. Only `registerFontkit` breaks in Workers (ESM issue), but merge operations use only `ArrayBuffer`/`Uint8Array` — fully safe.
2. **UX patterns for duplicate file upload** (Uploadcare, Carbon Design System, Eleken) — Admin tools: confirmation dialog with explicit options > silent replace. Three-option pattern (replace/merge/keep) is standard when all are valid actions.
3. **Cloudflare workers-sdk#8140** — Confirmed pdf-lib works in Workers for load/merge/save. ~370KB minified, well within 10MB limit.

### Key Principles Extracted
- Show conflict, don't hide it — silent overwrites violate principle of least surprise
- Offer all valid resolutions in one dialog — don't force multi-step workflows
- Chronological ordering for merged content preserves document narrative

### Patterns to Use
- **Conflict guard pattern** — already exists for reassign (DL-070). Mirror it for approve.
- **pdf-lib copyPages** — `PDFDocument.create()` → `copyPages()` → `addPage()` → `save()`

### Anti-Patterns to Avoid
- **Silent overwrite** — current behavior. Admin loses the first file without knowing.
- **Custom PDF parser** — image-to-pdf.ts builds PDFs from scratch, but merging existing PDFs by hand (xref tables, object renumbering) is extremely complex vs. using pdf-lib.

### Research Verdict
Use pdf-lib for merge. Mirror the reassign conflict guard for approve. Three-option dialog in frontend.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - Reassign conflict guard: `classifications.ts:367-379` — returns 409 with `conflict: true`
  - Frontend conflict handler: `script.js:3450-3459` — `showConfirmDialog` with force_overwrite retry
  - MS Graph helpers: `ms-graph.ts` — `getBinary()` (line 44), `putBinary()` (line 96), `delete()` (line 71)
  - SHA-256: `attachment-utils.ts:39` — `computeSha256(content: ArrayBuffer)`
  - `DRIVE_ID` from `classification-helpers.ts`
* **Reuse Decision:**
  - Conflict guard pattern: reuse exactly (copy from reassign, add to approve)
  - MS Graph `getBinary`/`putBinary`/`delete`: reuse for download → merge → upload → cleanup
  - `computeSha256`: reuse for merged file hash
  - `showConfirmDialog`: can't reuse as-is (supports only 1 button). Need new 3-option dialog.
* **Relevant Files:**
  - `api/src/routes/classifications.ts` — approve action (lines 398-448), conflict guard location
  - `api/src/lib/ms-graph.ts` — getBinary/putBinary/delete
  - `api/src/lib/inbound/attachment-utils.ts` — computeSha256
  - `api/src/lib/classification-helpers.ts` — DRIVE_ID
  - `github/annual-reports-client-portal/admin/js/script.js` — approveAIClassification (line 3263)
* **Dependencies:** pdf-lib (new), Airtable documents table, OneDrive via MS Graph

## 5. Technical Constraints & Risks
* **Security:** No new auth surfaces — uses existing admin token.
* **Risks:**
  - Merge of corrupted PDFs — pdf-lib.load() throws on invalid PDFs. Catch and fall back to "keep both" with error toast.
  - Large PDFs — Workers have 128MB memory. Two 50MB PDFs would fail. Unlikely for tax forms (typically < 1MB).
* **Breaking Changes:** None. Existing approve flow works unchanged when no conflict.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Admin can approve a second PDF for the same document type and choose to merge, keep both, or override — with the Airtable file_url correctly pointing to the result.

### Logic Flow

**Backend (classifications.ts):**
1. After `approveDocId` is resolved (line 426), check if target doc's status is `Received` AND has an `onedrive_item_id`
2. If conflict AND no `force_overwrite` → return 409 with conflict info (doc title, existing file item ID, existing attachment name)
3. If `force_overwrite` → check `approve_mode`:
   - `override` (default): current behavior — overwrite file fields
   - `merge`: download both PDFs → merge chronologically → upload merged → update doc → delete redundant file
   - `keep_both`: create new doc record with suffixed title → approve classification against new record

**Merge flow detail:**
1. `msGraph.getBinary(/drives/${DRIVE_ID}/items/${existingItemId}/content)` — existing file
2. `msGraph.getBinary(/drives/${DRIVE_ID}/items/${newItemId}/content)` — new file from classification
3. Order by `uploaded_at` vs `received_at` chronologically
4. `mergePdfs(olderPdf, newerPdf)` via pdf-lib
5. `msGraph.putBinary(/drives/${DRIVE_ID}/items/${existingItemId}/content, mergedBytes)` — overwrite existing file in-place (preserves URL/itemId)
6. `computeSha256(mergedBytes)` → update doc record with new hash
7. `msGraph.delete(/drives/${DRIVE_ID}/items/${newItemId})` — remove redundant source file
8. Update doc record: `file_hash` = new hash (file_url and onedrive_item_id stay the same since we overwrote in-place)

**Keep-both flow detail:**
1. Query existing docs of same type+report to determine part number
2. Create new document record: copy type, category, person, report from existing; append ` — חלק N` to issuer_name
3. Set standard fields: status=Received, file_url, onedrive_item_id, file_hash, etc.
4. Update classification to point to new doc record

**Frontend (script.js):**
1. In `approveAIClassification`, after `parseAIResponse`, check `data._conflict` BEFORE the `!data.ok` throw
2. Show a custom 3-option dialog with file names visible:
   - "מזג קבצים" (Merge) — primary blue
   - "שמור שניהם" (Keep both) — outline/secondary
   - "החלף קובץ" (Override) — danger red
3. `resubmitApprove(recordId, mode)` re-calls the endpoint with `force_overwrite: true` + `approve_mode: mode`

### Data Structures / Schema Changes
- **New body params** on review-classification: `approve_mode?: 'override' | 'merge' | 'keep_both'`
- **New Airtable document records** only for keep_both — no schema changes, just new records
- **No new Airtable fields** needed

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/package.json` | Modify | Add `pdf-lib` dependency |
| `api/src/lib/pdf-merge.ts` | Create | ~20-line merge utility using pdf-lib |
| `api/src/routes/classifications.ts` | Modify | Add conflict guard + 3 resolution modes to approve action |
| `github/.../admin/js/script.js` | Modify | Add conflict check in approve + 3-option dialog + resubmit helper |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Approve first PDF of same type → works normally (no conflict)
* [ ] Approve second PDF of same type → 409 conflict dialog appears with 3 options
* [ ] Merge option → merged PDF on OneDrive, doc record file_url points to it, redundant file deleted
* [ ] Keep-both option → new doc record with "חלק 2" suffix, both files exist on OneDrive
* [ ] Override option → existing file replaced, doc record updated
* [ ] Three PDFs of same type → third approve shows conflict, merge/keep-both works (part 3)
* [ ] Non-PDF files (e.g., Excel) → merge still works (pdf-lib handles any valid PDF, and office files are already converted to PDF by WF05)
* [ ] Corrupted PDF → merge fails gracefully, shows error toast
* [ ] Card transitions to reviewed state after any resolution
* [ ] No regression: reassign conflict flow still works

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
