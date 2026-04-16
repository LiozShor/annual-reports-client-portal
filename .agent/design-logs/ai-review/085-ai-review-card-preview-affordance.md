# Design Log 085: AI Review Card — Remove Fuzzy Hint & Improve Preview Affordance
**Status:** [DONE]
**Date:** 2026-03-03
**Related Logs:** 075 (AI Review Inline Document Preview), 043 (AI Review Card Redesign), 082 (Clickable UI Audit)

## 1. Context & Problem

Two UX issues on the AI Review tab's document cards:

1. **Fuzzy match hint is noise.** When the AI fuzzy-matches a document (state C), the card shows `💡 בנק דיסקונט ≈ בנק דיסקונט` — comparing the AI-detected issuer with the matched document issuer. When both names are identical or near-identical, this adds visual clutter with no informational value. The user wants it removed entirely.

2. **Preview click target is invisible.** The entire `.ai-card-top` div is clickable (`onclick="loadDocPreview(...)"`) and loads the document in the side preview panel. However, there is **no visible affordance** — no button, no icon, no text indicating this is clickable. The only cues are `cursor: pointer` on the div and a subtle underline on the file name on hover. Users don't know they can click to preview.

## 2. User Requirements

1. **Q:** The '💡 בנק דיסקונט ≈ בנק דיסקונט' hint appears on the AI Review tab's document card. Remove it from there?
   **A:** Yes, remove from AI Review tab card.

2. **Q:** What do you mean by 'preview' — docs popover, email preview, or document file preview?
   **A:** Document file preview (the side panel that shows the actual file).

3. **Q:** Where specifically is the preview UX unclear?
   **A:** AI review card — nothing visible to click to open preview.

4. **Q:** What kind of visual hint would feel natural?
   **A:** You decide — apply UX best practices.

## 3. Research

### Domain
Card UI Affordances, Clickability Signifiers, Document Preview UX

### Sources Consulted
1. **"Don't Make Me Think" — Steve Krug** — Users should never spend a millisecond wondering whether something is clickable. Designers love subtle cues, but web users miss them routinely. Flat design is the enemy of affordance.
2. **Nielsen Norman Group — "Beyond Blue Links: Making Clickable Elements Recognizable"** — Strongest clickability signifiers: color contrast, borders/outlines, button shape, consistent placement, size. Position in known action zones inherits clickability expectations.
3. **Nielsen Norman Group — "Icon Usability"** — A text label must accompany icons to clarify meaning. Only 3 icons are universal without labels (home, print, search). An "eye" icon for preview is NOT one of them — it needs a label.

### Key Principles Extracted
- **Always visible > hover-only** — Preview action must be recognizable at rest, not only on hover (Krug)
- **Icon + text label** — Eye icon alone is not universally understood; pair with "תצוגה מקדימה" or short label (NNG)
- **Known action zone** — Place in card header consistently across all card states (NNG)
- **Don't compete with primary actions** — Preview is secondary; approve/reject/reassign are primary. Preview button should be visually lighter (Material Design cards guideline)

### Patterns to Use
- **Ghost/link button with icon** — Visible but secondary, doesn't compete with primary action buttons in card footer
- **Consistent placement** — Same position in all card states (full match, fuzzy, unmatched)

### Anti-Patterns to Avoid
- **Hover-only affordance** — Current state. Fails on touch, fails for discoverability.
- **Icon-only button** — Eye icon without text is not universally recognized.

### Research Verdict
Add a small, always-visible ghost-style button with eye icon + Hebrew label in the card top area. Keep it visually secondary (gray/muted) so it doesn't compete with classification actions. Remove the empty `viewFileBtn` placeholder and replace with a real preview button.

## 4. Codebase Analysis

### Relevant Files
| File | Why |
|------|-----|
| `admin/js/script.js:1911` | `viewFileBtn = ''` — empty placeholder, originally held "Open in tab" |
| `admin/js/script.js:2025-2044` | Fuzzy match state (state C) — generates `fuzzyHintHtml` |
| `admin/js/script.js:2086-2097` | Card HTML template — `ai-card-top` with onclick, includes `viewFileBtn` |
| `admin/css/style.css:1470-1475` | `.ai-card-top` styling |
| `admin/css/style.css:2176-2178` | `.ai-card-top` cursor pointer |
| `admin/css/style.css:3421-3432` | `.clickable-preview` hover effects |

### Existing Patterns
- Design system has `.btn-ghost` (transparent bg, gray text, no border) — perfect for secondary action
- `.btn-sm` for compact inline buttons (4px 12px, 12px font)
- Lucide `eye` icon available
- `.ai-card-top` already has flex layout with `justify-content: space-between` — button can go on the left side (RTL: left = end)

## 5. Technical Constraints & Risks

- **Security:** None — purely cosmetic change
- **Risks:** Minimal. Removing fuzzy hint is a simple deletion. Adding button reuses existing patterns.
- **Breaking Changes:** None. The onclick on `.ai-card-top` already calls `loadDocPreview()`. The new button just adds visual clarity; click behavior unchanged.

## 6. Proposed Solution (The Blueprint)

### Change 1: Remove Fuzzy Hint

Delete the `fuzzyHintHtml` variable and its usage in state C (fuzzy match).

**Lines to modify:** `script.js:2037-2039` (generation) and `script.js:2044` (usage)

### Change 2: Add Preview Button to Card Top

Replace the empty `viewFileBtn` with a visible ghost button:

```html
<button class="btn btn-ghost btn-sm ai-preview-btn" onclick="event.stopPropagation(); loadDocPreview('${id}')" title="תצוגה מקדימה">
    <i data-lucide="eye" class="icon-sm"></i> תצוגה מקדימה
</button>
```

Key decisions:
- `event.stopPropagation()` — prevents double-firing with the `ai-card-top` onclick
- Ghost style — secondary visual weight, doesn't compete with approve/reject
- Hebrew label "תצוגה מקדימה" — matches the preview panel placeholder text
- Always visible in all card states (full, fuzzy, unmatched)

### Change 3: CSS for active state

Add visual feedback when preview is active for this card:

```css
.ai-review-card.preview-active .ai-preview-btn {
    color: var(--brand-600);
    background: var(--brand-50);
}
```

### Change 4: Remove redundant `.ai-card-top` cursor

Since the button itself is the click target now, remove the blanket `cursor: pointer` from `.ai-card-top` — only the button should look clickable.

### Change 5: Clean up `.ai-fuzzy-hint` CSS

Remove the unused CSS class `.ai-fuzzy-hint` (lines 1734-1741 in style.css).

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Remove fuzzy hint, add preview button |
| `admin/css/style.css` | Modify | Add `.ai-preview-btn` active state, remove `.ai-fuzzy-hint` CSS, remove `.ai-card-top` cursor |

## 7. Validation Plan
* [ ] Fuzzy match cards no longer show the `💡 ... ≈ ...` hint line
* [ ] All card states (full match, fuzzy, unmatched) show the "תצוגה מקדימה" button
* [ ] Clicking the preview button loads the document in the side panel
* [ ] Active card gets brand-colored preview button
* [ ] Button doesn't compete visually with approve/reject/reassign actions
* [ ] No double-fire (clicking button doesn't trigger both button and card-top onclick)

## 8. Implementation Notes (Post-Code)
* *To be filled after implementation.*
