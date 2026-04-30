#!/usr/bin/env node
/**
 * DL-385 — Seed 12 QA pending_classifications records for CPA-210.
 *
 * Covers every variance for the partial-contract review flow:
 *   - T901/T902 full-year (baseline)
 *   - Partial mid/early/middle (gap before, after, both sides)
 *   - LLM swapped (income↔expense reversal — tests ⇄ swap button)
 *   - No contract_period (LLM failed to extract dates)
 *   - Single-month edge
 *   - Cross-year, parser stress test, 2-digit year boundary
 *
 * Usage:
 *   source ~/Desktop/moshe/annual-reports/.env
 *   AIRTABLE_API_KEY=$AIRTABLE_API_KEY AIRTABLE_BASE_ID=$AIRTABLE_BASE_ID \
 *     node scripts/seed-cpa210-qa.mjs
 *
 * Flags:
 *   --dry-run      Print payload but don't write
 *   --year=2026    Override report year (default: 2026)
 *   --cleanup      Delete previously-seeded QA rows (matched on attachment_name prefix)
 */

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const API_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
const PC_TABLE = 'tbloiSDN3rwRcl1ii'; // pending_classifications
const REPORTS_TABLE = 'tbls7m3hmHC4hhQVy'; // reports
const CLIENTS_TABLE = 'tblFFttFScDRZ7Ah5'; // clients

const DRY_RUN = process.argv.includes('--dry-run');
const CLEANUP = process.argv.includes('--cleanup');
const YEAR = Number((process.argv.find(a => a.startsWith('--year='))?.split('=')[1]) || 2026);
const CLIENT_ID = 'CPA-210';
const QA_PREFIX = '[DL-385-QA] ';

if (!API_KEY || !BASE_ID) {
  console.error('Missing AIRTABLE_API_KEY (or AIRTABLE_PAT) and/or AIRTABLE_BASE_ID in env.');
  console.error('Hint: source ~/Desktop/moshe/annual-reports/.env');
  process.exit(1);
}

const AT = {
  list: async (table, filter) => {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${table}`);
    if (filter) url.searchParams.set('filterByFormula', filter);
    url.searchParams.set('pageSize', '100');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (!r.ok) throw new Error(`Airtable ${table} list ${r.status}: ${await r.text()}`);
    return (await r.json()).records;
  },
  create: async (table, fields) => {
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${table}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (!r.ok) throw new Error(`Airtable ${table} create ${r.status}: ${await r.text()}`);
    return r.json();
  },
  delete: async (table, id) => {
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${table}/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!r.ok) throw new Error(`Airtable ${table} delete ${r.status}: ${await r.text()}`);
    return r.json();
  },
};

// ---- Step 1: Resolve client + report ----
async function resolveReport() {
  const clients = await AT.list(CLIENTS_TABLE, `{client_id} = '${CLIENT_ID}'`);
  if (!clients.length) throw new Error(`Client ${CLIENT_ID} not found`);
  const clientRec = clients[0];
  const clientName = clientRec.fields.name || CLIENT_ID;

  const reports = await AT.list(
    REPORTS_TABLE,
    `AND({client_id}='${CLIENT_ID}', {year}=${YEAR}, {filing_type}='annual_report')`
  );
  if (!reports.length) {
    throw new Error(
      `No annual_report for ${CLIENT_ID} year ${YEAR}. Create one first or pass --year=<existing>.`
    );
  }
  return { reportId: reports[0].id, clientName };
}

// ---- Step 2: Cleanup mode ----
async function cleanup() {
  console.log(`→ Cleanup: searching pending_classifications with prefix "${QA_PREFIX}"...`);
  const rows = await AT.list(
    PC_TABLE,
    `AND({client_id}='${CLIENT_ID}', FIND('${QA_PREFIX}', {attachment_name})=1)`
  );
  console.log(`  Found ${rows.length} QA rows to delete.`);
  if (DRY_RUN) {
    rows.forEach(r => console.log(`  [dry] would delete ${r.id}: ${r.fields.attachment_name}`));
    return;
  }
  for (const r of rows) {
    await AT.delete(PC_TABLE, r.id);
    console.log(`  ✓ deleted ${r.id}: ${r.fields.attachment_name}`);
  }
}

// ---- Step 3: Test fixtures ----
const cp = (start, end) => JSON.stringify({
  startDate: start,
  endDate: end,
  coversFullYear: start.endsWith('-01-01') && end.endsWith('-12-31') &&
    start.slice(0, 4) === end.slice(0, 4),
});

function buildFixtures(reportId, clientName) {
  const baseHour = (i) => new Date(Date.now() - (12 - i) * 3600 * 1000).toISOString();
  const common = {
    report: [reportId],
    sender_email: 'qa@test.local',
    sender_name: 'QA Test (DL-385)',
    review_status: 'pending',
    client_id: CLIENT_ID,
    client_name: clientName,
    year: YEAR,
    attachment_content_type: 'application/pdf',
    attachment_size: 123456,
  };
  const FY = `${YEAR}-01-01`;
  const FYE = `${YEAR}-12-31`;

  return [
    { ...common, attachment_name: `${QA_PREFIX}01 שכירות-מלא-תל-אביב.pdf`,
      matched_template_id: 'T901', ai_confidence: 0.95, issuer_name: 'דירה רחוב הרצל',
      contract_period: cp(FY, FYE), received_at: baseHour(1),
      ai_reason: 'QA #1 — Baseline T901 full-year (DL-359 green badge path)' },

    { ...common, attachment_name: `${QA_PREFIX}02 שכירות-משרד-מלא.pdf`,
      matched_template_id: 'T902', ai_confidence: 0.93, issuer_name: 'משרד בבית הקרן',
      contract_period: cp(FY, FYE), received_at: baseHour(2),
      ai_reason: 'QA #2 — Baseline T902 full-year + ⇄ swap button visible' },

    { ...common, attachment_name: `${QA_PREFIX}03 שכירות-חלקי-מאי-דצמבר.pdf`,
      matched_template_id: 'T901', ai_confidence: 0.88, issuer_name: 'דירת גג נווה צדק',
      contract_period: cp(`${YEAR}-05-01`, FYE), received_at: baseHour(3),
      ai_reason: 'QA #3 — Partial T901 gap BEFORE → "+ בקש 1-4" button + date editor' },

    { ...common, attachment_name: `${QA_PREFIX}04 הוצאות-משרד-ינואר-יוני.pdf`,
      matched_template_id: 'T902', ai_confidence: 0.85, issuer_name: 'משרד בנייני אומה',
      contract_period: cp(FY, `${YEAR}-06-30`), received_at: baseHour(4),
      ai_reason: 'QA #4 — Partial T902 gap AFTER → "+ בקש 7-12" button' },

    { ...common, attachment_name: `${QA_PREFIX}05 שכירות-חלקי-מרץ-ספטמבר.pdf`,
      matched_template_id: 'T901', ai_confidence: 0.82, issuer_name: 'דירת חדרים גוש דן',
      contract_period: cp(`${YEAR}-03-01`, `${YEAR}-09-30`), received_at: baseHour(5),
      ai_reason: 'QA #5 — Partial T901 gaps BOTH sides → two "+ בקש" buttons' },

    { ...common, attachment_name: `${QA_PREFIX}06 שכר-דירה-הכנסה-2026.pdf`,
      matched_template_id: 'T902', ai_confidence: 0.71, issuer_name: 'שכ"ד דירה רמת אביב',
      contract_period: cp(`${YEAR}-05-01`, FYE), received_at: baseHour(6),
      ai_reason: 'QA #6 — LLM SWAPPED (real T901, labelled T902). Test ⇄ income→expense reversal' },

    { ...common, attachment_name: `${QA_PREFIX}07 הוצאות-שכר-דירה-עסק.pdf`,
      matched_template_id: 'T901', ai_confidence: 0.68, issuer_name: 'משרד דיזנגוף',
      contract_period: cp(FY, `${YEAR}-04-30`), received_at: baseHour(7),
      ai_reason: 'QA #7 — LLM SWAPPED (real T902, labelled T901). Test ⇄ expense→income reversal' },

    { ...common, attachment_name: `${QA_PREFIX}08 חוזה-שכירות-ללא-תאריכים.pdf`,
      matched_template_id: 'T901', ai_confidence: 0.55, issuer_name: 'דירה לא מזוהה',
      received_at: baseHour(8),
      ai_reason: 'QA #8 — No contract_period (LLM failed dates). Banner shows "לא זוהו תאריכים", test MM.YYYY input on blank' },

    { ...common, attachment_name: `${QA_PREFIX}09 שכירות-יולי-בלבד.pdf`,
      matched_template_id: 'T901', ai_confidence: 0.79, issuer_name: 'דירה רחוב יפו',
      contract_period: cp(`${YEAR}-07-01`, `${YEAR}-07-31`), received_at: baseHour(9),
      ai_reason: 'QA #9 — Single-month (Jul only) → both "+ בקש" buttons. Type 7.26 then 7/2026 in parser' },

    { ...common, attachment_name: `${QA_PREFIX}10 שכירות-יוני-2025.pdf`,
      matched_template_id: 'T902', ai_confidence: 0.91, issuer_name: 'משרד שנה קודמת',
      contract_period: cp(`${YEAR - 1}-06-01`, `${YEAR - 1}-12-31`), received_at: baseHour(10),
      ai_reason: 'QA #10 — Cross-year (dates in prior year, year=current). Tests fallback in saveContractPeriod' },

    { ...common, attachment_name: `${QA_PREFIX}11 שכירות-קלט-לא-תקין.pdf`,
      matched_template_id: 'T901', ai_confidence: 0.80, issuer_name: 'בדיקת קלט',
      contract_period: cp(`${YEAR}-02-01`, `${YEAR}-08-31`), received_at: baseHour(11),
      ai_reason: 'QA #11 — Parser stress: type 13.2026, 5.5, abc (reject); 5.26, 05.2026, 5/26, 5-2026 (accept)' },

    { ...common, attachment_name: `${QA_PREFIX}12 שכירות-2-ספרות-שנה.pdf`,
      matched_template_id: 'T901', ai_confidence: 0.92, issuer_name: 'בדיקת שנה',
      contract_period: cp(FY, FYE), received_at: baseHour(12),
      ai_reason: 'QA #12 — 2-digit year boundary: type 5.79→2079 vs 5.80→1980 (per parseLenientMonthYear century rule)' },
  ];
}

// ---- Step 4: Run ----
async function main() {
  if (CLEANUP) { await cleanup(); return; }

  console.log(`→ Resolving CPA-210 / year ${YEAR} report...`);
  const { reportId, clientName } = await resolveReport();
  console.log(`  Client: ${clientName} | Report: ${reportId}`);

  const fixtures = buildFixtures(reportId, clientName);
  console.log(`→ Seeding ${fixtures.length} pending_classifications rows...${DRY_RUN ? ' [DRY-RUN]' : ''}`);

  for (const fields of fixtures) {
    if (DRY_RUN) {
      console.log(`  [dry] ${fields.attachment_name}`);
      continue;
    }
    const rec = await AT.create(PC_TABLE, fields);
    console.log(`  ✓ ${rec.id} ← ${fields.attachment_name}`);
  }

  console.log('');
  console.log('Done. Open admin AI Review tab on CPA-210 to see them.');
  console.log(`Cleanup later: node scripts/seed-cpa210-qa.mjs --cleanup`);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
