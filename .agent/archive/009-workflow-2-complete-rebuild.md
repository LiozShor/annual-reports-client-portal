# 009 - Workflow #2 Complete Rebuild (Simplified + Fixed)

## Location
Design logs folder: `C:\Users\liozm\Desktop\moshe\annual-reports\.agent\design-logs`

## Date: 2026-01-25 (Updated multiple times same day)

## Problem Statement
Current Workflow #2 has critical issues:
1. **Placeholders not replaced**: `{institution}`, `{company}`, `{withdrawal_type}`, `{product}` appear in output
2. **Too many nodes**: 18 nodes making it hard to maintain
3. **Duplicate documents**: No proper deduplication logic
4. **Not using SSOT**: Should fetch from GitHub instead of hardcoded logic

## User Requirements (From Session)
1. Multi-value answers → **separate documents** (one per item)
2. Form 106 → **one per employer**
3. Form 867 → **one per institution** (deduplicate if same institution in securities + deposits)
4. Insurance docs → **one per (product + company)**
5. Spouse docs → **show spouse name in parentheses**
6. Deduplication → **keep only ONE instance** per (type + issuer + person)

## Simplified Architecture (7 Nodes)

```
1. Webhook (POST /tally-questionnaire-response)
   ↓
2. HTTP Request → Fetch questionnaire-mapping.json from GitHub
   ↓
3. HTTP Request → Fetch document-types.json from GitHub
   ↓
4. Code → Process mapping + create docs + generate HTML
   ↓
5. Airtable → Batch upsert documents
   ↓
6. Microsoft Graph → Send email to office
   ↓
7. Respond to Webhook
```

## Code Node Logic (Detailed)

### Input Schema
- `$input.item(0).json` = Tally webhook data
- `$input.item(1).json` = questionnaire-mapping.json
- `$input.item(2).json` = document-types.json

### Processing Steps

#### 1. Detect Language
Check Tally keys to determine if Hebrew or English form.

#### 2. Extract System Fields
- report_id, client_id, year, token, client_name, spouse_name, email

#### 3. Generate Documents with Proper Substitution

For each mapping in questionnaire-mapping.json:
- Get answer value for this question
- Check if condition met (yes/no/checkbox)
- If `perItem = true`: split answer by newline → array of items
- For each item:
  - For each document type in `mapping.documents[]`:
    - Get document template from document-types.json
    - **Replace ALL placeholders**:
      - `{year}` → year
      - `{employer}` / `{bank}` / `{institution}` / `{platform}` → item (from detailsField="issuer_name")
      - `{company}` → item (from detailsField="company")
      - `{product}` → mapping.fixedParams.product (e.g., "קרן פנסיה")
      - `{withdrawal_type}` → item (from detailsField="withdrawal_type")
      - `{benefit_type}` → item (from detailsField="benefit_type")
    - If `isSpouse = true`: append `(spouse_name)` to description
    - Create deduplication key: `type|||issuer|||person`
    - Add to Map (auto-deduplicates)

#### 4. Generate HTML Email
Group documents by category, build styled HTML for office.

### Deduplication Strategy
Use JavaScript Map with key = `${docType.id}|||${issuerName}|||${person}`

Example:
- "form_867|||מ1|||לוי יצחק" → only ONE instance even if מ1 appears in both securities AND deposits

## Critical Fixes from Log 008

### Multi-Parameter Substitution
The previous attempt only used `docType.details[0].key`.

**New approach:**
```javascript
// Loop ALL details, not just first one
if (docType.details) {
  docType.details.forEach(detail => {
    const placeholder = `{${detail.key}}`;

    // Source the value correctly:
    if (detail.key === 'year') {
      description = description.replace(new RegExp(placeholder, 'g'), year);
    }
    else if (detail.key === 'product' && mapping.fixedParams?.product) {
      description = description.replace(new RegExp(placeholder, 'g'), mapping.fixedParams.product);
    }
    else if (mapping.detailsField && item) {
      // Generic replacement for issuer_name, company, withdrawal_type, etc.
      description = description.replace(new RegExp(placeholder, 'g'), item);
    }
  });
}
```

## Expected Output (Test Case)

Using the user's provided data:
- Employers: "שכיר1", "שכיר2"
- Spouse employers: "שכירה1", "שכיהר2"
- Banks: "מ1", "מ3"
- Securities: "מ1", "מ2"
- Pension companies: "כלל1", "כלל2"

**Expected documents:**
```
💼 Employment
- טופס 106 לשנת 2025 משכיר1
- טופס 106 לשנת 2025 משכיר2
- טופס 106 לשנת 2025 משכירה1 (בן זוג1)
- טופס 106 לשנת 2025 משכיהר2 (בן זוג1)

🏦 Banks & Investments
- טופס 867 (אישור ניכוי מס) לשנת 2025 ממ1  (deduplicated!)
- טופס 867 (אישור ניכוי מס) לשנת 2025 ממ2
- טופס 867 (אישור ניכוי מס) לשנת 2025 ממ3

🛡️ Insurance
- אישור שנתי למס הכנסה לשנת 2025 (דוח שנתי מקוצר) על ההפקדות לקרן פנסיה ב"כלל1"
- אישור שנתי למס הכנסה לשנת 2025 (דוח שנתי מקוצר) על ההפקדות לקרן פנסיה ב"כלל2"
```

**NO placeholders like:**
- ❌ `{employer}`
- ❌ `{institution}`
- ❌ `{company}`
- ❌ `{product}`

## Implementation Plan

1. ✅ Create design log 009
2. ⏳ Write complete Code node JavaScript
3. ⏳ Build simplified workflow in n8n (7 nodes)
4. ⏳ Test with user's provided questionnaire data
5. ⏳ Validate: no placeholders, correct deduplication, proper spouse attribution

## CRITICAL FIX NEEDED IN CURRENT WORKFLOW

### Node: Code - DocMapping (ID: d5346f8f-fc99-4dcf-b19e-83e2f6eccfa8)

**Current buggy code (line ~197):**
```javascript
if (docType.details && docType.details.length > 0) {
  const templateParamKey = docType.details[0].key;  // ❌ ONLY FIRST PLACEHOLDER!
  params[templateParamKey] = cleanAndBold(item);
}
```

**Fixed code (loop ALL placeholders):**
```javascript
if (docType.details && Array.isArray(docType.details)) {
  docType.details.forEach(detail => {
    const key = detail.key;
    let value = '';

    // Year
    if (key === 'year') {
      value = year;
    }
    // Fixed params from mapping (e.g., product="קרן פנסיה")
    else if (mapping.fixedParams && mapping.fixedParams[key]) {
      value = mapping.fixedParams[key];
    }
    // Dynamic value from answer (employer, company, etc.)
    else if (item) {
      value = item;
    }

    if (value) {
      params[key] = cleanAndBold(value);
    }
  });
}
```

### Test Case
With answer: "כלל1\nכלל2" for "באיזה חברות ביטוח?" (pension companies)

**Before fix:**
```
"אישור שנתי למס הכנסה לשנת 2025 על ההפקדות ל{product} ב\"כלל1\""  ❌
```

**After fix:**
```
"אישור שנתי למס הכנסה לשנת 2025 על ההפקדות לקרן פנסיה ב\"כלל1\""  ✅
```

## UPDATE: Session 2026-01-25 (Later Session)

### Status of Original Plan
- ✅ Placeholder bug FIXED (log 010)
- ✅ Duplicate documents FIXED (log 011)
- ✅ Display library CREATED (log 012)
- ✅ Display library INTEGRATED (log 013)
- ❌ Workflow still TOO COMPLEX (19 nodes!)

### NEW EVEN SIMPLER ARCHITECTURE (6 Nodes)

**Current state:** 19 nodes with mystery JS/Python nodes, redundant Airtable reads, unnecessary IF checks

**New target:** 6 nodes, TRUE SSOT, zero business logic in n8n

```
1. Webhook (receive Tally)
   ↓
2. Respond to Webhook (immediate 200 OK - CRITICAL!)
   ↓
3. Code - ORCHESTRATOR (tiny! just calls library functions)
   • Fetch 3 SSOT files from GitHub (parallel async)
   • Call processing functions from libraries
   • Return: documents, emailHtml, metadata
   ↓
4. Airtable - Upsert Documents (even if empty array)
   ↓
5. Microsoft Graph - Send Email to Office (ALWAYS send)
   ↓
6. Airtable - Update Report Status
```

### Key Architectural Decisions (2026-01-25)

**Q: Remove the IF node?**
A: ✅ YES - Office should ALWAYS get email, even with 0 documents

**Q: Re-read from Airtable after upsert?**
A: ❌ NO - No reason to re-read. Use documents created in memory.

**Q: What if Airtable fails?**
A: It's a critical error. Let workflow fail. No special handling needed.

**Q: Parallel or sequential steps 4-6?**
A: Sequential is fine (simpler to debug)

### Removed Nodes (vs. current 19-node version)
- ❌ IF node (unnecessary - always send email)
- ❌ "Code in JavaScript" mystery node
- ❌ "Code in Python" mystery node
- ❌ Airtable - List Docs (re-reading documents we just wrote)
- ❌ Extra Merge nodes (2 → 0)
- ❌ "Code - Transform Mapping" (logic moves to library)
- ❌ "Code - Format & Extract" (logic moves to library)
- ❌ "Code - Add Docs to Email" (replaced by display library call)
- ❌ All intermediate processing nodes

### TRUE SSOT Strategy

Instead of embedding business logic in n8n Code nodes, ALL logic will live in GitHub libraries:

**Existing SSOT files:**
1. ✅ `document-types.json` - document definitions
2. ✅ `questionnaire-mapping.json` - mapping rules
3. ✅ `document-display-n8n.js` - HTML generation

**NEW SSOT file needed:**
4. 🆕 `workflow-processor-n8n.js` - ALL processing logic
   - `extractSystemFields(tallyData)` - get report_id, client, spouse, year, etc.
   - `processAllMappings(tallyData, mappings, docTypes, systemFields)` - create documents
   - `deduplicateDocuments(documents)` - dedupe by key
   - `prepareAirtablePayload(documents, reportId)` - format for Airtable
   - `generateOfficeEmailMetadata(systemFields, documentCount)` - email metadata

### Code Node Will Be ~40 Lines (Just Orchestration)

```javascript
// Fetch all SSOT files from GitHub (parallel)
const [mappingData, docTypesData, displayLibCode, processorCode] = await Promise.all([
  fetch('https://raw.githubusercontent.com/.../questionnaire-mapping.json').then(r => r.json()),
  fetch('https://raw.githubusercontent.com/.../document-types.json').then(r => r.json()),
  fetch('https://raw.githubusercontent.com/.../document-display-n8n.js').then(r => r.text()),
  fetch('https://raw.githubusercontent.com/.../workflow-processor-n8n.js').then(r => r.text())
]);

// Load libraries
const displayLib = eval(displayLibCode);
const processor = eval(processorCode);

// Get Tally data
const tallyData = $input.item(0).json;

// ORCHESTRATION ONLY (zero business logic!)
const systemFields = processor.extractSystemFields(tallyData);
const documents = processor.processAllMappings(tallyData, mappingData, docTypesData, systemFields);
const uniqueDocs = processor.deduplicateDocuments(documents);
const emailHtml = displayLib.generateDocumentListHTML(uniqueDocs, systemFields);
const airtableDocs = processor.prepareAirtablePayload(uniqueDocs, systemFields.report_id);

// Return everything for next nodes
return [{
  json: {
    ...systemFields,
    documents: airtableDocs,
    email_html: emailHtml,
    doc_count: uniqueDocs.length
  }
}];
```

**Benefits:**
- 68% fewer nodes (19 → 6)
- Zero business logic in n8n (ALL in GitHub)
- Fix bugs in ONE place → automatically fixed everywhere
- Version controlled, testable, reusable
- Clear separation: libraries = logic, n8n = orchestration

## CURRENT EMAIL FORMAT (Exact from Workflow [02])

### Email Subject
```
התקבל שאלון שנתי: [client_name] - [year]
```

### Email Body Structure

**Part 1: Header Section** (from Code - Format & Extract)
```html
<div style="font-family: Arial, sans-serif; direction: rtl; text-align: right;">
  <h3>התקבלו תשובות חדשות לשאלון (עברית/אנגלית)</h3>
  <div style="margin:0 0 12px 0; color:#555;">
    <div><strong>טופס:</strong> שאלון שנתי 2025</div>
    <div><strong>תאריך:</strong> 2026-01-25</div>
    <div><strong>לקוח:</strong> לוי יצחק</div>
    <div><strong>שנה:</strong> 2025</div>
    <div><strong>אימייל:</strong> client@example.com</div>
  </div>
  <table>[All questionnaire answers in table format]</table>
</div>
```

**Part 2: Document List** (from display library)
```html
<div style="margin-top:20px;padding:15px;background:#fff3cd;border-radius:8px;border-right:5px solid #ff9800;">
  <h3>📄 מסמכים נדרשים</h3>

  <div style="margin-bottom:20px;">
    <h4 style="margin:0 0 10px 0;color:#ff9800;border-bottom:1px solid #ffe0b2;">💼 הכנסות מעבודה</h4>

    <div style="margin-bottom:8px;">
      <strong style="color:#1976d2;">לוי יצחק:</strong>
      <ul style="list-style:none;padding:0;margin:5px 0;">
        <li>• טופס 106 לשנת 2025 משכיר1</li>
        <li>• טופס 106 לשנת 2025 משכיר2</li>
      </ul>
    </div>

    <div style="margin-bottom:8px;">
      <strong style="color:#7b1fa2;">משה (בן/בת זוג):</strong>
      <ul style="list-style:none;padding:0;margin:5px 0;">
        <li>• טופס 106 לשנת 2025 משכירה1 (משה)</li>
      </ul>
    </div>
  </div>

  <!-- More categories... -->
</div>
```

**Part 3: Action Buttons**
```html
<div style="margin-top:30px;padding:20px;background:#e3f2fd;border-radius:8px;text-align:center;">
  <div style="margin-bottom:20px;">
    <a href="[approve_url]" style="display:inline-block;padding:12px 25px;background:#4caf50;color:white;text-decoration:none;border-radius:5px;font-weight:bold;margin:5px;">
      ✅ המסמכים תקינים - שלח ללקוח
    </a>
    <a href="[edit_url]" style="display:inline-block;padding:12px 25px;background:#ff9800;color:white;text-decoration:none;border-radius:5px;font-weight:bold;margin:5px;">
      ✏️ עריכת רשימה
    </a>
  </div>
  <p style="font-size:12px;color:#666;">לקוח: [email] | שנה: [year] | דוח: [report_id_last_6]</p>
</div>
```

### Email Metadata
- **To:** reports@moshe-atsits.co.il
- **Content-Type:** HTML
- **Continue on fail:** true (don't block workflow if email fails)

## MYSTERY NODES EXPLAINED

After reading the downloaded workflow file:

**"Code in JavaScript" (ID: b24cfec5-a9da-4528-93a7-151b6e6d06cf)**
```javascript
return [{
  json: {
    report_record_id: $items("Code - Format & Extract")[0].json.report_record_id,
  },
}];
```
- **Purpose:** Just extracts report_record_id
- **Verdict:** ❌ UNNECESSARY - can be done in one line elsewhere

**"Code in Python" (ID: fea17807-f7a0-4669-98dd-62a32b9703ff)**
```python
for item in _items:
  item["json"]["my_new_field"] = 1
return _items
```
- **Purpose:** Adds useless field `my_new_field = 1`
- **Verdict:** ❌ COMPLETELY USELESS - debugging leftover

**"Code - Transform Mapping"**
- **Purpose:** Transforms questionnaire mapping format
- **Verdict:** ⚠️ Can be moved to library

## IF NODE EXPLAINED

```javascript
conditions: [{
  leftValue: "={{ $json.isEmpty() }}",
  rightValue: true,
  operator: "notEquals"
}]
```

**Translation:** IF `$json is NOT empty`
- **TRUE branch:** Upsert to Airtable
- **FALSE branch:** Skip Airtable, go straight to email

**User requirement:** Office should ALWAYS get email, even with 0 documents

**Decision:** ✅ Keep IF node to avoid upserting empty arrays, but BOTH branches should lead to email

## SIMPLIFIED ARCHITECTURE V2 (7 Nodes - Final)

```
1. Webhook (receive Tally)
   ↓
2. Respond to Webhook (immediate 200 OK)
   ↓
3. Code - Orchestrator (fetch libraries, process, generate HTML)
   ↓
4. IF (documents.length > 0?)
   ├─ TRUE → Airtable - Upsert Documents
   └─ FALSE → (skip Airtable)
   ↓
5. Code - Prepare Email (build final email HTML)
   ↓
6. Microsoft Graph - Send Email to Office (ALWAYS)
   ↓
7. Airtable - Update Report Status
```

**Why 7 nodes instead of 6?**
- IF node prevents upserting empty arrays to Airtable (cleaner)
- Both branches lead to email (satisfies "always send email" requirement)

## WHAT CODE - ORCHESTRATOR DOES

**Fetches from GitHub (parallel):**
1. questionnaire-mapping.json
2. document-types.json
3. document-display-n8n.js
4. workflow-processor-n8n.js (NEW library to create)

**Processes:**
1. Extract system fields (report_id, client, spouse, year, etc.)
2. Translate questionnaire keys (English → Hebrew)
3. Extract answers
4. Process all mappings → create documents
5. Deduplicate documents
6. Build questionnaire answers table HTML

**Returns:**
```javascript
{
  json: {
    // System fields
    report_record_id,
    client_name,
    spouse_name,
    client_email,
    year,
    form_language,

    // Documents
    documents: [...],  // For Airtable
    doc_count: 12,

    // HTML components
    header_html: "...",  // Questionnaire summary table

    // URLs
    approve_url: "...",
    edit_url: "..."
  }
}
```

## WHAT CODE - PREPARE EMAIL DOES

**Takes input from Code - Orchestrator:**
- header_html
- documents array
- client_name, spouse_name
- approve_url, edit_url

**Generates:**
1. Document list HTML using display library
2. Action buttons HTML
3. Combines all parts into final email body

**Why separate node?**
- Needs to run AFTER the IF node (regardless of TRUE/FALSE branch)
- Cleaner separation of concerns

## Implementation Plan (Updated)

1. ⏳ Create `workflow-processor-n8n.js` library with functions:
   - `extractSystemFields(tallyData)`
   - `translateKeys(tallyData)` - English → Hebrew form keys
   - `extractAnswers(tallyData)`
   - `buildAnswersTableHTML(answers, formLanguage)`
   - `processAllMappings(answers, mappings, docTypes, systemFields)`
   - `deduplicateDocuments(documents)`
   - `prepareAirtablePayload(documents, reportId)`

2. ⏳ Create new 7-node workflow in n8n

3. ⏳ Test with real questionnaire data

4. ⏳ Verify:
   - Email looks IDENTICAL to current format
   - All document details correct (employer names, etc.)
   - Categories display properly
   - Spouse separation works
   - Action buttons work

5. ⏳ Parallel run (run both old + new workflows) to compare outputs

6. ⏳ Switch traffic to new workflow

7. ⏳ Delete old 19-node workflow after 1 week

### Next Session Notes
- Write the workflow-processor-n8n.js library
- Build the 7-node workflow
- Test thoroughly with PARALLEL RUN before switching traffic
