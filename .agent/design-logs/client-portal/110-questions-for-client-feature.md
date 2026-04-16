# Design Log 110: Questions for Client Feature
**Status:** [COMPLETED]
**Date:** 2026-03-07
**Related Logs:** DL-104 (Doc Manager Phase 2), DL-105 (Approve & Send inline), DL-107 (Email overhaul)

## 1. Context & Problem
Office staff often need to ask clients clarifying questions alongside document requests (e.g., "Which employer issued this?" or "Did you receive income from abroad?"). Currently there's no structured way — they resort to separate emails or phone calls with no audit trail.

**Feature:** Add a "Questions for Client" section in the Document Manager where office staff can:
1. Add multiple individual questions
2. Questions appear in the Approve & Send email (WF[03]) — **only unanswered ones**
3. Log answers when client responds (via phone/WhatsApp/email)
4. Questions persist until manually cleared
5. Questions are **NOT** included in other email workflows (reminders, batch status)

## 2. User Requirements
1. **Q:** Per-report or per-document?
   **A:** Per-report — one questions section for the entire case
2. **Q:** How should clients see questions?
   **A:** Email only (read-only) — client responds externally
3. **Q:** Persist or one-time?
   **A:** Persist until manually cleared
4. **Q:** Single text block or multiple questions?
   **A:** Multiple individual questions (add/remove)
5. **Q:** Office answers?
   **A:** Yes — office can log answers to questions they asked
6. **Q:** Which emails include questions?
   **A:** Only Approve & Send (WF[03]) — not reminders or batch status

## 3. Research

### Domain
Form Design, Inline List Editing UX, Transactional Email Design

### Sources Consulted
1. **GOV.UK / DWP / Scottish Gov Design Systems (Add Another pattern)** — Add button at BOTTOM of list. Fieldset-based repeating groups. Auto-renumber on delete.
2. **Linear Inline Editing** — Click-to-edit, minimal friction. No explicit save/cancel per item.
3. **Brevo / Moosend Transactional Email Design** — Card container for distinct sections (`bg:#f9fafb`, `border:1px solid #e5e7eb`, `border-radius:8px`). Numbered items for cross-referencing.

### Key Principles Extracted
- Add button at bottom of list (GOV.UK consensus)
- Stacked layout for Q+A pairs (question above answer, full width)
- Left-border color indicator: gray=unanswered, green=answered
- Sequential numbering, auto-renumber on delete
- Empty state: icon + "No questions" + CTA button
- Email: card container, numbered, bold question text

### Patterns to Use
- **Add Another pattern:** Bottom button, sequential numbering, inline delete
- **Transactional email card:** Visually separated Q&A section before CTA

### Anti-Patterns to Avoid
- **Progressive disclosure for answer field:** Always show both Q+A fields — empty answer is visual cue
- **Auto-save per question:** Conflicts with existing transactional save model — keep all changes batched

### Research Verdict
Follow the existing Document Manager transactional model: questions are tracked as pending changes, saved via the same "Save Changes" flow, included in WF[04] payload. This is consistent with how notes, status changes, and name edits work.

## 4. Codebase Analysis

### Existing Solutions Found
- **Office notes** (`noteChanges` Map, `trackNoteChange()`, `bookkeepers_notes` field) — closest analog. Per-document textarea, tracked in Maps, saved via extensions payload.
- **Approve & Send** (`approveAndSendToClient()`) — calls WF[03] via fetch with JSON response. Already handles sent badge and duplicate send warnings.
- **Document Service** — builds `client_email_html` including full email wrapper. WF[03]'s MS Graph node sends `$json.client_email_html` directly from Document Service output.

### Reuse Decision
- Reuse the transactional change tracking pattern (Maps/Sets → extensions payload → WF[04])
- Reuse the collapsible section UI pattern from "Add Documents" section
- **Do NOT modify Document Service** — inject questions section in a new Code node in WF[03] after Document Service call

### Key Files & Integration Points

| File | Role |
|------|------|
| `github/.../document-manager.html` | Add questions section HTML (between doc list and action buttons) |
| `github/.../document-manager.js` | State management, rendering, save flow |
| `github/.../document-manager.css` | Styling for question items |
| `[API] Get Client Documents` (`Ym389Q4fso0UpEZq`) | Include `client_questions` in office response |
| `[04] Document Edit Handler` (`y7n4qaAUiCS4R96W`) | Process `question_updates` in extensions |
| `[03] Approve & Send` (`cNxUgCHLPZrrqLLa`) | New "Inject Questions" code node before MS Graph |

### Data Flow
```
[Load] API → report.client_questions (JSON) → frontend state
[Save] frontend → extensions.client_questions → WF[04] → Airtable report field
[Email] WF[03] → Get Report (includes client_questions) → Inject Questions node → email HTML
```

## 5. Technical Constraints & Risks

* **Airtable field type:** `client_questions` as `multilineText` storing JSON string. Airtable has no native JSON type — must parse/stringify.
* **MCP updateNode replaces entire `parameters`:** For Airtable node updates, must include ALL existing params (documented in MEMORY.md).
* **Email HTML injection:** Must find reliable insertion point in Document Service's `client_email_html`. Use a marker comment or insert before the CTA section.
* **No breaking changes:** Questions are optional — empty array = no section shown, no behavior change.

## 6. Proposed Solution (The Blueprint)

### Data Model
Airtable field `client_questions` on `annual_reports` table (`tbls7m3hmHC4hhQVy`):
```json
[
  {"id": "q_1709812345678", "text": "האם יש חשבוניות נוספות?", "answer": "", "created_at": "2026-03-07"},
  {"id": "q_1709812345999", "text": "מי המעסיק?", "answer": "חברת ABC", "created_at": "2026-03-07"}
]
```
- `id`: `q_` + timestamp (unique per report, no collision risk)
- `text`: question text (Hebrew free text)
- `answer`: empty string = unanswered; non-empty = answered
- `created_at`: date string (display only)

### Logic Flow

**A. Load (API → Frontend)**
1. `[API] Get Client Documents` → `Build Response` code node: add `client_questions: report.client_questions || '[]'` to office response
2. `document-manager.js` → `loadDocuments()`: parse `data.client_questions` into `clientQuestions` array

**B. Frontend UI**
1. New collapsible section "שאלות ללקוח" between `#existingDocs` and `.add-section`
2. Empty state: message-circle icon + "אין שאלות ללקוח" + "הוסף שאלה" button
3. Question list: numbered items, each with:
   - Left border color (gray=unanswered, green=answered)
   - Question number + text (textarea, editable)
   - Answer textarea (always visible, placeholder "תשובה...")
   - Delete button (trash icon, inline confirm if has content)
4. "הוסף שאלה" button at bottom
5. Changes tracked by comparing current state with `originalQuestions` snapshot

**C. Save (Frontend → WF[04] → Airtable)**
1. `saveDocumentChanges()` / `confirmSubmit()`: add `client_questions: clientQuestions` to extensions
2. WF[04] `Extract & Validate`: parse `extensions.client_questions`
3. WF[04]: new Airtable update step — write `client_questions` JSON string to report record
4. Confirmation modal: show questions summary (added/edited/deleted count)

**D. Email (WF[03] → Client)**
1. WF[03] `Get a record` already fetches report — will include `client_questions` field
2. New Code node "Inject Questions" between `Call Document Service` and `MS Graph - Send to Client`
3. Logic:
   - Parse `client_questions` from report record
   - Filter to unanswered only (`answer === ''` or `!answer`)
   - If none → pass through unchanged
   - If any → build HTML card section with numbered questions
   - Insert into `client_email_html` before the CTA button (find `</table>` before CTA or use regex)
4. Email section styling:
   ```html
   <!-- Questions card: bg:#FEF3C7, border:#F59E0B (amber/warning) -->
   <tr><td style="padding:24px 0 8px;">
     <table style="width:100%;background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;">
       <tr><td style="padding:16px 20px;">
         <p style="font-weight:bold;margin:0 0 12px;">שאלות מהמשרד:</p>
         <ol style="margin:0;padding-right:20px;">
           <li style="margin-bottom:8px;">שאלה ראשונה?</li>
           ...
         </ol>
       </td></tr>
     </table>
   </td></tr>
   ```

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `document-manager.html` | Modify | Add questions section HTML between doc list and add-section |
| `document-manager.js` | Modify | Add state (`clientQuestions`, `originalQuestions`), rendering, change tracking, save integration |
| `document-manager.css` | Modify | Add `.question-item`, `.question-answered`, `.question-unanswered` styles |
| `[API] Get Client Documents` Build Response | Modify | Add `client_questions` to office mode response |
| `[04] Document Edit Handler` Extract & Validate | Modify | Parse `client_questions` from extensions |
| `[04] Document Edit Handler` | Add node | Airtable update for `client_questions` on report record |
| `[03] Approve & Send` | Add node | "Inject Questions" Code node between Document Service and MS Graph |
| Airtable `annual_reports` table | Add field | `client_questions` (multilineText) |

## 7. Validation Plan
* [ ] Add 2-3 questions in Document Manager → verify they display with numbering and left-border indicators
* [ ] Save questions → verify Airtable `client_questions` field contains valid JSON
* [ ] Reload page → questions persist with correct text and answers
* [ ] Add answer to a question → save → answer persists
* [ ] Delete a question → remaining questions auto-renumber
* [ ] Approve & Send with unanswered questions → email contains "שאלות מהמשרד" section with only unanswered items
* [ ] Approve & Send with ALL questions answered → email does NOT contain questions section
* [ ] Approve & Send with no questions at all → email unchanged (no empty section)
* [ ] Reminder email (WF[06]) → does NOT contain questions (regression check)
* [ ] Batch Status email → does NOT contain questions (regression check)
* [ ] Edit bar shows question changes in pending count
* [ ] Confirmation modal shows question change summary

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
