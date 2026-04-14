/**
 * DL-267: Temporary backfill endpoint — advance stuck reports with 0 missing docs.
 * Remove after running once in production.
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { checkAutoAdvanceToReview } from '../lib/auto-advance';
import type { Env } from '../lib/types';

const backfill = new Hono<{ Bindings: Env }>();

const TABLES = {
  REPORTS: 'tbls7m3hmHC4hhQVy',
};

backfill.post('/backfill-zero-docs', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') || c.req.query('token') || '';
  if (!verifyToken(token, c.env.ADMIN_SECRET)) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Find reports stuck in Pending_Approval or Collecting_Docs with 0 missing docs
  const reports = await airtable.listAllRecords(TABLES.REPORTS, {
    filterByFormula: `AND(
      OR({stage}='Pending_Approval', {stage}='Collecting_Docs'),
      {docs_missing_count}=0
    )`,
    fields: ['stage', 'docs_missing_count', 'docs_total', 'client_name', 'year'],
  });

  let advanced = 0;
  const results: Array<{ id: string; name: string; year: string; from: string; advanced: boolean }> = [];

  for (const report of reports) {
    const f = report.fields as Record<string, unknown>;
    const didAdvance = await checkAutoAdvanceToReview(airtable, report.id);
    results.push({
      id: report.id,
      name: (f.client_name as string) || '',
      year: (f.year as string) || '',
      from: (f.stage as string) || '',
      advanced: didAdvance,
    });
    if (didAdvance) advanced++;
  }

  return c.json({
    ok: true,
    total_checked: reports.length,
    advanced,
    results,
  });
});

export default backfill;
