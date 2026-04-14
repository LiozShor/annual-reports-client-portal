# Design Log 219: Allow Adding Second Filing Type for Existing Client
**Status:** [DRAFT]
**Date:** 2026-03-29
**Related Logs:** DL-218 (dual AR+CS tabbed view), DL-216 (filing type scoping)

## 1. Context & Problem
When a client already has an Annual Report, the admin cannot add a Capital Statement for the same client — the system shows "לקוח קיים" (client exists) because both the frontend and backend reject duplicate emails unconditionally. This blocks the dual-filing-type workflow that DL-218 tabs were built for.

**Two layers of blocking:**
1. **Frontend** (`script.js:1637-1639`): `existingEmails` set blocks any email already in the dashboard
2. **Backend** (`import.ts:60`): Skips clients with existing emails — doesn't even check filing type

## 2. User Requirements
1. **Q:** Reuse existing client record or create new one?
   **A:** Reuse existing client record — create only a new Report linked to it.

2. **Q:** Block same filing type + year duplicates?
   **A:** Yes — only allow a *different* filing type. Same email + same year + same filing type = still show "לקוח קיים".

3. **Q:** Fix both manual add and bulk import?
   **A:** Yes — fix both `addManualClient` and `admin-bulk-import` endpoint.

4. **Q:** Initial stage for new report?
   **A:** Start fresh at `Send_Questionnaire` (stage 1) — needs its own questionnaire.

## 3. Research
### Domain
Data modeling — composite unique constraints, multi-entity upsert patterns.

### Key Principles
- **Clients table is filing-type-agnostic**: One client record serves all filing types. Differentiation at Reports level.
- **Existing upsert pattern** (`performUpsert` in Airtable): Already used in this project for dedup (DL-112). Here we don't need upsert — we need a "find-or-skip" for client + "create-if-no-matching-report" for report.

### Research Verdict
Straightforward fix: change duplicate detection from email-only to email+year+filing_type composite key.

## 4. Codebase Analysis
### Existing Solutions Found
- `existingEmails` set in both frontend and backend — simple email-only dedup
- Backend already fetches `existingReports` filtered by year (import.ts:29-31) but doesn't check `filing_type` against them
- `clientIdToEmail` map in backend already maps client IDs to emails

### Files Affected

| File | Location | Current Behavior | Fix |
|------|----------|-----------------|-----|
| `admin/js/script.js` | Line 1637-1639 | Blocks any existing email | Check email+filing_type combo instead |
| `api/src/routes/import.ts` | Lines 44-65 | Skips if email exists as client | Reuse existing client, only skip if same year+filing_type report exists |

### Dependencies
- Airtable Clients table: `tblFFttFScDRZ7Ah5`
- Airtable Reports table: `tbls7m3hmHC4hhQVy`

## 5. Technical Constraints & Risks
- **Security:** No new auth concerns — uses existing admin-only endpoint
- **Risks:** Must not create duplicate client records. Must correctly link new report to existing client.
- **Breaking Changes:** None — existing single-filing-type clients unaffected

## 6. Proposed Solution

### Success Criteria
Admin can add a Capital Statement for a client who already has an Annual Report (and vice versa), creating only a new Report record linked to the existing Client.

### Frontend Fix (`admin/js/script.js`)

**Change `addManualClient()` (line 1637-1641):**

Replace the simple `existingEmails.has(email)` check with a composite check:
```javascript
// Check if same email + same filing type already exists
const existingClient = clientsData.find(c => c.email?.toLowerCase() === email);
if (existingClient && existingClient.filing_type === filingType) {
    showModal('warning', 'לקוח קיים', 'כתובת המייל הזו כבר קיימת עם אותו סוג דוח.');
    return;
}
```

But wait — `clientsData` has one entry per **report** (not per client). So a client with AR would have one entry. If they also had CS, they'd have two entries. We need to check if any entry with the same email has the same filing type:
```javascript
const hasSameTypeReport = clientsData.some(c =>
    c.email?.toLowerCase() === email && c.filing_type === filingType
);
if (hasSameTypeReport) {
    showModal('warning', 'לקוח קיים', 'כתובת המייל הזו כבר קיימת עם אותו סוג דוח.');
    return;
}
```

### Backend Fix (`api/src/routes/import.ts`)

**Phase 1: Change duplicate detection (lines 34-65)**

Current flow:
1. Build `existingEmails` from all clients → skip if email exists
2. Build `emailsWithReport` from all reports for this year → skip if email has report

New flow:
1. Build `existingClientsByEmail` map (email → client record ID)
2. Build `emailsWithReportForType` set — only include reports matching the requested `filing_type`
3. For each import client:
   - If email has a report with same filing_type → skip (true duplicate)
   - If email has existing client but no report with this filing_type → reuse client, create report
   - If email is new → create client + report (as today)

**Phase 2: Split creation into two paths (lines 67-101)**

Current: Always creates client + report together
New: Two paths:
- **New clients**: Create client record, then create report linked to new client ID
- **Existing clients**: Skip client creation, create report linked to existing client ID

### Logic Flow
```
For each client in import:
  1. email exists in Clients table?
     NO  → create client + report (existing path)
     YES → already has report with same year+filing_type?
       YES → skip (duplicate)
       NO  → create report only, linked to existing client ID
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/import.ts` | Modify | Composite dedup, split new/existing client paths |
| `github/.../admin/js/script.js` | Modify | Check email+filing_type instead of email-only |

### Final Step
- Housekeeping: Update design log, INDEX, current-status

## 7. Validation Plan
* [ ] Manual add: Add CS for existing AR client (CPA-XXX) → succeeds, creates report only
* [ ] Manual add: Try adding same filing type again → blocked with "לקוח קיים"
* [ ] Manual add: Verify new report linked to SAME client record (not new client)
* [ ] Manual add: New report starts at Send_Questionnaire stage
* [ ] DL-218 tabs: After adding CS, document-manager shows tabs for both
* [ ] Bulk import: Import CSV with mix of new + existing clients with different filing type → correct counts
* [ ] Single-report clients: No regression — adding brand new client still works

## 8. Implementation Notes (Post-Code)
*TBD*
