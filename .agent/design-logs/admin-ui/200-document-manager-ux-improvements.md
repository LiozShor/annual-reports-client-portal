# Design Log 200: Document Manager UX Improvements
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-26
**Related Logs:** DL-150 (Collapsible Card Redesign — DEPRECATED by this log), DL-045 (Status Overview — Draft), DL-068 (Visual Hierarchy — Draft)

## 1. Context & Problem

The Document Manager page (`document-manager.html`) has grown organically — features added over time (notes, client notes, questionnaire, questions, add docs) created a cluttered interface. CPA firm employees process 500+ clients and need efficiency. A UX audit (`docs/ux-audit-document-manager.md`) identified 10 pain points. Research-backed proposals (`docs/ux-proposals-document-manager.md`) were produced with 17 cited sources. This log implements 9 approved improvements across 3 phases.

## 2. User Requirements

1. **Q:** DL-150 overlap?
   **A:** Supersede DL-150 — mark it [DEPRECATED].

2. **Q:** Sticky bar when no pending changes?
   **A:** Always visible after scrolling past status overview. Shows progress + Send when no changes, progress + Save/Reset when changes exist.

3. **Q:** Secondary zone label clickable?
   **A:** Static label only. Individual sections remain independently collapsible.

4. **Q:** Send to Client focus behavior?
   **A:** Use existing `showConfirmDialog()` as-is. No focus change needed.

## 3. Research

### Domain
Admin Dashboard UX, Progressive Disclosure, RTL Layout

### Sources Consulted
See `docs/ux-proposals-document-manager.md` for full 17-source research table. Key sources:
1. **NN/g Progressive Disclosure** — Defer rarely-used features; show primary actions first
2. **NN/g Accordions on Desktop** — Accordions correct when sections aren't peers; tabs wrong here
3. **Material Design Bidirectionality** — Use CSS logical properties; mirror directional icons
4. **Smashing Magazine Sticky Menus** — Sticky elements justified when page's job is to help users act/save
5. **GitLab Saving Pattern** — "Saving..."→"Saved ✓" inline with timestamp

### Research Verdict
Accordion pattern is correct — problem is ordering and grouping, not the pattern itself. Reorder sections by action priority, add sticky bar for long lists, improve affordance on interactive elements.

## 4. Codebase Analysis

### Existing Solutions Found
- `showToast()` (line 140) — fixed-position toast, already used for notes save feedback
- `showConfirmDialog()` (line 1938) — callback-based confirm dialog, 4 params
- `.spinner` class in design-system.css (line 571) — existing CSS spinner
- `.badge` classes in design-system.css (line 267) — badge variants available
- `updateStatusOverview()` (line 1173) — controls edit session bar visibility + status counts
- `toggleStatusFilter()` (line 1241) — existing filter toggle with click/dblclick
- `handleNotesSave()` (line 305) — blur handler, already uses showToast
- `loadQuestionnaireForReport()` (line 2047) — already has basic loading text

### Reuse Decision
- Reuse `.spinner` for questionnaire loading (no need to create new spinner)
- Reuse `showConfirmDialog()` for Send confirmation (extend message content, not function signature)
- Replace `showToast()` in notes save with inline indicator (toast is too heavy for auto-save)
- Reuse `updateStatusOverview()` — extend it to also update sticky bar and question card accent

### Key Files
| File | Lines | Role |
|------|-------|------|
| `document-manager.html` | 416 | Page structure — reorder sections, add sticky bar HTML, add secondary zone wrapper |
| `document-manager.css` | 1621 | Styles — sticky bar, save indicator, filter clear button, pill hover, secondary zone |
| `document-manager.js` | 2529 | Logic — all 9 features' JS changes |

### Alignment with Research
- Current accordion pattern matches NN/g recommendation — keep it
- Section ordering violates "inverted pyramid" principle — fix via reorder
- Count boxes already have `cursor: pointer` — good, but need stronger hover affordance
- No sticky elements exist — adding one follows Smashing Magazine guidance

## 5. Technical Constraints & Risks

* **Security:** No security implications — all changes are CSS/HTML/client-side JS
* **Risks:** Section reorder could confuse existing users briefly (mitigated: all sections still exist, just reordered)
* **Breaking Changes:** None — all existing functionality preserved. Edit session pills get new onclick but retain existing text updates.
* **RTL:** All new CSS must use logical properties. Verified: existing codebase uses `border-inline-start`, `margin-inline-start` etc.
* **`card-section--info`:** Has no CSS definition — class exists in HTML only. Removing it from Communications card has zero visual effect.

## 6. Proposed Solution (The Blueprint)

### Phase 1: Quick Polish (no structural changes)

#### P1. Auto-save confirmation for Report Notes
- **HTML:** Add `<span id="notesSaveIndicator" class="save-indicator"></span>` after the textarea in `#notesSection`
- **CSS:** `.save-indicator` — `font-size: var(--text-xs); color: var(--success-600); opacity: 0; transition: opacity 0.3s;` + `.save-indicator.show { opacity: 1; }` + `.save-indicator.error { color: var(--danger-600); }`
- **JS:** In `handleNotesSave()`: replace `showToast` calls with inline indicator updates. On success: show "✓ נשמר", fade after 2s. On error: show "✕ שגיאה בשמירה" in red, persistent.

#### P2. Questionnaire loading state
- **HTML:** Set initial content of `#questionnaireContent` to centered spinner using existing `.spinner` class
- **JS:** In `loadQuestionnaireForReport()`: replace inline loading text (line 2053) with spinner HTML. On error: add retry button that resets `_questionnaireFetched = false` and re-calls the function.
- **CSS:** `.questionnaire-loading` — centered flex container with spinner + text

#### P3. Filter clear button
- **HTML:** Add `<div id="filterActiveBar" class="filter-active-bar" style="display:none;">` after `.status-count-boxes` div
- **CSS:** `.filter-active-bar` — flex row with text + button. `.filter-active-bar .filter-clear-btn` — small ghost button style
- **JS:** In `toggleStatusFilter()` and `applyStatusFilter()`: show/hide the filter bar based on `activeStatusFilter`. Add `clearStatusFilter()` function called by the button.

#### P4. Clickable edit session pills
- **HTML:** Add `onclick` and `data-target` attributes to the 3 change pills (danger/success/info). Add `role="button"` and `tabindex="0"`.
- **CSS:** `.stat-pill[onclick] { cursor: pointer; }` + `.stat-pill[onclick]:hover { filter: brightness(0.9); }` + `@keyframes pulseHighlight` animation
- **JS:** Add `scrollToPill(category)` function. Tracks `_pillScrollIndex` per category. Uses `scrollIntoView({ behavior: 'smooth', block: 'center' })` + adds temporary `.pulse-highlight` class.

### Phase 2: Section Reorder + Visual Hierarchy

#### P5. Move "Add Documents" above document list
- **HTML:** Move the entire `card-section--brand` block (lines 281-334) to between the status overview (line 201) and `#existingDocs` (line 228). Current questionnaire section stays where it is initially (will be moved in P6).

#### P6. Split into Primary + Secondary Zone
- **HTML:** After Questions for Client card, add:
  ```html
  <div class="secondary-zone">
      <div class="secondary-zone-header">
          <i data-lucide="info" class="icon-sm"></i>
          מידע נוסף
      </div>
      <!-- Move Questionnaire, Notes, Communications here -->
  </div>
  ```
- **CSS:** `.secondary-zone` — `background: var(--gray-100); border-radius: var(--radius-lg); padding: var(--sp-4); margin: var(--sp-4) var(--sp-6);`. `.secondary-zone-header` — `font-size: var(--text-sm); font-weight: 600; color: var(--gray-500); margin-bottom: var(--sp-3); display: flex; align-items: center; gap: var(--sp-2);`
- **Final page order:** Status Overview → Add Documents → Document List → Questions → Secondary Zone (Questionnaire, Notes, Communications) → Actions Row

#### P7. Unify card colors + conditional warning
- **HTML:** Remove `card-section--brand` from Add Documents. Remove `card-section--info` from Communications. Add `id="questionsSection"` to Questions card for JS targeting.
- **CSS:** No new CSS needed — removing variant classes falls back to base `.card-section`
- **JS:** In `renderQuestions()`: after updating badge count, conditionally add/remove `card-section--warning` class based on whether there are unanswered questions: `questionsSection.classList.toggle('card-section--warning', hasUnanswered)`
- **Icons:** Already present in HTML — `file-text` (questionnaire), `sticky-note` (notes), `mail` (communications), `plus` (add docs), `message-circle` (questions). These are already the icons used. No emoji replacement needed — Lucide icons are appropriate.

#### P8. Enhanced Send to Client confirmation
- **JS:** In `approveAndSendToClient()`: build a richer message for `showConfirmDialog()` that includes document counts (total, received, missing) and pending question count. Use `escapeHtml` for safety.
- **Message format:** Multi-line HTML string showing: "שליחת רשימת מסמכים ל-{name}" + counts summary + warning that this sends an email.
- **Note:** `showConfirmDialog` uses `escapeHtml(message)` — need to pass raw HTML instead. Create the dialog content manually (similar to existing confirm modal pattern) OR modify the message to use text-only with line breaks.

**Decision:** Since `showConfirmDialog` escapes HTML, we'll build the message as plain text with counts on separate lines, using `\n` which renders in `<p>` tags. Alternatively, we can build a custom innerHTML for the modal body. Given the user wants to use the existing function, we'll craft a descriptive plain-text message.

### Phase 3: Sticky Action Bar

#### P9. Sticky status + action bar
- **HTML:** Add new `<div id="stickyActionBar" class="sticky-action-bar">` inside `#content`, directly above `#statusOverview`. Contains:
  - Mini progress bar (4px height, same segments)
  - Summary text ("X/Y התקבלו")
  - Edit session counts (inline pills, condensed)
  - Save + Reset buttons (when changes) OR Send button (when clean)
- **CSS:** `.sticky-action-bar` — `position: sticky; top: 0; z-index: 100; background: white; border-bottom: 1px solid var(--gray-200); box-shadow: 0 2px 8px rgba(0,0,0,0.06); padding: var(--sp-3) var(--sp-6); display: none;` + `.sticky-action-bar.visible { display: flex; }` + slide animation via transform
- **JS:**
  - `IntersectionObserver` on `#statusOverview` — when it leaves viewport, show sticky bar; when visible, hide it
  - `updateStickyBar()` function called from `updateStatusOverview()` — syncs progress %, counts, button visibility
  - Sticky save/reset/send buttons call same functions as bottom buttons
  - Mobile (< 640px): hide counts, show only progress + primary button
- **Animation:** `@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }` applied when `.visible` is added

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `document-manager.html` | Modify | Reorder sections, add sticky bar HTML, add secondary zone wrapper, add filter bar, add save indicator span |
| `document-manager.css` | Modify | Add styles for sticky bar, save indicator, filter bar, secondary zone, pill hover, pulse animation |
| `document-manager.js` | Modify | Add sticky bar logic, save indicator, filter clear, pill scroll, enhanced send confirmation, conditional warning class |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan

### Phase 1
* [ ] Report Notes: type text, blur → see "✓ נשמר" appear and fade after 2s
* [ ] Report Notes: disconnect network, blur → see "✕ שגיאה בשמירה" in red
* [ ] Questionnaire: expand before fetch completes → see spinner, then content loads
* [ ] Questionnaire: simulate fetch error → see error state with retry button, click retry → loads
* [ ] Filter: click "חסר" count box → filter active, "× הצג הכל" button appears
* [ ] Filter: click clear button → filter clears, all docs visible, button hides
* [ ] Filter: double-click still works as power-user shortcut
* [ ] Edit pills: mark 2 docs for removal → click "2 להסרה" pill → scrolls to first, highlights
* [ ] Edit pills: click same pill again → scrolls to second marked doc

### Phase 2
* [ ] Page order: Status Overview → Add Documents → Document List → Questions → Secondary Zone → Actions
* [ ] Add Documents card: neutral styling (no blue accent)
* [ ] Communications card: neutral styling (was already neutral since --info had no CSS)
* [ ] Questions card: orange accent when unanswered questions exist, neutral when none
* [ ] Secondary zone: gray background, "מידע נוסף" label visible
* [ ] All collapsible sections still expand/collapse correctly after reorder
* [ ] Send to Client: confirmation shows document counts and question count
* [ ] Send to Client: still triggers email and updates stage on confirm

### Phase 3
* [ ] Scroll past status overview → sticky bar slides down from top
* [ ] Sticky bar shows compact progress bar + "X/Y התקבלו"
* [ ] When changes pending: sticky bar shows Save + Reset buttons, clicking Save works
* [ ] When no changes: sticky bar shows Send to Client button
* [ ] Scroll back up to status overview → sticky bar hides
* [ ] Mobile (< 640px): sticky bar shows only progress + primary button
* [ ] RTL: all elements properly mirrored in sticky bar

### General
* [ ] All existing features work: inline editing, status changes, upload/download, note popovers
* [ ] No console errors
* [ ] Page loads correctly for clients with no documents (not-started view)
* [ ] Page loads correctly for clients with spouse documents

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation*
