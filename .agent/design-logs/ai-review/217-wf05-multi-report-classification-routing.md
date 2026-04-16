# Design Log 217: WF05 Multi-Report Classification Routing

**Status:** [IMPLEMENTED]
**Date:** 2026-03-29
**Related Logs:** DL-164 (filing_type layer), DL-203 (WF05 Worker migration), DL-206/207 (classification parity), DL-216 (admin tab scoping)

## 1. Context & Problem

When a client has **both an AR and CS report active** (both in `Collecting_Docs` or `Review` stage), and they send a document by email, WF05's `getActiveReport()` picks one report arbitrarily (latest year, first match). The classification then runs against only that report's required documents, potentially:

1. Missing the correct match (doc is for CS but classified against AR templates)
2. Creating the classification record linked to the wrong report
3. Leaving Natan unable to route the document to the correct report

**Root cause:** `getActiveReport()` returns a single report. The pipeline is single-report-scoped from step 9 onward.

## 2. User Requirements

1. **Q:** How should the system decide which report a doc belongs to?
   **A:** Classify against BOTH report's document lists. If it matches an AR template → link to AR report. If CS → CS. If ambiguous → show both options in AI Review for Natan.

2. **Q:** Unified or separate classifier prompts?
   **A:** Unified prompt — one DOC_TYPE_REFERENCE with all templates (AR tagged, CS tagged). AI picks best match, we infer filing type from template ID prefix.

3. **Q:** Will both reports be active simultaneously?
   **A:** Yes, very likely. Both in Collecting_Docs at the same time.

4. **Q:** What about unmatched documents?
   **A:** Show both report options in review — don't default to either.

## 3. Research

### Domain
Multi-label document classification, document routing in multi-entity systems.

### Key Principles Extracted
- **Separate classification from routing.** Classification answers "what is this?" — routing answers "where does it go?" The template ID determines the document type; the template's filing_type determines the report.
- **Exploit system state for routing.** Template exclusivity (CS-T001 can only belong to CS) resolves 100% of routing in our case — AR and CS templates use entirely different ID prefixes.
- **Template ID IS the routing signal.** AR uses `T001-T1701`, CS uses `CS-T001-CS-T022`. Zero overlap. No need for confidence comparison or disambiguation logic.

### Research Verdict
Because AR and CS template IDs are completely disjoint (`T*` vs `CS-T*`), the routing problem is much simpler than the general case. The AI classifies using a unified template list → the returned template ID's prefix determines the filing type → we look up the correct report. No ambiguity possible at the template level.

## 4. Codebase Analysis

### Critical Files
- `api/src/lib/inbound/processor.ts` — Main pipeline, `getActiveReport()` (line 157), `processEmail()` (line 509), `processAttachmentWithClassification()` (line 330)
- `api/src/lib/inbound/types.ts` — `ActiveReport` (line 110), `ClassificationResult` (line 122)
- `api/src/lib/inbound/document-classifier.ts` — `DOC_TYPE_REFERENCE` (line 42), `ALL_TEMPLATE_IDS` (line 31), `buildSystemPrompt()` (line 262), `classifyAttachment()` (line 475), `findBestDocMatch()` (line 406)

### Current Flow
```
Email → identifyClient() → getActiveReport(clientId) → [SINGLE REPORT]
  → fetch requiredDocs for that report
  → classifyAttachment(attachment, requiredDocs, ...)
  → processAttachmentWithClassification() → write to PENDING_CLASSIFICATIONS
```

### Existing Solutions Found
- `report_key` formula in Airtable already includes `filing_type` — so `requiredDocs` are inherently scoped to a report's filing type via `report_key_lookup`
- `documents_templates` table has `filing_type` field (DL-164)
- Template ID prefixes are disjoint: AR = `T*`, CS = `CS-T*`

### Key Insight: Route by Template ID Prefix
Since template IDs are disjoint, we don't need complex disambiguation. The pipeline becomes:
1. Fetch ALL active reports for the client (not just one)
2. Merge required docs from all reports into one list
3. Classify against the merged list (unified prompt with all templates)
4. After classification: look up which report the matched template belongs to
5. Link the classification record to the correct report

## 5. Technical Constraints & Risks

- **Classifier prompt size:** Adding CS templates to DOC_TYPE_REFERENCE increases prompt size. Currently 31 AR templates; CS adds up to 22. Still well within limits, and using prompt caching.
- **Required docs merge:** Different reports may have different `report_key_lookup` values. Must track which doc belongs to which report for `findBestDocMatch`.
- **Unmatched documents:** When template_id is null (no match), we need a fallback report — user chose "show both options in review."
- **No breaking changes:** When a client has only one report (the common case), behavior is identical to current.
- **CS templates not yet in DOC_TYPE_REFERENCE:** The CS template descriptions need to be added. This is a content task — write descriptions for CS-T001 through CS-T022.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
When a dual AR+CS client sends a document, it is classified against all templates and linked to the correct report based on the matched template's filing type. Natan sees the document in the correct entity tab's AI Review.

### Logic Flow

**Step 1: Fetch ALL active reports (not just one)**
- `getActiveReports()` (plural) returns `ActiveReport[]` instead of `ActiveReport | null`
- Add `filingType` to `ActiveReport` interface
- Keep the same Airtable filter, but return ALL matching reports (not just first)
- Add `filing_type` to fetched fields

**Step 2: Merge required docs from all reports**
- Fetch `requiredDocs` for each report (each has unique `report_key`)
- Tag each doc with its source `reportRecordId` so we know which report it belongs to
- Pass the merged list to the classifier

**Step 3: Add CS templates to DOC_TYPE_REFERENCE**
- Add CS-T001 through CS-T022 descriptions to the reference
- Add `CS-T*` IDs to `ALL_TEMPLATE_IDS`
- Update `CLASSIFY_TOOL` enum to include CS template IDs

**Step 4: Classify with unified prompt**
- `classifyAttachment()` receives the merged required docs list
- `buildSystemPrompt()` includes all templates (AR + CS) — the AI picks the best match
- `findBestDocMatch()` already filters by `templateId` against `requiredDocs` — works with merged list

**Step 5: Route classification to correct report**
- After classification: if `templateId` starts with `CS-` → find the CS report from `activeReports`
- If `templateId` starts with `T` → find the AR report
- If `templateId` is null (unmatched) → use the first report (arbitrary) but mark for human review
- The `report` field in the classification record links to the correct report

**Step 6: Handle single-report clients (no regression)**
- If only one active report → same as today, just with `activeReports[0]`
- The merged docs list has only one report's docs → identical behavior

### Data Structures / Schema Changes

**`ActiveReport` interface (types.ts):**
```typescript
export interface ActiveReport {
  reportRecordId: string;
  reportKey: string;
  year: number;
  stage: string;
  clientName: string;
  filingType: string;  // NEW: 'annual_report' | 'capital_statement'
}
```

**`ClassificationResult` — no change needed.** The `templateId` prefix IS the filing type signal.

**No Airtable schema changes needed.** The `pending_classifications.report` link field already exists and will point to the correct report.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/types.ts` | Modify | Add `filingType` to `ActiveReport` |
| `api/src/lib/inbound/processor.ts` | Modify | `getActiveReport()` → `getActiveReports()` (returns array), merge requiredDocs, route by template prefix |
| `api/src/lib/inbound/document-classifier.ts` | Modify | Add CS template IDs to `ALL_TEMPLATE_IDS`, add CS descriptions to `DOC_TYPE_REFERENCE`, update `CLASSIFY_TOOL` enum |
| `api/src/lib/inbound/document-classifier.ts` | Modify | `findBestDocMatch()` — tag results with source report |

### Implementation Order

1. Add `filingType` to `ActiveReport` interface
2. `getActiveReport()` → `getActiveReports()` — return all active reports with filing_type
3. Update `processEmail()` — merge requiredDocs from all reports, track report mapping
4. Update `findBestDocMatch()` to return which report the matched doc belongs to
5. Update `processAttachmentWithClassification()` to use the matched report (not a single hardcoded one)
6. Add CS templates to `DOC_TYPE_REFERENCE` + `ALL_TEMPLATE_IDS` + tool enum
7. Deploy + test
8. Housekeeping

### Final Step
- Housekeeping: update design log, INDEX, current-status

## 7. Validation Plan

- [ ] Single-report AR client: sends doc → classified against AR templates, linked to AR report (no regression)
- [ ] Dual AR+CS client: sends AR doc (e.g., Form 106) → linked to AR report
- [ ] Dual AR+CS client: sends CS doc (e.g., bank ID) → linked to CS report
- [ ] Unmatched doc for dual client → classification created, linked to a report, review_status='pending'
- [ ] CS tab in admin shows only CS classifications; AR tab shows only AR
- [ ] Single CS-only client: sends doc → classified against CS templates, linked to CS report
- [ ] No active report for client → NeedsHuman (same as before)
- [ ] TypeScript compiles, wrangler deploy succeeds

## 8. Implementation Notes (Post-Code)

*To be filled during implementation.*
