// TEMPORARY ENDPOINT — added 2026-04-12 for checking OneDrive folder existence.
// Remove after batch import is complete.

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { resolveOneDriveRoot } from '../lib/inbound/attachment-utils';
import type { Env } from '../lib/types';

const checkFolders = new Hono<{ Bindings: Env }>();

checkFolders.get('/admin-check-folders', async (c) => {
  const token = c.req.query('token') ?? '';
  const tokenResult = await verifyToken(token, c.env.SECRET_KEY);
  if (!tokenResult.valid) return c.json({ ok: false, error: 'unauthorized' }, 401);

  const year = c.req.query('year') || '2025';
  const filingType = c.req.query('filing_type') || 'annual_report';
  const stage = c.req.query('stage') || 'Send_Questionnaire';

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  const graph = new MSGraphClient(c.env, c.executionCtx);

  // Get reports in the given stage
  const reports = await airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
    filterByFormula: `AND({year}=${year}, {stage}='${stage}', {filing_type}='${filingType}')`,
  });

  const clientIds = reports.map((r) => {
    const cid = r.fields.client;
    return Array.isArray(cid) ? cid[0] : cid;
  }).filter(Boolean) as string[];

  const clients = await airtable.listAllRecords('tblFFttFScDRZ7Ah5');
  const clientMap = new Map(clients.map((cl) => [cl.id, (cl.fields.name as string) || '']));

  const clientNames = clientIds.map((id) => clientMap.get(id) || '').filter(Boolean);

  // List OneDrive root children
  const root = await resolveOneDriveRoot(graph);
  const folderList = await graph.get(
    `/drives/${root.driveId}/items/${root.rootFolderId}/children?$select=name&$top=999`
  );
  const existingFolders = new Set<string>(
    (folderList?.value || []).map((f: any) => f.name as string)
  );

  const found: string[] = [];
  const missing: string[] = [];
  for (const name of clientNames) {
    if (existingFolders.has(name)) {
      found.push(name);
    } else {
      missing.push(name);
    }
  }

  c.header('Cache-Control', 'no-store');
  return c.json({
    ok: true,
    total: clientNames.length,
    found: found.length,
    missing: missing.length,
    missingNames: missing.length > 0 ? missing : undefined,
  });
});

export default checkFolders;
