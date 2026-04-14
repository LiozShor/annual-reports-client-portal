# Design Log 208: Document Manager Client Switcher Dropdown
**Status:** [COMPLETE]
**Date:** 2026-03-27
**Related Logs:** DL-039 (searchable combobox pattern), DL-200 (document manager UX improvements), DL-089 (SEC-004 no PII in URLs)

## 1. Context & Problem
The document manager page shows one client at a time. To switch clients, the admin must navigate back to the admin panel, find the next client, and click into their document manager. When reviewing multiple clients sequentially (e.g., during document review or approval sessions), this back-and-forth wastes significant time.

## 2. User Requirements
1. **Q:** Where should the client switcher be placed?
   **A:** Header bar, next to the back button. Always visible at top of page.

2. **Q:** What data should appear in the dropdown?
   **A:** Two separate dropdowns: one for year (default 2025, will support 2026 next year) and one for client (searchable by name). Not a single combined dropdown.

3. **Q:** How should the client list be fetched?
   **A:** Preload on page load — fetch entire client list immediately so dropdown opens instantly.

4. **Q:** What happens when a client is selected?
   **A:** Navigate to their document manager (replace current URL with new report_id).

## 3. Research
### Domain
Admin navigation UX, searchable combobox patterns, entity switching in admin tools.

### Sources Consulted
1. **"Don't Make Me Think" — Steve Krug** — Information scent: navigation elements must be self-evident. Show current client name prominently, make trigger look clickable/searchable. Recognition over recall — users should recognize clients from a filtered list, not recall exact names.
2. **Nielsen Norman Group — Dropdown Usability** — Standard dropdowns unusable beyond ~15 items. For 500+ items, searchable combobox is mandatory: text field that filters a listbox as user types.
3. **Stripe/Linear entity switching patterns** — Combobox with type-ahead filtering, each row shows name + context (email, status). Filtering must feel instant (<100ms). Highlight matched text in results.
4. **WAI-ARIA Combobox Pattern** — `role="combobox"` with `aria-expanded`, `aria-haspopup="listbox"`, keyboard nav (arrows, enter, escape), `aria-activedescendant` for visual focus.

### Key Principles Extracted
- **Search-first for large lists** — 500+ clients requires searchable combobox, not native `<select>`
- **Recognition over recall** — show stage badge alongside name so admin can identify the right client
- **Keyboard navigation** — power users (Natan) need arrow keys + enter + escape
- **Instant filtering** — client-side filter on preloaded data, <100ms response

### Patterns to Use
- **Searchable combobox** — reuse `createDocCombobox` pattern from DL-039 (already in codebase)
- **Year as native select** — only 2-3 options, no search needed
- **Preloaded data from existing API** — `ADMIN_DASHBOARD` already returns `clients[]` and `available_years[]`

### Anti-Patterns to Avoid
- **Native `<select>` for 500+ items** — unusable without search
- **Server-side search per keystroke** — unnecessary overhead when dataset fits in memory
- **Cmd+K command palette** — overkill for a single-purpose client switcher

### Research Verdict
Two-dropdown approach: native `<select>` for year (2-3 options), custom searchable combobox for client (500+ items). Reuse existing combobox CSS/JS patterns. Data comes from existing `ADMIN_DASHBOARD` API — no new endpoint needed.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `createDocCombobox()` in `admin/js/script.js` (lines 1564-1769) — searchable combobox with category headers, filtering, keyboard support. Can be adapted for client selection.
  - `ADMIN_DASHBOARD` API (`api/src/routes/dashboard.ts`) — returns `clients[]` (name, stage, report_id, year) and `available_years[]`
  - `populateYearDropdowns()` / `updateYearDropdowns()` in `admin/js/script.js` — year dropdown logic already exists
  - `positionFloating()` utility for smart dropdown positioning
* **Reuse Decision:** Adapt combobox CSS pattern from DL-039. Create new `createClientCombobox()` function specific to client switching. Year dropdown is simple native `<select>`.
* **Relevant Files:**
  - `document-manager.html` — header HTML (lines 27-41)
  - `assets/css/document-manager.css` — header styles
  - `assets/js/document-manager.js` — page init, `loadDocuments()`
  - `shared/endpoints.js` — `ADMIN_DASHBOARD` endpoint
* **Existing Patterns:** RTL-first, design-system CSS tokens, Lucide icons
* **Dependencies:** `ADMIN_DASHBOARD` API (already deployed), admin auth token in localStorage

## 5. Technical Constraints & Risks
* **Security:** Uses existing admin auth token. Only `report_id` in URL (SEC-004). No new PII exposure.
* **Risks:** Dashboard API fetches full client data per year — could be slow for first load. Mitigated by parallel fetch alongside `loadDocuments()`.
* **Breaking Changes:** None — additive HTML/CSS/JS only. Header layout changes are self-contained.
* **Unsaved changes:** If admin has pending document edits when switching clients, those changes are lost. Could add dirty-check warning but user chose direct navigation.

## 6. Proposed Solution (The Blueprint)

### Logic Flow
1. **On page load (parallel with loadDocuments):** Fetch `ADMIN_DASHBOARD` for default year (2025) to get client list + available years
2. **Render two controls in header:**
   - Year `<select>` — populated from `available_years`, default to current tax year
   - Client searchable combobox — populated from `clients[]`, shows name + stage badge
3. **Year change:** Re-fetch dashboard for new year → repopulate client combobox
4. **Client select:** Navigate to `document-manager.html?report_id={selected_report_id}`
5. **Current client highlighted:** The currently-viewed client (matching `REPORT_ID`) gets visual indicator in dropdown

### Data Structures / Schema Changes
No schema changes. Uses existing API response:
```json
{
  "clients": [{ "report_id": "recXXX", "name": "שם", "stage": "Collecting_Docs", ... }],
  "available_years": [2025, 2024]
}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `document-manager.html` | Modify | Add year select + client combobox to header area |
| `assets/css/document-manager.css` | Modify | Add styles for client switcher (combobox, year select) |
| `assets/js/document-manager.js` | Modify | Add `loadClientList()`, `createClientCombobox()`, year change handler |

### UI Mockup (Header)
```
┌──────────────────────────────────────────────────────────────┐
│ ← חזרה לפורטל ניהול    [2025 ▾]  [🔍 חפש לקוח... ▾]       │
│                                                              │
│  🏢 Logo    ניהול מסמכים                                     │
│             משרד רו״ח Client Name                               │
└──────────────────────────────────────────────────────────────┘
```
The year select and client combobox sit on the same line as the back button (top row of header).

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 items to `current-status.md`

## 7. Validation Plan
* [ ] Year dropdown shows available years, defaults to 2025
* [ ] Client combobox lists all clients for selected year with name + stage badge
* [ ] Search filters clients by name (substring match, Hebrew)
* [ ] Selecting a client navigates to their document manager
* [ ] Current client is visually highlighted in dropdown
* [ ] Changing year reloads client list for that year
* [ ] Keyboard navigation works (arrows, enter, escape)
* [ ] No layout breakage on narrow screens
* [ ] Back button still works correctly

## 8. Implementation Notes (Post-Code)
- `loadClientSwitcher()` runs in parallel with `loadDocuments()` — non-blocking, fails silently
- Stage badge CSS scoped under `.client-combobox-option .stage-badge` — avoids dependency on `admin/css/style.css`
- Input cloned on each `_buildClientCombobox()` call to remove stale event listeners (year change re-builds)
- `_handleComboOutsideClick` registered with `document.removeEventListener` guard to avoid duplicates
- Dirty check reuses existing state vars: `markedForRemoval`, `docsToAdd`, `markedForRestore`, `statusChanges`, `noteChanges`, `nameChanges`, `questionsAreDirty()`
- Year default: reads `?year=` URL param first, falls back to `'2025'`
- **Commits:** `db8d512` (feature), `9706ce5` (proportion fix — year select 74px)
