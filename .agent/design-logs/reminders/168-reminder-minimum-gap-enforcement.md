# Design Log 168: Reminder Minimum Gap Enforcement (>10 Days)
**Status:** [COMPLETED]
**Date:** 2026-03-22
**Related Logs:** DL-155 (twice-monthly reminders), DL-109 (configurable reminders), DL-067 (init on stage entry)

## 1. Context & Problem
DL-155 introduced twice-monthly reminders (1st & 15th). The "after send" formula always picks the nearest 1st or 15th:
```javascript
day < 15 ? 15th same month : 1st next month
```
When a reminder is sent mid-cycle (e.g., March 22 via manual "Send Now"), the next date lands only 10 days later (April 1). User expects April 15 — a meaningful gap between reminders.

**Bonus finding:** The init formulas in WF[01], WF[02], and Admin Change Stage still use the OLD DL-109 formula (`day <= 15 ? month+1 : month+2`, always on the 1st), instead of DL-155's "next-next 1st or 15th".

## 2. User Requirements
1. **Q:** What minimum gap should be enforced between reminders?
   **A:** >10 days. If next 1st/15th is ≤10 days away, skip to the one after.

2. **Q:** Should this apply only to manual sends or also to automated batch?
   **A:** Both manual and automated — one formula everywhere.

## 3. Research
### Domain
Semi-monthly batch scheduling with minimum-gap enforcement. See DL-155 for prior research on calendar-aligned scheduling.

### Sources Consulted
1. **DL-155 Research (cumulative)** — Calendar-aligned 1st/15th is standard for semi-monthly cadence. Simple formula, universally understood.
2. **"Release It!" — Michael Nygard** — Batch jobs on calendar boundaries are simpler to reason about. Candidate-based date selection is more robust than day-of-month ranges.
3. **HubSpot cadence patterns** — Minimum spacing between touches prevents "reminder fatigue" when manual and automated sends overlap.

### Key Principles
- **Calendar alignment preserved**: Still 1st and 15th only — no rolling offsets
- **Minimum gap prevents fatigue**: >10 days ensures meaningful spacing even on manual sends
- **Calendar-day comparison**: Use midnight-normalized dates to avoid time-of-day sensitivity

### Anti-Patterns to Avoid
- **Day-of-month ranges** (`day <= 5 ? ... : day <= 21 ? ...`): Breaks on short months (Feb 21 → Mar 1 = 8 days). Candidate-based approach handles all month lengths.
- **Millisecond-based diff**: Sensitive to time-of-day when the batch runs. Calendar-day diff is more predictable.

## 4. Codebase Analysis

### Files & Locations

| Component | Location | Current Code | Problem |
|-----------|----------|-------------|---------|
| **WF[06] Set Update Fields** | `FjisCdmWc4ef0qSV` node `set_update_fields` | `day < 15 ? 15th : 1st next` | No minimum gap. March 22 → April 1 (10d) |
| **WF[01] Stage Entry** | `9rGj2qWyvGWVf9jXhv7cy` line 205 | `day <= 15 ? month+1 day 1 : month+2 day 1` | OLD DL-109 formula, never picks 15th |
| **WF[02] Stage Entry** | `QqEIWQlRs1oZzEtNxFUcQ` line 312 | Same as WF[01] | OLD DL-109 formula, never picks 15th |
| **Admin Change Stage** | `3fjQJAwX1ZGj93vL` node `code-02` | Same logic in jsCode | OLD DL-109 formula, never picks 15th |

### Existing Patterns
- DL-155 already uses `new Date(year, month, day)` for date construction — JS auto-rolls month/year boundaries
- WF[06-SUB] cron `0 6 1,15 * *` is correct (no change needed)
- Admin date editor uses custom picker — no formula, no change needed
- API Reminder Admin (`send_now`, `change_date`) accepts user-provided dates — no formula

## 5. Technical Constraints & Risks
* **Timezone**: All date computations must use `Asia/Jerusalem` — consistent with scheduler trigger
* **Risk — day 5 edge**: March 5 → March 15 is exactly 10 days. With strict `> 10`, this skips to April 1 (27 days). Acceptable for manual sends; automated batch always runs on 1st/15th where gaps are 14-17 days.
* **Breaking Changes**: None — same fields, same data type, just smarter date selection.

## 6. Proposed Solution

### A. New "After Send" Formula (candidate-based with >10d gap)

```javascript
const now = new Date();
const isoNow = now.toISOString();

// DL-168: Next 1st or 15th with >10 day minimum gap
const day = now.getDate();
const month = now.getMonth();
const year = now.getFullYear();

const candidates = [];
if (day < 15) candidates.push(new Date(year, month, 15));
candidates.push(new Date(year, month + 1, 1));
candidates.push(new Date(year, month + 1, 15));
candidates.push(new Date(year, month + 2, 1));

const todayMidnight = new Date(year, month, day);
const nextDate = candidates.find(c =>
  Math.round((c - todayMidnight) / 86400000) > 10
);
const nextDateStr = nextDate.toISOString().split('T')[0];
```

**Edge case verification:**

| Send Date | Candidates | >10d winner | Gap |
|-----------|-----------|-------------|-----|
| Mar 1 | Mar 15, Apr 1, ... | Mar 15 | 14d |
| Mar 5 | Mar 15, Apr 1, ... | Apr 1 | 27d |
| Mar 14 | Mar 15, Apr 1, ... | Apr 1 | 18d |
| Mar 15 | Apr 1, Apr 15, ... | Apr 1 | 17d |
| Mar 21 | Apr 1, Apr 15, ... | Apr 1 | 11d |
| **Mar 22** | Apr 1, Apr 15, ... | **Apr 15** | **24d** |
| Dec 22 | Jan 1, Jan 15, ... | Jan 15 | 24d |
| Feb 21 | Mar 1, Mar 15, ... | Mar 15 | 22d |

### B. New "Init" Formula (skip one cycle — second qualifying candidate)

```javascript
const now = new Date();
const day = now.getDate();
const month = now.getMonth();
const year = now.getFullYear();

const candidates = [];
if (day < 15) candidates.push(new Date(year, month, 15));
candidates.push(new Date(year, month + 1, 1));
candidates.push(new Date(year, month + 1, 15));
candidates.push(new Date(year, month + 2, 1));
candidates.push(new Date(year, month + 2, 15));

const todayMidnight = new Date(year, month, day);
const qualifying = candidates.filter(c =>
  Math.round((c - todayMidnight) / 86400000) > 10
);
const initDate = qualifying.length >= 2 ? qualifying[1] : qualifying[qualifying.length - 1];
```

As an n8n expression (IIFE) for WF[01] and WF[02]:
```
={{ (function(){ const n=new Date(),d=n.getDate(),m=n.getMonth(),y=n.getFullYear(),c=[]; if(d<15)c.push(new Date(y,m,15)); c.push(new Date(y,m+1,1),new Date(y,m+1,15),new Date(y,m+2,1),new Date(y,m+2,15)); const t=new Date(y,m,d),q=c.filter(x=>Math.round((x-t)/864e5)>10); return (q.length>=2?q[1]:q[q.length-1]).toISOString().split('T')[0]; })() }}
```

### C. Changes by Component

#### C1. WF[06] Set Update Fields — replace next-date formula
Replace simple ternary with candidate-based formula A.

#### C2. WF[01] Update Stage — replace init expression
Replace `new Date(new Date().getFullYear(), new Date().getDate() <= 15 ? new Date().getMonth() + 1 : new Date().getMonth() + 2, 1).toISOString().split('T')[0]` with formula B IIFE.

#### C3. WF[02] Update Report Stage — replace init expression
Same replacement as C2.

#### C4. Admin Change Stage `code-02` — replace init formula
Replace the `reminderNextDate = new Date(...)` block with formula B inline.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n WF[06] `FjisCdmWc4ef0qSV` | Modify | `set_update_fields` jsCode — candidate-based >10d formula |
| n8n WF[01] `9rGj2qWyvGWVf9jXhv7cy` | Modify | Node `2334ac6d` expression — init IIFE |
| n8n WF[02] `QqEIWQlRs1oZzEtNxFUcQ` | Modify | Node `13bd8ea8` expression — init IIFE |
| n8n Admin Change Stage `3fjQJAwX1ZGj93vL` | Modify | Node `code-02` jsCode — init formula |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy test items to `current-status.md`

## 7. Validation Plan
* [ ] Send Now on a test client today (March 22) → verify next_date = 2026-04-15
* [ ] Verify automated batch on April 1 would set next to April 15 (14 days > 10)
* [ ] Verify automated batch on April 15 would set next to May 1 (16 days > 10)
* [ ] Stage entry init → verify next_date skips one cycle (second qualifying candidate)
* [ ] Admin Change Stage to Collecting_Docs → verify init date uses new formula
* [ ] Year boundary: Dec 22 send → verify next_date = Jan 15 (not Jan 1)
* [ ] No regression: reminder tab in admin panel displays dates correctly

## 8. Implementation Notes (Post-Code)

**Fix attempt #1 (session 171):** Failed — formula was never actually written to `set_update_fields` node, and Respond GET/POST nodes lost their `respondWith`/`responseBody` parameters (likely from an MCP `updateNode` that replaced the entire parameters object without including these fields).

**Fix attempt #2 (session 172):**
- **Root cause 1 (formula):** `set_update_fields` still had old DL-155 ternary. Applied candidate-based >10d formula.
- **Root cause 2 (Respond nodes):** Both `respond_get` and `respond_post` in `[API] Reminder Admin` (RdBTeSoqND9phSfo) only had CORS headers in `options` — `respondWith: "json"` and `responseBody` were missing. Restored full parameters.
- **Root cause 3 (init formulas):** All 3 init locations (WF[01] `2334ac6d`, WF[02] `13bd8ea8`, Admin Change Stage `code-02`) still had old DL-155 "skip one cycle" formula without >10d check. Applied candidate-based init formula (second qualifying candidate).
- Applied research principle: **Always include ALL existing parameters** when using `updateNode` on non-Code nodes (Airtable, HTTP) since it replaces the entire `parameters` object.
