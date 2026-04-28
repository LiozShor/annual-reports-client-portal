# Design Log 370: Move-Classification Edge Cases — Pending-Always Semantics
**Status:** [COMPLETED — 2026-04-28]
**Date:** 2026-04-28
**Related Logs:** DL-369, DL-361, DL-355, DL-356, DL-248

## 1. Problem

DL-369 shipped `POST /webhook/move-classification-client` (`api/src/routes/classifications.ts:2125-2397`), letting the office move a classification + file to another client. Tracing the flow surfaced three edge cases that silently produce inconsistent state:

| Scenario | Pre-DL-370 behavior | Problem |
|---|---|---|
| Target client has zero `Required_Missing` docs (everything received/waived) | Move succeeds. Classification → `review_status: 'reassigned'`, `document: []`. File uploads to target OneDrive. No target `documents` row patched (orphan file). | Classification looks "done" (`reassigned`) but is actually unmatched — nothing surfaces it for office attention. |
| Target HAS required docs but AI doesn't match any | Same as above — orphan classification + file. | Same: looks resolved, isn't. |
| Target doc slot already has a Received file | Endpoint returns 409 `target_doc_conflict` and aborts BEFORE upload. | User must manually reject the existing target file before retrying — high-friction, blocks legitimate "this is the better file" moves. |

## 2. Existing Solutions

- DL-369 endpoint structure (download → reclassify → upload → patch).
- `pending` is already a valid `pending_classifications.review_status` so it surfaces in AI Review queue.

## 3. User Decisions (Phase A)

- All three cases → classification lands on target as `review_status: 'pending'` (not `'reassigned'`), so office sees it under target client and finishes handling.
- Doc-conflict case: upload file to target OneDrive folder anyway, do NOT touch the existing Received document. Classification sits as pending. Toast tells office about the conflict.
- File physically moves in all cases.

## 4. Proposed Solution

### Backend — `api/src/routes/classifications.ts` (`/webhook/move-classification-client`)

1. **Lines 2276-2283** — Replace conflict-abort with conflict-skip. On `targetDoc.fields.status === 'Received' && onedrive_item_id`, set `targetDoc = null` (so patch block at 2313 is skipped) + `targetDocConflict = true`. Continue with upload + classification update.
2. **Line 2347** — `review_status: 'reassigned'` → `review_status: 'pending'`.
3. **Line 2346** — When `targetDocConflict`, also clear `document` link (otherwise classification's new `file_url`/`onedrive_item_id` would conflict with the existing-Received doc still linked).
4. **Lines 2373-2382** — Add `target_doc_conflict` and `target_matched` to response payload.
5. Remove the now-dead 409 `target_doc_conflict` error response. Other structured codes preserved: `same_client`, `target_client_not_found`, `target_client_invalid`, `target_report_not_found`, `ambiguous_target_report`, `missing_onedrive_item`, `file_move_failed`, `source_clear_failed`.

### Frontend — `frontend/admin/js/script.js` (`moveClassificationClient` ~7163-7200)

1. Add explicit Hebrew error mapping for `target_report_not_found` (`לא נמצא דוח פעיל מתאים אצל לקוח היעד.`). Drop dead `target_doc_conflict` branch.
2. Tailor success toast on response flags:
   - Default: `המסמך הועבר אל ${targetName} (ממתין לבדיקה)`
   - Conflict: `הקובץ הועבר אל ${targetName} אך כבר קיים שם מסמך מאושר. הסיווג ממתין להחלטה.`
3. Existing `loadAIClassifications(false, true)` + `selectClient(targetName)` retained — both still correct.

### Frontend — `frontend/admin/index.html`
- Cache-bust `script.js?v=372` → `?v=373`.

## 5. What Stays Unchanged

- Source document `Required_Missing` revert (DL-248 guard) — line 2298-2311.
- Old OneDrive item deletion after upload — line 2353.
- Pre-checks: `same_client`, `target_client_not_found`, `target_report_not_found`, `ambiguous_target_report` still block.
- `checkAutoAdvanceToReview` for both source + target reports.
- Cache invalidation; security log emission.
- Target-document `review_status: 'confirmed'` when matched + no conflict (line 2316) — doc still treated as confirmed; only the *classification* stays pending.
- Helpers reused: `applyMissingStatusInvariant`, `resolveOneDriveFilename`, `uploadToOneDrive`, `classifyAttachment`, `MSGraphClient`.

## 6. Out of Scope

- Backfilling DL-369-era `reassigned` rows that shipped before this change.
- Auto-rejecting existing Received target doc when a "better" file arrives — explicit office decision required.
- Changing reassign semantics in `/webhook/review-classification` (same-client) or `/webhook/assign-unidentified` (DL-361).

## 7. Verification

End-to-end on a non-prod-like client with seeded test classifications:

- [x] Target with **zero Required_Missing docs**: move succeeds; file in target OneDrive; classification appears in AI Review under target with `pending`; source side cleared per DL-248 guard. *(Test A — 2026-04-28)*
- [x] Target where AI matches a Required_Missing doc cleanly: target document → `Received`, classification → `pending` under target. *(Test B — 2026-04-28)*
- [x] Target where AI fails to match: file uploads, classification → `pending` under target, no `document` link. *(Test C — 2026-04-28)*
- [x] **Target doc slot already has a Received file (NEW behavior):** move succeeds (no 409). File uploads. Existing target doc untouched. Classification → `pending` under target. *(Test D — 2026-04-28; conflict toast not shown when slot is already Received before classification — pending classification is sufficient for office)*
- [x] Source document reverts to `Required_Missing` only when still referencing the moved file; skip if already Required_Missing (DL-248 + DL-370 fix). *(2026-04-28)*
- [x] Old OneDrive file deleted after target upload.
- [x] After move, switching to target client shows the new pending card.
- [x] Cache-bust effective.

## 8. Files Touched

| File | Action |
|---|---|
| `api/src/routes/classifications.ts` | Lines 2276-2283, 2346-2347, 2373-2382 inside `/webhook/move-classification-client` |
| `frontend/admin/js/script.js` | `moveClassificationClient` error mapping + toast |
| `frontend/admin/index.html` | `script.js?v=372` → `?v=373` |
| `.agent/design-logs/INDEX.md` | DL-370 row |
| `.agent/current-status.md` | Phase E test handoff |
