# Design Log 342: Reminder Burst Readiness — 422 This Week

**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-04-25
**Related Logs:** DL-059 (foundation), DL-154 (calendar-date idempotency, still DRAFT), DL-257 (admin bulk cap), DL-271 (cron at 08:00), DL-277 (429 retry), DL-155 (twice-monthly)

## 1. Context & Problem
The admin reminder tab shows **422 reminders due this week** (`השבוע 422`). Highest single-day volume previously handled is **under 50**. The user wants confidence the system can absorb a ~3–10× spike before the first big batch fires.

Delivery mode this week: **n8n WF[06] daily 08:00 cron only**. No admin bulk-send planned.
Primary worry per user: **duplicate sends and silent failures**.
Deliverable: audit-only — this document is the artifact. No code changes.

## 2. User Requirements
1. **Q:** Send mode for the 422?
   **A:** Daily cron only — WF[06] picks them up paced across the week.
2. **Q:** Past peak handled?
   **A:** Under 50 in a single day.
3. **Q:** Top concern?
   **A:** Duplicate sends / silent failures.
4. **Q:** Deliverable?
   **A:** Audit-only go/no-go.
5. **Q:** Timing pressure?
   **A:** 2–3 day runway.
6. **Q:** Live Gmail quota check?
   **A:** Desk-check only.

## 3. Research

### Domain
Email burst reliability + idempotency for cron-driven scheduled jobs.

### Sources Consulted
1. **Google Workspace — Gmail sending limits** (`support.google.com/a/answer/166852`) — Standard Workspace cap is **2,000 unique external recipients per user per day**. SMTP relay cap is 10,000/day account-wide with 100 recipients/transaction.
2. **n8n — Handling API rate limits** (`docs.n8n.io/integrations/builtin/rate-limits/`) — Canonical pattern: Loop Over Items → action → Wait → loop. Always honour `Retry-After`. Small batches (10–50) cap memory.
3. **DL-154 + DL-059 + DL-271 (in-repo)** — Prior decisions on idempotency, cron time (08:00), and reminder lifecycle.

### Key Principles Extracted
- **Daily idempotency belongs on calendar date, not 24h windows** — clock drift between consecutive cron runs always sits a few minutes under 24h. Timestamp windows are for rate-limiting, not daily dedup. (DL-154 already proved this with 3 missed reminders in March.)
- **Write the dedup marker BEFORE the side-effect** — for at-least-once schedulers, mark `last_reminder_sent_at` before/in-the-same-write as the email send. If the marker is written *after* a successful Gmail send and the run retries, you double-send.
- **Observability beats prevention for cron jobs** — single-execution failures inside n8n cloud are silent unless the executions tab is checked. UptimeRobot / error-logger don't see in-workflow exceptions.
- **Headroom math first, optimisation second** — most "is it going to break?" worries dissolve once you put the actual numbers next to the documented caps.

### Patterns to Use
- **Per-batch Wait node** (n8n canonical) — only relevant if we ever cross ~500/day. Not needed at 85–150/day.
- **Calendar-date dedup with Asia/Jerusalem TZ** (DL-154 pattern) — recommended **only if the burst exposes the existing 24h-window bug**.

### Anti-Patterns to Avoid
- **Hot-fixing WF[06] before Monday** — touching a cron that's about to fire 422 emails has more downside than upside. Audit, observe, fix only on real evidence.
- **Adding retries to the Gmail node naïvely** — without a "did I already send" idempotency key, retries become duplicate-multipliers.

### Research Verdict
At 422/week the question isn't "can the system handle it" (numerically it's trivial) — it's "will partial failures be visible". Recommend GO with manual observation on the first two cron runs. Defer all code changes; queue DL-154 as a hot-fix only if the burst surfaces the bug.

## 4. Codebase Analysis
### Existing Solutions Found (Phase A pre-scan + plan-mode exploration)
- **n8n WF[06] `FjisCdmWc4ef0qSV`** — Reminder Scheduler. Code lives in n8n cloud (no local export). Behavior documented in DL-059, DL-154, DL-271. Cron at **08:00 Asia/Jerusalem** (DL-271).
- **`api/src/routes/reminders.ts`** — Worker-side admin endpoint. Idempotency check at lines 297–304 (`hoursSince < 24` → warn). Batch update in 10-record chunks (lines 326–329). Fires `/send-reminder-manual` async (line 332). **NOT on cron path.**
- **`frontend/admin/js/script.js` ~11180–11280** — `executeReminderAction` does single-batch POST with all `report_ids` (95s timeout per DL-098). Not invoked for cron-only delivery.
- **DL-154 calendar-date fix** — written 2026-03-16, status still `[DRAFT]`, **never deployed** (no Section 8 implementation notes; not in current-status.md).

### Reuse Decision
No code reuse needed — audit only. The "code path" being audited is the n8n WF[06] cron flow, which is read about, not modified.

### Dependencies
- n8n cloud (`liozshor.app.n8n.cloud`) — WF[06] execution
- Gmail / Google Workspace — reports@moshe-atsits.co.il send quota
- Airtable base `appqBL5RWQN9cPOyh` — reminder field writes

## 5. Technical Constraints & Risks
- **Single-execution model:** WF[06] processes the day's whole batch in one execution. A mid-run exception in any non-`continueOnFail` node skips remaining clients silently.
- **Cron drift:** Documented at 08:00 IL (DL-271). Two consecutive runs land at ~23h59m apart, which trips the latent DL-154 bug for any client reminded yesterday.
- **No alerting hook:** Errors inside WF[06] don't reach `error-logger.ts` or UptimeRobot. Console-only via n8n executions tab.
- **Risk if we touch anything:** changing WF[06] before Monday with 422 emails queued behind it is asymmetric — small upside, real chance of breaking the run entirely.

## 6. Audit Findings & Recommendations (the "Blueprint" for this audit)

### Throughput math
| Limit | Headroom for 150/day worst case |
|---|---|
| Workspace external recipients | 2,000/day → **13× headroom** |
| Gmail per-second throttle (~1 msg/s sustained) | 150 emails ≈ 2–3 min wall-time → fits in any single n8n execution |
| Airtable 5 req/s | Naturally paced by Gmail send latency, never approaches |
| Worker / KV | Cron path doesn't invoke Worker; only relevant for any admin "Send Now" |

**Capacity verdict: GO.** External caps are not the constraint.

### Bottleneck table

| # | Layer | Component | Risk | Severity | Mitigation |
|---|---|---|---|---|---|
| 1 | n8n WF[06] | Single sequential execution; if any non-`continueOnFail` node throws, remaining cohort silently dropped | Whole-day cohort loss | **High** | Confirm `continueOnFail` on Gmail + Airtable Update nodes before Monday; if missing — turn on. (Read-only audit, but flagged for user.) |
| 2 | n8n WF[06] | Filter Eligible 24h timestamp window (DL-154 bug still latent) | Same-time clients reminded yesterday will be skipped today | Medium | Most of 422 unaffected (their last reminder was weeks ago). Only at-risk: clients in their 2nd consecutive day. Watch executions tab. |
| 3 | n8n WF[06] | Order of "Send Gmail" vs "Update Airtable last_reminder_sent_at" | If marker written after Gmail success and run retries → double-send | **Medium** | Verify in WF[06] node order. Standard pattern: write Airtable first (or use `performUpsert` with idempotency key) — confirm Monday morning. |
| 4 | Gmail | Send quota | 422/week ÷ ~5 days ≈ 85/day avg | **Low** | 23× under cap |
| 5 | Airtable | 5 req/s | Pacing by Gmail latency keeps far below | Low | No action |
| 6 | Observability | Silent partial failure | No automated alert when WF[06] errors mid-run | **Medium** | Manual: open n8n executions tab + `wrangler tail` for 5 min after each 08:00 cron, days 1–2 |
| 7 | Worker `/admin-reminders` | Different dedup logic (timestamp warn vs. n8n's window) | Only relevant if Natan also clicks Send Now | Low | Out of scope (cron-only this week) |

### Top concerns (user-flagged) — direct answers

**Duplicate sends:**
- **n8n side:** Risk = node order + retry behaviour. Mitigation = pre-Monday spot-check of WF[06] (item 3 above).
- **Worker side:** Not on the cron path; warn-dialog at lines 297–304 only fires when admin clicks Send Now.
- **Verdict:** Low risk if WF[06] writes the marker before/with the send. Verify, don't refactor.

**Silent failures:**
- **n8n side:** Genuinely silent. The only observability is the n8n executions list and Gmail "Sent" folder count.
- **Worker side:** `error-logger.ts` covers Worker routes, doesn't help here.
- **Verdict:** Acceptable for a 5-day burst as long as a human looks at the executions tab on day 1 and day 2. Permanent fix (n8n → Slack/email error notification on workflow failure) is out of scope.

### Go/No-Go
**GO** — every numeric headroom is comfortable; the real risks are observable and recoverable next-day. Conditions:
1. Spot-check WF[06] before Monday (15 min — items 1 & 3 above).
2. Live-monitor first two 08:00 runs (15 min each).
3. If items 2 or 3 actually bite — apply DL-154 hot-fix or temporarily revert cron to 06:00 to widen the 24h window.

### Files to Change
None. This is an audit; the document itself is the deliverable.

### Final Step (Always)
- **Housekeeping:** status → `[IMPLEMENTED — NEED TESTING]`; copy Section 7 monitoring tasks to `current-status.md`.

## 7. Validation Plan
*"Validation" here = human spot-checks before & during the burst.*
- [ ] **Pre-Monday (15 min):** Open WF[06] in n8n. Confirm `continueOnFail: true` on Gmail Send + Airtable Update nodes. Confirm node order: Airtable Update (writing `last_reminder_sent_at`) runs ahead of, or atomically with, Gmail Send.
- [ ] **Pre-Monday:** Confirm cron schedule is still 08:00 Asia/Jerusalem (DL-271).
- [ ] **Day 1, 08:00–08:15:** Open n8n executions tab; verify the run is green and processed the expected count. Cross-check Gmail "Sent" folder.
- [ ] **Day 1, 08:00–08:15:** Run `wrangler tail --format pretty` against `annual-reports-api` to catch any callback errors from Gmail / Airtable side-effects on the Worker.
- [ ] **Day 2, 08:00–08:15:** Repeat. Confirm clients reminded on Day 1 who are *not* due again don't get re-sent (sanity check on idempotency).
- [ ] **Day 2:** If a yesterday-reminded client got missed today (DL-154 latent bug surfaced) — promote DL-154 from `[DRAFT]` to a hot-fix.
- [ ] **End of week:** Compare total sent count vs. 422 expected. Discrepancy > 5% triggers a follow-up DL.

## 8. Implementation Notes (Post-Audit)
- Audit produced read-only; no n8n / Worker / frontend changes.
- DL-154 (`reminders/154-fix-reminder-idempotency-calendar-date.md`) confirmed still `[DRAFT]` — Section 8 empty, not in current-status.md. Left as a queued hot-fix candidate, not deployed.
- Worker side (`api/src/routes/reminders.ts:297–304`) confirmed off the cron path — no change to the audit scope.
- Research principles applied: "headroom math first" (Section 6 throughput table), "observability beats prevention for cron jobs" (Section 7 monitoring TODOs), "don't touch the cron right before it fires 422 emails" (no code changes).
