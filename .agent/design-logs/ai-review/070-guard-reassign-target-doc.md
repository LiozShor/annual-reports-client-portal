# Design Log 070: Guard Reassign Target Doc
**Status:** [IMPLEMENTED]
**Date:** 2026-03-01
**Related Logs:** [069-review-classification-race-condition-guard](069-review-classification-race-condition-guard.md)

## 1. Context & Problem

DL069 added a compare-and-set guard on the **source document** during review classification — preventing reject/reassign from clearing a doc already `Received` by a different file. However, the **target document** in a reassign operation has no guard.

When reassigning a classification TO a document that's already `Received`, the `Update Target Doc` node blindly overwrites its `file_hash`, `file_url`, `onedrive_path`, and status — silently replacing a previously-approved document with no warning.

**Scenario:**
1. Admin approves File A for "טופס 867 — אוצר החייל" → doc becomes `Received`
2. Admin reassigns File B to the same "טופס 867 — אוצר החייל" → File A is silently replaced by File B

## 2. User Requirements

1. **Q:** When reassigning to a doc that's already Received, should the system (a) block entirely, (b) warn + let override, or (c) silently proceed?
   **A:** Warn + let override. Show a confirmation dialog explaining the conflict, proceed only if admin confirms.

2. **Q:** If admin cancels the override, should the classification stay pending or be deleted?
   **A:** Keep pending. Don't delete the classification record if the admin cancels.

## 3. Research

### Domain
Concurrency, Optimistic Conflict Detection, Confirmation UX

### Sources Consulted
1. **"Designing Data-Intensive Applications" — Kleppmann** — Compare-and-set prevents lost updates. Application-level conflict detection is the pragmatic choice when the database (Airtable) lacks native optimistic locking. (Already researched in DL069.)
2. **Nielsen Norman Group — Confirmation Dialogs** — Specific confirmation dialogs should name the action and describe consequences. Use action verbs ("Replace Document") not generic "OK". Red/danger styling for destructive actions.
3. **HTTP 409 Conflict** — Standard semantics for "request conflicts with current state of the resource." Appropriate for backend-detected conflicts with client-side resolution.

### Key Principles Extracted
- **Backend detects, frontend resolves:** Backend has the source of truth (current doc state). Frontend has the UX context (can show a dialog and get user confirmation). Conflict detection belongs in the backend; resolution in the frontend.
- **Force flag pattern:** First request fails with conflict details. Client shows confirmation. Second request includes `force_overwrite: true` to bypass the guard. Clean separation of concerns.
- **Critical ordering:** Conflict detection MUST happen before Update Classification — that node deletes the classification record. If we detect after deletion, the admin can't re-submit.

### Anti-Patterns to Avoid
- **Frontend-only guard (checking missingDocs list):** `missingDocs` only shows `Required_Missing` docs. A `Received` doc wouldn't appear there, so the frontend can't reliably detect the conflict.
- **Serializing all webhook executions:** Overkill. Human-speed reviews don't need mutex-level concurrency control.

### Research Verdict
Backend-detected conflict with force flag. Process Action fetches the target doc inline, checks if it's already Received, and returns early with a 409 conflict response if so (unless `force_overwrite` is true). Frontend catches the 409, shows a danger confirmation dialog, and re-submits with the force flag.

## 4. Codebase Analysis

### Workflow: `[API] Review Classification` (`c1d7zPAmHfHM71nV`) — 30 nodes

**Current reassign flow:**
```
Process Action → Update Classification (DELETES record) → IF Doc Update → Update Document
  → IF Reassign → Find Target Doc → Update Target Doc → Build Response → Respond Success
```

**Key nodes:**
- **Parse & Verify**: Destructures `{ classification_id, action, reassign_template_id, reassign_doc_record_id, notes, new_doc_name }`. Needs `force_overwrite` added.
- **Process Action** (Code, pos [1120, 400]): Generates `docUpdate` and `targetDocUpdate`. Has inline fetch pattern already used for Fetch Source Doc guard (DL069).
- **Update Classification** (pos ~[1344, 400]): DELETES the classification record. This is the point of no return — conflict must be detected before this.
- **Find Target Doc** (Code, pos ~[2368, 200]): Uses `this.helpers.httpRequest` with hardcoded Airtable API key. Same pattern we'll reuse for the inline target doc fetch.

**Gap for new nodes:** Between Process Action [1120, 400] and Update Classification [1344, 400] — 224px, room for IF Conflict at [1232, 400].

### Frontend: `admin/js/script.js`

- **`submitAIReassign(recordId, templateId, docRecordId, loadingText, newDocName)`** (line ~2044): Main reassign function. All 3 callers converge here.
- **`showConfirmDialog(message, onConfirm, confirmText, danger)`** (line ~3112): Callback-based. Supports danger styling (red button).
- **`parseAIResponse(response)`** (line ~1840): Parses JSON, checks `data.ok`. No 409/conflict handling.

### Alignment with Research
- The existing `showConfirmDialog` with `danger = true` matches the NN/G recommendation for destructive confirmation dialogs.
- The inline fetch pattern in Find Target Doc provides a proven template for the Airtable call.
- The `force_overwrite` flag pattern is clean and doesn't require new nodes for re-submission — same endpoint, same request shape.

## 5. Technical Constraints & Risks

* **Race window:** Between inline fetch and Update Target Doc, another admin could approve the same target doc. Acceptable at human-speed review cadence.
* **Classification deletion order:** Conflict detection MUST precede Update Classification. If detected after, the classification record is already deleted and the admin can't re-try.
* **Existing source guard compatibility:** DL069's source doc guard runs in the same Process Action code. Both guards are independent — source guard checks `Fetch Source Doc` node, target guard does an inline fetch. No interference.
* **Breaking changes:** None. The `force_overwrite` field is optional and defaults to false. Existing callers (all 3 reassign paths) are unaffected until the frontend is updated.
* **Node count:** 30 → 32 (adding IF Conflict + Respond Conflict)

## 6. Proposed Solution (The Blueprint)

### Logic Flow

1. Admin reassigns classification → frontend calls API
2. Parse & Verify extracts `force_overwrite` (defaults false)
3. Process Action: if `action === 'reassign'` and `reassign_doc_record_id` is set and `force_overwrite` is false:
   - Inline fetch target doc from Airtable (status, file_hash, document_title)
   - If target doc `status === 'Received'` → return `{ conflict: true, ... }`
   - Otherwise → proceed normally
4. IF Conflict node routes:
   - `conflict === true` → Respond Conflict (HTTP 409 with conflict details)
   - `conflict !== true` → Update Classification (existing flow continues)
5. Frontend catches 409 → `showConfirmDialog` with danger styling and Hebrew message
6. If admin confirms → re-submit with `force_overwrite: true` → Process Action skips guard → normal reassign proceeds
7. If admin cancels → nothing happens, classification stays pending

### Workflow Changes

| Change | Node | Details |
|--------|------|---------|
| Update code | **Parse & Verify** | Add `force_overwrite` to destructured fields + return object |
| Update code | **Process Action** | Add inline Airtable fetch for target doc, conflict detection logic |
| Add node | **IF Conflict** at [1232, 400] | Condition: `{{ $json.conflict === true }}` |
| Add node | **Respond Conflict** at [1344, 200] | respondToWebhook, status 409, body = `{{ JSON.stringify($json) }}`, CORS header |
| Rewire | Process Action → IF Conflict → Update Classification | Insert IF Conflict into chain |
| Add connection | IF Conflict (true) → Respond Conflict | New branch for conflict response |

### Frontend Changes

| File | Function | Change |
|------|----------|--------|
| `admin/js/script.js` | `submitAIReassign()` | Add `forceOverwrite` param (default false), add to request body, handle 409 response with `showConfirmDialog` |

### Files to Change

| Location | Action | Description |
|----------|--------|-------------|
| n8n `c1d7zPAmHfHM71nV` | Modify | 4 operations: update Parse & Verify, update Process Action, add IF Conflict, add Respond Conflict, rewire |
| `github/.../admin/js/script.js` | Modify | `submitAIReassign`: forceOverwrite param + 409 handling |

## 7. Validation Plan

* [ ] Reassign to a `Required_Missing` doc → works as before (no conflict triggered)
* [ ] Reassign to a `Received` doc → 409 response, confirm dialog shown with target doc title
* [ ] Confirm overwrite → re-submits with `force_overwrite: true`, target doc updated successfully
* [ ] Cancel overwrite → classification stays pending, no changes made
* [ ] Normal approve/reject → unchanged behavior
* [ ] Source doc guard (DL069) → still fires correctly (no interference)
* [ ] Check execution logs for conflict detection messages

## 8. Implementation Notes (Post-Code)
* **Backend (n8n):** Updated Parse & Verify to pass `force_overwrite`. Updated Process Action with inline Airtable fetch for target doc — returns `{ conflict: true }` when target is `Received` and `force_overwrite` is false. Added IF Conflict node at [1232, 400] routing to Respond Conflict (409) on true branch, Update Classification on false branch. Node count 30→32.
* **Frontend:** Updated `parseAIResponse()` to detect 409 + `conflict` flag and tag response with `_conflict: true`. Updated `submitAIReassign()` with 6th `forceOverwrite` param — on conflict, shows danger `showConfirmDialog` naming the target doc, re-calls with `forceOverwrite=true` on confirm.
