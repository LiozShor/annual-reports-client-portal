# Design Log 248: Reassign Clears Unrelated Approval on Same Source Doc
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-12
**Related Logs:** DL-210 (classification review bugfixes), DL-222 (multi-PDF approve conflict), DL-205 (clear file fields on status revert)

## 1. Context & Problem

**Bug report:** Client CPA-XXX (Client Name) — Natan approved a rent expense file (`הארכת חוזה הרצל 99`) to doc T902. File was renamed in OneDrive to `חוזה שכירות (הוצאה).pdf`, but the Airtable document record stayed `Required_Missing`.

**Root cause:** The reassign action's "clear source doc" step (line 924-943 in `classifications.ts`) **blindly clears all file fields** on the source document — without checking whether the source doc's current file belongs to THIS classification or to a DIFFERENT one that was already approved.

**Timeline of the bug:**
1. ~18:30:00 — Natan approves classification A (`הארכת חוזה הרצל 99`) → T902 doc set to `Received`
2. ~18:30:15 — OneDrive renames the file → `חוזה שכירות (הוצאה).pdf` ✓
3. ~18:30:30 — Natan reassigns classification B (`הארכת חוזה חתומה`) FROM T902 TO T901
4. Reassign step 1: **blindly clears T902** → `Required_Missing` ← UNDOES step 1!
5. ~18:30:57 — Reassign step 3: Updates T901 → `Received` ✓

**Impact:** Any time two classifications share the same AI-matched source document and the admin approves one then reassigns the other, the reassign's blind clear will undo the first approval. The file stays in OneDrive but the Airtable link is lost. This is a data-loss bug.

## 2. User Requirements
No discovery questions needed — this is a clear bug with a deterministic root cause. The fix must:
- Prevent the reassign clear-source from undoing unrelated approvals
- Not break the legitimate clear-source behavior (when the source doc still has THIS classification's file)
- Be backwards-compatible

## 3. Research

### Domain
State Machine Side Effects, Concurrent Write Safety

### Research Verdict
Classic "blind clear" anti-pattern: the clear-source step assumes it "owns" the source doc, but in a multi-classification scenario, another approval may have already written different data to the same doc. The fix is a guard: only clear if the source doc's current `onedrive_item_id` matches the classification's `onedrive_item_id`.

## 4. Codebase Analysis

### The Bug Location
`api/src/routes/classifications.ts`, lines 920-944 — reassign action, "clear source doc" block:

```typescript
if (docId) {
    const clearFields = {
        status: 'Required_Missing',
        review_status: null,
        // ... clears ALL file fields unconditionally
    };
    await fetch(... PATCH docId with clearFields);
}
```

The `docId` comes from `clsFields.document` (the classification's linked document). If the AI classified two attachments from the same email to the same template (e.g., both to T902), both classifications link to the same document record. Approving one sets the doc to Received; reassigning the other clears it.

### Why OneDrive rename succeeded but Airtable didn't
The approve action (classification A) completed fully — including the OneDrive rename at Step 6 (line 1207-1227). Then the reassign action (classification B) ran its Step 1 (clear source), which nuked the Airtable record AFTER the approve had already completed.

### Guard approach
Before clearing, fetch the source doc's current `onedrive_item_id` and compare with the classification's `onedrive_item_id`. If they differ, a different file was approved to this doc — skip the clear.

## 5. Technical Constraints & Risks
* **Security:** No auth changes needed — stays within the existing admin-only endpoint.
* **Risks:** The guard adds one extra Airtable GET (fetch source doc before clearing). Negligible cost — this only runs on reassign actions.
* **Breaking Changes:** None. The fix only skips a destructive operation that shouldn't happen.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Reassigning a classification away from a source doc does NOT clear the source doc if a different file has already been approved to it.

### Logic Flow
1. In the reassign block (line 924), before clearing the source doc:
   a. Fetch the source doc's current `onedrive_item_id`
   b. Compare with `clsFields.onedrive_item_id` (the classification's file)
   c. If they match → clear the source doc (same file, safe to clear)
   d. If they differ → skip the clear (a different file was approved, don't touch it)
   e. If source doc has no `onedrive_item_id` → also skip (nothing to protect, but also nothing to clear)

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | Add guard to reassign clear-source block (lines 924-944) |

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status.md

## 7. Validation Plan
* [ ] Test: Approve classification A to doc X, then reassign classification B (same source doc X) to doc Y — doc X should stay Received
* [ ] Test: Reassign classification where source doc has the SAME file → source doc should still be cleared to Required_Missing
* [ ] Test: Reassign classification where source doc has NO file → source doc should NOT be cleared (no-op)
* [ ] Verify no regression: standard approve, reject, reassign, keep_both, merge flows still work

## 8. Implementation Notes (Post-Code)
* Guard uses `sourceDoc` variable (already fetched at line 454) when available, falls back to fresh fetch
* Used `JSON.stringify` for the log message to avoid `[object Object]` in Cloudflare logs
* Also manually fixed the CPA-XXX rent expense doc (`rec1MUnESk4FvvPkJ`) via temp Worker endpoint — Airtable now shows Received with correct OneDrive link
* Manual testing with CPA-XXX couldn't reproduce exact scenario — AI matched each file to a different doc. Bug only triggers when 2+ classifications share the same source doc. Fix is deterministic (guard checks onedrive_item_id match before clearing).
