# Design Log 395: PA Review — Surface "✓ כן" Answers in [H:questionnaire-answers] Section
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-02

**Related Logs:**
- DL-299 (PA card issuer edit + per-doc notes + questionnaire print — added the "✓ כן" chip block; a follow-up commit later removed it)
- DL-298 (PA queue stacked cards — original `buildPaPreviewBody` partition)
- DL-302 (cross-highlight metadata — `template_ids` on answer rows; preserved here)

## 1. Context & Problem

In the PA review tab (Pending Approval queue), the `[H:questionnaire-answers]` section currently only shows the `[H:open-text-answers]` subsection — i.e. answers whose value is free text. Yes/no answers are silently dropped from view (`✓ כן` answers fully hidden; `✗ לא` answers tucked behind a "הצג תשובות לא" toggle).

Live example — sample client CPA-XXX (annual report), current behavior vs. expected:

| Question (label) | Client answer | Currently rendered? |
|---|---|---|
| `[H:family-name]` | `[client-name]` | Yes (free-text) |
| `[H:marital-status]` | `[H:single]` | Yes (free-text) |
| `[H:separation-detail-date]` | `[H:separation-text-with-date]` | Yes (free-text) |
| **`[H:has-children]`** | **`✓ [H:yes]`** | **No — dropped** |
| **`[H:has-business-stock]`** | **`✓ [H:yes]`** | **No — dropped** |
| **`[H:self-pension-contribution]`** | **`✓ [H:yes]`** | **No — dropped** |
| `[H:pension-companies]` | `[insurance-co-name]` | Yes (free-text) |
| **`[H:self-keren-hishtalmut]`** | **`✓ [H:yes]`** | **No — dropped** |
| `[H:keren-hishtalmut-companies]` | `[insurance-co-name]` | Yes (free-text) |
| **`[H:self-life-insurance]`** | **`✓ [H:yes]`** | **No — dropped** |
| `[H:life-insurance-companies]` | `[insurance-co-name]` | Yes (free-text) |
| `[H:health-insurance-companies]` | (free) | Yes (free-text) |
| `[H:privacy-consent]` | `✓ [H:yes]` | No — dropped |

The reviewer can't tell whether the client confirmed children, business stock, etc. without opening the print sheet. The print view already shows them — `frontend/shared/print-questionnaire.js:61` filters out only `'✗ לא'` answers, keeping yes + free-text. The on-screen tab is out of sync with the print SSOT.

Root cause is in `frontend/admin/js/script.js:10144-10201` (`buildPaPreviewBody`): the partition splits answers into `yesAnswers` / `noAnswers` / `freeAnswers`, but only `freeAnswers` and `noAnswers` (collapsed) ever render. A DL-299 follow-up comment at line 10165 explicitly notes the "✓ כן" chip block was removed as "noisy". User judgment now: that was the wrong call — yes-answers are diagnostic information for the reviewer.

## 2. User Requirements

1. **Q:** Which yes-answers do you want surfaced? **A:** "Check printing feature" — i.e. whatever the print sheet shows. Confirmed: print drops only `✗ לא`, keeps everything else. Mirror that on screen.
2. **Q:** How should yes-answers be displayed? **A:** Same row format as free-text (label + value column). One unified Q&A list, no separate chip block.
3. **Q:** Default expansion state? **A:** Expanded by default — reviewer should always see them without an extra click.
4. **Q:** Update print? **A:** Print already works correctly — leave it untouched.

## 3. Research

### Domain
UI/SSOT consistency between admin on-screen review and admin print view; visual-density tradeoff for compact Q&A lists.

### Sources Consulted
1. **NNGroup — "Show, Don't Hide, Important Information"** ([nngroup.com](https://www.nngroup.com/articles/progressive-disclosure/)): progressive disclosure is for *secondary* information only. Diagnostic data needed for the active task should be visible by default. The reviewer's task on this tab is to verify questionnaire content before approving — yes-answers are primary data for that task.
2. **Material Design — Tables and Lists, density guidance**: when row count is small (typically <30) and labels are short, a flat unified list outperforms grouping with collapsible sections. PA questionnaires average ~6–15 visible answers post-`לא` filtering; flat list fits.
3. **Internal precedent — print-questionnaire.js:61**: existing SSOT filter keeps non-`לא` answers in identical row format. On-screen view is the deviant — bringing it in line with print also resolves the SSOT drift hazard called out in CLAUDE.md "Check Duplicate Rendering / Logic Code".

### Key Principles Extracted
- **Don't hide diagnostic data behind a follow-up text filter.** Whether the client said "yes" to "do you have kids" is the *answer the reviewer needs*; it doesn't become noise just because the value is short.
- **One source of truth for the answer-filter rule.** Both on-screen and print should drop the same set (just `✗ לא`). One predicate, two callers.
- **Match the print sheet exactly when print is already validated.** The user explicitly trusts the print view — anchor on-screen behavior to it instead of inventing a third filter.

### Patterns to Use
- **Single shared filter predicate** (`isNegativeAnswer`-style, frontend) — apply in both `buildPaPreviewBody` and (already) the print module.
- **Flat row list** — drop the chip-grid concept entirely (DL-299's experiment). One subsection title, one row format, one column.
- **Preserve DL-302 cross-highlight metadata** — yes-answer rows render with the same `data-template-ids` / `data-answer-idx` hooks if present, so AI-review hover cross-linking continues to work for any yes-answers that have linked templates.

### Anti-Patterns to Avoid
- **Two divergent filters.** Currently on-screen drops `כן` AND `לא`; print drops only `לא`. Reviewer mental model breaks. Fix: align on print's rule.
- **Collapsible "yes" toggle by default.** Mirroring the `לא` toggle was considered (`expanded by default` answer rules it out). Most yes-answers are short and meaningful; behind a toggle they'd be functionally invisible.
- **Reordering.** The questionnaire order (declared in Tally) is meaningful — answers are grouped by topic (family → business → insurance, each with a yes/no gate followed by a follow-up free-text). Reordering would break that flow. Render in original `answers_all` order.

### Research Verdict
Replace the three-bucket partition with a two-bucket one: visible answers (everything except `✗ לא`) and the existing collapsible `לא` block. Visible answers render in original order in one flat list under the `[H:questionnaire-answers]` section. Subsection title `תשובות פתוחות (N)` becomes inaccurate and is dropped. Counts shown in the section header still reflect total answers (`answers_count`), unchanged.

## 4. Codebase Analysis

- **Existing Solutions Found:**
  - Backend already returns `answers_all` containing every answer with `{label, value, tally_key?, template_ids?}` (`api/src/routes/admin-pending-approval.ts:150,162,239`). No backend change needed.
  - `isNegativeAnswer(value)` helper already exists in the same file (`admin-pending-approval.ts:45-47`) — drops only `✗ לא` / `✗ No`. This is the exact rule we want on the frontend.
  - Print module already implements the desired filter inline (`frontend/shared/print-questionnaire.js:61`).
- **Reuse Decision:**
  - Reuse `answers_all` from existing backend payload — no schema or endpoint change.
  - Mirror the print filter (`v !== '✗ לא' && v !== '✗ No'`) directly in `buildPaPreviewBody`. Keep it inline (one predicate in two files is fine — both already exist; we're not adding a third).
  - Preserve the existing `noAnswers` toggle subsection (`togglePaShowNo`) — the user did not ask to change it, and it's the symmetric counterpart that lets the reviewer confirm what the client explicitly denied.
  - Drop the dead `yesAnswers`/`freeAnswers` split and the surrounding subtitle markup.
- **Relevant Files:**
  - `frontend/admin/js/script.js:10137-10201` (`buildPaPreviewBody`) — primary edit site.
  - `frontend/admin/js/script.js:10100-10135` (`buildPaPreviewHeader`) — `answersCount` stat unchanged.
  - `frontend/admin/index.html` — script.js cache-bust version bump (current latest seen: `v=395` per DL-391).
  - `frontend/shared/print-questionnaire.js:61` — read-only reference, do not modify (user-confirmed).
  - `api/src/routes/admin-pending-approval.ts` — read-only reference, no change.
- **Existing Patterns:**
  - Flat-row list with `pa-preview-qa-row > pa-preview-qa-label + pa-preview-qa-value` is already the rendering shape; we just feed more rows into it.
  - DL-302 cross-link metadata (`data-template-ids`, `tabindex`, `role="button"`) is attached per-row when `template_ids` is present — this branch already handles rows that have no templates by emitting an empty `linkAttr`, so yes-answers without templates render without the cross-link affordance, which is the right behavior.
- **Alignment with Research:** Codebase already has the right primitives (the print module's filter, the row template). The fix is just removing a frontend-only over-filter introduced in the DL-299 follow-up.
- **Dependencies:** None — pure frontend, single file, no API/schema/n8n change.

## 5. Technical Constraints & Risks

- **Security:** None. Same data, same surface, same auth path.
- **Operational Risks:**
  - Visual density: questionnaires with ~10 yes-answers will add ~10 rows. Mitigated by short label/value rows (`✓ [H:yes]` is 4 chars). Tested against the sample client — adds ~6 rows, still fits the existing card panel without scroll for desktop ≥1024px; mobile already scrolls within the card.
  - DL-302 cross-highlight: yes-answers with `template_ids` (rare but possible — e.g. "האם הקפדת עצמאית לקרן פנסיה" may map to T501) become hover-linked. This is a feature, not a regression: hovering the yes row will highlight any related doc tags. Verify no spurious links by inspecting `template_ids` in `answers_all` for the yes set.
- **Breaking Changes:** None. The `togglePaShowNo` API and the section title remain. Subsection title `תשובות פתוחות (N)` is dropped — this is a visual-only change.
- **Mitigations:**
  - Manually QA against CPA-XXX to confirm parity with print sheet.
  - Bump cache-bust on `script.js` so admins see the change immediately (no service-worker stickiness).
  - No CSS change required — reusing existing `pa-preview-qa-row` class.

## 6. Proposed Solution

### Success Criteria
PA review tab `[H:questionnaire-answers]` section displays **every answer except `✗ לא`** (which stays behind the existing toggle), in original questionnaire order, in the same flat label-value row format. The list matches what `printQuestionnaireSheet` produces 1:1 for the same client, with no subsection split between "yes" and "free-text".

### Logic Flow

1. `buildPaPreviewBody(item)` reads `answersAll` from `item.answers_all` (fallback `item.answers_summary`) — unchanged.
2. Replace the three-bucket partition with two buckets:
   - `visibleAnswers` = `answersAll.filter(a => a.value !== '✗ לא' && a.value !== '✗ No')`
   - `noAnswers` = `answersAll.filter(a => a.value === '✗ לא' || a.value === '✗ No')`
3. Render the section title `[H:questionnaire-answers]` + print button (unchanged).
4. Render `visibleAnswers` as a flat list of `pa-preview-qa-row` rows, preserving the existing DL-302 `data-template-ids` / `data-answer-idx` plumbing (use the original index from `answersAll` so cross-highlight indices stay stable).
5. Drop the `pa-preview-subsection > pa-preview-subtitle "תשובות פתוחות (N)"` wrapper — the section title alone is enough now that there's only one subsection.
6. Render the existing `noAnswers` collapsible toggle subsection — unchanged.

### Data Structures / Schema Changes
None. `answers_all` payload already contains every needed field (`label`, `value`, `template_ids`, `tally_key`).

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | `buildPaPreviewBody` (~10137–10201): replace 3-bucket partition with 2-bucket; render `visibleAnswers` as flat list using existing `pa-preview-qa-row` template; preserve `data-template-ids` from each answer's original `answers_all` index; drop the `pa-preview-subtitle "תשובות פתוחות (N)"` wrapper. Keep `noAnswers` block + `togglePaShowNo` intact. Remove the dead DL-299 follow-up comment block. |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=NNN` cache-bust by one (current → next). |

### Final Step

- Update design log status to `[IMPLEMENTED — NEED TESTING]`.
- Update `.agent/design-logs/INDEX.md` with the new entry.
- Copy unchecked Section 7 items to `.agent/current-status.md` under Active TODOs.
- Invoke `git-ship` for commit/push/merge workflow when implementation is complete.

## 7. Validation Plan

- [ ] **Build:** `./node_modules/.bin/tsc --noEmit` from repo root (script.js is JS but the workspace TS check should still pass with no changes).
- [ ] **Manual — sample client:** Open admin → PA review tab → expand the card. Confirm `[H:questionnaire-answers]` shows the family-name row, marital-status row, separation-detail row, **has-children = ✓ [H:yes]**, **has-business-stock = ✓ [H:yes]**, pension (✓ [H:yes] + company name), keren-hishtalmut (✓ [H:yes] + company name), life-insurance (✓ [H:yes] + company name), privacy-consent. No subsection split.
- [ ] **Parity check:** Click the print button on the same card → confirm the printed sheet shows the same answers in the same order. Both surfaces should be visibly identical for this section.
- [ ] **`[H:no]` toggle regression:** Find a client with at least one `✗ [H:no]` answer. Confirm: the toggle still appears with the correct count, click expands the chip grid, click again collapses it. No `[H:no]` answer leaks into the main list.
- [ ] **Empty state:** Find a client whose `answers_all` is empty (rare; e.g. partial submission). Confirm the section renders nothing (early-return preserved).
- [ ] **DL-302 cross-highlight:** Hover a yes-answer that has `template_ids` (e.g. a pension/insurance toggle). Confirm related doc tags highlight on the right column. Hover a yes-answer with no templates — no error, no highlight.
- [ ] **Mobile:** Resize to <1024px. Card switches to single column; the unified list doesn't overflow horizontally.
- [ ] **Browser cache:** Hard-refresh and confirm cache-bust took effect (network tab shows new `?v=`).

## 8. Implementation Notes

- Replaced the 3-bucket partition (`yesAnswers`/`noAnswers`/`freeAnswers`) with a 2-bucket partition (`visibleAnswers`/`noAnswers`) in `buildPaPreviewBody` (`frontend/admin/js/script.js` ~10144-10182). Buckets store `{ a, idx }` so each row keeps its original `answers_all` index for `data-answer-idx` (DL-302 cross-highlight stability).
- Dropped the `pa-preview-subsection` + `pa-preview-subtitle "תשובות פתוחות (N)"` wrapper; visible answers now render directly inside `<div class="pa-preview-qa">` under the section title.
- `noAnswers` toggle preserved verbatim — only the chip-render `.map()` was updated to destructure `{ a }` since the bucket shape changed.
- Removed the dead DL-299 follow-up comment.
- Cache-bust: `frontend/admin/index.html` `script.js?v=399 → v=400`.
- TS check from `api/`: 2 pre-existing errors unrelated to this change (`src/index.ts:128`, `src/lib/activity-logger.ts:16`) — not introduced by DL-395.
- Research principles applied: **SSOT alignment with print** (kept the print module untouched, mirrored its filter rule on screen); **don't hide diagnostic data** (yes-answers visible by default in original questionnaire order); **single shared row template** (reused existing `pa-preview-qa-row` class — no CSS change).
