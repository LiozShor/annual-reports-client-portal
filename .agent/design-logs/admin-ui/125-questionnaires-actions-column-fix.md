# Design Log 125: Questionnaires Tab — Actions Column Background & Sticky Fix
**Status:** [DRAFT]
**Date:** 2026-03-08
**Related Logs:** DL-120 (questionnaires tab improvements), DL-122 (sticky client name row)

## 1. Context & Problem
The "פעולות" (actions) column in the questionnaires tab has two bugs:
1. **Different background color** — The actions column cells have an explicit `background: var(--white, #fff)` + `box-shadow: -2px 0 4px` while neighboring cells are transparent. This creates a visible color/shadow mismatch.
2. **Not sticky vertically** — When a detail row is expanded, `.qa-main-row-sticky td` makes all cells stick at `top: 41px`. But the actions cell has `display: flex` (overriding `display: table-cell`), which likely breaks `position: sticky` in the table layout context. Neighboring cells stick properly.

Both issues stem from the horizontal-sticky feature (DL-120) that was designed to keep the actions column visible during horizontal scrolling. The table never overflows horizontally in practice, so the feature is unnecessary and creates these side effects.

## 2. User Requirements
1. **Q:** Vertical or horizontal scroll issue?
   **A:** Vertical — when scrolling down with a detail row expanded.

2. **Q:** Remove all visual differences or keep subtle divider?
   **A:** Remove all — no shadow, no separate background.

3. **Q:** Does this also affect the main dashboard table?
   **A:** Only questionnaires tab.

## 3. Research
### Domain
CSS Table Layout, Sticky Positioning

### Sources Consulted
1. **Polypane — "Getting Stuck: All the Ways position:sticky Can Fail"** — `display: flex` on a table cell changes its box type from `table-cell`, which can break sticky positioning in the table layout context.
2. **CSS-Tricks — "A Table with Both a Sticky Header and a Sticky First Column"** — Best practice: keep `td` as `table-cell` for reliable sticky; use inner wrappers for flex layout.
3. **MDN — position: sticky** — Sticky works relative to the nearest scroll container; requires the element to participate in normal document/table flow.

### Key Principles
- Keep `td` elements as `display: table-cell` for reliable sticky positioning in tables
- Use inner `<div>` wrappers for flex layout inside table cells
- Opaque backgrounds on sticky cells are only needed when content scrolls underneath

### Research Verdict
Remove the horizontal-sticky feature entirely (unused), fix `display: flex` by moving it to an inner wrapper, and let the existing `.qa-main-row-sticky td` rule handle vertical sticking uniformly.

## 4. Codebase Analysis
* **Existing Solutions:** `.qa-main-row-sticky td` already handles vertical sticky for all cells — the actions cell just needs to stop overriding it.
* **Reuse Decision:** Reuse existing sticky row mechanism, remove the horizontal-sticky overlay.
* **Relevant Files:**
  - `admin/css/style.css` lines 4191–4218 (actions column sticky rules)
  - `admin/css/style.css` line 4221 (`.qa-actions-cell` flex layout)
  - `admin/js/script.js` line 5281 (actions cell HTML)

## 5. Technical Constraints & Risks
* **Risk:** If the table ever needs horizontal scrolling on narrow screens, the actions column won't stick. Acceptable — can revisit if needed.
* **Breaking Changes:** None — purely visual/behavioral fix.

## 6. Proposed Solution (The Blueprint)

### CSS Changes (`admin/css/style.css`)

**Remove** these 4 rules entirely (lines ~4191–4218):
```css
/* REMOVE: Sticky actions header */
#questionnaireTableContainer th:last-child { ... }

/* REMOVE: Sticky actions cell — horizontal */
#questionnaireTableContainer td.qa-actions-cell { ... }

/* REMOVE: Match hover background on sticky actions cell */
#questionnaireTableContainer tr:hover td.qa-actions-cell { ... }

/* REMOVE: When row is sticky, also stick vertically */
#questionnaireTableContainer .qa-main-row-sticky td.qa-actions-cell { ... }
```

**Modify** `.qa-actions-cell` — move flex to inner wrapper:
```css
/* BEFORE */
.qa-actions-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    justify-content: center;
}

/* AFTER */
.qa-actions-inner {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    justify-content: center;
}
```

### JS Change (`admin/js/script.js`)

Wrap actions buttons in `<div class="qa-actions-inner">`:
```html
<td class="qa-actions-cell" onclick="event.stopPropagation();">
    <div class="qa-actions-inner">
        <button ...>...</button>
        <button ...>...</button>
        <button ...>...</button>
    </div>
</td>
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/css/style.css` | Modify | Remove 4 horizontal-sticky rules, rename `.qa-actions-cell` flex to `.qa-actions-inner` |
| `admin/js/script.js` | Modify | Add inner `<div class="qa-actions-inner">` wrapper around action buttons |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Expand a detail row → scroll down → פעולות column sticks at the same position as neighboring cells
* [ ] Normal state: פעולות column has no visual difference from neighboring columns (no shadow, same background)
* [ ] Hover state: all cells in the row highlight uniformly
* [ ] Action buttons (folder, printer, chevron) still work correctly
* [ ] Checkbox column still works
* [ ] Bulk selection still works
* [ ] No regression in the main dashboard table

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
