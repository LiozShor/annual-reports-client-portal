# Design Log 278: Classification Recovery Agent
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-15
**Related Logs:** DL-245 (agentic classification workflows — draft research), DL-195 (tool_use parsing fix), DL-277 (429 retry + re-classify)

## 1. Context & Problem
Haiku's document classifier returns correct `evidence`, `issuer_name`, and high `confidence` (0.95) but `matched_template_id: null` — a systemic bug affecting **9 out of 82 pending classifications** (11% failure rate). The AI does the hard work (reading PDFs, identifying document types) correctly, but drops the structured output field that maps to a template ID.

Additionally:
- **4 records** have a valid `matched_template_id` but `findBestDocMatch` returned no doc link (template exists but no matching required doc found — likely issuer key mismatch or missing required doc record)
- **4 records** failed with 429 rate limit errors that escaped the existing 3-retry loop

Total: **17 out of 82 pending records (21%)** have broken or missing classifications.

## 2. User Requirements
1. **Q:** When should the recovery agent fire?
   **A:** All three categories: null template + high conf, doc-match failures, and 429 failures.

2. **Q:** What model for recovery?
   **A:** Haiku (same as classifier — cheap, text-only call).

3. **Q:** Should recovery also fix issuer_name?
   **A:** Template ID only. Keep it focused.

4. **Q:** Logging?
   **A:** Console warn (visible in Worker logs).

5. **Q:** CS templates in scope?
   **A:** No — CS is not in production yet. AR templates only.

## 3. Research
### Domain
LLM Structured Output Validation, Evaluator-Optimizer Pattern

### Sources Consulted
1. **Anthropic Evaluator-Optimizer Cookbook** — Core loop: generator → evaluator → feedback → retry until PASS. Key insight: recovery agent doesn't need the full document — just the evidence text + required docs list.
2. **LLM Structured Outputs: Schema Validation for Real Pipelines (Collin Wilkins, 2026)** — Validation-retry pattern: validate output, ask model to fix using validation message. Track retry rates — if a prompt consistently needs 2+ retries, fix the prompt.
3. **Anthropic Claude Structured Outputs docs** — Tool use with `strict: true` reduces format errors but doesn't prevent semantic errors (model returns null when it should return a value). Still need defensive handling.

### Key Principles Extracted
- **Recovery is cheaper than retry**: Don't re-send the PDF. The evidence text already contains everything needed to pick a template ID. A text-only recovery call costs ~200 input tokens vs ~10K+ for re-classification with PDF.
- **Single retry, not a loop**: For our case, one recovery attempt is sufficient. If the recovery agent also returns null, accept the failure — don't burn tokens in a loop.
- **Different prompt, same model**: The recovery prompt should be simpler and more directive than the classifier prompt. No ambiguity — just "given this evidence, pick the template."

### Patterns to Use
- **Evaluator-Optimizer (simplified)**: Classifier = generator, recovery agent = evaluator that also fixes. Single pass, no loop.
- **Validation gate**: Check structured output fields before returning. If `templateId` is null but `confidence >= 0.5` and `reason` is non-empty, trigger recovery.

### Anti-Patterns to Avoid
- **Re-sending the full document**: Wasteful — the evidence already summarizes the document.
- **Retry loop**: Overkill for a mapping task. One shot is enough.
- **Modifying the original classifier prompt**: The classifier works 89% of the time. Don't risk regression for the 11% edge case.

### Research Verdict
Implement a lightweight single-pass recovery agent that fires when the classifier returns high confidence but null template ID. Text-only Haiku call with the evidence + required docs list. Also handle 429 failures with a deferred re-classification.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `fetchWithRetry()` (document-classifier.ts:714-735) — 429 retry with exponential backoff
  - `findBestDocMatch()` (document-classifier.ts:558-588) — matches templateId to required doc records
  - Re-classify endpoint (classifications.ts:838-914) — re-runs full classification from OneDrive file
  - `CLASSIFY_TOOL` schema (document-classifier.ts:307-369) — full tool with 6 required fields

* **Reuse Decision:**
  - Reuse `findBestDocMatch()` after recovery to link the recovered templateId to a doc record
  - Reuse `fetchWithRetry` pattern for the recovery API call
  - New: simpler `RECOVERY_TOOL` schema (only `matched_template_id` + `confidence`)
  - New: `recoverTemplateId()` function — lightweight AI call

* **Relevant Files:**
  - `api/src/lib/inbound/document-classifier.ts` — main file to modify
  - `api/src/lib/inbound/types.ts` — ClassificationResult type (no changes needed)
  - `api/src/lib/inbound/processor.ts` — no changes needed (recovery happens inside classifyAttachment)

* **Alignment with Research:** The codebase already follows the "validate then fix" pattern (429 retry). Recovery agent extends this to semantic validation (null template with good evidence).

## 5. Technical Constraints & Risks
* **Security:** Recovery agent uses the same Anthropic API key. No new secrets needed.
* **Risks:**
  - Recovery agent could return a wrong templateId (mitigated by confidence check + existing admin review step)
  - Additional API call adds latency (~200ms for text-only Haiku) — acceptable since it only fires on failures
  - Rate limiting — recovery call could itself get 429'd (mitigated by reusing fetchWithRetry pattern)
* **Breaking Changes:** None — recovery is additive, only fires on previously-null results

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Recovery agent fixes ≥80% of "null template + high confidence" cases (currently 9 records), bringing overall classification success rate from 73% to ~85%+.

### Logic Flow

#### A. Template Recovery (null template + good evidence)
1. After parsing the classifier's tool_use response (line 823), check: `templateId === null && confidence >= 0.5 && reason.length > 10`
2. Call `recoverTemplateId()` — a lightweight Haiku call with:
   - System: "You are a template matcher. Given document evidence and a list of required templates, pick the best match."
   - User: The evidence text + required docs list (formatted as `TYPE: issuer_name`)
   - Tool: `recover_template` with `matched_template_id` (enum) + `confidence` (number)
3. If recovery returns a valid templateId with confidence >= 0.5:
   - Override `input.template_id` with recovered value
   - Log: `console.warn('[classifier] Recovery agent matched {templateId} for "{attachment.name}"')`
   - Run `findBestDocMatch()` to link to a doc record
4. If recovery fails or returns null: keep original null result (no change)

#### B. Doc-Match Recovery (template exists, no doc link)
After the existing `findBestDocMatch()` call (line 794), if `matchedDocRecordId` is null but `templateId` exists:
- This is an issuer mismatch or missing required doc — **no recovery needed at classifier level**
- The admin review UI already handles reassignment
- Skip for now (existing flow is correct)

#### C. 429 Failure Recovery
The existing `fetchWithRetry()` already retries 3 times. The 4 failed records in Airtable escaped all retries.
- **No code change needed** — use the existing re-classify endpoint (DL-277) to manually re-process these
- Optionally increase MAX_RETRIES from 3 to 5 (cheap insurance)

### Data Structures / Schema Changes
No Airtable schema changes. New tool schema in code only:

```typescript
const RECOVERY_TOOL = {
  name: 'recover_template',
  description: 'Match document evidence to the correct template ID from the required documents list.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      matched_template_id: {
        type: 'string',
        enum: [...ALL_TEMPLATE_IDS],
        description: 'The template ID that best matches the document evidence.'
      },
      confidence: {
        type: 'number',
        description: 'Confidence in the match (0.0-1.0).'
      }
    },
    required: ['matched_template_id', 'confidence']
  }
};
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/document-classifier.ts` | Modify | Add `RECOVERY_TOOL` schema, `recoverTemplateId()` function, hook into classifyAttachment after line 823 |

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status.md, commit & push, merge to main

## 7. Validation Plan
* [ ] Deploy and send a test email with a document that previously triggered null template (e.g., טופס 867 from אקסלנס טרייד)
* [ ] Check Worker logs for recovery agent activation (`[classifier] Recovery agent matched...`)
* [ ] Verify the pending classification record in Airtable has correct `matched_template_id` and `document` link
* [ ] Use re-classify endpoint on existing 9 broken records to verify they now get recovered
* [ ] Confirm no regression on already-working classifications (the 60 matched records)
* [ ] Check that recovery agent does NOT fire when classification succeeds normally (no unnecessary API calls)

## 8. Implementation Notes (Post-Code)
* Recovery agent placed inside `classifyAttachment()` after initial doc matching — fires only when `templateId` is null + confidence >= 0.5 + evidence > 10 chars
* Used `strict: true` on RECOVERY_TOOL to enforce enum compliance — recovery agent MUST return a valid template ID (no null option)
* Recovery prompt includes explicit mapping rules (106→T201, 867→T601, etc.) to guide Haiku
* MAX_RETRIES on main classifier bumped 3→5 per plan
* Research principle applied: "Recovery is cheaper than retry" — text-only call ~200 tokens vs ~10K+ for full re-classification with PDF
