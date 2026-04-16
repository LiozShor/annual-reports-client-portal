# Design Log 111: Reminder History — Migrate to Inline JSON Field
**Status:** IMPLEMENTED
**Date:** 2026-03-07
**Related Logs:** DL-109 (reminder system enhancements — original implementation)

## 1. Context & Problem
DL-109 added a `reminder_history` Airtable table with one record per reminder sent, plus a dedicated `get_history` API action and frontend fetch flow. User observed that for 600+ clients, a separate table is overkill — a JSON field on `annual_reports` would be simpler, eliminate extra queries, and keep data co-located with the report.

## 2. User Requirements
1. **Q:** Keep the separate table as fallback, or delete entirely?
   **A:** Delete it — single source of truth on annual_reports.

2. **Q:** Store only dates+type, or also delivery status metadata?
   **A:** Dates + type only. `[{"date":"2026-03-07","type":"B"}]`

3. **Q:** Popover fetch strategy?
   **A:** From list data (recommended) — zero extra API calls.

## 3. Research
### Domain
Data modeling — embedded vs. referenced documents. This is a classic NoSQL pattern.

### Research Verdict
Embedded document pattern wins when: (a) data is always accessed with the parent, (b) entries are small and bounded, (c) you never query across parents. All three conditions hold here. A JSON array in a text field on `annual_reports` is the right call.

## 4. Codebase Analysis

### Current Implementation (DL-109)

**Airtable:**
- `reminder_history` table (`tblHl3hGoFwC5FfXx`) — fields: `report` (singleLineText), `sent_at` (dateTime), `type` (singleSelect A/B)

**n8n — WF[06] (`FjisCdmWc4ef0qSV`):**
- `Create History` node (`create_history`) — Airtable Create after Filter Sent. Writes `report`, `sent_at`, `type`.

**n8n — Reminder Admin (`RdBTeSoqND9phSfo`):**
- `Parse Action` — includes `get_history` in validActions, sets `_history_lookup = true`
- `IF History` node (`if_history`) — routes history lookups to search path
- `Search History` node (`search_history`) — Airtable Search on `reminder_history`
- `Build History Response` node — returns `{ok: true, history: [...]}`

**Frontend — script.js:**
- `historyCache` Map (line 754)
- `toggleHistoryPopover()` (lines 756–779) — positions popover, checks cache, calls fetch
- `fetchHistoryForPopover()` (lines 791–817) — POST `get_history` action
- `renderHistoryPopover()` (lines 819–842) — renders date+type list
- `closeHistoryPopover()` / `_closeHistoryPopoverOnClick()` (lines 781–789)
- Cache invalidation in `executeReminderAction` for `send_now` (lines 3961–3962)
- Last Sent `<td>` with clickable class (line 3721)

**Frontend — index.html:**
- `<div id="reminderHistoryPopover">` (line 764)

### Reuse Decision
- **Keep:** Popover UI (HTML div, CSS, render function, positioning, accessibility)
- **Remove:** `fetchHistoryForPopover()`, `historyCache` Map, `get_history` action, 4 n8n nodes
- **Change:** WF[06] Filter Sent → append to JSON field instead of creating record; Build GET Response → include history in list; toggleHistoryPopover → read from reminderData

## 5. Technical Constraints & Risks
* **Read-modify-write:** WF[06] must read existing JSON, append, write back. Concurrent sends could overwrite (extremely unlikely with `batchSize:1`, `batchInterval:2500`).
* **Airtable field type:** Long text. Max ~100KB per cell. At ~50 bytes per entry × 20 reminders/year × 5 years = 5KB. No risk.
* **Migration:** 3 existing records in `reminder_history` (test data). No production data to migrate — table is brand new.
* **Breaking changes:** None. The popover UX stays identical.

## 6. Proposed Solution (The Blueprint)

### Data Format
Field `reminder_history` on `annual_reports` (long text):
```json
[{"date":"2026-03-07T19:23:38Z","type":"B"},{"date":"2026-04-01T10:00:00Z","type":"B"}]
```

### Logic Flow

**Write path (WF[06]):**
1. In `Filter Sent` code node (after guard), for each successfully sent item:
   - Read current `reminder_history` from the report's Airtable data (already fetched by Search Due Reminders / Get Single Record)
   - Parse as JSON array (default `[]`)
   - Append `{date: now_ISO, type: _type}`
   - Stringify and attach as `_history_json` to the item
2. In `Set Update Fields` code node, include `reminder_history: _history_json` in the fields to write
3. `Update Reminder Fields` Airtable node already writes dynamic fields — add `reminder_history` to schema
4. **Remove** `Create History` node entirely + its connection from Filter Sent

**Read path (Reminder Admin):**
1. `Search Reminder Records` already fetches all report fields — add `reminder_history` to the returned data
2. `Build GET Response` — parse `reminder_history` JSON, include as `history` array in each item
3. **Remove** 4 nodes: `IF History`, `Search History`, `Build History Response`, and the `get_history` branch from `Parse Action`

**Frontend:**
1. `toggleHistoryPopover()` — read history from `reminderData` (the list response already in memory), not from cache/fetch
2. **Remove:** `historyCache` Map, `fetchHistoryForPopover()`, `_closeHistoryPopoverOnClick` wrapper
3. `renderHistoryPopover()` — keep as-is (same input format)
4. Cache invalidation on `send_now` — remove (data refreshes naturally with list reload)
5. Last Sent `<td>` — keep clickable, just change the data source

### n8n Node Changes

| Workflow | Node | Action |
|----------|------|--------|
| WF[06] `FjisCdmWc4ef0qSV` | `Filter Sent` (code) | Append history JSON to each item |
| WF[06] `FjisCdmWc4ef0qSV` | `Set Update Fields` (code) | Include `reminder_history` in output |
| WF[06] `FjisCdmWc4ef0qSV` | `Update Reminder Fields` (airtable) | Add `reminder_history` to schema |
| WF[06] `FjisCdmWc4ef0qSV` | `Create History` (airtable) | **DELETE** node + connection |
| Reminder Admin `RdBTeSoqND9phSfo` | `Parse Action` (code) | Remove `get_history` from validActions |
| Reminder Admin `RdBTeSoqND9phSfo` | `IF History` (if) | **DELETE** node |
| Reminder Admin `RdBTeSoqND9phSfo` | `Search History` (airtable) | **DELETE** node |
| Reminder Admin `RdBTeSoqND9phSfo` | `Build History Response` (code) | **DELETE** node |
| Reminder Admin `RdBTeSoqND9phSfo` | `Build GET Response` (code) | Parse + include history in items |

### Frontend Changes

| File | Change |
|------|--------|
| `admin/js/script.js` | Remove `historyCache`, `fetchHistoryForPopover()`, `_closeHistoryPopoverOnClick`. Simplify `toggleHistoryPopover()` to read from `reminderData`. Remove cache invalidation in `executeReminderAction`. |
| `admin/index.html` | No change (popover div stays) |
| `admin/css/style.css` | No change (CSS stays) |

### Airtable Changes
1. Add `reminder_history` (long text) field to `annual_reports` (`tbls7m3hmHC4hhQVy`)
2. Delete `reminder_history` table (`tblHl3hGoFwC5FfXx`) — manually in Airtable UI
3. Update `docs/airtable-schema.md`

## 7. Validation Plan
* [ ] Send reminder (send_now) → check `reminder_history` field in Airtable contains JSON with correct entry
* [ ] Send a second reminder → JSON array has 2 entries (append, not overwrite)
* [ ] Open Reminders tab → click Last Sent cell → popover shows history
* [ ] Empty history client → popover shows "לא נשלחו תזכורות"
* [ ] send_now → reload list → popover shows updated entry
* [ ] Scheduled trigger sends batch → all sent clients have history appended
* [ ] Popover accessibility: Tab to cell, Enter opens popover

## 8. Implementation Notes

**Airtable field:** Created via Meta API (token now has `schema.bases:write`). Field ID: `fldT2ect4YA0LemeF`.

**WF[06] changes (6 ops):**
- `Search Due Reminders` — added `reminder_history` to fields list
- `Filter Sent` — reads `reminder_history` from Filter Eligible upstream, parses JSON, appends `{date, type}`, outputs `_history_json`
- `Set Update Fields` — includes `reminder_history: _history_json`
- `Update Reminder Fields` — added `reminder_history` (multilineText) to schema
- Removed `Create History` node + connection (nodeCount 25→24)

**Reminder Admin changes (12 ops):**
- `Build GET Response` — parses `reminder_history` JSON per item, includes `history` array
- `Build Save Response` — same parsing added (config save path also returns items)
- `Parse Action` — removed `get_history` from validActions + `_history_lookup` logic
- Removed 3 nodes: IF History, Search History, Build History Response
- Reconnected: Parse Action → IF Config Update directly (nodeCount stays 27, connections cleaned)

**Frontend changes:**
- Removed ~45 lines: `historyCache` Map, `fetchHistoryForPopover()`, `_closeHistoryPopoverOnClick`, cache invalidation
- `toggleHistoryPopover()` now reads `item.history` from `remindersData` (already loaded)
- `closeHistoryPopover` used directly as event handler (no wrapper needed)

**Manual cleanup required:**
- Delete `reminder_history` table (`tblHl3hGoFwC5FfXx`) in Airtable UI
