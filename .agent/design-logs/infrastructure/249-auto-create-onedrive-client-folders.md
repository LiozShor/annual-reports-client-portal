# Design Log 249: Auto-Create Client OneDrive Folders
**Status:** [COMPLETED]
**Date:** 2026-04-12
**Related Logs:** DL-248 (upload fix), DL-235 (folder restructure), DL-240 (subfolder removal)

## 1. Context & Problem
When clients are added via bulk import, no OneDrive folder structure is created. Folders only appear on-demand when the first document arrives. This means browsing OneDrive shows an incomplete picture. Goal: create `clientName/year/filingType/` at import time.

## 2. User Requirements
1. **Q:** Goal? **A:** Organized from day one — every client has folders even before documents arrive.
2. **Q:** Trigger? **A:** During bulk import (existing Workers endpoint).
3. **Q:** Depth? **A:** Full: client + year + filing type.
4. **Q:** Backfill? **A:** Yes, one-time for all existing clients.
5. **Q:** n8n or Workers? **A:** Workers — import endpoint already there with MS Graph auth.

## 3. Research
### Domain: Cloud Storage Automation, MS Graph API
- MS Graph folder creation: `POST /drives/{driveId}/items/{parentId}/children` with `{ name, folder: {}, conflictBehavior: 'fail' }`
- Must create levels sequentially (parent ID needed for child)
- Idempotent pattern: POST with `fail` → catch → GET existing by path

## 4. Codebase Analysis
* **Existing pattern:** `classifications.ts:33-46` — archive folder creation with same POST/catch/GET pattern
* **Reuse:** `resolveOneDriveRoot()`, `FILING_TYPE_FOLDER` from attachment-utils.ts
* **Import endpoint:** `import.ts` — creates clients + reports, no OneDrive logic
* **Rollover endpoint:** `rollover.ts` — creates new year reports, same gap

## 5. Technical Constraints & Risks
* **Rate limits:** ~300-400 MS Graph calls for full backfill — well within 10K/10min limit
* **Non-blocking:** Folder creation errors don't fail the import — logged in response

## 6. Proposed Solution
### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/attachment-utils.ts` | Modify | Added `ensureFolder()` helper + `createClientFolderStructure()` |
| `api/src/routes/import.ts` | Modify | Creates folders after client+report batch creation |
| `api/src/routes/rollover.ts` | Modify | Creates target year folders after report creation |

## 7. Validation Plan
* [x] Build passes (`wrangler deploy --dry-run`)
* [x] Backfill ran: 40/40 client combos created/verified, 0 errors
* [ ] Test bulk import with new client — verify folder appears in OneDrive
* [ ] Test year rollover — verify new year folder created
* [ ] Verify existing upload/inbound flows still work (no regression)

## 8. Implementation Notes
- `ensureFolder()`: private helper, POST with `conflictBehavior: 'fail'` → catch → GET by path (same pattern as archive folder in classifications.ts)
- `createClientFolderStructure()`: calls `ensureFolder()` 3 times sequentially (client → year → filingType)
- Both import.ts and rollover.ts wrap folder creation in try/catch — errors don't fail the main operation
- `folder_results` added to both responses for visibility
- Backfill endpoint created, ran (40/40 success), removed
