# Design Log 345: AI-review "all reviewed" prompt — doc-collection status + send-missing
**Status:** [COMPLETED]
**Date:** 2026-04-25
**Related Logs:** DL-210 (review-done prompt), DL-308 (email preview modal + approve-and-send), DL-323 (user-initiated scroll), DL-335 (held questions), DL-341 (auto-advance), DL-314 (icon sprite)

## 1. Context & Problem
The AI-review "all reviewed" prompt (`_buildClientReviewDonePromptEl`, script.js:7218) summarizes only the AI-review verdicts (`אושרו` / `שויכו` / `נדחו`) and offers either `סיום בדיקה` or `סיום בדיקה ושליחת שאלות`. It does NOT tell Natan whether the client actually delivered every required document.

Concrete flow that breaks today:
1. Client sends 5 of 7 required docs.
2. AI classifies + Natan reviews all 5 → prompt appears.
3. Natan clicks `סיום בדיקה` thinking he is done — but 2 docs are still missing and the client never got a reminder.

The header above the doc list does say `📄 מסמכים נדרשים (5/7 התקבלו)`, but it is collapsed by default and is not actionable.

## 2. User Requirements
1. **Q:** Where should the doc-collection status appear?
   **A:** Inside the existing "כל המסמכים נבדקו!" prompt box, next to the AI-review verdicts.
2. **Q:** Counts source?
   **A:** Existing `docs_received_count` / `docs_total_count` from Airtable rollups (Recommended).
3. **Q:** What does the "send" button do?
   **A:** Same behaviour as `approveAndSendToClient()` from doc-manager.html — i.e., send the missing-docs email reminder. Reuse `previewApproveEmail` for preview.
4. **Q:** Preview content?
   **A:** Full email preview (subject + HTML body) of the missing-docs reminder — reuses DL-308 modal.
5. **Q:** All-received state behaviour?
   **A:** Show "all docs received → ready for review" badge alongside the existing `סיום בדיקה` button.

## 3. Research
### Domain
Admin operational UX / state-aware actions / progressive disclosure.

### Sources Consulted
1. **Tog's Paradox (Bruce Tognazzini)** — "Make the next required action obvious; if the system knows what should happen next, surface it." Key takeaway: don't make the operator pivot to a different surface to see follow-up actions.
2. **Don Norman, *The Design of Everyday Things* — Affordances chapter** — Visible state + visible action belong on the same surface.
3. **Existing Pending-Approval queue (DL-308)** — Already implements the exact preview + send pattern for the same email; reuse rather than reinvent.

### Key Principles Extracted
- **Status + action together.** Showing "5/7 received" without an action button forces the operator to context-switch (admin panel → reminders tab). Combine.
- **Same email, same UX.** The missing-docs email is a single SSOT-driven artefact — reuse, don't fork.
- **Don't auto-advance state.** Sending a reminder ≠ moving the client forward in the pipeline. Be conservative: just send.

### Patterns to Use
- **Reuse `previewApproveEmail` + `ENDPOINTS.APPROVE_AND_SEND`** — same backend route, same modal, no new email template.
- **Inline status chip** — small bg-colored chip next to the verdicts so the visual weight stays balanced.

### Anti-Patterns Avoided
- **New endpoint** — was tempting (one targeted at "AI-review reminder"). Rejected: the existing endpoint already filters `status='Required_Missing'` server-side.
- **Auto-stage-bump on send** — the queue version (`approveAndSendFromQueue`) bumps stage 3 → 4 because that IS the queue's job. This surface fires from stage 4 / 5 and must NOT advance further.

### Research Verdict
Reuse `previewApproveEmail` and clone-then-trim `approveAndSendFromQueue` into `approveAndSendFromAIReview` (drops the queue-card/state-bump cleanup). Pure frontend change.

## 4. Codebase Analysis
* **Existing solutions reused:**
  - `previewApproveEmail(reportId, clientName)` (script.js:10003) → DL-308 email preview modal.
  - `ENDPOINTS.APPROVE_AND_SEND` (Worker: `api/src/routes/approve-and-send.ts`) → already filters missing docs server-side, sends bilingual HTML email.
  - `escapeOnclick`, `showConfirmDialog`, `showAIToast`, `fetchWithTimeout`, `FETCH_TIMEOUTS.mutate`, `icon()` (DL-314 sprite helper).
* **Reuse decision:** zero new backend, zero new email template, one new ~30-line wrapper function.
* **Relevant files examined:**
  - `frontend/admin/js/script.js:7218-7268` (target function), `:10017-10119` (queue version reference), `:10003-10015` (preview helper), `:4264-4290` and `:8135-8136` (where the rollup counts are already on items).
  - `api/src/routes/approve-and-send.ts:45-120` (confirms missing-docs filter).
  - `frontend/admin/css/style.css:2351-2399` (existing prompt CSS).
  - `scripts/icon-list.txt` — confirmed `clock`, `check-circle-2`, `eye`, `send` already in sprite (no rebuild needed).
* **Existing patterns:** Doc-collection status is rendered as `(received/total)` in multiple places (clientsData rows, AI accordion headers). Same source-of-truth, no new API call.

## 5. Technical Constraints & Risks
* **Stale rollup race:** if a doc upload happens while the prompt is open, the displayed count lags until the next refresh. Mitigation: display only — the email payload is built server-side from live Airtable, so the recipient always sees the truth.
* **Wrong-stage send:** endpoint accepts any stage. AI-review tab effectively shows clients in stage ≥ 4, but no hard guard. Acceptable for now; can add a stage check later if a misuse case emerges.
* **Icon sprite:** verified `clock` and `check-circle-2` already in `scripts/icon-list.txt` — no `node scripts/build-icon-sprite.mjs` run required.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
After reviewing all of a client's AI-classified docs, Natan sees a clear "X/Y received · N missing" chip in the same prompt and can preview + send the missing-docs reminder in one click — without leaving the AI-review tab and without changing the client's pipeline stage.

### Logic Flow
1. `_buildClientReviewDonePromptEl(clientName)` derives `docs_received_count`, `docs_total_count`, `report_id` from `aiClassificationsData[clientName][0]`.
2. Render a status chip: green `is-complete` if all received, amber `is-pending` otherwise.
3. If `docsMissing > 0` AND `report_id` present, render a second action row with `תצוגה מקדימה` (→ `previewApproveEmail`) + `שלח רשימת מסמכים חסרים` (→ new `approveAndSendFromAIReview`).
4. New `approveAndSendFromAIReview` confirms via `showConfirmDialog`, hits `ENDPOINTS.APPROVE_AND_SEND?confirm=1&respond=json`, toasts result. Wording shifts to "שלח שוב" / "נשלח כבר ב-..." if `docs_first_sent_at` is set.

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | `_buildClientReviewDonePromptEl` — add `docStatusHtml` + `sendMissingHtml` blocks; add new `approveAndSendFromAIReview` function next to `approveAndSendFromQueue`. |
| `frontend/admin/css/style.css` | Modify | Add `.ai-review-done-status.is-complete/.is-pending` chip + `.ai-review-done-actions-row` flex row, near existing `.ai-review-done-prompt` rules. |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=333` → `v=334` (cache-bust). |

### Final Step
* Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section-7 items to `current-status.md`.

## 7. Validation Plan
* [ ] Open AI-review tab; pick a client with `X<Y` docs received.
* [ ] Review all classified docs → "כל המסמכים נבדקו!" prompt appears with amber `<X>/<Y> התקבלו · נותרו <Y-X> מסמכים` chip.
* [ ] `תצוגה מקדימה` opens the DL-308 email preview modal showing the missing-docs HTML + subject.
* [ ] `שלח רשימת מסמכים חסרים` → confirm dialog → success toast → email arrives at test inbox (`gws` to liozshor1@gmail.com); subject + body match the preview.
* [ ] Client with `docs_first_sent_at` already set → confirm dialog text shows "נשלח כבר ב-..." and primary button reads "שלח שוב".
* [ ] Client with `X==Y` → green `כל המסמכים התקבלו (X/Y) — מוכן לבדיקה` chip; no preview/send buttons; existing `סיום בדיקה` still dismisses.
* [ ] Client with pending questions AND missing docs → both action sets render; questions stack on the right, missing-docs row below the prompt content.
* [ ] Mobile (<= 768px) layout: chip + buttons wrap cleanly inside the prompt's `flex-wrap`.
* [ ] No console errors on either flow.
* [ ] No regression in `dismissClientReview`, `dismissAndSendQuestions`, `previewBatchQuestions`, `openBatchQuestionsModal`, `previewApproveEmail` from doc-manager.

## 8. Implementation Notes (Post-Code)
* Used `check-circle-2` for the all-received chip (already in sprite, matches the existing prompt icon for consistency) instead of the planned `package-check` (not in sprite, would have required regenerating).
* Status chip moved INSIDE `.ai-review-done-text` (below the verdicts) so it inherits the column layout; the preview/send action row sits OUTSIDE `.ai-review-done-content` so it spans full width on its own line, matching the doc-manager visual rhythm.
* No stage-bump or array splice in `approveAndSendFromAIReview` — deliberate divergence from `approveAndSendFromQueue` (the AI-review tab is not the Pending-Approval queue).
* Research principle applied: *Status + action on the same surface* (Norman). The chip and the send buttons live in the same prompt, no context switch.
