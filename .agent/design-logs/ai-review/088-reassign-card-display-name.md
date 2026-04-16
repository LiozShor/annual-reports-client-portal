# Design Log 088: Show Reassigned Doc Name on Reviewed Card
**Status:** [IMPLEMENTED & TESTED]
**Date:** 2026-03-04
**Related Logs:** [086-persistent-batch-review](086-persistent-batch-review.md)

## 1. Context & Problem

After DL-086 introduced persistent reviewed cards, reviewed cards display the **original AI classification name** rather than the final decision. When a document is reassigned from doc X to doc Y, the card still shows X's name. This is because `transitionCardToReviewed()` only updates `review_status` and `reviewed_at` but never merges the API response data (which includes the new doc title) into the local item.

User requirement: **reassign only** — approve and reject keep current display as-is.

## 2. User Requirements

1. **Q:** Should reassigned cards show the new doc name or original + new?
   **A:** Replace entirely — show only the new target doc name.

2. **Q:** Should approved cards update to the confirmed SSOT name from the API?
   **A:** No — keep the current AI-matched name.

3. **Q:** Should rejected cards update their display name?
   **A:** No — keep current display (original classification + rejection reason).

4. **Q:** Should the lozenge badge mention the reassign target?
   **A:** No — keep generic "שויך מחדש" lozenge; the card body shows the new name.

## 3. Research

### Domain
Client-side State Synchronization, Optimistic UI Updates

### Sources Consulted
1. **TanStack Query / SWR docs** — After mutation, apply the server response as source of truth rather than pre-calculating local state. The server response is authoritative.
2. **Nielsen Norman Group — Visibility of System Status** — Users must see that their action took effect. Showing stale data (old doc name after reassign) violates this heuristic.

### Key Principles Extracted
- **Server response = source of truth:** The API returns `doc_title` with the confirmed SSOT name. Apply it to local state rather than guessing.
- **Visibility of system status:** The card must reflect the actual decision the admin made.

### Patterns to Use
- **Mutation response merge:** After API success, merge relevant response fields into the local data item before re-rendering.

### Anti-Patterns to Avoid
- **Pre-calculating client-side:** Don't construct the new doc name locally from template ID — use `doc_title` from the API response (SSOT-generated).
- **Modifying `transitionCardToReviewed()` generically:** This function works correctly for approve/reject. Only the reassign caller needs the data merge.

### Research Verdict
Simple merge of `data.doc_title` and `templateId` into the local item in `submitAIReassign()`, before calling `transitionCardToReviewed()`. The API response is the authoritative source.

## 4. Codebase Analysis

### Relevant Files
- **`admin/js/script.js`**
  - `submitAIReassign()` (line 2607): Makes API call, gets `data` with `doc_title`, calls `transitionCardToReviewed()` at line 2650 — but never updates local item fields
  - `transitionCardToReviewed()` (line 2678): Only sets `review_status` + `reviewed_at`, then re-renders
  - `renderReviewedCard()` (line 2260): Reads `item.matched_doc_name`, `item.matched_template_id`, `item.matched_template_name` for display
  - `getCardState()` (line 1761): Uses `item.matched_template_id` — returning 'full' when template ID exists (affects re-review button set)
  - `AI_DOC_NAMES` (line 1736): Template ID → Hebrew name lookup

### Existing Patterns
- `trackReviewAction()` (line 3037) already reads `data.doc_title` for the batch email tracker — proving the API returns it
- `reassignedItem` is already fetched at line 2645 — just needs field updates added

### Alignment with Research
- Current code violates "server response = source of truth" — it ignores `doc_title` for display purposes
- Fix aligns: merge server response into local item before re-render

### Dependencies
- API response must include `doc_title` — confirmed it does (see `formatAISuccessToast` at line 2413)

## 5. Technical Constraints & Risks

- **Security:** None — no new data exposure
- **Risks:**
  - `getCardState()` reads `matched_template_id` — after update, reassigned cards will return 'full' state on re-review, showing approve/reject/reassign buttons. This is correct behavior.
  - `matched_template_name` is a fallback for `AI_DOC_NAMES[matched_template_id]` — setting both ensures display works even if template isn't in the local lookup
- **Breaking Changes:** None

## 6. Proposed Solution (The Blueprint)

### Logic Flow

In `submitAIReassign()` (line 2644-2650), after the existing `const reassignedItem = ...` line and before `transitionCardToReviewed()`:

```js
// Update local item with reassigned doc info from API response
if (reassignedItem && data.doc_title) {
    reassignedItem.matched_doc_name = data.doc_title;
    reassignedItem.matched_template_id = templateId;
    reassignedItem.matched_template_name = AI_DOC_NAMES[templateId] || '';
}
```

`transitionCardToReviewed()` then calls `renderReviewedCard()` which reads the **updated** fields → card displays the new doc name.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add 4-line data merge in `submitAIReassign()` before `transitionCardToReviewed()` |

### What About Re-Review?

After updating `matched_template_id`, `getCardState()` returns 'full' → re-review shows approve/reject/reassign buttons. If the admin re-reviews and approves, the card shows the (now-correct) doc name with blue approved lozenge. All works correctly.

## 7. Validation Plan

* [ ] Reassign doc X to doc Y → card shows Y's name (not X)
* [ ] Reassign to "new document" (__NEW__ path) → card shows the custom name
* [ ] Re-review a reassigned card → approve → card shows Y's name with blue lozenge
* [ ] Re-review a reassigned card → reject → card shows Y's name with amber lozenge
* [ ] Re-review a reassigned card → reassign again to Z → card shows Z's name
* [ ] Approve a card → card still shows original AI name (unchanged behavior)
* [ ] Reject a card → card still shows original AI name (unchanged behavior)
* [ ] Batch tracker: verify `trackReviewAction()` still records correct doc name for email

## 8. Implementation Notes (Post-Code)
- **4 lines added** in `submitAIReassign()` at line ~2646 of `admin/js/script.js`
- Merges `data.doc_title`, `templateId`, and `AI_DOC_NAMES[templateId]` into the local `reassignedItem` before `transitionCardToReviewed()` is called
- `renderReviewedCard()` then reads the updated `matched_doc_name` and displays the correct reassigned name
- No n8n, CSS, or other file changes needed
