---
name: DL-305 Raise inline-image signature-filter threshold
description: Raise inline-image size threshold from 20KB to 50KB so Outlook-rendered signature logos (image00N.png ~30KB) no longer slip through and get ingested as documents
type: design-log
---

# Design Log 305: Raise Inline-Image Signature Filter Threshold (20KB → 50KB)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-19
**Related Logs:** DL-303 (inline-attachment filter rewrite), DL-287 (Cloudflare Queues inbound), DL-260 (archive extraction)

## 1. Context & Problem

DL-303 replaced the blanket `isInline` drop with a narrow guard: `isInline && IMAGE_EXTENSIONS && size < 20_000`. That closed the iPhone-Mail-PDF regression but left a false-positive gap.

Two reports today (2026-04-19 10:12) ingested an Outlook email-signature PNG as a "document":
- **CPA-XXX** — forwarded email from sender
- **CPA-XXX** — forwarded email from sender

Both received the same file: `image002.png`, **29,897 bytes**, SHA-256 `5e9fd5b750151267fde062ece7cbd12d99b1c1bc309168a5b79bfb7d3ba43bd2`. Visual inspection confirms it's the Moshe Atsits office business-card logo block embedded in Natan's Outlook signature — exactly the class of content the inline filter exists to drop.

Root cause: the file is ~29.2KB, above the 20,000-byte threshold from DL-303. Anything the sender's mail client renders at ≥250×~100px with typical PNG compression exceeds 20KB.

## 2. User Requirements

1. **Q:** What's the right discriminator to widen the filter?
   **A:** Raise size threshold 20KB → 50KB.
2. **Q:** What about the two already-ingested records?
   **A:** Lioz will clean Airtable manually. No backfill script.
3. **Q:** Extra protection for forwarded emails (multiple signatures stacked)?
   **A:** No — size-threshold fix is enough. Don't add Fwd:/FW: detection.
4. **Q:** Branch name?
   **A:** `DL-305-inline-signature-filter` (renamed from auto-session name).

## 3. Research

### Domain
Same as DL-303: MIME `Content-Disposition`, MS Graph `fileAttachment`, email-signature image sizing. Incremental research only — see DL-303 for baseline.

### Incremental Findings
- **Outlook inline signature sizing:** Outlook desktop renders branded HTML signatures with logos typically 200–400px wide, saved as PNG. Observed range in client emails: 10KB (monochrome) to 40KB (full-color business-card block). 50KB is a conservative upper bound that covers the office signature (29.8KB) with ~67% headroom.
- **Phone-photo floor:** A 50KB threshold is still well below typical phone photos (500KB–5MB). Only failure mode would be a deliberately-compressed thumbnail a client inlined, which is an unlikely workflow.
- **Office-document floor unchanged:** `.pdf` / `.docx` / `.xlsx` are never affected by this guard — the `IMAGE_EXTENSIONS` check comes first.

### Research Verdict
Bump threshold `20_000 → 50_000`. Single-line change; preserves all DL-303 guarantees (inline PDFs still pass). Accepts a small increase in false-negative risk on very small inlined photos — Natan catches those in AI Review if they ever appear.

## 4. Codebase Analysis

* **File:** `api/src/lib/inbound/attachment-utils.ts:35` — single line to edit.
* **Only call site:** `fetchAttachments` in the same file (unchanged).
* **Downstream:** `archive-expander.ts` / `image-to-pdf.ts` / `processor.ts` unchanged.
* **Dependencies:** None added. `IMAGE_EXTENSIONS` already imported (DL-303).
* **No tests** in `api/` — manual validation is the gate.

## 5. Technical Constraints & Risks

* **Security:** No PII change. Filter widens rejection scope; downstream unchanged.
* **Risk — legit small photo dropped:** Inline photo 20–50KB would now be dropped. Mitigation: phone photos are rarely this small; if one slips, it's visible in email body and can be forwarded as a regular (non-inline) attachment.
* **Risk — signature logos >50KB:** Still possible, but rare for our senders. Falls into AI Review → Natan catches.
* **Breaking changes:** None.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
The exact email flow that produced the CPA-XXX / CPA-XXX false positive, replayed after deploy, leaves no `image002.png` record in `PENDING_CLASSIFICATIONS` — while iPhone-Mail PDF attachments (DL-303 success case) still classify normally.

### Logic Flow (unchanged except the constant)
1. `fetchAttachments` → `RawAttachment[]` from MS Graph.
2. `filterValidAttachments`:
   - `SKIP_EXTENSIONS` → drop
   - `ARCHIVE_EXTENSIONS` → keep
   - `isInline && IMAGE_EXTENSIONS && size < 50_000` → **drop** *(was 20_000)*
   - Unknown ext + tiny → drop
   - Otherwise → keep
3. Remaining attachments decoded + hashed.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/attachment-utils.ts` | Modify | `20_000` → `50_000` on line 35; update inline comment to note the new ceiling |
| `.agent/design-logs/infrastructure/305-inline-signature-filter-threshold.md` | Create | This file |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-305 row |
| `.agent/current-status.md` | Modify | Session summary + test items |

### Final Step (Always)
Housekeeping: status → `[IMPLEMENTED — NEED TESTING]`, Section 7 items copied to `current-status.md`, commit feature branch locally, `wrangler deploy` from `api/`, **pause for explicit approval before merging or pushing to main** (per user memory `feedback_ask_before_merge_push.md`).

## 7. Validation Plan

* [ ] **Replay the bad flow:** After `wrangler deploy`, re-forward the original email that triggered this issue (a forwarded client email with an Outlook HTML signature) from Natan's Outlook to `reports@moshe-atsits.co.il`. Verify no `image002.png` lands in `PENDING_CLASSIFICATIONS` for the matched CPA.
* [ ] **DL-303 regression — iPhone PDF:** Send a PDF from iPhone Mail (isInline=true, >50KB) to the mailbox. Verify it still classifies and uploads to OneDrive.
* [ ] **DL-303 regression — signature <20KB:** Forward an email with a small monochrome signature logo (<20KB). Verify it's still dropped (behavior unchanged for this size class).
* [ ] **New-threshold coverage — signature 20–50KB:** Forward an email with the office signature (known 29.8KB `image002.png`). Verify it is now dropped.
* [ ] **Edge — signature >50KB:** Forward an email with an intentionally-large signature image (>50KB). Expected: passes filter and lands in AI Review (acceptable — Natan rejects manually).
* [ ] **Worker logs clean:** `wrangler tail` shows no unexpected errors.
* [ ] **Manual cleanup:** Lioz deletes existing CPA-XXX / CPA-XXX `image002.png` PENDING_CLASSIFICATIONS rows + OneDrive files (out of code scope).

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
