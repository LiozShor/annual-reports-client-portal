# DL-110: Inline Q&A / Questions List UX Research

**Date:** 2026-03-07
**Type:** Research
**Status:** Complete

---

## 1. "Add Item to List" UX Patterns (Admin Panels)

### Sources
- [PatternFly Inline Edit](https://pf3.patternfly.org/v3/pattern-library/forms-and-controls/inline-edit/)
- [Linear Inline Editing Changelog](https://linear.app/changelog/2022-06-09-inline-editing)
- [Linear Create Issues Docs](https://linear.app/docs/creating-issues)
- [MOJ Design System — Add Another](https://design-patterns.service.justice.gov.uk/components/add-another/)
- [Scottish Gov — Add More Fields](https://designsystem.gov.scot/patterns/add-more-fields)
- [DWP Design System — Add Another Thing](https://design-system.dwp.gov.uk/patterns/add-another-thing)
- [UX Movement — Preventing Accidental Delete](https://uxmovement.com/buttons/how-to-make-sure-users-dont-accidentally-delete/)
- [Indie Hackers — Designing Destructive Actions](https://www.indiehackers.com/post/ux-tip-how-to-design-destructive-actions-e-g-delete-turn-off-74d17fdc28)
- [Eleken — Empty State UX](https://www.eleken.co/blog-posts/empty-state-ux)

### Key Principles

#### Add Button Placement
- **Bottom of list** is the standard for "add another" patterns (GOV.UK, DWP, Scottish Gov all place it below).
- **PatternFly exception**: "Create" action in toolbar above list adds row at TOP in edit mode.
- **Recommended for our case**: "Add question" button at the bottom of the list — this is the dominant pattern for repeatable field groups. Users read top-to-bottom, so new items appear where they're expected.

#### Inline Editing vs Modal Entry
| Pattern | When to Use | Example |
|---------|------------|---------|
| **Click-to-edit inline** | Quick single-field edits, frequent updates | Linear: click title/description to edit, auto-saves |
| **Inline row in edit mode** | Adding structured items to tables/lists | PatternFly: new row appears with all fields editable, check/X to save/cancel |
| **Modal entry** | Complex multi-field items, rare additions | Jira: full issue creation modal with many fields |
| **"Add another" expanding** | Repeatable field groups in forms | GOV.UK: fields appear below, focus moves to new field |

**Recommended for our case**: Inline row that appears at the bottom of the list when "Add" is clicked. Both question and answer fields visible immediately. Auto-focus on the question field.

#### Delete Confirmation Patterns
| Severity | Pattern | Example |
|----------|---------|---------|
| **Low (reversible)** | No confirmation — use undo toast | Gmail: delete email, toast with "Undo" link |
| **Medium (single item)** | Simple confirmation or undo toast | Scottish Gov single fields: no dialog, just remove |
| **High (grouped/has data)** | Confirmation dialog before deletion | Scottish Gov grouped fields: confirmation component |
| **Critical (irreversible)** | Type-to-confirm | GitHub: type repo name to delete |

**Recommended for our case**: For Q&A items, a simple inline confirmation is sufficient (medium severity). If the question has content, show a brief confirmation. If it's empty, delete immediately.

#### Empty State
- **Icon + headline + CTA button** is the universal pattern.
- Headline: state what's empty ("No questions added yet"), not generic ("No data").
- Single CTA: "Add your first question" — same action as the "Add" button.
- Avoid walls of text; one sentence of context is enough.
- **Recommended**: Light gray area with a centered icon (question mark or list icon), "No questions added yet", and a primary "Add Question" button.

#### Visual Hierarchy (Question vs Answer)
- **Question field**: larger/bolder — it's the primary identifier.
- **Answer field**: secondary, can be slightly smaller or lighter.
- **Numbered list**: sequential numbering (1, 2, 3...) helps scanning and gives a sense of order.
- **Row separator**: subtle `border-bottom` between items, not heavy dividers.

---

## 2. Q&A Sections in Transactional Emails

### Sources
- [Brevo — Transactional Email Design Examples](https://www.brevo.com/blog/transactional-email-design-examples/)
- [Moosend — Transactional Email Best Practices 2026](https://moosend.com/blog/transactional-email-best-practices/)
- [EDMDesigner — Tabular Data in HTML Emails](https://blog.edmdesigner.com/tabular-data-representation-in-modern-html-emails/)
- [Bootdey — Invoice Receipt Email Template](https://www.bootdey.com/snippets/view/simple-invoice-receipt-email-template)
- [Postmark Transactional Email Templates](https://postmarkapp.com/transactional-email-templates)
- [EDMDesigner — Padding/Margin/Border in Emails](https://blog.edmdesigner.com/html-email-padding-margin-border/)

### Key Principles

#### Visual Separation from Main Content
- Q&A section should be a **distinct block** within the email, not blended into running text.
- Use a **light background container** (`#f9fafb` or `#f5f5f5`) to create a visual "card" effect.
- Add **padding inside** the container (`16-24px`) and **margin above/below** (`24-32px`).
- A `1px solid #e5e7eb` border on the container provides subtle framing.

#### Numbered vs Unnumbered Questions
- **Numbered is better for Q&A** — it implies order, makes reference easier ("see question 3"), and helps in follow-up conversations.
- Number styling: bold number, followed by the question text.
- Pattern: `<strong>1.</strong> Question text here`

#### Styling Patterns for Q&A in Email
**Recommended structure (table-based for email compatibility):**

```
+--------------------------------------------------+
|  bg: #f9fafb, border: 1px solid #e5e7eb          |
|  padding: 20px                                    |
|                                                   |
|  SECTION HEADER: "שאלות נוספות" / "Additional     |
|  Questions"                                       |
|                                                   |
|  ┌────────────────────────────────────────────┐   |
|  │ 1. [Question text - bold]                  │   |
|  │    [Answer text - normal weight, gray]     │   |
|  ├────────────────────────────────────────────┤   |
|  │ 2. [Question text - bold]                  │   |
|  │    [Answer text - normal weight, gray]     │   |
|  └────────────────────────────────────────────┘   |
+--------------------------------------------------+
```

**CSS specifics (inline for email):**
- Question: `font-weight: 600; color: #1f2937; font-size: 14px;`
- Answer: `font-weight: 400; color: #4b5563; font-size: 14px;`
- Row separator: `border-top: 1px solid #eee` on each row after the first
- Cell padding: `padding: 12px 0` per row
- Container: `background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px;`

#### Email Client Compatibility
- Use `<table>` elements, NOT `<div>` for layout — Outlook requires table-based structure.
- Apply padding ONLY on `<td>` elements — the only reliable tag+property combo across all clients.
- Inline all CSS — external stylesheets are stripped by most email clients.
- Max width: 600px (ideal), 800px (upper limit).
- For RTL (Hebrew): set `dir="rtl"` on the container `<td>`, `text-align: right`.

---

## 3. Paired Fields (Question + Answer) Form Design

### Sources
- [LogRocket — Progressive Disclosure in UX](https://blog.logrocket.com/ux-design/progressive-disclosure-ux-types-use-cases/)
- [IxDF — Progressive Disclosure](https://ixdf.org/literature/topics/progressive-disclosure)
- [Carbon Design System — Forms Pattern](https://carbondesignsystem.com/patterns/forms-pattern/)
- [USWDS — Progress Easily](https://designsystem.digital.gov/patterns/complete-a-complex-form/progress-easily/)
- [Scottish Gov — Add More Fields](https://designsystem.gov.scot/patterns/add-more-fields)
- [LogRocket — Toast Notifications UX](https://blog.logrocket.com/ux-design/toast-notifications/)

### Key Principles

#### Pairing Related Fields Visually
- **Stacked layout (label above input)** for question + answer pairs. Question field on top, answer field directly below.
- **Group border/container**: Wrap each Q&A pair in a subtle container (light border or background) to create visual association.
- **Fieldset/legend semantics**: Use `<fieldset>` with numbered legend ("Question 1") to group Q+A fields — good for accessibility.
- Avoid side-by-side layout for question+answer — questions can be long text, need full width.

#### Progressive Disclosure
| Pattern | Description | When to Use |
|---------|-------------|-------------|
| **Always visible** | Both Q and A fields shown | When answers are expected for all questions |
| **Show on demand** | Answer field appears after question is entered | When not all questions will have answers (optional) |
| **Accordion** | Q visible, A revealed on click/expand | For reviewing existing Q&A pairs (read-only view) |

**Recommended for our case**: Always visible — both fields shown immediately. The admin is entering both question and answer text, and an empty answer field serves as a visual cue that it still needs to be filled.

#### Status Indicators (Answered/Unanswered)
- **Visual cue on the row**: small colored dot or icon.
  - Green check / filled dot = has answer text
  - Orange/gray empty circle = question without answer
- **Alternative**: border-left color on the row container (green = complete, gray = incomplete).
- Keep indicators subtle — they're secondary info, not primary.

#### Field Labeling
- For repeating Q&A pairs, use numbered labels: "Question 1", "Answer 1", "Question 2", "Answer 2".
- Or use a single group label "Question 1" with sub-labels "Question text" / "Answer text".
- Placeholder text can supplement but NOT replace labels.

---

## Recommended Patterns for Our Implementation

### Admin Panel: Q&A List Editor

```
┌─────────────────────────────────────────────────────┐
│  Additional Questions                    [+ Add]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─ 1 ──────────────────────────────────── [🗑] ─┐  │
│  │  Q: [What is your primary income source?    ]  │  │
│  │  A: [Salary from employment                 ]  │  │
│  └────────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ 2 ──────────────────────────────────── [🗑] ─┐  │
│  │  Q: [Do you own property abroad?            ]  │  │
│  │  A: [                                       ]  │  │
│  └────────────────────────────────────────────────┘  │
│                                                     │
│  [+ Add another question]                           │
│                                                     │
└─────────────────────────────────────────────────────┘

Empty state:
┌─────────────────────────────────────────────────────┐
│  Additional Questions                               │
├─────────────────────────────────────────────────────┤
│                                                     │
│         (?) No questions added yet                  │
│                                                     │
│         [+ Add Question]                            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Behaviors:**
1. "Add" button at bottom creates new Q&A pair, auto-focuses question field.
2. Delete icon (trash) on each row — if row has content, brief inline confirmation; if empty, immediate delete.
3. Numbered sequentially (auto-renumber on delete).
4. Answer field shows subtle status indicator (green border-left when filled).
5. Auto-save on blur (Linear pattern) — no explicit save/cancel per row.

### Email: Q&A Display Block

```html
<!-- Q&A Section Container -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
  <tr>
    <td style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px;">
      <!-- Section Header -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size: 15px; font-weight: 600; color: #374151; padding-bottom: 16px; border-bottom: 1px solid #e5e7eb;">
            שאלות נוספות
          </td>
        </tr>
      </table>
      <!-- Q&A Items -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 14px 0; border-bottom: 1px solid #f0f0f0;">
            <strong style="color: #1f2937;">1. Question text here</strong><br/>
            <span style="color: #6b7280; font-size: 14px;">Answer text here</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 14px 0;">
            <strong style="color: #1f2937;">2. Question text here</strong><br/>
            <span style="color: #6b7280; font-size: 14px;">Answer text here</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

---

## Decision Matrix

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Add button placement | Bottom of list | GOV.UK/DWP/Scottish Gov consensus; natural reading flow |
| Edit mode | Always inline, auto-save on blur | Linear pattern; reduces friction for frequent edits |
| Delete confirmation | Inline only if content exists | Low severity (reversible); avoid confirmation fatigue |
| Empty state | Icon + text + CTA button | Universal pattern; guides first action |
| Field layout | Stacked (Q above A) | Questions can be long; full width needed |
| Numbering | Sequential, auto-renumber | Helps scanning; useful for email cross-reference |
| Email Q&A styling | Card container with numbered rows | Visual separation from main email content |
| Progressive disclosure | Always visible (both fields) | Admin enters both; empty A field = visual cue |
| Status indicator | Left border color (subtle) | Secondary info; doesn't distract from content |
