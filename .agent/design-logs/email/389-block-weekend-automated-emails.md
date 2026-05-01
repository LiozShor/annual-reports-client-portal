# Design Log 389: Block ALL Automated Client Emails on Friday/Saturday
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-05-01
**Related Logs:** DL-264 (off-hours email queue), DL-273 (MS Graph deferred send), DL-281 (Outlook as source of truth), DL-333 (batch-questions off-hours)

## 1. Context & Problem
Israel's work week is Sun–Thu. Sending automated client emails on Friday or Saturday — even at "morning" hours — is unprofessional and out of step with how the office (Moshe Atsits CPA) operates.

DL-264 already queues off-hours email (8PM–8AM Israel) for next 08:00 via MS Graph `PidTagDeferredSendTime`; DL-281 made the queue self-healing via Outlook as source of truth. Both still leak emails on Friday/Saturday because the deferred timestamp lands on the next day even when that day is a weekend. Two routes (`send-questionnaires`, `request-pdf-password`) bypass the gate entirely and send immediately. n8n's Reminder Scheduler also fires on weekends.

This DL extends the existing infrastructure to **also skip Friday and Saturday**, releasing weekend-queued mail at **Sunday 08:00 Israel**. Internal/office emails (feedback, error notifications, internal digests) continue normally.

## 2. User Requirements (Phase A)
1. **Q:** Which automated email paths should the Friday/Saturday block cover?
   **A:** All Worker emails to clients **+** n8n reminder workflow. Office-internal notifications continue (feedback to Lior, errors to admin).
2. **Q:** What defines the Friday/Saturday window?
   **A:** Friday 00:00 → Sunday 00:00 Israel calendar-day. Simplest, no DST/sunset edge cases.
3. **Q:** When should weekend-queued emails be released?
   **A:** Sunday 08:00 Israel.
4. **Q:** Should weekend-queued emails appear in the existing `(N בתור לשליחה)` modal?
   **A:** Yes — reuse DL-281 modal/count. Outlook is already source of truth via `listOutboxDeferred()`.

## 3. Research
### Domain
Weekend skip in CRM/transactional email scheduling.

### Sources Consulted
1. **HubSpot — Ensure Your Automation Only Fires on Workdays** (babelquest.co.uk) — single toggle on workflow delay; counts only business days. Industry-standard pattern.
2. **Customer.io — Best day and time to send marketing emails** — "Saturday and Sunday consistently show the lowest open and click-through rates." For Israel that inverts to Fri/Sat.
3. **GMass — Skip Weekends** (gmass.co/blog/skip-weekends) — flag computes follow-up cadence in Mon–Fri days only, not calendar days. Direct analogue for our reminder cadence (n8n).
4. **Salesforce Stack Exchange — Email should not go on Weekend through Journey Builder** — community pattern: append a "send_window" flag at queue time, gate on it at delivery. Confirms decision happens at enqueue, not at fire.

### Key Principles Extracted (delta on top of DL-264/DL-281)
- **Decide at enqueue, not at fire** — set `PidTagDeferredSendTime` to next valid weekday 08:00 once; Exchange handles the wait. No second cron, no recheck logic.
- **Single calendar-day window beats sunset math** — DST-stable, debuggable, "good enough" for B2C-style office email.
- **Same UX for both deferral reasons** — users don't care *why* it's queued; one count, one modal.

### Patterns Used
- **Single SSOT helper for "next valid send time"** — every call site asks the same function, never branches on day-of-week locally.
- **Codify policy in `docs/email-design-rules.md`** — new Section 13 prevents future regressions when adding email paths.

### Anti-Patterns Avoided
- **Halachic Shabbat (sunset-based) window** — sunset varies through the year; calendar-day Fri/Sat is unambiguous and matches office reality.
- **Per-route weekend logic** — would scatter the policy across 5+ files; helper is the only correct surface.
- **Background sweep cron to "fix" weekend-fired emails** — at-enqueue gate makes it impossible.

### Research Verdict
Add `getNextBusinessMorning0800Israel()` and `isOffHoursOrWeekend()` helpers. Migrate three already-gated routes; add gate to two unprotected routes; gate the n8n reminder cron. Codify in `email-design-rules.md` so future paths follow.

## 4. Codebase Analysis
### Existing Solutions Found
- `api/src/lib/israel-time.ts` — `isOffHours()`, `getIsraelHour()`, `getNext0800Israel()` (DL-264).
- `api/src/lib/ms-graph.ts` — `sendMailDeferred()`, `replyToMessageDeferred()` accept UTC ISO `PidTagDeferredSendTime` (DL-273).
- `frontend/admin/js/script.js` — `renderQueuedEmailsModal()` (DL-281) reads Outlook directly. Weekend-deferred messages will appear automatically.

### Reuse Decision
Reuse all of the above. Add new helpers in `israel-time.ts`. Three call sites swap helper names; two add the gate; one n8n workflow gets a new IF node. No new infrastructure.

### Worker Call Sites
| File | Line | Recipient | Current state | Change |
|------|------|-----------|---------------|--------|
| `approve-and-send.ts` | ~220 | client | off-hours gated | swap to weekend-aware helpers |
| `dashboard.ts` (admin-send-comment) | ~364, 397 | client | off-hours gated | swap to weekend-aware helpers (2 reply paths) |
| `send-batch-questions.ts` | ~81 | client | off-hours gated | swap to weekend-aware helpers |
| `send-questionnaires.ts` | ~86 | client | **immediate** | add gate |
| `request-pdf-password.ts` | ~130 | client | **immediate** | add gate |
| `feedback.ts` | ~48 | internal (Lior) | immediate | **no change** |

### n8n Workflows
- **[06] Reminder Scheduler** `FjisCdmWc4ef0qSV` — add IF node after cron checking Asia/Jerusalem weekday; if Fri/Sat, end execution.
- **[07] Daily Natan Digest** `0o6pXPeewCRxEEhd` — recipients are internal (Moshe, Natan); per Phase A scope, no change.

### Dependencies
None. All work is in existing files.

## 5. Constraints & Risks
- **Risk A — Friday-morning approval, but office wants emails to land Sunday morning, not Monday morning.** Resolved by Phase A: release at Sunday 08:00.
- **Risk B — Helper rename ripple.** Decision: add `getNextBusinessMorning0800Israel()` and `isOffHoursOrWeekend()` as new exports; keep `getNext0800Israel()` and `isOffHours()` for backward compatibility. Migrate the 4 call sites in this PR.
- **Risk C — DST transitions.** `Intl.DateTimeFormat({timeZone: 'Asia/Jerusalem'})` handles DST automatically; same approach as existing helper.
- **Risk D — n8n weekend gate misses Friday cron tick before deploy.** Mitigation: deploy Worker + n8n change in same session.
- **Security:** No new auth surfaces; no PII change.
- **Breaking changes:** None. Helper signatures additive.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Every client-facing automated email path defers to Sunday 08:00 Israel when triggered on Fri/Sat. Existing off-hours weekday behaviour unchanged. Future client-facing email paths inherit the policy via documented helper.

### Logic Flow
1. **At enqueue:** `if (isOffHoursOrWeekend()) → sendMailDeferred(getNextBusinessMorning0800Israel())` else `sendMail()` (immediate).
2. **`getNextBusinessMorning0800Israel()`:** compute next 08:00 Israel via existing logic; if that date is Friday or Saturday Israel time, advance one day; repeat (max 2 iterations).
3. **n8n Reminder Scheduler:** IF node checks `Asia/Jerusalem` weekday; if Fri/Sat, end. Else continue.

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/israel-time.ts` | Modify | Add `getIsraelDayOfWeek`, `isWeekend`, `isOffHoursOrWeekend`, `getNextBusinessMorning0800Israel` |
| `api/src/routes/approve-and-send.ts` | Modify | Swap to weekend-aware helpers |
| `api/src/routes/dashboard.ts` | Modify | Same swap (2 reply paths) |
| `api/src/routes/send-batch-questions.ts` | Modify | Same swap |
| `api/src/routes/send-questionnaires.ts` | Modify | Add gate |
| `api/src/routes/request-pdf-password.ts` | Modify | Add gate |
| n8n `FjisCdmWc4ef0qSV` | Modify via MCP | Add weekday IF gate after cron |
| `docs/email-design-rules.md` | Modify | New Section 13 — Sending Policy / Quiet Hours |

### Final Step (Always)
* **Housekeeping:** Status → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 to `current-status.md`.

## 7. Validation Plan
- [ ] At Israel `Thu 21:00`, `getNextBusinessMorning0800Israel()` → `Sun 08:00`.
- [ ] At `Fri 10:00` → `Sun 08:00`.
- [ ] At `Sat 10:00` → `Sun 08:00`.
- [ ] At `Sun 09:00` → gate returns false (immediate).
- [ ] At `Mon 22:00` → `Tue 08:00` (unchanged from DL-264).
- [ ] `approve-and-send` Friday → Outbox `PidTagDeferredSendTime = Sunday 08:00 Israel`.
- [ ] `dashboard` reply on Saturday → same.
- [ ] `send-batch-questions` on Friday → deferred to Sunday.
- [ ] `send-questionnaires` on Friday → deferred to Sunday (NEW behaviour).
- [ ] `request-pdf-password` on Saturday → deferred to Sunday (NEW behaviour).
- [ ] `feedback.ts` → still sends immediately on weekend (internal).
- [ ] Admin queue modal shows weekend-deferred items with Sunday 08:00 timestamp.
- [ ] n8n Reminder Scheduler manual run on Friday → IF gate stops execution; on Sunday → fires normally.
- [ ] No regression: weekday off-hours behaviour identical to DL-264.
- [ ] `docs/email-design-rules.md` Section 13 lists every gated path and points to `israel-time.ts` SSOT.

## 8. Implementation Notes (Post-Code)
- **`israel-time.ts`** — added 4 helpers: `getIsraelDayOfWeek`, `isWeekend`, `isOffHoursOrWeekend`, `getNextBusinessMorning0800Israel`. Legacy `isOffHours` and `getNext0800Israel` kept for backward compat (no remaining callers in this PR — flagged "do not use" in `email-design-rules.md` Section 13).
- **Migrated 3 routes** to weekend-aware helpers: `approve-and-send.ts`, `dashboard.ts` (admin-send-comment), `send-batch-questions.ts`. Diff is `isOffHours` → `isOffHoursOrWeekend` and `getNext0800Israel` → `getNextBusinessMorning0800Israel` in each.
- **Added gate to 2 unprotected routes:** `send-questionnaires.ts` (`graph.sendMail` → conditional `sendMailDeferred`/`sendMail` with cc passthrough), `request-pdf-password.ts` (same pattern). Stage advance / Airtable side-effects unchanged in both — only delivery is deferred.
- **`docs/email-design-rules.md`** — added Section 13 "Sending Policy / Quiet Hours". Lists every gated path + every intentional exemption (`feedback.ts`, error logger, Daily Natan Digest, future client-triggered transactional). Documents the SSOT helper and the required `if (isOffHoursOrWeekend()) { ... }` pattern for any future client-facing email path.
- **n8n Reminder Scheduler `FjisCdmWc4ef0qSV`** — added Code node `Skip Fri/Sat (DL-389)` between `Schedule Trigger` and `Fetch Config`. Returns `[]` on Fri/Sat Israel weekday → halts cron-driven reminders on weekends. Manual webhook (`Manual Send Webhook` → `Verify & Split`) and `Execute Workflow Trigger` paths intentionally bypass the gate (admin-triggered sends are not "automated"). Workflow remained active throughout the change; nodeCount 28 → 29; verified via `n8n_get_workflow` structure mode.
- **Frontend** — no changes. DL-281's Outlook-source-of-truth modal already reads `listOutboxDeferred()`; weekend-deferred messages will appear with `scheduled_for` set to Sunday 08:00 Israel automatically.
- **Type-check** — `tsc --noEmit` shows only 2 pre-existing errors (`src/index.ts:128` Response promise, `src/lib/activity-logger.ts:16` node:async_hooks) — both unrelated to this change.
- **Applied research principles:** decide-at-enqueue (set `PidTagDeferredSendTime` once, Exchange handles wait) + single-SSOT helper + codified policy in design rules to prevent regressions in future email paths.


