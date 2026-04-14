# Design Log 058: Add New Custom Document from AI Review Reassign
**Status:** [IMPLEMENTED]
**Date:** 2026-02-25
**Related Logs:** 039 (Searchable Categorized Doc Dropdown), 054 (Inline Stage Advancement), 057 (Disable Approve for Unrequested Docs)

## 1. Context & Problem

When reviewing AI-classified documents, the admin sometimes encounters a document that doesn't match any of the client's existing needed-docs. Currently the only options are to reassign to an existing document or reject. The admin wants to **create a new custom document on the fly** during reassign, without leaving the AI review page.

The document-manager page already has a "מסמך מותאם אישית" feature using `template_id: 'general_doc'`. This feature should reuse the same convention.

## 2. User Requirements

1. **Q:** Template pool for new doc?
   **A:** It's a general/freeform doc — admin types a custom name (not picking from templates).

2. **Q:** UI placement?
   **A:** Button in combobox — a "+ הוסף מסמך חדש" option at top/bottom of the existing dropdown.

3. **Q:** Fields for the new doc?
   **A:** Fully named by the user — admin types the name.

4. **Q:** API design (single or two-step)?
   **A:** Single call — backend creates doc AND reassigns atomically.

5. **Q:** UX flow after clicking "add new"?
   **A:** Inline text input — combobox transforms into a text input where admin types the name.

6. **Q:** template_id for the new doc?
   **A:** `general_doc` — same as existing custom doc feature in document-manager.

7. **Q:** Available in modal only or also inline combobox?
   **A:** Both — must align with document-manager's "מסמך מותאם אישית" pattern.

## 3. Research

### Domain
Form Design, Inline Creation Patterns, Combobox UX

### Sources Consulted
1. **"Don't Make Me Think" — Steve Krug** — "Mindless, unambiguous choices": each click should be obvious. The "+ add new" option must be visually distinct from regular doc options so admin doesn't confuse it with a selection.
2. **Select2 Tagging / React-Select Creatable** — Established pattern: a special option at bottom of dropdown that creates from the search text or opens a creation flow. Users expect this at the end of the list.
3. **Smashing Magazine "Combobox vs. Multiselect"** — Combobox is optimal for large lists with search. Adding a "create" affordance at a fixed position (top or bottom) maintains scannability.

### Key Principles Extracted
- **Obvious affordance**: The "add new" button must look different from regular options (color, icon, separator)
- **Reversible**: Admin should be able to cancel back to the regular combobox without losing state
- **Consistent convention**: Reuse `general_doc` template_id from document-manager — same backend, same Airtable pattern

### Patterns to Use
- **Creatable Combobox:** Fixed "+ add new" option at top of dropdown, separated by a visual divider
- **Mode Toggle:** Clicking "add new" transforms combobox into text input; a cancel link returns to list mode

### Anti-Patterns to Avoid
- **Separate modal for creation:** Over-engineered — admin just needs to type a name, not fill a form
- **Creating from search text:** Risky — admin might be searching, not intending to create

### Research Verdict
Simple inline toggle between "select from list" and "type a name" modes within the existing combobox. Reuse `general_doc` convention from document-manager. Backend handles doc creation atomically in the existing reassign flow.

## 4. Codebase Analysis

### Relevant Files
- `admin/js/script.js:1025-1159` — `createDocCombobox()` function
- `admin/js/script.js:1833-1906` — `showAIReassignModal()`, `confirmAIReassign()`, `submitAIReassign()`
- `admin/js/script.js:1486-1496` — inline combobox initialization for unmatched/mismatch cards
- `admin/js/script.js:1908-1917` — `assignAIUnmatched()` for inline combobox submit
- `admin/css/style.css:2179-2313` — combobox CSS
- `admin/index.html:435-455` — reassign modal HTML
- `assets/js/document-manager.js:960-985` — existing `general_doc` creation pattern
- n8n workflow `c1d7zPAmHfHM71nV` — "Find Target Doc" code node (where create logic goes)

### Existing Patterns
- `general_doc` template_id already established in document-manager
- Combobox already supports `onSelect` callback, `dataset.selectedValue`, `dataset.selectedDocId`
- Reassign API already accepts `reassign_template_id` and `reassign_doc_record_id`

### Alignment with Research
- Existing combobox has no create mode — this adds it cleanly
- Backend already handles `general_doc` in other workflows — just need to handle it in review-classification

## 5. Technical Constraints & Risks

- **Security:** New doc name comes from admin (trusted) — no sanitization beyond HTML escaping
- **Risks:** If backend fails to create the doc, the reassign should fail cleanly (no partial state)
- **Breaking Changes:** None — adding optional fields to existing API; combobox backwards-compatible via opt-in `allowCreate` flag

## 6. Proposed Solution (The Blueprint)

### Logic Flow

**Frontend:**
1. `createDocCombobox()` gains `allowCreate: boolean` option
2. When `allowCreate: true`, dropdown renders a "+ הוסף מסמך חדש" button at the top, separated by a divider
3. Clicking it switches to "create mode": input placeholder changes to "שם המסמך החדש...", dropdown closes, a "← חזרה לרשימה" link appears below
4. Typing in create mode sets `dataset.selectedValue = '__NEW__'` and `dataset.newDocName = input.value`
5. Clicking "← חזרה לרשימה" returns to normal combobox mode
6. `confirmAIReassign()` and `assignAIUnmatched()` detect `__NEW__` and pass `new_doc_name` to API
7. `submitAIReassign()` sends additional fields: `reassign_template_id: 'general_doc'`, `new_doc_name: '...'`

**Backend (n8n workflow c1d7zPAmHfHM71nV):**
1. "Parse & Verify" node: accept optional `new_doc_name` field from request
2. "Process Action" node: pass `new_doc_name` forward when present
3. "Find Target Doc" code node: when `reassign_template_id === 'general_doc'` AND `new_doc_name` is provided AND no `reassign_doc_record_id`:
   - Create a new record in `documents` table via Airtable API
   - Fields: `type: 'general_doc'`, `issuer_name: new_doc_name`, `issuer_key: new_doc_name`, `category: 'general'`, `person: 'client'`, `status: 'Required_Missing'`, `report: [report_record_id]`
   - Return the new record ID so "Update Target Doc" proceeds normally
4. "Build Response" node: include `doc_title` = `new_doc_name` for the success toast

### Data Structures / Schema Changes
No schema changes — `general_doc` type already exists in Airtable `documents` table.

**New API fields (additive, optional):**
```json
{
    "action": "reassign",
    "reassign_template_id": "general_doc",
    "new_doc_name": "אישור מיוחד מהמוסד לביטוח לאומי"
}
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add create mode to `createDocCombobox()`, update `confirmAIReassign()`, `submitAIReassign()`, `assignAIUnmatched()`, inline combobox init |
| `admin/css/style.css` | Modify | Add styles for create button, create mode input, back link |
| n8n `c1d7zPAmHfHM71nV` | Modify | Update Parse & Verify, Process Action, Find Target Doc nodes to handle `new_doc_name` |

## 7. Validation Plan
- [ ] Click "+ הוסף מסמך חדש" in reassign modal — switches to text input mode
- [ ] Click "← חזרה לרשימה" — returns to normal combobox with docs list
- [ ] Type a name + click שייך — API creates doc + reassigns, card removed, toast shows custom name
- [ ] Same flow works in inline combobox on unmatched cards
- [ ] Same flow works in mismatch fallback combobox
- [ ] Confirm button stays disabled when create-mode input is empty
- [ ] Created doc appears in Airtable `documents` table with correct fields
- [ ] Created doc status transitions to `Received` after reassign completes
- [ ] File renamed/moved on OneDrive with the custom doc name
- [ ] No regression: existing reassign to known docs still works

## 8. Implementation Notes (Post-Code)
*Log any deviations from the plan here during implementation.*
