# Design Log 190: Questionnaire Toggle — Hide "No" Answers On-Screen
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-26
**Related Logs:** DL-156 (Print Questionnaire — Skip 'No' Answers), DL-120 (Questionnaires Tab UX)

## 1. Context & Problem
The print function already filters out `✗ לא` answers (DL-156), but the on-screen questionnaire display in document-manager shows ALL answers including NOs. The user wants consistency with the print view — default to hiding NO answers, with a toggle to show them when needed.

## 2. User Requirements
1. **Q:** Where should the toggle be placed?
   **A:** Left of the print button, same toolbar row.

2. **Q:** What UI element?
   **A:** Ghost button with icon swap (same `.btn .btn-sm .btn-ghost` as print button).

3. **Q:** Should the default persist across reloads?
   **A:** No — reset each time. Default is always "hide NOs" (like printing).

4. **Q:** Label logic — show action or state?
   **A:** Label shows action (what clicking will do). Default: "הצג תשובות לא" → after click: "הסתר תשובות לא".

## 3. Research
### Domain
Filter Toggle UX, Table Row Filtering

### Sources Consulted
1. **NN/g — Toggle-Switch Guidelines** — Toggle should take effect immediately (no apply button). Labels should be short, direct, frontloaded with keywords.
2. **Smashing Magazine — Designing Filters That Work** — Good default state reflects the most common use case. Applied filters should be visible at a glance.
3. **"Don't Make Me Think" (Steve Krug)** — Minimize cognitive effort. Clear language and visual cues. Users read only as much as they think they need to.

### Key Principles Extracted
- **Immediate effect:** Toggle filters table rows instantly, no "apply" needed — our case is a single binary toggle, perfect for this.
- **Smart default:** Default hides NOs (matches print behavior, which is the common use case for office workers reviewing questionnaires).
- **Clear labeling:** Action-oriented label ("הצג תשובות לא" / "הסתר תשובות לא") with icon swap provides both textual and visual feedback.

### Research Verdict
Simple ghost button toggle with immediate re-render. No persistence needed. Aligns with existing print filtering pattern.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `document-manager.js:2135` — `answers.filter(a => a.value && a.value !== '✗ לא')` already in print function
  - `_renderQuestionnaire(container)` at line 2070 — renders all answers, needs filtering added
  - `_questionnaireData` module-level variable stores fetched data
* **Reuse Decision:** Reuse exact same filter expression from print. Add module-level flag + re-render call.
* **Relevant Files:** `document-manager.js` (JS logic), `document-manager.html` (toolbar HTML)
* **Existing Patterns:** Ghost button pattern used by print button (line 216-218). Lucide icons already loaded.

## 5. Technical Constraints & Risks
* **Security:** None — purely client-side display filter on already-fetched data.
* **Risks:** Minimal — isolated to questionnaire section, no shared state.
* **Breaking Changes:** None — default hides NOs which matches print behavior.

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. Add module-level flag `let _hideNoAnswers = true;` (default: hide)
2. In `_renderQuestionnaire()`, filter answers based on flag before rendering
3. Add `toggleHideNoAnswers()` function — flips flag, re-renders, swaps button text/icon
4. Add ghost button to HTML toolbar, left of print button

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `github/annual-reports-client-portal/assets/js/document-manager.js` | Modify | Add `_hideNoAnswers` flag, filter in `_renderQuestionnaire()`, add `toggleHideNoAnswers()` |
| `github/annual-reports-client-portal/document-manager.html` | Modify | Add toggle button left of print button in toolbar |

### Implementation Details

**document-manager.js changes:**
1. Near line 2032 (module variables): add `let _hideNoAnswers = true;`
2. In `_renderQuestionnaire()` at line 2072, after `const answers = qa.answers || [];`:
   ```js
   const displayAnswers = _hideNoAnswers
       ? answers.filter(a => a.value && a.value !== '✗ לא')
       : answers;
   ```
   Then use `displayAnswers` instead of `answers` in the forEach (line 2088).
3. New function `toggleHideNoAnswers()`:
   ```js
   function toggleHideNoAnswers() {
       _hideNoAnswers = !_hideNoAnswers;
       const btn = document.getElementById('toggleNoAnswersBtn');
       if (btn) {
           btn.innerHTML = _hideNoAnswers
               ? '<i data-lucide="eye" class="icon-sm"></i> הצג תשובות לא'
               : '<i data-lucide="eye-off" class="icon-sm"></i> הסתר תשובות לא';
           lucide.createIcons({ nodes: [btn] });
       }
       const container = document.getElementById('questionnaireContent');
       if (container && _questionnaireData) _renderQuestionnaire(container);
   }
   ```

**document-manager.html changes:**
At line 215, change the flex container to include the toggle button before the print button:
```html
<div style="display:flex; justify-content:flex-end; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4) 0;">
    <button id="toggleNoAnswersBtn" class="btn btn-sm btn-ghost" onclick="toggleHideNoAnswers()">
        <i data-lucide="eye" class="icon-sm"></i> הצג תשובות לא
    </button>
    <button class="btn btn-sm btn-ghost" onclick="printQuestionnaireFromDocManager()">
        <i data-lucide="printer" class="icon-sm"></i> הדפסה
    </button>
</div>
```

### Final Step
* **Housekeeping:** Update design log status, INDEX, current-status.md, git commit & push

## 7. Validation Plan
* [ ] Open document-manager for a client with questionnaire data
* [ ] Verify NO answers are hidden by default (button shows "הצג תשובות לא")
* [ ] Click toggle — verify all answers appear (button changes to "הסתר תשובות לא" with eye-off icon)
* [ ] Click toggle again — NOs hidden again
* [ ] Print — verify print still works independently (always hides NOs regardless of toggle)
* [ ] Reload page, reopen questionnaire — verify default is back to hidden NOs
* [ ] Verify no regression on client questions section below questionnaire

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation.*
