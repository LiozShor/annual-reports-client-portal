# Design Log 056: OneDrive Persistent File Links — Batch Resolve at Page Load
**Status:** [IMPLEMENTED]
**Date:** 2026-02-25
**Related Logs:** [051-onedrive-persistent-file-links](051-onedrive-persistent-file-links.md) (prior research, redirect approach rejected), [049-onedrive-file-ops-rename-move](049-onedrive-file-ops-rename-move.md), [045-document-manager-status-overview-file-actions](045-document-manager-status-overview-file-actions.md)

## 1. Context & Problem

Staff may rename/move files directly in OneDrive after the system uploads them. The `file_url` stored in Airtable is captured at upload time and becomes stale. The system already stores `onedrive_item_id` (immutable MS Graph driveItem ID) but never uses it for URL resolution. This is a preventive fix — links aren't broken yet.

## 2. User Requirements

1. **Q:** Which approach for persistent links? (Redirect per click, resolve at page load, scheduled batch repair)
   **A:** Resolve at page load — APIs batch-resolve item IDs via MS Graph before returning to frontend. 0ms click latency.

2. **Q:** Which surfaces need fixing?
   **A:** All — links aren't broken yet but this is preventive for all surfaces (AI review, document manager, client portal).

3. **Q:** How often does staff rename/move files?
   **A:** Unknown frequency — preventive measure.

## 3. Research

### Domain
Cloud file management, Microsoft Graph API, persistent file references

### Sources Consulted
*See design log 051 for full research. Key findings carried forward:*

1. **MS Graph API — driveItem addressing** — Item IDs are immutable within a drive. Renaming or moving does not change the ID.
2. **MS Graph API — $batch** — Supports up to 20 requests per call. Efficient for bulk resolution.
3. **MS Graph API — driveItem: get** — `GET /drives/{driveId}/items/{itemId}?$select=webUrl` returns current `webUrl`.
4. **Design Log 049** — Established principle: use `onedrive_item_id` (permanent) for all file ops.

### Key Principles Extracted
- Item ID is immutable within a drive — survives renames, moves, content updates
- `$batch` API enables resolving all URLs in a single HTTP call (~200ms)
- Graceful degradation: if resolution fails, fall back to existing `file_url`

### Patterns to Use
- **Batch resolve at page load:** API resolves all item IDs before returning response
- **Graceful fallback:** If MS Graph fails, return existing `file_url` unchanged
- **Transparent to frontend:** API returns fresh `file_url` — no frontend changes needed

### Anti-Patterns to Avoid
- **Redirect per click:** Rejected — adds ~200ms latency per click
- **Storing resolved URLs permanently:** `webUrl` goes stale on rename/move
- **Frontend-side resolution:** Frontend can't access MS Graph (no OAuth2 token)

### Research Verdict
Batch resolve at page load. Modify both API workflows to resolve `onedrive_item_id` → fresh `webUrl` via MS Graph `$batch` before responding. Zero frontend changes.

## 4. Codebase Analysis

### API Workflows

| Workflow | ID | Build Response Node | Response Structure |
|----------|-----|--------------------|--------------------|
| Get Pending Classifications | `kdcWwkCQohEvABX0` | `code-build-response` | Flat: `{ items: [{file_url, ...}] }` |
| Get Client Documents | `Ym389Q4fso0UpEZq` | `4aca5e5a-...` | Nested: `{ groups: [{ categories: [{ docs: [{file_url}] }] }] }` |

Both workflows:
- Already have `onedrive_item_id` available from Airtable queries
- Do NOT include `onedrive_item_id` in API responses
- Build Response → Respond (direct connection, we insert 3 nodes between)
- Build Response uses `this.helpers.httpRequest()` for Airtable calls

### Frontend Surfaces (no changes needed)

| Surface | File | Link Pattern |
|---------|------|-------------|
| AI review | `admin/js/script.js:1518` | `<a href="${escapeAttr(item.file_url)}"...>` |
| Document manager | `assets/js/document-manager.js:292` | `<a href="${escapeHtml(doc.file_url)}"...>` (view + download) |
| Client portal | `assets/js/view-documents.js:234` | `<a href="${doc.file_url}"...>` |

### Airtable Fields

| Table | Field | Available |
|-------|-------|-----------|
| `pending_classifications` | `onedrive_item_id` | Yes (singleLineText) |
| `documents` | `onedrive_item_id` | Yes (singleLineText) |

### OAuth2 Credential
- ID: `GcLQZwzH2xj41sV7` (MS_Graph_CPA_Automation)
- Used by existing WF[05] and Review Classification workflows

## 5. Technical Constraints & Risks

* **Latency:** +200ms per API call (MS Graph $batch roundtrip). Acceptable — page load goes from ~300ms to ~500ms.
* **Auth:** Uses existing MS_Graph_CPA_Automation OAuth2 credential. n8n handles token refresh automatically.
* **`/me/drive` vs `/drives/{driveId}`:** Starting with `/me/drive/items/{id}` (delegated auth). If it fails, will switch to explicit driveId approach.
* **Deleted files:** MS Graph returns 404 → batch response has error for that item → fallback to existing `file_url`.
* **Rate limits:** Small team, low concurrency. $batch further reduces API calls.
* **Breaking Changes:** None. Frontend is unchanged. API response structure is unchanged (same `file_url` field, just fresher values).

## 6. Proposed Solution (The Blueprint)

### Architecture Per Workflow

```
Build Response (modified) → Prepare Batch (new Code) → Batch Resolve URLs (new HTTP Request) → Apply Fresh URLs (new Code) → Respond (existing)
```

### Build Response Changes

**Get Pending Classifications:** Add to items.push():
```javascript
onedrive_item_id: d.onedrive_item_id || null,
```

**Get Client Documents:** Add to both groupByCategory() and groupByCategoryCl():
```javascript
onedrive_item_id: d.json.onedrive_item_id || null,
```

### Prepare Batch (Code node)

Collects `onedrive_item_id` values, builds $batch body. If no items need resolution, outputs a no-op request with `_skip: true`.

### Batch Resolve URLs (HTTP Request node)

POST `https://graph.microsoft.com/v1.0/$batch` with OAuth2. `onError: continueRegularOutput`.

### Apply Fresh URLs (Code node)

References `$('Build Response')` for original data, `$('Prepare Batch')` for item map, `$input` for batch results. Merges fresh `webUrl` into `file_url`, removes `onedrive_item_id` from output.

### Files to Change

| File / Workflow | Action | Description |
|-----------------|--------|-------------|
| n8n `kdcWwkCQohEvABX0` Build Response | Modify | Add `onedrive_item_id` to items |
| n8n `kdcWwkCQohEvABX0` (structure) | Add 3 nodes + rewire | Prepare Batch, Batch Resolve, Apply Fresh URLs |
| n8n `Ym389Q4fso0UpEZq` Build Response | Modify | Add `onedrive_item_id` to docs |
| n8n `Ym389Q4fso0UpEZq` (structure) | Add 3 nodes + rewire | Prepare Batch, Batch Resolve, Apply Fresh URLs |

## 7. Validation Plan

* [ ] AI review panel: "Open file" links work for docs with `onedrive_item_id`
* [ ] Document manager: view + download links work
* [ ] Client portal: view links work
* [ ] Rename file in OneDrive → reload → link still opens correct file
* [ ] Move file to different folder → reload → link still works
* [ ] API response time <500ms total
* [ ] Docs without `onedrive_item_id` → existing `file_url` preserved
* [ ] MS Graph failure → graceful fallback to existing `file_url`
* [ ] Empty pending list → no errors
* [ ] Both workflows validate with 0 invalid connections

## 8. Implementation Notes (Post-Code)

**Implemented:** 2026-02-25

### WF1: Get Pending Classifications (`kdcWwkCQohEvABX0`)
- **Build Response** (`code-build-response`): Added `onedrive_item_id: d.onedrive_item_id || null` to items.push block
- **Prepare Batch** (new Code node at [920, 400]): Collects unique item IDs from flat `items[]`, caps at 20
- **Batch Resolve URLs** (new HTTP Request at [1144, 400]): POST `$batch`, OAuth2 `GcLQZwzH2xj41sV7`, `onError: continueRegularOutput`
- **Apply Fresh URLs** (new Code node at [1368, 400]): Merges `webUrl` into `file_url`, deletes `onedrive_item_id` from output
- **Respond** moved to [1592, 400]
- Node count: 6 → 9

### WF2: Get Client Documents (`Ym389Q4fso0UpEZq`)
- **Build Response** (`4aca5e5a-...`): Added `onedrive_item_id: d.json.onedrive_item_id || null` in both `groupByCategory()` (office) and `groupByCategoryCl()` (client)
- **Prepare Batch** (new Code node at [-136, 45120]): Walks nested `groups[].categories[].docs[]` structure
- **Batch Resolve URLs** (new HTTP Request at [88, 45120]): Same config as WF1
- **Apply Fresh URLs** (new Code node at [312, 45120]): Walks nested structure to update URLs
- **Respond** moved to [512, 45120]
- Node count: 10 → 13

### Design Decisions
- **No _skip flag:** If no items have `onedrive_item_id`, empty `requests[]` is sent to MS Graph. HTTP Request fails gracefully (`onError: continueRegularOutput`), Apply Fresh URLs detects no valid responses and returns original unchanged.
- **Cap at 20:** MS Graph $batch supports max 20 requests. Items beyond 20 keep their existing `file_url`. Unlikely to hit this limit in practice.
- **`/me/drive` path:** Using delegated auth path. If credential uses app-only auth, will need to switch to `/drives/{driveId}/items/{id}`.
- **No frontend changes:** All 3 surfaces benefit transparently — API returns fresh `file_url` values in the same shape.
