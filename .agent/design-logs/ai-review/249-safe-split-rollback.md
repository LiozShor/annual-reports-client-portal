# Design Log 249: Safe Split with Rollback on Failure

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-12
**Related Logs:** DL-237 (PDF split & re-classify — original implementation)

## 1. Context & Problem

DL-237 implemented PDF split & re-classify. Its own research identified "Deleting original on split" as an anti-pattern to avoid, recommending "mark as 'split' rather than deleting." However, the implementation did the opposite — it deletes the original classification record **immediately** (line 511) before background processing starts in `waitUntil`.

When the background job fails (PDF download timeout, pdf-lib error, OneDrive upload failure, Worker time limit), the original record is permanently lost with no recovery mechanism. This happened in production with client דני ויינר — a 7.6 MB PDF was lost from pending classifications and had to be manually restored.

## 2. User Requirements

1. **Q:** Should partial segment failures rollback everything or keep successful segments?
   **A:** Rollback all on any failure — all-or-nothing. If any segment fails, revert original back to 'pending' and delete any partial segments.

2. **Q:** Should the admin panel show progress feedback during split?
   **A:** Toast + auto-refresh — show 'splitting...' toast immediately, auto-refresh list after a few seconds.

3. **Q:** Should review_status get a new 'splitting' value?
   **A:** Yes, new 'splitting' status — clear intent, easy to filter from pending list.

## 3. Research

### Domain
Background Job Safety, Cloudflare Workers waitUntil patterns

### Sources Consulted
1. **Cloudflare Workers docs — ctx.waitUntil** — waitUntil extends execution after response, shares CPU time limit with main handler. Silent failure — no retry, no notification. Fire-and-forget by design.
2. **Martin Fowler — Temporal Patterns / Soft Delete** — Use status field as state machine instead of hard delete. Status column IS your crash-recovery mechanism. `active` → `processing` → `deleted` (or rollback).
3. **Stripe engineering — Saga pattern / idempotency** — Each step writes completion state; on failure, compensation function reverses completed steps. Guard clauses prevent duplicate processing.

### Key Principles Extracted
- **Never hard-delete before async work completes** — the status column is the crash-recovery mechanism
- **All-or-nothing with compensation** — track each step, rollback completed steps on failure
- **Design for waitUntil failure** — it's fire-and-forget, silent on error

### Patterns to Use
- **Status transition pattern:** `pending` → `splitting` → (success: delete original) / (failure: revert to `pending`)
- **Compensation on failure:** Delete any partially-created segment records before reverting original

### Anti-Patterns to Avoid
- **Delete-before-process** — exactly what the current code does. Loses data on background failure.
- **Partial success without cleanup** — leaving orphaned segment records alongside a reverted original

### Research Verdict
Replace the immediate-delete pattern with a status transition. Mark the original as 'splitting' (hidden from the pending list), process in background. On success, mark as 'split'. On failure, delete any partial segments and revert to 'pending'. This aligns with DL-237's own research recommendation that was not followed in implementation.

## 4. Codebase Analysis

### Existing Solutions Found
- **Split handler:** `api/src/routes/classifications.ts:489-645` — the code to fix
- **Frontend split UI:** `github/annual-reports-client-portal/admin/js/script.js:7249-7576`
- **get-pending-classifications filter:** `classifications.ts:107` — filters `{review_status} != 'split'`

### Reuse Decision
- Modify existing split handler in-place — no new files needed
- Frontend only needs minor toast text update

### Key Findings
- `review_status` schema: `pending / approved / rejected / reassigned` — no 'split' or 'splitting' yet
- Filter at line 107: `{review_status} != 'split'` — need to also exclude 'splitting'
- Frontend already shows toast + auto-refresh after split — behavior is good, just need to handle the case where refresh shows original still in 'splitting' state

## 5. Technical Constraints & Risks

* **Airtable select field:** Adding 'splitting' value requires `typecast: true` on the first write, or pre-creating the option. Using typecast is safest.
* **Worker timeout:** If waitUntil times out mid-rollback, we could end up with the original stuck in 'splitting'. But this is strictly better than the current behavior (permanent deletion). A future cron sweep could handle stale 'splitting' records.
* **Race condition:** If admin refreshes and sees 'splitting' card, they might try to act on it. The 'splitting' status should make the card non-actionable.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Split failures no longer lose the original classification — it reverts to 'pending' and is visible again in the admin panel.

### Logic Flow

**Backend (`classifications.ts` split action):**
1. Instead of `deleteRecords`, update original to `review_status: 'splitting'`
2. In background `waitUntil`:
   a. Track created segment record IDs in an array
   b. Process all segments (download, split, upload, classify, create records)
   c. **On success:** Update original to `review_status: 'split'` (hidden from list)
   d. **On failure:** Delete any partially-created segment records, revert original to `review_status: 'pending'`, add note about the failure

**Frontend (`script.js`):**
1. Filter out 'splitting' cards from display (or show with disabled state)
2. Toast already works — no change needed

**Airtable schema:**
1. Add 'splitting' and 'split' to `review_status` allowed values (via typecast on first write)
2. Update schema docs

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/classifications.ts` | Modify | Replace delete-then-process with status-transition pattern |
| `docs/airtable-schema.md` | Modify | Add 'splitting' and 'split' to review_status values |

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status.md, commit & push

## 7. Validation Plan
* [ ] Split a multi-page PDF — verify original shows 'splitting' status (not deleted)
* [ ] Verify new segments appear as 'pending' after successful split
* [ ] Verify original changes to 'split' after successful split
* [ ] Simulate failure (e.g., invalid page numbers) — verify original reverts to 'pending'
* [ ] Verify 'splitting' records are hidden from the pending classifications list
* [ ] Verify no regression in approve/reject/reassign actions

## 8. Implementation Notes (Post-Code)
* Replaced `deleteRecords` at line 511 with `updateRecord` to set `review_status: 'splitting'`
* Added `createdIds` array to track segment records created during background processing
* On success: update original to `review_status: 'split'`
* On failure: delete partial segments via `deleteRecords(createdIds)`, revert original to `review_status: 'pending'` with failure note
* Updated `get-pending-classifications` filter to also exclude `'splitting'` status
* Updated `docs/airtable-schema.md` with new status values
* Research principle applied: Status transition pattern (Martin Fowler temporal patterns) — status column as crash-recovery mechanism
