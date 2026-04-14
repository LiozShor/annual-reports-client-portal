// TEMPORARY ENDPOINT — added 2026-04-12 for bulk OneDrive folder creation.
// Remove after batch import is complete.

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { resolveOneDriveRoot, createClientFolderStructure } from '../lib/inbound/attachment-utils';
import type { Env } from '../lib/types';

const createFolders = new Hono<{ Bindings: Env }>();

createFolders.post('/admin-create-folders', async (c) => {
  const body = await c.req.json<{ token?: string; year?: number; filing_type?: string }>();
  const tokenResult = await verifyToken(body.token || '', c.env.SECRET_KEY);
  if (!tokenResult.valid) return c.json({ ok: false, error: 'unauthorized' }, 401);

  const year = String(body.year || 2025);
  const filingType = body.filing_type || 'annual_report';

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  const graph = new MSGraphClient(c.env, c.executionCtx);

  // Get all reports in Send_Questionnaire stage for this year
  const reports = await airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
    filterByFormula: `AND({year}=${year}, {stage}='Send_Questionnaire', {filing_type}='${filingType}')`,
  });

  // Get client names
  const clientIds = reports.map((r) => {
    const cid = r.fields.client;
    return Array.isArray(cid) ? cid[0] : cid;
  }).filter(Boolean) as string[];

  const clients = await airtable.listAllRecords('tblFFttFScDRZ7Ah5');
  const clientMap = new Map(clients.map((c) => [c.id, (c.fields.name as string) || '']));

  const root = await resolveOneDriveRoot(graph);

  const results: { client: string; ok: boolean; error?: string }[] = [];
  for (const clientId of clientIds) {
    const name = clientMap.get(clientId) || '';
    if (!name) {
      results.push({ client: clientId, ok: false, error: 'No client name' });
      continue;
    }
    try {
      await createClientFolderStructure(graph, root, name, year, filingType);
      results.push({ client: name, ok: true });
    } catch (err: any) {
      results.push({ client: name, ok: false, error: err.message });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return c.json({
    ok: true,
    total: results.length,
    succeeded,
    failed: failed.length,
    errors: failed.length > 0 ? failed : undefined,
  });
});

export default createFolders;
