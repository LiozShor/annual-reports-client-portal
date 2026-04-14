# Design Log 051: OneDrive Persistent File Links via Item ID Resolution
**Status:** [UNAPPROVED] — Research complete, implementation approach not yet decided. User concerned about redirect-per-click latency. Alternative approaches (batch resolve at page load, scheduled repair) proposed but not yet evaluated.
**Date:** 2026-02-23
**Related Logs:** [049-onedrive-file-ops-rename-move](049-onedrive-file-ops-rename-move.md), [045-document-manager-status-overview-file-actions](045-document-manager-status-overview-file-actions.md), [035-wf05-ai-classification-onedrive-upload](035-wf05-ai-classification-onedrive-upload.md)

## 1. Context & Problem

Staff renames and moves files directly in OneDrive (outside the system). The `file_url` stored in Airtable is a OneDrive `webUrl` captured at upload time — it becomes stale when the file's path changes, causing "Open file" buttons to return 404. The system already stores `onedrive_item_id` (MS Graph driveItem ID) in Airtable but never uses it for file resolution.

## 2. User Requirements

1. **Q:** What's the actual pain point?
   **A:** Links break after staff renames/moves files in OneDrive. "Open file" buttons fail.

2. **Q:** Which surfaces need reliable file links?
   **A:** All surfaces — AI review, document-manager, and client portal.

3. **Q:** Strategy: preventive or reactive?
   **A:** Switch to item IDs (preventive) — generate URLs from `onedrive_item_id` on demand so links never break.

4. **Q:** Does staff work directly in OneDrive?
   **A:** Yes — they browse OneDrive, rename files, reorganize folders manually.

## 3. Research

### Domain
Cloud file management, Microsoft Graph API, persistent file references

### Sources Consulted
1. **MS Graph API — driveItem addressing** — "Items are assigned a unique identifier when they are created and the ID persists across the actions a user performs on the item. Renaming or moving the item will not change the item's ID."
2. **MS Graph API — driveItem: get** — `GET /drives/{driveId}/items/{itemId}` returns current `webUrl` and `@microsoft.graph.downloadUrl` (short-lived download URL).
3. **MS Graph API — shares API** — Encoded sharing token resolves to `driveItem` with `parentReference.driveId`. System already uses this pattern.
4. **Design Log 049** — Already established principle: "Use `onedrive_item_id` (permanent) for all file ops — filenames/paths can change without breaking references."

### Key Principles Extracted
- Item ID is immutable within a drive — survives renames, folder moves, content updates
- Cross-drive moves (copy+delete) create new IDs — but all files are on one drive, so not applicable
- `@microsoft.graph.downloadUrl` is short-lived (~1 hour) — must generate on demand, not cache
- `driveId` is constant for the firm's OneDrive — can be cached in n8n static data

### Patterns to Use
- **Redirect webhook:** Thin n8n endpoint that resolves item ID → current URL and 302-redirects
- **Graceful fallback:** Use `file_url` when `onedrive_item_id` is missing (legacy data)

### Anti-Patterns to Avoid
- **Storing resolved URLs:** Don't cache `webUrl` or `downloadUrl` — they go stale on rename/move (the whole reason for this change)
- **Self-healing writes:** Don't update `file_url` in Airtable on every file open — adds latency and complexity for no benefit since the redirect webhook solves it

### Research Verdict
Create a redirect webhook. Frontend links point to it with `itemId` param. Webhook resolves current URL via MS Graph and 302-redirects. ~200ms per click is acceptable UX.

## 4. Codebase Analysis

### Surfaces Using `file_url`

| Surface | File | Lines | Usage |
|---------|------|-------|-------|
| AI review | `admin/js/script.js` | ~1327 | View button |
| Document manager | `assets/js/document-manager.js` | 284-289 | View + Download buttons |
| Client portal | `assets/js/view-documents.js` | — | NOT USED — no file links |

### APIs Returning `file_url`

| API | Workflow ID | Returns `onedrive_item_id`? |
|-----|-------------|----------------------------|
| Get Pending Classifications | `kdcWwkCQohEvABX0` | No — needs adding |
| Get Client Documents | `Ym389Q4fso0UpEZq` | No — needs adding |

### Auth Pattern
- `admin/js/script.js`: `authToken` variable, stored via `localStorage[ADMIN_TOKEN_KEY]`
- `document-manager.js`: reads same `localStorage` key (line 1120) — shared origin, no URL param needed

### OneDrive Auth
- OAuth2 credential: `GcLQZwzH2xj41sV7` (`MS_Graph_CPA_Automation`)
- Sharing token resolves `driveId` at runtime: `GET /shares/{token}/driveItem`
- `driveId` is constant — can cache in n8n workflow static data

## 5. Technical Constraints & Risks

* **Latency:** ~200ms per click (MS Graph roundtrip). Acceptable for file-open action.
* **Auth:** Webhook must be authenticated (uses existing admin token from localStorage).
* **Deleted files:** If item is permanently deleted, MS Graph returns 404 → webhook returns 404 error.
* **OAuth refresh:** n8n handles token refresh automatically for predefined credentials.
* **Rate limits:** Small team (~3 people), low concurrent usage. Not a concern.

## 6. Proposed Solution (The Blueprint)

### Architecture

```
Frontend "Open file" click
  → GET /webhook/resolve-file?itemId={id}&action=view&token={token}
  → n8n: resolve driveId (cached) + GET /drives/{driveId}/items/{itemId}
  → 302 redirect to current webUrl (or downloadUrl)
  → Browser opens file at current location
```

### A. New n8n Workflow: `[API] Resolve OneDrive File`

| Node | Type | Purpose |
|------|------|---------|
| Webhook | webhook | `GET /resolve-file` — receives `itemId`, `action`, `token` |
| Validate & Check Cache | code | Validate params, check `$getWorkflowStaticData('global').driveId` |
| IF driveId Cached | if | Skip sharing token resolution if cached |
| Resolve driveId | httpRequest | `GET /shares/{token}/driveItem?$select=parentReference` (only on cache miss) |
| Save driveId | code | `$getWorkflowStaticData('global').driveId = ...` |
| Get Item | httpRequest | `GET /drives/{driveId}/items/{itemId}?$select=webUrl,@microsoft.graph.downloadUrl` |
| Build Redirect | code | Pick URL based on `action` param, handle errors |
| Respond | respondToWebhook | 302 redirect (or 400/401/404 error) |

### B. Update Existing API Workflows (1 line each)

**Get Pending Classifications** (`kdcWwkCQohEvABX0`): Add `onedrive_item_id` to Build Response output.

**Get Client Documents** (`Ym389Q4fso0UpEZq`): Add `onedrive_item_id` to Build Response output.

### C. Frontend Changes

**Shared helper** (added to both JS files):
```javascript
function buildFileUrl(item, action = 'view') {
    if (item.onedrive_item_id) {
        const token = localStorage.getItem('QKiwUBXVH@%#1gD7t@rB]<,dM.[NC5b_') || '';
        return `${API_BASE}/resolve-file?itemId=${encodeURIComponent(item.onedrive_item_id)}&action=${action}&token=${encodeURIComponent(token)}`;
    }
    if (item.file_url) {
        return action === 'download'
            ? item.file_url + (item.file_url.includes('?') ? '&' : '?') + 'download=1'
            : item.file_url;
    }
    return null;
}
```

**`admin/js/script.js`** (~line 1327): Replace `item.file_url` with `buildFileUrl(item, 'view')`.

**`document-manager.js`** (lines 284-289): Replace `doc.file_url` links with `buildFileUrl(doc, 'view')` and `buildFileUrl(doc, 'download')`.

### Files to Change

| File / Workflow | Action | Description |
|-----------------|--------|-------------|
| New n8n workflow | Create | `[API] Resolve OneDrive File` — redirect webhook |
| n8n `kdcWwkCQohEvABX0` Build Response | Modify | Add `onedrive_item_id` to response |
| n8n `Ym389Q4fso0UpEZq` Build Response | Modify | Add `onedrive_item_id` to response |
| `admin/js/script.js` | Modify | Add `buildFileUrl()`, update view button |
| `assets/js/document-manager.js` | Modify | Add `buildFileUrl()`, update view/download buttons |

## 7. Validation Plan

* [ ] Click "Open file" on AI review card (doc with `onedrive_item_id`) → opens correct file
* [ ] Click "Open file" on AI review card (doc with only `file_url`) → opens via fallback
* [ ] Click view on document-manager (doc with `onedrive_item_id`) → opens correct file
* [ ] Click download on document-manager → triggers download
* [ ] Rename file in OneDrive, then click "Open file" → still works
* [ ] Move file to different folder in OneDrive, then click "Open file" → still works
* [ ] Call webhook without `token` → 401 error
* [ ] Call webhook with invalid `itemId` → 404 error
* [ ] Doc with no `file_url` and no `onedrive_item_id` → no buttons shown

## 8. Open Questions (Unapproved)

**Redirect webhook approach was rejected** — user felt per-click latency (~200-500ms) is unacceptable.

**Alternative approaches to evaluate next session:**

| Approach | Page load impact | Click latency | Staleness window | Complexity |
|----------|-----------------|---------------|------------------|------------|
| **A. Resolve at page load** — API batch-resolves item IDs via MS Graph `$batch` before returning to frontend | +200ms | 0ms (direct link) | None | Modify 2 API Code nodes |
| **B. Scheduled batch repair** — Workflow runs every 15-30 min, updates stale `file_url` in Airtable | 0ms | 0ms (direct link) | Up to 30 min | 1 new scheduled workflow |
| **C. Both combined** — Resolve at load + scheduled repair for Airtable hygiene | +200ms | 0ms | None | Both changes |

**Key research findings (confirmed):**
- `onedrive_item_id` is immutable within a drive — survives renames, moves, content updates
- `GET /drives/{driveId}/items/{itemId}` returns current `webUrl`
- MS Graph `$batch` supports 20 requests per call — efficient for bulk resolution
- System already stores `onedrive_item_id` in both `documents` and `pending_classifications` tables
- `driveId` resolved from sharing token, constant for the firm's OneDrive

## 9. Implementation Notes (Post-Code)

* *Pending approval and implementation.*
