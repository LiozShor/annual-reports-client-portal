# Design Log 239: Cross-Filing-Type Reassign in AI Review
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-06
**Related Logs:** DL-238 (Unified AI Review Tab), DL-224 (Reassign Conflict Resolution)

## 1. Context & Problem
DL-238 made the AI Review tab show both AR and CS classifications together. The reassign modal currently only shows documents from the classification's own report (same filing type). When a document is misclassified to the wrong filing type (e.g., AR doc classified as CS), Natan needs to reassign it to a doc in the OTHER filing type's report — currently impossible.

## 2. User Requirements
1. **Q:** Should reassign support cross-filing-type (AR → CS, CS → AR)?
   **A:** Yes, enable cross-type reassign.
2. **Q:** Should the selector default to the card's filing type?
   **A:** Ask only when client has both filing types (both reports active).
3. **Q:** What should the filing type selector look like?
   **A:** Toggle buttons above combobox (דו"ש / הצה"ה).
4. **Q:** If client only has one filing type, show selector?
   **A:** Hide selector, show docs directly (same as today).

## 3. Research
### Domain
Progressive Disclosure, Toggle Button UX

### Sources Consulted
1. **NN/g — Toggle Switch Guidelines** — Toggles should deliver immediate results; use them to switch between two mutually exclusive states.
2. **IxDF — Progressive Disclosure** — Show users what they need when they need it; hide complexity behind clear affordances.
3. **DL-238 research** (cumulative) — Unified views with inline badges for category distinction.

### Key Principles Extracted
- Toggle buttons are appropriate for switching between two mutually exclusive views of the same data type (AR docs vs CS docs).
- Progressive disclosure: hide the toggle when there's only one option (single filing type clients).
- Immediate feedback: switching the toggle should instantly rebuild the dropdown.

### Research Verdict
Simple toggle above the combobox. Default to the card's own filing type. Hide when single-type client. Frontend-driven switching using data already available from the API.

## 4. Codebase Analysis
* **Existing:** `showAIReassignModal()` (script.js:3669) uses `item.all_docs` from the classification's own report.
* **Combobox:** `createDocCombobox()` (script.js:2262) accepts a `docs` array and renders grouped options. Already supports rebuild.
* **API GET:** Each item includes `all_docs` scoped to its report. Need to add `other_report_docs`, `other_report_id`, `other_filing_type`.
* **API POST (reassign):** Path 1 (direct `doc_record_id`) works cross-report already. Path 2 (create new doc) uses `reportId` from classification — needs `target_report_id` param for cross-type.
* **`FILING_TYPE_LABELS`** (script.js:18) already has Hebrew labels.

## 5. Technical Constraints & Risks
* **Security:** None — same auth, same data, just showing docs from sibling report.
* **Risks:** If `docsByReport` has no entry for the sibling report (no docs yet), `other_report_docs` will be empty — toggle button shows but combobox is empty. This is correct (client has no docs in that filing type yet).
* **Breaking Changes:** None — `other_report_docs` is additive; frontend degrades gracefully if missing.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Natan can reassign a document to the other filing type's doc list from the AI Review reassign modal.

### Logic Flow
1. API GET: Build `clientToReports` map from classifications → for each item, find sibling report → include `other_report_docs`
2. Frontend: If `item.other_report_docs?.length > 0`, show toggle. Default = item's filing type.
3. Toggle click → `createDocCombobox()` with the selected type's doc list.
4. On confirm: `doc_record_id` is always passed (combobox provides it). POST handler Path 1 works cross-report.
5. For "create new doc": pass `target_report_id` in POST body when toggle is on the other type.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | GET: add `other_report_*` fields; POST: accept `target_report_id` |
| `github/annual-reports-client-portal/admin/js/script.js` | Modify | Toggle UI in reassign modal, combobox rebuild on toggle |
| `github/annual-reports-client-portal/admin/css/style.css` | Modify | Toggle button styles |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, current-status, git commit & push

## 7. Validation Plan
* [ ] Client with only AR: no toggle shown, reassign works as before
* [ ] Client with AR+CS: toggle shown, defaults to card's filing type
* [ ] Toggle switch rebuilds combobox with other filing type's docs
* [ ] Reassign to a doc in the OTHER filing type succeeds
* [ ] "Create new doc" in other filing type creates doc in correct report
* [ ] Same-type reassign still works (regression)
* [ ] Path 1 (direct doc ID) used for all cross-type reassigns

## 8. Implementation Notes (Post-Code)
- API builds `clientToReports` map from classification records (not a separate Airtable query) — no extra API calls.
- Sibling report lookup uses IIFE spread in response object to keep the code clean.
- `aiReassignSelectedReportId` global tracks the currently selected report for cross-type "create new doc" path.
- `submitAIReassign` now accepts optional 7th param `targetReportId`.
- Toggle container added to `index.html` with `display:none` by default — JS shows it when needed.
