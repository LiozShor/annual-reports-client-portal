# DL-109: Reminder System Enhancements (Phase 5)

**Status:** IMPLEMENTED
**Session:** 103 (2026-03-07)
**Scope:** Monthly reminder timing overhaul + reminder send history

---

## 5.1 — Monthly Reminder Timing (15th Cutoff)

### Problem
The `send_day` config + `month + 2` formula was too rigid. Clients contacted on the 30th got a reminder on the 1st (2 days later).

### Solution
New 15th-of-month cutoff rule:
- Event before 16th → 1st of next month
- Event on/after 16th → 1st of month+2

`send_day` setting removed entirely.

### Formula
```javascript
const day = new Date().getDate();
new Date(d.getFullYear(), day <= 15 ? d.getMonth() + 1 : d.getMonth() + 2, 1)
  .toISOString().split('T')[0];
```

### n8n Changes
| Workflow | Node | Change |
|----------|------|--------|
| WF[01] `9rGj2qWyvGWVf9jXhv7cy` | Update Stage (Airtable) | Expression: `month+2` → cutoff |
| WF[02] `QqEIWQlRs1oZzEtNxFUcQ` | Update Report Stage (Airtable) | Same |
| Admin Change Stage `3fjQJAwX1ZGj93vL` | Process Change (Code) | jsCode: `month+2` → cutoff |
| WF[06] `FjisCdmWc4ef0qSV` | Set Update Fields (Code) | Removed sendDay branch, use cutoff |
| WF[06] `FjisCdmWc4ef0qSV` | Fetch Config (Airtable) | Filter: removed `reminder_send_day` |
| Reminder Admin `RdBTeSoqND9phSfo` | Collect Saves (Code) | Gutted to passthrough (cascade removed) |
| Reminder Admin `RdBTeSoqND9phSfo` | Build GET Response (Code) | Removed `sendDay`, `send_day` from output |
| Reminder Admin `RdBTeSoqND9phSfo` | Build Save Response (Code) | Same + removed cascade date count |
| Reminder Admin `RdBTeSoqND9phSfo` | Fetch Reminder Config (Airtable) | Filter: only `reminder_default_max` |
| Reminder Admin `RdBTeSoqND9phSfo` | Fetch Config (Save) (Airtable) | Same |

### Frontend Changes
- **index.html:** Removed `settingsSendDayInput` form field from settings modal
- **script.js:** Removed `reminderSendDay` state variable, all `send_day` refs in `loadReminders`, `openReminderSettingsModal`, `saveReminderSettings`, `doSaveReminderSettings`

---

## 5.2 — Reminder Send History Popover

### Problem
`last_reminder_sent_at` is a single overwritten value — no history trail.

### Solution
New `reminder_history` Airtable table + clickable "Last Sent" cell that shows a history popover.

### Airtable
Table: `reminder_history` (`tblHl3hGoFwC5FfXx`)
- `report` — Link to `annual_reports`
- `sent_at` — DateTime (UTC)
- `type` — Single Select: A, B

### n8n Changes
| Workflow | Node | Change |
|----------|------|--------|
| WF[06] `FjisCdmWc4ef0qSV` | Filter Sent (Code) | Added `_type` recovery from Filter Eligible by report ID |
| WF[06] `FjisCdmWc4ef0qSV` | Create History (NEW Airtable Create) | Writes `report`, `sent_at`, `type` after Filter Sent |
| Reminder Admin `RdBTeSoqND9phSfo` | Parse Action (Code) | Added `get_history` to validActions + early return |
| Reminder Admin `RdBTeSoqND9phSfo` | IF History (NEW IF) | Routes `_history_lookup === true` to history path |
| Reminder Admin `RdBTeSoqND9phSfo` | Search History (NEW Airtable Search) | Searches `reminder_history` by report ID, `alwaysOutputData: true` |
| Reminder Admin `RdBTeSoqND9phSfo` | Build History Response (NEW Code) | Returns `{ok: true, history: [{sent_at, type}, ...]}` |

### Frontend Changes
- **index.html:** Added `reminderHistoryPopover` div (reuses `.docs-popover` CSS)
- **script.js:**
  - `historyCache` Map + `toggleHistoryPopover()` + `fetchHistoryForPopover()` + `renderHistoryPopover()` + `closeHistoryPopover()` — mirrors docs popover pattern
  - Last Sent `<td>` → clickable with `.clickable-docs`, `tabindex`, `role="button"`, `aria-label`, keyboard handler
  - Cache invalidation: `historyCache.delete(reportId)` in `executeReminderAction` for `send_now`

### Reused Patterns
- `.docs-popover` CSS class (no new styles)
- `.clickable-docs` class for cursor pointer
- `positionFloating()` for popover positioning
- `{ once: true }` click listener for outside-click close

---

## Files Changed

### n8n Workflows (6 workflows, ~15 node updates)
- WF[01], WF[02], Admin Change Stage, WF[06], Reminder Admin

### Frontend (2 files)
- `admin/index.html` — settings modal, history popover div
- `admin/js/script.js` — send_day removal, history popover code

### Docs (2 files)
- `docs/airtable-schema.md` — new `reminder_history` table
- `docs/meeting-with-natan-action-items.md` — Group 5 marked done
