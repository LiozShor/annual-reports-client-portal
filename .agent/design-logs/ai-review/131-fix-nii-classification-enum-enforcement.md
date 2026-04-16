# Design Log 131: Fix NII Classification & Enum Enforcement
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-09
**Related Logs:** [035-wf05-ai-classification](035-wf05-ai-classification-onedrive-upload.md), [046-wf05-loop-restructure](046-wf05-loop-restructure-classification-optimization.md), [112-webhook-dedup-and-issuer-display](112-webhook-dedup-and-issuer-display.md)

## 1. Context & Problem

The AI document classifier (WF05, Claude Haiku 4.5 via tool-use) misclassified a "דמי אבטלה" (unemployment) NII document as T304 (דמי לידה / maternity benefits). The LLM's own evidence correctly identified the content as "דמי אבטלה" but chose the wrong template.

**Three root causes identified:**

1. **No schema-level enum constraint** — The tool schema uses `type: ['string', 'null']` with a description listing valid IDs, but no actual `enum`. The LLM returned T304 (maternity) which wasn't even in the client's required docs.

2. **Incomplete NII routing rules** — The system prompt only maps 3 of 6+ NII subtypes:
   - נכות → T303 ✓
   - דמי לידה → T304 ✓
   - שאירים → T305/T306 ✓
   - **Missing:** אבטלה, מילואים, פגיעה בעבודה, גמלת נכות מעבודה → T301/T302

3. **Terse docs context format** — Required docs shown as `- T302, issuer: <b>אבטלה</b>...` with HTML tags and misleading "issuer:" prefix, burying the allowance type differentiator.

## 2. User Requirements

1. **Q:** Should we enum-restrict template IDs to only the client's required docs?
   **A:** Yes — enforce with enum + `strict: true`. Unrequested docs classify as null.

2. **Q:** Should we list ALL NII allowance types explicitly in the prompt?
   **A:** Yes — explicit routing table for all subtypes.

3. **Q:** Should we improve the docsCtx format?
   **A:** Yes — structured format, strip HTML, show full name prominently.

4. **Q:** Should we add person-matching (client vs spouse) hints?
   **A:** Yes — add client name to prompt so LLM can match NII names to client/spouse.

## 3. Research

### Domain
LLM classification prompt engineering, tool-use schema constraints, Hebrew NLP.

### Sources Consulted
1. **Anthropic Structured Outputs Docs** — `strict: true` + `enum` on tool schema enables constrained decoding at the token level. Model literally cannot produce values outside the enum. Requires `anthropic-beta: structured-outputs-2025-11-13` header.
2. **TaxMorph (WWW 2025)** — Hierarchical classification with LLM-refined taxonomies. When classes have "identical leaf names under similar parent nodes" (exactly our NII subtype problem), explicit disambiguation rules improve F1 by 2-5%.
3. **Arize/Phoenix — LLM Classification Prompting** — For 30+ class classification: use discriminating descriptions with "NOT this class" notes for confusing pairs; show all synonyms per class; keep enum values as English codes.
4. **Hebrew LLM Classification (Gili Nachum)** — Claude performs well on Hebrew (93%+ on 11-class task). Main pitfall: overlapping domain terms (ביטוח לאומי / ביטוח פנסיוני / ביטוח חיים all start with "ביטוח").

### Key Principles Extracted
- **Constrained decoding > description hints** — Token-level enforcement prevents hallucinated IDs entirely. Description hints are "best effort."
- **Discriminating context** — For similar classes, the prompt must explicitly state how to differentiate (NII subtype routing table).
- **Client-scoped enum** — Dynamic enum per client eliminates impossible choices, reducing the decision space.

### Patterns to Use
- **`strict: true` + `enum`** on the `matched_template_id` property
- **Explicit routing table** for NII subtypes with person-matching rules
- **Cleaned docs context** — strip HTML, show `template_id: full_resolved_name (person)` format

### Anti-Patterns to Avoid
- **Description-only constraints** — Current approach. LLM ignores them under uncertainty.
- **Generic "based on type" rules** — Too vague for similar-sounding NII subtypes.

### Research Verdict
Add `strict: true` + `enum` for hard enforcement, plus an explicit NII routing table and cleaner docs context for soft guidance. The hard constraint prevents impossible classifications; the soft guidance helps the LLM pick the RIGHT template from the valid set.

## 4. Codebase Analysis

### Existing Solutions Found
- **`Prepare Attachments` code node** (`22ed433d-...` in WF05 `cIa23K8v1PrbDJqY`): Already builds `validTemplateIds` from `[...new Set(requiredDocs.map(d => d.type))]`. Just needs to be used as an actual enum.
- **`Classify Document` HTTP node** (`f9b2d119-...`): Already sends custom headers. Just needs the `anthropic-beta` header added.
- **DOC_TYPE_REFERENCE constant**: Already has detailed per-template descriptions. NII section already partially maps subtypes. Just needs completion.

### Reuse Decision
- Reuse `validTemplateIds` construction — just wire it into the enum
- Extend DOC_TYPE_REFERENCE NII entries with explicit disambiguation
- Modify `docsCtx` builder — strip HTML, change format

### Dependencies
- Anthropic `structured-outputs-2025-11-13` beta feature
- WF05 must be active for classifications to work

## 5. Technical Constraints & Risks

- **Risk:** `strict: true` first-request compilation overhead (100-300ms) — negligible vs 5s batch interval
- **Risk:** Prompt caching interaction — `validTemplateIds` changes per client, so tool definition won't cache across clients. But DOC_TYPE_REFERENCE (the big part) still caches. Net impact: minimal.
- **Risk:** `strict` mode requires `additionalProperties: false` and all fields in `required` — current schema already has this.
- **Breaking changes:** None — same API response shape, just more accurate classifications.

## 6. Proposed Solution (The Blueprint)

### Part 1: Tool schema changes (`Prepare Attachments` jsCode)

**Add enum to `matched_template_id`:**
```javascript
matched_template_id: {
  type: ['string', 'null'],
  enum: [null, ...validTemplateIds],
  description: 'Template ID from the required docs list. null if no match.'
}
```

**Add `strict: true` and `additionalProperties: false`:**
```javascript
const toolDefinition = {
  name: 'classify_document',
  description: '...',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: { ... },
    required: [...]
  },
  cache_control: { type: 'ephemeral' }
};
```

### Part 2: HTTP header (`Classify Document` node)

Add: `{ "name": "anthropic-beta", "value": "structured-outputs-2025-11-13" }`

### Part 3: NII routing table (system prompt)

Replace:
```
- ביטוח לאומי (NII): T301-T306 based on type (נכות=T303, דמי לידה=T304, שאירים=T305/T306)
```

With:
```
- ביטוח לאומי (NII) — MUST match by allowance type AND person:
  • נכות (disability) → T303
  • דמי לידה (maternity) → T304
  • קצבת שאירים (survivors), client → T305; spouse → T306
  • אבטלה (unemployment) → T301 (client) or T302 (spouse)
  • מילואים (reserves) → T301 (client) or T302 (spouse)
  • פגיעה בעבודה (work injury) → T301 (client) or T302 (spouse)
  • גמלת נכות מעבודה (work disability benefit) → T301 (client) or T302 (spouse)
  • Any other NII type → T301 (client) or T302 (spouse)
  Person hint: The client's name is provided below. If the NII document shows a different name, it's likely for the spouse — use T302/T306 instead of T301/T305.
```

### Part 4: Improved docsCtx format

```javascript
const docsCtx = requiredDocs.length > 0
  ? requiredDocs.map(d => {
      const name = (d.issuer_name || '').replace(/<\/?b>/g, '');
      const p = d.person === 'spouse' ? ' (spouse)' : '';
      return `- ${d.type}: ${name}${p}`;
    }).join('\n')
  : 'No required documents found for this client.';
```

### Part 5: Add client name to prompt

Before the docs list:
```
Client name: ${clientName}

The client's required documents (not yet received):
${docsCtx}
```

### Files to Change

| Location | Action | Description |
|----------|--------|-------------|
| n8n `Prepare Attachments` code node | Modify jsCode | enum + strict + NII rules + docsCtx + client name |
| n8n `Classify Document` HTTP node | Add header | `anthropic-beta: structured-outputs-2025-11-13` |

### Final Step
Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy validation items to `current-status.md`.

## 7. Validation Plan

* [ ] API returns only valid template IDs from enum (no T304 when not in required docs)
* [ ] `bituach_leumi_avtalah.pdf` classifies as T302 (unemployment, spouse) — NOT T304
* [ ] Other 14 test classifications remain correct (T201, T601, T501, T401, etc.)
* [ ] NII disability doc (`bituach_yashir_shnati.jpg`) still classifies as T303
* [ ] Prompt caching still works (check `cache_creation_input_tokens` in API response)
* [ ] No runtime errors on the Classify Document node (strict mode header accepted)
* [ ] Enum compilation doesn't cause timeout (should be <300ms)

## 8. Implementation Notes (Post-Code)

**Implemented 2026-03-09.** Both nodes updated via `n8n_update_partial_workflow` (2 operations, atomic).

### Changes Applied

1. **`Prepare Attachments` code node** (`22ed433d-...`):
   - `docsCtx`: Removed `const desc`, removed `iss` with `, issuer:` prefix. Now strips HTML `<b>` tags from `issuer_name` and uses `- T302: אבטלה (spouse)` format.
   - `toolDefinition`: Added `strict: true` at tool level, `additionalProperties: false` on `input_schema`, `enum: [null, ...validTemplateIds]` on `matched_template_id`.
   - System prompt: Added `Client name: ${clientName}` before the docs list.
   - NII routing: Replaced single-line rule with 10-line explicit routing table covering all 7+ NII subtypes with person-matching guidance.

2. **`Classify Document` HTTP node** (`f9b2d119-...`):
   - Added `anthropic-beta: structured-outputs-2025-11-13` header alongside existing `anthropic-version` and `content-type` headers.

### Verification
- Workflow structure verified: 52 nodes, 50 connections unchanged.
- Workflow remains active.
- User will test by re-sending the same documents and observing classification results.
