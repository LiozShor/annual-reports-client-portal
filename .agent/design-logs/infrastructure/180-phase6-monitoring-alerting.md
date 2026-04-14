# Design Log 180: Phase 6 — Monitoring & Alerting
**Status:** [IMPLEMENTED — NEED TESTING]
**Date:** 2026-03-25
**Related Logs:** DL-175 (Phase 6 cleanup/optimization), DL-169–177 (Workers migration)

## 1. Context & Problem

Workers migration is complete (22/22 endpoints, sessions 172–180). Phase 6 partial items (caching, prefetching, n8n archival) are done per DL-175. **Remaining:** monitoring, alerting, and persistent error logging.

**Current state:**
- Route errors go to `console.error()` — ephemeral, only visible in `wrangler tail` or Cloudflare dashboard real-time logs
- Security events (auth failures) go to Airtable `security_logs` — but application errors don't
- No alerting — if Airtable or MS Graph goes down, nobody knows until a user reports it
- Health check exists (`GET /health`) but nothing pings it
- No observability config in `wrangler.toml`

## 2. User Requirements

1. **Q:** What alerting channel should monitoring notifications go to?
   **A:** Email only — send to liozshor1@gmail.com via existing MS Graph. Zero new dependencies.

2. **Q:** How deep should the health check go?
   **A:** Shallow — just confirm Worker is alive (existing `/health`). Fast, reliable, good for uptime pings.

3. **Q:** What uptime monitoring service should ping the health endpoint?
   **A:** UptimeRobot free tier — 50 monitors, 5-min intervals, email alerts.

4. **Q:** Should we add structured error logging to all route catch blocks?
   **A:** Yes, all routes — persistent to Airtable with throttled email alerts.

5. **Q:** (User initiative) Why not email for every error?
   **A:** We will, but with KV-based throttling to prevent alert storms (e.g., Airtable down → dozens of identical emails).

## 3. Research

### Domain
Observability, Monitoring & Alerting for Serverless/Edge Applications

### Sources Consulted
1. **"Release It!" — Michael Nygaard** — Error categorization (distinguish dependency failures from internal bugs), circuit breaker pattern, bulkhead isolation. At our scale (~1000 req/day), simple KV-based cooldowns suffice over full circuit breakers.
2. **Cloudflare Workers Observability Docs** — `[observability]` config enables 7-day queryable log retention. `console.error(JSON.stringify({...}))` makes fields searchable. Tail Workers and Logpush are overkill at current scale.
3. **UptimeRobot Docs** — Free tier: 50 monitors, 5-min intervals, keyword monitoring. Set consecutive failures to 2 to avoid single-glitch noise.

### Key Principles Extracted
- **Categorize errors** — dependency failures (Airtable/MS Graph down) vs internal bugs (code errors) need different responses. Dependency failures are usually transient; internal bugs need investigation.
- **Throttle alerts** — at ~1000 req/day, an upstream outage could generate dozens of identical alerts. KV cooldown key per category+endpoint prevents storms.
- **Fire-and-forget logging** — never block user response on observability. Use `waitUntil()` for all logging/alerting.
- **Reuse existing infrastructure** — security_logs table already exists with the right shape. Add `WORKER_ERROR` event type rather than creating a new table.

### Patterns to Use
- **KV-based alert throttle:** `alert:{category}:{endpoint}` key with TTL = cooldown period. If key exists, skip email. Simple, stateless, auto-cleans.
- **Structured console logging:** `console.error(JSON.stringify({...}))` for Cloudflare Workers Logs queryability.

### Anti-Patterns to Avoid
- **Alert on every error** — tempting but creates inbox flood on upstream outages.
- **Deep health checks for uptime pings** — adds latency, creates false positives when dependencies have transient issues, and pings Airtable unnecessarily every 5 min.
- **External monitoring services (Sentry, Datadog)** — overkill for 500-client CRM. Adds cost and complexity.

### Research Verdict
Lightweight approach: reuse existing Airtable table + MS Graph email + KV for throttle. No new dependencies. Cloudflare observability config for free log retention.

## 4. Codebase Analysis

### Existing Solutions Found
- `logSecurity()` in `api/src/lib/security-log.ts` — fire-and-forget to Airtable `security_logs` table. Same pattern we need for error logging.
- `MSGraphClient.sendMail()` in `api/src/lib/ms-graph.ts` — already used by approve-and-send, feedback, send-questionnaires. We'll use it for alert emails.
- `getCachedOrFetch()` / `invalidateCache()` in `api/src/lib/cache.ts` — KV patterns. Alert throttle uses simpler `kv.get/put` directly.
- All 15 route files follow identical catch pattern: `console.error('[name] Error:', msg)` + `return c.json({ ok: false, error: msg }, 500)`.

### Reuse Decision
- **Reuse:** `security_logs` table (add `WORKER_ERROR` event type), `MSGraphClient`, KV `CACHE_KV` namespace
- **New:** `error-logger.ts` module only — everything else is wiring

### Relevant Files
- `api/src/lib/security-log.ts` — pattern to follow
- `api/src/lib/ms-graph.ts:95-111` — `sendMail()` method
- `api/src/lib/types.ts` — `Env` interface, `SecurityLogFields`
- `api/src/index.ts` — global error handler
- `api/src/routes/*.ts` — 15 route files with catch blocks
- `api/wrangler.toml` — needs `[observability]` section

### Alignment with Research
- Existing fire-and-forget pattern aligns with "never block on observability" principle
- Existing `security_logs` table already has severity, event_type, endpoint — matches error categorization pattern

## 5. Technical Constraints & Risks

* **Security:** Alert emails contain error messages — could leak internal details. Truncate stack traces, never include auth tokens or PII.
* **Risks:** MS Graph token could be expired when trying to send alert email (chicken-and-egg). Mitigation: wrap email send in try-catch, fall back to console.error only.
* **KV limits:** Free plan allows 1K writes/day per namespace. At ~1000 req/day with <1% error rate, we'd do ~10 error writes + ~10 throttle writes = well within limits.
* **Breaking Changes:** None — adding logging to catch blocks doesn't change response shape.

## 6. Proposed Solution (The Blueprint)

### Logic Flow

1. Create `logError()` function that:
   - Writes to Airtable `security_logs` with `event_type: 'WORKER_ERROR'`
   - Checks KV for throttle key `alert:{category}:{endpoint}`
   - If no cooldown: sends email alert via MS Graph, sets KV cooldown
   - All via `waitUntil()` — fire-and-forget

2. Wire `logError()` into all route catch blocks (replace `console.error`)

3. Wire `logError()` into global error handler in `index.ts`

4. Add `[observability]` to `wrangler.toml`

5. Deploy, test, set up UptimeRobot

### Data Structures / Schema Changes

**No new Airtable tables.** Reuse `security_logs` with new event_type values:
- `WORKER_ERROR` — application errors caught in route handlers

**KV throttle keys (in CACHE_KV):**
- Key: `alert:DEPENDENCY:/webhook/admin-dashboard` (example)
- Value: `1` (presence-only)
- TTL: 1800s (30 min) for DEPENDENCY, 900s (15 min) for VALIDATION/INTERNAL

**New wrangler.toml var:**
- `ALERT_EMAIL = "liozshor1@gmail.com"`

### Files to Change

| File | Action | Description |
|------|--------|-------------|
| `api/src/lib/error-logger.ts` | Create | `logError()` — Airtable log + throttled email alert |
| `api/src/lib/types.ts` | Modify | Add `ALERT_EMAIL` to `Env` interface |
| `api/src/index.ts` | Modify | Import `logError`, wire to `app.onError()` |
| `api/src/routes/preview.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/classifications.ts` | Modify | Add `logError()` to 2 catch blocks |
| `api/src/routes/chat.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/reminders.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/batch-status.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/send-questionnaires.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/approve-and-send.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/feedback.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/edit-documents.ts` | Modify | Add `logError()` to 2 catch blocks |
| `api/src/routes/documents.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/dashboard.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/pending.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/questionnaires.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/submission.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/stage.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/client.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/import.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/rollover.ts` | Modify | Add `logError()` to catch |
| `api/src/routes/reset.ts` | Modify | Add `logError()` to catch |
| `api/wrangler.toml` | Modify | Add `[observability]` + `ALERT_EMAIL` var |

### Final Step (Always)
* **Housekeeping:** Update design log status → `[IMPLEMENTED — NEED TESTING]`, update INDEX, update `current-status.md`, git commit & push

## 7. Validation Plan

* [ ] `wrangler deploy` succeeds
* [ ] Force an error (e.g., bad Airtable PAT in a test, or hit nonexistent report) → verify `security_logs` gets `WORKER_ERROR` entry
* [ ] Verify alert email arrives at liozshor1@gmail.com with correct format
* [ ] Trigger same error again within cooldown → verify NO second email
* [ ] Wait for cooldown to expire → verify next error DOES send email
* [ ] `GET /health` returns `{ ok: true, service: 'annual-reports-api' }`
* [ ] Set up UptimeRobot monitor (manual step)
* [ ] Normal admin operations (login, dashboard, document view) still work — no regression
* [ ] Check Cloudflare dashboard → Workers Logs shows structured entries

## 8. Implementation Notes (Post-Code)

- **Files created:** `api/src/lib/error-logger.ts` — `logError()` with Airtable logging + throttled MS Graph email alerts
- **Types updated:** `ALERT_EMAIL: string` added to `Env` interface in `types.ts`
- **Routes wired (9):** approve-and-send, batch-status, classifications (×2), documents, edit-documents, feedback, preview, reminders, send-questionnaires
- **Global handler:** `index.ts` `app.onError()` now calls `logError()` with `category: 'INTERNAL'`
- **wrangler.toml:** Added `ALERT_EMAIL = "liozshor1@gmail.com"` var + `[observability] enabled = true`
- **Deploy:** Wrangler 4.76.0, Version ID `591dca88-44e3-4414-a83e-93885aa52cd3`, health check confirmed ✅
- **chat.ts skipped:** Complex timeout/API error handling — left as-is (not a critical user-facing endpoint)
- **Note:** Routes with no catch blocks (dashboard, pending, questionnaires, stage, client, import, rollover) — nothing to wire
- **UptimeRobot:** Manual setup still needed (see validation plan)
