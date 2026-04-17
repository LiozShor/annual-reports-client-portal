# Design Log 299: PA Card — Manual Issuer Edit + Per-Doc Notes + Questionnaire Print
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-17
**Related Logs:**
- DL-298 (PA queue stacked cards — this log extends it)
- DL-296 (WF02 ✨ issuer suggestion — `issuer_name_suggested` + accept chip; manual edit is the complement for wrong/missing suggestions)
- DL-295 (2-col preview, inline status menu, `togglePaShowNo`, `renderPaDocTagRow`)
- DL-227 (inline doc-tag menu pattern — reused for clicks on the doc row)
- doc-manager reference: `startCompanyEdit()` + `openNotePopover()` + `printQuestionnaireFromDocManager()` (functions we adapt)

## 1. Context & Problem

DL-298 shipped the stacked PA card, but admins still need the doc-manager for three frequent operations:
1. **Fix a wrong or missing ✨ issuer suggestion.** DL-296 only offers a 1-click *accept*. When the Haiku extraction returns `null`, extracts the wrong entity, or the admin needs to swap to a canonical `company_links` entry (e.g. "לאומי" → "בנק לאומי"), they must leave the PA card for the doc-manager's `startCompanyEdit` flow.
2. **Attach a per-doc note** for the bookkeeper ("client said will upload next week"). The field exists (`bookkeepers_notes`, written to by DL-296's raw-context append), but there's no inline editor on the PA card — admins leave for doc-manager.
3. **Print the questionnaire** for a client about to be called or reviewed offline. `printQuestionnaireFromDocManager()` exists; the PA card has no equivalent button.

Three round-trips per client, every stage-3 review.

## 2. User Requirements

1. **Q:** Pencil placement for issuer edit? **A:** Small pencil icon inline on each doc row, after the doc name + ✨ chip. Click → inline input + ✓/✗.
2. **Q:** Note popover save timing? **A:** Immediate save on popover close / blur (no dirty-state tracking — PA card has no bulk save).
3. **Q:** Hide-No toggle (already present via `togglePaShowNo`)? **A:** Already works — just add the print button alongside.
4. **Q:** Print reuse or new fn? **A:** Reuse `printQuestionnaireFromDocManager()` verbatim with small refactor to accept a data argument (currently reads doc-manager globals `_questionnaireData`, `clientQuestions`, `REPORT_NOTES`, `allReports`).
5. **Q (follow-up, user-flagged mid-discovery):** "In doc-manager there's an option to switch issuer to other companies" — include the `החלף חברה` combobox backed by `companyLinksMap`? **A:** **Yes.** For `COMPANY_TEMPLATES` (T501/T401/T301) docs, the inline edit exposes both a free-text input AND a secondary `החלף חברה ▼` combobox with the same `company_links` catalog doc-manager shows. For non-company templates, free-text only.

## 3. Research

### Domain
Inline-edit UX on dense detail views; immediate-save vs deferred-save semantics; print-dialog data plumbing.

### Sources Consulted
1. **DL-227 prior research (inline doc-tag menu)** — already established: click-tag → popover anchored by `getBoundingClientRect`, close on outside click or Esc, optimistic DOM update + PATCH. Reuse same infra for note popover + pencil input.
2. **Airtable operational patterns** (our own `EDIT_DOCUMENTS` endpoint) — `name_updates` array and `note_updates` array are both idempotent, no-email per existing DL-296/DL-227 flows. Budget: one PATCH per edit, no new endpoint.
3. **NNGroup "Inline Editing: Basic Rules"** — three hard rules: (a) clicking the affordance must NEVER destroy the current value without confirmation, (b) Save/Cancel must be reachable via both keyboard (Enter/Esc) and mouse, (c) after save, focus should return to where it came from. All three apply verbatim to the pencil input + note popover.
4. **Material "Popover dismissal"** — immediate-save on blur is appropriate for *low-stakes, single-field* edits (our note text is exactly that — no schema, free-text, easily corrected). Deferred-save (doc-manager pattern) is appropriate when there are *many* dirty fields at once (doc-manager edits N docs + questionnaire + notes in one session). The PA card has only one note per action → immediate-save is the right call.

### Key Principles Extracted
- **Match save semantics to the session length.** PA card = one card open, one edit at a time → immediate save. Doc-manager = many simultaneous dirty fields → deferred save. Don't copy the batching pattern where it doesn't fit.
- **Keep the issuer-edit UI symmetric for company and non-company templates.** Both show a free-text input; COMPANY_TEMPLATES additionally expose the swap combobox. Avoid branching users into two mental models.
- **Reuse the print HTML verbatim.** The printed layout is already validated for client handoff; regenerating it PA-side invites drift. Refactor `printQuestionnaireFromDocManager` to take data as an argument and call it from both surfaces.
- **One PATCH per edit, no new endpoints.** `EDIT_DOCUMENTS.name_updates[]` (DL-296) and a new parallel `note_updates[]` both fit the existing envelope.

### Patterns to Use
- **Click-to-edit with ✓/✗ action row** (per NNGroup; matches `startCompanyEdit` ergonomics).
- **Popover anchored via `getBoundingClientRect`** (DL-227 + doc-manager note popover — copy the positioning math).
- **Immediate save on popover close** with rollback toast on failure.
- **Optional combobox for canonical value swap** (COMPANY_TEMPLATES only) — mirrors doc-manager's `החלף חברה` affordance backed by `companyLinksMap`.

### Anti-Patterns to Avoid
- **Modal dialogs for per-doc edits.** Heavyweight, breaks flow. Inline or popover only.
- **Re-implementing the print HTML.** Forks the office-facing document over time.
- **Copying doc-manager's dirty-state Map.** Requires a bulk save button the PA card doesn't have; adds failure modes.
- **Rewriting `startCompanyEdit` for PA card.** It's heavy (`companyEntries` mapping, URL aliases, combobox with live filter). Instead: lightweight PA-scoped version that reuses the same `company_links` data source + a simple filtered-list dropdown; no URL plumbing needed (PA doesn't render company links).

### Research Verdict
Ship three features as one tight DL: (a) pencil-to-edit at the end of each doc row, with free-text input + ✓/✗ + (for COMPANY_TEMPLATES) an inline "החלף חברה" combobox pulling from `company_links`; (b) note-icon popover at the end of each doc row with immediate save of `bookkeepers_notes`; (c) print button next to the "תשובות שאלון" section title calling a refactored `printQuestionnaire(data)` helper that doc-manager also uses. All three go through `EDIT_DOCUMENTS` or `window.open`, no new endpoints.

## 4. Codebase Analysis

### Existing Solutions Found
- **`api/src/routes/admin-pending-approval.ts:79`** already loads `companyLinks` via `buildCompanyLinkMap(companyLinkRecords)` to drive the doc-builder, but doesn't return it. Expose it in the response as `company_links: companyLinksToObject(companyLinks)` — single added field, reuses existing helper at `api/src/routes/documents.ts:85`.
- **`api/src/routes/edit-documents.ts`** already accepts `name_updates: [{id, issuer_name}]` (used by DL-296 accept chip). Add parallel support for `note_updates: [{id, bookkeepers_notes}]` if not already present (verify); otherwise reuse.
- **`frontend/admin/js/script.js:5881 togglePaShowNo`** — already present. No change needed for feature #9a.
- **`frontend/admin/js/script.js:~6070 renderPaDocTagRow`** (DL-295/298) — the doc-row renderer. Extend to render trailing pencil button + note button.
- **`frontend/assets/js/document-manager.js:1276 openNotePopover` + `2853 printQuestionnaireFromDocManager`** — the reference implementations. Extract print to a shared helper (`frontend/shared/print-questionnaire.js`) that takes `{questionnaireData, clientQuestions, reportNotes, clientName, year, filingType}`. Both surfaces call the shared helper.

### Reuse Decision
- **Backend:** 1-line change to PA endpoint response (add `company_links`). Verify `EDIT_DOCUMENTS` `note_updates[]` path; add it if missing (one route, no new endpoint).
- **Frontend shared:** extract print logic to `frontend/shared/print-questionnaire.js` (exported as `printQuestionnaireSheet(data)`). Doc-manager's existing `printQuestionnaireFromDocManager` becomes a thin wrapper that passes its globals in.
- **Frontend PA:** new PA-scoped functions (`openPaIssuerEdit`, `savePaIssuerEdit`, `cancelPaIssuerEdit`, `openPaDocNotePopover`, `closePaDocNotePopover`, `printPaQuestionnaire`). All live next to DL-295/298's PA functions in `script.js`.

### Relevant Files
| File | Role |
|------|------|
| `api/src/routes/admin-pending-approval.ts` | Return `company_links` in response |
| `api/src/routes/edit-documents.ts` | Verify `note_updates[]` accepted; add if missing |
| `frontend/shared/print-questionnaire.js` | **NEW** — extracted print helper |
| `frontend/document-manager.html` | Load new shared print helper before doc-manager.js |
| `frontend/admin/index.html` | Load new shared print helper before script.js; add shared note-popover DOM (one `<div id="paNotePopover">`) |
| `frontend/assets/js/document-manager.js` | `printQuestionnaireFromDocManager` → thin wrapper calling `printQuestionnaireSheet(data)` |
| `frontend/admin/js/script.js` | Extend `renderPaDocTagRow` with pencil + note buttons; add PA issuer-edit + note-popover handlers; add `printPaQuestionnaire(item)` button in `buildPaPreviewBody` Q&A section header |
| `frontend/admin/css/style.css` | `.pa-doc-row__edit`, `.pa-doc-row__note`, `.pa-doc-row__note--has-content`, `.pa-issuer-edit-row` (input + ✓/✗), `.pa-issuer-swap-combo`, `.pa-print-btn` |

### Dependencies
- Airtable field `bookkeepers_notes` — already populated by DL-296 extraction.
- Airtable `company_links` table — already the source for `companyLinksMap`.
- No schema changes.

## 5. Technical Constraints & Risks

- **Risk:** `EDIT_DOCUMENTS` may not already support `note_updates[]`. If it doesn't: add the write path in the same PR (one `if (note_updates) for(...) patch(...)` branch in the route). Pattern copies `name_updates`.
- **Risk:** Extracting `printQuestionnaireFromDocManager` to a shared helper changes a hot path on doc-manager. Mitigate: shape-compatible wrapper; verify `_questionnaireData.client_info`, `clientQuestions`, `REPORT_NOTES`, `allReports` all flow through the new signature unchanged.
- **Risk:** The combobox for `החלף חברה` on the PA card means loading `company_links` for every report (already loaded server-side in the endpoint — just a response-size bump of ~1-2 KB per response, negligible).
- **Risk:** Note popover on a stacked card can extend past the card's expanded body if the card is near the viewport bottom. The positioning math in doc-manager's `openNotePopover` already handles flip-above; copy it verbatim.
- **Risk:** Pencil button on every doc row could crowd the row on mobile. Mitigate: show pencil only on hover / on focus at ≥768px; always visible on ≤768px (mobile has no hover). CSS: `.pa-doc-row__edit { opacity: 0; transition: opacity 120ms; } .pa-preview-doc-row:hover .pa-doc-row__edit, @media (max-width: 768px) .pa-doc-row__edit { opacity: 1; }`.
- **Security:** No new data exits the system. `bookkeepers_notes` is admin-only (already `CLIENT_SAFE_FIELDS`-excluded per DL-296). `issuer_name` follows the DL-296 pipeline. Print window opens `about:blank` — no external fetch.
- **Breaking changes:** None. Adding new fields + new UI affordances. Existing DL-298 card behavior unchanged if the user doesn't click the new buttons.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
On a DL-298 PA card, admin can (a) click a pencil on any doc row to rename the issuer, with a `החלף חברה` dropdown for T501/T401/T301 populated from `company_links`; (b) click a speech-bubble icon on any doc row to open a popover, edit `bookkeepers_notes`, blur → immediate save with toast; (c) click a 🖨 print button in the "תשובות שאלון" section header and get the same printed sheet doc-manager produces. All three work without leaving the PA card. No regressions on doc-manager's print + note flows.

### Logic Flow

**A. Manual issuer edit**
1. `renderPaDocTagRow(d, reportId)` appends `<button class="pa-doc-row__edit" onclick="openPaIssuerEdit('${reportId}', '${docId}')"><i data-lucide="pencil" /></button>` after the existing suggestion chip.
2. `openPaIssuerEdit(reportId, docId)` replaces the doc row's name span with:
   - text input (current `d.name` unwrapped via `htmlToMarkdown` — mirror doc-manager's approach) + ✓/✗ buttons
   - if `d.template_id` ∈ COMPANY_TEMPLATES: a secondary "החלף חברה ▼" toggle → combobox listing `Object.keys(company_links)` (filtered by typed text). Selecting a company fills the input.
3. Enter / ✓ → `savePaIssuerEdit(reportId, docId, newValue)` → optimistic update of `d.name` + `d.issuer_name_suggested = ''` → PATCH `EDIT_DOCUMENTS` with `name_updates: [{id: docId, issuer_name: newValue}]` → toast on success, rollback on failure.
4. Esc / ✗ → revert DOM only.

**B. Per-doc note popover**
1. `renderPaDocTagRow` appends `<button class="pa-doc-row__note ${d.bookkeepers_notes ? 'pa-doc-row__note--has-content' : ''}" onclick="openPaDocNotePopover(event, '${reportId}', '${docId}')"><i data-lucide="${has ? 'message-square-text' : 'message-square'}" /></button>`.
2. Single shared `<div id="paNotePopover">` lives at the bottom of `frontend/admin/index.html` (mirrors doc-manager's `#notePopover`).
3. `openPaDocNotePopover(event, reportId, docId)`: positions the popover using the DL-227 / doc-manager flip-above math, loads current `d.bookkeepers_notes`, focuses textarea.
4. Blur / outside click / Esc → `closePaDocNotePopover()` → if text changed: immediate PATCH `EDIT_DOCUMENTS` with `note_updates: [{id: docId, bookkeepers_notes: newText}]` → optimistic update + toast + icon swap (filled ↔ empty). Rollback on failure.

**C. Print questionnaire**
1. Extract `printQuestionnaireFromDocManager` → `frontend/shared/print-questionnaire.js` exporting `function printQuestionnaireSheet({ clientName, year, email, phone, submissionDate, filingTypeLabel, answers, clientQuestions, reportNotes })`. Takes concrete values; no global reads.
2. Doc-manager: `printQuestionnaireFromDocManager` becomes a 12-line wrapper that pulls from existing globals and calls the shared fn.
3. PA card: `buildPaPreviewBody` Q&A section title bar gets `<button class="pa-print-btn" onclick="printPaQuestionnaire('${item.report_id}')"><i data-lucide="printer" /> הדפסה</button>`.
4. `printPaQuestionnaire(reportId)` maps the PA `item` (contains `answers_all`, `client_questions`, `notes`/`client_notes`, `client_name`, `year`, `filing_type`, `spouse_name`) to the shared signature and calls `printQuestionnaireSheet(...)`.

### Data Structures / Schema Changes
- **API response (`admin-pending-approval.ts`):** add `company_links: Record<string, string>` at the top level alongside `items`.
- **API request (`edit-documents.ts`):** extend `extensions` to accept `note_updates?: Array<{id: string, bookkeepers_notes: string}>` in parallel with `name_updates`. If the route already accepts this, no change.
- No Airtable schema changes.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/admin-pending-approval.ts` | Modify | Include `company_links` in response |
| `api/src/routes/edit-documents.ts` | Verify / Modify | Accept `note_updates[]` branch; add if missing |
| `frontend/shared/print-questionnaire.js` | **Create** | `printQuestionnaireSheet(data)` — the shared HTML + `window.open` logic |
| `frontend/document-manager.html` | Modify | `<script src="shared/print-questionnaire.js">` before `document-manager.js` |
| `frontend/admin/index.html` | Modify | Same script tag; add `<div id="paNotePopover">…</div>` near the other admin modals |
| `frontend/assets/js/document-manager.js` | Modify | `printQuestionnaireFromDocManager` becomes a wrapper calling `printQuestionnaireSheet` |
| `frontend/admin/js/script.js` | Modify | Extend `renderPaDocTagRow` (pencil + note buttons); add `openPaIssuerEdit` / `savePaIssuerEdit` / `cancelPaIssuerEdit`; add `openPaDocNotePopover` / `closePaDocNotePopover` / `_updatePaNoteBtn`; add `printPaQuestionnaire(reportId)`; add print button to `buildPaPreviewBody` Q&A section title |
| `frontend/admin/css/style.css` | Modify | `.pa-doc-row__edit`, `.pa-doc-row__note`, `.pa-issuer-edit-row`, `.pa-issuer-swap-combo`, `.pa-print-btn`; hover-reveal at ≥768px |
| `.agent/design-logs/admin-ui/299-pa-card-issuer-edit-notes-print.md` | **Create** | This log |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-299 row |
| `.agent/current-status.md` | Modify | Session summary + §7 tests |

### Final Step (Always)
* **Housekeeping:** Update DL-299 status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked §7 items to `current-status.md`, commit. **Pause before push/merge** per `feedback_ask_before_merge_push`.

## 7. Validation Plan

**Issuer edit**
* [ ] Hover over a doc row → pencil appears; mobile (≤768px) → pencil always visible
* [ ] Click pencil on a non-company-template doc (e.g. T106) → inline input + ✓/✗; no "החלף חברה" dropdown
* [ ] Click pencil on T501/T401/T301 doc → input + ✓/✗ + "החלף חברה ▼" toggle
* [ ] "החלף חברה" toggle → combobox with filtered list of `company_links` names; pick one → input filled; ✓ → saves
* [ ] Enter → saves; Esc / ✗ → reverts with original value intact
* [ ] Save success: doc-row name updates (rollback of `issuer_name_suggested` if suggestion was present — chip disappears), toast "שם עודכן"
* [ ] Save failure (network offline) → DOM reverts, error toast
* [ ] Verify Airtable: `issuer_name` PATCHed; `issuer_name_suggested` cleared if was present
* [ ] XSS: `<script>` in typed name → escaped on rendered row

**Per-doc note popover**
* [ ] Click note icon on a doc row → popover opens anchored to icon; flip-above when near viewport bottom
* [ ] Type into textarea → no save yet
* [ ] Click outside / blur → popover closes; toast "הערה נשמרה" if text changed
* [ ] Esc → popover closes without save; no toast; original value restored
* [ ] Icon reflects state: filled speech bubble when note has content
* [ ] Verify Airtable: `bookkeepers_notes` PATCHed (also preserves existing DL-296 `[תשובה מהשאלון]` prefix if present)
* [ ] Network failure → rollback + error toast
* [ ] Opening second note popover closes the first

**Questionnaire print**
* [ ] Print button visible in "תשובות שאלון" section title of every expanded PA card
* [ ] Click → new print window opens with: client name + filing type + year header, Q&A table (non-"לא" answers only), client questions section, office notes
* [ ] Popup blocker blocks window → toast "אפשר חלונות קופצים"
* [ ] Doc-manager print still works identically (no regression from extraction)
* [ ] RTL + Hebrew characters render correctly in print preview

**No regression**
* [ ] DL-298 expand/collapse, folder-open link, approve-and-send, DL-296 ✨ chip accept, DL-227 status menu, DL-295 hide-No toggle all unchanged
* [ ] AI-Review tab untouched
* [ ] Doc-manager pencil edit + note popover + print all unchanged

## 8. Implementation Notes (Post-Code)

**Backend:** `EDIT_DOCUMENTS` already accepted `note_updates: [{id, note}]` (route verified at `api/src/routes/edit-documents.ts:78-78`) — no route change needed; used the existing shape. `admin-pending-approval.ts` response extended with `company_links` (inline `Record<string, string>` conversion since the `documents.ts` helper is file-local).

**Frontend shared (`frontend/shared/print-questionnaire.js`):** new module exposing `window.printQuestionnaireSheet(data)`. Self-contained RTL A4 sheet with the same CSS as the previous inline version. Accepts concrete values (no global reads). Empty-answer guard + popup-blocker toast preserved.

**Doc-manager (`document-manager.js`):** `printQuestionnaireFromDocManager` now a ~15-line wrapper that maps `_questionnaireData.client_info` + `clientQuestions` + `REPORT_NOTES` + active report's `filing_type` into the shared helper. No user-visible change to doc-manager print.

**Admin script.js:**
- `loadPendingApprovalQueue` captures `data.company_links` into new global `paCompanyLinks`.
- State globals: `_paActiveIssuerEdit`, `_paActiveNoteDocId` / `_paActiveNoteReportId` / `_paActiveNoteOriginal`, `PA_COMPANY_TEMPLATES = ['T501','T401','T301']`.
- `renderPaDocTagRow`: added pencil button + note button (with `has-content` variant + `message-square-text` icon swap), wrapped in `.pa-doc-row__actions`. Row now carries `data-doc-id` / `data-report-id` for popover teardown.
- Issuer edit: `openPaIssuerEdit` / `_paBuildIssuerSwapList` / `togglePaIssuerSwap` / `filterPaIssuerSwap` / `pickPaIssuerSwap` / `cancelPaIssuerEdit` / `savePaIssuerEdit`. Save is optimistic (mutates `doc_groups` + `doc_chips`, re-renders whole card so the header suggestion count updates); `EDIT_DOCUMENTS.name_updates`; rollback on failure.
- Note popover: `openPaDocNotePopover` / `cancelPaDocNotePopover` / `closePaDocNotePopover` / `_paTeardownNotePopoverHandlers`. Flip-above math mirrors `document-manager.js:openNotePopover`. Immediate save on outside-click (close) via `EDIT_DOCUMENTS.note_updates`; Esc = cancel (no save). Document-level click + keydown listeners are cleaned up on every close to prevent leaks.
- Print: `printPaQuestionnaire(reportId)` maps the PA item (`answers_all`, `client_questions`, `notes`/`client_notes`, etc.) into the shared helper. Button injected into the "תשובות שאלון" section title via a flex row.
- `_paFindDoc(reportId, docId)` helper walks `doc_groups → categories → docs` — shared by both issuer edit and note popover.

**CSS (`style.css`):** new block at end of file — doc-row actions with hover-reveal (always-on at ≤768px), `.pa-doc-row__note--has-content` in amber, inline issuer edit row (input + ✓/✗ + swap toggle), swap combobox (max-height list with local filter), fixed-positioned `.pa-note-popover`, print button in Q&A section title (flex-between layout).

**Research principles applied:**
- §3 principle #1 (immediate save for single-field low-stakes edits): note popover saves on close; no dirty-state Map.
- §3 principle #2 (symmetric UI for company vs non-company templates): pencil identical; only the "החלף חברה" toggle is conditional.
- §3 principle #3 (reuse print HTML): verbatim shared helper; doc-manager behavior preserved.
- §3 principle #4 (one PATCH per edit): reused existing `EDIT_DOCUMENTS` envelope for both flows; zero new endpoints.

**Deviations:**
- Used existing `EDIT_DOCUMENTS.note_updates[]` shape (`{id, note}`) rather than the `{id, bookkeepers_notes}` shape proposed in §6; route already accepted the canonical shape.
- Popover-on-close teardown uses dynamically-attached document listeners (cleanup map on `document._paNoteCloseHandler` / `_paNoteKeyHandler`) instead of adding always-on listeners; matches DL-227's doc-tag menu cleanup pattern.
- Issuer save re-renders the entire card (not just the row) so the header's ✨ count badge updates when a suggestion accept is implicit in the save. Acceptable because it's the same `outerHTML` swap pattern DL-298 already uses.
