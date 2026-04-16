# DL-183: CC Spouse Email on Questionnaire Send

**Status:** `[IMPLEMENTED — NEED TESTING]`
**Date:** 2026-03-25

## Summary
When a client has a `cc_email` field populated (spouse's email), the questionnaire send will:
1. CC the spouse on the email
2. Add a highlighted "one questionnaire per family" note in the email body

## Files Changed
- `api/src/lib/ms-graph.ts` — Added optional `ccAddress` param to `sendMail()`
- `api/src/lib/email-html.ts` — Added `showFamilyNote` to `QuestionnaireEmailParams`, renders yellow callout when true
- `api/src/routes/send-questionnaires.ts` — Reads `cc_email` from client record, passes CC + family note flag
- `api/src/routes/import.ts` — Accepts optional `cc_email` from Excel import, writes to client record
- Airtable `clients` table — Added `cc_email` (singleLineText) field via API

## Behavior
- CC only on questionnaire sends (not reminders, batch status)
- Controlled by presence of `cc_email` — if empty/missing, no CC and no family note
- Family note: yellow callout box after CTA button with RTL border styling
