# Design Log 196: Fix Empty Binary Upload — Field Name Mismatch
**Status:** IMPLEMENTED — NEED TESTING
**Date:** 2026-03-26
**Related Logs:** [195-fix-tool-use-response-parsing](195-fix-tool-use-response-parsing.md), [134-fix-classification-field-ordering-full-enum](134-fix-classification-field-ordering-full-enum.md)

## 1. Context & Problem

All files uploaded to OneDrive via WF05 (`[05] Inbound Document Processing`) are **0 bytes**. PDF previews fail ("הטעינה של מסמך ה-PDF נכשלה"), and duplicate detection is broken (all files share the same empty-string SHA-256 hash).

**Root cause:** Field name mismatch between two Code nodes in the same workflow:
- `Prepare Attachments` outputs: `attachment_content_bytes` (line 577)
- `Process and Prepare Upload` reads: `attachment_data` (doesn't exist → `undefined`)

```javascript
// Process and Prepare Upload — line ~132
const buf = Buffer.from(data.attachment_data || '', 'base64');  // always empty!
const fileHash = crypto.createHash('sha256').update(buf).digest('hex');  // always same hash
// ...
binary: { file: { data: buf.toString('base64'), ... } }  // uploads 0 bytes
```

**Impact:**
- Every file uploaded to OneDrive is 0 bytes → no preview, no content
- Duplicate detection is useless (all hashes identical)
- `Image to PDF` conversion skipped (`!bin.data` is true for empty string)
- **AI review tab shows only 1 document** — the API deduplicates by `file_hash` (`classifications.ts:73-81`), and since all records share the same empty-string hash, only the first record survives dedup

## 2. User Requirements

1. **Q:** Skip discovery — proceed with fix?
   **A:** Yes (user said "fix")

## 3. Research

### Domain
n8n Binary Data Flow, File Upload Pipelines

### Sources Consulted
1. **DL-195 investigation** — Discovered the empty hash during tool_use parser fix. Same `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (SHA-256 of empty string) on every record.
2. **n8n Binary Data Docs** — Code nodes that return `{ json, binary }` replace the entire binary channel. The `Process and Prepare Upload` node overwrites whatever binary was flowing from the Merge node.
3. **Upload to OneDrive node config** — Uses `contentType: binaryData`, `inputDataFieldName: file` — sends the `file` binary channel as the PUT body. If binary data is empty, OneDrive creates a 0-byte file.

### Key Principles Extracted
- Binary data rebuild in Code nodes must use the exact field name from upstream
- n8n binary channel is overwritten completely when a Code node returns a `binary` key
- Duplicate detection based on file hash is meaningless when all hashes are identical

### Research Verdict
Single field name fix: `attachment_data` → `attachment_content_bytes`. Also need to clean up the 4 duplicate pending classification records for CPA-XXX (2 old failed + 2 new with 0-byte files).

## 4. Codebase Analysis

### Existing Solutions Found
- `Prepare Attachments` (nodeId `22ed433d-fdcb-4afc-9ce2-c14cab2861c4`) — outputs `attachment_content_bytes` at line 577
- `Process and Prepare Upload` (nodeId `630031f2-6e40-46ce-be9b-9a617dd290c3`) — reads `data.attachment_data` at line ~132, should be `data.attachment_content_bytes`
- `Image to PDF` node — reads `item.binary.file.data`, correctly checks `!bin.data` to skip empty binaries

### Downstream Impact
- `Upload to OneDrive` — will now receive actual file content instead of 0 bytes
- `Check Duplicate` — will now have meaningful file hashes for dedup
- `Image to PDF` — will now convert images to PDF correctly (non-empty binary)
- Airtable `file_hash` field — will now store real hashes

## 5. Technical Constraints & Risks

- **Risk: None** — simple field name fix, same data type (base64 string)
- **Breaking Changes:** None — downstream nodes already expect binary data
- **Side effect:** Duplicate detection will now actually work — previously uploaded duplicates will get new unique hashes

## 6. Proposed Solution (The Blueprint)

### Change 1: Fix field name in `Process and Prepare Upload`

Replace `data.attachment_data` with `data.attachment_content_bytes`:
```javascript
// BEFORE
const buf = Buffer.from(data.attachment_data || '', 'base64');

// AFTER — DL-196: fix field name to match Prepare Attachments output
const buf = Buffer.from(data.attachment_content_bytes || '', 'base64');
```

### Change 2: Clean up CPA-XXX duplicate records

Delete the 2 old failed-parse records from execution 10513 (they have 0-byte OneDrive files):
- `rec2MdgNqllHv8m87` (Harel, failed parse, 0 bytes)
- `recRT5KYB3ZJyAlJe` (Phoenix, failed parse, 0 bytes)

Keep the 2 new correctly-classified records from execution 10516:
- `recAr9UH3zRADQDvK` (Phoenix T501 @ 0.98) — but 0-byte file, needs re-upload
- `reca7W4VlnX3pKHOT` (Harel T501 @ 0.95) — but 0-byte file, needs re-upload

### Change 3: Trigger re-processing for CPA-XXX

Forward the same email again to trigger WF05 with the fix, so files upload with actual content.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| WF05 `Process and Prepare Upload` node | Modify | Fix `attachment_data` → `attachment_content_bytes` |
| Airtable Pending_Classifications | Delete 2 | Remove old failed-parse records |

### Final Step (Always)
- **Housekeeping:** Update design log status, INDEX, current-status.md, commit & push

## 7. Validation Plan
- [ ] Deploy fix to WF05 via `n8n_update_partial_workflow`
- [ ] Forward an email with attachment to trigger WF05
- [ ] Verify `file_hash` is NOT the empty-string hash
- [ ] Verify OneDrive file is NOT 0 bytes (check file size in execution data)
- [ ] Verify PDF preview works in admin panel
- [ ] Verify Image to PDF conversion works for image attachments

## 8. Implementation Notes (Post-Code)

**Deployed 2026-03-26:**
- Changed `data.attachment_data` → `data.attachment_content_bytes` on line 136 of `Process and Prepare Upload` node
- Added comment: `// DL-196: fix field name to match Prepare Attachments output`
- Deployed via `n8n_update_partial_workflow` — 1 operation applied
- User manually deleted 4 CPA-XXX pending classification records (2 old failed-parse + 2 new 0-byte)
- **Next:** Forward CPA-XXX email to trigger WF05 re-processing with both DL-195 + DL-196 fixes
