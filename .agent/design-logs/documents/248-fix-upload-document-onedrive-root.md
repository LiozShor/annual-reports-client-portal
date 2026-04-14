# Design Log 248: Fix Upload Document — Wrong OneDrive Root Folder Source
**Status:** [COMPLETED]
**Date:** 2026-04-12
**Related Logs:** DL-198 (admin upload per row), DL-235 (folder restructure), DL-240 (remove subfolders)

## 1. Context & Problem
Admin upload in doc-manager.html returns 400: "Report has no OneDrive root folder configured". The endpoint `upload-document.ts:67` reads `onedrive_root_folder_id` from the report record, but this field only exists on the clients table. The reports table has a different field (`onedrive_folder_id`). Additionally, the endpoint duplicated OneDrive path construction logic already available in `attachment-utils.ts`.

## 2. User Requirements
1. **Q:** Which folder ID should the upload use as the base?
   **A:** Client's `onedrive_root_folder_id` — resolved via `resolveOneDriveRoot()` (same as inbound processing).
2. **Q:** Is this feature in production?
   **A:** Yes, was working but broke recently.

## 3. Research
Skipped — straightforward data access bug with an existing correct implementation to reuse.

## 4. Codebase Analysis
* **Existing Solutions Found:** `resolveOneDriveRoot()` and `uploadToOneDrive()` in `attachment-utils.ts` already implement correct OneDrive folder resolution and file upload with proper path construction.
* **Reuse Decision:** Reuse both functions — eliminates duplicated logic and the incorrect Airtable field reference.
* **Root Cause:** `upload-document.ts:67` read `report.fields.onedrive_root_folder_id` — field doesn't exist on reports table (only on clients table). Should use `resolveOneDriveRoot()` which resolves from the shared OneDrive token.

## 5. Technical Constraints & Risks
* **Security:** No change — same auth flow, same OneDrive credentials.
* **Risks:** None — reusing battle-tested helper functions from inbound processing.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Admin can upload files via doc-manager without the 400 error; files land in correct OneDrive folder.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/upload-document.ts` | Modify | Replace broken field read + duplicated logic with `resolveOneDriveRoot()` + `uploadToOneDrive()` |

## 7. Validation Plan
* [ ] Build passes (`wrangler deploy --dry-run`)
* [ ] Deploy to production
* [ ] Upload a test file via doc-manager.html — no 400 error
* [ ] File appears in correct OneDrive folder: `root/clientName/year/filingType/filename`
* [ ] Airtable document record updated: `file_url`, `onedrive_item_id`, status = "Received"

## 8. Implementation Notes
- Replaced imports: removed `DRIVE_ID`, `sanitizeFilename`, `FILING_TYPE_FOLDER`; added `resolveOneDriveRoot`, `uploadToOneDrive`
- `uploadToOneDrive` returns `{ webUrl, itemId, downloadUrl }` — mapped correctly to response fields
- `resolveOneDriveRoot` makes one MS Graph call to resolve the sharing token — same as inbound processing
- Fixed filename: documents table has `issuer_name` not `display_name`/`name` — every file was being saved as "document.pdf"
- Ran one-time URL fix: 31 stale file_url values refreshed, 1 broken (אלביט — file deleted), 10 unchanged
