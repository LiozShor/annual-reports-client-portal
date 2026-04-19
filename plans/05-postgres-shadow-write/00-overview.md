# Postgres (Neon) + Drizzle — Shadow-Write Overview
**Status:** Not started | **Depends on:** 01 (optional — cleaner types help)
**Estimated effort:** 5–7 days (including 7-day soak)

## Goal
Introduce Neon Postgres + Drizzle ORM as a **secondary write target** for one bounded context — proposal: the audit-log table (`tblVjLznorm0jrRtd` in Airtable base `appqBL5RWQN9cPOyh`). Airtable remains the read path and SSOT. "Done" = 7 days of dual-write with row counts matching ±0.5% and no Worker error-rate increase. This plan does NOT cut reads over.

## Why audit_logs first
- **Append-only** — no updates or deletes to reconcile.
- **No downstream n8n consumer** reads it; n8n will not break.
- **Easy diff** — row count + primary key set comparison is sufficient.
- **Low blast radius** — if Postgres is down, we swallow the error and Airtable still records.

## Preconditions
- Neon project provisioned by user; connection string in Cloudflare Secret `DATABASE_URL`.
- (Optional) Hyperdrive binding for connection pooling — recommend for Workers.
- Drizzle installed in `api/` (`drizzle-orm`, `drizzle-kit`).
- Schema for `audit_logs` matches Airtable field types (TEXT for IDs, TIMESTAMPTZ for dates, JSONB for details).

## Steps
1. `npm install drizzle-orm drizzle-kit` in `api/`. Add `drizzle.config.ts`.
2. Define `audit_logs` schema in `api/src/db/schema.ts` mirroring the Airtable table.
3. Generate migration: `drizzle-kit generate`. Commit migration SQL.
4. Apply migration to Neon (manual step; document in `api/src/db/README.md`).
5. Wrap `logError` in `api/src/lib/error-logger.ts`:
   - Write to Airtable (existing path, unchanged).
   - **Then** write to Postgres via Drizzle. Errors caught and logged, never thrown.
6. Deploy to staging. Exercise with 20+ errors (forced).
7. Verify row parity: Airtable count = Postgres count.
8. Promote to production. Start 7-day soak.
9. Daily: row-count diff + spot-check 5 random rows for field equality.

## Risks
- **Write amplification** — each error write becomes two network calls. Keep Postgres write async/fire-and-forget via `ctx.waitUntil` so it does not block the Worker response.
- **Dual-write partial failure** — Airtable succeeds, Postgres fails (or vice versa). Acceptable short-term; we're measuring. Alert if Postgres failure rate > 1%.
- **n8n workflow breakage** — n8n reads audit data from Airtable. Shadow write must not change Airtable shape or create fields. Verified by: no `drizzle-kit` command touches Airtable.
- **Connection pool exhaustion** — Workers don't hold connections; use Hyperdrive or direct `postgres` driver with pooled URL from Neon.
- **PII duplication** — audit logs may contain Hebrew names / CPA-IDs. Postgres backup policy must match Airtable's retention. Confirm with user before enabling prod.
- **Secret sprawl** — `DATABASE_URL` is new. Document in deployment runbook.

## Rollback
- Disable Postgres write: comment out the Drizzle call in `logError`. Redeploy. Airtable path unaffected.
- Keep `DATABASE_URL` secret (safe unused).
- Optional: `TRUNCATE audit_logs` on Neon if starting over.

## Acceptance criteria
- [ ] Migration applied cleanly on Neon.
- [ ] Staging: 20+ forced errors result in 20+ rows in both Airtable and Postgres.
- [ ] Production: 7-day soak with row counts ±0.5%.
- [ ] Worker error-rate (Sentry, once plan 02 is live) shows no regression.
- [ ] Spot-check 5 random rows: all fields equal between Airtable and Postgres (modulo type coercion).
- [ ] Per CLAUDE.md: live verification before `COMPLETED`. Not a dry-run.

## Decision needed
Confirm `audit_logs` as the shadow-write target. Alternative is a new table, but audit_logs gives the cleanest signal.

## Out of scope
- Cutting any read over to Postgres.
- Migrating any other Airtable table.
- Using Postgres for new features.
- Backfilling historical Airtable rows into Postgres (forward-only writes).
- Client portal data paths.
