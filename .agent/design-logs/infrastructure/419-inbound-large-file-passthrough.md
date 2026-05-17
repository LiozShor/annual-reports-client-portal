# Design Log 419: Inbound Large-File Passthrough (OneDrive Upload Sessions + Classifier Skip)

**Status:** [BEING IMPLEMENTED — DL-419]
**Date:** 2026-05-17
**Branch:** `DL-419-inbound-large-file-passthrough`
**Related Logs:**
- DL-414 (raised Drive fetch cap 25 → 50 MB, 2026-05-15 — surfaced this regression)
- DL-416 (classifier base64 OOM fix, 2026-05-17, **shipped + deployed but insufficient**)
- DL-287 (Cloudflare Queues inbound pipeline + DLQ)
- DL-367 (Gmail Drive smart-link fetch path)

---

## 1. Context & Problem

**Trigger.** 2026-05-17 — DL-416 deployed at 15:08Z; the user re-triggered the original 32 MB Drive PDF inbound at 15:06pm; the queue **still OOM'd 3× and DLQ'd at 15:13:08Z**. CF Workers Logs show `[inbound][DL-367] Fetched drive_…pdf (33,672,812 bytes)` followed by 63 s of silence then `outcome=exceededMemory`. No `[classifier]` log fires — the OOM is upstream of DL-416's fix.

**Real root cause** (`processor.ts:processAttachment` Step 6, line 620):
```ts
upload = await uploadToOneDrive(pCtx.graph, oneDriveRoot, …, contentToUpload, …);
```
which delegates to `graph.putBinary(path, ArrayBuffer)` (`ms-graph.ts:97`). For a 32 MB body, CF Workers' `fetch()` buffers the body before transmit → peak ≈ 64 MB just for the PUT, on top of:
- The original 32 MB `attachment.content` still held in scope
- 7 other attachments' contents still in `attachments[]`
- Worker baseline ~30–50 MB

Cumulative pushes past the **128 MB per-isolate cap**.

MS Graph also documents this: simple `PUT /content` has a 4 MB upload limit; files >4 MB *should* use `createUploadSession` with chunked transfer. We've been over-extending it; 32 MB tipped over.

## 2. User Requirements (Q&A)

1. **Q:** Should heavy docs still appear in OneDrive and the pending_classifications queue, just without AI classification?
   **A:** Yes — full passthrough. Upload to OneDrive, create pending_classifications row, **skip Anthropic** for oversize files.
2. **Q:** Upload strategy for files >5 MB?
   **A:** MS Graph upload session with 5 MiB chunks (canonical pattern; chunk size must be a multiple of 320 KiB — 5 MiB = 16 × 320 KiB).
3. **Q:** UX for the oversize row in AI Review?
   **A:** Empty template (`matched_template_id=null`) + Hebrew sentinel `"קובץ גדול — דרוש סיווג ידני"` in `matched_doc_name`. Office reassigns via normal flow.
4. **Q:** Cleanup of orphan rows from earlier failed attempts on CPA-XXX?
   **A:** Leave them — office triages manually.
5. **Q:** Deploy path?
   **A:** Standard ship-to-main → `bash .claude/workflows/deploy-worker.sh`.

## 3. Research

### Domain
MS Graph `driveItem: createUploadSession` chunked upload semantics · Cloudflare Workers `fetch()` body memory behavior · pending_classifications schema (known from DL-416 + DL-407).

### Sources Consulted

1. **Microsoft Graph — `driveItem: createUploadSession`** (`learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession`)
   - Fragment size MUST be a multiple of 320 KiB (327,680 bytes). Non-multiples cause large file transfers to fail on the last byte range.
   - Recommended fragment size 5–10 MiB on stable connections.
   - 4 MiB ÷ 320 KiB = 12.8 → NOT valid. 5 MiB (16 × 320 KiB = 5,242,880) is correct.
   - Fragments must be uploaded sequentially.
   - Headers: `Content-Length: <chunk size>`, `Content-Range: bytes N-M/<total>`.
   - Last chunk's response carries the `DriveItem` (`id`, `webUrl`, `@microsoft.graph.downloadUrl`).

2. **Cloudflare Workers — Best Practices** (`developers.cloudflare.com/workers/best-practices/workers-best-practices`)
   - "Stream request and response bodies. Workers have a 128 MB memory limit, so buffering an entire body … will crash your Worker on large payloads."

3. **MS Graph PowerShell large-file upload sample** (`learn.microsoft.com/en-us/answers/questions/587655`)
   - Validates the chunked-PUT sequence with `Content-Range` headers; final chunk may be smaller than chunk size.

### Key Principles
- Chunk size must be a 320 KiB multiple — off-by-one is the most common upload-session bug.
- Sequential chunks, not parallel (MS Graph rejects out-of-order ranges).
- Free memory eagerly: after upload + page-count, replace `attachment.content` with `new ArrayBuffer(0)` so V8 GC reclaims the bytes before the NEXT attachment's PUT.
- Skip AI call for oversize — saves 5–10 s + Haiku tokens; the row still surfaces in AI Review with a sentinel for manual triage.

### Patterns Reused
- `graph.putBinary(path, ArrayBuffer | ReadableStream)` already accepts both shapes (`ms-graph.ts:97`). The chunked-upload helper uses raw `fetch()` against the pre-authenticated `uploadUrl` (which would reject a Bearer header, so we can't go through `putBinary`).
- DL-416's `MAX_CLASSIFIABLE_BYTES = 20 MB` — now `export`ed so processor.ts uses the same constant for the skip gate.
- Existing `pending_classifications` create at `processor.ts:750-752` natively supports `classification=null` — only added the Hebrew sentinel for the oversize case.

### Anti-Patterns Avoided
- ❌ Lowering `DRIVE_DEFAULT_MAX_BYTES` to 15 MB (defeats DL-414's intent; user explicitly rejected).
- ❌ Streaming the whole processing function (massive scope; image→PDF + Office→PDF tier conversions would also need rewriting).
- ❌ A new feature flag (per CLAUDE.md: just change the code).
- ❌ 4 MB chunk size (not a 320 KiB multiple — last-chunk failure mode).

### Verdict
Three changes across three files, ~120 lines net. No infra/contract change. Ships in one commit.

## 4. Codebase Analysis

**Files modified (3):**

| File | Changes |
|---|---|
| `api/src/lib/inbound/attachment-utils.ts` | NEW `uploadLargeFileToOneDrive` helper (createUploadSession + 5 MiB chunked PUT loop, ~85 lines). `uploadToOneDrive` dispatches: ≤5 MB → existing single PUT; >5 MB → chunked path. New `UPLOAD_SESSION_THRESHOLD = 5 * 1024 * 1024`, `UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024`. |
| `api/src/lib/inbound/processor.ts` | (a) Import `MAX_CLASSIFIABLE_BYTES` from document-classifier; add `OVERSIZE_SENTINEL_DOC_NAME` Hebrew constant. (b) In classify-batch loop (~L1195), early-return null when `attachment.size > MAX_CLASSIFIABLE_BYTES` with a `[DL-419] Skipping AI classification` warn. (c) In `processAttachment` just before Step 8 pending-classifications create: free `attachment.content` + `contentToUpload` + `officePdfContent` when not a duplicate. (d) In Step 8 `classFields`, set `matched_doc_name = OVERSIZE_SENTINEL_DOC_NAME` and `ai_reason = '[DL-419] Skipped AI classification (oversize)'` when classification was skipped. |
| `api/src/lib/inbound/document-classifier.ts` | `MAX_CLASSIFIABLE_BYTES` → `export const`. Removed the now-unreachable `isOversize` branch (DL-416's text-placeholder Anthropic call) since the upstream skip filters those out. Updated `wouldSendPdfBytes` predicate to drop the `!isOversize` term. `userPromptText` ternary drops the `isOversize` disjunct. |

**Read-only / unchanged:**
- `api/src/lib/ms-graph.ts:97` — `putBinary(ArrayBuffer | ReadableStream)`.
- `api/wrangler.toml` — queue config (max_retries=3, DLQ).
- `docs/airtable-schema.md:394` — `pending_classifications` schema (nullable `matched_template_id`).

## 5. Constraints & Risks

- **128 MB per-isolate cap remains hard.** Chunked upload solves the PUT peak; if OTHER attachments in the same email are also large (>5 MB each), cumulative `attachments[]` still grows. The pre-Step-8 memory-free pass mitigates by freeing already-uploaded buffers before the NEXT attachment runs.
- **Per-chunk retry / resumability NOT implemented.** Single-pass upload — if a chunk fails the whole upload fails (same failure mode as today). Future DL can add `nextExpectedRanges` resume.
- **Image→PDF / Office→PDF tier conversions** still buffer the full ArrayBuffer pre-upload. Out of scope — current images are <5 MB in practice.
- **`uploadUrl` is a pre-authenticated short-lived URL.** Hitting it through `graph.putBinary` (which attaches a Bearer header) would reject; we use raw `fetch()` directly. Documented in the helper's doc comment.

## 6. Solution Shipped

### 6.1 `uploadToOneDrive` dispatch + new `uploadLargeFileToOneDrive`
`attachment-utils.ts` (~85 new lines):
- `UPLOAD_SESSION_THRESHOLD = 5 MB`, `UPLOAD_CHUNK_SIZE = 5 MiB`.
- Existing single-PUT path retained for files ≤5 MB.
- New helper: `POST createUploadSession` → loop `PUT uploadUrl` with `Content-Range: bytes N-M/total`. 202 = more chunks expected (drain body). 200/201 on the final chunk carries the DriveItem.

### 6.2 Classifier skip in `processor.ts`
Classify-batch loop's `map(async)` body checks `attachment.size > MAX_CLASSIFIABLE_BYTES`; if so, logs a warn and returns `null` directly. No Anthropic call.

### 6.3 Memory-free in `processor.ts`
Just before Step 8 (pending_classifications create), for non-duplicate paths:
```ts
attachment.content = new ArrayBuffer(0);
contentToUpload   = new ArrayBuffer(0);
officePdfContent  = null;
```

### 6.4 Sentinel in `pending_classifications` row
`classFields.matched_doc_name = OVERSIZE_SENTINEL_DOC_NAME` ("קובץ גדול — דרוש סיווג ידני") when `!classification && attachment.size > MAX_CLASSIFIABLE_BYTES`. `ai_reason` set to `'[DL-419] Skipped AI classification (oversize)'` for the audit trail.

### 6.5 Cleanup of DL-416's now-dead path
`document-classifier.ts` — `isOversize` branch removed; `MAX_CLASSIFIABLE_BYTES` exported; comments refer to the upstream skip in processor.ts.

### 6.6 No infra / no contract changes
`wrangler.toml`, queue/DLQ handlers, `ClassificationResult`/`OneDriveUploadResult` shapes, Anthropic API call, Airtable schema — all unchanged.

## 7. Validation Plan

- [ ] **V1 — Live retest, the 12:08pm email.** User re-detects via Airtable; new attempt should land cleanly:
  - 8 attachments processed, no `exceededMemory`, no DLQ.
  - 7 attachments classified by Anthropic with `matched_template_id` populated.
  - 1 attachment (the 32 MB Drive PDF) creates a pending_classifications row with `matched_template_id=null`, `matched_doc_name='קובץ גדול — דרוש סיווג ידני'`, populated `file_url` + `onedrive_item_id`.
  - Worker logs show `[inbound][DL-419] Skipping AI classification …` + `[inbound][DL-419] Chunked upload start / done`.
  - All 8 files visible in CPA-XXX's OneDrive folder.
- [ ] **V2 — Smoke, normal-size email.** Forward a 2-attachment email with both <5 MB. Both go through single-PUT (no DL-419 chunked-upload log lines), both classified, both rows have `matched_template_id` populated.
- [ ] **V3 — Edge, mid-size between thresholds.** Forward an email with a 6 MB PDF. Chunked upload engages (2 chunks), Anthropic still classifies (size < 20 MB).
- [ ] **V4 — Edge, just over the AI threshold.** Forward a 22 MB PDF. Chunked upload engages, AI classification skipped, sentinel set, row visible in AI Review.
- [ ] **V5 — Memory headroom check during V1.** Workers Logs: `outcome=ok`, wall < 120 s.
- [ ] **V6 — Office reassign flow.** In AI Review, click the sentinel row → reassign to a template. Confirm: documents row updates with `file_url` + correct `type`; pending_classifications row dismissed normally.

## 8. Implementation Notes

- Implemented on branch `DL-419-inbound-large-file-passthrough` off updated `main` (which includes DL-416 merge).
- `npx wrangler deploy --dry-run -c wrangler.toml` passed (build 2331.8 KiB / 647.5 KiB gzip) — no type errors, no new bindings.
- The pre-authenticated `uploadUrl` returned by `createUploadSession` is hit with raw `fetch()` (not `graph.putBinary`) because the upload endpoint rejects Bearer tokens — documented in the helper's doc comment.
- Memory-free pass uses `new ArrayBuffer(0)` rather than `null` so the `attachment.content` field stays a valid `ArrayBuffer` for any downstream consumer that may still touch it; semantically empty.
- DL-416's `isOversize` placeholder Anthropic call removed entirely. The upstream skip in processor.ts is the single source of oversize handling.
