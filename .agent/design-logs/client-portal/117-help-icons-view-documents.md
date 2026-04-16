# Design Log 117: Help Icons on view-documents
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-08
**Related Logs:** None

## 1. Context & Problem
Clients accessing the `view-documents` portal often don't know where or how to obtain specific required tax documents. Providing contextual help reduces support calls and confusion.

## 2. User Requirements
*Q&A from discovery phase:*
1.  **UX Pattern:** Accordion (minimal)
2.  **Text Readiness:** Build UI with dummy instructions for now; instructions will eventually be pulled from Airtable.
3.  **Empty States:** If a document has no help text, hide the "?" help icon.
4.  **Formatting:** The help text will use HTML (e.g., clickable links).
5.  **Language:** Bilingual (Hebrew/English).

## 3. Research
### Domain
Progressive Disclosure, Contextual Help, Usability Guidelines.

### Sources Consulted
1. **NN/g (Nielsen Norman Group)** — Accordions are powerful for progressive disclosure on mobile to prevent information overload.
2. **LogRocket / UX Design** — Keep accordion headers concise and make the full area clickable; use visual cues to show state.
3. **UX Patterns / NNG** — Contextual help should be unintrusive, shouldn't hide critical task-completion info, and must be accessible.

### Key Principles Extracted
- **Progressive Disclosure:** Only show the help text when requested to avoid cluttering the document list.
- **Mobile Optimization:** Accordions are preferred over tooltips on mobile since tooltips (hover) don't work well on touch devices.

### Patterns to Use
- **Inline Accordion:** We will use a minimal, stripped-down accordion directly beneath the document name row.
- **Visual Cues:** We'll use a `?` (circle-help) icon next to the document name that acts as the trigger to toggle the accordion.

### Anti-Patterns to Avoid
- **Hover Tooltips:** Avoid tooltips for complex HTML content or instructions, as they are not mobile-friendly and can disappear unpredictably.

### Research Verdict
We will implement a minimal inline accordion. The "?" icon will serve as the toggle trigger for the collapsible content below the document row. The content will render safe HTML (`sanitizeDocHtml`).

## 4. Codebase Analysis
* **Existing Solutions Found:** `ui-design-system-full.md` defines `.collapsible-trigger` and `.collapsible-content`. We will adapt this for a minimal inline feel inside the document row.
* **Reuse Decision:** We will adapt the existing `.doc-row` split-row pattern to allow a full-width collapsible row underneath the main flex row. We'll wrap `.doc-row` and `.doc-help-content` in a `.doc-item-wrapper`.
* **Relevant Files:** `assets/js/view-documents.js`, `assets/css/view-documents.css`.
* **Dependencies:** Document Service API (will need dummy data injected if actual data is missing during testing).

## 5. Technical Constraints & Risks
* **Security:** We must safely render HTML using our existing sanitizer (allowing `<b>`, `<strong>`, `<a>` tags for links).
* **UI Layout:** The document row uses `.doc-row` flex layout. The accordion content must expand below it without breaking the split-row (right/left) alignment.

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1.  **Mock Data:** In `renderDocuments()`, if a document lacks `help_he` or `help_en`, we inject dummy text for testing purposes to see the UI.
2.  **Rendering:**
    *   If help text exists, append a `<button class="help-toggle-btn">` (with a `circle-help` lucide icon) next to the document name.
    *   Append a new `div.doc-help-content` underneath the main `.doc-row`.
    *   Wrap both the `.doc-row` and `.doc-help-content` in a parent `.doc-item-wrapper`.
3.  **Interaction:** Clicking the `help-toggle-btn` toggles an `.open` class on the `.doc-help-content`, expanding it with CSS max-height transition.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `assets/js/view-documents.js` | Modify | Update rendering loop to include toggle button and collapsible content. Add toggle function. Verify safe HTML |
| `assets/css/view-documents.css` | Modify | Add styles for `.doc-item-wrapper`, `.help-toggle-btn`, `.doc-help-content`, and transitions. |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan
* [ ] Test Case 1: Verify the "?" icon appears only when help text is present (using mock data).
* [ ] Test Case 2: Click the "?" icon to expand the accordion and verify smooth transition.
* [ ] Test Case 3: Verify the HTML inside the help text renders correctly (links are clickable, `<b>` is bold).
* [ ] Test Case 4: Verify language toggle switches the help text between English and Hebrew.
* [ ] Test Case 5: Verify mobile layout does not break when the accordion is open.

## 8. Implementation Notes (Post-Code)
* *(To be filled after implementation)*
