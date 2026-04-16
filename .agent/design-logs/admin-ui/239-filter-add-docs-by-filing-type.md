# Design Log 239: Filter Add-Document Dropdown by Filing Type
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-06
**Related Logs:** DL-216 (filing type scoping all tabs), DL-219 (add second filing type)

## 1. Context & Problem
The document manager has AR/CS tabs for clients with both filing types. However, the "add document" dropdown shows ALL 55 templates (33 AR + 22 CS) regardless of which tab is active. Users see irrelevant templates for the wrong filing type.

## 2. User Requirements
- Only show templates relevant to the active filing type tab
- Backend filtering (API returns `filing_type` per template, frontend filters)

## 3. Codebase Analysis
- **Airtable:** All 55 templates already have `filing_type` set (22 CS, 33 AR, 0 blank)
- **API (`documents.ts:243-256`):** Template mapping did NOT include `filing_type`
- **Frontend (`document-manager.js:606-651`):** `initDocumentDropdown()` iterated all `apiTemplates` without filtering
- **Categories:** Shared across filing types (e.g., `employment` has both AR and CS templates). Filtering at template level, not category level. Empty optgroups already hidden by `if (groupHtml)` check.

## 4. Proposed Solution

### API (1 line)
Add `filing_type` to template field mapping in `documents.ts`.

### Frontend (4 lines)
In `initDocumentDropdown()`, filter `apiTemplates` by the active report's `filing_type` before building optgroups. Fallback: templates without `filing_type` show in all tabs.

## 5. Files Changed
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/documents.ts` | Modify | Add `filing_type` to template mapping (line ~256) |
| `github/.../assets/js/document-manager.js` | Modify | Filter templates by filing type in `initDocumentDropdown()` (line ~621) |

## 6. Validation Plan
* [ ] Open document manager for AR report -> dropdown shows only T-series templates (33)
* [ ] Switch to CS tab -> dropdown shows only CS-T-series templates (22)
* [ ] Existing documents display unaffected
* [ ] Adding a doc from filtered dropdown works normally
* [ ] Single-report clients (AR only) still work correctly

## 7. Implementation Notes
- No research phase needed — straightforward data passthrough + filter
- All 55 templates already have `filing_type` in Airtable — no data migration needed
- Categories don't need filtering — `employment` category shared across both types, empty groups auto-hidden
