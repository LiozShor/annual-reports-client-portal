# Design Log 080: Document Manager — Spouse Name Fix & Inline Doc Rename
**Status:** [IMPLEMENTED]
**Date:** 2026-03-02
**Related Logs:** DL-045 (document-manager status overview), DL-032 (UI redesign & edit flow)

## 1. Context & Problem

Two issues in `document-manager.html`:

**Bug — Spouse name missing in header:**
The page header shows `בן/בת זוג: -` even when the client has a spouse. Root cause: `viewClientDocs()` in admin panel doesn't pass `spouse_name` in URL params, and the page never fetches it from the API response (which already includes it).

**Feature — Inline document name editing:**
Admins need to rename documents directly (e.g., change issuer from "בנק לאומי" to "בנק הפועלים" in "טופס 867 לשנת 2025 – בנק לאומי"). Currently no edit capability exists for document names — only status, notes, and removal are supported.

## 2. User Requirements

1. **Q:** Where does the spouse bug appear?
   **A:** In the page header — "שם לקוח: Client Name, בן/בת זוג: -, שנת מס: 2025"

2. **Q:** Should the edit save permanently to Airtable?
   **A:** Yes — permanent, persists across sessions and shows everywhere.

3. **Q:** Edit full name or just issuer portion?
   **A:** Full document name — free text editing of the entire string.

4. **Q:** Should clients also see the edited name?
   **A:** Yes — both admin and client portal show the edited name.

## 3. Research

### Domain
Inline Editing UX, Data Loading Race Conditions

### Sources Consulted
1. **"Don't Make Me Think" (Krug)** — Interface must be self-evident. If user wonders "is this editable?", design failed. Pencil icon is a mindless, unambiguous click.
2. **PatternFly Inline Edit Guidelines** — Pencil icon at row end, transforms value into input. Save (checkmark) + cancel (X) replaces action area. Match input size to display to avoid layout jump.
3. **Atlassian Design: Inline Edit** — Click on value or icon to enter edit mode. Explicit save/cancel. Escape key cancels. Keep user in context — no modals for simple field edits.

### Key Principles Extracted
- **Context preservation**: Stay on same view during editing, no page nav or modals
- **Visual continuity**: Input must match display style (same font, same position, no "jump")
- **Explicit save/cancel**: Checkmark + X buttons, Enter saves, Escape cancels
- **Minimal friction**: Click pencil → type → Enter. Three interactions max.
- **Loading state awareness**: Never show stale data — update header once API response arrives

### Patterns to Use
- **Pencil-to-input swap**: Replace `.document-name` div with `<input>` on pencil click, same dimensions
- **Batched save**: Follow existing pattern — track in Map, send with other changes on "Save"
- **Progressive header update**: Populate header from URL params immediately, then overwrite from API response

### Anti-Patterns to Avoid
- **Hidden affordance**: Don't make edit only discoverable on hover — always show pencil icon
- **Auto-save without undo**: Don't save on blur. Require explicit Enter/checkmark.
- **Field jump on edit**: Input must be same width/height as display text

### Research Verdict
Follow the existing note-editing pattern (toggleNote) as the model — add a `nameChanges` Map, pencil icon, and inline input. This is consistent with the codebase and minimizes new patterns.

## 4. Codebase Analysis

### Relevant Files
| File | Role |
|------|------|
| `github/.../assets/js/document-manager.js` | Main JS — state, rendering, save logic |
| `github/.../assets/css/document-manager.css` | Styles for document items |
| `github/.../admin/js/script.js` | Admin panel — `viewClientDocs()` function |
| n8n `[API] Get Client Documents` (Ym389Q4fso0UpEZq) | API — already returns `spouse_name` |
| n8n `[04] Document Edit Handler` (y7n4qaAUiCS4R96W) | Edit handler — needs `name_updates` support |

### Existing Patterns
- **Change tracking**: `statusChanges` Map, `noteChanges` Map, `markedForRemoval` Set — all batched until save
- **Document row layout**: flex row with icon → name (flex:1) → status badge → note btn → delete btn → file links
- **Save flow**: `confirmSubmit()` builds `extensions` object, POSTs to `/edit-documents`
- **n8n batch update**: `Prep Waive Items` node merges all changes into `updateMap`, feeds `Airtable - Batch Update Docs`

### Alignment with Research
The existing batch-save pattern aligns perfectly with the "explicit save" research principle. Adding `nameChanges` Map follows the established convention.

### Dependencies
- Airtable `documents` table has `issuer_name` field (singleLineText) — this is what gets updated
- `get-client-documents` API already returns `spouse_name` in response (confirmed in Build Response node code)
- Client portal reads `doc.name` from API — updating `issuer_name` in Airtable automatically updates what clients see

## 5. Technical Constraints & Risks

* **Security:** Admin token required — already enforced by both API endpoints
* **Risks:** Renaming a doc could cause confusion if SSOT template name differs from display name. Mitigated: `issuer_name` is already the "custom display name" field separate from template type.
* **Breaking Changes:** None — adding new optional `name_updates` extension is backwards-compatible. Old payloads without it are unaffected.

## 6. Proposed Solution (The Blueprint)

### Part A: Spouse Name Fix

**Logic Flow:**
1. Keep current URL param extraction as immediate display (line 10, 74) — shows value if available
2. After `loadDocuments()` resolves, read `spouse_name` from API response
3. Update header AND the `SPOUSE_NAME` variable so doc generation also uses it

**Changes in `document-manager.js`:**
- In `loadDocuments()` after `data` is parsed (~line 136): extract `data.spouse_name` and update header + variable

**Changes in `admin/js/script.js`:**
- In `viewClientDocs()`: pass `spouse_name` from `clientsData` if available (belt & suspenders)

**No n8n changes needed** — API already returns `spouse_name`.

### Part B: Inline Document Name Editing

**Logic Flow:**
1. Add pencil icon button after `.document-name` div in each document row
2. On pencil click: replace the `.document-name` div content with an `<input>` field pre-filled with current name
3. Show save (checkmark) and cancel (X) inline buttons, hide pencil
4. Enter key or checkmark click: save new name to `nameChanges` Map, revert to text display with updated name
5. Escape key or X click: revert to original name, no change tracked
6. Visual indicator: same `status-changed`-style border highlight when name is modified
7. On page save (`confirmSubmit`): include `name_updates` array in extensions

**Frontend changes:**
- Add `nameChanges` Map to state (line ~32)
- Add pencil button in document row template (after line 277)
- Add `startNameEdit(docId)`, `saveNameEdit(docId)`, `cancelNameEdit(docId)` functions
- Track changes: `nameChanges.set(docId, newName)` / `nameChanges.delete(docId)` if reverted to original
- In `confirmSubmit()`: add `name_updates` to extensions (parallel to `note_updates`)
- CSS: `.name-edit-input` class matching `.document-name` dimensions

**Backend changes (n8n [04] Document Edit Handler):**
- `Extract & Validate` node: parse `extensions.name_updates` array
- `Prep Waive Items` node: add name_updates loop → `updateMap.get(id).issuer_name = name.issuer_name`
- No other node changes — `Airtable - Batch Update Docs` auto-maps all fields

### Data Structures

**Frontend `nameChanges` Map:**
```
docId → newName (string)
```

**Extensions payload addition:**
```json
{
  "name_updates": [
    { "id": "recXXX", "issuer_name": "New Hebrew Name" }
  ]
}
```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `github/.../assets/js/document-manager.js` | Modify | Add spouse fix in loadDocuments, add nameChanges state + edit functions, update confirmSubmit |
| `github/.../assets/css/document-manager.css` | Modify | Add `.name-edit-input` and `.name-edit-actions` styles |
| `github/.../admin/js/script.js` | Modify | Pass spouse_name in viewClientDocs URL params |
| n8n `Extract & Validate` (54bf1690) | Modify | Parse `name_updates` from extensions |
| n8n `Prep Waive Items` (5ccd073d) | Modify | Add name_updates loop to updateMap |

## 7. Validation Plan

* [ ] Open document-manager for a client WITH a spouse — verify header shows spouse name
* [ ] Open document-manager for a client WITHOUT a spouse — verify header shows "-"
* [ ] Click pencil icon — verify input appears with current name, same visual size
* [ ] Press Escape — verify edit cancels, original name restored
* [ ] Edit name + press Enter — verify name updates in display, purple border appears
* [ ] Edit name back to original — verify change tracking is cleared (no purple border)
* [ ] Save all changes — verify Airtable `issuer_name` field updated
* [ ] Reload page — verify renamed document shows new name
* [ ] Check client portal (view-documents.html) — verify client sees the renamed document
* [ ] Verify other operations (status change, notes, waive) still work alongside name edits

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
