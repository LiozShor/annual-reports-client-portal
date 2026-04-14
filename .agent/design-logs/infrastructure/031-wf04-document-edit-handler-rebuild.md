# Design Log 031: WF[04] Document Edit Handler Rebuild

**Date:** 2026-02-15
**Status:** Completed
**Workflows modified:** [04] y7n4qaAUiCS4R96W, [SUB] Document Service hf7DRQ9fLmQqHv3u

## Context

WF[04] was built before the SSOT/Document Service architecture. An audit found 3 critical, 3 high, and 4 medium issues including broken `formatDocumentName` calls, inline HTML generation (SSOT violation), and a plaintext security token.

## Changes Made

### Document Service Enhancement
- Added `doc_list_html` output field to the "Generate HTML" node's return statement
- Exposes the already-computed categorized doc list HTML (the `officeDocListHtml` variable)
- No breaking changes — existing consumers (WF[02], WF[03]) unaffected

### WF[04] Full Rebuild (17 old nodes removed, 16 new nodes added)

**New flow:**
```
Webhook POST → Respond OK → Extract & Validate → IF Has Changes
  → IF Has Waives → (waive path) → IF Has Creates → (create path)
  → Fetch Updated Docs → Prepare Service Input → Call Document Service
  → Build Edit Email → MS Graph Send (office only) → Update Timestamp
```

**Key design decisions:**
- Office-only email (no client email on edits)
- HMAC tokens via `generateApprovalToken()` (same cyrb53 hash as WF[03])
- New docs default to `category: 'other'`, `person: 'client'`
- WF[04] builds change diff + calls Document Service for SSOT doc list HTML
- CORS locked to `https://liozshor.github.io`

## Issues Resolved

| # | Issue | Fix |
|---|-------|-----|
| C1 | SSOT violation (inline HTML) | Doc list from Document Service `doc_list_html` |
| C2 | formatDocumentName wrong arg type | Removed — no display lib calls |
| C3 | Plaintext token | HMAC via `generateApprovalToken()` |
| H4 | Missing category/person on creates | `category: 'other'`, `person: 'client'` |
| H5 | No timestamp update | `Update Report Timestamp` node added |
| H6 | Display lib from GitHub | Removed — uses Document Service |
| M7 | Self-referencing webhook | Removed |
| M8 | continueOnFail swallowing errors | Not set on new nodes |
| M9 | No empty edit handling | `IF Has Changes` early exit |
| M10 | CORS wildcard | Set to `https://liozshor.github.io` |
| L11 | Dead crypto import | Not included |

## Token Compatibility

WF[04] Build Edit Email generates tokens with same algorithm as WF[03] Verify Token:
- Function: `generateApprovalToken(reportId, secret)` — cyrb53 hash
- Secret: `MOSHE_1710`
- Token format: base36 string from seeded hash

## Testing Checklist

- [ ] Open document manager for a test report
- [ ] Waive 1-2 documents → verify Airtable status = "Waived"
- [ ] Add 1 document from dropdown → verify created with category='other'
- [ ] Add 1 custom document → verify created in Airtable
- [ ] Verify office email received at reports@moshe-atsits.co.il
- [ ] Verify email shows: change summary (red removed, green added) + SSOT doc list
- [ ] Verify Approve button URL has HMAC token (not plain "MOSHE_1710")
- [ ] Click Approve → verify WF[03] accepts the HMAC token
- [ ] Submit empty edit (no changes) → verify NO email sent
