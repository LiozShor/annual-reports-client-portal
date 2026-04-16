# Design Log 063: Reminder Settings Dialog
**Status:** [IMPLEMENTED]
**Date:** 2026-02-26
**Related Logs:** 059-automated-follow-up-reminder-system.md, 061-configurable-reminder-limits.md

## 1. Context & Problem
The reminder tab has settings scattered across two UI zones:
1. A full-width **settings bar** showing default max reminders with inline edit controls
2. A **global batch date** input ("תאריך אצווה הבא") crammed into the filter bar

The user wants to:
- Remove the batch date (not relevant — it was a specific-date setter, not what they need)
- Add a **day-of-month** setting (e.g., reminders go out on the 1st or 15th)
- Consolidate all settings into one button → modal dialog
- Design for extensibility (more settings may come later)

## 2. User Requirements
1. **Q:** Does the scheduler already have a day-of-month config?
   **A:** Unknown — investigation revealed: no. Currently just fetches `reminder_default_max`. New backend work needed.

2. **Q:** Any other settings for the dialog?
   **A:** Start with these two, but design for extensibility (more settings may be added later).

3. **Q:** Day picker format?
   **A:** Simple number input (1-28).

## 3. Research
### Domain
Settings Dialog UX, Admin Panel Patterns, Progressive Disclosure

### Sources Consulted
1. **"Don't Make Me Think" — Steve Krug** — Settings are infrequent, deliberate actions. Don't scatter them across the page — group them where users expect them.
2. **NNGroup — Settings & Preferences UX** — Settings belong behind a single entry point. Inline settings compete visually with the data they configure.
3. **Refactoring UI — Adam Wathan & Steve Schoger** — Small modals (≤420px) for lightweight configuration. Don't use 560px for two fields.

### Key Principles Extracted
- **Group related config together** — settings bar + batch date are siblings conceptually but live in different zones. Consolidate.
- **Settings ≠ Filters** — Filters control what you see; settings control how the system behaves. Never mix them.
- **Progressive disclosure** — A settings button hides complexity until the user asks for it.

### Patterns to Use
- **Settings gear button → modal** — Universal admin pattern. One click reveals all config.
- **Form field pattern from design system** — `.form-field` + `.form-label` + `.form-help` for each setting.

### Anti-Patterns to Avoid
- **Modal Hijack** — This modal is user-initiated (click "Settings"), not system-initiated. Safe.
- **Mystery Meat Navigation** — Include text label "הגדרות" alongside gear icon, not icon-only.

### Research Verdict
Consolidating into a settings modal is the correct pattern. Remove the settings bar (saves vertical space), remove the batch date from filters (wrong location), add a single settings button to the filter bar end.

## 4. Codebase Analysis
* **HTML** (`admin/index.html` lines 373-407): Settings bar at lines 373-386, global date at lines 403-407
* **CSS** (`admin/css/style.css`): `.reminder-settings-bar` lines 2293-2337 (45 lines), `.reminder-global-date` lines 2046-2058 (13 lines)
* **JS** (`admin/js/script.js`): 6 functions to remove (~60 lines): `updateDefaultMaxDisplay`, `editDefaultMax`, `cancelEditDefaultMax`, `saveDefaultMax`, `doSaveDefaultMax`, `applyGlobalReminderDate`
* **Modal pattern**: `.ai-modal-overlay` > `.ai-modal-panel` already used by `aiReassignModal` and `confirmDialog`
* **Config API**: Generic key-value upsert via `update_config` action — adding new keys requires zero changes to write path
* **RTL bug found**: `.reminder-global-date` uses `margin-right: auto` instead of `margin-inline-start: auto`
* **`.form-field` exists** (line 612) but `.form-label` and `.form-help` do not — need to add

## 5. Technical Constraints & Risks
* **Backend needed**: `reminder_send_day` config key is new. API must fetch + return it, scheduler must use it.
* **No breaking changes**: Per-client date picker (`showReminderDatePicker`) and per-client max edit (`editClientMax`) are NOT affected.
* **Config write path works**: The existing `update_config` action + upsert node handle any `config_key` — no n8n changes needed for saving.

## 6. Proposed Solution (The Blueprint)
### Frontend Changes

**HTML** — Remove settings bar + global date div, add settings button to filter bar, add modal near other modals.

**CSS** — Remove ~58 lines of dead CSS, add ~15 lines (`.reminder-settings-btn`, `.form-label`, `.form-help`, `.form-field` spacing).

**JS** — Remove 6 old functions, add 3 new (`openReminderSettingsModal`, `closeReminderSettingsModal`, `saveReminderSettings`), add `reminderSendDay` state var, update `loadReminders`.

### Backend Changes (n8n)

**API (`RdBTeSoqND9phSfo`):**
- Fetch Reminder Config: filter `OR({config_key}='reminder_default_max',{config_key}='reminder_send_day')`
- Build GET Response: extract + return `send_day`

**Scheduler (`FjisCdmWc4ef0qSV`):**
- Fetch Config: same OR filter
- Set Update Fields: use `send_day` for computing next `reminder_next_date`

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/index.html` | Modify | Remove settings bar + global date, add settings button + modal |
| `admin/css/style.css` | Modify | Remove ~58 lines dead CSS, add ~15 lines |
| `admin/js/script.js` | Modify | Remove 6 functions, add 3, update loadReminders |
| n8n `RdBTeSoqND9phSfo` | Modify | Config fetch filter + Build GET Response |
| n8n `FjisCdmWc4ef0qSV` | Modify | Config fetch + Set Update Fields |

## 7. Validation Plan
* [ ] Settings bar gone, global date gone
* [ ] "הגדרות" button visible at filter bar end
* [ ] Modal opens with current values pre-filled
* [ ] Save persists both values via API
* [ ] Day validation: 0, 29+ rejected in-modal
* [ ] Cancel/Escape closes without saving
* [ ] Per-client date picker still works
* [ ] Per-client max inline edit still works
* [ ] Toast confirms successful save
* [ ] RTL layout correct (button at start/left of filter bar)

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*

## Expert Consultation Summary
**Amara (UX):** Group settings together, validate in-modal before closing, include text label with icon.
**Renzo (Frontend):** Use `margin-inline-start: auto` (fix RTL bug), max-width 420px modal, clean up dead CSS/JS.
**Yuki (Visual):** Breathing room in modal, consistent spacing from design tokens, keep modal to 2 settings max.
