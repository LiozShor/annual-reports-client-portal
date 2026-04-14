# Design Log 095: Fix Bulk Send Questionnaires (Only First Client Processed)
**Status:** [DRAFT]
**Date:** 2026-03-05
**Related Logs:** None

## 1. Context & Problem
When selecting multiple clients in the admin "שליחת שאלונים" tab and clicking send, only the first client receives the questionnaire email and only their report is updated to stage 2. The loading modal correctly shows "שולח 3 שאלונים" but the result shows "1 נשלחו".

**Root cause (confirmed via execution 5593 data):**
- `Verify & Split` → 3 items
- `If Valid` → 3 items
- `Get Report` → 3 items
- `Get Client` → 3 items
- **`Build Email Data` → 1 item** (drops from 3 to 1)
- All downstream: 1 item

The "Build Email Data" Code node (v2, default `runOnceForAllItems` mode) uses `$input.item` which is an alias for `$input.first()` — it only returns the first item. The node then returns a single `{ json: {} }`, discarding items 2+.

## 2. User Requirements
1. **Q:** Did you receive 1 email or 3?
   **A:** Only 1 email
2. **Q:** How many reports moved to stage 2?
   **A:** Only 1

## 3. Research
### Domain
n8n Code node item handling patterns

### Key Principle
In n8n Code node v2, mode `runOnceForAllItems` (default) receives ALL items at once. `$input.item` returns only the first — must use `$input.all()` to iterate. Alternatively, mode `runOnceForEachItem` executes the code once PER item, where `$input.item` correctly references the current item.

### Research Verdict
Change mode to `runOnceForEachItem`. The existing code already uses `$input.item` and `$('Get Report').item` (single-item accessors) — they'll work correctly in per-item mode with zero code changes.

## 4. Codebase Analysis
**Workflow:** `[01] Send Questionnaires` (`9rGj2qWyvGWVf9jXhv7cy`)
**Broken node:** `Build Email Data` (ID: `c773bfd8-8e03-481b-b1c1-1824f9acf92f`)

Current code (no changes needed, just mode change):
```javascript
const report = $('Get Report').item.json;  // first item only in runOnceForAllItems!
const client = $input.item.json;            // first item only in runOnceForAllItems!
// ... builds email data ...
return { json: { ... } };  // single item output
```

In `runOnceForEachItem` mode:
- `$input.item` → current item (correct)
- `$('Get Report').item` → matching item by index (correct)
- `return { json: {} }` → one output per execution, N total (correct)

## 5. Technical Constraints & Risks
* **Security:** No impact — auth token verified in Verify & Split (upstream)
* **Risks:** None — only changes execution mode of one node, code stays identical
* **CORS note:** "Respond Success" has `Access-Control-Allow-Origin: *` instead of `https://liozshor.github.io` — separate issue, not fixing here

## 6. Proposed Solution (The Blueprint)
### Change
Update "Build Email Data" node to add `mode: "runOnceForEachItem"` parameter. No code changes needed.

### n8n Update
```json
{
  "type": "updateNode",
  "nodeId": "c773bfd8-8e03-481b-b1c1-1824f9acf92f",
  "updates": {
    "parameters": {
      "mode": "runOnceForEachItem",
      "jsCode": "<existing code unchanged>"
    }
  }
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n WF `9rGj2qWyvGWVf9jXhv7cy` "Build Email Data" node | Modify | Add `mode: "runOnceForEachItem"` |

## 7. Validation Plan
* [ ] Select 3 test clients, send questionnaires → result modal shows "3 נשלחו"
* [ ] All 3 emails arrive at liozshor1@gmail.com
* [ ] All 3 reports updated to stage `2-Waiting_For_Answers` in Airtable
* [ ] Single client send still works (regression)

## 8. Implementation Notes (Post-Code)
*To be filled after implementation.*
