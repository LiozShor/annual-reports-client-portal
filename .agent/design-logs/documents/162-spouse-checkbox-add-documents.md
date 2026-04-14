# Design Log 162: Spouse Checkbox for Document Addition
**Status:** [DRAFT]
**Date:** 2026-03-17
**Related Logs:** DL-160 (document manager company dropdown)

## 1. Context & Problem

When adding documents via "הוספת מסמכים" in the document manager, dropdown-selected docs auto-detect the person (client/spouse) from the SSOT template's `scope` field. But custom documents are hardcoded to `person: 'client'`, and there's no way to override the auto-detected person for dropdown docs either. The admin needs a way to mark any added document as belonging to the spouse.

## 2. User Requirements

1. **Q:** How should the spouse toggle appear?
   **A:** Checkbox labeled "מסמך של בן/בת הזוג"

2. **Q:** Should this apply to dropdown docs, custom docs, or both?
   **A:** Both — checkbox overrides template scope for dropdown docs too

3. **Q:** Should the checkbox only be visible when the client has a spouse?
   **A:** Yes — hide when `SPOUSE_NAME` is empty

## 3. Research

### Domain
Form Design, Checkbox UX Patterns

### Sources Consulted
1. **"Checkboxes: Design Guidelines" — NN/G** — Checkboxes for binary toggles; labels should be positive/affirmative (not negated). Short labels (3-4 words) reduce cognitive load.
2. **"Form Design Patterns" — Adam Silver** — Modifier checkboxes that affect subsequent actions should be visually grouped with the controls they modify.
3. **"Checkbox UI Design Best Practices" — Eleken** — Place checkboxes near the elements they control; always associate labels for click targets.

### Key Principles Extracted
- Checkbox label should be affirmative ("מסמך של בן/בת הזוג") not negative
- Place near the add controls (dropdown + custom input), not elsewhere
- Persistent state (stays checked) is correct for batch-adding multiple spouse docs

### Patterns to Use
- **Shared modifier checkbox:** One checkbox that affects both add flows (dropdown + custom)
- **Conditional visibility:** Hide entire control when irrelevant (no spouse)

### Anti-Patterns to Avoid
- **Per-doc toggle after adding:** Adding complexity to each chip is overkill — checkbox before adding is simpler
- **Radio button client/spouse:** Not needed when default is already correct (client)

### Research Verdict
Simple checkbox above the add controls, conditionally visible. Override template scope when checked.

## 4. Codebase Analysis

### Existing Solutions Found
- `docsToAdd` Map already stores `{ person: 'client'|'spouse' }` metadata — no schema change needed
- `buildDocMeta()` determines person from `tpl.scope` — easy to add checkbox override
- `SPOUSE_NAME` global variable already available from API response
- Design system has `.switch`/`.switch-slider` for toggles and checkbox styling

### Reuse Decision
Reuse existing `docsToAdd` metadata pattern. No new data structures needed.

### Relevant Files
- `document-manager.html` — HTML for add section
- `assets/js/document-manager.js` — all add/save logic
- `assets/css/design-system.css` — has checkbox/toggle styles

### Alignment with Research
Existing pattern of metadata in `docsToAdd` Map aligns perfectly with adding person info. The checkbox modifier pattern is standard UX.

## 5. Technical Constraints & Risks

* **Security:** No security impact — person field is already validated server-side
* **Risks:** None — additive change, no existing behavior modified when checkbox is unchecked
* **Breaking Changes:** None — default behavior (person='client') unchanged

## 6. Proposed Solution (The Blueprint)

### Logic Flow
1. On page load, if `SPOUSE_NAME` is set, show the spouse checkbox
2. When admin checks the box and adds a doc (dropdown or custom), person is set to 'spouse'
3. Selected doc chips show "(בן/בת זוג)" indicator when person is spouse
4. Confirmation modal shows person label next to added doc names
5. On save, person metadata sent to API as before

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `document-manager.html` | Modify | Add spouse checkbox in הוספת מסמכים section |
| `assets/js/document-manager.js` | Modify | isSpouseDocMode(), override in buildDocMeta/addCustomDoc, show indicator in chips + modal |

## 7. Validation Plan
* [ ] Checkbox hidden when client has no spouse
* [ ] Checkbox visible when client has spouse
* [ ] Custom doc with checkbox checked → chip shows "(בן/בת זוג)"
* [ ] Dropdown doc with checkbox checked → overrides to spouse
* [ ] Dropdown doc with checkbox unchecked → uses template scope as before
* [ ] Confirmation modal shows person indicator for spouse docs
* [ ] Save sends correct `person` value to API
* [ ] Checkbox stays checked between multiple adds

## 8. Implementation Notes (Post-Code)
*(To be filled during implementation)*
