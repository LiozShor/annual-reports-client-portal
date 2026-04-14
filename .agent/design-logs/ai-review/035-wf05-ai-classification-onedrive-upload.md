# Design Log 035: WF05 — AI Classification + OneDrive Upload
**Status:** [COMPLETED]
**Date:** 2026-02-17
**Related Logs:** 034 (Phase 2 overview), 027 (Document Service)

## 1. Context & Problem

WF05 (`cIa23K8v1PrbDJqY`) currently receives email notifications via MS Graph webhook, fetches the email + attachments, identifies the client, finds their active report, and retrieves required documents. But the pipeline has two placeholder areas:

1. **Classification** — The "Classify & Build Summary" node is a placeholder that doesn't actually classify documents. It just builds a notification saying "AI classification not yet active."

2. **OneDrive filing** — No file upload exists yet. Documents should be automatically filed to the correct client folder.

**This design log covers adding both capabilities to WF05.**

## 2. User Requirements (Discovery Q&A)

1. **Q:** GPT-4o or GPT-4o-mini for classification?
   **A:** Start with cheaper (GPT-4o-mini). ~$0.61 for 5,000 docs.

2. **Q:** What if client has no required documents in the system?
   **A:** Still notify Natan that docs were received but client doesn't need any. Save the files to OneDrive anyway.

3. **Q:** OneDrive folder name — Hebrew name or client_id + name?
   **A:** Hebrew name only (e.g., `Client Name`).

4. **Q:** Auto-mark as "Received" or wait for Natan's review?
   **A:** Set `review_status = pending_review`. Don't change document `status` until Natan confirms.

5. **Q:** Multiple attachments — batch or separate?
   **A:** Classify each attachment independently.

6. **Q:** OpenAI credential in n8n — how?
   **A:** User will create `openAiApi` credential manually in n8n. Workflow uses HTTP Request node with predefined credential type.

## 3. Technical Constraints & Risks

### Dependencies
- **OpenAI API** — GPT-4o-mini via `POST /v1/chat/completions`
- **MS Graph API** — OneDrive file upload via `PUT /drives/{driveId}/items/{folderId}:/{path}:/content`
- **Airtable** — `documents` table (update classification fields), `documents_templates` table (for prompt context)
- **OneDrive sharing token** — `u!aHR0cHM6Ly9tb3NoZWF0c2l0cy1teS5zaGFyZXBvaW50LmNvbS86ZjovZy9wZXJzb25hbC9yZXBvcnRzX21vc2hlLWF0c2l0c19jb19pbC9JZ0NjSEVYU2pZSWpUcHlrdXJ3NnJvOENBV01WZ0xlaC1lR19oUUViMjlZeG5Fbz9lPWZUYzl5Qw`

### Risks
| Risk | Mitigation |
|------|------------|
| AI misclassifies document | `review_status = pending_review` — Natan always reviews first |
| OpenAI rate limit (429) | HTTP Request node retry on fail (3 retries, 2s wait) |
| OneDrive folder creation fails | `conflictBehavior: replace` is idempotent — safe to retry |
| Hebrew encoding in OneDrive paths | `encodeURIComponent()` per path segment |
| Client has no required docs | Special flow: save to OneDrive + notify Natan, skip classification |
| Large attachments (>250MB) | Skip + flag. Simple PUT supports up to 250MB. |
| n8n credential scoping for OpenAI | User creates credential manually in n8n UI (ID: GblC7h2qWERAuXuN) |
| LLM confidence is uncalibrated | 0.7 threshold is a starting heuristic. Month 1: all docs go to human review. Calibrate with ~200 labeled docs. |
| Tier 2 token explosion on scanned/multi-page PDFs | Log pages, file size, token usage per doc. Set hard token limit in API call. |
| OneDrive folder name with reserved chars | Sanitize client names before path encoding (strip `/ \ * < > ? : | # %`) |

## 4. Proposed Solution (The Blueprint)

### Architecture Overview

```
[Existing WF05 pipeline up to Get Required Docs]
        ↓
  ┌─ Has required docs? ──────────────┐
  │                                    │
 YES                                  NO
  │                                    │
  │  For each attachment:             Save all attachments to:
  │    ├─ Tier 1: Classify by         {client}/2025/מסמכים שלא זוהו/
  │    │   metadata (filename +       Notify Natan: "client sent docs
  │    │   email body)                 but has no required doc list"
  │    ├─ If confidence < 0.7:
  │    │   Tier 2: Send PDF to
  │    │   OpenAI for deep classify
  │    ├─ Update Airtable
  │    │   (ai_confidence, ai_reason,
  │    │   review_status)
  │    └─ Upload to OneDrive
  │        ├─ Identified → מסמכים שזוהו
  │        └─ Unidentified → מסמכים שלא זוהו
  │
  └─ Build review summary email ──→ Email Natan
```

### New/Modified Nodes in WF05

**REMOVE:** "Classify & Build Summary" (placeholder) — replaced by the nodes below.

**ADD (in order after Get Required Docs):**

| # | Node Name | Type | Purpose |
|---|-----------|------|---------|
| 1 | Resolve OneDrive Root | HTTP Request | `GET /shares/{token}/driveItem` → extract driveId + rootFolderId (run once) |
| 2 | Classify Documents | Code | Loop over attachments, call OpenAI per attachment, match to required docs |
| 3 | OpenAI Classify | HTTP Request | `POST /v1/chat/completions` with structured output |
| 4 | Process Classification | Code | Parse OpenAI response, match template_id → document record, build results array |
| 5 | Upload to OneDrive | HTTP Request | `PUT /drives/{driveId}/items/{folderId}:/{path}:/content` per file |
| 6 | Update Airtable | HTTP Request / Airtable | Update document records with classification + file URL |
| 7 | Build Summary & Email | Code + HTTP | Build Hebrew review email, send to Natan |

### Detailed Node Specifications

#### Node 1: Resolve OneDrive Root

```
HTTP Request — GET
URL: https://graph.microsoft.com/v1.0/shares/u!aHR0cHM6Ly9tb3NoZWF0c2l0cy1teS5zaGFyZXBvaW50LmNvbS86ZjovZy9wZXJzb25hbC9yZXBvcnRzX21vc2hlLWF0c2l0c19jb19pbC9JZ0NjSEVYU2pZSWpUcHlrdXJ3NnJvOENBV01WZ0xlaC1lR19oUUViMjlZeG5Fbz9lPWZUYzl5Qw/driveItem
Auth: MS Graph OAuth2 (predefined credential)
Output: { id: rootFolderId, parentReference: { driveId: "..." } }
```

#### Node 2+3+4: Classification Pipeline (Code + HTTP Request)

**Approach:** Single Code node that prepares the OpenAI request for each attachment. Then HTTP Request node calls OpenAI. Then another Code node processes results.

**Simplified approach for v1:** Use a single large Code node that:
1. Reads attachments from Process & Filter Attachments
2. Reads required docs from Get Required Docs
3. Reads client + report data
4. For each attachment: builds the OpenAI prompt, calls via `$helpers.httpRequest`, parses result
5. Outputs classification results array

**However**, n8n Cloud Code nodes can't use `$helpers.httpRequest` with predefined credentials for OpenAI. So we need the HTTP Request node for the actual API call.

**Practical approach — Split In Batches pattern:**

```
Process & Filter Attachments
  → Prepare Classification (Code — builds prompt per attachment)
  → Split In Batches (loop over attachments)
    → OpenAI Classify (HTTP Request — POST to chat/completions)
    → Process Result (Code — parse response, match to doc)
    → Upload to OneDrive (HTTP Request — PUT file)
    → Update Airtable Doc (Airtable — update document record)
  → Build Summary (Code — aggregate all results)
  → Email Natan (HTTP Request — MS Graph sendMail)
```

Wait — Split In Batches adds complexity. Since most emails have 1-3 attachments, a simpler approach:

**Simplest approach — Code node does everything:**

A single Code node after "Get Required Docs" that:
1. Gets all data from upstream nodes
2. Loops over attachments internally
3. For each: calls OpenAI via `$helpers.httpRequest()` (using raw API key from workflow static data or a Set node)
4. Matches results to required docs
5. Calls OneDrive upload via `$helpers.httpRequest()` (using MS Graph token — but can't easily get OAuth token in Code node)

**Problem:** We need OAuth tokens for both OpenAI and MS Graph, and Code nodes on n8n Cloud can't easily access credential tokens.

**Final approach — Prepare + Loop with HTTP nodes:**

```
[Get Required Docs]
  → [Resolve OneDrive Root] (HTTP — MS Graph)
  → [Prepare Attachments Loop] (Code — one output item per attachment with all context)
  → [OpenAI Classify] (HTTP — runs once per item/attachment)
  → [Determine OneDrive Path] (Code — set upload path based on classification)
  → [Upload to OneDrive] (HTTP — MS Graph PUT, runs per item)
  → [Update Airtable] (Airtable node — update document record)
  → [Build & Send Summary] (Code + HTTP — aggregate results, email Natan)
```

This is clean: each HTTP node handles one API call per attachment, n8n loops automatically.

#### Node: Prepare Attachments Loop (Code)

```javascript
// Input: one item from Process & Filter Attachments (with all attachments in .attachments array)
// Plus: required docs, client data, report data, OneDrive root
// Output: one item PER attachment with full classification context

const emailData = $('Process & Filter Attachments').first().json;
const clientData = $('Search Client by Email').first().json;
const reportData = $('Get Active Report').first().json;
const requiredDocs = $('Get Required Docs').all().map(i => i.json);
const onedrive = $('Resolve OneDrive Root').first().json;

const clientName = clientData.name;  // Hebrew name
const year = String(reportData.year);
const driveId = onedrive.parentReference.driveId;
const rootFolderId = onedrive.id;

const attachments = emailData.attachments || [];
const items = [];

for (const att of attachments) {
  // Build required docs context for prompt
  const docsContext = requiredDocs.length > 0
    ? requiredDocs.map(d => `- ${d.template_id}: ${d.document_title}`).join('\n')
    : 'אין מסמכים נדרשים עבור לקוח זה';

  items.push({
    json: {
      // Attachment data
      attachment_name: att.name,
      attachment_content_type: att.content_type,
      attachment_size: att.size,
      attachment_content_bytes: att.content_bytes,

      // Email context
      email_subject: emailData.subject,
      email_body_preview: emailData.body_preview,
      sender_email: emailData.sender_email,
      sender_name: emailData.sender_name,
      email_id: emailData.email_id,
      internet_message_id: emailData.internet_message_id,
      received_at: emailData.received_at,

      // Client/report context
      client_name: clientName,
      client_id: clientData.client_id,
      report_key: reportData.report_key,
      year: year,
      has_required_docs: requiredDocs.length > 0,
      required_docs_context: docsContext,
      required_docs: requiredDocs,

      // OneDrive context
      drive_id: driveId,
      root_folder_id: rootFolderId
    }
  });
}

return items;
```

#### Node: OpenAI Classify (HTTP Request)

```
Method: POST
URL: https://api.openai.com/v1/chat/completions
Auth: Predefined Credential → OpenAI API
Body Content Type: JSON
Body (Using Fields Below):
  model: "gpt-4o-mini"
  temperature: 0
  max_completion_tokens: 300
  messages: [expression — built from $json fields]
  response_format: { type: "json_schema", json_schema: {...} }
```

**Note:** The messages array and response_format need to be constructed as JSON. Since "Using Fields Below" doesn't support complex nested structures easily, we'll use "Using JSON" with careful escaping, or build the full body in the Prepare node and just reference `{{ $json.openai_request_body }}`.

**Better approach:** Have the Prepare node output `openai_request_body` as a pre-built JSON string, then the HTTP Request node just sends it as raw JSON body.

#### Node: Determine OneDrive Path (Code)

```javascript
const input = $json;
const classification = JSON.parse(
  $('OpenAI Classify').first().json.choices[0].message.content
);

const isIdentified = classification.matched_template_id !== null
  && classification.confidence >= 0.5;

const subfolder = isIdentified ? 'מסמכים שזוהו' : 'מסמכים שלא זוהו';

// Build path: clientName/year/subfolder/filename
const pathSegments = [
  input.client_name,
  input.year,
  subfolder,
  input.attachment_name
].map(s => encodeURIComponent(s));

const uploadPath = pathSegments.join('/');

return [{
  json: {
    ...input,
    classification,
    is_identified: isIdentified,
    subfolder,
    upload_url: `https://graph.microsoft.com/v1.0/drives/${input.drive_id}/items/${input.root_folder_id}:/${uploadPath}:/content`,
    // For Airtable update
    matched_template_id: classification.matched_template_id,
    ai_confidence: classification.confidence,
    ai_reason: classification.reasoning,
    issuer_name: classification.issuer_name
  }
}];
```

#### Node: Upload to OneDrive (HTTP Request)

```
Method: PUT
URL: {{ $json.upload_url }}
Auth: MS Graph OAuth2 (predefined credential)
Content Type: application/octet-stream
Body: Binary — decoded from $json.attachment_content_bytes
```

**Challenge:** HTTP Request node needs binary body, but we have base64 string. Options:
- Use "Send Binary File" option if the data is in n8n binary format
- Or use a Code node before upload to convert base64 → binary and set it as n8n binary data

**Pre-upload Code node (Convert to Binary):**
```javascript
const item = $input.first();
const binaryData = Buffer.from(item.json.attachment_content_bytes, 'base64');

return [{
  json: item.json,
  binary: {
    file: {
      data: binaryData.toString('base64'),
      mimeType: item.json.attachment_content_type,
      fileName: item.json.attachment_name
    }
  }
}];
```

Then the HTTP Request node uses "Send Binary File: true" with input field "file".

#### Node: Update Airtable (conditional)

Only update if:
- Client has required docs AND a match was found

```
If matched_template_id is not null:
  Find the document record in required_docs where template_id matches
  Update that record:
    - ai_confidence = classification.confidence
    - ai_reason = classification.reasoning
    - review_status = "pending_review"
    - source_attachment_name = attachment_name
    - source_sender_email = sender_email
    - source_message_id = email_id
    - source_internet_message_id = internet_message_id
    - file_url = OneDrive webUrl (from upload response)
    - onedrive_item_id = upload response id
    - uploaded_at = now
```

#### Node: Build & Send Summary (Code)

Aggregates all classification results and builds a Hebrew email to Natan:

```
Subject: מסמך חדש התקבל - {client_name}

{N} קבצים התקבלו מ{client_name} ({sender_email})

סיווג אוטומטי:
✅ טופס 106 — Intel (ביטחון: 95%) → מסמכים שזוהו
⚠️ scan003.jpg — לא זוהה (ביטחון: 20%) → מסמכים שלא זוהו

[לבדיקה בלוח הבקרה →]
```

If client has no required docs:
```
Subject: מסמך התקבל מלקוח ללא רשימת מסמכים - {client_name}

{N} קבצים התקבלו מ{client_name} ({sender_email})
ללקוח זה אין רשימת מסמכים נדרשים במערכת.
הקבצים הועלו ל-OneDrive בתיקייה: {client_name}/{year}/מסמכים שלא זוהו
```

### OpenAI Classification Prompt

```
System prompt (English):

You are a document classifier for an Israeli CPA firm's tax document collection system.

Given an email attachment's filename, email subject, and email body — identify which document type this is from the client's required documents list.

The client's required documents (not yet received):
{required_docs_context}

Rules:
- Return matched_template_id from the list above ONLY. If the document doesn't match any, return null.
- Extract the issuer/employer/bank name from the filename or email body into issuer_name. Return null if not visible.
- Set needs_pdf_fallback to true if you cannot classify confidently from metadata alone and believe reading the actual PDF content would help.
- Evidence field: cite ONLY the specific filename/email cues that led to your classification (1-2 sentences max, no reasoning chain).
- Do NOT guess. If confidence is below 0.5, return null for matched_template_id.

Special patterns:
- Pension/provident fund redemption notices ("הודעה על תשלום פדיון") → classify as the relevant pension/savings template (T501).
- Multi-account annual report bundles (one PDF with reports for multiple accounts from same institution) → classify as T501, use the institution name as issuer.
- Donation receipt bundles (קבלות על תרומה, Section 46) → classify as T1301.
- Non-tax documents (degree certificates, personal letters, etc.) → return null.
- Non-PDF files (DOCX, XLSX, images) → classify from filename/email metadata only. Set needs_pdf_fallback=false.

User prompt:

Filename: {attachment_name}
Email subject: {email_subject}
Email body: {email_body_preview}
Sender: {sender_name} ({sender_email})
```

### JSON Schema for OpenAI Response

**Key improvements from review:**
- `matched_template_id` is an **enum** of the 33 template IDs + null (prevents typos like "T2011")
- `needs_pdf_fallback` added — model decides if Tier 2 is needed
- `evidence` replaces `reasoning` — evidence-only, no step-by-step rambling

```json
{
  "name": "classification_result",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "matched_template_id": {
        "type": ["string", "null"],
        "enum": [null, "T001", "T002", "T003", "T101", "T102", "T201", "T202",
                 "T301", "T302", "T303", "T304", "T305", "T306",
                 "T401", "T402", "T501", "T601", "T701", "T801",
                 "T901", "T902", "T1001", "T1101", "T1102",
                 "T1201", "T1301", "T1401", "T1402", "T1403",
                 "T1501", "T1601", "T1602", "T1701"],
        "description": "Template ID from the required docs list, or null if unknown"
      },
      "confidence": {
        "type": "number",
        "description": "0.0 to 1.0 — NOTE: uncalibrated heuristic, not a probability"
      },
      "needs_pdf_fallback": {
        "type": "boolean",
        "description": "true if metadata alone is insufficient and reading the PDF would help"
      },
      "issuer_name": {
        "type": ["string", "null"],
        "description": "Extracted employer/bank/institution name, or null"
      },
      "evidence": {
        "type": "string",
        "description": "1-2 sentences citing specific filename/email cues only"
      }
    },
    "required": ["matched_template_id", "confidence", "needs_pdf_fallback", "issuer_name", "evidence"],
    "additionalProperties": false
  }
}
```

### OneDrive Folder Structure

```
Root (shared folder)
├── Client Name/
│   └── 2025/
│       ├── מסמכים שזוהו/
│       │   ├── טופס 106 - Intel.pdf
│       │   └── טופס 867 - בנק הפועלים.pdf
│       └── מסמכים שלא זוהו/
│           └── scan003.jpg
├── משה כהן/
│   └── 2025/
│       └── ...
```

Path-based upload auto-creates intermediate folders. One PUT per file.

**Folder name sanitization:** Before `encodeURIComponent()`, strip OneDrive-reserved characters (`/ \ * < > ? : | # %`) and trailing periods from client names. Example:
```javascript
function sanitizeFolderName(name) {
  return name.replace(/[\/\\*<>?:|#%]/g, '').replace(/\.+$/, '').trim();
}
```

## 5. Evaluation Plan (Calibration)

### Why This Matters
LLM confidence scores are uncalibrated — a model saying "0.92" is a heuristic, not a probability. The 0.7 threshold is a starting guess that MUST be validated with real data.

### Phase 1: Collect Labeled Data (Month 1)
- **All classifications go to human review** (`review_status = pending_review`)
- Natan confirms or rejects each classification
- System logs: `matched_template_id`, `confidence`, `needs_pdf_fallback`, `evidence`, and Natan's decision
- Target: ~200 labeled documents minimum

### Phase 2: Compute Metrics
- For each confidence threshold (0.5, 0.6, 0.7, 0.8, 0.9):
  - **Precision**: % of auto-classified docs that were correct
  - **Recall**: % of classifiable docs that were auto-classified
  - **Misroute rate**: % sent to wrong folder
- Pick threshold that meets tolerance (e.g., <5% misroute rate)

### Phase 3: Tune & Automate
- Set the calibrated threshold for auto-classification
- Reduce human review to only below-threshold docs
- Monitor weekly: track misclassification rate, add to dashboard

### Error Categories to Track
| Category | Example | Action |
|----------|---------|--------|
| Correct match | T201 → confirmed Form 106 | Auto-classify after calibration |
| Wrong match | T201 → was actually T601 | Improve prompt, lower threshold |
| Missed match | null → was actually T201 | Add filename patterns to prompt |
| False PDF fallback | needs_pdf_fallback=true but metadata was enough | Tune prompt |

### Telemetry (Log Per Classification)
```javascript
{
  email_id, attachment_name, attachment_size, attachment_pages,
  matched_template_id, confidence, needs_pdf_fallback,
  tier_used: "metadata" | "pdf",
  token_usage: { prompt_tokens, completion_tokens },
  review_decision: "confirmed" | "rejected" | "reassigned",
  processing_time_ms
}
```

## 6. Implementation Plan

### Step 1: OpenAI Credential
- [ ] User creates `openAiApi` credential in n8n UI (paste API key)
- [ ] Verify with a test HTTP Request

### Step 2: OneDrive Root Resolution
- [ ] Add "Resolve OneDrive Root" HTTP node
- [ ] Test: verify driveId + rootFolderId are returned

### Step 3: Classification Pipeline
- [ ] Replace "Classify & Build Summary" with new nodes
- [ ] Add "Prepare Attachments Loop" Code node
- [ ] Add "OpenAI Classify" HTTP Request node
- [ ] Add "Determine OneDrive Path" Code node
- [ ] Test with test email

### Step 4: OneDrive Upload
- [ ] Add "Convert to Binary" Code node
- [ ] Add "Upload to OneDrive" HTTP Request node
- [ ] Test: verify file appears in correct folder

### Step 5: Airtable Updates
- [ ] Add conditional Airtable update for matched documents
- [ ] Test: verify ai_confidence, ai_reason, review_status fields update

### Step 6: Summary Email
- [ ] Add summary email builder
- [ ] Test: verify Natan receives proper notification

### Step 7: Edge Cases
- [ ] Test with client that has no required docs
- [ ] Test with multiple attachments in one email
- [ ] Test with unrecognized document (should go to מסמכים שלא זוהו)

## 7. Validation Plan

- [ ] Send email with test-form-106.pdf → should classify as T201 with high confidence
- [ ] Verify file appears in OneDrive: `Client Name/2025/מסמכים שזוהו/test-form-106.pdf`
- [ ] Verify Airtable document record updated with ai_confidence, review_status
- [ ] Verify Natan gets email with classification summary
- [ ] Send email with generic "scan.pdf" → should go to מסמכים שלא זוהו
- [ ] Send email from unknown sender → should trigger "client not found" notification

## 8. Sample Document Analysis (20 Real Documents)

**Date:** 2026-02-17
**Source:** `docs/Samples/` — 20 documents gathered by Natan from real client submissions

### Document Breakdown

| Category | Count | Examples | Classification Strategy |
|----------|-------|---------|------------------------|
| Machine-generated PDF (text extractable) | 12 | doc01, 05-07, 08-11, 15-18, 19 | Tier 1 (metadata) likely sufficient |
| Scanned/image PDF (no text) | 3 | doc04, doc12, (parts of doc20) | Tier 2 (native PDF to OpenAI) |
| Garbled Hebrew text | 2 | doc02, doc03 | Tier 2 preferred |
| Non-PDF formats | 2 | doc13 (DOCX), doc14 (XLSX) | Human review (v1) |
| Mixed (scanned + text) | 1 | doc20 (donation receipts) | Tier 2 preferred |

### Key Pattern: Scanned Ratio ~15-20% (NOT 40-50%)

Initial PyPDF2 analysis was misleading — most "failed" PDFs are machine-generated financial institution PDFs with clean text. Only truly scanned documents (CamScanner, physical scans) need vision. Tier 1 + Tier 2 covers ~95% of cases.

### Template Coverage from Samples

| Template | Count | Documents |
|----------|-------|-----------|
| T201 (Form 106) | 1 | doc01 |
| T401 (Form 867) | 2 | doc02, doc03 |
| T501 (Annual pension/savings) | 7 | doc05-07, doc09, doc15-17, doc18 |
| T001 (Residency cert) | 1 | doc08 |
| T304 (NII maternity) | 1 | doc19 |
| T1301 (Donation receipts) | 1 | doc20 (9 pages, 6 charities) |
| T1601/T1602 (Foreign income) | 2 | doc10, doc11 |
| No match (non-tax) | 1 | doc04 (degree certificate) |
| Unknown | 2 | doc12, doc13 |
| T1001 (Inventory) | 1 | doc14 (XLSX) |

### New Patterns Discovered

1. **Pension redemption notices** (doc05-07): "הודעה על תשלום פדיון" from Migdal — withdrawal notices with tax withholding (ניכוי מס במקור). Related to T501 but technically a different sub-document. AI should classify as T501 since the CPA needs these for pension/savings category.

2. **Multi-account bundled PDFs** (doc16 — 15 pages): Single PDF containing annual reports for 8+ accounts across pension, gemel, hishtalmut, gemel lehashkaa — all from Altshuler Shaham for one person. Classify entire PDF as T501 with issuer "Altshuler Shaham."

3. **Donation receipt bundles** (doc20 — 9 pages, 6 charities): Multiple receipts per Section 46 in one PDF. All for "Adriano Jauvel." Classify as T1301.

4. **Non-tax documents** (doc04 — HIT degree certificate): Validates the null classification path. AI must return null with high confidence.

5. **Non-PDF formats** (doc13 DOCX, doc14 XLSX): Rare. For v1, classify from filename/email metadata only. If unrecognizable, flag for human review.

### Design Adjustments Based on Samples

1. **System prompt update:** Add guidance for pension redemption notices → classify as T501
2. **System prompt update:** Add guidance for multi-account PDFs → classify once, identify primary product type
3. **System prompt update:** Add guidance for donation receipt bundles → classify as T1301
4. **Non-PDF handling:** Add pre-check in Prepare node — if content_type is not PDF, skip Tier 2 fallback and classify from metadata only
5. **File size context:** Add file size and content_type to the classification prompt as additional signals

## 9. Implementation Notes (Post-Code)

**Date:** 2026-02-17
**Implemented by:** Claude Code session

### What Was Built

Replaced the "Classify & Build Summary" placeholder with 6 new nodes in WF05 (`cIa23K8v1PrbDJqY`):

| # | Node Name | Type | Purpose |
|---|-----------|------|---------|
| 1 | Resolve OneDrive Root | HTTP Request | GET /shares/{token}/driveItem → driveId + rootFolderId |
| 2 | Prepare Attachments | Code | Splits attachments into N items, builds OpenAI request body per attachment |
| 3 | OpenAI Classify | HTTP Request | POST /v1/chat/completions with structured JSON schema output |
| 4 | Process and Prepare Upload | Code | Parses classification, determines OneDrive path, creates binary data |
| 5 | Upload to OneDrive | HTTP Request | PUT binary file to path-based URL (auto-creates folders) |
| 6 | Build Summary | Code | Aggregates all results into Hebrew notification email for Natan |

**Final pipeline:** Get Required Docs → Resolve OneDrive Root → Prepare Attachments → OpenAI Classify → Process and Prepare Upload → Upload to OneDrive → Build Summary → Email Natan

**Total nodes:** 20 (was 15, removed 1, added 6)

### Design Decisions Made During Implementation

1. **HTTP Request for OpenAI (not built-in node):** Need strict JSON schema with enum constraint on template IDs (33 + null) to prevent hallucinated IDs. Built-in node doesn't support full `response_format: { type: "json_schema" }` with enum arrays.

2. **Pre-built request body in Prepare node:** The OpenAI request body (including system prompt, user prompt, and JSON schema) is constructed in the Prepare Attachments Code node and passed as `openai_request_body`. The HTTP Request node just `JSON.stringify()`s it. This avoids complex expression construction in the HTTP node.

3. **Index-based matching for upstream data:** Process and Prepare Upload uses `$('Prepare Attachments').all()` to get original context and `$input.all()` (from OpenAI Classify) for responses. Items are matched by array index since n8n preserves ordering.

4. **Binary data via Code node:** The Process and Prepare Upload Code node converts base64 `attachment_content_bytes` to n8n binary format (`binary.file`). The Upload to OneDrive HTTP Request uses `contentType: "binaryData"` with `inputDataFieldName: "file"`.

5. **Conflict behavior:** OneDrive upload URL includes `?@microsoft.graph.conflictBehavior=rename` to avoid overwriting duplicate filenames.

6. **Node name "and" vs "&":** Used "Process and Prepare Upload" (word "and") instead of "&" (ampersand) to avoid encoding issues in n8n MCP tools. All `$()` references match accordingly.

### Implemented (Session 12 — 2026-02-17)

**5 improvement batches applied via n8n MCP (`n8n_update_partial_workflow`):**

| Batch | Description | Nodes Changed |
|-------|-------------|---------------|
| 1 | Remove hardcoded `year=2025` — use dynamic `new Date().getFullYear()-1` | Get Active Report, Prepare Attachments, Build Summary |
| 2 | Airtable document status updates — write `review_status=pending_review`, `ai_confidence`, `file_url`, etc. (NOT `status`) | +Prep Doc Update, +IF Has Match, +Update Document Record |
| 3 | `email_events` audit trail — create event at start ("Detected"), update at end ("Completed") | +Create Email Event, +Update Email Event |
| 4 | SHA-256 file hash for duplicate detection — `file_hash` written to Airtable | Process and Prepare Upload (updated) |
| 5 | Tier 2 PDF fallback stub — if `needs_pdf_fallback && confidence < 0.7`, route to unidentified | Process and Prepare Upload (updated) |

**Final node count:** 25 (was 20). All validated, workflow reactivated.

### Not Yet Implemented (Deferred)

- **Full Tier 2 PDF vision pipeline:** When enough docs need PDF vision (>10% after calibration with ~200 docs), add Claude Sonnet 4.5 via Anthropic API as true Tier 2.
- **Calibration infrastructure:** Telemetry logging (token usage, processing time) not implemented yet. Phase 2 of the evaluation plan.
- **Completion % auto-update:** When `review_status` is confirmed by Natan, auto-advance `status` to `Received` and recalc completion %.
- **Admin UI for review:** UI surface for Natan to confirm/reject AI classifications (currently email-only).

### Credentials Used

| Service | Credential ID | Name |
|---------|--------------|------|
| OpenAI API | GblC7h2qWERAuXuN | OpenAI API |
| MS Graph OAuth2 | GcLQZwzH2xj41sV7 | MS_Graph_CPA_Automation |
| Airtable | ODW07LgvsPQySQxh | Airtable Personal Access Token account |
