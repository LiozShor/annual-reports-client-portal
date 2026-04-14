# Design Log 143: Classification Test Bugfixes — OneDrive Collision, NII Issuer, Large PDF Threshold
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-10
**Related Logs:** [035](035-wf05-ai-classification-onedrive-upload.md), [046](046-wf05-loop-restructure-classification-optimization.md), [048](048-onedrive-rename-dedup-improvements.md), [134](134-fix-classifier-field-ordering.md), [137](137-fix-onedrive-rename-extension-and-title.md)

## 1. Context & Problem

User sent 18 test documents to the classification pipeline and compared results against ground truth. Three categories of bugs found:

**Bug 1 — OneDrive item collision (CRITICAL):**
Multiple classification records share the same `onedrive_item_id` and `file_url` (e.g., doc13 and doc15 both point to `doc13.pdf`'s OneDrive entry). Preview shows the wrong document. Root cause: `Prep Doc Update` node uses `$('Check If PDF').first()` and `$('Finalize Conversion').first()` inside a `splitInBatches` loop. In n8n, `.first()` inside a loop can return data from a **previous iteration** — it doesn't scope to the current batch item.

**Bug 2 — NII issuer extraction (doc19):**
The classification prompt instructs the LLM (line 425 of Prepare Attachments): "For NII documents (T302-T306): return the BENEFIT TYPE in Hebrew (e.g., אבטלה, מילואים, ..., דמי לידה, ...), NOT ביטוח לאומי." This is correct for T302 (generic NII, where benefit type disambiguates multiple NII entries) but WRONG for T303/T304/T305/T306 (specific NII templates). For doc19 (דמי לידה), `issuer_name` was set to "דמי לידה" instead of "ביטוח לאומי", causing `findBestDocMatch` to fail (no document has "דמי לידה" as issuer).

**Bug 3 — Large PDF threshold too low (doc12, doc16):**
`LARGE_PDF_THRESHOLD = 500 * 1024` (500KB) in Prepare Attachments (line 540). PDFs above this threshold are classified by filename + email metadata ONLY — actual content is not sent to the API. doc16 (525KB) and doc12 (3.6MB) both failed because their generic filenames ("doc16.pdf", "doc12.pdf") gave zero signal. 500KB is too conservative — normal tax documents are often 500KB-2MB.

## 2. User Requirements

1. **Q:** Bug 1 fix approach?
   **A:** Pass upload result via item data (pipeline pattern) — thread the upload result through each node's output JSON so `Prep Doc Update` reads from `$input.first()` instead of referencing upstream nodes with `.first()`.

2. **Q:** For NII-specific templates (T303/T304/T305/T306), what should issuer_name be?
   **A:** Always "ביטוח לאומי". Only T302 (generic) needs the benefit type as issuer.

3. **Q:** File size issue — investigate or skip?
   **A:** Investigate in this design log.

4. **Q:** Scope — include classification accuracy improvements?
   **A:** OneDrive + issuer + file size only. Pension/study-fund confusion is a separate log.

## 3. Research

### Domain
n8n Data Flow in Loops, Anthropic API File Limits, Document Classification Pipelines

### Sources Consulted
1. **n8n Community — splitInBatches data isolation** — `$('NodeName').first()` returns the first item from the node's most recent execution output. Inside a loop, if a node was executed in a previous iteration AND the current iteration takes a different branch (skipping that node), `.first()` returns the PREVIOUS iteration's data. This is by design — n8n doesn't clear node outputs between loop iterations.
2. **Anthropic API Documentation — Document Support** — PDF documents sent as base64 via `type: "document"` support up to 100 pages and ~32MB payload. The 500KB threshold is an arbitrary application-level limit, not an API constraint. Files up to 5MB should work reliably.
3. **n8n Best Practice: Data Threading** — The recommended pattern inside loops is to pass all needed data through each node's output (`return [{ json: { ...input, newField } }]`) so downstream nodes use `$input.first()` instead of referencing upstream nodes by name.

### Key Principles Extracted
- **Never use `$('NodeName').first()` inside splitInBatches** for data that changes per iteration — use `$input` instead.
- **Thread data through the pipeline** — each Code node receives upstream data via `$input` and passes it forward with additions.
- **Anthropic API supports large PDFs natively** — the 500KB threshold was over-conservative.

### Patterns to Use
- **Pipeline data threading:** Each node in the loop receives data from `$input.first()` and returns `{ ...inputData, newFields }`.
- **Targeted prompt fix:** Only change the issuer_name instruction for T303/T304/T305/T306, keep T302 behavior.

### Anti-Patterns to Avoid
- **`$('NodeName').first()` inside loops** — the exact bug we're fixing.
- **Arbitrary file size thresholds** — trust the API's actual limits.

### Research Verdict
Three targeted fixes in WF[05] Prepare Attachments + Prep Doc Update + intermediate nodes. No architectural changes needed.

## 4. Codebase Analysis

### Existing Solutions Found
- Pipeline threading pattern already used partially — `Check Duplicate` reads from `$input`, `Image to PDF` reads from `$input`. But `Check If PDF` breaks the chain by reading from `$('Upload to OneDrive').first()` and `Finalize Conversion` reads from `$('Check If PDF').first()`.

### Files to Examine
| Node (WF cIa23K8v1PrbDJqY) | ID | Issue |
|---|---|---|
| Prep Doc Update | `code-prep-doc-update` | Uses `.first()` for upload result — gets wrong iteration's data |
| Check If PDF | `check-if-pdf` | Uses `$('Upload to OneDrive').first()` — should use `$input` |
| Finalize Conversion | `finalize-conversion` | Uses `$('Check If PDF').first()` — should use `$input` |
| Prepare Attachments | `22ed433d-fdcb-4afc-9ce2-c14cab2861c4` | issuer_name instruction + LARGE_PDF_THRESHOLD |

### Data Flow (Current — BROKEN)
```
Upload to OneDrive → Check If PDF($('Upload to OneDrive').first()) → IF Needs Conversion
  TRUE  → Download PDF → Upload PDF → Delete Original → Finalize Conversion($('Check If PDF').first()) → Prep Doc Update($('Finalize Conversion').first())
  FALSE → Prep Doc Update($('Check If PDF').first())
```

### Data Flow (Fixed — PIPELINE)
```
Upload to OneDrive → Check If PDF($input) → IF Needs Conversion
  TRUE  → Download PDF → Upload PDF → Delete Original → Finalize Conversion($input + Check If PDF data threaded) → Prep Doc Update($input)
  FALSE → Prep Doc Update($input)
```

### Dependencies
- WF[05] `cIa23K8v1PrbDJqY` — 4 Code nodes to update
- Anthropic API — no changes needed, just raise our threshold

## 5. Technical Constraints & Risks

* **Security:** No new permissions or credentials.
* **Risks:**
  - `IF Needs Conversion` is a binary IF node — it passes through the JSON from Check If PDF to both branches. The TRUE branch adds HTTP response data (Download PDF, Upload PDF, Delete Original). Finalize Conversion currently reads from Check If PDF — after fix, it reads from `$input` which is the Delete Original output. Must ensure Delete Original passes through all needed fields.
  - HTTP Request nodes (Download PDF, Upload PDF, Delete Original) may not pass through input JSON — they return only the HTTP response. Need to verify behavior or use a Code node to merge.
* **Breaking Changes:** None — output shape of Prep Doc Update is unchanged.

## 6. Proposed Solution (The Blueprint)

### Fix 1: OneDrive Collision — Pipeline Data Threading

**Problem:** `.first()` references upstream nodes by name, which can return stale data from previous loop iterations.

**Solution:** Thread the upload result through each node via `$input`, so no node references a named upstream node.

#### Node: Check If PDF (`check-if-pdf`)
Change from:
```js
const upload = $('Upload to OneDrive').first().json;
const d = $('Check Duplicate').first().json;
```
To:
```js
const input = $input.first().json;
const upload = input;  // Upload to OneDrive response IS the input
const d = input;       // Check Duplicate data was already merged upstream
```
Wait — Check If PDF receives from Upload to OneDrive (HTTP node). The HTTP node returns the MS Graph response, NOT the Check Duplicate data. We need the `attachment_name` from Check Duplicate to determine the extension.

**Revised approach:** Check If PDF currently reads `attachment_name` from Check Duplicate and `id`/`parentReference` from Upload to OneDrive. Both come via different paths. The Upload to OneDrive HTTP node only returns MS Graph JSON.

**Solution:** The `Image to PDF` node already threads all data through (`{ ...d, ... }`). We need to ensure the data flows:
1. `Image to PDF` → receives from IF Not Duplicate (has Check Duplicate data) → adds conversion fields → outputs `{ ...all_prev_data, _img_converted, ... }`
2. `Upload to OneDrive` → HTTP PUT → returns ONLY MS Graph response (loses all previous data)
3. `Check If PDF` → needs BOTH Upload response AND previous data (attachment_name, etc.)

**The real gap:** Upload to OneDrive is an HTTP Request node that **replaces** the input with the HTTP response. Previous node data is lost.

**Fix:** Change `Check If PDF` to:
- Read upload response from `$input.first().json` (the HTTP response)
- Read attachment data from `$('Image to PDF').first().json` ... but that's the same `.first()` problem!

**Better fix:** Use `$input.first().json` for the upload response, and extract `attachment_name` from the upload response's `name` field (MS Graph returns the filename). This eliminates the need to reference Check Duplicate at all.

Actually, the simplest fix for the core bug: **Prep Doc Update** is the only node that writes to Airtable. It needs the upload result (webUrl, id). Currently it tries multiple `.first()` fallbacks. The fix is:

**The IF Needs Conversion node passes through Check If PDF's JSON to both branches.** So:
- FALSE branch → Prep Doc Update receives Check If PDF's JSON directly via `$input` (which includes `_upload_result`)
- TRUE branch → goes through Download PDF → Upload PDF → Delete Original → Finalize Conversion → Prep Doc Update

For the TRUE branch, the HTTP nodes (Download/Upload/Delete) replace the JSON. But Finalize Conversion already reads from `$('Upload PDF to OneDrive').first()` and `$('Check If PDF').first()`.

**Revised strategy — minimal changes:**

The actual collision bug is in `Prep Doc Update` only. The intermediate nodes (Check If PDF, Finalize Conversion) execute once per loop iteration and their `.first()` references are to nodes that also executed in THE SAME iteration (Upload to OneDrive → Check If PDF is the immediate next node). The problem is specifically in `Prep Doc Update` which may receive from TWO different paths:
- FALSE path: directly from `IF Needs Conversion`
- TRUE path: from `Finalize Conversion`

And uses try/catch to probe multiple named nodes.

**Fix for Prep Doc Update:** Both paths converge at Prep Doc Update. Each path's final node should include `_upload_result` in its output:
- FALSE path (IF Needs Conversion → Prep Doc Update): Check If PDF already sets `_upload_result`. This flows through IF node unchanged. ✅
- TRUE path (Finalize Conversion → Prep Doc Update): Already sets `_final_upload_result`. ✅

So the fix is: **In Prep Doc Update, read from `$input.first().json` instead of probing named nodes.**

```js
const input = $input.first().json;

// Determine upload result — Finalize Conversion sets _final_upload_result, Check If PDF sets _upload_result
let upload = input._final_upload_result || input._upload_result || {};
```

Similarly, for Check Duplicate data (`d`), we need it from `$input` too. But Prep Doc Update's `$input` comes from either:
- FALSE: Check If PDF output (has `_upload_result` but NOT the original attachment data like `attachment_name`, `client_id`, etc.)
- TRUE: Finalize Conversion output (has `_final_upload_result` + Check If PDF spread data, but again no original attachment data)

Wait — Check If PDF does `return [{ json: { ...upload, _upload_result: upload, ... } }]` — it spreads the Upload to OneDrive response, NOT the original item data. So `attachment_name`, `client_id`, etc. are NOT in Check If PDF's output.

Currently `Prep Doc Update` reads original data from `$('Check Duplicate').first().json` — which is a node that executed earlier in the same loop iteration. This should be safe because Check Duplicate runs once per iteration and Prep Doc Update runs once per iteration (they're in the same branch path).

Actually, the REAL question is: **does `$('Check Duplicate').first()` ever return stale data?**

The loop flow is:
```
Loop Over Items → Preserve Item Data → IF Has Required Docs → Classify → Merge → Process and Prepare Upload → Check Duplicate → IF Not Duplicate → Image to PDF → Upload to OneDrive → Check If PDF → IF Needs Conversion → [TRUE: ... → Finalize Conversion] → Prep Doc Update → Create Pending Classification → Route by Match → IF Has Match → [Update Doc or Loop Wait] → Loop Over Items
```

This is a sequential loop (splitInBatches with batch size 1). Each iteration goes through the full chain before the next starts. So `$('Check Duplicate').first()` should always return the CURRENT iteration's data because Check Duplicate executes once per iteration.

But the user confirmed that MULTIPLE docs got the same OneDrive ID. So something IS crossing iterations. Let me re-examine...

The key insight: **IF Needs Conversion has TWO output branches.** In iteration 1 (doc13.docx, needs conversion), the TRUE branch executes (Finalize Conversion runs). In iteration 2 (doc15.pdf, no conversion), the FALSE branch executes (Finalize Conversion does NOT run). When Prep Doc Update in iteration 2 does:
```js
try {
  const fc = $('Finalize Conversion').first().json;
  upload = fc._final_upload_result || {};
}
```
It finds Finalize Conversion's output from **iteration 1** (because Finalize Conversion didn't run in iteration 2, so the previous output is still there). This is the bug!

**The fix is now clear:** In Prep Doc Update, use `$input.first().json` which always comes from the CURRENT path:
- FALSE branch: `$input` = Check If PDF output (has `_upload_result`)
- TRUE branch: `$input` = Finalize Conversion output (has `_final_upload_result`)

And for Check Duplicate data: keep `$('Check Duplicate').first().json` — it's safe because Check Duplicate always executes in every iteration.

#### Node: Prep Doc Update (`code-prep-doc-update`) — THE FIX

Replace the upload resolution block:
```js
// OLD (BROKEN):
let upload = {};
try {
  const fc = $('Finalize Conversion').first().json;
  upload = fc._final_upload_result || {};
} catch(e) {
  try {
    upload = $('Check If PDF').first().json._upload_result || {};
  } catch(e2) {
    upload = $('Upload to OneDrive').first().json || {};
  }
}
```

With:
```js
// NEW (FIXED): Read from $input — always current iteration
const input = $input.first().json;
const upload = input._final_upload_result || input._upload_result || {};
```

Same pattern for conversion metadata — replace all `$('Finalize Conversion').first()` and `$('Image to PDF').first()` and `$('Check If PDF').first()` with reads from `input`:

```js
const _conversionFailed = input._conversion_failed || false;
const _conversionError = input._conversion_error || '';
const _convertedFrom = input._converted_from || '';
```

And for `resolvedExpectedFilename`:
```js
// Check if conversion updated expected_filename
let resolvedExpectedFilename = d.expected_filename || null;
if (input._img_converted && input.expected_filename) {
  resolvedExpectedFilename = input.expected_filename;
}
if (!input._conversion_failed && input._converted_from && resolvedExpectedFilename) {
  resolvedExpectedFilename = resolvedExpectedFilename.replace(/\.[^.]+$/, '.pdf');
}
```

Wait — `input` is from Check If PDF or Finalize Conversion, NOT from Image to PDF. Image to PDF runs BEFORE Upload to OneDrive. Its data flows through Upload (HTTP, which replaces it) → Check If PDF. So `_img_converted` is NOT in Check If PDF's output.

Let me trace the data flow more carefully:

1. Image to PDF: `{ ...d, _img_converted, expected_filename (updated), upload_url (updated) }` + binary
2. Upload to OneDrive (HTTP): Returns MS Graph response `{ id, webUrl, name, parentReference, ... }` — **ALL previous JSON lost**
3. Check If PDF: `{ ...upload_response, _upload_result: upload_response, _needs_conversion, _convert_url, ... }` — reads from `$('Upload to OneDrive').first()` and `$('Check Duplicate').first()`
4. IF Needs Conversion: passes through Check If PDF output
   - FALSE → Prep Doc Update
   - TRUE → Download PDF (HTTP) → Upload PDF (HTTP) → Delete Original (HTTP) → Finalize Conversion → Prep Doc Update

So `_img_converted` is lost at step 2 (HTTP node replaces JSON). Check If PDF doesn't have it.

Currently Prep Doc Update reads Image to PDF via `$('Image to PDF').first()` — and this is actually SAFE because Image to PDF runs every iteration (it's always in the path). But to be safe, we should thread it.

**Hmm, this is getting complex.** Let me simplify:

The ONLY problematic reference is `$('Finalize Conversion').first()` in Prep Doc Update — because Finalize Conversion doesn't run in the FALSE branch. All other `.first()` references are to nodes that run every iteration.

**Minimal fix:** In Prep Doc Update, detect which branch we came from using `$input`:
- If `$input.first().json._final_upload_result` exists → came from TRUE branch (Finalize Conversion)
- Otherwise → came from FALSE branch (Check If PDF via IF Needs Conversion)

```js
const input = $input.first().json;
let upload;
if (input._final_upload_result) {
  // TRUE branch: Finalize Conversion ran
  upload = input._final_upload_result;
} else {
  // FALSE branch: no conversion needed
  upload = input._upload_result || {};
}
```

This eliminates all try/catch probing of named nodes for the upload result.

For other fields that use `$('Finalize Conversion').first()`:
- `_conversion_failed`, `_conversion_error`, `_converted_from` → read from `input` (Finalize Conversion spreads its data into output)

For fields from Image to PDF (`_img_converted`, updated `expected_filename`):
- These are lost at the HTTP Upload node. Currently read via `$('Image to PDF').first()`. This reference IS safe (Image to PDF runs every iteration). But for consistency, we could thread it through Check If PDF.

**Decision: Minimal change — only fix the Finalize Conversion reference in Prep Doc Update.** Keep other `.first()` references that are safe (always-executing nodes).

### Fix 2: NII Issuer — Prompt Update

In Prepare Attachments (`22ed433d-fdcb-4afc-9ce2-c14cab2861c4`), change the `issuer_name` tool description.

**From (line 425):**
```
For NII documents (T302-T306): return the BENEFIT TYPE in Hebrew (e.g., אבטלה, מילואים, פגיעה בעבודה, נכות, דמי לידה, שאירים), NOT ביטוח לאומי.
```

**To:**
```
For T302 (generic NII): return the BENEFIT TYPE in Hebrew (e.g., אבטלה, מילואים, פגיעה בעבודה), NOT ביטוח לאומי. For T303/T304/T305/T306 (specific NII): return 'ביטוח לאומי' or 'המוסד לביטוח לאומי'.
```

Also update the DOC_TYPE_REFERENCE section for T302 (line 248):
```
issuer_name: Return the BENEFIT TYPE (e.g., "אבטלה", "מילואים"), not "ביטוח לאומי".
```
Keep this for T302 only. Add explicit issuer_name instructions to T303, T304, T305, T306:
```
issuer_name: Return "ביטוח לאומי" (NOT the benefit type).
```

### Fix 3: Large PDF Threshold

In Prepare Attachments, raise `LARGE_PDF_THRESHOLD` from 500KB to a higher value.

Anthropic API supports PDF documents up to 100 pages via `type: "document"`. The base64 encoding adds ~33% overhead. A 5MB PDF becomes ~6.7MB base64. The API request limit is ~32MB.

**Change:**
```js
// FROM:
const LARGE_PDF_THRESHOLD = 500 * 1024;  // 500KB

// TO:
const LARGE_PDF_THRESHOLD = 5 * 1024 * 1024;  // 5MB
```

This allows PDFs up to 5MB to be sent with full content. Above 5MB, fall back to metadata-only classification (these are likely scanned multi-page documents that may hit page limits anyway).

### Files to Change

| Node | ID | Action | Description |
|------|-----|--------|-------------|
| Prep Doc Update | `code-prep-doc-update` | Modify | Replace `.first()` probing with `$input.first().json` |
| Prepare Attachments | `22ed433d-...` | Modify | Fix issuer_name instruction + raise LARGE_PDF_THRESHOLD |

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Re-send 18 test docs — verify each gets a UNIQUE `onedrive_item_id` and `file_url`
* [ ] Preview doc13 and doc15 in UI — confirm they show different documents
* [ ] doc19 (דמי לידה): verify `matched_template_id` = T302, `issuer_name` = "דמי לידה" (benefit type, NOT "ביטוח לאומי")
* [ ] doc19: verify `matched_doc_name` is populated (matches T302 דמי לידה SSOT record)
* [ ] doc16 (525KB PDF): verify content is sent to API and classification succeeds
* [ ] doc12 (3.6MB PDF): verify content is sent to API and classification succeeds
* [ ] Verify no regression: small PDFs (<500KB) still classified correctly
* [ ] Verify no regression: DOCX/XLSX extraction still works
* [ ] Verify no regression: image conversion (JPEG/PNG → PDF) still works

## 8. Implementation Notes (Post-Code)

### Changes Applied (2026-03-10)

**MCP Operation 1: Prep Doc Update (`code-prep-doc-update`)**
- Replaced try/catch probing of `$('Finalize Conversion').first()` with `const input = $input.first().json`
- Upload result: `input._final_upload_result || input._upload_result || {}`
- Conversion metadata (`_conversion_failed`, `_conversion_error`, `_converted_from`): read from `input` first, fallback to `$('Image to PDF').first()` for error/convertedFrom
- Expected filename Tier 2 check: read `input._converted_from` instead of `$('Finalize Conversion').first()`
- Kept safe references: `$('Check Duplicate')`, `$('Create Email Event')`, `$('Get Active Report')`, `$('Image to PDF')` — all execute every iteration

**MCP Operation 2: Prepare Attachments (`22ed433d-...`)**
- `issuer_name` tool description (line 429): Changed `For NII documents (T302-T306)` → `For T302 (generic NII only)` + added `For T303/T304/T305/T306: return "ביטוח לאומי"`
- DOC_TYPE_REFERENCE: Added `issuer_name: Return "ביטוח לאומי" (NOT the benefit type).` to T303, T304, T305, T306
- `LARGE_PDF_THRESHOLD`: Changed from `500 * 1024` (500KB) to `5 * 1024 * 1024` (5MB)
- Fixed JS quoting: used double quotes for Hebrew inside single-quoted description string

**MCP Operation 3: Prepare Attachments — NII T302 Alignment (final fix)**
- ~~After Airtable verification showed ALL NII documents use T302 (not T303-T306), realigned classifier~~ **REVERTED in session 144** — see Op 4 below.

**MCP Operation 4: Prepare Attachments — Restore NII template routing (session 144)**
- **Problem:** Op 3 incorrectly collapsed all NII to T302. Airtable `documents` table shows SSOT generates T302 (spouse allowance), T303 (client disability), T305 (client survivors), T306 (spouse survivors). T301/T304 are unused.
- DOC_TYPE_REFERENCE: T302 narrowed to "Spouse NII Allowance" only. T303, T305, T306 restored with correct descriptions and issuer_name rules.
- T301, T304 removed from `ALL_TEMPLATE_IDS` enum (not generated by SSOT).
- NII rules: Replaced "ALL NII = T302" with person + benefit type routing (spouse→T302, client disability→T303, client survivors→T305, spouse survivors→T306).
- `issuer_name` tool description: T302=benefit type, T303=null, T305/T306=survivor details.
- Pushed via n8n REST API (code too large for MCP tool parameter).
