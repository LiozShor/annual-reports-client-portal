# Design Log 288: Fix Queued-Subtitle Stale Flash on Dashboard Load
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-16
**Related Logs:** DL-281 (Outbox as source of truth), DL-273 §8 (queued_send_at staleness gap)

## 1. Context & Problem
On admin dashboard load, the stage-3 card briefly flashes a stale subtitle like `(30 בתור לשליחה)` for ~100–300ms, then the subtitle disappears. The flashed count is yesterday's delivered emails, not anything actually pending.

Root cause: in `recalculateStats()` the `queuedCount` expression falls back to a client-side filter on `clientsData.c.queued_send_at` whenever `queuedEmailsLoaded === false`. That field never self-clears after 08:00 delivery (the exact gap DL-273 §8 documented and DL-281 set out to fix). So during the brief window before `/admin-queued-emails` responds, the card renders from stale Airtable data. Once the Outbox fetch lands, `recalculateStats()` re-runs with the real (usually empty) Outbox set and the subtitle is removed.

DL-281 switched the post-load path to Outbox as the source of truth but left the pre-load fallback in place (Risk C in that log proposed gating by "scheduled time in the future"; that gate was never implemented).

## 2. User Requirements
Direct observation: "currently when I get to the admin portal — I see an orphaned text '30 ממתינים לשליחה' then it's gone". No clarification needed — the fix target is unambiguous.

## 3. Research
Domain already researched in DL-281 (Outlook Outbox as source of truth, deferred-send semantics, DL-273 staleness). No new research required.

**Principle applied:** "Don't render a UI element from a known-stale data source, even briefly." The subtitle has no meaning until the authoritative answer (Outbox contents) is available. Rendering a placeholder is better than rendering a wrong answer that later silently changes.

## 4. Codebase Analysis
* **Affected code:** `frontend/admin/js/script.js:1598-1607` (inside `recalculateStats()`).
* **Callers:** `recalculateStats()` is invoked on every data refresh; `loadQueuedEmails()` sets `queuedEmailsLoaded = true` and re-calls it after the Outbox fetch completes.
* **Downstream:** Only the stage-3 card subtitle consumes `queuedCount` (lines 1609-1626). When count is 0 the subtitle is either never created or removed — which is exactly the desired pre-load state.
* **No backend change needed.** `/admin-queued-emails` already returns the correct value once awaited.

## 5. Technical Constraints & Risks
* **Risk — Legacy records with no `graph_message_id`:** DL-281's Risk C noted that pre-DL-281 queued records only have `queued_send_at` and would be invisible to the Outbox-based endpoint. Impact of this change: those legacy records contribute 0 to the pre-load count (same as before — the old fallback was just temporarily visible for ~200ms, it was never actually correct). Once the Outbox fetch completes they remain invisible, same as in the current deployed behavior. **No regression.**
* **Risk — First-load UX:** The subtitle now has a ~100–300ms delay before appearing when there IS a real queue. Acceptable — the subtitle is advisory (clickable modal for detail), the stage-3 count itself is unaffected.
* **Breaking changes:** None. Pure render-time behavior change.

## 6. Proposed Solution

### Success Criteria
Admin dashboard load shows no stale `(N בתור לשליחה)` flash. The subtitle either doesn't render, or renders with the correct Outbox-backed count once that fetch resolves.

### Logic Flow
1. `recalculateStats()` runs on initial data arrival. `queuedEmailsLoaded` is false. `queuedCount = 0`. Subtitle-render branch (line 1609 `if (queuedCount > 0)`) is skipped — no DOM mutation.
2. `loadQueuedEmails()` completes, sets `queuedEmailsLoaded = true`, and calls `recalculateStats()` again.
3. Now `queuedCount` reflects actual Outbox contents. Subtitle created iff `> 0`.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Lines 1598-1607: replace stale fallback with `: 0`. Update comment. |

### Final Step (Always)
Housekeeping: INDEX row, current-status.md entry, commit, merge.

## 7. Validation Plan
- [ ] Hard-reload `/admin` on a day after 08:00 when there are no queued emails. Stage-3 card renders clean — no `(N בתור לשליחה)` flash at any point.
- [ ] Queue an email via approve-and-send during off-hours (or manipulate a test record to have a future Outbox message). Reload. Subtitle appears with correct count once Outbox fetch resolves (~200-500ms). No flicker to a different wrong number.
- [ ] Verify clicking the subtitle still opens `openQueuedEmailsModal()` with correct list (regression check on DL-281).
- [ ] Regression: `recalculateStats()` still correctly updates stage counts (stat-total, stat-stage1..8). Unrelated to the fix but called in the same function.

## 8. Implementation Notes
* Intentionally chose "render nothing" over DL-281 Risk C's "gate by future time" suggestion. The latter would preserve legacy-record visibility but adds complexity for a migration window that's already past (all post-DL-281 queued records have `graph_message_id`). Simpler + correct-by-construction.
* Branch work done in main repo, not the originally-intended worktree — the session's worktree admin directory was pruned by a concurrent cleanup process and could not be repaired mid-session. Tracked as a session note only; no code impact.
