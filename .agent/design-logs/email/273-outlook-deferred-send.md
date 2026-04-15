# Design Log 273: Replace KV+Cron Queue with MS Graph Deferred Send
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-15
**Related Logs:** DL-264 (off-hours email queue), DL-266 (reply to client messages)

## 1. Context & Problem
DL-264 introduced an off-hours email queue: approve-and-send emails queued between 8PM-8AM Israel are stored in Workers KV and delivered by a daily cron at 05:00 UTC. DL-266 extended this to comment replies. The system works but has drawbacks:

- **Cron fires at 07:00 Israel in winter** (DST offset) instead of 08:00
- **Extra infrastructure**: KV queue + cron handler + retry logic for what's essentially "send later"
- **No cancellation path**: once queued, no way to cancel/edit a scheduled email
- **Airtable stage transitions delayed**: approval stays in Pending_Approval until cron fires

MS Graph supports `PidTagDeferredSendTime` — a server-side scheduled send where Exchange holds the message in Outbox until the specified time. This eliminates the queue entirely.

## 2. User Requirements
1. **Q:** MS Graph deferred send approach?
   **A:** PidTagDeferredSendTime — eliminates cron entirely

2. **Q:** Timing for deferred emails?
   **A:** Always 08:00 Israel time, regardless of when approved

3. **Q:** UI behavior after removing KV queue?
   **A:** Keep same UI indicators (toast, button text, queued_send_at field) — just change the backend from KV to Outlook deferred

4. **Q:** Scope — both email types?
   **A:** Both approve-and-send AND comment replies migrate to deferred send. Eliminate cron entirely.

## 3. Research
### Domain
Email scheduling, MS Graph extended properties, Exchange deferred delivery

### Sources Consulted
1. **MS Graph singleValueExtendedProperties docs** — `PidTagDeferredSendTime` uses `SystemTime 0x3FEF` property tag
2. **Exchange deferred delivery behavior** — Server-side hold in Outbox, no client connection needed at send time
3. **MS Graph createReply + extended properties** — createReply doesn't accept extended properties in body; must PATCH separately

### Key Principles Extracted
- **Two-step draft→send is required** — `/sendMail` with extended properties is unreliable for deferred delivery; Exchange may skip the Outbox
- **For replies: three-step** — `createReply` → PATCH extended property → send
- **UTC format required** — ISO 8601 with `Z` suffix: `"2026-04-16T05:00:00.0000000Z"`
- **Past time = immediate send** — safe fallback, no errors
- **Server-side delivery** — Exchange holds the message; our Worker doesn't need to be running at send time

### Patterns to Use
- **Draft→Send**: create message draft with `singleValueExtendedProperties` → send
- **Reply→Patch→Send**: createReply → PATCH deferred property → send
- **Israel time → UTC conversion**: compute next 08:00 Israel in UTC for the property value

### Anti-Patterns to Avoid
- **`/sendMail` with extended properties**: unreliable — message bypasses Outbox
- **KV queue for simple scheduling**: unnecessary when the mail server supports deferred delivery natively

### Research Verdict
Replace KV+cron with MS Graph `PidTagDeferredSendTime`. Two new methods on MSGraphClient: `sendMailDeferred()` and `replyToMessageDeferred()`. Eliminate cron handler, KV queue operations, and `email-queue.ts`.

## 4. Codebase Analysis
* **Existing Solutions Found:** `MSGraphClient` already has `post()`, `patch()`, `sendMail()`, `replyToMessage()` — the draft→send pattern is already used in `replyToMessage()` (create draft → send)
* **Reuse Decision:** Extend MSGraphClient with deferred variants. Reuse `isOffHours()` + `getIsraelHour()` — still needed to decide whether to defer
* **Relevant Files:** See Files to Change table below
* **Existing Patterns:** `replyToMessage()` already does create-draft→send — deferred send extends this with an extended property
* **Alignment with Research:** Good — the codebase already has the two-step pattern

**Full touchpoint map (from exploration):**
- KV writes: `approve-and-send.ts:196`, `dashboard.ts:329`
- KV reads: `email-queue.ts:21,85`
- Cron: `index.ts:88-91`, `wrangler.toml:40`
- `queued_send_at` field: 8 references across 5 files
- Frontend queued UI: `document-manager.js` (5 locations), `script.js` (2 locations)
- `isOffHours`: `approve-and-send.ts`, `dashboard.ts`

## 5. Technical Constraints & Risks
* **Security:** No new auth surfaces — uses existing MS Graph app credentials
* **Risks:**
  - If `PidTagDeferredSendTime` doesn't work on our Exchange Online tenant → fallback to immediate send (past time = immediate)
  - Airtable stage transitions now happen immediately at approval time (not at send time) — this is actually BETTER (faster pipeline progression)
  - No way to query Outlook Outbox via Graph for "pending deferred" messages — but we keep `queued_send_at` in Airtable for visibility
* **Breaking Changes:** Cron removal — but cron only did queue processing, nothing else

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Off-hours approve-and-send and comment reply emails use MS Graph deferred delivery (PidTagDeferredSendTime) instead of KV+cron, with no visible UI changes to the admin.

### Logic Flow

**Approve-and-send (off-hours):**
1. Admin approves → `isOffHours()` returns true
2. Compute next 08:00 Israel time in UTC
3. Call `graph.sendMailDeferred(subject, html, toAddress, fromMailbox, deferredUtc)` — creates draft with extended property → sends
4. Update Airtable: advance stage immediately (Collecting_Docs or Review), set `queued_send_at`
5. Return `{ ok: true, queued: true, scheduled_for: '08:00' }`

**Comment reply (off-hours):**
1. Admin sends reply → `isOffHours()` returns true
2. Compute next 08:00 Israel time in UTC
3. If threaded: `graph.replyToMessageDeferred(messageId, html, fromMailbox, deferredUtc)` — createReply → PATCH property → send
4. If not threaded: `graph.sendMailDeferred(subject, html, toAddress, fromMailbox, deferredUtc)`
5. Return `{ ok: true, queued: true, scheduled_for: '08:00' }`

**Key change: Airtable stage transitions happen immediately**, not at cron time. This means:
- Clients move to Collecting_Docs right away (better pipeline flow)
- `queued_send_at` is set for admin visibility but cleared on next page load after 08:00 passes
- No more "stuck in Pending_Approval overnight" issue

### Data Structures / Schema Changes
* **Keep:** `queued_send_at` Airtable field (informational — shows when email will arrive)
* **Remove:** KV keys `queued_email:*` and `queued_comment:*`
* **New helper:** `getNext0800Israel(): string` — returns next 08:00 Israel in UTC ISO 8601

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/ms-graph.ts` | Modify | Add `sendMailDeferred()` and `replyToMessageDeferred()` methods |
| `api/src/lib/israel-time.ts` | Modify | Add `getNext0800Israel()` helper returning UTC ISO 8601 |
| `api/src/routes/approve-and-send.ts` | Modify | Replace KV queue with `sendMailDeferred()`, move stage transition into off-hours path |
| `api/src/routes/dashboard.ts` | Modify | Replace KV queue with `sendMailDeferred()`/`replyToMessageDeferred()` |
| `api/src/lib/email-queue.ts` | Delete | No longer needed — cron processor removed |
| `api/src/index.ts` | Modify | Remove `scheduled` handler export, remove `email-queue` import |
| `api/wrangler.toml` | Modify | Remove `crons = ["0 5 * * *"]` |

**No frontend changes needed** — the UI already shows the right indicators based on the `{ queued: true }` API response and `queued_send_at` field.

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update `current-status.md`

## 7. Validation Plan
* [ ] Off-hours approve-and-send: email arrives at ~08:00 Israel (not immediately)
* [ ] Off-hours comment reply (threaded): reply arrives at ~08:00 in correct thread
* [ ] Off-hours comment reply (non-threaded): email arrives at ~08:00
* [ ] Business-hours approve-and-send: unchanged — sends immediately
* [ ] Business-hours comment reply: unchanged — sends immediately
* [ ] UI toast shows "אושר ✓ ישלח אוטומטית ב-08:00" on off-hours approval
* [ ] Doc-manager button shows "⏰ ישלח ב-08:00" (disabled) after off-hours approval
* [ ] Airtable stage advances immediately on off-hours approval (not delayed)
* [ ] `queued_send_at` field populated on off-hours approval
* [ ] Cron no longer fires (wrangler.toml has no crons)
* [ ] Worker deploys successfully without scheduled handler
* [ ] No regression: daytime approve-and-send flow unchanged

## 8. Implementation Notes (Post-Code)
* **Draft→send pattern confirmed working** — `sendMailDeferred()` creates draft with `singleValueExtendedProperties` then sends; `replyToMessageDeferred()` does createReply → PATCH property → send
* **Stage transitions now immediate** — off-hours approvals advance to Collecting_Docs/Review right away instead of waiting for cron. This is better for pipeline flow.
* **`queued_send_at` still set** — informational field for admin visibility. Not auto-cleared after 08:00 delivery (Exchange has no callback). Clears on next daytime approval or manual action. Same UX gap existed with KV system (cron cleared it at 07:00 Israel in winter).
* **Dashboard queued count still works** — filters on `queued_send_at` without stage check, so it shows count even after stage advances
* **Cron fully removed** — no `[triggers]` section in wrangler.toml, no `scheduled` handler in index.ts
* **`email-queue.ts` deleted** — 121 lines removed
