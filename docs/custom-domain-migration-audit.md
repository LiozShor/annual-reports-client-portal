# Custom Domain Migration Audit

**Date:** 2026-03-12
**Current domain:** `liozshor.github.io/annual-reports-client-portal`
**Purpose:** Map all references that need updating if migrating to a custom domain

---

## Summary

| Category | Count | Criticality |
|----------|-------|-------------|
| n8n CORS headers (Respond to Webhook) | 27 nodes across 12 workflows | CRITICAL |
| Frontend JS hardcoded URLs | 2 files | HIGH |
| Email template URLs (n8n) | 2+ templates | CRITICAL |
| CSP headers in HTML | 5 files (no change needed — `connect-src` points to n8n, not GitHub) | LOW |
| Raw GitHub content fetches | 4 files | MEDIUM |
| GitHub web links (help links) | 2 files | LOW |
| Documentation/design logs | 35+ files | NONE (no prod impact) |

---

## 1. n8n CORS Headers (CRITICAL)

**27 Respond to Webhook nodes** across **12 workflows** have:
```
Access-Control-Allow-Origin: https://liozshor.github.io
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

| # | Workflow | ID |
|---|----------|----|
| 01 | Send Questionnaires | 9rGj2qWyvGWVf9jXhv7cy |
| 02 | Response Processing | QqEIWQlRs1oZzEtNxFUcQ |
| 03 | Approve & Send | cNxUgCHLPZrrqLLa |
| 04 | Document Edit Handler | y7n4qaAUiCS4R96W |
| API | Get Client Documents | Ym389Q4fso0UpEZq |
| API | Check Existing Submission | QVCYbvHetc0HybWI |
| API | Reset Submission | ZTigIbycpt0ldemO |
| API | Send Batch Status | QREwCScDZvhF9njF |
| Admin | Mark Complete | loOiiYcMqIgSRVfr |
| Admin | Dashboard | AueLKVnkdNUorWVYfGUMG |
| Admin | Auth & Verify | REInXxiZ-O6cxvldci3co |
| Inbound | Doc Processing (WF05) | cIa23K8v1PrbDJqY |

**Note:** WF[03] also includes `Authorization` in `Access-Control-Allow-Headers` (Bearer token auth).
**Anomaly:** WF[01] has one node with `Access-Control-Allow-Origin: *` instead of the scoped domain.

---

## 2. Frontend Hardcoded URLs (HIGH)

### `admin/js/script.js:4777`
```js
window.open(`https://liozshor.github.io/annual-reports-client-portal/view-documents.html?report_id=${...}`, '_blank')
```
Opens client doc list from admin panel.

### `n8n/workflow-processor-n8n.js:820`
```js
const editUrl = `https://liozshor.github.io/annual-reports-client-portal/document-manager.html?report_id=${reportId}`
```
Generates doc editor link embedded in emails.

---

## 3. Email Template URLs (CRITICAL)

In `n8n/workflow-processor-n8n.js` (embedded in n8n Code nodes):
- **Questionnaire link:** `https://liozshor.github.io/annual-reports-client-portal/?report_id=${r.id}&token=${...}`
- **WhatsApp icon:** `https://liozshor.github.io/annual-reports-client-portal/assets/images/whatsapp-icon.png`
- **Document edit link:** `https://liozshor.github.io/annual-reports-client-portal/document-manager.html?report_id=${...}`

**Warning:** Previously sent emails contain old URLs — those links will break unless the old domain redirects to the new one.

---

## 4. Raw GitHub Content Fetches (MEDIUM)

These fetch JS/JSON from `raw.githubusercontent.com` — NOT affected by a custom domain change, but listed for completeness:

| File | Fetches |
|------|---------|
| `n8n/workflow-processor-n8n.js:8` | Self-reference URL |
| `n8n/document-display-n8n.js:5` | Self-reference URL |
| `admin/questionnaire-mapping-editor.html:678-679` | `questionnaire-mapping.json`, `document-types.json` |
| `admin/document-types-viewer.html:304` | `document-types.json` |

---

## 5. CSP Headers (NO CHANGE NEEDED)

All 5 HTML files have `connect-src 'self' https://liozshor.app.n8n.cloud https://unpkg.com` — these point to n8n, not GitHub Pages. The `'self'` directive auto-adapts to whatever domain serves the page.

Files: `index.html`, `approve-confirm.html`, `document-manager.html`, `view-documents.html`, `admin/index.html`

---

## 6. GitHub Web Links (LOW)

Help links in admin tools — cosmetic, not functional:
- `admin/questionnaire-mapping-editor.html:576` → GitHub blob link
- `admin/document-types-viewer.html:242` → GitHub blob link

---

## Migration Checklist

- [ ] **DNS:** Add CNAME record pointing custom domain to `liozshor.github.io`
- [ ] **GitHub Pages:** Configure custom domain in repo settings (auto-HTTPS)
- [ ] **n8n CORS (27 nodes, 12 workflows):** Update `Access-Control-Allow-Origin` to new domain
- [ ] **Frontend JS (2 files):** Update hardcoded `liozshor.github.io` URLs
- [ ] **Email templates (n8n Code nodes):** Update all portal URLs in email generation
- [ ] **GitHub redirect:** Verify GitHub auto-redirects old domain to new (it does for custom domains)
- [ ] **Reactivate workflows:** After CORS updates, deactivate/reactivate in n8n UI to re-register webhooks
- [ ] **Test all flows:** Landing page, questionnaire, doc upload, approval, admin panel, emails
- [ ] **Old emails:** Verify old URLs in previously-sent emails still work via redirect
