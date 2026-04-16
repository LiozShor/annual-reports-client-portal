# Design Log 106: Client Detail Modal + Phone Field
**Status:** [DRAFT]
**Date:** 2026-03-06
**Related Logs:** DL-091 (deactivate-client-soft-delete), DL-037 (admin-portal-ux-refactor)

## 1. Context & Problem
The admin panel has no way to edit client contact details (name, email, phone). Currently:
- Changing a client's email requires direct Airtable access
- No phone field exists in the system at all
- The manual "add client" form only collects name + email
- Client name click goes to document manager, with no path to edit client info

## 2. User Requirements
1. **Q:** Where should the email be editable?
   **A:** Admin dashboard — click an edit icon next to client name to open a detail modal.

2. **Q:** Should there be safeguards when changing email?
   **A:** Yes — confirmation dialog warning that future emails will go to the new address.

3. **Q:** Should email changes affect all reports for the same client?
   **A:** Yes, global — email lives on the client record.

4. **Q:** What fields should be editable?
   **A:** Email, Name, Phone.

5. **Q:** How to handle the name-click conflict (currently opens doc manager)?
   **A:** Keep name click → doc manager. Add a pencil ✏️ icon next to the name that opens the detail modal.

6. **Q:** Should we also update the add-client flow?
   **A:** Yes — add phone field to manual add form + bulk import.

## 3. Research
### Domain
Admin Panel UX, Form Design Patterns, Modal Editing

### Sources Consulted
1. **"Form Design Patterns" — Adam Silver** — Pre-fill all fields with existing data. Validate on submit, not on keystroke. Never disable Save button. Error messages must state what happened AND what to do.
2. **"Don't Make Me Think" — Steve Krug** — Edit mode must be visually obvious (2+ signals). Use conventions (pencil icon, Save/Cancel). Design for scanning with labels above inputs.
3. **Nielsen Norman Group — Modal Dialogs & Confirmation** — Modals are justified for bounded record editing. Use action-specific button labels ("שמור שינויים" not "אישור"). Reserve confirmations for high-impact changes only (email change = yes, name change = no).
4. **HubSpot/Linear/GitHub Primer** — Explicit save with optimistic UI + toast feedback is the safest CRM pattern. Never mix auto-save and explicit save. Save button text should use object name.

### Key Principles Extracted
- **Pre-fill always** — Modal opens with current values, user sees what they're changing
- **Validate on submit** — No inline validation on keystroke; validate when Save clicked
- **Confirm only email changes** — Email affects all future communications; name/phone are low-risk
- **Optimistic UI** — Update `clientsData` immediately on save, revert on API error
- **Labels above inputs** — Standard RTL-safe vertical layout in modal

### Patterns to Use
- **AI Modal pattern** (`.ai-modal-overlay > .ai-modal-panel`) — consistent with existing modals
- **Explicit Save + Cancel** — footer buttons, action-specific label "שמור שינויים"
- **Toast feedback** — `showAIToast` on success/failure

### Anti-Patterns to Avoid
- **Auto-save on blur** — too risky for contact info
- **Disabled Save button** — no feedback about what's wrong
- **Confirmation on every save** — only for email changes
- **Generic errors** — must be field-specific ("אימייל לא תקין")

### Research Verdict
Use the existing AI Modal pattern with explicit save, pre-filled fields, and a confirmation dialog only when email changes. Toast feedback on save. Validate on submit.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `showConfirmDialog()` — callback-based confirm, perfect for email change warning
  - `showAIToast()` — success/error feedback
  - `fetchWithTimeout()` with `FETCH_TIMEOUTS.mutate` — standard API call pattern
  - `isValidEmail()` — email validation already exists
  - AI Modal markup pattern in index.html (aiReassignModal as template)
  - `performServerImport()` — sends `{name, email}` array, needs `phone` added
* **Reuse Decision:** Reuse all existing UI patterns. New: modal HTML, 2 JS functions, 1 n8n workflow.
* **Relevant Files:**
  - `admin/index.html` — modal markup + manual add form
  - `admin/js/script.js` — JS logic
  - `admin/css/style.css` — modal form styles
  - n8n workflow `[API] Admin Bulk Import` — accept phone in import
* **Existing Patterns:** Client name cell has `client-link` (click→docs) + `client-view-link` (icon→portal). Edit icon follows same pattern.
* **Dependencies:** Airtable clients table needs `phone` field added manually (no schema write access).

## 5. Technical Constraints & Risks
* **Security:** Auth token verified via HMAC on every request. CORS headers required.
* **Airtable schema:** Token lacks `schema.bases:write` — phone field must be created manually in Airtable UI.
* **Risks:** Changing email affects all reports for that client (lookup field). Confirmation dialog mitigates.
* **Breaking Changes:** None — new endpoint, new modal, existing behavior untouched.

## 6. Proposed Solution (The Blueprint)

### Overview
Three changes: (A) new n8n webhook for get/update client, (B) client detail modal in admin, (C) phone field in add-client flow.

### A. n8n Workflow: `[API] Admin Update Client`

**Pattern:** Modeled after Admin Toggle Active (jIvRNEOifVc3SIgi)

**Endpoint:** POST `/admin-update-client`

**Request — Get mode:**
```json
{ "token": "...", "report_id": "recXYZ", "action": "get" }
```
**Response:** `{ ok: true, client: { name, email, phone, client_id } }`

**Request — Update mode:**
```json
{ "token": "...", "report_id": "recXYZ", "action": "update", "fields": { "name": "...", "email": "...", "phone": "..." } }
```
**Response:** `{ ok: true, updated: { name, email, phone } }`

**Node Flow (9 nodes):**
1. Webhook (POST /admin-update-client)
2. Verify Token & Input (Code) — validate token, extract action + report_id
3. IF Authorized
4. Get Report (Airtable search annual_reports)
5. Route by Action (IF action=get vs update)
6. **GET path:** Get Client (Airtable get clients by ID) → Respond Client Details
7. **UPDATE path:** Update Client (Airtable update clients) → Audit Log → Respond Success
8. Respond Unauthorized (with CORS)

All Respond nodes include CORS headers.

### B. Admin Panel: Client Detail Modal

**Entry point:** Pencil icon next to client name in dashboard table (same hover-reveal pattern as external-link icon).

**Modal structure:**
```
┌─────────────────────────────────────┐
│ ✏️  עריכת פרטי לקוח                │
├─────────────────────────────────────┤
│                                     │
│  שם מלא:                            │
│  ┌─────────────────────────────┐    │
│  │ Moshe Cohen                 │    │
│  └─────────────────────────────┘    │
│                                     │
│  אימייל:                            │
│  ┌─────────────────────────────┐    │
│  │ moshe@example.com           │    │
│  └─────────────────────────────┘    │
│                                     │
│  טלפון:                             │
│  ┌─────────────────────────────┐    │
│  │ 050-1234567                 │    │
│  └─────────────────────────────┘    │
│                                     │
├─────────────────────────────────────┤
│                  [ביטול] [שמור שינויים] │
└─────────────────────────────────────┘
```

**Flow:**
1. Click pencil icon → `openClientDetailModal(reportId)`
2. Show modal with loading state
3. POST `{action: "get"}` → populate fields with current values
4. User edits fields, clicks "שמור שינויים"
5. Validate: name required, email required + valid format, phone optional
6. If email changed → `showConfirmDialog` with warning → on confirm → save
7. POST `{action: "update", fields: {...}}` → optimistic update `clientsData` → re-render row → toast
8. On error → revert clientsData → error toast

### C. Add Client Flow: Phone Field

**HTML change:** Add phone input between email and year in manual form.
**JS change:** `addManualClient()` reads phone value, passes `{name, email, phone}` to `performServerImport()`.
**n8n change:** Update `[API] Admin Bulk Import` workflow to accept and store `phone` field.
**Excel format:** Update format guide to show 3 columns: name, email, phone.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/index.html` | Modify | Add client detail modal markup + phone field in manual add form |
| `admin/js/script.js` | Modify | Add openClientDetailModal, saveClientDetails, update addManualClient, edit icon in name cell |
| `admin/css/style.css` | Modify | Add client-edit-link style (like client-view-link), modal form field styles |
| n8n: new workflow | Create | `[API] Admin Update Client` — get/update client details |
| n8n: Admin Bulk Import | Modify | Accept phone in client objects, pass to Airtable create |
| Airtable clients table | Manual | Add `phone` singleLineText field |

## 7. Validation Plan
* [ ] **Manual prerequisite:** Phone field exists in Airtable clients table
* [ ] **Edit icon:** Hover over client row → pencil icon appears next to name
* [ ] **Modal opens:** Click pencil → modal shows with current name + email pre-filled, phone empty (new field)
* [ ] **Name edit:** Change name → save → dashboard row shows new name, Airtable updated
* [ ] **Email edit:** Change email → confirm dialog appears → confirm → save → toast success, Airtable updated
* [ ] **Email validation:** Enter invalid email → save → error shown
* [ ] **Phone edit:** Enter phone → save → Airtable updated
* [ ] **No changes:** Open modal, change nothing, click save → no API call or just silent success
* [ ] **Cancel:** Edit fields then cancel → no changes saved
* [ ] **Add client with phone:** Manual add form shows phone field → add client → phone saved in Airtable
* [ ] **Bulk import with phone:** Excel with phone column → import → phones saved
* [ ] **CORS:** All webhook responses include correct CORS headers

## 8. Implementation Notes (Post-Code)
*To be filled during implementation.*
