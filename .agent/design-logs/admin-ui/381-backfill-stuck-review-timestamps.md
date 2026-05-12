# Design Log 381: Backfill `docs_completed_at` on 2 stuck Stage-5 reports
**Status:** [COMPLETED — 2026-05-12]
**Date:** 2026-04-29
**Branch:** `claude-session-20260429-184332`
**Related Logs:** DL-364 (Review tab count mismatch fix — introduced the invariant, deferred this backfill as Open Question 2), DL-290 (cross-surface stat alignment patterns)

## 1. Context & Problem

On the admin panel, two surfaces count "מוכנים להכנה" (Stage-5 / Review) clients and disagree:
- **Stat card `stat-stage5`**: **51** — frontend counts every record where `stage === 'Review'`, no further filter (`script.js:2028`).
- **Tab badge `reviewCountBadge`**: **49** — backend `review_queue` (`dashboard.ts:128–137`) filters `stage === 'Review' AND docs_completed_at IS SET AND is_active !== false`, then sorts FIFO.

Gap of 2 = two Stage-5 reports with `docs_completed_at = null`. These are pre-DL-364 records: DL-364 added backfill logic on future transitions to Review but explicitly deferred fixing existing stuck records (DL-364 §8 Open Question 2). The user confirmed 51 is the truth; the tab badge must match.

**Audit of all Stage='Review' write paths** (Phase 1 Explore):
| Path | File:Line | docs_completed_at Handling |
|------|-----------|---------------------------|
| `/admin-change-stage` | `api/src/routes/stage.ts:63–65` | Covered (DL-364) |
| Auto-advance (0-doc) | `api/src/lib/auto-advance.ts:28–29` | Covered (idempotent `\|\| now()`) |
| `/approve-and-send` (0-doc batch) | `api/src/routes/approve-and-send.ts:230, 244` | Covered |
| `/admin-mark-complete` (legacy) | `api/src/routes/stage.ts:90` | Dead code (sets `Completed`, zero call sites since DL-364) |

No active leak. Fix is a one-shot data correction.

## 2. User Requirements (Q&A)

1. **Q:** Which counter is wrong?
   **A:** Tab badge (49) is wrong. Stat card (51) is the truth.
2. **Q:** Fix approach — change badge math or backfill the 2 records?
   **A:** Backfill the 2 stuck records. Do not change the math.
3. **Q:** FIFO queue ordering — how should stuck records appear after backfill?
   **A:** Leave unchanged (use `last_modified_at` so they surface in a natural position).
4. **Q:** Should we also audit all Stage='Review' write paths?
   **A:** Yes — done, no active leaks found (see §1 table).

## 3. Research

**Domain:** State-machine invariant enforcement + one-shot data correction.

**Verdict (cumulative knowledge — no new external research needed):**
- DL-364 established the core principle: "when state X requires invariant I, every transition INTO X must establish I." That was applied prospectively.
- DL-290 established the cross-surface SSOT principle for admin stat counts.
- One-shot data corrections for pre-existing stuck records are standard practice; they should: (a) have a dry-run mode, (b) use the closest-to-accurate timestamp (not `now()`), (c) leave an audit trail via console output, (d) be deleted after use.
- `last_modified_at` (Airtable `LAST_MODIFIED_TIME`) is the best proxy for "when the client entered Review" — better than `now()` which would incorrectly place old records at the bottom of the FIFO queue.

## 4. Codebase Analysis

**Relevant Files:**
| File | Role |
|------|------|
| `api/src/routes/stage.ts:63–65` | DL-364 backfill (forward-only; existing nulls not touched) |
| `api/src/routes/stage.ts:81–93` | Dead `/admin-mark-complete` handler — zero call sites |
| `api/src/routes/dashboard.ts:128–137` | `review_queue` filter — requires `docs_completed_at` |
| `frontend/admin/js/script.js:851` | `reviewCountBadge` ← `data.review_queue.length` |
| `frontend/admin/js/script.js:2028` | `stat-stage5` ← stage-5 count, no `docs_completed_at` filter |
| `frontend/shared/endpoints.js:35` | `ADMIN_MARK_COMPLETE` entry — dead after DL-364 |

**Airtable field:** `docs_completed_at` (ISO 8601 string), table `tbls7m3hmHC4hhQVy` (Reports).

**Existing patterns:** pyairtable/REST PATCH for one-off corrections. Here using Node fetch against Airtable REST API (same `.env` token, no extra dep).

## 5. Technical Constraints & Risks

- **PII:** Script output will show client names — run only locally, do not commit output.
- **Timestamp accuracy:** `last_modified_at` reflects the last write to any field, not necessarily when stage was set to Review. For these 2 old records this is the best available proxy; acceptable.
- **FIFO impact:** Backfilling with `last_modified_at` (a past date) places these clients earlier in the queue than newer records — correct, since they are genuinely older.
- **Rollback:** Clearing `docs_completed_at` back to null on the 2 records restores prior state trivially. No other side effects.
- **Dead code removal risk:** Zero — `/admin-mark-complete` has no call sites. Deletion is safe.

## 6. Proposed Solution

### Success Criteria
After running the backfill script and hard-reloading the admin panel, `reviewCountBadge` and `stat-stage5` both show **51** (or whatever the live count is at that moment, but both equal).

### Logic Flow

1. Create `tmp/dl381-backfill-stuck-review.mjs`.
2. Script loads `.env` from the canonical clone path, queries Airtable for `stage='Review' AND docs_completed_at=BLANK()`, prints dry-run output.
3. With `--apply`: PATCH each record with `docs_completed_at = LAST_MODIFIED_TIME` (from the record), fallback `now()`.
4. User confirms dry-run output, runs with `--apply`.
5. Hard-reload admin panel → verify both counters agree.
6. Optional: remove dead `/admin-mark-complete` from `stage.ts` and `endpoints.js`.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `tmp/dl381-backfill-stuck-review.mjs` | Create | One-shot backfill script (deleted after run) |
| `api/src/routes/stage.ts:81–93` | Delete | Remove dead `/admin-mark-complete` handler |
| `frontend/shared/endpoints.js:35` | Delete | Remove `ADMIN_MARK_COMPLETE` entry |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-381 row |
| `.agent/current-status.md` | Modify | Add Section 7 test items |

## 7. Validation Plan

- [ ] Dry-run script: confirms exactly 2 records matched, prints names + `last_modified_at`.
- [ ] Apply script: exits 0, prints success for both records.
- [ ] Hard-reload admin panel → `reviewCountBadge` == `stat-stage5` (both 51).
- [ ] Open "מוכנים להכנה" tab → both backfilled clients appear in FIFO queue.
- [ ] Airtable: open one backfilled record, verify `docs_completed_at` set to historical timestamp (not today).
- [ ] Regression: other stat cards (stage 1–4, 6–8) unchanged.

## 8. Implementation Notes

- The user-reported stuck clients (CPA-XXX, CPA-XXX) already had `docs_completed_at` set — they were fixed by a recent admin action via DL-364's prospective backfill. The actual stuck records were two clients created 2026-03-25 with NULL `docs_completed_at` (IDs withheld per PII policy).
- Backfilled using `createdTime` (2026-03-25) so they appear at the top of the FIFO queue — correct, since they entered Review before all newer clients.
- Verified 0 stuck records remain after patch.
- Generic backfill script (`tmp/dl381-backfill-stuck-review.mjs`) created for reference but the direct Node one-liner was used instead. Script can be deleted after commit.
- Dead code cleanup (`/admin-mark-complete`) deferred to follow-up — no active bug, low urgency.
