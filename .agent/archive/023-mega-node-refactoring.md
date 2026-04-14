# Design Log 023: MEGA NODE Refactoring - Split into Focused Nodes

**Date:** 2026-01-26
**Status:** [COMPLETED]
**Workflow:** [02-SIMPLIFIED] Questionnaire Response Processing V2 (ID: EMFcb8RlVI0mge6W)
**Priority:** HIGH - Architecture improvement

---

## Problem Statement

Current workflow has a **656-line MEGA NODE** that is:
- ❌ Hard to debug (which section failed?)
- ❌ Hard to maintain (where do I fix X?)
- ❌ Hard to understand (what does each part do?)
- ❌ All-or-nothing (one bug breaks everything)
- ❌ Poor error messages (line 423 doesn't indicate logical step)

**User feedback:** "Why won't we separate the MEGA code to several code nodes? Isn't it more make sense?"

**Answer:** YES! The MEGA NODE was a mistake. Fewer nodes ≠ simpler workflow.

---

## Design Principles

1. **Single Responsibility** - Each node does ONE thing well
2. **Clear Naming** - Node name explains what it does
3. **Testable** - Can test each node independently
4. **Debuggable** - Errors point to specific logical step
5. **Reusable** - Can extract nodes for other workflows
6. **Maintainable** - Future developers understand immediately

---

## Target Architecture

### Current (Bad)
```
MEGA NODE (656 lines)
  ├─ Section 1: Config & Helpers (160 lines)
  ├─ Section 2: Extract System Fields (120 lines)
  ├─ Section 3: Parse Mapping Data (50 lines)
  ├─ Section 4: Document Generation (220 lines)
  ├─ Section 5: Deduplication (50 lines)
  └─ Section 6: Output Format (56 lines)
```

### Refactored (Good)
```
Node 1: Extract & Prepare (200 lines)
  - Extract system fields
  - Build answers map
  - Generate questionnaire HTML
  - Prepare data structures
  Output: Clean, ready-to-process data

Node 2: Generate Documents (300 lines)
  - Loop through mappings
  - Apply perItem logic
  - Format document names
  - Create raw document list
  Output: Array of documents (may have duplicates)

Node 3: Finalize & Format (150 lines)
  - Apply business rules (foreign income, appendix)
  - Deduplicate by document_key
  - Add metadata
  - Format for Airtable
  Output: Final unique documents
```

**Benefits:**
- Clear separation of concerns
- Each node ~150-300 lines (readable in one screen)
- Errors pinpoint exact step
- Can test each step independently

---

## Complete Workflow Architecture (14 nodes)

```
1. Webhook (receive Tally submission)
   ↓
2. Respond to Webhook (IMMEDIATE acknowledgment)
   ↓ (splits to 3 parallel HTTP requests)
3. HTTP - Get Document Types
4. HTTP - Get Questionnaire Mapping
5. HTTP - Get Display Library
   ↓ (all 3 converge)
6. Merge
   ↓
7. Code - Extract & Prepare ⭐ NEW (replaces MEGA lines 1-330)
   ↓
8. Code - Generate Documents ⭐ NEW (replaces MEGA lines 331-589)
   ↓
9. Code - Finalize & Format ⭐ NEW (replaces MEGA lines 590-693)
   ↓
10. Airtable - Batch Upsert
   ↓
11. Code - Prepare Search Query
   ↓
12. Airtable - Search Documents (filter Required_Missing)
   ↓
13. Code - Generate Email HTML (with display library)
   ↓
14. MS Graph - Send Email
   ↓
15. Code - Prepare Report Update
   ↓
16. Airtable - Update Report
```

**Node count:** 16 total (vs 14 current, but MUCH more maintainable)

---

## Node 1: Extract & Prepare

**Responsibility:** Extract and clean all input data

**Input:** Merged data from Webhook + HTTP nodes

**Processing:**
1. Extract webhook body and fields
2. Detect form language (he/en)
3. Normalize keys (English → Hebrew)
4. Build answers_by_key map
5. Extract system fields (report_id, client_id, year, etc.)
6. Extract client/spouse names
7. Generate questionnaire HTML summary table

**Output:**
```javascript
{
  // System fields
  report_record_id,
  client_id,
  year,
  token,
  client_name,
  client_email,
  spouse_name,
  display_name,

  // Answers map
  answers_by_key: {},

  // Parsed data structures
  DOCUMENT_TYPES: {},
  QUESTION_MAPPINGS: [],
  CATEGORIES: {},

  // Generated content
  html_summary: "<div>...</div>",

  // Metadata
  formLanguage: "he",
  formName: "...",
  createdAt: "..."
}
```

**Size:** ~200 lines

**Error handling:**
- Validate required fields exist
- Clear error if document_types missing
- Clear error if question_mappings missing

---

## Node 2: Generate Documents

**Responsibility:** Process mappings and create raw document list

**Input:** Output from Node 1

**Processing:**
1. Loop through QUESTION_MAPPINGS
2. Check if should generate docs (condition logic)
3. Split multi-value answers (perItem)
4. Format document names with parameters
5. Add documents to output array
6. Handle special cases (pension withdrawal)

**Output:**
```javascript
[
  {
    document_key: "form_106_recXXX_employment_employers_list_קפה_גרג_1",
    type: "Form_106",
    status: "Required_Missing",
    issuer_name: "טופס 106 לשנת 2025 מ<b>קפה גרג 1</b>",
    issuer_name_en: "Form 106 for 2025 from <b>Cafe Greg 1</b>",
    issuer_key: "question_5zjRMZ",
    category: "employment",
    person: "client",
    report: ["recXXX"],
    report_record_id: "recXXX"
  },
  // ... more documents (may have duplicates at this stage)
]
```

**Size:** ~300 lines

**Key functions:**
- `shouldGenerateDocs(mapping, answerValue)`
- `splitListItems(value)`
- `formatDocumentName(typeId, params)`
- `addDoc(mapping, docTypeId, ...)`

**Error handling:**
- Skip mappings with missing data
- Warn if document type not found
- Continue on individual document failure

---

## Node 3: Finalize & Format

**Responsibility:** Apply business rules, deduplicate, format output

**Input:** Raw document array from Node 2 + metadata from Node 1

**Processing:**
1. **Apply business rules:**
   - Foreign income logic (skip if tax return filed abroad)
   - Appendix consolidation (merge multiple into ONE)
   - Any other conditional logic

2. **Deduplicate:**
   - Use document_key (unique per item)
   - Keep first occurrence

3. **Add metadata:**
   - _client_name, _spouse_name, _year
   - _form_language, _html_summary
   - _report_record_id

4. **Format for Airtable:**
   - Wrap each doc in `{ json: { ... } }`
   - Ensure all required fields present

**Output:**
```javascript
[
  {
    json: {
      document_key: "...",
      report: ["recXXX"],
      type: "Form_106",
      status: "Required_Missing",
      person: "client",
      issuer_name: "...",
      issuer_name_en: "...",
      issuer_key: "...",
      category: "employment",

      // Metadata
      _client_name: "לוי יצחק",
      _spouse_name: "משה",
      _year: "2025",
      _form_language: "he",
      _html_summary: "<div>...</div>",
      _report_record_id: "recXXX"
    }
  },
  // ... unique documents only
]
```

**Size:** ~150 lines

**Business rules:**
- Foreign income: Check `question_487oPA`
- Appendix: Consolidate ID_Appendix + Child_ID_Appendix → ONE
- Add more rules as needed

**Error handling:**
- Handle empty document list (return NO_DOCS placeholder)
- Validate deduplication worked

---

## Implementation Steps

### Step 1: Create Node 1 Code
- Extract lines 1-330 from MEGA NODE
- Remove unused sections
- Add clear output structure
- Test independently

### Step 2: Create Node 2 Code
- Extract lines 331-589 from MEGA NODE
- Adapt to receive structured input from Node 1
- Keep all document generation logic
- Test with sample input

### Step 3: Create Node 3 Code
- Extract lines 590-693 from MEGA NODE
- Add business rules (from our fixes)
- Implement clean deduplication
- Test with sample documents

### Step 4: Update Workflow
- Remove old MEGA NODE
- Add 3 new nodes in sequence
- Connect properly
- Validate connections

### Step 5: Test
- Run with [TEST] Tally Mock Trigger
- Verify all documents generated correctly
- Check email format
- Verify Airtable records

---

## Data Flow Between Nodes

### Node 1 → Node 2
```javascript
$input.first().json = {
  report_record_id: "recXXX",
  year: "2025",
  client_name: "לוי יצחק",
  spouse_name: "משה",
  answers_by_key: { "question_5zjRMZ": "קפה גרג 1\nקפה קפה 2", ... },
  DOCUMENT_TYPES: { ... },
  QUESTION_MAPPINGS: [ ... ],
  html_summary: "<div>...</div>",
  formLanguage: "he"
}
```

### Node 2 → Node 3
```javascript
$input.all() = [
  { json: { document_key: "...", type: "Form_106", ... } },
  { json: { document_key: "...", type: "Form_106", ... } },
  // ... all documents (may have duplicates)
]
```

PLUS access to Node 1 data via:
```javascript
const node1Data = $('Code - Extract & Prepare').first().json;
```

### Node 3 → Airtable
```javascript
$input.all() = [
  { json: { document_key: "...", type: "Form_106", status: "Required_Missing", ... } },
  // ... unique documents only
]
```

---

## Testing Strategy

### Unit Testing (per node)

**Node 1:**
- Test with Hebrew form
- Test with English form
- Test with married client
- Test with single client
- Verify all system fields extracted

**Node 2:**
- Test single employer → 1 doc
- Test 2 employers → 2 docs
- Test withdrawal types → 6 docs
- Verify placeholder replacement
- Verify bold formatting

**Node 3:**
- Test foreign income logic
- Test appendix consolidation
- Test deduplication (2 same employers → 1 doc)
- Verify metadata added

### Integration Testing

- Run full workflow with test submission
- Verify 28+ documents created
- Verify email format correct
- Verify Airtable records accurate

---

## Benefits of Refactoring

### Before (MEGA NODE)
- ❌ 656 lines in one node
- ❌ Error: "Line 423" (what step?)
- ❌ Hard to find bug location
- ❌ Can't test parts independently
- ❌ All-or-nothing execution

### After (3 Focused Nodes)
- ✅ Max 300 lines per node
- ✅ Error: "Code - Generate Documents failed" (clear!)
- ✅ Easy to locate bugs
- ✅ Can test each step separately
- ✅ Partial success possible (Node 1 OK, Node 2 failed)

### Maintenance Example

**Scenario:** Need to change how employer names are formatted

**Before:**
1. Open MEGA NODE
2. Search through 656 lines
3. Find the right section (where?)
4. Hope you don't break other parts
5. Test entire workflow

**After:**
1. Open "Code - Generate Documents"
2. Find `formatDocumentName()` function (top of file)
3. Make change
4. Test just Node 2 with sample input
5. Deploy confidently

---

## Migration Plan

1. ✅ Create design log (this file)
2. ⏳ Create 3 new node code files
3. ⏳ Test each node independently
4. ⏳ Update workflow structure
5. ⏳ Remove old MEGA NODE
6. ⏳ Test end-to-end
7. ⏳ Deploy to production
8. ⏳ Monitor first real submission

---

## Success Criteria

- [ ] Node 1: Extracts all fields correctly
- [ ] Node 2: Generates all documents (2 employers → 2 docs)
- [ ] Node 3: Applies all business rules correctly
- [ ] Workflow: Completes without errors
- [ ] Email: Shows questionnaire + documents properly
- [ ] Airtable: All documents saved with correct data
- [ ] Code: Each node < 300 lines
- [ ] Maintainability: Future developer can understand in 5 minutes

---

## Status

🔧 **IN PROGRESS**

**Next:** Create Node 1 code
