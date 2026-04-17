# Design Log 293: Doc-Manager — Full Client Edit (Pencil + Inline)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-17
**Related Logs:** DL-106 (client-detail-modal), DL-107 (doc-manager-inline-edit [DRAFT, never shipped]), DL-268 (modal cc_email + snapshot), DL-091 (soft-delete / is_active)

## 1. Context & Problem
Today you can edit client name/email/cc_email/phone from the **admin dashboard** via a pencil icon (DL-106 + DL-268) that opens `#clientDetailModal`. From the **document-manager** page, there's no way to edit client details — you have to navigate back to the dashboard, find the row, and click the pencil.

The user wants parity: a pencil icon on the doc-manager client bar that opens the same edit modal, **and** inline editing for simple fields where it makes sense ("what could be inline would be inline also"). DL-107 planned this back in March 2026 but was never implemented — the `.editable-field` styles and `startInlineEdit()` functions don't exist in the frontend yet.

## 2. User Requirements
1. **Q:** Where in the doc-manager should the edit entry point live?
   **A:** Pencil icon in header next to client name (mirrors dashboard pattern).
2. **Q:** Reuse the DL-106 modal or build a richer "full edit" modal?
   **A:** Extend the DL-106 modal with more fields — same modal used from both dashboard and doc-manager.
3. **Q:** Which extra fields should be editable?
   **A:** Identifiers (CPA ID / tax ID / company name), internal notes, and the existing name/email/phone — plus: **what could be inline would be inline also**.
4. **Q:** Should edits apply globally or per-report?
   **A:** Global — update the client record. Consistent with DL-106.

## 3. Research
### Domain
Admin Panel UX — Inline Editing & Modal Editing (same domain as DL-106 + DL-107).

### Cumulative Knowledge
Prior research from **DL-106** (modal editing: Form Design Patterns / NN-g / HubSpot-Linear-Primer) and **DL-107** (inline editing: PatternFly / Atlassian / Adam Silver) fully covers this domain. See those logs for sources. No new research needed — we are applying the same patterns to a new surface.

### Key Principles (applied here)
- **Modal for "full edit"** — bounded record editing with explicit Save/Cancel (DL-106 pattern; already shipped).
- **Inline for lightweight scalars** — click → input swap, Enter=save / Escape=cancel / blur=save (DL-107 pattern).
- **Single source of truth for the modal** — one `#clientDetailModal` reused across dashboard + doc-manager; no duplicate definitions.
- **Pre-fill, validate on submit, optimistic UI, toast feedback** — already established in DL-106/DL-268.
- **LTR inputs for email/phone** even on RTL pages.
- **Confirm only for high-impact changes** — DL-268 removed confirmation even for email (direct save + dirty-check on close). We continue that pattern.

### Anti-Patterns Avoided
- **Duplicating the modal HTML in `document-manager.html`** — would drift from the dashboard version. Instead: lift modal markup into a shared partial OR inline a duplicate but keep JS in one shared module. (Pragmatic choice below.)
- **Auto-save on keystroke** — user requirement is explicit save.

### Verdict
Ship a pencil icon on the doc-manager client bar that opens the **same modal** used on the dashboard. Add inline editing for email / cc_email / phone directly in the client bar (simple scalars, high-frequency edits). Do NOT build a separate bigger modal — one modal, two entry points.

## 4. Codebase Analysis
### Existing solutions (reuse-first)
* **Modal HTML:** `#clientDetailModal` lives in `frontend/admin/index.html` — exclusive to admin dashboard. Doc-manager (`frontend/document-manager.html`) is a separate page that does NOT load `admin/index.html`, so we must inline a copy of the modal markup there OR render it dynamically from JS.
* **Modal logic:** `openClientDetailModal`, `closeClientDetailModal`, `saveClientDetails` at `frontend/admin/js/script.js:7321-7462`. Uses globals `authToken`, `clientsData`, `fetchWithTimeout`, `showAIToast`, `showConfirmDialog`, `isValidEmail`, `ENDPOINTS.ADMIN_UPDATE_CLIENT` — most are dashboard-specific.
* **API endpoint:** `POST /admin-update-client` at `api/src/routes/client.ts:43-199`. Already supports `action: "get" | "update"` with `{name, email, cc_email, phone}`. **No changes needed API-side for name/email/cc_email/phone.**
* **Doc-manager client bar:** `frontend/document-manager.html:77-102` — 5 items (name, spouse, year, stage, sent). No email/phone/cc_email shown today.
* **Doc-manager JS:** `frontend/assets/js/document-manager.js` — has `ADMIN_TOKEN`, `REPORT_ID`, `CLIENT_NAME`, `CLIENT_EMAIL`, `CLIENT_CC_EMAIL` globals. No phone global. Has `showToast` (similar but not identical to `showAIToast`).
* **GET client data:** `ENDPOINTS.GET_CLIENT_REPORTS?client_id=...&mode=office` populates `CLIENT_EMAIL` + `CLIENT_CC_EMAIL`. Phone is NOT returned.

### Airtable clients table (`tblFFttFScDRZ7Ah5`) — confirmed fields
- `name`, `email`, `cc_email`, `phone`, `is_active`
- **NOT present:** tax_id, company_name, internal_notes, address

### Reuse decision
- **Reuse the DL-106 modal as-is** for all fields it already handles (name/email/cc_email/phone).
- **Inline a duplicate of the modal HTML** into `document-manager.html` — cheaper than a shared partial since the project has no templating layer. Modal markup is ~40 lines; acceptable duplication.
- **Lift the 3 modal JS functions** (`openClientDetailModal` / `closeClientDetailModal` / `saveClientDetails`) into a shared module `frontend/assets/js/client-detail-modal.js` so both pages import one implementation. Dependencies (`fetchWithTimeout`, `showAIToast`/`showToast`, `isValidEmail`) already exist in both.
- **Defer** tax_id / company_name / internal_notes additions — they require manual Airtable schema changes (out of scope for API token). Flag as Phase 2 in Section 7.

### Dependencies
- `api/src/routes/client.ts` — already supports all needed fields. No API change for Phase 1.
- `frontend/admin/js/script.js` — extract modal functions to shared module, delete originals, import.
- `frontend/document-manager.html` + `frontend/assets/js/document-manager.js` — new pencil + inline fields + modal mount.
- `frontend/assets/css/document-manager.css` — editable-field styles (new) + modal styles (can import from admin's CSS or duplicate the subset).

## 5. Technical Constraints & Risks
- **Modal CSS:** `.ai-modal-overlay` styles live in `frontend/admin/css/style.css`. Doc-manager uses its own CSS. Either (a) duplicate the minimal modal rules into `document-manager.css`, or (b) link `admin/css/style.css` into document-manager.html. **Choice:** duplicate the `.ai-modal-overlay` + `.ai-modal-panel` + form-group subset into `document-manager.css` — avoids loading the full admin stylesheet on every doc-manager page.
- **Auth context drift:** Dashboard uses global `authToken`, doc-manager uses `ADMIN_TOKEN` (read from localStorage directly). Shared module must accept a token argument instead of depending on a global.
- **Toast function naming:** Dashboard has `showAIToast`, doc-manager has `showToast`. Shared module must accept a toast adapter or detect which is available.
- **Phone global missing in doc-manager:** `loadClientReports()` doesn't populate a `CLIENT_PHONE` variable. Fine — the modal fetches fresh from `admin-update-client?action=get`; inline-edit initialization will also fetch once.
- **`GET_CLIENT_REPORTS` doesn't return phone:** Inline display of phone in the client bar requires either (a) extending the endpoint response, or (b) a second fetch on page load. **Choice:** extend `GET_CLIENT_REPORTS` to include `phone` in office mode — single network call, parallel to existing `client_email` + `cc_email` fields. One-line addition in the route handler.
- **Risks:** Extracting shared modal JS has low blast radius but touches a surface DL-268 just iterated on. Must preserve dirty-tracking + change-summary behavior verbatim.
- **Breaking changes:** None — modal behavior on dashboard stays byte-identical.

## 6. Proposed Solution

### Success criteria
From the document-manager page, clicking the pencil next to the client name opens the same modal used on the dashboard and saves name/email/cc_email/phone globally. Email, cc_email, and phone also support inline click-to-edit directly in the client bar without opening the modal.

### Logic flow
**Modal path (parity with dashboard):**
1. User clicks pencil next to client name in doc-manager client bar.
2. `openClientDetailModal(REPORT_ID)` (shared function) runs — same as dashboard.
3. Fetch `admin-update-client?action=get` → populate fields → show modal.
4. User edits, clicks "שמור שינויים" → `saveClientDetails()` → POST `action=update`.
5. Optimistic update of in-page state (`CLIENT_NAME` / `CLIENT_EMAIL` / `CLIENT_CC_EMAIL` / new `CLIENT_PHONE` + DOM bar items) → toast with change summary.

**Inline path (email / cc_email / phone):**
1. User clicks the `<strong>` value in a client-bar item marked `.editable-field`.
2. `startInlineEdit(fieldKey)` swaps the `<strong>` for an `<input type="email|tel">` with current value.
3. **Enter** or **blur** → validate → POST `admin-update-client action=update {<fieldKey>: value}` → swap back to `<strong>` with new value → toast. **Escape** → revert without saving.
4. On validation failure → keep input open, show toast, no save.

### Data structures
No Airtable schema changes (Phase 1). No API contract changes except: `GET_CLIENT_REPORTS` office-mode response gains `client_phone` alongside existing `client_email` + `cc_email`.

### Files to change
| File | Action | Description |
|------|--------|-------------|
| `frontend/assets/js/client-detail-modal.js` | Create | Exports `openClientDetailModal(reportId, ctx)`, `closeClientDetailModal()`, `saveClientDetails(ctx)`. `ctx = {authToken, toast, onSaved(client)}`. Behavior byte-identical to current DL-268 logic. |
| `frontend/admin/js/script.js` | Modify | Delete the 3 modal functions (lines ~7319-7462). Wrap callsite to pass `{authToken, toast: showAIToast, onSaved: (c) => { /* existing clientsData + filterClients + change-summary logic */ }}`. |
| `frontend/admin/index.html` | No change | Modal markup stays here (used by dashboard). |
| `frontend/document-manager.html` | Modify | (a) Add pencil `<button>` beside `<strong id="clientName">`. (b) Add `<div class="client-bar-item">` rows for email / cc_email / phone with `.editable-field <strong>` values. (c) Inline a duplicate of `#clientDetailModal` markup. (d) Load `client-detail-modal.js`. |
| `frontend/assets/js/document-manager.js` | Modify | Add `CLIENT_PHONE` global. Populate email/cc_email/phone bar items from `loadClientReports` response. Wire pencil onclick → `openClientDetailModal(REPORT_ID, ctx)`. Implement `startInlineEdit(fieldKey)` + `commitInlineEdit()` + `cancelInlineEdit()` (reuse `admin-update-client action=update` for single-field saves). |
| `frontend/assets/css/document-manager.css` | Modify | Add (a) `.editable-field` styles (hover border, edit-mode input, LTR for email/phone). (b) Minimal `.ai-modal-overlay` + `.ai-modal-panel` + form-group subset copied from `admin/css/style.css`. (c) Pencil icon button style matching dashboard `client-edit-link`. |
| `api/src/routes/client-reports.ts` (or wherever `GET_CLIENT_REPORTS` lives) | Modify | Include `client_phone` in office-mode response so inline edit has a value to show on load. |

### Phase 2 (deferred — requires manual Airtable schema work)
Once you add `tax_id`, `company_name`, `internal_notes` (long text) fields to the clients table in Airtable UI, we extend:
- `api/src/routes/client.ts` → GET includes them, UPDATE accepts them.
- `#clientDetailModal` HTML → 3 more inputs.
- No inline variant for these (multi-line / longer values → modal-only).

Phase 2 is not implemented in this ticket — separate DL when ready.

### Final step (housekeeping — always)
Update DL-293 status → `[IMPLEMENTED — NEED TESTING]`, mark DL-107 as `[SUPERSEDED by DL-293]` in INDEX, copy unchecked Section 7 items to `.agent/current-status.md`.

## 7. Validation Plan
- [ ] Pencil icon appears in doc-manager client bar next to client name.
- [ ] Click pencil → modal opens with current name / email / cc_email / phone pre-filled.
- [ ] Edit name in modal → save → client bar updates without reload; dashboard also shows new name on next visit.
- [ ] Edit email → save → inline email field in bar updates to new value.
- [ ] Cancel (X or backdrop) with unsaved changes → DL-268 dirty-check prompt fires.
- [ ] Inline: click email `<strong>` → turns into `<input type="email">` LTR with current value selected.
- [ ] Inline: Enter saves, Escape reverts, blur saves (same as Enter).
- [ ] Inline: invalid email → validation toast, input stays open, no save.
- [ ] Inline: cc_email and phone behave the same (phone is free-text, no format validation).
- [ ] Dashboard modal still behaves identically — regression check DL-106 + DL-268 flows (dirty-check, change summary toast, optimistic update, cc_email row).
- [ ] `admin-update-client` audit log fires for both modal and inline edits.
- [ ] `GET_CLIENT_REPORTS` office response now includes `client_phone`.
- [ ] No console errors on doc-manager page load.
- [ ] Network: single fetch for initial load (not a separate call for phone).

## 8. Implementation Notes (Post-Code)
- **API:** `api/src/routes/client-reports.ts` — office-mode response now includes `client_phone` alongside `client_email` + `cc_email` (single added field + single line in result object).
- **Shared module:** `frontend/assets/js/client-detail-modal.js` — new. Exports `openClientDetailModalShared(reportId, ctx)`, `closeClientDetailModal(skipDirtyCheck)`, `saveClientDetails()`, `buildClientDetailChanges(updated, prev)`. Behavior byte-identical to pre-extraction DL-268 implementation (dirty check, snapshot, saving overlay, optimistic update via `onSaved`).
- **Dashboard refactor:** `frontend/admin/js/script.js:7319-7462` — 144-line modal block replaced with a 25-line wrapper that injects `{authToken, toast: showAIToast, onSaved: ...}`. Change-summary HTML toast preserved via `buildClientDetailChanges` helper.
- **Dashboard HTML:** `frontend/admin/index.html` — loads `../assets/js/client-detail-modal.js` before `js/script.js`; bumped `script.js?v=265` → `v=266`.
- **Doc-manager HTML:** `frontend/document-manager.html` — added pencil link next to `#clientName` (hidden until `REPORT_ID` resolves), added 3 new `.client-bar-item` rows for email / cc_email / phone with `.editable-field` strong elements, duplicated modal markup (self-contained copy), loaded shared JS.
- **Doc-manager JS:** `frontend/assets/js/document-manager.js` — added `CLIENT_PHONE` global. `loadClientReports` + `discoverSiblingReports` now populate email/cc_email/phone globals from the API response and call `updateClientBarContacts()`. New functions: `updateClientBarContacts`, `openClientDetailModal` (wrapper), `startInlineEdit(fieldKey)`, `cancelInlineEdit(fieldKey)`.
- **Doc-manager CSS:** `frontend/assets/css/document-manager.css` — appended pencil + `.editable-field` + `.inline-edit-input` + `.ai-modal-*` subset + `.client-detail-*` styles (self-contained; no cross-file dependency on admin stylesheet).
- **CC email row visibility:** Hidden when `CLIENT_CC_EMAIL` is empty (avoids bar clutter). To add a spouse email, use the pencil → modal path. Acceptable since cc-email is relatively rare.
- **Toast adapter:** Shared module emits `warning` and `danger` types; doc-manager maps both to `error` (showToast only supports info/success/error). Dashboard passes `showAIToast` directly.
- **Phase 2 (tax_id / company_name / internal_notes):** Deferred — requires manual Airtable schema work. Not implemented here.
- **Research applied:** DL-106 (modal editing patterns — Form Design Patterns, NN-g) + DL-107 (inline editing — PatternFly, Atlassian: Enter/Escape/blur semantics, keep edit mode on validation error, LTR inputs in RTL page).
