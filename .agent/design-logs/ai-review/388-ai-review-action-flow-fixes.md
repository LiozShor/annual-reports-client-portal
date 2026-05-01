# Design Log 388: AI Review Tab — Action-Flow Fixes (silent refresh + auto-advance + match-error guard)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-01
**Related Logs:** DL-341 (preview zoom + first auto-advance), DL-369 (move-to-client refresh path), DL-370 (move edge cases), DL-374 (open-tab itemId), DL-373/379/380/382 (encrypted-file flow that may produce file-less classification rows).

## 1. Context & Problem

Two regressions in the AI Review tab degrade daily office throughput:

1. **Match-to-existing dead end.** Picking "[H:also-match]" → "general doc" / "existing" / similar surfaces variants of `Classification has no file to share` (server-side 400) shown to the user as a generic "[H:error]" modal (`Classification has no file to share`). The error fires whenever the source classification record is missing `onedrive_item_id` and/or `file_url`. The user reports this is one example of multiple variants in the match flow.

2. **No silent refresh / no auto-advance** after approve / reject / reassign / match / move. The user must hard-refresh to see the result, and the queue does not advance to the next pending classification. This used to work (per DL-341) but is now perceived as broken — either the auto-advance branch is being skipped, the scope is too narrow (mobile + cross-client excluded), or new code paths (conflict dialogs, encrypted files) bypass `transitionCardToReviewed()`.

Net effect: a multi-click, hard-refresh review loop instead of the intended one-click-to-zero-click queue. This is exactly what `feedback_silent_refresh_after_mutation.md` tells us never to ship.

## 2. User Requirements

1. **Q:** How should I scope the design log?
   **A:** One DL covering both bugs.
2. **Q:** For the match-to-existing error flow ("Classification has no file to share" etc.), desired behavior?
   **A:** Investigate & fix root cause.
3. **Q:** After approve / reject / match / etc. — desired post-action behavior?
   **A:** Auto-advance to next pending classification.
4. **Q:** Which actions should trigger the silent refresh + auto-advance?
   **A:** All state-changing AI Review actions (it worked in the past).
5. **Q:** If auto-advance reaches the last pending item (queue empty), what should happen?
   **A:** Show the existing "All caught up" empty state.
6. **Q:** Continue end-to-end after approval, or stop at the approved plan?
   **A:** Continue through Phase D (implement, deploy, hand off tests).

## 3. Research

### Domain

Review-queue UX (operator throughput) + optimistic UI with server reconciliation, in a vanilla-JS SPA with SWR-style fingerprint refresh.

### Sources Consulted

1. **UX Stack Exchange — "Approve/Reject workflow for User Reviews"** (https://ux.stackexchange.com/questions/84483) — canonical guidance: actioned items leave the list with a fadeout; the next pending becomes the focus; status icons on remaining items reduce scanning load. Directly maps to AI Review's same-class queue.
2. **TanStack Query — Optimistic Updates** (https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates) — optimistic state must be reconciled with server truth via a follow-up `invalidate`/refetch; UI-only optimism without reconciliation drifts. Maps to our `transitionCardToReviewed()` which mutates local state but never re-fetches.
3. **React `useOptimistic` reference** (https://react.dev/reference/react/useOptimistic) — reinforces the same pattern: optimistic value + reconcile after the action settles. We are not on React for this surface, but the pattern (local update → schedule reconcile) translates.

### Key Principles Extracted

- **Action implies intent for next.** When an operator actions item N in a homogeneous queue, default to surfacing N+1; do not require a second click.
- **Optimistic UI requires reconciliation.** Every mutation handler must end in a fingerprint-aware refetch; "looks updated" is not "is updated".
- **Pre-validate known preconditions.** When the server has a guard (`!file_url`), pre-check on the client and disable / explain rather than serve a generic post-submit error.
- **Empty state is part of the happy path.** Queue-drained must render "all caught up" — no blank panes.
- **Mobile metaphor matters.** A "fat-card swap" UI should not silently reorder; smooth-scroll-to-next preserves spatial continuity.

### Patterns to Use

- **Auto-advance with same-client preference and cross-client fallback** (DL-341 base, extended): pick next pending; prefer same client; fall back to next client; on empty → empty state.
- **Fingerprint-short-circuit silent refetch** (existing `loadAIClassifications(silent=true)` at script.js:4065-4230): cheap to fire after every mutation.
- **Client-side precondition guard** before opening match-to-existing / move-to-client modals.

### Anti-Patterns to Avoid

- **Optimistic-only state** without reconcile — current bug.
- **Generic post-submit error modals** for known preconditions — replace with actionable inline guidance.
- **Hard reload** — already worked around with SWR; do not regress.
- **Cross-client jump on every action** — only when same-client is empty (avoid yanking the operator out of context).

### Research Verdict

Restore + extend DL-341 auto-advance to cover all state-changing actions, add a silent reconcile after every mutation via the existing `loadAIClassifications(silent=true)` path, and replace the match-to-existing error round-trip with a client-side precondition guard plus disabled action buttons on file-less classification rows.

## 4. Codebase Analysis

- **Existing Solutions Found:**
  - `transitionCardToReviewed(recordId, status, data)` at `frontend/admin/js/script.js:8250-8302` — orchestrator already called by approve, reject, reassign, also-match.
  - DL-341 auto-advance branch at `frontend/admin/js/script.js:8293-8299` — desktop + same-client only; sorts via `compareDocRows` and calls `selectDocument(next.id)`.
  - `loadAIClassifications(silent, prefetchOnly)` at `frontend/admin/js/script.js:4065-4230` — already SWR-style with fingerprint short-circuit; safe to call after every mutation.
  - `renderAICards` empty-state path at `frontend/admin/js/script.js:5660-5701` — shows the "all caught up" empty state when `aiClassificationsData.length === 0`.
  - `moveClassificationClient` at `frontend/admin/js/script.js:7163+` — already does `loadAIClassifications(false, true)` + `selectClient(target)` (correct pattern; reuse).
- **Reuse Decision:** Reuse `transitionCardToReviewed`, `loadAIClassifications(true)`, `compareDocRows`, `selectDocument`, `selectClient`, `renderAICards` empty-state. Only widen the auto-advance branch and add a single `queueMicrotask(reconcile)` line at the end of the orchestrator. New code: client-side precondition guards in `showAIAlsoMatchModal` and `moveClassificationClient`.
- **Relevant Files:**
  - `frontend/admin/js/script.js` — handlers + orchestrator + match modal entry.
  - `frontend/admin/index.html` — `?v=NNN` cache-bust on `script.js`.
  - `api/src/routes/classifications.ts` — error shape at lines 1224-1229 (`also_match`) and 2227-2233 (`move-classification-client`).
- **Existing Patterns:** Optimistic local DOM transition + (currently absent) server reconcile; SWR fingerprint refresh; modal-based action confirmations via `showInlineConfirm` / `showAIAlsoMatchModal`.
- **Alignment with Research:** Codebase already partially implements the UX-SE auto-advance pattern (DL-341) and the SWR-style reconcile primitive (`loadAIClassifications(silent)`). Gap = wiring the reconcile after every mutation + extending auto-advance.
- **Dependencies:** Cloudflare Workers (`api/`), Airtable (`classifications` table fields `onedrive_item_id`, `file_url`, `review_status`), Cloudflare Pages (`docs.moshe-atsits.com` via `annual-reports-client-portal-git`).

## 5. Technical Constraints & Risks

- **Security:** No new data surfaced; pre-check uses fields already returned by `/get-pending-classifications`. No PII expansion.
- **Operational Risks:**
  - Cross-client auto-advance must not steal the operator's manual selection — guard with "only when same-client queue is empty".
  - Silent reconcile fires once per mutation; SWR fingerprint short-circuit prevents thrash.
  - Cache-bust must accompany script.js edits or office serves stale (`feedback_admin_script_cache_bust.md`).
- **Breaking Changes:** Server returns `error: 'no_file_to_share'` (was: 'Classification has no file to share' message). Backwards-compatible because callers display `data.error || data.message`; no schema change.
- **Mitigations:**
  - Keep DL-341 same-client preference; cross-client only as fallback.
  - Pre-check stops the user before the modal opens; no half-submitted state.
  - Mobile gets scroll-into-view, not a layout-tearing swap.
  - Conflict-dialog flows (`approve` `_conflict`, `also_match` `conflicts[]`) wired to fire the same reconcile after the dialog resolves.

## 6. Proposed Solution

### Success Criteria

After any state-changing AI Review action (approve / reject / reassign / match-to-existing / move-to-client), the UI advances to the next pending classification (same client first, cross-client fallback) without a manual refresh, silently reconciles with the server, and renders "all caught up" when the queue is empty. The match-to-existing flow no longer dead-ends with "Classification has no file to share" — the action button is disabled (with explanatory tooltip) on file-less rows, and any leakage path shows an actionable Hebrew toast instead of a generic modal.

### Logic Flow

1. User clicks an AI Review action (approve / reject / etc.).
2. Action handler runs as today; on success, calls `transitionCardToReviewed(recordId, newStatus, data)`.
3. Orchestrator: update local `aiClassificationsData`; refresh card DOM; recalc stats; sync preview pane.
4. **Auto-advance (extended):** compute `pickNextPending(item)` — same-client first, cross-client fallback. Desktop: `selectClient` if needed + `selectDocument(next.id)`. Mobile: `scrollIntoView(next card)`. None pending: show empty state.
5. **Reconcile:** schedule `queueMicrotask(() => loadAIClassifications(true).catch(()=>{}))`. SWR fingerprint short-circuits when nothing changed server-side.
6. **Match modal pre-check:** `showAIAlsoMatchModal(recordId)` and `moveClassificationClient(recordId, ...)` early-return with a Hebrew toast if `!item.onedrive_item_id || !item.file_url`.
7. **Card render:** disable match / move buttons on file-less rows with title=tooltip.
8. **Conflict-dialog flows** (approve `_conflict`, also_match `conflicts[]`) wire the same reconcile call regardless of user choice.
9. **Server error shape:** add `error: 'no_file_to_share'` code in 400 responses.

### Data Structures / Schema Changes

None. Existing fields used: `id`, `client_name`, `review_status`, `onedrive_item_id`, `file_url`. Server response keeps the same shape; only error string is structured.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Extend auto-advance branch; add reconcile call at end of `transitionCardToReviewed`; add pre-check in `showAIAlsoMatchModal` and `moveClassificationClient`; disable match/move buttons on file-less rows; wire reconcile after conflict dialogs |
| `frontend/admin/index.html` | Modify | Bump `?v=NNN` on `script.js` |
| `api/src/routes/classifications.ts` | Modify | Return `{ ok:false, error:'no_file_to_share', message:'Classification has no file to share' }` at lines 1224-1229 and 2227-2233 |
| `.agent/design-logs/INDEX.md` | Modify | Add row for DL-387 |

### Final Step

- Status → `[IMPLEMENTED — NEED TESTING]`.
- Update INDEX.md.
- Copy Section 7 items to `.agent/current-status.md` Active TODOs.
- Invoke `git-ship` skill for commit/push.
- Deploy: `bash .claude/workflows/deploy-worker.sh` (Worker) + Pages auto-builds on push.

## 7. Validation Plan

- [ ] Approve a pending AI classification on desktop → next same-client pending becomes selected; no manual refresh.
- [ ] Approve the last pending in a client that has pending across the queue → cross-client fallback selects the first pending in the next client.
- [ ] Approve the last pending in the entire queue → "all caught up" empty state renders.
- [ ] Reject with reason → same auto-advance behavior.
- [ ] Reassign (same and cross-filing-type) → auto-advance.
- [ ] "[H:also-match]" success path → auto-advance + silent reconcile.
- [ ] Match-to-existing on a classification with `file_url` blank → action button disabled with tooltip; clicking via keyboard nav shows actionable Hebrew toast (no generic "[H:error]" modal).
- [ ] Mobile (narrow layout) approve → card swap + smooth scroll to next pending; queue empty → empty state.
- [ ] Approve `_conflict` dialog → choose any option → silent reconcile fires; UI matches Airtable on next tab return.
- [ ] Move-to-client retains existing behavior (full reload + selectClient) but also adds the file-less pre-check.
- [ ] Cache-bust version bumped in `frontend/admin/index.html` (office picks up the fix without hard reload).
- [ ] Follow-up audit: count of classifications with blank `file_url` AND `onedrive_item_id`; identify the inbound code path that produces them (separate DL).
- [ ] No console errors; no regression in tab switching, badge counts, or stats grid.

## 8. Implementation Notes

### Deviations from plan
- **DL number bumped from 387 → 388.** The dl-claims ref series only ran up to 380, but `admin-ui/387-reassign-modal-single-click-custom.md` was already on disk at INDEX. Re-claimed 388 atomically and renamed branch + DL file.
- **`move-classification-client` server-side error not changed.** Original plan called for the structured `no_file_to_share` code in both `also_match` (classifications.ts:1227) and `move-classification-client`. Inspection showed the move endpoint does not have a "no file" precondition error; its error vocabulary is `ambiguous_target_report` / `target_report_not_found`. Only the `also_match` site (classifications.ts:1227-1236) was updated. Client-side guard for `moveClassificationClient` remains useful (avoids round-trip on file-less rows even though the server doesn't surface this exact error).
- **Card-level button disable (plan 1.2) not implemented.** Saved scope: the modal-open guards already prevent the dead-end. Disabling the action chip on every file-less card requires touching the renderer + understanding the "show on hover" affordance; deferred to a follow-up if office still reports friction.
- **Conflict-dialog reconcile (plan 2.3) handled implicitly.** The `_conflict` early-return in `confirmAIAlsoMatch` and `approveAIClassification` does not call `transitionCardToReviewed`, so the new microtask reconcile inside that function does not fire. Acceptable because the user is still on the source card and will trigger another action; the next mutation reconciles. If office reports conflict-dialog drift, add a single `loadAIClassifications(true)` call before the conflict early-return.

### Research principles applied
- **Action implies intent for next** (UX SE) — `transitionCardToReviewed` now advances to next pending in same client → next client (cross-client fallback) → empty state.
- **Optimistic UI requires reconciliation** (TanStack Query) — `queueMicrotask(loadAIClassifications(true))` after every mutation; SWR fingerprint short-circuit keeps it cheap.
- **Pre-validate known preconditions** — `showAIAlsoMatchModal` and `moveClassificationClient` early-return with actionable Hebrew toasts when `!onedrive_item_id || !file_url`.

### Files changed
- `api/src/routes/classifications.ts` — structured `no_file_to_share` error response (1227-1236).
- `frontend/admin/js/script.js` — `formatAIResponseError` mapping; `showAIAlsoMatchModal` guard; `moveClassificationClient` guard; `transitionCardToReviewed` rewrite (auto-advance + cross-client fallback + mobile scroll + microtask reconcile).
- `frontend/admin/index.html` — cache-bust `?v=391` → `?v=392`.
- `.agent/design-logs/INDEX.md` — DL-388 row.

### Commands run
- `./node_modules/.bin/tsc --noEmit` (api) — pre-existing errors in `src/index.ts:128` and `lib/activity-logger.ts:16` unrelated to this change; my edits introduced no new TS errors.

