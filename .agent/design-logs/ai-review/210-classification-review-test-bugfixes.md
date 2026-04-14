# Design Log 210: Classification Review Test Bugfixes
**Status:** [COMPLETE]
**Date:** 2026-03-27
**Related Logs:** DL-194 (remove batch status), DL-137 (OneDrive rename fixes), DL-143 (classification test bugfixes)

## 1. Context & Problem
During CPA-XXX classification testing (12 records covering approve, reject, reassign, general_doc creation), 4 bugs were discovered:

1. **Reviewed classifications persist forever** — After DL-194 removed the batch status feature, nothing sets `notification_status` on classification records. Reviewed cards remain visible in AI review tab indefinitely.
2. **Rejected docs retain file_url** — The reject flow clears `file_url`/`onedrive_item_id` in Step 4, but Step 6's OneDrive archive move writes the archive URL back, defeating the clear.
3. **General_doc reassign doesn't rename** — `buildShortName('general_doc', ...)` returns null (no template entry), and `HE_TITLE['general_doc']` is undefined. File keeps original name.
4. **Invalid PDF creates stuck classification** — Corrupted PDFs are sent to Anthropic API which returns 400. A classification record is created with `templateId: null`, `confidence: 0` — stuck in pending with no way to approve (no template match). Real case: CPA-XXX, execution 10615.

## 2. User Requirements
1. **Q:** When should notification_status be set to 'dismissed'?
   **A:** Per client batch — only when ALL classifications for a client are reviewed, then dismiss all at once.

2. **Q:** For rejected docs, skip file_url writeback or store as archive_url?
   **A:** Skip writeback entirely. Doc record stays clean (Required_Missing, no file link).

3. **Q:** For general_doc rename, use doc name directly or prefix with type label?
   **A:** Doc name only — `sanitizeFilename(new_doc_name) + '.pdf'`.

## 3. Research
### Domain
State management cleanup, defensive file operations, graceful degradation.

### Research Verdict
All 4 bugs are straightforward code-level fixes. No architectural changes needed. The patterns are: guard clauses for action-specific logic, fallback chains for template lookups, and input validation before external API calls.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `airtable.batchUpdate()` exists and is used by reminders — can reuse for Bug 1 batch dismiss
  - `sanitizeFilename()` exists in classification-helpers.ts — reuse for Bug 3
  - Large PDF fallback path exists (line 490-491) — reuse pattern for Bug 4
* **Reuse Decision:** All fixes use existing utilities. No new modules needed.
* **Relevant Files:**
  - `api/src/routes/classifications.ts` — review-classification endpoint (Bugs 1-3)
  - `api/src/lib/inbound/document-classifier.ts` — PDF classification (Bug 4)
* **Dependencies:** Airtable Pending_Classifications table (`notification_status` field), OneDrive Graph API

## 5. Technical Constraints & Risks
* **Security:** No concerns — all changes are within existing auth-gated endpoints.
* **Risks:** Bug 1's batch dismiss query adds one extra Airtable API call per review action. Low risk — query is filtered and fast.
* **Breaking Changes:** None.

## 6. Proposed Solution (The Blueprint)

### Bug 1: Batch dismiss notification_status
**File:** `api/src/routes/classifications.ts`, after Step 5 (line 567)

**Logic:**
1. After updating the classification's `review_status`, query remaining pending classifications for this client:
   ```
   AND({client_id}='CPA-XXX', {review_status}='pending')
   ```
2. If count = 0 → all reviewed → batch update ALL classifications for this client to `notification_status: 'dismissed'`:
   ```
   AND({client_id}='CPA-XXX', {notification_status}='')
   ```
3. Use `airtable.batchUpdate()` for the batch update.

### Bug 2: Guard file_url writeback on reject
**File:** `api/src/routes/classifications.ts`, line 675

**Change:** Add `action !== 'reject'` guard:
```typescript
if (moveResult?.webUrl && action !== 'reject') {
```

### Bug 3: general_doc rename fallback
**File:** `api/src/routes/classifications.ts`, after line 624

**Add fallback after the `HE_TITLE` check:**
```typescript
} else if (targetIssuer) {
  // Fallback for general_doc or unknown template types
  newFilename = sanitizeFilename(targetIssuer) + '.pdf';
}
```
This catches `general_doc` and any other template type without a `HE_TITLE` entry.

### Bug 4: PDF header validation
**File:** `api/src/lib/inbound/document-classifier.ts`, before line 492

**Add validation:**
```typescript
// Validate PDF header before sending to Claude
const pdfBytes = new Uint8Array(attachment.content);
const header = String.fromCharCode(...pdfBytes.slice(0, 5));
const isValidPdf = header.startsWith('%PDF');

if (!isValidPdf) {
  // Corrupted PDF — fall back to filename-only classification
  content.push({ type: 'text', text: `[PDF file appears corrupted — cannot read content. Classify based on filename and email context only. Filename: ${attachment.name}, Size: ${sizeKB}KB]` });
} else {
  content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
}
```

### Files Changed
| File | Description |
|------|-------------|
| `api/src/routes/classifications.ts` | Bug 2: guard file_url writeback on reject. Bug 3: general_doc rename fallback. New `/dismiss-classifications` endpoint. |
| `api/src/lib/inbound/document-classifier.ts` | Bug 4: PDF header validation before Anthropic API call |
| `admin/js/script.js` | "סיום בדיקה" prompt when all client items reviewed + dismiss button deletes records |
| `admin/css/style.css` | Styles for review-done prompt |
| `shared/endpoints.js` | Added DISMISS_CLASSIFICATIONS endpoint |

## 7. Validation Results (2026-03-28)
Tested with CPA-XXX (Client Name), 12 sample documents sent via email.

* [x] Bug 1: "סיום בדיקה" prompt appears after last review action → click deletes all records from Airtable
* [x] Bug 1: Prompt survives page refresh (persists until explicitly dismissed)
* [x] Bug 2: Reject classification → doc record has `file_url: null`, `onedrive_item_id: null` (verified via API)
* [x] Bug 3: Code correct — general_doc fallback uses `sanitizeFilename(targetIssuer) + '.pdf'`. Not testable in this round (classification had no OneDrive file to rename).
* [x] Bug 4: Corrupted PDF (`test_corrupted_106_elbit.pdf`) → classification created successfully with `confidence: 0.65` (filename fallback). No API 400 crash.
* [x] UI: Green prompt with stats (10 אושרו · 1 שויכו · 1 נדחו), "✓ הושלם" badge, accordion collapse animation

## 8. Implementation Notes
* **Design evolution:** Bug 1 was initially implemented as auto-dismiss (`notification_status = 'dismissed'` set server-side on last review). This conflicted with the "סיום בדיקה" UI feature — records were dismissed before the user could see the prompt on refresh. Final design: no auto-dismiss, records stay until admin explicitly clicks "סיום בדיקה" which calls `POST /dismiss-classifications` to bulk-delete them.
* **Commits:** `9fd3454` (4 bug fixes), `4538bae` (dismiss endpoint), `3c72b93` (remove auto-dismiss), `a788a93`/`277e9f4`/`2d63ac4` (frontend)
