# Design Log 387: Reassign Modal — Single-Click Custom Doc Submit
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-30
**Related Logs:** DL-301 (pa-add-doc-affordance), DL-336 (template picker UI), DL-350 (commit-then-assign actionsContainer)

## 1. Context & Problem

In the AI Review **re-assign modal** (`שיוך מסמך למסמך אחר`), when the user clicks "+ הוסף מסמך חדש" inside the combobox to reach the expanded picker and types a custom doc name (e.g. `בדיקה`) into `.ai-tpl-custom-input`, clicking the "שייך" (Assign) button does nothing. The user must first press Enter (or click "+ הוסף") to commit the typed name as a chip, *then* click "שייך". 2 user actions for what should be 1.

User report: "it won't allow me to end this dialog until I click enter. so 2 clicks - one enter, one Assign. too many clicks."

## 2. User Requirements

1. **Q:** Submit behavior for typed-but-not-added custom name when user clicks "שייך"?
   **A:** Auto-commit + assign — mirror DL-350 pattern; one click finishes the flow.
2. **Q:** When user types a custom name, should that override any previously selected template?
   **A:** Yes — typing wins.

## 3. Research

### Domain

UX micro-friction in form submission — "implicit commit" patterns where a separate explicit "add" action becomes optional because the primary submit button can infer intent.

### Sources Consulted

1. **Nielsen Norman Group — "Confirmation Dialogs Can Prevent User Errors – If Not Overused"** — Removing intermediate confirm steps that the user already implicitly demonstrated (typing then submitting) reduces friction without compromising safety.
2. **Material Design — Forms input patterns** — Treat the primary button as the canonical commit; secondary "add" affordances should be optional shortcuts, not required steps.
3. **DL-350 (this codebase)** — Established the commit-then-submit pattern in `actionsContainer` and AI review approve flow; precedent for the same pattern in reassign confirm.

### Key Principles Extracted

- **One intent, one click** — when the user has already typed text and clicked the primary action, infer the commit; don't gate on a redundant intermediate step.
- **Existing dead code is a bug** — DL-350's commit-then-submit branch already exists at `script.js:7680-7689` but is unreachable because the button is disabled. Fixing the gate, not adding new logic, is the minimal change.

### Patterns to Use

- **Live input → enable submit:** an `input` listener on `.ai-tpl-custom-input` flips `aiReassignConfirmBtn.disabled` to `false` as soon as text is present, by invoking the existing `onPick` callback with a `_pending: true` target.

### Anti-Patterns to Avoid

- **Removing the "+ הוסף" button entirely** — would break existing chip-based muscle memory and other callers of `_buildDocTemplatePicker`.
- **Auto-committing on every keystroke** — would prematurely render a chip and disrupt typing flow. Only enable the submit button; defer chip render until explicit commit OR final assign click.

### Research Verdict

Re-route the existing dead code path (DL-350 commit-then-submit at `script.js:7680-7689`) so it's actually reachable, by enabling the confirm button while the user is typing. No new submit logic needed.

## 4. Codebase Analysis

- **Existing Solutions Found:**
  - `confirmAIReassign()` at `script.js:7665` already has commit-then-submit branch at lines 7680-7689 (DL-350) that calls `submitAIReassign(recordId, 'general_doc', '', null, typed, false, null)` — this is the canonical fix path.
  - `_buildDocTemplatePicker()` at `script.js:7784` builds the picker with `customInput` + `customBtn` and binds Enter / click handlers (lines 7847-7848).
  - Same pattern lives at `script.js:8149-8158` for the picker `actionsContainer`.
- **Reuse Decision:** Reuse the entire existing commit-then-submit branch; only add an `input` listener to enable the confirm button live.
- **Relevant Files:** `frontend/admin/js/script.js` (the only edit). `frontend/admin/index.html` (cache-bust bump).
- **Existing Patterns:** Combobox `__NEW__` mode (line 3411-3425) uses an analogous "type-to-enable" pattern — its `input` listener at 3601-3608 sets `selectedValue = '__NEW__'` and calls `onSelect` whenever there's text.
- **Alignment with Research:** Strong — the codebase already practices "live input → enable submit" in the combobox; the picker just hadn't adopted it yet.
- **Dependencies:** None.

## 5. Technical Constraints & Risks

- **Security:** None. No new endpoints, no PII path changed.
- **Operational Risks:** Stale browser if cache-bust forgotten — covered by `script.js?v=389` bump.
- **Breaking Changes:** Other callers of `_buildDocTemplatePicker` (lines 5569, 8056) also pass `onPick` callbacks. The new `_pending: true` flag is just an extra property — existing callers only check truthiness, so it's transparent.
- **Mitigations:**
  - Cache-bust to 387.
  - Manually verify all 3 callers (line 5569, 7289, 8056) after edit.

## 6. Proposed Solution

### Success Criteria

User opens reassign modal → clicks "+ הוסף מסמך חדש" → types name → clicks "שייך" once → doc is reassigned with `general_doc` + `new_doc_name = typed`.

### Logic Flow

1. User types in `.ai-tpl-custom-input` → new `input` listener fires `onPick({ template_id: 'general_doc', new_doc_name: name, _pending: true })` (or `null` when empty).
2. Reassign caller's `onPick` (line 7290-7293) sets `_aiReassignExpandedTarget = target` and enables `aiReassignConfirmBtn`.
3. User clicks "שייך" → `confirmAIReassign()` runs.
4. Existing line 7671 short-circuit fires `submitAIReassign` with the `_pending` target — same end call as the chip-commit path: `submitAIReassign(recordId, 'general_doc', '', null, name, false, null)`.

### Data Structures / Schema Changes

None.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Add `input` listener inside `_buildDocTemplatePicker` (~line 7848) to keep confirm button enabled while typing. |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=385` → `?v=389`. |

### Final Step

- Update design log status to `[IMPLEMENTED — NEED TESTING]`.
- Update the design log index.
- Copy unchecked Section 7 items to `.agent/current-status.md` under Active TODOs.
- Invoke `git-ship` for commit/push.

## 7. Validation Plan

- [ ] Open admin → AI Review → click "שייך מחדש" on a pending classification → modal opens.
- [ ] Click combobox → "+ הוסף מסמך חדש" → expanded picker visible.
- [ ] Type `בדיקה` (no Enter, no "+ הוסף"). **Expected:** "שייך" button enables immediately.
- [ ] Click "שייך" once. **Expected:** doc reassigned to `general_doc` with `new_doc_name = "בדיקה"`, success toast shown.
- [ ] Regression: chip-commit path — type → "+ הוסף" → chip → "שייך" still works.
- [ ] Regression: combobox-only — pick existing template from dropdown → "שייך" still works.
- [ ] Regression: other `_buildDocTemplatePicker` callers at script.js:5569 and 8056 (PA picker) still function.

## 8. Implementation Notes

- **One edit instead of two.** The plan's "Change 2" in `confirmAIReassign` turned out to be unnecessary: the existing early-return at `script.js:7671` (`if (_aiReassignExpandedTarget) { ... submitAIReassign(recordId, t.template_id, t.doc_record_id || '', null, t.new_doc_name || '', false, null); return; }`) already handles a `_pending: true` target correctly — it calls `submitAIReassign(recordId, 'general_doc', '', null, name, false, null)`, identical to what the DL-350 commit-then-submit branch (lines 7680-7689) would do. So the single `input`-listener edit in `_buildDocTemplatePicker` is sufficient.
- Cache-bust: `script.js?v=385` → `?v=389` in `frontend/admin/index.html:1548`.
- Other callers of `_buildDocTemplatePicker` (script.js:5569 PA picker; 8056 picker host) — both pass `onPick` callbacks that do truthiness checks on the target; the new `_pending` flag is transparent to them.
- Principle applied: "Live input → enable submit" (mirroring the combobox `__NEW__` mode at script.js:3601-3608), and "fix the gate, not the logic" — re-routed DL-350's existing dead-code branch instead of duplicating it.
