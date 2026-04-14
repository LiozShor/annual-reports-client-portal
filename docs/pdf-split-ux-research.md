# PDF Splitting UX & Thumbnail Rendering Research

> Research date: 2026-04-05
> Context: Admin panel modal for splitting multi-page PDFs into separate documents during AI-review classification

---

## 1. pdf.js Page Thumbnail Rendering

### Library Setup (pdfjs-dist v5.x)

Current stable: **pdfjs-dist v5.6.205** (April 2026). Use matching worker version.

```html
<!-- CDN (non-bundled project like ours) -->
<script src="https://unpkg.com/pdfjs-dist@5.6.205/build/pdf.min.mjs" type="module"></script>
```

```javascript
// Worker setup — MUST match library version
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://unpkg.com/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs';
```

### Core Rendering Pattern

```javascript
// Load PDF from ArrayBuffer or URL
const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
const totalPages = pdf.numPages; // Page count

// Render one page to canvas
const page = await pdf.getPage(pageNum); // 1-indexed
const scale = 0.4; // ~0.3-0.5 for thumbnails
const viewport = page.getViewport({ scale });
const outputScale = window.devicePixelRatio || 1;

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
canvas.width = Math.floor(viewport.width * outputScale);
canvas.height = Math.floor(viewport.height * outputScale);
canvas.style.width = Math.floor(viewport.width) + 'px';
canvas.style.height = Math.floor(viewport.height) + 'px';

await page.render({
  canvasContext: ctx,
  viewport: viewport,
  transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
}).promise;
```

### Performance Best Practices

| Technique | Details | Source |
|-----------|---------|--------|
| **Lazy rendering via IntersectionObserver** | Only render visible thumbnails. Use 300px `rootMargin` for pre-loading. Disconnect observers on cleanup. | BentoPDF, Joyfill |
| **Batch progressive rendering** | Render pages in batches (e.g., 4-6 at a time) with progress callback. Prevents UI freeze on 20+ page PDFs. | BentoPDF |
| **Canvas-to-dataURL conversion** | Render to canvas, convert to `dataURL`, embed as `<img>`. Frees canvas memory while preserving thumbnail. | BentoPDF |
| **Cancellation tokens** | Use a `renderId` timestamp. Before each render, check if render is still current. Prevents stale renders when user uploads a new file. | BentoPDF |
| **HiDPI scaling** | Set canvas dimensions in JS (`canvas.width/height`) not CSS. Use `window.devicePixelRatio` multiplier. Without this, thumbnails look blurry on Retina. | pdf.js examples, Joyfill |
| **Thumbnail scale** | Use scale 0.3-0.5 for thumbnail grids (vs 1.5 for full view). Lower = faster + less memory. v5.4.449 specifically improved memory for thumbnails. | Nutrient, BentoPDF |
| **Offscreen rendering** | Render complex pages offscreen, copy to visible canvas. Relevant for pages with heavy vector graphics. | Joyfill |
| **Reuse canvas elements** | Pool canvases instead of creating new ones to reduce GC pressure. | Joyfill |

### Key Gotcha

pdf.js Web Worker does NOT work with `file://` URLs. Must serve from HTTP(S). Our admin panel serves from GitHub Pages, so this is fine.

---

## 2. pdf-lib for Client-Side PDF Splitting

### Library Profile

| Property | Value |
|----------|-------|
| Version | 1.17.1 (stable, our API already uses it) |
| Min.js size | ~1.1 MB unminified; minified ~380-400KB (per GitHub issue #14 and Bundlephobia) |
| Dependencies | 4: `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `pako`, `tslib` |
| Environments | Browser, Node, Deno, React Native |
| CDN | `https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js` |
| Tree-shakeable | Yes (ESM build available) |

### Page Extraction Pattern

```javascript
import { PDFDocument } from 'pdf-lib';

async function extractPages(sourceBytes, pageIndices) {
  // pageIndices = zero-based array, e.g., [0, 2, 3]
  const srcDoc = await PDFDocument.load(sourceBytes);
  const newDoc = await PDFDocument.create();
  const pages = await newDoc.copyPages(srcDoc, pageIndices);
  pages.forEach(page => newDoc.addPage(page));
  const pdfBytes = await newDoc.save(); // Uint8Array
  return pdfBytes;
}

// Convert to downloadable blob
function toBlob(pdfBytes) {
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

// Helper: 1-based range to 0-based indices
function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i - 1);
}
```

### pdf.js + pdf-lib Complementary Usage

These two libraries serve different roles and work well together:

| Library | Role | Strength |
|---------|------|----------|
| **pdf.js** (pdfjs-dist) | Rendering/viewing | Parse PDF, render pages to canvas, text extraction |
| **pdf-lib** | Manipulation | Copy pages, create new PDFs, extract page subsets |

**Pattern:** Load PDF bytes once -> pass same `ArrayBuffer` to both libraries. pdf.js renders thumbnails; pdf-lib extracts pages when user confirms split.

### Known Limitations

- pdf-lib `copyPages` can **increase** output file size (doesn't compress; embedded fonts/images duplicated per split doc)
- No built-in page rendering (that's pdf.js's job)
- `@pdf-lib/fontkit` needed for custom fonts (optional, not needed for splitting)
- Large PDFs (100+ pages) may cause memory pressure in browser during `load()` — consider showing a warning for files > 50MB

---

## 3. PDF Splitting UX Patterns (Industry Survey)

### Adobe Acrobat Web

- **Thumbnail grid** of all pages displayed horizontally
- **Divider lines** between page thumbnails — clicking a divider turns it blue, indicating a split point
- Up to 22 split points per document
- Split points = "where to cut" mental model (scissors metaphor)
- No drag-to-group; purely positional splitting
- Requires sign-in for actual split execution

### Smallpdf

- **Thumbnail grid** with all pages visible at a glance
- Two modes: "Extract all pages" (each page becomes a separate PDF) vs "Select pages" for targeted extraction
- **Click to select** individual pages; **Ctrl/Cmd+click** for multi-select
- **Drag to reorder** pages within the grid
- Scissor icon tool for splitting at specific points
- Clean, minimal UI — no overwhelming options

### iLovePDF

- Three split modes:
  1. **Range mode** — custom page ranges (e.g., 1-3, 4-7) or fixed-size divisions
  2. **Pages mode** — extract individual pages as separate PDFs
  3. **Size mode** — split by file size target (premium)
- Shows preview of resulting file count before executing
- Displays original file size and page count for context

### PDFLince (Open Source — pdf-lib + pdf.js)

- Fully client-side (no server upload)
- Uses **Web Workers** for non-blocking PDF processing
- Visual page organizer with extract, reorder, delete capabilities
- Split by ranges or "every page"
- Uses pdf.js for rendering + pdf-lib for manipulation (same stack we'd use)

### Common UX Principles Across All Tools

1. **Always show page thumbnails** — users need visual confirmation of content
2. **Show page numbers** on or below each thumbnail
3. **Preview before execute** — show how many documents will result from the split
4. **Two mental models:** "where to cut" (divider lines) vs "which pages to group" (selection-based)
5. **Support both single-page extraction and range-based splitting**
6. **File size and page count** displayed prominently

---

## 4. Document Management Split Patterns (Enterprise)

### UiPath Document Understanding

- AI classifies pages into document types automatically
- **Manual review station** for ambiguous classifications
- Consecutive pages of the same type are grouped into one document
- Non-consecutive pages of the same type remain separate (won't auto-merge)
- Users can override AI classification per page in a review UI

### Hyperscience

- Auto-splitting with **confidence scores** per page
- Low-confidence pages sent to **Manual Classification Supervision** queue
- Only consecutive same-type pages grouped; no cross-gap merging
- Review UI shows page thumbnail with suggested classification + override dropdown

### General DMS Patterns

| Pattern | Details |
|---------|---------|
| **Metadata inheritance** | Split documents inherit parent's metadata (upload date, source, uploader). Classification/type assigned per split. |
| **Audit trail** | Link split documents back to original parent document. Store "split from [original_id] pages X-Y" |
| **Undo/revert** | Keep original file intact. Split creates new records. "Undo" = delete split children, restore parent to active. |
| **Batch splitting** | Allow splitting multiple PDFs in sequence without closing the modal |
| **Version history** | Original preserved as version 0. Each split is a new document, not a version. |

---

## 5. Recommendations for Our Admin Panel

### Architecture

- **pdf.js** (v5.x via CDN) for thumbnail rendering — already proven at scale, worker-based
- **pdf-lib** (v1.17.1, already in our API) for page extraction — can also run client-side via CDN
- Load both from CDN `<script>` tags (no bundler needed, consistent with our GitHub Pages approach)

### Recommended UX Flow

```
1. Admin clicks "Split" on a multi-page document in AI review
2. Modal opens → shows loading spinner
3. PDF fetched from OneDrive URL → passed to pdf.js
4. Thumbnail grid rendered (lazy if >10 pages)
5. Page count + file info shown in modal header
6. Admin selects pages per group:
   - Click thumbnail to select/deselect (toggle)
   - Selected pages highlighted with group color
   - "New Group" button to start a new document group
   - Each group gets a document type dropdown (from SSOT types)
7. Preview: "This will create N documents" summary
8. Confirm → pdf-lib extracts pages per group → uploads each as new document
9. Original document marked as "Split" (not deleted)
```

### Patterns to Use

1. **Thumbnail grid with lazy IntersectionObserver rendering** — handles 20+ page PDFs without freezing
2. **Canvas-to-img conversion** — render to canvas, convert to dataURL, display as `<img>`. Frees canvas memory.
3. **Group-based selection** (not divider-line) — better fit for our use case where pages go to different document types, not sequential splitting
4. **Color-coded groups** — each group gets a distinct color border/badge. Proven pattern in document classification UIs.
5. **Confirm dialog before split** — use our `showConfirmDialog()`, show resulting document count
6. **Keep original intact** — split creates new Airtable records linked to parent. Reversible.
7. **Progress feedback** — `showLoading()` during extraction, per-group upload progress

### Anti-Patterns to Avoid

1. **Rendering all pages at once on large PDFs** — will freeze browser. Use lazy rendering.
2. **Creating new canvases per render without cleanup** — memory leak. Pool or convert to img.
3. **Divider-line UX for classification splitting** — dividers work for sequential cuts but not for assigning arbitrary pages to document types
4. **Deleting original on split** — always keep original, mark status. Enables undo.
5. **Blocking UI during PDF load** — use Web Worker (pdf.js does this by default)
6. **Ignoring HiDPI** — thumbnails will look blurry on modern screens without devicePixelRatio handling
7. **Allowing split without classification** — every group must have a document type assigned before confirm
8. **Forgetting to set canvas dimensions in JS** — CSS-only sizing causes blurry canvas rendering

### Library Versions (Pinned)

```
pdfjs-dist: 5.6.205 (CDN, with matching worker)
pdf-lib:    1.17.1  (CDN or already in API deps)
```

---

## Sources

- [Joyfill: Optimizing In-Browser PDF Rendering](https://joyfill.io/blog/optimizing-in-browser-pdf-rendering-viewing)
- [Nutrient: Complete Guide to PDF.js](https://www.nutrient.io/blog/complete-guide-to-pdfjs/)
- [pdf.js Official Examples](https://mozilla.github.io/pdf.js/examples/)
- [BentoPDF: Page Rendering and Thumbnails (DeepWiki)](https://deepwiki.com/alam00000/bentopdf/5.4-page-rendering-and-thumbnails)
- [FreeCodeCamp: Extract PDF Pages with JavaScript](https://www.freecodecamp.org/news/extract-pdf-pages-render-with-javascript/)
- [pdf-lib Official Site](https://pdf-lib.js.org/)
- [pdf-lib GitHub](https://github.com/Hopding/pdf-lib)
- [PDFLince: Client-Side PDF Toolkit](https://github.com/GSiesto/PDFLince)
- [Adobe Acrobat: Split PDFs](https://helpx.adobe.com/acrobat/web/edit-pdfs/organize-documents/split-pdfs.html)
- [Smallpdf: Split PDF](https://smallpdf.com/split-pdf)
- [iLovePDF: Split PDF](https://www.ilovepdf.com/split_pdf)
- [UiPath: Classification and Splitting](https://forum.uipath.com/t/classification-and-splitting/714035)
- [Hyperscience: Auto-Splitting](https://help.hyperscience.ai/v42/docs/auto-splitting)
- [Bundlephobia: pdf-lib](https://bundlephobia.com/package/pdf-lib)
- [pdfjs-dist on npm](https://www.npmjs.com/package/pdfjs-dist)
