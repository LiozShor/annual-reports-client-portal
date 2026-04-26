# Design Log 353: AI-Review — Make Reject Reason Optional
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-26
**Related Logs:** DL-244 (rejected uploads visibility), DL-253 (group by reason), DL-334 (cockpit middle + actions), DL-344 (reject clears unrelated approval)

## 1. Context & Problem
In the AI-Review tab's inline reject sub-panel, the "Confirm reject" button is gated `disabled` until the admin picks a rejection reason from a dropdown. For high-volume reject batches this adds an extra click per item (open → pick reason → confirm). User reports it as friction ("too many buttons to click"). Most rejections don't need categorization — admin just wants to flip the verdict and move on.

## 2. User Requirements
1. **Q:** What should happen when the admin clicks reject without picking a reason?
   **A:** Keep dropdown visible, default to "no reason", allow one-click confirm.
2. **Q:** Which reject surfaces should this apply to?
   **A:** Only the inline AI-Review pane (`script.js` L4876, `showPanelRejectNotes`). Leave the older batch/persistent-review modal (L6550) untouched.
3. **Q:** When reason is empty, what should appear in the rejected-uploads log + client email callout?
   **A:** Substitute generic label `נדחה ע"י המשרד` (English: `Rejected by office`).
4. **Q:** Should the notes textarea remain optional?
   **A:** Already optional — leave as is.

## 3. Research
### Domain
Form Friction / Form Field Optionality — UX patterns for reducing required choices.

### Sources Consulted
1. **Hick's Law** — each forced choice adds latency proportional to log₂(n+1). Removing the gating predicate on a non-essential field is the canonical friction win.
2. **Krug — *Don't Make Me Think*** — required fields should reflect downstream system requirements, not "nice-to-have" categorization.
3. **Existing project pattern** — DL-253 already groups rejected uploads by reason with a `fallbackReason` for empty values; the email layer is already empty-tolerant.

### Patterns to Use
- **Optional with sensible default:** keep field for power users, drop the gate.
- **Display-layer substitution:** replace empty string with a meaningful generic label at render time, not in storage.

### Anti-Patterns to Avoid
- **Removing the dropdown entirely** — destroys the option for the admin who wants to categorize.
- **Storing the fallback label in the database** — couples display copy to data; future copy change would need a migration.

### Research Verdict
Make the field optional by removing the disabled-button gate; substitute `נדחה ע"י המשרד` / `Rejected by office` only at display time (frontend reviewed-card + backend email callout). Storage stays empty when admin doesn't pick a reason.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `REJECTION_REASONS` map in `frontend/admin/js/script.js:3598` and `api/src/lib/classification-helpers.ts:36` (HE labels).
  - `REJECTION_REASONS_EN` in `api/src/lib/email-html.ts:225` (EN labels).
  - `fallbackReason` already exists at `email-html.ts:250` — currently `'אחר'` / `'Other'`. Just needs the literal swapped.
  - Backend `classifications.ts:1543-1554` already accepts empty `parsed.reason` and propagates `reason_code: ''`, `reason_text: ''` cleanly into `rejected_uploads_log` — no data-layer change needed.
* **Reuse Decision:** extend existing functions/literals; no new helpers.
* **Relevant Files:**
  - `frontend/admin/js/script.js` (4 spots: L4882 disabled attr, L4901 change handler, L4659 reasonLabel ladder, L5792 reasonLabel ladder).
  - `frontend/admin/index.html` (cache-bust).
  - `api/src/lib/email-html.ts` (fallback literal).
* **Existing Patterns:** display-layer fallback with `||` ladder is already idiomatic for the rejection block.
* **Alignment with Research:** codebase already supports empty reason at storage and email-render layers; admin display is the only place that returns empty HTML for empty reason.
* **Dependencies:** none (no API contract change, no Airtable schema change).

## 5. Technical Constraints & Risks
* **Security:** none — same auth + endpoint, just relaxes a client-side gate. Server already accepts empty reason.
* **Risks:**
  - DL-253 grouping: empty-reason items will now bucket under `נדחה ע"י המשרד` instead of `אחר`. Acceptable.
  - Existing `rejected_uploads_log` entries with empty `reason_text` will display the new label on next email render. Approved by user.
* **Breaking Changes:** none.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Admin can reject a classification in the AI-Review pane in **one click** (open reject panel → click confirm) with no reason selected, and the reviewed card + downstream email show `נדחה ע"י המשרד` (HE) / `Rejected by office` (EN) instead of an empty block.

### Logic Flow
1. Admin clicks reject on a pending card → `showPanelRejectNotes` renders sub-panel.
2. Confirm button is enabled from render (no `disabled` attr).
3. Admin clicks confirm immediately → `executeReject(recordId, '', '')`.
4. Backend stores `rejected_uploads_log` entry with `reason_code: ''`, `reason_text: ''`.
5. Reviewed card displays `נדחה ע"י המשרד` via display-layer fallback.
6. Next reminder email renders the entry under `נדחה ע"י המשרד` group (HE) or `Rejected by office` (EN).

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | L4882 remove `disabled`; L4901 remove change handler; L4659 + L5792 add fallback label for empty reason in rejected variant |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=339` → `?v=340` |
| `api/src/lib/email-html.ts` | Modify | L250 change fallbackReason to `נדחה ע"י המשרד` / `Rejected by office` |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-353 row |
| `.agent/current-status.md` | Modify | Add Phase E test checklist |

### Final Step (Always)
* **Housekeeping:** Update status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 to `current-status.md`, commit & push feature branch, deploy Worker, **pause for merge approval**.

## 7. Validation Plan
- [ ] Frontend smoke: AI-Review tab → click reject on a pending classification → confirm button is **already enabled** → click confirm with no reason → success toast, card transitions to rejected.
- [ ] Reviewed card display: a card rejected with no reason shows `נדחה ע"י המשרד` instead of empty block.
- [ ] Live email check: trigger a Type B reminder for a client with a no-reason rejected upload; verify HE callout shows under `נדחה ע"י המשרד`, EN client sees `Rejected by office`.
- [ ] Regression — picked-reason path: open reject → pick a reason → confirm → existing label flows through unchanged in email + reviewed card.
- [ ] Regression — batch/persistent-review modal (L6548) still requires a reason (disabled gate intact).
- [ ] No console errors; cache-bust loads `script.js?v=340`.

## 8. Implementation Notes (Post-Code)
- `frontend/admin/js/script.js` `showPanelRejectNotes` (~L4867-4910): removed `disabled` attribute from `.ai-reject-confirm-btn`; removed the `select.addEventListener('change', ...)` line that toggled `confirmBtn.disabled`. Dropdown placeholder relabeled `בחר סיבה (אופציונלי)...` so the optional nature is visible at a glance.
- `frontend/admin/js/script.js` (~L4655-4680, `_renderClassificationInfo` rejected variant): `reasonLabel` ladder now ends in `'נדחה ע"י המשרד'`. Added an `else if (variant === 'rejected')` branch so the block still renders when `item.notes` is missing entirely (rare but possible after the optional-reason flow).
- `frontend/admin/js/script.js` (~L5787-5800, reviewed-card rejection block): refactored to compute `reasonLabel`/`notesText` outside the `if (item.notes)` guard and always render the `<div class="ai-reviewed-rejection-info">` for `reviewStatus === 'rejected'`. Empty reason → fallback label.
- `api/src/lib/email-html.ts:250` `fallbackReason`: `'אחר' / 'Other'` → `'נדחה ע"י המשרד' / 'Rejected by office'`. DL-253 grouping continues to bucket all empty-reason entries into a single group under the new label.
- `frontend/admin/index.html:1525`: cache version `script.js?v=352` → `?v=353` per `feedback_admin_script_cache_bust.md`.
- TypeScript check: 4 pre-existing errors in `backfill.ts`, `classifications.ts`, `edit-documents.ts`, `preview.ts` — unrelated to this change. `email-html.ts` change is a string-literal swap, no type implications.
- Batch/persistent-review modal at `script.js:6548-6581` deliberately untouched — out of scope per Phase A answer.

**Research principles applied:** Hick's Law (drop the gating choice) + display-layer fallback (don't store presentation in data).
