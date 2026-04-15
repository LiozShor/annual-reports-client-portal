# Design Log 277: Fix Reminder Progress Bar Math & Classification 429 Retry
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-15
**Related Logs:** DL-060 (reminder SSOT doc display), DL-062 (reminder tones), DL-203 (WF05 worker migration)

## 1. Context & Problem
Two related issues discovered via client CPA-XXX (Client Name):

**Bug A — Progress bar math mismatch:** Type B reminder email shows "התקבלו 0 מתוך 11 מסמכים | חסרים: 10". If 0 received out of 11 total, missing should be 11 not 10. Root cause: `_docs_missing` uses `myDocs.length` (count of `Required_Missing` status docs from Airtable search = 10) but `_docs_total` counts ALL non-waived docs (11, including 1 `Requires_Fix` doc). The progress bar displays the raw count instead of computing `total - received`.

**Bug B — Classification 429 rate limit with no retry:** Client sent 19 PDF attachments in one email. The inbound pipeline batches classification in groups of 3 (`CLASSIFY_BATCH_SIZE = 3`) but has NO delay between batches and NO retry on 429 errors. 14 of 19 PDFs failed with Anthropic API rate_limit_error, permanently recorded as confidence=0 with no template match. The client was then sent a reminder for "missing documents" she already submitted.

## 2. User Requirements
1. **Q:** Fix approach for progress bar?
   **A:** Compute `missing = total - received` in the email builder (single line change).

2. **Q:** Fix approach for 429 rate limits?
   **A:** Investigate root cause first, then re-classify failed ones.

## 3. Research
### Domain
Resilience Engineering — API rate limit handling in document processing pipelines.

### Key Principles
- **Retry with exponential backoff** is the standard pattern for 429 responses. Anthropic's 429 response includes a `retry-after` header.
- **Fail-forward with recovery** — when classification fails, the record should be marked for retry rather than permanently stored as failed.
- **Concurrency control** — batches of 3 is reasonable, but no inter-batch delay means 19 calls fire in ~seconds.

## 4. Codebase Analysis
### Bug A (Progress Bar)
- **n8n WF[06] `FjisCdmWc4ef0qSV`** — "Build Type B Email" Code node
  - Line 113: `const missing = inp._docs_missing;` ← bug source
  - Lines 111-112: `total` and `received` already available
- **n8n WF[06]** — "Prepare Type B Input" Code node
  - `_docs_missing: myDocs.length || r.docs_missing_count || 0` — only counts `Required_Missing`
- **Airtable rollups:** `docs_total` = COUNT (all linked docs including Waived), `docs_missing_count` = rollup (only `Required_Missing`)
- **✅ ALREADY FIXED** in n8n: `const missing = total - received;`

### Bug B (429 Retry)
- **`api/src/lib/inbound/document-classifier.ts:713-727`** — raw `fetch()` call to Anthropic API, throws on non-OK status, NO retry
- **`api/src/lib/inbound/processor.ts:735-760`** — batches of 3 (`CLASSIFY_BATCH_SIZE = 3`), `Promise.all` per batch, sequential batches, catch returns `null`
- **No inter-batch delay**: for loop immediately starts next batch after `await`
- **No `retry-after` header parsing**: 429 response body/headers ignored
- **Model:** claude-haiku-4-5-20251001 (rate limits: typically ~100 RPM on lower tiers)

### Affected Records (CPA-XXX)
- 19 classification records in `tbloiSDN3rwRcl1ii`, all `pending` status
- 14 have `ai_confidence=0`, `ai_reason: "Classification failed: Anthropic API 429: ..."`
- 5 classified successfully (first ~2 batches before rate limit kicked in)

## 5. Technical Constraints & Risks
* **Workers CPU time:** Retry loops with sleep aren't possible in Workers — use `scheduler.wait()` or `ctx.waitUntil()`
* **Cloudflare Workers 30s limit:** Retry with backoff can add seconds; 3 retries × 4s max = 12s added
* **Active workflow:** WF[06] is a cron job, changes take effect on next run
* **No breaking changes:** retry is additive; existing behavior (fail → null) preserved as final fallback

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Progress bar shows `total - received` for missing count; classification retries up to 3 times on 429 with exponential backoff; CPA-XXX's 14 failed PDFs are re-classified.

### Task 1: Add retry with backoff to `classifyAttachment` (Bug B)
**File:** `api/src/lib/inbound/document-classifier.ts`

Add a `fetchWithRetry` wrapper around the Anthropic API call (lines 713-727):
```ts
async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, init);
    if (resp.status !== 429 || attempt === maxRetries) return resp;
    const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
    const delay = Math.max(retryAfter * 1000, 1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error('unreachable');
}
```

Replace line 714 `fetch(...)` with `fetchWithRetry(...)`.

### Task 2: Add inter-batch delay in processor (Bug B)
**File:** `api/src/lib/inbound/processor.ts`

After each batch's `Promise.all` (line 756), add a 1-second delay:
```ts
if (batchEnd < attachments.length) {
  await new Promise(r => setTimeout(r, 1000));
}
```

### Task 3: Re-classify CPA-XXX's 14 failed records
Use the admin classifications endpoint or write a one-time script to trigger re-classification for the 14 records with `ai_reason` containing "429".

### Task 4: Housekeeping
- Update design log status → `[IMPLEMENTED — NEED TESTING]`
- Update `.agent/current-status.md`
- Git commit & push, merge to main

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/document-classifier.ts` | Modify | Add `fetchWithRetry` wrapper with 429 retry + exponential backoff |
| `api/src/lib/inbound/processor.ts` | Modify | Add 1s delay between classification batches |
| n8n WF[06] Build Type B Email | ✅ Done | `missing = total - received` |

## 7. Validation Plan
* [ ] Deploy Workers and verify no build errors
* [ ] Re-classify CPA-XXX's 14 failed PDFs — all should get proper classification
* [ ] Trigger a test Type B reminder for a report with Requires_Fix docs — verify progress bar shows correct total-received
* [ ] Verify no regression in classification for normal emails (1-3 attachments)

## 8. Implementation Notes (Post-Code)
* n8n WF[06] Build Type B Email updated twice:
  - First: `const missing = total - received` (07:30:37Z) — incorrect, included waived docs
  - Final: `const missing = inp._docs_missing; const displayTotal = received + missing` (07:43:19Z) — correct, waived excluded from both total and missing
* `document-classifier.ts`: Added `fetchWithRetry()` with 3 retries, exponential backoff, `retry-after` header parsing
* `processor.ts`: Added 1s inter-batch delay between classification batches
* `classifications.ts`: Added `re-classify` action to `review-classification` endpoint — downloads PDF from OneDrive, re-runs AI classification, updates Airtable record
* Workers deployed: version 02329de2-25bd-4c5c-bdd8-6ff17494be9b
* CPA-XXX: All 15 rate-limited records re-classified. 14 matched templates (mostly T1101), 1 unmatched (רישיון+אסמכתא, conf=0.4)
