# Design Log 173: Cloudflare Workers — MS Graph Phase 4b (Classifications)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-23
**Related Logs:** DL-172 (Phase 4a: get-preview-url + get-client-documents), DL-112 (webhook dedup), DL-129 (short names), DL-070 (conflict guard), DL-081 (inline PATCH), DL-137 (file rename)

## 1. Context & Problem
Phase 4a migrated 2 MS Graph endpoints to Workers (4-10x speedup). Phase 4b migrates the remaining 2 — the AI classification review system:
- `get-pending-classifications`: 3-6s on n8n → powers the AI Review tab (most complex read endpoint)
- `review-classification`: 3-6s on n8n → approve/reject/reassign with OneDrive file move/rename (most complex write endpoint in the entire system)

After this phase: 17/22 endpoints on Workers.

## 2. User Requirements
1. **Q:** Full migration or hybrid?
   **A:** Full migration — port all logic including OneDrive file operations.

2. **Q:** Exact port of DL-112/DL-129 edge cases?
   **A:** Exact port — identical behavior to n8n.

3. **Q:** Subagent-driven?
   **A:** Yes, same pattern as Phase 4a.

## 3. Research
### Domain
See DL-172 for prior research on: OAuth2 edge token management, MS Graph batch API, file URL lifecycle.

### Incremental Findings (Phase 4b specific)
- **MS Graph file move/rename:** Single PATCH to `/drives/{driveId}/items/{itemId}` with `name` + `parentReference.id` in body. `@microsoft.graph.conflictBehavior=rename` query param handles duplicates.
- **Folder creation:** POST to `/drives/{driveId}/items/{parentId}/children` with `{ name, folder: {}, @microsoft.graph.conflictBehavior: 'fail' }`. If folder exists, GET by path: `/drives/{driveId}/items/{parentId}:/{folderName}:`
- **Sequential dependencies:** File move requires folder ID, which requires year folder ID, which requires current file location. These are 3-4 sequential MS Graph calls — cannot be parallelized.

### Research Verdict
Reuse all MS Graph infrastructure from Phase 4a. The file operations are sequential by nature (each step needs the previous result), so no optimization possible there — just clean, error-handled sequential calls.

## 4. Codebase Analysis
* **Existing Solutions:** MSGraphClient (get/post/patch/batch), AirtableClient, doc-builder maps, auth middleware — all reusable
* **Reuse:** `buildCategoryMap`, `buildTemplateMap` from doc-builder; MSGraphClient for all OneDrive ops
* **New code needed:** `buildShortName` (exists in n8n but not yet in Worker), `HE_TITLE` map, rejection reason mapping, OneDrive folder navigation helpers

## 5. Technical Constraints & Risks
* **Sequential file ops:** 3-4 MS Graph calls per review action (irreducible latency ~400-800ms)
* **Folder creation race:** If two reviews happen simultaneously for same client, both may try to create archive folder. `conflictBehavior=fail` + GET fallback handles this.
* **Stage advancement:** Must re-fetch report after doc updates to check current state.
* **Response must return before file move completes** — n8n does this too (Build Response runs before file ops). We can use the same pattern or make file ops synchronous (Worker has 30s CPU time).

## 6. Proposed Solution
See plan file for full task breakdown (5 tasks).

## 7. Validation Plan
* [ ] Get Pending: returns pending + reviewed-unsent classifications
* [ ] Get Pending: inactive clients filtered (DL-102)
* [ ] Get Pending: file hash dedup (DL-112)
* [ ] Get Pending: short name resolution (DL-129)
* [ ] Get Pending: stats correct (matched, unmatched, high_confidence, pending, reviewed)
* [ ] Get Pending: OneDrive URLs resolved via batch
* [ ] Get Pending: response shape matches n8n (JSON diff)
* [ ] Review: approve → doc Received, file renamed
* [ ] Review: reject → doc Required_Missing, file to ארכיון, Hebrew reason
* [ ] Review: reassign → source cleared, target assigned, file to זוהו
* [ ] Review: DL-070 conflict guard returns 409
* [ ] Review: custom doc creation (general_doc)
* [ ] Review: DL-081 inline PATCH clears null fields
* [ ] Review: OneDrive folder creation (archive/zohu)
* [ ] Review: stage advancement (all docs Received → Review)
* [ ] Review: response shape matches n8n
* [ ] Frontend: AI Review tab loads from Worker
* [ ] Frontend: approve/reject/reassign actions work

## 8. Implementation Notes (Post-Code)
* Subagent-driven: 4 implementer agents (Tasks 1-4), all passed TypeScript checks
* get-pending-classifications tested: 2 items returned, stats correct, confidence 0.95
* review-classification: deployed but not yet tested end-to-end (approve/reject/reassign actions)
* OneDrive file operations: synchronous within Worker (not async/waitUntil)
* Also fixed pre-existing bug: reminder confirmation dialog missing client name (r.name → r.client_name)
