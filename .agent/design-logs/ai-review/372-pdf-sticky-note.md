# Design Log 372: PDF Sticky-Note from AI Review Card

**Status:** [COMPLETED — 2026-05-12]
**Date:** 2026-04-28
**Related Logs:** DL-075 (inline preview), DL-085 (preview affordance), DL-146 (download button), DL-337 (raw text vs AI summary)

## 1. Context & Problem

Moshe and Natan repeatedly need to record document-specific context: "client says this is the corrected invoice", "amount differs from the email body", "this is a draft, real one coming next week". Today there's no surface for this — `pending_classifications.notes` is reserved for reject-reason, and `documents.bookkeepers_notes` is general-purpose, not tied to the AI Review workflow.

The note must travel with the PDF itself so that if the file is later forwarded to Moshe-as-CPA or to the accountant downstream, the context is visible without consulting Airtable.

## 2. User Requirements

1. **Q:** Two distinct features (annotation + password unlock) — one log or two?  
   **A:** Two separate logs.
2. **Q:** What does "add a note ON the pdf" mean — record-attached, burned-in, or proper PDF annotation?  
   **A:** "is there an option to put a note at the pdf itself?" → yes, via proper PDF /Annot Text (sticky-note) annotation.
3. **Q:** Annotation flavor — proper /Annot, burned-in box, or compare both?  
   **A:** Proper PDF sticky-note annotation (pdf-lib /Annot Text).
4. **Q:** Position on the page?  
   **A:** First page, Moshe picks corner each time (TL / TR / BL / BR dropdown).
5. **Q:** Audience?  
   **A:** Internal only (Moshe/Natan). Note may travel with the PDF if forwarded — accepted trade-off given proper annotations are removable in Acrobat if needed.

## 3. Research

### Domain
PDF object editing — specifically the /Annot Text annotation subtype defined in PDF 1.4+. Library choice: **pdf-lib** (already a Worker dependency at `api/package.json`, `^1.17.1`).

### Key Principles Extracted
- Use the spec, not invented format. /Annot Text renders as sticky-note in any PDF viewer.
- Wrap all string values in `PDFString` when constructing annotations via pdf-lib low-level API.
- Annotations are page-scoped — add to `page.node.set(PDFName.of('Annots'), ...)`, merge with existing array.

### Patterns to Use
- **Idempotent annotation key:** Tag each annotation with `T` = `"moshe-atsits-internal-note"`. Strip and re-add on each save.
- **Round-trip via pdf-lib:** Load → mutate → save → re-upload.

### Anti-Patterns to Avoid
- Burned-in text box (not visually a note)
- Storing note ONLY on Airtable (defeats user's request)
- Storing note ONLY on PDF (makes server-side search impossible)

## 4. Codebase Analysis

- pdf-lib already a dep (`api/package.json`)
- `MSGraphClient.getBinary` for fetching the PDF
- `MSGraphClient.putBinaryReplace` — new shared helper (DL-372/373 shared infra)
- AI Review actions panel renderer at `script.js:4482`
- `showAIReassignModal` at `script.js:6847` — modal pattern reference

## 5. Technical Constraints & Risks

- **Security:** Note text is internal — must NOT leak to client portal. Store in `internal_pdf_note` Airtable field, never join to client-facing endpoints.
- **Annotation merge bug:** If a PDF already has annotations, must append not overwrite.
- **PDF/A locked:** Some files reject mutation — Worker returns 422 with clear error.

## 6. Proposed Solution

### Files Changed
| File | Action |
|------|--------|
| `api/src/lib/ms-graph.ts` | Added `putBinaryReplace(itemId, body)` |
| `api/src/routes/add-pdf-note.ts` | Created — POST /webhook/add-pdf-note |
| `api/src/index.ts` | Registered new route |
| `api/src/lib/pdf-annotations.ts` | Created — pdf-lib helper |
| `frontend/admin/js/script.js` | Added button + `showAddPdfNoteModal()` |
| `frontend/admin/index.html` | Bumped cache version to 373 |

### Logic Flow
1. User clicks **📝 הוסף הערה** in overflow menu for the active card.
2. Modal: textarea (max 500 chars) + corner dropdown + Save/Cancel.
3. POST `/webhook/add-pdf-note` with `{ itemId, recordId, note, corner }`.
4. Worker: fetch PDF → annotate → `putBinaryReplace` → update Airtable `internal_pdf_note`.
5. UI: success toast + reload preview.

## 7. Validation Plan
- [ ] Test with a fresh unencrypted PDF — annotation appears in chosen corner of page 1
- [ ] Open saved PDF in Adobe Acrobat — sticky-note pin visible, click reveals note text
- [ ] Open in Chrome built-in viewer — annotation pin visible
- [ ] Save a second note on same PDF — first note replaced (idempotent key working)
- [ ] Try with encrypted PDF — Worker returns 422 PDF_ENCRYPTED
- [ ] Try with PDF that already has annotations — existing preserved, new note added
- [ ] Verify `documents.internal_pdf_note` populated in Airtable
- [ ] Verify note does NOT appear in client portal
- [ ] Test Hebrew RTL text in the note
- [ ] Test with 500 chars exactly — no truncation

## 8. Implementation Notes
- Added to overflow menu (⋮) on all card variants to keep primary actions clean
- Corner coordinates: TL=(20,top-60), TR=(width-60,top-60), BL=(20,60), BR=(width-60,60)
- pdf-lib annotation built with low-level PDFDict to avoid "Expected a string object" error
