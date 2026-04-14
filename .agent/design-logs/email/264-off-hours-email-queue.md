# Design Log 264: Off-Hours Email Queue
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-14
**Related Logs:** DL-092 (approve-send duplicate prevention), DL-105 (approve guard)

## 1. Context & Problem
Natan sometimes reviews and approves client document lists late at night (8PM-8AM). Emails sent at 2AM are suboptimal — they either wake clients or get buried under morning email. Need to queue off-hours approval emails and deliver them all at 8AM Israel time.

## 2. User Requirements
1. **Q:** What timezone for the 8PM-8AM window?
   **A:** Israel (Asia/Jerusalem) — handles DST automatically

2. **Q:** What should Natan see in the UI when approving off-hours?
   **A:** Green success with queued notice: "אושר ✓ ישלח אוטומטית ב-08:00"

3. **Q:** Should the Airtable stage update immediately or wait until 8AM?
   **A:** Keep stage as Pending_Approval with a `queued_send_at` sub-status field. Not a new pipeline stage — transient state (max 12 hours) doesn't justify 10+ file blast radius.

4. **Q:** Apply to both admin panel and approve-confirm.html flows?
   **A:** Yes, both flows queue during off-hours.

## 3. Research
### Domain
Email scheduling, Cloudflare Workers cron/queue patterns, transactional email timing

### Sources Consulted
1. **Cloudflare Queues docs** — `delaySeconds` supports up to 24h delays, but KV+cron is simpler for our scale (5-20 emails/night)
2. **Mailgun — Scheduling Email Delivery** — Batch-at-morning outperforms individual delays for CRM email. DST must use IANA timezone, not UTC offset.
3. **b2brocket.ai — Email Timing** — 20-30% open rate improvement when emails land during working hours vs. off-hours. Status update emails (not transactional) benefit from morning delivery.

### Key Principles Extracted
- **KV+cron over Queues** — for 5-20 items/night, KV is simpler with zero new infrastructure
- **Respect the inbox** — 2AM notifications signal odd working hours and risk being read as urgent
- **Batch at fixed morning time** — simpler and more debuggable than per-message delay calculations
- **DST via IANA timezone** — `Intl.DateTimeFormat` with `Asia/Jerusalem` handles automatically

### Patterns to Use
- **KV-based job queue**: write `queued_email:{reportId}` → cron reads+processes+deletes
- **Fire-and-forget async**: existing `ctx.waitUntil()` pattern for non-blocking operations

### Anti-Patterns to Avoid
- **Durable Objects**: overkill for 20 items/night — alarms shine for per-user state machines
- **UTC manual offset**: breaks twice a year at DST transitions
- **Delaying ALL emails**: error/failure notifications should still be immediate (not applicable here)

### Research Verdict
KV-based queue with Worker cron trigger. Single cron at 05:00 UTC (07:00-08:00 Israel depending on DST). Sub-status field on Pending_Approval stage instead of new pipeline stage.

## 4. Codebase Analysis
* **Existing Solutions Found:** `cache.ts` has KV helpers (getCachedOrFetch, invalidateCache). `ctx.waitUntil()` pattern in error-logger and audit-log. `MSGraphClient.sendMail()` ready to use.
* **Reuse Decision:** Reuse MSGraphClient, AirtableClient, logError, invalidateCache, calcReminderNextDate. New: israel-time.ts helper, email-queue.ts processor.
* **Relevant Files:** `approve-and-send.ts` (main flow), `index.ts` (export), `wrangler.toml` (cron), `document-manager.js` (UI), `approve-confirm.html` (confirmation page), `dashboard.ts` (stats), `script.js` (dashboard UI)
* **Existing Patterns:** No scheduled handler exists yet — Worker only exports Hono `app`. Need to change to object export with `fetch` + `scheduled`.
* **Dependencies:** KV namespace `CACHE_KV`, MS Graph credentials, Airtable PAT

## 5. Technical Constraints & Risks
* **Security:** No new auth surfaces — uses existing admin Bearer token and approval hash token
* **Risks:** Cron at 05:00 UTC fires at 07:00 IST (winter) instead of 08:00. Acceptable — both are morning hours.
* **Breaking Changes:** None — daytime flow unchanged. Export change from `app` to `{ fetch, scheduled }` is transparent to Cloudflare.

## 6. Proposed Solution (The Blueprint)
### Success Criteria
Off-hours (8PM-8AM Israel) approve-and-send queues emails in KV and delivers them at ~8AM morning cron, with clear UI feedback to Natan.

### Logic Flow
1. Admin approves client → Worker checks Israel time via `Intl.DateTimeFormat`
2. **If off-hours (20:00-08:00):** save email payload to KV `queued_email:{reportId}`, set `queued_send_at` on Airtable, return `{ ok: true, queued: true }`
3. **If business hours:** send immediately (current behavior unchanged)
4. **Cron at 05:00 UTC daily:** list KV `queued_email:*`, send each via MS Graph, advance stage to Collecting_Docs, clear `queued_send_at`, delete KV keys

### Data Structures / Schema Changes
* **Airtable field:** `queued_send_at` (dateTime) on `annual_reports` table
* **KV key:** `queued_email:{reportId}` with 24h TTL
* **KV value:** `{ reportId, subject, html, toAddress, fromMailbox, queuedAt, existingFirstSent }`

### Files to Change
| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/israel-time.ts` | Create | isOffHours(), getIsraelHour() |
| `api/src/lib/email-queue.ts` | Create | processQueuedEmails() |
| `api/src/routes/approve-and-send.ts` | Modify | Off-hours check, KV queue, queued response |
| `api/src/index.ts` | Modify | Add scheduled handler export |
| `api/wrangler.toml` | Modify | Add cron trigger |
| `github/.../document-manager.js` | Modify | Queued toast + badge |
| `github/.../approve-confirm.html` | Modify | Queued success state |
| `api/src/routes/dashboard.ts` | Modify | Add queued_count |
| `github/.../admin/js/script.js` | Modify | Stage 3 queued subtitle |

### Final Step (Always)
* **Housekeeping:** Update design log → `[IMPLEMENTED — NEED TESTING]`, copy Section 7 to `current-status.md`

## 7. Validation Plan
* [ ] Approve client after 20:00 Israel → response says queued, KV key created, Airtable has queued_send_at
* [ ] Approve client 08:00-20:00 Israel → sends immediately (unchanged)
* [ ] Dashboard shows queued count on stage 3 card
* [ ] Document manager shows queued badge after off-hours approval
* [ ] approve-confirm.html shows queued success page
* [ ] Trigger cron manually → queued emails send, stage → Collecting_Docs, KV keys deleted
* [ ] Duplicate off-hours approval → KV key overwrites (idempotent)
* [ ] No regression: daytime approve-and-send works identically

## 8. Implementation Notes (Post-Code)
* Airtable field created: `queued_send_at` (dateTime), field ID `fld18iNopKSFdbXxX`
* Cron trigger: `0 5 * * *` (05:00 UTC = 08:00 IDT summer / 07:00 IST winter)
* KV key pattern: `queued_email:{reportId}` with 24h TTL
* Export change: `api/src/index.ts` now exports `{ fetch, scheduled }` instead of bare `app`
* Dashboard API returns `queued_count` in stats + `queued_send_at` per client
* Applied research principle: batch-at-morning over individual delays (simpler, more debuggable)
