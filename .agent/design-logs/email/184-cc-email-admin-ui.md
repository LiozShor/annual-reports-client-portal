# DL-184: Add cc_email to Admin UI (Import, Manual Add, Edit)

**Status:** Completed
**Date:** 2026-03-25

## Summary
Added `cc_email` (spouse CC email) field to all admin UI client surfaces: Excel import, manual add form, and client detail edit modal. Backend API updated to return and accept `cc_email` on get/update.

## Changes

### Backend (`api/src/routes/client.ts`)
- Added `cc_email?: string` to input type
- `action: 'get'` returns `cc_email` from client record
- `action: 'update'` accepts and writes `cc_email`
- Validation check includes `cc_email` in the "at least one field" gate

### Frontend HTML (`admin/index.html`)
- Manual add form: cc_email field after email, with Hebrew label and help text
- Client detail edit modal: cc_email field between email and phone
- Format help table: shows 3 columns (name, email, cc_email) with cc_email marked optional
- Preview table: added cc_email column header

### Frontend JS (`admin/js/script.js`)
- CSV template: includes `cc_email` column with sample data
- Import parsing: reads `cc_email` or `אימייל בן/בת זוג` column headers
- Preview table: renders cc_email column
- Import send: includes `cc_email` in client payload
- Manual add: reads, passes, and clears `manualCcEmail` field
- Client detail modal: populates, saves, clears `clientDetailCcEmail`
- Optimistic update: includes `cc_email` in `clientsData`

## Design Decisions
- Field is optional everywhere — no email validation on cc_email (just trim)
- Backward compatible: imports without cc_email column still work
- Hebrew label: `אימייל בן/בת זוג (לא חובה)` with help text `יקבל/תקבל עותק של השאלון`
