# UI Design System — Full Reference

> **Quick reference (APIs, tokens, decision guide):** `docs/ui-design-system.md`
> This file contains complete HTML structure, styling rules, and all component examples.

**CSS files:** `design-system.css` (tokens) → `common.css` (shared) → page-specific CSS
**Icon library:** [Lucide Icons](https://lucide.dev/) via `<i data-lucide="icon-name">` + `lucide.createIcons()`
**Fonts:** Heebo (Hebrew), Inter (English)
**Direction:** RTL-first (Hebrew). English sections use `dir="ltr"` or `.en-text`

---

## 1. Design Tokens

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--brand-50` | #EEF2FF | Hover backgrounds, selected states |
| `--brand-100` | #E0E7FF | Badge backgrounds |
| `--brand-500` | #6366F1 | Focus rings, active indicators, spinners |
| `--brand-600` | #4F46E5 | **Primary buttons**, links, active tabs |
| `--brand-700` | #4338CA | Hover on primary buttons |
| `--gray-50` | #FAFAF9 | Page backgrounds, table header bg |
| `--gray-100` | #F5F5F4 | Skeleton loading, chip bg |
| `--gray-200` | #E7E5E4 | **All borders** |
| `--gray-500` | #6B6764 | Muted text, labels |
| `--gray-600` | #57534E | Body text, table headers |
| `--gray-700` | #44403C | Secondary button text |
| `--gray-800` | #292524 | **Headings**, primary text |
| `--success-50/100/500/700` | Green scale | Received, complete, success states |
| `--warning-50/100/500/700` | Amber scale | Waiting, fix-needed, caution states |
| `--danger-50/100/500/700` | Red scale | Errors, missing, destructive actions |
| `--info-50/100/500/700` | Blue scale | Informational, restored states |

### Spacing (8px grid)

```
--sp-1: 4px   --sp-2: 8px   --sp-3: 12px  --sp-4: 16px
--sp-5: 20px  --sp-6: 24px  --sp-8: 32px  --sp-10: 40px
--sp-12: 48px --sp-16: 64px
```

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Small elements, inline errors |
| `--radius-md` | 8px | **Buttons**, inputs, action buttons, dropdowns |
| `--radius-lg` | 12px | **Cards**, toasts, accordions, upload zones |
| `--radius-xl` | 16px | **Modals**, page containers, loading box |
| `--radius-full` | 9999px | Badges, pills, progress bars, chips, toggles |

### Shadows

| Token | Usage |
|-------|-------|
| `--shadow-xs` | Accordions, stat items |
| `--shadow-sm` | Cards, stat cards (default) |
| `--shadow-md` | Page containers, stat cards (hover), active cards |
| `--shadow-lg` | **Modals**, toasts, dropdowns, loading box |

### Transitions

| Token | Duration | Usage |
|-------|----------|-------|
| `--transition-fast` | 150ms ease | Hover, focus, button press |
| `--transition-base` | 200ms ease | Toast slide, general transitions |
| `--transition-slow` | 300ms ease | Progress bar fill, collapsible expand |

---

## 2. Buttons

### Base

```html
<button class="btn btn-primary">
    <i data-lucide="icon-name" class="icon-sm"></i> Label
</button>
```

All buttons: `inline-flex`, `align-items: center`, `gap: 8px`, `font-weight: 600`, `font-size: 14px`, `border-radius: 8px`, `padding: 12px 20px`. Active press: `scale(0.98)`. Disabled: `opacity: 0.5`.

### Variants

| Class | Background | Text | Border | Use for |
|-------|-----------|------|--------|---------|
| `.btn-primary` | `--brand-600` | white | none | Main actions (submit, save, confirm) |
| `.btn-secondary` | white | `--gray-700` | `--gray-200` | Cancel, secondary actions |
| `.btn-ghost` | transparent | `--gray-600` | none | Toolbar actions (refresh, logout) |
| `.btn-danger` | `--danger-500` | white | none | Destructive actions |
| `.btn-success` | `--success-500` | white | none | Positive actions (send, approve) |
| `.btn-outline-danger` | white | `--danger-500` | `--danger-100` | Soft destructive (remove, delete toggle) |

### Sizes

| Class | Padding | Font size | Use for |
|-------|---------|-----------|---------|
| `.btn-lg` | 16px 24px | 16px | Hero CTAs, standalone actions |
| _(default)_ | 12px 20px | 14px | Standard buttons |
| `.btn-sm` | 4px 12px | 12px | Inline actions, table rows, bulk actions |
| `.btn-icon` | 0 (36×36) | — | Icon-only buttons |

### Action Buttons (table/card rows)

```html
<button class="action-btn view" title="צפה">
    <svg>...</svg>
</button>
```

32×32px, no border, colored background per type: `.view` (brand-50), `.send` (success-50). Hover: `translateY(-1px)`.

---

## 3. Dialogs & Modals

### Confirm Dialog (callback-based)

**JS API:** `showConfirmDialog(message, onConfirm, confirmText, danger)`

```html
<!-- Structure (already in admin/index.html) -->
<div id="confirmDialog" class="ai-modal-overlay">
    <div class="ai-modal-panel confirm-dialog-panel">
        <div class="ai-modal-panel-header">
            <i data-lucide="alert-triangle" class="icon"></i>
            <span id="confirmDialogTitle">אישור פעולה</span>
        </div>
        <div class="ai-modal-panel-body">
            <p id="confirmDialogMessage"></p>
        </div>
        <div class="ai-modal-panel-footer">
            <button class="btn btn-primary" id="confirmDialogBtn"
                onclick="closeConfirmDialog(true)">אישור</button>
            <button class="btn btn-secondary"
                onclick="closeConfirmDialog(false)">ביטול</button>
        </div>
    </div>
</div>
```

**Rules:**
- Max-width: 380px
- Danger mode: confirm button becomes `.confirm-btn-danger` (red)
- **NEVER use native `confirm()` or `alert()`**
- Callback-based — pass action as `onConfirm`, NOT async/await

### Result Modal (info/success/error)

**JS API:** `showModal(type, title, body, stats?)`

```html
<div id="resultModal" class="modal" onclick="if(event.target===this)closeModal()">
    <div class="modal-content">
        <button class="modal-close-btn" onclick="closeModal()" aria-label="Close">&times;</button>
        <div class="modal-icon" id="modalIcon"><!-- lucide icon --></div>
        <h2 class="modal-title" id="modalTitle"></h2>
        <div class="modal-body" id="modalBody"></div>
        <div class="modal-stats" id="modalStats"></div>
        <button class="btn btn-primary" onclick="closeModal()">סגור</button>
    </div>
</div>
```

- Types: `success` (circle-check), `error` (circle-alert), `warning` (alert-triangle)
- Optional `stats` object: `{ created, skipped, sent }` renders stat boxes
- Centered layout, icon on top
- **X button** (`.modal-close-btn`): top-right corner, absolute positioned
- **Click outside**: overlay `onclick` checks `event.target===this` to close
- **Auto-dismiss**: success modals auto-close after 3 seconds

### Custom Modal (form/interactive)

**Pattern:** Use for any modal that needs form fields, comboboxes, or custom content.

```html
<div id="myModal" class="ai-modal-overlay">
    <div class="ai-modal-panel">
        <div class="ai-modal-panel-header">
            <i data-lucide="icon-name" class="icon"></i>
            Modal Title
        </div>
        <div class="ai-modal-panel-body">
            <!-- Form fields, comboboxes, content -->
        </div>
        <div class="ai-modal-panel-footer">
            <button class="btn btn-secondary" onclick="closeMyModal()">ביטול</button>
            <button class="btn btn-primary" id="myConfirmBtn" disabled>
                <i data-lucide="check" class="icon-sm"></i> Confirm
            </button>
        </div>
    </div>
</div>
```

**Styling rules:**
- Overlay: `.ai-modal-overlay` — fixed, inset 0, `rgba(0,0,0,0.5)`, `backdrop-filter: blur(2px)`, z-index 1000
- Panel: `.ai-modal-panel` — white, max-width 560px, width 90%, border-radius `--radius-xl`, shadow `--shadow-lg`
- Animation: `modalSlideUp` (200ms) — opacity 0→1, translateY 16px→0
- Show/hide: toggle `.show` class on overlay
- Header: icon + title, font-size `--text-xl`, font-weight 700
- Body: padding `20px 24px`, color `--gray-600`, line-height 1.7
- Footer: flex, gap 12px, justify-content flex-end
- Confirm button starts `disabled`, enabled after validation

### Inline Confirm (card-scoped)

**JS API:** `showInlineConfirm(recordId, message, onConfirm, opts)`

Replaces card action buttons with a confirm bar. Used inside AI review cards.

- Animation: `aiInlineConfirmIn` (150ms fade)
- 150ms delay before confirm button enables (double-click protection)
- Escape key cancels
- Options: `{ danger, btnClass, confirmText }`

---

## 4. Toast Notifications

**JS API:** `showAIToast(message, type)`

```html
<div id="aiToast" class="ai-toast">
    <i data-lucide="check-circle" class="icon-sm" id="aiToastIcon"></i>
    <span id="aiToastText"></span>
</div>
```

- Position: fixed, bottom 24px, left 50%, transform centered
- Default: slides up from below, auto-dismisses after ~3s
- Types: `success` (check-circle, green), `danger` (x-circle, red)
- Z-index: 2000
- Style: rounded pill, bold text, shadow-lg

---

## 5. Loading States

### Full-Screen Loading Overlay

**JS API:** `showLoading(text)` / `hideLoading()`

```html
<div id="loadingOverlay" class="loading-overlay">
    <div class="loading-box">
        <div class="spinner spinner-lg"></div>
        <p id="loadingText">מעבד...</p>
    </div>
</div>
```

- Same overlay style as modals (fixed, blur backdrop)
- White box with `--radius-xl`, `--shadow-lg`
- Safety timeout: auto-hides after 25s and shows error modal
- Show: `.visible` class

### Card-Level Loading (AI Review Cards)

**JS API:** `setCardLoading(recordId, text)` / `clearCardLoading(recordId)`

Overlays a semi-transparent white layer with spinner on a specific `.ai-review-card`. The rest of the page stays interactive. Uses `.ai-loading` class + `.ai-card-loading-overlay` div.

### Row-Level Loading (Reminder Table Rows)

**JS API:** `setRowLoading(reportId, text)` / `clearRowLoading(reportId)`

Same pattern for table rows — overlays a spinner on a specific `<tr>` identified by `data-report-id`. Uses `.reminder-loading` class + `.reminder-row-loading-overlay` div. Used for single-row reminder actions (send, suppress, date change). Bulk actions (multiple rows) still use the full-screen overlay.

**Rule:** Prefer row/card-level loading for single-item actions. Use full-screen overlay only for bulk operations.

### Spinner

```html
<div class="spinner"></div>        <!-- 32px -->
<div class="spinner spinner-lg"></div>  <!-- 48px -->
```

Border animation, `--brand-500` top color, 0.7s spin.

### Skeleton Loading

```html
<div class="skeleton skeleton-text-lg" style="width: 70%"></div>
<div class="skeleton skeleton-text" style="width: 90%"></div>
<div class="skeleton skeleton-block"></div>
```

Shimmer animation (1.5s infinite), gray gradient. Use varied widths for natural look.

---

## 6. Tables

### Standard Table

```html
<div class="card">
    <div class="card-header">
        <h2><i data-lucide="users" class="icon"></i> Table Title</h2>
        <div class="header-actions">
            <button class="btn btn-secondary btn-sm">Action</button>
        </div>
    </div>
    <div class="card-body" style="padding: 0;">
        <div class="table-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th><button class="th-sort-btn" aria-sort="none">
                            Column <span class="sort-arrows"><span class="sort-asc">▲</span><span class="sort-desc">▼</span></span>
                        </button></th>
                    </tr>
                </thead>
                <tbody id="tableBody"></tbody>
            </table>
        </div>
    </div>
</div>
```

**Rules:**
- Always wrap in `.card` with header
- Always wrap table in `.table-wrapper` (overflow-x: auto)
- Text-align: `start` (RTL-aware)
- Sticky headers: `position: sticky; top: 0`
- Row hover: `--gray-50` background
- Sortable headers: `.th-sort-btn` with `.sort-arrows` indicator
- Error rows: `tr.error` (danger-50 bg), duplicate rows: `tr.duplicate` (warning-50 bg)
- Cell padding: `12px 16px`, font-size: 14px

### Filters Above Table

```html
<div class="filters">
    <div class="filter-group">
        <label><i data-lucide="search" class="icon-sm"></i> חיפוש:</label>
        <input type="text" placeholder="..." oninput="filterFn()">
    </div>
    <div class="filter-group">
        <label><i data-lucide="filter" class="icon-sm"></i> סינון:</label>
        <select onchange="filterFn()">...</select>
    </div>
</div>
```

Flex layout, gap 16px, flex-wrap. Select min-width: 180px.

---

## 7. Cards

### Standard Card

```html
<div class="card">
    <div class="card-header">
        <h2><i data-lucide="icon"></i> Title</h2>
        <div class="header-actions">...</div>
    </div>
    <div class="card-body">
        <!-- content -->
    </div>
</div>
```

White bg, 1px `--gray-200` border, `--radius-lg`, `--shadow-sm`.

### Stat Cards (Dashboard)

```html
<div class="stat-card stage-2" onclick="action()">
    <div class="stat-number" id="stat-id">0</div>
    <div class="stat-label"><i data-lucide="icon"></i> Label</div>
</div>
```

- Grid: `repeat(auto-fit, minmax(160px, 1fr))`
- 3px left border (color-coded by stage)
- Active state: thicker border, gray-50 bg, shadow-md, blue dot indicator
- Number: `--text-3xl`, weight 700
- Label: `--text-xs`, gray-500, with icon

### AI Review Cards

Complex card with: `.ai-card-top` (header) → `.ai-card-body` (content) → `.ai-card-actions` (footer). States: `.removing` (slide out), `.ai-loading` (disabled), `.match-full/.match-fuzzy` (green border), `.match-unmatched` (warning border).

**Card header inline badges** (in `.ai-file-info`, in display order):
- `.ai-filing-type-badge` (DL-238) — filing type identifier (always present in unified view)
- `.ai-duplicate-badge` — "כפול" warning when source file already exists in system
- `.ai-unrequested-badge` — "לא נדרש" when classified to a template the client wasn't asked for

**Unified view (DL-238):** AI Review tab loads all classifications regardless of the entity tab (`filing_type=all` query param). The filing type badge on each card lets the user identify which filing type each doc belongs to in the mixed list.

---

## 8. Badges & Status Indicators

### Generic Badge

```html
<span class="badge badge-success">Label</span>
```

Pill shape (`--radius-full`), font-size 12px, font-weight 600, colored bg + text.

| Class | Background | Text | Use for |
|-------|-----------|------|---------|
| `.badge-success` | `--success-100` | `--success-700` | Complete, received, valid |
| `.badge-danger` | `--danger-100` | `--danger-700` | Error, missing |
| `.badge-warning` | `--warning-100` | `--warning-700` | Waiting, duplicate, needs fix |
| `.badge-info` | `--info-100` | `--info-700` | Informational, restored |
| `.badge-neutral` | `--gray-100` | `--gray-600` | Inactive, waived |
| `.badge-brand` | `--brand-100` | `--brand-700` | Highlighted, selected |

### Stage Badge (workflow stages)

```html
<span class="stage-badge stage-3 clickable" onclick="openStageDropdown(event, id, stage)">
    <svg>...</svg> Stage Label <span class="stage-caret">▾</span>
</span>
```

Min-width 130px. Stages 1-5 with distinct colors. Clickable variant has hover shadow + translateY(-1px).

### Confidence Badge (AI)

```html
<span class="ai-confidence-badge ai-confidence-high">95%</span>
```

Variants: `.ai-confidence-high` (green), `.ai-confidence-medium` (amber), `.ai-confidence-low` (red).

### Filing Type Badge (DL-238)

```html
<span class="ai-filing-type-badge ai-ft-annual_report">דוח שנתי</span>
<span class="ai-filing-type-badge ai-ft-capital_statement">הצהרת הון</span>
```

Small pill badge identifying which filing type a document belongs to. Used on AI Review cards in the unified view (where both AR and CS classifications are shown together). Color-coded:

| Class | Background | Text | Border |
|-------|-----------|------|--------|
| `.ai-ft-annual_report` | `--primary-50` (#eff6ff) | `--primary-700` (#1d4ed8) | `--primary-200` (#bfdbfe) |
| `.ai-ft-capital_statement` | #f5f3ff | #6d28d9 | #ddd6fe |

Style: `display: inline-flex`, `padding: 1px var(--sp-2)`, `border-radius: var(--radius-full)`, `font-size: var(--text-xs)`, `font-weight: 600`, `flex-shrink: 0`.

Use the `FILING_TYPE_LABELS` JS map (`annual_report → דוח שנתי`, `capital_statement → הצהרת הון`) for the label text.

---

## 9. Dropdowns

### Stage Dropdown (positioned)

```html
<div class="stage-dropdown" style="top: Ypx; right: Xpx;">
    <button class="stage-dropdown-option active">
        <svg>...</svg> Current Stage
    </button>
    <button class="stage-dropdown-option">
        <svg>...</svg> Other Stage
    </button>
    <button class="stage-dropdown-option warning">
        <svg>...</svg> Backward <span class="backward-badge">חזרה</span>
    </button>
</div>
```

Fixed position, z-index 1001, white bg, `--shadow-lg`, `--radius-lg`, animation `stageDropdownIn` (120ms).

### Combobox (searchable dropdown)

Built via `createDocCombobox(container, docs, options)` in script.js. Used in AI Review reassign flows (inline cards + modal) and document-manager.

```html
<div class="doc-combobox">
    <input class="doc-combobox-input" placeholder="🔍 חפש מסמך..." />
    <div class="doc-combobox-dropdown">
        <!-- DL-239: Filing type toggle (only when client has both AR + CS) -->
        <div class="doc-combobox-ft-toggle">
            <button class="doc-combobox-ft-btn active" data-ft="own">דוח שנתי</button>
            <button class="doc-combobox-ft-btn" data-ft="other">הצהרת הון</button>
        </div>
        <!-- "+ Add new doc" entry (when allowCreate: true) -->
        <div class="doc-combobox-create-btn">+ הוסף מסמך חדש</div>
        <!-- Grouped doc options -->
        <div class="doc-combobox-category">📈 Category</div>
        <div class="doc-combobox-option" data-value="..." data-doc-id="..." data-name="...">
            Option text<span class="received-badge">✅</span>
        </div>
        <div class="doc-combobox-empty">לא נמצאו תוצאות</div>
    </div>
    <a href="#" class="doc-combobox-back-link">← חזרה לרשימה</a>
</div>
```

**Layout & positioning:**
- Fixed-position dropdown (`position: fixed`) so it escapes parent `overflow: hidden`.
- Width 420px, max-height 280px, z-index 9999.
- Categories are sticky at top during scroll.
- **Re-anchors on window scroll/resize** while open (DL-239) — without this, the dropdown drifts away from the input when the page scrolls.
- Toggle bar (when present) is also sticky at top with `position: sticky; top: 0; z-index: 2`.

**Interactions:**
- Focus on input → opens dropdown.
- Click input again while open → closes dropdown (toggle behavior, DL-239).
- Blur with 150ms delay → closes (delay lets option `mousedown` fire first).
- Escape key → closes.

**Filing type toggle (DL-239):**
Pass `otherDocs`, `ownFilingType`, `otherFilingType` to `createDocCombobox()` to enable. Toggle appears at the top of the dropdown only when the client has both AR and CS active reports. Clicking a toggle button rebuilds the doc list with that filing type's docs and clears the current selection.

**Filter format:**
- `currentMatchId` highlights the currently-matched template with `<span class="current-badge">◀ נוכחי</span>`.
- Received docs get `<span class="received-badge">✅</span>` and `.doc-received` class.

---

## 10. Accordions & Collapsibles

### Accordion

```html
<div class="accordion">
    <div class="accordion-header" onclick="toggleAccordion(this)">
        <span>Title</span>
        <span class="accordion-icon">▼</span>
    </div>
    <div class="accordion-body">
        <!-- content -->
    </div>
</div>
```

- Closed: max-height 0, overflow hidden
- Open: max-height 5000px, transition 0.5s
- Header open state: `--brand-600` bg, white text, bottom radius removed
- Icon: rotates 180° on open

### Collapsible Section

```html
<button class="collapsible-trigger" aria-expanded="false" onclick="toggle(this)">
    <span>Section Title</span>
    <i data-lucide="chevron-down" class="icon"></i>
</button>
<div class="collapsible-content">
    <!-- content -->
</div>
```

Content: max-height 0 → 2000px on `.open`. Icon rotates 180°.

---

## 11. Alerts & Banners

### Alert Box

```html
<div class="alert alert-warning">
    <i data-lucide="alert-triangle" class="icon"></i>
    <span>Warning message text</span>
</div>
```

Variants: `.alert-success`, `.alert-danger`, `.alert-warning`, `.alert-info`. Flex layout, icon + text, colored border + bg.

### Offline Banner

Fixed top bar, warning-100 bg, warning border-bottom, z-index 9999, slides down with animation.

### Stale Data Banner

Inline warning banner with refresh link, warning-50 bg, border, rounded.

---

## 12. Form Inputs

### Text Input / Select

```html
<div class="form-field">
    <label class="form-label">Label:</label>
    <input type="text" placeholder="Placeholder">
    <span class="form-help">Help text</span>
</div>
```

- Width: 100%, padding: `12px 16px`
- Border: 1px `--gray-200`, radius `--radius-md`
- Focus: border `--brand-500`, shadow `0 0 0 3px rgba(99,102,241,0.1)`
- Label: font-size 14px, weight 600, gray-700, margin-bottom 4px
- Help: font-size 12px, gray-500

### Toggle Switch

```html
<label class="switch">
    <input type="checkbox">
    <span class="switch-slider"></span>
</label>
```

44×24px, gray-300 track → `--brand-500` when checked, white 18px knob.

---

## 13. Progress Bars

### Simple

```html
<div class="progress-bar">
    <div class="progress-fill" style="width: 65%"></div>
</div>
```

Height 8px (or 12px with `.progress-bar-lg`). Fill color: `--success-500` default, or `.progress-fill-danger/warning/brand`.

### Stacked (multi-segment)

```html
<div class="progress-bar-stacked">
    <div class="progress-segment" style="width: 40%; background: var(--success-500)"></div>
    <div class="progress-segment" style="width: 20%; background: var(--warning-500)"></div>
    <div class="progress-segment" style="width: 10%; background: var(--danger-500)"></div>
</div>
```

---

## 14. Empty States

```html
<div class="empty-state">
    <div class="empty-state-icon"><i data-lucide="inbox" class="icon-2xl"></i></div>
    <p>No items to display</p>
</div>
```

Centered, padding 48px, gray-500 text, gray-300 icon (48px). Use relevant Lucide icon.

---

## 15. Chips / Tags

```html
<span class="chip">
    Tag Text
    <button class="chip-remove" onclick="remove()">×</button>
</span>
```

Pill shape, gray-100 bg, gray-200 border. Remove button: 18px circle, hover turns red.

---

## 16. Tooltip (Evidence Trigger)

```css
.ai-evidence-trigger:hover::after { /* tooltip content */ }
```

Tooltip: absolute positioned, max-width 300px, gray-800 bg, white text, font-size 12px, shadow-lg, radius-md. Appears on hover with opacity transition.

---

## 17. Tabs

```html
<div class="tabs-nav">
    <button class="tab-item active" onclick="switchTab('id', event)">
        <i data-lucide="icon" class="icon-sm"></i> Label
    </button>
    <button class="tab-item" onclick="switchTab('id', event)">
        <i data-lucide="icon" class="icon-sm"></i> Label
        <span class="badge-on-tab">5</span>
    </button>
</div>
```

- Border-bottom: 1px gray-200
- Active: `--brand-600` text + 2px bottom border
- Inactive: gray-500, no bottom border
- Tab content: `.tab-content` hidden, `.tab-content.active` shown

---

## 18. Upload Zone

```html
<div class="upload-zone" onclick="triggerFileInput()">
    <div class="upload-zone-icon"><i data-lucide="upload-cloud" class="icon-2xl"></i></div>
    <h3>Drag file here</h3>
    <p>Or click to browse</p>
    <button class="btn btn-primary"><i data-lucide="paperclip"></i> Choose file</button>
    <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display:none">
</div>
```

Dashed border (2px, gray-300), rounded, gray-50 bg. Hover/dragover: border turns brand-500.

---

## 19. Animations Reference

| Name | Duration | Effect | Used in |
|------|----------|--------|---------|
| `modalSlideUp` | 200ms | opacity 0→1, translateY 16→0 | Modal open |
| `stageDropdownIn` | 120ms | opacity 0→1, translateY -4→0 | Dropdown open |
| `aiInlineConfirmIn` | 150ms | opacity 0→1 | Inline confirm |
| `skeletonShimmer` | 1.5s infinite | Gradient sweep left | Skeleton loading |
| `spin` | 0.7s infinite | rotate 360° | Spinners |
| `fadeIn` | 300ms | opacity 0→1 | Generic fade |
| `slideUp` | 300ms/400ms | opacity 0→1, translateY 8→0 | Page containers |
| `slideDown` | 200ms | opacity 0→1, translateY -8→0 | Collapsible content |
| `chipIn` | 200ms | opacity 0→1, scale 0.85→1 | Tag/chip entry |
| `notePulse` | 1.5s infinite | box-shadow pulse | Note indicator |

---

## 20. Responsive Breakpoints

| Breakpoint | Context |
|-----------|---------|
| ≤480px | Landing page mobile |
| ≤640px | View documents mobile |
| ≤768px | Document manager / general mobile |

**Mobile rules:** Stack flex to column, full-width buttons, reduce padding (sp-5→sp-3), collapse grid columns.

---

## 21. Floating Element Positioning

All fixed-position popups, dropdowns, and tooltips **must** use the shared `positionFloating()` utility. Never manually set `top`/`right` on floating elements.

### API

```js
positionFloating(triggerEl, floatingEl, opts?)
```

| Param | Type | Description |
|-------|------|-------------|
| `triggerEl` | `Element` | The button/badge/icon that opens the floating element |
| `floatingEl` | `Element` | The floating element (`position: fixed`) |
| `opts.gap` | `number` | Space between trigger and float (default: `6`) |
| `opts.padding` | `number` | Viewport edge padding (default: `8`) |

### Behavior

- **Flip:** If not enough space below, places above the trigger
- **Shift:** Clamps horizontal position so the element stays within the viewport
- **Size-constrain:** Sets dynamic `max-height` based on available space in the chosen direction
- **Direction attribute:** Sets `data-side="bottom"` or `data-side="top"` on the floating element

### CSS Animation Pattern

Use `[data-side]` attribute selectors for direction-aware entry animations:

```css
.my-popup[data-side="bottom"] { animation: floatInDown 120ms ease-out; }
.my-popup[data-side="top"]    { animation: floatInUp 120ms ease-out; }
```

The `floatInDown` and `floatInUp` keyframes are defined globally in `style.css`.

### Current Users

| Element | Trigger |
|---------|---------|
| `.stage-dropdown` | Stage badge click |
| `.docs-popover` | Doc count click |
| `.ai-evidence-tooltip` | Evidence icon hover |
| `.suppress-menu` | Suppress button click |

### Rule

**NEVER manually set `top`/`right`/`left` on floating elements — always use `positionFloating()`.**

### Exception: Scroll-Sensitive Popovers

`positionFloating()` uses a temporary `display: block` measurement step, which can misplace elements that have no prior positioning (they flash at their static DOM position — often the bottom of the page). For singleton popovers anchored to a row/cell, use direct `getBoundingClientRect()` positioning instead and close on scroll:

```js
function openMyPopover(event, id) {
    const popover = document.getElementById('myPopover');
    const rect = event.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const POP_W = 280, POP_H = 140, GAP = 6, PAD = 8;

    // Vertical: below button, flip above if tight
    if (vh - rect.bottom - GAP >= POP_H) {
        popover.style.top = (rect.bottom + GAP) + 'px';
        popover.style.bottom = '';
    } else {
        popover.style.top = '';
        popover.style.bottom = (vh - rect.top + GAP) + 'px';
    }
    // Horizontal: align right edge to button, clamped
    const right = Math.max(PAD, Math.min(vw - rect.right, vw - POP_W - PAD));
    popover.style.right = right + 'px';
    popover.style.left = 'auto';
    popover.style.display = 'block';
}

// Close on scroll (position: fixed doesn't follow cell when page scrolls)
document.addEventListener('scroll', () => { if (activeId) closePopover(); }, true);
// Close on click-outside
document.addEventListener('click', e => {
    const pop = document.getElementById('myPopover');
    if (activeId && pop && !pop.contains(e.target)) closePopover();
});
```

Use `POP_H` as an estimate (don't measure dynamically). `position: fixed` in CSS.

---

## 22. Floating Bulk Action Bar

A fixed bar that appears when one or more table rows are checked. Used in Send Questionnaires tab and Reminders tab.

### Structure

```html
<div class="reminder-bulk-actions floating-bulk-bar" id="reminderBulkActions">
    <span class="reminder-bulk-count"><span id="reminderSelectedCount">0</span> נבחרו</span>
    <!-- Context-aware action groups: only one visible at a time -->
    <span id="reminderBulkActiveActions">
        <button class="btn btn-sm btn-primary" onclick="reminderBulkAction('send_now')">שלח עכשיו</button>
        <button class="btn btn-sm btn-ghost-warning" onclick="reminderBulkAction('suppress_forever')">ללא תזכורות</button>
    </span>
    <span id="reminderBulkMutedActions" style="display:none;">
        <button class="btn btn-sm btn-primary" onclick="reminderBulkAction('unsuppress')">הפעל מחדש</button>
    </span>
    <button class="btn btn-sm btn-ghost" onclick="cancelReminderSelection()">ביטול</button>
</div>
```

### Key Rules

1. **Context-aware actions:** When ALL selected rows are muted → show unsuppress only. When any are active → show send/suppress. Toggle via `updateReminderSelectedCount()`.
2. **Dismiss after action:** Always call `cancelReminderSelection()` before `loadReminders(true)` after a successful action — clears checkboxes and hides the bar.
3. **Close dropdown menus before actions:** `reminderAction()` must close `.suppress-menu.open` elements at the top, before any confirm dialog or API call.
4. **Mixed selection warning:** When selection contains both active and muted clients, show a clickable warning ("X מושתקים — לחץ להסיר") that deselects the muted ones.

### Cancel Pattern

```js
function cancelReminderSelection() {
    document.querySelectorAll('.reminder-checkbox, .reminder-select-all').forEach(cb => cb.checked = false);
    updateReminderSelectedCount(); // hides bar when count=0
}
```

---

## 23. Split Row Layout (RTL)

Use when a flex row must have a **content group on the right** and **action buttons on the left** — e.g. a document row where name+file-buttons stay together and delete/note/badge are pushed to the far left.

### Pattern

```html
<div class="document-item">  <!-- display: flex -->

    <!-- Right group: icon + name + contextual actions -->
    <div class="doc-name-group">
        <span class="document-icon">...</span>
        <div class="document-name">Document Title</div>
        <button class="name-edit-btn">✏️</button>
        <a class="file-action-btn" title="הורד קובץ">⬇</a>
        <a class="file-action-btn" title="צפה בקובץ">↗</a>
    </div>

    <!-- Left group: margin-inline-start:auto pushes everything here to the far left -->
    <button class="delete-toggle">🗑</button>
    <button class="note-btn">💬</button>
    <span class="badge">סטטוס</span>

</div>
```

```css
/* Right group: content-sized (not flex:1), limited width */
.doc-name-group {
    display: flex;
    align-items: center;
    max-width: 65%;
    min-width: 0;
    overflow: hidden;
}

/* Push the first left-side element (and everything after) to the far left */
.delete-toggle {
    margin-inline-start: auto;
}
```

### Key principles

- **Do NOT use `flex:1` on the group** — that makes it expand to fill all space, clustering buttons at the far left edge of the group (same problem as no group at all).
- **`margin-inline-start: auto`** on the first "left side" button absorbs all free space, creating the visual gap.
- **Name editing expands the group:** temporarily set `group.style.flex = '1'; group.style.maxWidth = 'none'` when an inline edit input is active, then restore on save/cancel.
- `max-width: 65%` on the group prevents very long document names from crowding out the action buttons.

### Result (RTL visual, right → left)

```
[📄 Document Name] [✏️] [⬇] [↗]  ————gap————  [🗑] [💬] [badge]
```
