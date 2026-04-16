# Design Log 130: Dashboard Reminder Warnings + Sent Count History Click

**Status:** [DRAFT]
**Date:** 2026-03-09
**Related Logs:** DL-059 (reminder system), DL-078 (reminder tab UX), DL-099 (suppress overhaul), DL-109 (history popover)

## 1. Context & Problem

The reminder tab has a 3-tier warning system before sending reminders (recently sent <24h, max exceeded, suppressed). But the **main client table** on the dashboard has a "Send Reminder" button (`sendDashboardReminder`) that skips all these checks — it just shows a plain "Send reminder to X?" confirm dialog. This means an admin can accidentally double-send or send to a suppressed/exhausted client from the dashboard without any warning.

Additionally, the "נשלחו" (sent count) column in the reminder tab should be clickable to open the history popover, same as the "נשלח לאחרונה" (last sent) column already does.

## 2. User Requirements

1. **Q:** Which reminder indicators do you want in the main table?
   **A:** All of them — recently sent (24h), max exceeded, suppressed/muted.

2. **Q:** How should they appear?
   **A:** On the action buttons — warnings appear when pressing the send reminder button (not as permanent visible badges).

3. **Q:** When should reminder data be loaded?
   **A:** On-demand when the reminder/send button is clicked.

4. **Q:** Should clicking the indicator do anything?
   **A:** Show tooltip only (details about last sent, count, status).

5. **Q:** Should "נשלחו" column also open history popover?
   **A:** Yes, behave exactly like "נשלח לאחרונה".

## 3. Research

### Domain
Confirmation Dialog UX, Progressive Disclosure, Warning Severity Tiers

### Sources Consulted
1. **NNGroup — "Confirmation Dialogs Can Prevent User Errors"** — Overusing confirm dialogs trains users to click through on autopilot. Reserve them for high-cost actions. Match interruption level to severity.
2. **NNGroup — "Indicators, Validations, and Notifications"** — Three-tier: indicators (passive), validations (contextual), notifications (interrupting). Each for different severity.
3. **Smashing Magazine — "How To Manage Dangerous Actions in User Interfaces"** — Never ask vague "Are you sure?" — state the specific consequence. Use descriptive button text.

### Key Principles Extracted
- **Match interruption to severity:** Suppressed = block (strongest), exhausted = strong warning, recently sent = moderate warning, clean = simple confirm.
- **State specific consequences:** "Sent 3 hours ago" is better than "Are you sure?"
- **Don't reuse same dialog for all severities:** Differentiate the messaging.

### Patterns to Use
- **Tiered confirmation:** Reuse the existing `reminderAction()` 3-tier logic (already proven in reminder tab)
- **On-demand data fetch:** Load reminder data for the specific client only when needed, using existing `admin-reminders` API

### Anti-Patterns to Avoid
- **Loading all reminder data on dashboard load:** Wasteful, slows initial load for a rarely-needed check
- **Showing permanent badges:** User explicitly didn't want visible indicators cluttering the table

### Research Verdict
Reuse the existing `reminderAction()` warning logic from the reminder tab. The `sendDashboardReminder()` function needs to fetch reminder data on-demand (if not already cached) and then run the same tier checks before sending.

## 4. Codebase Analysis

### Existing Solutions Found
- **`reminderAction()` (line 3830):** Already implements the exact 3-tier warning system needed
- **`isExhausted()` (line 3496):** Checks if reminder_count >= max
- **`remindersData` (line 3426):** Global cache of reminder data, populated by `loadReminders()`
- **`reminderLoaded` (line 3427):** Boolean flag indicating if data was fetched
- **`loadReminders(silent=true)` (line 3431):** Can silently fetch reminder data without UI loading indicator

### Reuse Decision
- Reuse `reminderAction()` directly — it already handles all 3 tiers
- Reuse `loadReminders(true)` for silent background fetch if data not yet loaded
- No new API calls or endpoints needed

### Relevant Files
| File | Lines | Purpose |
|------|-------|---------|
| `admin/js/script.js` | 4042-4048 | `sendDashboardReminder()` — needs rewrite |
| `admin/js/script.js` | 3830-3861 | `reminderAction()` — reuse as-is |
| `admin/js/script.js` | 3431-3470 | `loadReminders()` — call if not cached |
| `admin/js/script.js` | 3700 | "נשלחו" cell — already fixed (clickable history) |

### Dependencies
- `admin-reminders` API endpoint (existing, no changes needed)
- `remindersData` global array + `reminderLoaded` flag

## 5. Technical Constraints & Risks

* **Security:** No new endpoints or auth changes needed — reuses existing API
* **Risks:** Minimal — only changing the confirmation flow before send, not the actual send logic
* **Breaking Changes:** None — `reminderAction()` is already battle-tested in the reminder tab
* **Edge case:** If reminder data fails to load, fall back to the simple confirm (current behavior) so sending isn't blocked

## 6. Proposed Solution (The Blueprint)

### Logic Flow

1. User clicks "Send Reminder" in main client table → `sendDashboardReminder(reportId, clientName)`
2. Check if `reminderLoaded` is true (data already cached from reminder tab visit)
3. If not loaded → `await loadReminders(true)` (silent fetch, no loading spinner)
4. Call `reminderAction('send_now', reportId)` — this runs the existing 3-tier check:
   - Tier 1: Suppressed → blocked (suppressed clients shouldn't have send button, but safety net)
   - Tier 2: Exhausted (count >= max) → strong warning with override
   - Tier 3: Recently sent (<24h) → moderate warning with hours info
   - Clean → simple confirm "Send reminder to X?"
5. If `loadReminders` fails → fall back to simple confirm (current behavior)

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Rewrite `sendDashboardReminder()` to fetch data + delegate to `reminderAction()` |
| `admin/js/script.js` | Already done | "נשלחו" cell clickable with history popover (line 3700) |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy unchecked Section 7 items to `current-status.md`

## 7. Validation Plan

* [ ] Click "Send Reminder" from dashboard for a client with no prior reminders → simple confirm appears
* [ ] Click "Send Reminder" for a client who was reminded <24h ago → warning shows hours since last send
* [ ] Click "Send Reminder" for an exhausted client (count >= max) → strong warning with count/max info
* [ ] Click "Send Reminder" when reminder data NOT yet loaded → data loads silently, then warning appears
* [ ] Click "Send Reminder" when reminder data already cached → no extra API call, warning appears instantly
* [ ] If API fails to load reminder data → falls back to simple confirm (not blocked)
* [ ] "נשלחו" column in reminder tab → click opens history popover (same as "נשלח לאחרונה")
* [ ] Verify reminder tab behavior unchanged — all existing warnings still work

## 8. Implementation Notes (Post-Code)
*TBD*
