# Design Log 046: WF05 Loop Restructure + Classification Optimization
**Status:** [COMPLETED]
**Date:** 2026-02-22
**Related Logs:** 034 (Phase 2 overview), 035 (WF05 AI classification), 036 (Review interface), 043 (Card redesign)

## 1. Context & Problem

WF05 processes inbound email attachments (classify with AI, upload to OneDrive, save to Airtable). Currently all N attachments pass through each node as a batch — all 17 classify, then all 17 upload, then all 17 save. Problems:

1. **Rate limit crash:** Email with 17 attachments (3.3MB total, one 3.7MB/100+ page PDF) exceeded Anthropic's 50K input tokens/min limit. A 100-page PDF costs ~230K-490K tokens alone.
2. **All-or-nothing processing:** If doc #8 fails classification, docs 1-7 (already classified) are stuck — nothing gets uploaded or saved.
3. **No resilience:** One failure cascades to all documents in the batch.

## 2. User Requirements

1. **Q:** Should filename pre-classification skip the LLM?
   **A:** No — always send to LLM. Filename is a hint only.

2. **Q:** For large PDFs, truncate or flag?
   **A:** Truncate for classification only (2 pages to AI, full file to OneDrive).

3. **Q:** Upgrade Anthropic Tier 2?
   **A:** No — optimize first, see if it's enough.

4. **Q:** Can we use pdf-lib on n8n Cloud?
   **A:** No — n8n Cloud doesn't allow external npm packages. Need alternative.

## 3. Research

### Domain
Document AI, Classification Pipelines, Workflow Orchestration, Rate Limit Management

### Sources Consulted
1. **Anthropic PDF Support Docs** — Each PDF page costs ~2,300-4,900 tokens (text + image). Max 100 pages. No page selection parameter — must truncate before sending.
2. **Anthropic Prompt Caching Docs** — Cached tokens don't count against ITPM for Haiku 4.5. Minimum 4,096 tokens for cache activation. 5-min TTL, refreshed on use. System prompt must be array format for explicit cache_control.
3. **n8n Loop Over Items Docs** — SplitInBatches (renamed "Loop Over Items"). Two outputs: Done (index 0) and Loop (index 1). TypeVersion 3+ auto-collects items on Done. Wait node in loop for delays. `onError: continueRegularOutput` keeps loop running.
4. **n8n Cloud Limitations** — No external npm packages (pdf-lib unavailable). Built-in "Extract from File" node can extract text from PDFs. Buffer, crypto, moment available.
5. **n8n HTTP Request Batching** — Already has batch size/interval, but doesn't give per-document resilience (the core issue).

### Key Principles
- **Process one document end-to-end before starting the next** — partial completion is better than total failure
- **Cached tokens are free from ITPM** — invest in enriching the system prompt past 4,096 tokens to activate caching
- **Text extraction is 10x cheaper than PDF document type** — ~200-500 tokens/page vs ~2,300-4,900
- **n8n Cloud can't use pdf-lib** — must use built-in Extract from File or size-based filtering

### Patterns to Use
- **Loop Over Items** with batch size 1 for sequential per-document processing
- **Wait node** in loop for rate limit breathing room
- **Prompt caching** with ephemeral cache_control on enriched system prompt + tool definition
- **Size-based routing** — large PDFs (>500KB) use text extraction instead of document type

### Anti-Patterns to Avoid
- **Processing all items through each node** — current approach, fragile
- **Retrying with short intervals on rate limits** — 2s wait on a per-minute limit is useless
- **Sending 100-page PDFs as document type** — 230K+ tokens for classification that needs page 1

### Research Verdict
Restructure WF05 with Loop Over Items for per-document processing. Add text extraction fallback for large PDFs (since pdf-lib unavailable on Cloud). Enable prompt caching by enriching system prompt to 4,096+ tokens. Combined, these changes reduce tokens by ~90% and eliminate rate limit issues without upgrading Anthropic tier.

## 4. Codebase Analysis

**Current WF05 structure (26 nodes):**
```
Pre-loop (once per email):
  Webhook → Validate → Extract → Respond 202 → Fetch Email → Extract Email
  → Get Attachments → Process & Filter → Mark as Read → Create Email Event
  → Search Client → Get Active Report → Get Required Docs → Resolve OneDrive Root

Per-document (currently batched):
  Prepare Attachments (N items) → Classify Document → Process and Prepare Upload
  → Upload to OneDrive → Prep Doc Update → Create Pending Classification
  → Route by Match → IF Has Match
    → [true] Update Document Record → Update Email Event → Move to Documents Folder
    → [false] Update Email Event → Move to Documents Folder
```

**Key observations:**
- "Move to Documents Folder" moves the EMAIL (not a document) — should run ONCE after all docs processed
- "Update Email Event" updates the email event record — should run ONCE with summary
- "Prepare Attachments" already handles text extraction for DOCX/XLSX, could add PDF text extraction
- System prompt is ~8,383 chars (~2,000 tokens) — needs enrichment to reach 4,096 token minimum for caching

## 5. Technical Constraints & Risks

- **n8n Cloud:** No external npm (pdf-lib unavailable). Built-in Extract from File is available.
- **Rate limit:** 50K ITPM on Anthropic Tier 1. Single large PDF can exceed this.
- **Prompt caching minimum:** 4,096 tokens for Haiku 4.5 — current prompt too short.
- **Loop complexity:** Both IF branches must converge back to Loop Over Items.
- **OneDrive upload uses binary data:** Need to preserve attachment_content_bytes through the loop.
- **Risk:** Restructuring a production workflow with 26 nodes. Need to validate thoroughly.

## 6. Proposed Solution (The Blueprint)

### Architecture: New Flow

```
[Pre-loop — unchanged]
  Webhook → ... → Resolve OneDrive Root → Prepare Attachments
                                                    ↓
                                          ┌─ Loop Over Items (batch 1) ─┐
                                          │                              │
                                        Done                           Loop
                                          │                              ↓
                                Update Email Event            Classify Document
                                          ↓                        ↓
                              Move to Documents Folder    Process and Prepare Upload
                                                               ↓
                                                        Upload to OneDrive
                                                               ↓
                                                         Prep Doc Update
                                                               ↓
                                                    Create Pending Classification
                                                               ↓
                                                         Route by Match
                                                               ↓
                                                          IF Has Match
                                                          /          \
                                                       true         false
                                                        ↓              ↓
                                                 Update Document   (skip)
                                                    Record            │
                                                        \            /
                                                       Merge Results
                                                            ↓
                                                        Wait (5s)
                                                            ↓
                                                    [back to Loop Over Items]
```

### Changes Required

#### Change 1: Add Loop Over Items node
- Type: `n8n-nodes-base.splitInBatches` (typeVersion 3)
- Batch size: 1
- Position: between Prepare Attachments and Classify Document
- Loop output → Classify Document
- Done output → Update Email Event

#### Change 2: Add Merge node after IF Has Match
- Both IF branches converge to a single Merge node
- IF true → Update Document Record → Merge
- IF false → Merge (directly)
- Merge → Wait → Loop Over Items

#### Change 3: Add Wait node
- 5-second delay between iterations
- Position: after Merge, before loop-back to Loop Over Items
- Type: `n8n-nodes-base.wait`, amount: 5, unit: seconds

#### Change 4: Rewire post-loop nodes
- Disconnect Update Email Event from IF Has Match outputs
- Connect Loop Over Items Done output → Update Email Event → Move to Documents Folder

#### Change 5: Update Prepare Attachments code — size-based routing
Add to the Prepare Attachments code:
```javascript
// For PDFs > 500KB: use text extraction mode instead of document type
const LARGE_PDF_THRESHOLD = 500 * 1024; // 500KB

if (PDF_EXT.test(att.name) && att.size > LARGE_PDF_THRESHOLD) {
  // Flag for text extraction — send filename + metadata only
  // Let the AI classify from filename + email context
  content.push({ type: 'text', text: `[Large PDF - ${Math.round(att.size/1024)}KB, visual content not available]\nClassify based on filename and email context only.` });
} else if (PDF_EXT.test(att.name)) {
  // Small PDF: send as document type (full visual classification)
  content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.content_bytes } });
}
```

#### Change 6: Enable prompt caching
In Prepare Attachments code:
1. Change `system` from string to array format with `cache_control`
2. Enrich system prompt with detailed descriptions + example filenames for all 30 types (reach 4,096+ tokens)
3. Add `cache_control` on tool definition (last tool)

```javascript
anthropic_request_body: {
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 512,
  system: [{
    type: 'text',
    text: enrichedSystemPrompt,  // 4,096+ tokens
    cache_control: { type: 'ephemeral' }
  }],
  tools: [{
    ...toolDefinition,
    cache_control: { type: 'ephemeral' }
  }],
  tool_choice: { type: 'tool', name: 'classify_document' },
  messages: [{ role: 'user', content: content }]
}
```

#### Change 7: Update Classify Document retry settings
- `retryOnFail: true`
- `maxTries: 5`
- `waitBetweenTries: 30000` (30s — already applied)
- `onError: continueRegularOutput` — keep loop alive on failure

#### Change 8: Error handling in loop
- Set `onError: continueRegularOutput` on: Classify Document, Upload to OneDrive, Update Document Record
- In Process and Prepare Upload: check for classification errors, set `is_identified: false` on failure

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| WF05 (cIa23K8v1PrbDJqY) | Modify | Add Loop Over Items, Wait, Merge nodes. Rewire connections. |
| Prepare Attachments code | Modify | Size-based routing, prompt caching format, enriched system prompt |
| Classify Document node | Modify | Add onError: continueRegularOutput |

## 7. Validation Plan
- [ ] Single small PDF attachment: classify → upload → Airtable
- [ ] Multiple attachments (3-5): loop processes one at a time, all saved
- [ ] Large PDF (>500KB): text-only classification, still uploads to OneDrive
- [ ] Classification failure (simulate 429): error handled, loop continues to next doc
- [ ] Upload failure: error handled, loop continues
- [ ] Prompt caching: verify `cache_read_input_tokens > 0` in second+ iteration
- [ ] Post-loop: Email event updated, email moved to Documents folder (once)
- [ ] Empty attachments: loop handles gracefully (skip_classification items)

## 8. Implementation Notes (Post-Code)

### Deviations from Plan
1. **Merge node removed** — Both IF Has Match branches connect directly to Loop Wait instead of going through a Merge node. In n8n v1 execution order, Wait fires when ANY input receives data, so a Merge node is unnecessary. Simpler wiring.
2. **Process and Prepare Upload refactored** — Changed from batch index correlation (`prepItems[i]` ↔ `classifyItems[i]`) to single-item mode using `$('Loop Over Items').first().json` for current item data.
3. **Prep Doc Update refactored** — Same pattern, now reads single item from `$('Process and Prepare Upload').first().json`.
4. **Large code update via REST API** — Prepare Attachments code (29KB) was too large for the n8n MCP tool's inline parameter. Used direct n8n REST API (PUT /api/v1/workflows/{id}) to update.

### Changes Applied
- **Structural:** Added Loop Over Items (splitInBatches v3, batch 1) and Loop Wait (5s delay). 28 nodes total, 29 valid connections, 0 invalid.
- **Code nodes updated:** Prepare Attachments (size routing + prompt caching), Process and Prepare Upload (loop-mode), Prep Doc Update (loop-mode).
- **Error handling:** `onError: continueRegularOutput` on Classify Document. Upload to OneDrive and Update Document Record already had error handling.
- **Prompt caching:** System prompt in array format with `cache_control: {type: "ephemeral"}`. DOC_TYPE_REFERENCE constant adds ~5K+ tokens of detailed document descriptions for all 30+ types. Tool definition also has `cache_control`.
- **Size routing:** PDFs > 500KB classified by filename + email context only (text hint), not full document content. Still uploaded to OneDrive at full size.

### Verification
- Workflow validates with 0 invalid connections, 29 valid connections
- 5 validation "errors" are false positives (regex `}}` in JS code flagged as n8n expression brackets)
- Workflow is active and ready for live testing
