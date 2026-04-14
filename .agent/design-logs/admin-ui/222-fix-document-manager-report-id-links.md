# Design Log 222: Fix Document Manager report_id → client_id Links
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-29
**Related Logs:** DL-208 (document-manager-client-switcher), DL-089 (SEC-004 remove PII from URLs)

## 1. Context & Problem
DL-208 switched the document-manager page to use `client_id` instead of `report_id` for multi-report tab support. However, several link sources still generate the old `?report_id=` URL pattern. The office email sent by workflow "שאלון שנתי התקבל" contains a broken "עריכת רשימה" (Edit List) button that opens `document-manager.html?report_id=recXXX` — which now shows the "Not Started" state instead of loading the client's documents.

## 2. User Requirements
1. **Q:** Should we remove report_id backward compat from document-manager.js?
   **A:** Yes — make client_id the ONLY accepted parameter.
2. **Q:** Fix all 3 admin panel links (AI review + 2 nav functions)?
   **A:** Fix all 3. If client_id missing, don't navigate.
3. **Q:** Update view-documents.html link too?
   **A:** No — different page, uses report_id by design.

## 3. Research
Skipped — straightforward URL parameter migration with no architectural complexity.

## 4. Codebase Analysis
**Old links found in active code:**
1. n8n `[SUB] Document Service` → Generate HTML node, line 72: `editUrl` with `report_id`
2. `workflow-processor-n8n.js:830` — local JS copy, same `editUrl`
3. `script.js:2674` — AI review accordion doc-manager icon
4. `script.js:5400` — `viewClientDocs()` fallback
5. `script.js:6515` — `navigateToDocManager()` fallback
6. `document-manager.js:124-130` — backward compat branch for `report_id`

**Not changed (by design):**
- `view-documents.html?report_id=` links — separate client-facing page
- `approveUrl` with `report_id` — API endpoint parameter, not document-manager

## 5. Technical Constraints & Risks
* **Data availability:** `client_id` is already passed through the n8n pipeline (Extract & Map → Document Service → Generate HTML via `input.client_id`)
* **Risk:** If any AI review items lack `client_id`, the doc-manager button won't render. Acceptable — all current data has `client_id`.
* **Breaking change:** Old bookmarked/cached `?report_id=` URLs will show "Not Started" state. No crash, just empty.

## 6. Proposed Solution

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| n8n `[SUB] Document Service` (hf7DRQ9fLmQqHv3u) | Modify | Generate HTML: add `clientId`, change `editUrl` to `client_id` |
| `n8n/workflow-processor-n8n.js` | Modify | `buildActionButtonsHTML`: add `clientId` param, fix `editUrl` |
| `admin/js/script.js` | Modify | 3 places: AI review accordion + 2 nav functions |
| `assets/js/document-manager.js` | Modify | Remove `report_id` param reading + backward compat branch |

## 7. Validation Plan
* [ ] Trigger test questionnaire → office email "עריכת רשימה" button has `?client_id=`
* [ ] Click edit button → document-manager loads with correct client tabs
* [ ] Admin → AI review → accordion doc-manager icon → opens with `?client_id=`
* [ ] Admin → Dashboard → "View Docs" → navigates with `?client_id=`
* [ ] Old `?report_id=` URL → shows "Not Started" (no crash/error)
* [ ] Admin → Questionnaires tab → "ניהול מסמכים" → navigates with `?client_id=`
* [x] Client switcher dropdown → pick different client → URL has `?client_id=` (not `report_id`)
* [x] Client switcher → new client's documents load correctly
* [x] Client switcher → current client highlighted in dropdown

## 8. Implementation Notes
- n8n workflow updated via REST API PUT (code too large for MCP `n8n_update_partial_workflow`)
- `input.client_id` was already available in Generate HTML via trigger data spread (`...triggerData` in Merge Config)
- Kept `REPORT_ID` variable removed from document-manager.js entry point, but `loadDocuments(reportId)` function still exists internally (used by `loadClientReports` after selecting a report)
- **2026-03-31 — Missed: client switcher section (lines 3034-3249).** The entire switcher combobox still used `report_id` for matching current client, rendering options, and navigation. Fixed: renamed all `report_id` → `client_id` in switcher (10 edits). `_switcherNavigate()` now sets `?client_id=` in URL. Dashboard API already returned `client_id` per client — no backend changes needed.
