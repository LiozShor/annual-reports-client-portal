# Design Log 351: Add Edit + Delete to AI Review doc tag menu
**Status:** [COMPLETED]
**Date:** 2026-04-26
**Related Logs:** DL-227 (original `openDocTagMenu` design), DL-080 / DL-107 / DL-299 (Document Manager inline-rename patterns), DL-205 (clear file fields on status revert)

## 1. Context & Problem
The user reported that doc tags in the AI Review banner (`<span class="ai-doc-tag-received|ai-missing-doc-tag" onclick="openDocTagMenu(...)">`) "used to" offer Edit/Delete and that this is now gone.

**Investigation finding:** Per `git log -S "openDocTagMenu"`, commit `b1754b6` (DL-227, 2026-03-30) introduced the menu with **only the 4 status options** (Required_Missing / Received / Waived / Requires_Fix). Edit and Delete have never existed on this menu. The menu still works in the new pane-2 cockpit banner (`renderClientDocsHtml` ~script.js:4282-4294 emits the same onclick markup; `openDocTagMenu` at script.js:7976 still appends a `position:fixed` menu to `document.body`).

Reframed via Phase A clarification: the user wants Edit and Delete **added** so they don't have to bounce to Document Manager for those actions. Treated as a feature add, not a regression fix.

## 2. User Requirements
1. **Q:** What happens when you click a doc tag? **A:** "ok i see options but i want also edit" — menu opens, but Edit/Delete are missing.
2. **Q:** Surface affected? **A:** Desktop pane-2 cockpit banner.
3. **Q:** Scope? **A:** Restore + extend.
4. **Q:** Should Received tags open the menu? **A:** Yes — allow status change from Received.
5. **Q:** What does Edit do? **A:** Inline rename of the doc.
6. **Q:** What does Delete do? **A:** Soft-delete = mark as Waived (no record removal).
7. **Q:** Menu layout? **A:** Below the 3 status options, with a divider.

## 3. Research
### Domain
Admin Dashboard UX, contextual action menus, inline rename patterns.

### Sources
- **DL-227** — original `openDocTagMenu` design + Material Design / Carbon DS / Optimistic UI research. Reuse principles directly.
- **DL-080 / DL-107 / DL-299** — Document Manager inline-rename pattern (`nameChanges` Map → `name_updates: [{id, issuer_name}]` extension).
- **NN/g — Contextual menus** — Group destructive actions visually (divider). Confirm hard-deletes; soft-deletes can skip confirm but here we add it because the verb "Delete" raises the user's mental risk threshold.

### Key principles
- Status options stay where they are (no behavior change for happy path).
- Reuse the proven optimistic-update + undo-toast pattern (`updateDocStatusInline`) for both Edit and Delete.
- Inline rename matches Document Manager precedent — Enter commits, Esc cancels, blur cancels.

### Anti-patterns avoided
- Native `confirm()` — use `showConfirmDialog` per CLAUDE.md UI rules.
- Hard-delete from a chip click — too dangerous; per user req, Delete = Waive.
- Mixing destructive + non-destructive menu items without visual separation.

### Verdict
Add Edit + Delete as two extra menu items below a divider in the existing `openDocTagMenu`. Edit triggers inline-rename via existing `name_updates` API extension. Delete delegates to existing `updateDocStatusInline(..., 'Waived')` after a confirmation modal.

## 4. Codebase Analysis
| Need | Existing function | Path |
|---|---|---|
| Render tag with onclick | `renderDocTag(d)` | `script.js:7959` |
| Status menu open / position | `openDocTagMenu(event, tagEl)` | `script.js:7976` |
| Status pick handler | `selectDocTagStatus(event, btnEl)` | `script.js:8018` |
| Close menu + cleanup | `closeDocTagMenu()` | `script.js:8037` |
| Optimistic update + refresh | `updateDocStatusInline` / `applyDocStatusChange` / `refreshClientDocTags` | `script.js:8047, 8139, 8173` |
| Toast w/ undo | `showAIToast(msg, type, action?)` | `script.js:8304` |
| Confirmation modal | `showConfirmDialog(message, onConfirm, confirmText, danger)` | `script.js:12424` |
| Rename API payload | `name_updates: [{id, issuer_name}]` extension | `api/src/routes/edit-documents.ts:119,218,273` |
| Inline rename UX precedent | Document Manager `nameChanges` Map / inline-edit handler | `frontend/assets/js/document-manager.js:85,1463,1492,1540,1711,1743` |
| Menu CSS | `.ai-doc-tag-menu`, `.ai-doc-tag-menu-item`, `.ai-doc-tag-menu-icon` | `frontend/admin/css/style.css:2660-2693` |

**Reuse:** `openDocTagMenu`, `closeDocTagMenu`, `selectDocTagStatus`, `updateDocStatusInline` (for delete), `showAIToast`, `showConfirmDialog`, `name_updates` API extension, all existing menu CSS.

**Add:** divider in `openDocTagMenu` markup; new `selectDocTagDelete`, `openDocTagInlineRename`, `commitDocTagRename`, `applyDocNameChange` handlers; new `.ai-doc-tag-menu-divider` + `.ai-doc-tag-rename-input` CSS rules.

## 5. Technical Constraints & Risks
- **`tagEl.closest('.ai-accordion')` lookup:** still resolves in the pane-2 cockpit because pane-2 wraps clients in `.ai-accordion[data-client]` (verified by `refreshClientDocTags` at 8174 successfully querying it). No fix needed.
- **Inline-rename horizontal space:** tags live inside `flex-wrap` row; small width. Solution = replace tag inner with `<input>` that grows to fit content + min-width 120px. Enter commits, Esc cancels, blur cancels.
- **"Delete = Waived" redundancy:** functionally identical to the existing "Waive" status option. Differentiator = confirmation modal + the Delete-labeled menu item (clearer mental model for "make this go away" than the "Waive" label).
- **Idempotency:** rename early-returns if `newName === currentName`; status delete early-returns if already Waived (via existing `updateDocStatusInline` guard at line 8059).
- **Security/PII:** no new endpoints, existing Bearer auth, doc names are not PII.

## 6. Proposed Solution

### Success Criteria
Admin clicking any doc tag sees a menu with 3 status options (filtered to exclude current) + divider + Edit (pencil icon) + Delete (trash icon). Edit converts the tag to an inline `<input>` that commits on Enter via `name_updates`. Delete confirms then delegates to existing waive flow. Both show undo toast and rollback on API failure.

### Logic Flow
**Edit:**
1. Click Edit menu item -> `closeDocTagMenu()` -> `openDocTagInlineRename(docRecordId, tagEl)`.
2. Replace `tagEl.innerHTML` with `<input class="ai-doc-tag-rename-input" value="<currentName>">`, focus + select.
3. On Enter or blur: if value changed and non-empty -> optimistic mutate + refresh + POST `/edit-documents` `extensions.name_updates: [{id, issuer_name: value}]` -> success toast with undo.
4. On Esc / empty / unchanged -> restore tag (no API call).
5. On API failure -> revert + danger toast.

**Delete:**
1. Click Delete menu item -> `closeDocTagMenu()` -> `showConfirmDialog(<remove-from-list prompt>, onConfirm, <delete-label>, true)`.
2. On confirm -> `updateDocStatusInline(clientName, docRecordId, 'Waived')` (existing flow).
3. Toast + undo from existing flow.

### Files to Change
| File | Action | Description |
|---|---|---|
| `frontend/admin/js/script.js` | Modify | Add Edit + Delete entries with divider in `openDocTagMenu`; add `openDocTagInlineRename`, `commitDocTagRename`, `applyDocNameChange`, `undoDocNameChange`, `selectDocTagDelete` |
| `frontend/admin/css/style.css` | Modify | Add `.ai-doc-tag-menu-divider` + `.ai-doc-tag-rename-input` |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=339` → `?v=340` |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-351 entry |
| `.agent/current-status.md` | Modify | Append Section 7 test items |

### Final Step (Always)
Housekeeping → status `[IMPLEMENTED — NEED TESTING]`, copy Section 7 to `current-status.md`, commit + push feature branch. **Pause for explicit approval before merge to main** (memory: `feedback_ask_before_merge_push`). No backend → no `wrangler deploy`.

## 7. Validation Plan
- [ ] Click any doc tag in pane-2 cockpit banner -> menu shows 3 status options (current excluded), divider, Edit, Delete.
- [ ] Click Edit -> tag becomes editable input pre-filled with current name; cursor + selection ready.
- [ ] Type new name + Enter -> tag updates immediately, success toast with undo. Verify Airtable `Issuer_Name` (or relevant field) updated.
- [ ] Esc during rename -> tag reverts, no API call.
- [ ] Empty input + Enter -> tag reverts (no destructive empty-name save).
- [ ] Blur without change -> tag reverts (no API call).
- [ ] Click Delete -> confirmation modal (remove-from-list prompt) with red destructive button.
- [ ] Confirm delete -> tag becomes Waived (dim + strikethrough + "-" prefix). Identical to existing waive path.
- [ ] Cancel delete -> no change, menu stays closed.
- [ ] Undo on Edit reverts the rename (server side too).
- [ ] Undo on Delete reverts to Required_Missing (existing path).
- [ ] Existing 3 status options still work -- no regression on Missing/Received/Waived.
- [ ] Received tags open the menu and offer the same 5 actions (per Q4).
- [ ] Mobile accordion: menu still opens, inline rename input fits or wraps reasonably.
- [ ] No console errors. Hard-refresh (cache-bust) shows new build.

## 8. Implementation Notes
- `openDocTagMenu` (script.js:7976) extended: status options rendered first; new divider + 2 buttons appended (Edit + Delete).
- `selectDocTagEdit` / `selectDocTagDelete` look up the tag via combined CSS-class selector (`ai-missing-doc-tag, ai-doc-tag-received, ai-doc-tag-waived, ai-doc-tag-requires-fix`) since `ai-doc-tag-active` is removed by `closeDocTagMenu` before the handler runs — selecting by class union is safer than by `.ai-doc-tag-active`.
- `openDocTagInlineRename` mirrors Document Manager's rename UX (Enter commits, Esc/blur cancels, empty/unchanged = no-op). Uses `tagEl.dataset.editing='1'` flag + early-return guard in `openDocTagMenu` to prevent re-opening the menu mid-edit.
- Blur-cancel uses a 50ms `setTimeout` so Enter-keydown commit wins the race.
- `applyDocNameChange` mutates `name_short` AND `name` on the doc entry in both `all_docs` and `missing_docs` arrays; `refreshClientDocTags` then re-renders via existing `renderDocTag` which prefers `name_short`.
- `commitDocTagRename` / `undoDocNameChange` reuse the same `POST /edit-documents` payload shape as Document Manager (`name_updates: [{id, issuer_name, old_name}]`).
- Delete delegates to existing `updateDocStatusInline(..., 'Waived')` — no new code path, undo toast already provided by that function.
- CSS: divider is 1px `--gray-200` with small vertical margin; `--danger` action gets red text + light red hover (matching project token usage pattern).
- Out of scope (queued for follow-up DL): same treatment for PA queue (`openPaDocTagMenu`, script.js:9091).

### Research principles applied
- Material Design / Carbon DS (DL-227 research): divider visually separates destructive section.
- Optimistic UI with rollback (DL-227): both rename + delete update DOM first, fire API in background, revert on failure.
- Undo toast (NN/g): reversibility for soft-delete + rename without modal-confirmation friction.
- Document Manager rename precedent (DL-080/107/299): same `name_updates` payload shape, same Enter/Esc UX.
