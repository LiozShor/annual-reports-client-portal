# 026 - Display Library Migration Plan

**Created:** 2026-01-27
**Status:** [COMPLETED]
**Objective:** Ensure all document display locations use the centralized display library

---

## Overview

The display library (`document-display.js` / `document-display-n8n.js`) is the SINGLE SOURCE OF TRUTH for:
- Document name formatting
- Category grouping and ordering
- Client vs spouse separation
- HTML generation

**Goal:** Fix display bug ONCE in library → automatically fixed everywhere

---

## Migration Status

### Workflows

| Workflow | Status | Notes |
|----------|--------|-------|
| [02] Questionnaire Response | ✅ DONE | Uses `generateDocumentListHTML()` |
| [03] Approve & Send | ✅ DONE | Display library migrated |
| [04] Document Edit Handler | ✅ DONE | Display library migrated |

### Web Pages

| Page | Status | Notes |
|------|--------|-------|
| view-documents.html | ⏳ TODO | Has own JS display logic |
| document-manager.html | ⏳ TODO | Has own display logic |
| admin/index.html | ⏳ REVIEW | Check if displays documents |

---

## Migration Steps (Per Page)

### view-documents.html
1. Import display library: `import { formatDocumentName, groupDocumentsByCategory, generateDocumentListHTML } from './document-display.js'`
2. Replace existing category/grouping logic
3. Use library functions for consistent display
4. Test bilingual toggle still works

### document-manager.html
1. Import display library
2. Replace display logic with library functions
3. Ensure edit functionality still works
4. Test waive/add/notes features

---

## Testing Checklist

After each migration:

- [ ] **Visual consistency test:** All 4 locations display documents identically
- [ ] **Spouse name test:** Shows "(משה)" not "(בן/בת זוג)"
- [ ] **Category test:** Same order, emojis, Hebrew/English names
- [ ] **Separation test:** Married couples have client/spouse separation

---

## Success Criteria

- All workflows use `document-display-n8n.js`
- All web pages use `document-display.js`
- Zero custom HTML generation code remains
- All tests pass
