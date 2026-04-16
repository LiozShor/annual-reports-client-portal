# Design Log 240: Remove OneDrive Subfolders
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-06
**Related Logs:** DL-235 (OneDrive Folder Routing Restructure)

## 1. Context & Problem

The OneDrive folder structure used three subfolders inside each filing type folder:
- `זוהו` — identified docs (inbound classified)
- `ממתינים לזיהוי` — unidentified docs (inbound unclassified)
- `מסמכים שזוהו` — admin uploads

User wants to simplify: all docs go directly into the filing type folder root. Only `ארכיון` (archive at year level) remains for rejected/irrelevant docs.

## 2. User Requirements

1. **Q:** Where should all inbound docs land?
   **A:** Filing type root — no subfolders

2. **Q:** Admin uploads — same root?
   **A:** Yes, same root

3. **Q:** Reassign action — rename in place?
   **A:** Yes, no folder move needed

4. **Q:** Migrate existing files?
   **A:** No — leave old folders as-is

## 3. Research

Skipped — infrastructure cleanup with clear requirements.

## 4. Codebase Analysis

Four code paths modified:

| Location | Before | After |
|----------|--------|-------|
| `attachment-utils.ts` | `uploadToOneDrive()` had `folder` param in path | Removed `folder` param, files go to filing type root |
| `processor.ts:350-352` | `isIdentified ? 'זוהו' : 'ממתינים לזיהוי'` | Subfolder logic removed entirely |
| `processor.ts:583-591` | Unidentified client uploads to `ממתינים לזיהוי` | Subfolder removed |
| `upload-document.ts:88` | Admin uploads to `/מסמכים שזוהו/` | Subfolder removed from path |
| `classifications.ts:moveFileToArchive()` | 3-level traversal (file→subfolder→filing→year) | 2-level traversal (file→filing→year) |
| `classifications.ts` review handler | `moveToZohu` + `moveToArchive` logic | `moveToZohu` removed; archive uses 2-level traversal |

## 5. Technical Constraints & Risks

* **No migration:** Old subfolders and files remain untouched
* **Fewer API calls:** Archive traversal now 2 levels instead of 3 (one less Graph API call)
* **No breaking changes:** All consumers of `uploadToOneDrive()` updated

## 6. Proposed Solution (The Blueprint)

### Target folder structure
```
{client}/{year}/
├── דוח שנתי/              ← all docs land here directly
├── הצהרת הון/
└── ארכיון/                ← rejected/irrelevant (year-level)
```

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/attachment-utils.ts` | Modify | Remove `folder` param from `uploadToOneDrive()` |
| `api/src/lib/inbound/processor.ts` | Modify | Remove subfolder logic, update both upload calls |
| `api/src/routes/upload-document.ts` | Modify | Remove `/מסמכים שזוהו` from OneDrive path |
| `api/src/routes/classifications.ts` | Modify | Remove `moveToZohu`, simplify archive to 2-level traversal |

## 7. Validation Plan

* [x] Build passes (`npx tsc --noEmit`)
* [ ] Inbound email → attachment uploads to `{year}/דוח שנתי/filename.pdf` (no subfolder)
* [ ] Admin upload → file goes to `{year}/דוח שנתי/filename.pdf` (no מסמכים שזוהו)
* [ ] AI Review reject → file moves to `{year}/ארכיון/`
* [ ] AI Review approve → file renamed in place (no folder move)
* [ ] AI Review reassign → file renamed in place (no move to זוהו)
* [ ] Existing files in old subfolders still accessible

## 8. Implementation Notes

* Build passes cleanly after all changes
* `uploadToOneDrive()` signature simplified: `folder` param removed entirely
* Two calls in `processor.ts` updated (main inbound + unidentified client path)
* `moveFileToArchive()` helper and inline review handler both simplified to 2-level traversal
