# DL-405: Unify Right-Click Context Menu and Kebab Menu (Single Source of Truth)

**Status:** `[COMPLETED — 2026-05-12]`
**Branch:** `DL-405-unify-context-menus`
**Domain:** admin-ui (frontend-only)
**Related:** DL-123 (contextual-menu UX research), DL-152 (move view-as-client to row menu), DL-124 (dashboard actions revamp), DL-366 (kebab CC + resend), DL-404 (merge clients — added "merge" to wrong menu)

---

## 1. Context & Problem

The dashboard had two visually-distinct menus that act on the same client row but offered **different action sets**:

- **Right-click context menu** (`openClientContextMenu` at `frontend/admin/js/script.js:14063`). Showed: send questionnaire, send reminder, fill questionnaire on behalf, view questionnaire, view as client, add second filing type, **merge with another client (DL-404)**, archive.
- **Kebab `⋮`** (per-row template). Showed: view as client, view questionnaire, **add/edit CC email (DL-366)**, **copy questionnaire link (DL-366)**, add second filing type, archive.

Drift caught during DL-404 smoke-test: T8 added "מזג עם לקוח אחר" to the right-click handler but NOT the kebab template — so the merge action was reachable from right-click only. Each new feature DL had to remember to update both menus or one drifted. Today's drift: kebab was missing 4 right-click actions (send/remind/fill-on-behalf/merge), right-click was missing 2 kebab actions (CC email/copy link).

**Outcome:** a single shared item-list helper used by all three render sites (right-click, desktop kebab, mobile kebab). One place to add or edit any client-row action; both menus always stay in sync.

## 2. User Requirements (Q&A)

| # | Question | Decision |
|---|----------|----------|
| 1 | How to unify? | Single shared item-list helper, both menus render identical HTML |
| 2 | Item set? | Union of all current items (~10 actions) |
| 3 | Mobile parity? | Yes — mobile kebab gets full set |
| 4 | Layout / grouping? | 4 groups separated by `<hr>`: Send / View / Edit / Danger; most-used at top of each group |
| 5 | Touch parity? | Yes — long-press ≈500ms on mobile cards opens menu at finger position |
| 6 | Keyboard polish? | ARIA roles + arrow-key nav + Esc-to-close. No visible shortcut hints, no global shortcut bindings (deferred to follow-up DL) |
| 7 | DL-404 merge-in-wrong-menu bug? | Fixed automatically by the unification (both menus share the same items). Note in DL-404 §8 Implementation Notes for historical record. |

## 3. Research

Domain: contextual action menu UX for table-row entity actions. Primary research already completed in **DL-123 "Contextual Action Menu UX Research"** (2026-03-08) — citing rather than duplicating.

Principles applied:
- **Linear: comprehensive coverage from a single menu** → drives the union approach.
- **Linear: right-click OR Cmd+K opens contextual actions** → both reach the same item set.
- **NN/g: kebab `⋮` for item-specific actions, used consistently** → preserved.
- **PatternFly: divider above destructive items + danger styling** → 4 groups with `<hr>` between, danger group last.
- **Smashing — Hidden vs Disabled**: stage-bound items (send questionnaire, send reminder) stay hidden when irrelevant.
- **NN/g + WAI-ARIA**: `role="menu"` on container, `role="menuitem"` on each button, arrow-key nav, Esc closes.

## 4. Codebase Analysis

**Render sites before:**
| Site | File:line | Items |
|------|-----------|-------|
| Right-click context menu | `script.js:14063` (`openClientContextMenu`) | 8 active / 3 inactive |
| Desktop row kebab | `script.js:1714` (in `renderClientsTable`) | 6 active / 4 inactive |
| Mobile card kebab | `script.js:1782` (mobile template) | 6 active / 4 inactive |

**Reused without rewriting:** `closeAllRowMenus`, `toggleRowMenu`, `STAGES[stage].num`, `clientsData`, `getClientOtherFilingType`, `FILING_TYPE_LABELS`, `icon()` (DL-314), `escapeAttr`/`escapeHtml`, `showConfirmDialog`, all existing onclick handlers (`sendSingle`, `sendDashboardReminder`, `openAssistedQuestionnaire`, `viewQuestionnaire`, `viewClient`, `openCcEmailFromKebab`, `copyQuestionnaireLink`, `addSecondFilingType`, `openMergeClientsDialog`, `deactivateClient`, `reactivateClient`).

## 5. Constraints & Risks

| Risk | Mitigation |
|------|------------|
| Monolith size ratchet | New module `frontend/admin/js/modules/client-row-actions.js`. Net script.js delta = **−80 lines** (16217 → 16137). |
| Long-press conflicts with scroll | 500ms threshold + cancel on `touchmove` >10px. |
| Long-press conflicts with tap-to-open-card | Suppress synthetic click for 400ms after long-press fires. Plus skip long-press when `touchstart` target is an interactive element (button, input, link, stage-badge, etc). |
| Right-click positioning logic | Extracted to `_positionMenuAt(menu, x, y)` inside the module; reused by long-press. |
| Stage-aware visibility logic | Centralized in `_buildItems` with per-item `show` predicates evaluated identically in all 3 sites. |
| Cache-bust | `script.js?v=416 → 417`; new `<script src="js/modules/client-row-actions.js?v=1">` added before script.js. |

No backend / API / schema risk — frontend-only.

## 6. Implemented Solution

### 6.1 New module: `frontend/admin/js/modules/client-row-actions.js`

Exports on `window`:
- `buildClientRowActionsHtml(client, { rid, isActive, stage })` — returns inner HTML for either menu container.
- `openClientContextMenuAt(x, y, client)` — opens singleton `#clientContextMenu` at viewport coords (right-click + long-press).
- `attachLongPressMenu(rootEl)` — wires `touchstart/move/end/cancel` to fire menu at finger position after 500ms hold on any descendant `[data-report-id]`.
- `clientRowActionsMenuKeydown(e)` — keyboard handler (ArrowUp/Down, Home/End, Esc, Tab); auto-wired on the singleton + via document-delegated keydown for per-row `.row-menu`.

Items live in one array, `_buildItems(client, ctx)`, with per-item `{ group, show, icon, label, onClick, danger? }`. Renderer groups items into 4 buckets (`send` / `view` / `edit` / `danger`), drops empty buckets, joins surviving buckets with a single `<hr>` between them — no leading/trailing dividers.

### 6.2 `frontend/admin/js/script.js` changes

- `openClientContextMenu` (~70 lines) → 9 lines that delegate to `window.openClientContextMenuAt`.
- Desktop row kebab (~14 lines of inline HTML) → 1-line call to `window.buildClientRowActionsHtml`.
- Mobile card kebab (~14 lines of inline HTML) → 1-line call to `window.buildClientRowActionsHtml`.
- Removed now-dead locals `otherType`/`otherTypeLabel` and `mOtherType`/`mOtherTypeLabel` — module computes them.
- Long-press wired right next to existing `contextmenu` listener.
- `aria-haspopup="menu"` added to both `⋮` opener buttons; `role="menu"` added to both `.row-menu` containers.

### 6.3 `frontend/admin/index.html`

- Added `<script src="js/modules/client-row-actions.js?v=1">` before `js/script.js`.
- Bumped `script.js?v=416 → 417`.

### 6.4 CSS

Untouched — existing `.row-menu` / `#clientContextMenu` / `button.danger` styles cover the new HTML unchanged.

## 7. Validation Plan

- [ ] **Identical item set across all 3 sites** for the same client/stage.
- [ ] **DL-404 merge action visible everywhere:** "מזג עם לקוח אחר" in right-click + desktop kebab + mobile kebab on any active client.
- [ ] **DL-366 CC email + copy-link visible in right-click** too (right-click was missing them before).
- [ ] **Stage-bound actions hidden when out-of-context** (send questionnaire only at Send_Questionnaire; send reminder only at Waiting_For_Answers / Collecting_Docs; view questionnaire only at stage 3+).
- [ ] **Inactive client → archive items only** ("צפייה כלקוח" + "הפעל מחדש").
- [ ] **Long-press on mobile** (≥500ms) opens menu at finger position; short tap does NOT open menu (falls through to existing card-tap behavior).
- [ ] **Long-press cancellation:** start hold, scroll before 500ms — menu does NOT open.
- [ ] **Esc closes menu** in all sites.
- [ ] **Arrow-key nav:** open menu → Down moves focus → Enter activates → Esc closes.
- [ ] **ARIA in DOM:** inspect rendered menu, confirm `role="menu"` on container, `role="menuitem"` on each button, `aria-haspopup="menu"` on opener.
- [ ] **Group dividers:** all-4-groups menu renders exactly 3 `<hr>`; 2-group menu renders exactly 1 `<hr>`; no leading/trailing `<hr>`.
- [ ] **Hebrew RTL clamp at viewport edge:** right-click near right edge → menu clamps inside.
- [ ] **Monolith ratchet:** `python .claude/hooks/script-size-ratchet.py` PASS — script.js shrank 16217 → 16137 (-80).
- [ ] **Cache-bust:** `curl -sI https://docs.moshe-atsits.com/assets/js/script.js?v=417` returns 200; `client-row-actions.js?v=1` served.
- [ ] **DL-404 follow-up:** smoke-test merge dialog from BOTH right-click AND kebab — both reach `openMergeClientsDialog`.

## 8. Implementation Notes

- **2026-05-06** Phase D executed in canonical clone (`C:/Users/liozm/Desktop/moshe/annual-reports/`) on branch `DL-405-unify-context-menus` — current session worktree's `.git` is broken from earlier cleanup-script collision.
- **Net delta on script.js:** -80 lines (16217 → 16137). Ratchet baseline left at 16217 (ceiling, not floor — shrink doesn't require baseline edit).
- **Long-press skip-list:** added defensive `e.target.closest('button, input, a, .stage-badge, .clickable-count, .clickable-docs, .notes-cell, .checkbox-cell, .mobile-card-checkbox, .mobile-card-name')` early-return in `touchstart` so long-press doesn't hijack interactive sub-elements on the mobile card.
- **Keyboard nav for per-row `.row-menu`:** wired via document-delegated `keydown` (single listener, dispatches by `closest('.row-menu')`) since per-row menus are rendered into the table HTML and there's no per-row mount hook to attach listeners on.
- **DL-404 erratum:** appended to DL-404 §8 — T8's merge action was added to the right-click handler at line 14100 but missed the kebab template; this DL closes that gap structurally.

---

## Files Modified

**New:**
- `frontend/admin/js/modules/client-row-actions.js`

**Edited:**
- `frontend/admin/js/script.js` (3 render sites collapsed; 2 dead-local pairs removed; long-press wired)
- `frontend/admin/index.html` (module include + cache-bust v=417)
- `.agent/design-logs/admin-ui/404-merge-clients.md` (§8 erratum)
- `.agent/design-logs/INDEX.md` (DL-405 row)
