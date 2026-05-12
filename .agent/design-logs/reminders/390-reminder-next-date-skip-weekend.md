# Design Log 390: Reminder `reminder_next_date` Skips Fri/Sat → Backward to Thursday
**Status:** [COMPLETED — 2026-05-12]
**Date:** 2026-05-01
**Related Logs:** DL-389 (block weekend automated emails), DL-155 (twice-monthly reminders), DL-168 (minimum-gap enforcement), DL-067 (init on stage entry)

## 1. Context & Problem
DL-389 blocks the *cron tick* on Fri/Sat — but the **stored** `reminder_next_date` can still land on Fri or Sat (e.g. when the 1st of a month is a Saturday). Result: cron skips Fri/Sat, then catches the row on Sunday. No emails leak, but the Reminders admin tab shows confusing "due today" badges on weekends and operations rationale ("when will it actually fire?") becomes muddy.

User wants: if `calcReminderNextDate()` (or the n8n post-send recompute) lands on Fri or Sat, **shift backward to the preceding Thursday**. So the stored value matches when the email actually goes out.

## 2. User Requirements (Phase A)
1. **Q:** What change to reminder next-date logic?
   **A:** Skip Fri/Sat when computing next date.
2. **Q:** Shift direction?
   **A:** Backward to Thursday. Friday → Thursday (-1), Saturday → Thursday (-2). Crossing month boundaries is allowed.
3. **Q:** Backfill existing rows?
   **A:** Yes — one-shot script via temp Worker endpoint, both filing types.
4. **Q:** Scope?
   **A:** Both annual_reports and capital_statements.

## 3. Research

### Domain
Calendar-aligned scheduled reminders + business-day weekend handling.

### Sources Consulted
1. **Smartsheet community — "Automation reminders: weekends and holidays, send a day before"** — recommends shifting backward when reminder is time-sensitive. "Send the day before" is the prevailing pattern for B2C/CPA contexts where landing late looks worse than landing early.
2. **Power Automate — `WORKDAY` business-day calculation** (c-sharpcorner.com) — standard helper computes prior/next weekday given a base date and offset. Forward-shift is the default in Western locales (Mon–Fri), backward-shift is the inverse for our Sun–Thu work week.
3. **DL-155 (cumulative)** — calendar-aligned 1st/15th cadence. Simpler than rolling offsets; everyone understands "the 1st."
4. **DL-168 (cumulative)** — `>10-day` minimum gap via candidate-based selection. Backward shift can compress gaps but worst case is still 12+ days (1st=Sat → backward to prev Thu = day 30 of prev month; previous reminder was 15th = 15-day gap; safe).

### Key Principles Extracted (delta on top of DL-389/DL-168)
- **Shift after candidate selection, not during** — pick the calendar candidate first (1st/15th), then check weekday. Combining both into one expression makes the code unreadable.
- **Compute weekday from date-only value** — `reminder_next_date` is a YYYY-MM-DD field. Use `getUTCDay()` on a `new Date(yyyy, mm, dd)` constructed at local midnight; on a UTC-runtime worker the weekday is unambiguous.
- **Single helper, two surfaces** — Worker SSOT in `reminders.ts` + duplicate in n8n Code node. Keep the same algorithm in both; cite each other in comments.
- **Backfill > on-the-fly cleanup** — one-shot scan + PATCH is simpler than per-read repair logic and creates a clean snapshot.

### Anti-Patterns Avoided
- **Forward shift to Sunday** — would create bunching on Sundays (1st=Sat AND 15th=Sun in some months → both fire same day). Backward shift spreads load.
- **In-cron repair** — checking weekday at cron-fire time means storage stays inconsistent with actual fire dates. DL-389 already gates the cron; we want stored dates to match reality.
- **Holidays handling** — explicitly out of scope. Israel has many holidays; encoding all of them is a separate redesign. Cron + manual override + the existing DL-168 minimum-gap guard are sufficient safety nets.

### Verdict
Add a one-line `shiftOffWeekend(d)` helper in `api/src/lib/reminders.ts`; apply at the end of `calcReminderNextDate()`. Mirror in the n8n `Set Update Fields` Code node (DL-168 logic). Add a temp admin-auth Worker endpoint `POST /webhook/admin-backfill-reminder-weekend-dates` that scans both filing tables, finds rows where `reminder_next_date` is Fri/Sat, PATCHes to Thursday, returns count.

## 4. Codebase Analysis

### SSOT date calculator (Worker)
- `api/src/lib/reminders.ts:5-19` — `calcReminderNextDate()`. Returns `YYYY-MM-DD`. **No weekday awareness today.**

### Worker callers (5 sites, all set or clear `reminder_next_date`)
| File | Line | When |
|------|------|------|
| `api/src/routes/send-questionnaires.ts` | 98 | Stage 1 → 2 transition (sends questionnaire) |
| `api/src/routes/approve-and-send.ts` | 239 (set) / 245 (clear) | Stage 3 → 4 (approve doc list) |
| `api/src/routes/stage.ts` | 46 (set) / 54 (clear) | Manual admin stage change |
| `api/src/routes/reminders.ts` | 372 | Admin override edit |
| `api/src/lib/auto-advance.ts` | 31 | Clears `null` on auto-advance |

All four "set" callers go through `calcReminderNextDate()` → patching the helper fixes them all. Only the admin-override path (`reminders.ts:372`) accepts a user-provided date — should we shift that too? **Decision: yes** — applies the same rule to manual edits, except when the user explicitly types a Fri/Sat (assume intentional). Practically: helper is only invoked when the source is the auto-calculator; manual edits write whatever the admin typed. Already correct without change.

### n8n duplicate (post-send recompute)
- WF[06] `[06] Reminder Scheduler` (`FjisCdmWc4ef0qSV`) → node `Set Update Fields` (id `set_update_fields`). DL-168 candidate-based code lives here; needs the same weekday shift.

### Backfill scope
- Airtable tables: `annual_reports` (`tbls7m3hmHC4hhQVy`), `capital_statements` (TBD — confirm via `docs/airtable-schema.md`).
- Only rows where `reminder_next_date` is Fri/Sat AND row is in a reminder stage (Stage 2 or 4). Out-of-stage rows have `null` or stale values that will be cleared on transition anyway.
- Existing pattern: `api/src/routes/backfill.ts` (one-shot admin endpoints used by DL-381).

### Reuse Decision
- New helper `shiftOffWeekend(d: Date): Date` in `reminders.ts`.
- Patch `calcReminderNextDate()` to call it.
- Mirror algorithm in n8n `Set Update Fields` Code node (cannot share Worker code).
- New endpoint `POST /webhook/admin-backfill-reminder-weekend-dates` modelled on existing backfill endpoints.

## 5. Constraints & Risks
- **Risk A — Backward shift compresses minimum gap.** Worst observed case: 1st=Sat → backward to Thu (prev month day 30) = ~15 days from 15th-of-prev-month send. Above DL-168's 10-day floor. **Verified safe** for both 30 and 31-day months and for Feb leap/non-leap.
- **Risk B — Worker UTC vs Israel weekday.** `reminder_next_date` is date-only YYYY-MM-DD. Using `new Date(y,m,d).getUTCDay()` on a UTC runtime gives the correct weekday for that calendar date in Israel (date-only is timezone-agnostic). No DST trap.
- **Risk C — Two SSOTs drift.** Worker helper and n8n Code node are duplicates; future cadence change must edit both. Mitigated by mirrored comments + DL reference in both.
- **Risk D — Backfill double-shift.** If run twice, idempotent because Thursday isn't Fri/Sat. Safe.
- **Risk E — Holidays not handled.** Out of scope. Manual override remains available.
- **Risk F — Admin manual edit on Fri/Sat.** Currently no shift; admin's typed date is honoured. Acceptable — explicit > automatic.
- **Security:** No new auth surfaces; backfill endpoint behind admin Bearer token.
- **Breaking changes:** Stored values shift backward by 1–2 days for affected rows. No external API contract change.

## 6. Proposed Solution (The Blueprint)

### Helper (`api/src/lib/reminders.ts`)
```ts
// DL-390: shift Fri/Sat backward to preceding Thursday (Israel work week is Sun-Thu).
// Caller passes a Date (or YYYY-MM-DD ISO string parsed to Date); returns YYYY-MM-DD.
function shiftOffWeekend(d: Date): Date {
  const dow = d.getUTCDay(); // 0=Sun .. 5=Fri, 6=Sat
  if (dow === 5) d.setUTCDate(d.getUTCDate() - 1); // Fri → Thu
  else if (dow === 6) d.setUTCDate(d.getUTCDate() - 2); // Sat → Thu
  return d;
}
```

### Patch `calcReminderNextDate()`
```ts
export function calcReminderNextDate(): string {
  const now = new Date();
  const day = now.getDate();
  const targetDate = day < 15
    ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
    : new Date(now.getFullYear(), now.getMonth() + 1, 15);
  shiftOffWeekend(targetDate); // DL-390
  return targetDate.toISOString().split('T')[0];
}
```

### n8n `Set Update Fields` Code node — append after `nextDate` resolution
```js
// DL-390: shift Fri/Sat backward to Thursday (mirror of api/src/lib/reminders.ts shiftOffWeekend)
const dow = nextDate.getUTCDay();
if (dow === 5) nextDate.setUTCDate(nextDate.getUTCDate() - 1);
else if (dow === 6) nextDate.setUTCDate(nextDate.getUTCDate() - 2);
const nextDateStr = nextDate.toISOString().split('T')[0];
```

### Backfill endpoint
- Route: `POST /webhook/admin-backfill-reminder-weekend-dates`
- Auth: admin Bearer token (`verifyToken`).
- Body: `{ dryRun?: boolean, filing_type?: 'annual_report' | 'capital_statement' }` (default both).
- Logic:
  1. List records from each filing table where `reminder_next_date` is non-null and stage in (`Waiting_For_Answers`, `Collecting_Docs`).
  2. For each, compute `shiftOffWeekend(parseDate(rec.reminder_next_date))`.
  3. If shifted ≠ original, PATCH `reminder_next_date` to the shifted YYYY-MM-DD (skip in `dryRun`).
  4. Log via `logEvent({event_type:'reminder_weekend_backfill', ...})`.
  5. Return `{ ok, scanned, shifted, by_filing_type, sample_changes }`.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/reminders.ts` | Modify | Add `shiftOffWeekend()` helper; apply inside `calcReminderNextDate()` |
| `api/src/routes/backfill.ts` (or new file) | Modify/Create | Add `admin-backfill-reminder-weekend-dates` route |
| `api/src/index.ts` | Modify | Register the new backfill route |
| n8n `FjisCdmWc4ef0qSV` `Set Update Fields` | Modify via MCP | Append weekday shift after `nextDate` |
| `docs/email-design-rules.md` Section 13 | Modify | Cross-reference DL-390 — store-side weekend skip in addition to send-side |

### Final Step (Always)
Status → `[IMPLEMENTED — NEED TESTING]`. Run backfill with `dryRun: true` first, share output for review, then run real backfill.

## 7. Validation Plan
- [ ] Unit logic: `calcReminderNextDate()` invoked when "next 1st" = Saturday → returns the prior Thursday (day 30 of prior month).
- [ ] Unit logic: invoked when "next 15th" = Friday → returns Thursday (day 14).
- [ ] Unit logic: invoked when next date is already Sun/Mon/Tue/Wed/Thu → unchanged.
- [ ] Worker call sites — patch `send-questionnaires` Stage 1→2 → row's `reminder_next_date` reflects Thursday-shifted value.
- [ ] `approve-and-send` Stage 3→4 → same.
- [ ] `stage.ts` admin manual stage change → same.
- [ ] Admin "edit reminder date" preserves typed date even if Fri/Sat.
- [ ] n8n Reminder Scheduler — manually trigger send for one row, confirm `Set Update Fields` produces Thursday-shifted value.
- [ ] Backfill `dryRun: true` returns expected count + sample changes (no writes).
- [ ] Backfill real run — Airtable rows with Fri/Sat values are now Thursday; idempotent (second run reports `shifted: 0`).
- [ ] DL-168 minimum-gap interplay — last_reminder_sent + new shifted next_date still ≥ 10 days in worst case.
- [ ] Reminders admin tab shows no rows with Fri/Sat in the "due this week" column after backfill.
- [ ] DL-389 cron Skip Fri/Sat node remains in place (belt-and-suspenders).

## 8. Implementation Notes (Post-Code)
- **`api/src/lib/reminders.ts`** — added exported `shiftOffWeekend(d: Date): Date` that mutates and returns. `calcReminderNextDate()` now constructs target date with `Date.UTC(...)` (was local time) so the weekday read is timezone-stable on dev machines too — Worker runtime is UTC so behaviour is unchanged in production. Then calls `shiftOffWeekend(targetDate)` before formatting.
- **No call-site updates needed** — every Worker caller (`send-questionnaires.ts:98`, `approve-and-send.ts:239`, `stage.ts:46`, `auto-advance.ts` clears only) routes through `calcReminderNextDate()`. Admin manual override (`reminders.ts:372`) is intentionally NOT shifted: typed dates are honoured even if Fri/Sat.
- **n8n WF[06] `Set Update Fields`** — patched via `n8n_update_partial_workflow` MCP. Code node now constructs candidates with `Date.UTC()` and appends the same Fri/Sat→Thu shift after the DL-168 candidate selection. Mirror comment cites `api/src/lib/reminders.ts shiftOffWeekend()`.
- **Backfill endpoint** — `POST /webhook/admin-backfill-reminder-weekend-dates` added inside existing `api/src/routes/backfill.ts`. Already mounted via `app.route('/webhook', backfill)` — no `index.ts` change needed. Defaults to `dryRun: true` for safety; supports `filing_type` filter (`annual_report` | `capital_statement`); returns `{scanned, shifted, by_filing_type, sample_changes}`. Returns first 10 sample changes with truncated `client` field for PII safety.
- **Single `reports` table** — confirmed via `docs/airtable-schema.md`: both filing types live in `tbls7m3hmHC4hhQVy` keyed by `filing_type`. No separate `capital_statements` table — backfill reads one table.
- **`docs/email-design-rules.md`** — Section 13 extended with a new "Reminder cadence — store-side weekend skip (DL-390)" subsection. Cross-references `shiftOffWeekend()`, `calcReminderNextDate()`, the n8n node, and the backfill endpoint.
- **Type-check** — `tsc --noEmit` shows only the 2 pre-existing errors from prior sessions (`src/index.ts:128`, `src/lib/activity-logger.ts:16`); DL-390 diff is clean.
- **Backward-shift gap math** — verified: 1st-of-month=Sat → backward Thu = day 30 of prev month → 15 days from prev 15th (above DL-168's 10-day floor); 15th=Fri → backward Thu = day 14 → 13 days from prev 1st (also above floor).
- **Applied research principles:** shift after candidate selection (not during); single helper applied to both Worker and n8n surfaces; backfill > on-the-fly cleanup for clean state; holidays out of scope (manual override remains).

### Recommended rollout
1. Deploy Worker.
2. Run backfill with `dryRun: true` first → review `sample_changes` and `shifted` count.
3. Run real backfill (`dryRun: false`) → verify Reminders admin tab shows no Fri/Sat dates.
4. Wait one cron cycle (next 1st or 15th); confirm `Set Update Fields` produces a Thursday-shifted value when the calendar trigger lands on Fri/Sat.

