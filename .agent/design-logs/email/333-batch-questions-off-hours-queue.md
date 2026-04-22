# Design Log 333: Batch-Questions Off-Hours Queue

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-23
**Branch:** `DL-333-followup-questions-office-hours-queue`
**Related Logs:** DL-328 (the "שאל את הלקוח" feature), DL-264 (off-hours queue mechanism), DL-273 (PidTagDeferredSendTime), DL-281 (Outlook = source of truth)

---

## Context

DL-328 added a "שאל את הלקוח" button on the AI Review tab that sends a standalone email titled `שאלות לגבי המסמכים שהעברת — {client}` with per-file follow-up questions. The implementation calls `graph.sendMail(...)` synchronously at `api/src/routes/send-batch-questions.ts:76`. There is no off-hours check.

Outcome today: when Natan finishes a review batch at 22:00 and clicks "שאל את הלקוח", the client's phone pings at 22:00. Every other office-initiated email (approve-and-send via DL-264, replies via DL-266) already defers off-hours sends to 08:00 Israel time using MS Graph `PidTagDeferredSendTime`. Batch-questions is the only office-originated outbound email that bypasses that policy.

Requested behavior: when the office triggers batch-questions during off-hours (20:00–08:00 Israel), queue the email for 08:00 like every other email type.

---

## 1. User Requirements (Phase A answers)

1. **UX off-hours:** Auto-queue with toast `"השאלות נשלחו לבוקר — ישלחו ב־08:00"` (no confirm dialog).
2. **Queue visibility (DL-281 modal):** Yes — surface batch-questions sends as a third row type in the "בתור לשליחה" modal.
3. **Button hide after queue:** Yes — add `clientName` to `_batchQuestionsSentClients` on queued success too.
4. **Preview mode off-hours:** Unchanged — `preview=true` still returns rendered HTML synchronously.

---

## 2. Existing Solutions (Reuse First)

- `api/src/lib/israel-time.ts` — `isOffHours()`, `getNext0800Israel()`
- `api/src/lib/ms-graph.ts:243` — `sendMailDeferred(subject, html, to, from, deferredUtc, cc?) → {messageId}`
- `api/src/routes/approve-and-send.ts:198–238` — canonical off-hours pattern to mirror
- `api/src/routes/dashboard.ts:543–563` — `client_notes` JSON entry → queue-modal projection (DL-281 reply path is identical to what we need for batch questions)
- `frontend/admin/js/script.js:55, 6170–6188` — call site + session-scoped Set + toast helper

Nothing new is needed beyond stitching these together.

---

## 3. Research

Domain (transactional email scheduling, MS Graph deferred send) was fully researched in DL-264 (Mailgun + Cloudflare Queues sources), DL-273 (PidTagDeferredSendTime), and DL-281 (Outbox-as-source-of-truth). Conclusions reused verbatim — no incremental findings.

Key principles applied:
- **Batch at fixed morning time** (DL-264) — `getNext0800Israel()` rounds to 08:00 Israel, DST-safe.
- **Outlook = source of truth** (DL-281) — persist `graph_message_id` on the audit trail so the queue modal self-heals after delivery.
- **Self-healing over cron cleanup** — no new background job; the row vanishes from the modal on the next dashboard fetch after Exchange delivers.

---

## 4. Codebase Analysis

### Files to touch

| File | Change |
|------|--------|
| `api/src/routes/send-batch-questions.ts` | Add `isOffHours()` branch — call `sendMailDeferred` instead of `sendMail`, persist `graph_message_id` + `queued: true` flag on the new note, return `{ok:true, queued:true, scheduled_for:'08:00'}`. |
| `api/src/routes/dashboard.ts` (lines 543–563) | Extend the `client_notes` scan to also project `n.type === 'batch_questions_sent'` rows when `n.graph_message_id` is set and present in `outboxIds`. Emit `type: 'batch_questions'`. |
| `frontend/admin/js/script.js` (lines 6170–6188) | Read `data.queued` from response; on queued, toast `"השאלות נשלחו לבוקר — ישלחו ב־08:00"` (info tone) instead of `"השאלות נשלחו ללקוח"`. Still add to `_batchQuestionsSentClients` and call `dismissClientReview(clientName)`. |
| `frontend/admin/js/script.js` (renderQueuedEmailsModal) | Add label/icon mapping for `type: 'batch_questions'` (Hebrew: `שאלות לאחר סקירה`). |
| `frontend/admin/index.html` | Bump `script.js?v=` cache version (per memory `feedback_admin_script_cache_bust`). |

### Out of scope
- No Airtable schema change — `graph_message_id` lives inside the existing `client_notes` JSON entry (same shape as `office_reply` notes).
- No change to `email-html.ts` — the email body is identical regardless of when it's delivered.
- No backfill — DL-328 was just shipped; there are no historical batch-questions notes to migrate.
- No cancel/edit (consistent with DL-281 deferred follow-up).

---

## 5. Technical Constraints & Risks

- **Risk A — Note ordering:** `client_notes` is a JSON array; we need to update the `batch_questions_sent` entry we just appended with `graph_message_id`. Mirror `dashboard.ts` reply pattern (`notes[lastIdx] = {...notes[lastIdx], graph_message_id}` after the deferred send returns).
- **Risk B — Preview path:** Preview mode (`preview === true`) must short-circuit BEFORE the off-hours check — otherwise `preview` would also trigger a deferred send. Already the first thing the route checks; no change needed beyond making sure the new branch sits below it.
- **Risk C — `clientEmail` validation:** Currently checked after preview short-circuit (line 70). Off-hours branch must reuse the same validation.
- **Security:** No new auth surface — same Bearer token, same `verifyToken`.
- **Breaking changes:** None. Daytime behavior unchanged. Frontend gracefully ignores `data.queued` if backend returns it without an updated frontend (toast still says "השאלות נשלחו ללקוח").

---

## 6. Proposed Solution

### Success criteria
A "שאל את הלקוח" click between 20:00 and 08:00 Israel time → toast says the email is scheduled for 08:00 → email actually arrives at the client's mailbox at 08:00 Israel time → row appears in the dashboard "בתור לשליחה" modal labelled `שאלות לאחר סקירה` until Exchange delivers → row disappears on the next dashboard load after delivery.

### Logic flow

**Backend (`send-batch-questions.ts`):**
```
1. Auth → parse → validate → fetch report  (unchanged)
2. Build subject + html                     (unchanged)
3. if (preview === true) return rendered    (unchanged — preview short-circuit)
4. Validate clientEmail                     (unchanged)
5. const offHours = isOffHours();
6. let deferredMessageId: string | null = null;
   if (offHours) {
       const deferredUtc = getNext0800Israel();
       const r = await graph.sendMailDeferred(subject, html, clientEmail, SENDER, deferredUtc);
       deferredMessageId = r.messageId;
   } else {
       await graph.sendMail(subject, html, clientEmail, SENDER);
   }
7. Append note { type:'batch_questions_sent', date, items, language,
                 ...(deferredMessageId && { graph_message_id: deferredMessageId, queued: true }) };
8. updateRecord(REPORTS, …client_notes…) + clear pending_question on classifications  (unchanged)
9. return { ok: true, queued: offHours, ...(offHours && { scheduled_for: '08:00' }) };
```

**Backend (`dashboard.ts` /admin-queued-emails):**
- Inside the existing `for (const n of notes)` loop, accept `n.type === 'batch_questions_sent'` in addition to office_reply (or simply: project any note with `n.graph_message_id` in `outboxIds`, ignoring `n.type`).
- Emit `type: 'batch_questions'` for the new shape so the frontend can label it distinctly.

**Frontend (`script.js`):**
- After `data.ok` check: if `data.queued`, swap toast text + tone (info instead of success). Still add to Set + dismiss review.
- In `renderQueuedEmailsModal()`, extend the type→label/icon lookup to include `batch_questions → שאלות לאחר סקירה`.

### Files to change
| File | Action |
|------|--------|
| `api/src/routes/send-batch-questions.ts` | Modify (lines 70–96) |
| `api/src/routes/dashboard.ts` | Modify (lines 543–563 — relax type filter, project batch_questions) |
| `frontend/admin/js/script.js` | Modify (line ~6182 toast branch + queue modal type map) |
| `frontend/admin/index.html` | Bump `script.js?v=NNN` |

### Final step (always)
Housekeeping per skill protocol — status → `[IMPLEMENTED — NEED TESTING]`, INDEX entry, `current-status.md` update, commit + push (no merge to main without approval per memory `feedback_ask_before_merge_push`), `wrangler deploy` from `api/`.

---

## 7. Validation Plan

- [ ] **Daytime regression:** Click "שאל את הלקוח" between 08:00 and 20:00 Israel → email arrives immediately → toast says `"השאלות נשלחו ללקוח"` → no `graph_message_id` on the note → row does NOT appear in the queue modal.
- [ ] **Off-hours queue:** Click "שאל את הלקוח" after 20:00 Israel → response `{ok:true, queued:true, scheduled_for:'08:00'}` → toast says scheduled-for-08:00 wording → button hides → email actually arrives at 08:00 next morning → `client_notes` entry has `graph_message_id` + `queued:true`.
- [ ] **Queue modal visibility:** After off-hours queue, dashboard `(N בתור לשליחה)` count increments → modal lists the row labelled `שאלות לאחר סקירה` with the correct client name + scheduled time.
- [ ] **Self-heal post-delivery:** After Exchange delivers at 08:00, next dashboard load drops the row from the modal automatically (DL-281 Outlook-as-source-of-truth path).
- [ ] **Preview unaffected:** `preview=true` request at 22:00 still returns `{subject, html}` synchronously — no Outbox draft created.
- [ ] **`pending_question` clearing:** Off-hours queue still clears `pending_question` on each classification record immediately (parity with daytime).
- [ ] **Edge — empty clientEmail:** Off-hours route still 400s without queueing.
- [ ] **No regression on DL-281:** Doc-request and reply rows still appear correctly in the queue modal alongside the new batch-questions rows.
- [ ] **`wrangler deploy` clean:** Worker startup logs show no errors; `wrangler tail` shows the off-hours branch firing.

---

## 8. Implementation Notes (Post-Code)

- **No deviations from plan.** All four files modified exactly per Section 6.
- **`QueuedRow` type extended** in `dashboard.ts:505` from `'doc_request' | 'reply'` to add `'batch_questions'` — small extra edit not in original plan but mandated by TypeScript.
- **Type-check clean** — only 2 pre-existing errors (`backfill.ts` ADMIN_SECRET, `classifications.ts` pageCount) unrelated to this change. Same baseline as DL-281.
- **Research principles applied:**
  - DL-264 *batch-at-fixed-morning*: reused `getNext0800Israel()` so DL-333 inherits DST safety automatically.
  - DL-281 *Outlook = source of truth*: `graph_message_id` persisted on the note, queue modal projects via `outboxIds.has(gid)` — self-heals on Exchange delivery, no cron.
- **Cache version:** `script.js?v=297 → v=298`.
- **No Airtable schema change** — `client_notes` JSON shape was already flexible.
- **Frontend backwards-compat:** old workers returning no `data.queued` still get the daytime success toast (truthy check on `data.queued`).
