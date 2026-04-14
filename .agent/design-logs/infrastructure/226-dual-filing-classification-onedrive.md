# Design Log 226: Dual-Filing Classification & OneDrive Folder Architecture
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-30
**Related Logs:** DL-207 (WF05 Gap Audit), DL-219 (Second Filing Type), DL-203 (WF05 Migration), DL-206 (Classification Parity)

## 1. Context & Problem

Currently, when a client sends a document to the system, WF05 classifies it and routes it to **one** report (AR or CS) based on the template prefix (`CS-T*` → CS, `T*` → AR). However, some documents can satisfy requirements for **both** filing types simultaneously.

**Example:** A bank sends one comprehensive annual securities statement. This document is both:
- **T601** (Form 867 — Securities Annual Report) for the Annual Report
- **CS-T018** (Securities Balance Certificate) for the Capital Statement

The client shouldn't need to send the same document twice. The system must recognize dual-match scenarios and create records for both reports.

**Additionally:** OneDrive folder structure needs a filing-type layer. Currently all docs go into `{client}/{year}/{זוהו|ממתינים}`, with no separation between AR and CS documents.

## 2. User Requirements

1. **Q:** When a document matches both AR and CS, should WF05 create TWO separate records?
   **A:** Yes — duplicate records (one per filing type). Each has its own status, review, filename. Same PDF uploaded to both OneDrive folders.

2. **Q:** Should the AI classifier detect dual-match automatically?
   **A:** Yes — AI auto-detect. Classifier returns multiple matches when confident. Both records created automatically.

3. **Q:** Should approve/reject actions be independent per report?
   **A:** Fully independent. Each record has its own review lifecycle.

4. **Q:** How common is this dual-match scenario?
   **A:** Moderate (a handful of clients). Justifies proper implementation but not over-engineering.

5. **Q:** OneDrive storage model for dual matches?
   **A:** Copy PDF to both folders. Each folder is self-contained.

6. **Q:** Do CS folders exist in OneDrive?
   **A:** No — needs to be designed. Structure: `{client}/{year}/דוחות שנתיים/...` and `{client}/{year}/הצהרות הון/...`

## 3. Research

### Domain
Multi-label document classification, idempotent dual-record creation, OneDrive folder architecture.

### Sources Consulted
1. **Multi-label classification patterns** — Use independent binary classification per filing type ("Is this AR?" + "Is this CS?") rather than exclusive single-label. Return structured array of matches.
2. **OneDrive Graph API** — Hebrew folder names fully supported (Unicode). `conflictBehavior: "fail"` for idempotent folder creation. No native multi-destination upload — two independent PUT requests.
3. **Airtable batch operations** — Batch creates (up to 10 records) are all-or-nothing. Use `performUpsert` with `fieldsToMergeOn` for idempotent retries.

### Key Principles Extracted
- **Single classification call, multi-label output:** One AI call returns all applicable template IDs (primary + additional). Cheaper and more contextually accurate than two separate calls.
- **Idempotent dual-record creation:** Use Airtable batch upsert with `[source_hash, filing_type]` as merge key to prevent duplicates on retry.
- **Independent upload paths:** Two OneDrive PUTs are independently retryable. Track state per step so partial failures can resume.

### Patterns to Use
- **Array-based tool schema:** `additional_matches: [{template_id, evidence, issuer_name, confidence}]` in the AI tool output
- **Filing-type subfolder injection:** Insert between year and identification subfolder in OneDrive path

### Anti-Patterns to Avoid
- **Two separate AI calls** per attachment (one for AR, one for CS): Doubles cost, loses cross-context reasoning
- **Shared file references** between reports: Fragile, breaks the "each report folder is self-contained" principle
- **Implicit dual-match from template overlap:** Don't auto-duplicate just because T601 and CS-T018 are "similar" — let the AI decide based on document content

### Research Verdict
Single AI call with multi-label output. Process each match independently through the existing pipeline (upload + record creation). OneDrive gets filing-type subfolder layer.

## 4. Codebase Analysis

### Existing Solutions Found
- **`uploadToOneDrive()`** (`attachment-utils.ts:91-108`): Current path = `{client}/{year}/{folder}/{filename}`. Needs one more segment.
- **Template routing** (`processor.ts:654-660`): Currently `isCS = templateId.startsWith('CS-')` → routes to one report. Must become a loop.
- **Tool schema** (`document-classifier.ts:307-340`): Returns single `matched_template_id`. Must add `additional_matches` array.
- **`processAttachmentWithClassification()`** (`processor.ts:325-400`): Processes one attachment → one report. Must be callable multiple times for same attachment.
- **Admin upload** (`upload-document.ts:85`): Hardcoded path `/{year}/מסמכים שזוהו/`. Must add filing-type segment.

### Reuse Decision
- **Reuse** `uploadToOneDrive()` as-is — just change the `folder` arg to include filing-type prefix
- **Reuse** `processAttachmentWithClassification()` — call it once per match (it already takes `report` as a param)
- **Extend** AI tool schema — add `additional_matches` field
- **Extend** routing loop in processor.ts — iterate over primary + additional matches

### Relevant Files
| File | Lines | Role |
|------|-------|------|
| `api/src/lib/inbound/document-classifier.ts` | 1-455 | Tool schema, prompt, template IDs |
| `api/src/lib/inbound/processor.ts` | 325-690 | Upload + routing + record creation |
| `api/src/lib/inbound/attachment-utils.ts` | 91-108 | OneDrive upload path |
| `api/src/routes/upload-document.ts` | 82-86 | Admin manual upload path |

### Alignment with Research
- Current single-label approach matches research anti-pattern. Moving to multi-label aligns with best practices.
- Current flat year folder aligns with research recommendation to add filing-type segmentation.

## 5. Technical Constraints & Risks

* **Security:** No new auth concerns — same Airtable/Graph tokens.
* **Risks:**
  - **Breaking existing OneDrive paths**: All previously uploaded docs are at `{client}/{year}/זוהו/`. New docs will be at `{client}/{year}/דוחות שנתיים/זוהו/`. Existing files won't move automatically.
  - **Admin upload-document route** uses different subfolder naming (`מסמכים שזוהו`) — must update too.
  - **Pending classification records**: Currently one per attachment. Dual-match means two records per attachment — review UI must handle this.
* **Breaking Changes:**
  - OneDrive folder structure change is **non-breaking** for existing files (they stay where they are). New files go to new structure.
  - AI tool schema change is backwards-compatible (additional_matches defaults to empty array).

## 6. Proposed Solution (The Blueprint)

### Success Criteria
A single inbound document that matches both AR and CS requirements is classified once, creates two independent Airtable records (one per filing type), and uploads the PDF to both report folders in OneDrive — with the new `{client}/{year}/{דוחות שנתיים|הצהרות הון}/{זוהו|ממתינים}/` folder structure.

### OneDrive Folder Structure (NEW)

```
לקוחות/
  {Client Name}/
    {Year}/
      דוחות שנתיים/          ← Annual Report docs
        זוהו/                 ← Identified/classified
          T601 - ני"ע - פועלים.pdf
        ממתינים לזיהוי/        ← Unidentified/pending
      הצהרות הון/             ← Capital Statement docs
        זוהו/
          CS-T018 - ני"ע - פועלים.pdf
        ממתינים לזיהוי/
```

**Filing-type folder names:**
- `annual_report` → `דוחות שנתיים`
- `capital_statement` → `הצהרות הון`

### Logic Flow

#### A. AI Tool Schema Change (`document-classifier.ts`)
1. Add `additional_matches` field to the classify_document tool:
   ```
   additional_matches: {
     type: "array",
     items: {
       type: "object",
       properties: {
         template_id: { enum: ALL_TEMPLATE_IDS },
         evidence: { type: "string" },
         issuer_name: { anyOf: [string, null] },
         confidence: { type: "number" }
       }
     },
     description: "If this document also satisfies a requirement for the OTHER filing type, include the secondary match here."
   }
   ```
2. Add instruction to system prompt: "If a document serves requirements for BOTH Annual Report (T*) and Capital Statement (CS-T*), return the primary match as usual and add the secondary match in additional_matches."
3. Add dual-match disambiguation section listing known overlaps:
   - T601 (Form 867) ↔ CS-T018 (Securities Balance): Same bank statement
   - T501 (Annual Deposit Report) ↔ CS-T013/T014/T015 (Pension/Fund Tax Certs): Same insurance company certificate
   - T401 (Fund Withdrawal) ↔ CS-T013 (Pension Tax Cert): Same company, different purpose

#### B. OneDrive Path Change (`attachment-utils.ts` + `processor.ts`)
1. Add filing-type folder name map:
   ```typescript
   const FILING_TYPE_FOLDER: Record<string, string> = {
     annual_report: 'דוחות שנתיים',
     capital_statement: 'הצהרות הון',
   };
   ```
2. Update `uploadToOneDrive()` signature to accept `filingType` parameter
3. Build path: `{client}/{year}/{filingTypeFolder}/{identificationSubfolder}/{filename}`
4. Update admin `upload-document.ts` to use same pattern

#### C. Processor Routing Change (`processor.ts`)
1. After classification, collect all matches:
   ```typescript
   const allMatches = [{ ...primaryClassification }];
   if (classification.additionalMatches?.length) {
     allMatches.push(...classification.additionalMatches);
   }
   ```
2. For each match, determine the target report and call `processAttachmentWithClassification()`:
   ```typescript
   for (const match of allMatches) {
     const isCS = match.templateId.startsWith('CS-');
     const targetReport = activeReports.find(r =>
       isCS ? r.filingType === 'capital_statement' : r.filingType !== 'capital_statement'
     );
     if (!targetReport) continue; // No matching report exists
     await processAttachmentWithClassification(pCtx, attachment, metadata, clientMatch, targetReport, requiredDocs, emailEventId, oneDriveRoot, match);
   }
   ```
3. Pass `targetReport.filingType` through to `uploadToOneDrive()`

#### D. Classification Result Types (`types.ts`)
1. Extend `ClassificationResult` interface:
   ```typescript
   interface ClassificationResult {
     templateId: string | null;
     evidence: string;
     issuerName: string;
     confidence: number;
     matchedDocRecordId?: string;
     additionalMatches?: Array<{
       templateId: string;
       evidence: string;
       issuerName: string;
       confidence: number;
     }>;
   }
   ```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/inbound/document-classifier.ts` | Modify | Add `additional_matches` to tool schema + prompt instructions |
| `api/src/lib/inbound/processor.ts` | Modify | Routing loop for multi-match, pass filingType to upload |
| `api/src/lib/inbound/attachment-utils.ts` | Modify | Add `filingType` param to `uploadToOneDrive()`, update path |
| `api/src/lib/inbound/types.ts` | Modify | Extend `ClassificationResult` with `additionalMatches` |
| `api/src/routes/upload-document.ts` | Modify | Add filing-type subfolder to admin upload path |

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status.md

## 7. Validation Plan
* [ ] Send a securities PDF (Form 867) for a client with both AR and CS reports → verify TWO classification records created
* [ ] Verify AR record has templateId=T601, CS record has templateId=CS-T018
* [ ] Verify PDF uploaded to both `{year}/דוחות שנתיים/זוהו/` and `{year}/הצהרות הון/זוהו/`
* [ ] Send a doc that only matches AR → verify only ONE record created, uploaded to `דוחות שנתיים` folder
* [ ] Send a doc that only matches CS → verify only ONE record created, uploaded to `הצהרות הון` folder
* [ ] Send an unidentified doc → verify uploaded to primary report's `ממתינים לזיהוי` (NOT duplicated)
* [ ] Approve AR classification → verify CS classification remains independent
* [ ] Reject CS classification → verify AR classification unaffected
* [ ] Admin manual upload (`upload-document.ts`) → verify correct filing-type subfolder
* [ ] Client with only AR report (no CS) sends doc that could be dual → verify only AR record created (no orphan CS record)
* [ ] Verify no regression on single-filing-type clients

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
