# Design Log 025: Workflow [02] Data Flow Fix Needed

**Date:** 2026-01-26
**Status:** IN PROGRESS - Session ended, needs continuation in Plan Mode

---

## Problem Summary

Workflow [02] Questionnaire Response Processing V2 (ID: EMFcb8RlVI0mge6W) is broken. Multiple fixes were attempted but the data flow between nodes is still not working correctly.

---

## Last Known State (Execution 1904)

| Node | Status | Output |
|------|--------|--------|
| Generate Documents | ✅ Success | 30 documents |
| Finalize & Format | ❌ Wrong output | Metadata only, not documents |
| Airtable Batch Upsert | ❌ Failed | Received metadata instead of documents |

---

## The Core Problem

The workflow has 3 Code nodes in sequence that don't properly pass data:

1. **Extract & Prepare** → outputs system fields + DOCUMENT_TYPES + QUESTION_MAPPINGS
2. **Generate Documents** → reads from Extract & Prepare, outputs individual document items
3. **Finalize & Format** → should collect all documents and pass to Airtable

But downstream nodes (Airtable Batch Upsert, Code - Prepare Search Query, Code - Generate Email HTML, Code - Prepare Report Update) expect different data structures than what's being passed.

---

## Files with Current Code

- `C:\Users\liozm\Desktop\moshe\annual-reports\extract-and-prepare-FIXED.js`
- `C:\Users\liozm\Desktop\moshe\annual-reports\node2_current.js` (Generate Documents)

---

## What Needs to Happen (Next Session - Plan Mode)

1. Read the current state of ALL Code nodes in Workflow EMFcb8RlVI0mge6W
2. Map out the actual data flow: what each node outputs and what the next node expects
3. Identify all mismatches
4. Create a coherent fix plan where each node's output matches the next node's input
5. Test with a real Tally submission (execution 1904 had real data with 30 documents)

---

## Key Technical Details

- **Merge node** outputs 5 items: Webhook data, Document Types, Questionnaire Mapping, Display Library, SSOT Module
- **questionnaire-mapping.json** uses `mappings` array (not `questions`)
- **document-types.json** has `document_types` object
- **Airtable documents table** expects: document_key, report (linked field as array), type, status, issuer_name, etc.
- **Airtable Search formula**: `FIND("recXXX", ARRAYJOIN({report}, ","))`

---

## Fixes Applied This Session (2026-01-26)

1. ✅ Fixed Merge node: mode="append", numberInputs=5
2. ✅ Fixed Extract & Prepare: passes DOCUMENT_TYPES and QUESTION_MAPPINGS
3. ✅ Updated Generate Documents: uses correct code with `report: [report_record_id]`
4. ✅ Fixed Code - Prepare Search Query: gets report_record_id from Extract & Prepare
5. ✅ Fixed Code - Generate Email HTML: uses correct field access
6. ✅ Fixed Code - Prepare Report Update: gets data from Extract & Prepare
7. ✅ Fixed Airtable Search formula: uses `{report}` not `{report_record_id}`
8. ✅ Fixed Finalize & Format: uses `$input.all()` to get all documents

---

## Still Broken

Despite all fixes, the data flow is still not working correctly. The nodes were fixed individually but the overall data contract between nodes needs to be mapped out and verified.

---

## Next Session Prompt

```
Context: Workflow [02] Questionnaire Response Processing V2 (ID: EMFcb8RlVI0mge6W) is broken. Multiple fixes were attempted but the data flow between nodes is still not working correctly.

Last Known State (Execution 1904):
- Generate Documents: Created 30 documents ✅
- Finalize & Format: Output only metadata, not documents ❌
- Airtable Batch Upsert: Failed - received metadata instead of documents ❌

The Core Problem:
The workflow has 3 Code nodes in sequence that don't properly pass data:
1. Extract & Prepare → outputs system fields + DOCUMENT_TYPES + QUESTION_MAPPINGS
2. Generate Documents → reads from Extract & Prepare, outputs individual document items
3. Finalize & Format → should collect all documents and pass to Airtable

But downstream nodes (Airtable Batch Upsert, Code - Prepare Search Query, Code - Generate Email HTML, Code - Prepare Report Update) expect different data structures than what's being passed.

Files with Current Code:
- C:\Users\liozm\Desktop\moshe\annual-reports\extract-and-prepare-FIXED.js
- C:\Users\liozm\Desktop\moshe\annual-reports\node2_current.js (Generate Documents)

What Needs to Happen:
1. Read the current state of ALL Code nodes in Workflow EMFcb8RlVI0mge6W
2. Map out the actual data flow: what each node outputs and what the next node expects
3. Identify all mismatches
4. Create a coherent fix plan where each node's output matches the next node's input
5. Test with a real Tally submission (execution 1904 had real data with 30 documents)

Key Technical Details:
- Merge node outputs 5 items: Webhook data, Document Types, Questionnaire Mapping, Display Library, SSOT Module
- questionnaire-mapping.json uses `mappings` array (not `questions`)
- document-types.json has `document_types` object
- Airtable documents table expects: document_key, report (linked field as array), type, status, issuer_name, etc.
- Airtable Search needs formula: FIND("recXXX", ARRAYJOIN({report}, ","))

Design Log: .agent/design-logs/025-workflow-02-data-flow-fix-needed.md

Goal: Get a complete working workflow where a Tally submission creates documents in Airtable and sends an email to the office.
```

---

## Related Design Logs

- `024-ssot-alignment-comprehensive-audit.md` - Full SSOT alignment plan
- `023-mega-node-refactoring.md` - Original refactoring plan

