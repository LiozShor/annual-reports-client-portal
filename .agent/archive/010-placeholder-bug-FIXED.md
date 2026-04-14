# 010 - Placeholder Bug FIXED ✅

## Date: 2026-01-25

## Problem (From Logs 008 & 009)
Email output had unreplaced placeholders:
- `{institution}`, `{company}`, `{product}`, `{withdrawal_type}`
- Example: `"על ההפקדות ל{product} ב"{company}"` ❌

## Root Cause
Code - DocMapping node had **THREE bugs**:

### Bug #1: Line 120-121 (formatDocumentName function)
```javascript
template = template.replace(placeholder, value);  // ❌ Only replaces FIRST occurrence
```

### Bug #2: Line 198 (perItem branch)
```javascript
const templateParamKey = docType.details[0].key;  // ❌ Only uses FIRST detail!
params[templateParamKey] = cleanAndBold(item);
```

### Bug #3: Line 229 (single document branch)
```javascript
const templateParamKey = docType.details[0].key;  // ❌ Only uses FIRST detail!
```

## The Fix (Applied)

### Fix #1: Use replaceAll instead of replace
```javascript
template = template.replaceAll(placeholder, value);  // ✅ Replaces ALL occurrences
template_en = template_en.replaceAll(placeholder, value);
```

### Fix #2: Loop ALL details in perItem branch
```javascript
if (docType.details && docType.details.length > 0) {
  docType.details.forEach(detail => {
    if (detail.key === 'year') return; // Skip - already added

    // Use fixedParams if available (e.g., product="קרן פנסיה")
    if (mapping.fixedParams && mapping.fixedParams[detail.key]) {
      params[detail.key] = cleanAndBold(mapping.fixedParams[detail.key]);
    }
    // Otherwise use item value
    else if (item) {
      params[detail.key] = cleanAndBold(item);
    }
  });
}
```

### Fix #3: Loop ALL details in single document branch
```javascript
if (docType.details && docType.details.length > 0) {
  docType.details.forEach(detail => {
    if (detail.key === 'year' || detail.key === 'name') return; // Skip - already added

    if (mapping.fixedParams && mapping.fixedParams[detail.key]) {
      params[detail.key] = cleanAndBold(mapping.fixedParams[detail.key]);
    }
    else if (mapping.detailsField && answerValue) {
      const linkedAnswer = answers[mapping.linkedQuestion] || answerValue;
      params[detail.key] = cleanAndBold(linkedAnswer);
    }
  });
}
```

## Test Case (Insurance Document)

**Mapping:** `insurance_pension_companies`
- `perItem: true`
- `detailsField: "company"`
- `fixedParams: { product: "קרן פנסיה" }`
- `documents: ["insurance_tax_cert"]`

**Document Type:** `insurance_tax_cert`
```javascript
{
  name: {
    he: "אישור שנתי למס הכנסה לשנת {year} על ההפקדות ל{product} ב\"{company}\"",
    en: "Annual tax certificate for {year} for contributions to {product} at \"{company}\""
  },
  details: [
    { key: "year", ... },
    { key: "product", ... },
    { key: "company", ... }
  ]
}
```

**Answer:** `"כלל1\nכלל2"`

**BEFORE fix:**
```
"אישור שנתי למס הכנסה לשנת 2025 על ההפקדות ל{product} ב"<b>כלל1</b>""  ❌
```

**AFTER fix:**
```
"אישור שנתי למס הכנסה לשנת 2025 על ההפקדות ל<b>קרן פנסיה</b> ב"<b>כלל1</b>""  ✅
```

## Changes Applied

**Workflow:** `[02]` (ID: `EMFcb8RlVI0mge6W`)
**Node:** `Code - DocMapping` (ID: `d5346f8f-fc99-4dcf-b19e-83e2f6eccfa8`)
**Updated:** 2026-01-25
**Lines changed:** 120-121, 197-209, 237-251

## Status
✅ **FIXED** - All three bugs patched
⏳ **TESTING NEEDED** - User should test with real questionnaire data
⏳ **SIMPLIFICATION PENDING** - After confirming fix works, simplify workflow from 18 → 8 nodes
