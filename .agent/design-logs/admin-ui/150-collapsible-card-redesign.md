# Design Log 150: Collapsible Card Section Redesign
**Status:** [DEPRECATED] — Superseded by DL-200
**Date:** 2026-03-12
**Related Logs:** DL-200 (Document Manager UX Improvements)

## 1. Context & Problem
The document-manager page has 4 collapsible sections below the document list. Three use identical yellow/warning styling (`questions-section`) and one uses purple/brand (`add-section`). Problems:
- All 3 yellow cards look identical despite having different purposes (reference, communication, internal notes)
- Warning/yellow color is semantically wrong for non-warning content (questionnaire, notes)
- 2px borders and font-weight 700 are too heavy for secondary, collapsed-by-default sections
- Chevron rotation is broken — CSS targets `.icon` but HTML uses `icon-sm`

## 2. User Requirements
*Expert consultation (Yuki, Amara, Renzo) informed requirements:*
1. **Q:** Should all cards look the same? **A:** No — differentiate by purpose
2. **Q:** What color scheme? **A:** Neutral gray for low-priority (questionnaire, notes), keep amber for consequential (questions for client), keep brand for action (add docs)
3. **Q:** Visual weight? **A:** Reduce — 1px borders, font-weight 600, tighter spacing

## 3. Research
### Domain
UI Component Design — Accordion/Collapsible Patterns, Visual Hierarchy

### Sources Consulted
1. **"Refactoring UI" (Wathan & Schoger)** — Use 3 levers: size, weight, color. De-emphasize secondary elements rather than making primary louder. Not everything needs equal visual weight.
2. **Nielsen Norman Group: Accordions on Desktop** — Headings should be descriptive. Caret icon is the best indicator. Don't auto-collapse others.
3. **Andrew Coyle: "Design Better Accordions"** — Use different font styles for title vs body. Titles shouldn't compete with page headings. Subtle animations for comfort.

### Key Principles Extracted
- **Hierarchy through de-emphasis:** Make neutral sections quieter so the important ones (Questions for Client) stand out naturally
- **Semantic color usage:** Warning/amber = "needs attention." Gray = "reference/low-priority." Brand = "action."
- **Border-inline-start accent:** RTL-safe left-border accent differentiates without painting the entire container

### Anti-Patterns to Avoid
- **False Hierarchy:** All cards at same visual weight — nothing guides the eye
- **Rainbow Effect:** Yellow + purple for peer-level elements — two accent colors where one suffices
- **Decoration Addiction:** Colored bg + colored border + bold text = 3 layers of emphasis for collapsed secondary content

### Research Verdict
Adopt a neutral base (`.card-section`) with modifier variants (`--warning`, `--brand`). Sections without modifiers are quiet/gray. Only "Questions for Client" gets the amber accent (it's the one that actually warrants attention). "Add Documents" keeps brand accent (action-oriented).

## 4. Codebase Analysis
* **Existing Solutions Found:** Base `.collapsible-trigger` in design-system.css (lines 821-848) already provides a clean neutral style (white bg, 1px gray border, font-weight 600). The page-specific CSS overrides this with heavier warning/brand styling.
* **Reuse Decision:** Align with design-system base rather than fighting it. New `.card-section` mirrors the base defaults.
* **Relevant Files:** `document-manager.css` (lines 686-714 add-section, 991-1018 questions-section), `document-manager.html` (4 section divs), `design-system.css` (lines 842-848 chevron rotation)
* **Cross-Page Impact:** None — only `document-manager.html` uses these sections
* **JS Impact:** Zero — JS uses IDs not class names

## 5. Technical Constraints & Risks
* **Security:** None
* **Risks:** Low — CSS-only change, no JS, no data flow
* **Breaking Changes:** None — inner content structure preserved

## 6. Proposed Solution (The Blueprint)

### New CSS Architecture
Replace `.questions-section` and `.add-section` with BEM-style `.card-section` + modifiers:

| Class | Theme | Used By |
|-------|-------|---------|
| `.card-section` (base) | Neutral gray — white bg, 1px gray-200 border | Questionnaire, Notes |
| `.card-section--warning` | Amber accent — warning-50 bg, 3px inline-start accent | Questions for Client |
| `.card-section--brand` | Brand accent — brand-50 bg, 3px inline-start accent | Add Documents |

### Key CSS Changes
- Border: 2px → 1px
- Font-weight: 700 → 600
- Font-size: text-base → text-sm
- Margin: sp-5 → sp-3 (tighter grouping)
- Accent: `border-inline-start: 3px solid` on warning/brand variants
- Trigger bg: warning-50/brand-50 → white (base), keep colored bg for variants

### Chevron Fix
In design-system.css, extend rotation selector to also target `.icon-sm`:
```css
.collapsible-trigger[aria-expanded="true"] .icon,
.collapsible-trigger[aria-expanded="true"] .icon-sm {
    transform: rotate(180deg);
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `assets/css/document-manager.css` | Modify | Replace `.questions-section` + `.add-section` with `.card-section` variants |
| `document-manager.html` | Modify | Update 4 wrapper div class names |
| `assets/css/design-system.css` | Modify | Fix chevron rotation for `.icon-sm` |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`

## 7. Validation Plan
* [ ] All 4 sections render correctly with differentiated styles
* [ ] Questionnaire + Notes: neutral gray (white bg, gray border, no accent)
* [ ] Questions for Client: amber accent (warning bg, left border accent)
* [ ] Add Documents: brand accent (brand bg, left border accent)
* [ ] Chevron rotates on expand/collapse for all 4 sections
* [ ] Questionnaire scrollable content still works
* [ ] Notes textarea auto-save still works
* [ ] Questions container still renders correctly
* [ ] Add Documents form still works
* [ ] RTL layout correct (accent border on right side)
* [ ] Mobile responsive (smaller margins on narrow viewport)

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation*
