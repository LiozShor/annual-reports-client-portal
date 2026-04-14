# Design Log 048: OneDrive 3-Folder System, Rename at Upload, Duplicate Detection, Archive Moves
**Status:** [DRAFT]
**Date:** 2026-02-23
**Related Logs:** 035 (WF05 AI Classification + OneDrive Upload), 036 (AI Review Interface), 046 (Loop Restructure)

## 1. Context & Problem

WF[05] uploads email attachments to OneDrive with their original names (e.g., `scan003.pdf`) even when AI successfully classifies the document. The `expected_filename` is computed but unused at upload time. Additionally:
- No duplicate detection: same file sent twice creates two copies
- When Natan reviews classifications, files stay in their original folders
- Current 2-folder structure (`מסמכים שזוהו`/`מסמכים שלא זוהו`) lacks a "finalized" stage
- When Natan reassigns a classification, the OneDrive file keeps its old name

## 2. User Requirements

1. **Q:** Rename threshold for upload?
   **A:** Any match (≥0.5) — use expected_filename immediately.

2. **Q:** Duplicate action?
   **A:** Upload but flag — upload to OneDrive anyway, mark as duplicate.

3. **Q:** Per-status email folders?
   **A:** Skip — keep current Documents folder.

4. **Q:** Rename on reassign?
   **A:** Yes — rename + move to archive in one PATCH call.

5. **Q:** New folder structure?
   **A:** 3 folders: `ממתינים לזיהוי` (pending), `זוהו` (identified), `ארכיון` (archive).

6. **Q:** What triggers archive move?
   **A:** All review actions: approve, reassign, reject (= irrelevant).

7. **Q:** Existing folders?
   **A:** Rename them to new names (one-time migration).

8. **Q:** Combine move + rename?
   **A:** Yes — single PATCH call for efficiency.

## 3. Research

### Domain
File Management APIs, Document Deduplication, Workflow Orchestration

### Sources Consulted
1. **Microsoft Graph API — driveItem Update** — PATCH `/drives/{driveId}/items/{itemId}` supports rename (`name`) + move (`parentReference.id`) in one call. Conflict: `?@microsoft.graph.conflictBehavior=rename` query param. Known bug: `replace` unreliable on moves (GitHub #1383).
2. **Microsoft Graph API — Upload (PUT content)** — Filename in URL path determines OneDrive name, independent of binary data. Hebrew/Unicode fully supported with per-segment URL encoding.
3. **SHA-256 Dedup Best Practices** — Industry standard. No collisions. Gotcha: re-generated PDFs have different metadata timestamps → different hashes. "Upload but flag" pattern: always upload, flag via notes/field.
4. **Airtable filterByFormula** — `{file_hash} = 'hex'` full-table scan. 1-3s acceptable for pipeline.
5. **Race Conditions in n8n** — n8n Cloud concurrency limits reduce risk. Post-hoc detection acceptable.

### Key Principles
- Upload filename determined by URL path → upload `scan003.pdf` bytes as `טופס 106.pdf`
- PATCH supports rename + move in single atomic call
- `conflictBehavior=rename` on PATCH: auto-appends suffix on name clash
- Always upload duplicates (never silently discard) → CRM data integrity > storage cost
- OneDrive auto-creates intermediate folders on PUT but NOT on PATCH → must resolve/create archive folder

### Patterns to Use
- **Upload-time naming:** Set correct filename in PUT URL path
- **Post-upload dup check:** Flag in notes/notification
- **Atomic move+rename:** Single PATCH with `name` + `parentReference`
- **Get-or-create folder:** GET by path → if 404, create via POST children

### Anti-Patterns to Avoid
- **Silent duplicate suppression:** Never skip upload
- **Separate rename then move:** Two API calls when one suffices
- **Hardcoded driveId:** Resolve from shared link token

## 4. Codebase Analysis

### Relevant Files
| File | Role |
|------|------|
| `tmp/process-and-prepare-upload-loop.js` | WF[05] "Process and Prepare Upload" — builds upload URL, computes expectedFilename |
| `tmp/prep-doc-update-loop.js` | WF[05] "Prep Doc Update" — Airtable update payload |
| WF[05] `cIa23K8v1PrbDJqY` | Inbound Doc Processing (28 nodes) |
| [API] Review Classification `c1d7zPAmHfHM71nV` | Review actions (17 nodes) |

### Existing Patterns
- `http-rename-file` in Review Classification renames files on approve (PATCH)
- `HE_TITLE` map: template IDs → Hebrew titles (in Process and Prepare Upload)
- `san()`: sanitizes filenames for OneDrive
- `file_hash`: SHA-256 computed in Process and Prepare Upload
- `expected_filename`: computed and passed to Airtable but never used in upload URL
- Shared link token resolves to driveId + rootFolderId (Resolve OneDrive Root node)

### Gaps Found
- Upload URL uses `data.attachment_name` not `expectedFilename` (line 131)
- Subfolder names are old: `מסמכים שזוהו`/`מסמכים שלא זוהו` (line 102)
- No duplicate hash check node in loop
- No archive folder or move logic
- `if-should-rename` skips reassign and reject actions

## 5. Technical Constraints & Risks

* **Security:** Uses existing MS Graph OAuth2 credential. No new permissions.
* **Risks:**
  - Archive folder creation on first use → Code node handles get-or-create
  - PATCH move + rename could fail if file deleted → `onError: continueRegularOutput`
  - Duplicate check adds ~1-3s per attachment → acceptable with 5s loop delay
  - Known bug: `conflictBehavior=replace` unreliable on moves → use `rename` instead
* **Breaking Changes:** Old folder names change. Existing files need one-time migration.

## 6. Proposed Solution (The Blueprint)

### New Folder Structure
```
{client}/{year}/
  ├── ממתינים לזיהוי/   ← unmatched (was: מסמכים שלא זוהו)
  ├── זוהו/              ← matched, pending review (was: מסמכים שזוהו)
  └── ארכיון/            ← finalized: confirmed/reassigned/rejected (NEW)
```

### Feature 1: Rename at Upload + New Folder Names (WF[05])
- Change subfolder names in "Process and Prepare Upload"
- Use `expectedFilename` in upload URL path

### Feature 2: Duplicate Detection (WF[05])
- Add "Check Duplicate Hash" Airtable Search node
- Flag in `notes` field + notification email

### Feature 3: Archive Move + Rename on Review (Review Classification)
- Add "Resolve OneDrive Root" HTTP node
- Add "Prepare File Move" Code node (resolves archive folder, builds PATCH body)
- Modify existing rename chain to move+rename for all actions
- Enhance "Find Target Doc" with HE_TITLE map for reassign filename

### Feature 4: One-Time Folder Migration
- Rename existing OneDrive folders to new names via Graph API

### Files to Change
| Target | Action | Description |
|--------|--------|-------------|
| WF[05] "Process and Prepare Upload" | Modify code | New subfolder names + expectedFilename in path |
| WF[05] (structure) | Add node + rewire | Check Duplicate Hash |
| WF[05] "Prep Doc Update" | Modify code | Add is_duplicate |
| WF[05] "Create Pending Classification" | Modify fields | Conditional notes |
| WF[05] "Build Summary" | Modify code | Duplicate indicator |
| Review Classification (structure) | Add/modify nodes + rewire | OneDrive root, prepare move, move/rename |
| Review Classification "Find Target Doc" | Modify code | HE_TITLE + new_expected_filename |
| Review Classification "Build Response" | Modify code | Include move/rename status |

## 7. Validation Plan
- [ ] F1: Matched attachment uploads with expected_filename to `זוהו/`
- [ ] F1: Unmatched attachment keeps original name → `ממתינים לזיהוי/`
- [ ] F2: Duplicate flagged in notification + notes
- [ ] F2: Duplicate still uploaded (not skipped)
- [ ] F3: Approve → move to `ארכיון/` (name unchanged if already correct)
- [ ] F3: Reassign → rename + move to `ארכיון/`
- [ ] F3: Reject → move to `ארכיון/` (no rename)
- [ ] F3: file_url updated in Airtable after move
- [ ] F4: Existing folders renamed
- [ ] All: Both workflows validate with 0 invalid connections

## 8. Implementation Notes (Post-Code)
* *To be filled during implementation.*
