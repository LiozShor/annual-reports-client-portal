# Design Log 356: Preview URL Stale itemId — Self-Heal
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-26
**Related Logs:** [DL-205](../documents/205-clear-file-fields-on-status-revert.md), [DL-230](230-duplicate-classification-missing-file-info.md), [DL-180](../infrastructure/) (worker error logging)

## 1. Context & Problem

A Worker error alert fired on `/webhook/get-preview-url`: MS Graph returned `404 itemNotFound` for a OneDrive item.

Airtable lookup found **two** Documents records sharing that itemId:

| Record | Type | Status | Report |
|---|---|---|---|
| `recA` | T501 (study-fund issuer X) | **Required_Missing** | `repA` |
| `recB` | tofes_106 | Received | `repB` |

The cross-report duplicate is by design — DL-230 propagates the same `onedrive_item_id` across duplicate inbound classifications when SHA-256 deduplication kicks in. The bug here is that record #1 is `Required_Missing` yet still carries `onedrive_item_id`. DL-205 was supposed to null those fields whenever a doc enters `Required_Missing`. Either DL-205 never ran for this record (inbound dedup pre-DL-205, manual Airtable edit, or older n8n write path), or another code path wrote `Required_Missing` without clearing fields.

When the admin clicks Preview on record #1, the Worker forwards the stale itemId to MS Graph → 404 → red error in admin UI → alert in `worker-errors` channel → no recovery path.

## 2. User Requirements (Phase A)

1. **Q:** Scope of fix? **A:** Root cause + band-aid.
2. **Q:** Sweep Airtable for other stale records? **A:** Yes, dry-run first.
3. **Q:** Admin UI behavior on 404? **A:** Toast + auto-flag (auto-clear `onedrive_item_id` + `file_url` on the row, log warning).
4. **Q:** Cross-report duplicate concern? **A:** Accept — DL-230 design, no investigation.

## 3. Research

### Domain
Self-Healing APIs / Reconciliation Loops / Tombstone reconciliation for stale references to external resources. Cumulative knowledge from DL-205 (state-machine cleanup) reused.

### Sources Consulted (incremental)
1. **Self-Healing APIs (Krishnamoorthy, Medium)** — Treat persistent 404 from upstream as a tombstone signal: drive local state toward upstream truth via a reconciliation step.
2. **Azure Architecture Center — Design for Self-Healing** — Detect → contain → recover in the same request when safe (no destructive side effects on real data).
3. **Markuply — Handle 404 from external data source** — Distinguish "transient 404" (rate limit, propagation) from "permanent 404" (resource gone). Only reconcile on the latter.
4. **DL-205** — Destination-based field-clearing pattern (status reaching `Required_Missing` triggers null sweep).

### Key Principles Extracted
- **Self-heal is safe here:** the OneDrive file is already gone; the only "destruction" is removing a dangling Airtable reference. No real data loss possible.
- **Centralize the invariant:** "doc.status = `Required_Missing` ⇒ file fields are null" should be enforced at the data-write layer, not duplicated across every handler. This is the root-cause fix.
- **Distinguish 404 from 5xx:** Self-heal only on `404 itemNotFound`, not on transient MS Graph errors.

### Patterns to Use
- **Invariant enforcement at data layer:** A small `applyMissingStatusInvariant(fields)` helper (new `api/src/lib/doc-invariants.ts`) called by any update path that may write `status`.
- **Conditional reconciliation:** in `preview.ts`, on 404+itemNotFound + `recordId` known → PATCH that single row to null file fields; log warning; return `{ ok: false, code: 'FILE_GONE', message: 'הקובץ אינו זמין יותר ב-OneDrive' }`.
- **Dry-run sweep route:** mirror `backfill.ts` pattern.

### Anti-Patterns to Avoid
- **Per-handler patches.** Patching only the path that produced this specific record leaves the next path open. Centralize.
- **Auto-deleting records.** We clear stale fields, never the row — admins still need to see the doc as `Required_Missing` to re-collect.
- **Self-healing on transient 5xx.** Only `404 itemNotFound` triggers reconciliation.

### Research Verdict
Combine a centralized invariant helper (root cause) with a per-request self-heal in `preview.ts` (band-aid) plus a one-shot sweep route to clean residual records.

## 4. Codebase Analysis

### Code paths that set `status = 'Required_Missing'`

| # | Path | File:Line | Clears file fields? |
|---|---|---|---|
| 1 | edit-documents (admin) | `api/src/routes/edit-documents.ts:258,282` | ✅ DL-205 sweep |
| 2 | classifications.reject | `api/src/routes/classifications.ts:1497` | ✅ explicit (6 fields) |
| 3 | classifications.reassign clear-source | `:1611` | ✅ explicit (6 fields) |
| 4 | classifications.revert_cascade | `:1059` | ⚠️ partial (4 fields) |
| 5 | inbound processor (matched-doc update) | `api/src/lib/inbound/processor.ts:661-678` | ❌ overwrites without nulling old fields first |
| 6 | n8n direct Airtable writes / automations | — | unknown |

Path 4 nulls `onedrive_item_id` so it isn't the cause of `rec0nxN89Ap9ZvByN`. Most likely the row was written by an older path before DL-205 existed, or by an n8n workflow not yet hardened. Pinning the exact culprit retroactively is impossible. The fix is a centralized invariant + sweep.

### Admin UI flow (`frontend/admin/js/script.js`)
- `getDocPreviewUrl(itemId)` at `:3626` — fetches `GET_PREVIEW_URL`, resolves `{previewUrl, downloadUrl}` or rejects.
- Call sites at `:624` (mobile) and `:3773` (desktop) `.catch` → `humanizeError()` → inline error placeholder + retry button (timeout only).
- `showAIToast(message, type, action)` at `:8613`. Examples: `showAIToast('שגיאה: '+err.message, 'error')`.

### Worker
- `api/src/routes/preview.ts:42-67` — try/catch returns `{ ok: false, error: message }`.
- `MSGraphClient.post/get` — error message includes status code; we can detect `404` + "itemNotFound" / "could not be found".

### Sweep skeleton (mirrors `api/src/routes/backfill.ts:102-240`)
Auth `verifyToken(token, env.SECRET_KEY)`, `airtable.listAllRecords` with filter, `?dryRun=1` default, `airtable.batchUpdate` (10/chunk).

## 5. Technical Constraints & Risks

- **Self-heal correctness:** if MS Graph returns a transient 404, self-heal would wrongly null fields. Mitigation: only self-heal on `404` AND error message containing `itemNotFound` or `could not be found`.
- **Cross-report ripple (DL-230 dup):** because two records can share `onedrive_item_id`, self-heal must clear ONLY the record being previewed. Match by `recordId` (sent from frontend), not by itemId.
- **Concurrency:** PATCH null is idempotent; safe under racing previews.
- **Auth on sweep:** admin-only Bearer token. No PII risk.

## 6. Proposed Solution

### Success Criteria
Clicking Preview on a doc whose OneDrive file is gone shows a clear Hebrew toast, the row's stale `onedrive_item_id`/`file_url` are auto-cleared in Airtable, and a future identical preview attempt is impossible (button hides because field is empty). A one-shot sweep finds and reports residual records.

### Logic Flow

**Worker — `preview.ts`:**
1. Receive `{ itemId, recordId? }` (frontend now sends both).
2. Try MS Graph preview.
3. On 404+itemNotFound:
   - If `recordId` provided: PATCH row → null `onedrive_item_id`, `file_url`, `expected_filename`, `file_hash`, `uploaded_at`. Do not change `status`.
   - Log warning via `logError({category:'STALE_REFERENCE'})`.
   - Return `{ ok: false, code: 'FILE_GONE', message: 'הקובץ אינו זמין יותר ב-OneDrive' }`.
4. On other errors: existing path.

**Worker — new `api/src/routes/audit-stale-itemids.ts`:**
- `GET /webhook/audit-stale-itemids?dryRun=1` (default 1).
- Auth: Bearer admin token.
- Filter: `AND({status}='Required_Missing', {onedrive_item_id}!='')`.
- Optional `?verify=1`: HEAD MS Graph to confirm 404 before clearing (default off for speed).
- If `dryRun=0`: `batchUpdate` to null 5 file fields, return summary.
- Register in `api/src/index.ts`.

**Worker — `api/src/lib/doc-invariants.ts` (NEW):**
- `applyMissingStatusInvariant(fields)`: if `fields.status === 'Required_Missing'`, set 11 file/source/ai fields to `null`.
- Wire into `edit-documents.ts` (replace inline DL-205 sweep), `classifications.ts:reject/reassign/revert_cascade` (replace inline lists).

**Frontend — `script.js`:**
1. `getDocPreviewUrl(item)` (signature change): pass record id, send `?itemId=...&recordId=...`.
2. On `code === 'FILE_GONE'`:
   - `showAIToast('הקובץ אינו זמין יותר ב-OneDrive – הקישור הוסר', 'danger')`.
   - Mutate local `item.onedrive_item_id = ''; item.file_url = ''`.
   - Re-render the doc row.
3. Bump cache version on `script.js` and `?v=` in `index.html`.

### Files to Change

| File | Action | Description |
|---|---|---|
| `api/src/lib/doc-invariants.ts` | Create | Helper + 11-field null list. |
| `api/src/routes/edit-documents.ts` | Modify | Replace inline DL-205 sweep with helper. |
| `api/src/routes/classifications.ts` | Modify | Replace inline clears in reject/reassign/revert_cascade. |
| `api/src/routes/preview.ts` | Modify | Detect 404+itemNotFound, optional reconcile by `recordId`, return `code:'FILE_GONE'`. |
| `api/src/routes/audit-stale-itemids.ts` | Create | Dry-run sweep, admin Bearer auth. |
| `api/src/index.ts` | Modify | Register audit route. |
| `frontend/admin/js/script.js` | Modify | Pass `recordId`, handle `FILE_GONE`. |
| `frontend/admin/index.html` | Modify | Bump `?v=` on `script.js`. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-356 row. |
| `.agent/current-status.md` | Modify | Phase E test entries. |

### Final Step (Always)
Status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 to `current-status.md`, commit, push, **wait for explicit approval before merging to main**.

## 7. Validation Plan
* [ ] TS build passes: `./node_modules/.bin/tsc --noEmit` in `api/`
* [ ] Smoke: `/webhook/get-preview-url` on healthy doc → 200 with previewUrl
* [ ] Stale itemId reconcile (live): call with the alert's `itemId` + originating `recordId` → `{ok:false, code:'FILE_GONE'}`. Re-fetch record → fields nulled, `status` still `Required_Missing`
* [ ] No collateral damage: the sibling tofes_106 (Received, same itemId via DL-230) preview still works
* [ ] Audit dry-run: `?dryRun=1` returns counts + samples
* [ ] Audit purge: `?dryRun=0` clears stale records; re-run dry-run returns 0
* [ ] Admin UI: clicking Preview on stale itemId → red Hebrew toast, doc card refreshes without preview button, no console error spam
* [ ] Regression: `reject` and `reassign` flows still null all 11 fields after helper rewire
* [ ] Regression: edit-documents Received → Missing toggle still clears fields, Cancel restores
* [ ] Hebrew RTL toast direction correct

## 8. Implementation Notes (Post-Code)

- **Helper landed at `api/src/lib/doc-invariants.ts`** with a 16-field null list (broader than DL-205's original 12 — added `attachment_name`, `document_uid`, `reviewed_by`, `reviewed_at` after surveying the divergent inline lists in classifications.ts). Idempotent — null-on-null is a no-op, so it's safe to call from any update path.
- **Wired into 4 sites:** `edit-documents.ts:282` (replaces inline DL-205 sweep), `classifications.ts:1058` (revert_cascade — was clearing only 7/16 fields, biggest gap closed), `:1495` (reject), `:1610` (reassign clear-source). DL-248 / DL-344 reassign + reject "different file" guards preserved.
- **`preview.ts` self-heal:** `isItemNotFoundError(err)` matches HTTP 404 + `itemNotFound`/`could not be found`. On match, the route PATCHes the originating Documents row by `recordId` (not by itemId — DL-230 lets two records share an itemId, must scope to the row that asked) and returns `{ ok: false, code: 'FILE_GONE', message: 'הקובץ אינו זמין יותר ב-OneDrive' }`. `logError` deliberately NOT called for FILE_GONE — that path sends an alert email, and a recovered/expected condition shouldn't page anyone. `console.warn` only.
- **Audit route at `api/src/routes/audit-stale-itemids.ts`:** `?dryRun=1` default, `?verify=1` HEAD-checks each itemId before clearing (off by default for speed). Reports `matched`, `eligibleToClear`, `updated`, `verifiedMissing`, `verifiedExisting`, plus 10-row `samples`. Registered in `api/src/index.ts:78`.
- **Frontend (`script.js`):** `getDocPreviewUrl(itemId, recordId?)` — second arg is the Airtable record id, sent as `?recordId=`. `FILE_GONE` returns a typed `Error` with `err.code = 'FILE_GONE'`. Both call sites (mobile `:625`, desktop `:3814`) pass `item.id`. New `handleFileGoneSelfHeal(item, err)` mirrors the server-side null in the in-memory item, toasts in Hebrew, and best-effort calls `refreshItemDom(item.id)` + `renderDocList()` so the row's preview button disappears. Cache-bust: `script.js?v=362→363`.
- **TS build:** `tsc --noEmit` passes for all DL-356 files. Three pre-existing errors (`backfill.ts:29`, `classifications.ts:1002`, `edit-documents.ts:18`) untouched.
- **Deploy + live sweep deferred** to explicit user approval per `feedback_ask_before_merge_push.md`.
