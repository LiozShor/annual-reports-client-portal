# Design Log 336: Template Picker UI — Also-Match & Reassign Modals
**Status:** [COMPLETED]
**Date:** 2026-04-23
**Related Logs:** DL-314 (multi-template match — introduced also-match), DL-320 (also-match UX rework — moved button to post-approve), DL-301 (PA add-doc affordance — established `ensurePaTemplatesLoaded` + pa-add-doc pattern)

## 1. Context & Problem

The "גם תואם ל..." (also-match) modal has two problems with its "הוסף מסמך נוסף" section:
1. It uses `createDocCombobox(ownDocs, ...)` which only shows the client's own existing docs — not all available templates — and has no category grouping.
2. Its "הוסף מסמך חדש" option enters a bare free-text field with no template browsing.

The "שיוך מסמך למסמך אחר" (reassign) modal has the same issue: "הוסף מסמך חדש" in the combobox goes straight to free-text mode with no template picker.

The reference design (doc-manager + PA card, DL-301) already has the correct pattern: search field → categorized template list → "או מסמך מותאם אישית" divider → free-text input. This DL replicates that pattern in both modals.

## 2. User Requirements

1. **Q:** Should the template picker in also-match be additive (checkboxes + picker both feed into שייך) or replace the checkboxes?
   **A:** Additive — both checkbox selections and the picker selection are included in one שייך submit.

2. **Q:** Should the reassign modal also switch to showing ALL templates, or stay as-is?
   **A:** Keep client's own docs as the primary combobox. When "הוסף מסמך חדש" is clicked, EXPAND a full template picker panel below (not free-text mode).

3. **Q:** For templates with user variables (e.g. T501 needs issuer name) — variable wizard or skip?
   **A:** Variable wizard — ask for the variable before adding to batch.

4. **Q:** After picking from the template picker, show a removable chip or just enable שייך?
   **A:** Show chip/row with × button for visual confirmation.

## 3. Research

### Domain
Progressive disclosure in search UIs; creatable combobox UX; inline chip feedback.

### Sources Consulted
1. **NN/G Progressive Disclosure** — Show high-confidence shortcuts first; reveal all options behind a secondary action. Directly justifies the design: own docs as primary, full templates as expansion.
2. **React-Select Creatable pattern** — "Create new" option inline within filtered results at the bottom of the dropdown; show search-filtered list first, then a CTA. Validates showing templates BEFORE the free-text option.
3. **Inline chip feedback (Mobbin/LogRocket)** — Selected items appear as removable chips immediately; no separate confirmation step needed. Supports the chip-with-× approach.

### Key Principles Applied
- **Two-tier disclosure**: Client's own docs (most likely picks) shown first; "הוסף מסמך חדש" expands ALL templates behind a secondary action.
- **Create-last**: Custom free-text at bottom of dropdown, not top.
- **Immediate chip feedback**: Pick a template → chip appears inline; no extra dialog.

### Anti-Patterns to Avoid
- Bare free-text as the only "new doc" path (current behavior) — hides available templates.
- Global IDs in reusable picker function — use container-relative class selectors to avoid conflicts with PA picker (which uses `id="paAddDocSearch"` etc.).

## 4. Codebase Analysis

### Existing Solutions Found
| Thing | Location | Reuse |
|---|---|---|
| `ensurePaTemplatesLoaded(clientId, reportId, ft)` | script.js ~7786 | Reuse as-is |
| `_paRenderAddDocPick` HTML pattern | script.js ~7969 | Replicate into new function |
| `paAddDocFilter(q)` show/hide logic | script.js ~8055 | Replicate (container-scoped) |
| `paAddDocPickTemplate` + variable step | script.js ~8080 | Replicate |
| `paAddCustomDocSubmit` | script.js ~8237 | Replicate |
| `pa-add-doc-*` CSS classes | style.css ~8916 | Reuse directly |
| `createDocCombobox` | script.js ~3317 | Add `onExpand` option (3-line change) |
| `showAIAlsoMatchModal` / `confirmAIAlsoMatch` | script.js ~5637 | Modify |
| `showAIReassignModal` / `confirmAIReassign` | script.js ~5498 | Modify |
| `aiReassignModal` HTML | index.html ~1177 | Add expansion div |

### Reuse Decision
- Build one new function `_buildDocTemplatePicker` that encapsulates the pa-add-doc pattern, using container-relative selectors.
- Both modals call it for their "add new doc" paths.
- `createDocCombobox` gets a minimal `onExpand` hook (backwards-compatible).

### Alignment with Research
The two-tier disclosure and chip feedback patterns match codebase conventions: PA card already does this correctly. We're extending the same pattern to two more surfaces.

## 5. Technical Constraints & Risks

| Risk | Mitigation |
|------|-----------|
| Global DOM ID conflicts (paAddDocSearch etc.) | Use class-based selectors relative to container element |
| `ensurePaTemplatesLoaded` caches per `client_id` — stale if filing_type changes mid-session | Acceptable; same limitation already accepted in DL-301 |
| `createDocCombobox` is used on ~5 surfaces | `onExpand` is additive/undefined by default; zero impact on existing callers |
| Also-match confirm: removing early `if (checked.length === 0) return` guard | Move guard to after both checkbox + picker targets are collected |
| Templates without client doc records (not in ownDocs) | v1 scope: show only templates the client has as doc records + custom free-text. Future DL can extend backend to create docs from any template. |

## 6. Proposed Solution

### Success Criteria
Both modals have a proper template picker (search + categories + custom free-text + variable wizard + chip feedback) where the current `createDocCombobox`-based "new doc" flow was.

### New function: `_buildDocTemplatePicker(container, item, opts)`

Renders into `container`:
```
[🔍 חפש מסמך... (search input)]
[scrollable list: category headers + template options]
[—— או מסמך מותאם אישית ——]
[custom text input] [+ הוסף]
```

After pick → replaces content with chip:
```
[resolved doc name ×]
```

`opts.onPick(target | null)` — called with `{ template_id, doc_record_id?, new_doc_name? }` or `null` (chip cleared).

Steps:
1. **Loading** → `ensurePaTemplatesLoaded`
2. **Pick** → search + category list (own docs matched to template catalog for display names/emojis) + custom free-text
3. **Vars** (conditional) → if template has user variables, show inline input row
4. **Chip** → removable confirmation row

### Also-match modal changes
- Remove `createDocCombobox` call and `overlay.dataset.combobox*` pattern
- Call `_buildDocTemplatePicker(comboboxContainer, item, { onPick: target => { overlay._pickerTarget = target; updateConfirmBtn(); } })`
- `updateConfirmBtn`: check checkboxes OR `overlay._pickerTarget`
- `confirmAIAlsoMatch`: push `overlay._pickerTarget` into `additional_targets` if set

### Reassign modal changes
- `createDocCombobox`: add `onExpand` option (3 lines, backwards-compatible)
- `showAIReassignModal`: pass `onExpand` → shows `#aiReassignExpandedPicker`, calls `_buildDocTemplatePicker` in it
- `index.html`: add `<div id="aiReassignExpandedPicker" style="display:none;margin-top:8px;"></div>`
- `closeAIReassignModal`: clear expansion div + `_aiReassignExpandedTarget = null`
- `confirmAIReassign`: if `_aiReassignExpandedTarget` set, use it as the reassign target

### CSS additions
`.ai-picker-chip`, `.ai-picker-chip-label`, `.ai-picker-chip-clear` — added near `.ai-also-match-*` block.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Add `_buildDocTemplatePicker`; update `showAIAlsoMatchModal`, `confirmAIAlsoMatch`, `createDocCombobox` (onExpand), `showAIReassignModal`, `confirmAIReassign`, `closeAIReassignModal` |
| `frontend/admin/index.html` | Modify | Add `#aiReassignExpandedPicker` div; bump script v→303, css v→296 |
| `frontend/admin/css/style.css` | Modify | Add `.ai-picker-chip*` rules |
| `.agent/design-logs/ai-review/336-template-picker-ui.md` | Create | This file |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-336 entry |
| `.agent/current-status.md` | Modify | Update session summary |

### Final Step
Update status → `[IMPLEMENTED — NEED TESTING]`; copy unchecked §7 items to `current-status.md`; commit + push branch.

## 7. Validation Plan

- [ ] Also-match modal: "הוסף מסמך נוסף" section shows loading state then search + categorized template list
- [ ] Search filters list; empty categories auto-hide
- [ ] Pick template (no variables) → chip appears immediately with ×
- [ ] Pick T501 (has issuer_name) → variable input row appears → fill → confirm → chip shows full resolved name
- [ ] Custom free-text input → type name → הוסף → chip appears
- [ ] Chip × → resets to picker state (list reappears)
- [ ] 2 checkboxes checked + 1 picker pick → שייך sends 3 targets
- [ ] 0 checkboxes + picker pick → שייך enabled; sends 1 target
- [ ] Reassign modal: own-docs combobox works as before (no regression)
- [ ] Click "הוסף מסמך חדש" in reassign combobox dropdown → expanded picker panel appears below
- [ ] Expanded picker pick → שייך enabled; confirmAIReassign uses picker target
- [ ] closeAIReassignModal clears the expanded picker and resets `_aiReassignExpandedTarget`
- [ ] No regression on other `createDocCombobox` surfaces (unmatched card, etc.)

## 8. Implementation Notes
- `_buildDocTemplatePicker` added before `showAIAlsoMatchModal` (~line 5669 post-insert).
- `_aiReassignExpandedTarget` module-level var added alongside `aiReassignSelectedReportId`.
- `confirmAIReassign` restructured: expanded-picker path checked first, then falls through to combobox path (same `submitAIReassign` call).
- All state stored in closures inside `_buildDocTemplatePicker` (no external state object needed).
- `pa-add-doc-*` CSS reused as-is; only `.ai-picker-chip*` rules added.
