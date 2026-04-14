# Design Log 028: Tally Webhook to Airtable Trigger Migration

**Date:** 2026-01-28
**Status:** COMPLETED
**Workflow:** [02] Questionnaire Response Processing (QqEIWQlRs1oZzEtNxFUcQ)

## Summary

Replaced Tally Webhook with Airtable Trigger in Workflow [02]. The architecture now flows:
- **Before:** Tally Form → n8n Webhook → Process → Airtable
- **After:** Tally Form → Airtable (native integration) → n8n Airtable Trigger → Process

## Changes Made

### 1. Removed Nodes
- `Tally Webhook` (id: c3193bb3-7d5f-4e8b-b013-6c69977d619a)
- `Respond OK` (id: 4e8aea5e-91ee-4d38-919b-3e3bbd5cfaa1)

### 2. Added Nodes
- `Airtable Trigger` (id: airtable-trigger-001)
  - Poll interval: Every minute
  - Base: appqBL5RWQN9cPOyh
  - Table: tblxEox8MsbliwTZI (תשובות שאלון שנתי)
  - Trigger field: תאריך הגשה
  - Credentials: Airtable Personal Access Token account

### 3. Updated Nodes

#### Extract Airtable Data (formerly Extract Tally Data)
- Renamed from "Extract Tally Data" to "Extract Airtable Data"
- New code parses Airtable record format directly (no webhook payload parsing)
- Keeps UUID translation as safety fallback
- Maps all questionnaire fields to `answers_by_key` object
- Outputs same structure as before for downstream compatibility

#### Prepare for Airtable
- Updated reference: `$('Extract Tally Data')` → `$('Extract Airtable Data')`

#### Prepare Email
- Updated reference: `$('Extract Tally Data')` → `$('Extract Airtable Data')`

#### Update Report Stage
- Updated reference: `$('Extract Tally Data')` → `$('Extract Airtable Data')`
- Updated `last_progress_check_at` to use dynamic timestamp: `$now.toISO()`

## Airtable Table Configuration

| Property | Value |
|----------|-------|
| Table Name | תשובות שאלון שנתי |
| Table ID | tblxEox8MsbliwTZI |
| Trigger Field | תאריך הגשה |
| Purpose | Stores Tally form submissions via native Tally→Airtable integration |

## Key Fields Extracted
- `report_record_id` - Link to Annual Reports
- `client_id` - Link to Clients
- `year` - Tax year
- `source_language` - he/en for language detection
- `שם בן/בת הזוג` - Spouse name
- All 78+ questionnaire fields

## Validation Result
- **Valid:** YES
- **Errors:** 0
- **Warnings:** 21 (non-blocking, mostly about typeVersions and error handling recommendations)

## Architecture Benefits

1. **Simplified Flow:** Removes webhook complexity and immediate response requirement
2. **Native Integration:** Leverages Tally's built-in Airtable integration
3. **Reliability:** Airtable provides data persistence before n8n processing
4. **Debugging:** Easier to inspect data in Airtable before workflow processing

## Polling Delay

The Airtable Trigger polls every minute, so there's up to a 1-minute delay between:
- Tally form submission → Airtable record creation
- Airtable record creation → n8n workflow trigger

This was accepted as an acceptable trade-off for the architecture benefits.

## Workflow Status

- **Active:** false (workflow is currently inactive)
- To activate: Enable the workflow in n8n UI

## Next Steps

1. User to test the workflow by:
   - Filling out a Tally form
   - Verifying record appears in תשובות שאלון שנתי table
   - Waiting 1 minute for trigger to fire
   - Checking execution logs
   - Verifying email sent to reports@moshe-atsits.co.il
   - Verifying documents created in Documents table
   - Verifying report stage updated to 3-Collecting_Docs

2. Consider activating the workflow once testing confirms proper operation
