# Design Log 350: AI Review reassign — locked "שייך" button + 404 console errors
**Status:** [COMPLETED]
**Date:** 2026-04-26
**Related Logs:** DL-334 (3-pane rework), DL-339 (move actions to pane2), DL-330 (inline comboboxes)

## 1. Context & Problem

After the DL-345 → DL-348 merges, two regressions surfaced in the AI Review tab while reassigning a doc:

1. **Locked assign button** — selecting a doc in the reassign combobox does not enable the "שייך" button. The user is stuck on the card.
2. **Console 404s** — DevTools shows three `404` responses on a URL truncated as `…ew-classification`. Live `/webhook/review-classification` actually returns 400/401 (route exists, deployed), so the source path of the 404 is unconfirmed.

Both bugs are scoped to the AI Review reassign flow.

## 2. User Requirements

1. **Q:** Action that triggered the 404? **A:** Clicked "שייך מחדש" and picked a template.
2. **Q:** Exact 404 URL? **A:** Unknown — user forwarded screenshot. Reproducible on CPA-XXX in production.
3. **Q:** Environment? **A:** Production (docs.moshe-atsits.com).
4. **Q:** Regression vs long-standing? **A:** Just appeared today after recent merges.
5. **Q:** Scope of fix? **A:** Bug 1 first (root cause confirmed); Bug 2 deferred until full URL captured.

## 3. Research

### Domain
Frontend DOM scoping after a layout rework — regression caused by an ancestor-class lookup that wasn't updated when the surrounding container class changed.

### Sources Consulted
1. **DL-339 v1.5 audit comment (script.js:7129-7133)** — prior fix for the same class of bug in `assignAIUnmatched`: "audit this desktop-or-mobile call site — the panel scope is `.ai-actions-panel`, the mobile fat-card scope is `.ai-card-actions`. Without this fallback the combobox lookup below throws on every desktop [שייך] click in State D / State B fallback." That fix used `closest('.ai-card-actions') || closest('.ai-actions-panel')`.
2. **DL-334 / DL-339 design logs** — moved actions out of the fat card into the right-pane actions panel on desktop. Mobile fat-card path retained for narrow viewports.
3. **MDN: Element.closest()** — returns `null` when no matching ancestor exists; combined with `?.` it silently no-ops.

### Key Principles Extracted
- **Ancestor-class lookups must enumerate every container the element can live in.** When a layout rework introduces a second container, every `closest()` must be revisited, not just the call sites flagged at audit time.
- **Silent failures from `?.` are footguns** when the right-hand operand has user-visible side effects (here: enabling a button).

### Patterns to Use
- **Multi-scope `closest()` fallback:** `el.closest('.scopeA') || el.closest('.scopeB')` — the same pattern already used in `assignAIUnmatched` (DL-339 v1.5).

### Anti-Patterns to Avoid
- **Branching on viewport (`isAIReviewMobileLayout()`)** for DOM scope — fragile across responsive transitions; falling-back-by-class is robust to either layout.

### Research Verdict
Reuse the existing DL-339 v1.5 pattern verbatim in `initAIReviewComboboxes` `onSelect`. One-line scope change.

## 4. Codebase Analysis

* **Existing Solutions Found:** `assignAIUnmatched` already implements the multi-scope fallback (`script.js:7133`). Pattern is in-tree.
* **Reuse Decision:** Apply the same fallback to the combobox `onSelect` in `initAIReviewComboboxes`.
* **Relevant Files:**
  * `frontend/admin/js/script.js:5168-5190` — `initAIReviewComboboxes` (the bug)
  * `frontend/admin/js/script.js:7128-7158` — `assignAIUnmatched` (existing pattern)
  * `frontend/admin/js/script.js:4431-4486` — `renderActionsPanel` (where desktop combobox is rendered)
  * `frontend/admin/js/script.js:4555,4587` — `.doc-combobox-container.ai-ap-combobox` markup
  * `frontend/admin/js/script.js:4717-4737` — `.btn-ai-assign-confirm` button markup inside `.ai-ap-primary-actions`
  * `frontend/admin/index.html:1524` — script.js cache-bust
* **Existing Patterns:** Combobox + button colocation works on mobile because both share `.ai-card-actions`. Desktop split them into siblings under `.ai-actions-panel`.
* **Alignment with Research:** Direct match — DL-339 already established the cure.
* **Dependencies:** None; pure DOM-scoping fix.

## 5. Technical Constraints & Risks

* **Security:** None — pure UI handler.
* **Risks:** None expected. The fallback only fires when `.ai-card-actions` lookup fails, which is precisely the desktop case currently broken.
* **Breaking Changes:** None. Mobile path unchanged (first branch of the `||` still resolves).

## 6. Proposed Solution (The Blueprint)

### Success Criteria
On both desktop and mobile, selecting a doc in the AI Review reassign combobox immediately enables the "שייך" button and reassign succeeds end-to-end.

### Logic Flow
1. User opens reassign combobox in actions panel.
2. `onSelect(templateId)` fires.
3. Look up scope as `.ai-card-actions || .ai-actions-panel`.
4. Find `.btn-ai-assign-confirm` inside scope.
5. Toggle `disabled` based on `templateId` truthiness.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` (~5180) | Modify | Add `.ai-actions-panel` fallback to combobox onSelect |
| `frontend/admin/index.html` (1524) | Modify | Bump `script.js?v=339` → `?v=340` |

### Final Step (Always)
* **Housekeeping:** Update status → `[IMPLEMENTED — NEED TESTING]`, add Section 7 items to `current-status.md` Active TODOs, commit + push branch, **pause for merge approval** (frontend goes live only after merge to main).

## 7. Validation Plan

* [x] Unmatched/issuer-mismatch card → "שייך מסמך" button → reassign modal opens with picker
* [x] Reassign to existing doc via combobox dropdown succeeds
* [x] Reassign with custom doc name (picker → "מסמך מותאם אישית") succeeds with the typed name (no "general_doc" literal)
* [x] Reassign with var-less template (e.g. T002) succeeds with resolved Hebrew name
* [x] Reassign with var-filled template (e.g. T001 → city_name) succeeds with placeholders fully substituted
* [x] Issuer-mismatch quick-assign ("אישור ושיוך") still works
* [x] Modal expand picker hides combobox (only one search bar visible)
* [x] Combobox reopens on second click after a pick
* [x] In-place doc-tag header refresh after reassign (new doc appears immediately, no F5)
* [x] Doc-tag refresh anchored on `.ai-missing-docs-body` previous sibling (no longer clobbers messages header)
* [x] Missing-docs body capped at 240px max-height with overflow-y:auto when chip count is large
* [x] Custom-input typed name commits on "שייך"/"אישור" without requiring "הוסף" first
* [x] No 404s in DevTools Network during normal AI Review browsing or reassign flows
* [x] Mobile fat-card layout: unmatched card opens reassign modal via "שייך מסמך"

## 8. Implementation Notes (Post-Code)

Bundle scope grew during live testing. Final shape:

**Bug 1 (original):** combobox `onSelect` scope mismatch — fixed via DL-339 v1.5 multi-scope fallback (`closest('.ai-card-actions') || closest('.ai-actions-panel')`).

**Bug 2 (original 404):** Resolved as a side effect — the deployed `/webhook/review-classification` always returned 400/401, so the original 404 turned out to be from an in-flight request to a code path that didn't exist yet (picker creating a new doc on the report). Backend Path 3 fallback added.

**Follow-up bugs surfaced during live testing & fixed in same DL:**

1. **Picker `var-less` mistreatment:** `tpl.variables` could be empty while `name_he` had `{placeholder}` tokens. Picker now derives userVars from BOTH `tpl.variables` AND any `{token}` matched in `name_he`/`short_name_he`/`name_en`.
2. **Backend creates doc with type literal as name:** `assignAIUnmatched` only forwarded `newDocName` for the legacy `__NEW__` sentinel — picker emits `template_id='general_doc'` for custom-input. Fixed by always forwarding `newDocName` from combobox dataset. Backend hardened to reject empty derived names (400) instead of persisting type literals.
3. **Modal renders two search bars:** `onExpand` didn't hide the combobox while picker was open. Now hides on expand, restores on close.
4. **Combobox couldn't reopen after pick:** `mousedown` handler missed the "closed but already focused" branch (option mousedown's preventDefault keeps input focus, so the next click never refires the focus event). Added that branch.
5. **Doc-tag header refresh clobbered messages header:** `refreshClientDocTags` used `docsPane.querySelector('.ai-section-header')` which returned the first section ("הודעות הלקוח"). Anchored on `.ai-missing-docs-body.previousElementSibling` instead.
6. **In-place refresh missing for picker-created docs:** `updateClientDocState` was guarded on the original `docRecordId` arg (empty for picker-created). Now uses `data.doc_id` from the server response as fallback.
7. **Long chip lists:** `.ai-missing-docs-body` capped at `max-height: 240px; overflow-y: auto`.
8. **One-click commit:** clicking "שייך"/"אישור" with text in `.ai-tpl-custom-input` but no chip yet auto-commits the typed name.
9. **Inline UX too cramped:** unmatched + issuer-mismatch-fallback states drop the inline combobox entirely and route to the full reassign modal via `showAIReassignModal`. Quick-assign comparison radios for issuer-mismatch with siblings remain.

**Deploys:** worker `8da9e5c9` → `c3c9b2c6` → `c38847c9` → `10157460`. Frontend cache-bust `script.js?v=339 → v=362`, `style.css?v=318 → v=319`. Live tested on CPA-XXX with seeded test data tagged `DL350-r3-*` (since cleaned up).
