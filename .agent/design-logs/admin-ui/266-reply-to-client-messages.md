# Design Log 266: Reply to Client Messages from Dashboard Panel
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-14
**Related Logs:** DL-261 (dashboard recent messages panel), DL-263 (messages delete + raw text), DL-264 (off-hours email queue), DL-199 (client communication notes)

## 1. Context & Problem
The "הודעות אחרונות מלקוחות" side panel (DL-261) shows recent client emails. Currently, Natan can only view and delete/hide messages. To reply, he must switch to Outlook — friction.

**Goal:** Add inline reply capability so Natan can respond to client emails directly from the dashboard panel. Replies send branded HTML emails from `reports@moshe-atsits.co.il`. Off-hours replies (8PM-8AM Israel) queue for 8AM delivery, reusing the DL-264 infrastructure.

## 2. User Requirements
1. **Q:** What does "comment to a client" mean — how is it delivered?
   **A:** Email reply — sent from reports@ to client's email address

2. **Q:** Reply UI in the messages panel?
   **A:** Inline text input — expand the message row to show a textarea + send button below the client's message

3. **Q:** Email template for reply?
   **A:** Branded HTML — use existing Moshe Atsits email template (logo, RTL, footer)

4. **Q:** Off-hours queue UI feedback?
   **A:** Toast notification — "תגובה נשלחה ✓" (daytime) or "תגובה תישלח ב-08:00" (off-hours)

## 3. Research
### Domain
CRM Inline Reply UX, Activity Feed Design, Email Scheduling

### Sources Consulted
1. **Smashing Magazine — Notifications UX Guidelines** — Progressive disclosure: keep parent visible, show reply in context, confirm delivery with transient feedback.
2. **HubSpot CRM — Compose & Reply** — Inline reply in activity feed, maintain thread context, minimal compose UI (no full editor for quick replies).
3. **HubSpot/Gmail — Schedule Send** — "Scheduled for [time]" label in thread, batch-at-morning outperforms individual delays, provide cancel option.
4. **GetStream — Activity Feed Ideas** — Inline actions should expand within the feed item, not navigate away. Threading preserved via visual indent or container.

### Key Principles Extracted
- **Context preservation:** Keep the original message visible above the reply input — user sees what they're replying to.
- **Minimal compose UI:** For dashboard quick replies, a simple textarea + send button is sufficient. No rich editor, no attachments.
- **Immediate feedback:** Toast confirming send/queue status. Row collapses back after successful send.
- **No draft persistence:** For quick replies, losing the draft on navigation is acceptable (not a full email composer).

### Patterns to Use
- **Expand-in-place reply:** Reuse the existing `.msg-row.expanded` CSS toggle + add reply zone below content.
- **Off-hours KV queue:** Reuse DL-264 pattern — `queued_comment:{reportId}:{noteId}` in KV, processed by same cron.
- **Branded email template:** New simple `buildCommentEmailHtml()` in `email-html.ts` — logo, RTL, comment text, footer.

### Anti-Patterns to Avoid
- **Full rich text editor:** Overkill for 1-2 sentence replies. Textarea is sufficient.
- **Reply threading in panel:** The panel shows latest 10 messages. Adding reply threads would make it a chat app — out of scope.
- **Separate modal:** Breaks context. Inline is faster and more natural for quick replies.

### Research Verdict
Inline expand-in-place reply with textarea. New API endpoint for sending comment emails. Reuse DL-264 off-hours queue pattern. Simple branded email template for comments.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `isOffHours()` in `api/src/lib/israel-time.ts`
  - `processQueuedEmails()` in `api/src/lib/email-queue.ts`
  - `MSGraphClient.sendMail()` in `api/src/lib/ms-graph.ts`
  - `showAIToast()` — toast notification system
  - `FONT`, `C`, `BG`, `ACCENT`, `LOGO_URL` from `email-styles.ts`

* **Reuse Decision:**
  - Reuse `isOffHours()`, `MSGraphClient`, `showAIToast()`, email style constants
  - New `processQueuedComments()` with `queued_comment:` KV prefix
  - New `buildCommentEmailHtml()` + `buildCommentEmailSubject()`
  - New `replyToMessage()` on MSGraphClient for Outlook threading

* **Dependencies:** Airtable `client_notes` field, `client_email` field, MS Graph, KV `CACHE_KV`

## 5. Technical Constraints & Risks
* **Security:** Uses existing Bearer token auth. Comment text HTML-escaped before embedding in email.
* **Risks:** Client email may be missing — handled with `no_client_email` error response.
* **Breaking Changes:** None — purely additive.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Admin can click reply on any dashboard message, type a comment, and send branded email to client. Off-hours replies queue for 8AM.

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `frontend/admin/js/script.js` | Modify | Reply button, inline reply zone, sendReply() |
| `frontend/admin/css/style.css` | Modify | .msg-reply-zone styles |
| `frontend/shared/endpoints.js` | Modify | ADMIN_SEND_COMMENT endpoint |
| `frontend/assets/js/document-manager.js` | Modify | Threaded reply rendering in timeline |
| `frontend/assets/css/document-manager.css` | Modify | .msg-office-reply styles |
| `api/src/routes/dashboard.ts` | Modify | POST /admin-send-comment + reply map in GET |
| `api/src/lib/email-html.ts` | Modify | buildCommentEmailHtml() + contactBlock() |
| `api/src/lib/ms-graph.ts` | Modify | replyToMessage() for Outlook threading |
| `api/src/lib/email-queue.ts` | Modify | processQueuedComments() |
| `api/src/index.ts` | Modify | Wire comment queue in cron |

## 7. Validation Plan
* [ ] Reply button visible on each message row
* [ ] Clicking reply expands inline textarea
* [ ] Cancel collapses reply zone
* [x] Sending reply during business hours → email delivered immediately
* [ ] Sending reply off-hours → queued, toast "תגובה תישלח ב-08:00"
* [ ] Queued comments processed by morning cron
* [x] Email uses branded HTML template with logo, RTL, footer
* [x] Reply saved to client_notes as office_reply entry
* [ ] Reply appears in document-manager timeline as threaded card
* [x] Recent messages cache invalidated after reply
* [x] Empty comment text → validation error
* [x] Missing client email → error message
* [ ] No regression: existing panel features unaffected

## 8. Implementation Notes (Post-Code)
* **Original implementation:** Done in old repo (`annual-reports-old`) on branch `DL-266-reply-to-client-messages` (8 commits). Frontend merged to main; API never merged.
* **DL-272 port:** API code ported from old repo to monorepo — `dashboard.ts`, `email-html.ts`, `ms-graph.ts`, `email-queue.ts`, `index.ts`. Deployed to Workers.
* **Outlook threading:** `replyToMessage()` — two-step `createReply` + `send`. Falls back to `sendMail` if reply fails.
* **Contact block:** `contactBlock()` (renamed from `questionnaireContactBlock`) — shared by questionnaire + comment emails.
* **Note linking:** `reply_to` field on office_reply notes links to parent email note ID.
* **Key debugging from original session:** Graph `/reply` needs `message.body` not `comment`; `internetMessageId` filter needs `encodeURIComponent`; two-step `createReply`+`send` more reliable than direct `/reply`.
