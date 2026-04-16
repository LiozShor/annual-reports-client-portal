# Design Log 228: Smart Add Second Filing Type (Auto-Detect & Pre-Fill)
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-30
**Related Logs:** DL-219 (add second filing type backend), DL-226 (dual-filing classification), DL-225 (CS hardcoded AR remediation)

## 1. Context & Problem
The backend already supports adding a second filing type for existing clients (DL-219). However, the UX for this is poor:
- Admin must manually re-type name and CC email for clients who already exist
- No indication that a client already has the other filing type
- No quick shortcut from the client table to add the missing filing type

**Two UX improvements requested:**
1. **Add-form auto-detect:** When typing an email in the manual-add form, detect existing client on blur and offer to pre-fill details + auto-switch filing type
2. **Table "..." menu shortcut:** Add "הוסף הצהרת הון" / "הוסף דוח שנתי" button in the row action menu when the client only has one filing type

## 2. User Requirements
1. **Q:** When should the auto-detect trigger?
   **A:** On email blur — after admin tabs/clicks out of email field

2. **Q:** How should the pre-fill suggestion appear?
   **A:** Inline banner below email field with client details + "Fill details" button

3. **Q:** Should filing type auto-switch to the OTHER type?
   **A:** Yes — if client has AR, auto-switch dropdown to CS (and vice versa)

4. **Q:** Should this also work in bulk import?
   **A:** No — manual add only. Bulk import already handles client reuse silently.

5. **Q:** (User-initiated) Add "Add CS/AR" in table "..." menu?
   **A:** Yes — show the option only when the client doesn't already have the other filing type for the selected year.

## 3. Research
### Domain
Form auto-detection UX, progressive disclosure, smart defaults

### Sources Consulted
1. **Nielsen Norman Group — Inline Validation in Forms** — Inline feedback on blur (not while typing). Success states should be visually distinct but non-disruptive. Suggestion banners must be dismissable.
2. **Baymard Institute — Auto-Detecting Form Fields** — Auto-fill silently when confidence >95%. Apply visual affordance (light tint) to auto-filled fields. Detected fields should always be editable.
3. **GOV.UK Design System — Confirming Information Pattern** — Blue notification banner below triggering field, persists until acted upon. Use `role="status"` / `aria-live="polite"` for screen readers.
4. **Luke Wroblewski — Web Form Design (Rosenfeld Media)** — Two-path fork: "Use existing" vs "Enter new". Never leave user wondering if system or user filled the field.
5. **Material Design — Text Fields Assistive Elements** — Supporting text pattern for contextual info below fields. Smooth animation (150-300ms) for dynamic DOM changes.

### Key Principles Extracted
- **Blur trigger, never while typing** — avoids premature detection that interrupts flow
- **Inline banner > modal** — stays in form context, doesn't steal focus
- **Visual distinction for pre-filled fields** — light background tint so user knows what was auto-filled
- **Dismissable** — user can always ignore the suggestion and continue manually
- **Attribution** — tell user where data came from ("from existing AR report")
- **Smooth animation** — prevent layout shift on banner inject/dismiss

### Anti-Patterns to Avoid
- **Auto-filling without any visual cue** — user won't know what changed
- **Modal for simple match** — overkill, breaks flow
- **Non-dismissable suggestions** — feels forced

### Research Verdict
Inline banner on email blur + auto-fill on click + visual tint on filled fields. The "..." menu shortcut is a complementary path that skips the form entirely by pre-populating all fields and auto-submitting (or scrolling to the form pre-filled).

## 4. Codebase Analysis
### Existing Solutions Found
- **Duplicate detection already works** (`script.js:1648-1654`) — checks `clientsData.some(c => c.email === email && c.filing_type === filingType)`, so it already allows different filing types
- **`clientsData` contains ALL clients** (both AR and CS) loaded on dashboard init — can cross-reference across filing types client-side with no API call needed
- **Backend reuse path** (`import.ts:72-77`) — already creates only a report when client exists with different filing type
- **Row menus** exist in both desktop (`script.js:679-689`) and mobile cards (`script.js:740-751`), plus right-click context menu (`script.js:5542-5589`)

### Reuse Decision
- Reuse `clientsData` for cross-filing-type lookup — no new API needed
- Reuse `_doManualAdd()` for the actual creation — it already handles the import call + success toast
- Reuse existing `.row-menu` button styling for the new menu item
- Reuse `showAIToast` for success feedback

### Relevant Files
| File | Purpose |
|------|---------|
| `admin/js/script.js` | `addManualClient()` (line 1632), row menu render (lines 679-689, 740-751), context menu (5542-5574) |
| `admin/index.html` | Manual-add form (lines 290-318) |
| `admin/css/style.css` | Row menu styles, toast styles |
| `api/src/routes/import.ts` | Backend — no changes needed (already supports reuse) |
| `assets/js/document-manager.js` | Filing tabs (line 385), `allReports` state, `CLIENT_NAME`/`CLIENT_ID`/`YEAR` globals |
| `document-manager.html` | Filing tabs container (line 103), client bar |
| `assets/css/document-manager.css` | Doc manager styling |
| `api/src/routes/client-reports.ts` | Returns reports for client — needs `email`/`cc_email` addition for office mode |

### Alignment with Research
- Current form has no inline feedback pattern yet — need to add banner component
- Existing toast pattern (`showAIToast`) works for post-action confirmation
- No smooth animation for DOM injection exists — need to add CSS transition

## 5. Technical Constraints & Risks
* **Security:** No new auth concerns — all data already available in `clientsData` (loaded on dashboard init)
* **Risks:** Must not pre-fill from deactivated clients (check `is_active`)
* **Breaking Changes:** None — additive UX, existing flow unchanged
* **Edge case:** Client might have BOTH types already — no banner, no menu item

## 6. Proposed Solution (The Blueprint)

### Success Criteria
When admin types an email of an existing AR client, a banner appears offering to add CS (pre-filling name/cc_email/auto-switching type). Also, each client row's "..." menu shows "Add CS/AR" when the other type is missing.

### Feature A: Email Blur Auto-Detect + Pre-Fill Banner

#### Logic Flow
1. On `#manualEmail` blur event:
   - Get entered email (lowercase, trimmed)
   - Search `clientsData` for any active client with matching email
   - If found, determine which filing types exist for this email
   - If the client has one type but NOT both → show inline banner
   - If client has both types or no match → hide banner (if visible)
2. Banner shows: client name, existing filing type + stage, CC email
3. Banner has two buttons:
   - **"מלא פרטים ← [other type]"** — fills name, cc_email, switches filing type dropdown, dismisses banner. Add light tint to filled fields.
   - **"סגור ✕"** — dismisses banner, no action
4. On form submit, existing duplicate check still works as safety net
5. On form clear (after successful add), remove banner and field tints

#### HTML Changes (`admin/index.html`)
- Add a `<div id="existingClientBanner">` below the email field (hidden by default)

#### JS Changes (`admin/js/script.js`)
- Add `onEmailBlur()` function — lookup + banner render
- Add `fillFromExisting(email)` function — pre-fill fields + dismiss banner
- Add `dismissExistingBanner()` — hide banner
- Attach blur listener to `#manualEmail`
- Clear banner in `_doManualAdd` success path (already clears form fields)

#### CSS Changes (`admin/css/style.css`)
- `.existing-client-banner` — info-blue bg, rounded, padded, with slide-down animation
- `.field-prefilled` — light yellow/cream tint on auto-filled inputs
- Transition for banner show/hide (max-height + opacity, 200ms ease)

### Feature B: Table "..." Menu — "Add Other Filing Type"

#### Logic Flow
1. When rendering row menus (desktop table, mobile cards, context menu):
   - For each client, check if the OTHER filing type exists for same email + year
   - If NOT → show "הוסף הצהרת הון" or "הוסף דוח שנתי" button
   - If already has both → don't show the button
2. On click: call `addSecondFilingType(reportId)` which:
   - Looks up client data from `clientsData`
   - Determines the missing filing type
   - Calls `_doManualAdd(name, email, cc_email, year, otherType)` directly
   - Shows success toast with "שלח שאלון" action

#### Helper Function
```
function getClientOtherFilingType(email, year) {
  // Returns the missing filing type, or null if both exist
  const clientReports = clientsData.filter(c =>
    c.email?.toLowerCase() === email.toLowerCase() && String(c.year) === String(year)
  );
  const types = new Set(clientReports.map(c => c.filing_type || 'annual_report'));
  if (types.has('annual_report') && !types.has('capital_statement')) return 'capital_statement';
  if (types.has('capital_statement') && !types.has('annual_report')) return 'annual_report';
  return null; // both exist or neither (shouldn't happen)
}
```

#### Row Menu Changes (3 places)
1. **Desktop table** (line ~681): Add button before archive/deactivate
2. **Mobile card** (line ~742): Same
3. **Right-click context menu** (line ~5557): Add before `<hr>` separator

#### Filing Type Label Helper
```
const FILING_TYPE_LABELS = {
  annual_report: 'דוח שנתי',
  capital_statement: 'הצהרת הון'
};
```

### Feature C: Document Manager — "Add Other Filing Type" Button

#### Logic Flow
1. On `loadClientReports()` response (or `loadDocuments()`), check `allReports`:
   - If only ONE filing type → show "הוסף [other type]" button next to filing tabs area
   - If both types or zero → hide button
2. Button appears as a subtle action next to the filing tabs (or in the client bar area if no tabs)
3. On click → confirmation dialog → call import endpoint → reload page

#### Data Needed
- `client_email` and `cc_email` — not currently in doc manager state
- **API change:** Add `client_email` and `cc_email` to `client-reports` response (office mode only)
- In `client-reports.ts`: fetch client record by `clientId`, extract email/cc_email, include in response
- Store in doc manager globals: `CLIENT_EMAIL`, `CLIENT_CC_EMAIL`

#### Implementation
- Add `addOtherFilingType()` function to `document-manager.js`:
  - Determine missing type from `allReports`
  - Show confirmation: "להוסף [type] ללקוח [name]?"
  - Call import endpoint with `{ clients: [{name, email, cc_email}], year, filing_type }`
  - On success: reload page to show both tabs
- Render button in `renderFilingTabs()` or a new `renderAddFilingTypeBtn()` called after `loadClientReports()`

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `admin/index.html` | Modify | Add `#existingClientBanner` div below email field |
| `admin/js/script.js` | Modify | Add blur handler, banner logic, fill function, menu items, helper functions |
| `admin/css/style.css` | Modify | Banner styles, prefilled field tint, animation |
| `api/src/routes/client-reports.ts` | Modify | Add `client_email` + `cc_email` to office-mode response |
| `document-manager.html` | Modify | Add `#addOtherTypeBtn` placeholder near filing tabs |
| `assets/js/document-manager.js` | Modify | Store email/cc_email, add button render + click handler |
| `assets/css/document-manager.css` | Modify | Style for "add other type" button |

### Final Step
- Housekeeping: Update design log status, INDEX, current-status

## 7. Validation Plan
* [ ] Email blur: Type email of existing AR client → banner appears with correct details
* [ ] Email blur: Type email of client with BOTH types → no banner
* [ ] Email blur: Type new email → no banner
* [ ] Email blur: Type email of deactivated client → no banner (only active clients)
* [ ] Banner "Fill" button: Name, CC email, filing type all populated correctly
* [ ] Banner "Fill" button: Fields get visual tint indicating pre-fill
* [ ] Banner "Close" button: Banner dismissed, form fields unchanged
* [ ] Form submit after pre-fill: Report created successfully, linked to existing client
* [ ] Form clear after submit: Banner and field tints removed
* [ ] Desktop "..." menu: "הוסף הצהרת הון" shows for AR-only clients
* [ ] Desktop "..." menu: Button hidden when client has both types
* [ ] Mobile card "..." menu: Same button available
* [ ] Right-click context menu: Same button available
* [ ] Menu button click: Creates report, shows success toast with "שלח שאלון"
* [ ] Doc manager: Single-type client shows "הוסף [other type]" button
* [ ] Doc manager: Dual-type client does NOT show the button
* [ ] Doc manager: Click button → confirmation → report created → page reloads with both tabs
* [ ] Doc manager: `client_email`/`cc_email` returned correctly in API (office mode only, not client mode)
* [ ] No regression: Adding brand new client still works normally
* [ ] No regression: Existing duplicate detection (same type) still blocks

## 8. Implementation Notes (Post-Code)
* Helpers (`FILING_TYPE_LABELS`, `getClientOtherFilingType`) added to `script.js` globals — reused across all 3 features (banner, row menu, doc manager)
* Email blur banner uses CSS `max-height` transition for smooth show/hide animation
* Pre-filled fields get `.field-prefilled` class (yellow tint `#fefce8`) — removed on form clear
* Row menu button added in all 3 locations: desktop table, mobile card, right-click context menu
* API change: `client-reports.ts` fetches client record in parallel with reports query (no extra latency) — returns `client_email`/`cc_email` only in office mode
* Doc manager `addOtherFilingType()` calls existing `ENDPOINTS.ADMIN_BULK_IMPORT` → reloads page after 800ms to show both filing tabs
* Backward-compat path (`discoverSiblingReports` via `report_id`) gracefully hides the button since `CLIENT_EMAIL` won't be available
* **Tab linking (user feedback):** `viewClientDocs()` now passes `&tab=<filing_type>` matching the client's filing type / active entity tab. Doc manager reads `params.get('tab')` and selects matching report as active tab on load.
