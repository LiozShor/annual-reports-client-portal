# Design Log 409: Inbound dedup — skip creating pending_classification when file_hash already received
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-06
**Related Logs:** DL-407 (uncovered this gap during the matched_doc_name investigation); DL-112 (file_hash dedup foundation)

## 1. Context & Problem

The inbound processor at `api/src/lib/inbound/processor.ts:549-557` already detects file-hash duplicates — `checkFileHashDuplicate` queries both `documents` and `pending_classifications` for matches and returns `isDuplicate=true` when found. The code uses that signal to:

- ✅ Skip re-uploading the file to OneDrive (`!isDuplicate` guard at `processor.ts:606`)
- ✅ Skip image-to-PDF re-conversion (`!isDuplicate` at `processor.ts:578`)
- ❌ **But still create a fresh `pending_classification` row anyway** — the comment on line 549 literally says "but still create record if duplicate (with warning)"

There's no warning surfaced to the office and no skip-the-queue behavior, so the AI-review tab fills with redundant rows over time.

### Real-world example (uncovered during DL-407 investigation)

CPA-XXX:
- 2026-05-05 16:27 IL — Flavia (client) forwarded email with 7 attachments → 7 `pending_classifications` created. None reviewed.
- 2026-05-06 09:44 IL — same email re-processed (re-forward / replay / unknown). Same 6 file_hashes (one missing). All flagged `isDuplicate=true`. OneDrive correctly reused. **6 fresh `pending_classifications` created.**
- 2026-05-06 17:42–17:44 IL — Natan reviewed today's 6, they got dismissed.
- **Yesterday's 7 still sit in the queue** at `review_status=pending`, with `file_hash` matching already-Received documents. The AI-review counter honestly shows "0/7 נבדקו" for them.

User confirmed: "if a client resends a doc that already in OneDrive — it shouldn't create a new pending classification, isn't it right?"

## 2. User Requirements (open — Phase A not run yet)

Open product questions, to be resolved in Phase A:

- **Q1:** When `isDuplicate=true` AND match is in `documents` (already Received), should the inbound:
  - (a) silently skip creating a new `pending_classification` row entirely?
  - (b) create the row marked `is_duplicate=true` so it's filterable but visible?
  - (c) create the row + emit a soft toast / notification to the office?
- **Q2:** When `isDuplicate=true` AND match is in `pending_classifications` (queue twin still unreviewed), should the inbound:
  - (a) silently skip?
  - (b) increment a counter on the existing row?
  - (c) keep current behavior?
- **Q3:** Should there be a one-shot cleanup endpoint to scrub existing duplicate-pending rows for clients who already have the same `file_hash` in Received state? (User has indicated they can clean CPA-XXX manually via Airtable — open question for general policy.)

## 3. Research

(Phase B not run yet.)

## 4. Codebase Analysis

(Pre-scan only — full Phase C exploration deferred until Phase A is answered.)

- **Bug site:** `api/src/lib/inbound/processor.ts:549-557` (decision point) and the unconditional `pending_classifications` create that follows.
- **Dedup helper:** `api/src/lib/inbound/document-classifier.ts:1049-1083` — already returns `{isDuplicate, fileUrl, itemId}`. We can extend the return shape with `matchedTable: 'documents' | 'pending_classifications'` if Q1/Q2 require different policies.
- **DL-112 baseline:** existing file_hash dedup was scoped to "don't double-upload to OneDrive"; "don't double-queue for review" was always out of scope until now.

## 5. Constraints & Risks

- **Don't drop the row silently if it represents a different client review-action need.** Edge case: client re-sends with corrections (different file_hash → not affected). But if user re-sends the exact same byte content, treating as duplicate is safe.
- **Inbound idempotency.** KV dedup already protects against same-email-processed-twice within a short window. This DL handles the longer-window case where the same hash arrives across separate email events.
- **Existing `is_duplicate` field on `pending_classifications`** (`docs/airtable-schema.md:424`) is currently always `False` per data observation. Re-purposing it for this purpose is cheap.

## 6. Proposed Solution

Phase A decisions (user, this session):
1. Match in `documents` (Received) → **silently skip** the create.
2. Match in `pending_classifications` (queue twin) → **silently skip** the create.
3. Retro cleanup of stale rows → **none** (handled manually via Airtable UI).

Implementation (single guard, two helper changes):

- `api/src/lib/inbound/document-classifier.ts` — `DuplicateCheckResult` extended with `source: 'documents' | 'pending_classifications'`. `checkFileHashDuplicate` now prefers the documents-table match (stronger signal: file already Received) and labels the source so logging is accurate.
- `api/src/lib/inbound/processor.ts` — guard inserted immediately before the `createRecords(PENDING_CLASSIFICATIONS, …)` call. When `isDuplicate` is true, emit a single `attachment_duplicate_skipped` event (category `INBOUND`, PII-safe — first 12 chars of file_hash, no client name, no email body) and `return` early.

The guard short-circuits both:
- the `pending_classifications` create at the original line 715–717, and
- the `matchedDocRecordId` documents-table update at line 720 (already gated by `!isDuplicate` before this DL; now never reached at all on the duplicate path).

The post-create `attachment_classified` event is replaced on the duplicate path by `attachment_duplicate_skipped` so we can grep Workers logs for queue-noise drift.

No retrocleanup, no `is_duplicate=true` write, no soft toast, no tests — explicitly out of scope.

## 7. Validation Plan

**Pre-deploy**
- [x] `cd api && ./node_modules/.bin/tsc --noEmit` — only the two pre-existing unrelated errors (`index.ts`, `activity-logger.ts`); processor.ts + document-classifier.ts clean.

**Post-deploy (live)**
- [ ] Forward an email with one attachment whose file_hash already matches a Received doc on a real client. Expect: NO new `pending_classifications` row; one `attachment_duplicate_skipped` log line with `duplicate_match: 'documents'`; AI-review counter unchanged.
- [ ] Forward the same email twice within ~10 minutes. Expect: first arrival creates a pending row as normal; second arrival fires `attachment_duplicate_skipped` with `duplicate_match: 'pending_classifications'`.
- [ ] Forward an attachment with a never-seen file_hash. Expect: `pending_classifications` row created as before (non-duplicate path unchanged).

**Observability**
- [ ] After a few days, run `node scripts/query-worker-logs.mjs --since=72h --search="attachment_duplicate_skipped"` to baseline how often dedup fires.

## 8. Implementation Notes

- Single commit on `claude-session-20260506-174734`: `fix(inbound): DL-409 skip pending_classifications create when file_hash already known`.
- `processAttachmentWithClassification` returns `Promise<void>` and both call-sites (`processor.ts:1216, 1254`) discard the return — early `return` is safe.
- Wasted upstream work on the duplicate path (notes-building at line 700-703, `classFields` object at 678-713) is harmless and not worth refactoring out for a one-shot guard.
- Cribbed the log shape from `api/src/lib/inbound/bounce-handler.ts:75-85`. `file_hash_prefix` is sha256[0:12] — well below the >12 hex-char threshold flagged by P0 secret-audit safety.
