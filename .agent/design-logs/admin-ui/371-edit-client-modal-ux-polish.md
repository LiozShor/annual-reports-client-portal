# DL-371: Edit-Client Modal — UX/UI Redesign

**Status:** [IMPLEMENTED — NEED TESTING]
**Branch:** `DL-371-edit-client-modal-ux-polish`
**Date:** 2026-04-28

---

## Problem

The "edit client details" modal had several UX issues:
1. Phone/email inputs narrower than text inputs — CSS only targeted `input[type="text"]`, missing `type="email"` and `type="tel"`.
2. Header showed raw `clientName` with no action context — broken for names like `[צוות] - לאון`.
3. Tight spacing, no header border-bottom in React version.
4. Save button was washed-out lavender.
5. Name field not exposed despite API supporting it.

---

## Solution

Full React component redesign in `ClientDetailModal.tsx`. Ships to both admin dashboard and document-manager via the same IIFE bundle.

### Files changed

| File | Change |
|------|--------|
| `frontend/admin/react/src/components/ClientDetailModal.tsx` | New header (`עריכת לקוח: {name}`), name field added as first input, inline SVG icons in labels, `<form onSubmit>` for Enter-to-save, RTL button order (Save left = primary in RTL) |
| `frontend/admin/react/src/types/client.ts` | `name?: string` added to `ClientUpdatePayload`; `name` added to `ClientDetailFocusField` |
| `frontend/admin/react/src/hooks/useClient.ts` | Optimistic cache write maps `payload.name` → `clientName` |
| `frontend/admin/react/src/__tests__/ClientDetailModal.test.tsx` | Updated 4 existing tests for new title format; added name-edit test (5 total, all pass) |
| `frontend/admin/css/style.css` | Updated `.ai-modal-header/body/footer`, added `.client-detail-field-icon`, force `width:100%` on `.ai-modal-body .form-input` for all input types |
| `frontend/assets/css/document-manager.css` | Mirrored same redesign CSS + added `.ai-modal-header/title/body/footer` React classes (were missing entirely) |
| `frontend/admin/index.html` | `style.css?v=319→320`, `client-detail.js?v=370→371` |
| `frontend/document-manager.html` | `document-manager.css` gets `?v=1`, `client-detail-modal.js?v=370→371`, `admin/react-dist/client-detail.js` gets `?v=371` |
| `frontend/admin/react/vitest.config.ts` | Override `NODE_ENV=test` to prevent prod React build in tests |
| `frontend/admin/react/vitest.setup.ts` | Stub `HTMLElement.prototype.scrollIntoView` for jsdom |
| `frontend/admin/react-dist/client-detail.js` | Rebuilt (189.98 kB) |

---

## Section 7 — Validation Checklist

- [ ] **Visual — admin dashboard:** Pencil on any row → modal shows `עריכת לקוח: {name}`, 4 uniform-width inputs (name/email/cc_email/phone), icons in labels, indigo Save on right (RTL).
- [ ] **Visual — doc-manager:** Same modal renders identically from doc-manager pencil.
- [ ] **Phone field width:** Inspect element — `width: 100%` applied; phone matches email width pixel-for-pixel.
- [ ] **Title format:** `[צוות] - לאון` renders as `עריכת לקוח: [צוות] - לאון` — no naked bracket.
- [ ] **Name edit:** Type new name → Save enables → click Save → toast → dashboard row name updates without reload → reopen modal → persisted.
- [ ] **Name edit from doc-manager:** Save name → `#clientName` in client bar updates immediately.
- [ ] **CC email placeholder:** Empty cc_email shows `הוסף אימייל נוסף (לבן/בת זוג, יקבל עותק)`.
- [ ] **Dirty check:** Edit any field → click X → `showConfirmDialog` fires.
- [ ] **No regression:** Email-only and phone-only edits still work; only changed fields in mutation payload.
- [ ] **DL-366 auto-focus:** Opening with `focusField: 'cc_email'` still focuses cc_email input.
- [ ] **Vitest:** 5/5 pass ✅ (verified 2026-04-28).
- [ ] **Typecheck:** `tsc --noEmit` clean ✅ (verified 2026-04-28).
- [ ] **Build:** `npm run build` clean, 189.98 kB ✅ (verified 2026-04-28).
