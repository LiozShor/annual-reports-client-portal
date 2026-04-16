# Design Log 128: Inline Button Loading States for Document Manager
**Status:** Done
**Date:** 2026-03-09
**Related Logs:** None directly related

## 1. Context & Problem
The document-manager bottom action buttons ("אשר שינויים" → "אשר ושלח ללקוח") have two UX issues:
1. **No progress feedback during save** — after confirming changes in the modal, there's no visual indicator that saving is in progress. The user sees a toast at the top of the screen which is disconnected from the action area.
2. **Button text mismatch** — "אשר ושלח ללקוח" should be "שלח ללקוח" (simpler, clearer).
3. **Top-of-screen toasts for send operations** — the `showToast()` notifications for "שולח..." / "נשלח!" appear fixed at the top, far from the button the user just clicked. Should be inline.
4. **Insufficient bottom spacing** — buttons are too close to the bottom boundary of the component.

## 2. User Requirements
1. **Q:** Which spinner style for the save button?
   **A:** Spinner inside button — replace text with spinning icon + "שומר שינויים...", button disabled.

2. **Q:** What success feedback before transitioning to send button?
   **A:** Brief checkmark "נשמר!" for ~1.5s in the button, then swap to "שלח ללקוח".

3. **Q:** Same inline pattern for the send button?
   **A:** Yes — spinner → "נשלח!" → disabled "נשלח ללקוח ✓".

4. **Q:** Bottom spacing?
   **A:** Add ~24px (var(--sp-5)) padding-bottom.

## 3. Research
### Domain
Button Loading States, Inline Progress Feedback, Microinteractions

### Sources Consulted
1. **"Form Design Patterns" — Adam Silver** — Submit buttons should disable during submission and show clear progress. Avoid separate notifications that take attention away from the action area.
2. **Nielsen Norman Group — "Progress Indicators"** — Users need immediate feedback (< 1 second feels instant, 1-10s needs spinner). Success confirmation should be visible in the user's focal point, not in a distant notification area.
3. **Stripe Dashboard pattern** — Stripe uses inline button state transitions: text → spinner + loading text → brief success state → final state. This keeps feedback co-located with the user's attention.

### Key Principles Extracted
- **Co-located feedback:** Progress and success indicators should appear where the user's eye is already focused — inside the button itself.
- **State continuity:** Button transitions should feel like one continuous flow, not separate UI elements appearing/disappearing.
- **Minimum viable delay:** Show success state for 1-1.5s — enough to register but not enough to feel slow.

### Patterns to Use
- **Inline button state machine:** idle → loading (spinner + text) → success (✓ + text) → next state
- **CSS spinner animation:** Pure CSS `@keyframes` rotation on a pseudo-element or inline SVG

### Anti-Patterns to Avoid
- **Toast notifications for action feedback:** Toasts are for passive notifications, not direct action confirmation. The user shouldn't have to look away from where they clicked.

### Research Verdict
Replace all `showToast()` calls in `confirmSubmit()` and `approveAndSendToClient()` with inline button state changes. Add CSS spinner animation. Keep it simple — no external libraries.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `showToast()` (line 155) — fixed-position top-center toast. Currently used for save success and send progress/success/error.
  - `showAlert()` (line 141) — in-flow banner at top of page. Used for validation errors.
  - Button state toggling already exists: `save-reset-row` / `approve-send-row` toggle via `display` in the summary update function (lines 1029-1033).
* **Reuse Decision:** Will NOT reuse `showToast()` for these specific actions (that's the whole point). Will keep `showToast` available for other uses. Will reuse the existing row-toggle pattern.
* **Relevant Files:**
  - `document-manager.html` (lines 272-286) — button HTML
  - `assets/js/document-manager.js` — `confirmSubmit()` (line 1291), `approveAndSendToClient()` (line 1725)
  - `assets/css/document-manager.css` — `.actions-row` (line 838)
* **Flow:** `confirmSubmit()` → API call → on success: `showToast('נשמר!')` + `loadDocuments()` → `loadDocuments` re-renders → summary update toggles rows (hasChanges=false → shows approve-send-row, hides save-reset-row)

## 5. Technical Constraints & Risks
* **Timing:** After `confirmSubmit()` succeeds, `loadDocuments()` is called which re-fetches from API and re-renders. The row toggle happens in the re-render. We need to intercept this to show the success state on the save button BEFORE the row swap, then after 1.5s allow the row swap to happen.
* **Race condition:** `loadDocuments()` is async and may complete before the 1.5s success display. Need to delay the row swap.
* **Send button re-send:** The send button can be used to resend (if already sent). After send, it should show "נשלח ללקוח ✓" and disable.
* **Error handling:** On error, button must revert to original clickable state.

## 6. Proposed Solution (The Blueprint)
### Logic Flow

**Save flow (confirmSubmit):**
1. User clicks "שמור שינויים" in modal → `confirmSubmit()` fires
2. Modal closes (existing behavior)
3. **NEW:** Set save button to loading state: `⟳ שומר שינויים...` (disabled, spinner)
4. API call completes successfully
5. **NEW:** Set save button to success state: `✓ נשמר!` (green, 1.5s)
6. After 1.5s → call `loadDocuments()` (which re-renders and swaps rows)
7. The approve-send-row now shows with text "שלח ללקוח" (not "אשר ושלח ללקוח")
8. On error → revert button to original state, show alert

**Send flow (approveAndSendToClient):**
1. User clicks "שלח ללקוח" → confirm dialog → confirmed
2. **NEW:** Set send button to loading state: `⟳ שולח ללקוח...` (disabled, spinner)
3. Remove `showToast('שולח...')` call
4. API call completes successfully
5. **NEW:** Set send button to success state: `✓ נשלח!` (green, 1.5s)
6. After 1.5s → set final disabled state: `נשלח ללקוח ✓` with disabled styling
7. Remove `showToast('נשלח!')` call
8. On error → revert button, show inline error text or alert

### CSS Changes
- Add `@keyframes spin` for the spinner icon rotation
- Add `.btn-loading` class: disabled state with spinner
- Add `.btn-success-flash` class: brief green success state
- Add `padding-bottom: var(--sp-5)` to `.actions-row`

### Helper Function
Create `setBtnState(btn, state, text)` — manages button innerHTML + class + disabled:
- `'loading'`: adds `.btn-loading`, sets spinner + text, disabled=true
- `'success'`: adds `.btn-success-flash`, sets ✓ + text, disabled=true
- `'idle'`: removes special classes, restores original content, disabled=false

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `github/annual-reports-client-portal/assets/css/document-manager.css` | Modify | Add spinner keyframes, `.btn-loading`, `.btn-success-flash`, actions-row padding |
| `github/annual-reports-client-portal/assets/js/document-manager.js` | Modify | Add `setBtnState()`, update `confirmSubmit()` flow, update `approveAndSendToClient()` flow |
| `github/annual-reports-client-portal/document-manager.html` | Modify | Change "אשר ושלח ללקוח" text to "שלח ללקוח" |

### Final Step
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan
* [ ] Click "שמור שינויים" → modal confirms → button shows spinner "שומר שינויים..." → success "נשמר!" for ~1.5s → row swaps to "שלח ללקוח"
* [ ] Click "שלח ללקוח" → confirm dialog → button shows spinner "שולח ללקוח..." → success "נשלח!" → disabled "נשלח ללקוח ✓"
* [ ] Error case: simulate API failure → button reverts to clickable state
* [ ] Verify bottom spacing — buttons have breathing room from component boundary
* [ ] Verify re-send scenario (already sent) — still works with inline states
* [ ] Verify mobile layout — buttons and states display correctly on narrow screens

## 8. Implementation Notes (Post-Code)
**Commits:** e9fedba, d1b7e36

Implemented as planned. One post-implementation fix:
- **Bug:** After send → make changes → save → send button showed "✓ נשלח ללקוח" (disabled) instead of resetting to clickable "שלח ללקוח".
- **Fix:** Added `setBtnState(sendBtn, 'idle')` call in `updateUI()` when the approve-send row becomes visible again (no pending changes). This resets the button to its original state after each save-change cycle.
