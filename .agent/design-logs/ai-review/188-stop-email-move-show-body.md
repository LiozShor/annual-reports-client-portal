# DL-188: Stop Email Folder Move + Show Email Body in AI Review

**Status:** IMPLEMENTED — NEED TESTING
**Created:** 2026-03-26
**Domain:** ai-review

## Problem
1. WF[05] moves processed emails to "מסמכים שהתקבלו" folder — unnecessary, clutters mailbox
2. Clients write text in email body alongside attachments, but this is invisible in AI review tab

## Changes

### n8n WF[05] (cIa23K8v1PrbDJqY) — 4 node updates
1. **Disabled** `Move to Documents Folder` node (55425aa6) — emails stay in Inbox
2. **Process and Prepare Upload** (630031f2) — added `email_body_preview: data.email_body_preview` to return
3. **Prep Doc Update** (code-prep-doc-update) — added `email_body_preview: d.email_body_preview || ''` to return
4. **Create Pending Classification** (at-create-pending-class) — added `email_body_text` field mapping

### Airtable
- Added `email_body_text` (multilineText) field to Pending Classifications table (tbloiSDN3rwRcl1ii), field ID: fldbvlkrG8kmRHxiJ

### Workers API
- `api/src/routes/classifications.ts:206` — added `email_body_text` to API response object

### Admin Panel
- `admin/js/script.js` — added email body section to both `renderAICard()` and `renderReviewedCard()`
- `admin/css/style.css` — added `.ai-email-body` styles (blue left border, pre-wrap, dir=auto)
- Only rendered when `email_body_text` is non-empty
- 3+ newlines collapsed to 2

## Verification Checklist
- [ ] Send test email WITH body text and attachment
- [ ] Verify email stays in Inbox (not moved)
- [ ] Check Airtable Pending Classifications — `email_body_text` populated
- [ ] Open admin panel AI review tab — email body visible on card
- [ ] Test Hebrew-only body (RTL correct)
- [ ] Test no body text (section hidden)
- [ ] Test reviewed cards also show body text
