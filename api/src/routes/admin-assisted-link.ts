import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { generateClientToken } from '../lib/client-token';
import { AirtableClient } from '../lib/airtable';
import { logSecurity, getClientIp } from '../lib/security-log';
import { logError } from '../lib/error-logger';
import type { Env } from '../lib/types';

const adminAssistedLink = new Hono<{ Bindings: Env }>();

const FRONTEND_BASE = 'https://docs.moshe-atsits.com';
const REPORTS_TABLE = 'tbls7m3hmHC4hhQVy';
const CLIENTS_TABLE = 'tblFFttFScDRZ7Ah5';
const ALLOWED_STAGES = new Set(['Send_Questionnaire', 'Waiting_For_Answers']);
const ASSISTED_TOKEN_TTL_DAYS = 1;

function first(val: unknown): string {
  if (Array.isArray(val)) return (val[0] ?? '') as string;
  return (val ?? '') as string;
}

adminAssistedLink.post('/admin-assisted-link', async (c) => {
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  const clientIp = getClientIp(c.req.raw.headers);

  try {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const adminToken = typeof body.token === 'string' ? body.token : '';
    const reportId = typeof body.report_id === 'string' ? body.report_id : '';

    const tokenResult = await verifyToken(adminToken, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      logSecurity(c.executionCtx, airtable, {
        timestamp: new Date().toISOString(),
        event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        severity: 'WARNING',
        actor: 'admin-token',
        actor_ip: clientIp,
        endpoint: '/webhook/admin-assisted-link',
        http_status: 401,
        error_message: tokenResult.reason || '',
      });
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    if (!reportId) {
      return c.json({ ok: false, error: 'Missing report_id' }, 400);
    }

    const report = await airtable.getRecord(REPORTS_TABLE, reportId);
    const stage = first(report.fields.stage);
    if (!ALLOWED_STAGES.has(stage)) {
      return c.json(
        { ok: false, error: `שלב הלקוח (${stage}) אינו תומך במילוי שאלון. ניתן רק בשלבים 1-2.` },
        409
      );
    }

    const clientRecordId = first(report.fields.client);
    let clientName = '';
    if (clientRecordId) {
      try {
        const client = await airtable.getRecord(CLIENTS_TABLE, clientRecordId);
        clientName = first(client.fields.name);
      } catch {
        // Non-fatal — audit entry just won't carry the name
      }
    }

    const clientToken = await generateClientToken(
      reportId,
      c.env.CLIENT_SECRET_KEY,
      ASSISTED_TOKEN_TTL_DAYS
    );
    const url = `${FRONTEND_BASE}/?report_id=${encodeURIComponent(reportId)}&token=${encodeURIComponent(clientToken)}&assisted=1`;

    logSecurity(c.executionCtx, airtable, {
      timestamp: new Date().toISOString(),
      event_type: 'ADMIN_ASSISTED_OPEN',
      severity: 'INFO',
      actor: 'admin-token',
      actor_ip: clientIp,
      endpoint: '/webhook/admin-assisted-link',
      http_status: 200,
      details: JSON.stringify({ report_id: reportId, client_name: clientName, stage }),
    });

    return c.json({ ok: true, url });
  } catch (err) {
    console.error('[admin-assisted-link] Error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/admin-assisted-link',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message || 'internal' }, 500);
  }
});

export default adminAssistedLink;
