# Design Log 198: Admin Upload Document Per Row
**Status:** [DRAFT]
**Date:** 2026-03-26
**Related Logs:** DL-035 (WF05 AI classification + OneDrive upload), DL-045 (doc manager status/file actions), DL-137 (OneDrive rename)

## 1. Context & Problem
Currently, client documents arrive **only via email** — clients send files to `reports@moshe-atsits.co.il`, n8n WF05 processes them (AI classify + OneDrive upload). There is no way for Natan to upload a file directly from the document-manager UI. This forces a roundabout workflow when Natan receives a document outside of email (e.g., WhatsApp, in-person, phone photo) — he must email it to himself or manually upload to OneDrive and link it in Airtable.

**Goal:** Add an upload button per document row in the admin document-manager, allowing Natan to upload a file directly. The file goes to OneDrive, the document status auto-sets to "Received", and Airtable is updated with the file reference.

## 2. User Requirements
*Q&A from discovery phase:*
1. **Q:** Who should be able to upload files?
   **A:** Admin only (Natan via document-manager.html). Clients continue sending via email.

2. **Q:** Where should the upload endpoint live?
   **A:** Cloudflare Workers API (existing `api/src/routes/`). Already has MS Graph auth, Airtable access, and admin token validation.

3. **Q:** Should the upload go through AI classification?
   **A:** Skip AI. Admin picks the doc row -> uploads file -> goes directly to OneDrive with the correct doc name. No classification needed.

4. **Q:** After upload, should the doc status auto-change to Received?
   **A:** Yes, auto-set to "Received" in Airtable.

## 3. Research

### Domain
File Upload UX, MS Graph OneDrive API, Cloudflare Workers binary handling

### Sources Consulted
1. **"Form Design Patterns" (Adam Silver)** — One file input per conceptual item; show filename immediately after selection; inline error messages next to the control that failed; drag-and-drop only as enhancement, never sole method.
2. **Nielsen Norman Group (File Upload Design Patterns)** — Visibility of upload progress per-row (heuristic #1); three-state feedback loop (idle/uploading/complete); don't block rest of UI during upload; error recovery should be zero-effort (preserve file reference for retry).
3. **Real-world products (DocuSign, Notion, Linear)** — Compact upload trigger (icon button in row); inline progress within row; row height stays stable; completion replaces trigger with file info.
4. **MS Graph API docs** — Simple PUT for < 4MB (`/drives/{id}/items/{parentId}:/{filename}:/content`); resumable upload sessions for > 4MB; `Content-Type: application/octet-stream`; conflict behavior via query param.

### Key Principles Extracted
- **One input per document:** Each row gets its own upload button — no batch-upload-then-assign flow
- **Inline feedback:** Progress/success/error shown within the row, not global banners
- **Non-blocking:** Uploading one row shouldn't block interactions with other rows
- **Stable row height:** Replace content in-place, don't expand rows during upload
- **Client-side validation first:** Check file size and type before upload starts

### Patterns to Use
- **Three-state button:** Idle (upload icon) -> Uploading (spinner) -> Complete (checkmark, then transitions to normal Received state with file links)
- **Simple PUT upload:** Tax documents are always < 4MB (PDFs, images, scans). No need for resumable upload sessions.
- **Stream-through proxy:** Worker receives file as binary, streams it to MS Graph PUT. No buffering needed.

### Anti-Patterns to Avoid
- **Global upload modal:** Tempting to build a single upload dialog, but it breaks the per-row mental model. Each doc has specific context (name, status) that should stay visible during upload.
- **Drag-and-drop only:** Invisible to keyboard users and doesn't work well on mobile. Always provide a click button.
- **Immediate save pattern:** Don't wire upload into the existing "Save Changes" flow. Upload should be immediate and independent — the file goes to OneDrive right away, not queued with other changes.

### Research Verdict
Simple per-row upload button with immediate upload to OneDrive via Workers API. No AI classification. Auto-mark as Received. Client-side validation for file size (10MB max) and allowed types (PDF, images, common office formats).

## 4. Codebase Analysis

### Existing Solutions Found
- **MSGraphClient** (`api/src/lib/ms-graph.ts`): Has GET/POST/PATCH but no PUT for binary upload. Need to add `putBinary()` method.
- **DRIVE_ID** constant (`api/src/lib/classification-helpers.ts:15`): Same OneDrive drive used for all file operations.
- **Airtable update pattern** (`api/src/routes/edit-documents.ts`): Bearer token auth, `airtable.updateRecord()` for single record updates.
- **Document row rendering** (`document-manager.js:408-449`): Each row has `.doc-name-group` with download/view buttons. Upload button fits naturally here.
- **File action button styles** (`.file-action-btn` in `document-manager.css:761-783`): Existing style for download/view icons — reuse for upload.

### Reuse Decision
- **Reuse:** MSGraphClient (extend with `putBinary()`), AirtableClient, token verification, error logging, CORS middleware, `.file-action-btn` CSS class
- **New:** Upload route handler, `putBinary()` method, frontend upload button + progress UI, hidden `<input type="file">` per-row

### Relevant Files
| File | Purpose |
|------|---------|
| `api/src/lib/ms-graph.ts` | Add `putBinary()` method |
| `api/src/routes/upload-document.ts` | New route (POST `/webhook/upload-document`) |
| `api/src/index.ts` | Register new route |
| `api/src/lib/types.ts` | Env already has all needed bindings |
| `github/.../assets/js/document-manager.js` | Add upload button per row + upload logic |
| `github/.../assets/css/document-manager.css` | Upload button + progress styles |
| `github/.../shared/endpoints.js` | Add UPLOAD_DOCUMENT endpoint |

### Existing Patterns
- All routes use Hono, return `{ ok: boolean }`, use Bearer token auth
- MS Graph operations use `DRIVE_ID` constant and auto-retry on 401
- Frontend uses `fetchWithTimeout()` for API calls
- File action buttons use `.file-action-btn` class, hidden until row hover

### Alignment with Research
- Codebase patterns align well with research: per-row actions are already the pattern (status, notes, rename), adding upload follows the same model
- MSGraphClient's auto-retry on 401 handles token expiry during upload gracefully

## 5. Technical Constraints & Risks

### Security
- Admin-only: Bearer token auth (same as edit-documents)
- File size limit: 10MB max (enforced client-side AND server-side)
- Allowed file types: PDF, images (JPEG/PNG/HEIC), Office docs (XLSX/DOCX), TIF
- No executable file types (.exe, .bat, .js, etc.)

### Risks
- **OneDrive folder structure:** Need to determine which folder the file goes into. The client's year folder should already exist (created by WF05 or doc service). If it doesn't exist, we need to handle that gracefully.
- **File naming:** Use the document's display name (sanitized) as the OneDrive filename. Could collide with existing files — use `conflictBehavior=rename`.
- **CORS:** Workers CORS middleware already allows POST + Authorization header. FormData content type will need to be allowed (it's `multipart/form-data`, not `application/json`).

### Breaking Changes
None — purely additive feature.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

**Frontend (document-manager.js):**
1. Add hidden `<input type="file">` and upload button (upload icon) per document row
2. On click: trigger file input, validate file (size < 10MB, allowed type)
3. Show inline spinner replacing upload button
4. POST file as `multipart/form-data` to `/webhook/upload-document` with fields: `doc_id`, `report_id`, `file` (binary)
5. On success: replace spinner with checkmark, update row to show download/view links, update status badge to "Received"
6. On error: show inline error with retry option

**API (upload-document.ts):**
1. Auth: verify admin Bearer token
2. Parse multipart form data: extract `doc_id`, `report_id`, `file`
3. Validate: file size, file type, doc_id belongs to report_id (Airtable lookup)
4. Fetch report record to get client name + year (for OneDrive path)
5. Determine OneDrive path: `{client_name}/{year}/מסמכים שזוהו/{sanitized_doc_name}.{ext}`
6. Upload file to OneDrive via MS Graph PUT (simple upload, < 4MB)
7. Update Airtable document record: `file_url`, `onedrive_item_id`, `uploaded_at`, `status` = "Received"
8. Return `{ ok: true, file_url, download_url, onedrive_item_id }`

**MSGraphClient (ms-graph.ts):**
1. Add `putBinary(path, body, contentType)` method — same auth/retry pattern as existing methods but sends raw binary body with `Content-Type: application/octet-stream`

### Data Structures / Schema Changes
No Airtable schema changes needed — `file_url`, `onedrive_item_id`, `uploaded_at`, `status` fields already exist on Documents table.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/ms-graph.ts` | Modify | Add `putBinary()` method for binary file upload |
| `api/src/routes/upload-document.ts` | Create | New POST endpoint for file upload |
| `api/src/index.ts` | Modify | Import and mount upload-document route |
| `api/src/middleware/cors.ts` | Modify | Add PUT to allowed methods (for future use) — actually POST is sufficient |
| `github/.../shared/endpoints.js` | Modify | Add `UPLOAD_DOCUMENT` endpoint URL |
| `github/.../assets/js/document-manager.js` | Modify | Add upload button per row + upload handler |
| `github/.../assets/css/document-manager.css` | Modify | Add upload button + progress/success/error styles |
| `github/.../document-manager.html` | Modify | Add hidden file input template element |

### Final Step (Always)
* **Housekeeping:** Update design log status -> `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan
* [ ] Upload a PDF file for a "Required_Missing" document — verify file appears in OneDrive under correct folder
* [ ] Verify Airtable document record updated with `file_url`, `onedrive_item_id`, `uploaded_at`, `status = Received`
* [ ] Verify download/view links appear in the row after upload
* [ ] Verify status badge changes to "Received" after upload
* [ ] Test file size validation: try uploading > 10MB file — should show inline error
* [ ] Test file type validation: try uploading .exe — should be rejected
* [ ] Test upload for a doc that already has a file (Received status) — should replace/rename in OneDrive
* [ ] Test error handling: disconnect network during upload — verify retry button appears
* [ ] Test concurrent uploads: upload files for two different docs simultaneously
* [ ] Verify upload button is hidden for waived documents
* [ ] Test with image files (JPEG, PNG) — verify correct upload and preview

## 8. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
