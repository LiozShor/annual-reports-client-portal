# Design Log 401: Unidentified Inbound Doc Rows — Clickable for In-App Preview
**Status:** [COMPLETED — 2026-05-12]
**Date:** 2026-05-04
**Related Logs:** DL-361 (created `buildUnidentifiedDocsHtml`), DL-334 (preview pane + perf instrumentation), DL-339 (preview pane structure), DL-112 (file_hash dedup — see scope-adjacent note in §4)

## 1. Context & Problem

In the AI Review tab, **identified-client** doc rows (`script.js:4531`) are clickable: clicking opens the in-app preview pane via `selectDocument(recordId)`. The **unidentified-inbound** doc rows (`script.js:5547`) — added by DL-361 — were intentionally rendered as read-only with `cursor: default` and no click handler. The only action was the small ↗ external-link icon that opens OneDrive in a new tab.

Office staff need to **preview before assigning** an unidentified doc to a client. Today they have to either (a) open OneDrive in a new tab and tab back, or (b) assign blind. Both are friction. The fix is a 1:1 replication of the existing classified-row click pattern.

## 2. User Requirements

1. **Q:** What should clicking the unidentified-doc row open?
   **A:** In-app preview modal (same flow as `selectDocument()`).
2. **Q:** Keep the small ↗ OneDrive external-link icon at the end of the row?
   **A:** Keep it.
3. **Q:** Bundle inbound-identification fixes (image-noise filter, Tier 2.7 subject-ID match, AI-result logging)?
   **A:** No — strictly UI in this DL; inbound fixes deferred to a future DL.
4. **Q:** Also clean up the duplicate Airtable entries from the earlier ask?
   **A:** No — UI fix only this DL; cleanup separately.

## 3. Research

### Domain

Internal pattern replication (admin UI clickable list rows + preview pane). External research skipped — the authoritative source is the existing codebase (DL-334 preview flow, DL-339 pane structure, DL-361 unidentified rendering).

### Sources Consulted

1. **`script.js:4531-4540` (classified-row template, in-repo)** — canonical clickable row pattern: `data-id` + `title` + `onclick="selectDocument(...)"`.
2. **`script.js:4674` (`selectDocument` definition, in-repo)** — accepts a pending_classifications recordId; calls `loadDocPreview(id)` + `renderActionsPanel(item)`. Does not require `matched_doc_record_id`.
3. **DL-334 design log (`ai-review/334-*.md`)** — established the `dl334:preview` perf-marking and `loadDocPreview` flow that we get for free by reusing `selectDocument`.

### Key Principles Extracted

- **Single source of truth for click handlers** — both row variants now share `selectDocument`, so any future preview-pane improvement (perf, accessibility, error handling) applies uniformly.
- **Affordance must match interactivity** — removing `cursor: default` + `opacity: 0.85` is necessary, not cosmetic; an interactive row that looks disabled fails users.
- **Reuse over re-implement** — DL-334's perf instrumentation and DL-339's pane structure cover us automatically.

### Patterns to Use

- **Classified-row template:** `<div class="ai-doc-row" data-id="..." title="..." onclick="selectDocument('...')">`.
- **Stop-propagation guard on inner action:** the OneDrive ↗ `<a>` already has `onclick="event.stopPropagation()"` (`script.js:5553`), so the row click and the icon click won't conflict.

### Anti-Patterns to Avoid

- **Forking a new `previewUnidentifiedItem(...)` fn** — would diverge from the classified path and miss DL-334 instrumentation.
- **Using OneDrive same-tab navigation** — breaks AI Review flow context.
- **Keeping `cursor: default`/`opacity: 0.85`** on a now-interactive row.

### Research Verdict

Reuse `selectDocument(recordId)` directly. The unidentified items already live in `aiClassificationsData` (verified — same render source as classified items) so the existing `selectDocument` lookup will resolve. `loadDocPreview` works on the classification's `onedrive_item_id`, which all unidentified rows already have.

## 4. Codebase Analysis

- **Existing Solutions Found:**
  - `selectDocument(id)` at `frontend/admin/js/script.js:4674` — central preview-row click handler.
  - `loadDocPreview(id)` (mobile + desktop branches) — handles classifications by recordId.
  - `renderActionsPanel(item)` — gracefully handles unmatched/unidentified items (primary action becomes "Choose a client to assign").
  - `escapeAttr(s)` — already used by classified-row template.
- **Reuse Decision:** Reuse `selectDocument` as-is. Modify only the unidentified-row template.
- **Relevant Files:**
  - `frontend/admin/js/script.js:5547-5554` — unidentified row template (single edit site).
  - `frontend/admin/index.html:1558` — cache-bust `script.js?v=413` → `v=414`.
- **Existing Patterns:** Classified-row pattern is the canonical clickable-row template; copying it verbatim keeps the two surfaces uniform (CLAUDE.md "Uniformity (#1 RULE)").
- **Alignment with Research:** Direct match — single source of truth, no new fns.
- **Dependencies:** None new. Relies on existing DL-334 preview flow + `escapeAttr` helper.

**Scope-adjacent finding (NOT fixed in this DL):** while investigating the user-reported "3 docs forwarded but only 1 shows in UI" question (the user saw a count mismatch on a live unidentified card despite 3 attachments), I traced it to DL-112 file-hash dedup at `api/src/routes/classifications.ts:172-180`. When the same email is forwarded twice and the AI succeeds on the 2nd pass, the older `unidentified-...` pending rows are dedup-suppressed by their newer identified twins (same `file_hash`). This is correct in the common case (no dup work) but produces a wrong "files: 1" count when an inline-image attachment is the only survivor. Documented here for future-DL candidacy; not part of DL-401 scope.

## 5. Technical Constraints & Risks

- **Security:** None. The recordId is already exposed in row data attributes for the OneDrive icon's URL; making it clickable adds no exposure.
- **Operational Risks:**
  - `selectDocument` reads `aiClassificationsData` by id. If the unidentified item isn't present in that array, click would no-op silently. Mitigated: unidentified items ARE in `aiClassificationsData` (verified — same render source).
  - The OneDrive ↗ icon already has `onclick="event.stopPropagation()"` so the row click and icon click won't conflict.
  - **Monolith size ratchet:** edit must not bump line count. Solution: keep the change on the same line of the existing `<div>` opening tag.
- **Breaking Changes:** None. Pure additive.
- **Mitigations:** Manual smoke test on a current unidentified card before merge; cache-bust forces fresh JS.

## 6. Proposed Solution

### Success Criteria

Clicking anywhere on an unidentified-doc row (other than the ↗ icon) opens the same in-app preview pane that classified rows open. The row visually responds: `cursor: pointer` on hover (inherited from `.ai-doc-row`), active-row highlight on click.

### Logic Flow

1. Row template at `script.js:5548` gains `data-id`, `title`, and `onclick="selectDocument(...)"`.
2. Inline `style` drops `cursor: default;` and `opacity: 0.85;` so the row inherits standard `.ai-doc-row` hover + cursor styling.
3. OneDrive ↗ icon stays unchanged (its `event.stopPropagation()` already prevents row-click on icon click).
4. `selectDocument` runs unchanged → `loadDocPreview(item.id)` → preview pane opens.

### Data Structures / Schema Changes

None.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Line 5548: replace `<div class="ai-doc-row" style="opacity: 0.85; cursor: default;">` with `<div class="ai-doc-row" data-id="${escapeAttr(item.id \|\| '')}" title="${escapeAttr(fname)}" onclick="selectDocument('${escapeAttr(item.id \|\| '')}')">`. |
| `frontend/admin/index.html` | Modify | Line 1558: cache-bust `script.js?v=413` → `v=414`. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-401 active row. |
| `.agent/current-status.md` | Modify | Copy unchecked Section 7 items as Active TODOs. |

### Final Step

- Status `[BEING IMPLEMENTED — DL-401]` → after smoke verification → `[IMPLEMENTED — NEED TESTING]`.
- Update `.agent/design-logs/INDEX.md`.
- Copy Section 7 items to `.agent/current-status.md` Active TODOs.
- Invoke `git-ship` skill for commit/push (no merge to main; Pages git auto-deploy will pick up the change after main merge in a future ask).

## 7. Validation Plan

- [ ] **Monolith ratchet:** confirm net line count delta on `script.js` is 0 (in-place line replacement; pre-commit hook `script-size-ratchet.py` must not reject).
- [ ] **Manual smoke (live admin):** open AI Review tab with at least one unidentified card present (CPA-XXX / [client name redacted] case is live now). Click `image009.png` row → preview pane opens showing the image. Confirm row gets active highlight + cursor changes to pointer on hover.
- [ ] **Click on ↗ icon:** OneDrive opens in new tab AND row click does NOT also fire (existing `stopPropagation` should handle this).
- [ ] **Regression check classified rows:** open an identified card, click a doc row — no behavior change.
- [ ] **Mobile check:** narrow viewport, row click triggers `loadDocPreview` via DL-334 mobile short-circuit at `selectDocument`.
- [ ] **Cache-bust check:** after deploy, hard-reload admin and verify `script.js?v=414` is served.

## 8. Implementation Notes

**2026-05-04 — Edits applied:**

- `frontend/admin/js/script.js:5548` — single-line in-place replacement. Net line delta: 0. Used `escapeAttr(item.id || '')` defensively in case `item.id` is ever undefined (theoretically impossible — pending_classifications always have a recordId — but the `|| ''` keeps the onclick syntactically valid if it somehow happens, vs. throwing on `undefined`).
- `frontend/admin/index.html:1558` — `script.js?v=413` → `v=414`.
- No CSS changes needed: `.ai-doc-row` already has `cursor: pointer` + hover state from the classified-row styling. Removing the inline `cursor: default; opacity: 0.85;` allows the class default to take effect.

**Research principles actually applied:**

- **Single source of truth for click handlers** — both row variants now route through `selectDocument`. ✓
- **Reuse over re-implement** — no new fn introduced. ✓
- **Affordance match** — `cursor: default` + `opacity: 0.85` removed. ✓

**Deviations from plan:** none.

**Pending:** smoke test by user (live admin click on the Liran Almalem unidentified card → preview should open showing `image009.png`).
