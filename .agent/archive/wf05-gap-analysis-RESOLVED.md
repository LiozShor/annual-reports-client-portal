# WF05 Gap Analysis & Improvement Plan

**Date:** 2026-02-17
**Workflow:** [05] Inbound Document Processing (`cIa23K8v1PrbDJqY`)
**Status:** Active (v33)

---

## 1. Current Workflow Summary (Node-by-Node)

### Pipeline Flow (20 nodes, linear)

```
[Webhook Trigger] ──→ [Check Validation]
                          ├─ TRUE → [Respond Validation] (return validationToken)
                          └─ FALSE → [Extract Notification] (parse MS Graph webhook)
                                         ↓
                              [Respond 202] (acknowledge fast)
                                         ↓
                              [Fetch Email by ID] (MS Graph GET /messages/{id})
                                         ↓
                              [Extract Email] (filter auto-replies, skip no-attachments)
                                         ↓
                              [Get Attachments] (MS Graph GET /messages/{id}/attachments)
                                         ↓
                              [Process & Filter Attachments] (skip inline, <1KB, non-doc types)
                                         ↓
                              [Mark as Read] (PATCH isRead=true)
                                         ↓
                              [Search Client by Email] (Airtable lookup by sender email)
                                         ↓
                              [Get Active Report] (Airtable: client + year=2025 + stage 3 or 4)
                                         ↓
                              [Get Required Docs] (Airtable: report_key + status=Required_Missing)
                                         ↓
                              [Resolve OneDrive Root] (GET /shares/{token}/driveItem)
                                         ↓
                              [Prepare Attachments] (build OpenAI request per attachment)
                                         ↓
                              [OpenAI Classify] (POST /v1/chat/completions, gpt-4o-mini)
                                         ↓
                              [Process and Prepare Upload] (parse classification, build OneDrive path, create binary)
                                         ↓
                              [Upload to OneDrive] (PUT binary to path-based URL)
                                         ↓
                              [Build Summary] (aggregate results, build HTML email)
                                         ↓
                              [Email Natan] (MS Graph sendMail)
```

### What It Does Well

| Strength | Details |
|----------|---------|
| **Fast webhook acknowledgment** | Responds 202 before processing — prevents MS Graph retries |
| **Security validation** | Checks `clientState` secret in webhook notification |
| **Smart attachment filtering** | Skips inline images, tracking pixels, non-document types |
| **Auto-reply detection** | Filters out bounce-backs and auto-replies (Hebrew + English patterns) |
| **Structured output** | Uses JSON Schema with strict enum for template IDs — prevents hallucinated IDs |
| **OneDrive auto-folder creation** | Path-based upload creates intermediate folders automatically |
| **Graceful unknowns** | Handles unidentified clients and clients without required docs |
| **Retry logic** | All HTTP nodes have retry-on-fail configured (2-3 retries with wait) |
| **Summary email** | Rich HTML notification to Natan with classification table |

### What's Fragile or Missing

| Weakness | Impact | Severity |
|----------|--------|----------|
| **Metadata-only classification** | GPT-4o-mini only sees filename + email subject/body — never reads PDF content | HIGH |
| **No Airtable status updates** | Classification results not written back — document status stays "Required_Missing" forever | HIGH |
| **No confidence-based routing** | All docs treated the same regardless of AI confidence score | HIGH |
| **No PDF content analysis (Tier 2)** | `needs_pdf_fallback` flag returned but never acted on | HIGH |
| **No email_events logging** | No audit trail in Airtable — can't track processing status or debug failures | MEDIUM |
| **No duplicate detection** | Same document sent twice → uploaded twice, no deduplication | MEDIUM |
| **No format conversion** | DOCX/XLSX files classified from filename only — no conversion to PDF | MEDIUM |
| **Hardcoded year** | `year = 2025` hardcoded in Get Active Report filter and Prepare Attachments fallback | MEDIUM |
| **No multi-doc PDF splitting** | 15-page bundle (like doc16) classified as single document | LOW |
| **GPT-4o-mini vs Claude** | Research recommended Claude Sonnet 4.5 but implementation uses GPT-4o-mini | LOW (cost) |
| **No completion_percent update** | Even if docs were matched, completion percentage wouldn't update | HIGH |
| **No telemetry/calibration** | No logging of token usage, processing time, or Natan's review decisions | MEDIUM |

---

## 2. Gap Analysis Table

| # | Area | Current Behavior | Recommended Behavior | Priority | Effort |
|---|------|-----------------|---------------------|----------|--------|
| 1 | **Airtable updates** | Classification results never written to Airtable. Document status stays `Required_Missing`. | After upload: update matched document record with `ai_confidence`, `ai_reason`, `review_status=pending_review`, `file_url`, `source_attachment_name`, `source_sender_email`. | **P0 — Critical** | Low (1-2 hrs) |
| 2 | **Confidence-based routing** | All documents treated identically. No IF branching. | Add IF node after classification: ≥0.85 → auto-mark `Received`; 0.50-0.84 → `pending_review`; <0.50 → flag as unrecognized. Initially all go to review (calibration phase). | **P0 — Critical** | Low (2-3 hrs) |
| 3 | **PDF content analysis (Tier 2)** | `needs_pdf_fallback=true` flag ignored. Model only sees filename/subject. | When `needs_pdf_fallback=true` OR confidence < 0.7: re-call with base64 PDF content attached (vision). Use Claude Sonnet 4.5 for Tier 2 (native PDF input). | **P1 — High** | Medium (4-6 hrs) |
| 4 | **email_events audit trail** | No processing log in Airtable. | Create `email_events` record at start of processing. Update `processing_status` at each step (Detected → Downloaded → Classified → Uploaded → Airtable_Updated → Completed). On failure: set to `Failed` with `error_message`. | **P1 — High** | Medium (3-4 hrs) |
| 5 | **Duplicate detection** | Same file uploaded multiple times without checking. | Before classification: compute file hash (SHA-256 of `content_bytes`). Check `documents.file_hash` in Airtable. If match found → skip upload, notify Natan "duplicate detected". | **P1 — High** | Low (2-3 hrs) |
| 6 | **Hardcoded year** | `{year} = 2025` in Airtable filter. Breaks in 2026. | Use `new Date().getFullYear()` or dynamic expression. Also handle edge cases (Jan submissions for previous tax year). | **P1 — High** | Low (<1 hr) |
| 7 | **Completion percentage** | Not updated after document is received. | After Airtable update: trigger completion recalculation (rollup fields should auto-update if `status` changes to `Received`). Verify rollup propagation. | **P1 — High** | Low (<1 hr) |
| 8 | **Issuer matching** | `required_docs.find(d => d.type === cls.matched_template_id)` — matches first by type only. | When multiple docs share same type (e.g., two T201 Form 106 from different employers): match by `type + issuer_name` (normalized). If ambiguous → queue for review. | **P2 — Medium** | Medium (2-3 hrs) |
| 9 | **Format conversion** | DOCX/XLSX files classified from filename only. | Add pre-processing: detect non-PDF → convert to PDF using external API (e.g., CloudConvert) or flag for manual handling. | **P2 — Medium** | Medium (3-4 hrs) |
| 10 | **Multi-page bundle detection** | 15-page PDFs classified as single document. | In Tier 2 (Claude vision): add `contains_multiple_types` and `sub_documents[]` to output schema. If detected → create separate Airtable records per sub-document. | **P2 — Medium** | High (6-8 hrs) |
| 11 | **Model upgrade** | GPT-4o-mini (metadata only). | Keep GPT-4o-mini for Tier 1 (metadata, $0.61/5000 docs). Add Claude Sonnet 4.5 for Tier 2 (PDF vision, ~$0.028/doc). Two-tier = best cost/accuracy. | **P2 — Medium** | Medium (3-4 hrs) |
| 12 | **Telemetry logging** | No metrics collected. | Log per classification: `token_usage`, `processing_time_ms`, `tier_used`, `review_decision`. Store in `system_logs` or dedicated telemetry table. Use after month 1 to calibrate thresholds. | **P3 — Low** | Medium (3-4 hrs) |
| 13 | **Client matching fallback** | Only exact email match. Unknown sender → "לקוח לא מזוהה". | Add: (1) domain matching for corporate emails, (2) spouse email field check, (3) name matching from email body. | **P3 — Low** | Medium (3-4 hrs) |
| 14 | **OneDrive file naming** | Original attachment filename preserved (`scan003.pdf`). | Rename to meaningful name when classified: `{template_name} - {issuer}.{ext}` (e.g., `טופס 106 - עיריית תל אביב.pdf`). | **P3 — Low** | Low (1-2 hrs) |

---

## 3. Top 3 Improvements — Implementation Details

### Improvement #1: Airtable Document Status Updates (P0)

**Impact:** Without this, the entire classification is cosmetic — Natan gets an email but nothing changes in Airtable. Documents stay "Required_Missing" forever, completion percentage never updates, and the admin panel shows stale data.

**What to add:** An IF node + Airtable Update node between "Upload to OneDrive" and "Build Summary".

#### Node Changes

```
[Upload to OneDrive]
        ↓
[IF: Has Matched Doc?] ──→ TRUE → [Update Document in Airtable]
        │                                    ↓
        └──→ FALSE → ────────────→ [Build Summary] (merge both paths)
```

#### IF Node: "Has Matched Doc?"
```
Condition: $json.matched_doc_record_id is not empty
           AND $json.is_identified === true
```

#### Airtable Update Node: "Update Document Record"
- **Operation:** Update
- **Table:** documents (`tblcwptR63skeODPn`)
- **Record ID:** `{{ $json.matched_doc_record_id }}`
- **Fields to update:**

| Field | Value | Type |
|-------|-------|------|
| `status` | `Received` (or `pending_review` during calibration phase) | singleSelect |
| `ai_confidence` | `{{ $json.ai_confidence }}` | number |
| `ai_reason` | `{{ $json.evidence }}` | multilineText |
| `review_status` | `pending_review` | singleSelect |
| `file_url` | `{{ $('Upload to OneDrive').item.json.webUrl }}` | url |
| `onedrive_item_id` | `{{ $('Upload to OneDrive').item.json.id }}` | singleLineText |
| `source_attachment_name` | `{{ $json.attachment_name }}` | singleLineText |
| `source_sender_email` | `{{ $json.sender_email }}` | email |
| `source_message_id` | `{{ $json.email_id }}` | singleLineText |
| `source_internet_message_id` | `{{ $json.internet_message_id }}` | singleLineText |
| `uploaded_at` | `{{ new Date().toISOString() }}` | dateTime |
| `file_hash` | (compute SHA-256 of content_bytes in Process node) | singleLineText |

#### Airtable Schema Changes: None

All fields already exist in the `documents` table (per schema reference). The fields `ai_confidence`, `ai_reason`, `review_status`, `file_url`, `onedrive_item_id`, `source_attachment_name`, `source_sender_email`, `source_message_id`, `source_internet_message_id`, `uploaded_at`, and `file_hash` are all defined.

#### Implementation Notes
- During calibration (Month 1): set `review_status = pending_review` for ALL documents regardless of confidence. Set `status = Received` only after Natan confirms.
- After calibration: for confidence ≥ threshold, set both `status = Received` and `review_status = confirmed` automatically.
- The `file_hash` computation should be added to the "Process and Prepare Upload" Code node: `const hash = require('crypto').createHash('sha256').update(buf).digest('hex');`

---

### Improvement #2: Tier 2 PDF Vision Fallback (P1)

**Impact:** Currently the model only sees filename and email subject/body — it never reads the actual document. For scanned PDFs, generic filenames (scan001.pdf), or ambiguous metadata, this means ~20-30% of documents will be poorly classified. The research showed that ~15-20% of documents are scanned, and many financial institutions use generic filenames.

**What to add:** An IF node that checks `needs_pdf_fallback` flag, then calls Claude Sonnet 4.5 with the PDF content.

#### Node Changes

```
[OpenAI Classify (Tier 1)]
        ↓
[IF: Needs PDF Fallback?]
    ├─ TRUE → [Claude Vision Classify (Tier 2)] → [Process and Prepare Upload]
    └─ FALSE → [Process and Prepare Upload]
```

#### IF Node: "Needs PDF Fallback?"
```
Conditions (OR):
  - $json.needs_pdf_fallback === true (from OpenAI Tier 1)
  - Classification result confidence < 0.7
  - matched_template_id === null AND filename doesn't indicate non-tax
```

Note: The OpenAI response needs to be parsed in a Code node before the IF, since `needs_pdf_fallback` is inside the JSON response body.

#### Revised flow:

```
[OpenAI Classify (Tier 1 — metadata)]
        ↓
[Parse Tier 1 Result] (Code — extract confidence + needs_pdf_fallback)
        ↓
[IF: Needs Tier 2?]
    ├─ TRUE → [Prepare Claude Request] (Code — build Anthropic API body with PDF)
    │              ↓
    │         [Claude Vision Classify] (HTTP POST — Anthropic messages API)
    │              ↓
    │         [Parse Tier 2 Result] (Code — merge with Tier 1 data)
    │              ↓
    └─ FALSE → ──→ [Process and Prepare Upload] (Merge node combines both paths)
```

#### Claude Vision HTTP Request Node
```
Method: POST
URL: https://api.anthropic.com/v1/messages
Headers:
  x-api-key: {{ $credentials.anthropicApi.apiKey }}
  anthropic-version: 2023-06-01
  content-type: application/json
Body:
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 500,
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "document",
        "source": {
          "type": "base64",
          "media_type": "application/pdf",
          "data": "<base64 PDF content>"
        }
      },
      {
        "type": "text",
        "text": "<classification prompt with SSOT schema + required docs list>"
      }
    ]
  }]
}
```

#### Cost Impact
- Tier 2 calls: ~20-30% of 4,000 docs = ~800-1,200 docs/year
- Cost per Tier 2 call: ~$0.028 (Sonnet 4.5)
- Additional annual cost: ~$22-34
- Total (Tier 1 GPT-4o-mini + Tier 2 Claude): ~$25-40/year

#### New Credential Required
- Anthropic API key credential in n8n (user creates manually)

#### Airtable Schema Changes: None

Add `tier_used` value ("metadata" or "pdf_vision") to the existing `ai_reason` field or as metadata in the email notification.

---

### Improvement #3: Confidence-Based Routing + email_events Audit Trail (P0 + P1 combined)

**Impact:** Without confidence routing, all documents are treated identically — high-confidence Form 106 classifications get the same "manual review required" treatment as ambiguous scans. This defeats the purpose of AI classification. Without email_events, there's no way to debug failures, track processing status, or detect dropped emails.

#### Part A: Confidence-Based Routing

Add an IF node after "Process and Prepare Upload" that routes based on `ai_confidence`:

```
[Process and Prepare Upload]
        ↓
[Confidence Router] (IF node)
    ├─ ≥ 0.85 (Auto) → [Update Doc: status=Received, review_status=confirmed]
    │                       ↓
    ├─ 0.50-0.84 (Review) → [Update Doc: review_status=pending_review]
    │                           ↓
    └─ < 0.50 (Manual) → [Skip Airtable update — save to מסמכים שלא זוהו]
                              ↓
                    [Merge] → [Upload to OneDrive] → [Build Summary]
```

**Calibration phase override:** For Month 1, force ALL paths to `review_status = pending_review` regardless of confidence. After ~200 labeled samples, calibrate the 0.85 threshold based on actual precision/recall data.

#### Part B: email_events Audit Trail

Add 2 Airtable operations:
1. **Create email_event** — immediately after "Extract Email" (beginning of pipeline)
2. **Update email_event** — at the end of the pipeline (in "Build Summary" node) or on error

**Create email_event record:**

| Field | Value |
|-------|-------|
| `event_key` | `{{ $json.internet_message_id }}_{{ Date.now() }}` |
| `source_message_id` | `{{ $json.email_id }}` |
| `source_internet_message_id` | `{{ $json.internet_message_id }}` |
| `received_at` | `{{ $json.received_at }}` |
| `sender_email` | `{{ $json.sender_email }}` |
| `subject` | `{{ $json.subject }}` |
| `processing_status` | `Detected` |

**Update email_event at pipeline end:**

| Field | Value |
|-------|-------|
| `processing_status` | `Completed` (or `NeedsHuman` if low confidence) |
| `attachment_name` | Comma-separated list of all attachment names |
| `document` | Link to matched document record(s) |

**Error handling:** Wrap the pipeline in a try-catch pattern (via n8n Error Trigger or onError settings). On failure, update the email_event to `Failed` with `error_message`.

#### Airtable Schema Changes Required

None — the `email_events` table already exists with all required fields. However, verify:
- [ ] `processing_status` singleSelect has all values: `Detected`, `Downloaded`, `Classified`, `Uploaded`, `Airtable_Updated`, `Completed`, `Failed`, `NeedsHuman`
- [ ] `document` link field accepts manual record IDs (not just UI linking)

---

## 4. Estimated Impact

### Accuracy Impact

| Metric | Current (Tier 1 only) | After Improvements | Change |
|--------|----------------------|-------------------|--------|
| **Overall classification accuracy** | ~60-70% (metadata only) | ~90-95% (with Tier 2 vision) | +25-30% |
| **Scanned document accuracy** | ~20-30% (filename guess) | ~85-90% (Claude vision reads content) | +55-65% |
| **Multi-employer disambiguation** | ~50% (first-match) | ~85% (issuer matching) | +35% |
| **Duplicate detection rate** | 0% (no detection) | ~95% (file hash) | +95% |
| **Documents auto-processed** | 0% (all manual) | ~70% after calibration | +70% |
| **Human review items/day** | All documents | ~30% of documents | -70% |

### Processing Speed Impact

| Metric | Current | After Improvements | Change |
|--------|---------|-------------------|--------|
| **End-to-end time per email** | ~5-8 sec | ~6-12 sec (Tier 2 adds ~4 sec when needed) | +2-4 sec |
| **Natan's daily review time** | All docs manual | ~30% need review (2 min each) | -70% |
| **Time to mark doc as "Received"** | Manual (hours/days) | Automatic or pending_review (seconds) | ~instant |
| **Completion dashboard accuracy** | Always stale | Real-time updates | Immediate |

### Cost Impact

| Component | Current | After Improvements | Annual |
|-----------|---------|-------------------|--------|
| **GPT-4o-mini (Tier 1)** | ~$0.61/5000 docs | Same | ~$0.50 |
| **Claude Sonnet 4.5 (Tier 2)** | $0 | ~1,200 calls x $0.028 | ~$34 |
| **Total API cost** | ~$0.50/year | | ~$35/year |
| **Staff time saved** | 0 | ~200 hrs/year reduced review | Significant |

---

## 5. Airtable Schema Changes Summary

### No new tables required.

### No new fields required.

All fields referenced in the improvements already exist in the Airtable schema:

| Table | Fields Used | Status |
|-------|------------|--------|
| `documents` | `status`, `ai_confidence`, `ai_reason`, `review_status`, `file_url`, `onedrive_item_id`, `source_attachment_name`, `source_sender_email`, `source_message_id`, `source_internet_message_id`, `uploaded_at`, `file_hash` | All exist |
| `email_events` | `event_key`, `source_message_id`, `source_internet_message_id`, `received_at`, `sender_email`, `subject`, `attachment_name`, `processing_status`, `error_message`, `document`, `report` | All exist |

### Verify singleSelect values:

- `documents.review_status`: Ensure `pending_review`, `confirmed`, `rejected`, `manual` are all configured as options
- `documents.status`: Ensure `Received` is a valid option (it is per schema)
- `email_events.processing_status`: Ensure all 8 status values are configured: `Detected`, `Downloaded`, `Classified`, `Uploaded`, `Airtable_Updated`, `Completed`, `Failed`, `NeedsHuman`

---

## 6. Implementation Roadmap

### Phase 1: Critical Fixes (Week 1) — P0 items

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 1a | Add file_hash computation to "Process and Prepare Upload" Code node | 30 min | None |
| 1b | Add IF node + Airtable Update node after Upload (Improvement #1) | 2 hrs | None |
| 1c | Fix hardcoded `year = 2025` → dynamic year | 30 min | None |
| 1d | Add email_events create record after Extract Email | 2 hrs | Verify singleSelect values |
| 1e | Add email_events update at end of pipeline | 1 hr | 1d |

### Phase 2: Classification Upgrade (Week 2) — P1 items

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 2a | Add Parse Tier 1 Result Code node after OpenAI Classify | 1 hr | None |
| 2b | Add IF: Needs Tier 2? node | 1 hr | 2a |
| 2c | Build Claude Vision Classify HTTP Request node | 2 hrs | Anthropic API credential |
| 2d | Add Merge node to combine Tier 1 and Tier 2 paths | 1 hr | 2b, 2c |
| 2e | Add duplicate detection (hash check) before classification | 2 hrs | 1a |
| 2f | Test with sample documents from docs/Samples/ | 2 hrs | 2a-2d |

### Phase 3: Routing & Optimization (Week 3) — P2 items

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 3a | Add confidence-based routing IF node | 2 hrs | Phase 2 complete |
| 3b | Improve issuer matching (multi-employer disambiguation) | 2 hrs | None |
| 3c | Add meaningful OneDrive file naming | 1 hr | None |
| 3d | Test full pipeline end-to-end | 3 hrs | All above |

### Phase 4: Calibration (Month 1-2) — Ongoing

| # | Task | Notes |
|---|------|-------|
| 4a | Run all docs through pipeline with `review_status=pending_review` | All docs go to Natan |
| 4b | Natan confirms/rejects each classification | Target: 200+ labeled samples |
| 4c | Analyze precision/recall at each confidence threshold | Compute optimal threshold |
| 4d | Adjust threshold and enable auto-processing | Switch from all-review to confidence routing |

---

## 7. Research vs. Implementation Comparison

| Research Recommendation | WF05 Implementation | Gap | Resolution |
|------------------------|--------------------|----|------------|
| Claude Sonnet 4.5 as primary classifier | GPT-4o-mini (metadata only) | **Major** — lower accuracy, no PDF reading | Keep GPT-4o-mini for Tier 1 (cost-efficient metadata), add Claude for Tier 2 (PDF vision) |
| Native PDF input to classifier | Only filename/subject/body sent | **Major** — misses all visual content | Tier 2 sends base64 PDF to Claude Anthropic API |
| Confidence gating (0.85/0.50 thresholds) | No IF branching by confidence | **Major** — no auto-processing path | Add confidence router IF node |
| Airtable document status updates | Not implemented | **Critical** — system is cosmetic only | Add Airtable update node |
| Review queue table | Not implemented | **Medium** — uses `review_status` field instead | Acceptable — field-level review vs. separate table is simpler |
| Document deduplication (file hash) | Not implemented | **Medium** — duplicates uploaded silently | Add SHA-256 hash computation + Airtable check |
| email_events audit trail | Not implemented | **Medium** — no debugging/tracking | Add email_events create/update |
| Format conversion (DOCX→PDF) | Not implemented | **Low** — ~5% of files affected | Defer to Phase 3 or manual handling |
| Multi-doc PDF splitting | Not implemented | **Low** — rare (doc16-style bundles) | Defer — classify bundle as single type for now |
| Prompt caching (Anthropic) | N/A (using OpenAI) | **Low** — cost is minimal either way | Consider if switching to Claude-only |
| File naming convention | Original filename preserved | **Low** — cosmetic | Add in Phase 3 |

---

## 8. Risk Considerations

| Risk | Mitigation |
|------|-----------|
| Tier 2 adds latency | Only ~20-30% of docs hit Tier 2. Async processing — Natan doesn't wait for results. |
| Anthropic API key management | User creates credential manually in n8n. No secrets in code. |
| Auto-marking "Received" without Natan's review | Calibration phase (Month 1): ALL docs → pending_review. Auto-processing only after threshold is validated. |
| Breaking existing pipeline during upgrades | Use `n8n_update_partial_workflow` for incremental changes. Test with pinned data before activating. Save workflow version before each change. |
| Airtable rate limits with concurrent updates | Documents processed sequentially per email (n8n loops). Max ~5-10 docs per email. Well within Airtable limits. |
