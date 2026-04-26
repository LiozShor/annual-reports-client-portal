/**
 * DL-356: Sweep route to find (and optionally clear) Documents rows where
 * `status = 'Required_Missing'` AND `onedrive_item_id` is non-empty.
 *
 * Such rows produce 404s from MS Graph the moment an admin clicks Preview.
 * The fix-forward path (DL-356 invariant in `lib/doc-invariants.ts`)
 * prevents new rows from getting into this state, but legacy/manual rows
 * still need a one-shot purge.
 *
 * Usage:
 *   GET /webhook/audit-stale-itemids?token=<ADMIN>            # default dry-run
 *   GET /webhook/audit-stale-itemids?token=<ADMIN>&dryRun=0   # apply
 *   GET /webhook/audit-stale-itemids?token=<ADMIN>&verify=1   # HEAD-check OneDrive first
 *
 * Auth: admin Bearer token via `verifyToken`.
 */
import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import type { Env } from '../lib/types';

const DOCUMENTS_TABLE = 'tblcwptR63skeODPn';

const FIELDS_TO_NULL = {
  file_url: null,
  onedrive_item_id: null,
  expected_filename: null,
  file_hash: null,
  uploaded_at: null,
} as const;

const auditStaleItemIds = new Hono<{ Bindings: Env }>();

auditStaleItemIds.get('/audit-stale-itemids', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : c.req.query('token') || '';
  const auth = await verifyToken(token, c.env.SECRET_KEY);
  if (!auth.valid) return c.json({ ok: false, error: 'unauthorized' }, 401);

  const dryRun = c.req.query('dryRun') !== '0';
  const verify = c.req.query('verify') === '1';

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  const rows = await airtable.listAllRecords(DOCUMENTS_TABLE, {
    filterByFormula: `AND({status} = 'Required_Missing', {onedrive_item_id} != '')`,
    fields: ['onedrive_item_id', 'file_url', 'report', 'type', 'issuer_name'],
  });

  type Sample = { id: string; itemId: string; type?: unknown; issuer_name?: unknown; report?: unknown };
  const samples: Sample[] = [];
  const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];

  let verifiedMissing = 0;
  let verifiedExisting = 0;
  let msGraph: MSGraphClient | null = null;
  if (verify) msGraph = new MSGraphClient(c.env, c.executionCtx);

  for (const r of rows) {
    const f = r.fields as Record<string, unknown>;
    const itemId = String(f.onedrive_item_id || '');
    if (!itemId) continue;

    let shouldClear = true;
    if (verify && msGraph) {
      try {
        await msGraph.get(`/me/drive/items/${itemId}?$select=id`);
        shouldClear = false; // file still exists → leave alone
        verifiedExisting++;
      } catch {
        verifiedMissing++;
      }
    }

    if (shouldClear) {
      updates.push({ id: r.id, fields: { ...FIELDS_TO_NULL } });
      if (samples.length < 10) {
        samples.push({
          id: r.id,
          itemId,
          type: f.type,
          issuer_name: f.issuer_name,
          report: f.report,
        });
      }
    }
  }

  let updated = 0;
  if (!dryRun && updates.length > 0) {
    const written = await airtable.batchUpdate(DOCUMENTS_TABLE, updates);
    updated = written.length;
  }

  return c.json({
    ok: true,
    dryRun,
    verify,
    matched: rows.length,
    eligibleToClear: updates.length,
    updated,
    verifiedMissing,
    verifiedExisting,
    samples,
  });
});

export default auditStaleItemIds;
