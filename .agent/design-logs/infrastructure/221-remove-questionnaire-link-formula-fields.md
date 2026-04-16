# Design Log 221: Remove questionnaire_link Formula Fields from Airtable
**Status:** [COMPLETED]
**Date:** 2026-03-29
**Related Logs:** DL-090 (HMAC token architecture), DL-164 (filing type layer), DL-220 (CS email + landing)

## 1. Context & Problem
The `reports` table had two formula fields — `questionnaire_link_he` and `questionnaire_link_en` — that auto-generated Tally questionnaire URLs by concatenating the AR form ID with record fields.

These fields were problematic:
1. **Hardcoded AR form ID** — always pointed to `1AkYKb`/`1AkopM` regardless of `filing_type`, so CS reports got wrong links
2. **Invalid tokens** — after HMAC token migration (DL-090), the formula used the static `questionnaire_token` field, producing links that fail auth
3. **Unused** — no code, workflow, or frontend reads these fields (confirmed via codebase grep)

## 2. Decision
Delete both fields from Airtable. The actual questionnaire flow uses the `send-questionnaires` Worker endpoint, which builds links to the landing page (`/annual-reports-client-portal/?report_id=...&token=...`). The landing page then fetches the correct Tally form ID from the API based on `filing_type`.

## 3. Verification
- `grep -r "questionnaire_link" *.{ts,js,json}` — zero matches in all code files
- Only references were in `docs/airtable-schema.md` (documentation) and design logs (DL-089, DL-090)

## 4. Action Taken
Deleted manually from Airtable UI:
- `questionnaire_link_he` (formula, field ID `fldmCE8cSEZLArqrX`)
- `questionnaire_link_en` (formula, field ID `fldzWS8HIG8b0nyxV`)

## 5. Schema Doc Update
Update `docs/airtable-schema.md` to remove these two fields.
