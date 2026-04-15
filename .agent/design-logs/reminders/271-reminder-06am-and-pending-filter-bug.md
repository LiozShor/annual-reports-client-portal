# Design Log 271: Reminder 06 AM Timing + Pending Classification Filter Bypass + Monthly Reset Credential

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-15
**Related Logs:** DL-060 (reminder SSOT doc display), DL-178 (manual reminder send)

## 1. Context & Problem

Three bugs discovered in the reminder system on 2026-04-15 morning run (execution 11809):

**Bug 1 — Wrong send time:** Reminder emails sent at 06:00 Israel time instead of 08:00. Cron expression `0 6 * * *` in `Asia/Jerusalem` timezone fires at 06:00, not the intended 08:00.

**Bug 2 — Pending classification filter bypassed:** Clients with pending AI classifications (docs waiting for review) received reminders they shouldn't have. Specifically:
- **CPA-XXX (Client Name)** — 5+ pending classifications
- **CPA-XXX (דני ויינר)** — pending classifications

Root cause: `Prepare Type B Input` code node reads from `$('Filter Eligible')` (pre-filter) instead of the filtered output. The `Filter Type B By Pending` node correctly removes 2 clients (14 out of 16 pass), but `Prepare Type B Input` bypasses that by referencing the upstream node, getting all 16 back.

**Bug 3 — Monthly Reset credential error:** `[06-SUB] Monthly Reset` (pW7WeQDi7eScEIBk, exec 11810) fails because Airtable credential `avbHMwlPAfuabIcq` ("Airtable CRM") was deleted/rotated. Has been failing since at least April 1st. All 4 Airtable nodes use this stale credential.

**Non-issue — 16 Document Service calls (11812-11827):** Expected behavior. Each of the 16 Type B clients needs doc list generation via sub-workflow call. Normal.

## 2. User Requirements

1. **Q:** Should all 3 bugs be fixed in this log?
   **A:** Yes, fix all 3.

2. **Q:** Should clients with pending classifications be skipped entirely, or get a modified reminder?
   **A:** Skip entirely — don't confuse clients whose docs are being reviewed.

## 3. Research

Skipped — these are straightforward bugs with clear root causes, not architectural decisions.

## 4. Codebase Analysis

### Workflow: `[06] Reminder Scheduler` (FjisCdmWc4ef0qSV)

**Trigger:** `Schedule Trigger` — cron `0 6 * * *`, timezone `Asia/Jerusalem`

**Data flow for Type B (Collecting_Docs):**
```
Filter Eligible (29) → Split by Type FALSE (16 Type B)
  → Merge For Pending (16 + 62 pending cls = 78)
  → Filter Type B By Pending (14 pass, 2 skipped)
  → Route Pending Warning (IF: _warn_pending, all FALSE)
  → Search Missing Docs (11970 docs from Airtable)
  → Prepare Type B Input (16! reads from Filter Eligible, not filtered output)
  → Call Document Service (16)
  → Build Type B Email (16)
  → Merge All Emails (29 = 13 Type A + 16 Type B)
```

**The bug:** Line in `Prepare Type B Input`:
```javascript
const reports = $('Filter Eligible').all().filter(i => i.json._type === 'B');
```
Should reference `$('Route Pending Warning')` or filter using the pending data.

### Workflow: `[06-SUB] Monthly Reset` (pW7WeQDi7eScEIBk)

- 4 Airtable nodes all reference deleted credential `avbHMwlPAfuabIcq`
- Correct credential: `ODW07LgvsPQySQxh` ("Airtable Personal Access Token account")
- Nodes: `Search This Month Suppressed`, `Update Cleared Records`, `Search Newly Eligible`, `Update New Eligible`

## 5. Technical Constraints & Risks

* **Bug 2 fix risk:** Changing the `$()` reference in `Prepare Type B Input` must ensure the node name matches exactly. The FALSE branch of `Route Pending Warning` feeds into `Search Missing Docs`, and `Prepare Type B Input` runs after that. But the Code node can reference any upstream node by name. Using `$('Filter Type B By Pending')` is safest since that's the actual filter output.
* **Bug 3 credential fix:** Must use n8n REST API PUT to update all 4 nodes' credential references. Cannot be done via MCP.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Reminders fire at 08:00 Israel time, clients with pending classifications are excluded, and monthly reset succeeds.

### Fix 1: Cron timing
- Change `Schedule Trigger` cron from `0 6 * * *` to `0 8 * * *`
- Via REST API: GET workflow → update node params → PUT

### Fix 2: Pending classification filter
- In `Prepare Type B Input` Code node, change:
  ```javascript
  // OLD (BUG):
  const reports = $('Filter Eligible').all().filter(i => i.json._type === 'B');
  // NEW (FIX):
  const reports = $('Filter Type B By Pending').all();
  ```
- No need to filter by `_type === 'B'` since `Filter Type B By Pending` already only returns Type B items
- Via REST API: GET workflow → update Code node jsCode → PUT

### Fix 3: Monthly Reset credential
- Update all 4 Airtable nodes in `[06-SUB] Monthly Reset` to use credential ID `ODW07LgvsPQySQxh`
- Via REST API: GET workflow → update each node's credentials → PUT

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status.md, commit & push

## 7. Validation Plan
* [ ] Verify cron expression changed to `0 8 * * *` on workflow
* [ ] Verify `Prepare Type B Input` references `Filter Type B By Pending` instead of `Filter Eligible`
* [ ] Manually trigger reminder with a test client that has pending classifications — confirm they're skipped
* [ ] Verify Monthly Reset workflow uses correct credential (trigger manually or wait for May 1st)
* [ ] Verify no regression: Type B clients WITHOUT pending classifications still get reminders

## 8. Implementation Notes (Post-Code)
* All 3 fixes applied via n8n REST API PUT
* Fix 1: Cron changed `0 6 * * *` → `0 8 * * *` on Schedule Trigger
* Fix 2: `Prepare Type B Input` now reads `$('Filter Type B By Pending').all()` instead of `$('Filter Eligible').all().filter(...)` — comment on line 24 still says "Filter Eligible" (cosmetic, no impact)
* Fix 3: All 4 Monthly Reset Airtable nodes updated from stale credential `avbHMwlPAfuabIcq` to active `ODW07LgvsPQySQxh`
* Duplicate protection: 24h dedup guard in `Filter Eligible` prevents double-send since `last_reminder_sent_at` was set at 06:00 today
