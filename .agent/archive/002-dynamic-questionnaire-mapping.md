# Design Log: Dynamic Questionnaire-to-Document Mapping

## Date: 2026-01-24

## Current State

The system currently has:
1. **CSV Mapping File** (`archive/tally_n8n_mapping_with_english_keys.csv`) with ~94 questions
2. **Hardcoded Code Node** in workflow `[02] Webhook: Questionnaire Response` that processes Tally responses
3. **document-types.js** as Single Source of Truth for document type definitions

### Current Mapping Logic (from CSV):
| Question Type | Mapping Rule | Example |
|--------------|--------------|---------|
| Simple yes/no | IF(YES) → required document | "Did you live in qualifying settlement?" → Residency_Cert |
| Employer list | Per-item in list → Form_106 | Each employer in list → separate 106 |
| Bank list | Per-item in list → Form_867 | Each bank → separate 867 |
| Insurance companies | Per-item in list → Insurance_Tax_Cert | Each company → separate cert |

---

## Clarifying Questions

### Q1: Mapping Granularity
What level of mapping control do you need?
- **Option A**: Simple question → single document type (current)
- **Option B**: Question + specific answer → document type (e.g., "Which NII benefits?" → different docs per checkbox)
- **Option C**: Full conditional logic (if Q1=X AND Q2=Y → doc Z)

**User Answer**: ✅ As current - simple question → document type with IF(YES) conditions

---

### Q2: Per-Item Document Generation
Currently, list-type questions (employers, banks) generate one document **per item** in the list.
Should this behavior be configurable in the admin UI?
- Example: "Employer list: קפה גרג, מקדונלד" → 2x Form_106 (one for each)
- Should admin be able to change this to single doc, or configure different doc types per item?

**User Answer**: ✅ Yes - per-item behavior should be configurable

---

### Q3: Dynamic Document Details
Some documents require additional details extracted from answers:
- Form_106 → employer name (from employer list)
- Form_867 → bank name (from bank list)
- Insurance_Tax_Cert → company name (from company list)

Should the admin be able to:
- Configure which question fields feed into document details?
- Create new detail mappings?

**User Answer**: ✅ Yes - admin can configure which question fields map to document details

---

### Q4: Spouse Documents
Currently, separate document types exist for client vs spouse (Form_106 vs Form_106_Spouse).
Should the mapping UI:
- Handle this automatically based on question context?
- Allow manual mapping of "person" (client/spouse) per question?

**User Answer**: ✅ Automatic - detect spouse context from question (contains "בן/בת הזוג" or "spouse")

---

### Q5: Hebrew + English Forms
You have two Tally forms (Hebrew and English) with different field keys.
The CSV maps both field keys to the same logic.
Should the admin UI:
- Show both field keys side-by-side?
- Allow different mappings per language?
- Sync mappings automatically between languages?

**User Answer**: ✅ Button per question to "Transfer to English" - copies question text and doc mappings to English version

---

### Q6: Storage Location
Where should the dynamic mapping configuration be stored?
- **Option A**: Extend `document-types.js` with mapping rules (keep SSOT)
- **Option B**: New `questionnaire-mapping.js` file in GitHub (separate SSOT)
- **Option C**: Airtable table for mappings (database-driven)
- **Option D**: n8n Code node with external fetch (like current document-types approach)

**User Answer**: ✅ **Agent Recommendation: Option B** - New `questionnaire-mapping.js` in GitHub
- Keeps SSOT pattern consistent with document-types.js
- Allows version control and rollback
- Can be fetched by n8n via HTTP (like document-types)
- Separates concerns: document definitions vs mapping rules

---

### Q7: Validation & Preview
When editing mappings in the admin UI:
- Should there be a "preview" mode to test with sample data?
- Should validation prevent invalid configurations?
- Should changes require approval before going live?

**User Answer**: ✅ Yes to preview, Yes to approval before going live

---

## Design Decisions

### 1. Data Structure
Created `questionnaire-mapping.js` with:
- `QUESTION_CATEGORIES`: 16 categories (hidden, personal, family, children, employment, pension, nii, investments, realestate, insurance, military, education, health, donations, withholding, other)
- `QUESTION_MAPPINGS`: Array of 70+ mappings, each containing:
  - `id`: Unique identifier
  - `tallyKeys`: { he, en } - Tally form field keys
  - `label`: { he, en } - Question text
  - `type`: yes_no, list, text, checkbox, hidden
  - `category`: Category ID
  - `condition`: "yes", "no", or null
  - `documents`: Array of document type IDs
  - `isSpouse`: Boolean (auto-detected from question text)
  - `perItem`: Boolean (generate one doc per list item)
  - `detailsField`: Field name for issuer extraction
  - `docDescription`: { he, en } - Description text

### 2. Admin Interface (`questionnaire-mapping-editor.html`)
Features:
- Category filter dropdown
- Search by question/document
- Filter: with docs / without docs
- Edit document descriptions (Hebrew/English)
- Toggle: perItem, isSpouse
- Add/remove document types per question
- Visual indicators for modified cards
- Preview changes before saving
- Changes bar with discard/save buttons

### 3. n8n Workflows
- `[API] Get Questionnaire Mapping` (ID: If0tyzzUWF081jnD) - Serves JSON from GitHub
- `[Admin] Update Questionnaire Mapping` (ID: M3MhbIO2ckcYMv0Y) - Commits changes to GitHub

### 4. File Architecture
```
github/annual-reports-client-portal/
├── questionnaire-mapping.js      # MASTER - Source of Truth
├── questionnaire-mapping.json    # Auto-generated (for n8n)
├── generate-mapping-json.js      # Generator script
└── admin/
    ├── index.html               # Added new tab
    └── questionnaire-mapping-editor.html  # NEW
```

---

## Open Questions

- [x] Need to examine the actual Code - DocMapping node logic → Analyzed and migrated
- [x] Understand how conditional response values (checkboxes) are currently handled → Mapped
- [x] Determine if any edge cases exist in current mapping logic → Covered in structure
