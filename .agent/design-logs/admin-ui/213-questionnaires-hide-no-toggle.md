# Design Log 213: Questionnaires Tab — Hide NO Answers Toggle
**Status:** [DRAFT]
**Date:** 2026-03-28
**Related Logs:** DL-125 (questionnaires actions), DL-200 (document-manager UX)

## 1. Context & Problem
The document-manager questionnaire view has a toggle to hide "✗ לא" answers (default: hidden). The admin "שאלונים שהתקבלו" tab shows ALL answers including "✗ לא" rows, which adds clutter. User wants the same toggle behavior here.

## 2. User Requirements
1. **Q:** Global toolbar toggle or per-row toggle?
   **A:** Global toolbar toggle — one button affects all expanded detail views.
2. **Q:** Persist toggle state across tab switches?
   **A:** No — reset to default (hide NO) each time.
3. **Q:** Same filter logic as document-manager (`value === '✗ לא'`)?
   **A:** Yes — exact same filter.

## 3. Research
Skipped — this is a direct pattern replication from an existing feature in the same codebase.

## 4. Codebase Analysis
* **Existing Solution:** `document-manager.js:2163-2274` — `_hideNoAnswers` flag, `toggleHideNoAnswers()` function, filters `a.value !== '✗ לא'`
* **Reuse Decision:** Replicate the same pattern (global flag + filter in render). Not extracting a shared module since the two files are independent (admin vs client-facing).
* **Target file:** `admin/js/script.js` — `buildQADetailHTML()` at line 5712
* **Toggle placement:** Inside `.questionnaire-filter-bar` (line 676), next to the search input

## 5. Technical Constraints & Risks
* **Security:** None — cosmetic UI toggle, no data changes
* **Risks:** None — additive change, no existing behavior modified
* **Breaking Changes:** None

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. Add `let qaHideNoAnswers = true;` global state variable
2. Add toggle button in the questionnaire filter bar
3. Modify `buildQADetailHTML()` to filter answers based on `qaHideNoAnswers`
4. Toggle function: flip state, update button text/icon, re-render all currently open detail rows

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add `qaHideNoAnswers` flag, `toggleQaHideNoAnswers()` function, filter in `buildQADetailHTML()` |
| `admin/index.html` | Modify | Add toggle button in `.questionnaire-filter-bar` |

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status.md

## 7. Validation Plan
* [ ] Toggle button visible in questionnaires tab filter bar
* [ ] Default state: NO answers hidden, button shows "הצג תשובות לא"
* [ ] Click toggle: NO answers appear, button shows "הסתר תשובות לא"
* [ ] Toggle applies to all expanded questionnaire detail rows
* [ ] Switching tabs resets toggle to default (hide NO)
* [ ] Icons (eye/eye-off) render correctly via lucide

## 8. Implementation Notes (Post-Code)
*TBD*
