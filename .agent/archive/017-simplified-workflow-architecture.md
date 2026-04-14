# 017 - Simplified Workflow [02] Architecture

## Date: 2026-01-26

## Code Analysis Complete

**Agent extracted all 4 Code nodes successfully:**

| Node | Lines | Complexity | Purpose |
|------|-------|------------|---------|
| Code - Format & Extract | 250 | Medium | Parse Tally webhook, normalize answers |
| Code - Transform Mapping | 30 | Low | Parse mapping JSON |
| Code - DocMapping | 280 | High | Generate document list from answers |
| Code - Add Docs to Email | 60 | Low | Format final email HTML |
| **TOTAL** | **620 lines** | - | - |

---

## Current Architecture (22 nodes - TOO COMPLEX)

```
1. Webhook
2. Respond to Webhook
3. Code - Format & Extract
4. HTTP - Get Document Types
5. HTTP - Get Questionnaire Mapping
6. HTTP - Get Display Library
7. Code - Transform Mapping
8. Merge
9. Merge Mappings
10. Code - DocMapping
11. If (check if docs exist - UNNECESSARY)
12. Airtable - Upsert Documents
13. Code in JavaScript (dedupe?)
14. Airtable - List Docs
15. Code in Python (why Python?!)
16. Code - Add Docs to Email
17. HTTP Request - Send Email
18. Airtable - Update Annual Report
19. Edit Fields (why separate?)
20. Code - Orchestrator (appears unused)
21. Item Lists (appears unused)
22. Code - Email Prep (appears unused)
```

**Problems:**
- Nodes 20-22 appear unused (dead code)
- Duplicate merge operations
- Unnecessary If node (checking if docs exist)
- Mix of Python and JavaScript (why?)
- Edit Fields node does nothing useful

---

## Simplified Architecture (9 nodes - TARGET)

```
1. Webhook
   POST /webhook/tally-questionnaire-response
   ↓
2. Respond to Webhook (IMMEDIATE)
   Acknowledges receipt to prevent Tally retry
   ↓
3-5. HTTP Requests (PARALLEL)
   - Fetch document-types.json
   - Fetch questionnaire-mapping.json
   - Fetch document-display-n8n.js
   ↓
6. Code - MEGA NODE (620 lines combined)
   Section 1: Format & Extract (parse Tally payload)
   Section 2: Transform Mapping (parse mapping JSON)
   Section 3: DocMapping (generate documents with person field)
   Outputs: documents array, client data, form language
   ↓
7. Airtable - Batch Upsert Documents
   Uses document_key for deduplication
   Includes person field (client/spouse)
   ↓
8. Code - Generate Email & Send
   - Access upserted docs from previous node
   - Generate HTML using display library
   - Call Microsoft Graph API directly
   - Build action buttons (Approve, Edit)
   Outputs: email sent confirmation
   ↓
9. Airtable - Update Report
   Updates: stage, spouse_name, source_language
```

**Benefits:**
- 22 → 9 nodes (59% reduction)
- Clear linear flow (no confusing merges)
- All processing logic centralized (easier to debug)
- Maintains error boundaries (Airtable, Email separate)
- Faster execution (fewer node transitions)

---

## MEGA Node Structure (Node 6)

**Inputs:**
```javascript
const webhookData = $('Webhook').first().json;
const documentTypes = $('HTTP - Get Document Types').first().json;
const mappingData = $('HTTP - Get Questionnaire Mapping').first().json;
```

**Sections:**

### Section 1: Format & Extract (250 lines)
```javascript
// Extract from Tally webhook
// - Normalize field keys (English → Hebrew)
// - Detect form language
// - Extract hidden fields (report_id, client_id, etc.)
// - Extract answers
// - Build HTML summary table
// Outputs: answers_by_key, client_name, spouse_name, year, etc.
```

### Section 2: Transform Mapping (30 lines)
```javascript
// Parse mapping JSON
// - Handle different formats (string vs object)
// - Extract mappings array
// Outputs: question_mappings
```

### Section 3: DocMapping (280 lines)
```javascript
// Generate documents
// - Loop through mappings
// - Check if user answered yes/has value
// - Replace placeholders in doc names
// - Determine person field (client vs spouse) ← NEW!
// - Deduplicate by document_key
// Outputs: documents array with person field
```

**Section 4: Data Preparation (60 lines)**
```javascript
// Prepare for Airtable
// - Format documents for batch upsert
// - Add report_record_id link
// - Set default status = "Required_Missing"
// - Ensure person field is set
// Outputs: Array of Airtable-ready document objects
```

**Total MEGA Node: ~620 lines**

---

## Email & Send Node Structure (Node 8)

**Purpose:** Generate HTML email and send via Microsoft Graph API

**Inputs:**
```javascript
const upsertedDocs = $('Airtable - Batch Upsert Documents').all();
const displayLibCode = $('HTTP - Get Display Library').first().json;
const clientData = $('Code - MEGA NODE').first().json;
```

**Processing:**
```javascript
// 1. Execute display library
const displayLib = eval(displayLibCode);

// 2. Prepare documents array
const documents = upsertedDocs.map(item => ({
  issuer_name: item.json.issuer_name,
  category: item.json.category,
  person: item.json.person,  // ← Uses new field!
  type: item.json.type
}));

// 3. Generate HTML
const docsHtml = displayLib.generateDocumentListHTML(documents, {
  clientName: clientData.client_name,
  spouseName: clientData.spouse_name,
  language: 'he'
});

// 4. Build action buttons
const approveUrl = `https://liozshor.app.n8n.cloud/webhook/approve-and-send?report_id=${clientData.report_record_id}&token=${clientData.token}`;
const editUrl = `https://liozshor.github.io/annual-reports-client-portal/document-manager.html?report_id=${clientData.report_record_id}`;

// 5. Combine into email body
const emailBody = `
  <div>${clientData.html_summary}</div>
  ${docsHtml}
  <div>
    <a href="${approveUrl}">✅ Approve & Send to Client</a>
    <a href="${editUrl}">✏️ Edit Document List</a>
  </div>
`;

// 6. Send via Microsoft Graph API
const emailResponse = await sendEmail({
  to: 'reports@moshe-atsits.co.il',
  subject: `New Questionnaire Response - ${clientData.display_name}`,
  body: emailBody
});

// 7. Return data for next node
return [{
  json: {
    email_sent: emailResponse.ok,
    report_record_id: clientData.report_record_id,
    spouse_name: clientData.spouse_name,
    form_language: clientData.form_language,
    docs_count: documents.length
  }
}];
```

**Total: ~100 lines**

---

## Key Differences from Old Architecture

### ✅ Improvements:

1. **Person field populated correctly**
   - Old: No person field
   - New: Every document has person="client" or person="spouse"

2. **Clearer data flow**
   - Old: Multiple merges, unclear dependencies
   - New: Linear flow, easy to understand

3. **Fewer failure points**
   - Old: 22 nodes = 22 potential failure points
   - New: 9 nodes = 9 potential failure points

4. **Easier debugging**
   - Old: Logic scattered across 4+ nodes
   - New: All processing in 1 MEGA node (can add breakpoints)

5. **Faster execution**
   - Old: ~22 node transitions + 2 merges
   - New: ~9 node transitions + 0 merges

### ⚠️ Trade-offs:

1. **MEGA node is large (620 lines)**
   - But well-structured in 4 sections
   - Can add comments for navigation

2. **Email sending in Code node**
   - Old: Used HTTP Request node
   - New: Direct API call in Code
   - Reason: Reduces node count, same functionality

---

## Migration Strategy

### Phase 1: Build New Workflow
1. Create new workflow `[02-SIMPLIFIED]`
2. Keep old workflow `[02]` as backup
3. Do NOT modify old workflow yet

### Phase 2: Test with Mock Trigger
1. Use `[TEST] Tally Mock Trigger` workflow
2. Send test payload
3. Verify:
   - Documents created correctly
   - Person field populated correctly
   - Email sent correctly
   - Spouse name displays correctly

### Phase 3: Production Deployment
1. Update Tally webhook URL to new workflow
2. Monitor for 24 hours
3. If successful, archive old workflow
4. If failure, revert to old workflow URL

---

## Validation Checklist

Before deploying, verify:

- [ ] MEGA node compiles without errors
- [ ] All 3 HTTP requests complete successfully
- [ ] Documents array has correct structure
- [ ] Person field is populated for all documents
- [ ] Airtable upsert succeeds
- [ ] Email HTML is generated correctly
- [ ] Email is sent successfully
- [ ] Report is updated with correct stage
- [ ] Spouse name logic works correctly
- [ ] Test with Hebrew form submission
- [ ] Test with English form submission
- [ ] Test with married couple (has spouse)
- [ ] Test with single person (no spouse)

---

## Next Steps

1. ✅ Architecture designed
2. ⏳ Write MEGA node code
3. ⏳ Write Email & Send node code
4. ⏳ Create simplified workflow in n8n
5. ⏳ Test with mock trigger
6. ⏳ Deploy to production

---

## Status

✅ **Architecture finalized** - 9 nodes, clear flow
⏳ **Implementation pending** - Ready to build MEGA node
