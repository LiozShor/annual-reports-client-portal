# DL-424: Approve & Send "send again" silently dedup'd — admin UI missing `force=1`

**Status:** [IMPLEMENTED — NEED TESTING]
**Created:** 2026-05-18
**Implemented:** 2026-05-18
**Branch:** claude-session-20260518-102636
**Domain:** email

## 1. Context & Problem

User clicked "שלח שוב" (send again) in the doc-manager confirm dialog. Browser console:

```
[approve-and-send] fetching: https://annual-reports-api.liozshor1.workers.dev/webhook/approve-and-send?report_id=recXXXXXXXXXXXXXX&confirm=1&respond=json
[approve-and-send] status: 200 redirected: false
[approve-and-send] response: {ok: true, deduped: true, stage: 'Collecting_Docs'}
```

No email was sent. UI showed success because `data.ok === true`.

This is the admin-side counterpart to DL-354 (`email/354-approve-and-send-idempotency.md`). DL-354 added two idempotency layers to `api/src/routes/approve-and-send.ts:131-149` with `?force=1` reserved as the intentional admin-resend bypass. None of the three admin "send again" UI paths ever plumbed `force=1` through — every intentional resend has been silently dedup'd since 2026-04-27.

## 2. Root Cause

`api/src/routes/approve-and-send.ts:135` — Layer 1 returns `{ok:true, deduped:true}` whenever `docs_first_sent_at` is set unless `?force=1` is in the query.

Three admin call sites built the URL with only `confirm=1&respond=json` and never appended `&force=1`, even though their own confirm dialog already showed "נשלח ב-{date}. לשלוח שוב?" with the button labeled "שלח שוב":

| # | File | Line | UI surface |
|---|---|---|---|
| 1 | `frontend/assets/js/document-manager.js` | 2837 | Doc-manager "אשר ושלח" button |
| 2 | `frontend/admin/js/script.js` | 12027 | Pending-Approval queue card |
| 3 | `frontend/admin/js/script.js` | 12095 | AI-review "all reviewed" prompt |

All three already computed a `sentDate` variable for the dialog message + button label.

## 3. Fix

One-character-class change per call site: append `${sentDate ? '&force=1' : ''}` to the existing URL template literal.

```js
// before
`${ENDPOINTS.APPROVE_AND_SEND}?report_id=${REPORT_ID}&confirm=1&respond=json`

// after
`${ENDPOINTS.APPROVE_AND_SEND}?report_id=${REPORT_ID}&confirm=1&respond=json${sentDate ? '&force=1' : ''}`
```

Line counts unchanged (script.js ratchet-safe — baseline 16116, file remains 16116).

## 4. Cache-bust

- `frontend/admin/index.html` — `script.js?v=433 → 434`
- `frontend/document-manager.html` — `document-manager.js?v=413 → 414`

## 5. Why no Worker change

`?force=1` was deliberately designed as the admin-override path in DL-354. The Worker behavior is correct — the bug is purely that the admin UI never used the override flag for intentional resends. Changing the Worker default would weaken double-click protection for first sends.

## 6. Why no new dedup risk

The dedup guard still fires when `sentDate` is falsy (first send) — that's exactly the double-click / two-tab scenario DL-354 protects against. When `sentDate` is truthy, the admin has already seen a "list was sent on {date}. Send again?" confirm dialog and clicked "שלח שוב" — intent is explicit.

## 7. Validation Plan

- [ ] Open doc-manager for `recXXXXXXXXXXXXXX` (user's repro report).
- [ ] Click "אשר ושלח" → dialog reads "הרשימה נשלחה ב-{date}. לשלוח שוב ל-{name}?".
- [ ] Click "שלח שוב" → Network tab shows `…&confirm=1&respond=json&force=1`.
- [ ] Worker response is `{ok:true, stage:'Collecting_Docs'}` (no `deduped`).
- [ ] Client inbox receives a fresh email body identical to first send.
- [ ] Repeat the resend flow from the PA queue card → confirm new email + card slide-out works.
- [ ] Repeat from AI-review "send missing-docs reminder" prompt → confirm new email + no card-cleanup glitch.
- [ ] First-send (no `sentDate`) still works without `force=1` and is still dedup-protected on rapid double-click.

## 8. Implementation Notes

- Plan-mode design log was retroactive — code was already edited on disk when the user asked for `/design-log`. Phase A questions skipped per Auto Mode + user "no clarifying questions" directive. Documented here for the audit trail and so future "send again silently fails" reports route straight to this log.
- Duplicate-path audit (P1) applied: all three "send again" sites patched in one commit. No additional surfaces — `frontend/n8n/workflow-processor-n8n.js:828` is the office approval-link generator (token-auth, not admin-token, never sets `force=1`), and `frontend/approve-confirm.html` calls the Worker through the same route but is the office confirmation page, not an admin resend.
- Cross-references: DL-354 (idempotency layers), `feedback_admin_script_cache_bust` (cache version bumps), `feedback_silent_refresh_after_mutation` (UI does refresh — bug was that mutation never happened).
