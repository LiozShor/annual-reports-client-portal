# 012 - Centralized Document Display Library

## Date: 2026-01-25

## Problem Statement

**Inconsistency across three different views:**
1. n8n workflow email generation - custom HTML logic
2. Client document viewer (view-documents.html) - custom display logic
3. Office document manager (document-manager.html) - custom display logic

**Result:** Fix spouse name in one place → still broken in other two places. Fighting the same bugs for weeks.

## Solution: Single Source of Truth for Display Logic

Created centralized display library that ALL three places use:

### Files Created

**1. `document-display.js`** (ES6 module for web pages)
- URL: https://liozshor.github.io/annual-reports-client-portal/document-display.js
- Used by: view-documents.html, document-manager.html

**2. `document-display-n8n.js`** (n8n-compatible version)
- URL: https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/document-display-n8n.js
- Used by: n8n workflow [02]

## Core Functions

### 1. `formatDocumentName(doc, spouseName)`
**Purpose:** Format document names consistently
- Adds actual spouse name in parentheses: "טופס 106 מקפה גרג (משה)"
- Removes generic "(בן/בת זוג)" placeholder
- Returns: `{ plain: "...", html: "..." }`

### 2. `groupDocumentsByCategory(documents)`
**Purpose:** Group documents by category with proper ordering
- Categories: employment, investments, insurance, family, education, other
- Each has: name_he, name_en, emoji, order
- Returns: `{ categoryId: { name_he, emoji, docs: [] } }`

### 3. `separateClientAndSpouse(documents)`
**Purpose:** Separate based on `person` field
- Uses `doc.person === 'spouse'` to identify spouse documents
- Returns: `{ client: [], spouse: [] }`

### 4. `generateDocumentListHTML(documents, options)`
**Purpose:** Generate consistent HTML for emails and web
- Options: `{ clientName, spouseName, language }`
- Handles married vs single display logic
- Color coding: blue for client, purple for spouse
- Returns: complete HTML string with yellow box styling

## How to Use in n8n Workflow

### Step 1: Fetch the Library (HTTP Request node)

**Node:** HTTP Request
**URL:** `https://raw.githubusercontent.com/LiozShor/annual-reports-client-portal/main/document-display-n8n.js`
**Method:** GET

### Step 2: Use in Code Node

```javascript
// Execute the fetched library code
const displayLib = eval($node["HTTP Request"].json.data);

// Prepare your documents array
const documents = [
  {
    issuer_name: "טופס 106 לשנת 2025 מקפה גרג",
    category: "employment",
    person: "client"
  },
  {
    issuer_name: "טופס 106 לשנת 2025 מאופק",
    category: "employment",
    person: "spouse"
  }
  // ... more documents
];

// Generate HTML
const docsHtml = displayLib.generateDocumentListHTML(documents, {
  clientName: "לוי יצחק",
  spouseName: "משה",
  language: "he"
});

// Use in email
const emailHtml = `
  <div>
    <h2>שלום ${clientName}</h2>
    ${docsHtml}
  </div>
`;

return { emailHtml };
```

## Expected Output

**For married couple (client: "לוי יצחק", spouse: "משה"):**

```
📄 מסמכים נדרשים

💼 הכנסות מעבודה
  לוי יצחק:
    • טופס 106 לשנת 2025 מקפה גרג
    • טופס 106 לשנת 2025 מטמבור

  משה (בן/בת זוג):
    • טופס 106 לשנת 2025 מאופק (משה)
    • טופס 106 לשנת 2025 מתנובה (משה)

🏦 בנקים והשקעות
  • טופס 867 מ לאומי
  • טופס 867 מ דיסקונט
```

## Migration Plan

### Phase 1: n8n Workflow ✅
1. ✅ Create display library
2. ✅ Commit to GitHub
3. ⏳ Update workflow to fetch and use library
4. ⏳ Test with real submission

### Phase 2: Web Pages
1. ⏳ Update view-documents.html to import and use library
2. ⏳ Update document-manager.html to import and use library
3. ⏳ Remove old display logic from both pages

### Phase 3: Cleanup
1. ⏳ Remove old HTML generation code from n8n workflow
2. ⏳ Simplify workflow structure (18 → fewer nodes)

## Benefits

✅ Fix spouse name ONCE → works everywhere
✅ Fix categories ONCE → works everywhere
✅ Fix formatting ONCE → works everywhere
✅ No more inconsistency between email, client view, office view
✅ Simple, maintainable code
✅ Single source of truth for display logic

## Files Modified

**Created:**
- `github/annual-reports-client-portal/document-display.js` (296 lines)
- `github/annual-reports-client-portal/document-display-n8n.js` (155 lines)

**Commit:** 53d13e9

## Status

✅ **LIBRARY CREATED** - Simple, clean, ready to use
⏳ **INTEGRATION PENDING** - Need to update n8n workflow
⏳ **TESTING NEEDED** - Verify with real questionnaire data

## Next Steps

Send the user:
1. Confirmation that library is created and pushed
2. Simple explanation of what to do next
3. Ask if they want me to update the n8n workflow now, or if they want to send me the specific node to update
