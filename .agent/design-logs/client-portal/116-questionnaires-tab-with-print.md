# Design Log 116: Admin Portal — Questionnaires Tab with Print
**Status:** [IMPLEMENTED]
**Date:** 2026-03-08

## What was built

### n8n: [SUB] Format Questionnaire (`9zqfOuniztQc2hEl`)
- Execute Workflow Trigger → Format Q&A Code node
- Extracts `client_info`, builds `answers[]` (skip hidden/empty), reorders insurance fields after withdrawal anchor
- Output: `{ client_info, answers: [{label, value}...], raw_answers }`

### n8n: [API] Admin Questionnaires (`V39pd6kISSIhyKsv`)
- POST `/admin-questionnaires` + bearer auth
- Airtable `tblxEox8MsbliwTZI` filtered by year → sub-workflow → `{ ok, items[], count }`
- Full CORS headers, active

### Frontend (admin panel)
- New "שאלונים" tab button with count badge
- Tab content: year filter, search, bulk bar, expandable table with Q&A detail rows
- Print window: standalone RTL HTML, CSS @page, page break per client
- CSS: stats bar, bulk bar (floating), expand toggle, zebra Q&A table, amber client questions

## Key decisions
- **WF[02] not refactored** — Doc Service generates HTML; sub-workflow generates structured data. Different consumers, different formats.
- **Insurance field ordering** — `חברת ביטוח - קרן השתלמות/פנסיה/קופת גמל` reordered after `סוג כספים שנמשכו`

## Files changed
- n8n: 2 new workflows (IDs above), `docs/workflow-ids.md` updated
- `admin/index.html`: tab button + `#tab-questionnaires` div
- `admin/js/script.js`: ~260 lines added + switchTab updated
- `admin/css/style.css`: ~200 lines added
**Related Logs:** DL-110 (Questions for Client), DL-102 (scrollable tables), DL-097 (floating bulk bars)

## 1. Context & Problem
Office staff have no way to view submitted questionnaire responses from the admin panel. Item 7.3 from Natan's meeting. Also: insurance company fields need reordering (after withdrawal type). User wants Q&A logic extracted from WF[02] into a shared sub-workflow to avoid duplication.

## 2. User Requirements
1. **Q:** What data should each questionnaire show?
   **A:** Exactly like the "שאלון שנתי התקבל" email in WF[02].

2. **Q:** What does "Natan's Q&A annotations" mean?
   **A:** Same as DL-110 (`client_questions` feature).

3. **Q:** Print layout?
   **A:** One page per client, clean standalone document.

4. **Q:** Scope/filter?
   **A:** Current year, submitted only.

5. **Q:** Shared Q&A approach?
   **A:** Sub-workflow — `[SUB] Format Questionnaire` called by both WF[02] and new admin API.

6. **Q (from user):** Move insurance fields after withdrawal type?
   **A:** Yes — חברת ביטוח fields right after סוג כספים שנמשכו.

## 3. Research
### Domain
Print Stylesheets, Bulk Action UX, Expandable Data Tables

### Sources Consulted
1. **Print CSS** (customjs.space, 618media, paperplane.app) — `@media print`, `page-break-before: always` per client, `@page { margin: 15mm }`.
2. **Bulk Selection UX** (HashiCorp Helios, PatternFly) — Checkbox column + floating bar. Print in new window.
3. **Expandable Tables** (Adrian Roselli) — `<td colspan>` detail rows, `aria-expanded`, event delegation.

### Key Principles
- Print in new window (not `window.print()` on app page)
- Lazy detail rendering (data in memory, DOM on demand)
- `page-break-before: always` per client section
- No virtual scroll needed for 500 rows

### Patterns to Use
- Floating bulk bar (existing pattern)
- Checkbox multi-select (existing pattern)
- Table scroll container (existing pattern)
- Sub-workflow for shared logic (existing n8n pattern)

### Anti-Patterns to Avoid
- Don't `window.print()` on admin page (too many elements)
- Don't pre-render all detail rows on load
- Don't duplicate Q&A logic across WF[02] and admin tab

## 4. Codebase Analysis
### Existing Solutions Found
- **WF[02] `buildQuestionnaireTable()`** — exact rendering logic in `tmp/generate-html.js`
- **`formatAnswerValue()`** — value formatting (booleans, arrays, nulls)
- **HIDDEN_FIELD_LABELS/KEYS** — system field filtering
- **Floating bulk bar CSS** — `.client-bulk-actions`, `.reminder-bulk-actions`
- **Checkbox multi-select** — `toggleSelectAll()`, `updateSelectedCount()`

### Reuse Decision
- **Extract Q&A logic** to `[SUB] Format Questionnaire` sub-workflow (shared by WF[02] + admin API)
- **Frontend patterns**: Copy existing tab/table/checkbox/floating-bar patterns
- **DL-110 data**: Join via `report_record_id` in Build Response

### Dependencies
- Airtable: `תשובות שאלון שנתי` (tblxEox8MsbliwTZI), `annual_reports` (tbls7m3hmHC4hhQVy)
- Auth: `[Admin] Auth & Verify` (REInXxiZ-O6cxvldci3co)
- WF[02] refactor: careful not to break email notification

## 5. Technical Constraints & Risks
* **WF[02] regression risk**: Refactoring to use sub-workflow must preserve exact email output
* **Airtable pagination**: 100-record limit — sub-workflow handles single records, API handles batching
* **Field ordering**: Custom ordering map for insurance↔withdrawal block

## 6. Proposed Solution
See plan file for full details. Summary:

1. **`[SUB] Format Questionnaire`** — shared sub-workflow for Q&A extraction + formatting + field ordering
2. **WF[02] refactor** — call sub-workflow, simplify generate-html.js
3. **`[API] Admin Questionnaires`** — webhook that fetches + formats via sub-workflow + joins with annual_reports
4. **Admin HTML** — new tab button + content panel + floating bar
5. **Admin JS** — load, render table, expand/collapse, search, multi-select, print
6. **Admin CSS** — detail row, Q&A table, bulk bar styles
7. **Print window** — standalone RTL HTML, page-break per client

## 7. Validation Plan
* [ ] Sub-workflow returns correct structured Q&A data
* [ ] WF[02] still sends correct office email (no regression)
* [ ] Insurance fields appear after withdrawal type
* [ ] New "שאלונים" tab visible and loads data
* [ ] Table shows: name, spouse, date, docs progress, stage
* [ ] Expand shows full Q&A in WF[02] format
* [ ] Hidden fields not shown, booleans formatted
* [ ] Client questions (DL-110) shown when present
* [ ] Search filter works
* [ ] Multi-select + floating bar + print works
* [ ] Print: new window, one page per client, clean layout
* [ ] CORS headers on webhook
* [ ] Year filter works
* [ ] Empty state for no data

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation.*
