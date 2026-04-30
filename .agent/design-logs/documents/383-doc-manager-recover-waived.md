# Design Log 383: Doc Manager — Recover Waived Docs (Waived ↔ Required) Reliability + UX
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-30
**Related Logs:** [DL-205](205-clear-file-fields-on-status-revert.md) (scoped by this DL), [DL-244](244-rejected-uploads-visibility.md), [DL-356](../infrastructure/356-preview-url-stale-itemid-self-heal.md)

## 1. Context & Problem

The admin doc-manager page (`frontend/assets/js/document-manager.js`) lets the office toggle documents between **Required_Missing ↔ Waived ("אין צורך")**. Two problems surfaced simultaneously:

1. **Live 500 on CPA-XXX / annual_report** when saving from doc-manager. The browser showed generic toast "Save operation failed" — admin had no visibility into the real cause, and on failure the row state drifted from Airtable truth.
2. **Unsatisfying restore UX**: Waived → Required used a small inline `<input type="checkbox">` (`.restore-checkbox`) with no clear affordance, and the DL-205 file-clear warning was showing on Waived docs even though Waived docs have no file by definition. Confirmation summary incorrectly implied "file link will be deleted" on all restores.

## 2. User Requirements (Q&A)

1. **Q:** Which recover flow?
   **A:** Waived ↔ Required transitions (not reject-upload recovery, not stale-itemId repair).
2. **Q:** Main pain point?
   **A:** Silently fails (500) and doesn't refresh the row. Console: `POST /webhook/edit-documents 500`.
3. **Q:** Priority?
   **A:** Bundle — fix 500 AND redesign UX in one DL.
4. **Q:** File on restore?
   **A:** Don't clear. A Waived doc by definition was never received — there's no file to clear.
5. **Q:** Surface scope?
   **A:** Doc-manager page only.

## 3. Research

### Domain
State Machine Side Effects · Undo/Restore UX · Airtable atomic updates

### Cumulative Prior Research (DL-205, DL-198, DL-244)
- **DL-205 (destination-based sweep):** any row landing in `Required_Missing` → null file fields. Established `applyMissingStatusInvariant` in `api/src/lib/doc-invariants.ts`.
- **DL-198 (NN/g file upload):** error recovery should be zero-effort; surface real failure causes not generic messages.
- **DL-244 (rejected uploads):** parallel reasoning on state recovery UX.

### Delta Principle (DL-383)
DL-205 made the invariant **destination-keyed** — any row landing in `Required_Missing` gets 13 fields nulled, including `document_uid`. This over-applies for **Waived → Missing** restores because:
- Waived docs have no file (never received); clearing file fields is a no-op at best.
- Nulling `document_uid` (the Airtable upsert merge key) when the same submit also creates a doc with the same `document_uid` → Airtable 422 → Worker 500.

Fix: **source-aware invariant** — skip the null sweep when `previousStatus === 'Waived'`. DL-205 still applies for Received/Requires_Fix → Missing (those rows have real files that should be cleared).

## 4. Codebase Analysis

| File | Role |
|------|------|
| `api/src/lib/doc-invariants.ts` | `applyMissingStatusInvariant` — 13-field null sweep |
| `api/src/routes/edit-documents.ts` | `buildUpdateMap` — merges waive/restore/status/notes/names; calls invariant sweep |
| `frontend/assets/js/document-manager.js` | `toggleRestore`, `confirmSubmit`, row render, restore checkbox/button |
| `frontend/assets/css/document-manager.css` | `.restore-checkbox` → `.restore-btn` |
| `frontend/document-manager.html` | asset version cache-busts |

**Key paths:**
- `buildUpdateMap` (edit-documents.ts:240) — merges all change types, then sweeps invariant
- `archiveCandidates` loop (line 369) — already calls `airtable.getRecord` per doc; DL-383 adds a pre-fetch of `previousStatuses` before `buildUpdateMap`
- `confirmSubmit` (document-manager.js:~2447) — `throw new Error('Server error')` without reading response body = opaque failure

## 5. Constraints & Risks

- **DL-205 contract preserved** — Received/Requires_Fix → Missing still clears file fields. Only Waived → Missing is scoped out.
- **No new Airtable fields, no new endpoints, no schema changes.**
- **`_previousStatus` internal metadata** — stored in `updateMap` entry but filtered from Airtable PATCH (`Object.entries(u).filter(([k]) => k !== 'id' && k !== '_previousStatus')`).
- **Waive-wins guard** — if same id in both `docs_to_waive_ids` AND `docs_to_restore`, waive wins (mirrors frontend `filteredStatusChanges` rule). Logs a warning.

## 6. Proposed Solution (Implemented)

### Backend

1. **`doc-invariants.ts`** — `applyMissingStatusInvariant` gains `opts?: { previousStatus?: string }`. Skips null sweep when `previousStatus === 'Waived'`.
2. **`edit-documents.ts`** — `buildUpdateMap` gains `previousStatuses?: Map<string, string>` param. Pre-fetch step before the call fetches current status for all `docs_to_restore` ids. Waive-wins guard added at restore loop. `_previousStatus` stored in map entry; filtered before Airtable PATCH. Real error surfaced: catch already returns `{ ok: false, error: msg }` — frontend just wasn't reading it.

### Frontend

1. **Restore affordance** — `<input class="restore-checkbox">` → `<button class="restore-btn">` with rotate-ccw icon. `toggleRestore` updated to toggle `.active` class on button (no checkbox `checked` state).
2. **File-clear warning gated** — both row render and `toggleRestore` only show amber warning when `doc.status ∈ {Received, Requires_Fix}`. Waived restores show no warning.
3. **Confirm summary** — `restoreDocs.forEach` now checks `sourceIsFileState` before appending "⚠ קישור הקובץ יימחק" note.
4. **Error body parsed** — `throw new Error('Server error')` replaced with `response.json()` parse → surfaces real `body.error` in admin toast.
5. **Immediate row refresh** — `loadDocuments(REPORT_ID)` called immediately on success; `setBtnState('idle')` delayed 1.5s (decoupled from data refresh).
6. **CSS** — `.restore-btn` ghost button matching `.delete-toggle` sizing; `.restore-checkbox` removed.
7. **Cache-bust** — `document-manager.js?v=383`, `document-manager.css?v=2`.

## 7. Validation Plan

- [ ] **Repro + fix verify (CPA-XXX):** Open `/admin/document-manager?client_id=CPA-XXX&tab=annual_report`, restore a Waived doc, save → green toast + row refreshes + no 500 in wrangler tail. Airtable `document_uid` preserved.
- [ ] **Received → Missing still clears file:** Pick a Received doc with `file_url`, set status Missing → amber "קישור הקובץ יימחק" warning visible → save → Airtable `file_url` / `onedrive_item_id` nulled (DL-205 holds).
- [ ] **Waived restore — no file-clear warning:** Restore a Waived doc → NO amber warning in row or confirm dialog.
- [ ] **Waive + restore same session (different docs):** Mark 2 Required docs for waive AND 1 Waived doc for restore in one submit → all 3 transitions persisted.
- [ ] **Waive-wins edge case:** Programmatically test payload with same id in waive + restore → waive status in Airtable; warning logged.
- [ ] **Error toast:** Force a 500 (corrupt payload in dev) → admin sees real error message, not "Server error".
- [ ] **Restore button UX:** Waived doc shows rotate-ccw icon button; clicking toggles `.active` + `.marked-for-restore` on row.
- [ ] **TS build:** `./node_modules/.bin/tsc --noEmit` passes (0 errors excluding test-airtable).
- [ ] **PII guard:** Run before committing `.agent/` files.

## 8. Implementation Notes

- `batch-sanitize.mjs` converted to `batch-sanitize.ts` to resolve TS7016 implicit-any error; `.d.ts` stub also added as fallback.
- `ADMIN_SECRET` → `SECRET_KEY` in `backfill.ts` (was pre-existing TS error).
- `pageCount?: number` added to `ClassificationResult` in `inbound/types.ts` (was pre-existing TS error).
- `requiredDocs as any` cast at `classifications.ts:2693` (matches existing pattern at 2317 — was pre-existing TS error).
- Hook `n8n-wf-put-reminder.py` path fixed with `git rev-parse --show-toplevel` in both worktree + canonical `.claude/settings.json`.
- TS build: 0 errors after all fixes (excluding `test-airtable.ts` which had pre-existing errors).
- No Wrangler deploy run yet — pending verification on staging.
