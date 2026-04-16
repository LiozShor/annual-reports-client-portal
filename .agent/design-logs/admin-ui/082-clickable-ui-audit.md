# Design Log 082: Clickable UI Audit — Admin Panel
**Status:** [DRAFT]
**Date:** 2026-03-03
**Related Logs:** [055-sortable-headers-clickable-stage-badges](055-sortable-headers-clickable-stage-badges.md), [078-reminder-tab-clickable-cards-and-fixes](078-reminder-tab-clickable-cards-and-fixes.md), [075-ai-review-inline-document-preview](075-ai-review-inline-document-preview.md)

## 1. Context & Problem
Boss requested that "ANYTHING possible on the website should be clickable — especially in the admin route." Audit found 33 elements across all tabs; about half already interactive (client names, stage badges, stat cards, accordion headers, max cells). The rest — doc counts, email addresses, missing counts, status badges — are static text that could provide quick access to details, actions, or navigation.

## 2. User Requirements
1. **Q:** Scope — all tabs or specific?
   **A:** All tabs.
2. **Q:** What should clicking a client name do?
   **A:** Open Document Manager (same tab navigation).
3. **Q:** What should clicking doc counts (X/Y) do?
   **A:** Show a popover with which docs are received, missing, etc.
4. **Q:** Should emails be clickable?
   **A:** Both — click = mailto, copy icon = copy to clipboard.
5. **Q:** AI Review doc name click?
   **A:** Open the existing preview panel (DL-075).
6. **Q:** Reminders tab client name?
   **A:** Open Document Manager. Doc counts same behavior as dashboard.
7. **Q:** Any other specific elements?
   **A:** General directive — use judgment for everything else.

## 3. Research
### Domain
Interactive Data Tables, Affordance & Clickability Signifiers, Dashboard UX

### Sources Consulted
1. **"Don't Make Me Think" — Steve Krug** — Every interactive element must be self-evident at a glance. Users scan, not read. Color + underline + cursor = minimum affordance. Conventions beat cleverness.
2. **Nielsen Norman Group (Clickable Elements + Flat Design studies)** — Blue has the strongest perceived clickability. Hover is necessary but not sufficient — affordance must be visible at rest. Color alone isn't enough (8% male color blindness); pair with underline, icon, or weight.
3. **NN/g Data Tables article** — Row hover highlighting aids scanning. Popovers (not tooltips) for data-dense details. Only one popover open at a time. Light-dismiss pattern.
4. **Linear / GitHub UI patterns** — GitHub: titles are blue+underlined on hover, IDs are monospace muted. Linear: entire row clickable, actions fade in on hover. Notion: cells individually clickable, hover reveals controls.
5. **PatternFly Clipboard Copy** — Copy icon on hover, icon changes to checkmark for 1.5-2s, announce to screen readers with `aria-live="polite"`.

### Key Principles Extracted
- **Affordance at rest** (not just on hover): clickable elements need persistent visual cues — color, underline, badge shape
- **Scan-friendly**: interactive elements must be caught during rapid scanning (Krug's satisficing principle)
- **One popover at a time**: light-dismiss pattern to avoid overlay overload (NN/g)
- **Feedback within 100ms**: click → immediate visual change (Krug + NN/g)
- **Color + secondary cue**: never rely on color alone — pair with underline, icon, or border

### Patterns to Use
- **Clickable text** (`.client-link` pattern): brand-600 color + underline + cursor:pointer — already exists, reuse
- **Clickable badge** (doc counts): pill shape + subtle background + hover darken → signals clickability via shape
- **Copy-to-clipboard**: hover-revealed copy icon + `showAIToast` feedback + `navigator.clipboard.writeText()`
- **Lazy-load popover**: click doc count → show popover with spinner → fetch from `/get-client-documents` → render doc list
- **Suppress-menu CSS pattern**: existing `.suppress-menu` positioned overlay — reuse for popover

### Anti-Patterns to Avoid
- **Hover-only affordance**: must see clickability before hovering
- **Tooltips for essential info**: doc list must be in popover (persistent, scrollable), not tooltip
- **Overloading hover**: keep hover behavior consistent per column type
- **Color-only distinction**: pair color with shape (badge/pill) or underline

### Research Verdict
Use a combination of existing patterns (`.client-link` for names, `.suppress-menu` positioning for popovers) plus new utility classes (`.clickable-count`, `.email-cell`) for consistent affordance. Lazy-load doc details on popover click to avoid bloating the dashboard API.

## 4. Codebase Analysis
* **Relevant Files:**
  - `admin/js/script.js` — 5 render functions: `renderClientsTable` (L210), `renderPendingClients` (L822), `renderReviewTable` (L937), `renderAICards/renderAICard` (L1560/1735), `buildReminderTable` (L2837)
  - `admin/css/style.css` — `.client-link` (L1007), `.docs-count` (L1164), `.missing-count` (L1170), `.suppress-menu` (L2489)
* **Existing Patterns:**
  - `.client-link`: brand-600 + underline + cursor:pointer — used in Dashboard, Review, Reminders
  - `.suppress-menu`: absolute positioned dropdown — reference for popover
  - `showAIToast(msg, type)`: toast notification — perfect for clipboard feedback
  - `viewClientDocs(reportId, name, email, year)`: navigates to document-manager.html
* **API:** Dashboard returns counts only (no doc list). Document list available via `GET /get-client-documents?report_id=...&mode=office`
* **Gaps:** Send Questionnaires tab has no clickable client names or emails

## 5. Technical Constraints & Risks
* **API latency:** Doc popover needs lazy-load from `/get-client-documents` — show spinner, handle errors
* **Popover positioning:** Must work in RTL layout, stay within viewport. Position below the trigger, close on click-outside
* **One popover at a time:** Clicking a second count must close the first
* **No per-doc data in dashboard API:** Must call separate endpoint — cache results per `report_id` to avoid re-fetching
* **No breaking changes:** All existing clickable elements (client names, stage badges, stat cards) remain unchanged

## 6. Proposed Solution (The Blueprint)

### A. Doc Count Popover (Dashboard, Review Queue, Reminders)

**Trigger:** Click on `.docs-count` or `.missing-count` element.

**Behavior:**
1. Click → position a reusable `#docsPopover` div below the trigger
2. Show loading spinner
3. Fetch from `GET /get-client-documents?report_id=...&mode=office` (cache in `Map`)
4. Render compact doc list grouped by status: Received (green), Missing (red), Requires Fix (amber), Waived (gray)
5. Each doc shows: status icon + doc name (Hebrew)
6. Click outside or Escape → close
7. Click same trigger again → toggle close

**HTML (reusable singleton):**
```html
<div id="docsPopover" class="docs-popover" style="display:none">
  <div class="docs-popover-header">
    <span class="docs-popover-title"></span>
    <button class="docs-popover-close">&times;</button>
  </div>
  <div class="docs-popover-body"></div>
</div>
```

**CSS:** Absolute positioned, max-height 300px with overflow scroll, shadow-lg, radius-lg, light-dismiss.

**JS:** New functions:
- `toggleDocsPopover(event, reportId, clientName)` — positions & fetches
- `renderDocsPopoverContent(docs)` — builds compact list HTML
- `closeDocsPopover()` — hides + cleanup
- `docsCache = new Map()` — per-session cache

### B. Clickable Emails (Send Questionnaires, Review Queue)

**Pattern:** Wrap email text in a link + add copy icon.

```html
<td class="email-cell">
  <a href="mailto:${email}" class="email-link">${email}</a>
  <button class="copy-btn" onclick="copyToClipboard('${email}', this)" title="העתק">
    <i data-lucide="copy" class="icon-xs"></i>
  </button>
</td>
```

**JS:** `copyToClipboard(text, btn)` — uses `navigator.clipboard.writeText()`, shows `showAIToast('הועתק', 'success')`, briefly swaps icon to checkmark.

**CSS:** `.email-link` subtle brand color, `.copy-btn` opacity 0 → hover reveals.

### C. Client Names in Send Questionnaires Tab

Currently static text. Make clickable using existing `.client-link` pattern + `viewClientDocs()`.

### D. AI Review: Doc Name → Preview Panel

The AI review cards show file names in `.ai-file-name`. Add `onclick` to trigger `loadDocPreview()` (already exists from DL-075). If a card is already selected in the master panel, clicking the file name loads its preview.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add popover logic, email copy, update 5 render functions |
| `admin/css/style.css` | Modify | Add `.docs-popover`, `.email-cell`, `.email-link`, `.copy-btn`, `.clickable-count` styles |
| `admin/index.html` | Modify | Add `#docsPopover` singleton div |

### Render Function Changes Summary

| Function | Line | Changes |
|----------|------|---------|
| `renderClientsTable` | 210 | `.docs-count` + `.missing-count` → `onclick="toggleDocsPopover(...)"` with `tabindex="0"` + `role="button"` |
| `renderPendingClients` | 822 | Client name → `.client-link` with `viewClientDocs()`. Email → `.email-cell` with mailto + copy |
| `renderReviewTable` | 937 | Email → `.email-cell` with mailto + copy. Doc count → `onclick="toggleDocsPopover(...)"` |
| `renderAICard` | 1735 | `.ai-file-name` → `onclick` to load preview |
| `buildReminderTable` | 2837 | `.docs-count` → `onclick="toggleDocsPopover(...)"` |

## 7. Validation Plan
* [ ] Dashboard: click doc count → popover shows with spinner → loads doc list → correct statuses
* [ ] Dashboard: click missing count → same popover behavior
* [ ] Dashboard: click outside popover → closes
* [ ] Dashboard: click second client's count → first popover closes, second opens
* [ ] Send Questionnaires: client name clickable → opens doc manager
* [ ] Send Questionnaires: email → click opens mailto, copy icon copies + toast
* [ ] Review Queue: email → same mailto + copy behavior
* [ ] Review Queue: doc count → popover
* [ ] Reminders: doc count → popover
* [ ] AI Review: click file name → loads in preview panel
* [ ] Keyboard: Tab to clickable count → Enter opens popover → Escape closes
* [ ] RTL: popover positions correctly in RTL layout
* [ ] Cache: second click on same client → instant (no re-fetch)

## 8. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
