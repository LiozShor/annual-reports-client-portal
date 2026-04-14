# Design Log 069: Review Classification — Race Condition Guard
**Status:** [IMPLEMENTED]
**Date:** 2026-03-01
**Related Logs:** [054-inline-stage-advancement](054-inline-stage-advancement-review-classification.md), [058-add-new-doc-from-ai-review](058-add-new-doc-from-ai-review.md)

## 1. Context & Problem

When multiple email attachments are classified against the **same document record**, the individual review actions (approve/reassign/reject) can overwrite each other because they blindly write without checking the document's current state.

**Reproduction (executions 4164-4168):**
1. doc02.pdf & doc03.pdf both classified as "טופס 867 – אוצר החייל" (`rechEUOUHMJ9Vs7x2`)
2. Exec 4165: admin **approved** doc02.pdf → doc set to `Received` ✅
3. Exec 4166: admin **reassigned** doc03.pdf to מיטב → reassign logic **cleared** אוצר החייל back to `Required_Missing` ❌

The reassign's "clear source doc" step doesn't check whether the doc was already `Received` by a *different* file.

**Two bugs:**
- **Bug 1 (reassign/reject clears approval):** Reassign and reject always reset the source doc to `Required_Missing`, even if a different classification already approved it.
- **Bug 2 (approve overwrites file):** Approve always writes file fields, even if a different file was already placed by another classification.

## 2. User Requirements

1. **Q:** When two classifications point to the same doc and one is approved while the other is reassigned, should the reassign skip clearing if the doc is already Received?
   **A:** Yes — skip clearing if Received (compare-and-set guard).

2. **Q:** Should we also guard against approve overwriting a different file on the same doc?
   **A:** Yes — guard both directions.

## 3. Research

### Domain
Concurrency / Lost Updates, Compare-and-Set, Workflow Orchestration

### Sources Consulted
1. **"Designing Data-Intensive Applications" — Kleppmann** — Lost update problem: two concurrent read-modify-write cycles cause one to silently overwrite the other. Fix: compare-and-set ("set value = X only if current value = Y").
2. **Airtable API / Community** — Airtable has no native optimistic locking, conditional writes, or row-level locks. All guards must be application-level: read-then-guard-then-write.
3. **n8n Concurrency Patterns** — n8n has no per-workflow concurrency limit. Each webhook execution runs independently. Fix: make each write operation state-aware and defensive.

### Key Principles Extracted
- **Never blind-write:** Always read current state before writing. If state has changed, skip or adjust.
- **Monotonic status transitions:** Status should only move forward (`Required_Missing → Received`). A reassign/reject should not downgrade a doc that's already `Received` from a different file.
- **Use file_hash as fencing token:** Compare `cls.file_hash` with the doc's current `file_hash`. If they differ, a different file is on the doc — don't clear/overwrite it.

### Anti-Patterns to Avoid
- **Serializing all webhook executions:** Overkill and unavailable on n8n Cloud. Application-level guard is lighter and sufficient.
- **Lock fields in Airtable:** Subject to their own race window. Compare-and-set on actual state is more reliable.

### Research Verdict
Add a **Fetch Source Doc** node to read current document state, then use a **compare-and-set guard** in Process Action. The guard uses `file_hash` comparison: if the doc's current file hash differs from this classification's file hash, a different classification owns the doc — skip clearing/overwriting.

## 4. Codebase Analysis

### Workflow: `[API] Review Classification` (`c1d7zPAmHfHM71nV`) — 28 nodes

**Current flow (review chain):**
```
Get Classification → Get Report → Process Action → Update Classification
  → IF Doc Update ─┬─ [true] → Update Document → IF Reassign ─┬─ [true] → Find Target Doc → Update Target Doc → Build Response
                    │                                           └─ [false] → Build Response
                    └─ [false] → IF Reassign (same branches)
```

**Key insight:** IF Doc Update `false` branch goes directly to IF Reassign. So setting `has_doc_update = false` + `is_reassign = true` will skip clearing the source doc but still process the target doc.

### Process Action (`code-process-action`, pos [1120, 400])
- Generates `doc_update` object with target fields for Airtable update
- For reassign/reject: always sets `status: 'Required_Missing'` and clears all file fields
- For approve: always sets `status: 'Received'` and writes all file fields
- **No guard** — doesn't check current doc state

### Update Document (`at-update-document`)
- Reads all fields from `$('Process Action').first().json.doc_update`
- Applies blindly to Airtable

### Gap: [896, 400] → [1120, 400]
224px between Get Report and Process Action — room to insert Fetch Source Doc at [1008, 400].

## 5. Technical Constraints & Risks

* **Race window:** There's still a narrow window between Fetch Source Doc and Update Document. Acceptable since classification reviews are human-speed (seconds apart), not millisecond-level concurrent.
* **No doc case:** If `cls.document` is empty (shouldn't happen for approve/reject/reassign, but edge case), Fetch Source Doc would fail. Use `onError: "continueRegularOutput"` to handle gracefully.
* **Backwards compatible:** Response format unchanged. Frontend not affected.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

1. **Add node "Fetch Source Doc"** — Airtable GET to fetch the matched document's current `status` and `file_hash`
2. **Modify "Process Action"** — add compare-and-set guard before generating `doc_update`:
   - Read current doc from `$('Fetch Source Doc')`
   - **Reassign guard:** If `currentDoc.status === 'Received'` AND `currentDoc.file_hash !== cls.file_hash` → skip clearing (`doc_update = null`, `has_doc_update = false`). Target doc update still proceeds via `is_reassign = true`.
   - **Reject guard:** Same check — if doc already Received with a different file, skip clearing.
   - **Approve guard:** If `currentDoc.status === 'Received'` AND `currentDoc.file_hash` exists AND `currentDoc.file_hash !== cls.file_hash` → skip overwriting (`doc_update = null`, `has_doc_update = false`). Add `skipped_reason` to output for admin visibility.
3. **No other nodes change** — IF Doc Update, Update Document, IF Reassign all work correctly with the existing branching.

### Guard Logic (Process Action pseudocode)

```javascript
// Read current doc state (from new Fetch Source Doc node)
let currentDoc = null;
try {
  const fetched = $('Fetch Source Doc').first().json;
  if (fetched && fetched.id) currentDoc = fetched;
} catch (e) { /* no doc fetched — proceed without guard */ }

// For reassign/reject: guard against clearing a doc that's already Received by a different file
if ((action === 'reassign' || action === 'reject') && matchedDocId && currentDoc) {
  if (currentDoc.status === 'Received' && currentDoc.file_hash && currentDoc.file_hash !== cls.file_hash) {
    // Different file already approved — don't clear
    docUpdate = null;
    console.log(`[GUARD] Skip clearing doc=${matchedDocId}: already Received with different file`);
  }
}

// For approve: guard against overwriting a different file
if (action === 'approve' && matchedDocId && currentDoc) {
  if (currentDoc.status === 'Received' && currentDoc.file_hash && currentDoc.file_hash !== cls.file_hash) {
    // Different file already approved — don't overwrite
    docUpdate = null;
    console.log(`[GUARD] Skip approve overwrite doc=${matchedDocId}: already Received with different file`);
  }
}
```

### Workflow Changes

| Change | Node | Action |
|--------|------|--------|
| Add node | **Fetch Source Doc** (Airtable GET) | Fetch `status`, `file_hash` for `cls.document[0]`. Position [1008, 400]. |
| Rewire | Get Report → **Fetch Source Doc** → Process Action | Insert into chain |
| Update code | **Process Action** | Add compare-and-set guard using `$('Fetch Source Doc')` |

### Files to Change

| Location | Action | Description |
|----------|--------|-------------|
| n8n `c1d7zPAmHfHM71nV` | Modify | Add Fetch Source Doc node, rewire, update Process Action code |

## 7. Validation Plan

* [ ] Test: Approve doc02.pdf for אוצר החייל, then reassign doc03.pdf (also matched to אוצר החייל) → אוצר החייל should stay Received
* [ ] Test: Approve doc02.pdf for אוצר החייל, then reject doc03.pdf (also matched) → אוצר החייל should stay Received
* [ ] Test: Normal approve (no conflict) → doc should become Received as before
* [ ] Test: Normal reassign (no conflict, source doc is Required_Missing) → source doc cleared, target doc Received
* [ ] Test: Normal reject (no conflict) → doc reset to Required_Missing
* [ ] Check execution logs for GUARD messages when skip occurs

## 8. Implementation Notes (Post-Code)
* **No deviations from plan.** All 3 changes applied atomically via `n8n_update_partial_workflow` (5 operations).
* Added `&& docUpdate` to the guard condition — minor optimization to skip the guard entirely when docUpdate is already null (e.g., no matched doc). This is redundant since `matchedDocId` being truthy guarantees `docUpdate` is set, but makes the intent clearer.
* Fetch Source Doc node uses `onError: "continueRegularOutput"` so empty/missing document IDs don't crash the workflow.
* Workflow remained active throughout the update (no deactivation needed — partial update succeeded on active workflow).
