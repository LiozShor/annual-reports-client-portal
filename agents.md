# 🤖 AGENTS.md - Annual Reports Document Collection System

## Project Overview

Automated tax document collection system for **Moshe Atsits Accounting Firm**.  
The system streamlines the annual tax preparation process by:
- Sending bilingual questionnaires to clients
- Processing responses to determine required documents
- Routing approvals through office staff
- Delivering personalized document requirement lists to clients

---

## 🎯 Project Objectives

1. **Automate client onboarding** - Bulk import 500+ clients from Excel
2. **Bilingual support** - Hebrew and English questionnaires and emails
3. **Smart document mapping** - Automatically determine required documents based on questionnaire answers
4. **Office workflow** - Allow staff to review, edit, and approve document lists
5. **Client self-service** - Clients can view their required documents anytime
6. **Progress tracking** - Dashboard to monitor all clients' status

---

## 🌐 Language & Localization Rules

### Critical Language Requirements

| Audience | Language | Direction |
|----------|----------|-----------|
| Office staff | Hebrew only | RTL |
| Hebrew-speaking clients | Hebrew only | RTL |
| English-speaking clients | Bilingual (English + Hebrew) | LTR primary, RTL sections |

### HTML/CSS Requirements

```html
<!-- Hebrew pages -->
<html lang="he" dir="rtl">

<!-- English pages -->
<html lang="en" dir="ltr">

<!-- Bilingual sections -->
<div dir="rtl" class="hebrew-section">...</div>
<div dir="ltr" class="english-section">...</div>
```

### Font Stack
```css
font-family: 'Segoe UI', Arial, sans-serif;
```
This stack supports both Hebrew and English characters properly.

---

## 📁 Repository Structure

```
annual-reports-client-portal/
├── index.html              # Client landing page (language selection)
├── view-documents.html     # Client document list view
├── document-manager.html   # Office document editing interface
├── admin/
│   └── index.html          # Admin portal (bulk import, dashboard)
└── AGENTS.md               # This file
```

---

## 🔗 System Endpoints

### Client-Facing Pages

| Page | URL | Purpose |
|------|-----|---------|
| Landing | `/?report_id=X&client_id=Y&...` | Language selection, redirect to Tally |
| Documents | `/view-documents.html?report_id=X` | View required documents list |

### Admin Pages

| Page | URL | Purpose |
|------|-----|---------|
| Admin Portal | `/admin/` | Dashboard, bulk import, send questionnaires |

### n8n Webhook Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/webhook/trigger-survey` | GET | Trigger questionnaire email (legacy) |
| `/webhook/tally-questionnaire-response` | POST | Receive Tally form submissions |
| `/webhook/check-existing-submission` | GET | Check if client already submitted |
| `/webhook/reset-submission` | GET | Delete documents and reset stage |
| `/webhook/approve-and-send` | GET | Send final document list to client |
| `/webhook/tally-edit-documents` | POST | Process office document edits |
| `/webhook/get-client-documents` | GET | Get document list for client view |
| `/webhook/get-documents` | GET | Get documents for office editing |
| `/webhook/admin-auth` | POST | Admin login |
| `/webhook/admin-verify` | GET | Verify admin token |
| `/webhook/admin-dashboard` | GET | Get stats and client list |
| `/webhook/admin-bulk-import` | POST | Import clients from Excel |
| `/webhook/admin-pending` | GET | Get clients pending questionnaire |
| `/webhook/admin-send-questionnaires` | POST | Send questionnaires to selected clients |

---

## 🗄️ Airtable Schema

### Base ID: `appqBL5RWQN9cPOyh`

### Tables

| Table | ID | Purpose |
|-------|-----|---------|
| `clients` | `tblFFttFScDRZ7Ah5` | Client master list |
| `annual_reports` | `tbls7m3hmHC4hhQVy` | One record per client per year |
| `documents` | `tblXXXXXXXX` | Required/received documents |

### Key Fields - `annual_reports`

| Field | Type | Description |
|-------|------|-------------|
| `report_key` | Formula | Unique ID (e.g., `CPA-XXX_2025`) |
| `client` | Link | Link to clients table |
| `year` | Number | Tax year (e.g., 2025) |
| `stage` | Single Select | Current workflow stage |
| `questionnaire_token` | Text | Unique token for questionnaire |
| `source_language` | Single Select | `he` or `en` |
| `spouse_name` | Text | Spouse name if applicable |

### Workflow Stages

| Stage | Code | Description |
|-------|------|-------------|
| 1 | `1-Send_Questionnaire` | Waiting to send questionnaire |
| 2 | `2-Waiting_For_Answers` | Questionnaire sent, awaiting response |
| 3 | `3-Collecting_Docs` | Documents list sent to client |
| 4 | `4-Review` | Office reviewing received documents |
| 5 | `5-Completed` | All documents received, report complete |

---

## 📝 Tally Forms

### Hebrew Form
- **Form ID**: `1AkYKb`
- **URL**: `https://tally.so/r/1AkYKb`

### English Form
- **Form ID**: `1AkopM`
- **URL**: `https://tally.so/r/1AkopM`

### Hidden Fields (passed via URL)

| Field | Description |
|-------|-------------|
| `report_record_id` | Airtable record ID |
| `client_id` | Client identifier |
| `year` | Tax year |
| `questionnaire_token` | Security token |
| `full_name` | Client name (pre-fill) |
| `email` | Client email (pre-fill) |

---

## 📧 Email Templates

### Language Detection

Emails are generated based on `source_language` field:
- `he` → Hebrew only
- `en` → Bilingual (English first, Hebrew below)

### Office Emails (Always Hebrew)

All emails to `reports@moshe-atsits.co.il` are in Hebrew only.

### Client Emails

Follow the language of the questionnaire they submitted.

---

## 🔐 Authentication

### Admin Portal

- **Method**: Password + HMAC token
- **Token validity**: 24 hours
- **Storage**: localStorage in browser

### Questionnaire Links

- **Method**: URL parameters with `questionnaire_token`
- **Validation**: Token checked against Airtable record

---

## 📊 Document Categories

Documents are organized into 6 categories:

| Emoji | Hebrew | English |
|-------|--------|---------|
| 💼 | הכנסות מעבודה | Employment Income |
| 🏦 | בנקים ושוק ההון | Banks & Capital Markets |
| 🛡️ | ביטוח, פנסיה וקצבאות | Insurance, Pension & Benefits |
| 🏠 | מגורים ונדל"ן | Housing & Real Estate |
| 📋 | אישי ותרומות | Personal & Donations |
| 💰 | הכנסות נוספות | Additional Income |

---

## ⚙️ Technical Stack

| Component | Technology |
|-----------|------------|
| Frontend | Static HTML/CSS/JS on GitHub Pages |
| Backend | n8n (workflow automation) |
| Database | Airtable |
| Forms | Tally |
| Email | Microsoft Graph API (OAuth2) |
| Excel parsing | SheetJS (xlsx library) |

---

## 🚨 Important Constraints

### Webhook Reliability

Tally has automatic retry mechanism. If n8n takes too long to respond, duplicates may occur.
**Solution**: Immediate webhook acknowledgment followed by background processing.

### Hebrew Text Processing

Standard JavaScript string functions may strip Hebrew characters.
**Solution**: Use proper UTF-8 handling, avoid aggressive sanitization.

### Data Consistency

Always use Airtable as single source of truth. Don't process questionnaire responses in parallel with database updates.

### CORS

All webhook responses must include:
```
Access-Control-Allow-Origin: *
```

---

## 🔄 Client Flow

```
1. Office imports clients via Admin Portal
   ↓
2. Office triggers questionnaire send
   ↓
3. Client receives email with link
   ↓
4. Client selects language (Hebrew/English)
   ↓
5. Client fills Tally questionnaire
   ↓
6. n8n processes response, creates document list
   ↓
7. Office receives email with document list
   ↓
8. Office reviews/edits document list
   ↓
9. Office approves → Client receives final list
   ↓
10. Client submits documents via email
   ↓
11. Office marks documents as received
   ↓
12. Process complete
```

---

## 🧪 Testing

### Test Clients

Use these for testing:
- `liozshor1@gmail.com` - Test Hebrew flow
- `natan@moshe-atsits.co.il` - Test office flow

### Test Checklist

- [ ] Language selection works
- [ ] Hebrew form submission creates correct documents
- [ ] English form submission creates bilingual emails
- [ ] Office can edit document list
- [ ] Client can view documents page
- [ ] Admin portal login works
- [ ] Bulk import creates clients and reports
- [ ] Questionnaire emails are sent correctly

---

## 📞 Support

**Office Email**: reports@moshe-atsits.co.il

**n8n Instance**: https://liozshor.app.n8n.cloud

**GitHub Pages**: https://liozshor.github.io/annual-reports-client-portal/

---

## 📅 Version History

| Date | Change |
|------|--------|
| 2025-01 | Initial system setup |
| 2025-01 | Added English questionnaire support |
| 2025-01 | Added Admin Portal for bulk operations |
| 2025-01 | Added client document view page |

---

## 🤖 For AI Agents

When working on this project:

1. **Always check language context** - Is this for office (Hebrew) or client (check `source_language`)?
2. **Test with real data** - Use the test clients listed above
3. **Preserve bilingual support** - Never remove English or Hebrew, always support both
4. **Check Airtable schema** - Field names and types matter
5. **Validate webhook responses** - Must return JSON with CORS headers
6. **Handle empty states** - Always handle cases where Airtable returns 0 records