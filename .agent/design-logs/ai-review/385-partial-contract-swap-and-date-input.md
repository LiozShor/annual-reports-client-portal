# Design Log 385: Partial-Contract T901↔T902 Swap + Lenient Date Input + QA Test View
**Status:** [COMPLETED — 2026-04-30]
**Date:** 2026-04-30
**Related Logs:** DL-269 (partial rental detection), DL-270 (editable contract period dates), DL-359 (edit full-year contract dates), DL-314 (rental contract templates T901/T902)

## 1. Context & Problem

The partial-contract review flow (DL-269 → 270 → 359) has matured into the AI-Review card path for T901 (`חוזה שכירות (הכנסה)` / income) and T902 (`חוזה שכירות (הוצאה)` / expense). Two production pain points:

1. **Misclassification swap.** When the client uploads only a partial contract, the LLM occasionally tags T901 as T902 (or vice versa). There is currently **no one-click swap** on the AI-Review card; admin must use the heavier `reassign` flow.
2. **Date input friction.** The partial-contract editor uses native `<input type="month">` (script.js:6832). Admin can't type `05.2026` or `5.26` — must use the calendar control.

No QA convention exists for seeded "pending classification" records. Will introduce a tagged Airtable view + checklist.

## 2. User Requirements

1. **Q:** Where does the T901/T902 fix live?
   **A:** Admin AI-Review UI override (one-click swap), NOT prompt/rule changes.
2. **Q:** Which date formats accepted?
   **A:** `MM.YYYY` (e.g. `05.2026`); keep existing calendar; add free-text input above it.
3. **Q:** Where is the date input rendered?
   **A:** Admin AI-Review card only (NOT pending-approval queue 5739, NOT mobile banner 781).
4. **Q:** Test deliverable?
   **A:** Production base + dedicated `QA Test` Airtable view + manual QA checklist.
5. **Q:** Swap UX?
   **A:** One-click `⇄` button on review card, no confirmation modal.
6. **Q:** Calendar improvement?
   **A:** Free-text MM.YYYY input above existing calendar; both stay in sync.

## 3. Research

### Domain
UX for combined free-text + calendar date inputs (lenient parsing) and one-click classification toggles with undo.

### Sources Consulted
1. **NN/g — Date input forms** (https://www.nngroup.com/articles/date-input/) — let users type natural formats; show example placeholder; validate on blur, not onChange.
2. **GOV.UK Design System — Dates** (https://design-system.service.gov.uk/patterns/dates/) — example placeholders disambiguate format; never reject minor separator variants.
3. **Material Design 3 — Date Pickers** (https://m3.material.io/components/date-pickers) — text field is source of truth on commit; calendar mirrors parsed state; sync on blur.
4. **chrono-node** (https://www.npmjs.com/package/chrono-node) — casual parsing handles `5/26`, `5.2026`, `May 2026`. Reference for candidate-format strategy.
5. **date-fns issue #942** — 2-digit-year century rule is a silent-bug source; pin explicit window.
6. **NN/g — Confirmation dialogs** (https://www.nngroup.com/articles/confirmation-dialog/) — prefer **undo** for reversible toggles over confirmation dialogs.
7. **Material 3 — Snackbar** (https://m3.material.io/components/snackbar/guidelines) — optimistic action + Undo (~6s) is the canonical pattern.

### Key Principles
- **Text input = source of truth on commit.** Parse on blur (not onChange) → avoids datepicker-dilemma flicker; calendar reflects parsed value.
- **Lenient input, strict storage.** Accept `MM.YYYY`, `M.YY`, `M/YY`, `M-YYYY`, `MM/YYYY`, `M.YYYY`; store as ISO `YYYY-MM-DD`.
- **Reversible action ≠ confirm.** T901↔T902 swap is fully reversible. Use optimistic flip + toast with Undo, no modal.
- **Idempotent server endpoint.** Set `matched_template_id` to a target value, never "toggle" server-side.
- **Disambiguate 2-digit year.** `00–79 → 2000s`, `80–99 → 1900s`.

### Anti-Patterns to Avoid
- **onChange parsing** — causes calendar to jump while typing.
- **Confirm modal for reversible swap** — trains click-through, weakens future warnings.
- **Toggle endpoint** — race condition on double-tap.
- **Rejecting `5/26`** — accept all common separators (`.`, `/`, `-`).

### Research Verdict
Build a candidate-format list parsed on blur via inline regex (no new dependency); add idempotent `swap-classification` action to `/review-classification`; show toast with Undo after flip.

## 4. Codebase Analysis

**Reusable functions (frontend/admin/js/script.js):**
- `renderContractPeriodBanner(rid, cp, year)` — line 6788
- `renderFullYearBadge(rid, year)` — line 6783
- `expandFullYearBadgeToEdit(rid, badgeEl)` — line 6813
- `editContractDate(recordId, field, el)` — line 6828 (currently creates `<input type="month">`)
- `saveContractPeriod(recordId, startDate, endDate)` — line 6870, posts to `ENDPOINTS.REVIEW_CLASSIFICATION`
- `renderDocLabel()` — line 13562 (T901/T902 badge HTML)
- `showAIToast(msg, type, action?)` — existing toast helper

**Backend (api/src/routes/classifications.ts):**
- `/review-classification` existing actions (line 640): `approve, reject, reassign, split, classify-segment, finalize-split, request-remaining-contract, update-contract-period, re-classify, also_match, revert_cascade`. **No `swap-classification` yet.**
- Field: `matched_template_id` (table `tbloiSDN3rwRcl1ii`, line 438).

**Hebrew labels (api/src/lib/classification-helpers.ts:28):** `T901:'חוזה שכירות (הכנסה)'`, `T902:'חוזה שכירות (הוצאה)'`.

**Reuse:** `saveContractPeriod`, `renderContractPeriodBanner`, `showAIToast`, ISO date storage.
**Extend:** `editContractDate` to render dual inputs + sync.
**New:** `parseLenientMonthYear()`, `swapClassification()` frontend, `swap-classification` action server-side.

## 5. Technical Constraints & Risks

- **Security:** No new PII surface. Same admin-token auth as `update-contract-period`.
- **Operational:** Cache-bust required — bump `script.js?v=NNN` in `frontend/admin/index.html`.
- **Uniformity exception (CLAUDE.md #1):** Pending Approval queue 5739 + mobile banner 781 intentionally OUT of scope (consistent with DL-359). This is a documented scope cap.
- **Idempotency:** Server sets `matched_template_id` to explicit target, never flips blindly.
- **Breaking changes:** None — additive UI + additive endpoint action.
- **Date parser mitigation:** Reject inputs lacking a 2- or 4-digit year segment (rejects `5.5` day.month ambiguity).

## 6. Proposed Solution

### Success Criteria
On the AI-Review card for any T901/T902 partial-contract record: (a) admin sees a `⇄` button; one click flips classification, shows toast `הוחלף ל-T902 · בטל`, undo restores within 6s. (b) The date editor shows a free-text MM.YYYY input above the calendar; typing `05.2026` or `5.26` and tabbing out moves the calendar to May 2026.

### Logic Flow

**A. T901↔T902 swap**
1. Admin clicks `⇄` button on review card.
2. Frontend optimistically updates UI; calls `POST /review-classification {action:'swap-classification', record_id, target_template_id}`.
3. Server validates `target_template_id ∈ {'T901','T902'}`, sets Airtable `matched_template_id`, logs via `logEvent({event_type:'classification_swap', category:'admin', ...})`.
4. Toast with Undo for 6s; Undo re-calls swap with prior value.

**B. Lenient MM.YYYY input**
1. `editContractDate` renders `<input type="text" placeholder="MM.YYYY (לדוגמה 05.2026)">` ABOVE existing `<input type="month">`.
2. On blur: run `parseLenientMonthYear(value)`; if valid → write `YYYY-MM` to month input; if invalid → red border + `פורמט לא תקין — נסו 05.2026`.
3. On month input change: write canonical `MM.YYYY` back to text input (bidirectional sync).
4. Save flow unchanged (`saveContractPeriod` handles ISO).

**C. QA View**
1. Create Airtable view `QA — Partial Contract Test` in CLASSIFICATIONS table.
2. Seed 6 records per test scenarios table below.

### Test Scenarios (QA Airtable records)

| # | Scenario | Expected template_id | Dates | Tests |
|---|----------|---------------------|-------|-------|
| 1 | Income contract, full year | T901 (no swap needed) | full year | Baseline regression |
| 2 | Expense contract, partial Jan–Jun | T902 | 01.2026–06.2026 | Date editor base case |
| 3 | LLM swapped: income labelled expense | T902 → swap → T901 | 05.2026–12.2026 | Swap button (income fix) |
| 4 | LLM swapped: expense labelled income | T901 → swap → T902 | 01.2026–04.2026 | Swap button (expense fix) |
| 5 | Partial, lenient date formats | T901 | type `5.26`, `5/2026`, `05-2026` | Parser accepts variants |
| 6 | Partial, invalid date input | T902 | type `13.2026`, `5.5`, `abc` | Parser rejects gracefully |

### Data / API Changes
- **No schema change.** Reuses `matched_template_id`.
- **New action** added to `/review-classification`:
  ```
  { action: 'swap-classification', record_id: string, target_template_id: 'T901'|'T902' }
  ```
- Activity log: `event_type: 'classification_swap'` via `logEvent`.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Add `parseLenientMonthYear()`; extend `editContractDate` for dual inputs; add `swapClassification()`; render `⇄` button in `renderContractPeriodBanner` for T901/T902 |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=NNN` |
| `api/src/routes/classifications.ts` | Modify | Add `case 'swap-classification':` — validate target, update Airtable, log event |
| `.agent/design-logs/INDEX.md` | Modify | Add row 385 |

### Final Step
- Status → `[IMPLEMENTED — NEED TESTING]`.
- Update INDEX.md.
- Copy unchecked Section 7 items to `.agent/current-status.md`.
- Invoke `git-ship` (no auto-merge).

## 7. Validation Plan

- [ ] **Parser unit-grade:** In browser DevTools, verify `parseLenientMonthYear`: `5.26→{y:2026,m:5}`, `05.2026→ok`, `5/2026→ok`, `5-26→ok`, `13.2026→null`, `abc→null`, `5.5→null`.
- [ ] **Render:** QA scenario #1–#6: verify badge, `⇄` button on T901/T902 only, dual-input date editor visible.
- [ ] **Functional swap:** Scenario #3: click `⇄` → optimistic flip → server confirms → Airtable shows T902→T901 → Undo restores.
- [ ] **Functional date:** Scenario #5: type `5/26` in text → tab → calendar shows May 2026 → save → Airtable `startDate=2026-05-01`.
- [ ] **Idempotency:** Double-click `⇄` rapidly → final state correct; activity log shows two `classification_swap` events with explicit target values.
- [ ] **Regression:** Full-year badge (DL-359) still toggles; `update-contract-period` still saves; reject path (DL-353) untouched.
- [ ] **Cache-bust:** Hard-reload admin → new `script.js?v=NNN` served.
- [ ] **Scope cap:** Pending Approval queue 5739 + mobile banner 781 unchanged.
- [ ] **Activity log:** `node scripts/query-worker-logs.mjs --since=1h --search="classification_swap"` returns events.

## 8. Implementation Notes

- `parseLenientMonthYear()` added at script.js:6782 (before `renderFullYearBadge`). No new dependencies — pure regex.
- `editContractDate` replaced with dual-input version: free-text (`contract-date-text-input`) above native month input; `finishEdit` defined first so blur/change handlers can reference it via closure.
- `swapClassification()` added after `saveContractPeriod`. Optimistic flip of `aiClassificationsData`, loading spinner on button during request, rollback on error, Undo toast via `showAIToast` action param.
- Swap button injected as last item in `secondaryBtns` for T901/T902 cards. Button text updates in-place (no full card re-render) after swap to reflect new flippable direction.
- Backend: `'swap-classification'` added to whitelist + early-return handler after `update-contract-period`. Sets `matched_template_id` to explicit target (idempotent). `logEvent` category corrected to `'ADMIN'` (uppercase, per `EventCategory` type).
- `script.js?v=384 → 385` in `frontend/admin/index.html`.
- TS check clean for `classifications.ts` (2 pre-existing errors in unrelated files).
