# Design Log 364: "מוכנים להכנה" tab — "v" button advances next stage + count mismatch fix
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-27
**Branch:** `DL-364-ready-prep-v-button`
**Related Logs:** DL-033 (review-queue FIFO), DL-050 (inline confirmation), DL-065 (bulk-import), DL-161 (8-stage pipeline), DL-155 (reminder logic)

## 1. Context & Problem

Two related bugs on the admin "מוכנים להכנה" (Ready for Preparation, Stage 5/Review) screen:

1. **The "v" (circle-check) button jumps Stage 5 → Stage 8**, silently skipping `Moshe_Review` (6) and `Before_Signing` (7). It calls `POST /webhook/admin-mark-complete` (`api/src/routes/stage.ts:76`) which hard-codes `stage: 'Completed'`. This was the correct behavior **before** DL-161 added the 8-stage pipeline; it was never updated. The user expects "v" to advance to the next stage.

2. **The stat card shows 49 but the tab badge shows 47** — a 2-record gap. Both count Stage 5, but the queue filter requires `docs_completed_at` set, while the stat card doesn't. Two clients are at Stage 5 with NULL `docs_completed_at` (typically because the stage was set manually via the dropdown rather than via natural document-completion flow). Both counters should agree.

**Outcome:**
- "v" button advances Review → Moshe_Review (one stage forward) with stage-specific Hebrew wording.
- Backend `/admin-change-stage` backfills `docs_completed_at = now()` when moving a client TO `Review` and the field is empty. This makes the stat-card count and the FIFO queue agree.

## 2. User Requirements (Q&A)

1. **Q:** Intended "v" button behavior?
   **A:** Advance one stage (Review 5 → Moshe_Review 6).
2. **Q:** Scope — Review tab only or all queue tabs?
   **A:** Review tab only.
3. **Q:** New dialog/toast wording?
   **A:** "העבר לבדיקת משה?" (confirm) / "הועבר לבדיקת משה" (success).
4. **Q:** Backend approach?
   **A:** Reuse `/admin-change-stage` with `target_stage='Moshe_Review'`. No new endpoint.
5. **Q:** How to handle the 47 vs 49 count mismatch?
   **A:** Bundle fix into DL-363.
6. **Q:** Source of truth direction?
   **A:** Backfill `docs_completed_at = now()` in `/admin-change-stage` when moving TO `Review` and the field is empty.

## 3. Research

**Domain:** Admin UI affordance correctness + state-machine consistency (forward stage transitions must leave state coherent for downstream consumers).

**Verdict (cumulative knowledge — no new external research needed):**
- The "v" rebind is button-rebinding to an existing tested endpoint. Universal UX principle: a "next step" affordance must not jump terminal-state.
- The `docs_completed_at` backfill is a state-machine consistency fix: when state X requires invariant I (here, "Review implies docs_completed_at is set, because the FIFO queue depends on it"), every transition INTO X must establish I. Currently only the natural document-collection flow sets it; manual stage moves bypass it. Textbook missing-invariant bug.
- Both fixes follow existing codebase patterns (`showConfirmDialog` for mutations, `/admin-change-stage` for stage moves with side-effects).

## 4. Codebase Analysis

**Files involved:**
- `frontend/admin/js/script.js:3281–3312` — `markComplete(reportId, name)`. Currently calls `/admin-mark-complete`; rebound to `/admin-change-stage` with `target_stage: 'Moshe_Review'` and updated wording.
- `frontend/admin/js/script.js:3226` (desktop) + `:3268` (mobile) — both render the "v" button via `markComplete`. Single function fix covers both.
- `frontend/admin/js/script.js:1985–2005` — `recalculateStats()`. No change needed — once the backend backfills `docs_completed_at`, both counters agree on subsequent dashboard loads.
- `api/src/routes/stage.ts:17–73` — `POST /admin-change-stage`. Already handles forward moves, reminder cleanup, audit logging. **Add:** when `target_stage === 'Review'` AND `docs_completed_at` is empty, set it to `new Date().toISOString()`.
- `api/src/routes/dashboard.ts:116–124` — `review_queue` filter. No change.
- `api/src/routes/stage.ts:76` — `POST /admin-mark-complete`. Becomes unused on this tab. Defer deletion (Open Question 1).
- `frontend/admin/index.html` — cache-bust `script.js?v=NNN` bump.

**Existing patterns reused:**
- `showConfirmDialog(msg, onConfirm, confirmText)` — every state-change goes through this.
- `ENDPOINTS.ADMIN_CHANGE_STAGE` — already exists in `script.js`, used by the stage dropdown.
- `/admin-change-stage` reminder cleanup logic (DL-155) — applies automatically.

**No new endpoints, no new modules.**

## 5. Technical Constraints & Risks

- **Risk: existing 2 clients with NULL `docs_completed_at`.** The new backend logic only backfills on **future** transitions to Review. The two existing affected clients remain stuck until they're moved out of Review and back in, OR until we run a one-time backfill. See Open Question 2.
- **Risk: forward-move chains.** If someone moves a client `4 → 5 → 6` rapidly, the `docs_completed_at` set in step 1 persists into step 2 (correct — `/admin-change-stage` only clears on backward moves from ≥5).
- **Risk: docs_completed_at semantics drift.** Originally meant "all required documents were received." Now also means "moved to Review manually at this timestamp." Acceptable: all downstream consumers (FIFO queue, stat counters) treat it as "entered Review at this time."
- **Backend deploy required** (api/src/routes/stage.ts) — auto-deploy via wrangler from feature branch. Cache-bust `script.js?v=NNN` for frontend.

## 6. Proposed Solution

### Success Criteria
1. Clicking the "v" row button on the Stage-5 (Review) tab moves the client from `Review` → `Moshe_Review` with new Hebrew wording.
2. After the next dashboard refresh, the stat card "מוכנים להכנה" and the tab badge / "X לקוחות בתור" show the **same** number for newly-transitioned clients.

### Logic Flow

**Frontend ("v" button):**
1. User clicks "v" → `markComplete(reportId, name)`.
2. `showConfirmDialog("העבר את \"<name>\" לבדיקת משה?", ..., 'העבר לבדיקת משה')`.
3. On confirm: `POST /webhook/admin-change-stage` with `{ token, report_id, target_stage: 'Moshe_Review' }`.
4. On success: `showModal('success', 'הועבר!', '"<name>" הועבר לבדיקת משה בהצלחה.')` then `loadDashboard()`.

**Backend (`/admin-change-stage` enhancement):**
After existing reminder logic, before the Airtable update:
```ts
if (target_stage === 'Review' && !report.fields.docs_completed_at) {
  fields.docs_completed_at = new Date().toISOString();
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/stage.ts` | Modify | Backfill `docs_completed_at` when moving TO `Review` and empty. |
| `frontend/admin/js/script.js` | Modify | `markComplete()`: swap endpoint, new wording. |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=NNN` cache-bust. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-363 row. |
| `.agent/current-status.md` | Modify | Add Section 7 test items under Active TODOs. |

### Out of Scope (deferred)
- Renaming `markComplete` → `advanceToMosheReview` (cosmetic).
- Deleting `POST /admin-mark-complete` from `stage.ts` (Open Question 1).
- One-time backfill for the 2 existing affected clients (Open Question 2).
- Extending pattern to other queue tabs.

## 7. Validation Plan

**Frontend "v" button:**
- [ ] Open admin → "מוכנים להכנה" tab → pick a Stage-5 test client.
- [ ] Click "v" → confirm dialog reads "העבר את \"<name>\" לבדיקת משה?".
- [ ] Click "העבר לבדיקת משה" → success modal "הועבר!" with body "\"<name>\" הועבר לבדיקת משה בהצלחה.".
- [ ] Row disappears from "מוכנים להכנה" and appears in "לבדיקה של משה".
- [ ] Airtable check: `stage = Moshe_Review`, `docs_completed_at` preserved.
- [ ] Reminder fields all NULL on that record.
- [ ] Test the same flow in **mobile card view** (resize browser narrow).
- [ ] No regression: stage dropdown still works.

**Backend `docs_completed_at` backfill:**
- [ ] Pick a test client at Stage ≤4. Use the stage dropdown to move them directly to `Review`.
- [ ] Airtable check: `docs_completed_at` is now set to current timestamp.
- [ ] Reload dashboard: stat card "מוכנים להכנה" and tab badge show the **same** number.
- [ ] Client appears at the **bottom** of the FIFO queue (most recent timestamp).
- [ ] Pick a client already at Stage 5 with `docs_completed_at` set. Move via dropdown to Stage 4, then back to Stage 5. Verify `docs_completed_at` was cleared on the backward move (existing) and re-set on the forward move (new).

**Cache + deploy:**
- [ ] Hard reload after deploy → browser fetches new `script.js?v=NNN`.
- [ ] `wrangler tail` shows no startup errors after `wrangler deploy`.

## 8. Implementation Notes (Post-Code)

- Initial reservation gave DL-363 but `current-status.md` already had an informal DL-363 entry (chat-bubble misclassification, IDEA/BACKLOG logged earlier same day) without an actual log file. Re-reserved DL-364 to avoid collision; renamed branch + log file accordingly.
- Backend change is exactly 3 lines in `api/src/routes/stage.ts` (between the existing reminder cleanup branch and the `airtable.updateRecord` call). Followed the existing pattern of mutating the `fields` object before the single Airtable write — keeps the side-effect atomic.
- Frontend change kept the function name `markComplete` for now (cosmetic rename deferred per Out-of-Scope); only the dialog/toast wording, endpoint, body shape, and the row-button tooltip were updated. Tooltip update used `replace_all: true` since both desktop and mobile renderers used the same string.
- **Open Question 1 finding:** `POST /admin-mark-complete` (`api/src/routes/stage.ts:81`) and `ENDPOINTS.ADMIN_MARK_COMPLETE` (`frontend/shared/endpoints.js:35`) both remain in the tree but have **zero remaining JS call sites** after this change (grep confirmed). Safe to delete in a follow-up DL after one release cycle.
- **Open Question 2:** the 2 currently-stuck Stage-5 clients with NULL `docs_completed_at` are not auto-resolved by this change — they'll only get the timestamp the next time `/admin-change-stage` moves them TO Review. Defer one-time backfill until user decides; can be done via the temp-endpoint pattern (`reference_onedrive_temp_endpoint_pattern.md`).
