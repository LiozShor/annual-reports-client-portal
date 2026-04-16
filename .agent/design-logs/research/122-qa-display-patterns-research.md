# DL-122: Q&A Display Patterns Research — Admin Panel + Print

**Status:** Research
**Date:** 2026-03-08
**Context:** CRM admin panel showing client questionnaire questions and answers in an expandable detail view and print output. RTL Hebrew, amber-boxed Q&A section.

---

## Source 1: Nielsen Norman Group — Accordion Patterns for Q&A on Desktop

**URL:** https://www.nngroup.com/articles/accordions-on-desktop/
**Supporting:** https://media.nngroup.com/media/reports/free/Strategic_Design_for_Frequently_Asked_Questions.pdf

### Key Takeaways

NNGroup recommends accordions for Q&A when users need only a few pieces of information and will skip most content. Each question should be a heading, each answer the collapsible panel. Visual weight hierarchy: topic > question heading > answer body. Use caret or plus icons to signal expandability. Critical recommendation: **include an "Expand All" button and auto-expand all sections at print preview** — single-open accordions prevent accessing all content for printing.

When the audience requires most or all content, show everything at once — accordions create friction for bulk reading.

### Application to Our Case

- Our admin panel Q&A accordion (questionnaire tab) should default to collapsed for screen browsing but **auto-expand all sections when entering print mode** — this is a well-established pattern.
- The amber Q&A box visual weight is correct: the question label (bold) establishes hierarchy above the answer text.
- For answered vs. unanswered: NNGroup's guidance on "clear, descriptive headings" supports using visual differentiation (e.g., muted/italic for unanswered items, bold/normal weight for answered) rather than hiding unanswered questions entirely.
- The "Expand All" button we already have (DL-120) aligns with NNGroup's recommendation.

---

## Source 2: Smashing Magazine — Print Stylesheets (with CSS Paged Media)

**URL:** https://www.smashingmagazine.com/2018/05/print-stylesheets-in-2018/
**Supporting:** https://618media.com/en/blog/designing-for-print-with-css-tips/ · https://www.customjs.space/blog/print-css-cheatsheet/

### Key Takeaways

Print stylesheets should be included inside `@media print {}` blocks in the main CSS (not separate files) to encourage maintenance. Key rules for Q&A print output:

1. **Page-break control:** Use `break-inside: avoid` on Q&A pairs to prevent a question from appearing on one page and its answer on the next. Use `break-after: avoid-page` on question headings so the answer always follows.
2. **Orphans/widows:** Set `orphans: 2; widows: 2` on answer paragraphs to prevent single-line page splits.
3. **Hide irrelevant UI:** `display: none` on navigation, action buttons, expand/collapse icons, floating bars. Show all accordion content by forcing panels open.
4. **Typography:** Serif fonts improve printed legibility. Adjust line-height (1.5+) for print. Remove background colors (browsers strip them by default) — use borders instead.
5. **Generated content:** Insert URLs after links using `a[href]:after { content: " (" attr(href) ")"; }` — not needed for our Q&A case but useful for any links in answers.

### Application to Our Case

- **RTL Hebrew print:** `direction: rtl` must be explicitly set on the print container — some browsers reset direction in print mode. Test in Chrome and Edge print preview.
- **Amber background box:** Will disappear in print (browsers strip `background-color` by default). Replace with a left/right border (`border-right: 3px solid #d97706` for RTL) or use `-webkit-print-color-adjust: exact` if the amber background is important for context.
- **Accordion → flat list in print:** Force all `.accordion-panel` elements to `display: block !important; height: auto !important` in `@media print`.
- **Q&A pair integrity:** Wrap each Q&A pair in a container with `break-inside: avoid` to keep question + answer together across page breaks.
- **Hide interactive elements:** Action buttons, expand/collapse chevrons, floating bulk bars — all `display: none` in print.

---

## Source 3: Accordion & Detail View Patterns — UX Patterns for Developers + Carbon Design System

**URL:** https://uxpatterns.dev/patterns/content-management/accordion
**Supporting:** https://carbondesignsystem.com/components/accordion/usage/ · https://coyleandrew.medium.com/design-better-accordions-c67ae38e6713

### Key Takeaways

Real-world admin interfaces (IBM Carbon, Material Design) use accordions with these conventions:

1. **Answered vs. unanswered visual states:** Use a secondary indicator (checkmark icon, colored dot, or counter badge) next to the accordion header to show completion status. Carbon Design System recommends status indicators that are visible whether the accordion is open or closed — users should see at-a-glance which items need attention without expanding.
2. **Read-only vs. editable side by side:** The pattern is to show the read-only view as the default collapsed state with a summary line, and reveal editable fields only on expand or via an explicit "Edit" action. For pure read-only Q&A (our case), the expanded state shows the full answer as static text — no input fields.
3. **Multi-open vs. single-open:** For admin review workflows where users compare answers across questions, **allow multiple sections open simultaneously** (multi-open). Single-open is only appropriate when sections are truly independent and sequential.
4. **Keyboard accessibility:** `aria-expanded`, `aria-controls`, `role="region"` on panels. Arrow keys cycle headers, Enter/Space toggle.

### Application to Our Case

- **Status badges on collapsed headers:** Add a small indicator (e.g., green dot or checkmark) for answered questions and a muted dash or empty circle for unanswered — visible without expanding. This is the standard pattern from Carbon/Material.
- **Multi-open is correct for us:** Admin reviewing a client's questionnaire answers needs to compare across questions — our DL-120 single-open behavior should be reconsidered for the detail/review use case (single-open is fine for the table-level accordion, but within a single client's Q&A, multi-open is better).
- **Print: flatten the accordion entirely.** Both Carbon and the UX Patterns guide recommend removing the accordion interaction layer for print and rendering all content as a flat, sequential list with clear visual separators (HR or spacing) between Q&A pairs.

---

## Summary: Actionable Recommendations for Our Q&A View

| Area | Recommendation | Source |
|------|---------------|--------|
| Screen: answered vs. unanswered | Status indicator (dot/checkmark) on collapsed accordion header | Carbon Design System, NNGroup |
| Screen: visual hierarchy | Bold question label > regular-weight answer text > muted unanswered | NNGroup Visual Hierarchy |
| Screen: expand behavior | Multi-open for single-client Q&A review; single-open for table rows | NNGroup Accordions, UX Patterns |
| Screen: Expand All | Keep existing Expand All button (DL-120) | NNGroup |
| Print: accordion | Force all panels open, hide chevrons/buttons | NNGroup, Smashing Magazine |
| Print: page breaks | `break-inside: avoid` on Q&A pair containers | Smashing Magazine |
| Print: RTL | Explicit `direction: rtl` on print container | CSS best practices |
| Print: amber background | Replace with border (right border for RTL) or force color print | Smashing Magazine |
| Print: typography | Consider serif font for print, `line-height: 1.5+` | 618media, Smashing Magazine |
| Accessibility | `aria-expanded`, keyboard nav, semantic headings | Carbon, Aditus |

---

## Sources

1. [NNGroup — Accordions on Desktop](https://www.nngroup.com/articles/accordions-on-desktop/)
2. [NNGroup — Strategic Design for FAQs (PDF)](https://media.nngroup.com/media/reports/free/Strategic_Design_for_Frequently_Asked_Questions.pdf)
3. [Smashing Magazine — Print Stylesheets in 2018](https://www.smashingmagazine.com/2018/05/print-stylesheets-in-2018/)
4. [618media — Designing for Print with CSS (2025)](https://618media.com/en/blog/designing-for-print-with-css-tips/)
5. [CustomJS — Print CSS Cheatsheet](https://www.customjs.space/blog/print-css-cheatsheet/)
6. [UX Patterns for Developers — Accordion](https://uxpatterns.dev/patterns/content-management/accordion)
7. [Carbon Design System — Accordion Usage](https://carbondesignsystem.com/components/accordion/usage/)
8. [Andrew Coyle — Design Better Accordions](https://coyleandrew.medium.com/design-better-accordions-c67ae38e6713)
