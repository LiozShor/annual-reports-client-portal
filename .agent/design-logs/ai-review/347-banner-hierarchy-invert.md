# Design Log 347: Completion banner — invert action hierarchy (finish primary, send-list secondary)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-25
**Related Logs:** DL-210 (banner origin), DL-308 (email preview), DL-323 (user-initiated scroll), DL-333 (off-hours batch questions), DL-335 (held questions / on_hold), DL-341 (desktop banner host), DL-345 (missing-docs send action — now superseded in presentation), DL-346 (two-flow split — direct predecessor)

## 1. Context & Problem
DL-346 split the banner's actions into a questions card and a missing-docs card with the right structural shape, but the visual hierarchy inside is wrong:

- The two card-primary buttons (`סיים בדיקה ושלח שאלות`, `שלח רשימת מסמכים חסרים`) are solid green — the loudest controls in the banner.
- `סיים בדיקה` is a small ghost button at the top-right of the header.

Two problems:

1. **Asymmetric reversibility, wrong emphasis.** Sending a missing-docs email is irreversible (the client gets it; no undo). Dismissing the review is reversible (the client + their items can be re-opened any time). The dominant visual primary should be the *safer*, *more reversible* action. Today it's flipped.
2. **Y-dominant usage trained wrong.** Per the user observation, "Natan finishes the client without sending" is at least as common as "Natan sends the list." The current loudness teaches the muscle memory of clicking the green button to finish — and one day that click sends an email when the operator meant to dismiss.

This is a presentation-only fix. No data flow, no logic, no new conditions.

## 2. User Requirements
1. **Q:** Where does `סיים בדיקה` live and how loud?
   **A:** Always rendered. Lives at the **bottom** of the banner. Solid green primary (the only solid green in the banner). Taller (~10px padding), centered, font-size 14px, font-weight 500.
2. **Q:** What style for the card "send" buttons?
   **A:** Outlined ghost — white/transparent bg, `--success-700` text, 0.5px `--success-500` border, 5px 12px padding, 12-13px font, hover with subtle green tint. **No solid fill.** Same treatment for both `שלח שאלות ללקוח` and `שלח רשימת חסרים ללקוח`.
3. **Q:** Preview buttons?
   **A:** Demote to text-link (no button chrome). `--text-secondary` color, underline on hover. They're auxiliary, not actions.
4. **Q:** Conditional rendering?
   **A:** Same flags as DL-346. The only render-logic change is `סיים בדיקה` now ALWAYS renders (already shipped in the DL-346 follow-up commit `9918ebc`, but as a top-right ghost — this DL moves it to the bottom and inverts the loudness).
5. **Q:** Out of scope?
   **A:** Mobile layout, click handlers, plural-aware Hebrew (already correct), conditional logic (already correct), email flows, modals.
6. **Q:** Send-button label tweak?
   **A:** Per spec: `שלח שאלות ללקוח` (was `סיים בדיקה ושלח שאלות`) and `שלח רשימת חסרים ללקוח` (was `שלח רשימת מסמכים חסרים`). New labels signal "sends an email" without conflating with the primary finish action. Add a leading icon glyph "⤴" via `icon('send', 'icon-xs')` (already in sprite) — visual cue for "outbound".
7. **Q:** Question-card edit affordance?
   **A:** Demote `ערוך שאלות` → small text-link `ערוך`. Same modal handler.

## 3. Research
### Domain
Visual hierarchy / asymmetric reversibility / consequence-weighted button design.

### Sources Consulted
1. **NN/g — *Visual Hierarchy in UI Design*** — "Strongest visual emphasis goes to the action you most want the user to take, NOT the one with the biggest commercial value." Applied: most common path (finish without sending) gets primary; sending becomes a contextual offer.
2. **NN/g — *Confirmation Dialogs and the Risk of Defaults*** — Irreversible actions should never be the easiest target. Outlined buttons require deliberate selection; solid primaries get muscle-memory clicks. Applied: irreversible "send email" → outlined; reversible "finish" → solid.
3. **Material Design — *Button hierarchy* (filled / outlined / text)** — Maps three roles to three styles: highest-emphasis primary action → filled; alternative same-screen action → outlined; lowest-emphasis utility → text-link. Applied directly: filled = `סיים בדיקה`; outlined = `שלח …`; text = `תצוגה מקדימה` / `ערוך`.
4. **DL-346 (in-repo)** — already established the two-card structure; this DL only changes the painting, not the carpentry.

### Key Principles Extracted
- **Loudness = consequence-aware encouragement.** A loud control says "do this." If the loud control is the irreversible one, the UI is rooting for the wrong choice.
- **One filled primary per scope.** Multiple solid greens compete and flatten hierarchy. Reserve fill for the one canonical "complete this scope" action.
- **Demote auxiliaries to text.** Preview / edit are check/adjust affordances, not actions. Text-link styling matches their role.

### Patterns to Use
- **Filled / Outlined / Text triad** (Material). The exact mapping from spec: filled → finish; outlined → send; text → preview / edit.
- **Sticky-bottom primary** within the banner. The primary lives at the bottom regardless of which sub-sections render above it.

### Anti-Patterns Avoided
- **Two solid greens in the same card stack.** Forces the eye to compare; trains accidental clicks.
- **Hidden/distant primary** (today's small top-right `סיים בדיקה`). Discoverable controls should be where the eye lands at the end of the read.

### Research Verdict
Filled/Outlined/Text triad with a single bottom primary. Pure CSS + minor markup re-ordering. Implementation risk: low (handler signatures unchanged).

## 4. Codebase Analysis
* **Function to edit:** `_buildClientReviewDonePromptEl(clientName)` at `frontend/admin/js/script.js:7218`. Same surface as DL-346 / DL-345.
* **Existing handlers reused (no signature change):** `dismissClientReview`, `dismissAndSendQuestions`, `previewBatchQuestions`, `openBatchQuestionsModal`, `approveAndSendFromAIReview` (DL-345), `previewApproveEmail` (DL-308).
* **Existing flags reused:** `hasPendingQuestions` (with `_batchQuestionsSentClients` gate), `pendingQuestionsCount`, `docsMissing > 0 && reportId`. All already in place from DL-346.
* **Existing CSS to remove/refactor:** `.ai-review-flow-card__actions` currently uses `justify-content: flex-end` with mixed button styles. We'll keep the flex-end alignment but the children will be different classes. The DL-346 follow-up commit (`9918ebc`) added a small `btn-ghost`/`btn-success` toggle on `.ai-review-done-content`'s dismiss; that whole inline dismiss is being deleted.
* **CSS file:** `frontend/admin/css/style.css` — additions go near the existing `.ai-review-flow-card*` block (~line ~2380 area; DL-346 stack).
* **Icons used:** `check`, `send`, `eye`, `pencil`, `check-circle-2` — all already in `scripts/icon-list.txt` per DL-314 sprite.
* **Cache-bust:** `style.css` and `script.js` both need bumps (current `v=315` / `v=337` per index.html as of `885c08c`).

## 5. Technical Constraints & Risks
* **Outlined-on-white-on-green.** The outer banner is `--success-50` (very light green); cards are white; buttons sit on white. An outlined green button on white card on light-green outer must remain readable in mobile-zoom-out. Mitigated by using `--success-700` text + `--success-500` 0.5px border (the project tokens already deployed for similar patterns in `.btn-outline-success` if it exists; if not, scoped `.ai-review-flow-card__send-btn` rule).
* **Project's existing `.btn` system.** We won't introduce new global button variants; instead, use scoped class names (`ai-review-flow-card__send-btn`, `ai-review-done-primary`, `ai-review-flow-card__preview-link`) with explicit declarations. This avoids polluting the design system; if DL-346/347 patterns prove out, a follow-up DL can promote them to global tokens.
* **Existing global `.btn-success` rule.** It's solid-green. We must NOT apply `btn-success` to the send buttons; instead apply a fresh class. The `סיים בדיקה` primary can keep `btn-success btn-sm` (already styled correctly) plus a new size modifier.
* **Plural Hebrew text length.** "נותרו 12 מסמכים שלא התקבלו מהלקוח" is wide. With outlined buttons we have more horizontal room than DL-346's two-button row, but if the card cramps on narrow desktop widths the action row can flex-wrap. Already covered by `.ai-review-flow-card__actions { flex-wrap: wrap }`.
* **No regression in DL-345 wording flip.** `approveAndSendFromAIReview` confirms with "שלח שוב" / "נשלח כבר ב-<date>" inside the handler. The visible button label is what we control here; spec changes its idle label from "שלח רשימת מסמכים חסרים" to "שלח רשימת חסרים ללקוח". The handler-side dialog text stays unchanged (DL-345's logic), so a re-sent email still says "שלח שוב" inside the confirm dialog.
* **Mobile path.** Banner uses the same `_buildClientReviewDonePromptEl` builder via DL-341; mobile is technically not a "different render path" — it's the same builder injected differently. "Mobile out of scope" in spec means we won't redesign for narrow widths beyond what flex-wrap already gives us. Flag this in Section 7 as a smoke check.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
The banner reads "what was reviewed (header) → optional contextual offers (cards) → finish (primary)". One solid green button visible regardless of state. Sending is always a deliberate, outlined choice — never the path of least resistance.

### Logic Flow (no change vs DL-346)
1. Compute `pendingQuestionsCount`, `hasPendingQuestions`, `docsMissing`, `reportId`, `hasMissingFlow`.
2. Build header (icon + heading + stats) — drop the inline dismiss button that DL-346 follow-up commit `9918ebc` added; nothing replaces it inside the header.
3. Build sub-section A (questions) iff `hasPendingQuestions`, with outlined send + preview-link + edit-link.
4. Build sub-section B (missing) iff `hasMissingFlow`, with outlined send + preview-link.
5. Always append the bottom solid-green primary `סיים בדיקה`.

### Markup Sketch (semantic)
- Outer `.ai-review-done-prompt` (existing).
- Header `.ai-review-done-content` — drops its trailing dismiss button.
- `.ai-review-flows-stack` (existing) — stacks sub-section cards (zero, one, or two).
- Each `.ai-review-flow-card` (existing) — context line + actions row containing one outlined send button + one or two text-link auxiliaries.
- New trailing `.ai-review-done-primary-row` wrapping the solid green `סיים בדיקה` button.

### CSS Changes
- Add `.ai-review-flow-card__send-btn` — white bg, `--success-700` text, 0.5px solid `--success-500` border, padding 5px 12px, font 13px / 500, hover bg `--success-50`, active bg `--success-100`.
- Add `.ai-review-flow-card__preview-link` and `.ai-review-flow-card__edit-link` (or one shared `.ai-review-flow-card__link`) — text-button: no border, no bg, `--text-secondary` color, underline on hover, padding 2px 4px, font 12px.
- Add `.ai-review-done-primary-row` — flex container, `justify-content: center`, `margin-top: var(--sp-3)`.
- Add `.ai-review-done-primary` — solid `--success-500` bg, white text, no border, padding 10px var(--sp-4), border-radius `var(--radius-md)`, font 14px/500, hover bg `--success-600`.
- Remove the DL-346 follow-up's reliance on `btn btn-ghost btn-sm` for the inline header dismiss (the inline dismiss is gone).

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Restructure `_buildClientReviewDonePromptEl`: remove header dismiss; outlined send buttons inside both cards; demote previews / edit to links; append always-on bottom primary. Update labels to spec verbatim. |
| `frontend/admin/css/style.css` | Modify | Add scoped classes per the CSS Changes list. Place near existing `.ai-review-flow-card*` block. No global `.btn` rule changes. |
| `frontend/admin/index.html` | Modify | Bump `style.css?v=315 → 316`, `script.js?v=337 → 338`. |

### Final Step
* Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section-7 items to `current-status.md` under "Active TODOs". Mark DL-346's test entry as superseded by this DL's entry.

## 7. Validation Plan
* [ ] **State 1 — both flows:** header + questions card (outlined send + preview link + edit link) + missing-docs card (outlined send + preview link) + bottom solid-green `סיום בדיקה`. **Exactly one solid-green button visible.**
* [ ] **State 2 — questions only:** header + questions card + bottom primary. No missing card.
* [ ] **State 3 — missing only:** header + missing-docs card + bottom primary. No questions card.
* [ ] **State 4 — neither:** header + bottom primary. No cards.
* [ ] **DL-345 wording flip:** when `docs_first_sent_at` is set, the missing-docs send button still triggers the "שלח שוב" / "נשלח כבר ב-<date>" confirm dialog. Outlined styling holds with the longer button text (no overflow on the visible idle label `שלח רשימת חסרים ללקוח`).
* [ ] **Plural edges:** `1 ממתין לתשובה` vs `5 ממתינים לתשובה`; `נותר 1 מסמך שלא התקבל מהלקוח` vs `נותרו 7 מסמכים שלא התקבלו מהלקוח`. No layout breakage at either extreme.
* [ ] **Live email smoke (`gws`):** click outlined send for questions → email arrives at liozshor1@gmail.com (DL-333 path, off-hours queue if applicable). Click outlined send for missing → email arrives (DL-345 path).
* [ ] **DL-335 held-questions:** clicking bottom primary `סיים בדיקה` while there are `on_hold` items keeps them in the queue (no auto-dismiss).
* [ ] **No regression** in DL-323 user-initiated scroll, DL-341 desktop pane-2 placement, `recalcAIStats`-driven re-render, `_batchQuestionsSentClients` gate, `previewApproveEmail` modal (DL-308), `previewBatchQuestions` modal.
* [ ] **Console clean** in all four states.
* [ ] **Mobile (≤768px) smoke:** action rows wrap cleanly; bottom primary remains tap-target sized; no horizontal overflow.

## 8. Implementation Notes (Post-Code)
* Header `.ai-review-done-content` no longer has any trailing button — the always-on dismiss the DL-346 follow-up commit (`9918ebc`) injected there is gone. `.ai-review-done-content` now just renders icon + heading + stats.
* `.ai-review-flow-card__send-btn` and `.ai-review-flow-card__link` and `.ai-review-done-primary` are scoped (no global `.btn` collision). They explicitly set `background`, `border`, `color`, `padding` so they aren't influenced by global `.btn` rules.
* `.ai-review-done-primary` uses `min-width: 160px` + centered text so the bottom primary has consistent presence regardless of icon-glyph width (`חsiום בדיקה` short, an icon at start).
* All onclick handlers identical to DL-346: `dismissAndSendQuestions`, `previewBatchQuestions`, `openBatchQuestionsModal`, `approveAndSendFromAIReview`, `previewApproveEmail`, `dismissClientReview`. DL-345 confirm-dialog wording flip preserved (handler-side, not button-label-side).
* Research principles applied: NN/g visual hierarchy ("loudness encourages") + Material filled/outlined/text triad. The single solid green at the bottom is the only filled control in the banner.
