# Design Log 137: Fix OneDrive Rename — Extension Reverts to Original + Wrong Title on Reassign
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-09
**Related Logs:** [115-pdf-conversion-before-onedrive-upload](115-pdf-conversion-before-onedrive-upload.md), [129-dynamic-short-names-ai-review](129-dynamic-short-names-ai-review.md), [049-onedrive-file-ops-rename-move](049-onedrive-file-ops-rename-move.md), [048-onedrive-rename-dedup-improvements](048-onedrive-rename-dedup-improvements.md)

## 1. Context & Problem

Two bugs in the "Prepare File Move" code node (`code-prepare-file-move`) in the Review Classification workflow (`c1d7zPAmHfHM71nV`):

**Bug 1 — Extension reverts to original after PDF conversion:**
DL-115 added PDF conversion in WF[05] — all non-PDF files are converted to PDF before storage. But when the file is later renamed during approve/reassign, the code extracts the extension from `cls.attachment_name` (the original uploaded filename, e.g., `scan.jpg`), reverting the extension from `.pdf` to `.jpg`.

**Bug 2 — Wrong document type name on reassign:**
User reassigned a document to "דוח שנתי מקוצר – ביטוח חיים – הראל ביטוח" but the file was renamed to "אישור שנתי קופת גמל – הראל ביטוח.jpg". The hardcoded `HE_TITLE` map only has one entry per template group (T501 → "אישור שנתי קופת גמל"), ignoring the resolved short name which includes the specific deposit type and company.

**Root cause lines in Prepare File Move:**
```js
// Bug 1: extension from original filename
const origName = cls.attachment_name || '';
const dotIdx = origName.lastIndexOf('.');
const ext = dotIdx > 0 ? origName.substring(dotIdx) : '';

// Bug 2: hardcoded title map (incomplete, no variables)
const HE_TITLE = { T501:'אישור שנתי קופת גמל', ... };
```

## 2. User Requirements

1. **Q:** When reassigning, where should the filename come from?
   **A:** Use `short_name_he` from `documents_templates` table (same logic as DL-129), resolved with the target doc's variables. NOT the hardcoded `HE_TITLE` map.

2. **Q:** What extension should renamed files get?
   **A:** Always `.pdf` — DL-115 converts everything to PDF. Don't preserve original extension.

3. **Q:** Where should the short name come from (different workflow than Build Response)?
   **A:** Lookup `documents_templates` table directly in Prepare File Move, using the same `buildShortName()` logic from DL-129.

## 3. Research

### Domain
File Management Pipelines, OneDrive Rename Operations, PDF Conversion Pipeline Integrity

### Sources Consulted
1. **MS Graph API — Update DriveItem (Rename)** — PATCH accepts any filename; no validation that extension matches content type. Can silently rename a PDF to `.docx` creating a corrupt-looking file.
2. **MS Graph API — Convert to Other Formats** — `?format=pdf` returns binary stream, requires manual re-upload. Original file untouched with original extension.
3. **AWS Document Processing Pipeline for Regulated Industries** — Uses Document Lineage pattern: each derivative references parent `documentId`. Tracks `current_format` separately from display name.
4. **Zapier Community — OneDrive Extension Loss** — Extensions silently dropped during automation uploads. Fix: always explicitly include correct extension.
5. **Power Automate Rename Pitfall** — Renaming `.docx` to `.pdf` by changing name does NOT convert content. OneDrive silently accepts mismatched extensions.

### Key Principles Extracted
- **Extension must match actual content at every stage.** After PDF conversion, all renames must use `.pdf`.
- **Track format separately from display name.** The SSOT controls the human-readable portion; extension is a format concern.
- **Pre-resolve the full filename before the rename step.** Code node produces complete filename; rename PATCH is a dumb passthrough.
- **Lineage pattern: original metadata persists.** Store `original_filename` for audit but never use for rename.

### Patterns to Use
- **Hardcode `.pdf` extension** — since DL-115 converts all files to PDF, the extension is always `.pdf`. No need to track `current_format` separately.
- **Reuse `buildShortName()` from DL-129** — same variable resolution logic, ported to the rename workflow.
- **Airtable lookup for template info** — fetch `documents_templates` records to resolve `short_name_he`.

### Anti-Patterns to Avoid
- **Deriving extension from original uploaded file** — the exact bug we're fixing.
- **Hardcoded title maps** — `HE_TITLE` is incomplete, doesn't handle sub-types, and diverges from SSOT.
- **Letting SSOT name include the extension** — display names should be extension-agnostic.

### Research Verdict
Replace `HE_TITLE` map + `cls.attachment_name` extension with: (1) always `.pdf`, (2) `buildShortName()` resolved from `documents_templates` lookup. Port the same `templateInfo` + `buildShortName()` logic from DL-129's Build Response node into Prepare File Move.

## 4. Codebase Analysis

### Existing Solutions Found
- **DL-129 `buildShortName()`** — already implemented in Build Response node (`code-build-response` in `kdcWwkCQohEvABX0`). Resolves `short_name_he` variables by extracting bold segments from full SSOT name, filtering literal bolds, mapping to variable names.
- **`templateInfo` map** — built from `documents_templates` Airtable records. Contains `short_name_he`, `boldVars`, `literalBolds` per template.

### Reuse Decision
- **Reuse `buildShortName()` logic** — port the exact same function + `templateInfo` construction from DL-129 into Prepare File Move.
- **Reuse Airtable API pattern** — Prepare File Move already has `AT_KEY`, `BASE_ID`, `hdrs` (from Find Target Doc). Can query `documents_templates` directly.

### Relevant Files
- **Prepare File Move** (`code-prepare-file-move` in `c1d7zPAmHfHM71nV`) — the buggy node
- **Build Move Body** (`code-build-move-body` in same workflow) — downstream, passes filename to PATCH
- **DL-129 buildShortName()** — reference implementation in `kdcWwkCQohEvABX0` workflow

### Alignment with Research
- Current code violates "extension must match content" (uses original extension)
- Current code violates "pre-resolve full filename" (incomplete HE_TITLE map)
- Fix aligns with both principles

### Dependencies
- Airtable `documents_templates` table (`tblQTsbhC6ZBrhspc`) — `short_name_he`, `name_he`, `variables`, `template_id`
- `pending_classifications` record — `matched_doc_name` (has bold segments for variable resolution)
- `documents` record (Find Target Doc) — `issuer_name` (has bold segments for reassign target)

## 5. Technical Constraints & Risks

* **Security:** Uses existing Airtable token already in the workflow. No new permissions.
* **Risks:**
  - Adding Airtable API call increases latency by ~1-2s. Acceptable for a review action.
  - `short_name_he` might be null/empty for some templates → fallback to stripped `issuer_name` or template_id.
  - Bold extraction from `matched_doc_name` vs `issuer_name` depends on action (approve uses classification's `matched_doc_name`, reassign uses target doc's `issuer_name`).
* **Breaking Changes:** None — filenames change but this is the fix, not a regression.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

Rewrite the "Prepare File Move" code node:

1. **Always use `.pdf` extension** — replace `cls.attachment_name` extension extraction with hardcoded `.pdf`
2. **Fetch `documents_templates`** — one Airtable API call to get all template records with `short_name_he`, `name_he`, `variables`
3. **Build `templateInfo` map** — same logic as DL-129
4. **Port `buildShortName()`** — same function as DL-129
5. **Resolve filename per action:**
   - **Approve:** `buildShortName(cls.matched_template_id, cls.matched_doc_name)` → strip HTML → add `.pdf`
   - **Reassign:** `buildShortName(targetTemplateId, targetDocIssuerName)` → strip HTML → add `.pdf`
   - **Reject:** no rename (just move)
6. **Fallback chain:** If `buildShortName()` returns null → use `HE_TITLE[templateId] + issuer` → use `cls.attachment_name` stem + `.pdf`

### Data Flow

| Action | Short name source | Bold segments from | Example output |
|--------|------------------|--------------------|----------------|
| Approve | `buildShortName(cls.matched_template_id, cls.matched_doc_name)` | Classification's full SSOT name | `דוח שנתי מקוצר – ביטוח חיים – הראל ביטוח.pdf` |
| Reassign | `buildShortName(pa.reassign_template_id, targetDoc.issuer_name)` | Target doc's issuer_name field | `דוח שנתי מקוצר – ביטוח חיים – הראל ביטוח.pdf` |
| Reject | No rename | — | (file keeps current name, moves to ארכיון) |

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| WF `c1d7zPAmHfHM71nV` — "Prepare File Move" (`code-prepare-file-move`) | Modify | Replace HE_TITLE + attachment_name extension with buildShortName() + .pdf |

### MCP Operations
1. `n8n_update_partial_workflow` — update `code-prepare-file-move` node's `jsCode`

### Final Step
* Update design log status → `[IMPLEMENTED — NEED TESTING]`
* Copy Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Approve a doc with fuzzy/mismatch issuer → filename includes resolved short name + `.pdf` (not `.jpg`)
* [ ] Reassign to T501 "דוח שנתי מקוצר – ביטוח חיים – הראל ביטוח" → filename matches short name + `.pdf`
* [ ] Reassign to T601 → filename is "טופס 867 – {institution}.pdf"
* [ ] Approve a doc with exact/single issuer match → skip rename (no change, existing behavior)
* [ ] Reject a doc → moves to ארכיון without rename (existing behavior preserved)
* [ ] Reassign unmatched doc → moves to זוהו + renames correctly
* [ ] Template without `short_name_he` → fallback works (doesn't crash)
* [ ] Custom doc (general_doc) → uses custom name + `.pdf`
* [ ] Verify no regression: folder move logic (archive, zohu) still works

## 8. Implementation Notes (Post-Code)

**Implemented:** 2026-03-09

### Changes Made
1. **Extension fix:** Replaced `cls.attachment_name` extension extraction with hardcoded `const ext = '.pdf'`
2. **Title fix:** Added Airtable `documents_templates` fetch + `buildShortName()` (ported from DL-129) at top of node
3. **`HE_TITLE` map:** Kept as fallback safety net — only used if `buildShortName()` returns null
4. **`extractIssuer()` helper:** Kept for fallback path
5. **`stripHtml()` helper:** Added to clean HTML tags from `buildShortName()` output for filesystem-safe filenames
6. **Custom doc (general_doc):** Unchanged logic — uses `pa.new_doc_name` directly + `.pdf`

### Flow per action
- **Approve:** `buildShortName(cls.matched_template_id, cls.matched_doc_name)` → strip HTML → `.pdf` → fallback to `HE_TITLE + issuer`
- **Reassign:** `buildShortName(targetTemplateId, targetDoc.issuer_name)` → strip HTML → `.pdf` → fallback to `HE_TITLE + issuer` → fallback to target doc title
- **Reject:** No rename, move to archive (unchanged)
