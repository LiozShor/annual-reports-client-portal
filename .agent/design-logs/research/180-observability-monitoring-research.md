# DL-180: Observability & Monitoring Research

**Date:** 2026-03-25
**Status:** Research Complete
**Purpose:** Actionable patterns for monitoring the Cloudflare Workers API layer (~1000 req/day, 500 clients)

---

## Source 1: Cloudflare Workers Built-in Observability

### What's Available (no code changes)

| Feature | Plan | What It Does | Limits |
|---------|------|-------------|--------|
| **Workers Logs** | Free: 200K/day, 3d retention. Paid: 20M/mo incl, $0.60/M extra, 7d retention | Auto-captures console.log, errors, request metadata. Queryable in dashboard. | 256KB per log entry, truncated above |
| **Metrics/Analytics** | All plans | Request counts, error rates, CPU time, wall time, P50/P90 latency. Per-worker and zone-wide. | Built-in, no config needed |
| **Real-time Logs** | All plans | `wrangler tail` CLI or dashboard Live tab. Streams invocations as they happen. | Max 10 concurrent viewers. High-traffic enters sampling mode. Not persisted. |
| **Tail Workers** | Paid only | Separate Worker receives events from producer Workers. Can filter, transform, forward to external services. | Must deploy as separate Worker |
| **Logpush** | Paid only | Push trace events to R2, S3, or logging providers. `logpush = true` in wrangler.toml. | 16,384 char combined limit on logs+exceptions fields |
| **Traces** | All plans (billed from 2026-03-01) | OpenTelemetry-compatible distributed tracing. Auto-instruments fetch calls, KV ops, handler invocations. | No code changes needed |

### Config Required in wrangler.toml

```toml
[observability]
enabled = true
head_sampling_rate = 1   # 1 = 100% of requests logged. Lower for high traffic.
```

**At our scale (~1000 req/day):** `head_sampling_rate = 1` is fine. 1000/day = ~30K/month, well within the 20M paid tier inclusion.

### Key Patterns

1. **Structured JSON logging** — `console.log({ event: 'airtable_error', table: 'Reports', status: 422, duration_ms: 150 })` not `console.log('Airtable error: 422')`. Workers Logs indexes JSON fields for querying.
2. **Use correct log levels** — `console.error()` for errors, `console.warn()` for warnings. These show at correct severity in the dashboard query builder.
3. **Dashboard query builder** — filter by `$workers.outcome = "exception"`, `$metadata.error EXISTS`, or custom JSON fields in log entries. Supports aggregations (count, avg, percentile), group-by, time range.

### Anti-Patterns

- Do NOT rely on `wrangler tail` for production debugging — it's ephemeral and enters sampling under load.
- Do NOT use `passThroughOnException()` — it hides bugs. Use explicit try/catch.
- Do NOT store request-scoped data in global variables — isolates are reused across requests, causing data leaks.

---

## Source 2: Structured Error Logging for Edge/Serverless

### Error Categorization (from "Release It!" principles)

Classify every error into one of five categories. This determines retry behavior and alerting:

| Category | Retry? | Alert? | Example |
|----------|--------|--------|---------|
| **VALIDATION** | No | No | Missing required field, invalid token format |
| **BUSINESS** | No | No | Client already approved, duplicate submission |
| **DEPENDENCY** | Yes (with backoff) | Yes (throttled) | Airtable 503, MS Graph 429 |
| **INFRA** | No | Yes (immediate) | KV binding missing, secret not set |
| **UNKNOWN** | No | Yes (immediate) | Unhandled exception, unexpected shape |

### Implementation Pattern — Structured Error Envelope

```ts
interface ErrorLog {
  category: 'VALIDATION' | 'BUSINESS' | 'DEPENDENCY' | 'INFRA' | 'UNKNOWN';
  error: string;
  route: string;          // e.g., 'POST /webhook/approve-and-send'
  dependency?: string;    // e.g., 'airtable', 'ms-graph'
  status?: number;        // upstream HTTP status
  duration_ms: number;
  request_id: string;     // crypto.randomUUID()
  retryable: boolean;
}
```

Log with: `console.error(JSON.stringify(errorLog))` — Workers Logs auto-indexes all fields.

### "Release It!" Patterns Applied to This System

**1. Circuit Breaker for Airtable**
- Store state in KV: `{ status: 'closed'|'open'|'half-open', failureCount: N, openedAt: timestamp }`
- Key: `circuit:airtable`
- Thresholds: open after 5 consecutive failures, half-open after 60s cooldown
- Hysteresis: trips at threshold, recovers only after 2 consecutive successes in half-open
- When open: return `{ ok: false, error: 'Service temporarily unavailable' }` with 503
- At our scale (~1000 req/day): a single KV read per request is negligible cost

**2. Timeouts**
- Airtable API: 10s timeout (default fetch has no timeout in Workers)
- MS Graph API: 15s timeout (token refresh can be slow)
- n8n webhook callbacks: 10s timeout
- Pattern: `AbortSignal.timeout(10000)` passed to fetch

**3. Bulkheads (Resource Isolation)**
- Airtable failures must NOT prevent auth/token operations (which use KV only)
- MS Graph failures must NOT prevent Airtable reads
- Pattern: independent try/catch per dependency, never chain unrelated calls

**4. Fail Fast**
- Check circuit breaker state BEFORE making the request
- Validate request shape BEFORE touching any dependency
- Check token validity BEFORE any business logic

**5. Steady State**
- KV entries for circuit state must have TTL (expirationTtl: 3600) — auto-cleanup
- Error logs are auto-purged by Workers Logs retention (7 days)

### Anti-Patterns

- **No timeout on fetch calls** — Airtable can hang for 30s+ during incidents. Without AbortSignal, you burn CPU time and the 30s waitUntil budget.
- **Retrying non-retryable errors** — 422 (validation), 401 (bad credentials), 404 (wrong record ID) will never succeed on retry. Only retry 429, 500, 502, 503.
- **Global error counter without windowing** — "5 errors" means nothing without "in what time period?" Always use a sliding window.

---

## Source 3: UptimeRobot Setup

### What to Monitor

| Monitor | Type | URL | Check | Interval |
|---------|------|-----|-------|----------|
| **Health endpoint** | Keyword | `https://annual-reports-api.liozshor1.workers.dev/health` | Keyword: `"ok":true` | 5 min (free tier) |
| **Auth endpoint** | HTTP | `https://annual-reports-api.liozshor1.workers.dev/webhook/admin-auth` | Status: 401 (no creds = expected rejection) | 5 min |
| **Airtable dependency** | Keyword | Custom health route (see below) | Keyword: `"airtable":"up"` | 5 min |
| **GitHub Pages** | HTTP | `https://liozshor.github.io/annual-reports-client-portal/` | Status: 200 | 5 min |

### Deep Health Check Endpoint

Add a `/health/deep` route that actually tests dependencies:

```ts
app.get('/health/deep', async (c) => {
  const checks: Record<string, 'up' | 'down'> = {};

  // Test Airtable
  try {
    const at = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
    await at.listRecords('Reports', { maxRecords: 1, fields: ['Name'] });
    checks.airtable = 'up';
  } catch { checks.airtable = 'down'; }

  // Test KV
  try {
    await c.env.CACHE_KV.put('_health', 'ok', { expirationTtl: 60 });
    checks.kv = 'up';
  } catch { checks.kv = 'down'; }

  const allUp = Object.values(checks).every(v => v === 'up');
  return c.json({ ok: allUp, checks }, allUp ? 200 : 503);
});
```

UptimeRobot keyword monitor checks for `"ok":true` — catches both Worker crashes AND dependency failures.

### Configuration Best Practices

1. **Free tier: 50 monitors, 5-minute intervals.** More than enough for this project.
2. **Alert contacts:** Email (primary) + Slack/webhook (optional). Test alerts after setup.
3. **Consecutive failures before alerting:** Set to 2 (10 minutes). Avoids false alarms from single transient glitches or deployment blips.
4. **Keyword monitors over HTTP monitors:** A 200 response with `{"ok":false}` is still a failure. Keyword monitors catch this; HTTP monitors don't.
5. **Monitor naming convention:** `[AR-API] Health`, `[AR-API] Airtable`, `[AR-Pages] Frontend`. Prefix groups related monitors.
6. **Status page:** UptimeRobot free tier includes a public status page. Consider sharing with Natan for visibility.

### Anti-Patterns

- **Monitoring only the health endpoint** — `/health` returns `{ok:true}` even when Airtable is down. You need `/health/deep` for real dependency checking.
- **1-minute check intervals on free tier** — Not available. Don't upgrade just for interval; 5 minutes is fine for a CRM with office-hours traffic.
- **Alerting on every flicker** — Single check failures are noise. Always require 2+ consecutive failures.

---

## Source 4: Self-Hosted Error Alerting (Email via MS Graph + KV Dedup)

### The Problem

Airtable goes down for 5 minutes. 50 requests fail. Without throttling: 50 error emails to the developer. This is an alert storm.

### Solution: KV-Based Alert Throttle

```
KV key:    alert:{category}:{dependency}
KV value:  { count: N, firstSeen: timestamp, lastAlerted: timestamp }
KV TTL:    3600 (1 hour auto-cleanup)
```

### Alert Decision Logic

```
For each error:
  1. Build dedup key: `alert:DEPENDENCY:airtable` or `alert:UNKNOWN:unhandled`
  2. Read KV entry for this key
  3. If no entry:
     - Create entry { count: 1, firstSeen: now, lastAlerted: now }
     - Send alert email
  4. If entry exists:
     - Increment count
     - If (now - lastAlerted) > COOLDOWN_MINUTES:
       Send digest email: "X errors in last Y minutes"
       Update lastAlerted = now
     - Else: skip (still in cooldown)
```

### Cooldown Windows

| Error Category | Cooldown | Rationale |
|---------------|----------|-----------|
| DEPENDENCY | 30 min | Airtable/Graph outages last 5-30 min typically |
| INFRA | 60 min | Config issues won't self-resolve |
| UNKNOWN | 15 min | Needs attention, but don't flood |

### Email Alert Format

```
Subject: [AR-API] DEPENDENCY error: airtable (12 occurrences)

Body:
- First seen: 14:32 UTC
- Last seen: 14:47 UTC
- Count: 12
- Sample error: "Airtable listRecords error: 503 Service Unavailable"
- Route: POST /webhook/dashboard-data
```

### MS Graph Rate Limits

- 10,000 requests per 10 minutes per app+mailbox combination
- 4 concurrent requests max
- At our alert volume (worst case ~10 alert emails/day): nowhere near limits
- Always handle 429 with Retry-After header

### Implementation Pattern — waitUntil for Fire-and-Forget Alerting

```ts
// In global error handler or route catch blocks:
ctx.waitUntil(
  maybeAlert(env, {
    category: 'DEPENDENCY',
    dependency: 'airtable',
    error: err.message,
    route: c.req.path,
  })
);
// Response already sent to client — alerting is async
```

The `maybeAlert` function:
1. Reads KV for dedup key (1 KV read)
2. If cooldown active: writes incremented count (1 KV write), returns
3. If cooldown expired or first error: sends email via MS Graph, writes new state (1 KV write)

**Cost at scale:** Worst case ~100 errors/day = 200 KV ops/day. KV free tier: 100K reads + 1K writes/day. Well within limits.

### Anti-Patterns

- **One email per error** — Alert storm. Always dedup by category+dependency.
- **No cooldown window** — Even with dedup keys, if the key expires after each alert, you get re-alerted every time. The cooldown must be time-based, not count-based.
- **Alerting on VALIDATION errors** — Bad user input is not an operational issue. Log it, don't alert.
- **No error count in digest** — "Airtable is down" tells you nothing about impact. "Airtable is down — 47 failed requests in 15 minutes" tells you the blast radius.
- **Sending alerts from within the request path** — Use `waitUntil()`. Never block the user response to send an alert email.

---

## Summary: Implementation Priorities

### Must-Have (Week 1)

1. **Enable Workers Logs** — Add `[observability]` block to wrangler.toml. Zero code changes.
2. **Structured error logging** — Replace `console.error('message')` with `console.error(JSON.stringify({ category, error, route, ... }))` in the global error handler and AirtableClient.
3. **UptimeRobot** — Set up 3-4 monitors (health, deep-health, frontend). Takes 10 minutes.
4. **Fetch timeouts** — Add `AbortSignal.timeout()` to all external calls (Airtable, MS Graph).

### Should-Have (Week 2)

5. **Deep health endpoint** — `/health/deep` that tests Airtable + KV.
6. **KV alert throttle** — `maybeAlert()` function with cooldown windows.
7. **Error categorization** — Classify errors in catch blocks (VALIDATION/DEPENDENCY/INFRA/UNKNOWN).

### Nice-to-Have (Later)

8. **Circuit breaker for Airtable** — Only valuable if Airtable has frequent outages. Monitor first, implement if needed.
9. **Tail Worker** — For custom log processing. Not needed until logging volume or complexity grows.
10. **Logpush to R2** — Long-term log retention beyond 7 days. Only if needed for compliance.

---

## Sources

- [Cloudflare Workers Observability Overview](https://developers.cloudflare.com/workers/observability/)
- [Workers Logs Documentation](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Real-time Logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)
- [Tail Workers](https://developers.cloudflare.com/workers/observability/logs/tail-workers/)
- [Workers Logpush](https://developers.cloudflare.com/workers/observability/logs/logpush/)
- [Workers Errors and Exceptions](https://developers.cloudflare.com/workers/observability/errors/)
- [Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Introducing Workers Observability (blog)](https://blog.cloudflare.com/introducing-workers-observability-logs-metrics-and-queries-all-in-one-place/)
- [Release It! Book Review (Ben Nadel)](https://www.bennadel.com/blog/3162-release-it-design-and-deploy-production-ready-software-by-michael-t-nygard.htm)
- [Circuit Breaker Pattern (Martin Fowler)](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Circuit Breaker for Serverless (Fenergo)](https://resources.fenergo.com/engineering-at-fenergo/circuit-breaker-pattern-for-serverless-applications)
- [Usage Circuit Breaker for CF Workers (HN)](https://news.ycombinator.com/item?id=47322794)
- [UptimeRobot API Monitoring](https://uptimerobot.com/api-monitoring/)
- [UptimeRobot Monitoring Types Guide](https://uptimerobot.com/knowledge-hub/monitoring/ultimate-guide-to-uptime-monitoring-types/)
- [UptimeRobot Check Intervals](https://help.uptimerobot.com/en/articles/11360876-what-is-a-monitoring-interval-in-uptimerobot)
- [Opsgenie Alert Deduplication](https://support.atlassian.com/opsgenie/docs/what-is-alert-de-duplication/)
- [Prometheus Alertmanager Noise Reduction](https://www.netdata.cloud/academy/prometheus-alert-manager/)
- [MS Graph Throttling Limits](https://learn.microsoft.com/en-us/graph/throttling-limits)
- [MS Graph Throttling Guidance](https://learn.microsoft.com/en-us/graph/throttling)
