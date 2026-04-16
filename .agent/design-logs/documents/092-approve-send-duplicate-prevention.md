# DL-092: Approve & Send — Duplicate Send Prevention

**Status:** Done
**Date:** 2026-03-04

## Problem

When office clicks "approve and send" for a report where docs were already sent (stage >= 3), the system showed a hard "Already Approved" block with no way to re-send. Users needed a way to intentionally re-send.

## Solution

Replaced hard block with a **soft warning** — shows when docs were last sent, with a "Send Again" button.

## Changes Made

### Airtable
- Added `docs_first_sent_at` (dateTime) field to `annual_reports` table (field ID: `fldpkLSpxWL7RRgBr`)

### n8n Workflow [03] Approve & Send (`cNxUgCHLPZrrqLLa`)

1. **Added "Check Report" node** (Airtable Get Record) on the no-confirm path between `IF Confirm` (false) and `Build Confirm Page`
2. **Updated "Build Confirm Page"** — reads report from Check Report, adds `&warning=already_sent&sent_at=<date>` to redirect URL when stage >= 3
3. **Removed hard block** — deleted "If" node (`3155203d`) and "Already Approved" node (`1bc1022e`). Wired "Get a record" directly to "Airtable - List Docs" so confirms always proceed
4. **Updated "Airtable - Set Stage 3"** — added `docs_first_sent_at` (preserves original value on re-send, sets `$now` on first send). Fixed hardcoded `last_progress_check_at` → `$now.toISO()`

### Frontend (`approve-confirm.html`)
- Replaced `showAlreadyApproved()` (dead-end) with `showAlreadySentWarning(sentAt)` — warning-colored alert with formatted date and "שלח שוב" button
- Reads `warning` and `sent_at` URL params
- Warning state routes before normal confirm state

## Flow After Changes

```
Webhook → Global Config → Verify Token → IF Confirm
  ├─ FALSE → Check Report → Build Confirm Page → Confirmation Page
  │          (adds warning params if stage >= 3)
  │          Frontend shows warning state OR normal confirm
  └─ TRUE  → Get a record → Airtable - List Docs → ... → Send → Set Stage 3 → Success Page
             (no more hard block — always sends)
```

## Verification Steps

1. Open approve link for report at stage 2 → normal confirm page (no warning)
2. Click "אשר ושלח" → docs sent → success → `docs_first_sent_at` populated
3. Open same link again → warning with date + "שלח שוב" button
4. Click "שלח שוב" → docs re-sent → success → `docs_first_sent_at` unchanged
5. Bad token → still rejected
