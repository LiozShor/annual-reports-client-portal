/**
 * DL-300: One-shot cleanup — clear `issuer_name_suggested` on docs whose
 * template has `needs_issuer_suggestion != true`.
 *
 * Usage:
 *   DRY=1 node --loader ts-node/esm api/scripts/clear-disabled-template-suggestions.ts   # default: report only
 *   DRY=0 node --loader ts-node/esm api/scripts/clear-disabled-template-suggestions.ts   # actually patches
 *
 * Env required: AIRTABLE_API_KEY (or AIRTABLE_PAT), AIRTABLE_BASE_ID.
 *
 * Idempotent — safe to re-run. Paginates all docs with non-empty
 * `issuer_name_suggested`, looks up each doc's template, clears the
 * field for docs whose template is disabled.
 */

const AIRTABLE_API = 'https://api.airtable.com/v0';
const DOCUMENTS_TABLE = 'tblcwptR63skeODPn';
const TEMPLATES_TABLE = 'tblQTsbhC6ZBrhspc';

const DRY = (process.env.DRY ?? '1') !== '0';
const TOKEN = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE_ID;

if (!TOKEN || !BASE) {
  console.error('Missing AIRTABLE_API_KEY/AIRTABLE_PAT or AIRTABLE_BASE_ID');
  process.exit(1);
}

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

async function listAll(table: string, params: Record<string, string> = {}): Promise<AirtableRecord[]> {
  const out: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const qs = new URLSearchParams({ pageSize: '100', ...params });
    if (offset) qs.set('offset', offset);
    const res = await fetch(`${AIRTABLE_API}/${BASE}/${table}?${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`Airtable list ${table} ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

async function batchPatch(table: string, records: { id: string; fields: Record<string, unknown> }[]): Promise<void> {
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    const res = await fetch(`${AIRTABLE_API}/${BASE}/${table}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: chunk }),
    });
    if (!res.ok) throw new Error(`Airtable patch ${table} ${res.status}: ${await res.text()}`);
  }
}

async function main() {
  console.log(`[clear-disabled-template-suggestions] DRY=${DRY ? '1' : '0'}`);

  // 1. Fetch templates → set of DISABLED template_ids.
  const templates = await listAll(TEMPLATES_TABLE);
  const disabledIds = new Set<string>();
  const enabledIds = new Set<string>();
  for (const t of templates) {
    const tid = t.fields['template_id'] as string | undefined;
    if (!tid) continue;
    if (t.fields['needs_issuer_suggestion'] === true) enabledIds.add(tid);
    else disabledIds.add(tid);
  }
  console.log(`  templates: enabled=${enabledIds.size} disabled=${disabledIds.size}`);

  // 2. Fetch docs with non-empty issuer_name_suggested.
  const docs = await listAll(DOCUMENTS_TABLE, {
    filterByFormula: `{issuer_name_suggested} != ''`,
    fields: JSON.stringify(['template_id', 'issuer_name_suggested']) as unknown as string,
  }).catch(async () => {
    // Airtable `fields` param is repeated, not array. Fallback: no field filter.
    return listAll(DOCUMENTS_TABLE, { filterByFormula: `{issuer_name_suggested} != ''` });
  });
  console.log(`  docs with suggestions: ${docs.length}`);

  // 3. Filter to docs whose template is disabled.
  const toClear: { id: string; fields: Record<string, unknown> }[] = [];
  const byTemplate = new Map<string, number>();
  for (const d of docs) {
    const raw = d.fields['template_id'];
    const tid = Array.isArray(raw) ? (raw[0] as string) : (raw as string | undefined);
    if (!tid) continue;
    if (!disabledIds.has(tid)) continue;
    toClear.push({ id: d.id, fields: { issuer_name_suggested: '' } });
    byTemplate.set(tid, (byTemplate.get(tid) ?? 0) + 1);
  }

  console.log(`  to clear: ${toClear.length}`);
  const grouped = [...byTemplate.entries()].sort((a, b) => b[1] - a[1]);
  for (const [tid, n] of grouped) {
    console.log(`    ${tid}: ${n}`);
  }

  if (toClear.length > 0) {
    const sample = toClear.slice(0, 5).map((u) => u.id);
    console.log(`  sample ids: ${sample.join(', ')}`);
  }

  if (DRY) {
    console.log('DRY mode — no writes. Re-run with DRY=0 to apply.');
    return;
  }

  if (toClear.length === 0) {
    console.log('Nothing to clear.');
    return;
  }

  await batchPatch(DOCUMENTS_TABLE, toClear);
  console.log(`Cleared ${toClear.length} docs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
