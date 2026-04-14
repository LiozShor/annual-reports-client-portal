# Design Log 025: Workflow [02] Bug Fixes - Lessons Learned

**Date:** 2026-01-27
**Workflow:** `[02-SIMPLIFIED] Questionnaire Response Processing V2` (ID: EMFcb8RlVI0mge6W)
**Status:** [COMPLETED]

---

## Key Findings & Mistakes to Avoid

### 1. JSON vs JavaScript File Confusion

**MISTAKE:** Assumed `questionnaire-mapping.json` was JavaScript code and tried to parse it with `new Function()`.

**REALITY:**
- `questionnaire-mapping.js` = JavaScript source with `export const QUESTION_MAPPINGS = [...]`
- `questionnaire-mapping.json` = Auto-generated JSON with `{ mappings: [...] }`

**The HTTP node fetches `.json` (not `.js`), so:**
```javascript
// WRONG - trying to execute JSON as JavaScript
const mappingFunc = new Function(mappingCode.replace(/export\s+/g, '') + '; return QUESTION_MAPPINGS;');

// CORRECT - JSON is already parsed, just access the property
const MAPPINGS = mappingResponse.mappings;
```

**RULE:** Always check what URL the HTTP node is fetching before writing parsing code.

---

### 2. HTTP Response Format Differences

**MISTAKE:** Assumed all HTTP responses have the same format.

**REALITY:**
| File Type | Response Format | How to Access |
|-----------|-----------------|---------------|
| `.json` | Parsed JSON object | `$('Node').first().json` directly |
| `.js` (raw text) | String or `{ data: "..." }` | Need to check both formats |

**SAFE PATTERN:**
```javascript
// For JSON endpoints (already parsed)
const jsonData = $('HTTP - Get JSON').first().json;
const items = jsonData.mappings; // Access directly

// For raw text (JavaScript files)
const response = $('HTTP - Get JS').first().json;
let code = '';
if (typeof response === 'string') {
  code = response;
} else if (response && response.data) {
  code = response.data;
} else {
  // Handle other formats
}
```

---

### 3. Tally Answer Format - Arrays vs Strings

**MISTAKE:** Assumed all answers are strings.

**REALITY:** Multi-select and choice fields return arrays, even for single values:
```javascript
// Tally returns
"question_67Kv1P": ["כן"]  // Array, not string!

// WRONG
if (answer === 'כן') { ... }

// CORRECT
function isYes(val) {
  if (Array.isArray(val)) val = val[0];  // Handle array
  const v = String(val || '').trim().toLowerCase();
  return v === 'כן' || v === 'yes';
}
```

---

### 4. Node Reference Names Must Be Exact

**MISTAKE:** Assumed node names from memory.

**REALITY:** Always verify node names match exactly:
```javascript
// If node is named "HTTP - Get Questionnaire Mapping"
$('HTTP - Get Questionnaire Mapping')  // Correct
$('HTTP-Get Questionnaire Mapping')    // Wrong - missing space
$('Get Questionnaire Mapping')         // Wrong - missing prefix
```

**RULE:** Use `n8n_get_workflow(mode='structure')` to verify exact node names before writing code.

---

### 5. SSOT Module Loading

**ISSUE:** The SSOT module is raw JavaScript that needs `new Function()` to execute.

**SAFE PATTERN:**
```javascript
let SSOT = {};
try {
  let ssotCode = '';
  if (typeof ssotResponse === 'string') {
    ssotCode = ssotResponse;
  } else if (ssotResponse && ssotResponse.data) {
    ssotCode = ssotResponse.data;
  }

  // Only parse if it looks like valid SSOT code
  if (ssotCode && typeof ssotCode === 'string' && ssotCode.includes('SSOT_TEMPLATES')) {
    const ssotFunc = new Function(ssotCode + '; return { SSOT_TEMPLATES, formatDocumentTitle, selectNIITemplate };');
    SSOT = ssotFunc();
  }
} catch (e) {
  console.error('Failed to parse SSOT:', e.message);
  // Continue with fallback behavior
}
```

---

### 6. Airtable Type Values Must Be Valid Enums

**MISTAKE:** Used lowercase document type IDs as Airtable `type` field values.

**REALITY:** Airtable single-select fields require exact option values:
```javascript
// WRONG - lowercase, doesn't exist in Airtable
type: "nii_allowance_cert"

// CORRECT - PascalCase with underscores
type: "NII_Allowance_Cert"
```

**RULE:** Create a type mapping function:
```javascript
function getAirtableType(docTypeId) {
  const typeMap = {
    'nii_allowance_cert': 'NII_Allowance_Cert',
    'form_106': 'Form_106',
    // ... all mappings
  };
  return typeMap[docTypeId] || docTypeId;
}
```

---

### 7. SSOT Template Output Format

**ISSUE:** SSOT `formatDocumentTitle()` returns an object, not a string.

**REALITY:**
```javascript
// SSOT returns
{ he: "טופס 106 לשנת <b>2025</b>...", en: "Form 106 for <b>2025</b>..." }

// CORRECT access
const result = SSOT.formatDocumentTitle(templateKey, params);
const hebrewTitle = result.he || result;  // Fallback if string
```

---

## Workflow [02] Architecture Reference

```
Webhook → Respond to Webhook
   ↓
HTTP nodes (parallel):
  - HTTP - Get Document Types      → .json endpoint (parsed JSON)
  - HTTP - Get Questionnaire Mapping → .json endpoint (parsed JSON)
  - HTTP - Get Display Library     → .js endpoint (raw text)
  - HTTP - Get SSOT Module         → .js endpoint (raw text)
   ↓
Merge (5 inputs)
   ↓
Extract & Prepare → Generate Documents → Finalize & Format
   ↓
Airtable - Batch Upsert
   ↓
...email generation...
```

---

## Pre-Flight Checklist for n8n Code Nodes

Before writing code that references other nodes:

1. [ ] Verify exact node names with `n8n_get_workflow(mode='structure')`
2. [ ] Check HTTP node URLs - is it `.json` or `.js`?
3. [ ] For JSON: data is directly in `.json`
4. [ ] For raw text: may be in `.json.data` or `.json` directly
5. [ ] Handle Tally array values (multi-select returns arrays)
6. [ ] Map document type IDs to valid Airtable enum values
7. [ ] SSOT returns `{ he: ..., en: ... }` - access `.he` for Hebrew

---

### 8. Extract & Prepare Output Format

**MISTAKE:** Expected `answers` but Extract & Prepare outputs `answers_by_key`.

**REALITY:**
```javascript
// Extract & Prepare outputs:
{
  answers_by_key: { "question_lyeQvN": [...], ... },
  answers_map: { "question_lyeQvN": [...], ... },
  // NOT just "answers"
}

// CORRECT access
const answers = input.answers_by_key || input.answers_map || input.answers || {};
```

---

### 9. Questionnaire Mapping JSON Structure

**MISTAKE:** Expected `{ questionKey, documentType, ... }` but actual structure is different.

**REALITY:**
```javascript
// Actual questionnaire-mapping.json structure:
{
  mappings: [
    {
      id: "employment_employers_list",
      tallyKeys: { he: "question_5zjRMZ", en: "question_xpDPY9" },
      documents: ["form_106"],  // ARRAY, not documentType
      isSpouse: false,
      perItem: true,
      detailsField: "issuer_name",  // Which param the item value fills
      linkedQuestion: null
    }
  ]
}
```

**CORRECT code:**
```javascript
// Use tallyKeys[lang] for question key based on form language
const lang = source_language === 'en' ? 'en' : 'he';
const questionKey = tallyKeys[lang];

// documents is an array
for (const docType of docTypes) { ... }

// detailsField tells which param gets the item value
if (detailsField && itemValue) {
  params[detailsField] = itemValue;
}
```

---

### 10. SSOT Module HTTP Loading Complexity

**ISSUE:** Loading JavaScript via HTTP and `new Function()` is fragile.

**SOLUTION (Session 2026-01-27):** Use INLINE SSOT templates in Generate Documents node.

**Benefits:**
- No HTTP dependency for templates
- Templates always available
- Easier to debug
- No parsing complexity

**The SSOT module is still useful for:**
- Centralized source of truth (master templates)
- Business rules (deduplication, consolidation)
- Used by display library

**Generate Documents now has inline templates** that match SSOT character-perfect.

---

## Files Modified This Session (Updated 2026-01-27)

- Workflow [02] - Generate Documents node (rewritten with inline SSOT templates)
- Workflow [02] - Fixed to use `answers_by_key` from Extract & Prepare
- Workflow [02] - Fixed to use correct questionnaire-mapping.json structure
- Design log 025 (this file)

---

## Changes Made (Session 2026-01-27)

### Generate Documents Node Rewrite

**Before (broken):**
- Tried to load SSOT module via HTTP + `new Function()`
- Used wrong field names (`questionKey` vs `tallyKeys`)
- Used wrong answers field (`answers` vs `answers_by_key`)
- Returned single item with `documents` array

**After (fixed):**
- Uses inline SSOT templates (no HTTP dependency)
- Uses correct `tallyKeys[lang]` for language-specific keys
- Uses `answers_by_key` from Extract & Prepare
- Returns each document as separate item for Finalize & Format
- Maps document types to Airtable enum values

**Key code patterns:**
```javascript
// Get answers from correct field
const answers = input.answers_by_key || input.answers_map || {};

// Use language-specific question keys
const lang = source_language === 'en' ? 'en' : 'he';
const questionKey = tallyKeys[lang];

// Try both with and without prefix
let answerValue = answers[questionKey] || answers[questionKey.replace(/^question_/, '')];

// Map to Airtable type
type: getAirtableType(docType)  // form_106 → Form_106
```

---

## Next Steps

1. ✅ Fixed Generate Documents node with inline SSOT templates
2. ✅ Fixed Airtable type mapping (exact schema values)
3. ✅ Fixed multi-line value splitting (splitMultiLine function)
4. ✅ Fixed Extract & Prepare UUID translation (translateFieldValue function)
5. ✅ Fixed Email HTML with action buttons (approve/edit URLs)
6. ⏳ User to test new execution
7. ⏳ Verify document titles show Hebrew (not template keys or UUIDs)
8. ⏳ Verify Airtable upsert succeeds (type values now correct)
9. ⏳ Verify multi-line inputs split into separate documents
10. ⏳ Check email HTML has correct format with buttons

---

## Session Summary (2026-01-27 Evening)

### All Bugs Fixed

| Bug | Status | Fix Location |
|-----|--------|--------------|
| UUID → Label mapping | ✅ FIXED | Extract & Prepare - `translateFieldValue()` |
| Missing doc types | ✅ FIXED | Generate Documents - inline SSOT templates |
| No action buttons | ✅ FIXED | Code - Generate Email HTML |
| Questionnaire table UUIDs | ✅ FIXED | Extract & Prepare - uses translated values |
| Airtable type error | ✅ FIXED | Generate Documents - AIRTABLE_TYPES mapping |
| Multi-line not split | ✅ FIXED | Generate Documents - `splitMultiLine()` |

### Key Code Patterns Implemented

**1. UUID Translation (Dynamic - No Hardcoding):**
```javascript
function translateFieldValue(field) {
  if (!field.options || !field.value) return field.value;

  const optionsMap = {};
  field.options.forEach(opt => {
    if (opt.id && opt.text) optionsMap[opt.id] = opt.text;
  });

  if (Array.isArray(field.value)) {
    return field.value.map(v => optionsMap[v] || v);
  }
  return optionsMap[field.value] || field.value;
}
```

**2. Airtable Type Mapping (Exact Schema Values):**
```javascript
const AIRTABLE_TYPES = {
  'residency_cert': 'Residency_Cert',
  'child_disability_approval': 'Child_Disability_Approval',
  'wht_approval': 'WHT_Approval_IncomeTax',
  // ... etc
};
```

**3. Multi-Line Value Splitting:**
```javascript
function splitMultiLine(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    const result = [];
    for (const v of val) {
      if (typeof v === 'string' && v.includes('\n')) {
        result.push(...v.split('\n').map(s => s.trim()).filter(Boolean));
      } else if (v) {
        result.push(String(v).trim());
      }
    }
    return result;
  }
  if (typeof val === 'string' && val.includes('\n')) {
    return val.split('\n').map(s => s.trim()).filter(Boolean);
  }
  return [String(val).trim()];
}
```

**4. Action Buttons:**
```javascript
const approveUrl = `https://liozshor.app.n8n.cloud/webhook/approve-and-send?report_id=${reportRecordId}&token=MOSHE_1710`;
const editUrl = `https://liozshor.github.io/annual-reports-client-portal/document-manager.html?report_id=${reportRecordId}`;
```

### Ready for Testing

The workflow is now ready for user testing. Expected behavior:
- Multi-line inputs (מעסיק1\nמעסיק2) → Separate documents
- UUIDs → Hebrew labels (e.g., "פיצויי פיטורין" instead of UUID)
- Airtable upsert → Succeeds (correct type values)
- Email → Includes questionnaire table + action buttons
