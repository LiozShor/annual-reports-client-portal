# Design Log 314: Classifier Fallback for Pre-Questionnaire Inbound Docs
**Status:** [BEING IMPLEMENTED — DL-314]
**Date:** 2026-04-21
**Related Logs:** DL-203 (WF05 Worker migration), DL-207 (WF05 Worker full gap audit), DL-259 (inbound notes all stages), DL-278 (classification recovery agent)

## 1. Context & Problem
When a client has not submitted their Tally questionnaire yet (stages `Send_Questionnaire` / `Waiting_For_Answers`), the inbound email pipeline captures attachments but skips LLM classification entirely. The guard is in `api/src/lib/inbound/processor.ts` line 788:

```ts
if (requiredDocs.length > 0) { /* classify */ }
```

`requiredDocs` is built from `documents` table rows with `status = 'Required_Missing'`. WF02 only populates that table after the Tally questionnaire is submitted — so for any client still at stage 1 or 2, `requiredDocs` is empty and classification never runs. The result: `pending_classifications` rows appear in AI Review with `matched_template_id: null`, no issuer, no confidence — the office has nothing to act on.

The classifier *does* have a dormant "no required docs" fallback at `document-classifier.ts:312` (`templateEnum = clientTemplateIds.length > 0 ? clientTemplateIds : [...ALL_TEMPLATE_IDS]`), but it is unreachable because the processor gates the call earlier, **and** the system prompt still instructs the LLM to only match against the required-docs list and return `null` otherwise. Two mismatched guards, both silently suppressing classification.

## 2. User Requirements
1. **Q:** What triggers the fallback?
   **A:** `requiredDocs` is empty **OR** stage ∈ {Send_Questionnaire, Waiting_For_Answers}.
2. **Q:** What template universe does the fallback expose?
   **A:** Templates matching the active report's `filing_type` (AR → non-CS; CS → CS-only).
3. **Q:** Re-classify later when questionnaire is submitted?
   **A:** No — leave fallback classifications as-is; office reassigns via existing flow.
4. **Q:** How to surface in UI?
   **A:** Badge `טרם מולא שאלון` on AI Review card + doc-manager row.
5. **Q:** Backfill?
   **A:** Yes, for CPA-XXX only (known affected client).

## 3. Research
### Domain
Document classification with dynamic schema / tool-use LLM prompting + stateful workflow stages.

### Sources Consulted
Skipped full research pass — this is a targeted bug fix against existing, well-understood code (DL-203, DL-207, DL-278). The relevant design pattern (tool-schema enum narrowing) is already in place; the fix is to reach the fallback branch and fix the prompt conflict.

### Key Principles Extracted
- **Single responsibility of gates:** one place should decide "classify or not." Today, processor.ts gates on `requiredDocs.length`; classifier's prompt gates on "only match required." These diverge. Fix: remove the processor guard, route through an explicit `fallbackMode` param that coherently rewrites both the tool enum and prompt.
- **Explicit over implicit flags:** instead of inferring fallback from `requiredDocs.length === 0`, carry an explicit `preQuestionnaire` on the classification result so downstream writers + UI don't re-derive it.

### Patterns to Use
- **Option-object parameter extension** on `classifyAttachment` — add `fallbackMode` + `filingType` to the existing options object. No breaking call-site changes.

### Anti-Patterns Avoided
- **Fabricating synthetic `requiredDocs` records** to fit the existing interface — would leak through `findBestDocMatch` and other helpers with nonsense state.
- **Auto re-classification on stage 2 → 3 transition** — adds complexity and LLM spend for little gain; office can reassign in one click.

### Research Verdict
Refactor the existing dormant fallback branch into a first-class mode. Keep backward-compat for stage-4+ clients (default path unchanged).

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `ALL_TEMPLATE_IDS` (line 31) already defines the full catalog split by prefix (`CS-` vs `T`).
  - `TEMPLATE_TITLES` (line 603) provides Hebrew titles for prompt / UI.
  - `buildClassifyTool` already has an unreachable fallback branch (line 312).
  - `pending_classifications` record schema already supports the data we need (`matched_template_id` nullable, `review_status: 'pending'` already lands it in AI Review queue).
* **Reuse Decision:** Extend existing functions with an options-object; do not duplicate.
* **Relevant Files:**
  - `api/src/lib/inbound/document-classifier.ts` — `buildClassifyTool`, `buildSystemPrompt`, `classifyAttachment`, `ClassificationResult` shape
  - `api/src/lib/inbound/processor.ts` — classification call site (line 788), `processAttachmentWithClassification` (line 433), `classFields` (line 570)
  - `api/src/lib/inbound/types.ts` — `ClassificationResult` interface
  - `api/src/routes/classifications.ts` — AI Review GET endpoint
  - `frontend/admin/js/script.js` — AI Review card renderer (stage-3 stacked cards)
  - Airtable `pending_classifications` table — add `pre_questionnaire` checkbox field
* **Existing Patterns:**
  - DL-287 Cloudflare Queues: `CLASSIFY_BATCH_SIZE = 1` + 1 s inter-batch delay → rate-limit safety still applies.
  - DL-278 recovery agent: scoped-enum tool schema; leave unchanged (early-return on empty `requiredDocs` is correct for that path).
  - Temp Worker endpoints for one-off ops (memory `reference_onedrive_temp_endpoint_pattern.md`).
* **Alignment with Research:** Codebase already follows option-object extension for classifier calls.
* **Dependencies:** Airtable `pending_classifications` schema change; Worker `wrangler deploy`.

## 5. Technical Constraints & Risks
* **Security:** Classifier runs with Anthropic API key from Worker secrets — unchanged. No new auth surface.
* **Risks:**
  - Stage-1/2 inbound volume is low, but this does add LLM cost. `CLASSIFY_BATCH_SIZE = 1` + dedup via `classification_key` upsert bound the volume.
  - Full-catalog classification may produce low-quality matches when the LLM's top candidate isn't actually something the client needs. Mitigated by the explicit badge + office reassign.
* **Breaking Changes:** None — new flag defaults to `false`; stage-4+ path unchanged.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Attachments arriving at stage 1 or 2 land in AI Review with a template assignment + `טרם מולא שאלון` badge; backfill populates templates on CPA-XXX's historical pre-questionnaire `pending_classifications` rows.

### Logic Flow
1. Processor detects pre-questionnaire condition: `requiredDocs.length === 0 || stage ∈ {Send_Questionnaire, Waiting_For_Answers}`.
2. Calls `classifyAttachment(..., { fallbackMode: true, filingType: primaryReport.filingType })`.
3. Classifier builds tool schema with enum = `scopedCatalog(filingType)` and system prompt stating no required-docs list exists.
4. Classifier returns `{ templateId, preQuestionnaire: true, matchedDocRecordId: null, ... }`.
5. Processor writes `pre_questionnaire: true` into `pending_classifications`.
6. AI Review GET passes flag through; frontend renders badge.
7. Backfill endpoint replays step 2–5 on existing `matched_template_id = null` rows for CPA-XXX.

### Data Structures / Schema Changes
- Airtable `pending_classifications` table: new **checkbox** field `pre_questionnaire`.
- `ClassificationResult` TS type: add `preQuestionnaire: boolean`.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/types.ts` | Modify | `ClassificationResult.preQuestionnaire: boolean` |
| `api/src/lib/inbound/document-classifier.ts` | Modify | `scopedCatalog` helper; `fallbackMode` + `filingType` in options; rewritten prompt + tool enum for fallback; set `preQuestionnaire` on return |
| `api/src/lib/inbound/processor.ts` | Modify | Drop `requiredDocs.length > 0` guard; compute `fallbackMode`; pass options; write `pre_questionnaire` in `classFields` |
| `api/src/routes/classifications.ts` | Modify | Map `pre_questionnaire` through GET response |
| `api/src/routes/backfill-dl314.ts` | Create | One-off endpoint `POST /webhook/backfill-dl314` (guarded by shared secret, deleted before merge) |
| `api/src/index.ts` | Modify | Register backfill route |
| `frontend/admin/js/script.js` | Modify | Render `ai-badge--warning` on AI Review card when `pre_questionnaire` |
| `frontend/admin/document-manager.html` + `frontend/assets/js/*.js` | Modify | Same badge on doc-manager rows |
| Airtable schema | Manual | Add `pre_questionnaire` checkbox field |

### Final Step (Always)
* **Housekeeping:** Update DL status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 items to `current-status.md`.

## 7. Validation Plan
* [ ] `./node_modules/.bin/tsc --noEmit` in `api/` passes
* [ ] Live test: send an email with a PDF attachment to `reports@moshe-atsits.co.il` from a client at stage `Waiting_For_Answers` — verify `pending_classifications` row has `matched_template_id` populated and `pre_questionnaire = true`
* [ ] AI Review tab shows the new card with `טרם מולא שאלון` badge
* [ ] Doc-manager for the same client shows the badge on the matching row
* [ ] Regression: stage-4 (`Collecting_Docs`) email still classifies normally, `pre_questionnaire = false`, no badge
* [ ] Backfill dry-run on CPA-XXX returns expected row count; sample matches are reasonable
* [ ] Backfill execution writes `pre_questionnaire = true` + template on all CPA-XXX affected rows
* [ ] `wrangler tail` confirms one Anthropic call per attachment (no retries, no 429 storms)
* [ ] Backfill endpoint removed before main merge

## 8. Implementation Notes (Post-Code)
* **Doc-manager badge scoped out.** Fallback classifications write to `pending_classifications` with `matched_doc_record_id: null` (no linked `documents` row). The doc-manager lists `documents` records, not classifications — so the badge naturally does not surface there. The AI Review card is the authoritative surface; when the office reassigns a fallback classification to a real doc via AI Review, the `documents` row gets the file attached but the `pre_questionnaire` flag stays on the classification record for audit purposes only.
* **Stage check uses string compare, not stage-number lookup.** `STAGE_ORDER[stage]` isn't imported in processor.ts; direct string comparison against `'Send_Questionnaire'` / `'Waiting_For_Answers'` is simpler and sufficient.
* **`findBestDocMatch` + recovery agent skipped in fallback mode.** Both operate on `requiredDocs` which is empty (or the client's list is pre-questionnaire irrelevant) — no useful output. Skipping saves an extra Haiku call per null-template case.
* **Prompt swap verified.** The rule "Do NOT invent a classification — only match against the required documents listed above." is now conditional on `!fallback`. In fallback mode the LLM is explicitly invited to pick from the full catalog.
