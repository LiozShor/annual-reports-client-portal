# Design Log 246: PDF Split Modal — Page Preview & Zoom

**Status:** [COMPLETED]
**Date:** 2026-04-09
**Related Logs:** DL-237 (PDF split & re-classify), DL-212 (mobile full-screen preview modal), DL-075 (inline document preview)

## 1. Context & Problem

The PDF split modal (DL-237) shows small thumbnails (scale 0.2, ~120px wide) for each page. Admins splitting multi-page PDFs need to understand what's on each page before deciding how to group them, but the thumbnails are too small to read. Currently there's no way to zoom in or preview individual pages — admins must guess or open the PDF separately.

This feature adds a lightbox-style page preview with zoom controls, accessible from any thumbnail in both split modes.

## 2. User Requirements

1. **Q:** How should the page preview/zoom work when the user clicks a thumbnail?
   **A:** Lightbox overlay — clicking a thumbnail opens a centered lightbox showing that page at full size, with left/right arrows to navigate between pages. Close with X or click outside. Background: dimmed split modal.

2. **Q:** Should the preview support pinch-to-zoom or scroll-zoom for very detailed documents?
   **A:** Zoomable with controls — add +/- zoom buttons and scroll-wheel zoom. Lets users inspect fine print.

3. **Q:** Should the zoom/preview be available in both split modes (Split All + Manual Range) or only Manual Range?
   **A:** Both modes — preview works on any thumbnail regardless of which split mode is active.

4. **Q:** Should there be a visual cue on thumbnails that they're clickable for preview?
   **A:** Hover magnify icon — show a small magnify icon overlay on hover, cursor changes to zoom-in.

## 3. Research

### Domain
Document Viewer UX, Lightbox Patterns, Client-Side PDF Rendering

### Sources Consulted
1. **pdf.js (Mozilla)** — Render at higher scale (1.0–1.5) for preview vs 0.2 for thumbnails. Use same `pdfDoc.getPage(i)` with larger viewport. Canvas → img conversion for memory.
2. **CSS Transform Zoom Pattern (Jake Archibald, Panzoom)** — Use `transform: scale()` + `translate()` for GPU-accelerated smooth zoom/pan. Better than re-rendering at each zoom level. Incremental steps: 1x → 1.5x → 2x → 3x.
3. **Adobe Acrobat / Google Drive Preview UX** — Thumbnail grid with click-to-preview is industry standard. Keyboard nav (arrows, Escape). Show page counter "Page N of M". Zoom controls bottom-center. Dimmed background maintains context.

### Key Principles Extracted
- **Render once at high quality, zoom via CSS transform** — re-rendering PDF pages per zoom level is expensive. Render at scale 1.0–1.5, then use CSS transform for further zoom. This keeps memory bounded.
- **Keyboard navigation is essential** — Left/Right arrows for page nav, +/- or scroll for zoom, Escape to close.
- **Maintain split modal context** — the lightbox overlays the split modal (doesn't replace it). User returns to the same split state after closing preview.
- **Lazy render preview** — only render the full-size page when the lightbox opens. Don't pre-render all pages at high quality.

### Patterns to Use
- **Layered overlay** — lightbox sits on top of split modal (higher z-index), both inside `.ai-modal-overlay`
- **CSS transform zoom** — render page once at scale ~1.0, zoom via `transform: scale(N)` with `transform-origin: center`
- **Scroll-wheel zoom** — `wheel` event on lightbox image adjusts scale in 0.25 increments
- **Drag-to-pan** — when zoomed > 1x, mousedown+mousemove translates the image

### Anti-Patterns to Avoid
- **Re-rendering PDF at each zoom level** — extremely slow, memory-heavy
- **Rendering all pages at high resolution upfront** — memory explosion
- **Replacing the split modal** — user loses context of their page selections

### Research Verdict
Render each page on-demand at scale 1.0 when the lightbox opens. Use CSS `transform: scale()` for zoom controls (1x → 1.5x → 2x → 3x). Add drag-to-pan when zoomed. Keyboard support for navigation. Lightbox overlays the split modal without replacing it.

## 4. Codebase Analysis

### Existing Solutions Found
- **`splitState.pdfDoc`** — pdf.js document already loaded and available in memory. Can call `pdfDoc.getPage(n)` for high-res render.
- **`renderSplitThumbnails()`** at `script.js:7274` — existing canvas render pattern with DPR scaling. Reuse the same pattern at higher scale.
- **Mobile preview modal** (`mobilePreviewModal`) — existing full-screen modal pattern with close button, could inform lightbox structure.
- **Lucide icons** — `search`, `zoom-in`, `zoom-out`, `chevron-left`, `chevron-right`, `x` all available.
- **`.ai-modal-overlay`** — existing overlay pattern with click-outside-to-close.

### Reuse Decision
- **Reuse** `splitState.pdfDoc` — no need to re-download PDF
- **Reuse** canvas rendering pattern from `renderSplitThumbnails()` at higher scale
- **Reuse** `.ai-modal-overlay` z-index layering pattern
- **New**: lightbox HTML, zoom/pan JS logic, hover magnify CSS

### Relevant Files
| File | Role |
|------|------|
| `github/.../admin/js/script.js` | Lightbox JS: open/close, render page, zoom/pan, keyboard nav |
| `github/.../admin/index.html` | Lightbox HTML shell (inside or after split modal) |
| `github/.../admin/css/style.css` | Lightbox styles, hover magnify overlay, zoom controls |

### Dependencies
- `splitState.pdfDoc` (pdf.js document, already loaded by split modal)
- Lucide icons (already loaded)

## 5. Technical Constraints & Risks

* **Security:** No new auth surface — uses already-loaded PDF data from `splitState.pdfDoc`.
* **Risks:**
  - Rendering at scale 1.0 uses ~4x memory per page vs scale 0.2. Mitigate: render one page at a time, clean up on navigation.
  - Large pages at 3x CSS zoom may look pixelated. Mitigate: render at scale 1.5 for enough detail at 2x zoom.
  - Touch/mobile: lightbox on small screens. Mitigate: full-screen on mobile, touch-friendly controls.
* **Breaking Changes:** None — additive UI overlay on existing split modal.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Admin can click any page thumbnail in the split modal, see a full-size preview in a lightbox, zoom in/out with controls or scroll wheel, navigate between pages with arrows, and return to the split modal with their selections intact.

### Logic Flow

#### A. Thumbnail Hover Affordance
1. Add CSS hover state on `.split-thumb-wrapper`: show magnify icon overlay + `cursor: zoom-in`
2. Icon: centered Lucide `search` icon with semi-transparent background
3. On click: call `openPagePreview(pageNumber)` (separate from group selection — use the img click, not wrapper)

#### B. Lightbox HTML & Open
1. Add `#splitPagePreview` overlay after `#aiSplitModal` in `index.html`
2. Structure: overlay > panel with header (page counter + close), body (canvas/img container), footer (zoom controls + nav arrows)
3. `openPagePreview(pageNum)`:
   - Set `splitPreviewState = { currentPage, scale: 1, translateX: 0, translateY: 0 }`
   - Show overlay, render page at pdf.js scale 1.5 to canvas → img
   - Update page counter "עמוד N מתוך M"

#### C. Page Navigation
1. Left/Right arrow buttons in footer
2. Keyboard: ArrowLeft/ArrowRight while lightbox open
3. On navigate: render new page, reset zoom to 1x

#### D. Zoom Controls
1. Footer buttons: zoom-out (−), zoom level display (e.g., "100%"), zoom-in (+)
2. Zoom levels: 1x, 1.5x, 2x, 3x (CSS `transform: scale()` on the image)
3. Scroll wheel: `deltaY` adjusts zoom ±0.25 per tick, clamped to [0.5, 3]
4. When zoomed > 1x: enable drag-to-pan (mousedown → track delta → `transform: translate()`)
5. Double-click: toggle between 1x and 2x

#### E. Close
1. Click overlay background, X button, or Escape key
2. Returns to split modal — `splitState` unchanged

#### F. Keyboard Handling
1. Add `keydown` listener when lightbox open, remove on close
2. ArrowLeft/ArrowRight: navigate pages
3. Escape: close lightbox
4. +/=: zoom in, -: zoom out

### Data Structures / Schema Changes
None — purely frontend, no Airtable or API changes.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `github/.../admin/index.html` | Modify | Add `#splitPagePreview` lightbox HTML after split modal |
| `github/.../admin/js/script.js` | Modify | Add ~120 lines: `openPagePreview()`, `closePagePreview()`, `renderPreviewPage()`, zoom/pan handlers, keyboard nav |
| `github/.../admin/css/style.css` | Modify | Add ~80 lines: lightbox overlay, zoom controls, hover magnify icon, drag cursor states |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Active TODOs"

## 7. Validation Plan

* [ ] Thumbnail hover shows magnify icon overlay + zoom-in cursor
* [ ] Clicking thumbnail opens lightbox with full-size page render
* [ ] Page counter shows correct "עמוד N מתוך M"
* [ ] Left/Right arrows navigate between pages
* [ ] Keyboard ArrowLeft/ArrowRight navigate pages
* [ ] Zoom +/- buttons change zoom level (1x → 1.5x → 2x → 3x)
* [ ] Scroll wheel zooms in/out smoothly
* [ ] Drag-to-pan works when zoomed > 1x
* [ ] Double-click toggles between 1x and 2x
* [ ] Escape key closes lightbox
* [ ] Click outside lightbox closes it
* [ ] Split modal state (groups, mode, selections) preserved after closing lightbox
* [ ] Works in both "Split All" and "Manual Range" modes
* [ ] Large PDF (20+ pages) — lightbox renders individual pages without freezing
* [ ] Mobile: lightbox is usable (full-screen, touch-friendly controls)
* [ ] No regression: existing split flow (confirm, split-all, manual ranges) still works

## 8. Implementation Notes (Post-Code)
* All 3 files changed as planned: HTML (~20 lines), CSS (~170 lines), JS (~210 lines)
* Code quality review found 2 critical issues — both fixed:
  - C1: Canvas backing store not released after toDataURL → added `canvas.width=0; canvas.height=0`
  - C2: `closeSplitModal()` didn't close lightbox → added `closePagePreview()` call
* Also fixed: removed unnecessary `lucide.createIcons()` per open, added render generation counter for race guard, `||` → `??` for falsy index 0, `img.alt` cleared on success
* Lightbox uses inline SVG for magnify icon (not Lucide) since thumbnails render dynamically
* Zoom steps: [0.5, 0.75, 1, 1.5, 2, 3] — CSS transform-based, not re-rendering
