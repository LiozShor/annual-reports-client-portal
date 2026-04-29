/**
 * request-pdf-password.ts — DL-380 / DL-382
 *
 * POST /webhook/request-pdf-password
 * Sends a bilingual password-request email listing one or more encrypted PDFs.
 * DL-382: accepts record_ids[] for batch requests; all selected records share
 * one random token written to password_request_token.
 *
 * Body: { record_ids: string[], preview?: boolean }
 *       (back-compat: also accepts { record_id: string } → wrapped to [record_id])
 * Headers: Authorization: Bearer <admin token>
 *
 * Preview mode returns { ok, subject, html } without sending or writing to Airtable.
 */

import type { Context } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { buildPasswordRequestEmailHtml } from '../lib/email-html';
import { logError } from '../lib/error-logger';
import { logEvent } from '../lib/activity-logger';
import { TABLES } from '../lib/inbound/types';
import type { Env } from '../lib/types';

const SENDER = 'reports@moshe-atsits.co.il';

function first(val: unknown): string {
  if (Array.isArray(val)) return (val[0] ?? '') as string;
  return (val ?? '') as string;
}

function generateToken(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 8)
    .toUpperCase();
}

export async function handleRequestPdfPassword(c: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = c.req.header('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const tokenResult = await verifyToken(bearerToken, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    // ── Parse body: accept batch record_ids[] or legacy single record_id ────
    const body = await c.req.json() as Record<string, unknown>;
    const { record_id, record_ids, preview } = body;

    let ids: string[];
    if (Array.isArray(record_ids) && record_ids.length > 0) {
      ids = record_ids.map(String);
    } else if (typeof record_id === 'string' && record_id) {
      ids = [record_id];
    } else {
      return c.json({ ok: false, error: 'no_records' }, 400);
    }

    if (ids.length > 20) {
      return c.json({ ok: false, error: 'too_many_records' }, 400);
    }

    const isPreview = preview === true;

    // ── Fetch all pending_classifications records ────────────────────────────
    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

    const pendingRecs = await Promise.all(
      ids.map(id => airtable.getRecord<Record<string, unknown>>(TABLES.PENDING_CLASSIFICATIONS, id)),
    );

    // ── Validate all records belong to the same client ──────────────────────
    const clientIdSet = new Set(pendingRecs.map(r => String(r.fields.client_id || '')));
    if (clientIdSet.size !== 1 || clientIdSet.has('')) {
      return c.json({ ok: false, error: 'mixed_clients' }, 400);
    }
    const clientId = [...clientIdSet][0];

    // ── Idempotency guard (skip in preview) — filter out already-sent records
    const unsent = isPreview
      ? pendingRecs
      : pendingRecs.filter(r => !r.fields.password_request_sent_at);
    if (!isPreview && unsent.length === 0) {
      const sentAt = String(pendingRecs[0].fields.password_request_sent_at || '');
      return c.json({ ok: false, error: 'already_sent', sent_at: sentAt }, 409);
    }
    const targetRecs = unsent;

    // ── Resolve client details ───────────────────────────────────────────────
    const clientRecords = await airtable.listAllRecords<Record<string, unknown>>(
      TABLES.CLIENTS,
      { filterByFormula: `{client_id}='${clientId.replace(/'/g, "\\'")}'`, maxRecords: 1 },
    );
    if (!clientRecords.length) {
      return c.json({ ok: false, error: 'client_not_found' }, 404);
    }
    const clientFields = clientRecords[0].fields;
    const clientEmail = String(first(clientFields.email) || '');
    const firstName = String(first(clientFields.name) || '');
    if (!clientEmail) {
      return c.json({ ok: false, error: 'no_client_email' }, 400);
    }

    // ── Collect filenames ────────────────────────────────────────────────────
    const filenames = targetRecs.map(r =>
      String(first(r.fields.attachment_name) || first(r.fields.expected_filename) || 'document.pdf'),
    );

    // ── Build email ──────────────────────────────────────────────────────────
    const token = generateToken();
    const subject = filenames.length === 1
      ? `קובץ מוגן בסיסמה — ${filenames[0]}`
      : `קבצים מוגנים בסיסמה — ${filenames.length} קבצים`;
    const html = buildPasswordRequestEmailHtml({ firstName, filenames, token });

    // ── Preview mode: return without side effects ───────────────────────────
    if (isPreview) {
      return c.json({ ok: true, subject, html });
    }

    // ── Send email ──────────────────────────────────────────────────────────
    const msGraph = new MSGraphClient(c.env, c.executionCtx);
    await msGraph.sendMail(subject, html, clientEmail, SENDER);

    // ── Stamp all records with token + sent_at ──────────────────────────────
    const now = new Date().toISOString();
    await Promise.all(
      targetRecs.map(r =>
        airtable.updateRecord(TABLES.PENDING_CLASSIFICATIONS, r.id, {
          password_request_token: token,
          password_request_sent_at: now,
        }),
      ),
    );

    // ── Activity log ────────────────────────────────────────────────────────
    logEvent({
      event_type: 'pdf_password_requested',
      category: 'ADMIN',
      details: { record_ids: targetRecs.map(r => r.id), count: targetRecs.length, client_id: clientId },
    });

    return c.json({ ok: true, count: targetRecs.length });
  } catch (err: any) {
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/request-pdf-password',
      error: err,
      category: 'INTERNAL',
    });
    return c.json({ ok: false, error: 'INTERNAL_ERROR', message: err.message }, 500);
  }
}
