/**
 * DL-420 ops endpoint — surgical pending_classifications PATCH.
 *
 * POST /webhook/admin/pc-patch
 * Auth: Bearer <N8N_INTERNAL_KEY>
 * Body: { record_id: string, fields: Partial<PCFields> }
 *
 * Whitelist of editable fields prevents accidental over-write of system fields
 * (file_hash, email_event, classification_key, etc.). Used for one-off manual
 * fixes that the read-only `AIRTABLE_API_KEY` token in local .env can't make.
 */

import { Hono } from 'hono';
import type { Env } from '../lib/types';
import { AirtableClient } from '../lib/airtable';
import { TABLES } from '../lib/inbound/types';

const ALLOWED_FIELDS = new Set<string>([
  'attachment_name',
  'ai_reason',
  'ai_confidence',
  'onedrive_item_id',
  'file_url',
  'notes',
  'review_status',
  'matched_template_id',
  'matched_doc_name',
  'attachment_size',
  'expected_filename',
  'issuer_name',
]);

const route = new Hono<{ Bindings: Env }>();

route.post('/admin/pc-patch', async (c) => {
  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token !== c.env.N8N_INTERNAL_KEY) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  let body: { record_id?: string; fields?: Record<string, unknown> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400);
  }

  const recordId = (body.record_id || '').trim();
  if (!/^rec[A-Za-z0-9]{14,}$/.test(recordId)) {
    return c.json({ ok: false, error: 'bad_record_id' }, 400);
  }

  const submitted = body.fields ?? {};
  const filtered: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const k of Object.keys(submitted)) {
    if (ALLOWED_FIELDS.has(k)) filtered[k] = submitted[k];
    else rejected.push(k);
  }
  if (Object.keys(filtered).length === 0) {
    return c.json({ ok: false, error: 'no_allowed_fields', rejected }, 400);
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  try {
    const result = await airtable.updateRecord(
      TABLES.PENDING_CLASSIFICATIONS,
      recordId,
      filtered,
      { typecast: true },
    );
    return c.json({ ok: true, id: result.id, fields_set: Object.keys(filtered), rejected });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message.slice(0, 300) }, 500);
  }
});

export default route;
