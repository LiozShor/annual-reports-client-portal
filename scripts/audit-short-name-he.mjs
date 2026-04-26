#!/usr/bin/env node
/**
 * DL-355 — Audit `documents_templates.short_name_he` for naming hygiene.
 *
 * Read-only. Outputs a Markdown table of templates whose short_name_he is
 * suspect:
 *   - contains literal `{year}` (or any other hardcoded placeholder)
 *   - contains parentheticals like "(נקרא גם...)"
 *   - longer than 60 chars
 *   - empty when name_he is non-empty
 *   - identical to name_he (no actual short form)
 *
 * Usage:
 *   AIRTABLE_API_KEY=... AIRTABLE_BASE_ID=app... \
 *     node scripts/audit-short-name-he.mjs
 */

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = 'tblQTsbhC6ZBrhspc'; // documents_templates
const API_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;

if (!API_KEY || !BASE_ID) {
  console.error('Missing AIRTABLE_API_KEY (or AIRTABLE_PAT) and/or AIRTABLE_BASE_ID in env.');
  process.exit(1);
}

async function listAll() {
  const records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    if (offset) url.searchParams.set('offset', offset);
    url.searchParams.set('pageSize', '100');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
    const j = await r.json();
    records.push(...j.records);
    offset = j.offset;
  } while (offset);
  return records;
}

const issues = [];
const records = await listAll();

for (const rec of records) {
  const f = rec.fields || {};
  const tid = f.template_id || rec.id;
  const shortHe = (f.short_name_he || '').toString();
  const nameHe = (f.name_he || '').toString();
  const flags = [];

  if (/\{year\}/i.test(shortHe)) flags.push('contains {year}');
  const otherPlaceholders = (shortHe.match(/\{(\w+)\}/g) || []).filter((p) => p !== '{issuer}');
  if (otherPlaceholders.length) flags.push('non-issuer placeholders: ' + otherPlaceholders.join(','));
  if (/\([^)]{8,}\)/.test(shortHe)) flags.push('contains parenthetical');
  if (shortHe.length > 60) flags.push(`length ${shortHe.length}`);
  if (!shortHe.trim() && nameHe.trim()) flags.push('empty short_name_he but name_he set');
  if (shortHe && shortHe === nameHe) flags.push('short_name_he == name_he');

  if (flags.length) {
    issues.push({ tid, shortHe, flags });
  }
}

console.log(`# DL-355 short_name_he audit (${new Date().toISOString().slice(0, 10)})`);
console.log(`Scanned ${records.length} templates. ${issues.length} flagged.\n`);

if (!issues.length) {
  console.log('All clean. No action needed.');
  process.exit(0);
}

console.log('| template_id | flags | short_name_he |');
console.log('|---|---|---|');
for (const i of issues) {
  const sh = i.shortHe.length > 80 ? i.shortHe.slice(0, 77) + '...' : i.shortHe;
  console.log(`| ${i.tid} | ${i.flags.join('; ')} | \`${sh}\` |`);
}
