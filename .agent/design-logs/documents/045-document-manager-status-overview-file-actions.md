# Design Log 045: Document Manager — Status Overview Panel + File View/Download
**Status:** [DRAFT]
**Date:** 2026-02-21
**Related Logs:** 032 (UI Redesign), 035 (WF05 AI Classification + OneDrive), 036 (AI Review Interface)

## 1. Context & Problem

The document-manager.html page is the office-facing tool for managing each client's required documents. When staff opens a client's document manager, they see a list of documents grouped by category — but there's **no at-a-glance status summary** showing how many documents have been received vs. are still missing.

Additionally, when WF05 processes inbound emails and uploads documents to OneDrive (setting `file_url` in Airtable), there's **no way for staff to view or download** those received files from the document manager. The download button exists but is permanently disabled ("בקרוב").

**Two features needed:**
1. **Status overview panel** — replace the edit-session stats bar with a richer panel showing document collection progress
2. **File view/download buttons** — enable viewing/downloading received documents via their OneDrive URLs

## 2. User Requirements

1. **Q:** Should the overview replace or sit above the existing edit-session stats bar?
   **A:** Replace it — combine into one unified panel.

2. **Q:** Should it show a progress bar or just counts?
   **A:** Progress bar + counts (visual progress bar with color-coded count boxes).

3. **Q:** For received documents — open in new tab or inline preview?
   **A:** Open in new tab (inline preview not possible due to Microsoft CSP restrictions blocking iframe embedding on non-Microsoft domains).

4. **Q:** Does the API return file_url?
   **A:** No — needs updating. The n8n workflow must be modified.

## 3. Research

### Domain
Dashboard Status UX, Document Preview Patterns

### Sources Consulted
1. **Nielsen Norman Group — Progress Indicators** — Percent-done indicators are correct when total is known. Always pair visual progress with text labels. Users wait 3x longer with progress indicators present.
2. **Monday.com — Battery Progress Bar** — Stacked multi-color bar segments proportional to status distribution. Hovering shows exact counts. Compact and scannable.
3. **Microsoft Learn — File Previews / CSP Restrictions** — OneDrive's CSP `frame-ancestors` directive blocks embedding on non-Microsoft domains. No workaround exists. Must use "open in new tab" approach.

### Key Principles Extracted
- Always pair visual progress with text labels (NN/g)
- Stacked bars with 3-7 segments are the sweet spot (Domo)
- Use semantic colors consistently (green=received, red=missing, orange=fix, gray=waived)
- Tooltips on bar segments for accessibility (small segments may be invisible)

### Patterns to Use
- **Stacked progress bar:** Multi-segment bar (like Monday.com battery) showing status composition
- **Conditional action buttons:** Show file buttons only when actionable (file_url exists + received status)

### Anti-Patterns to Avoid
- **Ghost affordances:** Disabled buttons that just confuse users — remove the permanently-disabled download button
- **Mystery meat navigation:** Icon-only buttons without aria-labels
- **Visual overload:** Too many decorative layers on count boxes

### Research Verdict
Stacked progress bar + color-coded count boxes + open-in-new-tab for file viewing. Inline preview is not technically feasible for OneDrive on GitHub Pages.

## 4. Codebase Analysis

### Relevant Files
| File | Role |
|------|------|
| `document-manager.html` | Page structure — stats bar (lines 102-119), document list rendering |
| `assets/css/document-manager.css` | Page styles — `.stats-bar`, `.stat-pill`, `.download-btn` |
| `assets/css/design-system.css` | Design tokens + `.progress-bar`, `.progress-fill`, `.badge-*` |
| `assets/js/document-manager.js` | `loadDocuments()`, `displayDocuments()`, `updateStats()` |
| n8n workflow `Ym389Q4fso0UpEZq` | [API] Get Client Documents — "Build Response" Code node |

### Existing Patterns
- **Progress bar:** `design-system.css` lines 512-542 — `.progress-bar` (8px) and `.progress-bar-lg` (12px) with `.progress-fill` using `transition: width var(--transition-slow)`. Single-segment only — need to extend for stacked segments.
- **Status badges:** `.badge-success`, `.badge-danger`, `.badge-warning`, `.badge-neutral` — same semantic colors.
- **Stat pills:** `.stat-pill`, `.stat-pill-danger`, `.stat-pill-success`, `.stat-pill-info` — pill-shaped counters.
- **Note button pattern:** `.note-btn` — ghost icon button with hover state, matching the style needed for file action buttons.
- **view-documents.js:** Already implements a single-fill progress bar (line 224-228) with "X מתוך Y מסמכים התקבלו" text.

### Alignment with Research
- Existing progress bar is single-segment → need stacked variant (research recommends multi-segment)
- Existing badge colors align with semantic color research
- No existing count-box pattern → new component, but uses existing tokens

### Dependencies
- **n8n API workflow** must return `file_url` (currently doesn't — blocking dependency)
- Airtable `documents.file_url` field exists and is populated by WF05

## 5. Technical Constraints & Risks

* **Security:** file_url links to OneDrive. URLs should require MS auth (office staff already authenticated). Escaped via `escapeHtml()` in href attributes. `rel="noopener noreferrer"` on all `target="_blank"` links.
* **Risks:** If API doesn't return file_url, buttons won't appear (graceful degradation). Broken/expired OneDrive links will show OneDrive's error page (no frontend-side validation possible).
* **Breaking Changes:** None — the stats bar replacement is purely additive. The disabled download button removal is a deliberate feature replacement.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

1. **Update n8n API** — Add `file_url` to the "Build Response" Code node in workflow `Ym389Q4fso0UpEZq`
2. **Replace HTML stats-bar** — New `.status-overview` section with progress bar, count boxes, and edit-session pills
3. **Add CSS** — Stacked progress bar, count boxes, file action buttons, responsive rules
4. **Update JS** — New `updateStatusOverview()`, updated `displayDocuments()` with conditional file buttons
5. **Remove old CSS** — `.download-btn` styles replaced by `.file-action-btn`

### Data Structures / Schema Changes

**API response change** — Add `file_url` field to each document object in office mode:
```javascript
// In "Build Response" Code node, office mode groupByCategory:
{ id, name, type, status, bookkeepers_notes, file_url: d.json.file_url || null }
```

No Airtable schema changes needed.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| n8n workflow `Ym389Q4fso0UpEZq` | Modify | Add `file_url` to Build Response Code node (office + client modes) |
| `document-manager.html` | Modify | Replace stats-bar with status-overview panel |
| `assets/css/document-manager.css` | Modify | Add status overview styles, stacked progress bar, count boxes, file buttons; remove `.download-btn` |
| `assets/js/document-manager.js` | Modify | Add `updateStatusOverview()`, update `displayDocuments()` for file buttons, update `updateStats()` |

### HTML Structure (Status Overview Panel)
```html
<div class="status-overview">
    <!-- Progress bar (stacked segments) -->
    <div class="status-overview-progress">
        <span class="status-overview-label">התקדמות איסוף מסמכים</span>
        <strong id="progressText">0 מתוך 0 (0%)</strong>
    </div>
    <div class="progress-bar progress-bar-lg progress-bar-stacked">
        <div class="progress-segment progress-segment-received" id="segReceived" title=""></div>
        <div class="progress-segment progress-segment-fix" id="segFix" title=""></div>
        <div class="progress-segment progress-segment-missing" id="segMissing" title=""></div>
        <div class="progress-segment progress-segment-waived" id="segWaived" title=""></div>
    </div>
    <!-- Count boxes -->
    <div class="status-counts">
        <div class="status-count-box received">
            <span class="count-number" id="countReceived">0</span>
            <span class="count-label">התקבלו</span>
        </div>
        <div class="status-count-box missing">
            <span class="count-number" id="countMissing">0</span>
            <span class="count-label">חסרים</span>
        </div>
        <div class="status-count-box needs-fix">
            <span class="count-number" id="countNeedsFix">0</span>
            <span class="count-label">נדרש תיקון</span>
        </div>
        <div class="status-count-box waived">
            <span class="count-number" id="countWaived">0</span>
            <span class="count-label">ויתור</span>
        </div>
    </div>
    <!-- Edit session counters (shown only when changes pending) -->
    <div class="edit-session-bar" id="editSessionBar" style="display:none;">
        <hr class="edit-session-divider">
        <!-- existing 4 stat-pills moved here -->
    </div>
</div>
```

### File Action Buttons (in displayDocuments)
```javascript
// Replace the disabled download button with:
const hasFile = doc.file_url && (doc.status === 'Received' || doc.status === 'Requires_Fix');
// Render view + download links only when file exists
${hasFile ? `
    <a href="${escapeHtml(doc.file_url)}" target="_blank" rel="noopener noreferrer"
       class="file-action-btn" title="צפייה בקובץ" aria-label="צפייה בקובץ">
        <i data-lucide="eye" class="icon-sm"></i>
    </a>
    <a href="${escapeHtml(doc.file_url)}${doc.file_url.includes('?') ? '&' : '?'}download=1"
       target="_blank" rel="noopener noreferrer"
       class="file-action-btn" title="הורדת קובץ" aria-label="הורדת קובץ">
        <i data-lucide="download" class="icon-sm"></i>
    </a>
` : ''}
```

### Key Design Decisions (from expert consultation)
- **Stacked progress bar** with 4 segments ordered: received (green) → needs-fix (orange) → missing (red) → waived (gray)
- **Count boxes** with tinted backgrounds, 3px top accent border, centered number + label
- **`<a>` tags for file links** (not `<button>`) — semantically correct for navigation
- **Separate ghost buttons** matching `.note-btn` pattern — consistent with page
- **Edit session pills visible only when changes pending** — reduces noise
- **100% complete** → green glow on progress bar
- **0 documents** → hide overview panel, show empty state

## 7. Validation Plan

* [ ] API returns file_url for documents that have OneDrive URLs
* [ ] Status overview shows correct counts matching document list
* [ ] Progress bar segments proportional to status counts
* [ ] Progress bar handles edge cases: 0 docs, 100%, all waived, single doc
* [ ] File view button opens OneDrive in new tab
* [ ] File download button triggers OneDrive download
* [ ] No file buttons shown for docs without file_url
* [ ] No file buttons shown for Missing/Waived status docs
* [ ] Edit session pills hidden when no pending changes
* [ ] Edit session pills appear when changes are made
* [ ] Responsive: panel works at 320px (count boxes wrap 2x2)
* [ ] RTL: all layout uses logical properties
* [ ] Accessibility: aria-labels on icon buttons, tooltips on progress segments
* [ ] Colors pass WCAG AA contrast (verified by Yuki)
* [ ] No layout shift on load (panel has predictable dimensions)

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation*
