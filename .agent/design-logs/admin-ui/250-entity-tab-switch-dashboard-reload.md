# Design Log 250: Entity Tab Switch Doesn't Reload Dashboard
**Status:** [COMPLETED]
**Date:** 2026-04-12
**Related Logs:** DL-247 (tab switching SWR), DL-216 (filing type scoping)

## 1. Context & Problem
Switching between AR (דוחות שנתיים) and CS (הצהרות הון) entity tabs while on the dashboard doesn't reload the table data. The entity tab visually switches but the clients table stays frozen showing the previous filing type's data. Works after a manual page refresh.

Root cause: DL-247 refactored `switchEntityTab()` to use opacity fades instead of full-screen overlays, but the `dashboard` case was omitted from the tab reload section. Additionally, a dead code block (`if (dashboardLoaded)`) was left behind — it always evaluates to `false` because `dashboardLoaded` is set to `false` three lines above it.

## 2. User Requirements
*Bug report — no discovery questions needed.*

## 3. Research
Skipped — single missing case in a conditional, not a design problem.

## 4. Codebase Analysis
* **File:** `admin/js/script.js` — `switchEntityTab()` at line 1121
* **Line 1149:** `dashboardLoaded = false; dashboardLoadedAt = 0;` — invalidates cache
* **Line 1161:** `if (dashboardLoaded) { recalculateStats(); ... }` — dead code, never executes
* **Lines 1174-1178:** Reload section handles `send`, `questionnaires`, `reminders`, `review` — but NOT `dashboard`
* **Confirmed via Playwright:** After entity switch, `dashboardLoaded === false` and `clientsData` still holds old AR data (40 items, mixed filing types, never re-fetched)

## 5. Technical Constraints & Risks
* **Security:** None
* **Risks:** None — adding a missing case to an existing pattern
* **Breaking Changes:** None

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Switching entity tabs on the dashboard reloads the table with the correct filing type's clients.

### Logic Flow
1. Remove dead `if (dashboardLoaded)` block (lines 1160-1165)
2. Add `else if (activeTab === 'dashboard') loadDashboard();` to reload section

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Remove dead code block + add dashboard case to reload section |

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status

## 7. Validation Plan
* [ ] Dashboard tab: switch AR → CS → table reloads with CS clients
* [ ] Dashboard tab: switch CS → AR → table reloads with AR clients
* [ ] Review tab: switch entity → still works (existing `loadDashboard()` call)
* [ ] Send/Questionnaires/Reminders tabs: switch entity → still works
* [ ] No console errors during any entity switch
* [ ] Stat cards update to reflect correct filing type counts

## 8. Implementation Notes (Post-Code)
* Removed dead `if (dashboardLoaded)` block — was always false since `dashboardLoaded` was set to `false` above it
* Added `dashboard` and `review` cases to the reload section
* Fixed `.tab-refreshing` (opacity fade) being applied to ALL tabs but only removed for tabs with load functions — import tab stayed at 50% opacity permanently. Now fade only applied to tabs that actually fetch data (send, questionnaires, reminders)
* Added filing type badge (`ai-filing-type-badge`) to import tab header — shows active filing type (דוח שנתי / הצהרת הון) so entity switch has visible feedback on import tab
* 3 commits: dashboard reload fix → opacity fade fix → filing type badge
