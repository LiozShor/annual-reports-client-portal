# Design Log 236: Cap Bulk Questionnaire Sending to 50
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-31
**Related Logs:** DL-095 (bulk send fix)

## 1. Context & Problem
The admin panel allows sending questionnaires in bulk with no upper limit. Natan could accidentally trigger hundreds of emails at once. Need to cap at 50 per batch for safety.

## 2. User Requirements
1. **Q:** Where should the limit be enforced?
   **A:** Frontend only
2. **Q:** What should happen when >50 selected?
   **A:** Cap checkbox selection at 50 (disable further checkboxes)
3. **Q:** Should "Send to All" be capped too?
   **A:** Yes, cap it at 50

## 3. Research
Skipped — straightforward UI cap, no domain complexity.

## 4. Codebase Analysis
- `sendQuestionnaires()` (script.js:1988) — central function, already chunks into 25s, no cap
- 3 callers: `sendToSelected()`, `sendToAll()`, `bulkSendQuestionnaires()`
- Pending tab: `.client-checkbox`, `toggleSelectAll()`, `updateSelectedCount()`
- Dashboard tab: `.dashboard-client-checkbox`, `toggleClientSelectAll()`, `updateClientSelectedCount()`

## 5. Technical Constraints & Risks
- No backend changes — this is purely a UX guard
- `disabled` checkboxes re-enable when user unchecks one (via `updateSelectedCount`/`updateClientSelectedCount`)

## 6. Proposed Solution
### Success Criteria
Selecting >50 clients is prevented in all bulk send paths.

### Changes
| Location | Change |
|----------|--------|
| `MAX_BULK_SEND = 50` constant | Added before `toggleSelectAll()` |
| `toggleSelectAll()` | Only checks first 50 checkboxes |
| `updateSelectedCount()` | Disables unchecked checkboxes at limit |
| `sendToAll()` | Shows warning modal if >50 pending |
| `sendQuestionnaires()` | Safety guard: rejects >50 with modal |
| `toggleClientSelectAll()` | Only checks first 50 checkboxes |
| `updateClientSelectedCount()` | Disables unchecked checkboxes at limit |

## 7. Validation Plan
* [ ] Pending tab: "Select All" with >50 clients — only 50 checked
* [ ] Pending tab: manually check 50, then try 51st — disabled
* [ ] Pending tab: uncheck one at 50 — remaining re-enabled
* [ ] "Send to All" with >50 — warning modal shown
* [ ] "Send to All" with <=50 — normal confirm dialog
* [ ] Dashboard tab: same checkbox cap behavior
* [ ] Single send still works normally
* [ ] Send <=50 batch — normal flow, emails sent

## 8. Implementation Notes
- Constant placed before first usage for readability
- Both pending tab and dashboard tab share the same `MAX_BULK_SEND` constant
- `sendQuestionnaires()` has a safety guard as defense-in-depth (in case any caller bypasses UI cap)
