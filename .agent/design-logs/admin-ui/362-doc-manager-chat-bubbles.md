# Design Log 362: Doc-Manager Client-Notes as Chat-Bubble Conversation
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-27
**Related Logs:** DL-360 (thread grouping), DL-266 (office reply linkage), DL-337 (raw_snippet fallback)

## 1. Context & Problem
DL-360 grouped client-notes by Outlook `conversation_id` and rendered each thread as one card
with a "▸ הצג N הודעות קודמות" collapse toggle. The data model is correct but the visual still
feels like stacked admin cards, not a conversation. The goal is to replace it with a true
chat-bubble view (iMessage / Israeli WhatsApp style) — alternating-side bubbles, letter avatars
on first-of-run, date dividers between threads, hover-revealed edit/delete.

## 2. User Requirements
1. **Q:** Bubble alignment in RTL — which side for the client?
   **A:** Office RIGHT (me / admin viewer), Client LEFT — Israeli WhatsApp convention. Reverses
   the brief's literal ask at user direction.
2. **Q:** How should office replies (DL-266 reply_to) render?
   **A:** Separate office bubble immediately after the parent client bubble. reply_to linkage is
   preserved logically for ordering; visual nesting dropped.
3. **Q:** Composer position?
   **A:** Keep at top, styled as rounded pill input + circular send button.
4. **Q:** Avatars?
   **A:** Yes — letter avatars on first bubble of a run only (iMessage pattern). Client = first
   letter of sender_email. Office = "מ".
5. **Q:** Backend scope?
   **A:** Frontend-only. DL-360 data model (conversation_id, reply_to) is sufficient.

## 3. Research
### Domain
Chat UI design patterns; RTL Hebrew chat conventions.

### Sources Consulted
1. **16 Chat UI Design Patterns — Bricxlabs** — message grouping by sender; tail only on last
   bubble of a run; consecutive-message corner suppression.
2. **iOS Chat Bubbles in CSS — Samuel Kraft** — CSS pseudo-element tail technique; rounded corner
   suppression for run grouping.
3. **Tailwind CSS Chat Bubble — Flowbite** — `rtl:space-x-reverse` and logical CSS properties
   for RTL bubble layouts (use `align-self` flips, not hard-coded `left`/`right`).
4. **DL-360 (in-repo)** — conversation_id bucketing logic reused verbatim.
5. **DL-266 (in-repo)** — reply_to field pattern; repurposed for ordering.

### Key Principles Extracted
- **Run-collapsing:** suppress sender header + avatar on consecutive same-sender bubbles (iMessage).
- **Tail only on first of run** (or last, per convention; we use first-of-run for avatar alignment).
- **Date divider per thread** — centered chip, like WhatsApp date separators.
- **Logical CSS properties** — `align-self: flex-start/flex-end` not `left`/`right` — RTL-safe.

### Patterns to Use
- **`cn-msg--in` / `cn-msg--out`** classes for bubble side; parent `dir="rtl"` handles visual flip.
- **`cn-msg--first-of-run`** class to show avatar, sender header, tail pseudo-element.
- **System notice** for `batch_questions_sent` — centered pill, no bubble.

### Anti-Patterns to Avoid
- **Keep collapse toggle:** chat UIs show everything; remove DL-360's toggle entirely.
- **Sender header on every bubble:** visual noise; suppress on consecutive same-sender.
- **Hard-coded `right:`/`left:` values:** RTL-fragile.

### Research Verdict
Full bubble rewrite, keeping DL-360 bucketing logic as-is. CSS uses `align-self` + RTL parent.
No backend changes needed.

## 4. Codebase Analysis
* **Existing Solutions Found:** DL-360's conversation_id bucketing (document-manager.js:3249-3270)
  is a clean pre-pass; reused verbatim. `replyMap` pattern (line 3239-3243) reused for ordering.
* **Reuse Decision:** Keep all bucketing, replyMap, escapeHtml/escapeAttr, lucide.createIcons call.
  Delete only `toggleCnThread` (lines 3398-3411).
* **Relevant Files:**
  - `frontend/assets/js/document-manager.js:3210-3411` — renderClientNotes + toggleCnThread
  - `frontend/assets/css/document-manager.css:2050-2253` — .cn-entry / .cn-icon / .cn-actions / .cn-thread-*
* **Existing Patterns:** `.cn-add-bar` (composer), `.cn-edit-textarea`, `.save-indicator`,
  `.cn-bq-items` — all preserved.
* **Alignment with Research:** Old code used icon-based entries (left icon + right body), not
  alternating sides — diverges from chat convention. New code adopts `align-self` approach.
* **Dependencies:** No Airtable schema changes. No Worker changes.

## 5. Technical Constraints & Risks
* **Security:** `escapeHtml`/`escapeAttr` wrappers maintained on all user-facing text.
* **Risks:** `toggleCnThread` called from inline onclick in DL-360 HTML — removing the function
  is safe because we're also removing all HTML that calls it.
* **Breaking Changes:** None. Standalone notes (no conv_id) render as client-side bubble.
  Office replies with missing parent render as standalone office bubble (graceful degradation).
* **RTL tail:** `::before` pseudo-element for the bubble tail; positioned on the avatar side.
  Since RTL flips are handled by `dir="rtl"` on body, we use `inset-inline-end` for positioning.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Hard-reload doc-manager.html for client@example.com shows a chat conversation: alternating
left/right bubbles, avatars on first-of-run, date divider above the thread, no collapse toggle.

### Logic Flow
1. **Bucket** (DL-360 logic unchanged): `replyMap`, `threads` Map, `standaloneItems[]`.
2. **Unified timeline**: one item per thread or standalone; sort newest-first by rep date.
3. **Per item**: emit `cn-date-divider` chip, then bubbles.
   - Thread: emit messages oldest-first; for each client msg, emit its replyMap entry immediately after.
   - Standalone `batch_questions_sent`: centered system notice.
   - Standalone manual/office note: office-side bubble.
   - Standalone email (legacy, no conv_id): client-side bubble.
4. **Run tracking**: `prevSender` var resets per date-section. `firstOfRun = (classify(entry) !== prevSender)`.
5. **Bubble HTML**: `.cn-msg.cn-msg--in/out[.cn-msg--first-of-run] > .cn-avatar + .cn-msg-stack > (.cn-msg-header + .cn-bubble) + .cn-msg-actions`.

### Data Structures / Schema Changes
None. Existing note shape from DL-360 is sufficient.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/assets/js/document-manager.js` | Modify | Rewrite renderClientNotes (3210-3396); delete toggleCnThread (3398-3411) |
| `frontend/assets/css/document-manager.css` | Modify | Replace .cn-entry/.cn-icon/.cn-actions/.cn-thread-* block (2050-2253) with chat-bubble styles |

### Final Step (Always)
* **Housekeeping:** Update DL status → `[IMPLEMENTED — NEED TESTING]`, update INDEX.md, copy
  all unchecked Section 7 items to `current-status.md` under "Active TODOs", commit + push.

## 7. Validation Plan
* [ ] Hard-reload doc-manager.html for client@example.com — should show chat bubbles: alternating sides, oldest-first within thread, date divider above, avatars + sender header on first-of-run only.
* [ ] Client with multiple Outlook threads — date dividers between threads; threads newest-first.
* [ ] Client with only manual office notes — all bubbles on office side (RIGHT in RTL), brand-blue.
* [ ] Client with legacy emails (no conv_id) — fallback client-side bubbles, no crash.
* [ ] batch_questions_sent entry — centered system notice, not a bubble.
* [ ] Hover a bubble — edit + delete icons fade in; both handlers work.
* [ ] Add note via top composer — appears as office bubble; save flow unchanged.
* [ ] No regression on Dashboard Recent Messages or AI Review tab.
* [ ] No Lucide icon-init errors in console.

## 8. Implementation Notes (Post-Code)
* Reused DL-360 bucket pre-pass verbatim (lines 3249-3270 logic kept).
* `reply_to` ordering: replays office reply as next bubble after its parent (not nested inside).
* CSS uses `align-self: flex-end` for `.cn-msg--out` (office = right in RTL) and
  `align-self: flex-start` for `.cn-msg--in` (client = left in RTL). No `margin-left`/`margin-right`.
* Bubble tail: `::before` with border trick, `inset-inline-end: -6px` on `.cn-msg--out` first-of-run,
  `inset-inline-start: -6px` on `.cn-msg--in` first-of-run.
