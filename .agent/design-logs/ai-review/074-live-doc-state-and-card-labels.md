# Design Log 074: Live Doc State Updates & Card Labels in AI Review Panel
**Status:** [IMPLEMENTED]
**Date:** 2026-03-02
**Related Logs:** [070-guard-reassign-target-doc](070-guard-reassign-target-doc.md)

## 1. Context & Problem

**Problem 1 — Stale missingDocs:** When an admin approves/reassigns a classification, the approved doc still appears in the reassign dropdown for other classifications in the same batch. The `missing_docs` and `all_docs` arrays in `aiClassificationsData` are never updated after mutations — they remain a snapshot from the initial API load. This means:
- Reassign dropdowns show docs that were already approved moments ago
- The doc status overview (category tags at top of accordion) doesn't reflect approvals
- Inline radio lists for issuer-mismatch cards still show approved docs

**Problem 2 — No card labels:** Classification cards lack descriptive titles for their sections. The card shows an attachment name, a confidence badge, and a matched doc name, but there's no label explaining what each part represents (e.g., "original file name", "AI classification result").

## 2. User Requirements

1. **Q:** When you approve a classification and the doc becomes Received, should that doc also visually update in the document status overview?
   **A:** Yes, update both the reassign dropdown AND the doc status overview.

2. **Q:** Should this work across clients?
   **A:** Not possible — each client has their own report/docs. Same client only.

3. **Q:** Should rejecting also update anything?
   **A:** No — reject doesn't change doc status, so no update needed.

4. **Q:** What card labels/titles do you want?
   **A:** Labels like "שם המסמך המקורי" (original doc name), "ה-AI חושב שזה המסמך:" (the AI thinks this is:), etc.

## 3. Research

### Domain
Optimistic UI Updates, Client-Side State Management, Stale Closure Prevention

### Sources Consulted
1. **"Optimistic UI in Frontend Architecture"** — Update immediately on success, keep snapshot for rollback on failure. Always re-sync after mutation settles. Don't use for irreversible actions.
2. **"Build a State Management System with Vanilla JS" (CSS-Tricks)** — Mutate the data array first, then re-render affected DOM. Never let DOM be source of truth. Batch DOM writes.
3. **"Stale Closures" (DEV Community)** — Don't embed data snapshots in HTML attributes via JSON.stringify. Instead, embed only an ID and look up current data at click time from the live array.

### Key Principles Extracted
- **Data-first, DOM-second:** Update `aiClassificationsData` first, then surgically update the DOM. The global array is already the SSOT — we just need to keep it accurate.
- **Eliminate stale captures:** The current pattern of `JSON.stringify(missingDocs)` in onclick attributes freezes data at render time. Instead, read from the live array at click time.
- **Surgical DOM updates over full re-render:** Re-rendering the entire accordion would lose UI state (expanded panels, scroll position). Instead, update only the affected elements.

### Anti-Patterns to Avoid
- **Full page re-fetch after each action:** Wasteful, causes UI flash, loses state. We already have the data — just mutate it.
- **DOM as source of truth:** Don't try to find and remove `<option>` elements from dropdowns. Update the data array and re-render the dropdown when it's next opened.

### Research Verdict
After a successful approve/reassign, mutate `missing_docs` and `all_docs` in all same-client items in `aiClassificationsData`, then surgically update the doc status overview section and re-render any inline comboboxes. For the reassign modal, switch from stale onclick data to live array lookup.

## 4. Codebase Analysis

### Key File: `github/annual-reports-client-portal/admin/js/script.js`

**Global state:**
- `aiClassificationsData` (line 1259) — array of all classification items, already the SSOT
- Each item has: `missing_docs[]`, `all_docs[]`, `docs_received_count`, `docs_total_count`, `matched_doc_record_id`

**Data flow for approve:**
1. `approveAIClassification(recordId)` (line 1889) → API call → `animateAndRemoveAI(recordId)` (line 2114)
2. `animateAndRemoveAI` filters the item out of `aiClassificationsData` and removes the card DOM
3. But **other items' `missing_docs`/`all_docs` are NOT updated**

**Data flow for reassign:**
1. `submitAIReassign(recordId, templateId, docRecordId, ...)` (line 2049) → API → `animateAndRemoveAI(recordId)`
2. Same gap — sibling items not updated

**Stale data sources:**
- `showAIReassignModal(recordId, missingDocs)` (line 1996): `missingDocs` is passed from onclick attribute (stale)
- Inline comboboxes: `data-docs='${JSON.stringify(missingDocs)}'` in HTML (stale)
- Issuer-mismatch radios: built from `missingDocs.filter(...)` at render time (stale)

**Doc status overview:**
- Rendered at lines 1526-1575 inside `renderAICards()`
- HTML class: `.ai-missing-docs-group` inside each `.ai-accordion`
- Uses `clientItems[0].all_docs` or `clientItems[0].missing_docs`
- Shows category-grouped tags with `ai-doc-tag-received` or `ai-missing-doc-tag` classes

**Card layout (for labels):**
- `.ai-card-top` > `.ai-file-info` — attachment name + badges
- `.ai-card-body` > `.ai-classification-result` > `.ai-classification-label` — confidence + matched doc
- `.ai-card-actions` — buttons
- 4 states: full, issuer-mismatch, fuzzy, unmatched

### Alignment with Research
- `aiClassificationsData` is already the SSOT — good. We just need to mutate it after actions.
- The stale `JSON.stringify(missingDocs)` in onclick attributes is exactly the anti-pattern from the research. Easy fix: read from live data instead.

## 5. Technical Constraints & Risks

* **No breaking changes:** All changes are frontend-only. No backend/API changes needed.
* **Inline comboboxes (issuer-mismatch edge case):** These are initialized once at render time. After mutating data, we need to re-initialize them or they'll show stale options. Since they're filtered to same-type docs only, this is only an issue when a same-type doc is approved.
* **Card label CSS:** New label elements need RTL-friendly styling. Keep it minimal — no new CSS classes if existing ones work.

## 6. Proposed Solution (The Blueprint)

### Part 1: Live Doc State Updates

**A. New helper function: `updateClientDocState(clientName, docRecordId)`**

Called after successful approve or reassign (before `animateAndRemoveAI`). Does:
1. Iterate all items in `aiClassificationsData` with matching `clientName`
2. For each item:
   - Remove the doc from `missing_docs` (filter by `doc_record_id`)
   - Update status in `all_docs` to `'Received'` (find by `doc_record_id`, set `status = 'Received'`)
   - Increment `docs_received_count`
3. Re-render the doc status overview for the affected accordion:
   - Find `.ai-accordion[data-client="${clientName}"]`
   - Find its `.ai-missing-docs-group`
   - Rebuild the category-grouped HTML from updated `all_docs`/`missing_docs`
   - Replace innerHTML
4. Re-render inline comboboxes for remaining cards of the same client:
   - Find all `.doc-combobox-container[data-record-id]` inside the accordion
   - Update their `data-docs` attribute with the new `missing_docs`
   - Re-initialize comboboxes
5. Re-render issuer-mismatch radio lists:
   - Find all `.ai-comparison-radio-list` inside the accordion
   - For each, rebuild the radio list from the updated item's `missing_docs`

**B. Wire into approve flow (line ~1910):**
```javascript
// Before animateAndRemoveAI:
const item = aiClassificationsData.find(i => i.id === recordId);
if (item?.matched_doc_record_id) {
    updateClientDocState(item.client_name, item.matched_doc_record_id);
}
animateAndRemoveAI(recordId);
```

**C. Wire into reassign flow (line ~2087):**
```javascript
// Before animateAndRemoveAI:
const item = aiClassificationsData.find(i => i.id === recordId);
if (docRecordId) {
    updateClientDocState(item?.client_name, docRecordId);
}
animateAndRemoveAI(recordId);
```

**D. Fix stale modal data — `showAIReassignModal` (line 1996):**

Change from receiving `missingDocs` parameter to reading from live data:
```javascript
function showAIReassignModal(recordId) {
    const item = aiClassificationsData.find(i => i.id === recordId);
    const missingDocs = item?.missing_docs || [];
    // ... rest unchanged
}
```

Update all onclick attributes to remove the missingDocs argument:
```javascript
onclick="showAIReassignModal('${escapeAttr(item.id)}')"
```
(6 occurrences across all 4 card states)

### Part 2: Card Labels

Add descriptive Hebrew labels to card sections:

| Section | Current | Proposed Label |
|---------|---------|---------------|
| File name (top) | Just the filename | `📎 קובץ מקור:` prefix |
| Confidence badge | Just `87%` | `רמת ביטחון של AI:` prefix before percentage |
| Classification result (matched) | Doc name after confidence | `🤖 זיהוי:` prefix before doc name |
| Issuer-mismatch type line | `סוג מסמך:` (already exists) | Keep as-is |
| Unmatched state | `לא זוהה` | Keep as-is |

Minimal labels — just enough for clarity without cluttering.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `github/.../admin/js/script.js` | Modify | Add `updateClientDocState()`, wire into approve/reassign, fix modal stale data, add card labels |

## 7. Validation Plan

* [ ] Approve a classification → same client's remaining cards show updated dropdown (approved doc removed)
* [ ] Approve a classification → doc status overview updates (tag changes from missing to received, counter increments)
* [ ] Reassign a classification → target doc removed from other cards' dropdowns
* [ ] Issuer-mismatch card: approve one same-type doc → radio list in sibling card shrinks
* [ ] Reassign modal: open after approving → shows fresh missing_docs (not stale)
* [ ] Card labels visible and properly styled in RTL
* [ ] No regression: approve/reject/reassign still work as before

## 8. Implementation Notes (Post-Code)
* *TBD*
