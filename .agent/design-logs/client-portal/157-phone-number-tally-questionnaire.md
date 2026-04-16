# Design Log 157: Move Phone Number Collection to Tally Questionnaire
**Status:** [IMPLEMENTED — NEEDS MANUAL STEPS + TESTING]
**Date:** 2026-03-16
**Related Logs:** DL-106 (client detail modal phone field), DL-107 (inline phone edit)

## 1. Context & Problem
Phone number is currently collected during client import (bulk Excel upload or manual add). This creates friction because:
- The office must have phone numbers ready at import time
- Many clients are imported without phone numbers (field is optional)
- The natural place to collect contact info is when the client fills the questionnaire

Moving phone collection to the Tally questionnaire ensures every client who submits a questionnaire also provides their phone number.

## 2. User Requirements
1. **Q:** Should phone be removed from import or kept in both places?
   **A:** Remove from import — phone collected only via Tally questionnaire.

2. **Q:** Where in the Tally questionnaire should the phone field appear?
   **A:** Start — after name/email in the personal info section.

3. **Q:** Should the phone field be required or optional?
   **A:** Required — client must provide phone to submit.

4. **Q:** Where should phone be stored in Airtable?
   **A:** Clients table only (single source for client contact info).

## 3. Research
### Domain
Form Design, Phone Number UX, Tally Form Configuration

### Sources Consulted
1. **"Form Design Patterns" (Adam Silver)** — Phone fields have high abandonment rates. Explain *why* you need the number. Single field, never split. Accept flexible input and normalize on backend.
2. **Tally.so Phone Number Documentation** — Tally has a native `/phone` block with built-in country selector, auto-format, and validation. Default country can be set to Israel. Stores in international format.
3. **Israeli Phone Number Format Guide** — Mobile: 05X-XXXXXXX (10 digits). International: +972-5X-XXXXXXX. Tally's native block handles validation automatically.

### Key Principles Extracted
- **Single input field** — Tally's native phone block handles this perfectly
- **Explain why you need it** — Add a short description in both languages: "לצורך יצירת קשר בנוגע לדו"ח" / "For communication regarding your report"
- **Don't reinvent validation** — Tally's built-in phone validation handles Israeli numbers correctly
- **Type-based extraction** — Tally sends a `PHONE_NUMBER` field type, same pattern as `EMAIL_ADDRESS` — extract by type, not by question key

### Patterns to Use
- **Type-based field extraction:** Same pattern as email in `extractSystemFields()` — scan for `PHONE_NUMBER` type
- **Backend normalization:** Store the international format Tally provides (+972...) as-is

### Anti-Patterns to Avoid
- **Custom regex validation on Tally:** Tally already validates — adding our own is redundant
- **Storing phone per-report:** Phone is client-level contact info, not report-specific

### Research Verdict
Use Tally's native phone block. Extract by field type in the processor. Store in clients table. No custom validation needed.

## 4. Codebase Analysis
* **Existing Solutions Found:** Phone field UI already exists in admin (manual add form, client detail modal) from DL-106 scaffolding. Import flow has full phone handling (parse, validate, send to API).
* **Reuse Decision:** Keep client detail modal phone display (DL-106). Remove all import-related phone code. Add new extraction in workflow-processor-n8n.js.
* **Relevant Files:**
  - `github/annual-reports-client-portal/n8n/workflow-processor-n8n.js` — `extractSystemFields()` at line 157, email extraction pattern at line 180-187
  - `github/annual-reports-client-portal/admin/js/script.js` — Import functions (lines 929-1137), manual add, bulk import
  - `github/annual-reports-client-portal/admin/index.html` — Phone inputs at lines 228-231, 272, 764
* **Existing Patterns:** Email extracted by Tally field type (`EMAIL_ADDRESS`) rather than mapped key — phone should follow same pattern
* **Alignment with Research:** Current email extraction pattern aligns perfectly with best practice of type-based detection
* **Dependencies:** Airtable clients table (needs `phone` field added manually), Tally forms (need `/phone` block added manually), WF[02] (needs node to write phone to clients table)

## 5. Technical Constraints & Risks
* **Security:** Phone is PII — already handled by existing Airtable security posture. No new exposure.
* **Risks:** Existing clients imported without questionnaire will have no phone. This is acceptable — phone will be collected when they fill the questionnaire.
* **Breaking Changes:** Removing phone from import means Excel templates change from 3 columns to 2. Existing templates with phone column should still work (extra column ignored, or gracefully handled).

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. User adds `/phone` block to both Tally forms (manual step)
2. User adds `phone` field to Airtable clients table (manual step)
3. Update `workflow-processor-n8n.js` to extract phone from Tally payload by `PHONE_NUMBER` type
4. Update WF[02] to write extracted phone to clients table
5. Remove phone from admin import flow (HTML + JS)
6. Update `[API] Admin Bulk Import` workflow to stop expecting phone

### Data Flow (After Change)
```
Tally form (phone required)
  → WF[02] webhook
  → extractSystemFields() reads PHONE_NUMBER type → client_phone
  → Airtable Update: clients table, phone field
  → Client detail modal reads phone from clients table (existing)
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `github/annual-reports-client-portal/n8n/workflow-processor-n8n.js` | Modify | Add `PHONE_NUMBER` extraction in `extractSystemFields()` |
| `github/annual-reports-client-portal/admin/index.html` | Modify | Remove `#manualPhone` input from manual add form |
| `github/annual-reports-client-portal/admin/js/script.js` | Modify | Remove phone from import template, parsing, payload, manual add |
| n8n WF[02] `QqEIWQlRs1oZzEtNxFUcQ` | Modify | Add Airtable update node for phone → clients table |
| n8n `[API] Admin Bulk Import` | Modify | Remove phone from payload processing |

### Manual Steps (User)
1. Add `phone` singleLineText field to Airtable clients table via UI
2. Add `/phone` block to Hebrew Tally form — after email, required, default country IL
3. Add `/phone` block to English Tally form — after email, required, default country IL
4. Share the Tally field keys (or confirm Tally sends `PHONE_NUMBER` type)

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan
* [ ] Import client via Excel with just name + email — succeeds
* [ ] Manual add works with just name + email
* [ ] Old Excel templates with phone column don't break import (extra column gracefully ignored)
* [ ] Fill Hebrew Tally questionnaire — phone is required, stored in clients table
* [ ] Fill English Tally questionnaire — phone is required, stored in clients table
* [ ] Client detail modal still displays phone from Airtable
* [ ] No regression in document generation (phone is contact info only)
* [ ] WF[02] execution succeeds with phone extraction

## 8. Implementation Notes (Post-Code)
* **Commit:** `be46753` — pushed to main
* **Tally API limitation:** PATCH /forms/:id with `blocks` array fails validation on existing FORM_TITLE blocks (safeHTMLSchema format). Phone fields must be added manually in Tally editor.
* **n8n WF[02] changes:** Extract & Map now extracts `client_phone` from multiple possible field names (טלפון, phone, Phone Number, מספר טלפון). New "Update Client Phone" node writes to clients table after Wait for Both.
* **n8n Bulk Import changes:** Filter Duplicates and Create Client nodes no longer reference phone.
* **.env:** Added `TALLY_API_KEY=tly-xFL96GEaKcK9pPe5fxHH6mopRfCdYenQ` for future API use.
