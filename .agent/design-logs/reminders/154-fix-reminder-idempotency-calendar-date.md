# Design Log 154: Fix Reminder Idempotency — Calendar Date Check

**Status:** [DRAFT]
**Date:** 2026-03-16
**Related Logs:** 059-automated-follow-up-reminder-system.md, 109-reminder-system-enhancements.md

## 1. Context & Problem

WF[06] Reminder Scheduler (`FjisCdmWc4ef0qSV`) ran today at 06:00 UTC and found 3 eligible records with `reminder_next_date = 2026-03-16`. However, the **Filter Eligible** Code node filtered out all 3 due to its idempotency check:

```js
if (now - lastSent < DAY_MS) return false; // DAY_MS = 24h
```

These 3 clients received their previous reminder yesterday (March 15) at ~06:18-06:31 UTC. The scheduler ran today at 06:00 UTC — only ~23.5 hours later — so the 24h window hadn't elapsed.

**Impact:** 3 clients (נועה פרידמן, אלון ברקוביץ, תמר רוזנברג) missed their Type A reminders today. All are stage 2 (Waiting for Answers).

## 2. User Requirements

1. **Q:** How should the idempotency check work?
   **A:** Calendar date comparison (Israel timezone). If `last_reminder_sent_at` is the same calendar day as today → skip. Different day → eligible.

2. **Q:** Re-send today's missed reminders?
   **A:** No. Wait for tomorrow's scheduled run.

## 3. Research

### Domain
Idempotency in scheduled batch jobs.

### Sources Consulted
1. **DL-059** — Original reminder system design. Specified "skip if `last_reminder_sent_at` < 24h ago" as the idempotency rule.
2. **DL-109** — Phase 5 reminder enhancements. Added 15th cutoff timing, didn't change idempotency logic.
3. **General scheduled job patterns** — Calendar-date comparison is the standard for daily jobs where execution time varies. Timestamp windows are appropriate for rate-limiting, not daily dedup.

### Research Verdict
Replace timestamp-window dedup with calendar-date comparison using `Asia/Jerusalem` timezone (matches the Schedule Trigger's configured timezone).

## 4. Codebase Analysis

* **Single file to change:** Filter Eligible Code node in WF[06] (`FjisCdmWc4ef0qSV`, nodeId: `filter_eligible`)
* **Current logic (lines causing the bug):**
  ```js
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  // ...
  if (!forceSend && r.last_reminder_sent_at) {
      const lastSent = new Date(r.last_reminder_sent_at).getTime();
      if (now - lastSent < DAY_MS) return false;
  }
  ```
* **Rest of the node logic is correct** — config reading, max check, tone escalation, type assignment all work fine.

## 5. Technical Constraints & Risks

* **Timezone:** Must use `Asia/Jerusalem` to match the scheduler's configured timezone. `toLocaleDateString('en-CA', {timeZone:'Asia/Jerusalem'})` returns `YYYY-MM-DD` format.
* **Risk:** Minimal — only changes the comparison method, not the overall flow. `forceSend` bypass for admin Send Now remains unchanged.
* **Breaking Changes:** None.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

**Remove** the idempotency guard entirely for scheduled (automatic) runs. The `reminder_next_date` field already controls eligibility — the Airtable search formula returns only records where `reminder_next_date <= TODAY()`. No additional timestamp guard is needed.

**Keep** same-day dedup only for manual Send Now (forceSend from admin panel):

```js
// Only guard against same-day duplicates for manual admin triggers
if (forceSend && r.last_reminder_sent_at) {
    const TZ = 'Asia/Jerusalem';
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
    const lastDay = new Date(r.last_reminder_sent_at)
        .toLocaleDateString('en-CA', { timeZone: TZ });
    if (lastDay === todayStr) return false;
}
```

### n8n Operations (1 op)

| # | Type | Node | Change |
|---|------|------|--------|
| 1 | updateNode | Filter Eligible (`filter_eligible`) | Replace 24h timestamp window with calendar date comparison |

### Full Updated Code

The complete `jsCode` for the Filter Eligible node — only the idempotency section changes:

1. Remove `const now = Date.now();` and `const DAY_MS = ...;`
2. Remove the `!forceSend && r.last_reminder_sent_at` idempotency block (automatic runs don't need it — `reminder_next_date` is the gate)
3. Add calendar-date dedup guard inside `forceSend` path only (prevents admin double-send on same day)

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy test items to `current-status.md`

## 7. Validation Plan

* [ ] Deploy updated Filter Eligible node to WF[06]
* [ ] Check tomorrow's 06:00 execution — the 3 clients with `reminder_next_date = 2026-03-16` should be picked up (unless their dates get advanced)
* [ ] Verify forceSend (admin Send Now) still bypasses the check
* [ ] Verify same-day duplicate prevention still works (run scheduler twice manually — second run should skip)

## 8. Implementation Notes (Post-Code)

*To be filled after implementation.*
