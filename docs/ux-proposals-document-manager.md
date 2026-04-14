# UX Improvement Proposals: Document Manager

**Date:** 2026-03-26
**Based on:** `docs/ux-audit-document-manager.md` + web research
**Status:** Proposals only — awaiting review before implementation

---

## Research Sources

| # | Source | URL | Key Insight |
|---|--------|-----|-------------|
| R1 | NN/g Progressive Disclosure | https://www.nngroup.com/articles/progressive-disclosure/ | Defer rarely-used features; show only what's needed for the current task |
| R2 | NN/g Accordions on Desktop | https://www.nngroup.com/articles/accordions-on-desktop/ | Avoid when users need most content visible; use when content is long and only 1-2 sections needed per visit |
| R3 | Material Design 3 Tabs | https://m3.material.io/components/tabs/guidelines | Max 6 tabs; use when sections are peers at the same hierarchy level |
| R4 | NN/g Tabs Used Right | https://www.nngroup.com/articles/tabs-used-right/ | Don't use tabs if users need to compare content across sections |
| R5 | Smashing Magazine Sticky Menus | https://www.smashingmagazine.com/2023/05/sticky-menus-ux-guidelines/ | Sticky elements should appear when the page's primary job is to help users act or save |
| R6 | GOV.UK Sticky Elements | https://technology.blog.gov.uk/2018/05/21/sticky-elements-functionality-and-accessibility-testing/ | Test sticky elements for keyboard navigation; keep them compact |
| R7 | NN/g Clickable Elements | https://www.nngroup.com/articles/clickable-elements/ | Signal clickability with visual affordances: borders, color contrast, cursor changes |
| R8 | Pencil & Paper Filter UX | https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering | Provide clear "Reset All" + individual filter clear; show applied filter count |
| R9 | Material Design Bidirectionality | https://m2.material.io/design/usability/bidirectionality.html | Use logical properties; mirror directional icons; keep text alignment natural |
| R10 | RTL Styling 101 | https://rtlstyling.com/posts/rtl-styling/ | Comprehensive RTL patterns for shadows, borders, transforms |
| R11 | NN/g Proximity of Actions | https://www.nngroup.com/articles/proximity-consequential-options/ | Don't place destructive/high-stakes actions in the same location as routine actions |
| R12 | Smashing Magazine Dangerous Actions | https://www.smashingmagazine.com/2024/09/how-manage-dangerous-actions-user-interfaces/ | Spatial separation + distinct styling for destructive vs. constructive actions |
| R13 | GitLab Saving Pattern | https://design.gitlab.com/patterns/saving-and-feedback/ | Show "Saving..."→"Saved ✓" inline with timestamp; debounce triggers |
| R14 | Baymard Accordion Pitfalls | https://baymard.com/blog/accordion-and-tab-design | Users rarely compare across accordion sections; OK when each section is independent |
| R15 | Jira UI/UX Review | https://createbytes.com/insights/jira-atlassian-ui-ux-yay-or-nay-review | Two-column layout for detail views: main content left, metadata sidebar right |
| R16 | Eleken CRM Design | https://www.eleken.co/blog-posts/how-to-design-a-crm-system-all-you-need-to-know-about-custom-crm | Minimize clicks per task; customize views by user role |
| R17 | GoodData Dashboard Architecture | https://www.gooddata.com/blog/six-principles-of-dashboard-information-architecture/ | "Inverted pyramid": KPIs at top, supporting detail below |

---

## Proposal 1: Reorder Sections — Action Zone First

### Problem
"Add Documents" is buried below 3 reference sections (audit H2). Users scroll past Notes, Communications, and Questions to reach the second-most-used feature.

### Research Backing
- **R1 (NN/g Progressive Disclosure):** Place primary actions within immediate reach; defer secondary/reference content.
- **R17 (GoodData):** "Inverted pyramid" — most actionable information at the top, supporting context below.

### Proposed Layout

```
┌──────────────────────────────────────────────┐
│ HEADER + CLIENT BAR                          │
├──────────────────────────────────────────────┤
│ STATUS OVERVIEW (progress bar + counts)      │
├──────────── PRIMARY ZONE ────────────────────┤
│ ▶ Add Documents (collapsible, blue)          │  ← MOVED UP
│                                              │
│ DOCUMENT LIST (always open)                  │
│   Person → Category → Document rows          │
│                                              │
│ ▶ Questions for Client (collapsible, orange) │
├──────────── SECONDARY ZONE ──────────────────┤
│ ┌─ gray background, "מידע נוסף" label ─────┐│
│ │ ▶ Questionnaire (collapsible)             ││
│ │ ▶ Report Notes (collapsible)              ││
│ │ ▶ Client Communications (collapsible)     ││
│ └───────────────────────────────────────────┘│
├──────────────────────────────────────────────┤
│ ACTIONS ROW (Save / Send)                    │
└──────────────────────────────────────────────┘
```

### Specific Changes
1. Move `card-section--brand` (Add Documents) to directly above `#existingDocs`
2. Move `card-section--warning` (Questions) to directly below `#existingDocs`
3. Wrap Questionnaire + Notes + Communications in a new `<div class="secondary-zone">` with a subtle header label "מידע נוסף"
4. Secondary zone gets `background: var(--gray-100)`, `border-radius: var(--radius-lg)`, `padding: var(--sp-4)`

### Why This Order
- **Add Documents first:** When the office reviews a client, they often need to add missing documents immediately. Having the dropdown right above the list lets them add → scroll down → verify → save.
- **Questions after docs:** Questions for client are contextual to the document review — "we need document X, please clarify Y."
- **Reference sections last:** Questionnaire, notes, and communications are "pull" content — the user opens them when needed, not on every visit.

### RTL Consideration
No RTL impact — this is a vertical reorder only. (R9, R10)

### Complexity: **S** (Small) — HTML reorder + one new wrapper div + CSS for secondary zone

---

## Proposal 2: Sticky Action Bar on Scroll

### Problem
On long document lists, the Save/Reset buttons at the bottom are off-screen (audit H1, L3). Users must scroll to the bottom to save, then back up to continue editing.

### Research Backing
- **R5 (Smashing Magazine):** Sticky elements are justified when "the page's primary job is to help users act or save."
- **R6 (GOV.UK):** Keep sticky bars compact (2-3 items max); test keyboard navigation.

### Proposed Behavior

```
Normal view (status overview visible):
┌──────────────────────────────────────┐
│ Status Overview (progress + counts)  │
│ Edit session pills (if changes)      │
├──────────────────────────────────────┤
│ Document list...                     │

After scrolling past status overview:
┌──────────────────────────────────────┐ ← sticky, top: 0
│ ▌██████░░░░▌  12/18 received        │ ← compact progress
│ 3 להסרה · 2 להוספה                  │ ← change summary (if any)
│ [שמור שינויים]  [אפס]              │ ← action buttons
├──────────────────────────────────────┤
│ Document list continues...           │
```

### Specific Changes
1. Create a `<div class="sticky-action-bar">` that mirrors the status overview in compact form
2. Use `IntersectionObserver` on `#statusOverview` to show/hide the sticky bar
3. Sticky bar contains:
   - One-line progress: mini progress bar (4px height) + "X/Y received" text
   - Edit session pill counts (same as existing, but inline)
   - Save + Reset buttons (duplicated from action row)
4. Sticky bar: `position: sticky; top: 0; z-index: 100; background: white; border-bottom: 1px solid var(--gray-200); box-shadow: 0 2px 4px rgba(0,0,0,0.05);`
5. Both sets of save buttons call the same function — no duplication of logic

### RTL Consideration
Sticky bar uses `flex` with `gap` — naturally adapts to RTL via `direction: rtl` inheritance. No additional mirroring needed. (R9)

### Mobile Behavior
On screens < 640px, the sticky bar shows only the progress bar + save button (no counts). This keeps it to one line (~48px height).

### Complexity: **M** (Medium) — new HTML element, IntersectionObserver JS, responsive CSS, duplicate button sync

---

## Proposal 3: Filter Affordance — Clear Button + Active State

### Problem
Count boxes are clickable filters, but the interaction is undiscoverable (audit M2). Double-click to clear is non-standard.

### Research Backing
- **R7 (NN/g Clickable Elements):** "Users should be able to tell at a glance what's clickable." Visual affordance: borders, color, cursor.
- **R8 (Pencil & Paper Filter UX):** Provide a visible "Clear All" button and show the count of active filters.

### Proposed Design

```
Default state (no filter):
┌─────────┬──────────┬──────────┬──────────┐
│  18     │   12     │    4     │    2     │
│  סה"כ   │  התקבל   │  חסר     │ אין צורך │
│         │   ●      │   ●      │   ●      │  ← colored dots hint clickability
└─────────┴──────────┴──────────┴──────────┘
             cursor: pointer on hover
             subtle hover: background darkens slightly

Filtered state (e.g., "חסר" active):
┌─────────┬──────────┬══════════╦──────────┐
│  18     │   12     ║    4     ║    2     │
│  סה"כ   │  התקבל   ║  חסר     ║ אין צורך │
│         │          ║  ● active║          │
└─────────┴──────────╚══════════╩──────────┘
                     ↑ thick border + bold

  ┌─────────────────────────────────┐
  │ מציג: חסר (4)    [× הצג הכל]  │  ← NEW: filter status line
  └─────────────────────────────────┘
```

### Specific Changes
1. Add `cursor: pointer` + `:hover` background change to all count boxes (may already exist — verify)
2. When a filter is active, show a new `<div class="filter-active-bar">` below the count boxes:
   - Text: "מציג: {status name} ({count})"
   - Button: "× הצג הכל" (Show all) — clears the filter
3. Keep double-click as undocumented power-user shortcut
4. Add a tooltip on first hover: "לחץ לסינון" (Click to filter) — show once per session via `sessionStorage`

### RTL Consideration
Filter bar text is Hebrew, naturally RTL. The "×" close button should be on the left (start) side in RTL context — use `margin-inline-start: auto` to push the clear button to the logical end. (R10)

### Complexity: **S** (Small) — one new conditional div, minor CSS, small JS change

---

## Proposal 4: Safer "Send to Client" Placement

### Problem
"Send to Client" occupies the same position as "Save Changes" — users habituated to clicking the bottom button may accidentally send (audit M1).

### Research Backing
- **R11 (NN/g Proximity):** "Placing a destructive option right next to a constructive one is a top-10 app design mistake."
- **R12 (Smashing Magazine):** Use spatial separation + distinct visual styling for high-stakes actions.

### Proposed Design

```
BEFORE:
┌──────────────────────────────────────┐
│ (when no changes)                    │
│        [🔵 שלח ללקוח]              │ ← same position as Save
│                                      │
│ (when changes exist)                 │
│   [🔵 שמור שינויים]    [אפס טופס] │
└──────────────────────────────────────┘

AFTER:
┌──────────────────────────────────────┐
│ Client Info Bar:                     │
│ שם: כהן  │  שנה: 2025  │  שלב: X   │
│                        [📤 שלח ללקוח]│ ← MOVED to client bar
└──────────────────────────────────────┘

  ... (rest of page) ...

┌──────────────────────────────────────┐
│ Actions Row (only when changes):     │
│   [🔵 שמור שינויים]    [אפס טופס] │
└──────────────────────────────────────┘
```

### Specific Changes
1. Move `#approveSendBtn` into `.client-bar` as the last item
2. Style it as `btn btn-success btn-sm` (smaller than current `btn-lg`)
3. Show it only when `stage >= Collecting_Docs` (stages where sending makes sense)
4. Add a confirmation dialog specific to Send: "אתה עומד לשלוח את רשימת המסמכים ללקוח. X מסמכים חסרים. להמשיך?" with a summary of what the client will see
5. Remove the `#approve-send-row` div from the action row entirely
6. Action row now only shows Save/Reset when changes exist, otherwise it's empty/hidden

### RTL Consideration
Button in client bar should align to the logical start (right in RTL). Use `margin-inline-start: auto` on the button to push it to the left edge of the client bar. (R9)

### Conflict Note
If **Proposal 2** (sticky bar) is implemented, the sticky bar should NOT include "Send to Client" — only Save/Reset. This reinforces the spatial separation.

### Complexity: **S** (Small) — move one button, add confirmation dialog, minor CSS

---

## Proposal 5: Auto-Save Feedback for Report Notes

### Problem
Notes textarea auto-saves on blur with no visual confirmation (audit M5).

### Research Backing
- **R13 (GitLab Saving Pattern):** Two states: "Saving..." (with spinner) → "Saved ✓" (with timestamp). Show inline near the trigger.

### Proposed Design

```
┌─ Report Notes ──────────────────────┐
│ ┌──────────────────────────────────┐│
│ │ הערות לדוח...                    ││
│ │                                  ││
│ └──────────────────────────────────┘│
│                        ✓ נשמר 14:32 │ ← appears after blur+save
│                          ↑ fades    │
│                            after 3s │
└─────────────────────────────────────┘

During save:
│                        ○ שומר...    │ ← spinner + "Saving..."
```

### Specific Changes
1. Add a `<span class="save-indicator" id="notesSaveIndicator"></span>` below the textarea
2. On blur: show "○ שומר..." → on success: "✓ נשמר {time}" → fade after 3s
3. On error: "✕ שגיאה בשמירה" in red, persistent until next attempt
4. CSS: `font-size: var(--text-xs); color: var(--gray-500); text-align: start;`

### Complexity: **S** (Small) — one span, minor JS in the blur handler, CSS animation

---

## Proposal 6: Unify Collapsible Card Colors

### Problem
4 different card accent colors add visual noise without clear meaning (audit L1).

### Research Backing
- **R17 (GoodData):** "Visual hierarchy must align with logical hierarchy." Color should encode meaning, not decoration.
- **R14 (Baymard):** Accordion sections should be visually peers unless there's a reason to distinguish.

### Proposed Design

All cards use neutral styling (default gray border) **except:**
- **Questions for Client** keeps orange/warning accent ONLY when there are unanswered questions (badge count > 0)
- When all questions are answered or there are no questions, it reverts to neutral

This makes the orange accent a **signal** — "attention needed here" — rather than a permanent decoration.

### Specific Changes
1. Remove `card-section--brand` class from Add Documents → use default `card-section`
2. Remove `card-section--info` class from Client Communications → use default `card-section`
3. Make `card-section--warning` on Questions conditional: add/remove class based on question count
4. In the secondary zone (from Proposal 1), all cards are neutral by default — the zone's recessed background already signals "secondary"

### RTL Consideration
No RTL impact — color changes only.

### Complexity: **S** (Small) — CSS class changes + minor JS conditional

---

## Proposal 7: Questionnaire Loading State

### Problem
Expanding questionnaire before pre-fetch completes shows empty content (audit M4).

### Research Backing
- **R1 (NN/g Progressive Disclosure):** Content revealed on demand must load fast or show a loading state. Empty content damages trust.

### Proposed Design

```
▼ השאלון השנתי — הוגש ב-15/01/2026
┌──────────────────────────────────────┐
│     ○                                │
│   טוען שאלון...                      │  ← spinner + text
│                                      │
└──────────────────────────────────────┘
```

### Specific Changes
1. Initialize `#questionnaireContent` innerHTML with a spinner:
   ```html
   <div class="questionnaire-loading">
     <div class="spinner"></div>
     <span class="text-sm text-muted">טוען שאלון...</span>
   </div>
   ```
2. Replace with actual content when fetch completes
3. If fetch fails, show error state with retry button

### Complexity: **S** (Small) — initial HTML + minor JS

---

## Proposal 8: Clickable Edit Session Pills

### Problem
Edit pills show "3 להסרה" but don't help navigate to the changed documents (audit L3).

### Research Backing
- **R16 (Eleken CRM):** "Minimize clicks per task." If the system knows which items changed, it should help the user find them.

### Proposed Design

```
Edit session bar:
┌────────────────────────────────────────────────┐
│ 📄 18 נדרשים │ ❌ 3 להסרה ▸ │ ➕ 2 להוספה ▸ │ │
└────────────────────────────────────────────────┘
                 ↑ clickable     ↑ clickable
                 scrolls to      scrolls to
                 first removed   first added
                 + highlights    + highlights
```

### Specific Changes
1. Add `cursor: pointer` and `onclick` to the danger/success/info pills
2. On click: `document.querySelector('.marked-for-removal')?.scrollIntoView({ behavior: 'smooth', block: 'center' })` + add a brief `pulse` animation class
3. Subsequent clicks cycle through all matching elements (track index per category)
4. In the sticky bar (Proposal 2), same behavior applies

### Complexity: **S** (Small) — click handlers + scrollIntoView + CSS pulse animation

---

## Prioritized Roadmap

### Phase 1: Quick Polish (no structural changes)
**Effort:** ~2 hours total
**User impact:** "Small things feel smoother — save confirmation, loading states, clearer filters."

| # | Proposal | Effort | Dependencies |
|---|----------|--------|--------------|
| P5 | Auto-save feedback for notes | S | None |
| P7 | Questionnaire loading state | S | None |
| P3 | Filter clear button + active state | S | None |
| P8 | Clickable edit session pills | S | None |

### Phase 2: Section Reorder + Color Cleanup
**Effort:** ~3 hours total
**User impact:** "The page makes more sense now — the things I need are at the top, the reference stuff is tucked away but still accessible."

| # | Proposal | Effort | Dependencies |
|---|----------|--------|--------------|
| P1 | Reorder sections (action zone first) | S | None |
| P6 | Unify card colors | S | Best done together with P1 |
| P4 | Move "Send to Client" to client bar | S | None |

**Conflicts:** None between proposals in this phase.

### Phase 3: Sticky Action Bar
**Effort:** ~4 hours
**User impact:** "I never have to scroll to the bottom to save anymore. The progress bar follows me."

| # | Proposal | Effort | Dependencies |
|---|----------|--------|--------------|
| P2 | Sticky action bar on scroll | M | Best after P1 (section reorder), since the sticky bar mirrors the status overview |

**Note:** P2 benefits from P4 being done first — if "Send to Client" is already moved to the client bar, the sticky bar only needs Save/Reset.

### Conflict Matrix

| Proposal pair | Conflict? |
|---------------|-----------|
| P1 + P2 | Synergy — P1's reorder makes P2's sticky bar simpler |
| P2 + P4 | Synergy — P4 removes Send from action row, simplifying P2 |
| P1 + P6 | Synergy — secondary zone naturally uses neutral colors |
| P3 + P2 | Independent — filter bar is in status overview, sticky bar is separate |

No proposals conflict with each other. All are additive.

---

## What NOT to Do (Based on Research)

1. **Don't convert to a tabbed interface** — Per R4 (NN/g Tabs), tabs are wrong when sections aren't peers at the same hierarchy level. Document list ≠ questionnaire ≠ notes. The accordion pattern is correct for this page; the problem is ordering, not the pattern. (This retires audit suggestion LR2.)

2. **Don't add a sidebar navigation** — The page is already 960px max-width. A sidebar would either cramp the document list or require a wider layout. CPA employees use this on standard monitors, not widescreen. Per R15 (Jira), two-column layouts work for detail views, but this page's content is too vertically sequential for a sidebar to help.

3. **Don't hide the document list behind progressive disclosure** — The document list IS the page. Per R2 (NN/g Accordions), avoid hiding content that users need on every visit.

---

## RTL-Specific Notes for All Proposals

Based on R9 (Material Design Bidirectionality) and R10 (RTL Styling 101):

1. The existing codebase already uses CSS logical properties (`margin-inline-start`, `padding-inline-end`) in the design system — continue this pattern for all new CSS
2. Any new icons with directional meaning (arrows, chevrons) should be mirrored in RTL. The existing `arrow-right` in the back button is correctly pointing right (→) for RTL "back" navigation
3. The sticky bar's progress text ("12/18 received") reads naturally in Hebrew — numbers are always LTR within RTL text, which is correct
4. Filter status line ("מציג: חסר (4)") — parenthetical numbers in Hebrew text render correctly without special handling
5. No changes to `dir="rtl"` on `<html>` — all proposals inherit RTL naturally
