# UI Design System — Quick Reference

> **Full HTML examples & patterns:** `docs/ui-design-system-full.md`
> **CSS files:** `design-system.css` → `common.css` → page-specific CSS
> **Icons:** Lucide via `<i data-lucide="icon-name">` + `lucide.createIcons()`
> **Fonts:** Heebo (Hebrew), Inter (English) · **Direction:** RTL-first; English: `dir="ltr"` / `.en-text`

---

## Critical Rules

- **NEVER** use native `confirm()` / `alert()` — use `showConfirmDialog()` / `showModal()`
- Confirm dialog is **callback-based** (NOT async/await) — pass action as `onConfirm`
- **NEVER** manually set `top`/`right`/`left` on floating elements — use `positionFloating()` **Exception:** singleton popovers anchored to scrollable rows — use `getBoundingClientRect()` + `position:fixed` + scroll-close listener (see full.md §21)
- Custom modals: `.ai-modal-overlay` > `.ai-modal-panel` — NOT `.modal-overlay`
- Prefer **row/card-level loading** for single-item actions; full-screen overlay only for bulk ops
- **Silent refresh after every mutation** — after any add/edit/delete that writes to Airtable, re-fetch and re-render the affected list/detail in place (preserve scroll, no flicker, no full reload). Refresh ALL surfaces showing the same data (admin + client, list + detail). Never instruct the user to reload.

---

## Quick Decision Guide

| Need | Use |
|------|-----|
| Confirm before action | `showConfirmDialog(msg, callback, text, danger)` |
| Show success/error result | `showModal('success'/'error'/'warning', title, body, stats?)` |
| Quick notification | `showAIToast(msg, 'success'/'danger', action?)` |
| Block UI during async | `showLoading(text)` → `hideLoading()` |
| Single-item async (card) | `setCardLoading(id, text)` / `clearCardLoading(id)` |
| Single-item async (row) | `setRowLoading(id, text)` / `clearRowLoading(id)` |
| Data table | `.card` > `.table-wrapper` > `.table` with sortable headers |
| Status label | `.badge` + variant (`success`/`danger`/`warning`/`info`/`neutral`/`brand`) |
| Workflow stage | `.stage-badge.stage-N` (N=1–5) |
| Form/interactive modal | `.ai-modal-overlay` > `.ai-modal-panel` (header/body/footer) |
| Expandable section | `.accordion` or `.collapsible-trigger` + `.collapsible-content` |
| Inline action confirm | `showInlineConfirm(id, msg, callback, opts)` |
| Fixed popup/dropdown | `positionFloating(trigger, float, opts?)` — auto flip/shift/constrain |
| Floating bulk bar | `.floating-bulk-bar` — dismiss with `cancelXxxSelection()` after action; context-aware action groups |
| Split row (name left, actions right in RTL) | `.doc-name-group` + `margin-inline-start: auto` on first right-side item |

---

## JS API Reference

### Dialogs & Modals

```js
showConfirmDialog(message, onConfirm, confirmText, danger)  // callback-based, NOT async
showModal(type, title, body, stats?)   // type: 'success' | 'error' | 'warning'
closeModal()
showInlineConfirm(recordId, message, onConfirm, opts)  // opts: { danger, btnClass, confirmText }
```

### Toasts

```js
showAIToast(message, type, action?)
// type: 'success' | 'danger'
// action: { label, onClick } → persistent button + close X (no auto-dismiss)
// no action → auto-dismiss after 3s
```

### Loading

```js
showLoading(text)           // full-screen overlay (25s safety timeout)
hideLoading()
setCardLoading(recordId, text)   // card-level; rest of page stays interactive
clearCardLoading(recordId)
setRowLoading(reportId, text)    // row-level; for single-item table actions
clearRowLoading(reportId)
```

### Floating Elements

```js
positionFloating(triggerEl, floatingEl, opts?)
// opts: { gap: 6, padding: 8 }
// auto flip (above/below), shift (viewport clamp), max-height constrain
// sets data-side="top" | "bottom" — use for direction-aware CSS animations
```

---

## Design Tokens

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--brand-600` | #4F46E5 | Primary buttons, links, active tabs |
| `--brand-500` | #6366F1 | Focus rings, spinners, active indicators |
| `--brand-50/100/700` | Indigo scale | Hover bg / badge bg / button hover |
| `--gray-800` | #292524 | Headings, primary text |
| `--gray-600` | #57534E | Body text, table headers |
| `--gray-500` | #6B6764 | Muted text, labels |
| `--gray-200` | #E7E5E4 | All borders |
| `--gray-100` | #F5F5F4 | Skeleton loading, chip bg |
| `--gray-50` | #FAFAF9 | Page backgrounds, table header bg |
| `--success-50/100/500/700` | Green | Received, complete, success |
| `--warning-50/100/500/700` | Amber | Waiting, fix-needed, caution |
| `--danger-50/100/500/700` | Red | Errors, missing, destructive |
| `--info-50/100/500/700` | Blue | Informational, restored |

### Spacing (8px grid)

`--sp-1: 4px` · `--sp-2: 8px` · `--sp-3: 12px` · `--sp-4: 16px` · `--sp-5: 20px` · `--sp-6: 24px` · `--sp-8: 32px` · `--sp-10: 40px` · `--sp-12: 48px` · `--sp-16: 64px`

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Inline errors |
| `--radius-md` | 8px | Buttons, inputs, dropdowns |
| `--radius-lg` | 12px | Cards, toasts, accordions |
| `--radius-xl` | 16px | Modals, page containers, loading box |
| `--radius-full` | 9999px | Badges, pills, chips, toggles |

### Shadows & Transitions

`--shadow-sm` → cards · `--shadow-md` → stat cards hover · `--shadow-lg` → modals, toasts, dropdowns

`--transition-fast: 150ms` (hover/focus) · `--transition-base: 200ms` (general) · `--transition-slow: 300ms` (progress/collapsible)

---

## Key CSS Classes

### Buttons

`.btn.btn-primary` · `.btn.btn-secondary` · `.btn.btn-ghost` · `.btn.btn-danger` · `.btn.btn-success` · `.btn.btn-outline-danger`

Sizes: `.btn-lg` · _(default)_ · `.btn-sm` · `.btn-icon`

### Badges

`.badge.badge-success/danger/warning/info/neutral/brand`
`.stage-badge.stage-N` (N=1–5, clickable variant: add `.clickable`)
`.ai-confidence-badge.ai-confidence-high/medium/low`

### Modals

`.ai-modal-overlay` (show/hide via `.show` class) > `.ai-modal-panel` > `.ai-modal-panel-header` / `.ai-modal-panel-body` / `.ai-modal-panel-footer`

### Loading & Skeletons

`.loading-overlay.visible` · `.loading-box` · `.spinner` · `.spinner-lg`
`.skeleton.skeleton-text-lg` · `.skeleton.skeleton-text` · `.skeleton.skeleton-block`

### Layout & Content

`.card` · `.card-header` · `.card-body` · `.table-wrapper` · `.table`
`.filters` · `.filter-group` · `.stat-card.stage-N`
`.alert.alert-success/danger/warning/info`
`.accordion` · `.accordion-header` · `.accordion-body`
`.collapsible-trigger` · `.collapsible-content`
`.tabs-nav` · `.tab-item` · `.tab-content`
`.empty-state` · `.chip` · `.chip-remove`
`.progress-bar` · `.progress-fill` · `.progress-bar-stacked`

### Split Row Layout (RTL)

```css
/* Content-sized name group stays on the right; actions pushed to the left */
.doc-name-group { display: flex; align-items: center; max-width: 65%; min-width: 0; overflow: hidden; }
.delete-toggle  { margin-inline-start: auto; } /* pushes left-side actions to the far left */
```

Do **not** add `flex: 1` to `.doc-name-group` — that causes all following buttons to cluster at the left edge. During inline name editing, temporarily expand: `group.style.flex = '1'; group.style.maxWidth = 'none'`, restore on save/cancel.

### Floating Element CSS Pattern

```css
.my-popup[data-side="bottom"] { animation: floatInDown 120ms ease-out; }
.my-popup[data-side="top"]    { animation: floatInUp 120ms ease-out; }
```

---

> For full HTML structure & examples → `docs/ui-design-system-full.md`
