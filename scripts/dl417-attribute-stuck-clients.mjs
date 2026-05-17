#!/usr/bin/env node
/**
 * dl417-attribute-stuck-clients.mjs — list clients behind the stuck email_events.
 *
 * Strategy: forward-query pending_classifications where email_event is in the
 * stuck set, read client_id + client_name + report. Also list the 8 STUCK
 * (Failed/Detected) email_events for which we have NO client linkage at all.
 *
 * Writes report to tmp/ (recIds + client_ids — kept local).
 *
 * Usage: source .env && node scripts/dl417-attribute-stuck-clients.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appqBL5RWQN9cPOyh';
if (!AIRTABLE_API_KEY) { console.error('missing AIRTABLE_API_KEY'); process.exit(1); }

const TBL_EMAIL_EVENTS = 'tblJAPEcSJpzdEBcW';
const TBL_PENDING      = 'tbloiSDN3rwRcl1ii';

async function listAll(tableId, params) {
  const search = new URLSearchParams();
  if (params.filterByFormula) search.set('filterByFormula', params.filterByFormula);
  if (params.fields) for (const f of params.fields) search.append('fields[]', f);
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const out = [];
  let offset = '';
  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}?${search.toString()}${offset ? `&offset=${offset}` : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
    if (!r.ok) throw new Error(`${tableId} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    out.push(...j.records);
    offset = j.offset || '';
  } while (offset);
  return out;
}

// 1. Fetch all non-Completed email_events
console.error('[dl417-attrib] fetching email_events...');
const events = await listAll(TBL_EMAIL_EVENTS, {
  filterByFormula: `OR({processing_status}='',NOT({processing_status}='Completed'))`,
  fields: ['source_message_id', 'received_at', 'processing_status', 'sender_email', 'subject', 'error_message', 'last_error_step'],
  pageSize: 100,
});
console.error(`  ${events.length} non-Completed events`);

const eventById = new Map(events.map(e => [e.id, e]));
const eventIds = [...eventById.keys()];

// 2. Fetch recent pending_classifications (last 90d) and filter client-side.
// Airtable's filterByFormula can't search linked-record arrays by recId
// (ARRAYJOIN returns primary-field values, not recIds), so do it locally.
console.error('[dl417-attrib] fetching recent pending_classifications...');
const sinceIso = new Date(Date.now() - 90 * 86400000).toISOString();
const eventIdSet = new Set(eventIds);
const allRecentPCs = await listAll(TBL_PENDING, {
  filterByFormula: `OR({received_at}='',IS_AFTER({received_at},'${sinceIso}'))`,
  fields: ['email_event', 'client_id', 'client_name', 'attachment_name', 'year', 'review_status', 'matched_template_id', 'sender_email'],
  pageSize: 100,
});
console.error(`  ${allRecentPCs.length} PCs in last 90d`);

const pcByEvent = new Map();
for (const pc of allRecentPCs) {
  const linkedEvents = pc.fields.email_event || [];
  for (const eid of linkedEvents) {
    if (!eventIdSet.has(eid)) continue;
    if (!pcByEvent.has(eid)) pcByEvent.set(eid, []);
    pcByEvent.get(eid).push({
      client_id:   pc.fields.client_id || '',
      client_name: pc.fields.client_name || '',
      attachment_name: pc.fields.attachment_name || '',
      year: pc.fields.year || '',
      review_status: pc.fields.review_status || '',
      matched_template_id: pc.fields.matched_template_id || '',
    });
  }
}
console.error(`  ${pcByEvent.size} events have at least one linked pending_classification`);

// 3. Build per-bucket attribution
const BUCKETS = {
  STUCK:           new Set(['Failed', 'Detected']),
  ACTION_REQUIRED: new Set(['NeedsHuman', 'PasswordReply']),
  TERMINAL:        new Set(['Bounced', 'Discarded']),
};
function bucket(s) {
  if (!s) return 'STUCK';
  for (const [k, v] of Object.entries(BUCKETS)) if (v.has(s)) return k;
  return 'UNKNOWN';
}

const lines = [];
const today = new Date().toISOString().slice(0, 10);
lines.push(`# DL-417 — Client Attribution for Stuck Emails (${today})`);
lines.push('');
lines.push('Forward-queried pending_classifications.email_event for every non-Completed email_event.');
lines.push('Rows with zero linked PCs cannot be attributed (failure happened before client ID).');
lines.push('');

for (const bkt of ['STUCK', 'ACTION_REQUIRED', 'TERMINAL', 'UNKNOWN']) {
  const evs = events.filter(e => bucket(e.fields.processing_status) === bkt);
  if (evs.length === 0) continue;
  lines.push(`## ${bkt} (${evs.length} email_events)`);
  lines.push('');

  // Group by client
  const byClient = new Map(); // client_id -> [{event, pcs}]
  const orphans = [];
  for (const e of evs) {
    const pcs = pcByEvent.get(e.id) || [];
    if (pcs.length === 0) { orphans.push(e); continue; }
    const cid = pcs[0].client_id || '(no client_id on PC)';
    if (!byClient.has(cid)) byClient.set(cid, []);
    byClient.get(cid).push({ event: e, pcs });
  }

  if (byClient.size > 0) {
    lines.push(`### Attributed (${[...byClient.values()].reduce((s, a) => s + a.length, 0)} events across ${byClient.size} clients)`);
    lines.push('');
    const sortedClients = [...byClient.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [cid, entries] of sortedClients) {
      const name = entries[0].pcs[0]?.client_name || '';
      lines.push(`- **${cid}** — ${name} — ${entries.length} stuck email(s)`);
      for (const { event, pcs } of entries) {
        const f = event.fields;
        const subj = (f.subject || '(no subject)').slice(0, 80);
        const pcSummary = pcs.map(p => `${p.attachment_name}${p.year ? ` (${p.year})` : ''}${p.review_status ? ` [${p.review_status}]` : ''}`).join('; ');
        lines.push(`  - \`${event.id}\` · ${f.received_at || '?'} · \`${f.processing_status || 'null'}\` · "${subj}"`);
        lines.push(`    - PCs: ${pcSummary}`);
        if (f.error_message) lines.push(`    - err: ${f.error_message.slice(0, 200)}`);
      }
    }
    lines.push('');
  }

  if (orphans.length > 0) {
    lines.push(`### Orphan — no pending_classifications, identity LOST (${orphans.length})`);
    lines.push('');
    for (const e of orphans) {
      const f = e.fields;
      const subj = (f.subject || '(no subject)').slice(0, 80);
      const sender = f.sender_email || '?';
      lines.push(`- \`${e.id}\` · ${f.received_at || '?'} · \`${f.processing_status || 'null'}\` · from: \`${sender}\` · "${subj}"`);
      if (f.error_message) lines.push(`  - err: ${f.error_message.slice(0, 200)}`);
    }
    lines.push('');
  }
}

mkdirSync('tmp', { recursive: true });
const out = `tmp/dl417-attribution-${today}.md`;
writeFileSync(out, lines.join('\n'), 'utf8');
console.error(`[dl417-attrib] wrote ${out}`);
console.log(`\n=== DL-417 Client Attribution ===\nReport: ${out}\n`);
