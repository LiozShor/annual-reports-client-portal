# Inline Status Tag Actions — UX Research

> Research date: 2026-03-30
> Context: Admin panel document list — click-on-tag to toggle document status (Required_Missing / Waived / Received)

---

## Key Principles

1. **Affordance through visual cues.** Interactive tags must look clickable — cursor:pointer, hover elevation/color shift, and a subtle border change on hover. Static badges and interactive tags must be visually distinct (Carbon Design System, Material Design). If a tag is clickable, it needs to signal that before the user hovers.

2. **Immediate feedback, deferred confirmation.** Optimistic UI: apply the visual state change instantly on click, fire the API in the background, and roll back only on failure. Users perceive the action as instant. Store previous state before applying the update so rollback is trivial.

3. **Minimum 3 distinguishing properties per state.** For WCAG compliance and clarity, each status must differ by at least 3 of: color, icon/shape, text label, opacity/decoration. A single color change is not enough — users with low color vision need shape + text + color (Carbon Design System's "three of four elements" rule).

4. **Single-click for the happy path, long-press/menu for alternatives.** The most common action (e.g., waive a required doc) should be a single click. Less common transitions (e.g., undo a waive, mark as received) should be accessible via a small dropdown/popover — not a multi-click cycle. Cycling through 3+ states with repeated clicks is error-prone and confusing.

5. **Reversibility is mandatory.** Every status change via inline tag must be undoable. Show a toast with "Undo" action button immediately after the change. This replaces confirmation dialogs for low-risk actions and is faster than confirm-then-act.

---

## Recommended Interaction Pattern: Click-on-Tag Status Toggle

### Pattern: "Primary Action Click + Popover for Alternatives"

**How it works:**

| User Action | Result |
|-------------|--------|
| **Single click** on a `Required_Missing` tag | Immediately transitions to `Waived` (most common inline action) + shows undo toast |
| **Single click** on a `Waived` tag | Transitions back to `Required_Missing` (undo) + shows undo toast |
| **Single click** on a `Received` tag | No action (received is a terminal/system state — not user-toggleable via tag click) |
| **Right-click or long-press** on any tag | Opens a small popover with all available transitions for that document |

**Why this over cycling:**
- Material Design filter chips use single-click to toggle between selected/unselected (two states). When there are 3+ states, MD3 recommends a menu or segmented control — not cycling.
- Ant Design's `CheckableTag` is explicitly a two-state toggle (checked/unchecked). Their pattern for multi-state uses dropdown menus.
- Cycling through N states with repeated clicks violates the "recognition over recall" heuristic — users can't see what the next click will do.

**Visual behavior on click:**
1. Tag immediately changes color/icon/text (optimistic update)
2. Brief scale pulse animation (100ms scale to 1.05, ease-out back to 1.0) — confirms the click registered
3. Toast appears: "Document waived" with [Undo] action button (persistent until dismissed)
4. API call fires in background
5. On API failure: revert tag to previous state, show error toast "Failed to update — restored previous status"

---

## Visual States

### Required_Missing (default — attention needed)

| Property | Value |
|----------|-------|
| Background | `--danger-50` (light red, ~#FEF2F2) |
| Border | `1px solid --danger-200` (~#FECACA) |
| Text color | `--danger-700` (dark red) |
| Icon | Lucide `circle-alert` (12px, before text) |
| Text | "חסר" / "Missing" |
| Font weight | 500 (medium) |
| Opacity | 1.0 |
| Cursor | `pointer` |
| Hover | Background darkens to `--danger-100`, border to `--danger-300` |

### Waived (intentionally skipped — low attention)

| Property | Value |
|----------|-------|
| Background | `--gray-100` (#F5F5F4) |
| Border | `1px solid --gray-200` (#E7E5E4) |
| Text color | `--gray-500` (#6B6764) |
| Icon | Lucide `minus-circle` (12px, before text) |
| Text | ~~"חסר"~~ with strikethrough on original text, or "הוחרג" / "Waived" |
| Font weight | 400 (normal) |
| Opacity | 0.7 |
| Text decoration | `line-through` on the document name (not the tag itself) |
| Cursor | `pointer` |
| Hover | Background to `--gray-200`, opacity to 0.85 |

**Document row treatment when waived:**
- The entire document row gets `opacity: 0.6` and the document name gets `text-decoration: line-through`
- This visually "crosses off" the item from the checklist — a pattern borrowed from to-do list UX
- Row is not hidden — waived items remain visible but clearly de-emphasized

### Received (complete — positive confirmation)

| Property | Value |
|----------|-------|
| Background | `--success-50` (light green, ~#F0FDF4) |
| Border | `1px solid --success-200` (~#BBF7D0) |
| Text color | `--success-700` (dark green) |
| Icon | Lucide `check-circle` (12px, before text) |
| Text | "התקבל" / "Received" |
| Font weight | 500 (medium) |
| Opacity | 1.0 |
| Cursor | `default` (not clickable — system-managed state) |
| Hover | No change (non-interactive) |

### Transition Animation (all states)

```
transition: background-color 150ms ease, color 150ms ease, opacity 200ms ease, transform 100ms ease;
```

On click: `transform: scale(1.05)` for 100ms, then back to `scale(1)`.

---

## Optimistic UI Implementation Pattern

### State Machine

```
Required_Missing <--click--> Waived    (user toggle, bidirectional)
Required_Missing ----------> Received  (system/upload only, NOT via tag click)
Waived ---------------------> Received  (system/upload only)
Received ---(admin only)---> Required_Missing  (via popover menu, not tag click)
```

### Rollback Strategy

1. **Before update:** Snapshot `{ recordId, previousStatus, previousTagHTML }`
2. **Apply optimistic:** Change tag class, text, icon immediately
3. **Fire API:** `PATCH /document/{id}/status` with new status
4. **On success:** Discard snapshot, toast auto-dismisses
5. **On failure:** Restore from snapshot (revert tag class/text/icon), show error toast
6. **On undo (toast button):** Fire reverse API call, apply reverse optimistic update with its own rollback

### Error Toast Pattern

- Type: `showAIToast("Failed to update status — reverted", "danger")`
- No action button needed — the rollback already happened
- 5s auto-dismiss (longer than success toast since it's an error)

---

## Batch Document Management Patterns

### Quick-Waive Multiple Documents

For waiving multiple documents at once (e.g., "waive all bank statements"):

1. **Floating bulk bar pattern** (already in the design system): User selects multiple doc rows via checkboxes, floating bar appears with "Waive Selected" button
2. **Category-level waive:** A "waive all" link next to document category headers (e.g., "Bank Documents (3)  [waive all]")
3. Each waived item transitions with a 50ms stagger delay for visual clarity

### Patterns from Accounting/Legal Software

- **Gatekeeper (contract management):** Workflow checklists where reviewers can skip items that aren't applicable — items remain visible but marked as "N/A" with reduced visual weight
- **ShareFile (legal doc review):** Bulk status operations on document lists with immediate visual feedback
- **Common pattern across tools:** "Not Applicable" / "Waived" items are never hidden — they stay in the list with visual de-emphasis (dimmed + strikethrough) so auditors can see what was intentionally skipped vs. what was missed

---

## Anti-Patterns to Avoid

1. **Cycling through 3+ states with repeated clicks.** Users lose track of which state comes next. Material Design explicitly uses menus for multi-state, not cycling. The only exception is a clean two-state toggle (on/off).

2. **Confirmation dialog for every status toggle.** For low-risk, reversible actions like waiving a document, a confirmation dialog adds friction without value. Use undo-via-toast instead. Reserve `showConfirmDialog()` for destructive/irreversible actions only.

3. **Hiding waived items from the list.** If waived documents disappear, the user loses context about what was intentionally skipped. Accounting/legal software universally keeps waived items visible but de-emphasized. Hiding also breaks the mental model of "checklist progress" — the total count changes unexpectedly.

4. **Color-only state differentiation.** Using only red vs. gray vs. green to distinguish states fails WCAG 1.4.1 (Use of Color). Each state must also differ by icon shape and text label. The Carbon Design System requires at least 3 of 4 distinguishing elements (color, icon, shape, text).

5. **Making "Received" status clickable for toggle.** "Received" means the system confirmed a document was uploaded/approved. Allowing casual click-to-toggle on received documents risks accidental data loss. This state should only be changeable through an explicit admin action (popover menu or dedicated button).

6. **No loading/pending state during API call.** Even with optimistic UI, the tag should show a subtle pending indicator (e.g., a tiny spinner replacing the icon, or a pulsing border) if the API takes >500ms. This prevents users from clicking again thinking the first click didn't register.

7. **Animating on page load.** Transition animations should only trigger on user interaction, not when the page renders. Tags should appear in their final state instantly on load.

---

## Sources

- [Chips - Material Design 3](https://m3.material.io/components/chips/guidelines)
- [Material Web - Chips](https://material-web.dev/components/chip/)
- [Tag - Ant Design](https://ant.design/components/tag/)
- [Badges vs. Pills vs. Chips vs. Tags - Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/badges-chips-tags-pills/)
- [Carbon Design System - Status Indicator Pattern](https://carbondesignsystem.com/patterns/status-indicator-pattern/)
- [Chip UI Design Tutorial - SetProduct](https://www.setproduct.com/blog/chip-ui-design)
- [Filter Chips - Good Practices Design](https://goodpractices.design/components/filter-chips)
- [Badge UI Design - SetProduct](https://www.setproduct.com/blog/badge-ui-design)
- [Badge UI Design - Cieden](https://cieden.com/book/atoms/badge/badge-ui-design)
- [Optimistic UI Patterns - Simon Hearne](https://simonhearne.com/2021/optimistic-ui-patterns/)
- [Understanding Optimistic UI - LogRocket](https://blog.logrocket.com/understanding-optimistic-ui-react-useoptimistic-hook/)
- [What Are Optimistic Updates - Medium](https://medium.com/@kyledeguzmanx/what-are-optimistic-updates-483662c3e171)
- [Toggle Switch Guidelines - Nielsen Norman Group](https://www.nngroup.com/articles/toggle-switch-guidelines/)
- [Microinteractions UX Patterns - Pencil & Paper](https://www.pencilandpaper.io/articles/microinteractions-ux-interaction-patterns)
- [Workflow Checklists - Gatekeeper](https://knowledge.gatekeeperhq.com/en/docs/workflow-checklists)
- [Legal Document Review - ShareFile](https://www.sharefile.com/resource/blogs/legal-document-review-guide)
