# Design Log 207: WF05 Worker — Full Gap Audit (All Design Logs)
**Status:** [AUDIT COMPLETE]
**Date:** 2026-03-27
**Supersedes:** DL-206 (classification-only gaps — this log is the comprehensive superset)
**Related Logs:** Every ai-review DL (035–201) + DL-203 (migration) + DL-206 (partial audit)

## 1. Context & Methodology

DL-203 migrated WF05 from a 56-node n8n workflow to a Cloudflare Worker. DL-206 audited classification prompt gaps specifically. **This audit is exhaustive** — compares the worker against:

- **Pre-migration backup:** `docs/wf05-backup-pre-migration-2026-03-26.json` (56 nodes, 4697 lines)
- **All 35 ai-review design logs:** DL-035 through DL-201
- **DL-206 infrastructure log** (classification parity)
- **Current Worker source:** `api/src/lib/inbound/*.ts` + `api/src/routes/classifications.ts`

### Files Audited (Worker)
| File | Lines | Role |
|------|-------|------|
| `api/src/lib/inbound/document-classifier.ts` | 302 | Classification prompt, tool schema, issuer matching |
| `api/src/lib/inbound/processor.ts` | 663 | Main pipeline orchestrator |
| `api/src/lib/inbound/client-identifier.ts` | 376 | 4-tier client identification |
| `api/src/lib/inbound/attachment-utils.ts` | 123 | OneDrive upload, file hash, conversions |
| `api/src/lib/inbound/image-to-pdf.ts` | 483 | JPEG/PNG → PDF |
| `api/src/lib/inbound/types.ts` | 157 | Shared types/constants |
| `api/src/routes/inbound-email.ts` | 83 | Webhook handler + KV dedup |
| `api/src/routes/classifications.ts` | 739 | Review endpoint (approve/reject/reassign) |
| `api/src/lib/classification-helpers.ts` | 166 | Shared helpers (HE_TITLE, buildShortName) |

---

## 2. Gap Inventory

### SEVERITY P0 — Classification Accuracy (Directly Degrades AI Results)

#### GAP-01: No Document Content Sent to AI
**Source:** DL-035, DL-046, DL-143
**n8n had:** Full document content in user prompt:
- Small PDFs (<5MB): base64 `type: 'document'` content block
- Images (PNG/JPG/TIFF/HEIC): base64 `type: 'image'` content block
- DOCX: Pure-JS DEFLATE decompressor → XML parser → extracted text; fallback to embedded images for scanned docs
- XLSX: sharedStrings.xml parser → extracted cell text + sheet names
- Large PDFs (>5MB): text-only metadata (DL-143 raised threshold from 500KB to 5MB)

**Worker has:** `classifyAttachment()` sends ONLY:
```
Filename: ${attachment.name}
Content-Type: ${attachment.contentType}
```
No document content, no base64, no text extraction, no images.

**Impact:** Classification is entirely filename-based. A file named `doc001.pdf` or `scan_20250315.jpg` cannot be classified. The AI literally cannot see the document.

**Fix:** Port the full content pipeline from Prepare Attachments node (backup lines 340-545):
- PDF base64 encoding
- Image base64 encoding
- DOCX text extraction (DEFLATE + XML, ~200 lines)
- XLSX text extraction (sharedStrings, ~50 lines)
- Size routing with 5MB threshold

---

#### GAP-02: DOC_TYPE_REFERENCE Missing (~200 Lines)
**Source:** DL-035, DL-046
**n8n had:** A ~200-line `DOC_TYPE_REFERENCE` constant embedded in the system prompt, containing for each of the 34 templates:
- Hebrew name + English description
- What the document looks like (visual cues)
- Common filenames
- Issuer info (who issues it)
- Disambiguation notes (what it's NOT)
- NII subtype routing rules

**Worker has:** Nothing. The system prompt is 3 lines:
```
You are a document classification assistant for a CPA tax firm.
Classify the attached document into the most appropriate template category.
Use the required documents list to find the best match.
```

**Impact:** AI has no domain knowledge to classify Hebrew tax documents.

**Fix:** Port DOC_TYPE_REFERENCE from backup (Prepare Attachments node, lines 198-393).

---

#### GAP-03: System Prompt Missing All Classification Rules
**Source:** DL-131, DL-134, DL-138, DL-143
**n8n had (~80 lines):**
- Step-by-step classification procedure (4 phases)
- Person check rules (client name vs document name → spouse detection)
- Category identification rules (Employment, NII, Insurance, Securities, Rental, etc.)
- NII routing table (disability→T303, maternity→T304, survivors→T305/T306, generic→T302)
- Insurance rules (T401 withdrawal vs T501 annual deposit)
- Rental rules (T901 income vs T902 expense)
- Tax withholding rules (T1101 income tax vs T1102 NII)
- Form 106 rules (T201 client vs T202 spouse)
- T301 removed with explicit redirect to T302 (DL-138)
- Critical warning: "NEVER return a template_id not in the required docs list unless you are very confident"

**Worker has:** 3 generic lines (see GAP-02).

**Impact:** No classification rules = random guessing for similar document types.

---

#### GAP-04: Tool Schema Missing All Hardening
**Source:** DL-131, DL-134
**n8n had:**
```javascript
{
  name: 'classify_document',
  input_schema: {
    type: 'object',
    additionalProperties: false,  // DL-131
    properties: {
      evidence: { ... },          // FIRST — CoT reasoning (DL-134 CRANE pattern)
      issuer_name: { ... },       // Second
      confidence: { ... },        // Third
      matched_template_id: {
        anyOf: [
          { type: 'string', enum: ALL_TEMPLATE_IDS },  // Full 33-ID static enum (DL-134)
          { type: 'null' }
        ]
      }                           // LAST — classification after reasoning
    },
    required: ['evidence', 'issuer_name', 'confidence', 'matched_template_id']
  }
}
// + strict: true (DL-131)
// + anthropic-beta: structured-outputs-2025-11-13 header (DL-131)
```

**Worker has:**
```typescript
{
  name: 'classify_document',
  input_schema: {
    type: 'object',
    properties: {
      template_id: { type: ['string', 'null'] },  // FIRST (wrong order), NO enum
      confidence: { type: 'number' },
      reason: { type: 'string' },                  // "reason" not "evidence"
      issuer_name: { type: 'string' },
    },
    required: ['template_id', 'confidence', 'reason', 'issuer_name']
  }
}
// No strict: true
// No additionalProperties: false
// No anthropic-beta header
```

**Impact (5 sub-gaps):**
- **No enum:** AI can hallucinate template IDs (e.g., "T999", "T100")
- **No strict mode:** AI can return extra fields or wrong types
- **Wrong field order:** Classification FIRST forces premature decision before reasoning (research shows evidence-first improves accuracy by ~15% — CRANE paper, DL-134)
- **No guided CoT:** `reason` field has no instructions vs `evidence` which specified: "1-3 sentences IN HEBREW: First identify the document CATEGORY..., then cite specific text..."
- **No issuer_name rules:** Missing NII benefit type rules, T303 null rule, T305/T306 survivor details

---

#### GAP-05: Confusing-Pairs Disambiguation Missing
**Source:** DL-134
**n8n had:** Explicit section in system prompt:
```
CONFUSING PAIRS:
• T401 (withdrawal/משיכה) vs T501 (deposit report/אישור שנתי): T401=ONE-TIME withdrawal, T501=ANNUAL report
• T501 (insurance annual) vs T303 (NII disability): T501 from PRIVATE insurers, T303 from ביטוח לאומי
• T901 (rental income) vs T902 (rental expense): Landlord→T901, Tenant→T902
• T1101 (income withholding) vs T1102 (NII withholding): "מס הכנסה"→T1101, "ביטוח לאומי"→T1102
• T201 vs T202 (Form 106 client vs spouse): Compare employee name to client name
```

**Worker has:** Nothing.

**Impact:** These are the most common misclassification pairs — every session before DL-134 had confusing-pair errors.

---

#### GAP-06: Email Context Missing from Classification
**Source:** DL-046, DL-188
**n8n had:** Email metadata in user prompt for each attachment:
- Email subject line
- Sender name and email
- Body preview (2000 chars)
- This helped when filename was ambiguous (e.g., `doc.pdf` from `payroll@intel.co.il`)

**Worker has:** Only filename + content-type. No email context at all.

**Impact:** Misses contextual cues that disambiguate ambiguous filenames.

---

### SEVERITY P1 — Matching & Routing (Affects Which Document Gets Updated)

#### GAP-07: Required Docs Missing `person` and `issuer_key` Fields
**Source:** DL-131, DL-144
**n8n had:** Required docs fetched with `person` (client/spouse) and `issuer_key` (short identifier).

**Worker fetches:**
```typescript
fields: ['type', 'issuer_name', 'status', 'report_key_lookup', 'expected_filename', 'category']
```

Missing: `person`, `issuer_key`, `document_name_he`.

**Impact:**
- No person tag in template list → NII routing can't distinguish client vs spouse
- No `issuer_key` → dual-field issuer matching impossible (GAP-08)

---

#### GAP-08: `issuer_key` Dual-Field Matching Missing
**Source:** DL-144
**n8n had (after DL-144 fix):**
```javascript
const qKey = compareIssuers(issuerName, doc.issuer_key);
const qName = compareIssuers(issuerName, doc.issuer_name);
const quality = (QUALITY_RANK[qKey] || 0) >= (QUALITY_RANK[qName] || 0) ? qKey : qName;
```

**Worker has:** Only `issuer_name` comparison:
```typescript
compareIssuers(issuerName, candidates[0].fields.issuer_name || '')
```

**Impact:** Short identifiers (e.g., "IDI", "AIG") won't match against long `issuer_name` fields.

**Example (from DL-144 test):** AI returns "איי.די.איי (IDI)" for a pension doc. `issuer_name` is the full SSOT title. Without `issuer_key = "IDI"`, the match fails.

---

#### GAP-09: Client Name Not Passed to Classifier
**Source:** DL-131
**n8n had:** Client name injected into system prompt for person matching:
```
Client name: ${clientName}. If document mentions a DIFFERENT person, it's likely the spouse.
```

**Worker has:** `classifyAttachment(pCtx, attachment, requiredDocs)` — no `clientName` parameter.

**Impact:** Cannot distinguish T201 (client Form 106) from T202 (spouse Form 106), or T305 (client survivors) from T306 (spouse survivors).

---

#### GAP-10: NII Issuer Return Rules Missing
**Source:** DL-131, DL-143
**n8n had:**
```
For T302 (generic NII): return the BENEFIT TYPE (e.g., אבטלה, מילואים).
For T303/T304/T305/T306 (specific NII): return 'ביטוח לאומי' or 'המוסד לביטוח לאומי'.
```

**Worker has:** Generic `issuer_name: { description: 'Name of issuing institution' }`

**Impact:** NII documents may get wrong issuer names, breaking the filename convention and OneDrive filing.

---

#### GAP-11: T301 Not Blocked
**Source:** DL-138
**n8n had:** T301 surgically removed:
- Removed from `ALL_TEMPLATE_IDS` enum (making it impossible to return)
- Removed from DOC_TYPE_REFERENCE
- Removed from HE_TITLE
- System prompt redirects generic NII → T302

**Worker has:** No enum at all, so T301 can be returned by the AI. T301 is correctly absent from HE_TITLE/TEMPLATE_TITLES, but nothing prevents the AI from returning `template_id: 'T301'`.

**Impact:** Generic NII docs classified as T301 → no matching required doc → unmatched.

---

### SEVERITY P1 — Content Processing (Affects File Quality)

#### GAP-12: Office-to-PDF Conversion Status Unclear
**Source:** DL-035, DL-115
**n8n had:** Full Office→PDF chain: Check If PDF → Download as PDF (Graph API `?format=pdf`) → Upload PDF → Delete Original → Finalize Conversion (fallback).

**Worker has:** Inline code in `processor.ts:409-444` using `pCtx.graph.getBinary()` and `pCtx.graph.putBinary()`. The `attachment-utils.ts:convertOfficeToPdf()` is a **STUB returning null** with `TODO: Needs MSGraphClient enhancement for binary GET responses`.

**Status:** Need to verify if `MSGraphClient.getBinary()` actually exists and works. If it's a stub, Office docs (DOCX/XLSX/PPTX) won't get PDF conversions.

---

#### GAP-13: DOCX/XLSX Text Extraction Missing
**Source:** DL-046
**n8n had:** Pure-JS text extractors in Prepare Attachments:
- `extractDocxText()`: DEFLATE decompress → parse word/document.xml → strip XML tags → return text
- `extractXlsxText()`: DEFLATE decompress → parse xl/sharedStrings.xml → return cell values + sheet names
- Fallback for scanned DOCX: `extractDocxImages()` → send as `type: 'image'` blocks

**Worker has:** None. These are needed for GAP-01 (sending document content to AI).

---

### SEVERITY P2 — Optimization & Robustness

#### GAP-14: Prompt Caching Not Implemented
**Source:** DL-046
**n8n had:**
```javascript
system: [
  { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }
]
// + tool definition with cache_control: { type: 'ephemeral' }
// + anthropic-beta: prompt-caching-2024-07-31 header
```

**Worker has:** Plain string system prompt, no caching headers.

**Impact:** Cost increase. Without caching, the ~5KB DOC_TYPE_REFERENCE is re-tokenized per attachment. With prompt caching, the 2nd+ attachment in the same email reuses cached tokens (~90% cost reduction on system prompt).

---

#### GAP-15: No `temperature: 0` on Client Identification AI
**Source:** DL-035
**n8n had:** `temperature: 0` for deterministic AI responses in client identification.

**Worker has:** No temperature parameter in `matchByAI()` (uses model default).

**Impact:** Non-deterministic client matching — same email could match different clients on retry.

---

#### GAP-16: Attachment Filenames Missing from AI Client Identification Prompt
**Source:** DL-035 (Identify Client node)
**n8n had:** Attachment filenames included in the AI identification prompt:
```
Attachments: tax_form_cohen.pdf, nii_certificate.jpg
```

**Worker has:** Only sender name, subject, body (2000 chars), and client list.

**Impact:** Minor — filenames occasionally contain client names or identifying info.

---

### SEVERITY P2 — Review Endpoint (classifications.ts)

#### GAP-17: HE_TITLE Map Mismatch Between Files
**Source:** DL-138, DL-197
**Worker has TWO different HE_TITLE maps:**

1. `classification-helpers.ts` (used by review endpoint):
```typescript
T101: 'טופס 106', T102: 'טופס 106 נוסף',
T201: 'אישור שנתי על תקבולי דמי נכות', ...
```

2. `processor.ts` / `document-classifier.ts` (used by inbound pipeline):
```typescript
T001:'אישור תושב', T002:'ספח תעודת זהות', T003:'מסמכי שינוי מצב משפחתי',
T201:'טופס 106', T202:'טופס 106', ...
```

**The template ID→name mappings are DIFFERENT between the two files.** For example:
- `classification-helpers.ts` maps T101→'טופס 106', T201→'אישור שנתי על תקבולי דמי נכות'
- `document-classifier.ts` maps T201→'טופס 106', T301→'טופס 867'

**Impact:** The same template ID shows different Hebrew names in the inbound pipeline vs the review interface.

**Fix:** Consolidate to a single exported HE_TITLE map, sourced from one file.

---

## 3. What's Already Working (No Changes Needed)

These items were verified against the n8n backup and all design logs:

| Feature | Worker File | Status |
|---------|------------|--------|
| KV dedup (Layer 0 + Layer 1) | `inbound-email.ts:38-57` | **BETTER than n8n** (KV vs broken Airtable upsert) |
| changeType filter | `inbound-email.ts:38` | ✅ |
| File hash dedup (Layer 2) | `document-classifier.ts:285-302` | ✅ |
| Consumer dedup (by file_hash) | `classifications.ts:73-81` | ✅ |
| Email fetch via MS Graph | `processor.ts:517-525` | ✅ |
| Auto-reply detection (headers + subject patterns) | `processor.ts:56-73, 79-114` | ✅ |
| Attachment filtering (extension + size + inline) | `attachment-utils.ts:28-36` | ✅ |
| Client identification (4-tier cascade) | `client-identifier.ts:347-376` | ✅ |
| Forwarded email parsing (From: + Hebrew מאת:) | `client-identifier.ts:115-139` | ✅ |
| Active report lookup (Collecting_Docs + Review) | `processor.ts:154-176` | ✅ |
| OneDrive shared folder resolution | `attachment-utils.ts:82-88` | ✅ |
| OneDrive upload with conflictBehavior=rename | `attachment-utils.ts:91-108` | ✅ |
| Subfolder routing (זוהו vs ממתינים לזיהוי) | `processor.ts:361-373` | ✅ |
| Image→PDF (JPEG + PNG) | `image-to-pdf.ts` | ✅ |
| Expected filename building (HE_TITLE + issuer) | `processor.ts:316-327` | ✅ |
| Pending classification record (25+ fields) | `processor.ts:449-479` | ✅ |
| Document record update (matched docs) | `processor.ts:484-505` | ✅ |
| Email event upsert + status tracking | `processor.ts:120-148` | ✅ |
| Client notes (LLM summary, dedup by message_id) | `processor.ts:182-285` | ✅ |
| Forward detection (fwd:/fw: + Hebrew variants) | `processor.ts:192` | ✅ |
| Issuer matching (entity stop words, token overlap) | `document-classifier.ts:63-95` | ✅ (needs issuer_key addition) |
| SHA-256 file hash | `attachment-utils.ts:39-44` | ✅ |
| email_body_text in pending classification | `processor.ts:476` | ✅ (DL-188) |
| Email NOT moved to folder | processor.ts | ✅ (DL-188: move disabled) |
| Synchronous processing (no 30s timeout) | `inbound-email.ts:57` | ✅ |
| Error logging with alerts | `lib/error-logger.ts` | ✅ |
| Sanitize email in review endpoint | `classifications.ts` | ✅ (DL-201) |
| Reassign target doc guard (409 conflict) | `classifications.ts` | ✅ (DL-070) |
| Stage advancement (Collecting_Docs → Review) | `classifications.ts` | ✅ (DL-054) |
| Tool-use response parsing | `document-classifier.ts` | ✅ (DL-195 fix not needed — Worker always used tool_use correctly) |
| Binary upload field name | N/A | ✅ (DL-196 was n8n-only bug — Worker uses ArrayBuffer directly) |

## 4. What the Worker Does BETTER Than n8n

| Improvement | Detail |
|-------------|--------|
| **KV dedup** | Atomic write-first-then-verify in Cloudflare KV vs broken Airtable upsert in n8n (Code node HTTP calls fail on n8n Cloud — DL-199) |
| **No 30s timeout** | Synchronous processing vs n8n `waitUntil` which had 30-second wall-clock limit |
| **Error logging** | Structured Airtable logs + throttled MS Graph alert emails vs nothing in n8n |
| **Clean architecture** | TypeScript modules with proper types vs 616-line monolithic Code node |
| **Direct Anthropic SDK** | Native fetch + typed responses vs HTTP Request node with pre-stringify pattern |
| **Testable** | Each module unit-testable vs n8n Code nodes requiring full workflow execution |

## 5. Implementation Priority Roadmap

### Phase 1: Classification Accuracy (CRITICAL — Do First)
**Estimated effort: ~500 lines across 2 files**

| Step | Gap | File | Action |
|------|-----|------|--------|
| 1a | GAP-02 | `document-classifier.ts` | Add `DOC_TYPE_REFERENCE` constant (~200 lines from backup) |
| 1b | GAP-03 | `document-classifier.ts` | Rewrite system prompt with full classification rules (~80 lines) |
| 1c | GAP-05 | `document-classifier.ts` | Add confusing-pairs section to system prompt |
| 1d | GAP-04 | `document-classifier.ts` | Rewrite tool schema: strict, enum, evidence-first, detailed descriptions |
| 1e | GAP-11 | `document-classifier.ts` | Ensure T301 not in ALL_TEMPLATE_IDS enum |
| 1f | GAP-10 | `document-classifier.ts` | Add NII issuer return rules to tool description |
| 1g | GAP-09 | `document-classifier.ts` + `processor.ts` | Pass clientName param for person matching |
| 1h | GAP-07 | `processor.ts` | Add `person`, `issuer_key` to required docs query |
| 1i | GAP-08 | `document-classifier.ts` | Add `issuer_key` dual-field matching in `findBestDocMatch()` |

### Phase 2: Document Content (CRITICAL — Biggest Accuracy Lift)
**Estimated effort: ~300 lines**

| Step | Gap | File | Action |
|------|-----|------|--------|
| 2a | GAP-01 | `document-classifier.ts` | Send PDF content as base64 document block |
| 2b | GAP-01 | `document-classifier.ts` | Send image content as base64 image block |
| 2c | GAP-13 | `document-classifier.ts` or new `text-extractor.ts` | Port DOCX text extraction (DEFLATE + XML, ~200 lines) |
| 2d | GAP-13 | Same file | Port XLSX text extraction (~50 lines) |
| 2e | GAP-01 | `document-classifier.ts` | Size routing: >5MB → metadata-only prompt |
| 2f | GAP-06 | `document-classifier.ts` + `processor.ts` | Pass email metadata (subject, body, sender) to classifier |

### Phase 3: Optimization & Cleanup
**Estimated effort: ~50 lines**

| Step | Gap | File | Action |
|------|-----|------|--------|
| 3a | GAP-14 | `document-classifier.ts` | Add prompt caching (system prompt array + cache_control + header) |
| 3b | GAP-15 | `client-identifier.ts` | Add `temperature: 0` |
| 3c | GAP-16 | `client-identifier.ts` | Add attachment filenames to AI identification prompt |
| 3d | GAP-17 | `classification-helpers.ts` | Consolidate HE_TITLE maps across all files |
| 3e | GAP-12 | Verify | Test Office→PDF conversion end-to-end (does `graph.getBinary()` work?) |

## 6. Source Material References

| Resource | Location | Contents |
|----------|----------|----------|
| n8n backup | `docs/wf05-backup-pre-migration-2026-03-26.json` | Full 56-node workflow, all Code node jsCode |
| Node extraction | `tmp/wf05-node-extraction.txt` | Extracted code from 19 Code nodes + 14 parameter nodes |
| DOC_TYPE_REFERENCE | Backup → Prepare Attachments → lines 198-393 | All 34 template type descriptions |
| System prompt | Backup → Prepare Attachments → lines 395-475 | Classification rules, NII routing, confusing pairs |
| Tool schema | Backup → Prepare Attachments → lines 477-545 | strict mode, evidence-first, full enum |
| DOCX extractor | Backup → Prepare Attachments → lines 1-110 | DEFLATE + XML parser |
| XLSX extractor | Backup → Prepare Attachments → lines 111-195 | sharedStrings parser |
| issuer_key fix | DL-144 | Dual-field matching pattern |
| DL-131 | `.agent/design-logs/ai-review/131-*` | Enum enforcement + NII routing |
| DL-134 | `.agent/design-logs/ai-review/134-*` | Field ordering + full enum + confusing pairs |
| DL-136 | `.agent/design-logs/ai-review/136-*` | Entity stop words + QUALITY_RANK |
| DL-138 | `.agent/design-logs/ai-review/138-*` | T301 removal |
| DL-143 | `.agent/design-logs/ai-review/143-*` | 5MB threshold + NII issuer rules |

## 7. Summary Statistics

| Category | Count |
|----------|-------|
| **P0 gaps (classification accuracy)** | 6 (GAP-01 through GAP-06) |
| **P1 gaps (matching & routing)** | 7 (GAP-07 through GAP-13) |
| **P2 gaps (optimization)** | 4 (GAP-14 through GAP-17) |
| **Total gaps** | **17** |
| **Already working** | 29 features verified ✅ |
| **Worker improvements over n8n** | 6 |
| **Estimated lines to port** | ~850 |

---

*Audit completed 2026-03-27. This is the definitive gap reference for WF05 Worker parity.*
