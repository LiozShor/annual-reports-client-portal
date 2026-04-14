# 015 - Workflow [02] Simplification Plan

## Date: 2026-01-26

## User Decisions

1. **Both workflow [02] versions don't work properly** → Need to fix the active one (EMFcb8RlVI0mge6W)
2. **Architecture:** Option A (client-side library)
3. **Priority:** Simplify workflow FIRST, then SSOT rollout
4. **Testing:** Use [TEST] Tally Mock Trigger workflow
5. **MCP Connection:** Available for direct n8n access

---

## CRITICAL DISCOVERY: Missing `person` Field

**Problem:** The Airtable `documents` table does NOT have a `person` field!

**Current schema (from airtable.json):**
```
documents table:
- document_key
- report
- type
- status
- issuer_key
- issuer_name
- file_url
- onedrive_item_id
- bookkeepers_notes
- etc.
```

**Missing:** `person` field (to store "client" or "spouse")

**Why this is critical:**
- The display library relies on `doc.person === 'spouse'` to separate documents
- Without this field, spouse documents cannot be distinguished from client documents
- Workflow [02] generates documents but has nowhere to store the person assignment

---

## Immediate Action Required

### Step 1: Add `person` Field to Airtable (USER MUST DO)

**Table:** documents
**Field name:** `person`
**Field type:** Single Select
**Options:**
  - `client`
  - `spouse`
**Default:** `client`

**Why Single Select and not Text?**
- Prevents typos ("spuse", "Spouse", "SPOUSE", etc.)
- Ensures data consistency
- Easier to filter in formulas

**Instructions for user:**
1. Open Airtable base `appqBL5RWQN9cPOyh`
2. Go to `documents` table
3. Click "+" to add new field
4. Name: `person`
5. Type: Single Select
6. Options: `client`, `spouse`
7. Default: `client`
8. Save

**After adding field:** Notify me so I can proceed with workflow simplification.

---

## Current Workflow [02] Analysis

**ID:** EMFcb8RlVI0mge6W
**Status:** Active, 22 nodes
**Issues:**
- Duplicate/conflicting nodes (old + new architecture mixed)
- Multiple merge operations
- Unclear data flow
- Does NOT populate `person` field (because it doesn't exist yet!)

**Current flow:**
```
1. Webhook (receive Tally submission)
2. Respond to Webhook (immediate - good!)
3. Code - Format & Extract
4. HTTP - Get Document Types (parallel)
5. HTTP - Get Questionnaire Mapping (sequential)
6. HTTP - Get Display Library (parallel)
7. Code - Transform Mapping
8. Merge
9. Merge Mappings
10. Code - DocMapping
11. If (check if docs exist)
12. Airtable - Upsert Documents
13. Code in JavaScript
14. Airtable - List Docs
15. Code in Python
16. Code - Add Docs to Email
17. HTTP Request - Send Email
18. Airtable - Update Annual Report
19. Edit Fields
20. Code - Orchestrator (appears disabled/unused)
21. Item Lists (appears disabled/unused)
22. Code - Email Prep (appears disabled/unused)
```

**Problems:**
- Nodes 20-22 seem unused (need to verify)
- Too many merge operations (2x)
- Code in JavaScript + Code in Python (why both?)
- If node checks if docs exist (unnecessary complexity)

---

## Target Simplified Architecture

**Goal:** 9 nodes (realistic target)

**Flow:**
```
1. Webhook
   ↓
2. Respond to Webhook (immediate)
   ↓
3. HTTP - Fetch document-types.json (parallel)
   ↓
4. HTTP - Fetch questionnaire-mapping.json (parallel)
   ↓
5. HTTP - Fetch document-display-n8n.js (parallel)
   ↓
6. Code - MEGA NODE:
   - Extract system fields (client_name, spouse_name, etc.)
   - Process questionnaire mappings
   - Create documents array with person field
   - Deduplicate documents
   - Generate HTML using display library
   ↓
7. Airtable - Batch Upsert Documents
   ↓
8. Email - Send to Office
   ↓
9. Airtable - Update Report (stage, spouse_name, language)
```

**Benefits:**
- Clear linear flow (no merges)
- All processing in one place (MEGA node)
- Easy to debug
- Faster execution
- Person field populated correctly

---

## MEGA Node Responsibilities

The MEGA node will combine logic from:
- Code - Format & Extract
- Code - Transform Mapping
- Code - DocMapping
- Code - Add Docs to Email

**Inputs (from parallel HTTP nodes):**
- `$('HTTP - Get Document Types').first().json` → document-types.json
- `$('HTTP - Get Questionnaire Mapping').first().json` → questionnaire-mapping.json
- `$('HTTP - Get Display Library').first().json` → display-library code
- `$('Webhook').first().json` → Tally submission

**Processing:**
1. Extract system fields from Tally submission
2. Load mapping rules from questionnaire-mapping.json
3. Iterate through mappings and create documents
4. For each document:
   - Determine `person` field (client vs spouse) based on `isSpouse` flag in mapping
   - Set `issuer_name` with placeholders replaced
   - Set `category` from document-types.json
   - Set `type` (document type ID)
   - Set `status` = "Required_Missing"
   - Set `document_key` = `{report_id}_{type}_{issuer_key}`
5. Deduplicate documents (same document_key)
6. Execute display library code: `eval(displayLibCode)`
7. Generate HTML: `displayLib.generateDocumentListHTML(documents, options)`

**Outputs:**
- `documents` array (for Airtable upsert)
- `emailHtml` (for email body)
- System fields (client_name, spouse_name, report_id, year, etc.)

---

## How `person` Field Will Be Populated

**From questionnaire-mapping.js:**
Each mapping has an `isSpouse` boolean:
```javascript
{
  id: "employment_client",
  isSpouse: false,  // ← This determines person field
  documents: ["Form_106"]
}

{
  id: "employment_spouse",
  isSpouse: true,  // ← Spouse document
  documents: ["Form_106_Spouse"]
}
```

**In MEGA node:**
```javascript
for (const mapping of mappings) {
  if (userAnsweredYes(mapping)) {
    for (const docType of mapping.documents) {
      documents.push({
        type: docType,
        person: mapping.isSpouse ? 'spouse' : 'client',  // ← KEY LINE
        issuer_name: replaceePlaceholders(docType.name_he, userInputs),
        category: docType.category,
        status: 'Required_Missing',
        // ... other fields
      });
    }
  }
}
```

---

## Dependencies

**Before simplification can begin:**
1. ✅ User must add `person` field to Airtable documents table
2. ✅ Verify questionnaire-mapping.json has `isSpouse` field for all mappings
3. ✅ Read current Code nodes to extract logic

**After simplification:**
1. Test with [TEST] Tally Mock Trigger
2. Verify person field is populated correctly
3. Verify spouse name displays correctly in email
4. Deploy to production

---

## Rollback Plan

**If simplified workflow fails:**
1. Keep old workflow [02] (EMFcb8RlVI0mge6W) as backup
2. Create new workflow [02-SIMPLIFIED]
3. Test new workflow thoroughly
4. Switch Tally webhook to new workflow URL
5. Monitor for 24 hours
6. If successful, archive old workflow
7. If failure, revert Tally webhook to old URL

---

## Next Steps

**Waiting on user:**
1. Add `person` field to Airtable documents table
2. Confirm field is added

**After confirmation:**
1. Read Code nodes from current workflow [02]
2. Extract all processing logic
3. Create MEGA node
4. Build simplified workflow
5. Test with mock trigger

---

## Questions for User

1. **Have you added the `person` field to Airtable?** (Single Select: client, spouse)
2. **Should I read the current Code nodes now to understand the logic?**
3. **Should I create a NEW workflow [02-SIMPLIFIED] or modify the existing one?**

---

## Status

⏸️ **BLOCKED** - Waiting for user to add `person` field to Airtable

After field is added → proceed with simplification
