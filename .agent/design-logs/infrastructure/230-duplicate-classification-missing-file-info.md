# Design Log 230: Duplicate Classifications Missing file_url and onedrive_item_id
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-30
**Related Logs:** DL-035 (AI classification + OneDrive upload), DL-203 (WF05 → Workers migration)

## 1. Context & Problem

When an inbound email attachment is detected as a duplicate (same SHA-256 hash already exists in `pending_classifications` or `documents` table), the OneDrive upload is skipped to avoid wasting storage. However, the code initializes `upload = { webUrl: '', itemId: '' }` and never populates it with the original record's file info. This means duplicate classification records are created with **empty** `file_url` and `onedrive_item_id` fields.

Impact: Natan can't click through to view duplicate files in OneDrive from the AI Review panel — they appear as broken/empty links. He has to manually look up and paste URLs.

Discovered on record `recXvDDZSjCC2Hnf9` (CPA-XXX, Client Name) which had `is_duplicate: true` with empty file fields.

## 2. User Requirements

No discovery questions needed — the bug and fix are clear from the code.

## 3. Research

Skipped — this is a straightforward data-propagation bug fix, not an architectural decision.

## 4. Codebase Analysis

### Root Cause

**File:** `api/src/lib/inbound/processor.ts` lines 388-401

```ts
let upload = { webUrl: '', itemId: '', downloadUrl: '' };
if (!isDuplicate) {
  upload = await uploadToOneDrive(...);
}
```

When `isDuplicate` is `true`, `upload` stays empty. Lines 459-460 then write empty strings to Airtable:
```ts
file_url: upload.webUrl,          // → ''
onedrive_item_id: upload.itemId,  // → ''
```

### Dedup Function

**File:** `api/src/lib/inbound/document-classifier.ts` lines 809-833

`checkFileHashDuplicate()` searches both `pending_classifications` and `documents` tables for matching `file_hash`, but only returns `boolean` — discards the matched records which contain the file info we need.

### Existing Solutions

The dedup function already fetches the original record (with `maxRecords: 1`). We just need to:
1. Add `fields: ['file_url', 'onedrive_item_id']` to the queries (field projection)
2. Return the file info alongside the boolean

## 5. Technical Constraints & Risks

* **Security:** No new auth/PII concerns — same fields already written for non-duplicates
* **Risks:** Minimal — only changes behavior for `isDuplicate === true` path. Non-duplicate flow untouched.
* **Breaking Changes:** None — `checkFileHashDuplicate` is only called from `processAttachment()`

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Duplicate classification records have the same `file_url` and `onedrive_item_id` as the original record they duplicate.

### Logic Flow

1. Change `checkFileHashDuplicate` return type from `boolean` to `{ isDuplicate: boolean; fileUrl?: string; itemId?: string }`
2. When a match is found in `pending_classifications`, extract `file_url` and `onedrive_item_id` from the matched record
3. When a match is found in `documents`, extract the same fields
4. In `processor.ts`, use the returned file info to populate the `upload` object for duplicates

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/document-classifier.ts` | Modify | Change `checkFileHashDuplicate` return type, extract file info from matched records |
| `api/src/lib/inbound/processor.ts` | Modify | Destructure new return value, populate `upload` for duplicates |

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status.md, git commit & push

## 7. Validation Plan
* [ ] Process a known duplicate attachment → verify `file_url` and `onedrive_item_id` are populated (not empty)
* [ ] Process a non-duplicate attachment → verify normal upload flow unchanged
* [ ] Build passes (`npm run build` in `api/`)
* [ ] Check existing duplicate records in Airtable — no regression

## 8. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
