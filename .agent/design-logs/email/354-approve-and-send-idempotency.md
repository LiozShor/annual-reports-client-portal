# DL-354: Approve & Send — idempotency lock to prevent duplicate emails

**Status:** IDEA / BACKLOG (not scheduled)
**Created:** 2026-04-26
**Domain:** email

## Observed
User reported a duplicate `דרישת מסמכים — דו"ח שנתי 2025 - Client Name` email landing in `client@example.com` inbox at 16:16 / 16:16 (same minute, identical subject + body).

## Root cause hypothesis
`api/src/routes/approve-and-send.ts` has **no idempotency guard between send and Airtable write**:

- Step 2 (L106-114): if `confirm !== '1'` redirects to confirm page; appends `&warning=already_sent` when `docs_first_sent_at` is set — UX warning only, not enforced.
- Step 5 (L200-206): `graph.sendMail(...)` runs unconditionally on every confirmed call.
- Step 6 (L216): `docs_first_sent_at: existingFirstSent || now` preserves the first-send timestamp but does not gate the second send.

Triggers that produce the duplicate:
1. Double-click on the confirm button (two GETs race past the gate before either writes Airtable).
2. Two open tabs / browser back-resubmit on `approve-confirm.html`.
3. Worker request retry on slow Graph response.

## Proposed fix (when scheduled)
Make Airtable the lock:
- At the top of Step 5, re-read the record and only proceed if `docs_first_sent_at` is empty (or older than an N-second resend window).
- Set `docs_first_sent_at = now` *before* `sendMail`; treat the second caller as a no-op (return `{ ok: true, deduped: true }`).
- Optional: cheap KV lock `lock:approve:<reportId>` with `expirationTtl: 60` for race-tight protection.
- Frontend mitigation only (disable confirm button on click) does NOT cover the two-tab case.

## Verification when implemented
Reproduce by opening `approve-confirm.html?...` in two tabs and clicking confirm in both — expect exactly one email + one stage transition.
