#!/usr/bin/env node
/**
 * query-activity-logs.mjs — query structured logEvent() events from R2 archive
 *
 * Reads NDJSON files written by the Worker's AsyncLocalStorage flush pipeline.
 * No 7-day limit — covers all archived history.
 *
 * Usage:
 *   source .env && node scripts/query-activity-logs.mjs --since=24h
 *   node scripts/query-activity-logs.mjs --since=7d --event-type=auth_success
 *   node scripts/query-activity-logs.mjs --since=1h --actor=admin
 *   node scripts/query-activity-logs.mjs --from=2026-04-30T07:00:00Z --search=doc_approve
 *
 * Env (source .env first):
 *   R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *
 * Requires: aws CLI with S3 support (uses R2 S3-compat API)
 */

import { execSync, spawnSync } from 'node:child_process';

const ENDPOINT   = process.env.R2_S3_ENDPOINT;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET     = 'activity-logs-archive';

if (!ENDPOINT || !ACCESS_KEY || !SECRET_KEY) {
  console.error('missing R2_S3_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY — source .env first');
  process.exit(1);
}

const awsEnv = {
  ...process.env,
  AWS_ACCESS_KEY_ID: ACCESS_KEY,
  AWS_SECRET_ACCESS_KEY: SECRET_KEY,
  AWS_DEFAULT_REGION: 'auto',
};

// ── Parse CLI args ────────────────────────────────────────────────────────────
function parseDuration(s) {
  const m = s.match(/^(\d+)(m|h|d)$/);
  if (!m) return null;
  const n = parseInt(m[1]);
  return n * (m[2] === 'm' ? 60 : m[2] === 'h' ? 3600 : 86400) * 1000;
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => a.replace(/^--/, '').split(/=(.+)/)).map(([k, v]) => [k, v ?? true])
);

const nowMs    = Date.now();
let sinceMs    = nowMs - 24 * 60 * 60 * 1000; // default 24h
let untilMs    = nowMs;

if (args.since)  sinceMs = nowMs - (parseDuration(args.since) ?? 86400000);
if (args.from)   sinceMs = new Date(args.from).getTime();
if (args.to)     untilMs = new Date(args.to).getTime();
if (args.until)  untilMs = new Date(args.until).getTime();

const filterEventType = args['event-type'] ?? args['event_type'] ?? null;
const filterActor     = args.actor ?? null;
const filterClientId  = args['client-id'] ?? args['client_id'] ?? null;
const filterSearch    = args.search ?? null;
const limit           = parseInt(args.limit ?? '200');
const jsonMode        = args.json === true || args.json === 'true';

// ── Build list of date prefixes to scan ──────────────────────────────────────
const prefixes = [];
const cursor = new Date(sinceMs);
cursor.setUTCHours(0, 0, 0, 0);
while (cursor.getTime() <= untilMs && prefixes.length < 30) {
  const y = cursor.getUTCFullYear();
  const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
  const d = String(cursor.getUTCDate()).padStart(2, '0');
  prefixes.push(`${y}-${m}-${d}/`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
}

// ── List R2 objects for each prefix ──────────────────────────────────────────
function awsS3(args) {
  const r = spawnSync('aws', ['s3', ...args, '--endpoint-url', ENDPOINT], { env: awsEnv, encoding: 'utf8' });
  if (r.error) { console.error('aws error:', r.error.message); process.exit(1); }
  return r.stdout ?? '';
}

const keys = [];
for (const prefix of prefixes) {
  const out = awsS3(['ls', `s3://${BUCKET}/${prefix}`]);
  for (const line of out.split('\n')) {
    const match = line.match(/(\S+)\s*$/);
    if (match && (match[1].endsWith('.ndjson') || match[1].endsWith('.json') || match[1].endsWith('.json.gz'))) {
      keys.push(prefix + match[1]);
    }
  }
}

console.error(`[query-activity-logs] scanning ${keys.length} files in ${prefixes.length} days | ${new Date(sinceMs).toISOString()} → ${new Date(untilMs).toISOString()}`);

// ── Fetch + filter events ─────────────────────────────────────────────────────
const results = [];

for (const key of keys) {
  if (results.length >= limit) break;
  try {
    const raw = awsS3(['cp', `s3://${BUCKET}/${key}`, '-']);
    for (const line of raw.split('\n')) {
      if (results.length >= limit) break;
      const t = line.trim();
      if (!t) continue;
      let ev;
      try { ev = JSON.parse(t); } catch { continue; }
      if (!ev.event_type) continue;

      const evMs = ev.ts ? new Date(ev.ts).getTime() : 0;
      if (evMs < sinceMs || evMs > untilMs) continue;
      if (filterEventType && ev.event_type !== filterEventType) continue;
      if (filterActor && ev.actor !== filterActor) continue;
      if (filterClientId && ev.client_id !== filterClientId) continue;
      if (filterSearch && !JSON.stringify(ev).includes(filterSearch)) continue;

      results.push(ev);
    }
  } catch { /* skip bad file */ }
}

console.error(`[query-activity-logs] ${results.length} events matched`);

// ── Output ────────────────────────────────────────────────────────────────────
if (jsonMode) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const ev of results) {
    const ts  = ev.ts ?? '?';
    const et  = (ev.event_type ?? '').padEnd(28);
    const cat = (ev.category ?? '').padEnd(6);
    const sev = (ev.severity ?? 'INFO').padEnd(5);
    const actor = ev.actor ? `actor:${ev.actor}  ` : '';
    const ep  = ev.endpoint ? `${ev.endpoint}  ` : '';
    const det = ev.details ? JSON.stringify(ev.details) : '';
    const err = ev.error ? `ERROR: ${ev.error.message}` : '';
    console.log(`${ts}  ${sev} ${cat} ${et}  ${actor}${ep}${det}${err}`);
  }
}
