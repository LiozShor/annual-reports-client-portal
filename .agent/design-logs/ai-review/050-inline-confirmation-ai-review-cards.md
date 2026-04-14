# Design Log 050: Inline Confirmation on AI Review Cards
**Status:** [DRAFT]
**Date:** 2026-02-23
**Related Logs:** [043-ai-review-card-redesign](043-ai-review-card-redesign.md), [042-ai-review-card-cleanup](042-ai-review-card-cleanup.md), [036-ai-classification-review-interface](036-ai-classification-review-interface.md)

## 1. Context & Problem

The AI Review tab uses a custom modal overlay dialog (`showConfirmDialog()`) to confirm approve, reject, and quick-assign actions. This interrupts the card review flow — the admin must dismiss the modal for every card action. For a queue of 10+ cards, this creates significant friction.

**Problem:** Modal confirmation dialogs break the card-by-card review flow and force context switches.

## 2. User Requirements

1. **Q:** Which confirmation dialogs should change?
   **A:** All review actions — approve, reject, and reassign.

2. **Q:** What should the inline confirmation look like?
   **A:** Replace the buttons area — the action buttons transform into a confirm/cancel strip.

3. **Q:** Should the confirmation include the action name or be generic?
   **A:** Action-specific — show what action will happen (e.g., "לדחות טופס 106?").

## 3. Research

### Domain
Confirmation UX, Card UI Patterns, Destructive Action Design

### Sources Consulted
1. **Nielsen Norman Group — "Confirmation Dialogs Can Prevent User Errors (If Not Overused)"** — Specificity over vagueness: never use "Are you sure?" — state exactly what will happen. Button labels must describe the action ("Reject Document" not "Yes"/"No"). Overusing confirmations trains users to click through mindlessly (wolf-crying problem).
2. **Smashing Magazine — "How to Manage Dangerous Actions in User Interfaces" (Sep 2024)** — Inline single-click-to-confirm pattern: button transforms on first click, requires second click to execute. Mitigate double-click risk with 100-200ms delay. Cognitive inertia: visual change breaks automatic patterns.
3. **GitLab Pajamas Design System — Destructive Actions Pattern** — Severity-based system: low severity = no friction, medium = two-click minimum, high = modal + typed confirmation. Our review actions are medium severity.

### Key Principles Extracted
- **Specificity:** Confirmation text must name the action and the entity — "לדחות טופס 106?" not "בטוח?"
- **Flow preservation:** Inline confirmation keeps the admin in the card context instead of shifting attention to a modal overlay
- **Double-click protection:** 150ms delay before confirm button activates prevents accidental rapid confirmation
- **Escape hatch:** Cancel button + Escape key must restore original state
- **Wolf-crying prevention:** Approve is low-risk and high-frequency — could arguably skip confirmation, but user explicitly wants it for all actions

### Anti-Patterns to Avoid
- **Generic "Are you sure?"** — triggers autopilot clicking
- **"Yes" / "No" button labels** — ambiguous, forces re-reading the question
- **Layout shift** — confirmation strip must occupy same space as original buttons
- **No delay on inline confirm** — double-click risk without 100-200ms delay
- **Confirmation fatigue** — mitigated by keeping the strip compact and fast to dismiss

### Research Verdict
Inline confirmation strip (replacing button area) is the right pattern for medium-frequency, medium-severity review actions. Modal is overkill, undo-toast alone is insufficient for reject (irreversible). The strip provides just enough friction without breaking flow.

## 4. Codebase Analysis

### Current Implementation
- **`showConfirmDialog(message, onConfirm, confirmText, danger)`** — Generic modal overlay dialog (lines 1932-1951 of `script.js`)
- **HTML:** `#confirmDialog` with class `ai-modal-overlay` — fixed overlay with blur backdrop
- **Used by:** `approveAIClassification()` (line 1578), `rejectAIClassification()` (line 1607), `quickAssignFromComparison()` (line 1144)
- **NOT used by:** `assignAIUnmatched()` — executes directly with no confirmation

### Card Structure
```
.ai-review-card[data-id]
  ├── .ai-card-top (file info + view button)
  ├── .ai-card-body (classification result)
  └── .ai-card-actions (action buttons — THIS gets replaced)
```

### Card States (4 variants)
| State | Actions | Confirmation |
|-------|---------|-------------|
| `full` | Approve, Reject, Reassign modal | showConfirmDialog for approve/reject |
| `fuzzy` | Approve, Reject, Reassign modal | showConfirmDialog for approve/reject |
| `issuer-mismatch` | Quick assign, Reassign modal, Reject | showConfirmDialog for quick-assign/reject |
| `unmatched` | Combobox assign, Reject | NO confirmation for assign; showConfirmDialog for reject |

### What stays
- `showConfirmDialog()` — still used by non-AI functions (`addManualClient`, `sendToAll`, `markComplete`)
- Reassign modal (`showAIReassignModal`) — selection interface, not just confirmation
- Card loading overlay (`setCardLoading` / `clearCardLoading`)

## 5. Technical Constraints & Risks

* **Layout shift risk:** Strip must fit in same space as original buttons. Using `min-height` on `.ai-card-actions` or fixed height ensures no jump.
* **Multiple cards:** Only one card should be in confirmation state at a time. Entering confirm on card B should cancel confirm on card A.
* **RTL:** Strip is Hebrew — text flows RTL, buttons on left. Existing `dir="rtl"` on page handles this.
* **Lucide icons:** After restoring original HTML, `lucide.createIcons()` must re-render icons.

## 6. Proposed Solution (The Blueprint)

### New Functions

**`showInlineConfirm(recordId, message, onConfirm, opts)`**
```
opts: { confirmText: string, danger: boolean, btnClass: string }
```

1. Cancel any existing inline confirm on other cards
2. Find card's `.ai-card-actions` div
3. Store original innerHTML in `card.dataset.originalActions`
4. Replace with confirmation strip:
   - `.ai-inline-confirm` div with message + confirm btn (disabled) + cancel btn
   - Danger variant: red text + red confirm button
5. After 150ms timeout, enable confirm button
6. Attach Escape key listener on card
7. Confirm → call `onConfirm()` callback
8. Cancel → call `cancelInlineConfirm(recordId)`

**`cancelInlineConfirm(recordId)`**
1. Find card, restore `dataset.originalActions` to `.ai-card-actions`
2. Remove data attribute
3. Call `lucide.createIcons()` to re-render icons

### Updated Handlers

| Function | Change |
|----------|--------|
| `approveAIClassification(id)` | Replace `showConfirmDialog` → `showInlineConfirm(id, 'לאשר את הסיווג?', async () => { ... }, {confirmText: 'אשר', btnClass: 'btn-success'})` |
| `rejectAIClassification(id)` | Replace `showConfirmDialog` → `showInlineConfirm(id, 'לדחות את הסיווג? המסמך יוסר מהתור.', async () => { ... }, {confirmText: 'דחה', danger: true})` |
| `quickAssignFromComparison(id, ...)` | Replace `showConfirmDialog` → `showInlineConfirm(id, 'לשייך ל: ${docName}?', async () => { ... }, {confirmText: 'שייך'})` |
| `assignAIUnmatched(id, btn)` | Add confirmation: `showInlineConfirm(id, 'לשייך?', async () => { ... }, {confirmText: 'שייך'})` |

### CSS

```css
.ai-inline-confirm {
    display: flex;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-5);
    border-top: 1px solid var(--gray-100);
    background: var(--gray-50);
    align-items: center;
    animation: fadeIn 0.15s ease;
}

.ai-inline-confirm-msg {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--gray-700);
}

.ai-inline-confirm.danger .ai-inline-confirm-msg {
    color: var(--danger-600);
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add `showInlineConfirm()`, `cancelInlineConfirm()`. Update 4 action handlers. |
| `admin/css/style.css` | Modify | Add `.ai-inline-confirm` styles |

## 7. Validation Plan

* [ ] Approve (full/fuzzy): buttons transform → "לאשר את הסיווג?" + green Confirm + Cancel
* [ ] Reject (all states): buttons transform → "לדחות את הסיווג?" + red Confirm + Cancel
* [ ] Quick assign (issuer-mismatch): transforms → "לשייך ל: {docName}?" + Confirm + Cancel
* [ ] Assign unmatched: transforms → "לשייך?" + Confirm + Cancel
* [ ] Cancel restores original buttons with working icons
* [ ] Escape key cancels
* [ ] 150ms delay prevents double-click
* [ ] Confirming one card while another is in confirm state → first cancels
* [ ] Confirm → loading state → card removed (existing flow unchanged)
* [ ] Reassign modal still works unchanged
* [ ] No layout shift when transforming
* [ ] RTL layout correct

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation.*
