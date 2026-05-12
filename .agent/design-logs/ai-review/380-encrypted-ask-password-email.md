# DL-380 — Encrypted PDF: Ask-Password Email + Auto-Detect Reply

**Status:** [COMPLETED — 2026-05-12]
**Branch:** `DL-380-encrypted-ask-password-email`
**Related:** DL-373 (in-app PDF unlock), DL-379 (lock indicator on cards)

## Problem

When Moshe sees an encrypted PDF in AI Review, getting the password from the client is a manual out-of-band exchange (phone, WhatsApp, separate email). Needed:
1. One-click "request password" email from the AI Review kebab — bilingual (HE+EN), per-card.
2. Track "already sent" so kebab shows "sent X days ago" (disabled, no duplicate spam).
3. Auto-detect password reply so the suggested password appears inline next to the DL-373 unlock panel.

## Solution

### Frontend
- `renderActionsPanel` overflow: if `ai_reason` matches password-protected pattern → show kebab item "בקש סיסמה מהלקוח" (or disabled "נשלחה בקשת סיסמה (X ימים)").
- `requestPdfPassword(recordId)`: fetches email preview via `showEmailPreviewModal` (extended with `actionLabel`/`onAction`), user reviews bilingual email, clicks "שלח בקשת סיסמה" → POST without preview flag.
- `email-preview-modal.js`: extended with optional `actionLabel` + `onAction` params for preview-then-send pattern. Backward-compatible.
- `_showPdfPasswordPanel`: surfaces `suggested_password` chip (click-to-fill) + collapsed `password_reply_raw` details.

### Worker
- `POST /webhook/request-pdf-password`: admin-token auth, preview mode (returns `{ok, subject, html}` without sending), send mode (idempotency guard → sendMail → stamp `password_request_sent_at`).
- `buildPasswordRequestEmailHtml`: bilingual two-card email (HE first, EN below), reuses DL-076 card layout constants. `firstName` and `filename` are HTML-escaped.

### Inbound Processor
- `tryHandlePasswordReply`: matches `[#PWD-{8-char-token}]` in subject → queries `pending_classifications` → extracts password candidate (strips quotes, prefers short no-Hebrew no-space lines) → writes `suggested_password` + `password_reply_raw` → marks email event `PasswordReply` → short-circuits pipeline if no attachments (falls through if attachments present).

### Schema (Airtable)
- `pending_classifications`: `password_request_sent_at` (dateTime), `suggested_password` (singleLineText), `password_reply_raw` (multilineText)
- `email_events.processing_status`: new option `PasswordReply`
- Migration: `scripts/dl380-add-schema-fields.py` (idempotent, run once before deploy)

## Files Changed

| File | Change |
|---|---|
| `frontend/shared/endpoints.js` | `REQUEST_PDF_PASSWORD` constant |
| `frontend/shared/email-preview-modal.js` | `actionLabel`/`onAction` extension |
| `frontend/admin/js/script.js` | Kebab item, `requestPdfPassword`, `humanRelDate`, password chip |
| `frontend/admin/css/style.css` | `.ai-suggested-password-chip` |
| `frontend/admin/index.html` | Cache-bust v=381 + RTL fix |
| `api/src/routes/request-pdf-password.ts` | NEW Worker endpoint |
| `api/src/lib/email-html.ts` | `buildPasswordRequestEmailHtml` + `buildPasswordRequestEmailSubject` |
| `api/src/lib/inbound/processor.ts` | `tryHandlePasswordReply` + integration |
| `api/src/index.ts` | Route registration |
| `scripts/dl380-add-schema-fields.py` | NEW Airtable schema migration |

## Validation Checklist

- [ ] Run `python3 scripts/dl380-add-schema-fields.py` → exits 0; idempotent re-run also exits 0
- [ ] Verify in Airtable UI: 3 new fields on `pending_classifications`; `PasswordReply` option in `email_events.processing_status`
- [ ] Encrypted card → kebab shows "בקש סיסמה מהלקוח"
- [ ] Click → email preview modal opens with bilingual subject + body
- [ ] Click "שלח בקשת סיסמה" → button shows "שולח..." → success state → auto-close → toast
- [ ] Kebab flips to disabled "נשלחה בקשת סיסמה (היום)"
- [ ] Cancel in modal → no email sent, no DB write
- [ ] Server 409 on duplicate send (already_sent error shown in Hebrew in modal)
- [ ] Outbound email arrives with `[#PWD-XXXXXXXX]` subject and bilingual body
- [ ] Reply with password as single line → inbound processor sets `suggested_password`
- [ ] AI Review card → unlock panel shows "סיסמה מוצעת: XXX" chip; clicking fills input
- [ ] Reply with attachments + password → pipeline processes attachment AND stores password
- [ ] Reply with no PWD token in subject → normal pipeline (regression)
- [ ] Worker deploy + Pages deploy before live test

## Follow-up Tweaks

- **2026-04-30:** Hebrew copy rewritten to be gender-neutral via impersonal/passive forms (no `gender` field on clients, avoiding awkward slash forms). `ששלחת` → `שנשלח/ו אלינו`; `אנא השב` → `יש להשיב`; `ציין` → `נא לציין`. Applies to both single-file and batch variants in `buildPasswordRequestEmailHtml`.
