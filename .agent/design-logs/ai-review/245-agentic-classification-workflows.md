# Design Log 245: Agentic Classification Workflows — Multi-Agent Robustness for WF05

**Status:** [DRAFT — RESEARCH PROPOSAL]
**Date:** 2026-04-09
**Related Logs:** DL-203 (WF05 Worker migration), DL-207 (WF05 full gap audit), DL-237 (manual PDF split + re-classify), DL-143 (classification bugfixes), DL-195 (tool_use parsing fix), DL-210 (review bugfixes), DL-131 (NII enum enforcement)

## 1. Context & Problem

The WF05 inbound classifier (`api/src/lib/inbound/document-classifier.ts` + `processor.ts`) is a **single-pass, single-model pipeline**:

```
Attachment → Haiku (claude-haiku-4-5) with tool_use → template_id + confidence + issuer → Airtable
```

One Haiku call per attachment, one shot. Whatever comes back is written to `pending_classifications` and the admin reviews manually in the AI Review tab. The only "robustness" today is:
- Hash-based dedup (exact file match)
- Invalid-PDF-header fallback to filename-only classification
- Large-PDF (>5MB) fallback to filename-only classification
- Manual human review after the fact

### Observed failure modes in the current code

| # | Edge case | Where it lives | What actually happens |
|---|-----------|----------------|----------------------|
| **EC-1** | **Multi-form PDFs** — client scans Form 106 + bank statement + ID appendix as one 5-page PDF | `classifyAttachment()` sends whole PDF as one `document` content block | Haiku picks ONE template for the entire file. The other 2 docs are lost until admin manually splits (DL-237 — manual only, admin-triggered). No automated detection. |
| **EC-2** | **Low confidence, high-stakes doc** — e.g., Form 106 (T201/T202 — primary income doc, client vs spouse disambiguation) returned at confidence 0.55 | `document-classifier.ts:756` — `< 0.5 → null`, `>= 0.5 → accept as-is` | Binary cutoff. A 0.55-confidence Form 106 is treated identically to a 0.95-confidence one. No second opinion from a stronger model. |
| **EC-3** | **Commonly-confused pairs** (T401↔T501, T201↔T202, T901↔T1601) | System prompt lists them verbatim (`document-classifier.ts:443-450`) | Haiku is warned via prompt but given no reinforcement. Historical bugs: DL-131 (NII enum misclassification), DL-143 (T401/T501 flip). |
| **EC-4** | **No structured data extraction** | Tool schema returns only `matched_template_id`, `confidence`, `evidence`, `issuer_name`, `additional_matches` | Office has to open each PDF to read Gross/Tax/Employer ID. Form 106s have a perfectly structured numbered table (sections 1-36) — a goldmine the pipeline ignores. |
| **EC-5** | **Large PDF skip** — anything >5MB classified from filename only (`LARGE_PDF_THRESHOLD`, line 486) | `classifyAttachment()` sets `userPromptText` to metadata-only | Single-pass guess with no content. No fallback path to split the large PDF and re-try. |
| **EC-6** | **Invalid PDF header** (DL-210 bug 4) | Falls back to filename-only | Same as EC-5 — no retry or content recovery attempt. |
| **EC-7** | **Sonnet as auditor never triggers** | No such code path exists | Current system has no "second opinion" hook anywhere. |

This log proposes **three agentic workflows** that integrate into the existing Worker pipeline at well-defined trigger points, leveraging Anthropic's documented workflow patterns (Routing, Evaluator-Optimizer, Orchestrator-Workers).

## 2. User Requirements (from the request)

Provided by the user up-front — no discovery questions needed for this research phase:

1. **Focus areas:** (a) PDF Splitting agent, (b) Critic/Verification agent using a stronger model, (c) Data Extraction agent for financial values.
2. **Deliverable:** For each agent — Purpose + Trigger, System Prompt, pseudocode showing integration with existing Cloudflare Worker flow.
3. **Find edge cases** where single-pass classification fails and explain how each agent solves them.
4. **This log is a proposal, not an implementation request.** Nothing is built until this log moves to `[APPROVED]`.

## 3. Research

### Domain
Document AI, Multi-Agent LLM Workflows, Classification Robustness, LLM-as-Judge patterns.

### Sources Consulted

1. **Anthropic — "Building Effective Agents"** (engineering.anthropic.com, Dec 2024) — Canonical taxonomy of agentic patterns: Prompt Chaining, Routing, Parallelization, Orchestrator-Workers, Evaluator-Optimizer, Autonomous Agents. Key quote on evaluator-optimizer: *"Deploy a capable (expensive) model as evaluator assessing a smaller, cost-efficient generator's work."* This is exactly the Critic agent pattern the user asked for.

2. **Anthropic tool_use docs + prompt caching** (already in use — `document-classifier.ts:698`) — `anthropic-beta: prompt-caching-2024-07-31` is already enabled for the system prompt. Any new agent with a large system prompt (DOC_TYPE_REFERENCE ~4K tokens) should also cache the prompt. Cost: cached tokens are 10% of input-token price → critic agent on Sonnet can reuse the same cached system prompt as Haiku if we factor the prompt correctly.

3. **LLM-as-a-Judge literature** (Zheng et al., "Judging LLM-as-a-Judge with MT-Bench", 2023) — Critics are most useful on a **gated subset** (low confidence, high stakes, ambiguous inputs) rather than every call. Running the critic on 100% of outputs wastes budget without measurable accuracy improvement beyond ~3-5%. Gate pays for itself.

4. **pdf-lib / pdf.js existing usage** (`api/src/lib/pdf-split.ts`, `api/src/lib/pdf-merge.ts`) — Already in our dependency tree from DL-237. `getPdfPageCount()` is already called on every ingest (`processor.ts:455`). Page extraction via `PDFDocument.copyPages()` is a known, tested code path.

### Key Principles Extracted

- **Gate expensive calls, don't replace cheap ones.** The Critic agent (Sonnet) should fire only on a low-confidence OR high-stakes subset — NOT on every Haiku output. Protecting the 95th-percentile accuracy case burns budget for no gain.
- **Routing > hardcoded sequential pipeline.** The existing pipeline is a sequential chain. A router node between ingest and classification decides which agents to invoke (splitter? critic? extractor?) based on cheap pre-checks (page count, file size, template class).
- **Evaluator-Optimizer with strategic model selection.** Haiku = generator (fast, cheap, $0.25/M input). Sonnet = evaluator (accurate, $3/M input). 10-12× price difference means a 10% gating rate still cuts cost vs. running Sonnet on everything.
- **Cache the reference prompt.** DOC_TYPE_REFERENCE is ~4K tokens. With ephemeral caching already enabled, the critic can reuse 90% of the Haiku prompt at a tenth the cost.
- **Tool-use for structured extraction, not free-text.** All three proposed agents should use `tool_choice: { type: 'tool', name: '...' }` (same pattern as current classifier) so we get validated JSON, not regex-parsed strings. This matches the existing DL-195 fix.

### Patterns to Use

| Pattern (Anthropic taxonomy) | Applied to |
|------------------------------|-----------|
| **Routing** | A new `routeClassification()` function decides per-attachment which agents to invoke |
| **Prompt Chaining** (sequential) | Splitter → Classifier → Critic → Extractor — each only runs when prior step hands off |
| **Evaluator-Optimizer** | Critic (Sonnet) evaluates Haiku's output and either confirms or corrects |
| **Orchestrator-Workers** (light) | Splitter acts as orchestrator: detects N segments, fans out N classification workers in parallel (reusing existing batch-of-3 pattern in `processor.ts:649`) |

### Anti-Patterns to Avoid

- **Running Sonnet on every classification.** Destroys the economics. Also unnecessary — Haiku is right ~90% of the time per DL-207 observations.
- **Splitting every multi-page PDF blindly.** Many legitimate docs are multi-page (T201 can be 2-3 pages; T601 can be 5+ pages from a bank). Splitter must first DETECT multi-form content before splitting.
- **Chatty multi-turn agents.** Each proposed agent is a single-shot tool_use call. No conversation loops. Workers have CPU limits (50ms CPU on paid plan) and we're already in `ctx.waitUntil()` — cannot afford multi-turn ping-pong.
- **Bypassing the admin review step.** The output of any agent is still written to `pending_classifications` with `review_status: 'pending'`. Automation raises the confidence floor, not the ceiling. Admin still approves.
- **Running agents inline in the request path.** Everything stays in `ctx.waitUntil()` — the webhook returns 200 immediately as it does today.

### Research Verdict

Use a **Routing → Chained-Workers** hybrid with three specialized agents, all invoked within the existing `ctx.waitUntil()` post-response phase. Gate each agent on a cheap pre-check so average cost per email stays close to today's baseline. Cache the shared document reference prompt so the Critic costs ~1.2× Haiku, not 10×. Keep human review as the final gate — these agents raise the floor, they don't remove the admin.

## 4. Codebase Analysis

### Existing Solutions Found (Reuse First)

| Asset | Location | Reuse for |
|-------|----------|-----------|
| `classifyAttachment()` (Haiku + tool_use) | `document-classifier.ts:618` | Unchanged — it's the "generator" in the Evaluator-Optimizer pair |
| `buildSystemPrompt()` + `DOC_TYPE_REFERENCE` | `document-classifier.ts:384,47` | **Shared** between Haiku, Critic, and Extractor (prompt caching amortizes cost) |
| `CLASSIFY_TOOL` schema | `document-classifier.ts` (tool definition) | Critic reuses the same output shape for correction proposals |
| `getPdfPageCount()` + `splitPdf()` | `api/src/lib/pdf-split.ts` (DL-237) | Splitter agent reuses page extraction — no new PDF lib code needed |
| Batch-of-3 parallel classification | `processor.ts:649-673` | Splitter fans out segments using the same pattern |
| Anthropic fetch boilerplate | `document-classifier.ts:693-702`, `processor.ts:243-259` | Copy-paste pattern for new agents (headers, beta flag, error handling) |
| `findBestDocMatch()` + issuer matching | `document-classifier.ts:537` | Any corrected template_id from Critic runs through the same matcher |
| Airtable `pending_classifications` write | `processor.ts:498` | All agent outputs land in the same table — single display surface |
| `TEMPLATE_TITLES` SSOT | `document-classifier.ts:574` | Filename building for split segments |

### Reuse Decision

- **Reuse** `classifyAttachment()` verbatim as the generator. Do NOT touch Haiku's prompt or schema.
- **Reuse** `DOC_TYPE_REFERENCE` as the shared cached prompt block for all three agents.
- **Reuse** `splitPdf()` + `getPdfPageCount()` from DL-237 — the plumbing already exists.
- **Reuse** `ctx.waitUntil()` orchestration already in place — no new request-path code.
- **New code** is limited to: (a) a triage function `shouldSplitPdf()`, (b) three new agent functions in a new file `lib/inbound/agents/`, (c) a `routeClassification()` dispatcher inserted between Phase A and Phase B in `processor.ts:649`.

### Relevant Files

| File | Role |
|------|------|
| `api/src/lib/inbound/processor.ts:646-760` | Phase A (classify) / Phase B (upload+record) — routing inserted between them |
| `api/src/lib/inbound/document-classifier.ts` | Generator — unchanged |
| `api/src/lib/pdf-split.ts` (DL-237) | Splitter agent's extraction primitive |
| `api/src/lib/inbound/agents/splitter.ts` | **NEW** — multi-form detection + split |
| `api/src/lib/inbound/agents/critic.ts` | **NEW** — Sonnet verification |
| `api/src/lib/inbound/agents/extractor.ts` | **NEW** — financial field extraction |
| `api/src/lib/inbound/agents/router.ts` | **NEW** — gating logic |
| `api/src/lib/inbound/types.ts` | Extend `ClassificationResult` with `verifiedBy?: 'sonnet'`, `extractedData?: {...}` |
| Airtable `pending_classifications` | New fields: `verified_by_critic`, `critic_verdict`, `extracted_gross`, `extracted_tax`, `extracted_employer_id`, `split_detected` |

### Dependencies

- Anthropic API (existing `ANTHROPIC_API_KEY` env var)
- `pdf-lib` (already installed)
- No new npm packages

## 5. Technical Constraints & Risks

- **Worker CPU budget:** Paid plan = 50ms CPU per invocation, but we're running in `ctx.waitUntil()` which gives up to 30 seconds. Haiku + Critic + Extractor = 3 sequential network calls per high-stakes attachment. At ~2-4s per call, worst case ~12s — within budget, but must not add a 4th agent.
- **Anthropic rate limits:** Today we batch classification 3-at-a-time (`processor.ts:649`). Adding a Critic doubles the call volume for gated items. Keep gating rate ≤ 30% to stay within the same rate-limit envelope.
- **Cost envelope:** Sonnet at $3/M input vs Haiku at $0.25/M. Critic gated at 25% → effective cost/email = 1.0× + 0.25 × 12× = 4× Haiku-only. Extractor (Haiku again, small output) ≈ 1.1×. Splitter (one extra Haiku + N extra classifications) ≈ 1.2× on a small subset. Rough ceiling: **~5× current per-email cost on gated emails, ~1.0× on ungated.** Current WF05 is ~$0.02/email → projected ~$0.08 on high-stakes emails. Acceptable.
- **Prompt caching:** Must be enabled on all three agents (`anthropic-beta: prompt-caching-2024-07-31`). `DOC_TYPE_REFERENCE` marked `cache_control: { type: 'ephemeral' }` — already done in `buildSystemPrompt()`, reuse the exact same blocks.
- **Idempotency:** Agents run inside `ctx.waitUntil()`. If the worker crashes mid-pipeline, the email stays un-acked at MS Graph and the whole thing retries. No new idempotency concerns beyond what DL-203 already handles.
- **Breaking changes:** None. All three agents are additive. `ClassificationResult` gets optional fields. Existing admin UI keeps working without changes (new fields surface in a follow-up UI log).
- **Risk — Critic hallucination:** Sonnet could disagree with Haiku and be wrong. Mitigation: record BOTH verdicts (`ai_confidence` = Haiku, `critic_verdict` = Sonnet). If they disagree, flag `review_status: 'pending_human'` prominently. Admin sees both opinions side-by-side. Never overwrite Haiku's output silently.
- **Risk — Splitter false positive:** Splits a legitimate 3-page T601 into 3 garbage segments. Mitigation: splitter is gated on `page_count >= 3 AND multi_form_confidence >= 0.7`. Legitimate multi-page docs from one issuer shouldn't trigger it.

## 6. Proposed Solution (The Blueprint)

### Success Criteria

A single `routeClassification(attachment, haikuResult)` dispatcher sits between Phase A and Phase B in `processor.ts`. Given the Haiku output and cheap pre-checks, it invokes zero, one, two, or three additional agents (Splitter, Critic, Extractor) in a defined chain. All agent outputs land in `pending_classifications` with new optional fields. Admin review tab shows a new "Verified by Sonnet ✓" badge on critic-confirmed rows, a "Split detected" badge on splitter segments, and an inline financial summary (Gross/Tax/Employer) for extractor-enriched rows.

### Architecture Overview

```
                    ┌─────────────────────────────────────────────────────┐
                    │  processor.ts — Phase A (Haiku classify, batch 3)   │
                    └──────────────────────┬──────────────────────────────┘
                                           │ ClassificationResult (Haiku)
                                           ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  routeClassification(attachment, haikuResult)       │
                    │  ─ cheap pre-checks, decides which agents to fire   │
                    └──┬──────────────┬───────────────┬───────────────────┘
                       │              │               │
               gated on             gated on       gated on
            page_count>=3 &&     conf<0.75 OR    template in
         size<5MB && isPdf     high_stakes_set   HIGH_VALUE_SET
                       │              │               │
                       ▼              ▼               ▼
                ┌──────────┐   ┌──────────┐    ┌─────────────┐
                │ AGENT 1  │   │ AGENT 2  │    │  AGENT 3    │
                │ Splitter │   │  Critic  │    │  Extractor  │
                │ (Haiku)  │   │ (Sonnet) │    │   (Haiku)   │
                └──────────┘   └──────────┘    └─────────────┘
                       │              │               │
                       ▼              ▼               ▼
                 ── N segments  ──  verdict    ── {gross, tax, employer_id}
                 re-classified      (confirm /
                 in parallel        correct /
                                    uncertain)
                       │              │               │
                       └──────────────┴───────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  processor.ts — Phase B (upload + write Airtable)   │
                    └─────────────────────────────────────────────────────┘
```

---

### Agent 1 — PDF Splitter (Multi-Form Detection)

**Purpose.** Detect when a single PDF contains multiple distinct tax forms (e.g., Form 106 + bank statement + ID scan in one 5-page file) and split it into per-form segments BEFORE classification — not after, as DL-237 currently does manually.

**Trigger conditions (ALL must be true).**
```
page_count >= 3
AND attachment.size < 5 * 1024 * 1024    // fits Haiku's document block
AND file is PDF (not image, not office)
AND haikuResult.confidence < 0.85        // if Haiku is confident, trust it
```
Rationale: Single-page PDFs can't be multi-form. 2-page PDFs are usually front+back of one doc. 3+ pages with Haiku-uncertainty is the sweet spot where multi-form risk is real. Size gate keeps us within Haiku's document token budget.

**Solves edge cases.** EC-1 (primary), EC-5 (partially — multi-form large PDFs can still fail).

**System Prompt.**
```text
You are a PDF segmentation analyst for an Israeli CPA firm.

Your ONE job: look at a PDF and decide whether it contains MULTIPLE DISTINCT tax documents, or whether it is a single multi-page document.

Rules:
1. A "document" is one tax form, certificate, or contract. A 3-page Form 106 is ONE document. A Form 106 + a bank statement + an ID scan, all in one PDF, is THREE documents.
2. Signals of a NEW document starting on a page:
   - Different letterhead / logo / institution
   - New form number (טופס 106, טופס 867, אישור שנתי...)
   - Page number restarts (e.g., "עמוד 1 מתוך 3" appearing mid-PDF)
   - Blank page separator (often used when scanning)
   - Radically different layout (tabular form vs. prose letter)
3. Signals that it is ONE document:
   - Same letterhead/header on every page
   - Continuous page numbering (1, 2, 3...)
   - Tables that span pages
   - One signature/stamp at the very end
4. Err on the side of NOT splitting. A false split creates garbage records; a false merge just needs manual review later.

Respond via the `segment_pdf` tool with:
- is_multi_form: boolean
- confidence: 0.0-1.0
- segments: array of { start_page, end_page, description } (empty if is_multi_form=false)
- reason: 1-2 sentences
```

**Technical integration (pseudocode).**
```ts
// api/src/lib/inbound/agents/splitter.ts
export async function splitterAgent(
  pCtx: ProcessingContext,
  attachment: AttachmentInfo,
  haikuResult: ClassificationResult,
): Promise<SplitDecision> {
  // Cheap pre-check — page count already computed in processor.ts:455
  if (attachment.pageCount! < 3) return { shouldSplit: false };
  if (attachment.size >= LARGE_PDF_THRESHOLD) return { shouldSplit: false };
  if (haikuResult.confidence >= 0.85) return { shouldSplit: false };

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: [
      { type: 'text', text: SPLITTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf',
                                      data: arrayBufferToBase64(attachment.content) } },
        { type: 'text', text: `PDF filename: ${attachment.name}\nTotal pages: ${attachment.pageCount}` },
      ],
    }],
    tools: [SEGMENT_TOOL],
    tool_choice: { type: 'tool', name: 'segment_pdf' },
  };
  const resp = await fetch('https://api.anthropic.com/v1/messages', { /* headers as existing */ });
  const { is_multi_form, segments, confidence } = parseToolUse(resp);

  if (!is_multi_form || confidence < 0.7) return { shouldSplit: false };
  return { shouldSplit: true, segments, confidence };
}

// Integration in processor.ts — BEFORE Phase B upload loop
for (let i = 0; i < attachments.length; i++) {
  const splitDecision = await splitterAgent(pCtx, attachments[i], classificationResults[i]);
  if (splitDecision.shouldSplit) {
    // Reuse DL-237 splitPdf() — same pdf-lib copyPages plumbing
    const segmentFiles = await splitPdf(attachments[i].content, splitDecision.segments);
    // Replace the single attachment with N sub-attachments
    const subAttachments = segmentFiles.map((bytes, idx) => ({
      ...attachments[i],
      name: `${attachments[i].name.replace(/\.pdf$/i, '')}_part${idx + 1}.pdf`,
      content: bytes.buffer,
      size: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    }));
    // Re-classify each segment (reuse batch-of-3 pattern)
    const subResults = await Promise.all(subAttachments.map(a =>
      classifyAttachment(pCtx, a, requiredDocs, primaryReport.clientName, emailMetadata)
    ));
    // Feed each (segment, subResult) through Phase B instead of the original
    // Mark each segment record with split_from = original classification_key
  }
}
```

---

### Agent 2 — Critic (Sonnet Verifier)

**Purpose.** Act as an evaluator on Haiku's classification for cases that are either LOW-CONFIDENCE or HIGH-STAKES. Sonnet either **confirms** Haiku's verdict, **corrects** it (returns a different `template_id` with justification), or flags **uncertain** (human must decide).

**Trigger conditions (ANY triggers the critic).**
```
haikuResult.confidence < 0.75
OR haikuResult.template_id in HIGH_STAKES_SET
OR haikuResult.template_id in CONFUSED_PAIR_SET       // T401/T501, T201/T202, T901/T1601, T302/T303
OR haikuResult.template_id == null && attachment.size < 5MB  // retry uncertain cases
```

Where:
```ts
const HIGH_STAKES_SET = new Set([
  'T201','T202',           // Form 106 — primary income doc
  'T601',                  // Form 867 — securities, often dual-matches
  'T501',                  // annual deposits — pension/fund
  'T302','T303','T305','T306', // NII variants — historically confused (DL-131)
]);
const CONFUSED_PAIR_SET = new Set([
  'T401','T501',           // withdrawal vs deposit report
  'T901','T902','T1601',   // Israeli rental vs foreign
]);
```

**Solves edge cases.** EC-2 (primary), EC-3 (primary), EC-6 (partial — retries uncertain cases with a stronger model).

**System Prompt.**
```text
You are a senior tax document auditor at an Israeli CPA firm. A faster classifier (Haiku) has already classified this document. Your job is to audit its verdict — NOT to re-classify from scratch unless the first verdict is clearly wrong.

${DOC_TYPE_REFERENCE}   ← reused, cached block

You will be given:
1. The document itself (PDF, image, or extracted text)
2. The email metadata (subject, sender, body preview)
3. The client's name and required documents list
4. Haiku's verdict: {template_id, confidence, issuer_name, evidence}

Your task — respond via the `critic_verdict` tool:

1. AGREE: Haiku is correct. Return verdict="confirm". No changes.
2. CORRECT: Haiku is wrong. Return verdict="correct" with the right {template_id, issuer_name, evidence}.
3. UNCERTAIN: The document is genuinely ambiguous (illegible scan, missing key markers, or multiple equally plausible templates). Return verdict="uncertain" with a brief explanation. The admin will decide.

Rules of engagement:
- Be CONSERVATIVE. If Haiku's answer is plausible, confirm it. Do NOT nitpick issuer name casing or alternative spellings.
- ONLY correct when you have HIGH confidence (>= 0.85) that Haiku is wrong AND you can point to specific content in the document that proves it.
- Pay special attention to the commonly-confused pairs: T401 (withdrawal) vs T501 (deposit report); T201 (client 106) vs T202 (spouse 106); T302 (spouse NII) vs T303 (client NII); T901/T902 (Israeli rental) vs T1601 (foreign income).
- For T201/T202: check the employee name on the form against "${clientName}". Mismatch = T202.
- For NII: never use "ביטוח לאומי" as issuer_name — use the benefit type.
- Never invent a template_id that isn't in the required documents list UNLESS Haiku's verdict is clearly wrong and the correct template IS in the list.

Output format: tool_use `critic_verdict` with {verdict, corrected_template_id?, corrected_issuer_name?, confidence, evidence}.
```

**Technical integration (pseudocode).**
```ts
// api/src/lib/inbound/agents/critic.ts
export async function criticAgent(
  pCtx: ProcessingContext,
  attachment: AttachmentInfo,
  haikuResult: ClassificationResult,
  requiredDocs: AirtableRecord<DocFields>[],
  clientName: string,
  emailMetadata: EmailMetadata,
): Promise<CriticVerdict | null> {
  // Gate — cheap checks first
  const shouldVerify =
    haikuResult.confidence < 0.75 ||
    HIGH_STAKES_SET.has(haikuResult.templateId ?? '') ||
    CONFUSED_PAIR_SET.has(haikuResult.templateId ?? '') ||
    (haikuResult.templateId === null && attachment.size < LARGE_PDF_THRESHOLD);
  if (!shouldVerify) return null;

  // Build content — same routing as classifyAttachment() (PDF / image / docx text)
  const content = buildClassifierContent(attachment);   // extract existing logic into helper
  content.push({ type: 'text', text:
    `HAIKU VERDICT TO AUDIT:\n` +
    `template_id: ${haikuResult.templateId}\n` +
    `confidence: ${haikuResult.confidence}\n` +
    `issuer_name: ${haikuResult.issuerName}\n` +
    `evidence: ${haikuResult.reason}\n\n` +
    `Email subject: ${emailMetadata.subject}\n` +
    `Email body: ${emailMetadata.bodyPreview}\n` +
    `Client: ${clientName}`
  });

  const body = {
    model: 'claude-sonnet-4-6',         // stronger model — the critic
    max_tokens: 512,
    system: buildSystemPrompt(clientName, requiredDocs)    // SAME cached block — prompt cache hit
                .concat([{ type: 'text', text: CRITIC_INSTRUCTIONS }]),
    messages: [{ role: 'user', content }],
    tools: [CRITIC_TOOL],
    tool_choice: { type: 'tool', name: 'critic_verdict' },
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    headers: {
      'x-api-key': pCtx.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',  // cache DOC_TYPE_REFERENCE
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return parseCriticVerdict(await resp.json());
}

// Integration in processor.ts — after Haiku classification, BEFORE upload
const verdict = await criticAgent(pCtx, attachments[i], classificationResults[i], ...);
if (verdict?.verdict === 'correct') {
  // Overwrite template_id but record both
  classificationResults[i] = {
    ...classificationResults[i],
    templateId: verdict.correctedTemplateId,
    issuerName: verdict.correctedIssuerName,
    reason: `[Corrected by critic] ${verdict.evidence}`,
    verifiedBy: 'sonnet',
    criticVerdict: 'correct',
    haikuOriginal: classificationResults[i],  // preserve for audit
  };
} else if (verdict?.verdict === 'confirm') {
  classificationResults[i].verifiedBy = 'sonnet';
  classificationResults[i].criticVerdict = 'confirm';
} else if (verdict?.verdict === 'uncertain') {
  classificationResults[i].criticVerdict = 'uncertain';
  // Do NOT overwrite — flag prominently for admin
}
```

---

### Agent 3 — Financial Data Extractor

**Purpose.** After a document has been CLASSIFIED (and optionally critic-verified), extract the small set of structured financial values that actually matter to the CPA workflow: Gross income, Tax withheld, Employer TIN / Institution ID. Save as dedicated Airtable fields so Natan's office doesn't have to open every PDF.

**Trigger conditions (ALL).**
```
haikuResult.templateId in EXTRACTABLE_TEMPLATES
AND (critic verdict is "confirm" or "correct") OR critic was not triggered
AND attachment.size < 5 * 1024 * 1024
```

Where:
```ts
const EXTRACTABLE_TEMPLATES = new Map([
  ['T201', { fields: ['gross', 'tax_withheld', 'employer_tin', 'employer_name'] }],
  ['T202', { fields: ['gross', 'tax_withheld', 'employer_tin', 'employer_name'] }],
  ['T601', { fields: ['total_proceeds', 'total_tax', 'broker_name'] }],
  ['T501', { fields: ['total_deposits', 'fund_name', 'policy_number'] }],
  ['T401', { fields: ['withdrawal_amount', 'tax_withheld', 'fund_name'] }],
  ['T1101', { fields: ['total_withheld', 'payer_name', 'payer_tin'] }],
  // Capital Statement balance templates
  ['CS-T008', { fields: ['closing_balance', 'bank_name', 'account_number_last4'] }],
  ['CS-T001', { fields: ['closing_balance', 'bank_name', 'account_number_last4'] }],
  ['CS-T010', { fields: ['mortgage_balance', 'bank_name'] }],
  ['CS-T018', { fields: ['portfolio_value', 'broker_name'] }],
]);
```

**Solves edge cases.** EC-4 (primary). Also provides **downstream value**: office can cross-check totals against Form 1301 (the filed return) without re-opening source PDFs.

**System Prompt.** (Per-template variant — the dispatcher picks the right one.)
```text
You are a financial data extractor for an Israeli CPA firm. A document has already been classified as {template_id} ({template_title_hebrew}).

Your ONLY job is to extract the specific numeric fields listed below from this document. Do NOT re-classify. Do NOT comment on the document.

Fields to extract (for template ${template_id}):
${fields_list_with_hebrew_hints}

Rules:
1. Return raw numbers only (no currency symbols, no commas, no "₪", no thousands separators). Example: "85432.50" not "85,432.50 ₪".
2. All amounts are in Israeli Shekels (NIS) unless the document clearly states otherwise.
3. For Form 106: "gross" = סה"כ ברוטו שנתי (usually row 158 or the annual gross total); "tax_withheld" = סה"כ מס הכנסה שנוכה במקור (usually row 042 / 045); "employer_tin" = ת.ז/ח.פ מעביד (9 digits).
4. For Form 867: "total_proceeds" = סה"כ תמורה; "total_tax" = סה"כ מס.
5. If a field is genuinely not visible in the document, return null for that field. Do NOT guess or compute.
6. For TIN/ID numbers, return only digits (strip hyphens, spaces, dots). Israeli TINs are 9 digits.
7. If the document is illegible or the required fields are unclear, return {extraction_failed: true, reason: "..."}.

Output via the `extract_fields` tool.
```

**Technical integration (pseudocode).**
```ts
// api/src/lib/inbound/agents/extractor.ts
export async function extractorAgent(
  pCtx: ProcessingContext,
  attachment: AttachmentInfo,
  classification: ClassificationResult,
): Promise<ExtractedData | null> {
  const templateId = classification.templateId;
  if (!templateId || !EXTRACTABLE_TEMPLATES.has(templateId)) return null;
  if (attachment.size >= LARGE_PDF_THRESHOLD) return null;
  if (classification.criticVerdict === 'uncertain') return null;  // don't extract from unconfirmed docs

  const spec = EXTRACTABLE_TEMPLATES.get(templateId)!;
  const systemPrompt = buildExtractorPrompt(templateId, spec.fields);   // per-template prompt

  const body = {
    model: 'claude-haiku-4-5-20251001',   // Haiku is fine — structured extraction is easy
    max_tokens: 256,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        buildDocumentBlock(attachment),   // same PDF/image routing helper
        { type: 'text', text: `Extract the fields. Template: ${templateId}.` },
      ],
    }],
    tools: [buildExtractorTool(spec.fields)],   // dynamic tool schema per template
    tool_choice: { type: 'tool', name: 'extract_fields' },
  };
  const data = parseToolUse(await fetch('https://api.anthropic.com/v1/messages', {...}));
  return data;
}

// Integration — immediately after Critic, BEFORE Airtable write
const extracted = await extractorAgent(pCtx, attachments[i], classificationResults[i]);
if (extracted) {
  classificationResults[i].extractedData = extracted;
  // Phase B writes these to new Airtable fields (extracted_gross, extracted_tax, etc.)
}
```

---

### Routing Dispatcher — `routeClassification()`

**New file.** `api/src/lib/inbound/agents/router.ts`

**Purpose.** Single entry point that orchestrates all three agents with the right gates. Called once per attachment in the Phase A→B boundary of `processor.ts`.

```ts
// api/src/lib/inbound/agents/router.ts
export async function routeClassification(
  pCtx: ProcessingContext,
  attachment: AttachmentInfo,
  haikuResult: ClassificationResult,
  requiredDocs: AirtableRecord<DocFields>[],
  clientName: string,
  emailMetadata: EmailMetadata,
): Promise<RouteResult> {
  // Step 1: Check if splitter should fire
  const splitDecision = await splitterAgent(pCtx, attachment, haikuResult);
  if (splitDecision.shouldSplit) {
    // Short-circuit: caller will re-enter the pipeline for each segment
    return { kind: 'split', segments: splitDecision.segments };
  }

  // Step 2: Critic verification (gated)
  const critic = await criticAgent(pCtx, attachment, haikuResult, requiredDocs, clientName, emailMetadata);
  let finalResult = haikuResult;
  if (critic?.verdict === 'correct') {
    finalResult = applyCriticCorrection(haikuResult, critic);
  } else if (critic?.verdict === 'confirm') {
    finalResult = { ...haikuResult, verifiedBy: 'sonnet', criticVerdict: 'confirm' };
  } else if (critic?.verdict === 'uncertain') {
    finalResult = { ...haikuResult, criticVerdict: 'uncertain' };
  }

  // Step 3: Financial extraction (gated, only on confirmed classifications)
  const extracted = await extractorAgent(pCtx, attachment, finalResult);
  if (extracted) finalResult.extractedData = extracted;

  return { kind: 'enriched', classification: finalResult };
}
```

**Integration point in `processor.ts`** — between Phase A (classification batch) and Phase B (upload + Airtable write), around line 675:

```ts
// processor.ts — insert between line 673 (batch classification done) and 678 (upload loop)
for (let i = 0; i < attachments.length; i++) {
  const routed = await routeClassification(
    pCtx,
    attachments[i],
    classificationResults[i],
    requiredDocs,
    primaryReport.clientName,
    metadata,
  );

  if (routed.kind === 'split') {
    // Expand one attachment into N segments, reclassify, process each
    const segmentResults = await processSplitSegments(pCtx, attachments[i], routed.segments, ...);
    for (const seg of segmentResults) {
      await processAttachmentWithClassification(pCtx, seg.attachment, metadata, clientMatch, targetReport, ..., seg.classification);
    }
  } else {
    classificationResults[i] = routed.classification;
    await processAttachmentWithClassification(pCtx, attachments[i], metadata, clientMatch, targetReport, ..., classificationResults[i]);
  }
}
```

### Mapping — Agents to Edge Cases

| Edge case | Solved by | How |
|-----------|-----------|-----|
| EC-1 Multi-form PDF | Splitter | Detects multiple forms in one PDF BEFORE classification, re-enters pipeline per segment. Automates what DL-237 currently requires a human click for. |
| EC-2 Low-confidence high-stakes | Critic | Sonnet audits any Haiku output with conf < 0.75 OR template in HIGH_STAKES_SET. Produces confirm/correct/uncertain verdict. |
| EC-3 Commonly confused pairs | Critic | CONFUSED_PAIR_SET always triggers Sonnet regardless of confidence. Specifically covers T401↔T501, T201↔T202, T901↔T1601, T302↔T303 (DL-131 regression coverage). |
| EC-4 No structured data | Extractor | Per-template tool_use extraction of Gross/Tax/Employer TIN for Form 106, Form 867, T501 deposits, balance templates for CS. |
| EC-5 Large PDF (>5MB) skip | Partially (Splitter) | Splitter can't help (size gate). Follow-up: a separate "large PDF triage" path that down-samples or extracts just the first page — out of scope for this log. |
| EC-6 Invalid PDF header | Critic (partial retry) | Critic re-tries the classification path when `template_id === null`. If the header is truly corrupt, Sonnet will also fail — but at least we give it a second shot. |
| EC-7 No second opinion | Critic | By definition. |

### Data Structures / Schema Changes

**`ClassificationResult` extension** (`api/src/lib/inbound/types.ts`):
```ts
export interface ClassificationResult {
  // existing fields...
  verifiedBy?: 'sonnet';
  criticVerdict?: 'confirm' | 'correct' | 'uncertain';
  haikuOriginal?: ClassificationResult;  // snapshot when critic overrides
  extractedData?: {
    gross?: number | null;
    tax_withheld?: number | null;
    employer_tin?: string | null;
    employer_name?: string | null;
    // ...template-specific fields
  };
  splitFromOriginal?: string;  // classification_key of parent if this is a split segment
}
```

**Airtable `pending_classifications` — new fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `verified_by_critic` | Checkbox | True if Sonnet audited and confirmed/corrected |
| `critic_verdict` | Single select: confirm / correct / uncertain | |
| `haiku_original_template` | Single line text | Haiku's original guess when critic overrides (audit trail) |
| `extracted_gross` | Number (currency) | Form 106 gross / 867 proceeds / etc. |
| `extracted_tax` | Number (currency) | Tax withheld |
| `extracted_employer_tin` | Single line text | Employer/institution TIN |
| `extracted_payload` | Long text (JSON) | Full extractor output (for fields not promoted to columns) |
| `split_detected` | Checkbox | True if splitter fired on this attachment |
| `split_segment_index` | Number | Segment # within original (1, 2, 3...) |

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/agents/splitter.ts` | Create | Multi-form detection + segment decision |
| `api/src/lib/inbound/agents/critic.ts` | Create | Sonnet verification with confirm/correct/uncertain verdict |
| `api/src/lib/inbound/agents/extractor.ts` | Create | Per-template financial field extraction |
| `api/src/lib/inbound/agents/router.ts` | Create | Dispatcher + gating logic |
| `api/src/lib/inbound/agents/gates.ts` | Create | HIGH_STAKES_SET, CONFUSED_PAIR_SET, EXTRACTABLE_TEMPLATES constants |
| `api/src/lib/inbound/processor.ts` | Modify | Insert `routeClassification()` call between Phase A and Phase B (~line 675). Handle `kind === 'split'` branch to expand into segments. |
| `api/src/lib/inbound/document-classifier.ts` | Modify | Extract `buildClassifierContent()` into a helper so agents can reuse PDF/image/docx routing (avoid duplication) |
| `api/src/lib/inbound/types.ts` | Modify | Extend `ClassificationResult` with `verifiedBy`, `criticVerdict`, `haikuOriginal`, `extractedData`, `splitFromOriginal` |
| Airtable `pending_classifications` table | Modify | Add 9 new fields (see table above) |
| `github/.../admin/js/script.js` | Follow-up log | AI review card UI: "Verified ✓ Sonnet" badge, financial summary inline, split-segment badge |

### Rollout Plan (to avoid a big-bang deploy)

1. **Phase 1 — Critic only, read-only.** Deploy critic agent. Write `critic_verdict` to Airtable but do NOT overwrite `matched_template_id` even when verdict is "correct". Compare Haiku vs Sonnet verdicts offline for a week. Measure correction rate.
2. **Phase 2 — Critic writes.** Once Phase 1 shows critic is reliable (>90% of "correct" verdicts match admin manual corrections), enable the template_id overwrite path. Keep `haiku_original_template` for audit.
3. **Phase 3 — Extractor.** Ship extractor agent against the 5 highest-value templates first (T201, T202, T601, T501, T1101). Expand to CS templates once stable.
4. **Phase 4 — Splitter.** Ship last. Needs the most human review before going live (false splits are destructive).

Each phase is a separate design log once approved.

### Final Step (Always)
* **Housekeeping:** This log stays at `[DRAFT — RESEARCH PROPOSAL]` until the user reviews and decides whether to approve a Phase 1 implementation log. No code is written from this log directly. On approval, split into 3-4 implementation logs (one per phase) and update `current-status.md` accordingly.

## 7. Validation Plan

*(These are the tests that will apply when Phase 1–4 are eventually implemented. Listed here so future implementation logs can cherry-pick the relevant ones.)*

### Critic agent (Phase 1–2)
- [ ] Critic fires on haiku confidence < 0.75
- [ ] Critic fires on T201/T202/T601/T501/T302/T303 regardless of confidence
- [ ] Critic fires on T401/T501/T901/T1601 (confused pairs) regardless of confidence
- [ ] Critic does NOT fire on high-confidence non-stakes docs (e.g., T1301 at 0.92) — cost control
- [ ] Sonnet "confirm" verdict sets `verified_by_critic = true`, no template change
- [ ] Sonnet "correct" verdict (Phase 2) overwrites `matched_template_id`, preserves `haiku_original_template`
- [ ] Sonnet "uncertain" verdict flags for prominent admin attention, no overwrite
- [ ] Prompt cache hit rate on `DOC_TYPE_REFERENCE` block is >80% (measure via Anthropic response `cache_read_input_tokens`)
- [ ] Phase 1 offline comparison: log disagreement rate between Haiku and Sonnet for 100+ docs. Compare against admin ground-truth corrections in `review_classification` calls.
- [ ] T201 vs T202 regression test: emails with spouse-name Form 106s previously misclassified as T201 are now corrected to T202
- [ ] DL-131 regression: NII disability vs maternity leave — Sonnet corrects T303 → T302 when document is דמי לידה

### Extractor agent (Phase 3)
- [ ] T201 extraction: gross, tax, employer_tin extracted correctly from a real Form 106 PDF
- [ ] T601 extraction: total_proceeds, total_tax extracted from a real טופס 867
- [ ] Extractor does NOT fire on critic-uncertain classifications
- [ ] Extractor returns null (not 0, not "") for fields genuinely missing from the document
- [ ] TIN extraction strips hyphens/spaces — always 9 digits
- [ ] Illegible scan → `extraction_failed: true` gracefully, no crash
- [ ] Extracted values written to Airtable as numbers (not strings) — aggregation queries work

### Splitter agent (Phase 4)
- [ ] Splitter does NOT fire on single-page PDFs
- [ ] Splitter does NOT fire on 2-page front/back scans
- [ ] Splitter does NOT fire on high-confidence (>=0.85) Haiku classifications
- [ ] Splitter correctly identifies 3 docs in a synthetic PDF of Form 106 + Form 867 + ID scan
- [ ] Splitter confidence < 0.7 → no split (conservative gate)
- [ ] Split segments are re-classified independently, each gets its own `pending_classifications` record
- [ ] Each segment references parent via `split_from` (same field added in DL-237)
- [ ] Original attachment's classification is marked `review_status = 'split'` and hidden from review UI
- [ ] Admin can undo a split (restore original record) — out of scope for initial rollout, documented as follow-up

### Cost & performance
- [ ] Per-email cost on the 25th percentile (ungated) case stays within ±5% of today's baseline
- [ ] Per-email cost on gated (high-stakes) cases stays below 5× baseline
- [ ] End-to-end latency (webhook receipt → `pending_classifications` record created) stays under 30s p95 (worker `waitUntil` budget)
- [ ] Rate-limit observations: no new 429s from Anthropic during steady-state (watch `/error-logger` for `DEPENDENCY` category bumps)

### Admin UX (separate UI design log — deferred)
- [ ] "Verified ✓ Sonnet" badge appears on critic-confirmed cards
- [ ] "Corrected by Sonnet" badge + original Haiku guess on critic-corrected cards
- [ ] "Uncertain — please review" red flag on critic-uncertain cards
- [ ] Financial summary chips (Gross/Tax/Employer) shown inline on extractor-enriched cards
- [ ] Split-segment cards grouped visually under a parent header

## 8. Implementation Notes (Post-Code)
*To be filled during implementation phases. Reference research principles applied (Evaluator-Optimizer, Routing, prompt caching) with specific line numbers when code is written.*

---

## Summary for the user

**TL;DR — Three agents, one dispatcher, gated by cheap pre-checks:**

| Agent | Model | Triggers when... | Solves |
|-------|-------|-----------------|--------|
| **1. Splitter** | Haiku | PDF has 3+ pages AND Haiku confidence < 0.85 AND size < 5MB | Multi-form scans (EC-1) — automates what DL-237 needs humans for |
| **2. Critic** | **Sonnet** | Haiku confidence < 0.75 OR template ∈ {high-stakes or confused-pairs set} | Misclassification of Form 106, NII, rental, withdrawals (EC-2, EC-3, EC-6) |
| **3. Extractor** | Haiku | Classification is confirmed AND template ∈ {Form 106, 867, 501, 1101, CS balance templates} | Office manually re-opening PDFs for Gross/Tax/Employer TIN (EC-4) |

All three agents run inside the existing `ctx.waitUntil()` window in `processor.ts`. The new `routeClassification()` dispatcher is inserted between Phase A (batch Haiku classification) and Phase B (upload + Airtable write), around line 675. No request-path code changes. `DOC_TYPE_REFERENCE` is reused and prompt-cached across all three agents — Sonnet critic cost ≈ 1.2× Haiku, not 10×. Rollout is 4 phases: Critic (read-only) → Critic (writes) → Extractor → Splitter.
