/**
 * request-pdf-password.ts — DL-380
 *
 * POST /webhook/request-pdf-password
 * Sends a bilingual password-request email to the client whose pending
 * classification record refers to a password-protected PDF.
 *
 * Body: { record_id: string, preview?: boolean }
 * Headers: Authorization: Bearer <admin token>
 *
 * Preview mode (preview=true) returns { ok, subject, html } without sending
 * or writing to Airtable — used by the admin panel's "preview email" button.
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

export async function handleRequestPdfPassword(c: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = c.req.header('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const tokenResult = await verifyToken(bearerToken, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    // ── Parse body ──────────────────────────────────────────────────────────
    const body = await c.req.json() as Record<string, unknown>;
    const { record_id, preview } = body;

    if (typeof record_id !== 'string' || !record_id) {
      return c.json({ ok: false, error: 'Missing record_id' }, 400);
    }
    const isPreview = preview === true;

    // ── Fetch pending_classifications record ────────────────────────────────
    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

    const pendingRec = await airtable.getRecord<Record<string, unknown>>(
      TABLES.PENDING_CLASSIFICATIONS,
      record_id,
    );

    const fields = pendingRec.fields;

    // ── Verify record is about a password-protected file ────────────────────
    const aiReason = String(fields.ai_reason || '');
    if (!aiReason.toLowerCase().includes('password protected')) {
      return c.json({ ok: false, error: 'not_encrypted' }, 400);
    }

    // ── Idempotency guard (skip in preview mode) ────────────────────────────
    const sentAt = fields.password_request_sent_at as string | null | undefined;
    if (!isPreview && sentAt) {
      return c.json({ ok: false, error: 'already_sent', sent_at: sentAt }, 409);
    }

    // ── Resolve client details ───────────────────────────────────────────────
    const clientId = String(fields.client_id || '');
    if (!clientId) {
      return c.json({ ok: false, error: 'Missing client_id on record' }, 400);
    }

    // PENDING_CLASSIFICATIONS stores client_id (the short ID string), not the
    // Airtable record ID.  Look the client up by filtering on the client_id field.
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
      return c.json({ ok: false, error: 'No client email' }, 400);
    }

    // ── Resolve filename ────────────────────────────────────────────────────
    // Field priority: attachment_name > expected_filename
    const filename = String(
      first(fields.attachment_name) ||
      first(fields.expected_filename) ||
      'document.pdf',
    );

    // ── Build email ─────────────────────────────────────────────────────────
    const recordIdShort = record_id.slice(-8);
    const subject = `קובץ מוגן בסיסמה — ${filename}`;
    const html = buildPasswordRequestEmailHtml({ firstName, filename, recordIdShort });

    // ── Preview mode: return without side effects ───────────────────────────
    if (isPreview) {
      return c.json({ ok: true, subject, html });
    }

    // ── Send email ──────────────────────────────────────────────────────────
    const msGraph = new MSGraphClient(c.env, c.executionCtx);
    await msGraph.sendMail(subject, html, clientEmail, SENDER);

    // ── Stamp the record ────────────────────────────────────────────────────
    await airtable.updateRecord(TABLES.PENDING_CLASSIFICATIONS, record_id, {
      password_request_sent_at: new Date().toISOString(),
    });

    // ── Activity log ────────────────────────────────────────────────────────
    logEvent({
      event_type: 'pdf_password_requested',
      category: 'ADMIN',
      details: { record_id, client_id: clientId },
    });

    return c.json({ ok: true });
  } catch (err: any) {
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/request-pdf-password',
      error: err,
      category: 'INTERNAL',
    });
    return c.json({ ok: false, error: 'INTERNAL_ERROR', message: err.message }, 500);
  }
}
