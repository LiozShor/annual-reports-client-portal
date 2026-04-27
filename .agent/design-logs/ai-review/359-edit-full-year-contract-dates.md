# Design Log 359: Edit Full-Year Contract Dates (Override AI Verdict)
**Status:** [COMPLETED]
**Date:** 2026-04-27
**Related Logs:** DL-270 (inline click-to-edit partial contract dates), DL-269/271 (request missing period), DL-314 (rental contract templates T901/T902)

## 1. Context & Problem
In the AI-review tab, when a client uploads a rental contract (template T901/T902) the LLM-classifier detects whether it covers the full tax year. Two render branches in `frontend/admin/js/script.js`:

- **Partial year** (`cp.coversFullYear === false`): banner with click-to-edit start/end month spans + "+ בקש חוזה {missing}" buttons. User can correct dates inline.
- **Full year** (`cp.coversFullYear === true`): a static green badge `📅 חוזה שנתי מלא ✓`. **No edit affordance.** If the LLM is wrong (e.g., detected Jan–Dec but contract is actually Jun–May), the operator has no way to override without going to Airtable directly.

Asymmetric trust in the AI verdict is a UX hole — the partial path already accepts that the AI may be wrong; the full-year path silently assumes it isn't.

## 2. User Requirements
1.  **Q:** How should the user override an LLM-classified "full year" contract?
    **A:** Click the badge to convert to partial-mode edit UI (same inputs as partial contracts).
2.  **Q:** After edits, what determines full-year vs partial?
    **A:** Backend re-evaluates `coversFullYear` from new dates. If span is Jan 1 – Dec 31, restore green badge; otherwise switch to partial banner with request-missing buttons.
3.  **Q:** Audit flag for manual override?
    **A:** No — silent edit, reuse existing `update-contract-period` endpoint. Frontend-only change.
4.  **Q:** Initial date values when expanding the full-year badge to edit mode?
    **A:** Pre-fill with the AI's detected `cp.startDate` / `cp.endDate` (typically `{year}-01-01` and `{year}-12-31` for full year). User edits one or both.
5.  **Q:** What happens if user collapses/cancels the edit without changing anything?
    **A:** Out of scope — clicking the editable date span and pressing Esc/blurring without picking already restores the label (existing `editContractDate` behavior). No new "cancel expansion" action needed.

## 3. Research
### Domain
UX for overriding ML/AI predictions; symmetric edit affordances across confidence states.

### Sources Consulted (existing patterns / prior work)
1. **DL-270 (inline click-to-edit dates)** — Established the `contract-date-editable` span + `editContractDate()` + `saveContractPeriod()` flow. Already battle-tested for partial contracts.
2. **NN/g — "Anti-Patterns: Don't Hide Editing Behind Modes"** — Generic ML-UX guidance: any AI verdict shown in the UI must have a visible edit path. Hidden edit affordances cause silent acceptance of wrong predictions.
3. **`api/src/routes/classifications.ts:604-628`** — Backend already symmetric: `update-contract-period` recomputes `coversFullYear` from posted dates and persists. No backend change needed.

### Key Principles Extracted
- **Symmetry:** Edit affordance must exist on every state, not just the "uncertain" one. Full-year detections are wrong sometimes too.
- **Reuse over reinvention:** Partial-mode banner HTML + edit handlers already work. A new full-year-edit modal would be duplicate code.
- **Backend is already correct:** `coversFullYear` is recomputed from posted dates server-side, so the frontend just needs to surface the path.

### Patterns to Use
- **Progressive disclosure:** Full-year badge stays compact until clicked; expanding it reveals the same partial-mode editor inline.
- **Bidirectional state swap:** Partial → full restoration after save (currently subtly broken — see Section 5) made symmetric with full → partial expansion via shared render helper.

### Anti-Patterns to Avoid
- **New modal for full-year edit:** Duplicates partial-mode behavior; users would learn two interactions for the same outcome.
- **Always-editable inputs:** Drops the visual affirmation that "AI got it right" for the 90%+ correct case; adds noise.
- **Audit field on Airtable:** Out of scope per Q3; can be added later if needed for AI accuracy tracking.

### Research Verdict
Reuse the partial-mode banner + edit handlers. Add a click handler on the full-year badge that swaps the badge for the partial banner pre-filled with the AI's current dates. Existing save flow handles the rest. Extract the partial banner render into a small helper so post-save state transitions can call it bidirectionally.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `editContractDate(rid, field, el)` at `frontend/admin/js/script.js:6352` — inline `<input type="month">` swap.
  - `saveContractPeriod(rid, startDate, endDate)` at `script.js:6394` — POSTs to `update-contract-period`, handles UI update on response.
  - Partial-mode banner HTML at `script.js:4810-4831` (also duplicated at lines 5739-5764 and 781-792 for other surfaces — *see Section 5*).
  - Backend `action: 'update-contract-period'` at `api/src/routes/classifications.ts:604-628` — recomputes `coversFullYear` server-side. **Already correct.**
* **Reuse Decision:** Reuse all three. Add ONE new function `expandFullYearBadgeToEdit(rid, badgeEl)` that mutates the badge's outer HTML in place to the partial banner. Add helper `renderContractPeriodBanner(rid, cp, year)` to centralize the partial banner HTML so `saveContractPeriod` can swap back when re-eval flips state.
* **Relevant Files:**
  - `frontend/admin/js/script.js` — only file changed (cache version bump in `frontend/admin/index.html`).
* **Existing Patterns:**
  - Click-to-edit using span swap (DL-270).
  - `event.stopPropagation()` on every editable span/button to prevent card expand/collapse.
  - Cache-bust comment via `?v=NNN` in `index.html`.
* **Alignment with Research:** Existing partial-mode flow already implements the recommended pattern. We're extending coverage, not deviating.
* **Dependencies:** None new. Airtable `Contract_Period` JSON column unchanged. Endpoint unchanged.

## 5. Technical Constraints & Risks
* **Security:** None. Same auth flow (HMAC token) as existing `update-contract-period`.
* **Risks:**
  - **Pre-existing bug surfaced:** `saveContractPeriod` line 6436 calls `banner.querySelector('.period-label').textContent = ...` to restore the full-year label, but the current partial banner has no `.period-label` element — so partial → full transitions silently no-op the label swap and leave stale partial UI. Will fix as part of this DL by introducing the shared render helper.
  - **Other surfaces showing the same banner** (Pending Approval queue at line 5739, mobile banner at line 781) currently render the editable partial banner but DO NOT have full-year click-to-edit. Out of scope for this DL — only the AI-review card (line 4799-4833 region) is in scope per user report. Note in Section 8 if patterns should propagate.
  - **Cache busting:** Edits to `script.js` require bumping `?v=NNN` in `frontend/admin/index.html` per memory `feedback_admin_script_cache_bust.md`.
* **Breaking Changes:** None. Existing partial-flow callers and DOM expectations preserved.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
On the AI-review card for a contract document marked `coversFullYear: true`, the operator can click the green "חוזה שנתי מלא ✓" badge, edit start/end months inline using the same UI as partial contracts, and save — with the badge correctly switching to partial-mode banner (with request-missing buttons) when the new dates no longer span Jan–Dec.

### Logic Flow
1. **Render full-year badge** with `onclick` handler + `cursor: pointer` + tooltip "לחץ לעריכה" + chevron/edit icon hint.
2. **On click** → call `expandFullYearBadgeToEdit(rid, badgeEl)`:
   a. Look up the classification item from `aiClassificationsData` by `rid`.
   b. Construct partial-banner HTML via new helper `renderContractPeriodBanner(rid, cp, year)`.
   c. Replace the badge's outerHTML with the partial banner.
   d. Auto-focus the start-date span to invite immediate editing.
3. **User edits a date** → existing `editContractDate` opens `<input type="month">` → on change calls `saveContractPeriod`.
4. **`saveContractPeriod` response handling** (refactor lines 6424-6456):
   - On `data.contract_period.coversFullYear === true`: swap banner back to full-year badge HTML (using same constructor as initial render).
   - On `coversFullYear === false`: re-render the partial banner via `renderContractPeriodBanner` (replaces the broken `.period-label` lookup). Updated banner shows correct request-missing buttons for the new gap.
5. **Update local cache:** `aiClassificationsData[i].contract_period = data.contract_period` (already done).

### Data Structures / Schema Changes
None.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Add `renderContractPeriodBanner(rid, cp, year)` and `renderFullYearBadge(rid, year)` helpers; replace inline HTML at line 4809 (full-year branch) with click-to-edit version; replace inline HTML at lines 4827-4831 (partial branch) with helper call; refactor `saveContractPeriod` post-save UI swap (lines 6424-6456) to use both helpers for bidirectional state swap; add new function `expandFullYearBadgeToEdit(rid, badgeEl)`. |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=NNN` cache version. |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items to `current-status.md` under Active TODOs, commit + push feature branch, deploy not needed (frontend-only — Cloudflare Pages auto-deploys after merge to main).

## 7. Validation Plan
* [ ] Open AI-review tab on a card with a T901/T902 contract document where AI marked `coversFullYear: true` (find one via filter or use test fixture).
* [ ] Verify the green "חוזה שנתי מלא ✓" badge has a pointer cursor, hover tooltip "לחץ לעריכה", and looks visually distinct enough to suggest clickability.
* [ ] Click the badge → verify it expands inline into the partial-mode editor with the AI-detected dates pre-filled (e.g., 01.2025 and 12.2025).
* [ ] Edit the start month to 06.2025 → blur the input → verify save toast "תאריכי חוזה עודכנו".
* [ ] Verify the banner now shows partial-mode with "+ בקש חוזה 01.2025-05.2025" button visible.
* [ ] Click "+ בקש חוזה" button → verify the missing-period request flow still works.
* [ ] Edit dates back to 01.2025 / 12.2025 → save → verify the banner swaps BACK to the green full-year badge.
* [ ] Refresh the page → verify the persisted state matches the last save (full or partial).
* [ ] Verify partial-mode contracts (the existing flow) still render correctly and click-to-edit on their dates still works (no regression).
* [ ] Verify request-missing-period buttons for partial contracts are unaffected (no regression).
* [ ] Verify Pending Approval queue (line 5739 surface) and mobile banner (line 781 surface) — confirm they still render correctly (we did NOT touch those branches; if they show full-year as static, that's pre-existing scope, document in Section 8).

## 8. Implementation Notes (Post-Code)
* **Implementation:** Added two helpers (`renderFullYearBadge`, `renderContractPeriodBanner`) and a new `expandFullYearBadgeToEdit` function in `frontend/admin/js/script.js`. Replaced the inline branch at the AI-review render site (around line 4804) with helper calls. Refactored `saveContractPeriod`'s post-save block to use `document.querySelector` with a combined selector for either banner state and replace `outerHTML` with the helper output — fixes the pre-existing `.period-label` no-op bug noted in §5.
* **Cache bust:** `frontend/admin/index.html` `script.js?v=363 → v=364`.
* **Backend:** Untouched. `update-contract-period` already recomputes `coversFullYear` server-side.
* **Out-of-scope siblings (carry-over):**
  * Pending Approval queue partial banner (`script.js:5739`) — still has the partial click-to-edit but no full-year clickable badge.
  * Mobile banner (`script.js:781`) — same asymmetry.
  * If user reports the same need on those surfaces, the new helpers can be reused there in a follow-up DL.
* **No automated tests** — `script.js` is the unmodularized "devil file" per memory. Verification is manual via §7 checklist.
