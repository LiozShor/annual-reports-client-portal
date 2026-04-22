# Design Log 321: Classifier Explicit Non-Document Verdict
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-22
**Related Logs:** DL-303 (inline attachment filter), DL-305 (raise inline threshold 20→50KB), DL-315 (pre-questionnaire classifier fallback), DL-195 (tool_use response parsing), DL-245 (agentic classification research)

## 1. Context & Problem

Decorative email-header images slip past the DL-303/DL-305 inline-image filter (50KB size cutoff) and reach the AI classifier. The current classifier tool schema forces the model to produce a `matched_template_id` guess even when the attachment is obviously not a document — so the row lands in `pending_classifications` with `review_status: 'pending'` and burns a human cycle to be rejected manually.

**Live example that triggered this log:** A client (CPA-XXX, 2026-04-20 inbound), attachment `ATT00001.png`, 62,195 bytes (~60KB — above the 50KB cutoff). Haiku correctly identified it: _"זה תמונה המציגה כותרת עברית 'הורכב תורים — משכנו חיים' עם שלוש סמלים (עין, לב, בית). זוהי תמונה סימלית בלבד ללא תוכן מסמך ממשי... זוהי עמוד כותרת או איור דקורטיבי."_ — then it still queued for human review, which rejected it 2026-04-22 with `not_relevant`.

Both DL-303 and DL-305 were live at ingest time. The AI _already_ made the correct call; the gap is that we force it to guess a template anyway instead of letting it say "this isn't a document."

Every decorative image through AI Review = 1 Anthropic classification call + office staff time. Across 500+ clients and common Outlook/Gmail auto-inserted header graphics, this is a real and recurring papercut.

## 2. User Requirements

1. **Q:** Can't the LLM judge whether it's a logo or similar and not add it to classified?
   **A:** Yes — that's the goal of this DL.

2. **Q:** How should the classifier express "this isn't a real document"?
   **A:** New `is_document: false` field on the tool schema. Simplest to reason about; one short-circuit in WF05/processor.

3. **Q:** When classifier returns non-document, what happens downstream?
   **A:** Skip the Airtable insert entirely. Classification never reaches `pending_classifications` — no review queue entry, no Airtable row. Log to Worker observability only.

4. **Q:** Which non-document categories should the classifier handle?
   **A:** Decorative / header / logo images, email signatures that escaped the size filter, empty/blank scanned pages. _Not_ raising the DL-305 size threshold (would risk dropping legitimate small scanned docs).

5. **Q:** Backfill historical decorative-image records?
   **A:** No — forward-only.

## 3. Research

### Domain
Document AI / Classification Pipeline Design — specifically pre-classifier rejection and taxonomy shape.

### Sources Consulted
1. **"Document Classification: End-to-End ML Workflow" (Label Your Data, 2026)** — Filtering non-documents before the classifier is a standard first-stage step; OCR/classification pipelines consistently recommend cheap gating before the expensive model.
2. **"LLM-as-classifier: Semi-Supervised, Iterative Framework" (arXiv 2508.16478)** — Fine-grained rejection taxonomies outperform coarse ones; clearly-defined category labels reduce over-refusal (false negatives on real content).
3. **"OR-Bench: An Over-Refusal Benchmark" (arXiv 2405.20947)** — Over-refusal (rejecting innocuous inputs) is the central risk when you let a classifier preemptively discard inputs. Needs guardrails.

### Key Principles Extracted
- **Early rejection saves cost** — a decorative image should not pay the full pipeline (Airtable row + KV cache + human review). The cheap signal is "the model itself already said it's not a document."
- **Fine-grained > coarse** — an enum (`decorative | signature | blank_page | other`) is more diagnosable than a plain boolean, even though we branch on the boolean.
- **Over-refusal is the failure mode** — an aggressive classifier that drops a real T501 PDF because it looks noisy is far costlier than leaving a few decorative images in the queue. The bias must lean toward "when in doubt, classify it."

### Patterns to Use
- **Confidence floor** — only short-circuit when `confidence >= 0.8`. Low-confidence non-doc verdicts fall through to human review. Matches DL-269's "partial contract" handling: uncertain → show to human.
- **Type-restricted short-circuit** — image-only for v1. PDFs that look non-document are rare and expensive-if-wrong; keep them in review. (Parallels DL-303 narrowing its `isInline` filter to images only.)
- **Observability-first** — every short-circuit emits a `logError` (non-error severity, `category: 'classifier_non_document'`) so false-positive rate is measurable from the UptimeRobot/error-log feed (DL-180 infrastructure).

### Anti-Patterns to Avoid
- **Raising the size threshold again** — tempting but fragile. Legitimate client-scanned receipts can be <100KB, so an even-higher cutoff will eventually drop real docs. The image-content heuristic we need is "does it look like a document?" — which is what the LLM is already good at.
- **Post-classification filter** (keep schema, add downstream drop rule) — fuzzier, harder to maintain, and gives the LLM no proper slot to express the verdict.
- **Rich `document_type` enum in v1** — scope creep. We want the boolean shortcut; an enum of signature/decorative/blank is the _reason_ field, not the decision field.

### Research Verdict
Add a `is_document: boolean` (required) and `non_document_reason: enum` (required when false) to the classifier tool schema. Short-circuit the processor insert when `is_document=false` AND image type AND `confidence >= 0.8`. Forward-only. No backfill. Log every drop.

## 4. Codebase Analysis

### Existing Solutions Found
- **Classifier entrypoint:** `api/src/lib/inbound/document-classifier.ts:770` — `classifyAttachment(pCtx, attachment, requiredDocs, clientName, emailMetadata)`. Already extended by DL-315 with `fallbackMode` + `filingType` on `emailMetadata`.
- **Tool schema builder:** `document-classifier.ts:317-389` — `buildClassifyTool()`. Current required fields: `evidence, issuer_name, confidence, additional_matches, contract_period, matched_template_id`. Strict mode enabled.
- **System prompt:** `document-classifier.ts:408-537`. Has an inlined `DOC_TYPE_REFERENCE` block (298 lines of Israeli tax doc specs). Ephemeral cache control applied. This is where non-document category definitions should be added.
- **Anthropic call:** `document-classifier.ts:846-877`. Model: `claude-haiku-4-5-20251001`, `max_tokens: 512`.
- **Return shape (`ClassificationResult`):** `api/src/lib/inbound/types.ts:133-145`. Already has `templateId, confidence, reason, issuerName, matchedDocRecordId, matchedDocName, matchQuality, additionalMatches?, contractPeriod?, preQuestionnaire?`. Adding `isDocument` + `nonDocumentReason?` is additive.
- **Airtable write (SHORT-CIRCUIT POINT):** `api/src/lib/inbound/processor.ts:570-612` — `processAttachmentWithClassification()`. `classFields` built 570-608, `airtable.createRecords(TABLES.PENDING_CLASSIFICATIONS, ...)` called at 610-612. Inserting a guard immediately before 568 is the cleanest point.
- **OneDrive upload path:** Phase B sequential upload runs inside the same `processAttachmentWithClassification` flow. Short-circuit must be placed before OneDrive too (no point uploading decorative garbage to a client folder).
- **Inline-image filter (DL-303/305):** `api/src/lib/inbound/attachment-utils.ts:28-40` — `filterValidAttachments()`. Untouched by this DL.

### Reuse Decision
Extend existing tool schema and `ClassificationResult` type. New guard in `processor.ts` is ~5-10 lines; no new module. Reuses DL-180 `logError` for observability.

### Alignment with Research
- Early-rejection pattern: matches Label Your Data's "pre-filter before classifier" — ours is "pre-filter before Airtable," which is the same principle one stage later.
- Fine-grained reason: enum matches SORRY-Bench's fine-grained-taxonomy finding.
- Over-refusal guardrails (confidence floor + image-only) directly address OR-Bench's central concern.

### Dependencies
- Anthropic Messages API (Haiku 4.5 tool-use)
- Airtable `pending_classifications` table (`tbloiSDN3rwRcl1ii`) — unchanged schema
- DL-180 `logError` in `api/src/lib/error-logger.ts`
- No n8n workflow changes (WF05 was migrated to Worker in DL-203)

## 5. Technical Constraints & Risks

* **Over-refusal (primary risk):** model drops a real document. Mitigations: confidence >= 0.8 floor; image-only short-circuit; observability log every drop; add a rollback switch (env var flag).
* **Prompt caching:** the DL-315 `fallbackMode` system prompt is ephemeral-cached. Adding a non-document section to the prompt will require a cache rebuild on first call — one-shot cost, not recurring.
* **Tool-use strict mode:** `strict: true` is enabled; new required fields must be added carefully to avoid schema validation rejects on the Anthropic side. `is_document` is simple boolean, safe. `non_document_reason` should be `required` only conditionally — in practice we'll make it `required` always and let the model emit `"other"` when `is_document=true` is the answer. (Simpler than JSON-schema conditionals.)
* **Backwards compat:** No existing consumer of `ClassificationResult.isDocument` — it's a new optional field downstream of the processor. Safe.
* **Security / PII:** Log payload includes `attachment_name` + `size` + `ai_reason` — all already logged elsewhere. No new PII surface.

## 6. Proposed Solution

### Success Criteria
A decorative inbound image (the CPA-XXX `ATT00001.png` class of file) gets `is_document: false` + `non_document_reason: "decorative"` with confidence ≥0.8, never appears in `/webhook/get-pending-classifications`, emits one observability log. Real tax documents (T501, T401, contracts, receipts) are unaffected.

### Logic Flow
1. Inbound email arrives → DL-303/305 inline-filter keeps it (image >50KB or non-image).
2. Processor batch calls `classifyAttachment` (unchanged).
3. Classifier Haiku call runs the **new** tool schema — model returns `is_document: true|false` + all existing fields + `non_document_reason`.
4. `classifyAttachment` parses tool-use result (existing logic + new fields) → `ClassificationResult`.
5. `processAttachmentWithClassification` **new guard** (before L568):
   - If `classification.isDocument === false` AND attachment MIME is image (`image/*`) AND `classification.confidence >= 0.8`:
     - `logError(ctx, env, { endpoint: 'inbound-processor', category: 'classifier_non_document', details: { attachment_name, size, non_document_reason, ai_reason, client_id } })`
     - `return` — skip OneDrive upload, skip Airtable insert.
   - Else → fall through to existing flow.

### Data Structures / Schema Changes

**Tool schema (`document-classifier.ts`):**
```json
"is_document": {
  "type": "boolean",
  "description": "Set FALSE only for: (1) decorative/header/logo images with no document content, (2) email signature images (even >50KB), (3) blank/empty scanned pages. Set TRUE for anything that could plausibly be a tax document, receipt, form, contract, or statement — even low-quality scans. When in doubt, TRUE."
},
"non_document_reason": {
  "type": "string",
  "enum": ["decorative", "signature", "blank_page", "not_applicable"],
  "description": "Required. When is_document=true, set to 'not_applicable'. Otherwise the category of non-document."
}
```

**TypeScript (`types.ts:133-145` — `ClassificationResult`):**
```typescript
isDocument: boolean;                                 // NEW (default true if missing)
nonDocumentReason?: 'decorative' | 'signature' | 'blank_page' | 'not_applicable';  // NEW
```

**Airtable:** no schema change. Decorative records simply never land.

### System Prompt Addition
Append a short section after `DOC_TYPE_REFERENCE` (~L308):

```
## Non-Document Attachments

Some inbound attachments are NOT documents. Set is_document=false for:
- **decorative**: Hebrew/English header graphics, symbolic icons (eye/heart/house), branded email banners, company logos standing alone
- **signature**: Email signature images (handwritten-style names, stamp graphics) — even if larger than typical signatures
- **blank_page**: Completely empty scans, white pages with only scanner noise

Set is_document=true for ANY file that plausibly contains:
- tax forms, receipts, contracts, insurance statements, bank statements,
  pension/provident statements, donation receipts, medical receipts,
  rental agreements — even if low-quality, partial, or in an unexpected layout

When in doubt, set is_document=true and let a human decide.
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/document-classifier.ts` | Modify | `buildClassifyTool()` add 2 fields; system prompt add non-document section; tool-use parse result into `isDocument` + `nonDocumentReason` |
| `api/src/lib/inbound/types.ts` | Modify | `ClassificationResult` + `isDocument`, `nonDocumentReason` |
| `api/src/lib/inbound/processor.ts` | Modify | New guard before L568 in `processAttachmentWithClassification` |
| `.agent/design-logs/ai-review/321-classifier-non-document-verdict.md` | Create | This log |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-321 row |

### Final Step (Always)
Housekeeping: update DL status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items to `.agent/current-status.md`, push feature branch, `wrangler deploy` from `api/`, surface merge-approval request to user (per user memory `feedback_ask_before_merge_push`).

## 7. Validation Plan

- [ ] **Anthropic Workbench dry-run:** paste new system prompt + tool schema + 3 test inputs: (a) `ATT00001.png` decorative header (Hebrew title + icons); (b) real T501 insurance PDF first page; (c) blank scanned page. Expected: a→{is_document:false, reason:"decorative", conf≥0.8}, b→{is_document:true, reason:"not_applicable", matched T501}, c→{is_document:false, reason:"blank_page"}.
- [ ] **TypeScript build passes** (`./node_modules/.bin/tsc --noEmit` in `api/`).
- [ ] **Worker dry-run deploy** (`npx wrangler deploy --dry-run` from `api/`).
- [ ] **Live test 1 (short-circuit fires):** Send a test email to `reports@moshe-atsits.co.il` with a decorative PNG attachment (can reuse CPA-XXX `ATT00001.png`). Confirm: no new row in `pending_classifications`; one log event with `category: 'classifier_non_document'` + `non_document_reason: 'decorative'`; OneDrive folder untouched.
- [ ] **Live test 2 (real doc still works):** Send a test email with a real T501 PDF. Confirm: normal AI Review behaviour — card appears, classified as T501, no short-circuit log event.
- [ ] **Live test 3 (over-refusal guardrail):** Send a blurry/low-quality scan of a real receipt. Expected: classifier either classifies normally OR returns `is_document:false` with `confidence < 0.8` (falls through to human review). MUST NOT be silently dropped.
- [ ] **Observability check:** Within 24h of deploy, query error log for `category: 'classifier_non_document'` — spot-check 5 entries. If any look like real-doc false-positives, roll back.
- [ ] **No regression in DL-315 `preQuestionnaire` path:** send a decorative image to a client who hasn't submitted the Tally questionnaire yet. Expected: still short-circuits (fallbackMode doesn't bypass the guard).

## 8. Implementation Notes (Post-Code)

- **Files edited:**
  - `api/src/lib/inbound/types.ts` — added `isDocument?: boolean` + `nonDocumentReason?` enum to `ClassificationResult`.
  - `api/src/lib/inbound/document-classifier.ts` — added `is_document` + `non_document_reason` to the tool schema (both required); added "NON-DOCUMENT detection (DL-321)" section to the system prompt after the commonly-confused-pairs block; extended the tool-use parser's internal `input` type + mapping; return shape now includes `isDocument` + `nonDocumentReason`.
  - `api/src/lib/inbound/processor.ts` — short-circuit guard at the top of `processAttachmentWithClassification()` (before hash dedup, before OneDrive, before Airtable). Image-only, confidence ≥ 0.8. Emits `console.warn` tagged `[inbound][DL-321]` with `{name, size, reason, conf, client, evidence}` — searchable in Worker logs (no Airtable error-log spam; `logError` taxonomy is `DEPENDENCY|VALIDATION|INTERNAL` and this isn't an error).
- **Defaulting:** missing `is_document` in Anthropic response is treated as `true` (safer default — bias toward review, not toward drop). Missing `non_document_reason` treated as `'not_applicable'`.
- **TS build:** clean for DL-321 edits. Two pre-existing errors unrelated to this DL:
  1. `api/src/routes/backfill.ts:29` references `Env.ADMIN_SECRET` (not in `Env` type).
  2. `api/src/routes/classifications.ts:937` references `ClassificationResult.pageCount` (not in the interface).
  Neither touched by this DL; both predate the branch.
- **Guardrails applied:**
  - Image-only (PDF `is_document=false` still gets inserted — V1 over-refusal safety).
  - Confidence floor 0.8 — matches DL-269 "uncertain → show human" pattern.
  - Prompt explicitly biases toward `is_document=true` when in doubt.
- **Research principles applied:**
  - *Early-rejection* (Label Your Data doc-classification pipeline): drop cheaply before expensive downstream state.
  - *Over-refusal as primary failure mode* (OR-Bench): every guardrail in the design points toward false-negatives (real docs dropped) being worse than false-positives (decorative images reaching review).
  - *Fine-grained rejection taxonomy* (SORRY-Bench / LLM-as-classifier paper): boolean decision + 4-value reason enum gives the model a proper slot to express the verdict.
