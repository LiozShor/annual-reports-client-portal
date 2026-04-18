# Design Log 303: Fix Inline Attachment Filter Dropping Legitimate PDFs
**Status:** [COMPLETED]
**Date:** 2026-04-18
**Related Logs:** DL-203 (WF05 Worker migration), DL-287 (Cloudflare Queues inbound email), DL-260 (archive extraction inbound)

## 1. Context & Problem

An email with a PDF attachment `Form106_2025.pdf` (received 2026-04-18 ~16:09) was silently swallowed by the inbound pipeline — no classification, no OneDrive upload, no client note was created.

Root cause: `api/src/lib/inbound/attachment-utils.ts:filterValidAttachments` drops every attachment where `isInline === true` before checking extension or size. iPhone Mail attaches PDFs with `Content-Disposition: inline` so the recipient sees a rendered preview; MS Graph surfaces this as `isInline: true`. The blanket filter kills the PDF before `contentBytes` is ever read.

## 2. User Requirements

1. **Q:** Which pipeline handled this email?
   **A:** Cloudflare Worker (DL-287 / DL-203). No legacy n8n WF05 — fully migrated. Both queue and sync paths share `processInboundEmail` → `fetchAttachments` → `filterValidAttachments`, so the fix is flag-agnostic.

2. **Q:** What failed?
   **A:** Attachment not detected at all; pipeline ran to completion with an empty attachment list.

3. **Q:** Original `isInline` check — why was it there?
   **A:** To drop inline email-signature logos and tracking pixels (tiny `.png`/`.gif` items that arrive inline in every branded email). That intent is preserved by the new, narrower check.

## 3. Research

### Domain
MIME email structure, `Content-Disposition` semantics, MS Graph fileAttachment schema.

### Sources Consulted
1. **MS-OXCMAIL spec (learn.microsoft.com)** — `Content-Disposition: inline` means "render in message body"; it is a *rendering hint*, not a signal about whether the part is user content. Document files can legitimately carry this header.
2. **MS Graph fileAttachment resource (learn.microsoft.com)** — `isInline` is the canonical boolean from the email `Content-Disposition` header. No additional semantics from Microsoft — it maps 1:1 to the MIME header value.
3. **Email signature blogs (emailsignaturerescue, mail-signatures)** — Inline signature images are typically raster images (`.png`/`.jpg`/`.gif`) under ~10–15KB (100×100px logo). Size + MIME type is the correct discriminator, not `isInline` alone.

### Key Principles Extracted
- **`isInline` ≠ "not a document"** — it tells the email client how to render the part. Real document files (PDF, DOCX) can be sent inline. Reject on type+size, not `isInline` alone.
- **Signature logos are images, small** — the set of problematic inline items is almost entirely small raster images. Filter specifically on `IMAGE_EXTENSIONS` + size < 20KB.
- **PDFs and Office docs are never signature logos** — an inline `.pdf` is always a document the client intentionally attached.

### Patterns to Use
- **Size + type gate for isInline:** only reject when `isInline && IMAGE_EXTENSIONS && size < 20_000`. Everything else passes through existing extension/size logic.

### Anti-Patterns to Avoid
- **Blanket `isInline` drop:** original bug — kills real documents from mobile Mail apps.
- **Checking `contentType` alone:** MS Graph sometimes normalizes content types; filename extension is more reliable.

### Research Verdict
Narrow the `isInline` guard to `IMAGE_EXTENSIONS + size < 20KB`. This covers the signature-logo use case while letting inline PDFs/Office files through.

## 4. Codebase Analysis

* **Existing Solutions Found:** `IMAGE_EXTENSIONS` set already defined in `api/src/lib/inbound/types.ts:168` — not imported in `attachment-utils.ts` prior to this fix.
* **Reuse Decision:** import `IMAGE_EXTENSIONS` from types, use it in the narrowed guard.
* **Only call site:** `fetchAttachments` in the same file at line 63. No other callers.
* **Downstream trust:** `archive-expander.ts` and `image-to-pdf.ts` accept `AttachmentInfo[]` (post-filter) and don't re-filter.
* **No legacy path:** `workflows/` directory does not exist; DL-203 fully migrated WF05 to the Worker.
* **Dependencies:** `USE_QUEUE` Worker secret — both code paths (queue consumer + sync route) call the same `filterValidAttachments`.

## 5. Technical Constraints & Risks

* **Security:** No PII exposure change — fix only widens which attachments are classified; downstream pipeline is unchanged.
* **Risk — false negatives:** A legitimate inline small photo (scanned letter photo <20KB) would be dropped. Mitigation: phone photos are typically 200KB–5MB. 20KB threshold is conservative.
* **Risk — signature logos >20KB:** A large company logo might slip through and be uploaded as a document. Mitigation: classify step assigns it no template match → lands in the AI Review pending queue; Natan will catch it. Low frequency risk.
* **No automated tests:** `api/` has no test harness. Manual Section 7 validation is the regression gate. (Follow-up DL-304 can introduce Vitest.)

## 6. Proposed Solution (The Blueprint)

### Success Criteria
An email with a PDF sent from iPhone Mail (isInline=true) is classified, uploaded to OneDrive, and logged as a client note — same as an Android/desktop PDF.

### Logic Flow
1. `fetchAttachments` calls MS Graph `/messages/{id}/attachments` → `RawAttachment[]`
2. `filterValidAttachments` applied:
   - `.gif`/`.ico`/`.svg`/etc → dropped (SKIP_EXTENSIONS)
   - `.zip`/`.rar`/`.7z` → kept (ARCHIVE_EXTENSIONS)
   - `isInline && IMAGE_EXTENSIONS && size < 20KB` → dropped (signature logos)
   - Unknown ext + tiny → dropped
   - Everything else → kept (includes `.pdf` regardless of `isInline`)
3. Remaining attachments decoded, SHA-256 hashed, passed to classifier

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/attachment-utils.ts` | Modify | Import `IMAGE_EXTENSIONS`; rewrite `filterValidAttachments` |
| `.agent/design-logs/infrastructure/303-inline-attachment-filter.md` | Create | This file |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-303 row |
| `.agent/current-status.md` | Modify | Add session summary + test items |

### Final Step (Always)
* Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 to `current-status.md`, push branch, `wrangler deploy`.

## 7. Validation Plan

* [ ] **Confirm bug on original message:** Query MS Graph for the original email (sender `shohamlian212@gmail.com`, received ~2026-04-18 16:09) and inspect `attachments` — confirm `Form106_2025.pdf` has `isInline: true`. If not, investigate further before relying on this fix.
* [ ] **iPhone Mail PDF resend test:** After `wrangler deploy`, have the client (or Lian from a test account) send a PDF attachment from iPhone Mail to `reports@moshe-atsits.co.il`. Verify: attachment is kept through `filterValidAttachments`, PDF appears in client's OneDrive folder, classification record created in Airtable.
* [ ] **Signature logo regression:** Forward an email with an inline PNG signature (<20KB) to the mailbox. Verify the PNG is NOT uploaded as a client document.
* [ ] **Android/desktop PDF unaffected:** Confirm that a normal non-inline PDF (isInline=false) still processes correctly.
* [ ] **Worker logs clean:** `wrangler tail` shows no unexpected errors after deploy.

## 8. Implementation Notes (Post-Code)

* Fix is a single-function rewrite in `attachment-utils.ts` — import `IMAGE_EXTENSIONS` (already in types.ts, not previously imported here), reorder filter logic to move `isInline` from a blanket gate to a combined `isInline && IMAGE_EXTENSIONS && size < 20KB` guard.
* TypeScript check clean — no errors on `attachment-utils.ts` (two unrelated pre-existing errors in `backfill.ts` and `classifications.ts`).
* Research principle applied: "size + type gate for isInline" — see Section 3.
