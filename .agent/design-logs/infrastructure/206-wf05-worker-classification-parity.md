# Design Log 206: WF05 Worker — Classification Prompt Parity
**Status:** [COMPLETE]
**Date:** 2026-03-26
**Related Logs:** [203](203-wf05-worker-migration.md), [131](../ai-review/131-fix-nii-classification-enum-enforcement.md), [134](../ai-review/134-fix-classification-field-ordering-full-enum.md), [136](../ai-review/136-fix-issuer-matching-multi-instance.md), [143](../ai-review/143-classification-test-bugfixes.md), [144](../ai-review/144-fix-issuer-matching-compare-issuer-key.md)

## 1. Context & Problem

DL-203 migrated WF05 from n8n (56 nodes) to a Cloudflare Worker. The pipeline works end-to-end: dedup, email fetch, client identification, OneDrive upload, Airtable records — all verified in production.

**However**, the classification prompt in `document-classifier.ts` is a minimal 3-line stub. The actual n8n Prepare Attachments node had ~350 lines of carefully tuned classification logic built over 6+ design logs. This means classifications will be low-quality until ported.

## 2. What's Missing (audited against n8n backup)

### Classification Prompt (CRITICAL)
| # | Gap | Source DL | Lines |
|---|-----|-----------|-------|
| 1 | **DOC_TYPE_REFERENCE** — 200-line detailed guide for all 34 template types with Hebrew names, issuer info, common filenames, visual descriptions, disambiguation notes | DL-035 | ~195 |
| 2 | **System prompt** — step-by-step classification rules: person check → category identification → template-specific rules → NII routing → insurance rules → rental rules | DL-131/134 | ~70 |
| 3 | **Confusing-pairs section** — T401 vs T501, T901 vs T1601, T201 vs T202, T1101 vs T1102, etc. | DL-134 | ~10 |
| 4 | **Client name in prompt** — for person matching (client vs spouse) | DL-131 | 1 |
| 5 | **Required docs context** — formatted list with person tag + cleaned issuer name | DL-131 | ~5 |

### Tool Schema (CRITICAL)
| # | Gap | Source DL |
|---|-----|-----------|
| 6 | `strict: true` + `additionalProperties: false` | DL-131 |
| 7 | Full 33-ID enum (`ALL_TEMPLATE_IDS`) — not client-scoped | DL-134 |
| 8 | Evidence-first field ordering (evidence → issuer → confidence → template_id) | DL-134 |
| 9 | Detailed `evidence` description with guided CoT | DL-134 |
| 10 | Detailed `issuer_name` rules (NII benefit types, T303 null, T305/T306 survivor details) | DL-131 |
| 11 | Prompt caching (`cache_control: { type: 'ephemeral' }`) | DL-046 |

### Size-Based Routing (MEDIUM)
| # | Gap | Source DL |
|---|-----|-----------|
| 12 | Large PDF threshold (5MB) — metadata-only mode for huge files | DL-046/143 |
| 13 | User prompt varies: full content vs filename+email context only | DL-046 |

### Issuer Matching (MEDIUM)
| # | Gap | Source DL |
|---|-----|-----------|
| 14 | Compare against `issuer_key` field in addition to `issuer_name` | DL-144 |
| 15 | `QUALITY_RANK` map for score-aware best match | DL-136 |

## 3. What's Already Working (no changes needed)

- ✅ KV dedup (write-first-then-verify pattern)
- ✅ Email fetch + metadata extraction + auto-reply filtering
- ✅ Client identification (4-tier cascade)
- ✅ OneDrive shared folder resolution + upload with conflictBehavior=rename
- ✅ Image→PDF conversion (JPEG/PNG)
- ✅ Office→PDF conversion (MS Graph ?format=pdf)
- ✅ Email event tracking (upsert + status updates)
- ✅ Pending classification records (all 25 fields)
- ✅ Document record updates
- ✅ Client notes (JSON array format, dedup, forward-skip)
- ✅ Issuer matching (entity stop words, token overlap) — needs issuer_key addition
- ✅ Synchronous processing (no waitUntil timeout)

## 4. Implementation Plan

### File: `api/src/lib/inbound/document-classifier.ts` — full rewrite

1. **Add DOC_TYPE_REFERENCE constant** — copy verbatim from n8n backup (lines 198-393)
2. **Add ALL_TEMPLATE_IDS constant** — full 33-ID array
3. **Rewrite tool schema** — strict mode, evidence-first ordering, detailed field descriptions
4. **Rewrite `classifyAttachment()`**:
   - Accept `clientName` parameter (for person matching)
   - Build `docsCtx` with person tags + cleaned issuer names
   - Build system prompt array with cache_control
   - Size-based routing: >5MB → metadata-only user prompt
   - Add `anthropic-beta: prompt-caching-2024-07-31` header
5. **Add `issuer_key` to `findBestDocMatch()`** — dual-field matching with QUALITY_RANK

### File: `api/src/lib/inbound/processor.ts` — minor updates

1. Pass `clientName` to `classifyAttachment()`
2. Add `issuer_key` to documents query fields
3. Pass `emailData` (subject, body_preview, sender) to classifier for size-routing prompt

### Estimated scope
- ~400 lines of prompt/schema constants (copy from backup)
- ~50 lines of logic changes
- No new files needed

## 5. Source Material

The exact prompt text is preserved in:
- **n8n backup**: `docs/wf05-backup-pre-migration-2026-03-26.json` → Prepare Attachments node → jsCode lines 198-545
- **Design logs**: DL-131, DL-134, DL-136, DL-143, DL-144

## 6. Validation Plan

* [ ] Classification of test email with mixed attachments — compare template IDs + confidence against n8n results
* [ ] NII document correctly routes to T302/T303/T305/T306 based on benefit type + person
* [ ] T201 vs T202 correctly uses person matching (client vs spouse name)
* [ ] T401 vs T501 disambiguation works (withdrawal vs deposit)
* [ ] Large PDF (>5MB) classified in metadata-only mode with lower confidence
* [ ] issuer_key matching — multi-instance docs (multiple T601s) matched correctly
* [ ] Full 33-ID enum — docs not in required list still get classified

## 7. Session Fixes Applied (2026-03-26)

Bugs fixed during this session (already deployed):
- `email_secondary` → `cc_email` (clients table)
- `client_name` → `name` (clients table)
- `client_record_id` → `client` (reports table)
- `title_he` doesn't exist → use TEMPLATE_TITLES map
- `email_direct` → `email_match` (singleSelect option)
- `NoActiveReport`/`Filtered` → valid processing_status options
- `issuer_match_quality: 'matched'` → use actual quality from classifier
- `year` as string → number
- Remove non-existent email_events fields (match_confidence, client_name, attachment_count)
- KV dedup race condition → write-first-then-verify
- `waitUntil` 30s timeout → synchronous processing
- OneDrive `items/root:` → shared folder root via sharing token
- HTTP Request node v1 → v4.2
- `conflictBehavior=rename` on uploads
