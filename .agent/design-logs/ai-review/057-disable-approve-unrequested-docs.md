# Design Log 057: Disable Approve for Unrequested Documents
**Status:** [IMPLEMENTED]
**Date:** 2026-02-25
**Related Logs:** 043 (AI Review Card Redesign), 036 (AI Classification Review Interface)

## 1. Context & Problem

When a client sends a document that's NOT in their required list (e.g., T1501 education cert when only employment docs were requested), the AI classifies it and matches a template, but there's no linked document record in Airtable. Design log 057's predecessor (session 40) added a "לא נדרש" badge to flag these.

**The problem:** The approve button still appears active on unrequested doc cards. If admin clicks "אשר":
- Classification record is deleted (removed from queue)
- **No document record is updated** (there's none to update)
- File may be renamed on OneDrive but new URL is **not saved** to Airtable
- **Net effect: file becomes orphaned** — exists on OneDrive, nothing tracks it

Admin should only be able to **reassign** (to an actual required doc) or **reject** (archive it).

## 2. User Requirements

1. **Q:** Should the approve button be hidden entirely or shown as disabled (grayed out) with a tooltip?
   **A:** Disabled + tooltip. Admin sees the option exists but understands why it's unavailable.

2. **Q:** Should this also block the 'approve anyway' action on issuer-mismatch cards that happen to be unrequested?
   **A:** Yes, block all approve paths for unrequested docs.

3. **Q:** Should the backend also enforce this (reject approve API calls for unrequested docs) or frontend-only?
   **A:** Frontend only.

## 3. Research

### Domain
Admin Panel UX — Disabled Action States

### Sources Consulted
1. **Nielsen Norman Group — Disabled Accessibility** — Use `aria-disabled="true"` over native `disabled` to keep button in tab order and allow tooltip announcements. Always pair disabled state with an explanation.
2. **Smashing Magazine (Friedman) — Disabled Buttons UX** — Default to always-enabled with error feedback, but disable is acceptable when you want users to *know a feature exists but is unavailable*. Never hide actions users expect to see. Prefer inline text over tooltip-only.
3. **CSS-Tricks — Making Disabled Buttons More Inclusive** — Replace `disabled` with `aria-disabled="true"` + CSS + JS click prevention. Enables tooltips and screen reader announcements while preventing the action.
4. **Material Design 3 — Disabled States** — Use ~38% opacity for content, ~12% for container. Visual treatment only — explanation layer must be custom.
5. **GitHub merge button pattern** — Canonical admin example: disabled button + inline reason + auto-enable when conditions met.

### Key Principles Extracted
- **Visibility over hiding:** Admin expects approve to exist → show it disabled with explanation, don't remove it
- **`aria-disabled` > `disabled`:** Keeps button focusable for tooltip/screen reader, our codebase already has `.btn:disabled` at 0.5 opacity
- **Explanation is mandatory:** Tooltip alone is acceptable for this use case (internal admin panel, badge already provides context)

### Patterns to Use
- **Disabled + tooltip pattern:** Button with `aria-disabled="true"`, CSS styling, JS click prevention, title tooltip

### Anti-Patterns to Avoid
- **Hiding the button:** Admin would wonder where approve went on some cards but not others
- **Native `disabled` attribute:** Removes from tab order, prevents tooltip on some browsers

### Research Verdict
Use `aria-disabled="true"` with tooltip explanation. The "לא נדרש" badge already provides visual context, tooltip on the button gives the "why" on hover. Simpler than inline text, appropriate for an internal admin tool where the user is trained.

**Pragmatic deviation:** Research recommends inline text over tooltip-only. We're using tooltip because: (1) the badge already serves as inline context, (2) adding text below each approve button would bloat the compact card layout, (3) this is an internal admin panel with ~2 users.

## 4. Codebase Analysis

### Relevant Files
- `admin/js/script.js` — `renderAICard()` (line 1502), `getCardState()` (line 1299), `approveAIClassification()` (line 1769)
- `admin/css/style.css` — `.btn:disabled` already at opacity 0.5 + cursor not-allowed (design-system.css line 184)

### Existing Patterns
- `getCardState(item)` determines card state: `full`, `fuzzy`, `issuer-mismatch`, `unmatched`
- States with approve buttons: `full` (line 1544), `fuzzy` (line 1657)
- State `issuer-mismatch` has "שייך" (quick-assign to radio-selected doc) — this is actually a reassign action, not approve
- Existing disabled button pattern: `.btn-ai-comparison-assign` starts `disabled`, enabled when radio selected (line 1593)
- `showInlineConfirm()` handles approve double-click protection (line 2129)

### Card states affected by `is_unrequested`
| State | Has approve? | Action needed |
|-------|-------------|---------------|
| `full` | Yes — "אשר" button | Disable when `is_unrequested` |
| `fuzzy` | Yes — "אשר" button | Disable when `is_unrequested` |
| `issuer-mismatch` | No — has "שייך" (assign=reassign) | No change needed — assigns to actual doc record |
| `unmatched` | No | No change needed |

## 5. Technical Constraints & Risks
- **No backend change** — frontend only per user preference
- **No risk of breaking existing cards** — only adds `aria-disabled` + click guard when `is_unrequested` is true
- **`is_unrequested` already in API response** — added to Build Response in previous fix

## 6. Proposed Solution

### Logic Flow
1. In `renderAICard()`, for `full` and `fuzzy` states, check `item.is_unrequested`
2. If true: render approve button with `aria-disabled="true"` + tooltip explaining why
3. In `approveAIClassification()`, add early guard: if card has `is_unrequested` data attribute, show toast and return
4. Add CSS for `.btn[aria-disabled="true"]` styling

### Changes

**`admin/js/script.js` — `renderAICard()`**

In `full` state (line 1543-1546), wrap approve button:
```javascript
const approveDisabled = item.is_unrequested;
// ...
${approveDisabled
  ? `<button class="btn btn-success btn-sm" aria-disabled="true" title="לא ניתן לאשר מסמך שלא נדרש — יש לשייך מחדש או לדחות">
      <i data-lucide="check" class="icon-sm"></i> אשר
    </button>`
  : `<button class="btn btn-success btn-sm" onclick="approveAIClassification('${escapeAttr(item.id)}')">
      <i data-lucide="check" class="icon-sm"></i> אשר
    </button>`
}
```

Same pattern in `fuzzy` state (line 1657-1659).

**`admin/js/script.js` — store `is_unrequested` on card**

Add `data-unrequested` attribute to card div (line 1694):
```javascript
<div class="ai-review-card ${cardClass}" data-id="${escapeAttr(item.id)}" ${item.is_unrequested ? 'data-unrequested="true"' : ''}>
```

**`admin/css/style.css`**

Add aria-disabled styling for buttons inside AI cards:
```css
.ai-review-card .btn[aria-disabled="true"] {
    opacity: 0.45;
    cursor: not-allowed;
    pointer-events: none;
}
```

Note: `pointer-events: none` blocks click AND enables the parent to show tooltip via `title` attribute. Since we're using `aria-disabled` (not native `disabled`), the `title` tooltip will fire on hover of the non-interactive area.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Disable approve button in `full` + `fuzzy` states when `is_unrequested` |
| `admin/css/style.css` | Modify | Add `aria-disabled` button styling |

## 7. Validation Plan
- [ ] Load admin panel → AI Review tab
- [ ] Card with unrequested doc: approve button grayed out, tooltip shows on hover
- [ ] Card with required doc: approve button works normally
- [ ] Clicking disabled approve does nothing (pointer-events: none)
- [ ] Reject and Reassign still work on unrequested cards
- [ ] Fuzzy match + unrequested: approve disabled
- [ ] Issuer-mismatch + unrequested: assign button still works (it's reassign, not approve)

## 8. Implementation Notes (Post-Code)
*To be filled after implementation.*
