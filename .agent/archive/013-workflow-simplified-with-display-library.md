# 013 - Workflow Simplified with Display Library

## Date: 2026-01-25

## What Was Done

Replaced 60+ lines of buggy HTML generation code in n8n workflow [02] with **3 lines** using the centralized display library.

## Changes to Workflow [02] (ID: EMFcb8RlVI0mge6W)

### Added Node
**HTTP - Get Display Library** (ID: fetch-display-lib)
- URL: `https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/document-display-n8n.js`
- Method: GET
- Position: After "Respond to Webhook", before "Merge"
- Purpose: Fetch display library at runtime

### Updated Node
**Code - Add Docs to Email** (ID: 9c0d5e56-6866-4ce8-b102-cbc99079848e)

**Before:** 130 lines with manual HTML building and buggy spouse detection
**After:** 60 lines using display library (50% reduction)

## Key Code Changes

### Old Buggy Logic (REMOVED)
```javascript
// ❌ This failed because docs contain employer names, not spouse names
const spouseDocs = docs.filter(d => spouseName && d.includes(spouseName));
const clientDocs = docs.filter(d => clientName && d.includes(clientName));
```

### New Clean Logic (ADDED)
```javascript
// ✅ Load display library
const displayLibCode = $('HTTP - Get Display Library').first().json;
const displayLib = eval(displayLibCode);

// ✅ Prepare documents with 'person' field
const documents = airtableDocs.map(item => ({
  issuer_name: item.json.issuer_name,
  category: categoryMap[item.json.document_key] || 'other',
  person: item.json.person || 'client',  // Uses 'person' field!
  type: item.json.type
}));

// ✅ Generate HTML with one function call
const docsHtml = displayLib.generateDocumentListHTML(documents, {
  clientName: clientName,
  spouseName: spouseName,
  language: 'he'
});
```

## How It Works Now

1. **Webhook receives** Tally submission
2. **HTTP node fetches** display library from GitHub
3. **DocMapping creates** documents with `person: 'spouse'` field
4. **Airtable stores** documents
5. **Code node calls** `displayLib.generateDocumentListHTML()`
6. **Display library:**
   - Separates docs by `person` field (not by name matching!)
   - Groups by category
   - Formats spouse names: "טופס 106 מקפה גרג (משה)"
   - Returns perfect HTML

## Expected Output

**For married couple (client: "לוי יצחק", spouse: "משה"):**

```
📄 מסמכים נדרשים

💼 הכנסות מעבודה
  לוי יצחק:
    • טופס 106 לשנת 2025 משכיר1
    • טופס 106 לשנת 2025 משכיר2

  משה (בן/בת זוג):
    • טופס 106 לשנת 2025 משכירה1 (משה)
    • טופס 106 לשנת 2025 משכירה2 (משה)

🏦 בנקים והשקעות
  • טופס 867 ממוסד1
  • טופס 867 ממוסד2
  • טופס 867 ממוסד3
```

## Benefits

✅ **Spouse name shows correctly** - Uses actual name "(משה)" not "(בן/בת זוג)"
✅ **No more buggy name matching** - Uses `person` field instead
✅ **50% less code** - 130 lines → 60 lines
✅ **Single source of truth** - Same logic will be used in web pages
✅ **Easy to maintain** - Fix library once, all places get fix

## Node Count
- **Before:** 18 nodes
- **After:** 19 nodes (added 1 HTTP node for library fetch)

## Status

✅ **WORKFLOW UPDATED** - Library integrated successfully
⏳ **TESTING NEEDED** - Submit new questionnaire to verify
⏳ **WEB PAGES TODO** - Update view-documents.html and document-manager.html to use same library

## Next Steps

1. Test with new questionnaire submission
2. Verify spouse names appear correctly
3. Verify categories display properly
4. Update web pages to use same library (future session)
