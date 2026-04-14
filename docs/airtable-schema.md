# Airtable Schema Reference

**Base:** Annual Reports CRM
**Base ID:** `appqBL5RWQN9cPOyh`
**Last Updated:** 2026-03-27

> **Last verified against live Airtable:** 2026-03-27 (full audit — 17 fields added, 1 table added, 1 link target fixed)

---

## Table Relationships

```
clients (1) ──→ (N) reports (1) ──→ (N) documents
                         │                        │
                         ↓                        ↓
                  תשובות שאלון         email_events
                  (questionnaire responses)       │
                                                  ↓
                                      pending_classifications
                                      (links: report, document, email_event)

documents_templates ← referenced by → question_mappings
                                            │
categories ← referenced by ────────────────┘

company_links (standalone — insurance company URLs for client portal)
```

---

## Core Tables

### clients (`tblFFttFScDRZ7Ah5`)
**Purpose:** Master client list for the firm.

| Field | Type | Description |
|-------|------|-------------|
| name | singleLineText | Client full name |
| client_counter | autoNumber | Auto-incrementing ID |
| client_id | formula | Generated key (e.g., "CPA-XXX") |
| email | email | Client email address |
| phone | phoneNumber | Client phone number |
| onedrive_root_folder_id | singleLineText | OneDrive folder for filing documents |
| is_active | checkbox | Active client flag |
| annual_reports | link → reports | All reports for this client |
| created_at | createdTime | |
| updated_at | lastModifiedTime | |
| cc_email | singleLineText | CC email address for notifications |

---

### reports (`tbls7m3hmHC4hhQVy`) *(formerly `annual_reports`)*
**Purpose:** One record per client per tax year per filing type. Tracks the full lifecycle from questionnaire to document collection.

| Field | Type | Description |
|-------|------|-------------|
| report_key | formula | Unique key (client + year + filing_type) |
| client | link → clients | Which client |
| year | number | Tax year (e.g., 2025) |
| stage | singleSelect | Pipeline stage (see below) |
| questionnaire_token | singleLineText | Auth token for questionnaire link |
| report_uid | singleLineText | Unique report identifier |
| spouse_name | singleLineText | Spouse name (from questionnaire) |
| source_language | singleSelect | he / en |
| docs_total | count | Total required documents |
| docs_missing_count | rollup | Documents still missing |
| docs_received_count | rollup | Documents received |
| completion_percent | formula | % complete |
| completion_status_auto | formula | Status label |
| last_progress_check_at | dateTime | Last activity timestamp |
| docs_first_sent_at | dateTime | When docs list was first sent to client (set by WF[03]) |
| docs_completed_at | dateTime | When completion_percent first reached 100% |
| onedrive_folder_id | singleLineText | OneDrive folder ID for this report |
| record_id | formula | The Airtable record ID |
| client_id | lookup | From clients table |
| client_email | lookup | From clients table |
| client_name | lookup | From clients table |
| documents | link → documents | All documents for this report |
| email_events | link → email_events | Related email events |
| notes | multilineText | Free-form notes |
| reminder_count | number | Times reminder sent (default 0) |
| reminder_max | number | Max reminders (null = system default 3) |
| reminder_next_date | date | Next scheduled reminder date |
| reminder_suppress | singleSelect | `this_month` / `forever` (null = active) |
| last_reminder_sent_at | dateTime | Last reminder send timestamp |
| reminder_history | multilineText | JSON array of `{date, type}` entries — inline send history |
| client_is_active | lookup | From clients.is_active — used to filter deactivated clients |
| client_questions | multilineText | JSON string — array of `{id, text, answer}` objects. Set by Document Manager (DL-110). Read by [API] Admin Questionnaires for questionnaire tab display. |
| filing_type | singleSelect | `annual_report` / `capital_statement` — determines which document templates and question mappings apply (DL-164) |
| pending_classifications | link → pending_classifications | Reverse link from pending_classifications |
| client_notes | multilineText | Free-form notes about the client (distinct from report `notes`) |
| rejected_uploads_log | multilineText | DL-244: JSON array of rejected uploads {filename, date, reason}. Auto-cleared on stage transition past Collecting_Docs. |

**Stage values (8-stage pipeline):**
1. `Send_Questionnaire` — Questionnaire not yet sent
2. `Waiting_For_Answers` — Questionnaire sent, client hasn't filled it yet
3. `Pending_Approval` — Questionnaire filled, documents not yet sent (office action)
4. `Collecting_Docs` — Documents sent, waiting for client uploads
5. `Review` — Ready for preparation
6. `Moshe_Review` — Ready for Moshe's review
7. `Before_Signing` — Before client signing
8. `Completed` — Report filed/submitted

---

### documents (`tblcwptR63skeODPn`)
**Purpose:** Individual required documents per report. Created by workflow [02] from questionnaire answers. Status tracked as documents are received.

| Field | Type | Description |
|-------|------|-------------|
| document_key | singleLineText | Unique key (legacy, for backward compat) |
| document_uid | singleLineText | Unique ID for upsert matching |
| report | link → reports | Which report this belongs to |
| type | singleLineText | Template ID reference (e.g., "T201") |
| status | singleSelect | Document status (see below) |
| person | singleSelect | "client" or "spouse" |
| category | singleLineText | Category ID (e.g., "employment") |
| issuer_key | singleLineText | Normalized key for deduplication |
| issuer_name | singleLineText | Display name (Hebrew) |
| issuer_name_en | multilineText | Display name (English) |
| bookkeepers_notes | multilineText | Office notes |
| file_url | url | OneDrive file URL (when received) |
| onedrive_item_id | singleLineText | OneDrive item ID |
| expected_filename | singleLineText | Expected file name |
| uploaded_at | dateTime | When document was uploaded |
| ai_confidence | number | AI classification confidence (0-1) |
| ai_reason | multilineText | AI classification reasoning |
| review_status | singleSelect | pending_review / confirmed / rejected / manual |
| reviewed_by | singleLineText | Who reviewed the document |
| reviewed_at | dateTime | When document was reviewed |
| source_message_id | singleLineText | Email message ID |
| source_internet_message_id | singleLineText | Internet message ID |
| source_attachment_name | singleLineText | Original attachment filename |
| source_sender_email | email | Who sent it |
| file_hash | singleLineText | File hash for duplicate detection |
| fix_reason_client | multilineText | Client-facing fix reason (for reminders) |
| report_key_lookup | lookup | From annual_reports |
| report_record_id | lookup | From annual_reports |
| email_events | link → email_events | Related email events |
| pending_classifications | link → pending_classifications | Reverse link from pending_classifications |
| is_missing | formula | Boolean: is document still missing? |
| is_received | formula | Boolean: has document been received? |
| is_required | formula | Boolean: status is Required_Missing, Received, or Requires_Fix |
| created_at | createdTime | |
| updated_at | lastModifiedTime | |

**Status values:**
- `Required_Missing` — Document required, not yet received
- `Received` — Document received and filed
- `Requires_Fix` — Document received but needs correction
- `Waived` — Document no longer required (office override)
- `Not Required` — Document not required (note: space, not underscore)

---

## SSOT Tables (Document Generation Infrastructure)

These three tables together replace all hardcoded document generation logic. They are the **single source of truth** for what documents to generate and how to display them.

### documents_templates (`tblQTsbhC6ZBrhspc`)
**Purpose:** The 33 document title templates. Every document title that the system generates MUST come from this table.

| Field | Type | Description |
|-------|------|-------------|
| template_id | multilineText | Unique ID (e.g., "T201", "T501") |
| name_he | multilineText | Hebrew title template with `{variable}` placeholders |
| name_en | multilineText | English title template with `{variable}` placeholders |
| short_name_he | singleLineText | Short Hebrew name for compact UI displays |
| category | singleSelect | Category ID (links to categories table) |
| scope | singleSelect | CLIENT / SPOUSE / PERSON / GLOBAL_SINGLE |
| emoji | singleSelect | Display emoji |
| variables | multilineText | Comma-separated variable names (e.g., "year, employer_name") |
| help_he | multilineText | Hebrew help text / instructions (Rich text/HTML supported) |
| help_en | multilineText | English help text / instructions (Rich text/HTML supported) |
| filing_type | singleSelect | `annual_report` / `capital_statement` — which filing type this template belongs to (DL-164) |

**Current templates (33):**
| ID | Scope | Category | Title (Hebrew, truncated) |
|----|-------|----------|---------------------------|
| T001 | CLIENT | general | אישור תושבות לשנת {year} – {city_name} |
| T002 | GLOBAL_SINGLE | general | ספח ת״ז מעודכן |
| T003 | CLIENT | general | מסמכי שינוי סטטוס משפחתי... |
| T101 | CLIENT | children | אישור ועדת השמה/שילוב |
| T102 | CLIENT | children | אישור קצבת נכות עבור הילד/ה |
| T201 | CLIENT | employment | טופס 106 – {employer_name} |
| T202 | SPOUSE | employment | טופס 106 – {spouse_name} – {employer_name} |
| T301 | CLIENT | insurance | אישור תקבולי {allowance_type} מביטוח לאומי |
| T302 | SPOUSE | insurance | אישור תקבולי {allowance_type} – {spouse_name} |
| T303 | PERSON | insurance | אישור דמי נכות – {person_name} |
| T304 | PERSON | insurance | אישור דמי לידה – {person_name} |
| T305 | CLIENT | insurance | קצבת שארים – {survivor_details} |
| T306 | SPOUSE | insurance | קצבת שארים – {spouse_name} – {survivor_details} |
| T401 | CLIENT | insurance | אישור משיכה – {withdrawal_type} |
| T402 | CLIENT | insurance | אישור משיכה – אחר: {withdrawal_other_text} |
| T501 | CLIENT | insurance | אישור הפקדות – {deposit_type} ב{company_name} |
| T601 | CLIENT | securities | טופס 867 – {institution_name} |
| T701 | CLIENT | securities | דוח רווחים/הפסדים קריפטו – {crypto_source} |
| T801 | CLIENT | other_income | אישור זכייה/פרסים – {gambling_source} |
| T901 | CLIENT | housing | חוזה שכירות הכנסה – {rent_income_monthly} |
| T902 | CLIENT | housing | חוזה שכירות הוצאה – {rent_expense_monthly} |
| T1001 | CLIENT | other_income | רשימת מלאי – 31.12.{year} |
| T1101 | CLIENT | other_income | ניכוי מס הכנסה במקור – {withholding_client_name} |
| T1102 | CLIENT | other_income | ניכוי ביטוח לאומי במקור – {withholding_client_name} |
| T1201 | CLIENT | personal | קבלות תרומות סעיף 46 |
| T1301 | CLIENT | personal | אישור שחרור משירות |
| T1401 | CLIENT | personal | הוצאות הנצחה – {relationship_details} |
| T1402 | CLIENT | personal | מסמך רשמי (קרוב במוסד) |
| T1403 | CLIENT | personal | מסמך רפואי – {medical_details} |
| T1501 | CLIENT | personal | תואר אקדמי – {university_name} – {degree_type} |
| T1601 | CLIENT | other_income | אסמכתאות הכנסות מחו״ל – {country} – {income_type} |
| T1602 | CLIENT | other_income | דו״ח מס במדינה – {country} |
| T1701 | CLIENT | other_income | מסמך הכנסה נוספת – {other_income_text} |

---

### question_mappings (`tblWr2sK1YvyLWG3X`)
**Purpose:** Maps each Tally questionnaire field to the document template(s) it triggers. This is the "brain" that decides which documents are required based on questionnaire answers.

| Field | Type | Description |
|-------|------|-------------|
| mapping_id | multilineText | Descriptive ID (e.g., "employment_client") |
| label_he | multilineText | Hebrew label for the question |
| label_en | multilineText | English label |
| tally_key_he | multilineText | Tally field key for Hebrew form |
| template_ids | singleSelect | Template ID(s) to generate (semicolon-separated, e.g., "T002;T003") |
| condition | singleSelect | Trigger condition: `yes` or `has_value` |
| per_item | checkbox | If true, generate one document per item in a list |
| is_spouse | checkbox | If true, document belongs to spouse section |
| category | singleSelect | Category ID for grouping |
| airtable_field_name | singleLineText | Corresponding Hebrew field name in תשובות שאלון שנתי table. Used by WF02 to translate Airtable field names → tally_key_he for the Document Service. |
| filing_type | singleSelect | `annual_report` / `capital_statement` — which filing type this mapping belongs to (DL-164) |

**Condition types:**
- `yes` — Triggers when answer is "כן" / true / checked
- `has_value` — Triggers when field has any non-empty value (used for list/text fields)

**per_item logic:**
- `false` — One document regardless of answer content
- `true` — Split answer by newline/semicolon, generate one document per item

**60 mappings currently defined.**

---

### categories (`tblbn6qzWNfR8uL2b`)
**Purpose:** Display categories for grouping documents with emoji headers. Used for visual organization in emails and web pages.

| Field | Type | Description |
|-------|------|-------------|
| category_id | multilineText | Unique key (e.g., "employment") |
| name_he | multilineText | Hebrew category name |
| name_en | multilineText | English category name |
| emoji | multilineText | Display emoji |
| sort_order | number | Display order (1 = first) |

**Current categories (8):**
| ID | Emoji | Hebrew | English | Order |
|----|-------|--------|---------|-------|
| employment | :briefcase: | הכנסות מעבודה | Employment Income | 1 |
| securities | :bank: | בנקים ושוק ההון | Banks & Capital Markets | 2 |
| insurance | :shield: | ביטוח פנסיה וקצבאות | Insurance Pension & Benefits | 3 |
| housing | :house: | מגורים ונדל״ן | Housing & Real Estate | 4 |
| personal | :clipboard: | אישי ותרומות | Personal & Donations | 5 |
| other_income | :moneybag: | הכנסות נוספות | Additional Income | 6 |
| general | :page_facing_up: | כללי | General | 7 |
| children | :baby: | ילדים | Children | 8 |

---

## Input Table

### תשובות שאלון שנתי (`tblxEox8MsbliwTZI`)
**Purpose:** Raw questionnaire responses. Tally pushes submissions here via its native Airtable integration. n8n workflow [02] triggers on new records in this table.

**Key characteristics:**
- Field names are in Hebrew (human-readable, NOT UUIDs)
- Values are already translated (no UUID-to-label mapping needed)
- Contains system fields: report_record_id, client_id, year, questionnaire_token, email
- Contains all 45+ questionnaire answer fields

**System fields:**
| Field | Type | Description |
|-------|------|-------------|
| report_record_id | singleLineText | Links to annual_reports record |
| client_id | singleLineText | Client identifier (e.g., "CPA-XXX") |
| year | singleLineText | Tax year |
| questionnaire_token | singleLineText | Auth token |
| source_language | singleSelect | Form language (choices: עברית, English, he, en) |
| email | email | Client email |
| מספר טלפון | phoneNumber | Client phone number |
| סטטוס | singleSelect | ממתין למילוי / התקבל / בטיפול / הושלם / דורש השלמה |
| תאריך הגשה | date | Submission date |
| הערות פנימיות | multilineText | Internal notes |
| אישור פרטיות | checkbox | Privacy consent confirmation |

**Answer fields (sample):**
| Field | Maps to |
|-------|---------|
| שם ושם משפחה | Client name |
| מצב משפחתי בשנת המס | Marital status |
| שם בן/בת הזוג | Spouse name |
| האם היית שכיר/ה בשנת המס | Employment trigger |
| רשימת מעסיקים בן/בת זוג | Spouse employers list |
| האם קיבלת קצבת נכות מביטוח לאומי | NII disability trigger |
| מוסדות ניירות ערך | Securities institutions list |
| ... | (45+ fields total) |

---

## Support Tables

### email_events (`tblJAPEcSJpzdEBcW`)
**Purpose:** Track inbound email processing for Phase 2 (document reception).

| Field | Type | Description |
|-------|------|-------------|
| event_key | singleLineText | Unique event key |
| source_message_id | singleLineText | MS Graph message ID |
| source_internet_message_id | singleLineText | Internet message ID |
| received_at | dateTime | When email was received |
| sender_email | email | Who sent the email |
| subject | singleLineText | Email subject |
| attachment_name | singleLineText | Attachment filename |
| processing_status | singleSelect | Processing state (Detected / Downloaded / Classified / Uploaded / Airtable_Updated / Completed / Failed / NeedsHuman) |
| error_message | multilineText | Error details if failed |
| workflow_run_id | singleLineText | n8n workflow execution ID |
| document | link → documents | Matched document |
| report | link → reports | Associated report |
| retry_count | number | Retry attempts |
| next_retry_at | dateTime | Next retry time |
| last_error_step | singleLineText | Last step where error occurred |
| pending_classifications | link → pending_classifications | Reverse link from pending_classifications |
| match_method | singleSelect | How sender was identified: `email_match` / `forwarded_email` / `sender_name` / `ai_identification` / `unidentified` |
| created_at | createdTime | Record creation time |

### system_config (`tblqHOkDnvb95YL3O`)
**Purpose:** Key-value configuration store for system-wide settings. Used by workflows and the admin panel at runtime.

| Field | Type | Description |
|-------|------|-------------|
| config_key | singleLineText | Lookup key (primary field) |
| config_value | singleLineText | Value (empty = feature-specific default) |
| description | singleLineText | Human-readable purpose |

**Current records:**
| Key | Default | Description |
|-----|---------|-------------|
| reminder_default_max | (empty = unlimited) | Max reminders per client. Per-client `reminder_max` overrides. |

---

---

### system_logs (`tblVjLznorm0jrRtd`)
**Purpose:** Workflow execution logs for debugging.

| Field | Type | Description |
|-------|------|-------------|
| Workflow_name | multilineText | Which workflow |
| Log_Level | singleSelect | Info / Error / Critical |
| Message | multilineText | Log message |
| Context_JSON | multilineText | Structured context data |
| Created_At | createdTime | Timestamp |

### security_logs (`tbljTNfeEkb3psIf8`)
**Purpose:** Security event logs for monitoring auth failures, token issues, and suspicious activity. Written by inline `logSecurity()` helpers in auth Code nodes (fire-and-forget). Queried by `[MONITOR] Security Alerts` workflow. Cleaned by `[MONITOR] Log Cleanup` workflow.

| Field | Type | Description |
|-------|------|-------------|
| timestamp | dateTime | Event time (ISO 8601, Asia/Jerusalem) |
| event_type | singleSelect | `AUTH_SUCCESS`, `AUTH_FAIL`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `ADMIN_ACTION`, `RATE_LIMIT` |
| severity | singleSelect | `INFO`, `WARNING`, `CRITICAL` |
| actor | singleLineText | Who (admin, admin-attempt, admin-token, monitor, anonymous) |
| actor_ip | singleLineText | `x-forwarded-for` header |
| endpoint | singleLineText | Which webhook was called |
| report_id | singleLineText | Affected report (if applicable) |
| http_status | number | Response status code |
| error_message | singleLineText | Failure reason (if applicable) |
| details | multilineText | JSON with extra context |
| workflow_execution_id | singleLineText | n8n execution ID for tracing |

**Retention:** Non-CRITICAL: 90 days. CRITICAL: 365 days. Automated by `[MONITOR] Log Cleanup`.

---

### pending_classifications (`tbloiSDN3rwRcl1ii`)
**Purpose:** Track AI-classified document attachments pending human review. Created by WF05 after classifying inbound email attachments.

| Field | Type | Description |
|-------|------|-------------|
| classification_key | singleLineText | Primary key (auto-generated: `{client_id}-{year}-{attachment_name}`) |
| report | link → reports | Client's active report |
| document | link → documents | Matched document record (null if unmatched) |
| email_event | link → email_events | Source email event |
| attachment_name | singleLineText | Original filename |
| attachment_content_type | singleLineText | MIME type |
| attachment_size | number | File size in bytes |
| sender_email | email | Who sent it |
| sender_name | singleLineText | Sender display name |
| received_at | dateTime | When email arrived |
| matched_template_id | singleLineText | AI's classification template ID (null if unmatched) |
| ai_confidence | number | 0-1 confidence score |
| ai_reason | multilineText | Evidence text from Claude |
| issuer_name | singleLineText | Extracted issuer/institution name |
| file_url | url | OneDrive web URL |
| onedrive_item_id | singleLineText | OneDrive item ID |
| file_hash | singleLineText | SHA-256 for dedup |
| review_status | singleSelect | `pending` / `approved` / `rejected` / `reassigned` / `splitting` / `split` |
| reviewed_by | singleLineText | Reviewer name |
| reviewed_at | dateTime | When reviewed |
| reassigned_to_template | singleLineText | If reassigned, new template ID |
| notes | multilineText | Reviewer notes |
| client_name | singleLineText | Denormalized for display |
| client_id | singleLineText | Denormalized client ID |
| year | number | Report year |
| issuer_match_quality | singleSelect | AI issuer matching quality: `exact`, `fuzzy`, `mismatch`, `single` |
| matched_doc_name | singleLineText | Display name of matched document (HTML-stripped) |
| expected_filename | singleLineText | Expected filename for the document |
| is_duplicate | checkbox | Flagged as duplicate attachment |
| notification_status | singleSelect | `sent` / `dismissed` — client notification state |
| conversion_error | singleLineText | Error message if file conversion failed |
| conversion_failed | checkbox | Whether file conversion failed |
| email_body_text | multilineText | Extracted email body text for context |

---

### company_links (`tblDQJvIaEgBw2L6T`)
**Purpose:** Insurance/financial company directory with links to document portals. Used by client portal to provide direct links for downloading documents.

| Field | Type | Description |
|-------|------|-------------|
| name_he | singleLineText | Company name in Hebrew |
| name_en | singleLineText | Company name in English |
| aliases | multilineText | Alternative names/spellings for matching |
| url | url | Link to company's document portal |
