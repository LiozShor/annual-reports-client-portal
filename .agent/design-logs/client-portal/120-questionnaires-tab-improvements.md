# Design Log 120: Questionnaires Tab — UX Improvements
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-08
**Related Logs:** DL-116 (original questionnaires tab), DL-102 (scrollable tables), DL-097 (floating bulk bars)

## 1. Context & Problem
The questionnaires tab (built in DL-116) works but has several UX issues:
- Table grows infinitely long when many questionnaires exist
- All accordions can open simultaneously, cluttering the view
- Question count and hidden question indicators add visual noise without value
- No quick way to navigate to a client's document-manager
- No way to print a single questionnaire without selecting it first
- Year dropdown includes irrelevant years (2023–2024)
- Client name isn't interactive

## 2. User Requirements
1. **Q:** Clicking client name should...?
   **A:** Expand/collapse the accordion row (same as chevron).

2. **Q:** Where should doc-manager button appear?
   **A:** In the table row (icon button).

3. **Q:** Year options?
   **A:** Dynamic: 2025 through current year.

4. **Q:** Where should individual print icon appear?
   **A:** In the table row (icon button).

## 3. Research
### Domain
Accordion UX, Scrollable Data Tables, Bulk Action Bars

### Sources Consulted
1. **W3C WAI APG: Accordion Pattern** — `aria-expanded`, `aria-controls`, keyboard nav (Enter/Space toggle)
2. **NNGroup: Accordions on Desktop** — Single-open is acceptable when sections are independent (each client is a discrete entity); add visual expand/collapse indicator
3. **Adrian Roselli: Fixed Table Headers** — Scrollable container with `tabindex="0"`, `role="region"`, `aria-labelledby`; sticky `<thead>` with background color
4. **Emplifi Soul / PatternFly: Bulk Action Bar** — Float bottom, count + actions + X to dismiss

### Key Principles
- Single-open accordion is OK here because each questionnaire is independent (no cross-reference need)
- Scrollable containers need `tabindex="0"` + `role="region"` for keyboard accessibility
- Sticky headers must have opaque background to prevent text overlap during scroll
- Clickable names should have cursor:pointer and hover feedback

### Patterns to Use
- **Existing `.table-scroll-container`** — already in codebase with sticky headers, max-height calc, accessibility attrs
- **Existing floating bulk bar** — already implemented in this tab

### Anti-Patterns to Avoid
- Don't use `display:block` on table elements for scroll (breaks column alignment)
- Don't add `overflow:hidden` to card containers (kills sticky)

### Research Verdict
Reuse existing `.table-scroll-container` pattern. Modify `toggleQuestionnaireDetail()` to auto-close siblings. Simple changes, no architectural risk.

## 4. Codebase Analysis
### Existing Solutions Found
- **`.table-scroll-container`** (`style.css:281-314`) — max-height calc, overflow-y auto, sticky headers, accessibility attrs. Used in dashboard, send, review, reminders tabs.
- **`toggleQuestionnaireDetail()`** (`script.js:5230-5245`) — currently allows multi-open. Simple to add sibling-close logic.
- **Document-manager navigation** (`script.js:4587-4588`) — pattern: `window.location.href = '../document-manager.html?report_id=${encodeURIComponent(reportId)}'`
- **`printQuestionnaires()`** (`script.js:5273-5467`) — existing bulk print in new window. Can extract core logic for single-item print.

### Reuse Decision
- Reuse `.table-scroll-container` CSS class as-is
- Reuse document-manager navigation pattern
- Extract `generatePrintHTML(items)` from existing `printQuestionnaires()` for shared use
- Reuse floating bulk bar (already in place)

### Files to Modify
| File | Lines | What |
|------|-------|------|
| `admin/index.html` | 634-680 | Remove 2023/2024 year options; wrap table in scroll container |
| `admin/js/script.js` | 5034-5479 | All 9 changes below |
| `admin/css/style.css` | 4138+ | Clickable name styles, action cell styles |

## 5. Technical Constraints & Risks
* **No backend changes** — all changes are frontend only
* **Low risk** — no API changes, no data model changes
* **colspan change** — detail row colspan must change from 6 to 5 (removing question count column)
* **Print extraction** — must preserve existing bulk print behavior exactly

## 6. Proposed Solution (The Blueprint)

### Changes

#### 1. Clickable client name → expand accordion
- In `renderQuestionnairesTable()`: wrap name cell content in a `<span class="qa-client-link">` with `onclick="toggleQuestionnaireDetail('${id}')"`
- CSS: `cursor: pointer`, brand color on hover

#### 2. Remove question count column
- Remove `<th>מספר שאלות</th>` from table header
- Remove the `<td>` with `answersCount` and `hasClientQuestions` indicator
- Update detail row `colspan` from 6 to 5

#### 3. Remove hidden questions indicator
- Already handled by removing the question count column (❓ icon was in that column)

#### 4. Scrollable table container
- Wrap `#questionnaireTableContainer` contents in `<div class="table-scroll-container" role="region" tabindex="0" aria-label="טבלת שאלונים">`
- The existing CSS class handles max-height, overflow, sticky headers

#### 5. Single accordion open at a time
- In `toggleQuestionnaireDetail()`: before opening a new detail row, close all other open detail rows and remove `.expanded` from their toggle buttons

#### 6. Dynamic years (2025+)
- Remove hardcoded `<option>` elements from HTML
- In JS (on page load or before first load): dynamically populate the year dropdown from 2025 to `new Date().getFullYear()`, defaulting to current year

#### 7. Document-manager button per row
- Add a new action icon in each row: `<button class="btn-icon" onclick="..." title="ניהול מסמכים"><i data-lucide="folder-open"></i></button>`
- Opens `../document-manager.html?report_id=${reportId}`

#### 8. Individual print icon per row
- Add a printer icon button in each row: `<button class="btn-icon" onclick="printSingleQuestionnaire('${id}')" title="הדפסה"><i data-lucide="printer"></i></button>`
- New function `printSingleQuestionnaire(id)` — finds the item in `questionnairesData`, calls shared print logic

#### 9. Refactor print into shared function
- Extract `generateQuestionnairePrintHTML(items)` from `printQuestionnaires()`
- `printQuestionnaires()` calls it with selected items (bulk)
- `printSingleQuestionnaire(id)` calls it with a single item

### Table Column Layout (after changes)
| # | Header | Width | Content |
|---|--------|-------|---------|
| 1 | Checkbox | 36px | Select checkbox |
| 2 | שם לקוח | auto | Clickable name (expands accordion) |
| 3 | בן/בת זוג | auto | Spouse name |
| 4 | תאריך הגשה | auto | Submission date |
| 5 | (no header) | ~120px | Doc-manager + Print + Expand icons |

### Logic Flow
1. Page loads → populate year dropdown dynamically (2025..currentYear)
2. Tab switch → `loadQuestionnaires()` fetches data
3. Render table with new column layout (no question count, actions column)
4. Click client name or chevron → `toggleQuestionnaireDetail(id)` auto-closes others, opens clicked
5. Click folder icon → navigate to document-manager
6. Click printer icon → `printSingleQuestionnaire(id)` opens print window
7. Select checkboxes → floating bar appears with print-all button + X cancel

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/index.html` | Modify | Remove 2023/2024 options, wrap table in scroll container |
| `admin/js/script.js` | Modify | All JS changes (~9 modifications) |
| `admin/css/style.css` | Modify | Clickable name styles, action cell |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Client name is clickable and expands the accordion
* [ ] Question count column is removed
* [ ] Hidden question indicator (❓) is removed
* [ ] Table is scrollable with sticky headers (doesn't extend page infinitely)
* [ ] Only one accordion open at a time (opening one closes others)
* [ ] Year dropdown shows only 2025+ dynamically
* [ ] Document-manager icon navigates correctly
* [ ] Individual print icon opens print window for single client
* [ ] Bulk print still works (select multiple → print)
* [ ] Floating bar X button cancels selection
* [ ] Search filter still works
* [ ] Empty state still displays correctly
* [ ] No visual regressions in other tabs

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation.*
