# Design Log 235: OneDrive Folder Routing Restructure
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-31
**Related Logs:** DL-226 (Dual-Filing OneDrive Architecture), DL-049 (OneDrive File Ops)

## 1. Context & Problem

The OneDrive folder structure had two issues:
1. **Archive inside filing type:** `ארכיון` was created as a subfolder of each filing type folder (e.g., `{year}/דוחות שנתיים/ארכיון/`), but should be a sibling at the year level
2. **Plural folder names:** Filing type folders used plural Hebrew (`דוחות שנתיים`, `הצהרות הון`) instead of singular (`דוח שנתי`, `הצהרת הון`)

## 2. User Requirements

1. **Q:** Rename filing type folders from plural to singular?
   **A:** Yes — `דוח שנתי` and `הצהרת הון`

2. **Q:** Archive folder layout — flat or sub-folders?
   **A:** Flat archive at year level, no sub-folders by filing type

3. **Q:** Should `זוהו` folder also move to year level?
   **A:** No — keep inside filing type folder

4. **Q:** Migrate existing files to new structure?
   **A:** No — new structure only, existing folders stay as-is

## 3. Research

Skipped — infrastructure change with clear requirements, no domain research needed.

## 4. Codebase Analysis

**Full OneDrive routing audit found 4 code paths:**

| Location | Operation | Folder Path |
|----------|-----------|-------------|
| `attachment-utils.ts:91-94` | FILING_TYPE_FOLDER constant | `דוחות שנתיים` / `הצהרות הון` |
| `attachment-utils.ts:108-109` | `uploadToOneDrive()` — inbound | `{year}/{filingFolder}/{subfolder}/{file}` |
| `upload-document.ts:87-88` | Admin upload | `{year}/{filingFolder}/מסמכים שזוהו/{file}` |
| `classifications.ts:18-51` | `moveFileToArchive()` | Creates `ארכיון` 2 levels up (inside filing type) |
| `classifications.ts:917-946` | Main review handler | Creates `ארכיון`/`זוהו` 2 levels up (inside filing type) |

**Parent traversal issue:** Both archive paths went 2 levels up from file (file → subfolder → filingFolder), creating `ארכיון` inside the filing type folder. Needed 3 levels up to reach year folder.

## 5. Technical Constraints & Risks

* **No migration:** Existing files in old plural-named folders won't move. New files go to new singular-named folders.
* **Extra API call:** Archive path now makes 3 Graph API calls instead of 2 (one more level of parent traversal). Acceptable — reject/archive is infrequent.
* **No breaking changes:** All consumers import `FILING_TYPE_FOLDER` — changing the constant values auto-propagates.

## 6. Proposed Solution (The Blueprint)

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/attachment-utils.ts` | Modify | Rename FILING_TYPE_FOLDER: `דוחות שנתיים` → `דוח שנתי`, `הצהרות הון` → `הצהרת הון` |
| `api/src/routes/classifications.ts` | Modify | `moveFileToArchive()`: 3-level traversal to year folder. Main review handler: split archive (3 levels) vs זוהו (2 levels) |

### Target folder structure
```
{client}/{year}/
├── דוח שנתי/              ← singular
│   ├── זוהו/
│   └── ממתינים לזיהוי/
├── הצהרת הון/             ← singular
│   ├── זוהו/
│   └── ממתינים לזיהוי/
└── ארכיון/                ← year-level sibling (flat)
```

## 7. Validation Plan

* [ ] Build passes (`npx tsc --noEmit`) — DONE
* [ ] Reject a classification → file moves to `{year}/ארכיון/` (NOT inside filing type folder)
* [ ] Approve with override → old file moves to `{year}/ארכיון/`
* [ ] Reassign unmatched doc → file moves to `{year}/{filingType}/זוהו/` (still inside filing type)
* [ ] Inbound email → attachment uploads to `{year}/דוח שנתי/זוהו/` (singular folder name)
* [ ] Admin upload → file goes to `{year}/דוח שנתי/מסמכים שזוהו/` (singular)
* [ ] CS document → uploads to `{year}/הצהרת הון/` (singular, not plural)
* [ ] Verify existing files in old plural folders are still accessible (no migration, old URLs unchanged)

## 8. Implementation Notes

* TypeScript build passes cleanly
* `moveFileToArchive()` now traverses file → subfolder → filingFolder → yearFolder (3 levels)
* Main review handler splits logic: `moveToArchive` uses 3-level traversal, `moveToZohu` keeps 2-level traversal
