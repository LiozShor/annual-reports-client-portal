# DL-186: Add Logo to All Emails

**Status:** IMPLEMENTED — NEED TESTING
**Date:** 2026-03-25
**Scope:** All 7 remaining email types (Worker + n8n)

---

## Background

DL-185 (Daily Natan Digest) added the Moshe Atsits logo to its email header. User approved and requested the logo on ALL system emails.

Logo URL: `https://liozshor.github.io/annual-reports-client-portal/assets/images/logo.png`

---

## Changes Made

### Worker (api/) — 3 files

| File | Change |
|------|--------|
| `api/src/lib/email-styles.ts` | Added `export const LOGO_URL = '...'` |
| `api/src/lib/email-html.ts` | Imported `LOGO_URL`; added logo `<tr>` inside 600px card before blue header; changed header `border-radius:8px 8px 0 0` → `border-radius:0` |
| `api/src/routes/feedback.ts` | Added centered `<img>` logo inside `<body>` before `<h2>` |

**Covers:** Client Status Email, Questionnaire Email, Admin Feedback Email

**Deployed:** Version `26ba211a-5cf7-48cd-8c06-f7abdbac9a99`

### n8n Workflows — 4 nodes

| Workflow | Node | Change |
|----------|------|--------|
| `FjisCdmWc4ef0qSV` (Reminder Scheduler) | Build Type A Email | Logo row added before blue header; header border-radius → 0 |
| `FjisCdmWc4ef0qSV` (Reminder Scheduler) | Build Type B Email | Logo row added to both EN and HE blocks; header border-radius → 0 |
| `QREwCScDZvhF9njF` (Send Batch Status) | Build Email | Logo row added to both EN and HE email sections; header border-radius → 0 |
| `HL7HZwfDJG8t1aes` (Security Alerts) | Build Alert Email | Logo `<div><img>` added after opening `<div>`, before `<h2>` |

**versionIds:**
- FjisCdmWc4ef0qSV → `af0a92d0`
- QREwCScDZvhF9njF → `1ff99816`
- HL7HZwfDJG8t1aes → `c04dc1ab`

---

## Logo HTML Snippet

```html
<!-- Table-based emails (inside 600px card, before header bar) -->
<tr><td align="center" style="padding:24px 0 16px;">
  <img src="https://liozshor.github.io/annual-reports-client-portal/assets/images/logo.png"
       alt="Moshe Atsits" width="180" height="auto"
       style="display:block;border:0;max-width:180px;height:auto;" />
</td></tr>

<!-- Div-based emails (Security Alerts) -->
<div style="text-align:center;padding:16px 0 8px;">
  <img src="..." width="160" style="display:inline-block;border:0;max-width:160px;height:auto;" />
</div>
```

---

## Testing Checklist

- [ ] Send a test questionnaire email → verify logo appears
- [ ] Trigger reminder (Type A) → verify logo in reminder email
- [ ] Trigger reminder (Type B) → verify logo in reminder email
- [ ] Trigger batch status send from admin → verify logo in batch email
- [ ] Send feedback from admin panel → verify logo in feedback email
- [ ] Trigger security monitor manually → verify logo in alert email
- [ ] Check rendering: Gmail desktop + mobile, Outlook
