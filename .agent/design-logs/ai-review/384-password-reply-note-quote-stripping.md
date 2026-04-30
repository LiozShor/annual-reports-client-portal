# Design Log 384: Strip Quoted Body From Password-Reply client_note
**Status:** [BEING IMPLEMENTED — DL-384]
**Date:** 2026-04-30
**Related Logs:** DL-382 (batch password request — introduced the client_note write), DL-380 (request-password email + auto-detect reply), DL-298 (PA queue redesign — origin of dead notesText concat), DL-282 (forwarded-email note recurrence)

## 1. Context & Problem

DL-382 (shipped earlier today) added a `client_notes` write inside `handlePasswordReplyEmail` so a password-reply email surfaces in the admin "Pending Approval → הודעות הלקוח" thread. The new note's `raw_snippet` is the truncated email body — including the quoted original `[#PWD-…]` request that Gmail/Outlook appends. Result: the admin chat bubble shows the actual reply *plus* the entire forwarded original email, instead of just the password reply.

Same blob is also written to `pending_classifications.password_reply_raw`, used by the AI Review unlock panel.

Quote-stripping for password *extraction* already exists inline (`replyLines` at `processor.ts:800-807`); the bug is that we discard the stripped variant and persist the un-stripped `truncated` slice.

While auditing, three pre-existing JSON-dump bugs in `frontend/admin/js/script.js` surfaced (3 spots concatenating the JSON-stringified `client_notes` array as plain text into a `notesText` string). Two are dead, one is live (print sheet).

## 2. User Requirements

1. **Q:** Where exactly is the raw blob visible?
   **A:** PA card "הודעות הלקוח" thread (screenshot supplied). Single message bubble shows reply + entire quoted PWD request.

2. **Q:** What should the password-reply note actually show as readable content?
   **A:** Just the stripped reply (e.g. `הסיסמה היא 123456`) — same quote-stripping as password extraction.

3. **Q:** Scope?
   **A:** Both — clean storage + audit/fix the raw-JSON-render bugs in script.js.

4. **Q:** After approval?
   **A:** Implement.

## 3. Research

Internal email reply quote-stripping. No external research needed — the principle (strip before persist, not just before parse) and the helper exist in-repo (commit `bb521e63`, processor.ts:798-813).

**Anti-pattern observed:** building a stripped variant for one purpose (`replyLines` for password parsing) but persisting the un-stripped variant to downstream stores. Future inbound paths should derive the stored snippet from the same stripper.

## 4. Codebase Analysis

**a) Source of un-stripped raw_snippet — `api/src/lib/inbound/processor.ts`**
- L798: `truncated = bodyText.substring(0, 1000)` — full body slice.
- L800–807: builds `replyLines[]`, stops at `בתאריך` / `On … wrote:` / `>` quote header.
- L809–813: fallback `searchLines` for bottom-posted replies.
- L823: `passwordReplyRaw = truncated.substring(0, 1000)` — **bug**.
- L830: writes to `pending_classifications.password_reply_raw`.
- L876: writes to `client_notes[].raw_snippet`.

**b) Render path for the screenshot — `frontend/admin/js/script.js`**
- `buildPaPreviewBody` (~L9837) emits the messages thread.
- L9942: `rawThread = item.client_notes`; parsed and walked at L9978: `(m.raw_snippet || m.summary || m.text || '')` lands directly in the bubble.

**c) Adjacent JSON-dump bugs**
- L9706 (`buildPaCard`) — declared, never used in body. **Dead — delete.**
- L9840 (`buildPaPreviewBody`) — declared, body uses smarter `rawThread` parser (L9942). **Dead — delete.**
- L11792 (`viewPrintQuestionnaireSheet`) → L11802 `reportNotes: notesText` — **LIVE BUG**: print sheet renders the JSON array.
- L9816 `notesCount` — only computes 0/1 badge from truthiness; OK.

## 5. Constraints & Risks

- **No backfill.** Existing rows keep their un-stripped blobs (PWD replies are rare, DL-382 is hours old). Cosmetic, low-volume.
- **Bottom-posted replies.** If `replyLines` is empty (password is below the quoted block), persist `searchLines.join('\n')` instead so the field isn't empty.
- **Print-sheet behavior change.** Free-text office notes still print; the chat-thread JSON no longer leaks.
- **Cache bust.** script.js edits require `?v=` bump in `frontend/admin/index.html` (memory rule).

## 6. Proposed Solution

### Change A — `api/src/lib/inbound/processor.ts` (in `handlePasswordReplyEmail`)
Replace the un-stripped raw with the stripped reply, with bottom-post fallback:

```ts
// DL-384: persist the stripped reply (not the quoted original PWD request),
// so admin surfaces render only the client's actual message.
const strippedReply = (replyLines.length > 0 ? replyLines : searchLines).join('\n');
const passwordReplyRaw = strippedReply.substring(0, 1000);
```

Both downstream writes (`pending_classifications.password_reply_raw`, `client_notes[].raw_snippet`) automatically pick up the cleaned value. No interface changes.

### Change B — `frontend/admin/js/script.js`
1. Delete dead `notesText` at L9706 (`buildPaCard`).
2. Delete dead `notesText` at L9840 (`buildPaPreviewBody`).
3. Fix `viewPrintQuestionnaireSheet` (L11792 / L11802):
   - Stop concatenating `item.client_notes` (JSON string) into the print payload.
   - Pass only the office-notes free-text (handle the rejection-reason `{reason,text}` shape that exists in `item.notes` for rejected items).
4. Bump `script.js?v=382` → `?v=384` in `frontend/admin/index.html`.

### Change C — Documentation
- Add DL-384 to `INDEX.md` Active Logs.
- Add Section 7 items to `.agent/current-status.md` Active TODOs.

## 7. Validation Plan

- [ ] **Live PWD reply E2E:** trigger fresh "request password" → reply with `הסיסמה היא test123` → check Airtable `report.client_notes` last entry: `raw_snippet` is the stripped reply only.
- [ ] **Admin render:** PA card → "הודעות הלקוח" → password-reply bubble shows only the reply.
- [ ] **password_reply_raw field:** AI Review unlock panel chip shows clean reply.
- [ ] **Bottom-posted edge case:** simulate password on last line below quoted block → confirm fallback persists non-empty.
- [ ] **Print sheet:** PA card → print → no `[{"id":"cn_...` leak; office notes still render.
- [ ] **Cache bust:** hard-reload admin → `?v=384` served.
- [ ] **Type/build:** `cd api && ./node_modules/.bin/tsc --noEmit` clean.
- [ ] **Dry-run deploy:** `cd api && CLOUDFLARE_API_TOKEN="" npx wrangler deploy --dry-run -c wrangler.toml` clean.

## 8. Implementation Notes

To be filled during Phase D.
