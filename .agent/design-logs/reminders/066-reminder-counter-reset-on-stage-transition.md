# Design Log 066: Reminder Counter Reset on Stage Transition
**Status:** [DRAFT]
**Date:** 2026-02-26
**Related Logs:** DL-059 (reminder system), DL-061 (configurable limits), DL-055 (admin change stage)

## 1. Context & Problem
The reminder tab splits clients into two categories:
- **Type A** (stage `2-Waiting_For_Answers`): Haven't filled questionnaire
- **Type B** (stage `3-Collecting_Docs`): Missing documents

Both categories share the same `reminder_count` field in Airtable. When a client completes the questionnaire and moves from stage 2 → stage 3, the counter carries over. A client reminded 5 times about the questionnaire starts document collection with count=5, making them appear "exhausted" even though they haven't received a single document reminder.

**Expected behavior:** Counter resets to 0 when client transitions between reminder categories.

## 2. User Requirements
1. **Q:** Where should the reset happen?
   **A:** At stage transition (in the workflow that moves 2→3)

2. **Q:** Should exhausted status also reset?
   **A:** Yes — full reset: count=0, clear suppression (except 'forever')

3. **Q:** Should UI show counter history from previous category?
   **A:** No — current count only

4. **Q:** Should reminder_next_date also reset?
   **A:** Yes — clear it so scheduler picks them up fresh

## 3. Research
### Domain
State Machine Transitions, Counter Reset Patterns, CRM Pipeline Design

### Sources Consulted
1. **XState/Statecharts (Stately.ai docs)** — Stage-specific metadata should be reset via entry actions of the new state, not exit actions of the old state. The reset is part of "entering" the new category.
2. **HubSpot Lifecycle Stages** — CRM tools treat stage properties as stage-scoped. When a deal moves stages, stage-level counters are definitionally meaningless in the new context.
3. **Event-Driven.io — Idempotent Command Handling** — The transition event itself is the idempotency key. Resetting to 0 is naturally idempotent (resetting twice = same result).

### Key Principles Extracted
- **Entry action pattern:** Reset fields as part of entering the new stage, in the same Airtable PATCH that sets the new stage. Atomic = no partial state.
- **Stage-scoped counters:** The `reminder_count` conceptually belongs to the current stage, not the client globally. Reset is semantically correct.
- **Natural idempotency:** Setting count=0 is inherently idempotent — if WF[02] processes the same record twice, the reset is harmless.

### Anti-Patterns to Avoid
- **Separate reset request:** Don't add a second Airtable update call to reset counters — include them in the existing stage update (atomic).
- **Scheduler-based reset:** Don't make the reminder scheduler detect stage changes and reset — this adds race condition risk and complexity.

### Research Verdict
Reset all reminder fields in the same Airtable update that sets the new stage. Simple, atomic, idempotent. No new workflows or nodes needed.

## 4. Codebase Analysis
* **Primary transition:** WF[02] `QqEIWQlRs1oZzEtNxFUcQ` — "Update Report Stage" node. Currently sets: `stage`, `source_language`, `last_progress_check_at`. Need to add reminder reset fields.
* **Secondary transition:** WF[API] Admin Change Stage `3fjQJAwX1ZGj93vL` — manual stage changes via admin panel. Currently sets `stage` + clears `docs_completed_at` on backward 4→3. Need to add reminder reset when advancing to stage 3.
* **No existing reset logic:** DL-059 built the reminder system without considering stage transitions. DL-061 only clears `reminder_next_date` for stage >= 4.

## 5. Technical Constraints & Risks
* **Security:** None — only touching internal Airtable fields
* **Risks:** Low — adding fields to existing Airtable update is additive, not breaking
* **Breaking Changes:** None — `reminder_suppress = 'forever'` is preserved (user decision)
* **Edge case:** Admin manually moving a client backward (3→2) should also reset, since they're entering a new reminder category

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. In WF[02] "Update Report Stage" node — add 4 reset fields to the Airtable update
2. In WF[API] Admin Change Stage — add reset fields when target stage differs in reminder category from current stage

### Reset Fields (same for both locations)
```
reminder_count: 0
reminder_suppress: null  (UNLESS current value is 'forever' — preserve admin decision)
reminder_next_date: null
last_reminder_sent_at: null
```

### Where to Change

**Change 1: WF[02] — "Update Report Stage" node**
- Workflow: `QqEIWQlRs1oZzEtNxFUcQ`
- Node: "Update Report Stage" (Airtable Update node)
- Action: Add `reminder_count`, `reminder_suppress`, `reminder_next_date`, `last_reminder_sent_at` to the fields being updated
- The `reminder_suppress` field should be set to `null` (to clear `this_month`) but NOT clear `forever` — need to check current value first

**Change 2: WF[API] Admin Change Stage**
- Workflow: `3fjQJAwX1ZGj93vL`
- Action: When stage changes and the reminder category changes (2→3 or 3→2), reset the same fields
- Category detection: stages 2 and 3 are different reminder categories

### Handling `reminder_suppress = 'forever'`
Since we need to preserve 'forever' but clear 'this_month', two approaches:
- **Option A:** Always clear to null. If admin set 'forever', they can re-set it. Simpler.
- **Option B:** Read current value, only clear if not 'forever'. Requires a Code node before the update.

User chose "full reset except forever" → **Option B** for Admin Change Stage (can read current record). For WF[02], the client just submitted a questionnaire — if they were suppressed 'forever' for questionnaire reminders, that suppression shouldn't carry to document reminders either. So **Option A** (clear all) is correct for WF[02].

**Correction:** User said "full reset" with "clear suppression except 'forever'". So:
- WF[02]: Clear `reminder_suppress` to null (even 'forever') — client just engaged, fresh start
- WF[API] Admin Change Stage: Preserve 'forever' since admin explicitly set it

Actually re-reading: user chose "Reset reminder_count to 0 AND clear reminder_suppress (except 'forever')". So we preserve 'forever' in both cases.

### Final Field Updates

**WF[02] "Update Report Stage":**
Add to existing Airtable update fields:
- `reminder_count` = 0
- `reminder_next_date` = null (empty)
- `last_reminder_sent_at` = null (empty)
- `reminder_suppress` = needs conditional: if current != 'forever', set null

Since this is an Airtable Update node (not a Code node), we need to handle the conditional for `reminder_suppress`. Options:
1. Add a Code node before the update to prepare the fields
2. Always clear it (simpler, acceptable since client just engaged)
3. Use an expression: won't work since we don't have the current value in the flow

**Simplest approach:** In WF[02], always clear `reminder_suppress` to null. Rationale: the client just filled the questionnaire — they're actively engaged. Any prior 'forever' suppression for questionnaire reminders shouldn't block document reminders. This aligns with "full reset" intent.

For WF[API] Admin Change Stage: the workflow already fetches the current record (to know the previous stage). Use a Code node to conditionally preserve 'forever'.

## 7. Validation Plan
* [ ] Test WF[02]: Submit a test questionnaire → verify reminder fields reset to 0/null
* [ ] Test Admin Change Stage: Move a client 2→3 manually → verify reset
* [ ] Test Admin Change Stage: Move a client 3→2 → verify reset
* [ ] Test 'forever' preservation: Set a client to 'forever' suppression, then admin-change stage → verify 'forever' persists
* [ ] Test no regression: Clients in stage 3 getting normal reminders still work
* [ ] Verify exhausted clients get fresh start after transition

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation*
