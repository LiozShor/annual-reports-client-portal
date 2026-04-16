# Design Log 205: Clear File Fields on Status Revert to Missing
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-26
**Related Logs:** [DL-045](045-document-manager-status-overview-file-actions.md), [DL-051](051-onedrive-persistent-file-links.md)

## 1. Context & Problem
When an admin changes a document's status from **Received → Missing** (or restores a Waived doc that had a file uploaded), the Airtable record retains stale file references — `file_url`, `onedrive_item_id`, `uploaded_at`, source email metadata, and AI classification fields. This creates orphaned links: the doc appears "missing" but still points to a OneDrive file, causing confusion and data inconsistency.

The actual OneDrive file is **not** deleted (safe, recoverable). Only Airtable references are cleared.

## 2. User Requirements
1. **Q:** Which fields should be cleared when a doc moves from Received → Missing?
   **A:** All file + source fields: `file_url`, `onedrive_item_id`, `expected_filename`, `file_hash`, `uploaded_at`, `source_attachment_name`, `source_message_id`, `source_internet_message_id`, `source_sender_email`, `ai_confidence`, `ai_reason`

2. **Q:** Should this also apply when restoring a Waived doc back to Missing?
   **A:** Yes, both flows — any doc going back to Missing gets a clean slate.

3. **Q:** Should the actual OneDrive file be deleted, or just the Airtable reference?
   **A:** Only clear Airtable fields. File stays in OneDrive for recovery.

4. **Q:** Should the admin see a confirmation warning before saving?
   **A:** Yes, inline warning on the doc row (amber text: "קישור הקובץ יימחק").

## 3. Research

### Domain
State Machine Side Effects, Destructive Action UX, Airtable Atomic Updates

### Sources Consulted
1. **State Machine Pattern (python-statemachine docs, AWS Event Sourcing)** — Use state entry/exit actions for cleanup side effects, not inline transition logic. Cleanup should trigger uniformly regardless of which path leads to a state.
2. **"How to Design Better Destructive Action Modals" (UX Psychology) + Smashing Magazine** — For lower-stakes changes (data cleared, not deleted), inline warnings suffice. Reserve confirmation dialogs for truly irreversible actions. Use amber/warning color, not red.
3. **Airtable PATCH API (Airtable docs)** — Set fields to `null` in PATCH to clear them. Combine status + field nulling in same request for atomicity. Setting null on already-null fields is a no-op.

### Key Principles Extracted
- **State-level cleanup**: Clear fields based on destination state, not origin. Any doc entering `Required_Missing` gets file fields cleared.
- **Inline feedback for recoverable actions**: Amber warning on the doc row. No modal needed since file persists in OneDrive.
- **Atomic update**: Status change + field clearing in single Airtable PATCH. No two-step risk.

### Patterns to Use
- **Destination-based sweep**: After building the update map, sweep all entries with `status === 'Required_Missing'` and null out file fields. Works for both explicit status change and restore.

### Anti-Patterns to Avoid
- **Checking old status**: Adds complexity and requires frontend to send old_status. Setting null on null = no-op, so checking is unnecessary.
- **Cascading automations**: Don't trigger a separate Airtable automation for field clearing — do it in the same PATCH.

### Research Verdict
Backend-driven, destination-based field clearing. Single sweep after `buildUpdateMap()` covers all paths to `Required_Missing`. Frontend shows inline amber warning for docs with `file_url` being reverted.

## 4. Codebase Analysis
* **Existing Solutions Found:** `buildUpdateMap()` already merges all doc changes (waive, restore, status, notes, names) into a unified update map. Perfect injection point for field clearing.
* **Reuse Decision:** Extend existing `buildUpdateMap()` with a post-processing sweep — no new functions needed.
* **Relevant Files:**
  - `api/src/routes/edit-documents.ts` — POST handler, `buildUpdateMap()`, batch update logic
  - `github/annual-reports-client-portal/assets/js/document-manager.js` — `setDocStatus()`, `updateDocStatusVisual()`, `toggleRestore()`, confirmation summary
  - `github/annual-reports-client-portal/assets/css/document-manager.css` — visual indicator patterns
* **Existing Patterns:** CSS classes for doc states (`.status-changed` purple border, `.marked-for-removal` red, `.marked-for-restore` blue). Warning follows same pattern with amber.
* **Alignment with Research:** Existing pattern of building a merged update map aligns perfectly with destination-based sweep. Existing inline visual indicators align with research on lower-stakes warnings.
* **Dependencies:** Airtable documents table, `AirtableClient.batchUpdate()` (PATCH, supports null fields)

## 5. Technical Constraints & Risks
* **Security:** No new auth concerns — uses existing Bearer token auth on edit-documents endpoint.
* **Risks:** None significant. Setting null on already-null fields is harmless. File persists in OneDrive.
* **Breaking Changes:** None. Additional fields in PATCH payload are additive.

## 6. Proposed Solution (The Blueprint)

### Logic Flow
1. Admin changes doc status to Missing (or checks restore on waived doc)
2. Frontend shows inline amber warning "קישור הקובץ יימחק" on affected doc row
3. Admin clicks Save → confirmation summary shows warning next to affected docs
4. Backend `buildUpdateMap()` builds update entries, then sweeps all `Required_Missing` entries to add null for 11 file fields
5. Single Airtable PATCH per batch clears status + file fields atomically

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/edit-documents.ts` | Modify | Add `FILE_FIELDS_TO_CLEAR` const + sweep in `buildUpdateMap()` |
| `github/.../assets/js/document-manager.js` | Modify | Add warning span in doc row, toggle in `updateDocStatusVisual()` and `toggleRestore()`, enhance confirmation summary |
| `github/.../assets/css/document-manager.css` | Modify | Add `.file-clear-warning` and `.file-clear-warning-summary` styles |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Change Received doc to Missing → inline warning appears (amber)
* [ ] Save → Airtable fields cleared (file_url, onedrive_item_id, expected_filename, file_hash, uploaded_at, source_*, ai_*)
* [ ] Restore Waived doc with file → warning appears
* [ ] Save restored doc → same fields cleared
* [ ] Cancel status change → warning disappears
* [ ] Waived doc without file → no warning on restore
* [ ] Missing doc changed to Missing (no-op) → no warning
* [ ] Confirmation summary shows warning for affected docs
* [ ] API build passes: `cd api && npm run build`
* [ ] No regression: other edit-documents operations (waive, notes, names, add) still work

## 8. Implementation Notes (Post-Code)
* No deviations from plan. All three files changed as specified.
* API build: `tsc --noEmit` passes (only pre-existing errors in `test-airtable.ts`).
* Deployed to Cloudflare Workers (version `75194fad`).
* Frontend pushed to GitHub (`845fffa`).
