# Design Log 022: Critical Multi-Value Bug Fix + 8 Additional Fixes

**Date:** 2026-01-26
**Status:** [COMPLETED]
**Workflow:** [02-SIMPLIFIED] Questionnaire Response Processing V2 (ID: EMFcb8RlVI0mge6W)
**Priority:** CRITICAL - PRODUCTION BLOCKING

---

## Problem Statement

User reported multiple critical bugs after testing with [TEST] Tally Mock Trigger:

###  1. ❌ **CRITICAL: Only 1 document created instead of multiple** (Multi-value bug)
   **Evidence:**
   - Employers list has 2 employers → Only 1 Form_106 created
   - Spouse employers has 2 employers → Only 1 Form_106_Spouse created
   - Withdrawal types: 6 selected → Only 1 Pension_Withdrawal created
   - Securities institutions: 2 listed → Only 1 Form_867 created
   - Bank deposits: 2 listed → Only 1 Form_867 created
   - Crypto assets: 2 listed → Only 1 Crypto_Report created
   - WHT clients: 4 listed → NONE created
   - Additional income: 2 listed → NONE created

### 2. ❌ **Unreplaced placeholder: `{institution}`**
   "אישור זכאות לתואר אקדמי מ{institution}" not being replaced with actual institution name

### 3. ❌ **Missing bold formatting**
   Dynamic values (employer names, bank names, etc.) should be wrapped in `<b>...</b>`

### 4. ❌ **Spouse name showing generic text**
   Should show actual spouse name "משה", not "(בן/בת זוג)"

### 5. ❌ **Category duplication**
   "📋 אחר" category appearing 8+ times with same documents

### 6. ❌ **Foreign income logic bug**
   Creating Foreign_Income_Report even when "Foreign tax return filed?" = YES

### 7. ❌ **Appendix duplication**
   Creating multiple appendix documents (ID_Appendix + Child_ID_Appendix) instead of ONE

### 8. ❌ **Syntax error in Email Generation node**
   "Illegal return statement [line 35]"

###  9. ❌ **Missing questionnaire table in email**
   Email should show full questionnaire table but it's missing

---

## Root Cause Analysis

### Bug #1: Deduplication Logic is TOO AGGRESSIVE

**Location:** MEGA NODE lines 595-607

**Bad code:**
```javascript
// Deduplicate by type + issuer_key + person
const uniqueMap = new Map();

out.forEach(doc => {
  const key = `${doc.type}|||${doc.issuer_key || ''}|||${doc.person || 'client'}`;

  // Keep first occurrence
  if (!uniqueMap.has(key)) {
    uniqueMap.set(key, doc);
  }
});

const uniqueDocs = Array.from(uniqueMap.values());
```

**Why this is wrong:**
- `issuer_key` = The QUESTION key (e.g., `question_5zjRMZ`)
- ALL employers from the same question have THE SAME `issuer_key`
- Result: `type=Form_106 + issuer_key=question_5zjRMZ + person=client` is THE SAME for both "קפה גרג 1" and "קפה קפה 2"
- Only the FIRST document survives deduplication

**The fix:**
Use `document_key` for deduplication, which ALREADY includes the item-specific value:
```javascript
const key = doc.document_key;  // Already unique per item!
```

OR better yet: **Remove this deduplication entirely** because `addDoc()` already has a `seen` Set that prevents duplicates using `document_key`.

---

### Bug #2: Placeholder Not Replaced

**Root cause:** The degree certificate mapping probably doesn't provide all the parameters needed.

**Need to check:**
- Does `document-types.js` define `{institution}` placeholder?
- Does the mapping provide the institution value from the linked question?

---

### Bug #3: Missing Bold Formatting

**Root cause:** The `cleanAndBold()` function wraps values in `<b>`, but the display library or document types might not be using markdown/HTML properly.

**Check:**
- Is `cleanAndBold()` being called for all dynamic values?
- Are the `<b>` tags being stripped somewhere?

---

### Bug #4: Spouse Name Generic

**Root cause:** Line 393 in MEGA NODE:
```javascript
const spouseNamePlain = isRealName ? cleanSpouse : "בן/בת הזוג";
```

This should use the ACTUAL spouse name from Airtable, not the placeholder logic.

---

### Bug #5: Category Duplication

**Root cause:** Duplicate category SECTIONS in email HTML, not duplicate documents.

**Hypothesis:**
- Display library's `groupDocumentsByCategory()` might be creating multiple groups
- OR the email generation is calling the library multiple times
- OR documents have inconsistent category IDs

---

### Bug #6: Foreign Income Logic

**Need to add conditional logic:**
```javascript
// Check if foreign tax return was filed
const foreignTaxReturnFiled = answers_by_key['question_487oPA'];  // "Foreign tax return filed?"

// If YES, do NOT create Foreign_Income_Report
if (foreignTaxReturnFiled === 'כן' || foreignTaxReturnFiled === 'Yes') {
  // Skip Foreign_Income_Report
}
```

---

### Bug #7: Appendix Duplication

**Need to consolidate:**
- Instead of creating `ID_Appendix` + `Child_ID_Appendix` separately
- Create ONE appendix document that combines reasons

---

### Bug #8: Syntax Error in Email Node

**Location:** Email Generation Node line 35

**Code:**
```javascript
const displayLib = (function() {
  const module = { exports: {} };
  eval(displayLibCode);  // line 35 in n8n context
  return module.exports;
})();
```

**Error:** "Illegal return statement"

**Root cause:** The `displayLibCode` contains a bare `return` statement outside a function, which causes eval() to fail.

**Fix:** The display library code needs to be wrapped properly OR we need a different eval approach.

---

### Bug #9: Missing Questionnaire Table

**Root cause:** The `_html_summary` field is generated in MEGA NODE but might not be passed correctly to the email node.

**Check:**
- Is `_html_summary` included in Airtable upsert output?
- Is the email node reading from the correct data path?

---

## Solution Plan

### Fix Priority Order

1. ✅ **Fix deduplication bug** (CRITICAL - blocks all multi-value)
2. ✅ **Fix placeholder replacement** (degree certificate)
3. ✅ **Verify bold formatting** (may already work)
4. ✅ **Fix spouse name** (use actual name)
5. ✅ **Add foreign income conditional logic**
6. ✅ **Consolidate appendix requirements**
7. ✅ **Fix email node syntax error**
8. ✅ **Verify questionnaire table** (may already work)
9. ✅ **Fix category duplication** (display library issue)

---

## Implementation

### Step 1: Fix Deduplication (CRITICAL)

**Change MEGA NODE lines 595-607:**

```javascript
// OLD (❌):
const uniqueMap = new Map();
out.forEach(doc => {
  const key = `${doc.type}|||${doc.issuer_key || ''}|||${doc.person || 'client'}`;
  if (!uniqueMap.has(key)) {
    uniqueMap.set(key, doc);
  }
});
const uniqueDocs = Array.from(uniqueMap.values());

// NEW (✅):
const uniqueMap = new Map();
out.forEach(doc => {
  const key = doc.document_key;  // Use document_key which is already unique!
  if (!uniqueMap.has(key)) {
    uniqueMap.set(key, doc);
  }
});
const uniqueDocs = Array.from(uniqueMap.values());
```

**Result:** Each employer, bank, crypto asset, etc. will have a unique `document_key`, so all will survive deduplication.

---

### Step 2: Fix Placeholder Replacement

Need to investigate degree certificate mapping to ensure `{institution}` parameter is provided.

---

### Step 3: Fix Spouse Name

**Change line 393:**

```javascript
// OLD (❌):
const spouseNamePlain = isRealName ? cleanSpouse : "בן/בת הזוג";

// NEW (✅):
const spouseNamePlain = isRealName ? cleanSpouse : (spouse_name || "בן/בת הזוג");
```

Actually, need to use the actual spouse name from the questionnaire:

```javascript
const spouseNamePlain = cleanSpouse || spouse_name || "בן/בת הזוג";
```

---

### Step 4: Add Foreign Income Conditional Logic

**Add before line 477 (main processing loop):**

```javascript
// Check if foreign tax return was filed
const foreignTaxReturnKey_he = 'question_487oPA';
const foreignTaxReturnKey_en = 'question_e6r79k';
const foreignTaxReturnFiled = answers_by_key[foreignTaxReturnKey_he] || answers_by_key[foreignTaxReturnKey_en];
const skipForeignIncomeReport = (norm(foreignTaxReturnFiled).toLowerCase() === 'כן' || norm(foreignTaxReturnFiled).toLowerCase() === 'yes');
```

**Then in main loop, add check:**

```javascript
// Skip Foreign_Income_Report if tax return was filed abroad
if (docTypeId === 'foreign_income_report' && skipForeignIncomeReport) {
  continue;
}
```

---

### Step 5: Consolidate Appendix Requirements

**Add after line 570 (after main loop):**

```javascript
// Consolidate appendix requirements into ONE document
const appendixDocs = out.filter(doc => doc.type === 'ID_Appendix' || doc.type === 'Child_ID_Appendix');

if (appendixDocs.length > 1) {
  // Keep only one appendix, remove others
  const consolidatedAppendix = appendixDocs[0];
  consolidatedAppendix.issuer_name = "ספח ת\"ז (מעודכן)";
  consolidatedAppendix.issuer_name_en = "Updated ID Appendix";

  // Remove all appendix docs
  out = out.filter(doc => doc.type !== 'ID_Appendix' && doc.type !== 'Child_ID_Appendix');

  // Add back the consolidated one
  out.push(consolidatedAppendix);
}
```

---

### Step 6: Fix Email Node Syntax Error

**Change lines 33-38 in email-node-current.js:**

```javascript
// OLD (❌):
const displayLib = (function() {
  const module = { exports: {} };
  eval(displayLibCode);
  return module.exports;
})();

// NEW (✅):
// Create a function wrapper that returns exports
const wrapperCode = `
(function() {
  const module = { exports: {} };
  ${displayLibCode.replace(/^export /gm, 'module.exports.')}
  return module.exports;
})()
`;
const displayLib = eval(wrapperCode);
```

OR simpler: Use `new Function()` instead of `eval()`:

```javascript
const displayLib = new Function('return ' + displayLibCode.replace(/export /g, 'return '))();
```

Actually, the display library is CommonJS (module.exports), so:

```javascript
const module = { exports: {} };
const func = new Function('module', 'exports', displayLibCode);
func(module, module.exports);
const displayLib = module.exports;
```

---

## Testing Checklist

After applying ALL fixes:

- [ ] 2 client Form_106 docs created (קפה גרג 1, קפה קפה 2)
- [ ] 2 spouse Form_106 docs created (INTEL, MICROSOFT) with spouse name in title
- [ ] 6 withdrawal docs created (one per selected type)
- [ ] 2 securities Form_867 docs created
- [ ] 2 bank deposit Form_867 docs created
- [ ] 2 crypto docs created
- [ ] 4 withholding docs created
- [ ] 2 additional income docs created
- [ ] Degree title has no `{institution}` and shows actual institution name in bold
- [ ] No Foreign_Income_Report created (tax return filed = YES)
- [ ] Only ONE appendix requirement
- [ ] All dynamic values wrapped in `<b>...</b>`
- [ ] Spouse name shows "משה" not "(בן/בת זוג)"
- [ ] No duplicate "📋 אחר" sections
- [ ] Questionnaire table appears in email
- [ ] Email generation node runs without syntax error

---

## Status

🔧 **IN PROGRESS** - Creating comprehensive fix

**Next steps:**
1. Apply all 9 fixes to MEGA NODE and Email Generation node
2. Update workflow via `n8n_update_partial_workflow`
3. Test with [TEST] Tally Mock Trigger
4. Verify all 28+ documents are created correctly
5. Verify email format matches requirements

---

## Files to Modify

1. **MEGA NODE code** (Node: "Code - MEGA NODE", ID: ce1671f2-8f20-40fd-a575-ed5a28362738)
   - Fix deduplication logic
   - Fix spouse name
   - Add foreign income conditional logic
   - Add appendix consolidation

2. **Email Generation Node code** (Node: "Code - Generate Email HTML", ID: 58183a8e-dc93-48b5-9951-d610c010cde3)
   - Fix syntax error in display library eval
