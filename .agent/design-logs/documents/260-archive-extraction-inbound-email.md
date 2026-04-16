# Design Log 260: Archive Extraction for Inbound Email Pipeline
**Status:** [DONE]
**Date:** 2026-04-13
**Related Logs:** DL-252 (PDF split), DL-244 (rejected uploads), DL-115 (PDF conversion), DL-196 (binary upload fix)

## 1. Context & Problem
Clients email ZIP/RAR/7z archives containing multiple tax documents to `reports@moshe-atsits.co.il`. These archives currently pass through the attachment filter (they're >1KB and not in SKIP_EXTENSIONS), get uploaded as opaque blobs to OneDrive, but Claude can't classify them and the individual files inside are never extracted. Client documents are effectively lost.

**Current behavior per pipeline:**
- **Inbound email**: Archives pass `filterValidAttachments()`, reach Claude classification as opaque binaries (filename only), get uploaded as-is to OneDrive → documents inside are inaccessible
- **Admin upload / Client portal**: Extension whitelist rejects archives (not in scope for this fix)

## 2. User Requirements
*Q&A from discovery phase:*
1. **Q:** What's the actual trigger — are clients currently sending archives, or proactive?
   **A:** Clients are sending them — documents are getting lost
2. **Q:** If a client sends a ZIP with 5 PDFs inside, what should happen?
   **A:** Auto-extract & process each file through normal pipeline (AI classification, OneDrive upload, etc.)
3. **Q:** Which pipelines need archive handling?
   **A:** Inbound email only
4. **Q:** What archive formats should be covered?
   **A:** ZIP + RAR + 7z

## 3. Research
### Domain
File Archive Processing, Serverless Binary Handling, Document Pipeline Architecture

### Sources Consulted
1. **Cloudflare Workers Web APIs** — Workers support DecompressionStream('deflate-raw') natively; no Node.js Buffer needed. ZIP extraction is feasible within the 5-min CPU budget.
2. **ZIP format specification** — Local file headers contain all data needed for extraction (signature, method, compressed size, filename). STORED (method 0) and DEFLATE (method 8) cover 99%+ of real-world ZIPs.
3. **OWASP Zip Slip vulnerability** — Path traversal via `../` in archive entry names. Must canonicalize and validate all extracted paths before use.
4. **Zip bomb research** — Compression ratios of 1000:1+ possible. Must enforce max decompressed size and max file count limits.

### Key Principles Extracted
- **Defense in depth for archives**: Validate at extraction time (path traversal, size limits, nesting depth) rather than trusting archive contents
- **Fail-safe for unsupported formats**: Upload the raw archive rather than silently dropping it — preserve the data even if we can't extract
- **Content-level dedup, not container-level**: Hash individual extracted files, not the archive itself, to catch duplicates across submission methods

### Patterns to Use
- **Expand-then-pipeline**: Extract archive contents into synthetic AttachmentInfo objects and feed them through the existing classification/upload pipeline unchanged
- **Provenance tracking**: Record source archive name in notes field so staff know which files came from which archive

### Anti-Patterns to Avoid
- **Recursive extraction**: Don't extract nested archives — risk of zip bombs and exponential complexity. Flag nested archives instead.
- **Archive-specific pipeline**: Don't create a separate processing path for extracted files. Reuse the existing attachment pipeline entirely.

### Research Verdict
All three formats (ZIP, RAR, 7z) can be auto-extracted in Cloudflare Workers:
- **ZIP**: Use existing `text-extractor.ts` infrastructure (pure Web APIs, zero dependencies)
- **RAR + 7z**: Use `archive-wasm` npm package — libarchive v3.7.7 compiled to WASM, ~750KB bundle, browser/Workers-compatible. Simple iterator API: `for (const entry of extract(data)) { entry.type, entry.path, entry.data }`. **Must be dynamically imported** (`await import('archive-wasm')`) to avoid WASM init cost on non-archive emails.
- **Limitation**: Encrypted RAR not supported (encrypted ZIP is fine). Unlikely for tax documents — fallback: upload raw + flag for manual extraction.
- For ZIP we prefer the existing in-house extractor (lighter, no WASM overhead) and only load archive-wasm for RAR/7z.

## 4. Codebase Analysis
* **Existing Solutions Found:** `text-extractor.ts` already has `extractFilesFromZip()` and `inflate()` — pure Web API ZIP extraction, Workers-compatible. Currently used for DOCX/XLSX text extraction.
* **Reuse Decision:** Reuse `extractFilesFromZip()` directly with `pathPrefix: ''` to extract all files from a ZIP. Only need to export it (currently module-private).
* **Relevant Files:**
  - `api/src/lib/inbound/types.ts` — extension constants (DOC_EXTENSIONS, SKIP_EXTENSIONS)
  - `api/src/lib/inbound/attachment-utils.ts` — filterValidAttachments(), fetchAttachments(), computeSha256()
  - `api/src/lib/inbound/text-extractor.ts` — extractFilesFromZip(), inflate()
  - `api/src/lib/inbound/processor.ts` — main pipeline orchestration
  - `api/src/lib/inbound/document-classifier.ts` — Claude classification
* **Existing Patterns:** Binary handling via ArrayBuffer/Uint8Array throughout. Image→PDF conversion in processor.ts. SHA256 dedup via computeSha256(). Provenance via `notes` field in PENDING_CLASSIFICATIONS.
* **Alignment with Research:** Existing ZIP extraction aligns perfectly with best practices. Missing: security guards (path traversal, zip bomb, nesting), which must be added in the new module.
* **Dependencies:** extractFilesFromZip (text-extractor.ts), computeSha256 (attachment-utils.ts), getFileExtension (attachment-utils.ts)

## 5. Technical Constraints & Risks
* **Security:** Zip bombs (max 50MB decompressed — Workers 128MB memory limit, raw + decompressed must fit; max 50 files; max 25MB per file), path traversal (`../` in names), nested archives (no recursion). All addressed with explicit guards.
* **Risks:** Password-protected ZIPs will fail extraction silently — fall through to "empty archive" path and get uploaded raw. This is acceptable behavior.
* **Breaking Changes:** None. Existing attachments flow unchanged. Only archives get expanded.
* **RAR/7z via archive-wasm:** WASM bundle adds ~750KB to Worker size (within 10MB limit). Encrypted RAR not supported — fallback to raw upload + flag.
* **ZIP64:** Not supported by existing walker (32-bit sizes). Email attachments are capped at 150MB by MS Graph — not a practical concern.
* **Hebrew filenames in ZIPs:** May be garbled if ZIP was created with CP437 encoding. Content is unaffected — classification works on file content, not filename.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
When a client emails a ZIP containing PDFs/images/docs, each file inside is individually extracted, classified by Claude, uploaded to OneDrive, and tracked in PENDING_CLASSIFICATIONS — just like regular attachments.

### Logic Flow
1. Fetch email attachments (existing)
2. **NEW**: Detect archives by extension (.zip, .rar, .7z)
3. **NEW**: For ZIPs → extract using existing `extractFilesFromZip()` (lightweight, no WASM)
4. **NEW**: For RAR/7z → extract using `archive-wasm` (libarchive WASM)
5. Apply security guards (zip bomb — 50MB max decompressed, path traversal, max 50 files, max 25MB per file, nested archives)
6. Create synthetic AttachmentInfo per extracted file (process one-at-a-time to minimize peak memory)
7. If extraction fails (encrypted, corrupted) → upload raw archive + flag for manual extraction
8. Feed expanded attachment list through existing Phase A (classification) + Phase B (upload)
9. Add provenance notes ("חולץ מ: archive.zip") to PENDING_CLASSIFICATIONS records

### Data Structures / Schema Changes
No Airtable schema changes. New TypeScript types:
- `ARCHIVE_EXTENSIONS` / `EXTRACTABLE_ARCHIVE_EXTENSIONS` constants in types.ts
- `ArchiveExpansionResult` interface (attachments, unextractableArchives, sourceArchiveMap, log)
- `ArchiveLogEntry` interface for structured logging

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/types.ts` | Modify | Add ARCHIVE_EXTENSIONS, EXTRACTABLE_ARCHIVE_EXTENSIONS constants (~3 lines) |
| `api/src/lib/inbound/text-extractor.ts` | Modify | Export `extractFilesFromZip` (add `export` keyword) |
| `api/src/lib/inbound/attachment-utils.ts` | Modify | Import ARCHIVE_EXTENSIONS, update filter to pass archives (~2 lines) |
| `api/src/lib/inbound/archive-expander.ts` | Create | New module: expandArchiveAttachments(), security guards, MIME map, logging (~180 lines) |
| `api/src/lib/inbound/processor.ts` | Modify | Call expandArchiveAttachments() after fetchAttachments(), use expanded list, add provenance notes (~30 lines) |
| `api/package.json` | Modify | Add `archive-wasm` dependency for RAR/7z support |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Active TODOs"

## 7. Validation Plan
* [ ] ZIP with 3 PDFs: all 3 extracted, classified individually, uploaded to OneDrive separately
* [ ] ZIP with mixed types (PDF + DOCX + JPG): each file processed through correct path (PDF direct, DOCX→text extraction, JPG→PDF conversion)
* [ ] ZIP with `../` path traversal: file skipped, logged, other files still processed
* [ ] ZIP with >50 files: only first 50 processed, warning logged
* [ ] ZIP with >50MB decompressed: extraction aborted, archive uploaded as-is
* [ ] Empty ZIP: uploaded as-is, no crash
* [ ] Password-protected ZIP: extraction fails gracefully, archive uploaded raw
* [ ] RAR file: extracted via archive-wasm, each file classified and uploaded individually
* [ ] 7z file: extracted via archive-wasm, each file classified and uploaded individually
* [ ] Encrypted RAR: extraction fails gracefully, archive uploaded raw with manual extraction note
* [ ] Nested archive (ZIP containing a ZIP): inner ZIP not recursively extracted, logged
* [ ] DOCX/XLSX files: NOT treated as archives despite being ZIP format internally
* [ ] SHA256 dedup: same PDF sent both standalone and inside ZIP → dedup catches it
* [ ] Normal (non-archive) attachments: behavior completely unchanged
* [ ] `wrangler deploy` succeeds with no type errors

## 8. Workers Best Practices Review (2026-04-13)
Reviewed against Cloudflare Workers best practices. Findings applied to plan:

| Finding | Severity | Resolution |
|---------|----------|------------|
| Memory pressure: raw archive + decompressed could exceed 128MB | HIGH | Lowered max decompressed from 100MB → 50MB, max per file from 50MB → 25MB |
| WASM init cost on every email request | MEDIUM | Use dynamic `import('archive-wasm')` — only load when RAR/7z detected |
| `archive-wasm` may need `nodejs_compat` flag | CRITICAL | Added verification step: `wrangler deploy --dry-run` before writing code |
| Floating promise risk on `expandArchiveAttachments()` | MEDIUM | Explicitly noted `await` requirement in plan |

**No issues with:** Web Crypto usage (SHA-256), no global mutable state, existing `DecompressionStream` for ZIP, fail-safe pattern, observability config.

**Pre-existing config notes (not blocking):** `compatibility_date` is 12+ months old (2025-03-15), missing `nodejs_compat` flag, using `wrangler.toml` instead of `wrangler.jsonc`.

## 9. Implementation Notes (Post-Code)
* `archive-wasm` required `nodejs_compat` flag as predicted in Workers review — added to `wrangler.toml`
* Bundle size increase: +188 KiB (1251 → 1439 KiB total, 344 KiB gzip) — well within 10MB limit
* `archive-wasm` has no TypeScript declarations; dynamic `import()` returns `any` — acceptable since the API is simple (`extract(data)` → generator of entries)
* `entry.type` values are `'FILE' | 'DIR' | ...` (not `'directory'`) — fixed during implementation
* `entry.data` returns `ArrayBuffer` (not `Uint8Array`) — wrapped with `new Uint8Array()` for consistent handling
