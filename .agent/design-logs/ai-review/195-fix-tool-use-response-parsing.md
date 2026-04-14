# Design Log 195: Fix Tool-Use Response Parsing in Document Classifier
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-26
**Related Logs:** [131-fix-nii-classification-enum-enforcement](131-fix-nii-classification-enum-enforcement.md), [134-fix-classification-field-ordering-full-enum](134-fix-classification-field-ordering-full-enum.md), [143-classification-test-bugfixes](143-classification-test-bugfixes.md)

## 1. Context & Problem

The AI document classifier in WF05 (`[05] Inbound Document Processing`, `cIa23K8v1PrbDJqY`) is failing to parse **every single** AI classification response. All documents are uploaded as "unidentified" (ממתינים לזיהוי) even though the AI correctly classifies them.

**Root cause:** DL-131 (2026-03-09) switched the classifier from free-text JSON to **tool_use** with `strict: true` and `tool_choice: { type: 'tool', name: 'classify_document' }`. This means Claude's response always has `stop_reason: 'tool_use'` and `content` is an **array** of content blocks (with `type: 'tool_use'`), not a JSON string.

The parser in `Process and Prepare Upload` was never updated:
```javascript
// CURRENT (broken) — expects string, gets array
let raw = resp.content || '';  // resp.content is [{type:'tool_use', input:{...}}]
raw = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
cls = JSON.parse(raw);  // Throws — array has no .replace(), or JSON.parse on object fails
```

**Impact:** Every document processed since DL-131 was implemented (2026-03-09) has been going to manual review instead of being auto-classified. Confirmed in executions:
- #10513 (today): 1 file — Phoenix pension correctly classified as T501 @ 98% confidence by AI, but parser failed
- #10491 (today): 11 files — all "Failed to parse AI response"
- #10489 (today): 4 files — all "Failed to parse AI response"

## 2. User Requirements

1. **Q:** Skip discovery questions — proceed with fix?
   **A:** Yes (user passed "yes/" to design-log)

## 3. Research

### Domain
Claude API Tool Use Response Parsing, Structured Outputs

### Sources Consulted
1. **Anthropic Tool Use Docs** — Tool use response format: `response.content` is an array of content blocks. When `stop_reason` is `tool_use`, the array contains `{type: 'tool_use', id: '...', name: '...', input: {...}}` blocks. The `input` object contains the structured data matching the tool's `input_schema`.
2. **Anthropic Structured Outputs Docs** — With `strict: true` + `anthropic-beta: structured-outputs-2025-11-13`, the `input` object is guaranteed to conform to the schema. No need for additional validation.
3. **DL-134 Research (CRANE paper)** — Field ordering (evidence first) was applied, which means the `input` object already has the correct field structure: `{evidence, issuer_name, confidence, matched_template_id}`.

### Key Principles Extracted
- Tool use responses ALWAYS return `content` as an array, never a string
- With `tool_choice: { type: 'tool', name: 'classify_document' }`, there will always be exactly one `tool_use` block
- With `strict: true`, the `input` object is schema-validated at the token level — no need for additional parsing or validation
- Defensive: should still handle edge cases (text blocks before tool_use, unexpected formats)

### Patterns to Use
- **Extract tool_use input directly:** `content.find(c => c.type === 'tool_use').input`
- **Fallback chain:** tool_use array → text block JSON parse → error fallback

### Anti-Patterns to Avoid
- **Assuming content is a string** — the original bug
- **Re-validating strict mode output** — unnecessary, wastes tokens

### Research Verdict
Straightforward fix: update the parser to handle the tool_use array format. Keep the text-block fallback for robustness.

## 4. Codebase Analysis

### Existing Solutions Found
- `Process and Prepare Upload` node (nodeId: `630031f2-6e40-46ce-be9b-9a617dd290c3`) — the broken parser
- `Prepare Attachments` node (nodeId: `22ed433d-fdcb-4afc-9ce2-c14cab2861c4`) — correctly builds the tool_use request with `tool_choice` and `tools`
- `Process AI Result` node (nodeId: `code-process-ai`) — handles AI Identify Client response; worth checking if it has the same bug

### Reuse Decision
- Fix in-place — only the parser block needs changing, rest of the node logic is correct

### Downstream Consumers
- After parse: `matched_template_id`, `confidence`, `evidence`, `issuer_name` feed into issuer matching, OneDrive path building, and Airtable record creation — all unchanged

### Dependencies
- WF05 must be active
- Node ID: `630031f2-6e40-46ce-be9b-9a617dd290c3`

## 5. Technical Constraints & Risks

- **Risk: None** — the parser fix is backwards-compatible. If a text response somehow arrives, the fallback handles it.
- **Breaking Changes:** None — same output shape from the node.
- **Security:** No security implications.

## 6. Proposed Solution (The Blueprint)

### Change 1: Fix parser in `Process and Prepare Upload`

Replace the broken parse block:
```javascript
// BEFORE (broken)
let cls;
try {
  let raw = resp.content || '';
  raw = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
  cls = JSON.parse(raw);
} catch {
  cls = { matched_template_id: null, confidence: 0, evidence: 'Failed to parse AI response', issuer_name: null };
}
```

With:
```javascript
// AFTER — handle tool_use array format (DL-131 switched to tool_use)
let cls;
try {
  const content = resp.content;
  if (Array.isArray(content)) {
    const toolBlock = content.find(c => c.type === 'tool_use');
    if (toolBlock && toolBlock.input) {
      cls = toolBlock.input;
    } else {
      // Fallback: try text block
      const textBlock = content.find(c => c.type === 'text');
      if (textBlock) {
        cls = JSON.parse(textBlock.text.replace(/^```json\s*/i, '').replace(/```\s*$/, ''));
      } else {
        throw new Error('No tool_use or text block in response');
      }
    }
  } else if (typeof content === 'string') {
    // Legacy: plain text JSON response
    cls = JSON.parse(content.replace(/^```json\s*/i, '').replace(/```\s*$/, ''));
  } else {
    throw new Error('Unexpected content format');
  }
} catch (e) {
  cls = { matched_template_id: null, confidence: 0, evidence: 'Failed to parse AI response: ' + e.message, issuer_name: null };
}
```

### Change 2: Fix client Client Name (CPA-XXX) pending classifications

After deploying the fix, the documents uploaded as "unidentified" for this client need manual correction in Airtable or re-processing.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| WF05 `Process and Prepare Upload` node | Modify | Fix tool_use response parser |

### Final Step (Always)
- **Housekeeping:** Update design log status, INDEX, current-status.md, git commit & push

## 7. Validation Plan
- [ ] Deploy fix to WF05 via `n8n_update_partial_workflow`
- [ ] Send a test email with a document attachment to trigger WF05
- [ ] Verify execution shows `is_identified: true` and correct `matched_template_id`
- [ ] Check admin panel AI review — document should show classification, not "לא זוהה"
- [ ] Fix CPA-XXX (Client Name) pending classification records

## 8. Implementation Notes (Post-Code)
- Fix deployed to WF05 `Process and Prepare Upload` node via `n8n_update_partial_workflow` (2026-03-26)
- Parser now handles: tool_use array → text block fallback → string fallback → error with message
- Only 2 pending classification records affected (both CPA-XXX, today's email)
- All other past "Failed to parse" records were already manually reviewed
- CPA-XXX's 2 pending records need manual assignment via admin panel AI review
