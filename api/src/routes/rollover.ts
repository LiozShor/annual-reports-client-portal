import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { resolveOneDriveRoot, createClientFolderStructure } from '../lib/inbound/attachment-utils';
import { generateHexToken } from '../lib/crypto';
import { invalidateCache } from '../lib/cache';
import type { Env } from '../lib/types';

const rollover = new Hono<{ Bindings: Env }>();

// POST /webhook/admin-year-rollover
rollover.post('/admin-year-rollover', async (c) => {
  const body = await c.req.json<{
    token?: string; source_year?: number; target_year?: number; mode?: string; filing_type?: string;
  }>();
  const tokenResult = await verifyToken(body.token || '', c.env.SECRET_KEY);
  if (!tokenResult.valid) return c.json({ ok: false, error: 'unauthorized' });

  const source_year = body.source_year;
  const target_year = body.target_year;
  const mode = body.mode || 'preview';
  const filing_type = body.filing_type || 'annual_report';

  if (!source_year || !target_year || source_year === target_year) {
    return c.json({ ok: false, error: 'Invalid source_year or target_year' });
  }
  if (mode !== 'preview' && mode !== 'execute') {
    return c.json({ ok: false, error: 'Invalid mode (must be preview or execute)' });
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Parallel: 3 Airtable queries
  const [activeClients, sourceReports, targetReports] = await Promise.all([
    airtable.listAllRecords('tblFFttFScDRZ7Ah5', {
      filterByFormula: '{is_active}=TRUE()',
    }),
    airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
      filterByFormula: `{year}=${source_year}`,
    }),
    airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
      filterByFormula: `{year}=${target_year}`,
    }),
  ]);

  // Build client ID sets
  const clientsWithSource = new Set<string>();
  for (const r of sourceReports) {
    const cid = Array.isArray(r.fields.client)
      ? (r.fields.client as string[])[0] : r.fields.client as string;
    if ((r.fields.filing_type || 'annual_report') !== filing_type) continue;
    if (cid) clientsWithSource.add(cid);
  }

  const clientsWithTarget = new Set<string>();
  for (const r of targetReports) {
    const cid = Array.isArray(r.fields.client)
      ? (r.fields.client as string[])[0] : r.fields.client as string;
    if ((r.fields.filing_type || 'annual_report') !== filing_type) continue;
    if (cid) clientsWithTarget.add(cid);
  }

  // Eligible: active + source report + no target report
  const eligible: { client_id: string; name: string; email: string }[] = [];
  for (const cl of activeClients) {
    if (!clientsWithSource.has(cl.id)) continue;
    if (clientsWithTarget.has(cl.id)) continue;
    eligible.push({
      client_id: cl.id,
      name: (cl.fields.name as string) || '',
      email: (cl.fields.email as string) || '',
    });
  }

  // Preview mode
  if (mode === 'preview') {
    return c.json({
      ok: true,
      mode: 'preview',
      eligible: eligible.length,
      already_exist: clientsWithTarget.size,
      clients: eligible.map((e) => ({ name: e.name, email: e.email })),
      source_year,
      target_year,
    });
  }

  // Execute mode
  if (eligible.length === 0) {
    return c.json({
      ok: true, mode: 'execute', eligible: 0, created: 0, failed: 0,
      message: 'No eligible clients for rollover',
    });
  }

  const records = eligible.map((e) => ({
    fields: {
      client: [e.client_id],
      year: target_year,
      filing_type,
      stage: 'Send_Questionnaire',
      report_uid: crypto.randomUUID(),
      questionnaire_token: generateHexToken(32),
      last_progress_check_at: new Date().toISOString(),
    },
  }));

  const result = await airtable.batchCreate('tbls7m3hmHC4hhQVy', records);

  // Create OneDrive folder structure for the target year (non-blocking)
  const folderResults: { client: string; ok: boolean; error?: string }[] = [];
  try {
    const graph = new MSGraphClient(c.env, c.executionCtx);
    const root = await resolveOneDriveRoot(graph);
    for (const e of eligible) {
      try {
        await createClientFolderStructure(graph, root, e.name, String(target_year), filing_type);
        folderResults.push({ client: e.name, ok: true });
      } catch (err: any) {
        folderResults.push({ client: e.name, ok: false, error: err.message });
      }
    }
  } catch (err: any) {
    folderResults.push({ client: '_root_', ok: false, error: `OneDrive init failed: ${err.message}` });
  }

  // DL-254: Invalidate years cache after rollover creates new year records
  invalidateCache(c.env.CACHE_KV, 'cache:available_years');

  return c.json({
    ok: true,
    mode: 'execute',
    created: result.created.length,
    failed: result.errors.length,
    source_year,
    target_year,
    folder_results: folderResults,
    errors: result.errors.length > 0 ? result.errors : undefined,
  });
});

export default rollover;
