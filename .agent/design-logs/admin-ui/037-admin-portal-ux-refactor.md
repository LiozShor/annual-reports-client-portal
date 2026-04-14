# Design Log 037: Admin Portal UX Refactor
**Status:** [COMPLETED]
**Date:** 2026-02-18
**Related Logs:** 036 (AI Classification Review Interface), 033 (Admin Review Queue FIFO), 032 (UI Redesign)

## 1. Context & Problem

The admin portal has 5 UX issues:
1. Duplicate click targets on client rows (name vs eye icon — unclear what each does)
2. Two separate pages (document-review.html + admin dashboard) feel redundant
3. Missing back buttons on admin sub-pages
4. Flat AI review layout (all client groups expanded, hard to scan)
5. Low-signal client summary data (email/year columns aren't actionable)

Additionally: template IDs (e.g., T501) shown in AI review cards are meaningless to office users — should show actual document names only.

## 2. User Requirements (Discovery Q&A)

1. **Q:** Template ID display (T501 etc.) — remove completely or keep alongside document name?
   **A:** Remove completely. Show only document name (e.g., "טופס 106 של משה מ-INTEL").

2. **Q:** AI Review tab data loading — fresh API call each time or cache from dashboard load?
   **A:** Fresh each time. Load from API when tab is clicked. Always current.

3. **Q:** Remove template IDs from missing docs tags too?
   **A:** Yes (implied by answer to Q1 — consistent approach).

4. **Q:** Last activity column — skip for now or derive from existing data?
   **A:** Skip for now. Don't add this column yet.

5. **Q:** AI pending count per client in dashboard table?
   **A:** Skip per-client column. Show total AI pending count in the tab badge only.

## 3. Technical Constraints & Risks

* **Dependencies:** document-review.html, document-review.js, document-review.css (will be deleted)
* **Security:** Auth token shared via localStorage (same `ADMIN_TOKEN_KEY`) — no new auth needed since AI review moves into the same admin page
* **Risks:**
  - Deleting document-review.html removes a working standalone page — must ensure all functionality is fully ported before deletion
  - The admin script.js will grow significantly — need to namespace AI review functions to avoid collisions

## 4. Proposed Solution (The Blueprint)

### 4.1 Back Buttons (smallest, independent)

Add back button to:
- `admin/document-types-viewer.html` — in the content area, before the card
- `admin/questionnaire-mapping-editor.html` — in the content area, before the card

Pattern (RTL-correct, from document-manager.html):
```html
<a href="index.html" class="btn btn-ghost btn-sm">
    <i data-lucide="arrow-right" class="icon-sm"></i>
    חזרה לפורטל ניהול
</a>
```

### 4.2 Client Row Consolidation

In `renderClientsTable()`:
- Remove the standalone eye icon button from actions column
- Add a small external-link icon next to client name as secondary action
- Row click (client name) → navigates to document-manager.html (unchanged)
- External-link icon → opens view-documents.html in new tab, labeled "צפייה כלקוח"
- Stage 1 clients keep send button in actions column

### 4.3 Client Summary Columns

New column layout:
| שם | שלב | מסמכים | חסרים | פעולות |

Changes:
- **Remove:** email column, year column
- **Add:** חסרים (missing docs count, red if >0)
- **Keep:** שם (with email tooltip on hover), שלב (stage badge), מסמכים (progress bar + X/Y), פעולות
- **Skip:** last activity column, per-client AI count

### 4.4 Move AI Review into Dashboard (5th Tab)

**HTML changes (admin/index.html):**
- Add 5th tab button: `סקירת AI` with pending count badge
- Add tab content div with: stats bar, filter bar, accordion container
- Add reassign modal (ported from document-review.html)
- Add toast element for success/error feedback
- Remove navbar "סקירת AI" link

**JS changes (admin/js/script.js):**
Port from document-review.js (adapting to avoid naming collisions):
- `loadAIClassifications()` — replaces `loadClassifications()`, fetches fresh data when tab is clicked
- `renderAICards()` — replaces `renderCards()`, uses accordion layout
- `renderAICard()` — replaces `renderCard()`, removes template IDs from display
- `approveAIClassification()`, `rejectAIClassification()`, `showAIReassignModal()`, `confirmAIReassign()`, `submitAIReassign()`, `assignAIUnmatched()`
- `animateAndRemoveAI()` — with accordion auto-collapse
- `applyAIFilters()`, `updateAIStats()`, `recalcAIStats()`
- `showAIToast()` — toast notification
- Helper functions: `getFileIcon()`, `formatFileMeta()`, `formatDate()`, `escapeAttr()`

**Template ID removal:**
- In `renderAICard()`: show only `item.matched_template_name`, not `item.matched_template_id`
- In missing docs tags: show only `d.name`, not `d.template_id`
- In reassign dropdown options: show only `d.name`, not `d.template_id`

**CSS changes (admin/css/style.css):**
Port unique styles from document-review.css:
- Review card styles (.review-card, .card-top, .card-body-review, .card-actions)
- Client group / accordion styles
- Stats bar, filter bar
- Confidence badges
- Sender info, file info
- Missing docs tags
- Toast notification
- Reassign modal (modal-overlay, modal-panel)
- Card removal animation

### 4.5 Accordion Layout

Each client group is a collapsible accordion:

**Collapsed (default):**
```
[▸] משה כהן  │  3 ממתינים  │  2 זוהו  │  1 לא זוהו  │  ⌀ 87%
```

**Expanded (on click):**
- Full review cards (same layout as current)
- Approve/Reject/Reassign actions per card

Behavior:
- All accordions start collapsed
- Click header to toggle
- When a card is removed (approved/rejected/reassigned), animate out
- When group becomes empty, remove the accordion section entirely
- Recalculate stats after each action

### 4.6 Delete Redundant Files

After all functionality is verified working in the dashboard:
- Delete `document-review.html`
- Delete `assets/js/document-review.js`
- Delete `assets/css/document-review.css`

### Architecture: Modified Files

| File | Change |
|------|--------|
| `admin/index.html` | Add AI Review tab + content + reassign modal + toast |
| `admin/js/script.js` | Port AI review logic, rewrite client table, update row actions |
| `admin/css/style.css` | Port AI review styles, accordion, tooltip, toast |
| `admin/document-types-viewer.html` | Add back button |
| `admin/questionnaire-mapping-editor.html` | Add back button |
| `document-review.html` | **DELETE** |
| `assets/js/document-review.js` | **DELETE** |
| `assets/css/document-review.css` | **DELETE** |

## 5. Validation Plan

- [ ] Open admin dashboard → verify 5 tabs visible
- [ ] Dashboard tab: verify client table has new columns (missing docs count, no email/year)
- [ ] Dashboard tab: hover client name → tooltip shows email
- [ ] Dashboard tab: click client name → goes to document-manager.html
- [ ] Dashboard tab: click external-link icon → opens view-documents in new tab
- [ ] Dashboard tab: verify no standalone eye icon button
- [ ] AI Review tab: click → loads fresh data from API
- [ ] AI Review tab: verify accordion groups, all collapsed by default
- [ ] AI Review tab: expand accordion → cards render correctly
- [ ] AI Review tab: verify NO template IDs shown (only document names)
- [ ] AI Review tab: approve card → animation + stats update
- [ ] AI Review tab: empty group → auto-removed
- [ ] AI Review tab: filters (search, confidence, type) work
- [ ] document-types-viewer.html: back button → admin dashboard
- [ ] questionnaire-mapping-editor.html: back button → admin dashboard
- [ ] Verify document-review.html is deleted, no broken links
- [ ] Mobile responsive check (768px breakpoint)

## 6. Implementation Notes (Post-Code)

All changes implemented as planned. No deviations.

**Files modified:**
- `admin/index.html` — removed navbar AI link, added 5th tab (סקירת AI), added tab content with stats/filters/accordion container, added reassign modal + toast, updated search placeholder
- `admin/js/script.js` — rewrote `renderClientsTable()` (new columns: חסרים, removed email/year, added email tooltip, replaced eye icon with external-link next to name), added full AI review section (~350 lines: load, render accordion, card rendering, approve/reject/reassign, filters, stats, animation, toast, helpers)
- `admin/css/style.css` — added client name cell styles, docs progress, missing count badge, full AI review styles (stats bar, filter bar, accordion, review cards, confidence badges, modal, toast, responsive)
- `admin/document-types-viewer.html` — added back button
- `admin/questionnaire-mapping-editor.html` — added back button
- Deleted: `document-review.html`, `assets/js/document-review.js`, `assets/css/document-review.css`

**Template ID removal:** All template IDs (T501 etc.) removed from AI review cards — only document names shown in classification labels, missing docs tags, and reassign dropdown options.
