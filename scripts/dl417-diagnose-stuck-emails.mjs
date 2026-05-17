#!/usr/bin/env node
/**
 * dl417-diagnose-stuck-emails.mjs — diagnose every stuck `email_events` row
 *
 * For each Airtable `email_events` record where processing_status != 'Completed',
 * cross-reference:
 *   - Airtable: linked `report.client_notes` (body summary survived?)
 *               linked `pending_classifications[]` (attachments survived?)
 *   - R2 `activity-logs-archive`: any logEvent() for the source_message_id
 *
 * Emits Markdown report to tmp/dl417-stuck-email-events-YYYY-MM-DD.md
 * (kept out of .agent/ — Airtable recIds trip the PII guard. record IDs +
 * client_id only; no names/emails — see DL-365 sanitization).
 *
 * OneDrive presence-checks happen in the Worker route (Track B), not here —
 * MS Graph client-credentials flow lives in the Worker.
 *
 * Usage:
 *   source .env && node scripts/dl417-diagnose-stuck-emails.mjs
 *   node scripts/dl417-diagnose-stuck-emails.mjs --since=30d --limit=200
 *   node scripts/dl417-diagnose-stuck-emails.mjs --no-r2     # skip R2 probe (faster)
 *
 * Env (source .env first):
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID
 *   R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  (optional, only for R2 probe)
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ── Config ────────────────────────────────────────────────────────────────────
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appqBL5RWQN9cPOyh';

if (!AIRTABLE_API_KEY) {
  console.error('missing AIRTABLE_API_KEY — source .env first');
  process.exit(1);
}

const TBL_EMAIL_EVENTS = 'tblJAPEcSJpzdEBcW';
const TBL_REPORTS      = 'tbls7m3hmHC4hhQVy';
const TBL_PENDING      = 'tbloiSDN3rwRcl1ii';

const BUCKETS = {
  STUCK:            new Set(['Failed', 'Detected']),
  ACTION_REQUIRED:  new Set(['NeedsHuman', 'PasswordReply']),
  TERMINAL_EXPECTED:new Set(['Bounced', 'Discarded']),
};

function bucketOf(status) {
  if (!status) return 'STUCK'; // null = stuck (never updated)
  for (const [name, set] of Object.entries(BUCKETS)) if (set.has(status)) return name;
  return 'UNKNOWN';
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => a.replace(/^--/, '').split(/=(.+)/)).map(([k, v]) => [k, v ?? true])
);
const sinceArg = args.since ?? null;
const limit    = parseInt(args.limit ?? '500', 10);
const skipR2   = args['no-r2'] === true || args['no-r2'] === 'true';

function parseDurationMs(s) {
  const m = String(s).match(/^(\d+)(m|h|d)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n * (m[2] === 'm' ? 60 : m[2] === 'h' ? 3600 : 86400) * 1000;
}

// ── Airtable REST helper (paginated list) ─────────────────────────────────────
async function airtableList(tableId, opts = {}) {
  const params = new URLSearchParams();
  if (opts.filterByFormula) params.set('filterByFormula', opts.filterByFormula);
  if (opts.fields) for (const f of opts.fields) params.append('fields[]', f);
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.sort) for (let i = 0; i < opts.sort.length; i++) {
    params.append(`sort[${i}][field]`, opts.sort[i].field);
    params.append(`sort[${i}][direction]`, opts.sort[i].direction || 'desc');
  }

  const out = [];
  let offset = '';
  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}?${params.toString()}${offset ? `&offset=${offset}` : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Airtable list ${tableId} ${r.status}: ${body.slice(0, 200)}`);
    }
    const j = await r.json();
    for (const rec of j.records) out.push(rec);
    offset = j.offset || '';
    if (out.length >= limit) break;
  } while (offset);
  return out;
}

async function airtableGet(tableId, recordId) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}/${recordId}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
  if (!r.ok) return null;
  return r.json();
}

// ── R2 archive probe (optional) ───────────────────────────────────────────────
function r2GrepForMessageId(messageId, sinceDays = 30) {
  if (skipR2) return { skipped: true, hits: 0, eventTypes: [] };
  if (!process.env.R2_S3_ENDPOINT || !messageId) return { skipped: true, hits: 0, eventTypes: [] };

  const awsEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID:     process.env.R2_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION:    'auto',
  };

  const prefixes = [];
  const cursor = new Date();
  for (let i = 0; i < sinceDays; i++) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cursor.getUTCDate()).padStart(2, '0');
    prefixes.push(`${y}-${m}-${d}/`);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const eventTypes = new Set();
  let hits = 0;

  for (const prefix of prefixes) {
    const lst = spawnSync('aws', ['s3', 'ls', `s3://activity-logs-archive/${prefix}`, '--endpoint-url', process.env.R2_S3_ENDPOINT], { env: awsEnv, encoding: 'utf8' });
    if (lst.status !== 0) continue;
    for (const line of (lst.stdout || '').split('\n')) {
      const m = line.match(/(\S+\.(?:ndjson|json|json\.gz))\s*$/);
      if (!m) continue;
      const cp = spawnSync('aws', ['s3', 'cp', `s3://activity-logs-archive/${prefix}${m[1]}`, '-', '--endpoint-url', process.env.R2_S3_ENDPOINT], { env: awsEnv, encoding: 'utf8' });
      if (cp.status !== 0) continue;
      for (const row of (cp.stdout || '').split('\n')) {
        if (!row.includes(messageId)) continue;
        hits++;
        try { eventTypes.add(JSON.parse(row).event_type || '?'); } catch {}
      }
    }
    if (hits > 0 && eventTypes.size > 2) break; // enough signal
  }

  return { skipped: false, hits, eventTypes: [...eventTypes] };
}

// ── Per-row diagnosis ─────────────────────────────────────────────────────────
async function diagnose(rec) {
  const f = rec.fields || {};
  const status = f.processing_status || null;
  const bucket = bucketOf(status);
  const reportLinks = f.report || [];
  const pcLinks     = f.pending_classifications || [];
  const messageId   = f.source_message_id || f.source_internet_message_id || null;

  // Memory check 1: Airtable pending_classifications survived?
  const pcCount = pcLinks.length;

  // Memory check 2: report.client_notes contains a summary for this email?
  let noteFound = null; // null = unknown, true/false
  let clientId = null;
  if (reportLinks.length > 0) {
    const report = await airtableGet(TBL_REPORTS, reportLinks[0]);
    if (report) {
      clientId = report.fields?.client_id || null;
      const notesJson = report.fields?.client_notes || '';
      if (notesJson) {
        try {
          const arr = JSON.parse(notesJson);
          if (Array.isArray(arr) && messageId) {
            noteFound = arr.some(n => (n.source_message_id === messageId) || (n.message_id === messageId));
          } else if (Array.isArray(arr)) {
            // No message id to match against — flag indeterminate
            noteFound = arr.length > 0 ? 'unknown' : false;
          }
        } catch {
          noteFound = notesJson.includes(messageId || '__never__') ? true : 'unknown';
        }
      } else {
        noteFound = false;
      }
    }
  }

  // Memory check 3: R2 archive log presence
  const r2 = r2GrepForMessageId(messageId, 30);

  // Verdict
  let verdict;
  if (bucket === 'TERMINAL_EXPECTED') verdict = 'ℹ️ terminal (expected)';
  else if (bucket === 'ACTION_REQUIRED') verdict = '🟡 action required (UI bucket)';
  else if (bucket === 'STUCK') {
    const hasAnyMemory = pcCount > 0 || noteFound === true || r2.hits > 0;
    if (hasAnyMemory && pcCount > 0) verdict = '⚠️ partial — attachments preserved, status not advanced';
    else if (hasAnyMemory && noteFound === true) verdict = '⚠️ partial — body summary preserved, no attachments tracked';
    else if (r2.hits > 0) verdict = '⚠️ partial — log trail only';
    else verdict = '❌ silent drop — no memory of payload';
  } else {
    verdict = `❓ unknown status: ${status}`;
  }

  return {
    id: rec.id,
    bucket,
    status: status || '(null)',
    received_at: f.received_at || '',
    has_message_id: !!messageId,
    client_id: clientId,
    report_id: reportLinks[0] || null,
    pc_count: pcCount,
    note_found: noteFound,
    r2_hits: r2.hits,
    r2_event_types: r2.eventTypes,
    r2_skipped: r2.skipped,
    error_message: (f.error_message || '').slice(0, 300),
    last_error_step: f.last_error_step || '',
    match_method: f.match_method || '',
    verdict,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.error('[dl417] listing email_events where processing_status != Completed …');

let formula = `OR(processing_status='',NOT({processing_status}='Completed'))`;
if (sinceArg) {
  const ms = parseDurationMs(sinceArg);
  if (ms) {
    const since = new Date(Date.now() - ms).toISOString();
    formula = `AND(${formula},IS_AFTER({received_at},'${since}'))`;
  }
}

const records = await airtableList(TBL_EMAIL_EVENTS, {
  filterByFormula: formula,
  pageSize: 100,
  sort: [{ field: 'received_at', direction: 'desc' }],
  fields: [
    'source_message_id', 'source_internet_message_id', 'received_at',
    'processing_status', 'error_message', 'last_error_step', 'match_method',
    'report', 'pending_classifications', 'document',
  ],
});

console.error(`[dl417] found ${records.length} non-Completed rows`);

const diagnoses = [];
let i = 0;
for (const rec of records) {
  i++;
  if (i % 10 === 0) console.error(`  … ${i}/${records.length}`);
  diagnoses.push(await diagnose(rec));
}

// ── Report ────────────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const reportPath = join('tmp', `dl417-stuck-email-events-${today}.md`);
mkdirSync(dirname(reportPath), { recursive: true });

const counts = {};
for (const d of diagnoses) counts[d.bucket] = (counts[d.bucket] || 0) + 1;

const lines = [];
lines.push(`# DL-417 — Stuck Email Events Audit (${today})`);
lines.push('');
lines.push(`**Total non-Completed rows:** ${diagnoses.length}`);
lines.push('');
lines.push('## Bucket Counts');
lines.push('');
lines.push('| Bucket | Count | Meaning |');
lines.push('|--------|-------|---------|');
lines.push(`| STUCK | ${counts.STUCK || 0} | \`Failed\` / \`Detected\` — pipeline didn't complete |`);
lines.push(`| ACTION_REQUIRED | ${counts.ACTION_REQUIRED || 0} | \`NeedsHuman\` / \`PasswordReply\` — manual action expected (AI-Review tab) |`);
lines.push(`| TERMINAL_EXPECTED | ${counts.TERMINAL_EXPECTED || 0} | \`Bounced\` / \`Discarded\` — intentional terminal failures |`);
lines.push(`| UNKNOWN | ${counts.UNKNOWN || 0} | Unrecognized status — investigate |`);
lines.push('');
lines.push('## Verdict Legend');
lines.push('');
lines.push('- ✅ data preserved — attachments AND body summary tracked');
lines.push('- ⚠️ partial — some memory exists but pipeline didn\'t finish');
lines.push('- ❌ silent drop — no Airtable evidence the payload survived (recovery from Outlook needed)');
lines.push('- ℹ️ terminal (expected) — Bounced/Discarded, no action');
lines.push('- 🟡 action required — surfaces in AI-Review tab today');
lines.push('');
lines.push('---');
lines.push('');

const order = ['STUCK', 'UNKNOWN', 'ACTION_REQUIRED', 'TERMINAL_EXPECTED'];
for (const bucket of order) {
  const rows = diagnoses.filter(d => d.bucket === bucket);
  if (rows.length === 0) continue;
  lines.push(`## ${bucket} (${rows.length})`);
  lines.push('');
  lines.push('| email_event_id | received_at | status | client_id | report_id | pc_count | note_in_memory | r2_hits | verdict |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const noteStr = r.note_found === true ? 'yes' : r.note_found === false ? 'no' : r.note_found === 'unknown' ? 'maybe' : '—';
    const r2Str = r.r2_skipped ? 'skipped' : `${r.r2_hits}${r.r2_event_types.length ? ` (${r.r2_event_types.join(',')})` : ''}`;
    lines.push(`| \`${r.id}\` | ${r.received_at || '—'} | \`${r.status}\` | \`${r.client_id || '—'}\` | \`${r.report_id || '—'}\` | ${r.pc_count} | ${noteStr} | ${r2Str} | ${r.verdict} |`);
  }
  lines.push('');

  const withErr = rows.filter(r => r.error_message);
  if (withErr.length > 0) {
    lines.push(`### Error messages (${bucket})`);
    lines.push('');
    for (const r of withErr) {
      lines.push(`- \`${r.id}\` — ${r.last_error_step ? `[${r.last_error_step}] ` : ''}${r.error_message.replace(/\n/g, ' ').slice(0, 200)}`);
    }
    lines.push('');
  }
}

lines.push('---');
lines.push('');
lines.push('## Next Steps');
lines.push('');
lines.push('- For each `❌ silent drop` row: pull the original email from `reports@moshe-atsits.co.il` Outlook archive by `source_message_id` and re-forward to trigger reprocess.');
lines.push('- For each `⚠️ partial — attachments preserved`: open the linked `report` in admin → check AI-Review tab; pending_classifications should be there.');
lines.push('- For each `🟡 action required` row: route Natan to AI-Review tab — these are NOT bugs.');
lines.push('- Once DL-417 Track B ships: these counts will appear live on the admin dashboard.');
lines.push('');

writeFileSync(reportPath, lines.join('\n'), 'utf8');
console.error(`[dl417] wrote ${reportPath}`);

// Print summary to stdout
console.log(`\n=== DL-417 Audit Summary ===`);
console.log(`Total non-Completed: ${diagnoses.length}`);
for (const b of order) if (counts[b]) console.log(`  ${b.padEnd(20)} ${counts[b]}`);
console.log(`\nReport: ${reportPath}\n`);
