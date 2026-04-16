# Design Log 054: Inline Stage Advancement in Review Classification
**Status:** [DONE]
**Date:** 2026-02-24
**Related Logs:** [031-wf04-document-edit-handler-rebuild](031-wf04-document-edit-handler-rebuild.md), [036-ai-classification-review-interface](036-ai-classification-review-interface.md), [049-onedrive-file-ops-rename-move](049-onedrive-file-ops-rename-move.md)

## 1. Context & Problem

When a client sends their last document via email:
1. WF[05] processes it → creates `pending_classification` record
2. Office approves classification via [API] Review Classification (`c1d7zPAmHfHM71nV`)
3. Document status → "Received" ✅
4. **Stage never advances from `3-Collecting_Docs` → `4-Review`** ❌

WF[04] (Document Edit Handler) was the only place that checked completion and advanced the stage, but it is never called by [API] Review Classification. The fix is to inline the completion check directly in [API] Review Classification — data is already in scope, no round-trip to WF[04] needed.

**Secondary bug:** "Move/Rename File" fails with `"URL parameter must be a string, got undefined"` when `onedrive_item_id` is missing on the classification record. This causes "Update File URLs" to fail silently (response already sent).

## 2. User Requirements

1. **Q:** Should the completion check call WF[04] or be inlined?
   **A:** Inline — smarter, data is already in scope.

2. **Q:** Should stage advancement be synchronous (blocking response) or async (after Respond Success)?
   **A:** Async — keep response fast, run completion check in parallel with file ops.

## 3. Research

### Domain
Workflow Orchestration — State Machine transitions, pipeline fan-out patterns.

### Prior Research
See design-log 031 (WF[04] rebuild) for prior research on stage advancement logic and completion detection.

### Key Principles Applied
- **Single Responsibility:** Each workflow owns its own state transitions. [API] Review Classification already owns the document → Received transition; owning the stage check too is cohesive, not a violation.
- **Fan-out after response:** Non-blocking work (file ops, state checks) fans out from "Respond Success" in parallel. Both branches are independent — completion check doesn't depend on file move success.
- **Guard before expensive chain:** If required data (item ID) is missing, skip the file ops chain rather than failing mid-chain. Fail fast, fail cheap.

### Anti-Patterns to Avoid
- **Inter-workflow call just to check a number:** Calling WF[04] via webhook to re-fetch and check `completion_percent` is wasteful when the report ID is already in scope.
- **Blocking the webhook response on file ops:** Already avoided — file ops run async. Completion check follows same pattern.

## 4. Codebase Analysis

### [API] Review Classification (`c1d7zPAmHfHM71nV`) — 24 nodes
Current async tail (after Respond Success):
```
Respond Success
  └─→ Prepare File Move → Get File Location → Get Year Folder
        → Create Archive Folder → Get Archive Folder
        → Create Zohu Folder → Get Zohu Folder
        → Build Move Body → Move/Rename File → Update File URLs
```

### Data available at "Respond Success"
- `classification.annual_report_id` — linked field on pending_classifications (or derivable from document record)
- `document.id` — the matched document record ID
- The classification record fields are available from "Get Classification" node output

### Completion Logic (from WF[04] design-log 031)
```javascript
// Re-fetch report for fresh rollups
const report = await airtable.get(annual_report_id);
if (report.docs_missing_count === 0 && report.stage === '3-Collecting_Docs') {
  await airtable.update(annual_report_id, {
    stage: '4-Review',
    docs_completed_at: new Date().toISOString()
  });
}
```

### OneDrive Bug Root Cause
"Prepare File Move" tries to build the OneDrive PATCH URL using `classification.onedrive_item_id`. When this field is null (e.g., file upload failed or item ID wasn't saved), the URL becomes `undefined` → HTTP request fails → "Update File URLs" gets 0 items.

### Files Changed
- `[API] Review Classification` (`c1d7zPAmHfHM71nV`) — n8n MCP update only, no GitHub files

## 5. Technical Constraints & Risks

- **Airtable rollups are not instant** — brief delay between document update and rollup recalculation. Mitigation: the async chain (file ops) takes ~2-5 seconds; "Re-fetch Report" runs after that delay naturally.
- **`annual_report_id` availability** — must verify it's accessible in the post-Respond-Success context. Will confirm by reading the "Get Classification" output structure.
- **Idempotency** — if the webhook fires twice, the stage check must be safe. Guard: `stage === '3-Collecting_Docs'` prevents double-advancement.
- **OneDrive guard** — skip flag must be set before the chain, not inline in each node.

## 6. Proposed Solution

### A. Completion Check (3 new nodes, fan-out from Respond Success)

```
Respond Success
  ├─→ Prepare File Move → ... (existing) ... → Update File URLs
  └─→ Re-fetch Report (Airtable GET annual_reports by report_id)
        ↓
      IF Complete (docs_missing_count == 0 AND stage == '3-Collecting_Docs')
        ↓ [true]
      Advance to Stage 4 (Airtable PATCH: stage='4-Review', docs_completed_at=now)
```

**New nodes:**
| Node | Type | Config |
|------|------|--------|
| Re-fetch Report | airtable | Operation: Get, Table: annual_reports, ID: `{{ $('Get Classification').item.json.fields.annual_report_id[0] }}` |
| IF Complete | if | `{{ $json.fields.docs_missing_count }} == 0` AND `{{ $json.fields.stage }} == '3-Collecting_Docs'` |
| Advance to Stage 4 | airtable | Operation: Update, Table: annual_reports, Fields: `stage='4-Review'`, `docs_completed_at=ISO timestamp` |

### B. OneDrive Guard (1 new node / modify Prepare File Move)

In **Prepare File Move** code node, add at the top:
```javascript
const itemId = $json.onedrive_item_id;
if (!itemId) {
  return [{ json: { _skip_file_ops: true } }];
}
```

Add **IF Has Item ID** node after Prepare File Move:
- `[true]` → Get File Location → ... → Update File URLs (existing chain)
- `[false]` → no-op (end of branch)

### Files to Change

| Target | Action | Description |
|--------|--------|-------------|
| `c1d7zPAmHfHM71nV` | Modify via n8n MCP | Add 3 completion-check nodes + 1 guard node, new connections |

## 7. Validation Plan

- [ ] Send a test doc as the last missing document for a client
- [ ] Approve classification in admin panel
- [ ] Verify: `stage` in Airtable → `4-Review` within ~10 seconds
- [ ] Verify: `docs_completed_at` timestamp is set
- [ ] Verify: client appears in "מוכנים לבדיקה" tab
- [ ] Verify: no double-advancement if approval fires twice (idempotency)
- [ ] Verify: client with >0 missing docs after approval stays at stage 3
- [ ] Verify: missing `onedrive_item_id` → file ops skipped gracefully, no error in execution

## 8. Implementation Notes

**Implemented:** 2026-02-24 via single `n8n_update_partial_workflow` call (10 operations).

### Nodes added (24 → 28 nodes)
| Node | ID | Position |
|------|-----|----------|
| Re-fetch Report | `at-refetch-report` | [4608, 500] |
| IF Complete | `if-complete` | [4832, 500] |
| Advance to Stage 4 | `at-advance-stage4` | [5056, 500] |
| IF Has Item ID | `if-has-item-id` | [2464, 560] |

### Connection changes
- Removed: Prepare File Move → Get File Location
- Added: Respond Success → Re-fetch Report (fan-out)
- Added: Re-fetch Report → IF Complete
- Added: IF Complete [true] → Advance to Stage 4
- Added: Prepare File Move → IF Has Item ID
- Added: IF Has Item ID [true] → Get File Location

### Notes
- Re-fetch Report uses `$('Get Classification').item.json.fields.report[0]` — `report` is the correct linked field name in `pending_classifications` (not `annual_report_id` as noted in section 6)
- Credentials added to both new Airtable nodes post-creation (activation would fail otherwise)
- Validation: 3 pre-existing errors in workflow unchanged; 0 errors on new nodes
