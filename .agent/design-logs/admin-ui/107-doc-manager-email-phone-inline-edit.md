# Design Log 107: Document Manager Email + Phone Inline Edit
**Status:** [DRAFT]
**Date:** 2026-03-06
**Related Logs:** DL-106 (client-detail-modal-phone-field), DL-104 (doc-manager-phase2-fixes), DL-045 (document-manager-status-overview)

## 1. Context & Problem
DL-106 added client detail editing to the admin dashboard. The document-manager page shows client name/spouse/year but NOT email or phone. The user wants email and phone visible in the client bar with inline editing capability.

## 2. User Requirements
1. **Q:** Edit UX — modal or inline?
   **A:** Inline edit. Click value → turns into input → save on blur/Enter.
2. **Q:** Placement in client bar?
   **A:** After year, before sent badge. Same row.

## 3. Research
### Domain
Inline Editing UX, Form Design Patterns

### Sources Consulted
1. **PatternFly Inline Edit** — Clear visual affordance (hover border), explicit save with Enter/Escape, keep edit mode on validation failure
2. **Atlassian Design: Inline Edit** — Click to edit pattern, confirm on Enter, cancel on Escape, blur = save
3. **"Form Design Patterns" — Adam Silver** — Inline editing should have clear edit state, avoid accidental saves, validation at save time not per-keystroke

### Key Principles
- **Visual affordance on hover** — subtle border/background so users know the field is clickable
- **Keyboard-first** — Enter=save, Escape=cancel
- **Blur = attempt save** — with a small delay so click events can fire
- **Keep edit mode on error** — don't revert to read-only if validation fails
- **LTR input for email/phone** — even in RTL page, these fields are LTR

### Research Verdict
Use click-to-edit with `<strong>` → `<input>` swap. Save via the existing `admin-update-client` API (DL-106). Reuse the ADMIN_TOKEN already available in document-manager.js.

## 4. Codebase Analysis
* **Existing client bar:** `.client-bar` with 4 items (name, spouse, year, sent badge) at document-manager.html:68-86
* **API data flow:** `loadDocuments()` → fetches from `/get-client-documents?mode=office` → populates `CLIENT_NAME`, `SPOUSE_NAME`, `YEAR` globals + DOM elements
* **Missing data:** email/phone not in API response — needs Airtable lookup fields on reports table + Build Response code update
* **Update API exists:** DL-106's `admin-update-client` webhook accepts `{action: "update", report_id, name, email, phone}`
* **Toast function:** `showToast(msg, type)` already exists in document-manager.js (added in DL-105b)
* **No existing inline edit pattern** in the codebase — this will be the first instance

## 5. Technical Constraints & Risks
* **CORS:** The `admin-update-client` webhook was just created via API and may have OPTIONS handling issues (see CLAUDE.md CORS rules). User needs to deactivate/reactivate it in n8n UI first.
* **Airtable lookup fields:** Must be created manually (API scope doesn't allow schema changes).
* **Security:** Email/phone only exposed in office mode (admin auth required), not client mode.

## 6. Proposed Solution
### n8n Change
Update Build Response code in `[API] Get Client Documents` to include `client_email` and `client_phone` in office mode response.

### Frontend Changes
1. HTML: Add email + phone `.client-bar-item` elements
2. CSS: `.editable-field` hover/edit states
3. JS: Populate from API, `startInlineEdit()` / `revertInlineEdit()` / `initInlineEditing()` functions

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| document-manager.html | Modify | Add 2 client-bar-items for email/phone |
| assets/css/document-manager.css | Modify | Add .editable-field styles |
| assets/js/document-manager.js | Modify | Add globals, populate, inline edit logic |
| n8n Build Response node | Modify | Add client_email, client_phone to office response |

## 7. Validation Plan
* [ ] Airtable: client_email and client_phone lookup fields exist on reports table
* [ ] n8n: GET mode=office returns client_email and client_phone
* [ ] UI: email and phone visible in client bar with values from API
* [ ] Click email → input appears with current value, cursor active
* [ ] Enter → saves, reverts to text, toast shown
* [ ] Escape → reverts without saving
* [ ] Invalid email → validation toast, input stays open
* [ ] Blur → saves (same as Enter)
* [ ] Phone edit → same flow, no validation (free text)

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
