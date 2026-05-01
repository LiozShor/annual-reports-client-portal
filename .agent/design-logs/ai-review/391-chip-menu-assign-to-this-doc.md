# Design Log 391: Chip Menu "Assign to This Doc"

> **Renumbered from DL-390 → DL-391** at push time: another session shipped a different DL-390 (`reminder-next-date-skip-weekend`) before this branch was pushed. Branch + DL file renamed; commit message reflects DL-391.
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-01
**Related Logs:** DL-386 (parent — inline prompt after add-doc), DL-351 (chip menu Edit/divider pattern), DL-330 (3-pane layout), DL-227 (inline doc tag rendering), DL-053 (silent refresh)

## 1. Context & Problem

DL-386 added a "+" chip + AI-aware add-doc popover and an **inline prompt** anchored to a freshly-created chip — when admin adds a new required doc while one AI cockpit card is `preview-active`, the prompt offers to reassign that card's file to the new chip in one click.

The follow-up captured at DL-386 close (2026-05-01 in current-status.md) is the symmetric affordance: **same one-click reassign, but reachable from any *existing* chip in the required-docs section**, not just the just-created one. Today the existing chip's `openDocTagMenu` only offers status changes (Required_Missing / Received / Waived) + Edit name (DL-351). There's no way to say "the file in the active card belongs in *this* slot" without leaving the menu and using the inline reassign combobox / modal.

Goal: when **exactly one** AI review card is `preview-active` at click time AND the chip's status is `Required_Missing`, prepend a single Hebrew menu item as the **first** menu option. Click → call existing `submitAIReassign(activeCardId, chip.template_id, chip.doc_record_id)`. No confirm dialog (one-click; reversible via existing Undo / re-review path).

## 2. User Requirements (Q&A)

1. **Q:** Branch setup?
   **A:** New `DL-391-assign-to-this-doc-from-chip-menu` branch (multi-tab safety).
2. **Q:** Which chip statuses should show this option?
   **A:** `Required_Missing` only — reassigning to an already-Received slot would orphan/overwrite the existing file.
3. **Q:** Confirm dialog?
   **A:** No — one-click submit. Action is reversible via existing Undo toast / re-review path. Symmetric with DL-386's post-add prompt; should not be friction-doubled.
4. **Q:** Visibility — always render or only when active card present?
   **A:** Only when `aiActionsPanel[data-item-id]` is set. If absent, the menu is unchanged from today (no new item).

## 3. Research

### Domain
Context-sensitive menu items in chip/tag systems; primary-action ordering inside a contextual menu.

### Sources
1. **NN/g — "Designing Effective Contextual Menus: 10 Guidelines"** (Kaplan, 2025). Most relevant: Guideline 1 (use for secondary actions — primary actions stay surfaced); Guideline 4 (group related contextual actions); Guideline 5 (consistent representation); Guideline 8 (avoid one/few-action menus — we already have 4 items, adding 1 is fine).
2. **Material Design 3 — Menus** (m2.material.io/components/menus). Reinforces ordering by frequency/importance; first item should match user expectation when contextually triggered.
3. **In-repo prior art — DL-351** and **DL-386**. DL-351 established the divider pattern. DL-386 established the gated-on-active-card reassign-via-`submitAIReassign` pattern; this DL extends it.

### Principles
- **Reuse over reinvent**: call existing `submitAIReassign(cardId, templateId, docRecordId)` (script.js:7773) — same path DL-386's inline prompt uses (script.js:11523).
- **Context-gated visibility**: option only renders when actionable (active card present). NN/g G1 — don't show actions that can't fire in the current context.
- **First item = primary intent**: when an admin opens a chip menu *while a preview is open*, the most likely intent is "this file belongs here." Status changes are secondary in that context.
- **Status gate**: only `Required_Missing` chips. Avoid silent overwrite of already-Received slots.

### Anti-Patterns Avoided
- Showing the option always (greyed when no active card) — adds noise, violates G1.
- Confirm dialog — friction-doubles vs. DL-386's one-click inline prompt; reassign is reversible.
- Repurposing `selectDocTagStatus` to also handle reassign — keep handlers single-purpose.
- Mirroring on Received chips — different semantics (overwrite confirm); not in scope.

### Verdict
Add a new top-of-menu item `selectDocTagAssignToCard` only when (a) chip status === `Required_Missing` AND (b) `aiActionsPanel[data-item-id]` is non-empty AND (c) the active card's current `doc_record_id` differs from this chip. Click closes menu and calls `submitAIReassign(activeCardId, templateId, docRecordId)`. No new endpoint, no new state. Single-file change.

## 4. Codebase Analysis

### Touch points
- `frontend/admin/js/script.js:9104-9119` — `renderDocTag(d)` — chip render. Already exposes `data-doc-record-id` and `data-status`. Need also `data-template-id` for the new handler.
- `frontend/admin/js/script.js:9121-9171` — `openDocTagMenu(event, tagEl)` — menu builder. Reads `currentStatus` and `docRecordId` from data attrs. Builds 3 status options + DL-351 Edit divider. The new item is **prepended** before the existing `statusItemsHtml`.
- `frontend/admin/js/script.js:7773` — `submitAIReassign(recordId, templateId, docRecordId, loadingText, newDocName, forceOverwrite, targetReportId)` — existing reassign path; line 11523 already calls the 3-arg form (DL-386 inline prompt).
- `frontend/admin/js/script.js:10807` — `aiActionsPanel.dataset.itemId` is the active-card record id (DL-339).
- `frontend/admin/js/script.js:9173-9193` — `selectDocTagStatus` — shape mirror for new `selectDocTagAssignToCard`.

### Why not extend `selectDocTagStatus`?
Different semantics (no client-name resolution; recordId comes from active card, not the tag). Single-purpose handler matches DL-351's `selectDocTagEdit`.

### CSS
No new rule — re-use `.ai-doc-tag-menu-item` and existing `.ai-doc-tag-menu-divider`.

### Cache-bust
Last bumped at v=394. New: `script.js?v=395`. `frontend/admin/index.html:1548`.

## 5. Constraints & Risks

- **Stale chip data**: `data-template-id` must be present at render time. `renderDocTag` reads `d.template_id` from the input doc object — present on canonical doc-row shape.
- **Active-card transitions**: `aiActionsPanel.dataset.itemId` may briefly be unset (DL-340/341 auto-advance). Re-check at click time inside the new handler — if missing, no-op + close menu.
- **General docs** (`template_id === 'general_doc'`): `submitAIReassign` already has the path (line 7750/7767). No special-casing.
- **No-op same-card**: if active card's `doc_record_id` already === chip's `doc_record_id`, suppress the option in `openDocTagMenu`.
- **Backwards compat**: pure additive. PA tab unaffected (PA uses `openPaDocTagMenu`).

## 6. Proposed Solution

### Logic flow

1. **`renderDocTag(d)`** — add `data-template-id` to the chip span.
2. **`openDocTagMenu`** — at top of menu build, conditionally compute `assignItemHtml`:
   - Read `aiActionsPanel.dataset.itemId`. Empty → no item.
   - Check `currentStatus === 'Required_Missing'`. Otherwise → no item.
   - Find active item in `aiClassificationsData`; if its `doc_record_id` already matches this chip → no item.
   - Else render a button with `📎` icon + Hebrew label, followed by a divider, before `statusItemsHtml`.
3. **New `selectDocTagAssignToCard`**: pull `docRecordId` + `templateId`, close menu, re-resolve active itemId, call `submitAIReassign(activeItemId, templateId, docRecordId)`.

### Files to change

| File | Change |
|------|--------|
| `frontend/admin/js/script.js` | (a) `data-template-id` on chip span. (b) Conditional menu item in `openDocTagMenu`. (c) New `selectDocTagAssignToCard` handler. |
| `frontend/admin/index.html` | Cache-bust `script.js?v=394 → ?v=395`. |

No CSS, HTML structural, Worker, or schema changes.

## 7. Validation Plan

- [ ] AI Review tab on a client with multiple `Required_Missing` chips and ≥1 pending classification.
- [ ] **No active card**: click any `Required_Missing` chip → menu shows only the existing 3 items (status options + Edit name). New item NOT visible.
- [ ] **Active card open**: click pending classification → preview opens, panel hydrates. Click an unrelated `Required_Missing` chip → "📎 שייך את התצוגה הפעילה למסמך זה" appears as **first** item, divider below it, status options + Edit name follow.
- [ ] **Click "Assign to this doc"** → loading toast → success. Card moves to reviewed; chip flips to Received via silent refresh. Card auto-advances (DL-341).
- [ ] **Same-doc no-op guard**: option hidden on the chip already linked to the active card.
- [ ] **Status gate**: open menu on a `Received` / `Waived` / `Requires_Fix` chip → option NOT visible.
- [ ] **General doc chip**: option appears + reassign succeeds.
- [ ] **Spouse-doc chip**: option appears + reassign succeeds.
- [ ] **Mobile accordion**: same flow works.
- [ ] **No regression on PA tab**: PA chips don't use `openDocTagMenu` (separate `openPaDocTagMenu`).
- [ ] **Cache-bust verified** in DevTools: `script.js?v=395`.

## 8. Implementation Notes

- **Field name correction during impl**: classification items in `aiClassificationsData` key on `id` (not `record_id`) and the currently-linked doc is `item.matched_doc_record_id` (not `doc_record_id` — that field lives on doc rows under `item.all_docs[]`). Verified via grep at write time — would have shipped silent no-op on the dedup guard otherwise. Logging here so future readers don't repeat the assumption.
- **Same-doc guard is defensive**: a `Required_Missing` chip by definition has no file linked, so `matched_doc_record_id !== docRecordId` is virtually always true under the `Required_Missing` gate. Kept anyway as a no-op safety net (e.g., if Airtable rollup lag briefly leaves a chip flagged Required_Missing while a classification already points there).
- **Cache-bust**: plan said v=393; actual was v=394 in `index.html` at impl time (DL-388 had bumped further). Bumped to v=395.
- **submitAIReassign re-use**: 3-arg form `(recordId, templateId, docRecordId)` — same call shape as DL-386's inline prompt at line 11523. Toast, silent refresh, and DL-341 auto-advance all handled inside `submitAIReassign`.
- **Visibility recap**: option appears iff (a) `aiActionsPanel.dataset.itemId` is non-empty, (b) chip status is `Required_Missing`, (c) chip has a `template_id` (added in this DL), and (d) the active item's `matched_doc_record_id !== docRecordId`. Otherwise the menu is identical to DL-351's.

### Files changed
- `frontend/admin/js/script.js` — `renderDocTag` adds `data-template-id`; `openDocTagMenu` prepends gated `assignItemHtml`; new `selectDocTagAssignToCard` handler.
- `frontend/admin/index.html` — cache-bust `v=394 → v=395`.
