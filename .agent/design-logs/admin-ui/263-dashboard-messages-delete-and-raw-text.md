# Design Log 263: Dashboard Messages — Delete Option + Raw Text Only
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-13
**Related Logs:** DL-261 (dashboard recent messages panel), DL-199 (client communication notes), DL-222 (multi-button dialog pattern)

## 1. Context & Problem
The dashboard side panel ("הודעות אחרונות מלקוחות", implemented in DL-261) currently shows AI-generated summaries of client emails. The user wants:
1. **Remove AI summary** — show only the original email text (raw_snippet) inline
2. **Add delete option** — with a two-button dialog offering "permanent delete" or "hide from dashboard"

## 2. User Requirements
1. **Q:** Delete button visibility?
   **A:** Show on hover (subtle trash icon on the right side of each row)

2. **Q:** Text display — what replaces the AI summary?
   **A:** Raw email snippet shown inline, truncated to ~2 lines. No AI summary anywhere.

3. **Q:** Delete confirmation?
   **A:** Yes — confirmation dialog required before delete.

4. **Q:** Delete scope — permanent or hide?
   **A:** User chooses! Two-button dialog: "מחק לצמיתות" (permanent delete, danger) and "הסתר מהדשבורד" (hide from dashboard, neutral). Plus cancel.

## 3. Research
### Domain
Activity Feed UX, Soft Delete Patterns

### Sources Consulted
Skipped — this is a UI refinement on existing infrastructure. Prior research in DL-261 covers dashboard UX patterns.

### Key Principles Extracted
- Reuse existing multi-button dialog pattern (DL-222 `showApproveConflictDialog`)
- "Hide" is a soft-delete: add flag to note, filter server-side

### Patterns to Use
- **Multi-button confirmation dialog:** Reuse DL-222 pattern — inject custom footer into `confirmDialog` container
- **Soft delete flag:** `hidden_from_dashboard: true` on note entries — filtered in API, preserved in Airtable

### Anti-Patterns to Avoid
- **Client-side-only hiding:** Would reset on page reload. Must persist flag in Airtable.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `showApproveConflictDialog()` in `script.js:6531-6575` — exact multi-button dialog pattern we need
  - `deleteClientNote()` in `document-manager.js:2959-2967` — permanent delete pattern (filter by ID + save)
  - `saveClientNotes()` in `document-manager.js:2875-2893` — save pattern via `update-client-notes` action
  - `ENDPOINTS.ADMIN_UPDATE_CLIENT` already available in `script.js`

* **Reuse Decision:**
  - Reuse `showApproveConflictDialog` pattern for two-button dialog
  - Reuse `update-client-notes` API action for both permanent delete and flag update

* **Gaps Found:**
  - API response (`dashboard.ts:176-186`) does NOT include `note.id` — needed for delete
  - No function in `script.js` to save client notes — need to add one
  - API endpoint does not filter `hidden_from_dashboard` notes — need to add filter
  - Validation in `client.ts:107-116` does not accept `hidden_from_dashboard` field — but it only checks required fields, extra fields pass through

* **Dependencies:** Airtable `client_notes` JSON field, KV cache for recent messages

## 5. Technical Constraints & Risks
* **Security:** Uses same Bearer token auth. No new auth needed.
* **Risks:** Cache invalidation — after delete/hide, the 5-min KV cache will still show the old data. Must invalidate cache key after mutation.
* **Breaking Changes:** Adding `hidden_from_dashboard` flag to notes is backwards-compatible — existing code ignores unknown fields. Adding `id` to API response is additive.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Dashboard message rows show raw email text (no AI summary), with a hover trash icon that opens a two-button dialog for permanent delete or hide-from-dashboard.

### Logic Flow

**A. Remove AI summary, show raw text inline:**
1. In `script.js:loadRecentMessages()` — replace `m.summary` with `m.raw_snippet` as the inline text
2. Remove the hover-to-show-snippet behavior (snippet IS the primary text now)
3. CSS: repurpose `.msg-summary` to show raw text, truncated to 2 lines with `-webkit-line-clamp`

**B. Add note ID to API response:**
1. In `dashboard.ts:176-186` — add `id: note.id` to the response object
2. Filter out notes with `hidden_from_dashboard === true`

**C. Add delete button (hover trash icon):**
1. In `script.js:loadRecentMessages()` — add a trash icon button to each row
2. CSS: `.msg-delete-btn` hidden by default, visible on `.msg-row:hover`
3. Button click stops propagation (prevents row navigation click)

**D. Two-button confirmation dialog:**
1. New function `showMessageActionDialog(noteId, reportId)` — reuses `showApproveConflictDialog` pattern
2. "מחק לצמיתות" (danger) — calls `deleteRecentMessage(noteId, reportId, 'permanent')`
3. "הסתר מהדשבורד" (neutral) — calls `deleteRecentMessage(noteId, reportId, 'hide')`

**E. Delete/hide API call:**
1. New function `deleteRecentMessage(noteId, reportId, mode)`:
   - Fetch current `client_notes` via `action: 'get'` on `ADMIN_UPDATE_CLIENT`
   - If mode=permanent: filter out note by ID
   - If mode=hide: set `hidden_from_dashboard: true` on note
   - Save via `action: 'update-client-notes'`
   - Remove row from DOM with animation
   - Show success toast

**F. Cache invalidation:**
1. New API endpoint or query param to bust KV cache after mutation
   - Simplest: the dashboard JS already appends `_t=${Date.now()}` but the API caches by year key
   - Solution: after successful delete, re-fetch messages with a cache-bust param, OR add a `DELETE /admin-recent-messages/cache` endpoint
   - Simplest approach: add `?bust_cache=1` param to the GET endpoint that deletes the KV key before fetching

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/dashboard.ts` | Modify | Add `id` to response, filter `hidden_from_dashboard`, add cache-bust param |
| `admin/js/script.js` | Modify | Replace summary with raw_snippet, add delete button, add dialog + delete functions |
| `admin/css/style.css` | Modify | Line-clamp on raw text, hover delete button, remove snippet hover styles |

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, `current-status.md`

## 7. Validation Plan
* [ ] Dashboard messages show raw email text (not AI summary)
* [ ] Text truncates to ~2 lines with ellipsis
* [ ] Trash icon appears on hover, disappears when not hovering
* [ ] Clicking trash icon does NOT navigate to document-manager
* [ ] Dialog shows two options: "מחק לצמיתות" and "הסתר מהדשבורד" plus cancel
* [ ] "מחק לצמיתות" permanently removes note from Airtable
* [ ] "הסתר מהדשבורד" adds flag, note disappears from dashboard but remains in document-manager
* [ ] After delete/hide, the row is removed from the panel immediately
* [ ] Success toast shown after action
* [ ] Refreshing the page does not show deleted/hidden messages
* [ ] No regression: clicking message row still navigates to document-manager
* [ ] No regression: document-manager notes timeline unaffected

## 8. Implementation Notes (Post-Code)
* *Log any deviations from the plan here during implementation.*
