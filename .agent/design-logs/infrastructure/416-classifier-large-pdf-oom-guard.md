# Design Log 416: Inbound Classifier — Large-PDF OOM Guard

**Status:** [COMPLETED — 2026-05-17 — superseded in effect by DL-419]
**Date:** 2026-05-17
**Branch:** `DL-416-classifier-oom-guard`
**Related Logs:**
- DL-287 (Cloudflare Queues inbound pipeline + DLQ machinery)
- DL-367 (Gmail Drive smart-link inbound fetch + original 25 MB cap)
- DL-414 (raised Drive cap 10/25 MB → 50 MB, 2026-05-15 — exposed this latent bug)

---

## 1. Context & Problem

**Trigger event.** 2026-05-17 12:16:47Z a Microsoft Graph inbound notification was dead-lettered after 3 failed delivery attempts on the `inbound-email` queue. Workers Observability (`scripts/query-worker-logs.mjs`, 12:10–12:20Z window):

| Attempt | Timestamp | Outcome | Wall ms | CPU ms |
|---|---|---|---|---|
| 1 | 12:10:46Z | `exceededMemory` | 71,922 | 8,005 |
| 2 | 12:12:36Z | `exceededMemory` | 69,746 | 8,442 |
| 3 | 12:14:27Z | `exceededMemory` | 71,078 | 5,557 |
| DLQ | 12:16:47Z | `[dlq] dead-lettered` | — | — |
| 4th delivery (separate MS Graph webhook re-fire) | 12:15:38→16:14Z | `done status=completed` (`inbound_note_saved`, `matched=true`) | — | — |

Email contained one Gmail Drive chip — `drive_1M2AOxsonFC4pEL0PV9oHjzzADN0pQX0L.pdf`, **33,672,812 bytes (~32 MB)**.

**Root cause.** `api/src/lib/inbound/document-classifier.ts`:
- L810 ran `const base64 = arrayBufferToBase64(attachment.content)` **unconditionally**, before the L813 size check.
- For PDFs ≥ 5 MB the resulting base64 is *discarded* — L828 sends only a text placeholder to Anthropic. Encode was pure waste.
- The helper (L404–411) used **per-byte string concatenation** (`binary += String.fromCharCode(bytes[i])`) — pathological O(n²) memory behavior in V8.

Peak for a 32 MB PDF ≈ 32 MB buffer + 32 MB intermediate string + ~43 MB base64 + concat-grow overhead → past the 128 MB per-isolate Workers cap.

DL-414 (2026-05-15) raised the Drive fetch cap to 50 MB. Anything 5–50 MB now lands in the classifier and triggered this latent bug.

## 2. User Requirements (Q&A)

1. **Q:** Scope — surgical or broader memory-safety pass?
   **A:** Handle large files: if a file is too large and would crash, don't classify it. → surgical encode fix **plus** a hard memory guard with filename-only fallback.
2. **Q:** UX for >5 MB PDFs?
   **A:** Keep current filename + email-context classification (existing `isLargePdf` branch behavior).
3. **Q:** What to do with today's DLQ'd message `AAMkAG…AABg2jxOAAA=`?
   **A:** Verify Airtable state in §7 before acting. Logs suggest a separate MS Graph webhook re-fire already landed it.
4. **Q:** Deploy path?
   **A:** Standard ship-to-main → `bash .claude/workflows/deploy-worker.sh`.

## 3. Research

### Domain
Cloudflare Workers memory limits · memory-efficient ArrayBuffer→base64 on V8 · CF Queues DLQ semantics.

### Sources Consulted

1. **Cloudflare Workers — Limits** (`developers.cloudflare.com/workers/platform/limits`) — 128 MB per isolate (not raisable). On exceed: invocation outcome `exceededMemory`. Official remedy: stream / avoid large in-memory objects; store in KV/R2/D1 instead of holding in Worker memory.
2. **base64.sh blog + StackOverflow #9267899** — Per-byte `binary += String.fromCharCode(b)` is the documented anti-pattern (synchronous, O(n²) memory). Canonical fix: 32 KB (`0x8000`) chunked encode via `String.fromCharCode.apply(null, bytes.subarray(i, i+CHUNK))`.
3. **Cloudflare Queues — Dead Letter Queues docs** — DLQ is just another queue; messages persist 4 days without a consumer. We *have* a consumer (`handleInboundDLQ`) that ack-logs-and-drops, so today's message is already gone from the DLQ. Replay would need an upstream MS Graph re-fetch + re-enqueue.

### Key Principles Extracted
- **Size-gate before allocation** — don't pay for bytes you'll throw away.
- **Chunked encoding (32 KB) is the V8-friendly pattern**.
- **Defense in depth** — even with the encode moved, a hard `MAX_CLASSIFIABLE_BYTES` ceiling with graceful fallback prevents OOM as a failure mode.
- **DLQ ack-and-log is correct** — retrying a budget-exhausted message either spins on a vendor outage or masks a code bug.

### Patterns Reused
- Existing `isLargePdf` text-placeholder branch (L828–830) already implements the desired UX — `isOversize` shares it.
- `processInboundEmail` upserts are idempotent (DL-287 contract).

### Anti-Patterns Avoided
- ❌ Removing the encode entirely (would break small-PDF + image content classification).
- ❌ Streaming base64 through `TransformStream` (overkill — we don't *want* the encoded result for large PDFs).
- ❌ Feature-flag gating (per CLAUDE.md: just change the code).

### Verdict
Two-part change: (1) chunked encoder + reorder so encode runs only when consumed; (2) hard `MAX_CLASSIFIABLE_BYTES = 20 MB` ceiling routing oversize attachments to the existing filename-only branch. One file. ~30 lines.

## 4. Codebase Analysis

**Files modified (1):**
- `api/src/lib/inbound/document-classifier.ts`
  - `arrayBufferToBase64` — replaced per-byte concat with 32 KB chunked `apply` + `parts.join('')`.
  - New `MAX_CLASSIFIABLE_BYTES = 20 * 1024 * 1024`.
  - `classifyDocument` body reordered: compute type flags first; `isOversize` branch appended at top of dispatch; base64 encode pushed inside the small-PDF and image branches (so it never runs for `isOversize`, `isLargePdf`, `isInvalidPdf`, DOCX-text, or XLSX paths).

**Read-only / referenced:**
- `api/src/lib/inbound/queue-consumer.ts` — confirms retry → DLQ pipeline.
- `api/src/lib/inbound/dlq-consumer.ts` — confirms ack-and-log.
- `api/src/lib/inbound/attachment-utils.ts:124` — `DRIVE_DEFAULT_MAX_BYTES = 52_428_800` (DL-414).
- `api/wrangler.toml` L62–80 — `max_retries=3`, DLQ wired.

**Other `arrayBufferToBase64` call sites:**
- L844 (now ~L865 after reorder) — DOCX-extracted images, ≤3, each bounded. Untouched; still benefits from chunked encoder.

## 5. Constraints & Risks

- **128 MB per-isolate cap is hard.** Must size-gate, not compress.
- **DOCX/XLSX paths unchanged** — text-extract first; image base64 is bounded.
- **Image branch** still encodes; a hypothetical 50 MB image now routes to filename-only via `isOversize` — acceptable (real client docs aren't 50 MB images).
- **No contract changes.** `ClassificationResult` shape, Anthropic API call, queue config all unchanged.

## 6. Solution Shipped

### 6.1 Chunked encoder
```ts
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // 32 KB
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return btoa(parts.join(''));
}
```

### 6.2 New ceiling
```ts
const MAX_CLASSIFIABLE_BYTES = 20 * 1024 * 1024;
```
Memory math: `buffer (N) + chunked binary (N) + base64 (~4N/3) ≈ 3.4N` peak. 20 MB → ~68 MB peak per attachment, comfortably under the 128 MB cap.

### 6.3 Reordered dispatch
- `isOversize` (size > 20 MB) → text placeholder, no encode.
- `isInvalidPdf` → text placeholder.
- `isLargePdf` (PDF > 5 MB) → text placeholder (existing behavior).
- Small PDF → encode + send.
- Image → encode + send.
- DOCX → text extract; image-fallback encodes only bounded fragments.
- XLSX → text extract only.

Prompt text guard updated to treat `isOversize` like `isLargePdf` ("classify by metadata only, set lower confidence").

### 6.4 No infra / no contract changes
`wrangler.toml`, DLQ handler, `ClassificationResult` shape, Anthropic API signature — untouched.

## 7. Validation Plan

- [ ] **V1 — Live retest, oversize PDF.** Forward a 25–50 MB PDF to `reports@moshe-atsits.co.il`. Watch Workers Logs:
  - `[queue] processing` → `[classifier] Oversize attachment …` warning → `[queue] done status=completed` on **first attempt**.
  - No `exceededMemory`, no DLQ.
- [ ] **V2 — Regression, normal PDF.** Forward a <5 MB real PDF; confirm Anthropic still receives the document bytes and matched_template fires.
- [ ] **V3 — Regression, mid-size PDF (5–20 MB).** Forward an 8 MB PDF; confirm `isLargePdf` filename-only branch fires (no `exceededMemory`).
- [ ] **V4 — Audit today's DLQ'd message state.** Source `.env`; query Airtable `email_events` and `pending_classifications` for `message_id=AAMkAGNlNTUzYjFhLThiNjItNDVkNy04ZDg4LTk5ZGFmY2Q3Mjk4OQBGAAAAAABkJX1h1wKBRYTdkpeLuY7IBwCvdIGqh9POR5eOxKWAcHHiAAAAAAEMAACvdIGqh9POR5eOxKWAcHHiAABg2jxOAAA=`. If both populated → no recovery needed (12:15:38Z redelivery landed it). If partial → manual recover via MS Graph subscription replay.
- [ ] **V5 — Image regression.** Send a small (<5 MB) JPG/PNG; confirm encode + classify path still works.
- [ ] **V6 — DOCX regression.** Send a DOCX with embedded images; confirm `imgBase64` path still works under chunked encoder.

## 8. Implementation Notes

- Edits applied on branch `DL-416-classifier-oom-guard` off updated `origin/main`.
- `npx wrangler deploy --dry-run -c wrangler.toml` from `api/` passed (bundle 2,331.79 KiB / 647.54 KiB gzip) — no type errors, no new bindings.
- No cache-bust required — Worker-only change, no frontend asset touched.
- Awaiting explicit "go" from user before push/merge/deploy (per project's "ask before merge and push" memory).
