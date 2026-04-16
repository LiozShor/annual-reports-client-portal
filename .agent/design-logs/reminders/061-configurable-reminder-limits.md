# Design Log 061: Configurable Reminder Limits
**Status:** [IMPLEMENTED]
**Date:** 2026-02-26
**Related Logs:** 059-automated-follow-up-reminder-system.md, 060-reminder-ssot-doc-display.md

## 1. Context & Problem
The reminder system's max limit is hardcoded to 3 in three places (WF[06] Filter Eligible, Reminder Admin Build GET Response, admin frontend). The user wants:
- Default = **unlimited** (keep sending until manually stopped)
- Global default **configurable from admin panel**
- Per-client limit **inline editable** in the reminder table
- Visual distinction between default vs custom limits

## 2. User Requirements
1. **Q:** Change default to unlimited or keep finite but configurable?
   **A:** Change to unlimited. Reminders keep sending unless limited per-client.

2. **Q:** Where should global default be configurable?
   **A:** Settings section inside the reminders tab (not a separate settings page).

3. **Q:** Per-client override UI — current `set_max` sufficient?
   **A:** Needs improvement — inline editable directly in the table row.

4. **Q:** What happens when client hits max?
   **A:** Current exhaustion behavior is fine (stop sending, admin can override).

5. **Q:** Settings bar location?
   **A:** Inside reminders tab, small config section at top.

6. **Q:** Per-client edit UX?
   **A:** Click count/max cell → inline dropdown → save. Most comfortable.

## 3. Research
### Domain
Inline table editing UX, admin settings patterns, notification limit systems.

### Sources Consulted
1. **NNGroup — Data Tables: Four Major User Tasks** — Inline editing best for quick single-value changes; use click-to-edit with explicit save for cascading settings.
2. **GitHub Primer Design System — Saving Patterns** — Declarative controls (selects, text) need explicit save; imperative controls (toggles) can auto-save. Never disable save buttons. Never mix save patterns on same page.
3. **Cloudscape (AWS) — Inline Edit Pattern** — Read → hover hint → click → edit mode → confirm/dismiss. Edit icon on hover. Inline validation. Return focus to cell on cancel.
4. **Atlassian Design System — Inline Edit Component** — Read/edit mode switching. Enter to confirm, Escape to cancel. Clear visual distinction between modes.

### Key Principles Extracted
- **Click-to-edit with dropdown for presets** — don't require typing for common values (unlimited, 3, 5, 10). Only show custom number input when needed.
- **Never auto-save cascading settings** — changing global default affects all clients. Require explicit Save button.
- **Auto-save on individual selection** — per-client changes are scoped to one entity. Can auto-save when preset selected from dropdown.
- **Default vs custom visual distinction** — muted "(ברירת מחדל)" text for default, bold brand-colored text for custom, reset icon (↺) for overridden values.
- **Focus management** — focus input on edit, Enter to save, Escape to cancel, return focus to cell.

### Patterns to Use
- **Settings bar:** Display value + "שנה" button → select + Save/Cancel
- **Inline cell edit:** Click cell → dropdown replaces text → select to auto-save or Enter → API call → re-render
- **Default + Override:** Show "(ברירת מחדל)" in muted gray, custom in brand-600 bold, ↺ reset button

### Anti-Patterns to Avoid
- **Mixed save patterns** — settings bar uses explicit Save, inline cells auto-save on select. Different control types, so this is OK per Primer guidelines.
- **No visual distinction** between read/edit mode — always show hover hint on cells.
- **Auto-save on global setting** — confirmation dialog when change would exhaust existing clients.

### Research Verdict
Click-to-edit inline dropdown for per-client limits (auto-save on selection), explicit Save for global default (cascading effect). Settings bar at top of reminders tab with edit toggle.

## 4. Codebase Analysis
* **Relevant Files:**
  - `admin/js/script.js` — `buildReminderTable()` (line 2264), `isExhausted()` (line 2169), `loadReminders()`, `executeReminderAction()`
  - `admin/css/style.css` — `.action-btn.reminder-set-btn` already defined (lines 2283-2290)
  - `admin/index.html` — reminders tab structure
  - n8n WF[06] `FjisCdmWc4ef0qSV` — Filter Eligible Code node
  - n8n [API] Reminder Admin `RdBTeSoqND9phSfo` — Build GET Response, Parse Action
* **Existing Patterns:**
  - `executeReminderAction()` already supports `value` param and `set_max` action
  - `setRowLoading()`/`clearRowLoading()` for row-level loading states
  - `showConfirmDialog()` for destructive actions
  - CSS class `.action-btn.reminder-set-btn` already defined (primary-50/600)
  - Toast strings for `set_max` already defined
* **Alignment with Research:** No inline editing patterns exist in codebase yet — this is new. All other patterns (modals, confirm dialogs, loading overlays) align well.
* **Dependencies:** Airtable (new config table), n8n WF[06] + Reminder Admin API, admin frontend

## 5. Technical Constraints & Risks
* **Security:** Config API uses same HMAC auth as existing actions. No new auth surface.
* **Risks:** Changing from default 3 to unlimited means existing clients with count >= 3 will resume getting reminders. This is intentional.
* **Breaking Changes:** None — `reminder_max` field semantics preserved. null now means "use global default" instead of "use hardcoded 3".
* **Airtable:** New `system_config` table required. Follows SSOT principle (Airtable = State Machine).
* **n8n:** WF[06] must be deactivated during update, then reactivated. Risk: brief downtime on the daily 08:00 scheduler (acceptable).

## 6. Proposed Solution (The Blueprint)

### Logic Flow
1. Create Airtable `system_config` table with `reminder_default_max` = empty (unlimited)
2. WF[06] fetches config at start of scheduled run; Filter Eligible uses it instead of hardcoded 3
3. Reminder Admin API fetches config on list requests, returns `default_max` in response
4. Reminder Admin API gains `update_config` action for changing global default
5. Frontend settings bar shows current default, allows editing with confirmation
6. Frontend count/max cell becomes clickable inline editor with dropdown

### Data: Airtable `system_config` Table
| Field | Type | Purpose |
|-------|------|---------|
| config_key | singleLineText (primary) | Lookup key |
| config_value | singleLineText | Value (empty = unlimited) |
| description | singleLineText | Human-readable purpose |

Initial record: `{config_key: 'reminder_default_max', config_value: '', description: 'Max reminders per client. Empty = unlimited.'}`

### n8n WF[06] Changes
- **Add node:** "Fetch Config" (Airtable Search on system_config) between Schedule Trigger and Search Due Reminders
- **Update:** Filter Eligible Code — read config from `$('Fetch Config')` or EWT payload, fallback to null (unlimited)
- **Connections:** Schedule Trigger → Fetch Config → Search Due Reminders (instead of direct)

### n8n Reminder Admin API Changes
- **Add node:** "Fetch Reminder Config" (Airtable Search) on GET path, between Route Method and Search Reminder Records
- **Update:** Build GET Response — include `default_max` in response, use it for exhaustion calculation
- **Update:** Parse Action — handle `update_config` action (returns `_config_update` flag), handle `set_max` with null value (reset to default)
- **Add nodes:** "IF Config Update" (routes config updates away from annual_reports), "Update Config" (Airtable update on system_config matching by config_key)
- **Connections:** Parse Action → IF Config Update → (true) Update Config → Respond POST / (false) Update Airtable (existing)
- **Update:** Execute Scheduler — pass `default_max` from request body to WF[06]

### Frontend Changes
- **Settings bar** at top of reminders tab: current value display + edit toggle + select + Save/Cancel
- **Inline count/max cell:** clickable, replaces with dropdown (∞/3/5/10/custom), auto-save on selection
- **Visual distinction:** default = gray muted "(ברירת מחדל)", custom = brand-600 bold + ↺ reset button
- **Updated `isExhausted()`** — use `reminderDefaultMax` instead of hardcoded 3
- **Updated `loadReminders()`** — store `default_max` from API response

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| Airtable | Create | `system_config` table + initial record |
| docs/airtable-schema.md | Modify | Document new table |
| n8n WF[06] `FjisCdmWc4ef0qSV` | Modify | Add Fetch Config node, update Filter Eligible code |
| n8n API `RdBTeSoqND9phSfo` | Modify | Add Fetch Config, IF Config Update, Update Config nodes; update Build GET Response, Parse Action |
| admin/index.html | Modify | Add settings bar HTML |
| admin/js/script.js | Modify | Settings bar logic, inline cell editing, updated isExhausted/loadReminders/buildReminderTable |
| admin/css/style.css | Modify | Settings bar + inline editor styles |

## 7. Validation Plan
* [ ] Load reminders tab — settings bar shows "ללא הגבלה" as default
* [ ] Change default to 5 — confirm dialog warns about affected clients, persists after reload
* [ ] Change back to unlimited — persists, exhaustion states update
* [ ] Click count/max cell — dropdown appears with presets
* [ ] Set client to 3 — cell shows "0/3" in brand color with ↺ reset button
* [ ] Reset client — returns to "(ברירת מחדל)" styling, reminder_max = null in Airtable
* [ ] Send Now for client with custom max — respects per-client limit
* [ ] Scheduled run — reads config from Airtable, applies correctly
* [ ] Config table missing/empty — graceful fallback to unlimited

## 8. Implementation Notes (Post-Code)
* **Airtable table:** `system_config` (`tblqHOkDnvb95YL3O`), seeded with `reminder_default_max` = empty
* **WF[06] changes:** Added Fetch Config node (Airtable Search), rewired Schedule Trigger → Fetch Config → Search Due Reminders. Filter Eligible reads config from Fetch Config (scheduled) or EWT payload (Send Now). Both paths fallback to null (unlimited).
* **Admin API changes:** GET path: Fetch Reminder Config → Search Reminder Records. Build GET Response includes `default_max`. POST path: IF Config Update routes `update_config` to Update Config (Airtable update on system_config by config_key), non-config actions to existing Update Airtable. Parse Action handles `set_max` with null/empty for reset.
* **Frontend:** Global `reminderDefaultMax` variable, stored from `data.default_max` in loadReminders. Settings bar HTML in index.html between stats and filter bars. New functions: updateDefaultMaxDisplay, editDefaultMax, cancelEditDefaultMax, saveDefaultMax, doSaveDefaultMax, editClientMax, handleMaxSelectChange, saveClientMax, resetClientMax. Per-client "unlimited" override uses value 9999.
* **Commit:** `e357a6e` pushed to main (session 49, 2026-02-26)
