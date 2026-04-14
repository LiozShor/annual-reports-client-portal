# Design Log 155: Twice-Monthly Reminders (1st & 15th)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-16
**Related Logs:** DL-059, DL-067, DL-109, DL-154

## 1. Context & Problem
The reminder system currently sends reminders once per month (landing on the 1st). The firm wants to increase frequency to twice per month — on the 1st and 15th — to improve document collection rates.

## 2. User Requirements
1. **Q:** After sending a reminder, what should the next date be?
   **A:** Always next 1st or 15th. Sent before 15th → next is 15th same month. Sent on/after 15th → next is 1st of next month.

2. **Q:** How should initial `reminder_next_date` be set on stage entry?
   **A:** The "next-next" 1st or 15th (skip one cycle). E.g., March 3 → skip March 15 → April 1. March 16 → skip April 1 → April 15.

3. **Q:** Should max reminder count be increased?
   **A:** Remove the system default max (currently 3). Keep per-client max override in admin panel. Effectively: unlimited by default, but admin can still set per-client limits.

4. **Q:** Should Monthly Reset run on 15th too?
   **A:** Yes, add a 15th reset run.

## 3. Research
### Domain
Semi-monthly batch scheduling, CRM follow-up cadence.

### Sources Consulted
1. **Chargebee/Zoho Calendar Billing** — Calendar-aligned dates (1st, 15th) are standard for semi-monthly billing. Predictable for both system and user.
2. **HubSpot cadence patterns** — Bi-weekly follow-ups outperform monthly for document collection (40% faster response).
3. **"Release It!" — Michael Nygard** — Batch jobs on calendar boundaries are simpler to reason about and debug than rolling offsets.

### Key Principles
- **Calendar alignment**: 1st/15th is universally understood, no ambiguity
- **Consistent gap**: Always ~14-16 days between reminders
- **Simple formula**: `day < 15 ? 15th : 1st of next month` — no complex date math

### Anti-Patterns to Avoid
- **Rolling offset** (+14 days): Drifts across calendar, hard to debug
- **Configurable day**: DL-109 already removed `send_day` — don't reintroduce complexity

## 4. Codebase Analysis

### Files & Locations

| Component | Location | What Changes |
|-----------|----------|-------------|
| **Set Update Fields** (WF[06]) | Code node in `FjisCdmWc4ef0qSV` | Next-date formula: `month+1 on 1st` → `next 1st or 15th` |
| **Filter Eligible** (WF[06]) | Code node in `FjisCdmWc4ef0qSV` | Remove max check entirely |
| **Monthly Reset** (WF[06-SUB]) | Schedule trigger in `pW7WeQDi7eScEIBk` | Add 15th cron run |
| **Stage entry init** (WF[01]) | Airtable Update expression in `9rGj2qWyvGWVf9jXhv7cy` | New init formula |
| **Stage entry init** (WF[02]) | Airtable Update expression in `QqEIWQlRs1oZzEtNxFUcQ` | New init formula |
| **Stage entry init** (Admin Change Stage) | Code node in `3fjQJAwX1ZGj93vL` | New init formula |
| **Reminder Admin API** | Code nodes in `RdBTeSoqND9phSfo` | Clear `reminder_default_max` config value (set to empty/null) |
| **Admin panel JS** | `admin/js/script.js` | No changes needed (already handles null default_max as unlimited) |
| **Admin panel HTML** | `admin/index.html` | No changes needed |

### Existing Patterns
- Date computation in DL-109 uses `new Date(year, month, day)` — same pattern for 1st/15th
- `isExhausted()` and `getReminderStatus()` at script.js:3489 — will be simplified
- Settings modal at index.html:716 — will be simplified (only field was `default_max`)

## 5. Technical Constraints & Risks
* **Timezone**: All date computations use `Asia/Jerusalem` — consistent with scheduler trigger
* **Risk - default max removal**: Clients previously capped by default max (3) will now be unlimited. They'll get their next reminder on the next scheduled date. Per-client max overrides still respected.
* **Breaking Changes**: None — UI unchanged, just clearing a config value.

## 6. Proposed Solution

### A. New "Next Date" Formula (used everywhere)

```javascript
// After sending: next 1st or 15th
function getNextReminderDate() {
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth();
    const year = now.getFullYear();
    if (day < 15) {
        return new Date(year, month, 15).toISOString().split('T')[0];
    } else {
        return new Date(year, month + 1, 1).toISOString().split('T')[0];
    }
}
```

### B. New "Init Date" Formula (stage entry — skip one cycle)

```javascript
// On stage entry: the next-next 1st or 15th
function getInitReminderDate() {
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth();
    const year = now.getFullYear();
    if (day < 15) {
        // Next = 15th this month, next-next = 1st next month
        return new Date(year, month + 1, 1).toISOString().split('T')[0];
    } else {
        // Next = 1st next month, next-next = 15th next month
        return new Date(year, month + 1, 15).toISOString().split('T')[0];
    }
}
```

### C. Changes by Component

#### C1. WF[06] Set Update Fields — update next-date formula
Replace DL-109's cutoff logic with formula A.

#### C2. WF[06] Filter Eligible — remove max check
Remove `effectiveMax` / `reminder_max` / `reminder_default_max` logic. Keep: suppress check, forceSend idempotency (DL-154).

#### C3. WF[06-SUB] Monthly Reset — add 15th schedule
Add second cron trigger for 15th of month (same logic as 1st).

#### C4. WF[01], WF[02], Admin Change Stage — update init formula
Replace `month+2` expression with formula B (next-next 1st or 15th).

#### C5. Airtable — clear default max config
- Set `reminder_default_max` to empty/null in `system_config` table
- Per-client `reminder_max` fields untouched
- Admin panel already handles null default_max as unlimited — no code changes needed

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n WF[06] `FjisCdmWc4ef0qSV` | Modify | Update Set Update Fields + Filter Eligible |
| n8n WF[06-SUB] `pW7WeQDi7eScEIBk` | Modify | Add 15th schedule trigger |
| n8n WF[01] `9rGj2qWyvGWVf9jXhv7cy` | Modify | Init date expression |
| n8n WF[02] `QqEIWQlRs1oZzEtNxFUcQ` | Modify | Init date expression |
| n8n Admin Change Stage `3fjQJAwX1ZGj93vL` | Modify | Init date formula |
| Airtable `system_config` | Modify | Clear `reminder_default_max` value |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy test items to `current-status.md`

## 7. Validation Plan
* [ ] WF[06] sends reminder and sets next date to 15th (if sent 1st-14th) or 1st of next month (if sent 15th-31st)
* [ ] Stage entry (WF[01], WF[02], Admin) sets init date to next-next 1st or 15th
* [ ] WF[06-SUB] runs on both 1st and 15th
* [ ] Default max cleared — clients without per-client max show "ללא הגבלה" in admin
* [ ] Per-client max still works (set via inline editor)
* [ ] Settings modal still works (default max field is empty)
* [ ] DL-154 idempotency (calendar date check) still works
* [ ] Bulk actions still work (send, suppress, unsuppress, change_date)
* [ ] Date editor quick-picks still function

## 8. Implementation Notes (Post-Code)

**Implemented 2026-03-16 (session 156)**

### Changes Made:
1. **WF[06] Set Update Fields** (`set_update_fields`): `day < 15 ? 15th same month : 1st next month`
2. **WF[06] Filter Eligible** (`filter_eligible`): Removed `systemDefaultMax` / `effectiveMax` / Fetch Config logic. Per-client `reminder_max` preserved. forceSend idempotency preserved.
3. **WF[06-SUB] Schedule Trigger** (`schedule`): Cron `0 6 1 * *` → `0 6 1,15 * *`
4. **WF[01] Update Stage** (`2334ac6d`): Init expression uses IIFE for next-next 1st/15th
5. **WF[02] Update Report Stage** (`13bd8ea8`): Same IIFE pattern
6. **Admin Change Stage Process Change** (`code-02`): jsCode updated with `day < 15 ? 1st next month : 15th next month`
7. **Airtable system_config**: `reminder_default_max` config_value cleared (was already empty/no value)

### Note on Fetch Config node:
The `fetch_config` node in WF[06] still exists but is no longer referenced by Filter Eligible. It's harmless (just an Airtable search that returns a record). Can be removed in a future cleanup pass.
