# Design Log 067: Initialize `reminder_next_date` on Stage Entry
**Status:** [DRAFT]
**Date:** 2026-02-26
**Related Logs:** DL-059 (reminder system), DL-066 (counter reset on transition), DL-055 (admin change stage)

## 1. Context & Problem
The reminder scheduler (WF[06]) finds due clients with:
```
{reminder_next_date} <= TODAY()
```
When `reminder_next_date` is NULL, Airtable's `<=TODAY()` returns FALSE — the record is invisible to the scheduler.

**Problem:** No workflow sets an initial `reminder_next_date` when clients enter stages 2 or 3. The scheduler only updates this field *after* sending a reminder, creating a chicken-and-egg problem: clients never get their first reminder because the scheduler can't find them.

**Affected transitions:**
- WF[01] Send Questionnaire: 1→2 (client now needs questionnaire reminders)
- WF[02] Response Processing: 2→3 (client now needs document reminders)
- WF[API] Admin Change Stage: manual moves into stage 2 or 3

## 2. User Requirements
1. **Q:** What should `reminder_next_date` be set to on stage entry?
   **A:** 1st of the month, two months from now. E.g., approved Feb 26 → April 1. Gives the client one full calendar month to act before the first reminder.

2. **Q:** Should DL-066 (counter reset) be merged into this?
   **A:** No, keep separate. DL-066 handles reset to null; this DL handles initialization to a real date.

3. **Q:** How to handle existing stage 2/3 records with null dates?
   **A:** Manual seed in Airtable — no code needed.

4. **Q:** Should Admin Change Stage also set the date?
   **A:** Yes, same logic as automatic transitions.

## 3. Research
### Domain
CRM Reminder Scheduling, State Machine Entry Actions, Calendar-Aligned Scheduling

### Sources Consulted
1. **UML State Machine Entry Actions (Stately.ai / Wikipedia)** — Entry actions initialize state-specific fields at the moment of state entry. Setting `reminder_next_date` on stage entry is textbook entry-action behavior.
2. **HubSpot Lifecycle Stages** — Tracks `Date entered [stage]` timestamp per stage. Workflows trigger follow-ups off this timestamp. Stage-scoped metadata is the norm.
3. **Chargebee/Zoho Calendar Billing** — Calendar-aligned dates (1st, 15th) beat rolling offsets for batch processing. Predictable, simple reporting, clients know what to expect.
4. **"Release It!" — Michael Nygard** — "Fail fast" on missing data. Silent null-skips are silent failures. Prevent nulls at the source rather than patching downstream.
5. **Salesforce Record-Triggered Flows** — Scheduled actions fire X days after stage entry. Idempotency guard: "execute only when specified changes are made."

### Key Principles Extracted
- **Entry action pattern:** Initialize `reminder_next_date` in the same Airtable PATCH that sets the stage. Atomic — no partial state.
- **Calendar alignment > rolling offset:** Aligning to 1st-of-month makes batch scheduling predictable. Already consistent with WF[06]'s fallback logic.
- **Prevent nulls at source:** Rather than making the scheduler tolerate nulls, ensure nulls can't exist in reminder-eligible stages.
- **Natural idempotency:** Setting a date field to a computed value is harmless if repeated.

### Anti-Patterns to Avoid
- **Silent null-skip:** Current behavior — scheduler silently ignores null records. Clients fall through the cracks.
- **Immediate reminder:** Setting `reminder_next_date = TODAY()` on entry. Poor UX — client just entered the stage.
- **Rolling offset:** `entry_date + 30 days` scatters dates across the calendar.
- **Scheduler-based backfill:** Making the scheduler detect and initialize nulls adds complexity and race conditions.

### Research Verdict
Set `reminder_next_date` as an entry action — in the same Airtable update that sets the stage. Use calendar-aligned date (1st of month+2). Simple, idempotent, prevents nulls at source.

## 4. Codebase Analysis
* **WF[01] Send Questionnaire** (`YfuRYpWdGGFpGYJG`): Sends questionnaire email, moves client 1→2. Has an Airtable Update node for stage. Need to add `reminder_next_date` field.
* **WF[02] Response Processing** (`QqEIWQlRs1oZzEtNxFUcQ`): Processes Tally submission, moves client 2→3. "Update Report Stage" node currently sets: `stage`, `source_language`, `last_progress_check_at`. Need to add `reminder_next_date`.
* **WF[API] Admin Change Stage** (`3fjQJAwX1ZGj93vL`): Manual stage changes via admin panel. Currently sets `stage` + clears `docs_completed_at` on 4→3. Need to add `reminder_next_date` when target is stage 2 or 3.
* **WF[06] Scheduler** (`FjisCdmWc4ef0qSV`): Already computes next date using same fallback logic (`1st of month+2`) in "Set Update Fields". Our initialization is consistent with the scheduler's own computation.
* **Existing date computation in WF[06]:**
  ```javascript
  // Fallback: 1st of month, 2 months from now
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  nextDate = nextMonth.toISOString().split('T')[0];
  ```

## 5. Technical Constraints & Risks
* **Security:** None — only touching internal Airtable fields
* **Risks:** Low — adding a field to existing Airtable Update nodes is additive
* **Breaking Changes:** None — scheduler already handles records with `reminder_next_date` set
* **Edge case — DL-066 interaction:** DL-066 resets `reminder_next_date` to null on category transitions (2↔3). If both DLs are implemented, DL-066 clears the date and this DL sets a new one — but they run in the same Airtable PATCH, so the final value should be the new date, not null. **Resolution:** When implementing DL-066's reset alongside this DL's initialization, the initialization takes precedence — set `reminder_next_date` to the computed date (not null) when entering stage 2 or 3.
* **Edge case — stage ≥4:** When moving to stage 4 or 5, do NOT set `reminder_next_date`. Only stages 2 and 3 are reminder-eligible.

## 6. Proposed Solution (The Blueprint)

### Date Computation (shared across all locations)
```javascript
// 1st of the month, 2 months from now
// Feb 26 → April 1, March 15 → May 1, Dec 10 → Feb 1 (next year)
const now = new Date();
const reminderDate = new Date(now.getFullYear(), now.getMonth() + 2, 1);
const reminder_next_date = reminderDate.toISOString().split('T')[0];
```

### Change 1: WF[02] Response Processing
**Workflow:** `QqEIWQlRs1oZzEtNxFUcQ`
**Node:** "Update Report Stage" (Airtable Update)
**Action:** Add `reminder_next_date` to the fields being updated.

Since this is an Airtable Update node (not a Code node), two options:
- **Option A:** Use n8n expression: `={{ new Date(new Date().getFullYear(), new Date().getMonth() + 2, 1).toISOString().split('T')[0] }}`
- **Option B:** Add a Set node or Code node before the update to compute the date.

**Recommendation:** Option A (expression) — simplest, no new nodes needed. The expression is evaluated at runtime.

### Change 2: WF[01] Send Questionnaire
**Workflow:** `YfuRYpWdGGFpGYJG`
**Node:** The Airtable Update node that sets `stage = '2-Waiting_For_Answers'`
**Action:** Same as Change 1 — add `reminder_next_date` expression to the update fields.

### Change 3: WF[API] Admin Change Stage
**Workflow:** `3fjQJAwX1ZGj93vL`
**Action:** When the target stage is `2-Waiting_For_Answers` or `3-Collecting_Docs`, include `reminder_next_date` in the Airtable update.

This workflow likely has a Code node that builds the update payload. Add conditional logic:
```javascript
const targetStage = $json.target_stage; // from webhook body
const isReminderStage = ['2-Waiting_For_Answers', '3-Collecting_Docs'].includes(targetStage);

const fields = { stage: targetStage };
if (isReminderStage) {
  const now = new Date();
  const rd = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  fields.reminder_next_date = rd.toISOString().split('T')[0];
}
// ... existing logic (clear docs_completed_at on 4→3, etc.)
```

If moving to stage ≥4: do NOT set `reminder_next_date` (leave as-is or clear it per DL-066).

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n WF[01] `YfuRYpWdGGFpGYJG` | Modify | Add `reminder_next_date` expression to stage update node |
| n8n WF[02] `QqEIWQlRs1oZzEtNxFUcQ` | Modify | Add `reminder_next_date` expression to "Update Report Stage" node |
| n8n WF[API] `3fjQJAwX1ZGj93vL` | Modify | Add conditional `reminder_next_date` when target is stage 2 or 3 |

### No frontend changes needed
The admin panel already reads and displays `reminder_next_date` from Airtable. Once the field is populated, it will show up automatically.

## 7. Validation Plan
* [ ] **WF[01]:** Send a test questionnaire → verify `reminder_next_date` is set to 1st of month+2 in Airtable
* [ ] **WF[02]:** Submit a test Tally response → verify `reminder_next_date` updates to new 1st of month+2
* [ ] **Admin Change Stage:** Move a client to stage 3 → verify `reminder_next_date` is set
* [ ] **Admin Change Stage:** Move a client to stage 4 → verify `reminder_next_date` is NOT set (or cleared)
* [ ] **Scheduler pickup:** After setting the date, verify WF[06] Search Due Reminders finds the record when date <= TODAY
* [ ] **No regression:** Existing reminders with already-set dates still work normally
* [ ] **Interaction with DL-066:** If counter reset is also implemented, verify the date is set (not null) after a 2→3 transition

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation*
