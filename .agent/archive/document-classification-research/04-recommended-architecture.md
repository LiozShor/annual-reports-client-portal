# 04 - Recommended Architecture

## System Design: Document Classification Pipeline

### Architecture Overview

```
Client Email (with attachments)
       │
       ▼
┌──────────────────┐
│  n8n Trigger      │  Microsoft Graph API - email webhook
│  (Inbound Email)  │  Extracts attachments + sender info
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Pre-Processing   │  1. Format detection (PDF/DOCX/XLSX/image)
│  (n8n Code node)  │  2. Convert non-PDF → PDF (LibreOffice headless)
│                   │  3. Page count check
│                   │  4. Image quality check for scanned docs
└──────┬───────────┘
       │
       ▼
┌──────────────────────────────────────────┐
│  Classification + Extraction              │
│  (Claude Sonnet 4.5 via HTTP Request)     │
│                                           │
│  Input: PDF/image + SSOT classification   │
│         schema + client context            │
│                                           │
│  Output: Structured JSON                  │
│  {                                        │
│    document_type: "T201",                 │
│    document_type_name: "טופס 106",        │
│    confidence: 0.95,                      │
│    person_name: "לולו קורל",              │
│    person_id: "318599545",                │
│    institution: "עיריית תל אביב - יפו",  │
│    tax_year: 2024,                        │
│    is_spouse: false,                      │
│    key_amounts: {...},                    │
│    page_count: 2,                         │
│    contains_multiple_types: false,        │
│    rejection_reason: null                 │
│  }                                        │
└──────┬───────────────────────────────────┘
       │
       ▼
┌──────────────────┐
│  Confidence Gate  │  IF confidence >= 0.85 → Auto-process
│  (n8n IF node)    │  IF confidence 0.50-0.85 → Queue for review
│                   │  IF confidence < 0.50 → Flag as unrecognized
└──────┬───────────┘
       │
       ├── High confidence ──► Auto-match to Airtable documents
       │                       Update status → "Received"
       │                       File to OneDrive client folder
       │
       ├── Medium confidence ──► Add to review queue (Airtable)
       │                         Office staff reviews + confirms/corrects
       │
       └── Low confidence ──► Flag for manual processing
                              Notify staff via email
```

### Detailed Component Design

---

### Component 1: Email Trigger & Attachment Extraction

**n8n Node**: Microsoft Graph Trigger (or polling)

**Logic**:
- Monitor the reports@moshe-atsits.co.il inbox
- Extract all attachments from incoming emails
- Match sender email to client record in Airtable (clients table)
- If sender not recognized → queue for manual matching

**Client Matching Strategy**:
```
1. Exact email match (clients.email)
2. Domain match (for corporate emails)
3. Name matching from email body
4. Manual assignment fallback
```

---

### Component 2: Pre-Processing

**n8n Node**: Code node (JavaScript)

**Steps**:
1. **Format Detection**: Check file extension and MIME type
2. **Conversion**:
   - `.docx` → PDF via LibreOffice headless (or external conversion API)
   - `.xlsx` → PDF via LibreOffice headless
   - `.jpg/.png/.heic` → Pass directly as image
   - `.pdf` → Pass through (check if text-extractable or scanned)
3. **Page Count**: Extract page count for multi-page handling
4. **Size Check**: Reject files > 50MB, warn on > 20MB

**Scanned Document Detection**:
```javascript
// Heuristic: if PDF has very little extractable text relative to page count,
// it's likely scanned
const textLength = extractedText.length;
const pageCount = pdf.numPages;
const isScanned = (textLength / pageCount) < 100; // <100 chars/page = scanned
```

---

### Component 3: Classification & Extraction (Core)

**n8n Node**: HTTP Request to Anthropic API

**API Call**:
```
POST https://api.anthropic.com/v1/messages
```

**System Prompt** (classification schema):
```
You are a document classification system for an Israeli CPA firm.
Classify the attached document into one of the following types:

[Full SSOT template list with descriptions, inserted dynamically]

For each document, return a JSON object with:
- document_type: template ID (e.g., "T201")
- document_type_name: Hebrew name
- confidence: 0.0-1.0
- person_name: full name as it appears
- person_id: Israeli ID number (9 digits)
- institution: issuing institution name
- tax_year: the tax year the document covers
- is_spouse: boolean - is this a spouse's document?
- key_amounts: object with relevant financial amounts
- page_count: number of pages in the document
- contains_multiple_types: boolean - does this PDF contain multiple document types?
- sub_documents: array (if contains_multiple_types is true)
- rejection_reason: null if valid tax document, string if not relevant

If the document is NOT a tax-related document, set document_type to "REJECT"
and provide a rejection_reason.

IMPORTANT: Return ONLY the JSON object, no markdown formatting.
```

**Client Context Enhancement** (optional but recommended):
```
Additional context for this client:
- Client name: {name}
- Spouse name: {spouse_name}
- Expected documents: {list from Airtable documents table}
- Already received: {list of received document types}
```

**Multi-Page Strategy**:
- For PDFs ≤ 5 pages: Send entire PDF
- For PDFs 6-20 pages: Send entire PDF (Claude handles up to 100 pages)
- For PDFs > 20 pages: Send first 3 pages + last 2 pages, with note about total pages

**Handling Multiple Types in One PDF** (like doc16 with 15 pages):
- If `contains_multiple_types: true`, the response includes a `sub_documents` array
- Each sub-document gets its own classification
- n8n workflow creates separate document records in Airtable for each

---

### Component 4: Confidence Gate & Routing

**n8n Node**: IF node (branching)

**Thresholds**:
| Confidence | Action | Expected % of docs |
|-----------|--------|-------------------|
| ≥ 0.85 | Auto-process (no human review) | ~70% |
| 0.50 - 0.84 | Queue for quick human review | ~20% |
| < 0.50 | Flag for manual classification | ~10% |

**Auto-process path**:
1. Match `document_type` to client's documents in Airtable
2. Find the matching document record (by template_id + client + issuer)
3. Update status to "Received" (התקבל)
4. Upload file to OneDrive client folder
5. Update completion percentage

**Review queue path**:
1. Create a review record in Airtable (new table: `document_reviews`)
2. Include: file link, AI classification, confidence, extracted metadata
3. Staff opens review interface → confirms or corrects classification
4. On confirmation → same auto-process flow

---

### Component 5: Airtable Integration

**Document Matching Logic**:
```javascript
// Find the matching document record for this client
const match = documents.filter(doc =>
  doc.report_key === clientReport.report_key &&
  doc.template_id === classification.document_type &&
  (doc.issuer_name === classification.institution ||
   doc.issuer_name === null) // if no issuer specified, match by type only
);

if (match.length === 1) {
  // Exact match - update status
  updateDocument(match[0].id, { status: 'received' });
} else if (match.length > 1) {
  // Multiple matches - use institution name to disambiguate
  // e.g., multiple Form 867s from different banks
  const exactMatch = match.find(m =>
    normalize(m.issuer_name) === normalize(classification.institution)
  );
  if (exactMatch) updateDocument(exactMatch.id, { status: 'received' });
  else queueForReview();
} else {
  // No match - document wasn't in the expected list
  // Could be: (a) unexpected document, (b) misclassification
  queueForReview();
}
```

---

### Component 6: File Storage (OneDrive)

**Folder Structure**:
```
Client Reports/
└── {year}/
    └── {client_name} - {client_id}/
        ├── 01 - טופס 106 - עיריית תל אביב.pdf
        ├── 02 - טופס 867 - בנק לאומי.pdf
        ├── 03 - אישור הפקדות - אלטשולר שחם.pdf
        └── ...
```

**File Naming Convention**:
```
{sequential_number} - {document_type_name} - {institution_name}.{ext}
```

---

## Implementation Phases

### Phase 1: Proof of Concept (1-2 weeks)
- Set up Claude API integration in n8n
- Create classification prompt with SSOT schema
- Test on the 20 sample documents
- Measure accuracy and confidence distribution
- Estimate cost at scale

### Phase 2: Pipeline Integration (2-3 weeks)
- Build email trigger workflow
- Add pre-processing (format conversion)
- Implement confidence gate logic
- Build Airtable matching logic
- Create review queue interface

### Phase 3: Production & Tuning (2-4 weeks)
- Deploy with real client documents
- Monitor accuracy and adjust prompts
- Fine-tune confidence thresholds based on real data
- Add OneDrive filing automation
- Build reporting dashboard (docs received, pending, completion %)

### Phase 4: Optimization (ongoing)
- Analyze common misclassifications → improve prompts
- Consider prompt caching for repeated SSOT schema
- Evaluate batching for cost reduction
- Add duplicate detection (same document sent twice)

---

## Fallback & Error Handling

| Scenario | Handling |
|----------|---------|
| API timeout | Retry 2x with exponential backoff, then queue for manual |
| API error (rate limit) | Queue and retry after cooldown |
| Unrecognized document | Flag as "unknown", add to review queue |
| Non-tax document (REJECT) | Notify staff, don't add to document list |
| Multiple clients share email | Use email body / file name hints, or queue for manual matching |
| Duplicate document submitted | Detect by file hash or content similarity, skip if already received |
| Password-protected PDF | Flag as unreadable, request re-send |
| Corrupted file | Flag as unreadable, request re-send |

---

## Prompt Engineering Notes

### Classification Prompt Best Practices:
1. **Include ALL document types** in the system prompt with Hebrew names
2. **Give examples** of each type's visual characteristics (Form 106 has tax authority logo, etc.)
3. **Specify extraction fields** per document type (not all types have the same fields)
4. **Require confidence scores** - the model should express uncertainty
5. **Include "REJECT" as an explicit category** with examples (inventory lists, personal emails)
6. **Ask for reasoning** in a separate field (helps debug misclassifications)

### Key Hebrew Signals to Include in Prompt:
- "טופס 106" → T201/T301
- "טופס 867" → T601
- "אישור תושבות" or "טופס 1312" → T001
- "דוח שנתי לעמית" → T501
- "אישור הפקדות" or "אישור מס עבור" → T501
- "אישור משיכת כספים" or "פדיון" → T401
- "הסכם שכירות" → T901/T902
- "קבלה על תרומה" or "סעיף 46" → T1301
- "ביטוח לאומי" + "אישור שנתי למס הכנסה" → T1201
- "1040" or "tax return" → T1401 (foreign)
