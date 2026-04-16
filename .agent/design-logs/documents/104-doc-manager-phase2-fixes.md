# DL-104: Document Manager Phase 2 Bug Fixes

**Status:** Implemented
**Session:** 96 (2026-03-05)
**Scope:** `document-manager.js`, `document-manager.html`, `document-manager.css`, WF[04] `y7n4qaAUiCS4R96W`

---

## Issues Fixed

### 2.1 — Raw `<B>` tags in edit mode

**Root cause:** `doc.name` contains HTML (e.g. `<b>2025</b>`). Populating the edit input via `escapeHtml()` converted it to `&lt;b&gt;` which displayed as literal `<b>`.

**Fix:**
- Added `htmlToMarkdown(html)` — converts `<b>...</b>` → `**...**`
- Added `markdownToHtml(str)` — converts `**...**` → `<b>...</b>`
- `startNameEdit()`: populates input with `htmlToMarkdown(currentName)`, adds live `.name-preview` div showing rendered bold
- `saveNameEdit()`: converts markdown → HTML before storing in `nameChanges`, uses `innerHTML + sanitizeDocHtml()` for display
- `cancelNameEdit()`: also updated to use `innerHTML + sanitizeDocHtml()`
- CSS: `.name-preview` added to `document-manager.css`

### 2.2 — Name changes not persisting to Airtable

**Root cause 1 (n8n):** "IF Has Waives" node (`2695b5d2`) condition didn't include `$json.name_updates.length` — name-only edits fell through to the False branch.

**Fix:** Added `+ $json.name_updates.length` to IF condition.

**Root cause 2 (frontend):** `name_updates` payload was missing `old_name` field needed by email builder.

**Fix:** Added `old_name: doc?.name || ''` to each name_updates entry.

**Root cause 3 (n8n):** "Build Edit Email" node (`530d5cb5`) didn't extract or display `name_updates`.

**Fix:**
- Added `const nameUpdates = extract.name_updates || [];`
- Added name changes section: amber card `(#fef3c7, #92400e)` showing `old → new` for each rename

### 2.3 — No Approve & Send to Client button

**Added:**
- `generateApprovalToken(reportId, secret)` — deterministic murmur-hash token (same algorithm as n8n email builder)
- `approveAndSendToClient()` — confirmation dialog → opens WF[03] approve-and-send URL in new tab
- `sendEmailOnSave` default changed: `true` → `false`
- `resetForm()` updated: email toggle reset to `false` (unchecked)
- HTML: `emailToggle` — removed `checked` attribute
- HTML: `#approve-send-row` button — shown only when NO pending changes
- HTML: success view updated — shows "השינויים נשמרו בהצלחה!" + Approve & Send button
- `updateStatusOverview()`: toggles `#approve-send-row` display based on `hasChanges`

---

## Files Changed

| File | Changes |
|------|---------|
| `assets/js/document-manager.js` | htmlToMarkdown, markdownToHtml helpers; startNameEdit (markdown input + live preview); saveNameEdit (markdown→HTML, innerHTML display); cancelNameEdit (innerHTML); sendEmailOnSave=false; resetForm email toggle; old_name in payload; generateApprovalToken; approveAndSendToClient; updateStatusOverview approve-send-row toggle |
| `document-manager.html` | emailToggle: removed checked; approve-send-row button; success view updated |
| `assets/css/document-manager.css` | .name-preview style |
| n8n WF[04] `y7n4qaAUiCS4R96W` | IF Has Waives: +name_updates.length; Build Edit Email: nameUpdates extraction + amber changeCard |

---

## Validation Checklist

- [ ] Edit a doc name: input shows `**bold**` markers, live preview renders bold, save shows rendered bold in list
- [ ] Save a name-only change: Airtable `issuer_name` field updates correctly
- [ ] Office email shows "עדכוני שם מסמך" amber card with old → new name
- [ ] Name changes + waives/status changes: all persist correctly
- [ ] No pending changes → "אשר ושלח ללקוח" button visible
- [ ] Pending changes → button hidden; after save → success view shows button
- [ ] "אשר ושלח ללקוח" confirmation dialog shows client name; confirming opens URL in new tab
- [ ] Email toggle defaults to OFF on page load and after reset
- [ ] WF[03] note: button opens `/webhook/approve-and-send` — requires WF[03] active

---

## Notes

- `approveAndSendToClient()` opens WF[03] directly. WF[03] is currently inactive — button is wired but will 404 until WF[03] is activated for the target client.
- Token algorithm (`MOSHE_1710` secret, murmur-hash) is identical between frontend and n8n email builder (already in WF[04] Build Edit Email node).
