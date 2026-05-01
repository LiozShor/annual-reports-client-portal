# Dual-Filing Type Research: Multi-Label Classification, OneDrive Architecture, Idempotent Record Creation

**Date:** 2026-03-30
**Context:** AI classifier returns multiple matches → create duplicate Airtable records → upload same PDF to two OneDrive folders

---

## Topic 1: Multi-Label Document Classification Patterns

### Source 1: Document Classification and Tagging with LLM and ML
**URL:** https://medium.com/@andy.bosyi/document-classification-and-tagging-with-llm-and-ml-ea404599dcc6

**Key Principle:** Multi-label classification (one document → multiple categories) differs fundamentally from single-label. The recommended approach is **sequential binary classification** — query each potential category individually with a binary yes/no rather than asking the LLM to return all labels at once. This increases API calls but dramatically improves accuracy.

**Application to our system:** When a document arrives (e.g., a payslip), the AI classifier should ask: "Is this relevant to Annual Report?" (yes/no) and "Is this relevant to Capital Statement?" (yes/no) independently, rather than "Which filing types does this belong to?" This maps cleanly to our dual filing type model where a document can match both AR and CS.

**Anti-patterns:**
- Trusting raw confidence scores without calibration
- Using complex models when simple binary classifiers suffice
- Assuming single-label when the domain is inherently multi-label

---

### Source 2: Categorization and Classification with LLMs (Matt Rickard)
**URL:** https://mattrickard.com/categorization-and-classification-with-llms

**Key Principle:** Use structured output APIs with `allow_multiple_classes: true` to return an array of selected categories. LLMs naturally struggle with label cardinality constraints — they return multiple categories when you want one, or vice versa, succeeding only ~80% of the time without structured enforcement.

**Application to our system:** The AI classifier should use structured output (JSON schema) that explicitly defines `filing_types` as an array: `{"filing_types": ["annual_report", "capital_statement"]}`. This guarantees valid, parseable output every time.

**Anti-patterns:**
- Relying on prompt tricks to produce valid JSON
- Manual parsing of unstructured LLM responses
- Expecting LLMs to respect undefined category boundaries without schema enforcement

---

### Source 3: OpenAI Function Calling / Structured Outputs
**URL:** https://platform.openai.com/docs/guides/function-calling

**Key Principle:** Function calling with `strict: true` guarantees that model output exactly matches the JSON Schema. The model can return multiple `tool_calls` in a single response, each with a unique ID. However, **Structured Outputs is not compatible with parallel function calls** — set `parallel_tool_calls: false` when using strict mode.

**Application to our system:** Define a `classify_document` function with a schema like:
```json
{
  "filing_types": { "type": "array", "items": { "enum": ["annual_report", "capital_statement"] } },
  "confidence": { "type": "number" },
  "document_type": { "type": "string" }
}
```
Use `strict: true` + `parallel_tool_calls: false` for reliable structured output. The array approach (single function returning multiple labels) is more reliable than multiple parallel tool calls.

**Anti-patterns:**
- Using parallel tool calls with strict mode (incompatible)
- Not setting `strict: true` for classification (allows schema violations)
- Defining separate functions per filing type instead of one function returning an array

---

## Topic 2: OneDrive Folder Architecture for Multi-Entity Document Management

### Source 4: Microsoft Graph API — Create Folder (DriveItem POST children)
**URL:** https://learn.microsoft.com/en-us/graph/api/driveitem-post-children?view=graph-rest-1.0

**Key Principle:** Folder creation via `POST /drives/{drive-id}/items/{parent-item-id}/children` with `@microsoft.graph.conflictBehavior` set to `"fail"` makes folder creation idempotent — if the folder already exists, it returns an error rather than creating a duplicate. Use `"rename"` only when you explicitly want auto-renaming.

**Application to our system:** For dual-filing, create folder structure like:
```
/Clients/{client_name}/
  ├── Annual Report {year}/
  │   └── documents...
  └── Capital Statement {year}/
      └── documents...
```
Use `conflictBehavior: "fail"` + catch 409 Conflict to implement "create if not exists" idempotently. When uploading the same PDF to both folders, make two sequential PUT requests to each folder path.

**Anti-patterns:**
- Using `"rename"` as default (creates `Folder (1)` silently — data loss risk)
- Not handling 409 Conflict (treating it as a fatal error when it means success)
- Deep nesting beyond 3-4 levels (OneDrive has 400-char path limit)

---

### Source 5: OneDrive Naming Conventions and Restrictions
**URL:** https://support.microsoft.com/en-us/office/invalid-file-names-and-file-types-in-onedrive-and-sharepoint-64883a5d-228e-48f5-b3d2-eb39e07630fa
**Also:** https://td.usnh.edu/TDClient/60/Portal/KB/ArticleDet?ID=3985

**Key Principle:** OneDrive supports Unicode characters including Hebrew in folder/file names. The total decoded path (folder + filename) must stay under 400 characters. Forbidden characters: `" * : < > ? / \ |`. No folder names starting with `~$` or matching reserved names (CON, PRN, AUX, NUL, etc.).

**Application to our system:** Hebrew folder names are fully supported. Recommended naming convention for bilingual:
- `{client_hebrew_name} - {client_english_name}/` for client folder
- `דוח שנתי {year}` or `Annual Report {year}` for filing type subfolder
- Keep names short — Hebrew chars are multi-byte but the 400-char limit applies to decoded characters, not bytes

**Anti-patterns:**
- Mixing RTL and LTR text in a single folder name without separator (confusing display)
- Using special characters common in Hebrew accounting (`/` for dates, `:` for time)
- Exceeding 400-char path limit with deeply nested Hebrew names

---

### Source 6: OneDrive File Storage API Overview
**URL:** https://learn.microsoft.com/en-us/graph/onedrive-concept-overview

**Key Principle:** OneDrive models everything as Drive (logical container) → DriveItem (file or folder). Use `PUT /drives/{drive-id}/items/{parent-id}:/{filename}:/content` for file upload. For uploading the same file to two locations, make two separate PUT requests — there is no native "copy to multiple destinations" API. Use webhooks + delta API for change detection.

**Application to our system:** When a document is classified for both AR and CS:
1. Upload original to AR folder: `PUT .../Annual Report {year}:/{filename}:/content`
2. Upload copy to CS folder: `PUT .../Capital Statement {year}:/{filename}:/content`
These are independent operations — if one fails, retry it independently.

**Anti-patterns:**
- Trying to use Graph batch API (`$batch`) for file uploads (not supported for large files)
- Creating symlinks/shortcuts instead of copies (breaks when original is moved)
- Not using `@microsoft.graph.conflictBehavior` on upload (silent overwrite)

---

## Topic 3: Idempotent Dual-Record Creation

### Source 7: Using Atomic Transactions to Power an Idempotent API (Brandur Leach)
**URL:** https://brandur.org/http-transactions

**Key Principle:** Map every HTTP request 1:1 to a database transaction. All operations within a request either commit or abort together. Use SERIALIZABLE isolation level to prevent race conditions (e.g., duplicate record creation). Insert audit/side-effect records within the same transaction.

**Application to our system:** Since Airtable lacks transactions, simulate atomicity:
1. Create Record A (AR document record) → get record ID
2. Create Record B (CS document record) with link to same source → get record ID
3. If step 2 fails, mark Record A with `needs_cs_pair: true` for retry
4. Use Airtable's `performUpsert` with a unique key (e.g., `{source_document_id}_{filing_type}`) to make retries safe

**Anti-patterns:**
- Fire-and-forget for step 2 (orphaned records with no cleanup)
- Using the same idempotency key for both records (they are different entities)
- Retrying the entire operation instead of just the failed step

---

### Source 8: Making Retries Safe with Idempotent APIs (AWS Builders' Library)
**URL:** https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/

**Key Principle:** Idempotency keys must be stored atomically alongside the operation result. The pattern: (1) Check if idempotency key exists, (2) If yes, return cached result, (3) If no, perform operation and store key+result atomically. For multi-step operations, use a **state machine** approach — track which steps completed and resume from the last successful step.

**Application to our system:** For dual-record creation from one classified document:
1. Generate idempotency key: `{document_hash}_{timestamp}`
2. Create state record: `{key, step: "pending", ar_record_id: null, cs_record_id: null}`
3. Create AR record → update state: `{step: "ar_created", ar_record_id: "recXXX"}`
4. Create CS record → update state: `{step: "complete", cs_record_id: "recYYY"}`
5. On retry, check state and resume from last completed step

**Anti-patterns:**
- Storing idempotency key only in memory (lost on crash)
- Not distinguishing between "operation in progress" and "operation not started"
- Using timestamps alone as idempotency keys (not unique enough)

---

### Source 9: Airtable Batch Operations and Linked Records
**URL:** https://support.airtable.com/docs/airtable-api-common-troubleshooting
**Also:** https://community.airtable.com/t5/automations/batch-link-records-from-another-table/td-p/159016

**Key Principle:** Airtable batch operations support up to 10 records per request. Batch creates are **all-or-nothing within a single API call** — if one record in a batch of 10 fails validation, the entire batch fails. Linked records can be created by passing the record ID of the target record in the linked field. `performUpsert` with `fieldsToMergeOn` provides server-side atomic dedup.

**Application to our system:** Create both AR and CS document records in a single batch call:
```json
{
  "records": [
    { "fields": { "Document": "payslip.pdf", "Filing_Type": "Annual Report", "Report": ["recAR123"] } },
    { "fields": { "Document": "payslip.pdf", "Filing_Type": "Capital Statement", "Report": ["recCS456"] } }
  ],
  "performUpsert": {
    "fieldsToMergeOn": ["Document_Source_Hash", "Filing_Type"]
  }
}
```
This creates both records atomically (both succeed or both fail) and is idempotent via upsert.

**Anti-patterns:**
- Creating records in separate API calls (partial failure risk)
- Not using `performUpsert` for retry safety (creates duplicates)
- Exceeding 10 records per batch (API rejects entire request)

---

## Synthesis: Recommended Architecture

### End-to-End Flow: Document Upload → Multi-Label Classification → Dual Records → Dual OneDrive Upload

```
1. CLASSIFY (AI)
   ├── Use structured output with array schema: {"filing_types": ["AR", "CS"]}
   ├── Binary classification per filing type (independent yes/no)
   └── strict: true for guaranteed valid JSON

2. CREATE RECORDS (Airtable)
   ├── Single batch API call with both records
   ├── performUpsert on {source_hash, filing_type} for idempotency
   ├── Both records link to same source document
   └── All-or-nothing: both created or both fail

3. UPLOAD FILES (OneDrive)
   ├── Create folders with conflictBehavior: "fail" (idempotent)
   ├── Upload to AR folder → record success
   ├── Upload to CS folder → record success
   ├── Independent operations — retry failed uploads individually
   └── Track upload status per filing type in Airtable

4. ERROR RECOVERY
   ├── Classification failure → retry classification (idempotent)
   ├── Record creation failure → retry batch (upsert = safe)
   ├── Upload failure → retry individual upload (PUT = idempotent)
   └── State tracked in Airtable record fields
```

### Key Anti-Patterns Summary
1. **Don't** ask the LLM "which type?" — ask "is it AR?" and "is it CS?" independently
2. **Don't** create records in separate API calls — use batch for atomicity
3. **Don't** use `conflictBehavior: "rename"` — use `"fail"` + handle 409
4. **Don't** retry the entire pipeline — track state and retry only failed steps
5. **Don't** use parallel tool calls with strict mode — they are incompatible
6. **Don't** fire-and-forget the second record — always verify both created
