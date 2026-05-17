# Design Log 420: Inbound Must Never Silently Drop Attachments

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-17
**Branch:** `claude-session-20260517-174347`
**Related Logs:**
- DL-417 (stuck `email_events` diagnose + monitor widget — extended here)
- DL-419 (large-file passthrough: oversize-classify-skip + chunked OneDrive upload)
- DL-414 (raised Drive fetch cap to 50 MB)
- DL-412 (AI-Review reassign flow — handles `matched_template_id=null` rows)
- DL-361 (unidentified-client path — template for "upload + PC w/o classification")

---

## 1. Context & Problem

**Trigger.** 2026-05-17 re-forward from a client (CPA-XXX) had 13
attachments. 7 `pending_classifications` rows were created, 1 file was rejected
as `too_large`, and **5 files were silently dropped** — likely a mix of broken
IBKR ZIPs and classify failures whose surrounding catches in `processor.ts`
swallowed the entire attachment.

**Hard invariant** (user-stated): every inbound attachment must end up with
(a) a file in OneDrive when bytes were obtained AND (b) a
`pending_classifications` row in AI Review — regardless of classify failure,
ZIP-extract failure, or `too_large` rejection. **"Users not visiting the
Outlook to look for orphaned client's mails."** AI Review IS the office's
inbox; if a file isn't there, it doesn't exist.

### Failure points before DL-420

| File:Line | Catch | What was dropped |
|---|---|---|
| `processor.ts:1285-1296` | `processAttachmentWithClassification` throws | Entire attachment — no upload, no PC |
| `processor.ts:1337-1343` | Outer attachment-loop catch | Entire attachment + any partial PC |
| `attachment-utils.ts:184-254` | `fetchDriveAttachment()` size-cap reject | Only added to `driveFailures[]`, never became a PC |
| `archive-expander.ts:256-266` | ZIP extract catch | ZIP kept in `attachments[]`; but a corrupt archive then tripped classify failure → outer catch dropped it |

`document-classifier.ts:919/1045-1057` already returns a graceful
`ClassificationResult` on LLM failure — the classify step itself doesn't drop;
the surrounding catches did.

## 2. User Requirements (Q&A)

1. **Q:** Should classify-failed files land in the client's folder or "לקוח לא מזוהה"?
   **A:** Client's folder — same as the happy path. The client is identified;
   only the document type isn't.
2. **Q:** New `email_events.processing_status` value for partial failures?
   **A:** No new enum value. Keep `Completed`. Use a numeric counter
   (`attachments_failed_count`) as the partial-failure signal so DL-417's
   widget can badge them.
3. **Q:** Surface the `too_large` Drive file in AI Review?
   **A:** Yes — metadata-only PC with `file_url=driveUrl`, `onedrive_item_id=''`,
   `matched_template_id=null`. Office clicks through to Drive directly.
4. **Q:** Should the raw-upload path (clients with no active reports) also
   produce PCs for every attachment?
   **A:** No — keep current behavior. Those reports are post-`Collecting_Docs`
   and don't need AI Review surfacing.

## 3. Files Modified

| File | Change |
|---|---|
| `api/src/lib/airtable.ts` | `updateRecord` gains `opts:{typecast?:boolean}` for auto-creating the 2 new `email_events` fields on first failure. |
| `api/src/lib/inbound/types.ts` | `AttachmentInfo` gains optional `tooLarge` + `driveUrl` markers for synthetic Drive stubs. |
| `api/src/lib/inbound/processor.ts` | (a) `too_large` Drive failures synthesize a stub attachment so the loop sees them. (b) New helper `createFallbackPendingClassification()` writes a metadata-only PC with `matched_template_id=null`, `ai_reason='[DL-420] …'`, `file_url=driveUrl` for too_large. (c) `processAttachmentWithClassification` takes an `outcome?:{pcCreated}` out-param; sets `true` after successful create / duplicate-skip / non-document short-circuit. (d) Per-attachment loop wraps in try/catch — on throw without `pcCreated`, writes a fallback PC. (e) After loop, PATCH `email_events.attachments_failed_count` + `failed_attachments` with `typecast:true`. |
| `api/src/routes/admin-stuck-emails.ts` | (a) Drop `fields:[]` so new typecast fields auto-included once Airtable creates them. (b) Second query for `processing_status='Completed' AND attachments_failed_count>0` (try/catch — 422s silently until the field exists). (c) New bucket `partial-failure` for Completed-with-failures. (d) Per-row `attachments_failed_count` + `failed_attachments` strings in response. |
| `frontend/admin/js/modules/stuck-emails-widget.js` | (a) New `❗ כשל חלקי (N)` count pill. (b) Per-row `❗ N נכשלו` badge with `failed_attachments` as tooltip. (c) Amber border for `bucket-partial-failure`. Cache-bust `?v=3→v=4` in `index.html`. |
| `docs/airtable-schema.md` | Document the 2 new `email_events` fields. |
| `.agent/design-logs/INDEX.md` | Add DL-420 row. |

`archive-expander.ts` unchanged — its existing "keep raw ZIP in `attachments[]`
when extract fails" behavior is exactly what the new loop body needs.

## 4. Status Semantics

- **`Completed`** = pipeline finished without aborting. Stays as-is.
- **`attachments_failed_count > 0`** + `Completed` = partial failure. Some
  attachments took the fallback path (PC with `matched_template_id=null`).
- **`Failed` / `NeedsHuman`** = unchanged (full pipeline abort / unidentified).

The DL-417 widget shows the existing buckets plus a new `partial-failure`
bucket; rows have a tooltip-bearing `❗ N נכשלו` badge.

## 5. Recovery — Existing Stuck Emails (2026-05-17 CPA-XXX incident)

**Question (user, mid-implementation):** *should I delete and recover their
mails? or it will be end up as a duplicated docs in pending classification
table and OneDrive?*

**Answer:** Do **not** re-forward the original email after DL-420 deploys —
you'd get duplicates because:

1. The 7 PCs already created on the first pass remain in Airtable and have
   real `file_hash` values. Re-processing would trip the DL-409 `file_hash`
   duplicate-skip path (good — no duplicate PC for them) but the OneDrive
   `conflictBehavior=rename` would still create `filename (1).pdf` copies
   (bad — duplicate files).
2. The 5 silently-dropped attachments have NO `file_hash` row anywhere, so
   they'd process cleanly — but only IF the underlying failure (corrupt ZIP /
   classify error) isn't deterministic. For IBKR ZIPs we know it is — they'd
   drop again pre-DL-420; with DL-420 they'd produce fallback PCs.

**Recommended recovery for CPA-XXX:** wait for DL-420 to deploy, then ask
the user to re-forward only the 6 missing files (5 dropped + 1 too_large)
**as a fresh email** so `file_hash` dedup correctly skips the 7 already-
processed files when MS Graph delivers a re-attached body. If that's
impractical, manually trigger reprocessing of the original `email_event`
row via the existing admin re-trigger flow — DL-420's fallback PC path will
handle the 6 missing ones; the 7 hash-known ones will dedup-skip.

The "duplicate OneDrive files" risk only materializes if you re-process the
**same MS Graph message** through the inbound pipeline. Don't.

## 6. Verification Plan

- [ ] `./node_modules/.bin/tsc --noEmit` clean from `api/`
- [ ] `bash .claude/workflows/deploy-worker.sh` succeeds; health endpoint green
- [ ] Live: re-forward a curated test email with 1 normal PDF, 1 corrupt ZIP,
      1 too-large Drive file, 1 PDF that triggers classify failure → expect
      4 PCs (1 happy, 3 fallback) and `attachments_failed_count=3`.
- [ ] DL-417 widget shows new `partial-failure` bucket and `❗` badges with
      tooltip-readable failure reasons.
- [ ] Happy-path regression: clean 1-PDF email still produces 1 PC + 0 failed.
- [ ] Unidentified-client path (DL-361) still creates one PC per attachment.

## 7. Out of Scope

- Bulk-recovery script for past dropped attachments (would need MS Graph
  re-fetch + dedupe against existing PCs). Defer to a follow-up DL if needed.
- Status-enum reform — kept `Completed` as the success terminal to avoid
  cascading changes to reminders, AI Review queue queries, and the DL-417
  widget's bucket sets.
- Raw-upload path (clients past `Collecting_Docs`) — out of scope; those
  reports don't surface in AI Review by design.
