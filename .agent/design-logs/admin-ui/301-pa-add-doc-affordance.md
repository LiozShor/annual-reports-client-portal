# Design Log 301: PA Card — Add Doc Affordance
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-17
**Related Logs:** DL-058 (add new doc from AI review), DL-162 (spouse checkbox add docs), DL-227 (inline waive/receive doc tags), DL-299 (PA card issuer edit + notes + print), DL-295/DL-298 (PA card stacked layout)

## 1. Context & Problem

The PA (Pending Approval) card in the admin portal lets admins review a client's submitted questionnaire + uploaded docs and decide whether to approve-and-send. Admins can already toggle a doc between Required_Missing / Received / Waived inline (DL-227) and edit per-doc notes (DL-299). **They cannot add a new required doc** directly on the card — for that they must open document-manager.html in a new tab, add the doc there, save, then return to the PA card.

This adds an "+ הוסף מסמך" affordance at the bottom of each doc-group in the PA card's doc list. Clicking it opens a popover that lets the admin either pick a template from the client's categorized template list (same templates doc-manager uses) or type a free-text custom doc name. On submit, the doc is created immediately via the existing `EDIT_DOCUMENTS` endpoint with `status: Required_Missing`, and the PA card re-renders with the new doc in place. The report stays in Pending_Approval — adding a doc is not a stage regression.

## 2. User Requirements

1. **Q:** What kind of doc should be addable from the PA card — custom free-text, template picker, or both?
   **A:** Both (custom + template picker) — full parity with doc-manager.
2. **Q:** Where should the "add doc" affordance live on the PA card?
   **A:** Small "+ הוסף מסמך" row at the bottom of the doc list.
3. **Q:** How should the new doc be saved?
   **A:** Immediate save, like waive/receive — no dirty-state tracking.
4. **Q:** Who is the doc for (person field)?
   **A:** Show client/spouse toggle only when the client has a spouse (`item.spouse_name` truthy).
5. **Q:** Stage impact when a missing doc is added at PA?
   **A:** Stay in Pending_Approval — admin is mid-review; a new missing doc goes out in the next email without regressing the pipeline.
6. **Q:** Template source?
   **A:** Reuse doc-manager's full categorized template list (SSOT) via `GET_CLIENT_DOCUMENTS?report_id=X&mode=office`.
7. **Q:** Duplicate rule?
   **A:** Block on exact `(template_id, issuer_key)` match. T501 + Hapoalim AND T501 + Leumi are both valid (different issuers); adding T501 + Hapoalim twice is blocked.

## 3. Research

### Domain
Creatable-combobox UX, inline optimistic-mutation patterns, form wizard reuse across surfaces.

### Sources Consulted
1. **DL-058 (ai-review/058-add-new-doc-from-ai-review.md)** — established `allowCreate` combobox convention in admin portal, `general_doc` template_id convention for custom docs, single-atomic-call backend pattern. This PA feature extends the same convention to a non-reassign context.
2. **DL-227 (ai-review/227-inline-waive-receive-doc-tags.md)** — inline status mutation pattern; "optimistic local mutate → EDIT_DOCUMENTS call → rollback + toast on error" loop proven on the PA card (`updatePaDocStatusInline`). We copy this loop verbatim for add-doc.
3. **DL-162 (documents/162-spouse-checkbox-add-documents.md)** — spouse person toggle only rendered when client has a spouse. Mirrored here.
4. **Select2 Tagging / React-Select Creatable** (via DL-058 citation) — creatable combobox pattern: a fixed "+ create" option, reversible mode toggle. Validated by prior use in this codebase.

### Key Principles Extracted
- **Reuse data sources** — the doc-manager template list is SSOT (`apiTemplates`, `apiCategories` from `GET_CLIENT_DOCUMENTS`). PA caches per `client_id` and never maintains its own template catalog.
- **Immediate save matches PA mental model** — every other mutation on the PA card is immediate; batching would introduce dirty-state that doesn't exist here.
- **Duplicate-by-issuer-key, not by display-name** — catalog contains per-issuer variants (T501, T401, T301). Display-name dedup would wrongly collapse legitimate multi-issuer cases.

### Patterns to Use
- **Creatable combobox (DL-058)** — template list with a custom free-text path.
- **Wizard-in-popover** — replicate doc-manager's 3-stage (search → variables → preview) but compact inside a popover.
- **Optimistic mutate + rollback (DL-227)** — mirror `updatePaDocStatusInline`'s success/failure loop.

### Anti-Patterns to Avoid
- **Importing doc-manager functions** — they mutate document-manager globals (`docsToAdd`, `pendingTemplate`, fixed DOM IDs). We transliterate the flow into PA-scoped helpers instead.
- **Stage auto-regression** — explicitly declined in Q5; would feel punitive mid-review.

### Research Verdict
Build a self-contained PA popover that lazily fetches the template catalog once per `client_id`, presents a creatable combobox + free-text input + variable step + preview, and submits via `EDIT_DOCUMENTS` with `docs_to_create`. Exact `(template_id, issuer_key)` duplicate guard matches the reality of multi-issuer templates.

## 4. Codebase Analysis

### Existing Solutions (Reuse)

| Thing | Location | Use |
|---|---|---|
| `EDIT_DOCUMENTS` endpoint | `api/src/routes/edit-documents.ts:254-395` | Already accepts `docs_to_create: [{ issuer_name, issuer_name_en, template_id, category, person, issuer_key }]`; hard-codes `status: 'Required_Missing'` in `buildCreateItems()` (line 279). No backend change required. |
| `GET_CLIENT_DOCUMENTS` | `frontend/admin/js/script.js:2084` — `${ENDPOINTS.GET_CLIENT_DOCUMENTS}?report_id=${reportId}&mode=office` | Returns `{ templates, categories_list }` filing-type-scoped for the client. PA lazy-fetches once per report. |
| `buildPaCard` / `buildPaPreviewBody` | `frontend/admin/js/script.js:5813, 5928` | Card render site — append `renderPaAddDocRow` after each person's last category. |
| `renderPaDocTagRow` | `frontend/admin/js/script.js:6118` | Existing doc-row renderer. New add-row uses sibling class `pa-preview-doc-row--add`. |
| `openPaDocTagMenu` / `updatePaDocStatusInline` | `frontend/admin/js/script.js:6189, 6266` | Pattern template: optimistic local mutate → `EDIT_DOCUMENTS` call → rollback + toast on error. |
| `openPaDocNotePopover` positioning | `frontend/admin/js/script.js:6741-6773` | Reused math for "flip above when near viewport bottom". |
| `_paFindDoc` | `frontend/admin/js/script.js:6565` | Used to iterate `doc_groups[].categories[].docs[]`. |
| `buildDocMeta` logic (reference only) | `frontend/assets/js/document-manager.js:1738-1761` | Template: substitute `{year}/{spouse_name}/{issuer_name}` placeholders; `issuer_key` = user-var values joined. |

### Data Shapes
- `pendingApprovalData[i]` carries: `report_id`, `client_id`, `client_name`, `spouse_name`, `filing_type`, `year`, `doc_chips: [{ doc_id, name, name_short, category_emoji, status, ... }]`, `doc_groups: [{ person, person_label, categories: [{ name, emoji, docs: [...] }] }]` (source `api/src/routes/admin-pending-approval.ts:193-210`).
- `doc_groups[].categories[].docs[]` is the SSOT for duplicate checks — each raw doc carries `type` (= template_id), `issuer_name`, `issuer_key`, `doc_record_id`, `person`, `status`, `category`.
- `apiTemplates[i]` has `{ template_id, name_he, name_en, category, variables: string[], scope? }`.

### Alignment With Research
- Optimistic-mutate pattern already proven on PA (DL-227) — add-doc reuses the exact loop.
- Template catalog is already fetchable via a single endpoint used by doc-manager — no new API needed.
- `doc_chips` lacks `template_id`/`issuer_key`, so duplicate checks must traverse `doc_groups` (not `doc_chips`).

## 5. Technical Constraints & Risks

- **Security:** Template catalog and doc creation both gated by admin `Authorization: Bearer <token>`; same auth model as existing PA mutations.
- **Stale cache:** Templates cached per `client_id` in memory. Stale if the report's `filing_type` changes mid-session — acceptable because admins rarely do that and a refresh clears it.
- **Doc-id reconciliation:** `EDIT_DOCUMENTS` response doesn't return the newly created Airtable record id in the existing handler shape. Optimistic chip uses a placeholder `doc_id` (`pa-new-<timestamp>`); the row is functional (can be waived/received/noted) only after the next PA refresh. For v1 this is acceptable — the user's primary ask is "the doc appears on the card." Follow-up: thread the created id back through `EDIT_DOCUMENTS` response.
- **Breaking changes:** None. New UI row + popover only; no changes to existing PA renders or mutations.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Clicking "+ הוסף מסמך" at the bottom of a PA card's doc list lets the admin pick a template (with variables when applicable) or type a custom name, and on confirm the doc appears in the card's doc list without a page reload. The new doc persists in Airtable with `status: Required_Missing`.

### Logic Flow
1. **Render** — in `buildPaPreviewBody`, after each person's last category, append `renderPaAddDocRow(reportId, person)`. If the item has no spouse, only the client group renders, so only one add-row appears.
2. **Open popover** → `openPaAddDocPopover(event, btn)` reads `report_id` + `person` from the button, then:
   - Calls `ensurePaTemplatesLoaded(clientId, reportId, filingType)` — fetches `GET_CLIENT_DOCUMENTS` once, caches `{ apiTemplates, apiCategories }` in module-scoped `_paTemplateCache` keyed by `clientId`.
   - Builds a floating popover in `document.body` with:
     - Search input + categorized template list.
     - A bottom "מסמך מותאם אישית" row (text input + `+` button).
     - A person selector pill (client/spouse) when `item.spouse_name` is truthy.
   - Positions popover using the same math as `openPaDocNotePopover` (flip above when near viewport bottom).
3. **Pick template** → `paAddDocPickTemplate(templateId)`:
   - Filters variables to user-provided (`!== 'year' && !== 'spouse_name'`).
   - If user-vars exist, swaps popover body to a variable-input step (`paAddDocShowVariables`).
   - Else, goes straight to preview (`paAddDocShowPreview`).
4. **Custom free-text path** → `paAddCustomDocSubmit(reportId)`:
   - Reads input; builds `pendingDoc` with `template_id: 'general_doc'`, `category: 'general'`, `issuer_name`/`issuer_key` = typed value, `issuer_name_en` = typed value.
   - Goes straight to preview.
5. **Preview + duplicate guard** (`paAddDocShowPreview`):
   - Computes resolved Hebrew display name (substituting `{year}` → item.year, `{spouse_name}` → item.spouse_name, user-var placeholders from variable-step inputs).
   - Calls `paDocIsDuplicate(item, pendingDoc)`:
     - Templates: iterate `doc_groups[].categories[].docs[]` for any `doc.type === template_id && (doc.issuer_key || '') === issuerKey` (case-insensitive on issuerKey). Skip docs with `status === 'Waived'` (they don't count).
     - Custom: case-insensitive exact match on `doc.issuer_name` where `doc.type === 'general_doc'`.
   - If duplicate, show inline warning and disable confirm button.
6. **Submit** → `paAddDocConfirm(reportId)`:
   - Optimistically:
     - Append new doc object to the correct `doc_groups[].categories[].docs[]` (find category by `name`/`id` or create it if missing — matches template's `category`).
     - Append to `doc_chips` with `doc_id: 'pa-new-<ts>'`, `status: 'Required_Missing'`, `name`/`name_short` = resolved name, `category_emoji` = from `apiCategories`.
   - Re-render card via `card.outerHTML = buildPaCard(item); safeCreateIcons(...)` (same as `updatePaDocStatusInline`).
   - POST `EDIT_DOCUMENTS`:
     ```json
     {
       "data": {
         "fields": [{ "type": "HIDDEN_FIELDS", "value": { "report_record_id": "<id>", "client_name": "...", "spouse_name": "...", "year": 2026 } }],
         "extensions": {
           "docs_to_create": [{ "issuer_name": "...", "issuer_name_en": "...", "template_id": "T501", "category": "salary", "person": "client", "issuer_key": "בנק הפועלים" }],
           "send_email": false
         }
       }
     }
     ```
   - On success: toast `המסמך נוסף בהצלחה`. No doc-id reconcile in v1 — placeholder id remains until next PA refresh.
   - On failure: rollback local state (remove optimistic chip + cat doc), re-render card, toast `שגיאה בהוספת המסמך`.

### Data Structures / Schema Changes
None. `doc_chips` optimistic entries use placeholder `doc_id` (`pa-new-<ts>`). `doc_groups` optimistic entries carry the same placeholder in `doc_record_id`.

### Files to Change

| File | Action | Description |
|---|---|---|
| `frontend/admin/js/script.js` | Modify | Add `_paTemplateCache`, `ensurePaTemplatesLoaded`, `renderPaAddDocRow`, `openPaAddDocPopover`, `closePaAddDocPopover`, `paAddDocPickTemplate`, `paAddDocShowVariables`, `paAddDocShowPreview`, `paAddDocConfirm`, `paAddCustomDocSubmit`, `paDocIsDuplicate`, `_paResolveTemplateName`. Append `renderPaAddDocRow` row in `buildPaPreviewBody`'s per-group loop. |
| `frontend/admin/css/style.css` | Modify | `.pa-preview-doc-row--add` (dashed border + muted color + `+` icon). `.pa-add-doc-popover` (popover shell + combobox + variable step + preview). Reuse existing `--sp-*` / `--gray-*` / `--primary-*` tokens. |
| `.agent/design-logs/admin-ui/301-pa-add-doc-affordance.md` | Create (this file) | Design log. |

### Final Step (Always)
Housekeeping — update design log status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items to `.agent/current-status.md` under Active TODOs.

## 7. Validation Plan

- [ ] On a PA card with no spouse, click `+ הוסף מסמך` → popover opens anchored below the button; shows categorized template list + custom input.
- [ ] Type a Hebrew search term → template list filters correctly.
- [ ] Pick a template with no user-variables → popover jumps directly to preview with resolved name.
- [ ] Pick a template with a user-variable (T501 issuer_name) → variable input step appears; empty submit blocks; filled submit proceeds to preview.
- [ ] Confirm on preview → card re-renders with new `Required_Missing` doc row; toast `המסמך נוסף בהצלחה` appears.
- [ ] Refresh the PA queue (reload page) → the newly added doc persists and appears under the same category.
- [ ] Duplicate guard: add T501 + "Hapoalim" twice → second attempt shows `מסמך זה כבר קיים ברשימה` and disables confirm. Changing issuer to "Leumi" re-enables confirm.
- [ ] Custom free-text: type a novel doc name + click `+` → preview shows the typed name with `general_doc` metadata; confirm creates the doc.
- [ ] Custom free-text duplicate: same exact name (case-insensitive) blocks with warning.
- [ ] Client with a spouse (`item.spouse_name` truthy): `+ הוסף מסמך` row renders under both the client's and the spouse's doc groups. Adding via spouse group creates Airtable record with `person: 'spouse'`.
- [ ] Network failure (devtools offline) on confirm: optimistic row disappears; toast `שגיאה בהוספת המסמך`; no leftover state.
- [ ] Stage assertion: after adding a doc, report stays on PA tab (`Pending_Approval`). Does not auto-regress.
- [ ] No regression: waive/receive inline toggle, note popover, issuer pencil edit, print, approve-and-send all still work on a card where a new doc was just added this session.
- [ ] Visual: add-doc row is visually distinguishable from regular doc rows (dashed border, muted color, `+` icon) — scans as an action.

## 8. Implementation Notes (Post-Code)
*Log any deviations from the plan here during implementation.*
