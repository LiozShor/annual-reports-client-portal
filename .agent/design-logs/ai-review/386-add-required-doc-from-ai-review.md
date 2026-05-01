# Design Log 386: Add Required Doc from AI Review Tab
**Status:** [COMPLETED — 2026-05-01]
**Date:** 2026-04-30
**Related Logs:** DL-058 (add new custom doc from AI review reassign), DL-053 (silent refresh), DL-330 (AI review 3-pane), DL-336 (template picker UI), DL-301 (PA add-doc popover), DL-349 (doc-tags-header-refresh)

## 1. Context & Problem

On the AI Review tab, the "📄 [H:required-docs] (X/Y [H:hebrew])" / "[H:missing-docs] (N)" section lists every required-but-not-yet-received doc as a tag chip. There is currently no way to add a new required doc directly from this section — admins must leave the AI review tab, go to the PA (Review & Approve) preview, click the "+ [H:add-doc]" row, then return.

Goal: add a "+" affordance inside the section so the existing PA add-doc popover (DL-336 template picker + variable wizard + custom doc) can be triggered without leaving the AI review tab. After a successful add, the section silently refreshes (DL-053) so the new chip appears immediately. Bonus: when exactly one AI review card is currently expanded/active at click time, after creation prompt to reassign that card's file to the just-created doc.

## 2. User Requirements (Q&A)

1. **Q:** Where should the "+" button live in the [H:required-docs] section?
   **A:** Last chip in the body — appended after existing missing-doc tags, inside `.ai-missing-docs-body`.

2. **Q:** Which existing dialog should be reused?
   **A:** PA add-doc popover (`openPaAddDocPopover` / `_buildDocTemplatePicker`, DL-301/336).

3. **Q:** Which report owns the new doc?
   **A:** The group's representative report (`items[0].report_id`).

4. **Q:** What should happen after a successful add?
   **A:** Silent refresh of the section (DL-053).

5. **Q:** If the user clicks "+" while reviewing a specific card, should we offer to assign the new doc to that card's file?
   **A:** Yes — when exactly one AI review card is expanded/`preview-active` at click time, prompt `[H:confirm-assign-file-to-this-doc]` Confirming triggers existing reassign flow against the new `doc_record_id`.

## 3. Research

### Domain
Inline-create UX in chip/tag sets, section-level affordances, consistency with PA pattern.

### Sources
1. **Material Design 3 — Chips guidelines** — input chips and chip sets are the canonical pattern for tag-like lists with inline add/remove; trailing add chip is established.
2. **Adam Silver — Where to put buttons on forms** — action buttons that affect a list area belong adjacent to the list.
3. **DL-058 / DL-301 / DL-336 (this repo)** — `_buildDocTemplatePicker` is the canonical add-doc UI; reuse over reinvent.

### Principles
- **Reuse over reinvent**: extend the existing popover instead of building a parallel one.
- **Trailing-chip placement**: matches user choice and mirrors `renderPaAddDocRow`.
- **Silent refresh > full reload** (DL-053).

### Anti-Patterns Avoided
- New modal for add-doc (would duplicate `_buildDocTemplatePicker`).
- Full tab reload after add.
- Person picker reinvention.

### Verdict
Render an `ai-missing-add-doc-chip` as the last item inside `.ai-missing-docs-body`. Click triggers `openPaAddDocPopover` with `data-report-id = items[0].report_id` and `data-person = "client"`. Popover gains a fallback lookup against `aiClassificationsData` (since `pendingApprovalData` is only loaded on the PA tab) and gates its optimistic `.pa-card` re-render path under a PA-mode flag. On success in AI mode: `loadAIClassifications({ silent: true })` → `refreshClientDocTags(clientName)`. If exactly one `.ai-review-card.preview-active` was present at click time, also prompt and run `submitAIReassign` against the new doc's `doc_record_id`.

## 4. Codebase Analysis

### Section render path (target surface)
- `frontend/admin/js/script.js:4530-4548` — desktop 3-pane initial render (`buildDesktopClientDocsHtml`)
- `frontend/admin/js/script.js:5328-5354` — mobile accordion initial render (`buildClientAccordionHtml`)
- `frontend/admin/js/script.js:9399-9414` — `buildDocCategoryTagsHtml(displayDocs)` — produces the chip list
- `frontend/admin/js/script.js:9420-9487` — `refreshClientDocTags(clientName)` — silent re-render of body for both desktop pane and mobile accordion (DL-053)

### Reused popover
- `script.js:10555-10565` — `renderPaAddDocRow(reportId, person)` — visual we mirror
- `script.js:10635-10710` — `openPaAddDocPopover(event, rowEl)` — entry; reads `data-report-id` and `data-person` (defaults to `'client'`)
- `script.js:10712, 10823, 10981, 11012, 11142` — pick → variable collection → preview → confirm
- `script.js:11196` — POST `ENDPOINTS.EDIT_DOCUMENTS` with `{ docs_to_create: [...] }`; success toast `[H:doc-added-successfully]`

### Silent refresh path
- `script.js:4084` — `loadAIClassifications({ silent: true })` re-pulls `GET_PENDING_CLASSIFICATIONS?filing_type=all` and merges by id (DL-127).
- `script.js:9420` — `refreshClientDocTags(clientName)` re-renders only the missing-docs body in both surfaces.

### Active-card detection
- `script.js:3748, 3801, 3803` — `.ai-review-card.preview-active` class marks the card whose preview is currently open in the 3-pane.

### CSS hooks
- `.pa-preview-doc-row--add` (`style.css:9175`) — existing add-row visual.
- `.ai-missing-category-tags` (`style.css:2628`) — chip set container.
- `.ai-missing-docs-body` (`style.css:2612`) — section body.
- Cache-bust: `frontend/admin/index.html:13` (`style.css?v=382`) and `frontend/admin/index.html:1548` (`script.js?v=387`).

### Data shape gotcha
`pendingApprovalData` is loaded only when the PA tab is active. The popover does `pendingApprovalData.find(i => i.report_id === reportId)` and bails silently if missing. For the AI tab path we add a fallback against `aiClassificationsData`. `paDocIsDuplicate` reads `item.doc_groups` (PA shape only); for AI mode duplicate check we use `item.all_docs` / `item.missing_docs` instead.

## 5. Constraints & Risks

- **Person attribution**: AI items have no `person` field; pass `'client'` as default. Popover's internal selector handles spouse if `spouse_name` exists.
- **Multiple reports per client**: rare; `items[0].report_id` (representative) matches how the section header is computed today.
- **Refresh race**: silent refresh is async; the popover dropdown content is loaded from a separate templates endpoint, so stale `aiClassificationsData` only affects the chip set briefly.
- **Cache-bust mandatory** (`feedback_admin_script_cache_bust`).
- **Backwards compatibility**: pure additive change. PA flow path is unchanged because the new branches gate behind `aiMode` flag.

## 6. Proposed Solution

### Logic flow

1. **Render the "+" chip** as the last item in the body. Extend `buildDocCategoryTagsHtml(displayDocs, addCtx)`. Pass `{ reportId: items[0].report_id, person: 'client' }` from all 3 callers (desktop initial render, mobile accordion, silent refresher).

2. **Adapt `openPaAddDocPopover`** to:
   - Look up item via `pendingApprovalData` first, then `aiClassificationsData` (set `aiMode = true` if matched there).
   - Capture `aiActiveCard` from `document.querySelector('.ai-review-card.preview-active')` when in `aiMode`.
   - Stash both on `_paAddDocState`.

3. **Adapt `_paRenderAddDocPick`** to use the same item-resolver helper.

4. **Adapt `paAddDocConfirm`**:
   - Item resolver helper.
   - Duplicate check: AI-mode path uses `all_docs` + `missing_docs`.
   - Skip `_paApplyOptimisticAdd` and `.pa-card` rerender in AI mode.
   - On success in AI mode:
     - `await loadAIClassifications({ silent: true });`
     - `refreshClientDocTags(item.client_name);`
     - If `aiActiveCard` set: locate the new doc in refreshed `aiClassificationsData` (match by `template_id` + `issuer_name` or by latest createdTime), then `showConfirmDialog('[H:confirm-assign-file-to-this-doc]', () => { submitAIReassign-equivalent })`. We will reuse the existing reassign endpoint by calling the same low-level fetch the existing reassign code uses (`ENDPOINTS.REVIEW_CLASSIFICATION` with `action: 'reassign'`, `reassign_template_id`, `reassign_doc_record_id`).
     - On dismiss/cancel: do nothing.

5. **Visual.** New `.ai-missing-add-doc-chip` rule mirroring chip metrics with a dashed outline + plus icon.

6. **Cache-bust:** `style.css?v=382 → ?v=383`, `script.js?v=387 → ?v=388`.

### Files to change

| File | Change |
|------|--------|
| `frontend/admin/js/script.js` | Extend `buildDocCategoryTagsHtml` + 3 call sites. Item-resolver helper. AI-mode branches in `openPaAddDocPopover`, `_paRenderAddDocPick`, `paAddDocConfirm`. Active-card capture + post-add reassign confirm. |
| `frontend/admin/css/style.css` | New `.ai-missing-add-doc-chip` rule. |
| `frontend/admin/index.html` | Cache-bust bump. |

## 7. Validation Plan

- [ ] AI review tab on a client with at least one report — "+" chip appears as last item inside [H:required-docs] body, both expanded and after collapse/re-expand.
- [ ] Click "+" → same popover used by document-manager preview opens. Search, categories, variable wizard, custom-doc input all behave identically.
- [ ] Pick a template → confirm → toast `[H:doc-added-successfully]`. Within ~1s the new doc appears as a chip in the same section.
- [ ] Custom-doc path: type a name → confirm. Same outcome; chip with the typed name.
- [ ] Spouse client: popover person selector visible; picking spouse creates the doc with `person: 'spouse'`; chip still appears.
- [ ] Inline reassign comboboxes on AI cards include the newly-added doc as a target.
- [ ] Mobile accordion: "+" chip renders, popover opens, chip appears after add.
- [ ] No regression: PA preview "+ [H:add-doc]" works identically.
- [ ] Cache-bust verified — DevTools shows `?v=383` / `?v=388`.
- [ ] Active-card flow: open a card preview, click "+", create a doc → confirm dialog `[H:confirm-assign-file-to-this-doc]` appears. Confirming triggers reassign — card moves to "reviewed" and file is bound to the new doc.
- [ ] Active-card dismiss: same as above, click cancel — doc still exists as chip; card unchanged.
- [ ] No active card: click "+" with no card open → after add, no confirm dialog (silent refresh only).

## 8. Implementation Notes

- `loadAIClassifications` takes positional args `(silent, prefetchOnly)`, not an options object. Call uses `loadAIClassifications(true)`.
- `pendingApprovalData` is **only** populated when the PA tab is active. Confirmed at runtime by tracing `loadPendingApprovalQueue` callers — without the AI fallback the popover would silently bail (`if (!item) return;`). Solution: new `_paResolveAddDocItem(reportId)` helper, used in `openPaAddDocPopover`, `_paRenderAddDocPick`, `paAddDocPickTemplate`, `_paRenderAddDocVariables`, `_paEnterPreview`, `paAddDocConfirm`. AI fallback flips a `aiMode` flag stashed on `_paAddDocState`.
- `paDocIsDuplicate` originally walked `item.doc_groups` only (PA shape). Extended to also walk flat `item.all_docs` / `item.missing_docs` so the AI shape gets a real duplicate check.
- `_paApplyOptimisticAdd` / `_paRollbackOptimisticAdd` and the `.pa-card` outerHTML rerender are now gated behind `!aiMode` since the AI tab has no `.pa-card` and uses `loadAIClassifications` + `refreshClientDocTags` for refresh instead.
- Active-card detection uses `.ai-review-card.preview-active` (DL-330). When exactly one such card exists at click time, after the silent refresh resolves, `_findJustCreatedDoc` matches the new doc by template_id + issuer_key (general_doc falls back to case-insensitive issuer_name) and `showConfirmDialog` invites the admin to reassign that card's file via the existing `submitAIReassign(cardId, templateId, docRecordId)`.
- The "+" chip is rendered inside `.ai-missing-docs-body` as the trailing item in `.ai-missing-category-tags`. It inherits the chip metrics; its dashed-outline indigo style mirrors the design-system primary palette so it reads as an action affordance, not a doc.
- Cache-bust: `style.css?v=382 → ?v=383`, `script.js?v=387 → ?v=388`.

### Files changed
- `frontend/admin/js/script.js` — `buildDocCategoryTagsHtml(displayDocs, addCtx)` extended; 3 callers updated (lines ~4538, ~5337, ~9450); new `_paResolveAddDocItem` and `_findJustCreatedDoc`; `openPaAddDocPopover` captures `aiActiveCard`; `paAddDocConfirm` branches on `aiMode`; `paDocIsDuplicate` handles AI flat shape.
- `frontend/admin/css/style.css` — new `.ai-missing-add-doc-chip` rule.
- `frontend/admin/index.html` — cache-bust bump.
