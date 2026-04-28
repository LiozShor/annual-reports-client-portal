# Design Log 367: Fetch Gmail Drive Smart-Link Attachments

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-28
**Branch:** `DL-367-gmail-drive-smart-links`
**Related Logs:** DL-203 (WF05 Worker migration), DL-282 (forwarded-email parsing), DL-260 (archive expansion), DL-315 (pre-questionnaire fallback)

---

## 1. Context & Problem

When a Gmail user attaches PDFs via "Insert from Drive", Gmail does **NOT** send them as MIME attachments. Instead, it embeds inline `gmail_drive_chip` HTML cards in the email body — visually they look like attachment cards in Outlook, but on the wire they are pure HTML with `<a href="https://drive.google.com/file/d/{id}/view">` links and `hasAttachments: false`.

**Live case (today, 2026-04-28):** a client sent 4 PDFs this way. Probe via Microsoft Graph confirmed:
- `hasAttachments: false`
- 0 Graph attachments
- 4 unique Drive file IDs in body HTML inside `gmail_drive_chip` divs

Result: `email_event` marked `Completed`, 0 `pending_classifications`, docs effectively lost. The earlier interim guard (deployed `dd2ae255`) only triggers when `hasAttachments=true` but readable=0; it doesn't catch this case because Gmail correctly reports `hasAttachments=false`.

## 2. User Requirements

1. **Q:** Drive content carrier shape — investigate first.
   **A:** Confirmed: body-HTML `gmail_drive_chip` cards (NOT Graph `referenceAttachment`).
2. **Q:** Sharing permission model? **A:** Anonymous "anyone with link" only. No OAuth.
3. **Q:** URL allowlist? **A:** Google Drive + Docs only.
4. **Q:** Size cap? **A:** 25 MB. Larger → NeedsHuman.
5. **Q:** On Drive download failure? **A:** NeedsHuman + admin notification only (no auto-reply to client).
6. **Q:** Strip chips from LLM-summarized note? **A:** Yes — chips are attachments, not prose.
7. **Q:** Parser scope? **A:** Both Gmail chips AND bare `drive.google.com/file/d/...` URLs.

## 3. Research

### Domain
Email parsing, HTTP file fetching with anonymous public links, content-type sniffing.

### Sources
1. **discuss.google.dev — May 2024 endpoint migration** — `https://drive.usercontent.google.com/download?id={id}&export=download&authuser=0` is the current direct-download endpoint.
2. **GitHub `ndrplz/google-drive-downloader` PR#30** — `&confirm=t` query param bypasses the virus-scan / large-file warning page without cookie+token round-trip.
3. **Stack Overflow — Drive content-type detection** — Drive returns `text/html` (the "you need access" page) instead of `application/pdf` when the file isn't shared "anyone with link". Content-Type check at the boundary is the cleanest permission detector.

### Key Principles
- **Validate at the boundary.** Allowlist hosts, cap size, verify Content-Type before treating bytes as a document.
- **Don't trust filenames from email bodies.** The chip's `<a title="X.pdf">` is helpful for naming but not authoritative — let the existing classifier verify what the file actually is via Content-Type.
- **Single failure path.** Failed Drive fetches → `NeedsHuman` with Drive URLs preserved in `error_message`.
- **Idempotency.** The existing `classification_key = ${clientId}-${year}-${name}` upsert handles re-processing.

### Patterns to Use
- **Source-agnostic AttachmentInfo synthesis** — Drive fetcher returns the same `AttachmentInfo` shape that `fetchAttachments` produces; the rest of the pipeline is unchanged.
- **HTML-first chip stripping** for note hygiene before LLM summarization.

### Anti-Patterns to Avoid
- Following arbitrary URLs (SSRF risk) — allowlist Google domains only.
- Trusting Content-Length (Drive can omit it) — read with hard byte cap.
- Cookie session simulation — `&confirm=t` is the supported single-shot path.

### Research Verdict
Build a single-shot anonymous fetcher: parse file IDs from body HTML (chips + bare URLs), call `https://drive.usercontent.google.com/download?id={id}&export=download&authuser=0&confirm=t`, validate Content-Type and size, synthesize `AttachmentInfo`, hand off to the existing pipeline. Failure → NeedsHuman.

## 4. Codebase Analysis

### Existing Solutions Found
- **`fetchAttachments(graph, messageId)`** at `attachment-utils.ts:58` — produces `AttachmentInfo[]`. Drive results merge into the same array.
- **`computeSha256(content)`** at `attachment-utils.ts:43` — reused for hashing fetched binaries.
- **`processInboundEmail`** at `processor.ts:725` — pipeline orchestrator. Inject Step 4a after `fetchAttachments`.
- **`stripQuotedContent`** at `processor.ts:228` — extend with chip-aware stripping.
- **`processAttachmentWithClassification`** at `processor.ts:481` — reused as-is.

### Reuse Decision
Reuse: `AttachmentInfo` shape, `computeSha256`, classification + upload pipeline, `pending_classifications` upsert, `email_event` upsert, `NeedsHuman` flagging.
New code: body-HTML Drive-link parser (~40 lines), Drive fetcher with allowlist + size cap + content-type check (~60 lines), chip-stripper (~15 lines).

### Relevant Files
| File | Role |
|------|------|
| `api/src/lib/inbound/attachment-utils.ts` | Add `parseDriveLinks`, `fetchDriveAttachment`, allowlist constants |
| `api/src/lib/inbound/processor.ts` | Step 4a integration; chip removal; revise `ghostAttachments` |
| `api/src/routes/backfill.ts` | Remove temp `/inspect-graph-message` probe |

### Dependencies
Cloudflare Workers `fetch()` (built-in). No new env vars / no schema changes.

## 5. Constraints & Risks

- **SSRF:** mitigated by host allowlist + ID format validation + non-200/non-binary rejection.
- **Abuse:** 25 MB byte-counter cap on streamed response; reject non-PDF/image/office Content-Type.
- **Workers limits:** sequential fetch (1 at a time, 500 ms spacing) keeps memory bounded.
- **Drive rate limits:** catch 429 → NeedsHuman.
- **Breaking changes:** None (additive).

## 6. Proposed Solution

### Success Criteria
A client email containing Gmail Drive smart-link chips (or bare Drive URLs) ends with the same outcome as if files had been sent as MIME attachments: one `pending_classifications` row per file, file uploaded to client's OneDrive folder, clean LLM-summarized note (without chip HTML).

### Logic Flow

**Step A — Parser (`parseDriveLinks`)**
Input: `bodyHtml`. Returns: `Array<{fileId, filename}>`.
1. Match `gmail_drive_chip` divs → `{fileId, filename}` from chip ID + `<a title>`.
2. Fallback: bare URLs `https?://(drive|docs).google.com/(file/d/|open?id=|uc?...id=)([a-zA-Z0-9_-]{20,})`.
3. Dedup by fileId; chip filename takes precedence.

**Step B — Fetcher (`fetchDriveAttachment`)**
1. URL: `https://drive.usercontent.google.com/download?id={fileId}&export=download&authuser=0&confirm=t`.
2. `fetch()` with default redirect-follow.
3. Validate: HTTP 200, `content-type` ∈ {pdf, octet-stream, image/*, office types}.
4. Stream-read body with 25 MB byte cap.
5. Compute sha256, return `AttachmentInfo`.

**Step C — Pipeline integration (`processor.ts`)**
After `fetchAttachments`:
- Parse Drive links from `email.body?.content`.
- Sequential fetch with 500ms spacing.
- Append successes to `attachments`; collect failures.

**Step D — Note hygiene**
Modify `extractMetadata` to strip `gmail_drive_chip` div blocks from `bodyHtml` before HTML→text conversion. Also pass parsed Drive filenames into `stripQuotedContent` for `bodyPreview`-derived text.

**Step E — Failure handling**
- All-fail (`attachments.length === 0` after Drive fetch): `NeedsHuman` + `error_message` listing Drive URLs.
- Partial: process successes normally; mark `NeedsHuman` at end with only failed URLs.

**Step F — Revise `ghostAttachments` guard**
```
const ghostAttachments =
  (!!email.hasAttachments && attachments.length === 0) ||
  (driveLinks.length > 0 && driveResults.length === 0);
```

**Step G — Cleanup**
Remove temp `/inspect-graph-message` endpoint.

### Files to Change
| File | Action |
|------|--------|
| `api/src/lib/inbound/attachment-utils.ts` | Modify (add helpers) |
| `api/src/lib/inbound/processor.ts` | Modify (integration + chip strip + ghost guard) |
| `api/src/routes/backfill.ts` | Modify (remove temp probe) |

### Final Step (Housekeeping)
- Mark DL-367 `[IMPLEMENTED — NEED TESTING]`
- Copy Section 7 to `current-status.md`
- Deploy via `wrangler deploy`
- Backfill the test client's email
- Update INDEX.md
- Commit on branch → push → **pause for merge approval**

## 7. Validation Plan

- [ ] **Unit — `parseDriveLinks`:** the test client's chip-only HTML returns 4 `{fileId, filename}` entries with correct Hebrew filenames.
- [ ] **Unit — `parseDriveLinks`:** bare URL `https://drive.google.com/file/d/ABC.../view` returns 1 entry; dedup vs chip with same ID.
- [ ] **Unit — `parseDriveLinks`:** non-Google URL returns 0 entries.
- [ ] **Unit — `fetchDriveAttachment`:** public PDF returns `AttachmentInfo` with valid sha256 + size.
- [ ] **Unit — `fetchDriveAttachment`:** unshared file (HTML response) returns `{error: 'not_binary_text/html'}`.
- [ ] **Unit — `fetchDriveAttachment`:** 30 MB file aborts with `{error: 'too_large'}`.
- [ ] **Unit — `stripQuotedContent`:** input with chip filenames does NOT leak them into cleaned body.
- [ ] **E2E — the test client's email re-ingestion:** `pending_classifications` shows 4 rows for CPA-XXX; test client's OneDrive folder (`<client_name>/2025/דוח שנתי/`) contains the 4 PDFs.
- [ ] **E2E — public Drive client test:** willing client sends 1 PDF as smart-link → processed within ~2 min.
- [ ] **E2E — unshared Drive test:** smart-link without "anyone with link" → `NeedsHuman` + Drive URL in error_message.
- [ ] **Regression — direct attachments:** normal MIME-attached email still processes identically.
- [ ] **Regression — chip-strip note:** prose + 1 chip → note stores prose only.
- [ ] **Cleanup verified:** `/webhook/inspect-graph-message` returns 404 after deploy.

## 8. Implementation Notes (Post-Code)

- **Deploy version:** `69e3a88b-c51d-4fae-bcff-c4456f740e96` (final, temp endpoints removed). Earlier `451fe3f3` had broken chip regex → fallback `drive_{fileId}.pdf` filenames.
- **Chip regex fix mid-implementation:** Initial regex required `<a ... title="...">` but Gmail puts the filename `title="..."` on an inner `<div>`, not the anchor. Replaced with two passes (class-then-id and id-then-class ordering) that match `\btitle="..."` on any tag within 4 KB of the chip header. After this fix, the test client's 4 PDFs got their proper Hebrew filenames.
- **Backfill outcome (2026-04-28, CPA-XXX):** 4 `pending_classifications` rows created with correct Hebrew names + classifications:
  - 3× T501 (provident-fund / pension issuers) at confidence 0.95 (issuers correctly extracted from chip filenames)
  - 1× T106 PDF unclassified — operator handles in admin
- **Cleanup needed:** OneDrive folder for the test client may have 4 stale files from the first replay (with `drive_{fileId}.pdf` names). Manual cleanup.
- **Temp endpoints removed in final deploy:** `/webhook/inspect-graph-message` and `/webhook/replay-inbound-email` (both gated by `X-DL367-Probe` header) were used during investigation + backfill, removed before final deploy.
- **Applied principles:** boundary validation (host allowlist + Content-Type + size cap), source-agnostic AttachmentInfo synthesis (Drive results merge into the same array as Graph attachments — pipeline downstream is unchanged), single failure path (NeedsHuman with Drive URLs preserved in error_message).
