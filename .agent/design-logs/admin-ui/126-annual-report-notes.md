# Design Log 126: Annual Report Notes
**Status:** [DRAFT]
**Date:** 2026-03-09
**Related Logs:** DL-113 (doc-manager save/stay), DL-116 (questionnaires tab with print)

## 1. Context & Problem
Office needs free-form notes per annual report — visible and editable in three surfaces: clients table, document manager, and printed questionnaires. The `notes` field already exists in Airtable (`annual_reports.notes`, multilineText) but is completely unused in the UI or any n8n workflow response.

## 2. User Requirements
1. **Q:** Should we use the existing `notes` Airtable field?
   **A:** Yes — use existing `notes` field (multilineText, already in schema)
2. **Q:** How should the clients table preview work?
   **A:** Truncated text + click to edit inline
3. **Q:** Save behavior?
   **A:** Auto-save on blur with subtle toast confirmation
4. **Q:** Document manager layout?
   **A:** Collapsible section (consistent with questionnaire section)
5. **Q:** Editable everywhere?
   **A:** Yes — editable in all three surfaces (clients table, document manager, print is read-only)

## 3. Research
### Domain
Inline editing UX, auto-save patterns, CRM notes fields

### Sources Consulted
1. **PatternFly Inline Edit Guidelines** — Pencil icon as universal edit affordance; read-only → active edit states must be visually distinct
2. **Atlassian Design — Inline Edit** — Single-click to activate; check icon saves, X discards; keep edit context visible
3. **GitLab Design System — Saving & Feedback** — "Saving…" spinner → "Change saved" toast; failure shows retry; reduce opacity while saving
4. **UI Patterns — Autosave** — Blur as primary trigger; provide undo for successful saves; never remove save affordance
5. **CSS-Tricks — Auto-Growing Textareas** — JS `scrollHeight` approach for reliable auto-expand

### Key Principles Extracted
- **Click-to-edit with visual affordance** — truncated text in table cells should have subtle hover indicator showing it's editable
- **Auto-save on blur + feedback** — save triggers on blur, show brief "saving…" then "saved" toast. On error, show persistent error toast with retry
- **Preserve context** — no modal interruption for simple edits; inline editing keeps user in flow
- **Auto-grow textarea** — textarea expands with content, no fixed height for notes that could be long

### Patterns to Use
- **Inline click-to-edit:** Click truncated text → expand to textarea → auto-save on blur → collapse back
- **Optimistic update:** Update local data immediately, save to API in background, revert on error
- **Toast feedback:** `showAIToast('הערה נשמרה', 'success')` on success, error toast on failure

### Anti-Patterns to Avoid
- **Modal for notes editing** — breaks flow for a simple text field, overkill
- **Debounced auto-save while typing** — user confusion about when it's saved; blur is cleaner
- **Fixed-height textarea** — notes can be long, auto-grow is better

### Research Verdict
Click-to-edit with auto-save on blur. Truncated preview in table, full textarea in collapsible section. Toast feedback. Optimistic local update.

## 4. Codebase Analysis
### Existing Solutions Found
- **`bookkeepers_notes` pattern** (document-manager.js) — per-document notes with popover editor, tracked in `noteChanges` Map, batch-saved with document changes. Different pattern (document-level, batch save) but useful reference.
- **`admin-update-client` endpoint** — POST webhook that handles get/update actions for report fields. Currently only name/email/phone but easily extendable to include `notes`.
- **Cross-reference pattern** — Questionnaires tab already looks up `clientsData` by `report_record_id` (line 5127 of script.js). Notes can ride on this same pattern for print.

### Reuse Decision
- **Reuse `admin-update-client`** for saving notes (extend with `notes` field) — no new endpoint needed
- **Reuse `clientsData`** as the notes source for print (cross-reference from questionnairesData)
- **Reuse collapsible section pattern** from document-manager.html for the notes section
- **Build new:** Inline edit component for clients table (no existing inline edit pattern exists)

### Relevant Files
| File | Purpose |
|------|---------|
| `admin/js/script.js` | Clients table rendering, questionnaire print, update-client calls |
| `admin/css/dashboard.css` | Clients table styles |
| `assets/js/document-manager.js` | Doc manager notes section, print from doc manager |
| `document-manager.html` | Notes section HTML |
| n8n: `AueLKVnkdNUorWVYfGUMG` | Dashboard — needs to include `notes` in response |
| n8n: `grR1Xs2vMEuq8QtZ` | Update Client — needs to accept `notes` in update |
| n8n: `Ym389Q4fso0UpEZq` | Get Client Documents — needs to return `notes` |

### Alignment with Research
Existing codebase uses modals for editing (client details) and popovers for doc notes. Research recommends inline edit for simple text — we'll introduce a new pattern for the table column while staying consistent with collapsible sections in doc manager.

## 5. Technical Constraints & Risks
* **Security:** Notes saved via authenticated `admin-update-client` webhook — same auth pattern as existing fields
* **Risks:** None significant — additive feature, no existing behavior changes
* **Breaking Changes:** New column in clients table changes layout — needs to work with existing sort/filter
* **n8n Workflow Updates:** 3 workflows need Code node changes to pass through `notes`. Airtable already fetches all fields, so just the JS mapping needs updating.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

**A. n8n Backend (3 workflows):**
1. **Dashboard** (`AueLKVnkdNUorWVYfGUMG`): Add `notes: report.notes || ''` to the client object in Format Response code node
2. **Update Client** (`grR1Xs2vMEuq8QtZ`): Add `notes` to the Airtable Update node fields (accept from request body, write to `annual_reports.notes`)
3. **Get Client Documents** (`Ym389Q4fso0UpEZq`): Add `notes: report.notes || ''` to the response in Build Response code node

**B. Admin Clients Table (script.js):**
1. Add "הערות" column header (between "חסרים" and "פעולות")
2. Add notes cell per row: truncated to ~60 chars, click to edit
3. Click handler: replace cell content with auto-growing textarea, pre-filled with current notes
4. Blur handler: auto-save via `admin-update-client` with `action: 'update-notes'`, optimistic local update
5. Toast feedback: "שומר..." → "הערה נשמרה" / error
6. Add `notes` to SORT_CONFIG for sortable column
7. CSS: notes cell truncation, edit state styles

**C. Document Manager (document-manager.js + HTML):**
1. Add collapsible "הערות לדוח" section ABOVE questionnaire section in HTML
2. Inside: auto-growing textarea, always editable when expanded
3. Populate from `data.notes` in `loadDocuments()` response
4. Blur handler: save via `admin-update-client` (REPORT_ID is already available)
5. Toast feedback same as clients table

**D. Print (both print functions):**
1. In `generateQuestionnairePrintHTML` (script.js): After client questions section, add notes block. Get notes from `clientsData` via `report_record_id` cross-reference.
2. In `printQuestionnaireFromDocManager` (document-manager.js): Add notes block after client questions. Get notes from the global variable populated during load.
3. Notes print style: light blue background (`#eff6ff`), blue-right border (`#3b82f6`), "הערות משרד" title

### Data Structures / Schema Changes
- **No Airtable schema changes** — `notes` field already exists
- **n8n only**: JS mapping changes in Code nodes (add `notes` to output objects)

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/js/script.js` | Modify | Add notes column + inline edit + print notes |
| `admin/css/dashboard.css` | Modify | Notes cell styles (truncation, edit state) |
| `document-manager.html` | Modify | Add collapsible notes section |
| `assets/js/document-manager.js` | Modify | Notes load/save/print logic |
| n8n `AueLKVnkdNUorWVYfGUMG` | Modify | Dashboard Code node — add `notes` |
| n8n `grR1Xs2vMEuq8QtZ` | Modify | Update Client — accept & write `notes` |
| n8n `Ym389Q4fso0UpEZq` | Modify | Get Client Docs — return `notes` |

### Save API Design
Reuse `admin-update-client` with a new action:
```js
POST /webhook/admin-update-client
{
  token: authToken,
  report_id: reportId,
  action: 'update-notes',
  notes: 'the note text'
}
```
Separate action keeps it lightweight — no need to send name/email/phone for a note save.

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy all unchecked Section 7 items to `current-status.md` under "Next Session TODO"

## 7. Validation Plan
* [ ] Notes column visible in clients table with correct truncation
* [ ] Click on notes cell opens inline textarea with existing content
* [ ] Blur saves notes to Airtable and shows toast
* [ ] Notes column is sortable (empty notes sort last)
* [ ] Document manager shows collapsible notes section above questionnaire
* [ ] Doc manager notes load correctly from API
* [ ] Doc manager notes save on blur
* [ ] Print from questionnaires tab includes notes section
* [ ] Print from document manager includes notes section
* [ ] Notes section appears after client questions in print
* [ ] Empty notes don't show a notes section in print
* [ ] n8n Dashboard returns `notes` in client objects
* [ ] n8n Update Client accepts and writes `notes`
* [ ] n8n Get Client Documents returns `notes`

## 8. Implementation Notes (Post-Code)
* *Pending implementation*
