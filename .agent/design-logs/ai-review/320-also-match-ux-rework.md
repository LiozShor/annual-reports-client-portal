# Design Log 320: "Also Matches" UX Rework + Robot Icon Removal
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-21
**Related Logs:** DL-314 (multi-template match — introduced the button this rework replaces), DL-222 (multi-PDF approve conflict — 3-option dialog prior art), DL-205 (clear-on-revert field semantics)

## 1. Context & Problem

DL-314 (shipped 2026-04-21) introduced the **"גם תואם ל.."** button on AI Review cards in their *pre-approve* state so admin could link one file to N templates. Immediate feedback after live use:

1. **Button appears too early.** Pre-approve is the wrong moment — admin's mental model is "approve the primary first, then extend." Showing the multi-match entry point before the primary decision adds choice overload and visual clutter to the decision that matters most (approve / reassign / reject).
2. **Wording is awkward.** "גם תואם ל.." (trailing ellipsis) is unclear without hovering; admin has to guess what it does.
3. **Placement / visual weight.** It competes with the primary Approve / Reassign / Reject actions.
4. **"?" robot help icon** (`<span class="ai-evidence-trigger">${icon('bot')}?</span>` at line 4271) on every AI card is decorative noise; the AI reason already renders inline in the unmatched state and is not information the admin needs on every card.
5. **No post-approve entry point.** An admin who realizes *after* approval that the same file satisfies another template currently has no way to link it — they'd have to un-approve, multi-match, re-approve. DL-314's own §8 lists this gap as an open TODO.

## 2. User Requirements
1. **Q:** What's unsatisfying about the current "גם תואם ל.." button?
   **A:** All three: appears too early (pre-approve), wording awkward, placement/visual weight.
2. **Q:** Where should the new post-approve button live?
   **A:** On the already-reviewed AI Review card only (not doc-manager rows, not both surfaces).
3. **Q:** Reuse the same modal or new one?
   **A:** Reuse `showAIAlsoMatchModal`.
4. **Q:** Remove "?" robot icon from all cards, or selectively?
   **A:** Remove from all AI Review cards.
5. **Q:** Exact Hebrew label for the new post-approve button?
   **A:** **"הקובץ תואם למסמך נוסף"**.
6. **Q:** Revert behavior on "שנה החלטה" when primary has linked sibling records?
   **A:** **Cascade** — clear primary + all siblings. (Deviates from DL-314's per-record unlink.)

## 3. Research
### Domain
UI affordance reduction (post-hoc correction of a shipped feature), cascade-delete UX, tooltip/iconography minimization.

### Sources Consulted
1. **Nielsen Norman Group — Tooltip Guidelines** — "Important information should always be on the page; tooltips shouldn't be essential for tasks." Supports removing the decorative "?" robot icon.
2. **Nielsen Norman Group — Reducing Cognitive Load** — Minimalism principle: remove elements that don't earn their place. Text labels > ambiguous icons.
3. **Supabase / Salesforce / Quick Admin Panel — Cascade Delete guidance** — Cascade is acceptable *when paired with an explicit confirmation dialog that quantifies the blast radius*. Silent cascade is an anti-pattern.
4. **DL-314 (prior research)** — Reference counting + "metadata over duplication" (SharePoint, Convex, AWS Comprehend). Already established patterns; this log reuses them.

### Key Principles Extracted
- **Remove rather than decorate** — the "?" icon adds no task-critical info; the AI reason still shows inline in the unmatched state.
- **Move entry points to the right moment** — multi-match is extension-of-approval, not part-of-approval. It belongs on the approved card.
- **Cascade requires confirmation with count** — never silent.

### Patterns to Use
- **Post-approve action on reviewed card** — mirror the "שנה החלטה" pattern: action buttons live in `renderReviewedCard`'s `.ai-card-actions`.
- **Confirmation-with-count dialog** — reuse existing `showConfirmDialog(message, onConfirm, confirmText, danger)` helper (line 10109). Hebrew copy: `"שינוי ההחלטה יסיר גם ${n} קישורים נוספים: ${titles.join(', ')}. להמשיך?"`.
- **Reference-count gate on archive** — reuse DL-314's `isLastReference()` from `api/src/lib/file-refcount.ts`.

### Anti-Patterns to Avoid
- **Silent cascade** — flagged by Supabase/Salesforce docs. Mitigation: explicit dialog.
- **Both pre- and post-approve buttons** — would keep the original noise. User chose replace, not add.
- **Redesign from scratch** — `showAIAlsoMatchModal` already works; only the entry point moves.

### Research Verdict
Remove pre-approve button entirely; add post-approve button on `renderReviewedCard`; remove decorative icon; add cascade confirmation on "שנה החלטה" when siblings exist.

### Deviation from DL-314
DL-314 chose **per-record unlink** as the revert semantic. User explicitly chose **cascade** here. Rationale: the sibling records were created as a *consequence* of approving the primary; undoing that decision should undo the whole chain. Per-record unlink remains available via doc-manager's direct "delete file" action on individual rows.

## 4. Codebase Analysis

### Existing Solutions Found
- `frontend/admin/js/script.js:4270–4272` — `evidenceIcon` span construction
- `frontend/admin/js/script.js:4526` — `${evidenceIcon}` interpolation in pre-approve card template
- `frontend/admin/js/script.js:4296–4298` — pre-approve "גם תואם ל..." button in `state='full'`
- `frontend/admin/js/script.js:4406–4408` — pre-approve "גם תואם ל..." button in `state='fuzzy'`
- `frontend/admin/js/script.js:4547–4643` — `renderReviewedCard` (post-approve card template)
- `frontend/admin/js/script.js:4612–4618` — `actionsHtml` for reviewed state (currently only "שנה החלטה")
- `frontend/admin/js/script.js:4647–4700` — `startReReview(recordId)` — UI-only toggle; no backend mutation
- `frontend/admin/js/script.js:5353–5437` — `showAIAlsoMatchModal(recordId)` — reusable as-is
- `frontend/admin/js/script.js:10109` — `showConfirmDialog(message, onConfirm, confirmText, danger)`
- `frontend/admin/js/script.js:10396–10414+` — floating tooltip IIFE (harmless when no triggers exist; leaving in place)
- `frontend/admin/css/style.css:2066, 2082` — `.ai-evidence-trigger` styles (removable)
- `api/src/routes/classifications.ts:80+` — `/get-pending-classifications` (emits the items payload; needs `shared_ref_count` / `shared_with_titles` / `shared_record_ids` added)
- `api/src/routes/classifications.ts:416+` — `/review-classification` POST (add new `action='revert_cascade'`)
- `api/src/lib/file-refcount.ts` — `countDocsSharingFile`, `isLastReference`, `buildSharedRefMap` — reuse

### Reuse Decision
- **Modal (`showAIAlsoMatchModal`)** — reuse unchanged; it pulls from `aiClassificationsData` and already filters already-matched templates.
- **`startReReview`** — extend to check `shared_ref_count` and show confirmation before transitioning UI. Add a cascade backend call on confirm.
- **Reference counting** — reuse DL-314's helpers.
- **Floating tooltip IIFE** — leave intact; no performance cost with zero triggers.

### Alignment with Research
- NN/G removal principle: the "?" icon fails the "earns its place" test → remove.
- Cascade-with-count matches DB best practice. Confirmation message includes explicit count + sibling titles.

### Dependencies
- No new npm packages.
- No Airtable schema changes.
- `admin/index.html` cache version bump (project memory: `feedback_admin_script_cache_bust.md`).

## 5. Technical Constraints & Risks

### Security
- New `action='revert_cascade'` reuses admin Bearer token. Must validate classification exists and its linked records all belong to same client (reuse DL-314 client-match guard).

### Risks
| Risk | Mitigation |
|------|-----------|
| Admin in-flight workflow: someone was about to multi-match before approving | New post-approve path is strictly more ergonomic. Communicate in commit + Natan-facing note. |
| CSS dependency on `.ai-evidence-trigger` elsewhere | Grep confirmed: only `style.css` lines 2066+2082. Safe to remove. |
| Cascade surprise vs DL-314 per-record unlink semantics | Explicit confirmation with count + titles. Also: per-record unlink still available via doc-manager row-level delete. |
| `startReReview` is UI-only today — cascade requires a NEW backend call | Add `action='revert_cascade'` to `/review-classification`. Reuse `countDocsSharingFile` + `moveFileToArchive` helpers. |
| Sibling doc IDs not currently on classifications payload | Add `shared_ref_count`, `shared_with_titles[]`, `shared_record_ids[]` to `/get-pending-classifications` items. Requires adding `onedrive_item_id` to docRecords fetch. |
| `cache:documents_non_waived` 5min KV cache wouldn't include `onedrive_item_id` if we add the field to the fetch — stale hits would be missing it | Bump cache key to `cache:documents_non_waived_v2` (DL-320) to force fresh. |
| Floating tooltip IIFE becomes dead code | Harmless. Delegated listener; zero match = zero work. |

### Breaking Changes
- None. Admin flow: pre-approve multi-match option removed; same capability available post-approve. No data format changes.

## 6. Proposed Solution

### Success Criteria
Pre-approve AI Review cards show only the primary decision actions. Approved cards gain a "הקובץ תואם למסמך נוסף" button that opens the same DL-314 modal. Robot "?" icon is gone everywhere. Clicking "שנה החלטה" on a card with siblings shows a confirmation with count + titles; on confirm, primary and all siblings revert and the OneDrive file archives.

### Logic Flow

**Frontend — card rendering:**
1. Delete `evidenceIcon` construction (script.js:4270–4272) and its interpolation (script.js:4526).
2. Delete pre-approve "גם תואם ל..." buttons (script.js:4296–4298 and 4406–4408).
3. In `renderReviewedCard`, when `reviewStatus === 'approved'` (i.e., card is approved, not rejected/reassigned), inject new button BEFORE "שנה החלטה":
   ```js
   <button class="btn btn-outline btn-sm ai-also-match-btn"
       onclick="showAIAlsoMatchModal('${escapeAttr(item.id)}')">
     ${icon('link-2', 'icon-sm')} "הקובץ תואם למסמך נוסף"
   </button>
   ```
4. Bump `script.js?v=275` → `276` in `admin/index.html`.

**Frontend — cascade confirmation:**
1. Modify `startReReview(recordId)`:
   - Look up `item.shared_ref_count` (new field from server).
   - If `> 1`: `showConfirmDialog(msg, onConfirm, 'המשך ונקה', true)` where `msg` = `"שינוי ההחלטה יסיר גם ${n-1} קישורים נוספים: ${titles.join(', ')}. להמשיך?"`.
   - On confirm: POST `/webhook/review-classification` with `action='revert_cascade'`. On success → refresh AI Review data (existing `loadAIReview()` or equivalent).
   - On cancel: no-op, stay on reviewed card.
   - If `shared_ref_count <= 1`: original flow (UI toggle to pre-approve actions).

**Backend — new action `revert_cascade`:**
1. Validate token, `classification_id`.
2. Fetch classification; extract `onedrive_item_id` + linked `document` record.
3. Find all Airtable doc records with `{onedrive_item_id} = '...'` AND `{status} = 'Received'` (reuse `countDocsSharingFile` logic, return records not just count).
4. Client-match guard: confirm all affected records' reports belong to same `client_id` (defense-in-depth).
5. For each affected doc record: patch `status = 'Required_Missing'`, clear `file_url`, `onedrive_item_id`, `file_hash`, `attachment_name`, `review_status`.
6. After clearing, call `moveFileToArchive(msGraph, itemId)` (count is now 0 — safe).
7. Reset classification: `review_status = 'pending'`, clear `document` link, `notification_status = ''`.
8. Respond `{ ok: true, cleared_doc_ids: [...], archived: true/false }`.

**Backend — pending-classifications enrichment:**
1. Add `'onedrive_item_id'` to docRecords fetch `fields` array (line 212).
2. Bump cache key `cache:documents_non_waived` → `cache:documents_non_waived_v2`.
3. Before building items array, call `buildSharedRefMap(docRecords)` → map of `onedrive_item_id → {count, titles, ids}`.
4. On each item: if `f.onedrive_item_id`: attach `shared_ref_count`, `shared_with_titles`, `shared_record_ids` from the map (else empty defaults).

### Data Structures / Schema Changes
- **No Airtable fields added.**
- **API response additions on `/get-pending-classifications` items:**
  - `shared_ref_count: number` — count of Received docs sharing this file (including self)
  - `shared_with_titles: string[]` — issuer names of siblings (including self, frontend filters)
  - `shared_record_ids: string[]` — doc record IDs (for cascade targeting)
- **New API action:** `POST /webhook/review-classification { action: 'revert_cascade', classification_id }`.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Remove `evidenceIcon` (4270–4272, 4526) + both pre-approve "גם תואם" buttons (4296–4298, 4406–4408). Add `alsoMatchBtn` to `renderReviewedCard` actionsHtml (4612–4618). Wrap `startReReview` with cascade confirmation. |
| `frontend/admin/css/style.css` | Modify | Remove `.ai-evidence-trigger` + `.ai-evidence-trigger:hover` blocks (2066, 2082). Add minimal `.ai-also-match-btn` styling. |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=275` → `?v=276`. |
| `api/src/routes/classifications.ts` | Modify | Add `'onedrive_item_id'` to docRecords fetch. Bump cache key to `cache:documents_non_waived_v2`. Enrich items with `shared_ref_count` / `shared_with_titles` / `shared_record_ids`. Add `action='revert_cascade'` branch. |
| `api/src/lib/file-refcount.ts` | Modify (minor) | Export a `findSiblingRecords(airtable, onedriveItemId)` helper (returns full records, not just count). |
| `.agent/design-logs/ai-review/320-also-match-ux-rework.md` | Create | This file. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-320 entry under Active → `ai-review/`. |

### Final Step (Always)
Update status → `[IMPLEMENTED — NEED TESTING]`; copy unchecked §7 items to `.agent/current-status.md`; update INDEX; run `wrangler deploy` from `api/`; commit + push; pause for merge approval.

## 7. Validation Plan

### Build-time
- [ ] `./node_modules/.bin/tsc --noEmit` from `api/` passes
- [ ] `npx wrangler deploy --dry-run` from `api/` passes
- [ ] Admin page loads with bumped cache version, no JS console errors

### Live end-to-end (MANDATORY before [COMPLETED])
- [ ] AI Review page: pre-approve cards (full/fuzzy/mismatch/unmatched) show NO "גם תואם ל..." button
- [ ] All AI Review cards show NO "?" robot icon in any state
- [ ] Approve a classification → card transitions to reviewed-approved → verify NEW "הקובץ תואם למסמך נוסף" button appears next to "שנה החלטה"
- [ ] Click new button → same DL-314 multi-match modal opens → select 2 templates → confirm → 2 sibling doc records created sharing `onedrive_item_id`
- [ ] Reload AI Review → reviewed card now shows `shared_ref_count = 3` (verify via DevTools or sibling chip)
- [ ] Click "שנה החלטה" on the sibling-bearing card → confirmation dialog shows count + sibling titles → confirm → all 3 records cleared (status=Required_Missing), OneDrive file moved to `archive-folder`, classification resets to pending
- [ ] Click "שנה החלטה" on a card WITHOUT siblings → NO confirmation dialog, original UI toggle flow works
- [ ] Reject / reassign flows unchanged

### Regression
- [ ] Existing primary Approve / Reassign / Reject flows unchanged
- [ ] DL-314 multi-match modal flow works (now invoked only from post-approve)
- [ ] `friendlyAIReason` still renders inline in unmatched state (line 4420)
- [ ] `buildShortName` / `renderDocLabel` still render correct labels on AI cards (no regression from removing evidenceIcon interpolation)
- [ ] `admin/index.html` JS loads with fresh cache (hard-reload test)

## 8. Implementation Notes (Post-Code)

**Files changed (this session):**
- `frontend/admin/js/script.js` — removed `evidenceIcon` span + interpolation; removed pre-approve "גם תואם ל..." buttons from `state='full'` and `state='fuzzy'`; added `alsoMatchBtn` to `renderReviewedCard` actionsHtml (only when `reviewStatus === 'approved'`); added cascade-confirmation branch to `startReReview` that fires when `item.shared_ref_count > 1`; added new `cascadeRevertAIClassification(recordId)` that POSTs `action='revert_cascade'` and reloads AI Review data.
- `frontend/admin/css/style.css` — removed `.ai-evidence-trigger` + `.ai-evidence-trigger:hover` blocks. Kept `.ai-evidence-tooltip` block (delegated tooltip IIFE is harmless with zero triggers; class referenced at runtime).
- `frontend/admin/index.html` — `script.js?v=275` → `?v=276`.
- `api/src/routes/classifications.ts` — added `'onedrive_item_id'` to docRecords fetch `fields` list; bumped cache key `cache:documents_non_waived` → `cache:documents_non_waived_v2` (also updated all 3 in-file invalidation call sites); imported `buildSharedRefMap`; built `sharedRefMap` before items array and attached `shared_ref_count` / `shared_with_titles` / `shared_record_ids` (defaulting to empty when no item_id); added `'revert_cascade'` to action allow-list; added new `action='revert_cascade'` branch — finds all Received docs sharing the onedrive_item_id, defense-in-depth client-match guard, clears each doc back to Required_Missing, resets classification to pending, archives file via `moveFileToArchive`, invalidates v2 cache.
- `api/src/routes/approve-and-send.ts` — updated its `cache:documents_non_waived` invalidation to `_v2`.
- `.agent/design-logs/ai-review/320-also-match-ux-rework.md` — created.
- `.agent/design-logs/INDEX.md` — added DL-320 row.

**Deviations from plan:**
1. **Did not export `findSiblingRecords` from `file-refcount.ts`** — inlined a small Airtable `listAllRecords` call in the `revert_cascade` handler. Fewer files to touch; same behavior. Can extract later if a third caller appears.
2. **Kept the floating-tooltip IIFE in script.js (lines ~10396+) intact.** Plan suggested leaving it; confirmed harmless (delegated mouseover listener matches zero `.ai-evidence-trigger` nodes → zero work). Removing it would be dead-code cleanup for the next pass.
3. **Reviewed card button appearance guard** — only renders when `reviewStatus === 'approved'` (not on `rejected` / `reassigned`), avoiding a semantically-wrong button on non-approved reviewed states.

**Open TODOs (move to current-status.md):**
- [ ] Live end-to-end testing per §7 checklist (multi-match post-approve, cascade confirm, icon removal).
- [ ] Consider removing the floating-tooltip IIFE in a future cleanup pass (~5 lines at line 10396+).
- [ ] After DL-318 (AI Review perf) ships, re-verify `cache:documents_non_waived_v2` invalidation still interacts correctly with the response-level KV cache.
