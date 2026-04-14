# Plan: DL-107 — Document Manager Email + Phone (Inline Edit)

## Context
DL-106 added client detail editing (name/email/phone) to the admin dashboard via a modal. Now the user wants the same fields visible and editable directly in the document-manager page (`document-manager.html`), using **inline editing** (click value → input → save on Enter/blur).

## Prerequisites (Manual — user must do before implementation)
- [ ] Add `client_email` lookup field on `tbls7m3hmHC4hhQVy` (annual_reports) → looks up `email` from linked `client` field
- [ ] Add `client_phone` lookup field on `tbls7m3hmHC4hhQVy` (annual_reports) → looks up `phone` from linked `client` field

## Implementation Steps

### Step 1: n8n — Update Build Response in `[API] Get Client Documents`
- **Workflow:** `Ym389Q4fso0UpEZq`, **Node:** `Build Response` (ID: `4aca5e5a-3d8c-4b5c-baf2-4f279e14e5b6`)
- In the office mode response (line 215-230 of Build Response code), add:
  ```js
  client_email: String(Array.isArray(report.client_email) ? report.client_email[0] : report.client_email || ''),
  client_phone: String(Array.isArray(report.client_phone) ? report.client_phone[0] : report.client_phone || ''),
  ```
- No changes needed for client mode (PII should NOT be exposed to client-facing view)

### Step 2: HTML — Add email + phone to client bar
- **File:** `github/annual-reports-client-portal/document-manager.html` (lines 68-86)
- Add 2 new `.client-bar-item` elements after year (line 83), before sentBadge (line 85):
  ```html
  <div class="client-bar-item">
      <i data-lucide="mail" class="icon-sm"></i>
      <span class="text-muted text-sm">אימייל:</span>
      <strong id="clientEmail" class="editable-field" title="לחץ לעריכה">-</strong>
  </div>
  <div class="client-bar-item">
      <i data-lucide="phone" class="icon-sm"></i>
      <span class="text-muted text-sm">טלפון:</span>
      <strong id="clientPhone" class="editable-field" title="לחץ לעריכה">-</strong>
  </div>
  ```

### Step 3: CSS — Inline edit styling
- **File:** `github/annual-reports-client-portal/assets/css/document-manager.css`
- Add after `.client-bar-item` rule (~line 56):
  ```css
  .editable-field {
      cursor: pointer;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      transition: border-color var(--transition-fast), background var(--transition-fast);
  }
  .editable-field:hover {
      border-color: var(--gray-300);
      background: var(--white);
  }
  .editable-field.editing {
      border-color: var(--brand-500);
      background: var(--white);
      outline: none;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
      min-width: 120px;
  }
  ```

### Step 4: JS — Populate fields + inline edit logic
- **File:** `github/annual-reports-client-portal/assets/js/document-manager.js`

**4a: Add global vars** (after line 13):
```js
let CLIENT_EMAIL = '';
let CLIENT_PHONE = '';
```

**4b: Populate in loadDocuments** (after spouse_name population, ~line 180):
```js
if (data.client_email !== undefined) {
    CLIENT_EMAIL = data.client_email;
    const emailEl = document.getElementById('clientEmail');
    if (emailEl) emailEl.textContent = CLIENT_EMAIL || '-';
}
if (data.client_phone !== undefined) {
    CLIENT_PHONE = data.client_phone;
    const phoneEl = document.getElementById('clientPhone');
    if (phoneEl) phoneEl.textContent = CLIENT_PHONE || '-';
}
```

**4c: Inline edit function** (add near end of file, before or after `updateSentBadge`):
```js
function initInlineEditing() {
    document.querySelectorAll('.editable-field').forEach(el => {
        el.addEventListener('click', startInlineEdit);
    });
}

function startInlineEdit(e) {
    const el = e.currentTarget;
    if (el.classList.contains('editing')) return;

    const fieldId = el.id; // clientEmail or clientPhone
    const currentValue = fieldId === 'clientEmail' ? CLIENT_EMAIL : CLIENT_PHONE;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
    input.className = 'editable-field editing';
    input.style.fontSize = 'inherit';
    input.style.fontWeight = 'inherit';
    input.dir = 'ltr';

    const save = async () => {
        const newValue = input.value.trim();
        if (newValue === currentValue) {
            // No change — revert
            revertInlineEdit(el, fieldId);
            return;
        }

        // Validate email
        if (fieldId === 'clientEmail' && newValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newValue)) {
            showToast('כתובת אימייל לא תקינה', 'error');
            input.focus();
            return;
        }

        try {
            const body = {
                token: ADMIN_TOKEN,
                report_id: REPORT_ID,
                action: 'update'
            };
            if (fieldId === 'clientEmail') body.email = newValue;
            if (fieldId === 'clientPhone') body.phone = newValue;
            // Always send current name to avoid clobbering
            body.name = CLIENT_NAME;
            if (fieldId === 'clientEmail') body.phone = CLIENT_PHONE;
            if (fieldId === 'clientPhone') body.email = CLIENT_EMAIL;

            const resp = await fetch(`${API_BASE}/admin-update-client`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await resp.json();
            if (!data.ok) throw new Error(data.error || 'Update failed');

            // Update global state
            if (fieldId === 'clientEmail') CLIENT_EMAIL = newValue;
            if (fieldId === 'clientPhone') CLIENT_PHONE = newValue;

            revertInlineEdit(el, fieldId);
            showToast('עודכן בהצלחה', 'success');
        } catch (err) {
            showToast('שגיאה בעדכון: ' + err.message, 'error');
            input.focus();
        }
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { revertInlineEdit(el, fieldId); }
    });
    input.addEventListener('blur', () => {
        // Small delay so click events on other elements can fire
        setTimeout(() => { if (document.activeElement !== input) save(); }, 150);
    });

    el.replaceWith(input);
    input.focus();
    input.select();
}

function revertInlineEdit(originalEl, fieldId) {
    const value = fieldId === 'clientEmail' ? CLIENT_EMAIL : CLIENT_PHONE;
    const strong = document.createElement('strong');
    strong.id = fieldId;
    strong.className = 'editable-field';
    strong.title = 'לחץ לעריכה';
    strong.textContent = value || '-';
    strong.addEventListener('click', startInlineEdit);

    // Find the input currently in the DOM
    const input = document.getElementById(fieldId) || document.querySelector(`input.editing`);
    if (input) input.replaceWith(strong);
}
```

**4d: Call `initInlineEditing()`** — add to the end of `loadDocuments()` success path, after `initIcons()`.

## Key Files
| File | Action |
|------|--------|
| `github/.../document-manager.html` | Add 2 client-bar items |
| `github/.../assets/css/document-manager.css` | Add `.editable-field` styles |
| `github/.../assets/js/document-manager.js` | Add globals, populate, inline edit logic |
| n8n `[API] Get Client Documents` Build Response | Add `client_email`, `client_phone` to office response |

## CORS Note
The `admin-update-client` webhook was just created via API — CORS may fail (see DL-106 CORS fix). If still failing by implementation time, the user needs to deactivate/reactivate the workflow in n8n UI first. The document-manager uses the same origin (`liozshor.github.io`) and `fetch()` pattern.

## Verification
1. Add `client_email` and `client_phone` lookup fields to Airtable reports table
2. Test n8n: curl GET mode=office → response includes `client_email`, `client_phone`
3. Open document-manager → client bar shows email + phone values
4. Click email → inline input appears → type new value → Enter → saves + toast
5. Click phone → same behavior
6. Press Escape → reverts without saving
7. Enter invalid email → validation toast, input stays open
