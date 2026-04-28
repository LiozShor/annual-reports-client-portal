# Design Log 369: AI Review Move Document To Different Client
**Status:** [IMPLEMENTED - NEED TESTING]
**Date:** 2026-04-28
**Related Logs:** DL-350, DL-361, DL-355, DL-248, DL-239, DL-314, DL-356

## 1. Problem

The AI Review card overflow menu (`.ai-ap-overflow__btn`) needs a new action that lets the office move the current document to a different client. This covers cases such as a spouse sending the other spouse's document, or a document landing under the wrong client after inbound email matching.

User decisions:
- Move only the current classification/document, not the full email batch.
- After choosing the target client, reclassify the file against that client's required-document list.
- Revert the source client's linked document back to `Required_Missing`.
- Physically move the OneDrive file to the target client's folder immediately.
- Make the action available for all AI Review card states: pending, approved, rejected, reassigned, and on-hold variants.

## 2. Existing Solutions

- `frontend/admin/js/script.js:4822` builds the AI Review actions-panel overflow menu and currently includes "change decision", "also matches another document", and "add/edit question".
- `frontend/admin/js/script.js:6915` contains `showAssignUnidentifiedModal`, a searchable client picker created for DL-361.
- `api/src/routes/classifications.ts:2139` contains `/webhook/assign-unidentified`, which already chooses a client, fetches the target active report, re-downloads OneDrive bytes, reclassifies with `classifyAttachment`, uploads to the target client's OneDrive folder, deletes the original unidentified file, and patches `pending_classifications`.
- `api/src/routes/classifications.ts:1632` contains same-client reassign logic, including DL-248 source-doc clearing guards and DL-355 canonical filename resolution.
- Existing `/webhook/review-classification` intentionally guards cross-report reassign to the same client (`target_report_id belongs to a different client`), so the cross-client move must be a new explicit endpoint/action, not a bypass of `target_report_id`.

## 3. Research Findings

- WAI-ARIA menu-button guidance says a menu button should expose `aria-haspopup`, maintain expanded state, and support keyboard activation; menu items that launch dialogs commonly use an ellipsis label. Applied here: add `aria-haspopup="menu"` / `aria-expanded` to the overflow button if touching the menu code, and label the new action as a dialog-opening action.
- The project UI design system requires custom `.ai-modal-overlay > .ai-modal-panel` modals and forbids native `confirm()` / `alert()`. Applied here: reuse the existing custom modal pattern and `showAIToast`/loading overlays.
- Existing project logs favor reuse over new parallel systems. Applied here: extend DL-361's client-picker/reclassify flow and DL-350's document reassign cleanup logic.

Sources:
- WAI-ARIA Authoring Practices menu button pattern: https://wai-aria-practices.netlify.app/aria-practices/examples/menu-button/menu-button-links
- Project UI system: `docs/ui-design-system.md`, `docs/ui-design-system-full.md`

## 4. Proposed Solution

Add a new overflow menu item on every AI Review review card:
- Hebrew label: `העבר ללקוח אחר...`
- Icon if practical: `user-round-cog` or `arrow-right-left` via existing icon helper where this menu supports icons.
- Click opens a modal with a searchable client picker, prefilled with all active clients from `clientsData`, excluding the current client.
- After choosing a target client, show a non-native confirmation summarizing source client, target client, and filename.
- On confirm, call a new Worker endpoint, e.g. `POST /webhook/move-classification-client`.

Backend flow for the new endpoint:
1. Verify admin token.
2. Fetch the source `pending_classifications` row and source linked `documents` row.
3. Resolve the target client by `client_id`.
4. Pick the target client's active report, preferring the current classification filing type and newest year. If multiple reports match the same filing type/year, return a structured ambiguity error for the UI rather than guessing.
5. Fetch target report required docs with `status = Required_Missing`.
6. Download the current OneDrive file bytes from the source item.
7. Reclassify via existing `classifyAttachment` using the target client's required docs and filing type.
8. Resolve the target OneDrive filename through `resolveOneDriveFilename`.
9. Upload/move the file into the target client's OneDrive folder. Implementation may use download + upload + delete, matching DL-361, because it is already reliable across folders and lets the filename be canonical.
10. Clear/revert the source document using `applyMissingStatusInvariant({ status: 'Required_Missing' })`, guarded by DL-248 semantics: only clear if the source document still points to this classification's `onedrive_item_id`.
11. Patch the classification row to point to the target report/client/document, set reclassified fields, update `file_url` and `onedrive_item_id`, and set `review_status` to `reassigned`.
12. If classification matched a required target doc, patch that target document to `Received` with file metadata, reviewed fields, source sender, and upload timestamp.
13. Invalidate document caches and run `checkAutoAdvanceToReview` for both source and target reports where appropriate.

Frontend flow:
1. Add overflow item in `renderActionsPanel` for all variants.
2. Create `showMoveClassificationClientModal(classificationId)` by extracting/reusing DL-361 client picker rendering rather than duplicating a second client search implementation.
3. Add row/card-level loading with `setCardLoading(classificationId, 'מעביר ללקוח אחר...')`.
4. On success, update `aiClassificationsData` from the response or reload AI classifications, select the target client row if present, and show a toast.
5. On partial/ambiguous errors, show `showModal('warning'|'error', ...)` with a clear Hebrew message.

## 5. Files To Change

- `frontend/admin/js/script.js`
  - Add overflow menu item for every card state.
  - Add move-to-client modal and shared client-picker helper.
  - Add API call, loading, success refresh, and error handling.
- `frontend/admin/css/style.css`
  - Add modal/client-picker CSS if reusable DL-361 inline styles are extracted to classes.
  - Keep `.ai-ap-overflow__btn` menu sizing stable.
- `frontend/shared/endpoints.js`
  - Add `MOVE_CLASSIFICATION_CLIENT`.
- `frontend/admin/index.html`
  - Bump `script.js` cache version.
- `api/src/routes/classifications.ts`
  - Add `POST /webhook/move-classification-client`.
  - Reuse DL-361 reclassification and OneDrive relocation structure.
  - Reuse DL-350/DL-356 source-doc cleanup and filename invariants.
- `.agent/design-logs/INDEX.md`
  - Add DL-369 entry after implementation status changes.
- `.agent/current-status.md`
  - Add validation handoff at session end.

## 6. Risks And Mitigations

- Wrong target report selection: prefer same filing type and newest year, but return an ambiguity error if selection is unsafe.
- Data loss during OneDrive move: download bytes first, upload to target, patch Airtable, then delete old item only after the target upload succeeds.
- Source document clearing could erase a newer correct file: keep the DL-248 guard and clear only when `sourceDoc.onedrive_item_id === classification.onedrive_item_id`.
- Duplicate target document file: reuse existing conflict behavior where possible. If the reclassified target doc already has a file, return a conflict response and defer merge/override UI to a follow-up unless a simple safe default is already available.
- Long classification/move time: use row/card loading and a 90-second timeout, matching DL-361 expectations.
- Menu accessibility regression: if changing overflow mechanics, add `aria-haspopup`, expanded state, Escape close, and keyboard activation support.

## 7. Validation Plan

- [ ] Pending AI Review card: overflow shows `העבר ללקוח אחר...`.
- [ ] Approved card: overflow shows the action and allows transfer.
- [ ] Rejected card: overflow shows the action and allows transfer.
- [ ] Reassigned card: overflow shows the action and allows transfer.
- [ ] Current source client is excluded from the target client picker.
- [ ] Transfer to target client with one active same-filing-type report reclassifies and updates the row under the target client.
- [ ] Source document status reverts to `Required_Missing` only when its file matches the moved classification item.
- [ ] OneDrive source item is removed only after the target upload succeeds.
- [ ] Target OneDrive filename uses canonical DL-355 short filename rules.
- [ ] Target document becomes `Received` when classification matches a required missing doc.
- [ ] Existing same-client `showAIReassignModal` flow still works.
- [ ] Existing DL-361 unidentified assignment flow still works.
- [ ] Missing token returns 401; bad target client returns a clear error.
- [ ] Ambiguous target report returns a clear modal, not a guessed move.
- [ ] Browser test: from the AI Review tab, move a seeded test document and verify the card relocates without hard refresh.

## 8. Implementation Notes

Implemented 2026-04-28.

- Frontend adds `העבר ללקוח אחר...` to every actions-panel overflow menu, opens a custom client picker modal, excludes the source client, confirms via `showConfirmDialog`, calls `ENDPOINTS.MOVE_CLASSIFICATION_CLIENT`, shows card-level loading, reloads AI Review, and selects the target client when available.
- Backend adds `POST /webhook/move-classification-client`. It accepts the documented body token and also the admin Bearer header, fetches the source classification, resolves target client/report, reclassifies the current file against target `Required_Missing` docs, uploads to the target OneDrive folder with DL-355 filename rules, clears the source document via DL-356 invariant only when it still references the moved file, patches the target doc/classification, then deletes the old OneDrive item.
- Target report selection is same-filing-type only. If multiple active target reports share the newest same filing type/year, endpoint returns `ambiguous_target_report`.
- Validation run: `script.js` and `endpoints.js` parse with Node. `api` `tsc --noEmit` still fails only on pre-existing errors already documented in `.agent/current-status.md`: `ADMIN_SECRET`, `ClassificationResult.pageCount`, DL-361 document typing, and missing `.mjs` declaration.
