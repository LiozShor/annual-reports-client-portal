# Design Log 394: OneDrive copy-on-also-match (per-target physical copies)
**Status:** [COMPLETED — 2026-05-12]
**Date:** 2026-05-02
**Related Logs:** DL-314 (shared sibling refs), DL-320 (cascade-revert), DL-355 (resolveOneDriveFilename), DL-369/370 (move-classification — similar copy logic), DL-388 (also_match guard), DL-391 (chip-menu follow-up)

## 1. Context & Problem

When admin marks an inbound document as `also_match` for additional templates (e.g. one PDF satisfies T201 + T501), the current flow shares **one** OneDrive file across all N target Documents records — every target row gets the same `file_url` + `onedrive_item_id`. This breaks the "one document = one physical file with the right name" mental model the office runs on. DL-314's `shared_ref_count` / `shared_with_titles` UI (the "🔗 also matches" chip) is a workaround for that semantic mismatch.

The fix: each `also_match` target gets its own physical copy in OneDrive, renamed via `resolveOneDriveFilename` for that target's template/issuer. Matching one PDF to T201 + T501 → two distinct OneDrive items, each named per its target, each Documents record pointing to its own copy.

Side effect: cascade-revert becomes naturally per-card with zero code changes (each record has unique `onedrive_item_id`, so the existing `filterByFormula: {onedrive_item_id} = X` query returns only the primary).

## 2. User Requirements

1. **Q:** If two targets resolve to the same filename, what should happen?
   **A:** Use `@microsoft.graph.conflictBehavior=rename` — Graph appends ` (1)`, ` (2)` automatically.

2. **Q:** What happens to the original file after also_match?
   **A:** Original belongs to the primary classification's doc (renamed by approve flow). Each `also_match` target gets its own fresh copy with the new name.

3. **Q:** If uploading to target N fails partway, what should the Worker do?
   **A:** Rollback all copies (best-effort DELETE already-uploaded), return 502 with structured error.

4. **Q:** Should existing legacy also_match shared-file records be migrated?
   **A:** Leave legacy as-is — going forward only.

5. **Q:** What about DL-314 shared fields (`shared_ref_count`, `shared_with_titles`)?
   **A:** Stop writing — already not persisted (computed at GET time). After DL-394, each record naturally has unique `onedrive_item_id`, count self-collapses to 1. No code change needed.

6. **Q:** Cascade-revert (DL-320) — revert all siblings or just this card?
   **A:** Option A — per card. `revert_cascade` already detects siblings via `filterByFormula: {onedrive_item_id} = X`; after DL-394 each record has unique id so the query returns just the primary. No code change needed.

## 3. Research

### Domain
MS Graph file operations in Cloudflare Workers (synchronous vs. async, binary upload patterns, conflict handling).

### Sources Consulted

1. **[MS Graph driveItem: copy](https://learn.microsoft.com/en-us/graph/api/driveitem-copy)** — `/copy` is asynchronous (202 + Location poll). Bad fit for Cloudflare Workers (CPU/wall-time limits make polling fragile).
2. **[Long-running actions overview](https://learn.microsoft.com/en-us/graph/long-running-actions-overview)** — Confirms async monitor pattern and why it's unsuitable for request-scoped Workers.
3. **[conflictBehavior on simple PUT](https://learn.microsoft.com/en-us/answers/questions/1515186/)** — Simple PUT to folder path supports `?@microsoft.graph.conflictBehavior=rename` as a query param. Returns new `driveItem` JSON (including `id` + `webUrl`) synchronously.

### Key Principles Extracted

- **Stay synchronous in Workers**: polling async Graph operations risks timeout; download+PUT is synchronous and predictable.
- **Single binary download, N uploads**: `getBinary` once, `putBinary` N times — avoids redundant Graph calls.
- **conflictBehavior=rename at the Graph layer**: simpler than managing collision logic in application code.

### Patterns to Use

- **Download-once + N synchronous PUTs**: `getBinary(source)` → loop `putBinary(folderPath + filename, binary)` → capture per-target `id` + `webUrl`.
- **Rollback-on-first-failure**: collect `uploadedItemIds[]`; on any error, DELETE each before returning 502.

### Anti-Patterns to Avoid

- **Using `/copy` endpoint**: returns 202+Location, requires polling — unsuitable for a synchronous request handler.
- **Sharing a single OneDrive item across records**: current pattern — this is exactly what we're replacing.

### Research Verdict

Use `MSGraphClient.getBinary` (already exists) + N calls to `MSGraphClient.putBinary` with folder-path URL + `?@microsoft.graph.conflictBehavior=rename`. Rollback via `MSGraphClient.delete` on error. No new MSGraphClient methods needed.

## 4. Codebase Analysis

- **Existing Solutions Found:**
  - `MSGraphClient.getBinary(path)` (`api/src/lib/ms-graph.ts:45`) — downloads file to ArrayBuffer.
  - `MSGraphClient.putBinary(path, body)` (`api/src/lib/ms-graph.ts:97`) — PUTs binary to a path, returns `driveItem` JSON. Already used with folder-path pattern at `classifications.ts:897`.
  - `MSGraphClient.delete(path)` (`api/src/lib/ms-graph.ts:72`) — for rollback.
  - `resolveOneDriveFilename(...)` (`api/src/lib/classification-helpers.ts:196`) — already imported in `classifications.ts:8`; used by approve, re-classify, finalize-split, upload-document.
  - `DRIVE_ID` — imported from `classification-helpers.ts:8`.
  - `templateMap` — already built at `classifications.ts:1249` within the `also_match` block.
- **Reuse Decision:** All infrastructure reused. Only change is Step C of `also_match` (lines 1400-1424).
- **Relevant Files:** `api/src/routes/classifications.ts` (sole change), `api/src/lib/ms-graph.ts` (read-only), `api/src/lib/classification-helpers.ts` (read-only).
- **Existing Patterns:** Folder-path PUT with conflictBehavior already used at line 897 for PDF-split segment uploads.
- **Alignment with Research:** 100% — synchronous PUT to folder path is the established pattern in this codebase.
- **Dependencies:** MS Graph (OneDrive), Airtable, CACHE_KV (already invalidated in Step E).

## 5. Technical Constraints & Risks

- **Security:** No PII changes. `sanitizeEmail` already applied to `sender_email`. Source file stays under same client OneDrive folder.
- **Operational Risks:**
  - Wall-time: download once + N uploads. Tax PDFs typically <5 MB; 5 targets ≈ 10s serial upload — within Workers' 30s wall-clock budget.
  - Rollback gaps: if Worker dies mid-upload (OOM/cold-start kill), orphan copies persist. DL-376 orphan-rename pass catches these.
  - Graph rate limits: serial uploads avoid concurrent-request throttling.
- **Breaking Changes:** No schema change. No frontend change. Legacy shared-file records unaffected (each retains its existing `onedrive_item_id`). `revert_cascade` behavior for new records changes naturally (per-card) without a code change.
- **Mitigations:** `conflictBehavior=rename` handles same-filename collision at Graph level. Rollback loop best-effort deletes copies before returning error.

## 6. Proposed Solution

### Success Criteria

Admin performs `also_match` on an inbound card for N templates → N new distinct OneDrive files appear in the client's filing folder, each named per its target template/issuer, each Documents Airtable record pointing to its own unique `onedrive_item_id` + `file_url`.

### Logic Flow

1. **C1** — fetch source file's parent folder id via `GET /drives/{DRIVE_ID}/items/{sharedItemId}?$select=parentReference`.
2. **C2** — download source binary once via `getBinary(/drives/{DRIVE_ID}/items/{sharedItemId}/content)`.
3. **C3** — for each `resolvedTarget`: resolve filename via `resolveOneDriveFilename({ templateId: r.templateId, issuerName: r.fields.issuer_name, ... })`, PUT binary to `/{folderId}:/{filename}:/content?@microsoft.graph.conflictBehavior=rename`, capture `{ id, webUrl }`.
4. **Rollback** — on any upload error: DELETE all previously uploaded item IDs, return 502 `partial_copy_failure`.
5. **C4** — PATCH each target Documents record with its own `file_url: newWebUrl`, `onedrive_item_id: newItemId`.

### Data Structures / Schema Changes

None. All existing Airtable fields used as-is.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | Replace Step C body (lines 1400-1424): shared-pointer write → download-once + per-target upload + per-target PATCH |

### Final Step

- Update design log status to `[IMPLEMENTED — NEED TESTING]`.
- Update INDEX.md row 394.
- Copy Section 7 items to `.agent/current-status.md` Active TODOs.
- Invoke `git-ship` skill.

## 7. Validation Plan

- [ ] `./node_modules/.bin/tsc --noEmit` from `api/` — type-check clean.
- [ ] Two-target also_match happy path: inbound PDF matched to two templates → OneDrive shows two files with target-appropriate names, each Documents record has unique `onedrive_item_id` + `file_url`, `file_hash` identical.
- [ ] Cascade-revert post also_match: revert source classification → primary doc cleared + primary file archived; also_match sibling UNTOUCHED.
- [ ] Legacy data: existing pre-DL-394 shared record → revert still cascades across siblings (legacy behavior unaffected).
- [ ] DL-314 chip: new post-DL-394 also_match record → admin UI does not show "🔗 also matches" chip (count = 1).

## 8. Implementation Notes

Step C rewrite applied at `classifications.ts:1400-1424`. `msGraph` instantiated inside the `also_match` block (was not present before). `resolveOneDriveFilename` + `templateMap` already in scope. `encodeURIComponent` on filename before building folder-path URL (same pattern as line 897). Rollback tracks `uploadedItemIds[]` before Airtable writes. Return shape extended with `uploaded_item_ids` for observability.
