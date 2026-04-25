# Design Log 346: Completion banner — separate questions flow from missing-docs flow
**Status:** [COMPLETED]
**Date:** 2026-04-25
**Related Logs:** DL-210 (banner origin), DL-308 (`previewApproveEmail`), DL-323 (user-initiated scroll), DL-333 (off-hours batch questions), DL-335 (on_hold + held questions), DL-341 (desktop banner host), DL-345 (missing-docs send action just shipped)

## 1. Context & Problem
The "כל המסמכים נבדקו!" green banner now mixes two independent action flows in one visual container:

- **Flow A — Questions:** the AI flagged docs that need a clarifying question to the client. Triggered by `hasPendingQuestions` (any item with `pending_question` and `review_status !== 'on_hold'`, AND client not in `_batchQuestionsSentClients`). Surfaces `סיום בדיקה ושליחת שאלות` + preview + `ערוך שאלות`.
- **Flow B — Missing docs (DL-345):** Airtable rollups show docs the client never sent. Triggered by `docsMissing > 0 && reportId`. Surfaces `שלח רשימת מסמכים חסרים` + `תצוגה מקדימה`.

Both can render simultaneously (they did in the screenshot from this session). Today they share one card with no visual boundary, both have a `תצוגה מקדימה` label, and the dismiss button (`סיום בדיקה`) only renders in the "neither" branch — making the layout look like four interchangeable buttons when they're actually two pairs of related actions targeting two different emails.

The DL-345 amber `<details>` chip (`נותרו N מסמכים`) duplicates information that should live with the missing-docs action, not stand on its own next to the verdict stats.

## 2. User Requirements
1. **Q:** What's the new layout shape?
   **A:** Outer green banner unchanged. Inside, two stacked white inner cards — one per flow — each with its own context line + primary action + labeled preview (+ optional `ערוך שאלות` for the questions card). Sub-sections render independently based on the existing flags. Cards have white bg, 0.5px border, `var(--radius-md)`, 12px padding, 8-10px gap between.
2. **Q:** What about the dismiss button?
   **A:** Render only when neither sub-section applies. When A or B render, dismiss is implicit in their primary action — no separate dismiss.
3. **Q:** Label changes?
   **A:** `תצוגה מקדימה של השליחה` → `תצוגה מקדימה של השאלות`. New: `תצוגה מקדימה של רשימת החסרים`. Everything else verbatim. DL-345 wording flips (`שלח שוב` + `נשלח כבר ב-<date>`) preserved.
4. **Q:** Button hierarchy inside each card?
   **A:** Solid green primary first, then ghost/outline preview, then ghost edit (questions only). Don't render all three as filled-green — the present uniformity is the bug.
5. **Q:** What goes away?
   **A:** Delete the bare `תצוגה מקדימה` button at the bottom of the missing-docs row (its purpose is unclear without context). Delete the standalone amber `<details>` chip — its info is now the context line of sub-section B.
6. **Q:** Mobile?
   **A:** Out of scope this DL. Mobile uses a different render path and stays untouched.

## 3. Research
### Domain
Admin operational UX / progressive disclosure / button hierarchy.

### Sources Consulted
1. **NN/g — *Visual Hierarchy in UI Design* (Aurora Harley)** — Same visual weight on multiple buttons reads as "pick any one, they're equivalent." If actions have different consequences (sends an email vs. dismisses UI vs. opens an edit modal), they must look different. Apply: primary green only on the one action that completes the flow; preview + edit demoted to ghost.
2. **NN/g — *Card UI Best Practices*** — Cards on a colored background work well as "one card = one self-contained idea." Apply: white sub-section card on green outer banner makes "one flow per card" legible.
3. **DL-308 + DL-345 (in-repo)** — Both already use the same backend endpoint with different ergonomics; there's already precedent for previews to be labeled by what they preview (the queue calls it `תצוגה מקדימה`, but in a context with one possible email). Apply: when two previews coexist, distinguish them by name.

### Key Principles Extracted
- **One card = one flow.** Visual containment communicates "these belong together; that other group is separate."
- **Primary visual weight tracks consequence.** A button that sends an email is not the same as a button that opens a preview modal — and they shouldn't look the same.
- **Labels disambiguate when context can't.** Two `תצוגה מקדימה` buttons in the same banner forced the operator to remember which was which.

### Patterns to Use
- **Inset card on tinted banner** — white bg, 1px border, soft radius, modest padding. Already exists project-wide as `.ui-inset-card` style; we'll add a banner-scoped variant.
- **Solid primary + ghost siblings** — `btn-success` (primary), `btn-ghost` / `btn-link` (preview/edit). Project's button system already supports this.

### Anti-Patterns Avoided
- **Stacked filled-green buttons** — looks like alternative routes, hides hierarchy. Replaced with one primary per card.
- **Redundant chip + identical info elsewhere** — the amber `<details>` is removed; its info collapses into card B's context line, which the user actually has to read to understand the action.
- **Implicit dismiss** when both flows are absent was already correct; we keep that branch.

### Research Verdict
Two-card structure on the existing green banner. Pure presentation refactor — no handler change, no email-flow change.

## 4. Codebase Analysis
* **Function to edit:** `_buildClientReviewDonePromptEl(clientName)` at `frontend/admin/js/script.js:7218`. Single function — both desktop (`_showClientReviewDonePromptDesktop`) and the mobile path call it. We're modifying its inner HTML only.
* **Existing handlers reused (no changes):**
  - `dismissClientReview(clientName)` — neither-flow dismiss.
  - `dismissAndSendQuestions(clientName)` — sub-section A primary.
  - `previewBatchQuestions(clientName)` — sub-section A preview.
  - `openBatchQuestionsModal(clientName)` — sub-section A edit.
  - `approveAndSendFromAIReview(reportId, clientName)` (DL-345) — sub-section B primary; `שלח שוב` + confirm-dialog wording flip already inside.
  - `previewApproveEmail(reportId, clientName)` (DL-308) — sub-section B preview.
* **Existing flags reused:**
  - `hasPendingQuestions = !_batchQuestionsSentClients.has(clientName) && clientItems.some(i => i.pending_question && i.review_status !== 'on_hold')` (line 7232-7233).
  - `docsMissing > 0 && reportId` (DL-345 path, line 7274 area; `reportId = rep.report_record_id || ''`).
  - Pending-questions count: `clientItems.filter(i => i.pending_question && i.review_status !== 'on_hold').length`.
* **CSS to add:** small block near existing `.ai-review-done-prompt` rules at `frontend/admin/css/style.css:2351`. New: `.ai-review-flow-card` (white inset), `.ai-review-flow-card__context`, `.ai-review-flow-card__actions`, `.ai-review-flows-stack`. Remove (or repurpose) the DL-345 `<details>`/chip block — keep the rule definitions in case we want them again, but the markup won't use them.
* **Cache-bust:** index.html script + style versions both need bumps.

## 5. Technical Constraints & Risks
* **Plural-aware Hebrew:** `1 ממתין לתשובה` (singular) vs `N ממתינים לתשובה` (plural). Existing code at line 7229 uses plural form unconditionally. We'll branch on count === 1 in both context lines (`נותר 1 מסמך שלא התקבל` / `נותרו N מסמכים שלא התקבלו`).
* **Empty-banner edge case:** if `clientItems` is empty (race during refresh), the function still runs. Guard: render header only with "אין פריטים לבדיקה" or short-circuit. Current behavior renders an empty stats line; we keep that to avoid scope creep.
* **`safeCreateIcons()`:** desktop and mobile paths both call it after building. New `chevron-down` removal is fine; `eye` / `send` / `pencil` / `check-circle-2` / `clock` / `check` all already in `scripts/icon-list.txt` — no sprite rebuild.
* **DL-345 `<details>` chip removal:** the chip's only data source was `missing_docs` for the expansion list. We are removing the expansion path. If the user later wants "click to see which docs are missing" again, we can add it inside sub-section B's context line as a secondary `<details>`. Out of scope per spec.
* **No regression in DL-335:** the held-questions filter inside `dismissClientReview` is untouched. We don't render the dismiss button in either flow card (per spec), so dismiss-with-on_hold-keep behavior only fires from the neither-flow path, which is unchanged.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
The banner reads at a glance as: header (verdict summary) + zero/one/two action cards (each self-contained with primary + preview + maybe edit) + optional dismiss when no card renders. Two `תצוגה מקדימה` buttons no longer collide visually. No email-flow regression.

### Logic Flow
1. Compute existing flags: `hasPendingQuestions`, `docsMissing`, `reportId`, `pendingQuestionsCount` (new — derive from same predicate already used).
2. Build header HTML (icon + heading + stats) — unchanged.
3. Build sub-section A iff `hasPendingQuestions`.
4. Build sub-section B iff `docsMissing > 0 && reportId`.
5. Build single dismiss button iff neither A nor B.
6. Concatenate header + (A or '') + (B or '') + (dismiss or ''). Stack uses `.ai-review-flows-stack` for the gap.

### Markup Sketch
Outer green prompt → header (icon + heading + stats) → `.ai-review-flows-stack` containing zero, one, or two `<section class="ai-review-flow-card">` elements. Each sub-section has a `__context` line followed by a `__actions` row. The single dismiss button is rendered inside `.ai-review-done-content` (right side) only when neither sub-section applies.

Sub-section A action row: `[send] btn-success` primary + `[eye] btn-ghost` preview + `[pencil] btn-ghost` edit.
Sub-section B action row: `[send] btn-success` primary + `[eye] btn-ghost` preview.
Hebrew labels: see "Label Changes" in Section 2.

### CSS Additions
```css
.ai-review-flows-stack {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);            /* 8px */
    margin-top: var(--sp-2);
    direction: rtl;
}
.ai-review-flow-card {
    background: var(--white);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-md);
    padding: var(--sp-3);        /* 12px */
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
}
.ai-review-flow-card__context {
    font-size: var(--text-xs);
    color: var(--gray-700);
}
.ai-review-flow-card__actions {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
}
```

DL-345 rules (`.ai-review-done-status`, `.ai-review-done-missing*`, `.ai-review-done-actions-row`) will be **deleted** — their markup is being removed.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Restructure `_buildClientReviewDonePromptEl` per the markup sketch. Remove the DL-345 `<details>` block and the bottom `.ai-review-done-actions-row`. Add plural-aware count strings. All onclick handlers stay identical. |
| `frontend/admin/css/style.css` | Modify | Add `.ai-review-flows-stack` + `.ai-review-flow-card*` rules near existing `.ai-review-done-prompt` rules at line ~2351. Remove the DL-345 chip / `<details>` / actions-row CSS that becomes orphaned. |
| `frontend/admin/index.html` | Modify | Bump `style.css?v=` and `script.js?v=` (current `v=335` for script). |

### Final Step
* Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section-7 items to `current-status.md` under "Active TODOs".

## 7. Validation Plan
* [ ] **State 1 — A only:** client with `pending_question` items, all docs received. Banner shows one white sub-section with primary `סיים בדיקה ושלח שאלות` + ghost `תצוגה מקדימה של השאלות` + ghost `ערוך שאלות`. No B card. No footer dismiss.
* [ ] **State 2 — B only:** client with no pending questions but `docsMissing > 0`. Banner shows one white sub-section with primary `שלח רשימת מסמכים חסרים` + ghost `תצוגה מקדימה של רשימת החסרים`. No A card. No footer dismiss.
* [ ] **State 3 — A + B:** matches the screenshot trigger. Two stacked white sub-sections with 8-10px gap; each self-contained; no footer dismiss.
* [ ] **State 4 — Neither:** all reviewed, all docs received, no pending questions. Header + single green `סיים בדיקה` button. No sub-sections.
* [ ] **DL-345 wording preservation:** when `docs_first_sent_at` is set, sub-section B primary reads `שלח שוב`; confirm dialog reads `נשלח כבר ב-<date>. לשלוח שוב ל-<client>?`.
* [ ] **Plural Hebrew:** `1 ממתין לתשובה` (n=1) vs `3 ממתינים לתשובה` (n=3); `נותר 1 מסמך שלא התקבל` vs `נותרו 4 מסמכים שלא התקבלו`.
* [ ] **Handler wiring:** each button fires the same function as before (smoke-test with `gws` for the questions email + missing-docs email — verify same recipients and bodies).
* [ ] **Held questions (DL-335):** dismiss path still keeps `on_hold` items in the queue when the neither-flow dismiss fires.
* [ ] **No regressions:** DL-323 user-initiated scroll still triggers; desktop pane-2 placement (DL-341) still correct; banner re-renders cleanly on `recalcAIStats` after each transition.
* [ ] Console clean on all four states.
* [ ] Mobile (≤768px) untouched — visual smoke check only, no spec changes.

## 8. Implementation Notes (Post-Code)
* `_buildClientReviewDonePromptEl` now derives `pendingQuestionsCount` once (instead of recomputing the predicate twice) and feeds the plural-aware context line.
* DL-345 markup (`<details>` chip + bottom `.ai-review-done-actions-row`) deleted entirely along with all associated CSS rules. The DL-345 logic is intact — it's just rendered through the new sub-section B card now.
* Stats line in the header still uses unconditional plural (`ממתינים לתשובת`) — out of scope per spec; the new plural-aware wording lives only in the new context lines.
* Single dismiss button moved BACK INSIDE `.ai-review-done-content` (right side, like the previous "neither" branch) so the header row reads as `[icon] [text] [dismiss]` when no flows apply — matches DL-210 visual rhythm.
* No handler signatures changed; `safeCreateIcons()` callers (desktop + mobile paths) untouched.
* Research principle applied (NN/g — *Visual Hierarchy*): one solid-green primary per card, ghost siblings for preview/edit. The previous "stacked filled-green buttons" anti-pattern is gone.
