# Design Log 289: Recent Messages — Comment Threads + Mark-as-Handled + Compose Expand & Preview
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-16
**Related Logs:** DL-261 (recent messages panel), DL-263 (delete + raw text), DL-266 (reply to client messages), DL-272 (load more), DL-273 (deferred send), DL-274 (search bar)

## 1. Context & Problem
The dashboard side panel "הודעות אחרונות מלקוחות" has three real frictions today:
1. **Reply threads collapse to one.** `dashboard.ts:198-206` builds `replyMap = Map<reply_to, single reply>` via `.set()`. When the office sends 2+ replies on the same original message, only the **last** survives in the API response. UI shows just `m.reply` (singular).
2. **Trash icon frames the action wrong.** Today's danger button (`showMessageDeleteDialog`) opens a delete/hide dialog. It encourages "clean up the clutter," not "I handled this." Office should track what's been handled like a TODO list.
3. **Reply box is cramped.** Inline 2-row textarea is fine for "thanks!" but painful for longer replies — and the office sends real branded HTML emails without seeing how they'll look in the recipient's inbox.

## 2. User Requirements
1. **Q:** What does "2+ comments shown as comments" mean — what's currently broken or limited?
   **A:** Multi-turn reply thread — when there are 2+ back-and-forth exchanges, show ALL replies stacked as a thread under the original message.
2. **Q:** What should the new "v" (checkmark) action do?
   **A:** Mark as handled (soft-hide). Same as current "hide from dashboard" but framed positively as "טופל".
3. **Q:** What should happen to the existing trash/delete option?
   **A:** Remove entirely. Checkmark replaces it.
4. **Q:** Visual treatment for the checkmark?
   **A:** Instant fade-out + toast (same pattern as current delete).
5. **Q (mid-flow):** After commenting, prompt to mark as handled?
   **A:** Yes — inline strip after successful reply with "סמן כטופל / השאר פתוח" buttons.
6. **Q (mid-flow):** Compose UX?
   **A:** Add Gmail-style expand button on the reply textarea → opens larger compose mode with **live preview** of the actual branded email (greeting box, logo, footer — exactly what the client receives).

## 3. Research
### Domain
Activity feed UX, threaded conversation display, WYSIWYG email composition

### Sources Consulted
Skipped — this builds on infrastructure from DL-261/263/266 which already covered dashboard UX, soft-delete patterns, and reply UX. New patterns (thread connector, Gmail-style expand+preview) are well-established conventions; reuses existing email template as single source of truth.

### Key Principles Extracted
- **Thread visualization:** A vertical connector line + nested indent makes parent/reply relationship obvious without text labels (Gmail, Slack pattern).
- **Positive framing for archival:** "Mark as handled ✓" reads as accomplishment vs "delete" which reads as cleanup chore. Same DB operation, different psychology.
- **Single source of truth for email rendering:** Build preview server-side using the same `buildCommentEmailHtml()` that sends — never duplicate the template in JS.

### Patterns to Use
- **Thread connector:** `border-right: 2px solid var(--gray-200)` on the replies wrapper.
- **Inline post-action prompt:** Replace row content briefly (DL-263 `showMessageDeleteDialog` pattern), auto-dismiss on timeout.
- **Modal compose with live preview:** `.ai-modal-overlay` > `.ai-modal-panel` (per CLAUDE.md memory — NOT design-system `.modal-overlay`). 2-pane CSS Grid; iframe `srcdoc` for preview.

### Anti-Patterns to Avoid
- **Duplicating email HTML in JS:** Drift risk between preview and actual sent email. Always render server-side.
- **Modal after every reply for "mark as handled?":** Too heavy. Inline strip with auto-dismiss respects flow.

## 4. Codebase Analysis
* **Existing Solutions Found:**
  - `buildCommentEmailHtml()` in `api/src/lib/email-html.ts:683` — the exact email template; reused as-is for preview
  - `delete-client-note` action with `mode: 'hide'` in `client.ts:130-152` — already does soft-archive correctly; no backend change needed for checkmark
  - `deleteRecentMessage()` fade-out animation in `script.js:984-993` — copied for `markMessageHandled`
  - `showMessageDeleteDialog()` inline-row-replacement pattern in `script.js:939-970` — adapted for post-reply prompt
  - `sendReply()` send pipeline in `script.js:1041-1075` — reused; only the input UI changes for expand mode
  - `.ai-modal-overlay` pattern (per memory) for custom modals
* **Reuse Decision:** Maximum reuse. Backend: only adds preview endpoint + replies array. Frontend: replaces icon, adds modal, adds prompt — all using existing patterns.
* **Dependencies:** Airtable `client_notes` JSON field, Lucide icons (`check`, `maximize-2`, `minimize-2`)

## 5. Technical Constraints & Risks
* **Security:** Preview endpoint requires same Bearer auth as send. No new auth.
* **Risks:** 
  - Cache invalidation: hide action already invalidates `cache:recent_messages:${year}` (existing pattern).
  - Preview endpoint per-keystroke: mitigated by 400ms client-side debounce. No DB hit, just template render.
* **Breaking Changes:** API response field `reply` → `replies[]`. Single producer (this endpoint), single consumer (this script.js). Safe.

## 6. Proposed Solution (The Blueprint)

### Success Criteria
Office can see all reply threads stacked under each message, mark messages as handled with one click (✓), get prompted to mark-as-handled after each reply, and expand the compose box into a larger view with live preview of the branded email.

### Logic Flow
1. **Backend replies array** — iterate `office_reply` notes; push into `Map<reply_to, Array<reply>>` (not `.set` overwrite). Sort each bucket by `date` ASC.
2. **Backend preview endpoint** — `POST /admin-comment-preview` body `{report_id, comment_text}` → calls `buildCommentEmailHtml({commentText, clientName, year})` → returns `{ok, html, subject}`.
3. **Frontend thread render** — `renderMessages` loops `m.replies` instead of single `m.reply`.
4. **Frontend checkmark** — replaces trash button. `markMessageHandled(noteId, reportId)` calls existing `delete-client-note` with `mode:'hide'` directly (no dialog).
5. **Frontend post-reply prompt** — after `sendReply` success, replace row content with strip: "נשלח ✓  סמן כטופל?" + 2 buttons. Auto-dismiss 8s.
6. **Frontend expand-compose** — expand button on textarea → modal with grid (textarea | iframe). Debounced 400ms preview fetch on input. Collapse preserves text.

### Data Structures / Schema Changes
**API response change** (backwards-incompatible for the dashboard endpoint, but single-consumer):
```json
// before
{"id":"...", "reply":{"summary":"...","date":"..."} | null, ...}
// after
{"id":"...", "replies":[{"id":"...","summary":"...","date":"..."}], ...}
```

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/routes/dashboard.ts:197-224` | Modify | replyMap → repliesByOriginal array; response field rename |
| `api/src/routes/dashboard.ts` | Add | New `POST /admin-comment-preview` route |
| `frontend/admin/js/script.js:901-936` | Modify | Loop m.replies; swap trash for check |
| `frontend/admin/js/script.js:939-999` | Modify | Remove showMessageDeleteDialog; add markMessageHandled |
| `frontend/admin/js/script.js:1002-1075` | Modify | Add expand button, expandReplyCompose modal, post-reply prompt |
| `frontend/shared/endpoints.js` | Modify | Add ADMIN_COMMENT_PREVIEW URL |
| `frontend/admin/css/style.css` | Modify | New .msg-action-btn--success, .msg-thread-replies, .msg-reply-expand-btn, .msg-post-reply-prompt, .msg-compose-modal, .msg-compose-grid, mobile rules |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 to `current-status.md` "Active TODOs", update INDEX.

## 7. Validation Plan
* [ ] Send 3 office replies on the same client message → all 3 appear stacked under the original, oldest-first, with thread connector line
* [ ] Click ✓ button on a row → row fades out (300ms) + toast "סומן כטופל ✓"
* [ ] Refresh page → handled message stays hidden (server `hidden_from_dashboard` flag persisted)
* [ ] doc-manager timeline for the same client still shows the hidden message (no regression — DL-263 invariant)
* [ ] After sending a reply: inline strip appears with "סמן כטופל / השאר פתוח" — auto-dismisses at 8s
* [ ] Click "סמן כטופל" in post-reply strip → message hides
* [ ] Click "השאר פתוח" or wait 8s → panel reloads, new reply visible in thread
* [ ] Compact reply box: expand button visible top-right
* [ ] Click expand → modal opens, textarea preserves typed text
* [ ] Type in expanded textarea → preview updates within ~400ms, shows logo, blue header bar, comment body, contact block, footer (greeting row removed in DL-358)
* [ ] Empty textarea → preview shows "הקלד הודעה לתצוגה מקדימה" placeholder
* [ ] Click collapse → modal closes, compact textarea has the typed text
* [ ] Click send from expanded mode → email sent (or queued off-hours), same pipeline as compact
* [ ] Mobile (<900px): expand modal stacks textarea above preview
* [ ] Escape key + overlay click in modal = collapse (preserves text), NOT cancel
* [ ] No regression: search bar, load-more, click-to-doc-manager all still work
* [ ] No regression: trash icon fully gone — no orphan styles, no console errors

## 8. Implementation Notes (Post-Code)
* **Inline post-reply prompt (refinement during implementation):** Initial implementation replaced row content with the prompt strip. User clarified "the mark as handled prompt will be inline" — refactored `showPostReplyPrompt` to **append** the strip below row content (`row.appendChild(prompt)`) so the original message + new reply stay visible while the prompt asks "did you handle this?". `loadRecentMessages()` runs only on dismiss/keep paths, not when "סמן כטופל" is clicked (markMessageHandled handles its own re-render).
* **Escape listener leak fix (post-review):** Code-quality reviewer caught a memory leak in `expandReplyCompose` — Escape `keydown` listener was only removed via the Escape key path, not via collapse-button/cancel/overlay-click paths. Refactored: declared `escHandler` first, moved `removeEventListener` into the `collapse()` closure so all 4 dismiss paths clean it up.
* **CSS RTL fix (post-review):** `.msg-preview-loading` used `right: 8px` — switched to logical property `inset-inline-end: 8px` for proper RTL handling.
* **Send-path code duplication (acknowledged, not fixed):** Send logic exists in both `sendReply` (compact) and `expandReplyCompose` (modal). Both POST to `ADMIN_SEND_COMMENT` and handle the same result branches. Reviewer flagged as MINOR_CONCERN (not blocking) — left as-is for now; if API contract changes later, both paths must be updated together.
* **TypeScript:** Zero new errors. Two pre-existing errors in `backfill.ts:22` (`ADMIN_SECRET`) and `classifications.ts:902` (`pageCount`) are unrelated to this change.
* **Email template reuse:** Live preview calls `buildCommentEmailHtml` server-side via the new `/admin-comment-preview` endpoint — never duplicating the template in JS. Single source of truth maintained.
* **Backwards-compatible API change:** Response field `reply: {...}|null` → `replies: Array<{id,summary,date}>`. Single producer (dashboard endpoint), single consumer (script.js renderMessages) — no migration needed.
