# Design Log 258: Client Messages Visible on Low Stages
**Status:** DONE
**Date:** 2026-04-13
**Related Logs:** DL-199 (Client Communication Notes — implemented timeline + WF05 integration)

## 1. Context & Problem
When a client is at stage 1 (Send_Questionnaire), the document manager page shows only a "שאלון טרם מולא" empty state with a send-questionnaire button, then **returns early** (`document-manager.js:275`). The secondary zone — containing office notes, client messages, and rejected uploads — lives inside `#content` which stays hidden.

Clients may send emails even before filling out the questionnaire. WF05 captures these into `client_notes` in Airtable. But the office can't see them on the doc-manager page at stage 1 because the secondary zone is never rendered.

**Key insight:** The API response includes `client_notes` and `notes` at all stages. The JS already parses them (lines 247-259) **before** the early return. The data is loaded — just not displayed.

## 2. User Requirements
1. **Q:** Where should client messages appear on the low-stage view?
   **A:** Below the send button, inside the not-started-view area.

2. **Q:** Should the office be able to add/edit/delete notes from the low-stage view?
   **A:** Full edit — same capabilities as the normal doc-manager view.

3. **Q:** Which stages should show client messages?
   **A:** All stages ≤ 3 (Send_Questionnaire, Waiting_For_Answers, Pending_Approval). Note: stages 2-3 already show the full content view, so only stage 1 is actually affected.

4. **Q:** Should office notes also be visible on low stages?
   **A:** Yes — both office notes and client messages.

## 3. Research
### Domain
Progressive Disclosure UI, CRM Activity Feeds

### Research Verdict
This is a straightforward UI visibility fix — the feature (DL-199) already exists and works. The change is purely about making an existing section visible at an earlier stage. No new patterns needed. See DL-199 for the original research on CRM activity logging and timeline UX.

## 4. Codebase Analysis
### Existing Solutions Found
- **DL-199 fully implemented:** `renderClientNotes()`, `saveClientNotes()`, `addClientNote()`, `editClientNote()`, `deleteClientNote()` — all in `document-manager.js:2799-2960`
- **Office notes:** `handleNotesSave()` at `document-manager.js:587-615`
- **Secondary zone HTML:** `document-manager.html:310-394` — contains questionnaire, notes, client messages, rejected uploads sections

### Reuse Decision
100% reuse. No new functions needed. Just move existing HTML and adjust visibility.

### Relevant Files
| File | Purpose |
|------|---------|
| `github/.../document-manager.html:151-159` | `not-started-view` — early stage empty state |
| `github/.../document-manager.html:162-411` | `#content` — main content containing secondary zone |
| `github/.../document-manager.html:310-394` | `.secondary-zone` — the block to extract |
| `github/.../assets/js/document-manager.js:268-276` | Early-return logic for stage ≤ 1 |
| `github/.../assets/js/document-manager.js:323-324` | Normal content display path |
| `github/.../assets/js/document-manager.js:374-377` | No-reports path |
| `github/.../assets/css/document-manager.css:1173-1198` | Secondary zone styles (self-contained, no parent deps) |

### Alignment with Research
N/A — pure UI visibility change reusing existing implementation.

## 5. Technical Constraints & Risks
* **CSS independence:** Verified — `.secondary-zone` styles use no parent-dependent selectors. Moving out of `#content` is safe.
* **JS element IDs:** All functions target IDs (`clientNotesTimeline`, `reportNotesTextarea`, etc.) not parent selectors. Moving HTML won't break them.
* **No-reports case:** When `allReports.length === 0` (line 374), there's no `client_notes` data. Secondary zone must stay hidden.
* **Breaking Changes:** None — purely additive visibility change.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Office can see and edit client messages and office notes on the doc-manager page for stage 1 clients.

### Logic Flow
1. Move `.secondary-zone` HTML out of `#content` to be a standalone section
2. Show it whenever report data is loaded (any stage)
3. Hide it only when there's no report at all

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `github/.../document-manager.html` | Modify | Extract `.secondary-zone` from `#content`, place between `#not-started-view` and `#content` |
| `github/.../assets/js/document-manager.js` | Modify | Show `#secondaryZone` in early-return path + normal path; hide in no-reports path |

### Detailed Changes

**HTML:** Cut `.secondary-zone` block (lines 310-394) from `#content`. Add `id="secondaryZone"` and `style="display:none;"`. Place after `#not-started-view`, before `#content`.

**JS — 4 touch points:**
1. **Early-return (line 271-276):** Add `document.getElementById('secondaryZone').style.display = '';`
2. **Normal content (line 323-324):** Add same show line
3. **No-reports (line 374-377):** No change needed (secondaryZone stays `display:none`)
4. **Cached report switch (~line 540-562):** Add same show line

### Final Step (Always)
* **Housekeeping:** Update design log status, INDEX, current-status

## 7. Validation Plan
* [ ] Stage 1 client: doc-manager shows "שאלון טרם מולא" + secondary zone with notes + client messages
* [ ] Can add manual note on stage 1 view — saves to Airtable
* [ ] Can edit/delete existing notes on stage 1 view
* [ ] Stage 4+ client: full content + secondary zone works normally (no regression)
* [ ] Client switcher: switching between low/high stage clients shows correct view
* [ ] No-reports case: only not-started-view, no secondary zone
* [ ] Mobile responsive check

## 8. Implementation Notes (Post-Code)
* Moved `.secondary-zone` from inside `#content` (was lines 310-394) to standalone `#secondaryZone` sibling after `#content` closing tag
* Added `style="display:none"` default — JS shows it explicitly in 3 paths (early-return, normal content, cache restore)
* Also hide it during non-cached tab switch (before `loadDocuments` fetch) to avoid stale display
* No CSS changes needed — `.secondary-zone` selectors are self-contained
* No-reports path: no change needed, `display:none` default covers it
