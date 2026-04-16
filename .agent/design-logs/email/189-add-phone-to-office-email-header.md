# Design Log 189: Add Phone Number to Office Email Summary Box
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-26
**Related Logs:** DL-157 (Phone Number Collection via Tally), DL-106 (Client Detail Modal + Phone Field)

## 1. Context & Problem
The office notification email ("שאלון שנתי התקבל") summary box shows: client name, spouse, year, email, doc count — but **no phone number**. The phone field is already extracted in WF[02] Extract & Map node (line 75: `normalizePhone(rawPhone)`) and passed as `client_phone` to the Document Service, but the Generate HTML node in `[SUB] Document Service` never reads or renders it.

## 2. Root Cause
In the **Generate HTML** node (`generate-html` in workflow `hf7DRQ9fLmQqHv3u`):
- Line 23: `clientEmail` is extracted from input — but no `clientPhone` extraction exists
- Lines 509-514: `summaryBox()` call has 5 rows (name, spouse, year, email, doc count) — no phone row

The data IS available in `input.client_phone` (passed via `triggerData` spread in merge-config). It's just never consumed.

## 3. Proposed Solution

### Generate HTML node — 2 changes:

**Change 1:** Add phone extraction after line 23:
```js
const clientPhone = input.client_phone || '';
```

**Change 2:** Add phone row to summaryBox after email row (line 513), before doc count:
```js
...(clientPhone ? [['טלפון:', clientPhone]] : []),
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n `[SUB] Document Service` → Generate HTML node | Modify | Add `clientPhone` input + summary row |

No other files affected — phone data already flows through the pipeline.

## 4. Validation Plan
- [ ] Send a test questionnaire for a client with a phone number → verify phone appears in office email summary box
- [ ] Send a test questionnaire for a client without a phone → verify no empty row appears
- [ ] Verify client email (not office email) is unaffected
