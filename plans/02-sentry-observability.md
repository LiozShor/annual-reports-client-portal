# Sentry + Structured Observability
**Status:** Not started | **Depends on:** none (can run parallel to 01)
**Estimated effort:** 1–2 days

## Goal
`@sentry/cloudflare` integrated into `api/src/index.ts`. Existing `logError` (`api/src/lib/error-logger.ts`) extended to also capture errors to Sentry with PII-scrubbed payloads. JSON-structured log output for queue consumers. "Done" = a forced 500 on staging surfaces in Sentry within 60 seconds with CPA-IDs and Hebrew names redacted.

## Preconditions
- Sentry project provisioned by user; DSN stored as Cloudflare Secret `SENTRY_DSN`.
- Current `logError` contract (`{endpoint, error, category?, details?}`) unchanged — wrapper adds Sentry capture, does not break existing Airtable writes.
- UptimeRobot dashboard (`https://stats.uptimerobot.com/8VXdFEnkD9`) stays live as the independent signal during rollout.

## Steps
1. `npm install @sentry/cloudflare` in `api/`.
2. Wrap Hono app in `api/src/index.ts` with `Sentry.withSentry(...)` or the queue-compatible handler form.
3. Extend `api/src/lib/error-logger.ts`: after Airtable write, call `Sentry.captureException(error, { tags: { endpoint, category } })`.
4. Implement `beforeSend` scrubber:
   - Strip any field matching `/CPA-\d+/`, replace Hebrew name fields (match `/[\u0590-\u05FF]/`) in message/breadcrumb/extra.
   - Drop `Authorization`, `X-Internal-Key`, any `*_token` keys.
5. Deploy to staging: `wrangler deploy` (per CLAUDE.md "always deploy after main push" — same applies to staging).
6. Force a 500 on a test endpoint; verify event in Sentry with scrubbed payload.
7. Enable for production queue consumer (`inbound-email`) last, after 24h staging soak.

## Risks
- **PII leakage** — stack traces can contain real client data; `beforeSend` is the only line of defense. Test with fixtures containing Hebrew + CPA-IDs before prod.
- **Quota burn** — set `tracesSampleRate: 0.1`, errors-only initially.
- **Queue consumer wrapping** — Cloudflare Queues have a different handler shape; verify Sentry's `cloudflare` SDK version supports queue export.
- **Token/secret capture** — explicit denylist in `beforeSend` plus regex for `eyJ...` JWT-ish patterns.

## Rollback
- Remove `Sentry.withSentry(...)` wrapper and `Sentry.captureException` calls.
- `logError` falls back to Airtable-only path (unchanged).
- Remove the `SENTRY_DSN` secret (optional, safe to leave).

## Acceptance criteria
- [ ] Forced 500 on staging endpoint appears in Sentry within 60s.
- [ ] Event does NOT contain `CPA-\d+`, Hebrew characters, auth headers, or JWT-ish tokens.
- [ ] `logError` still writes to the existing Airtable audit log (no regression).
- [ ] `inbound-email` queue consumer errors appear in Sentry after 24h soak.
- [ ] Per CLAUDE.md, live verification on a real inbound email captured without PII leakage before marking `COMPLETED`.

## Out of scope
- Frontend Sentry (admin or client portal) — defer until after React migration (plan 03).
- Performance monitoring / tracing — errors-only in this plan.
- Replacement of Airtable audit log.
