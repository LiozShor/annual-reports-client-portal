# Design Log 352: Add-Doc Owner Tabs (Doc-Manager + PA Popover Uniformity)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-26
**Related Logs:** DL-162 (spouse checkbox add docs), DL-301 (PA add-doc affordance), DL-039 (searchable categorized doc dropdown)

## 1. Context & Problem

The doc-manager's "הוספת מסמכים" (`document-manager.html:270-275`, DL-162) uses a persistent checkbox (`#spouseDocCheckbox`) to mark new docs as belonging to the spouse. The checkbox is **sticky** across adds and across collapsing/reopening the section. Admins routinely forget the checkbox is still checked from a prior add and end up silently tagging the wrong person. User report: "it chooses for me by mistake to write that its the spouse's."

Meanwhile, the PA queue's add-doc popover (`script.js:9354+`, DL-301) already solves this with a **segmented control** of person tabs that:
- Defaults from row context (client vs. spouse row), not sticky
- Is hidden when `item.spouse_name` is empty
- Filters templates by `scope` (CLIENT / SPOUSE / PERSON / GLOBAL_SINGLE / empty) via `_paTemplateMatchesPerson` (`script.js:9500`)

Outcome of this log: doc-manager adopts the PA popover's tab pattern, removing the sticky-checkbox bug and giving both add-doc surfaces an identical owner-selection control (Uniformity rule #1).

## 2. User Requirements

1. **Q:** How should the owner tabs appear and behave above the template combobox?
   **A:** Two tabs above the combobox (segmented control), replacing the checkbox.
2. **Q:** What should the default owner be each time the modal/section opens?
   **A:** Always reset to client each page load (no sticky state).
3. **Q:** When the client has no spouse, what should happen?
   **A:** Hide the tabs entirely.
4. **Q:** Should switching tabs while a template is half-selected reset the search input?
   **A:** Keep search & dropdown state — only the owner metadata changes.
5. **Q:** Tab labels — generic ("שלי" / "בן/בת זוג") or actual names?
   **A:** Use actual names (`👤 {client_name}` / `👥 {spouse_name}`) — matches the PA popover labels already in use.
6. **Q:** Should the doc-manager combobox filter templates by the active person's scope?
   **A:** Yes — same predicate as PA popover (`_paTemplateMatchesPerson`).

## 3. Research

### Domain
Form Design / Modifier-Before-Action UX, Segmented Controls, RTL Hebrew Forms.

### Sources Consulted
1. **NN/G — "Checkboxes vs. Toggles"** — Checkboxes are passive (state stays until form submit); segmented controls are immediate-effect toggles for mutually exclusive scope choices. Citing this distinction directly in our case: a "client vs. spouse" choice is mutually exclusive scope, so segmented control fits better than checkbox.
2. **Apple HIG — Segmented Controls** — "Use a segmented control to organize content into distinct categories of mutually exclusive choices." Owner = client/spouse is exactly this shape.
3. **Primer (GitHub) — SegmentedControl Accessibility** — Must have a group label (visible or sr-only) so screen readers announce purpose. Each segment is a button with `aria-pressed` or part of a `role="radiogroup"`.
4. **DL-162 prior research (Adam Silver, NN/G, Eleken)** — Modifier control should sit near the action it modifies; affirmative labels; conditional visibility when irrelevant. Still applies.

### Key Principles Extracted
- **Mutual exclusivity → segmented control, not checkbox.** Owner is binary AND mutually exclusive — segmented is the canonical shape.
- **Default to a safe state on each session.** Sticky modifier state across page loads is the root cause of the current bug (NN/G — "preserve user intent across mode changes, but don't surprise them with stale modes").
- **Place the modifier near the action.** Already true (above combobox).
- **Group label for a11y.** Add an `aria-label` like "בעלים של המסמך" on the tabs container.

### Patterns to Use
- **Segmented control (2 segments)** with `.active` state, identical visual to `pa-add-doc-person` for cross-surface uniformity.
- **Conditional visibility** when `SPOUSE_NAME` is empty.
- **Scope-based filtering** of the dropdown content by the active tab (port `_paTemplateMatchesPerson`).

### Anti-Patterns to Avoid
- **Sticky persistent state** across opens — caused the original bug.
- **Per-doc owner toggle on the chip** — adds friction; the decision belongs before the pick.
- **Radio group with form-submit semantics** — owner should apply immediately like the PA popover does.

### Research Verdict
Port the PA popover's `pa-add-doc-person` segmented control verbatim into doc-manager. Reuse `_paTemplateMatchesPerson` predicate. Default to client on every page load. Hide when no spouse.

## 4. Codebase Analysis

### Existing Solutions Found
- **PA popover already has the exact component** — `script.js:9455-9460` renders `.pa-add-doc-person` with two `.pa-add-doc-person-btn` buttons; `paAddDocSetPerson` (9507) handles tab clicks and re-renders. CSS at `admin/css/style.css:9187-9215`.
- **Scope filter predicate** — `_paTemplateMatchesPerson` (`script.js:9500-9505`) handles all 5 Airtable scope values (CLIENT, SPOUSE, PERSON, GLOBAL_SINGLE, empty). Reuse it.
- **doc-manager combobox** — `initDocumentDropdown` (`document-manager.js:730`) groups templates by category; `renderAddDocDropdown` (846) renders. Doesn't currently filter by scope at all — relies on `buildDocMeta` to set `person` from `tpl.scope === 'SPOUSE'`.
- **`isSpouseDocMode`** (`document-manager.js:1769`) is the single read-point for the checkbox; rewriting just this function flows through to `buildDocMeta` (1775) and `addCustomDoc` (2481) with no other changes.

### Reuse Decision
- **Copy** (not import — vanilla scripts, no module system in doc-manager): `_paTemplateMatchesPerson` predicate.
- **Mirror** CSS class names from `pa-add-doc-*` to `add-doc-*` in document-manager.css for visual consistency without coupling files (doc-manager.html doesn't load admin/css/style.css).
- **Rewrite** `isSpouseDocMode` to read tab state. No call-site changes needed.

### Relevant Files
- `frontend/document-manager.html:270-283` — checkbox markup + combobox container
- `frontend/assets/js/document-manager.js`:
  - `initDocumentDropdown` (730) — needs tab render + handler + initial state
  - `renderAddDocDropdown` (846) — accept active person, filter by scope
  - `isSpouseDocMode` (1769) — rewrite
  - `buildDocMeta` (1775), `addCustomDoc` (2481) — call sites unchanged
- `frontend/assets/css/document-manager.css` — add segmented-control styles
- `frontend/admin/js/script.js:9455-9505` — reference (no edit; PA popover already correct)
- `frontend/admin/css/style.css:9187-9215` — reference styles to mirror

### Alignment with Research
The PA popover's existing implementation already conforms to NN/G + HIG + Primer guidance — segmented control, conditional visibility, immediate effect, group context via positioning. Porting it satisfies all research principles without re-deriving them.

## 5. Technical Constraints & Risks

* **Security:** No impact — `person` is already validated server-side; this only changes how it's set client-side.
* **Risks:**
  - Existing docs added via the OLD checkbox in this session won't migrate — but the checkbox is replaced cleanly, no in-flight session data is corrupted (chips already stored their `person` at add time).
  - If `SPOUSE_NAME` is set but the active filing's scope differs (e.g., spouse name from earlier filing year), tabs will show — same behavior as DL-162 had with the checkbox.
* **Breaking Changes:** Removes `#spouseDocCheckbox` element. Any external automation/test selectors targeting it must be updated. None in current test suite.
* **Uniformity:** Tabs in both surfaces use the same labels (`👤 {client_name}` / `👥 {spouse_name}`) and the same scope-filter predicate.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Adding a doc on either surface explicitly requires the admin to acknowledge owner via the active tab — no sticky state across page loads; both surfaces visually and behaviorally identical when a spouse exists.

### Logic Flow (Doc-Manager)
1. On page load, `initDocumentDropdown` reads `CLIENT_NAME` + `SPOUSE_NAME` globals.
2. If `SPOUSE_NAME` empty → hide `#addDocPersonTabs`; `_addDocActivePerson = 'client'`.
3. If `SPOUSE_NAME` set → render two tabs `[👤 {CLIENT_NAME}] [👥 {SPOUSE_NAME}]`; mark client tab active; `_addDocActivePerson = 'client'`.
4. Tab click → `setAddDocPerson(person)` updates state, swaps `.active` class, calls `renderAddDocDropdown` with new filter (preserves current input value).
5. `renderAddDocDropdown` filters `entries` by `_addDocTemplateMatchesPerson(tpl, _addDocActivePerson)` before applying the search-text filter.
6. On template pick / custom doc submit, `buildDocMeta` / `addCustomDoc` continue to call `isSpouseDocMode()` — now returns `_addDocActivePerson === 'spouse'`.
7. On `resetAddDocWizard`, `_addDocActivePerson` stays where the user left it within this page-load (only initial load resets it).

### PA Popover (Reference — No Change)
Already implements identical behavior since DL-301. Verified labels use `client_name` / `spouse_name` (`script.js:9457-9458`).

### Data Structures
- New module-level state: `let _addDocActivePerson = 'client';`
- No schema changes. `docsToAdd` Map continues to store `{ person: 'client'|'spouse', ... }`.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/document-manager.html` | Modify | Replace `#spouseDocToggle` (lines 270-275) with `#addDocPersonTabs` container above `#addDocCombobox` |
| `frontend/assets/js/document-manager.js` | Modify | Add `_addDocActivePerson`, `setAddDocPerson`, `_addDocTemplateMatchesPerson`; update `initDocumentDropdown` to render tabs; update `renderAddDocDropdown` to filter by scope; rewrite `isSpouseDocMode` to read tab state |
| `frontend/assets/css/document-manager.css` | Modify | Add `.add-doc-person`, `.add-doc-person-btn`, `.add-doc-person-btn.active` (RTL-safe segmented control) |

### Final Step (Always)
Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items to `.agent/current-status.md`.

## 7. Validation Plan
* [ ] Doc-manager for client **with spouse**: tabs visible above combobox, default = client name highlighted, `(בן/בת זוג)` indicator absent on chip.
* [ ] Switch to spouse tab → combobox re-renders WITHOUT CLIENT-only templates; PERSON / GLOBAL_SINGLE / empty templates remain.
* [ ] Search input value preserved across tab switch.
* [ ] Pick template under spouse tab → chip shows `(בן/בת זוג)`.
* [ ] Add custom doc under spouse tab → chip shows `(בן/בת זוג)`.
* [ ] Reload page → default reverts to client tab (no sticky state).
* [ ] Doc-manager for client **without spouse** → tabs hidden, behavior unchanged from today.
* [ ] PA popover for client with spouse: tabs still work as before (regression check).
* [ ] PA popover for client without spouse: no tabs (regression check).
* [ ] Save flow: API receives correct `person` per doc on both surfaces.
* [ ] Hebrew RTL renders tabs right-to-left, active state visually clear.
* [ ] Keyboard a11y: Tab focuses tabs; Enter/Space activates; arrow keys optional but tab-to-tab works.

## 8. Implementation Notes (Post-Code)
*(To be filled during implementation — note any deviations and which research principles were applied.)*
