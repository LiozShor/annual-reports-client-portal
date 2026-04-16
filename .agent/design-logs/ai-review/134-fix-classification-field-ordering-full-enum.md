# Design Log 134: Fix Classification Field Ordering & Full Enum
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-09
**Related Logs:** [131-fix-nii-classification-enum-enforcement](131-fix-nii-classification-enum-enforcement.md)

## 1. Context & Problem

DL-131 added enum constraints + strict mode to the AI document classifier (WF05, Claude Haiku 4.5). The intent was to prevent hallucinated template IDs and fix a specific NII misclassification. **Result: regression from 14/15 → 7/15 correct classifications.**

Two root causes identified:

1. **Client-scoped enum** — `validTemplateIds` restricted to only the client's required docs. When a test doc's correct type wasn't in the enum, the LLM was forced to pick the "least wrong" match (e.g., degree certificate T1501 → classified as T001 residency).

2. **Field ordering** — Schema has `matched_template_id` FIRST and `evidence` LAST. The LLM must commit to a classification before reasoning about the document, reducing accuracy.

## 2. User Requirements

1. **Q:** What's your preferred fix direction for the enum?
   **A:** "I don't understand this topic. You should decide." → Full enum always (research-driven decision).

2. **Q:** Should we keep strict mode?
   **A:** "IDK" → Keep it (research supports it for simple schemas).

3. **Q:** Should we test with both original and generic filenames?
   **A:** Yes — test both to isolate variables.

4. **Q:** Research depth?
   **A:** Deep research — full investigation of classification prompt patterns.

## 3. Research

### Domain
LLM Constrained Decoding, Multi-Class Document Classification, Prompt Engineering for Classification

### Sources Consulted (15+ sources across 3 parallel agents)

1. **CRANE (arXiv 2502.09061)** — Add a reasoning field BEFORE the constrained enum field. Pure constraint enforcement = 99% valid but only 22% functional accuracy. With reasoning delimiter: **+10 percentage points improvement**. Directly applicable: our `evidence` field should come before `matched_template_id`.

2. **RANLP 2025 — "The Hidden Cost of Structure"** — Constrained decoding systematically reduces model accuracy. Enumeration constraints cause misclassification when forced structure conflicts with learned patterns. Confirms our regression.

3. **Anthropic Structured Outputs Docs** — `strict: true` uses constrained decoding at token level. Supported for Haiku 4.5. Maximum 16 nullable/union types per request (we use 1). Schema under 10KB (ours is ~1KB). Nullable via `anyOf` is correct pattern.

4. **Anthropic Advanced Tool Use** — `input_examples` improved accuracy from 72% to 90%. Descriptions should be 3-4+ sentences. "Think of descriptions as instructions to a new hire."

5. **Wharton Technical Report (2025)** — Non-reasoning models like Haiku gain +11-13% accuracy from CoT prompting. Negligible cost at Haiku pricing.

6. **Follow-Up Differential Descriptions (OpenReview 2025, FuDD)** — Explicitly describing differences between confusing classes "significantly improves classification performance."

7. **Hierarchical Classification with Black-Box LLMs (arXiv 2025)** — Single-pass Direct Hierarchical (DH) strategy outperforms flat and multi-step. Encode category groups in reasoning instruction.

8. **Amazon Science — Label with Confidence (CIKM 2024)** — LLM numeric confidence scores have Expected Calibration Error of 0.108-0.427. Categorical is more consistent but we keep numeric for backward compat.

9. **Aidan Cooper — Guide to Constrained Decoding** — Field ordering matters: if a boolean field comes before a description field, the model must decide before reasoning. Reasoning fields should come first.

10. **HN Discussion on Structured Outputs** — "Constrained generation is a reliability floor, not a quality guarantee." Poor prompt + constrained decoding = syntactically correct but semantically wrong.

### Key Principles Extracted

- **Think-then-classify (CRANE)** — The evidence/reasoning field MUST come before the classification field in the schema. This is the single biggest accuracy improvement we can make.
- **Full enum always** — Restricting the enum to client-scoped IDs is an anti-pattern. The model needs all valid options available.
- **Discriminating descriptions** — For confusing pairs (T401 vs T501, T501 vs T303, T901 vs T902), explicitly state the differentiating criteria in the prompt.
- **Metadata is signal** — Pass filename, email context, sender info alongside document content. Production IDP systems always leverage metadata.

### Patterns to Use

- **CRANE reasoning-before-classification:** Move `evidence` field to position 1 in schema, enhance its description to guide structured thinking (category → specific type).
- **Full static enum:** Always use all 34 template IDs. Client's required docs shown in prompt for preference, not for restriction.
- **Confusing-pairs section:** Add explicit disambiguation rules for the 5 most confusing pairs to the system prompt.

### Anti-Patterns to Avoid

- **Client-scoped enum** — Tempting because it reduces decision space, but catastrophic when the correct type is excluded. Forces wrong matches.
- **Classify-then-reason field ordering** — Intuitive (ID first, evidence after) but forces the model to commit before thinking. Research shows 10-13pp accuracy loss.
- **Numeric confidence as truth** — Tempting to automate thresholds, but LLM confidence is poorly calibrated. Use for human routing only.

### Research Verdict

Three changes, ranked by expected impact:
1. **Reorder fields** (evidence FIRST) — highest impact, ~10pp from CRANE
2. **Full enum** (all 34 IDs always) — fixes the 7 regressions directly
3. **Confusing-pairs section** — prevents T401/T501 and T501/T303 confusion

Keep strict mode (schema is simple), keep numeric confidence (backward compat), keep NII routing table from DL-131.

## 4. Codebase Analysis

### Existing Solutions Found
- `DOC_TYPE_REFERENCE` constant (lines 193-398 in prepare_attachments_v3.js) — already has detailed per-template descriptions. Partially covers confusing pairs but not explicitly.
- `docsCtx` builder (lines 400-406) — already clean from DL-131 (HTML stripped, structured format).
- NII routing table (lines 462-471) — already explicit from DL-131.
- `anthropic-beta` header — already set on Classify Document node from DL-131.

### Reuse Decision
- Reuse DOC_TYPE_REFERENCE as-is (no changes needed to the ~200-line constant)
- Reuse docsCtx builder as-is
- Reuse NII routing table as-is
- Only change: tool schema field ordering + full enum + enhanced evidence description + confusing-pairs section in prompt

### Downstream Consumers
- **Airtable fields:** `matched_template_id`, `ai_confidence` (float), `ai_reason` (Hebrew text), `issuer_name` → all field NAMES unchanged, no downstream changes needed
- **Admin panel (script.js ~3100+):** reads same fields → no changes needed
- **n8n downstream nodes:** parse API response → field names match → no changes needed

### Dependencies
- WF05 `cIa23K8v1PrbDJqY` must be active
- Anthropic `anthropic-beta: structured-outputs-2025-11-13` header (already set)

## 5. Technical Constraints & Risks

- **Risk:** Strict mode with `anyOf` nullable pattern — tested and working in v3. No change here.
- **Risk:** Prompt caching — DOC_TYPE_REFERENCE (the big cached part) is unchanged. Only the dynamic system prompt text changes. Net impact: minimal.
- **Risk:** Token usage — `evidence` field with enhanced description may produce slightly longer reasoning (~50 more tokens). Well within 512 max_tokens.
- **Breaking changes:** None — same API response shape, same Airtable field mapping.

## 6. Proposed Solution (The Blueprint)

### Change 1: Full enum (always all 34 IDs)

Replace lines 409-411:
```javascript
// BEFORE (DL-131 — client-scoped, caused regressions)
const validTemplateIds = requiredDocs.length > 0
  ? [...new Set(requiredDocs.map(d => d.type))]
  : ['T001','T002',...];

// AFTER (DL-134 — always full enum)
const ALL_TEMPLATE_IDS = ['T001','T002','T003','T101','T102','T201','T202','T301','T302','T303','T304','T305','T306','T401','T402','T501','T601','T701','T801','T901','T902','T1001','T1101','T1102','T1201','T1301','T1401','T1402','T1403','T1501','T1601','T1602','T1701'];
```

### Change 2: Reorder schema fields — evidence FIRST

New field ordering in `toolDefinition.input_schema.properties`:
```
1. evidence           (string) — reasoning/CoT before classification
2. issuer_name        (string|null)
3. confidence         (number 0-1)
4. matched_template_id (anyOf string enum + null) — classification LAST
```

### Change 3: Enhanced evidence description

```javascript
evidence: {
  type: 'string',
  description: '1-3 sentences IN HEBREW: First identify the document CATEGORY (employment, NII/social security, insurance/pension, banking/securities, rental, personal, tax withholding, etc.), then cite specific text or visual elements that determine the exact template type. For NII documents, explicitly state the allowance type (אבטלה/נכות/דמי לידה/מילואים/שאירים/etc.). For insurance documents, state if it is a deposit report (אישור שנתי/הפקדות → T501) vs withdrawal certificate (אישור משיכה → T401).'
}
```

### Change 4: Confusing-pairs section in system prompt

Add after NII routing table:
```
- CONFUSING PAIRS — pay special attention:
  • T401 (withdrawal/משיכה) vs T501 (deposit report/אישור שנתי): T401 is a ONE-TIME withdrawal event. T501 is an ANNUAL report on regular deposits. Annual deposit totals → T501. Specific withdrawal with tax deducted → T401.
  • T501 (insurance annual report) vs T303 (NII disability): T501 from PRIVATE insurance companies (מגדל, הראל, כלל, etc.). T303 from ביטוח לאומי. Check the issuer.
  • T901 (rental income) vs T902 (rental expense): Client as "משכיר" (landlord) → T901. Client as "שוכר" (tenant) → T902.
  • T1101 (income tax withholding) vs T1102 (NII withholding): "ביטוח לאומי" → T1102. "מס הכנסה" → T1101.
  • T201 (Form 106 client) vs T202 (Form 106 spouse): Compare employee name to client name. Different person → T202.
```

### Change 5: Prompt note about non-required docs

Add after docsCtx in system prompt:
```
Note: The required documents list shows what this client NEEDS. The document you are classifying may or may not be one of these. If it matches a required document, prefer that match. If it does NOT match any required document, classify it using the Document Type Reference — use the best matching template from the full list of 34 types.
```

### Files to Change

| Location | Action | Description |
|----------|--------|-------------|
| n8n `Prepare Attachments` code node | Modify jsCode | Full enum + field reorder + enhanced evidence desc + confusing pairs + prompt note |

### Final Step
Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy validation items to `current-status.md`.

## 7. Validation Plan

* [ ] Push v4 code to n8n without errors (workflow stays active, 52 nodes)
* [ ] Test with ORIGINAL descriptive filenames: expect >= 14/15 correct
* [ ] Test with GENERIC filenames (doc1-doc15): expect >= 13/15 correct
* [ ] `bituach_leumi_avtalah.pdf` classifies as T301 or T302 (NOT T304)
* [ ] `bituach_yashir_shnati.jpg` classifies as T303 (NOT T801)
* [ ] `contract_rent_apartment.pdf` classifies as T902 (NOT T1701)
* [ ] `keren_hishtalmut_eltzamach.pdf` classifies as T401 (NOT T501)
* [ ] `ishur_shnati_migdal_oved_kosher.pdf` classifies as T501 (NOT T305)
* [ ] `ishur_toar_TAU.pdf` classifies as T1501 (NOT T001)
* [ ] `pitzuei_piturin_2025.png` classifies as T401 (NOT T801)
* [ ] `sapach_tz_scan.jpg` classifies as T002 (NOT T1201)
* [ ] Evidence field populated with structured Hebrew reasoning (category → specific type)
* [ ] Prompt caching still works (check `cache_creation_input_tokens` in API response)
* [ ] No runtime errors on Classify Document node

## 8. Implementation Notes (Post-Code)

**Pushed:** 2026-03-09 via n8n REST API PUT
**Node:** `22ed433d-fdcb-4afc-9ce2-c14cab2861c4` (Prepare Attachments)
**Workflow:** `cIa23K8v1PrbDJqY` ([05] Inbound Document Processing)
**Code file:** `tmp/prepare-attachments-v4.js` (33,118 chars, 589 lines)

### Changes applied:
1. `ALL_TEMPLATE_IDS` — static array of all 33 template IDs (was client-scoped)
2. Schema field order: `evidence → issuer_name → confidence → matched_template_id`
3. Enhanced evidence description with guided CoT (category → type reasoning)
4. Confusing-pairs disambiguation section (T401/T501, T501/T303, T901/T902, T1101/T1102, T201/T202)
5. Non-required docs note in system prompt

### Preserved from DL-131:
- NII routing table (explicit subtype → template mapping)
- Clean docsCtx format (HTML stripped)
- Client name in prompt
- `strict: true` + `anyOf` nullable pattern
- `anthropic-beta` header on Classify Document node

### Verification:
- [x] Workflow updated (52 nodes, active)
- [x] ALL_TEMPLATE_IDS present
- [x] Evidence field comes before matched_template_id
- [x] Confused pairs section present
- [ ] Testing pending — see validation plan in §7
