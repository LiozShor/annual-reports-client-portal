# Design Log 156: Print Questionnaire — Skip "No" Answers
**Status:** [DRAFT]
**Date:** 2026-03-16
**Related Logs:** DL-116 (questionnaires tab with print), DL-120 (questionnaires tab improvements)

## 1. Context & Problem
When printing questionnaires (from document-manager or questionnaires tab), all Q&A rows are printed including questions where the answer is "no" (✗ לא). These rows add clutter without informational value — the office only needs to see what the client *has* (positive/descriptive answers), not what they don't have.

## 2. User Requirements
1. **Q:** Filter only '✗ לא' or also empty values?
   **A:** Both '✗ לא' and empty values.

2. **Q:** Apply to on-screen display too or print only?
   **A:** Print only. On-screen Q&A tables remain unchanged.

3. **Q:** Apply to bulk print (select multiple → print)?
   **A:** Yes, same filtering everywhere — all print paths.

4. **Q:** Apply to client portal view-documents?
   **A:** N/A — clients don't see questionnaire Q&A in the portal.

## 3. Research
### Domain
Print optimization, form response display

### Key Principles Extracted
- Print layouts should maximize information density — omitting null/negative answers saves paper and reading time
- Screen vs print can diverge — screen shows complete data for verification, print shows actionable data
- Filtering should be deterministic and match what users expect (no surprises)

### Research Verdict
Simple filter at render time (print HTML generation). No changes to data source or on-screen display.

## 4. Codebase Analysis
### Existing Solutions Found
- `[SUB] Format Questionnaire` (n8n, `9zqfOuniztQc2hEl`) — `formatAnswerValue()` converts boolean/string "no"/"לא" to `'✗ לא'`. Empty values return `null` and are already excluded from the answers array.
- So the only value to filter in print is `'✗ לא'`. Empty values are already stripped at the source.

### Two Print Locations
1. **`document-manager.js:1915`** — `printQuestionnaireFromDocManager()` — uses `answers.map()` to build `<tr>` rows
2. **`admin/js/script.js:5657-5671`** — `generateQuestionnairePrintHTML()` — uses `answers.forEach()` to build `<tr>` rows. Shared by `printQuestionnaires()` and `printSingleQuestionnaire()`.

### On-Screen Display (NOT touched)
- `document-manager.js:1861` — `_renderQuestionnaire()` — on-screen panel
- `admin/js/script.js:5436` — `buildQADetailHTML()` — accordion rows

## 5. Technical Constraints & Risks
* **Security:** None — pure cosmetic change in print output
* **Risks:** Minimal — filtering only affects print window HTML, no data mutation
* **Breaking Changes:** None

## 6. Proposed Solution (The Blueprint)
### Logic
Add a filter before rendering answer rows in both print functions. Filter condition: skip rows where `value` is `'✗ לא'` or falsy (empty/null/undefined).

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `github/annual-reports-client-portal/assets/js/document-manager.js` | Modify | Filter `answers` before `.map()` in `printQuestionnaireFromDocManager()` |
| `github/annual-reports-client-portal/admin/js/script.js` | Modify | Filter `answers` before `.forEach()` in `generateQuestionnairePrintHTML()` |

### Detailed Changes

**document-manager.js** (~line 1915):
```js
// Before:
let rows = answers.map((a, i) => `<tr>...`).join('');

// After:
const printAnswers = answers.filter(a => a.value && a.value !== '✗ לא');
let rows = printAnswers.map((a, i) => `<tr>...`).join('');
```

**admin/js/script.js** (~line 5657-5664):
```js
// Before:
if (answers.length > 0) {
    printHtml += `<table>...`;
    answers.forEach(({ label, value }) => { ... });

// After:
const printAnswers = answers.filter(a => a.value && a.value !== '✗ לא');
if (printAnswers.length > 0) {
    printHtml += `<table>...`;
    printAnswers.forEach(({ label, value }) => { ... });
```

### Final Step
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`

## 7. Validation Plan
* [ ] Open document-manager for a client with mixed yes/no answers → print → verify "no" rows are gone
* [ ] Open questionnaires tab → single print (printer icon) → verify "no" rows are gone
* [ ] Questionnaires tab → select multiple → bulk print → verify "no" rows are gone
* [ ] Verify on-screen display (doc-manager panel + questionnaires accordion) still shows all answers including "no"
* [ ] Edge case: client with ALL "no" answers → print should show empty table or just header info

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation.*
