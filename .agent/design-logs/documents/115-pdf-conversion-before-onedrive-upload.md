# Design Log 115: PDF Conversion Before OneDrive Upload
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-08
**Related Logs:** DL-035 (WF05 AI Classification + OneDrive Upload), DL-048 (OneDrive rename/dedup)

## 1. Context & Problem
Accountants browse client files in OneDrive and encounter mixed formats (HEIC from iPhones, DOCX, JPG, PNG, etc.). This creates friction — different viewers needed, inconsistent display. Natan requested all files be standardized to PDF before storage.

Meeting action item 7.2: "Add a processing step before uploading files to OneDrive that converts all file types to PDF."

## 2. User Requirements
1. **Q:** Which file types to convert?
   **A:** All non-PDF → PDF
2. **Q:** Conversion timing — before or after classification?
   **A:** After dedup check, before OneDrive storage (AI already handles all formats natively via Anthropic multimodal; avoids wasting conversions on duplicates)
3. **Q:** Conversion service?
   **A:** MS Graph `?format=pdf` (free, already authenticated). CloudConvert as future fallback if needed.
4. **Q:** Keep originals?
   **A:** PDF only — delete original non-PDF after successful conversion.

## 3. Research
### Domain
Document Processing Pipelines, File Format Standardization, MS Graph API

### Sources Consulted
1. **MS Graph API Docs — DriveItem content format** — `GET /drives/{driveId}/items/{itemId}/content?format=pdf` returns 302 redirect to converted PDF. Supports HEIC, JPG, PNG, DOCX, XLSX, PPTX, etc. ~4MB file size limit (406 on larger files).
2. **CloudConvert API v2** — Jobs+Tasks architecture, sync endpoint blocks until done. Import/base64 (10MB limit), $0.01/conversion. Official n8n community node exists. Kept as future fallback.
3. **n8n Binary Data Docs** — Binary flows via `binary.file` property between nodes. `httpRequestWithAuthentication` in Code nodes cannot access OAuth2 tokens. Each authenticated MS Graph call must be a separate HTTP Request node.

### Key Principles Extracted
- **Normalize early, convert once** — convert to canonical PDF format as early as practical in the pipeline
- **Validate after conversion** — check that output is valid PDF (has id/webUrl from MS Graph response)
- **Fail gracefully** — conversion failures should not block the pipeline; flag and keep original

### Patterns to Use
- **`continueOnFail` chain** — HTTP nodes in series, each with `continueOnFail: true`. Finalize Code node checks if chain succeeded or failed.
- **URL guard for DELETE** — conditional expression prevents deleting original when upload failed: `$('Upload PDF').first().json.id ? deleteUrl : ''`

### Anti-Patterns to Avoid
- **Code node HTTP calls** — Can't use `$helpers.httpRequest` for MS Graph OAuth2. Must use HTTP Request nodes.
- **Converting before dedup** — Wastes API calls on duplicate files that will be skipped anyway.

### Research Verdict
MS Graph's free `?format=pdf` endpoint covers ~95% of cases (images, Office docs, all under 4MB). Files that fail conversion (>4MB, exotic formats) keep their original format with a flag in Airtable. CloudConvert can be added later as a fallback tier for the remaining ~5%.

## 4. Codebase Analysis
* **Existing Solutions Found:** No conversion logic exists anywhere in the codebase. WF[05] uploads files as-is.
* **Reuse Decision:** Reuse existing MS Graph OAuth2 credentials (`GcLQZwzH2xj41sV7`, "MS_Graph_CPA_Automation"). Reuse existing Upload to OneDrive pattern (HTTP PUT with binary.file).
* **Relevant Files:**
  - WF[05] `cIa23K8v1PrbDJqY` — 45 nodes, insertion point after "Upload to OneDrive" (node `827476fe`)
  - "Prep Doc Update" (node `code-prep-doc-update`) — reads `$('Upload to OneDrive').first().json` for webUrl/id; needs modification
  - "Create Pending Classification" (Airtable node) — needs `conversion_failed` and `conversion_error` fields
* **Existing Patterns:** Linear chain with `continueOnFail` used elsewhere (e.g., email guard nodes in WF[01]/WF[03])
* **Data Flow:** File content flows as base64 string through JSON until "Process and Prepare Upload" converts to `binary.file`. Upload to OneDrive returns MS Graph item data with `id`, `webUrl`, `parentReference.driveId`.

## 5. Technical Constraints & Risks
* **MS Graph 4MB limit:** Files > 4MB return 406 on `?format=pdf`. Graceful degradation: keep original, flag in Airtable.
* **OAuth2 in Code nodes:** Not available — each Graph API call needs its own HTTP Request node (increases node count).
* **Binary passthrough:** Binary data auto-passes through HTTP nodes but can be lost if nodes use Manual Mapping without explicitly including binary fields.
* **Delete safety:** Must NOT delete original if PDF upload failed — URL guard expression prevents this.
* **Node positioning:** 6 downstream nodes need to shift right ~1,344px to make room.

## 6. Proposed Solution (The Blueprint)

### Logic Flow
```
Upload to OneDrive [existing]
  ↓
① Check If PDF [Code] — checks extension, builds convert/upload/delete URLs
  ↓
② IF Needs Conversion [IF]
  ├─ TRUE → ③ Download as PDF [HTTP GET ?format=pdf, continueOnFail]
  │           ↓
  │         ④ Upload PDF to OneDrive [HTTP PUT, continueOnFail]
  │           ↓
  │         ⑤ Delete Original File [HTTP DELETE, continueOnFail, URL-guarded]
  │           ↓
  │         ⑥ Finalize Conversion [Code — checks success, outputs _final_upload_result]
  │           ↓
  │         Prep Doc Update [existing, MODIFIED]
  │
  └─ FALSE → Prep Doc Update [existing, MODIFIED]
```

### Data Flow
| Path | Upload data source for Prep Doc Update |
|------|----------------------------------------|
| Already PDF | `$('Check If PDF').first().json._upload_result` |
| Conversion OK | `$('Finalize Conversion').first().json._final_upload_result` (new PDF item) |
| Conversion Failed | `$('Finalize Conversion').first().json._final_upload_result` (original item, preserved) |
| Unconvertible ext | Same as "Already PDF" — treated as passthrough |

### Schema Changes
Add to `pending_classifications` table (via `typecast: true`):
- `conversion_failed` (checkbox)
- `conversion_error` (singleLineText)

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| WF[05] `cIa23K8v1PrbDJqY` | Add 6 nodes | Check If PDF, IF Needs Conversion, Download as PDF, Upload PDF, Delete Original, Finalize Conversion |
| WF[05] Prep Doc Update | Modify | Read upload data from conversion or passthrough path via try/catch |
| WF[05] Create Pending Classification | Modify | Add conversion_failed, conversion_error columns |
| WF[05] downstream nodes | Move | Shift 6 nodes right ~1,344px |
| `docs/airtable-schema.md` | Modify | Document new fields |

### MCP Operations Sequence
1. Deactivate workflow
2. Move 6 downstream nodes right (Prep Doc Update through Loop Wait)
3. Add 6 new nodes with positions, parameters, credentials
4. Rewire connections (remove Upload→PrepDoc, add new chain)
5. Update Prep Doc Update code
6. Update Create Pending Classification columns
7. Reactivate workflow

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] PDF file → passes through unchanged, correct webUrl/itemId in Airtable
* [ ] JPG image → converted to PDF in OneDrive, original deleted, Airtable points to PDF
* [ ] HEIC image → same as JPG test
* [ ] DOCX file → converted to PDF, original deleted
* [ ] Large file (>4MB) → conversion fails gracefully, original kept, `conversion_failed=true` in Airtable
* [ ] Unknown extension (.zip) → passes through as non-convertible, original kept
* [ ] Duplicate file → caught by IF Not Duplicate before conversion, no conversion attempted
* [ ] Verify no regression: AI classification still works (runs before conversion)
* [ ] Verify OneDrive folder structure: PDF files in correct client/year/subfolder

## 8. Implementation Notes (Post-Code)
* Implemented 2026-03-08 via MCP partial workflow updates + REST API for connection fix
* 6 new nodes added: Check If PDF, IF Needs Conversion, Download as PDF, Upload PDF to OneDrive, Delete Original File, Finalize Conversion
* Node count: 45 → 51
* Connection count: 43 → 49
* All new HTTP nodes: `continueOnFail: true`, credentials `GcLQZwzH2xj41sV7` (MS_Graph_CPA_Automation)
* IF Needs Conversion false→branch required direct REST API PUT to fix (MCP addConnection with `sourceHandle: "false"` incorrectly placed target on output 0 instead of 1)
* Prep Doc Update modified: reads from `Finalize Conversion._final_upload_result` (try/catch fallback to Check If PDF._upload_result, then Upload to OneDrive directly)
* Outputs `conversion_failed`, `conversion_error`, `converted_from` fields — not yet written to Airtable (pending_classifications schema change needed manually)
* **Note (DL-115 lesson):** When using MCP `addConnection` with `sourceHandle: "false"` for IF node false branch, the connection lands on output index 0 (same as true branch). Fix: use REST API PUT to manually set `connections['IF Node'].main = [[true_targets], [false_targets]]`
