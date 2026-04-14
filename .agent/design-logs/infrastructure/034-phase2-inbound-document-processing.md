# Design Log 034: Phase 2 — Inbound Document Processing
**Status:** [COMPLETED]
**Date:** 2026-02-17
**Related Logs:** 027 (Document Service), 029 (WF02 rebuild), 033 (Review Queue)

## 1. Context & Problem

Today, when clients email documents back to `reports@moshe-atsits.co.il`, staff must:
1. Open each email manually
2. Figure out which client sent it
3. Identify what type of document it is (Form 106? Form 867? etc.)
4. Match it against the client's required document list
5. Mark it as received in the system
6. File it into the correct OneDrive folder

With 500+ clients, each sending 5-15 documents over several months, this is hundreds of manual classification + filing actions.

**Goal:** Automate the entire pipeline — from email arrival to Airtable status update to OneDrive filing — with AI classification and human-in-the-loop review (especially in month 1).

## 2. User Requirements (Discovery Q&A)

1. **Q:** Polling vs real-time trigger?
   **A:** No heavy polling (no 5-min scheduler). Use an event-driven trigger (IMAP trigger or MS Graph webhook).

2. **Q:** One mailbox or multiple?
   **A:** Only `reports@moshe-atsits.co.il`.

3. **Q:** Client identification — what's the fallback?
   **A:** (a) Match by sender email address → Airtable lookup. (b) Also parse subject/body for client name or ID. If still no match → notify Natan for manual handling.

4. **Q:** Confidence threshold — what happens when AI isn't sure?
   **A:** Auto-tag with best guess + always send for Natan's review. First month is fully human-in-the-loop: system classifies, Natan confirms. If system can't classify at all → notify Natan to handle manually.

5. **Q:** Multiple documents in one email?
   **A:** Each attachment = one document (classify independently). If AI detects a multi-document PDF (e.g., Form 106 + Form 867 in one file), flag for manual handling. Smart PDF splitting is a future enhancement.

6. **Q:** OneDrive filing — must-have?
   **A:** Yes. User has the root OneDrive folder ID. For each client: ensure folder exists (create if not), then inside it year subfolders (e.g., `2025/`). File each document there.

7. **Q:** Duplicate handling?
   **A:** Keep both versions, flag with "sent twice" or similar status.

8. **Q:** Natan's review interface?
   **A:** Both email notification (with link) AND a new "Document Intake" tab on the admin dashboard showing pending classifications for review.

## 3. Technical Constraints & Risks

### Dependencies
- **Microsoft Graph API** — already configured (used for sending emails in WF02/03). Need to add email *reading* + OneDrive file upload permissions.
- **Airtable** — `documents` table (update status), `clients` table (email lookup), `annual_reports` table (active report per client).
- **AI Model** — Claude or GPT-4 Vision for document classification. Need to handle PDFs (text extraction) and images (OCR/vision).
- **OneDrive** — root folder ID available. Need to create client + year subfolders.

### Permissions Check (Microsoft Graph)
Current scopes likely cover `Mail.Send`. Phase 2 needs:
- `Mail.Read` or `Mail.ReadWrite` (to read + mark as processed)
- `Files.ReadWrite` (OneDrive file upload + folder creation)

### Risks
| Risk | Mitigation |
|------|------------|
| AI misclassifies document | Human-in-the-loop review (month 1 = mandatory) |
| Client sends from unknown email | Fallback: parse subject/body, then manual queue |
| Multi-doc PDFs | Flag for manual, don't attempt to split (v1) |
| Large attachments (>25MB) | Check Graph API limits, skip + notify if too large |
| Duplicate emails (client re-sends) | Keep both, flag as duplicate |
| MS Graph token expiry | Use refresh token pattern (already in place for send) |
| Non-document attachments (signatures, logos) | Filter by file type + size threshold |

## 4. Proposed Solution (The Blueprint)

### High-Level Architecture

```
Email arrives at reports@moshe-atsits.co.il
        ↓
[WF05] Email Trigger (IMAP or MS Graph webhook)
        ↓
Filter: has attachments? is not auto-reply/bounce?
        ↓
Identify Client (sender email → Airtable lookup → fallback: parse subject)
        ↓
  ┌─ Client found ──────────────────────┐
  │                                      │
  │  Get client's required doc list      │
  │  from Airtable (documents table)     │
  │        ↓                             │
  │  For each attachment:                │
  │    ├─ Extract text/image             │
  │    ├─ AI classifies against          │
  │    │   client's specific doc list    │
  │    ├─ Update Airtable status         │
  │    ├─ Upload to OneDrive             │
  │    └─ Log classification result      │
  │        ↓                             │
  │  Send review summary to Natan        │
  │  (email + dashboard link)            │
  │                                      │
  └─ Client NOT found ─────────────────→ Notify Natan (manual handling)
```

### Workflow: [05] Inbound Document Processing

**Trigger:** New email in `reports@` inbox (IMAP trigger or MS Graph notification)

**Phase 1 — Email Intake & Client Matching:**

| Step | Node Type | Action |
|------|-----------|--------|
| 1 | Trigger | New email detected |
| 2 | IF | Has attachments? (skip if no) |
| 3 | IF | Is auto-reply/bounce/newsletter? (skip if yes) |
| 4 | Code | Extract sender email, subject, body |
| 5 | Airtable Search | Find client by email address |
| 6 | IF | Client found? |
| 6a | Code (fallback) | Parse subject/body for name or ID → Airtable search |
| 6b | IF | Client found after fallback? |
| 6c | → Notify Natan | Unidentified sender → manual queue |

**Phase 2 — Document Classification (per attachment):**

| Step | Node Type | Action |
|------|-----------|--------|
| 7 | Split In Batches | Loop over attachments |
| 8 | IF | Filter out non-documents (tiny images, .html signatures, etc.) |
| 9 | Code | Extract text from PDF / prepare image for vision |
| 10 | Airtable Search | Get client's required documents (status != "Received") |
| 11 | AI Agent / HTTP | Send to LLM: "Given this document and this list of required docs, which one is it?" |
| 12 | Code | Parse AI response: matched_document_id, confidence, reasoning |
| 13 | IF | Confidence above threshold? |
| 13a | Airtable Update | Set document status → "Received" (or "Pending Review") |
| 13b | Airtable Update | Set document status → "Needs Manual Review" |
| 14 | MS Graph / HTTP | Upload file to OneDrive (client folder → year folder) |

**Phase 3 — Review & Notification:**

| Step | Node Type | Action |
|------|-----------|--------|
| 15 | Code | Build review summary (what was classified, confidence levels) |
| 16 | MS Graph | Email Natan: summary + link to dashboard intake tab |
| 17 | Airtable Update | Update report completion % |
| 18 | Code | Mark email as processed (move to folder or flag) |

### AI Classification Prompt (Draft)

```
You are a document classifier for a CPA firm's tax document collection system.

CLIENT: {client_name}
YEAR: {year}

The client needs to submit these documents (not yet received):
{list of required documents with IDs and Hebrew titles}

You received the following document:
- Filename: {filename}
- Content: {extracted_text_or_image}

TASK:
1. Identify which document from the required list this matches.
2. Return JSON: { "document_id": "...", "confidence": 0.0-1.0, "reasoning": "..." }
3. If it doesn't match any required document, return { "document_id": null, "confidence": 0, "reasoning": "..." }
4. If the file contains MULTIPLE document types, return { "document_id": "MULTI_DOC", "confidence": 0, "reasoning": "describe what you see" }
```

### Airtable Schema — Existing Fields We'll Use

**`documents` table — already exists (no changes needed):**

| Field | Type | Phase 2 Usage |
|-------|------|---------------|
| `file_url` | url | OneDrive link to filed document |
| `onedrive_item_id` | singleLineText | OneDrive item ID for API operations |
| `expected_filename` | singleLineText | For matching incoming files |
| `uploaded_at` | dateTime | When document was received/uploaded |
| `source_message_id` | singleLineText | MS Graph email message ID |
| `source_internet_message_id` | singleLineText | Internet message ID (cross-reference) |
| `source_attachment_name` | singleLineText | Original attachment filename |
| `source_sender_email` | email | Sender's email address |
| `ai_confidence` | number | AI classification confidence (0-1) |
| `ai_reason` | multilineText | AI's explanation for the match |
| `file_hash` | singleLineText | For duplicate detection |
| `bookkeepers_notes` | multilineText | Natan's notes on the document |
| `status` | singleSelect | Existing status field (will use for received/pending) |

**`documents` table — new fields needed:**

| Field | Type | Purpose |
|-------|------|---------|
| `review_status` | singleSelect | `pending_review`, `confirmed`, `rejected`, `manual` |
| `reviewed_by` | singleLineText | Who confirmed (e.g., "natan") |
| `reviewed_at` | dateTime | When review happened |

**`annual_reports` table — new field:**

| Field | Type | Purpose |
|-------|------|---------|
| `onedrive_folder_id` | singleLineText | Client's year-specific OneDrive folder ID |

### OneDrive Folder Structure

```
Root Folder (ID provided by user)
├── {client_name} - {client_id}/
│   ├── 2025/
│   │   ├── טופס 106 - Intel.pdf
│   │   ├── טופס 867 - בנק הפועלים.pdf
│   │   └── ...
│   └── 2026/
├── {another_client}/
│   └── 2025/
```

### Admin Dashboard — "Document Intake" Tab

New tab showing all recently received documents pending review:

| Column | Source |
|--------|--------|
| Client Name | Airtable → clients |
| Document Matched | AI classification result |
| Confidence | ai_confidence (color coded: green >0.8, yellow 0.5-0.8, red <0.5) |
| AI Reasoning | ai_reasoning (expandable) |
| Original Filename | original_filename |
| Received | received_at (relative time) |
| Actions | Confirm / Reject / Reassign / View File |

**Confirm:** Sets `review_status = confirmed`, keeps the AI match.
**Reject:** Sets `review_status = rejected`, reverts document status, prompts to pick correct doc.
**Reassign:** Dropdown to pick the correct document type manually.
**View File:** Opens OneDrive link.

### Email Notification to Natan

Short summary email triggered after each email is processed:

```
Subject: מסמך חדש התקבל - {client_name}

{N} קבצים התקבלו מ{client_name} ({sender_email})

סיווג אוטומטי:
✅ טופס 106 - Intel (ביטחון: 95%)
⚠️ מסמך לא מזוהה - scan003.jpg (ביטחון: 30%)

[לבדיקה בלוח הבקרה →]
```

## 5. Implementation Plan (Phases)

### Phase 2a — Core Pipeline (MVP)
- [ ] Verify MS Graph permissions (Mail.Read, Files.ReadWrite)
- [ ] Build WF05: email trigger → client matching → AI classification → Airtable update
- [ ] Add new fields to `documents` table
- [ ] Test with sample documents from Natan
- [ ] Email notification to Natan

### Phase 2b — OneDrive Filing
- [ ] Build folder creation logic (client folder → year folder)
- [ ] File upload via MS Graph
- [ ] Store `file_url` and `onedrive_folder_id` in Airtable

### Phase 2c — Admin Dashboard Intake Tab
- [ ] New tab in admin dashboard
- [ ] Confirm / Reject / Reassign actions
- [ ] API endpoints for review actions

### Phase 2d — Hardening
- [ ] Duplicate detection (same file sent twice → flag)
- [ ] Non-document attachment filtering (signatures, logos, tiny images)
- [ ] Error handling: large files, corrupted PDFs, unsupported formats
- [ ] Completion % auto-update after confirmations

## 6. Open Questions (Waiting for Natan's Answers)

- [ ] Which email address do clients send docs to? (assumed: reports@)
- [ ] How do clients identify themselves in emails?
- [ ] Existing OneDrive folder structure?
- [ ] Common file formats (PDF, images, etc.)?

### Resolved
- [x] Root OneDrive folder — SharePoint link provided:
  `https://mosheatsits-my.sharepoint.com/:f:/g/personal/reports_moshe-atsits_co_il/IgCcHEXSjYIjTpykurw6ro8CAWMVgLeh-eG_hQEb29YxnEo?e=fTc9yC`
  (Will resolve to drive ID + folder ID via MS Graph `/shares/` endpoint at implementation time)

## 7. Implementation Notes (Post-Code)
*To be filled during implementation.*
