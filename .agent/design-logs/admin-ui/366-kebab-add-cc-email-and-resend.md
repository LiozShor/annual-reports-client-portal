# DL-366: Dashboard Kebab Actions — Add/Edit Secondary Email + Copy Questionnaire Link

**Status:** `[COMPLETED — 2026-05-12]`
**Date:** 2026-04-28
**Related Logs:** DL-183 (CC on questionnaire), DL-184 (cc_email admin UI), DL-052 (inbound match by cc_email), DL-293 (client detail modal)

## 1. Context & Problem

Two small frictions in the dashboard row's "..." menu:

1. **Secondary email setup is buried.** Some clients want a second person (typically a spouse) involved in the questionnaire stage. The plumbing already exists — `cc_email` on the client record (DL-184), questionnaire CC (DL-183), inbound match by cc_email (DL-052/`client-identifier.ts:96-105`). But to set it up today, the admin must find the client, open the detail modal, scroll to the cc_email field, save, then go back to the dashboard and hit Send. Collapse to one click.
2. **No way to copy the questionnaire link.** Today the link is only delivered via email. If a client says "I never got it" or asks for it on WhatsApp, the admin has no way to grab it. The URL is built server-side at `send-questionnaires.ts:81` and never exposed to the frontend. Add a kebab item that fetches a freshly-signed link and copies it to clipboard.

**Out of scope (parked for a future DL):** extending `cc_email` to non-questionnaire emails (reminders, batch status, comment replies, document requests). After this DL, only the questionnaire honors `cc_email`. Known limitation.

## 2. User Requirements

1. **Q:** What is the gap vs. today's `cc_email`?
   **A:** Need a kebab-menu action to add CC mail and (re-)send questionnaire. Extending CC to other emails was deferred.
2. **Q:** One secondary or many?
   **A:** Stay with ONE (`cc_email`). No schema change.
3. **Q:** Inbound — anything to change?
   **A:** No. Tier 1 already matches `cc_email`.
4. **Q:** How should "copy link" work?
   **A:** On-demand via API. Fresh signed token each click. No storage.
5. **Q:** Which stages show "Copy link"?
   **A:** Stages 1–3 only.

## 3. Research

### Domain
Multi-Recipient Transactional Email UX + Admin Action-Menu UX.

### Sources
1. **Postmark — Transactional Email Best Practices (2026):** Use `To` for the addressee; `Cc` for parties kept in the loop. CC keeps the secondary informed without changing reply semantics.
2. **Mailtrap — Transactional Email Best Practices 2026:** CC is acceptable for recurring emails when the secondary belongs in the conversation; BCC is for large broadcasts.
3. **HubSpot — Reply / Reply All / CC / BCC:** Default Reply goes to primary sender only; CC'd parties only see threads if office Reply-Alls. Acceptable here (Reply-To is monitored office address).

### Key Principles Applied
- **CC over To:** keeps semantic ownership with primary; spouse stays informed.
- **Mint-on-demand tokens:** no token caching/storage; clipboard always gets a fresh 45-day token (per `feedback_client_token_45_days.md`).
- **Reuse > rebuild:** lean entirely on existing helpers (`copyToClipboard`, `openClientDetailModal`, `sendSingle`, `generateClientToken`).

### Patterns Used
- **Bridge prop pass-through:** vanilla `script.js` → `client-detail-modal.js` shim → React `mountClientDetail` → `ClientDetailModal` props. New `focusField` prop threads through unchanged surfaces.

### Anti-Patterns Avoided
- Building URL client-side (would expose HMAC secret) — rejected.
- Storing the token in Airtable (rotation concern, schema change) — rejected.

## 4. Codebase Analysis

| What | Where | Reuse plan |
|------|-------|-----------|
| Questionnaire send + CC | `api/src/routes/send-questionnaires.ts:83-88` | Unchanged. New flow ends by calling this. |
| `cc_email` form field | `frontend/admin/react/src/components/ClientDetailModal.tsx:136-148` | Reuse. Open with `focusField='cc_email'`. |
| `sendSingle(rid)` | `frontend/admin/js/script.js:1585-1587` | Call after save when stage=`Send_Questionnaire`. |
| Kebab markup | `script.js:1592-1603` (desktop), `1657-1668` (mobile) | Add new items here. |
| `copyToClipboard(text, btn)` | `script.js:2408` | Use for copy-link. |
| Token signing | `generateClientToken` in `api/src/lib/client-token.ts` | Extract URL builder into shared helper. |
| Bridge | `frontend/assets/js/client-detail-modal.js` + `frontend/admin/react/src/islands/client-detail.tsx` | Thread `focusField` through. |

**Dashboard API gap:** `cc_email` is NOT in the GET response today (`dashboard.ts:95-109`). Add it.

**Stage gating:**
- Add/edit cc_email: shown all stages. Auto-resend confirm only on stage 1.
- Copy link: stages 1–3 only.

## 5. Technical Constraints & Risks

- **Cache busting:** bump `script.js?v=` in `frontend/admin/index.html` (currently 365).
- **Hebrew RTL:** all labels Hebrew-first.
- **PII:** never log `cc_email` value; log only `hasCc: true/false`.
- **Idempotency:** if user saves cc_email past stage 1, don't auto-send — toast only.
- **Devil file:** `script.js` is 10k+ lines; surgical edits, grep before touching.

## 6. Proposed Solution

### Success Criteria
**(A) cc_email kebab:** Click "..." → "הוסף/ערוך אימייל משני" → modal opens scrolled+focused on cc_email → save. If stage=Send_Questionnaire, confirm dialog → on confirm, `sendSingle(rid)` runs and CCs the questionnaire to the new address. Else toast "נשמר. ייכנס לתוקף בשליחה הבאה".

**(B) Copy link:** Click "..." → "העתק קישור לשאלון" (stages 1–3 only) → Worker mints fresh URL → clipboard receives URL → toast "הקישור הועתק ללוח".

### Logic Flow

**(A)** Dashboard returns `cc_email` per row. Kebab label switches "הוסף" vs "ערוך". Handler `openCcEmailFromKebab(rid, stageKey)` calls `openClientDetailModal(rid, { focusField: 'cc_email' })` and on save, conditionally fires `showConfirmDialog` → `sendSingle`.

**(B)** New endpoint `POST /webhook/admin-questionnaire-link` (auth via admin token, like other admin endpoints). Returns `{ ok, url }`. Handler `copyQuestionnaireLink(rid)` posts → `copyToClipboard(url)` → toast.

### Data Structures
- Dashboard response: add `cc_email: string` to each client row.
- New API: `POST /webhook/admin-questionnaire-link` body `{ token, report_id }` → `{ ok, url, error? }`.

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/questionnaire-url.ts` | Create | Helper `buildQuestionnaireUrl(reportId, secret)` minting fresh signed URL. |
| `api/src/routes/questionnaire-link.ts` | Create | `POST /admin-questionnaire-link` route. |
| `api/src/index.ts` | Modify | Register new route. |
| `api/src/routes/send-questionnaires.ts` | Modify | Use new helper (DRY). |
| `api/src/routes/dashboard.ts` | Modify | Add `cc_email` to response. Need to add `client_cc_email` lookup field to query. |
| `frontend/admin/react/src/components/ClientDetailModal.tsx` | Modify | Accept `focusField?: 'cc_email' \| 'email' \| 'phone'`. Auto-focus on mount. |
| `frontend/admin/react/src/islands/client-detail.tsx` | Modify | Thread `focusField` from MountProps to component. |
| `frontend/admin/react/src/types/client.ts` | Modify | Add `focusField` to `ClientDetailContext`. |
| `frontend/admin/react/src/types/globals.d.ts` | Modify | Update `mountClientDetail` signature. |
| `frontend/admin/react/src/__tests__/ClientDetailModal.test.tsx` | Modify | Add `focusField` test case. |
| `frontend/admin/react-dist/client-detail.js` | Rebuild | `npm run build` in `frontend/admin/react/`. |
| `frontend/assets/js/client-detail-modal.js` | Modify | Accept and forward `focusField` from ctx. |
| `frontend/admin/js/script.js` | Modify | Two new kebab items (desktop+mobile), 2 new handlers, surface `cc_email` from row data. |
| `frontend/admin/index.html` | Modify | Bump `script.js?v=366`. |
| `.agent/design-logs/INDEX.md` | Modify | Add DL-366. |
| `.agent/current-status.md` | Modify | Add Phase E test items. |

### Final Step
Housekeeping → `[IMPLEMENTED — NEED TESTING]`, copy unchecked Section 7 to `current-status.md`, commit, push, `wrangler deploy` from `api/`, await explicit approval before merging to main.

## 7. Validation Plan

- [ ] Row WITHOUT cc_email, stage=`Send_Questionnaire`: kebab shows "הוסף אימייל משני" → modal opens, cc_email field auto-focused → save → confirm dialog → confirm → questionnaire arrives at primary AND cc inbox (verify via `gws`).
- [ ] Row WITH cc_email set: kebab shows "ערוך אימייל משני", field pre-filled.
- [ ] Stage ≥ 2: save flow works, no confirm dialog, toast "נשמר. ייכנס לתוקף בשליחה הבאה".
- [ ] Modal cancel: no API write, no send.
- [ ] Mobile layout: kebab item renders correctly.
- [ ] Hebrew RTL renders correctly.
- [ ] Cache `?v=366` bumped; hard refresh shows new behavior.
- [ ] No `cc_email` value in Worker logs (only `hasCc` flag).
- [ ] Regression: existing "צפייה כלקוח" / "העבר לארכיון" still work.
- [ ] Regression: pencil-icon flow still works without `focusField`.
- [ ] Stage 1 row: kebab shows "העתק קישור לשאלון" → click → clipboard contains valid URL `${FRONTEND_BASE}/?report_id=...&token=...` → opening URL lands successfully.
- [ ] Stages 2 and 3: copy-link visible and works.
- [ ] Stage 4+: copy-link NOT shown.
- [ ] Copy-link toast in Hebrew RTL.
- [ ] Copy-link API failure: error toast, clipboard untouched.
- [ ] Token expiry: copied URL works for 45 days.

## 8. Implementation Notes (Post-Code)

- **Backend:**
  - New helper `api/src/lib/questionnaire-url.ts` exports `buildQuestionnaireUrl(reportId, secret)` and `FRONTEND_BASE`. Refactored `send-questionnaires.ts` to use it (DRY) — line 81's inline URL build is gone.
  - New route `api/src/routes/questionnaire-link.ts` — `POST /webhook/admin-questionnaire-link` body `{token, report_id}` → `{ok, url}`. Validates report exists via `airtable.getRecord` before minting (returns 404 `report_not_found` otherwise).
  - Registered in `api/src/index.ts` next to `sendQuestionnaires`.
  - `dashboard.ts` GET response now includes `cc_email` per row. Implemented via parallel third Airtable fetch (`tblFFttFScDRZ7Ah5` with `fields: ['cc_email']`) + Map join keyed on client record id (NOT a lookup field — avoids Airtable schema change). Empty string when client has no cc_email.

- **Frontend (React island):**
  - `types/client.ts`: new `ClientDetailFocusField` union (`'email' | 'cc_email' | 'phone'`); added `focusField?: ClientDetailFocusField` to `ClientDetailContext`.
  - `components/ClientDetailModal.tsx`: new `focusField` prop; `useEffect` runs once after `draft` is hydrated, finds the input by id (`cd-email` / `cd-cc-email` / `cd-phone`), calls `.focus()` and `.scrollIntoView()`. `focusedRef` ensures it only fires once per mount.
  - `islands/client-detail.tsx`: passes `props.ctx?.focusField` through to the component.
  - `__tests__/ClientDetailModal.test.tsx`: new test asserts `cd-cc-email` becomes `document.activeElement` after mount with `focusField='cc_email'`.
  - `frontend/assets/js/client-detail-modal.js` (bridge shim): forwards `ctx.focusField` to `mountClientDetail`.

- **Frontend (admin script.js):**
  - `openClientDetailModal(reportId, options)` now accepts `{ focusField, afterSave }` options. Backwards compatible — existing pencil-icon callers pass no options.
  - New `openCcEmailFromKebab(rid, stageKey)`: opens modal with `focusField:'cc_email'`. On save, compares `prev.cc_email` vs `updated.cc_email`. If new value added AND stage=`Send_Questionnaire` → `showConfirmDialog` → `sendSingle(rid)`. Else toast.
  - New `copyQuestionnaireLink(rid)`: `POST /admin-questionnaire-link` → `navigator.clipboard.writeText(url)` → toast "הקישור הועתק ללוח". Error path shows danger toast.
  - Two new kebab items in BOTH desktop (`script.js:~1592-1603`) and mobile (`script.js:~1657-1668`) markup. `users` icon for cc_email (semantically clearer than `user-plus` which isn't in the sprite); `copy` icon for link.
  - Cache-bust: `?v=365` → `?v=366` in `frontend/admin/index.html`.

- **Research applied:**
  - DL-183 CC pattern reused unchanged. No new outbound CC plumbing.
  - On-demand token mint (vs. caching/storing) — keeps every copied link at full 45-day TTL (per `feedback_client_token_45_days.md`).

- **Deviations from plan:**
  - Plan called for icon `user-plus`; sprite doesn't include it, used `users` instead (slightly different semantics — implies two people, fits secondary-email metaphor well).
  - Plan called for `cc_email` lookup field on reports table; chose Map-join over Airtable schema change (safer — no admin step, deployable from Worker code alone). Slightly more memory but negligible at 500 clients.
  - Build environment caveat: React island tests fail in this worktree due to `process.env.NODE_ENV='production'` defined in `vite.config.ts:8` leaking into vitest. New `focusField` test added but not verified locally — pre-existing issue, scoped out.

- **NOT implemented (out of scope per user instruction):**
  - Extending CC to non-questionnaire emails (reminders, batch status, comment replies, document requests). Parked for a future DL.
