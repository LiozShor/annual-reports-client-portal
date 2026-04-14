import { Hono } from 'hono';
import { verifyClientToken } from '../lib/client-token';
import { AirtableClient } from '../lib/airtable';
import { logSecurity, getClientIp } from '../lib/security-log';
import type { Env } from '../lib/types';

const reset = new Hono<{ Bindings: Env }>();

// POST /webhook/reset-submission (client-facing, uses client token)
reset.post('/reset-submission', async (c) => {
  const body = await c.req.json<{ report_id?: string; token?: string; year?: string }>();
  const reportId = body.report_id || '';

  if (!reportId) {
    return c.json({ ok: false, error: 'Missing report_id' });
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Get report
  let report: { id: string; fields: Record<string, unknown> };
  try {
    report = await airtable.getRecord('tbls7m3hmHC4hhQVy', reportId);
  } catch {
    return c.json({ ok: false, error: 'Report not found' });
  }

  // Validate client token
  const tokenResult = await verifyClientToken(report.id, body.token || '', c.env.CLIENT_SECRET_KEY);
  if (!tokenResult.valid) {
    const clientIp = getClientIp(c.req.raw.headers);
    logSecurity(c.executionCtx, airtable, {
      timestamp: new Date().toISOString(),
      event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      severity: 'WARNING',
      actor: 'client-token',
      actor_ip: clientIp,
      endpoint: '/webhook/reset-submission',
      http_status: 200,
      error_message: tokenResult.reason || '',
    });
    return c.json({ ok: false, error: tokenResult.reason });
  }

  // Search and delete documents
  const docs = await airtable.listAllRecords('tblcwptR63skeODPn', {
    filterByFormula: `FIND('${reportId}', ARRAYJOIN({report_record_id}))`,
  });
  if (docs.length > 0) {
    await airtable.deleteRecords('tblcwptR63skeODPn', docs.map((d) => d.id));
  }

  // Search and delete questionnaire responses
  const questionnaires = await airtable.listAllRecords('tblxEox8MsbliwTZI', {
    filterByFormula: `FIND('${reportId}', ARRAYJOIN({report_record_id}))`,
  });
  if (questionnaires.length > 0) {
    await airtable.deleteRecords('tblxEox8MsbliwTZI', questionnaires.map((q) => q.id));
  }

  // Reset report stage
  await airtable.updateRecord('tbls7m3hmHC4hhQVy', reportId, {
    stage: 'Waiting_For_Answers',
    last_progress_check_at: new Date().toISOString(),
  });

  return c.json({ ok: true });
});

export default reset;
