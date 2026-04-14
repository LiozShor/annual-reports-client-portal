# Design Log 267: Auto-Advance to Review When Zero Docs Remaining
**Status:** [IMPLEMENTED — VERIFIED] (n8n bug fixed 2026-04-14, backfill applied, manual test passed 2026-04-14)
**Date:** 2026-04-14
**Related Logs:** DL-158 (zero-docs approve-and-send, DRAFT — superseded), DL-054 (inline stage advancement), DL-161 (stage pipeline migration)

## 1. Context & Problem

When a client has 0 documents remaining (either because the questionnaire generated no required docs, or because the office waived/received all docs), the report stays stuck in `Pending_Approval` or `Collecting_Docs`. The office must manually click "approve-and-send" to advance the stage — which is unnecessary when there are no documents to send.

**Goal:** Automatically advance reports to `Review` (מוכן להכנה, stage 5) whenever `docs_missing_count` reaches 0, regardless of how it got there. No manual office action required.

## 2. User Requirements

1. **Q:** When should auto-advance trigger?
   **A:** Both `Pending_Approval` and `Collecting_Docs` — whenever docs_missing reaches 0.

2. **Q:** Should the office receive a notification?
   **A:** Silent — they see the stage change on the dashboard.

3. **Q:** Real-time hook or periodic scan?
   **A:** Real-time hook — check immediately after every status change.

4. **Q:** Backfill scope?
   **A:** `Pending_Approval` + `Collecting_Docs` only — don't touch other stages.

## 3. Research

### Domain
State Machine Design — automatic transitions with guard conditions.

### Sources Consulted
1. **UML State Machine (Wikipedia)** — Guard conditions are Boolean expressions evaluated dynamically. If TRUE, transition fires; if FALSE, transition is skipped. Guards must be pure and fast (no I/O).
2. **State Machine Design Pattern (LinkedIn/Rahimi)** — Centralize transition logic in a single function to avoid duplication across triggers. Each trigger point calls the same guard+transition helper.
3. **Airtable Rollup Patterns (Community)** — Rollup fields (`docs_missing_count`) update asynchronously after linked record changes. Re-fetch the report record after status changes to get the updated rollup value.

### Key Principles Extracted
- **Pure guard:** `docs_missing_count === 0 && stage in [Pending_Approval, Collecting_Docs]` — no side effects in the check itself.
- **Centralized transition:** One helper function, called from all trigger points. Avoids the current duplication (classifications.ts vs edit-documents.ts use different strategies).
- **Idempotent:** If already at Review or beyond, do nothing. Safe to call multiple times.

### Patterns to Use
- **Guard + Action helper:** `checkAutoAdvanceToReview(airtable, reportId)` — fetches report, checks guard, advances if needed.
- **Fire-and-forget with waitUntil:** Non-blocking auto-advance after the main response is sent.

### Anti-Patterns to Avoid
- **Duplicated inline logic:** Current state — classifications.ts uses `docs_missing_count`, edit-documents.ts uses `completion_percent`. Should unify.
- **Checking during page load:** Don't add auto-advance logic to dashboard or document-manager GET endpoints — creates race conditions and slows page loads.

### Research Verdict
Create a shared `checkAutoAdvanceToReview()` helper in `api/src/lib/auto-advance.ts`. Call it from all document-status-change code paths. This replaces the existing inline auto-advance blocks in classifications.ts and edit-documents.ts with a single, consistent implementation.

## 4. Codebase Analysis

### Existing Auto-Advance (Duplicated)
| File | Lines | Strategy | Stage Check |
|------|-------|----------|-------------|
| `api/src/routes/classifications.ts` | 1322-1338 | `docs_missing_count === 0` | `Collecting_Docs` only |
| `api/src/routes/edit-documents.ts` | 353-378 | `completion_percent >= 100` | NOT in `[Review, Moshe_Review, Before_Signing, Completed]` |

**Problem:** Two different strategies, neither handles `Pending_Approval`.

### Stage Transition Points (approve-and-send)
| File | Lines | Behavior |
|------|-------|----------|
| `api/src/routes/approve-and-send.ts` | 213-221 | Always → `Collecting_Docs` (even for 0 docs) |
| `api/src/lib/email-queue.ts` | 42-50 | Always → `Collecting_Docs` (queued path) |

### Document Status Change Points (triggers for doc count reaching 0)
| Operation | File | Lines |
|-----------|------|-------|
| Approve classification | `classifications.ts` | 874-890 |
| Approve (keep_both) | `classifications.ts` | 815-865 |
| Reassign | `classifications.ts` | 1156-1177 |
| Batch waive | `edit-documents.ts` | 330-344 |
| Restore to missing | `edit-documents.ts` | 214-218 |
| Doc generation (n8n) | `[02] Response Processing` → `[SUB] Document Service` | n8n workflow |

### Reuse Decision
- **Extend:** Existing auto-advance logic in classifications.ts and edit-documents.ts → replace with shared helper
- **Extend:** approve-and-send.ts stage transition → check 0-docs case, go to Review instead of Collecting_Docs
- **New:** `api/src/lib/auto-advance.ts` — shared helper
- **New:** Backfill endpoint (temporary)

## 5. Technical Constraints & Risks

* **Airtable rollup lag:** `docs_missing_count` is a rollup field. After updating a document's status, the rollup may take a moment to reflect. The re-fetch in the helper mitigates this (fetches after the update is committed).
* **Race condition:** Multiple concurrent status changes could trigger the helper simultaneously. The helper is idempotent (checks stage before advancing), so worst case is a redundant Airtable update.
* **n8n trigger for questionnaire with 0 docs:** Doc generation happens in n8n. After doc service runs, if `document_count === 0`, n8n should call a Worker endpoint to trigger auto-advance. This requires a small n8n workflow change.
* **No breaking changes:** The approve-and-send flow still works — it just advances to Review instead of Collecting_Docs when there are 0 docs.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Reports with `docs_missing_count === 0` in stages `Pending_Approval` or `Collecting_Docs` automatically advance to `Review` without manual office action.

### Logic Flow

#### A. Shared Helper (`api/src/lib/auto-advance.ts`)
```typescript
export async function checkAutoAdvanceToReview(
  airtable: AirtableClient, reportId: string
): Promise<boolean> {
  const report = await airtable.getRecord(REPORTS_TABLE, reportId);
  const fields = report.fields as Record<string, unknown>;
  const stage = fields.stage as string;
  const docsMissing = (fields.docs_missing_count as number) || 0;

  const ELIGIBLE = ['Pending_Approval', 'Collecting_Docs'];
  if (docsMissing === 0 && ELIGIBLE.includes(stage)) {
    await airtable.updateRecord(REPORTS_TABLE, reportId, {
      stage: 'Review',
      docs_completed_at: fields.docs_completed_at || new Date().toISOString(),
      // Clear reminder fields (Review is not a reminder stage)
      reminder_next_date: null,
      reminder_count: null,
      reminder_suppress: null,
      last_reminder_sent_at: null,
    });
    return true;
  }
  return false;
}
```

#### B. Integration Points
1. **classifications.ts (lines 1322-1338):** Replace inline auto-advance with `checkAutoAdvanceToReview()` call.
2. **edit-documents.ts (lines 353-378):** Replace inline auto-advance with `checkAutoAdvanceToReview()` call inside `waitUntil`.
3. **approve-and-send.ts (lines 213-221):** After sending email, check if 0 docs → advance to `Review` instead of `Collecting_Docs`.
4. **email-queue.ts (lines 42-50):** Same as approve-and-send — check 0 docs after queued email send.

#### C. approve-and-send.ts Modification
After the email is sent (line 208), check document count:
- If `documents.length === 0`: advance to `Review` (via helper), set `docs_first_sent_at`
- If `documents.length > 0`: advance to `Collecting_Docs` (existing behavior)

Same logic for the queued email path in `email-queue.ts` — store `docsCount` in the queue payload so the processor knows whether to go to Review or Collecting_Docs.

#### D. n8n Workflow Change
In `[02] Response Processing` (QqEIWQlRs1oZzEtNxFUcQ), after the Document Service sub-workflow returns:
- Check `document_count` from the response
- If `document_count === 0`: call Worker API `POST /webhook/auto-advance-check` with the report_id
- The Worker endpoint calls `checkAutoAdvanceToReview()`

#### E. Backfill Endpoint
Temporary `POST /webhook/backfill-zero-docs` endpoint:
1. Query Airtable for all reports in `Pending_Approval` or `Collecting_Docs` with `docs_missing_count = 0`
2. For each: call `checkAutoAdvanceToReview()`
3. Return count of advanced reports
4. Remove endpoint after running

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/auto-advance.ts` | Create | Shared `checkAutoAdvanceToReview()` helper |
| `api/src/routes/classifications.ts` | Modify | Replace inline auto-advance (lines 1322-1338) with helper call |
| `api/src/routes/edit-documents.ts` | Modify | Replace inline auto-advance (lines 353-378) with helper call |
| `api/src/routes/approve-and-send.ts` | Modify | Use Review for 0-doc case (lines 213-221) |
| `api/src/lib/email-queue.ts` | Modify | Use Review for 0-doc case (lines 42-50), add docsCount to payload |
| `api/src/routes/backfill.ts` | Create | Temporary backfill endpoint |
| `api/src/index.ts` | Modify | Register backfill route |
| n8n `[02] Response Processing` | Modify | Add auto-advance call after 0-doc generation |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items to `current-status.md`

## 7. Validation Plan
* [x] Approve-and-send with 0 docs → report advances to Review (not Collecting_Docs)
* [x] Approve classification that completes all docs → report advances to Review (from Collecting_Docs)
* [x] Approve classification that completes all docs → report advances to Review (from Pending_Approval — edge case where office approves docs before approve-and-send)
* [x] Batch waive all remaining docs → report advances to Review (tested 2026-04-14: CPA-XXX, 2 docs waived → auto-advanced to Review)
* [x] Edit-documents that results in 0 missing → report advances to Review
* [x] Reports already at Review or beyond are NOT affected
* [x] Backfill: run endpoint → verify all eligible reports advanced
* [x] Dashboard shows correct stage counts after auto-advance
* [x] Off-hours queued email with 0 docs → advances to Review on morning send
* [x] No duplicate stage transitions (idempotent)

## 8. Implementation Notes (Post-Code)

### Bug Fix: n8n Dead Branch on 0 Docs (2026-04-14)

**Reported by:** Client Name (2025) — questionnaire submitted, 0 docs generated, stuck at stage 2 (`Waiting_For_Answers`).

**Root Cause:** When Document Service returns 0 documents:
1. "Prepare for Airtable" Code node outputs empty array (0 items)
2. "Upsert Documents" Airtable node receives nothing → produces no output
3. "Wait for Both" Merge node (`chooseBranch` mode) stalls — input 0 never arrives
4. "Update Report Stage" never executes → stage stays at `Waiting_For_Answers`

Additionally, DL-267 section D (n8n auto-advance call after 0-doc generation) was never implemented — but even if it had been, the Merge stall would have prevented the stage update.

**Fixes Applied:**
1. **`alwaysOutputData: true`** on "Upsert Documents" node (`8363cfde`) — Merge now fires even with 0 docs
2. **Dynamic stage expression** in "Update Report Stage" node (`13bd8ea8`) — if `document_count === 0`, sets stage to `Review` (not `Pending_Approval`), clears reminder fields, sets `docs_completed_at`. This replaces the need for a separate Worker auto-advance call (section D of original plan).
3. **Backfill:** Client Name 2025 (`reczZAsgEJDI8rrPi`) updated from `Waiting_For_Answers` → `Review`

**Pattern applied:** n8n Airtable Search + empty branch pattern (memory: `alwaysOutputData: true` on upstream node).
