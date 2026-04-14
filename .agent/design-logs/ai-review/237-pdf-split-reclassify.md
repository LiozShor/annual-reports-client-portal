# Design Log 237: PDF Split & Re-Classify from AI Review

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-05
**Related Logs:** DL-035 (classification pipeline), DL-075 (inline preview), DL-222 (multi-PDF approve conflict)

## 1. Context & Problem

When clients send multi-page PDFs containing different document types (e.g., Form 106 + bank statement in one scan), the classification agent classifies the entire file as one document type. The admin currently has no way to split it — they must reject and ask the client to resend, or manually download/split/re-upload outside the system.

This feature adds a "Split PDF" action to AI review cards for multi-page PDFs, letting the admin split the file into segments and re-classify each segment independently.

## 2. User Requirements

1. **Q:** When should the split option appear?
   **A:** Auto-detect on ingest — detect page count during inbound processing. If 2+ pages, flag so review card shows a "Split PDF" action automatically.

2. **Q:** What split modes should be available?
   **A:** Two modes: (1) Split ALL — one page per file, each re-classified. (2) Manual page ranges — admin types ranges like "1-2, 3, 4-5".

3. **Q:** After splitting, what happens to the original classification?
   **A:** Replace original — mark as "split" and hide. New classification records created for each extracted segment, each going through full classify → review flow.

4. **Q:** Where should the split UI live?
   **A:** Modal with page thumbnails — clicking "Split PDF" opens a modal showing page thumbnails. Admin selects pages visually, picks split mode, confirms.

5. **Q:** AI-assisted split detection?
   **A:** No — admin decides manually. No AI recommendations for split points.

6. **Q:** PDF rendering for thumbnails?
   **A:** pdf.js in browser — load Mozilla's pdfjs-dist library client-side for page thumbnail rendering.

## 3. Research

### Domain
Document Management UX, Client-Side PDF Processing

### Sources Consulted
1. **pdf.js (Mozilla)** — Render thumbnails at scale 0.3–0.5, use IntersectionObserver for lazy loading, handle HiDPI with devicePixelRatio. Canvas → img conversion frees memory.
2. **pdf-lib (Hopding)** — `PDFDocument.copyPages()` + `addPage()` extracts page ranges into new PDFs. Already in our `api/package.json`. Works alongside pdf.js — same ArrayBuffer feeds both. ~400KB minified.
3. **Document management UX (Adobe Acrobat, Smallpdf patterns)** — Thumbnail grid with click-to-select is industry standard. Group-based selection with color coding better for classification workflows than divider-line model. Always preview resulting document count before executing. Keep original for undo.

### Key Principles Extracted
- **Thumbnail grid > divider line** — for classification splitting, seeing all pages at once with selectable groups is better than inserting dividers between pages
- **Lazy render thumbnails** — don't render all pages up front; use IntersectionObserver with rootMargin for smooth scrolling
- **Keep original intact** — mark as "split" rather than deleting, so the admin can recover if needed
- **Show result count before confirming** — "This will create N documents" prevents surprises

### Patterns to Use
- **pdf.js for rendering + pdf-lib for extraction** — same ArrayBuffer shared between both libs
- **Canvas → img conversion** — render to canvas, convert to dataURL, replace canvas with img to free GPU memory
- **Group-based page selection** — colored groups for manual ranges, clear visual assignment

### Anti-Patterns to Avoid
- **Rendering all pages at once** — memory explosion for large PDFs. Lazy render with IntersectionObserver
- **CSS-only canvas sizing** — blurry on HiDPI. Must use devicePixelRatio scaling
- **Deleting original on split** — lose audit trail and undo capability

### Research Verdict
Use pdf.js (CDN) for client-side thumbnail rendering and pdf-lib (already in API deps) for server-side page extraction. Two split modes (split-all + manual ranges). Original classification marked as "split", new records created per segment and sent through the existing classification pipeline.

## 4. Codebase Analysis

### Existing Solutions Found
- **`pdf-merge.ts`** — uses `pdf-lib` with `PDFDocument.copyPages()` — exact same API needed for splitting (extract specific pages instead of all pages)
- **`classifyAttachment()`** in `document-classifier.ts:618` — the classification function we'll call for each split segment
- **`uploadToOneDrive()`** in `attachment-utils.ts` — handles OneDrive uploads with MS Graph
- **Classification record creation** in `processor.ts:449-485` — field structure for creating new classification records
- **Modal pattern** — `showAIReassignModal()` in `script.js:3655` — existing modal pattern for AI review actions
- **`showInlineConfirm()`** — card-level confirmation pattern
- **Preview panel** — `loadDocPreview()` at `script.js:2515` uses iframe for PDF preview

### Reuse Decision
- **Reuse** `pdf-lib` (already a dependency) for page extraction — create a `splitPdf()` function mirroring `mergePdfs()`
- **Reuse** `classifyAttachment()` for re-classifying each split segment
- **Reuse** `uploadToOneDrive()` for uploading split PDFs
- **Reuse** Airtable record creation pattern from `processor.ts`
- **New**: pdf.js CDN in admin panel, split modal UI, split API endpoint

### Relevant Files
| File | Role |
|------|------|
| `api/src/lib/pdf-merge.ts` | Extend with `splitPdf()` function |
| `api/src/routes/classifications.ts` | Add `action=split` handler |
| `api/src/lib/inbound/document-classifier.ts` | Called per split segment |
| `api/src/lib/inbound/processor.ts` | Classification record field template |
| `api/src/lib/inbound/attachment-utils.ts` | OneDrive upload helper |
| `github/.../admin/js/script.js` | Split modal UI + button handler |
| `github/.../admin/index.html` | Add pdf.js CDN, modal HTML shell |
| `github/.../shared/endpoints.js` | Add SPLIT_CLASSIFICATION endpoint (or reuse REVIEW_CLASSIFICATION) |
| `github/.../admin/css/ai-review.css` | Modal + thumbnail grid styles |

### Dependencies
- **pdf-lib** v1.17.1 (already in `api/package.json`)
- **pdfjs-dist** (new CDN dependency for admin frontend — thumbnail rendering only)
- Airtable CLASSIFICATIONS table needs `page_count` field + `split_from` link field
- OneDrive for storing split PDFs

## 5. Technical Constraints & Risks

* **Security:** Split PDFs still go through the same auth flow. No new auth surface — uses existing `verifyToken()`.
* **Risks:**
  - Large PDFs (50+ pages) could cause memory issues in Workers (128MB limit). Mitigate: cap at 30 pages for splitting, or process in chunks.
  - pdf.js CDN adds ~500KB to admin page load. Mitigate: load lazily only when split modal opens.
  - Re-classification costs Claude API calls per segment. Mitigate: show cost warning ("This will classify N documents").
* **Breaking Changes:** None — new endpoint, new UI element. Existing flow unchanged.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Admin can click "Split PDF" on a multi-page classification card, see page thumbnails, select split mode (all or manual ranges), confirm, and see new classification cards appear for each split segment — all without leaving the AI review page.

### Logic Flow

#### A. Ingest-Time Page Count Detection
1. In `processor.ts`, after loading the PDF with pdf-lib, call `doc.getPageCount()`
2. Store as `page_count` field in the classification record
3. Frontend uses `page_count >= 2` to show the "Split PDF" button on cards

#### B. Frontend Split Modal
1. Card shows "✂️ פיצול" button when `page_count >= 2`
2. Clicking opens a full modal (`.ai-modal-overlay` > `.ai-modal-panel`)
3. Modal loads pdf.js lazily (first use only), fetches PDF binary via existing preview URL
4. Renders page thumbnails in a grid (scale 0.3, lazy via IntersectionObserver)
5. Two mode tabs:
   - **Split All**: Pre-selects every page as individual document. Shows "N documents will be created"
   - **Manual Ranges**: Text input for ranges (e.g., "1-2, 3, 4-5"). Visual feedback — selected pages highlighted with group colors. Live preview of resulting document count
6. Confirm button: "פצל ל-N מסמכים" with count
7. On confirm: POST to split endpoint with classification_id + page groups

#### C. API Split Endpoint
**Route:** `POST /webhook/review-classification?action=split`

**Request body:**
```json
{
  "action": "split",
  "classification_id": "recXXX",
  "groups": [[1, 2], [3], [4, 5]]
}
```

**Processing:**
1. Fetch original classification record from Airtable
2. Download original PDF from OneDrive via item_id
3. For each group of pages:
   a. Extract pages using pdf-lib `copyPages()` → new PDF `Uint8Array`
   b. Upload to OneDrive with filename `{original_name}_part{N}.pdf`
   c. Classify via `classifyAttachment()` — passes the extracted PDF content
   d. Create new classification record with:
      - Same client/report/sender fields as original
      - New `file_url`, `onedrive_item_id`, `file_hash`
      - Fresh `ai_confidence`, `matched_template_id` from classification
      - `split_from` linking to original record
      - `review_status: 'pending'`
4. Update original classification: `review_status: 'split'`, `notification_status: 'split'`
5. Return `{ ok: true, created: N, classifications: [...] }`

#### D. Post-Split UI
1. On success, refresh classifications list (existing `loadAIClassifications()`)
2. New cards appear for each segment — normal review flow applies
3. Original card hidden (review_status = 'split', filtered out by existing logic)
4. Toast: "הקובץ פוצל ל-N מסמכים חדשים"

### Data Structures / Schema Changes

**Airtable CLASSIFICATIONS table — new fields:**
| Field | Type | Purpose |
|-------|------|---------|
| `page_count` | Number | Total pages in the PDF (set at ingest) |
| `split_from` | Link to CLASSIFICATIONS | Points to parent classification (set on split children) |
| `page_range` | Single line text | Which pages this segment contains, e.g., "1-2" |

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/pdf-split.ts` | Create | `splitPdf(pdf, pageGroups)` — extracts page groups using pdf-lib |
| `api/src/routes/classifications.ts` | Modify | Add `action=split` handler to review-classification endpoint |
| `api/src/lib/inbound/processor.ts` | Modify | Add `page_count` capture after PDF load |
| `api/src/lib/inbound/types.ts` | Modify | Add `page_count` to classification fields type |
| `github/.../admin/index.html` | Modify | Add pdf.js CDN script (lazy), split modal HTML shell |
| `github/.../admin/js/script.js` | Modify | Add split modal logic, thumbnail rendering, button handlers |
| `github/.../admin/css/ai-review.css` | Modify | Split modal styles, thumbnail grid, group colors |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Active TODOs"

## 7. Validation Plan

* [ ] Multi-page PDF (3+ pages) shows "✂️ פיצול" button on review card
* [ ] Single-page PDF does NOT show split button
* [ ] Split modal opens with correct page thumbnails rendered via pdf.js
* [ ] "Split All" mode creates one classification per page
* [ ] "Manual Ranges" mode correctly parses "1-2, 3, 4-5" into groups
* [ ] Invalid range input (e.g., "0, 99") shows validation error
* [ ] Split PDFs are uploaded to OneDrive with `_part1`, `_part2` suffixes
* [ ] Each split segment is classified independently (different template matches possible)
* [ ] Original classification hidden after split (review_status = 'split')
* [ ] New classification cards appear on refresh with correct client/report context
* [ ] `split_from` field links children to parent
* [ ] `page_range` field shows correct ranges on child records
* [ ] Large PDF (20+ pages) renders thumbnails without freezing browser
* [ ] Verify no regression: approve/reject/reassign still work normally
* [ ] Mobile: split modal is usable on small screens

## 8. Implementation Notes (Post-Code)
* Created `api/src/lib/pdf-split.ts` with `splitPdf()` and `getPdfPageCount()` using pdf-lib
* Page count capture added to `processor.ts` — handles native PDFs, image→PDF, and office→PDF conversions
* Airtable fields created: `page_count` (fld5Vens9pAwBHADK), `page_range` (fldQzyqzTgBYqlH2N), `split_from` (fldbO9QHD830LjWDD)
* API `action=split` handler uses early return pattern, creates segments sequentially (classify → upload → record per segment)
* Frontend uses pdf.js v3.11.174 (lazy CDN) for thumbnails, `getDocPreviewUrl()` downloadUrl for PDF binary
* Split button appears on all card states when `page_count >= 2`
* Group colors (10 colors) for manual range visual feedback
* Uses existing patterns: `fetchWithTimeout`, `authToken`, `showLoading`/`hideLoading`, `showAIToast`, `showModal`
