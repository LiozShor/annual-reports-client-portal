import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import type { Env } from '../lib/types';

const pending = new Hono<{ Bindings: Env }>();

const heCollator = new Intl.Collator('he');

// GET /webhook/admin-pending
pending.get('/admin-pending', async (c) => {
  // Auth: Bearer header or ?token= query
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : c.req.query('token') || '';

  const result = await verifyToken(token, c.env.SECRET_KEY);
  if (!result.valid) {
    return c.json({ ok: false, error: 'unauthorized' });
  }

  const year = c.req.query('year') || String(new Date().getFullYear());
  const filingType = c.req.query('filing_type') || 'annual_report';
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  const records = await airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
    filterByFormula: `AND({year}=${year}, {stage}='Send_Questionnaire', {client_is_active}=TRUE(), {filing_type}='${filingType}')`,
  });

  const getField = (val: unknown) => Array.isArray(val) ? val[0] : (val || '');

  const clients = records.map((r) => ({
    report_id: r.id,
    name: getField(r.fields.client_name) || 'Unknown',
    email: getField(r.fields.client_email) || '',
  }));

  clients.sort((a, b) => heCollator.compare(a.name as string, b.name as string));

  return c.json({ ok: true, clients });
});

export default pending;
