import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { buildQuestionnaireUrl } from '../lib/questionnaire-url';
import { logError } from '../lib/error-logger';
import type { Env } from '../lib/types';

const questionnaireLink = new Hono<{ Bindings: Env }>();

const REPORTS_TABLE = 'tbls7m3hmHC4hhQVy';

questionnaireLink.post('/admin-questionnaire-link', async (c) => {
  try {
    const body = await c.req.json<{ token?: string; report_id?: string }>();

    const tokenResult = await verifyToken(body.token ?? '', c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    const reportId = body.report_id;
    if (!reportId || typeof reportId !== 'string') {
      return c.json({ ok: false, error: 'report_id required' }, 400);
    }

    // Verify the report exists before minting a token (avoids handing out
    // valid-looking URLs for nonexistent reports).
    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
    try {
      await airtable.getRecord(REPORTS_TABLE, reportId);
    } catch {
      return c.json({ ok: false, error: 'report_not_found' }, 404);
    }

    const url = await buildQuestionnaireUrl(reportId, c.env.CLIENT_SECRET_KEY);
    return c.json({ ok: true, url });
  } catch (err) {
    console.error('[questionnaire-link] Error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/admin-questionnaire-link',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default questionnaireLink;
