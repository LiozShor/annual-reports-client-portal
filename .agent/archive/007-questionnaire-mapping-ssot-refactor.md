# Design Log 007: Questionnaire Mapping Single Source of Truth Refactor
**Status:** [COMPLETED]
**Date:** 2026-01-25
**Approved:** 2026-01-25
**Related Logs:** [002-dynamic-questionnaire-mapping.md]

## 1. Context & Problem

### Current State
The system has **TWO conflicting sources** for questionnaire-to-document mapping:

1. **Source 1 (GitHub):** `questionnaire-mapping.js` with 70+ question mappings (includes all Boolean logic)
2. **Source 2 (n8n):** Hardcoded `STEPS` array in Workflow 2's "Code - DocMapping" node (~20 mappings)

### The Problem
**Boolean-triggered documents are completely missing** from production because:
- ✅ They ARE defined in `questionnaire-mapping.js` (GitHub SSOT)
- ❌ They ARE NOT in the hardcoded `STEPS` array (n8n Code Node)
- ❌ The `[API] Get Questionnaire Mapping` workflow (ID: If0tyzzUWF081jnD) exists but is **INACTIVE**

**Test Evidence:**
- Input: User answered "כן" (Yes) to 11 Boolean questions
- Expected: 11+ Boolean-triggered documents created
- Actual: **ZERO** Boolean-triggered documents created
- Working: Multi-select splitting works perfectly (27 documents created from list questions)

### Why This Happened
Design Log 002 created `questionnaire-mapping.js` as the intended SSOT, but Workflow 2's Code Node was never updated to consume it. Instead, it continues using a legacy hardcoded `STEPS` array that predates the SSOT architecture.

---

## 2. User Requirements (The 5 Questions)

### Q1: Which Missing Boolean Mappings Should Be Added?
**Answer:** 9 missing mappings (excluding "Have Children" which is redundant):
1. Marital Status Change (`question_J6p7MK`) → `id_appendix`
2. New Child Added (`question_y62LzX`) → `child_id_appendix`
3. Special Education (`question_0xBXaB`) → `special_ed_approval`
4. Gambling/Prize Wins (`question_QDeLkX`) → `gambling_win_cert`
5. Foreign Income (`question_e6Q4vl`) → `foreign_income_report`
6. Business Inventory (`question_K65bkX`) → `inventory_list`
7. Army Release (<3 years) (`question_oyR995`) → `army_release_cert`
8. Relative in Institution (`question_5z9vzN`) → `institution_approval`
9. Health Status Change (`question_DNkQaN`) → `medical_committee`

**Excluded:**
- `question_8KaOMz` (Have Children) - No document needed; only status changes trigger docs
- `question_P69RpP` (Alimony) - Intentionally removed per user request

### Q2: Alimony Document - Why Commented Out?
**Answer:** Keep it removed. Alimony was intentionally excluded and should remain excluded.

### Q3: Multi-Select NII Spouse Benefits - Single or Split?
**Answer:** Change from `mode: 'static'` to **`mode: 'multi_expand'`** (split into separate documents).
- Example: "נכות, אבטלה, מילואים" → 3 separate `nii_allowance_cert_spouse` documents

### Q4: Data Source - Hardcoded vs. SSOT?
**Answer:** Implement **true Single Source of Truth** by:
- ❌ Removing hardcoded `STEPS` array from Code Node
- ✅ Fetching `questionnaire-mapping.json` from GitHub (like `document-types.json`)
- ✅ Processing mappings dynamically at runtime

### Q5: Validation Strategy
**Answer:** Deploy to n8n and test with the provided input data (expecting 37+ documents created).

---

## 3. Technical Constraints & Risks

### Dependencies
- **n8n Workflow:** `[02] Webhook: Questionnaire Response & Doc Mapping` (ID: EMFcb8RlVI0mge6W)
- **Code Node:** "Code - DocMapping" (node index 5, 419 lines)
- **GitHub Files:**
  - `questionnaire-mapping.js` (SSOT)
  - `questionnaire-mapping.json` (auto-generated)
- **Existing API:** `[API] Get Questionnaire Mapping` (ID: If0tyzzUWF081jnD) - currently INACTIVE

### Security
- No authentication changes required (GitHub files are public read)
- Webhook tokens already implemented

### Risks
1. **Breaking Change:** Complete rewrite of document generation logic
2. **Mapping Schema Differences:** `questionnaire-mapping.js` structure may not match current `STEPS` format
3. **Regression:** Existing working features (multi-select splitting) must continue working
4. **Dependency:** Workflow now depends on GitHub availability (already true for `document-types.json`)

---

## 4. Proposed Solution (The Blueprint)

### Architecture Flow

**Current (Broken):**
```
Tally Webhook → Code Node (Hardcoded STEPS) → Airtable
```

**Proposed (SSOT):**
```
GitHub: questionnaire-mapping.js (MASTER)
    ↓
Auto-generate: questionnaire-mapping.json
    ↓
n8n HTTP Request → Fetch mapping JSON
    ↓
Code Node → Process dynamically → Airtable
```

This matches the existing pattern used for `document-types.json`!

---

### Logic Flow

#### Phase 1: Activate Existing API
1. Enable `[API] Get Questionnaire Mapping` workflow (ID: If0tyzzUWF081jnD)
2. Verify it returns valid JSON from GitHub

#### Phase 2: Update Workflow 2
1. Add HTTP Request node before "Code - DocMapping" to fetch mapping
2. Merge mapping data with existing input (like "HTTP - Get Document Types" node)
3. Refactor "Code - DocMapping" node to consume mapping dynamically

#### Phase 3: Core Mapping Logic Refactor

**New Code Node Structure:**
```javascript
// INPUT: Merged data from Tally + document-types + questionnaire-mapping
const answers = input.answers_by_key;
const DOCUMENT_TYPES = input.document_types;
const QUESTION_MAPPINGS = input.question_mappings; // NEW!

// ITERATE OVER MAPPINGS (not hardcoded STEPS)
for (const mapping of QUESTION_MAPPINGS) {
  // Skip hidden fields
  if (mapping.documents.length === 0) continue;

  // Check if question was triggered
  const answerValue = answers[mapping.tallyKeys.he] || answers[mapping.tallyKeys.en];
  if (!shouldGenerateDocs(mapping, answerValue)) continue;

  // Handle based on type
  if (mapping.perItem) {
    // Split and create per item (multi-select)
    const items = splitListItems(answerValue);
    items.forEach(item => createDocument(mapping, item));
  } else {
    // Create single document (yes/no, static)
    createDocument(mapping, null);
  }
}
```

**Key Functions to Implement:**
1. `shouldGenerateDocs(mapping, answerValue)` - Checks `mapping.condition` ("yes", "no", null)
2. `splitListItems(value)` - Handles newline/comma splitting
3. `createDocument(mapping, itemValue)` - Generates document record with proper naming

---

### Data Structures / Schema Changes

#### Input Schema (from Merge node)
```javascript
{
  // Existing
  answers_by_key: {...},
  report_record_id: "...",
  year: "2025",
  client_name: "...",
  spouse_name: "...",
  document_types: {...},   // From GitHub
  categories: {...},        // From GitHub

  // NEW
  question_mappings: [     // From questionnaire-mapping.json
    {
      id: "employment_employers_list",
      tallyKeys: { he: "question_5zjRMZ", en: "question_xpDPY9" },
      label: { he: "רשימת מעסיקים", en: "Employer list" },
      type: "list",
      category: "employment",
      condition: null,
      documents: ["form_106"],
      isSpouse: false,
      perItem: true,
      detailsField: "issuer_name"
    },
    // ... 70+ more mappings
  ]
}
```

#### Mapping Processing Rules
| `mapping.type` | `mapping.condition` | `mapping.perItem` | Behavior |
|---------------|---------------------|-------------------|----------|
| `yes_no` | `"yes"` | `false` | Create 1 doc if answer = "כן"/"Yes" |
| `yes_no` | `"no"` | `false` | Create 1 doc if answer = "לא"/"No" |
| `list` | `null` | `true` | Split by `\n` or `,` and create 1 doc per item |
| `checkbox` | `null` | `true` | Split by `,` and create 1 doc per selected option |
| `text` | `null` | `false` | Create 1 doc with text value |

---

### n8n Workflow Architecture

**Modified Workflow 2 Nodes:**

```
1. Webhook (unchanged)
2. Code - Format & Extract (unchanged)
3. HTTP - Get Document Types (unchanged)
   ↓
4. HTTP - Get Questionnaire Mapping (NEW - fetch from GitHub)
   ↓
5. Merge (MODIFIED - merge 3 sources: Tally + DocTypes + Mappings)
   ↓
6. Code - DocMapping (REFACTORED - consume mapping dynamically)
   ↓
7. Airtable - Upsert Documents (unchanged)
   ... rest unchanged
```

**New HTTP Request Node Configuration:**
- URL: `https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/questionnaire-mapping.json`
- Method: GET
- Response Format: JSON

---

### Document Name Generation Logic

**Current `STEPS` uses:**
```javascript
makeName: (employer) => formatDocumentName('form_106', {
  year: tax_year,
  employer: cleanAndBold(employer)
})
```

**New mapping-driven approach:**
```javascript
function generateDocumentName(mapping, itemValue, context) {
  const docType = DOCUMENT_TYPES[mapping.documents[0]];

  // Build parameters
  const params = { year: context.year };

  // Add details field if perItem
  if (mapping.perItem && itemValue) {
    params[mapping.detailsField] = cleanAndBold(itemValue);
  }

  // Handle spouse naming
  if (mapping.isSpouse) {
    params.name = cleanAndBold(context.spouseName);
  } else {
    params.name = cleanAndBold(context.clientName);
  }

  return formatDocumentName(docType.id, params);
}
```

---

## 5. Validation Plan

### Test Case 1: Boolean Questions (Currently Broken)
**Input:** User answers "כן" (Yes) to 9 Boolean questions
**Expected Output:** 9 documents created:
- `id_appendix`
- `child_id_appendix`
- `special_ed_approval`
- `gambling_win_cert`
- `foreign_income_report`
- `inventory_list`
- `army_release_cert`
- `institution_approval`
- `medical_committee`

**Current Output:** 0 documents ❌
**After Fix:** 9 documents ✅

---

### Test Case 2: Multi-Select Splitting (Currently Works)
**Input:**
- Employers: "שכיר1\nשכיר2"
- Banks: "פקדון1\nפקדון2"
- Pension Withdrawals: "פיצויי פיטורין, מענק פרישה, משיכת קרן השתלמות"

**Expected Output:**
- 2x `form_106`
- 2x `form_867`
- 3x `pension_withdrawal`

**Current Output:** ✅ Works correctly
**After Fix:** ✅ Must continue working (no regression)

---

### Test Case 3: Spouse NII Benefits (New Behavior)
**Input:** `question_V0QgDM` = "נכות, אבטלה, מילואים, דמי לידה"

**Current Output:** 1x `nii_allowance_cert_spouse` (generic)
**After Fix:** 4 separate documents (one per benefit type) ✅

---

### Test Case 4: Full Integration Test
**Input:** The exact Tally payload provided by user (67 answers)
**Expected Output:** 37+ documents total:
- 9 Boolean-triggered docs
- 27 multi-select split docs
- 1+ static docs

**Success Criteria:**
- All documents created in Airtable
- Correct Hebrew/English names
- Proper spouse vs client separation
- No duplicates (deduplication works)

---

### Regression Prevention
**Must verify NO breaking changes for:**
- ✅ Employer list splitting (Form 106)
- ✅ Bank/securities splitting (Form 867)
- ✅ Insurance company splitting (Insurance Tax Cert)
- ✅ Pension withdrawal multi-expand
- ✅ WHT client splitting
- ✅ Spouse name handling
- ✅ Document name formatting (bold, HTML)

---

## 6. Implementation Notes (Post-Code)

*(To be filled during implementation)*

---

## Implementation Checklist

- [ ] **Phase 1:** Activate `[API] Get Questionnaire Mapping` workflow
- [ ] **Phase 2:** Add HTTP Request node to Workflow 2
- [ ] **Phase 3:** Update Merge node to include mapping data
- [ ] **Phase 4:** Refactor "Code - DocMapping" node
  - [ ] Remove hardcoded `STEPS` array
  - [ ] Add mapping iteration logic
  - [ ] Implement `shouldGenerateDocs()` function
  - [ ] Implement `splitListItems()` function
  - [ ] Update `createDocument()` to use mapping schema
- [ ] **Phase 5:** Update `questionnaire-mapping.js` with missing entries:
  - [ ] Marital Change → `id_appendix`
  - [ ] New Child → `child_id_appendix`
  - [ ] Special Ed → `special_ed_approval`
  - [ ] Gambling → `gambling_win_cert`
  - [ ] Foreign Income → `foreign_income_report`
  - [ ] Inventory → `inventory_list`
  - [ ] Army Release → `army_release_cert`
  - [ ] Institution → `institution_approval`
  - [ ] Health Change → `medical_committee`
  - [ ] Spouse NII → Change to `perItem: true`
- [ ] **Phase 6:** Regenerate `questionnaire-mapping.json`
- [ ] **Phase 7:** Deploy to n8n
- [ ] **Phase 8:** Run full integration test with provided input
- [ ] **Phase 9:** Verify all 37+ documents created correctly
- [ ] **Phase 10:** Update this design log with implementation notes

---

## Success Metrics

**Before (Current State):**
- Documents from Boolean questions: **0 / 9** ❌
- Documents from multi-select: **27 / 27** ✅
- Total: **27 / 37+** (73% success)

**After (Target State):**
- Documents from Boolean questions: **9 / 9** ✅
- Documents from multi-select: **27 / 27** ✅
- Total: **37+ / 37+** (100% success)

**Architecture:**
- Single Source of Truth: ✅ `questionnaire-mapping.js`
- No hardcoded mappings in n8n: ✅
- Dynamic processing: ✅
- Consistent with `document-types.json` pattern: ✅
