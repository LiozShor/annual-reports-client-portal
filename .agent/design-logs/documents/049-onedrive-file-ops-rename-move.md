# Design Log 049: OneDrive File Operations — Rename, Move, DOCX Extraction
**Status:** [COMPLETED]
**Date:** 2026-02-23
**Related Logs:** [048-onedrive-rename-dedup-improvements](048-onedrive-rename-dedup-improvements.md), [035-wf05-ai-classification-onedrive-upload](035-wf05-ai-classification-onedrive-upload.md), [043-ai-review-card-redesign](043-ai-review-card-redesign.md)

## 1. Context & Problem

Files uploaded to OneDrive by WF[05] kept their original attachment names (e.g., `scan003.pdf`) even when AI classification identified the document type and issuer. The `expected_filename` was computed but only used at upload for high-confidence matches. When Natan reviewed classifications, no rename or folder move happened. Additionally, DOCX files with embedded images (scanned docs pasted into Word) failed classification because only text was extracted.

**Problems addressed:**
- Files uploaded with uncertain issuer included wrong issuer in filename
- No rename on review approval (to add confirmed issuer)
- No rename on reassignment (to match target template)
- No folder move when assigning unmatched docs (stayed in `ממתינים לזיהוי`)
- Duplicate type name bug: filename showed "טופס 106 – טופס 106 – ..."
- "Approve anyway" button on issuer-mismatch cards was confusing
- Loading text showed "משייך מחדש" for first-time assignments
- DOCX files with only images (no text) couldn't be classified

## 2. User Requirements

1. **Q:** When AI isn't sure about the issuer (multiple candidates), should the filename include the issuer?
   **A:** No. Upload as type-only (e.g., "טופס 106.pdf"). Add issuer on review when confirmed.

2. **Q:** What about the "approve anyway" button on issuer-mismatch cards?
   **A:** Remove it — unclear what it does.

3. **Q:** Loading text for first-time assignments?
   **A:** Should say "משייך..." not "משייך מחדש..."

4. **Q:** Where should files move on each review action?
   **A:**
   - Approve (matched, from זוהו) → Stay in זוהו (rename only)
   - Assign (unmatched, from ממתינים לזיהוי) → Move to זוהו + rename
   - Reject (from either) → Move to ארכיון

5. **Q:** Can we classify DOCX with embedded images?
   **A:** Yes, extract images from DOCX ZIP structure and send to Claude as image content blocks.

## 3. Research

### Domain
File management automation, OneDrive Graph API, document ZIP formats

### Sources Consulted
1. **Microsoft Graph API — DriveItem PATCH** — Single PATCH call can rename (`name`) and move (`parentReference.id`) simultaneously. `@microsoft.graph.conflictBehavior=rename` adds suffix on conflict.
2. **DOCX ZIP structure** — DOCX files are ZIP archives. Images stored in `word/media/`. DEFLATE (method 8) or STORE (method 0) compression.
3. **Prior design log 035** — Original WF[05] architecture, classification flow, folder structure.

### Key Principles Extracted
- Use `onedrive_item_id` (permanent) for all file ops — filenames/paths can change without breaking references
- Single PATCH for rename+move is atomic — no intermediate state
- `conflictBehavior=fail` on folder creation = idempotent (try create, fall back to GET)
- DOCX image extraction needs pure-JS inflate since n8n Code nodes don't have `zlib`

### Research Verdict
All operations use standard Graph API patterns. The existing workflow already had the archive move chain (Get File Location → Get Year Folder → Create Archive → Get Archive → Build Move Body → Move/Rename). Extended same pattern for zohu folder resolution.

## 4. Codebase Analysis

### WF[05] Inbound Document Processing (`cIa23K8v1PrbDJqY`)
- **Process and Prepare Upload** — computes `expectedFilename` using `HE_TITLE[template] + issuer`
- **Prepare Attachments** — extracts content from PDFs, images, DOCX for Claude classification
- `issuerMatchQuality` field: `exact`, `single`, `fuzzy`, `mismatch`, or null

### Review Classification (`c1d7zPAmHfHM71nV`)
- **Prepare File Move** — computes rename/move parameters (no API calls)
- **Build Move Body** — builds PATCH body from Prepare File Move output
- **Move/Rename File** — HTTP PATCH to OneDrive
- Archive chain: Get File Location → Get Year Folder → Create Archive Folder → Get Archive Folder
- `cls.issuer_name` = AI-detected issuer (just the name, e.g., "עיריית תל אביב")
- `cls.matched_doc_name` = full document title from Airtable (e.g., "טופס 106 של **משה** לשנת 2025 מ**עיריית תל אביב**")

### Admin Panel (`admin/js/script.js`)
- `approveAIDespiteMismatch()` — dead function for "approve anyway" button
- `submitAIReassign()` — handles all assignment/reassignment actions
- `quickAssignFromComparison()` — assigns from radio button comparison list

## 5. Technical Constraints & Risks

* **Data field confusion:** `cls.matched_doc_name` is the FULL document title (not just issuer). Using it as issuer caused duplicate type names. Must use `cls.issuer_name` instead.
* **Folder existence:** `זוהו` folder might not exist for clients with only unmatched docs. Fixed with Create → Get pattern (same as archive).
* **Unmatched detection:** `cls.matched_template_id === null` reliably indicates file is in `ממתינים לזיהוי`.
* **DOCX inflate:** n8n Code nodes lack `zlib`. Used existing pure-JS `inflateRaw` (tiny-inflate port already in Prepare Attachments).

## 6. Proposed Solution (The Blueprint)

### A. Conditional Filename at Upload (WF[05])
- Include issuer in `expectedFilename` ONLY when `issuerMatchQuality === 'exact' || 'single'`
- Uncertain matches (fuzzy/mismatch): type-only name (e.g., "טופס 106.pdf")

### B. Rename on Review (Review Classification)
- **Approve:** If `issuer_match_quality` not exact/single → rename to `HE_TITLE + cls.issuer_name`
- **Reassign:** Rename to `HE_TITLE[target_template] + cls.issuer_name`
- **Reject:** No rename (just move)

### C. Folder Move on Review
- **Approve:** No move (stays in `זוהו`)
- **Assign unmatched:** `move_to_zohu = true` → moves from `ממתינים לזיהוי` to `זוהו`
- **Reject:** `move_to_archive = true` → moves to `ארכיון`

### D. New Nodes Added
- **Create Zohu Folder** — POST `{driveId}/items/{yearFolderId}/children` with `{name: "זוהו", conflictBehavior: "fail"}`
- **Get Zohu Folder** — GET `{driveId}/items/{yearFolderId}:/זוהו:`

### E. DOCX Image Extraction (WF[05])
- When DOCX has no text: parse ZIP structure, extract images from `word/media/`
- Send as `image` content blocks to Claude (max 3 images)

### F. Admin UI Cleanup
- Remove "אשר בכל זאת" buttons
- Add `loadingText` parameter to `submitAIReassign`
- First-time assignments use "משייך..." instead of "משייך מחדש..."

### Files Changed

| File / Node | Action | Description |
|------|--------|-------------|
| WF[05] Process and Prepare Upload | Modify | Conditional issuer in expectedFilename |
| WF[05] Prepare Attachments | Modify | Add `extractDocxImages()` for DOCX with embedded images |
| Review Classification: Prepare File Move | Modify | Fix duplicate bug (use `cls.issuer_name`), add `move_to_zohu` flag |
| Review Classification: Build Move Body | Modify | Handle `move_to_zohu` with zohu folder resolution |
| Review Classification: Create Zohu Folder | Create | HTTP POST to create זוהו folder |
| Review Classification: Get Zohu Folder | Create | HTTP GET to resolve זוהו folder ID |
| `admin/js/script.js` | Modify | Remove approve-anyway, fix loading text |

## 7. Validation Plan

* [x] Matched doc with exact/single issuer → uploads with issuer in filename
* [x] Matched doc with fuzzy/mismatch issuer → uploads as type-only filename
* [x] Approve type-only file → renames to include issuer (no duplicate type name)
* [x] Assign unmatched doc → renames + moves from ממתינים לזיהוי to זוהו
* [x] Reject doc → moves to ארכיון
* [x] No "אשר בכל זאת" button visible on issuer-mismatch cards
* [x] First-time assignment shows "משייך..." loading text
* [x] DOCX with embedded images → images extracted and sent to Claude
* [ ] E2E test: full cycle upload → classify → approve → verify filename + folder
* [ ] E2E test: full cycle upload → classify → reject → verify file in ארכיון

## 8. Implementation Notes

* **Bug found during implementation:** `cls.matched_doc_name` contains the FULL formatted document title (e.g., "טופס 106 של **משה** לשנת 2025 מ**עיריית תל אביב**"), not just the issuer. Using it in `heTitle + ' – ' + cleanIssuer` produced "טופס 106 – טופס 106 של משה מעיריית תל אביב.pdf". Fixed by switching to `cls.issuer_name` which contains only the AI-detected issuer.
* **Reassign filename:** Previously used `targetDoc.issuer_name` (also a full title). Changed to `HE_TITLE[target_template] + cls.issuer_name` for consistent short filenames.
* **Folder move chain:** Extended existing archive chain with 2 new nodes (Create Zohu Folder + Get Zohu Folder) inserted between Get Archive Folder and Build Move Body. Same pattern (POST create with conflictBehavior=fail → GET by path).
* **Workflow now has 24 nodes** (was 22). Connection chain: `...Get Archive Folder → Create Zohu Folder → Get Zohu Folder → Build Move Body → Move/Rename File → Update File URLs`
* Commits: `8790a9b` (admin UI fixes), n8n MCP updates for WF[05] and Review Classification.
