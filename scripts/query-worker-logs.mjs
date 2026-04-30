#!/usr/bin/env node
/**
 * query-worker-logs.mjs — query Cloudflare Workers Observability API
 *
 * Shows HTTP traces + console.log output from annual-reports-api.
 * Uses CF Observability Telemetry API (7-day hot window).
 *
 * Usage:
 *   source .env && node scripts/query-worker-logs.mjs --since=1h
 *   node scripts/query-worker-logs.mjs --since=30m --level=error
 *   node scripts/query-worker-logs.mjs --since=2h --search="auth_success"
 *   node scripts/query-worker-logs.mjs --from=2026-04-30T07:00:00Z --to=2026-04-30T08:00:00Z
 *
 * Env (source .env first):
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN  (needs Account > Workers Observability > Read)
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN  = process.env.CLOUDFLARE_API_TOKEN;
const WORKER     = 'annual-reports-api';
const BASE_URL   = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/observability/telemetry`;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID in env — source .env first');
  process.exit(1);
}

// ── Parse CLI args ────────────────────────────────────────────────────────────
function parseDuration(s) {
  const m = s.match(/^(\d+)(m|h|d)$/);
  if (!m) return null;
  const n = parseInt(m[1]);
  return n * (m[2] === 'm' ? 60 : m[2] === 'h' ? 3600 : 86400) * 1000;
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => a.replace(/^--/, '').split('='))
);

const nowMs  = Date.now();
let sinceMs  = nowMs - 60 * 60 * 1000; // default 1h
let untilMs  = nowMs;

if (args.since)  sinceMs = nowMs - (parseDuration(args.since) ?? 3600000);
if (args.from)   sinceMs = new Date(args.from).getTime();
if (args.to)     untilMs = new Date(args.to).getTime();
if (args.until)  untilMs = new Date(args.until).getTime();

const searchTerm = args.search ?? null;
const levelFilter = args.level ?? null;   // error | warn | log | info
const limit = parseInt(args.limit ?? '100');

// ── Build filters ─────────────────────────────────────────────────────────────
const filters = [
  { key: '$workers.scriptName', operation: 'includes', type: 'string', value: WORKER },
];
if (levelFilter) {
  filters.push({ key: 'source.level', operation: 'eq', type: 'string', value: levelFilter });
}
if (searchTerm) {
  filters.push({ key: 'source.message', operation: 'includes', type: 'string', value: searchTerm });
}

// ── Query ─────────────────────────────────────────────────────────────────────
const res = await fetch(`${BASE_URL}/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    queryId: `agent-query-${Date.now()}`,
    timeframe: { from: sinceMs, to: untilMs },
    parameters: { filters, limit },
    view: 'events',
  }),
});

if (!res.ok) {
  console.error('CF API error:', res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
if (!data.success) {
  console.error('CF API error:', JSON.stringify(data.errors));
  process.exit(1);
}

const events = data?.result?.events?.events ?? [];
console.error(`[query-worker-logs] ${events.length} events | ${new Date(sinceMs).toISOString()} → ${new Date(untilMs).toISOString()}`);

// ── Output ────────────────────────────────────────────────────────────────────
for (const ev of events) {
  const ts  = new Date(ev.timestamp).toISOString();
  const lvl = (ev.source?.level ?? 'info').toUpperCase().padEnd(5);
  const msg = ev.source?.message ?? JSON.stringify(ev);
  const status = ev.$workers?.event?.response?.status;

  // Try to parse structured logEvent JSON from message
  let parsed = null;
  try { parsed = JSON.parse(msg); } catch { /* raw message */ }

  if (parsed?.event_type) {
    // Our structured logEvent — print compact
    const et   = parsed.event_type.padEnd(28);
    const cat  = (parsed.category ?? '').padEnd(6);
    const sev  = (parsed.severity ?? 'INFO').padEnd(5);
    console.log(`${ts}  ${sev} ${cat} ${et}  ${parsed.endpoint ?? ''}${parsed.details ? '  ' + JSON.stringify(parsed.details) : ''}`);
  } else {
    // Raw HTTP trace or other log
    const statusStr = status ? ` [${status}]` : '';
    console.log(`${ts}  ${lvl}${statusStr}  ${String(msg).slice(0, 160)}`);
  }
}
