# Data Map — Amendment 13 Compliance Audit

**System:** Annual Reports CRM — Moshe Atsits CPA Firm
**Date:** 2026-03-11
**Scope:** All personal data flows in the tax document collection system

---

## 1. Airtable Data Inventory

### Base: Annual Reports CRM (`appqBL5RWQN9cPOyh`)

#### 1.1 `clients` Table
| Field | Type | Personal Data? | ISS? | Notes |
|-------|------|:---:|:---:|-------|
| name | text | Yes | No | Full name |
| email | email | Yes | No | Contact email |
| client_id | formula | Yes | No | CPA-N identifier |
| onedrive_root_folder_id | text | No | No | System reference |
| is_active | checkbox | No | No | Status flag |

**Data minimization:** Appropriate — only essential client contact fields.

#### 1.2 `annual_reports` Table
| Field | Type | Personal Data? | ISS? | Notes |
|-------|------|:---:|:---:|-------|
| client (link) | link | Yes | No | Links to client record |
| year | number | No | No | Tax year |
| stage | select | No | No | Workflow stage |
| questionnaire_token | text | No | No | Auth token (security) |
| spouse_name | text | Yes | Yes (family) | Family status indicator |
| source_language | select | No | No | |
| client_email (lookup) | lookup | Yes | No | From clients |
| client_name (lookup) | lookup | Yes | No | From clients |
| notes | multiline | Potentially | Potentially | Free-form — could contain sensitive info |
| reminder_history | multiline | No | No | JSON timestamps |
| client_questions | multiline | Potentially | Potentially | JSON Q&A — may contain sensitive answers |

**Data minimization concern:** `client_questions` stores questionnaire Q&A as JSON — duplicates data from `תשובות שאלון שנתי`. Review whether both copies are needed.

#### 1.3 `documents` Table
| Field | Type | Personal Data? | ISS? | Notes |
|-------|------|:---:|:---:|-------|
| document_key | text | No | No | System key |
| type | text | No | No | Template reference |
| status | select | No | No | |
| person | select | Yes | Yes (family) | "client" or "spouse" — reveals marital status |
| issuer_name | text | Potentially | No | e.g., employer name, bank name |
| file_url | url | No | No | OneDrive link |
| ai_confidence | number | No | No | AI classification score |
| ai_reason | multiline | No | No | AI reasoning |
| source_sender_email | email | Yes | No | Who sent the document |
| source_attachment_name | text | Potentially | No | Original filename |
| bookkeepers_notes | multiline | Potentially | Potentially | Office notes |
| fix_reason_client | multiline | No | No | Client-facing fix notes |

**Data minimization concern:** `ai_reason` retains full AI reasoning text. Consider retention policy for AI data.

#### 1.4 `תשובות שאלון שנתי` (Questionnaire Responses) Table
| Field | Type | Personal Data? | ISS? | Notes |
|-------|------|:---:|:---:|-------|
| שם ושם משפחה | text | Yes | No | Full name |
| email | email | Yes | No | Client email |
| מצב משפחתי בשנת המס | text | Yes | **Yes (family)** | Marital status |
| שם בן/בת הזוג | text | Yes | **Yes (family)** | Spouse name |
| האם היית שכיר/ה | text | Yes | No | Employment status |
| רשימת מעסיקים | text | Yes | No | Employer names |
| האם קיבלת קצבת נכות | text | Yes | **Yes (health)** | NII disability benefits |
| דמי לידה | text | Yes | **Yes (health)** | Maternity leave |
| מוסדות ניירות ערך | text | Yes | No | Securities institutions |
| הכנסות משכירות | text | Yes | No | Rental income |
| תרומות | text | Yes | No | Donations |
| (45+ total fields) | various | Yes | Mixed | Full questionnaire responses |

**ISS fields identified:** Marital status, spouse name, disability benefits, maternity leave, children with disabilities (T101/T102), medical details (T1403), memorial/bereavement (T1401/T1402).

**Data minimization:** All fields directly support tax report preparation — appears necessary.

#### 1.5 `email_events` Table
| Field | Type | Personal Data? | ISS? | Notes |
|-------|------|:---:|:---:|-------|
| sender_email | email | Yes | No | Who sent the email |
| subject | text | Potentially | No | Email subject line |
| attachment_name | text | Potentially | No | Filename |
| processing_status | select | No | No | |

**Retention concern:** No automated cleanup documented. Email events should follow retention policy.

#### 1.6 `pending_classifications` Table
| Field | Type | Personal Data? | ISS? | Notes |
|-------|------|:---:|:---:|-------|
| client_name | text | Yes | No | Denormalized |
| client_id | text | Yes | No | Denormalized |
| sender_email | email | Yes | No | |
| sender_name | text | Yes | No | |
| attachment_name | text | Potentially | No | |
| ai_confidence | number | No | No | |
| ai_reason | multiline | No | No | AI classification evidence |
| file_url | url | No | No | OneDrive link |

**Retention:** Privacy-compliance.md states 90-day retention for AI classification data. No automated cleanup workflow identified.

#### 1.7 `system_logs` Table
| Field | Type | Personal Data? | ISS? | Notes |
|-------|------|:---:|:---:|-------|
| Context_JSON | multiline | Potentially | No | May contain client IDs, emails |

**Retention:** Not explicitly defined. Should be aligned with security_logs (90 days non-critical).

#### 1.8 `security_logs` Table
| Field | Type | Personal Data? | ISS? | Notes |
|-------|------|:---:|:---:|-------|
| actor_ip | text | Yes | No | IP address (now explicitly PII under Amendment 13) |
| report_id | text | Yes | No | Links to client data |
| details | multiline | Potentially | No | JSON context |

**Retention:** 90 days (non-critical), 365 days (critical). Automated by `[MONITOR] Log Cleanup` workflow.

---

## 2. Data Flow Map

### 2.1 Questionnaire Collection Flow
```
Client Browser
  → GitHub Pages (index.html) — reads report_id + token from URL
  → Tally Form (hosted by Tally) — collects all questionnaire data
  → Tally Airtable Integration — writes to תשובות שאלון שנתי table
  → n8n Workflow [02] (Airtable Trigger) — processes responses
  → Document Service Sub-Workflow — generates document list
  → Airtable (documents table) — stores generated documents
  → Microsoft Graph API — sends office notification email
```

**Personal data in transit:** Full name, email, marital status, spouse name, employment details, disability status, income details, all questionnaire answers.

### 2.2 Document Reception Flow (AI Classification)
```
Client → Email (with attachments) → Office inbox
  → n8n Workflow [05] — polls Microsoft Graph for new emails
  → Attachment download + PDF conversion
  → Anthropic Claude API — sends document image for classification
  → AI response: matched template, confidence, reasoning
  → OneDrive — file upload
  → Airtable — pending_classifications table
  → Admin Review (human-in-the-loop)
  → Airtable — documents table update
```

**Personal data sent to Anthropic:** Document images (may contain names, tax IDs, financial figures, medical info). Classification metadata returned.

### 2.3 Client Document Viewing Flow
```
Client receives email with link
  → GitHub Pages (index.html) — report_id + token in URL
  → URL params stripped from browser bar immediately
  → Token stored in sessionStorage
  → n8n webhook (check-existing-submission) — validates token
  → n8n webhook (get-client-documents) — returns document list
  → view-documents.html — displays categorized document list
```

**Personal data exposed:** Client name, spouse name, year, document titles (may contain employer names, bank names, medical details) displayed in browser.

### 2.4 Admin Operations Flow
```
Admin → GitHub Pages (admin/index.html) — password login
  → n8n webhook (admin-auth) — returns HMAC token (8-hour)
  → Dashboard, client management, document management
  → All API calls include admin_token in request
```

---

## 3. URL Parameter Exposure Analysis

### 3.1 Current URL Parameters

| Page | Parameters | Contains PII? | Risk |
|------|-----------|:---:|------|
| index.html | `report_id`, `token` | No (opaque IDs) | Low — stripped immediately |
| view-documents.html | `report_id` | No | Low — token in sessionStorage |
| document-manager.html | `report_id` | No | Low — admin_token in localStorage |
| approve-confirm.html | `report_id`, `token`, `result`, `warning`, `sent_at` | No | Low — stripped immediately |
| Tally form redirect | `report_record_id`, `client_id`, `year`, `questionnaire_token`, `full_name`, `email`, `source_language` | **Yes** | **Medium** — PII passed to Tally |

**Key finding:** The `goToForm()` function in `landing.js:291-303` passes `full_name` and `email` as URL parameters to Tally. These appear in:
- Browser address bar (briefly)
- Browser history
- Tally server logs
- Referrer headers (if Tally has external links)

**Mitigation already in place:** `<meta name="referrer" content="no-referrer">` prevents referrer leakage. URL params are stripped from the landing page URL bar. However, PII is still passed in the Tally redirect URL.

---

## 4. Third-Party Data Processors

### 4.1 Airtable (US-based)
- **Data received:** All client data, questionnaire responses, documents metadata, system logs
- **Server location:** United States
- **DPA status:** Airtable offers a GDPR DPA — needs to be executed
- **Adequacy:** US is not an "adequate jurisdiction" — requires SCCs or equivalent
- **Risk:** Primary database — highest volume of personal data

### 4.2 Anthropic / Claude API (US-based)
- **Data received:** Document images for classification (may contain tax IDs, names, financial data, medical info)
- **Server location:** United States
- **Data retention:** API inputs retained for **7 days** (reduced from 30 as of Sep 2025). Not used for training. **Zero-day retention (ZDR) addendum** available on request.
- **DPA status:** Anthropic's DPA with SCCs is **auto-included** in Commercial ToS — accepted on API signup. Review to confirm Israeli coverage. Consider requesting ZDR addendum. See [Anthropic DPA](https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa).
- **Risk:** Sensitive document content sent for AI processing

### 4.3 Microsoft 365 / Graph API (EU/IL-based)
- **Data received:** Emails (sending/receiving), document files (OneDrive)
- **Server location:** EU/Israel (depends on tenant configuration)
- **DPA status:** Microsoft provides comprehensive DPA
- **Risk:** Lower — likely adequate jurisdiction

### 4.4 n8n Cloud (EU-based)
- **Data received:** All workflow data passes through n8n (processing metadata, API payloads)
- **Server location:** EU (Germany)
- **DPA status:** n8n provides GDPR DPA
- **Risk:** Lower — EU is adequate jurisdiction, data is transient
- **CRITICAL NOTE:** Multiple secrets (Airtable PATs, admin password, HMAC keys) are hardcoded in JavaScript Code nodes within n8n workflows. Anyone with n8n editor access can view all secrets. See compliance report Finding 24.

### 4.5 Tally (EU-based)
- **Data received:** Full questionnaire responses, client PII (name, email)
- **Server location:** EU (Belgium)
- **DPA status:** Tally provides GDPR DPA — needs to be reviewed for Israeli compliance
- **Risk:** Receives all questionnaire data including ISS (family status, disability)

### 4.6 GitHub Pages (US-based)
- **Data received:** Static HTML/JS files only — no PII stored
- **Server location:** United States
- **Risk:** Minimal — may log IP addresses (standard web server behavior)
- **Note:** GitHub's privacy policy covers IP logging

---

## 5. Data Categories Summary

| Category | Where Stored | ISS? | Volume |
|----------|-------------|:---:|--------|
| Client identifiers (name, email, ID) | Airtable (clients, annual_reports) | No | ~600 records |
| Family status (marital, spouse) | Airtable (questionnaire, annual_reports) | **Yes** | ~600 records |
| Employment data (employers, income) | Airtable (questionnaire, documents) | No | ~600 records |
| Health/disability data | Airtable (questionnaire) | **Yes** | Subset of clients |
| Financial data (investments, deposits) | Airtable (questionnaire, documents) | No* | ~600 records |
| Tax documents (images) | OneDrive, Anthropic (transient) | **Yes** | Thousands of files |
| AI classification data | Airtable (pending_classifications, documents) | No | Per document |
| Security/audit logs | Airtable (security_logs, system_logs) | Partially | Rolling |
| Email metadata | Airtable (email_events) | Partially | Per email |

*Financial data is considered sensitive under Amendment 13's expanded definition.

---

## 6. n8n Workflow Data Flow Inventory

Based on MCP audit of 30 active workflows on `liozshor.app.n8n.cloud`:

| Workflow | ID | Personal Data | External Services | Key Concern |
|----------|-----|--------------|-------------------|-------------|
| [01] Send Questionnaires | `9rGj2q...` | Client name, email, report ID | Airtable, MS Graph, GitHub Pages | Client token secret hardcoded |
| [02] Questionnaire Processing | `QqEIWQ...` | Full questionnaire answers, name, email, spouse | Airtable (5 tables), MS Graph, Document Service | Airtable PAT hardcoded in code |
| [03] Approve & Send | `cNxUgCH...` | Client names, emails, document lists | Airtable, MS Graph | HMAC secret hardcoded |
| [04] Document Edit Handler | `y7n4qa...` | Document metadata, client info | Airtable, MS Graph, OneDrive | Large workflow, partial audit |
| [05] Inbound Document Processing | `cIa23K8...` | Document images, sender email/name, attachments | MS Graph, OneDrive, Airtable, Claude API | 43 nodes, not accessible via MCP |
| [SUB] Document Service | `hf7DRQ...` | Questionnaire answers, document generation | Airtable (multiple tables) | Central hub for all personal data |
| [Admin] Auth & Verify | `REInXx...` | IP addresses, auth events | Airtable security_logs | **Admin password in plaintext** |
| [Admin] Bulk Import | `DjIXYU...` | Client names, emails, phone numbers | Airtable | Downloads ALL clients for dedup |
| [05-SUB] Email Subscription | `qCNsXn...` | Inbox metadata | MS Graph | Subscribes to ALL inbox messages |
| [API] Get Pending Classifications | `kdcWwk...` | Client names, sender info, AI results | Airtable (5 tables), MS Graph | Airtable PAT hardcoded |
| [MONITOR] Security Alerts | `HL7HZw...` | IP addresses, security events | Airtable, MS Graph | Sends alerts to personal Gmail |
| [MONITOR] Log Cleanup | `AIwVdD...` | Security log records | Airtable | Only workflow with data retention automation |

### Key n8n Data Flow Concerns:
1. **Secrets in code:** 2 Airtable PATs, admin password, HMAC key, client token secret all hardcoded across 6+ workflows
2. **No data minimization:** Several workflows fetch ALL clients/documents on every request
3. **Email subscription scope:** Monitors ALL inbox messages, not filtered to client emails
4. **Workflow [05] inaccessible:** The highest-risk workflow (AI classification, 43 nodes) has `availableInMCP: false` — could not be fully audited
