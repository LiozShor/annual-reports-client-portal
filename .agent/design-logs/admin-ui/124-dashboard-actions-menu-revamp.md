# Design Log 124: Dashboard Actions Menu Revamp
**Status:** ✅ TESTED & VERIFIED
**Date:** 2026-03-08
**Related Logs:** DL-037 (admin portal UX refactor), DL-059 (reminder system), DL-116/120 (questionnaires tab), DL-123 (action menu UX research)

## 1. Context & Problem
The Dashboard row-level actions menu (⋮ 3-dot) is limited. Currently it only has archive/reactivate. The inline buttons (`Send Questionnaire` at stage 1, `Set Reminder` at stages 2-3) don't fully match the admin's workflow needs:
- No way to **view a client's questionnaire answers** from the Dashboard
- "הגדר תזכורת" (Set Reminder) only sets a future date — doesn't actually send a reminder now
- Admin wants a quick "send reminder" action that fires immediately

## 2. User Requirements
1. **Q:** Should "See Questionnaire" open in a new tab, switch to Questionnaires tab, or expand inline?
   **A:** Open in new tab.

2. **Q:** Should "Send Reminder" send immediately with confirm, show preview first, or just send?
   **A:** Confirm dialog then send.

3. **Q:** At which stages should "See Questionnaire" be available?
   **A:** Stages 3+ (after the client answered the questionnaire).

4. **Q:** Should Type A/B reminders be separate items, one smart item, or a submenu?
   **A:** One smart item — auto-detects type based on stage.

## 3. Research
### Domain
Contextual Action Menus in Admin Data Tables

### Sources Consulted
1. **NNGroup — Contextual Menu Guidelines** — Reserve contextual menus for secondary actions. Kebab for item-specific, hamburger for navigation. Never single-item menus.
2. **NNGroup — Confirmation Dialogs** — Overuse causes "dialog fatigue." Only for irreversible actions. Specificity matters: name the entity.
3. **Smashing Magazine — Managing Dangerous Actions** — Severity ladder: no confirm for reversible, inline guard for medium, modal for high risk. Three layers for destructive: color + icon + specific verb.
4. **PatternFly Design System — Menu Guidelines** — Destructive items at bottom with divider. Icons: all or none consistency.
5. **Linear App — Invisible Details** — Put nearly every action in the context menu. Users shouldn't navigate away.

### Key Principles Extracted
- **Progressive disclosure:** Frequent actions visible inline; secondary actions in the overflow menu (NNGroup). Our "send reminder" is frequent enough for inline, but "view questionnaire" and "archive" are secondary.
- **Confirmation only for irreversible:** Sending a reminder is not destructive but IS irreversible (email sent). Confirm dialog is correct (NNGroup). Archive is also irreversible → keep confirm.
- **Specificity in confirm dialogs:** "Send Type A reminder to [name]?" is better than "Are you sure?" (NNGroup).
- **Destructive at bottom, separated by divider:** Archive stays at the bottom with `<hr>` (PatternFly, Dell DS, Linear).

### Patterns to Use
- **Smart action button:** One "שלח תזכורת" that calls `send_now` via the existing `executeReminderAction` API. Type detection happens server-side (n8n workflow already handles it based on stage).
- **Lazy-load questionnaire data:** Reuse `generateQuestionnairePrintHTML` for the view. If `questionnairesData` isn't loaded yet, fetch on-demand from the admin-questionnaires endpoint.

### Anti-Patterns to Avoid
- **Over-stuffing the menu:** Don't add every possible action. Keep it to 4-5 items max per state.
- **Duplicating reminder logic client-side:** The n8n workflow already knows Type A vs B based on stage. Don't re-implement detection in JS.

### Research Verdict
Minimal changes: replace "set reminder date" with "send reminder now" (reusing existing `send_now` action), add "view questionnaire" (reusing print HTML generator). Both the inline buttons and the context menu (right-click) need updating.

## 4. Codebase Analysis
### Existing Solutions Found
- **`executeReminderAction('send_now', [reportId])`** — already sends a reminder immediately via POST to `/admin-reminders` webhook. Includes exhaustion guard, 24h cooldown guard, and confirm dialog. Fully functional.
- **`reminderAction('send_now', reportId)`** — wrapper with all the guard logic (lines 3821-3852). Currently only used in Reminders tab but is generic enough to call from Dashboard.
- **`generateQuestionnairePrintHTML(items)`** — generates a full HTML page for questionnaire viewing/printing. Used by `printSingleQuestionnaire`.
- **`questionnairesData`** — loaded when Questionnaires tab is visited; may be empty from Dashboard context.
- **`loadQuestionnaires()`** — fetches from `/admin-questionnaires` endpoint.

### Reuse Decision
- **Reuse `executeReminderAction`** directly for send reminder — no new API needed.
- **Reuse `generateQuestionnairePrintHTML`** for view — just open without triggering `print()`.
- **Need small adapter:** `viewQuestionnaire(reportId)` that fetches Q data on-demand if not cached.

### Relevant Files
| File | Why |
|------|-----|
| `admin/js/script.js` | Inline row HTML (L279-336), context menu (L4423-4476), reminder functions (L3821-3852), questionnaire print (L5500-5515) |
| `admin/css/style.css` | `.row-menu` styles (L2692-2751) — no CSS changes needed |

### Alignment with Research
- Current menu follows Linear's pattern (context menu mirrors inline actions). We'll maintain this.
- Destructive action (archive) already at bottom with divider — matches PatternFly/Dell DS.
- Confirm dialog for send uses specific entity name — matches NNGroup recommendation.

## 5. Technical Constraints & Risks
- **Security:** `executeReminderAction` already validates auth token. No new endpoint needed.
- **Risks:** `questionnairesData` may not be loaded when user clicks "View Questionnaire" from Dashboard. Must handle lazy-loading.
- **Breaking Changes:** None. We're replacing one menu item and adding another. Existing API stays the same.
- **Data dependency:** The `reminderAction` function (L3821) reads from `remindersData` for exhaustion/cooldown guards. From the Dashboard tab, `remindersData` may also be empty. We need a simpler confirm flow from the Dashboard (no exhaustion/cooldown guards — those are niceties, not blockers).

## 6. Proposed Solution (The Blueprint)

### Menu Layout — Active Clients

**Inline buttons (visible in row):**
| Stage | Button |
|-------|--------|
| 1 (Send Questionnaire) | 📨 Send Questionnaire (unchanged) |
| 2 (Waiting for Answers) | 🔔 Send Reminder |
| 3 (Collecting Docs) | 🔔 Send Reminder |

**Overflow menu (⋮ 3-dot) — active clients:**
| Stage | Items |
|-------|-------|
| 3+ | 📋 צפה בשאלון (View Questionnaire) |
| Always | 🔗 צפייה כלקוח (View as Client) |
| Always | --- |
| Always | 🗄️ העבר לארכיון (Archive) — danger |

**Overflow menu — archived clients:** unchanged (View as Client + Reactivate).

### Logic Flow

**A. Replace inline "Set Reminder" button with "Send Reminder":**
1. Change icon from `bell-plus` to `bell-ring`
2. Change title from "הגדר תזכורת" to "שלח תזכורת"
3. Change onclick from `setManualReminder(rid, name)` to `sendDashboardReminder(rid, name)`

**B. New function `sendDashboardReminder(reportId, clientName)`:**
```javascript
function sendDashboardReminder(reportId, clientName) {
    showConfirmDialog(
        `לשלוח תזכורת ל${escapeHtml(clientName)}?`,
        () => executeReminderAction('send_now', [reportId]),
        'שלח תזכורת'
    );
}
```
Simple confirm → send. No exhaustion/cooldown guards (those are in the Reminders tab where the admin has full context). Dashboard is for quick actions.

**C. Add "View Questionnaire" to overflow menu (stages 3+):**
```javascript
if (stageNum >= 3) {
    items += `<button onclick="viewQuestionnaire('${rid}'); closeAllRowMenus();">
        <i data-lucide="file-text"></i> צפה בשאלון</button>`;
}
```

**D. New function `viewQuestionnaire(reportId)`:**
1. Check if `questionnairesData` has an item with matching `report_record_id`
2. If not found, fetch from `/admin-questionnaires` API (sets `questionnairesData` as a side-effect)
3. Find the matching item, call `generateQuestionnairePrintHTML([item])`
4. Open in new window WITHOUT triggering print

**E. Update context menu (right-click) to match:**
Same changes as inline + overflow: add "View Questionnaire" at stages 3+, replace "Set Reminder" with "Send Reminder" at stages 2-3.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Replace setManualReminder calls with sendDashboardReminder, add viewQuestionnaire to menu, add 2 new functions |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Stage 1 client: row shows "Send Questionnaire" button only, no reminder button
* [ ] Stage 2 client: row shows "Send Reminder" button (bell-ring icon), clicking shows confirm dialog, confirming sends reminder and shows success toast
* [ ] Stage 3 client: row shows "Send Reminder" button, overflow menu shows "צפה בשאלון"
* [ ] Stage 4+ client: overflow menu shows "צפה בשאלון", no reminder button
* [ ] "צפה בשאלון" opens questionnaire in new tab (formatted HTML view, no auto-print)
* [ ] "צפה בשאלון" works even if Questionnaires tab was never opened (lazy-load)
* [ ] Right-click context menu matches the inline/overflow items
* [ ] "View as Client" and "Archive" still work as before
* [ ] Archived clients: menu unchanged (View as Client + Reactivate)
* [ ] No regression in Reminders tab functionality

## 8. Implementation Notes (Post-Code)
* `generateQuestionnairePrintHTML` has no embedded auto-print — the callers trigger `print()` separately. So `viewQuestionnaire` simply doesn't call `.print()` (no regex stripping needed).
* `sendDashboardReminder` calls `executeReminderAction('send_now')` directly (bypasses `reminderAction` guard wrapper) — intentional for quick Dashboard use without exhaustion/cooldown checks.
* Added `const stageNum = STAGES[stage]?.num || 0;` in context menu builder since the variable wasn't in scope there (unlike the row template which has it from the parent scope).
