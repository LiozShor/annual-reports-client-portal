# Design Log 159: Phone Number Display in All Questionnaire Surfaces
**Status:** [COMPLETE]
**Date:** 2026-03-16
**Related Logs:** DL-157 (phone number migration to Tally questionnaire)

## 1. Context & Problem
DL-157 migrated phone collection from import to Tally questionnaire. The phone number is now extracted and normalized in WF[02] and stored in Airtable. However, phone is not yet displayed in all office-facing surfaces:
- Office email (sent after questionnaire submission) — missing phone in personal info card
- Admin questionnaires tab detail view — **already done** (previous session)
- Admin questionnaires print view — **already done** (previous session)
- Document manager print view — **already done** (previous session)

The remaining work is adding phone to the **office email** built by `[SUB] Document Service` → Generate HTML node.

## 2. User Requirements
1. **Q:** Where should the phone appear in the office email?
   **A:** In the personal info section (summaryBox), same row style as email/name.

2. **Q:** What format?
   **A:** XXX-XXXX-XXX (e.g., 052-4571-577). Already normalized by Extract & Map in WF[02].

3. **Q:** Client-facing or office-only?
   **A:** Office/admin only. Client portal and client emails do NOT show phone.

## 3. Research
### Domain
Continuation of DL-157. No additional research needed — this is a straightforward field addition following existing patterns.

### Research Verdict
Follow the exact same pattern as `clientEmail` in the Generate HTML node. Add phone as a new row in `summaryBox()`.

## 4. Codebase Analysis
* **Existing Solutions Found:** `summaryBox()` helper in Generate HTML already renders label-value pairs. Phone just needs to be added as a new row.
* **Reuse Decision:** 100% reuse — add one destructuring line and one array entry.
* **Relevant Files:**
  - `[SUB] Document Service` (hf7DRQ9fLmQqHv3u) → Generate HTML node — office email builder
  - `github/annual-reports-client-portal/admin/js/script.js` — already modified (lines 5422-5425, 5660-5663)
  - `github/annual-reports-client-portal/assets/js/document-manager.js` — already modified (line 2115)
* **Data Flow Verified:**
  - WF[02] Extract & Map outputs `client_phone` (normalized)
  - WF[02] calls Document Service via Execute Workflow → trigger receives `client_phone`
  - Document Service trigger (passthrough) → Pass Trigger Data wraps as `_triggerData`
  - Wait For All → Merge Config spreads `...triggerData` → `client_phone` is in output
  - Generate Documents passes through → Generate HTML has `client_phone` in `$input.first().json`
  - **BUT Generate HTML does not destructure `client_phone`** — this is the only missing piece

## 5. Technical Constraints & Risks
* **Security:** Phone is PII — already in the office email context (office-only), no new exposure.
* **Risks:** None. Adding a row to summaryBox is purely additive.
* **Breaking Changes:** None.

## 6. Proposed Solution (The Blueprint)
### Logic Flow
1. In Generate HTML node, add `clientPhone` to the destructuring block (~line 14-26)
2. Add `['טלפון:', clientPhone || 'לא צוין']` row in `summaryBox()` after the email row
3. Push frontend changes (script.js + document-manager.js) that were already made in previous session

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| n8n `[SUB] Document Service` Generate HTML node | Modify | Add `client_phone` destructuring + summaryBox row |
| `github/annual-reports-client-portal/admin/js/script.js` | Already done | Phone in QA detail + print views |
| `github/annual-reports-client-portal/assets/js/document-manager.js` | Already done | Phone in doc manager print view |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan
* [x] Submit Tally questionnaire with phone → office email contains phone in personal info card
* [x] Admin questionnaires tab → phone visible in detail header (already implemented)
* [x] Admin questionnaires print → phone in meta line and summary grid (already implemented)
* [x] Document manager print → phone in meta line (already implemented)
* [x] Phone format is XXX-XXXX-XXX in all surfaces
* [x] Client portal does NOT show phone (office-only)

## 8. Implementation Notes (Post-Code)
* n8n `[SUB] Document Service` Generate HTML node updated — `clientPhone` destructured + phone row in summaryBox after email
* Frontend commit `a2c1ba2` pushed to main — phone in admin QA detail, admin print, doc-manager print
* All tests passed (2026-03-16)
