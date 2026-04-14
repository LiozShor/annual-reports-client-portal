import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { logAudit } from '../lib/audit-log';
import { invalidateCache } from '../lib/cache';
import type { Env } from '../lib/types';

const client = new Hono<{ Bindings: Env }>();

// POST /webhook/admin-toggle-active
client.post('/admin-toggle-active', async (c) => {
  const body = await c.req.json<{ token?: string; report_id?: string; active?: boolean }>();
  const tokenResult = await verifyToken(body.token || '', c.env.SECRET_KEY);
  if (!tokenResult.valid) return c.json({ ok: false, error: 'unauthorized' });

  if (!body.report_id || typeof body.active !== 'boolean') {
    return c.json({ ok: false, error: 'invalid_input' });
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Get report to find linked client
  const report = await airtable.getRecord('tbls7m3hmHC4hhQVy', body.report_id);
  const clientId = Array.isArray(report.fields.client)
    ? (report.fields.client as string[])[0] : report.fields.client as string;
  const clientName = Array.isArray(report.fields.client_name)
    ? (report.fields.client_name as string[])[0] : (report.fields.client_name as string) || 'Unknown';

  if (!clientId) return c.json({ ok: false, error: 'No client linked to report' });

  // Update client is_active
  await airtable.updateRecord('tblFFttFScDRZ7Ah5', clientId, { is_active: body.active });

  logAudit(c.executionCtx, airtable, {
    action: body.active ? 'client_reactivated' : 'client_deactivated',
    report_id: body.report_id,
    details: `${clientName}: ${body.active ? 'Reactivated' : 'Deactivated'}`,
  });

  return c.json({ ok: true, active: body.active, client_name: clientName });
});

// POST /webhook/admin-update-client
client.post('/admin-update-client', async (c) => {
  const body = await c.req.json<{
    token?: string; report_id?: string; action?: string;
    name?: string; email?: string; cc_email?: string; phone?: string; notes?: string; client_notes?: string;
    rejected_uploads_log?: string;
    note_id?: string; mode?: string;
  }>();
  const tokenResult = await verifyToken(body.token || '', c.env.SECRET_KEY);
  if (!tokenResult.valid) return c.json({ ok: false, error: 'unauthorized' });

  const { report_id, action } = body;
  if (!report_id || !action || !['get', 'update', 'update-notes', 'update-client-notes', 'update-rejected-uploads', 'delete-client-note'].includes(action)) {
    return c.json({ ok: false, error: 'invalid_input' });
  }

  if (action === 'update' && body.name === undefined && body.email === undefined && body.cc_email === undefined && body.phone === undefined) {
    return c.json({ ok: false, error: 'invalid_input' });
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Get report to find linked client
  const report = await airtable.getRecord('tbls7m3hmHC4hhQVy', report_id);
  const clientId = Array.isArray(report.fields.client)
    ? (report.fields.client as string[])[0] : report.fields.client as string;

  if (!clientId) return c.json({ ok: false, error: 'No client linked to report' });

  // Route by action
  if (action === 'update-notes') {
    await airtable.updateRecord('tbls7m3hmHC4hhQVy', report_id, {
      notes: body.notes !== undefined ? body.notes : '',
    });
    logAudit(c.executionCtx, airtable, {
      action: 'notes_updated', report_id, details: 'Notes updated',
    });
    return c.json({ ok: true });
  }

  if (action === 'update-rejected-uploads') {
    if (body.rejected_uploads_log === undefined) {
      return c.json({ ok: false, error: 'rejected_uploads_log is required' });
    }
    await airtable.updateRecord('tbls7m3hmHC4hhQVy', report_id, {
      rejected_uploads_log: body.rejected_uploads_log,
    });
    logAudit(c.executionCtx, airtable, {
      action: 'rejected_uploads_log_updated', report_id, details: 'Rejected uploads log updated',
    });
    return c.json({ ok: true });
  }

  if (action === 'update-client-notes') {
    if (body.client_notes === undefined) {
      return c.json({ ok: false, error: 'client_notes is required' });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.client_notes);
    } catch {
      return c.json({ ok: false, error: 'client_notes must be a valid JSON string' });
    }
    if (!Array.isArray(parsed)) {
      return c.json({ ok: false, error: 'client_notes must be a JSON array' });
    }
    for (const entry of parsed) {
      if (
        typeof entry !== 'object' || entry === null ||
        typeof (entry as Record<string, unknown>).id !== 'string' ||
        typeof (entry as Record<string, unknown>).date !== 'string' ||
        typeof (entry as Record<string, unknown>).summary !== 'string' ||
        !['email', 'manual'].includes((entry as Record<string, unknown>).source as string)
      ) {
        return c.json({ ok: false, error: 'Each entry must have id (string), date (string), summary (string), source ("email"|"manual")' });
      }
    }
    await airtable.updateRecord('tbls7m3hmHC4hhQVy', report_id, {
      client_notes: body.client_notes,
    });
    logAudit(c.executionCtx, airtable, {
      action: 'client_notes_updated', report_id, details: 'Client notes updated',
    });
    return c.json({ ok: true });
  }

  // DL-263: Delete or hide a single client note
  if (action === 'delete-client-note') {
    const { note_id, mode } = body;
    if (!note_id || !mode || !['permanent', 'hide'].includes(mode)) {
      return c.json({ ok: false, error: 'note_id and mode ("permanent"|"hide") are required' });
    }

    const notesRaw = report.fields.client_notes as string | undefined;
    if (!notesRaw) return c.json({ ok: false, error: 'No client notes found' });

    let notes: Array<Record<string, unknown>>;
    try {
      notes = JSON.parse(notesRaw);
    } catch {
      return c.json({ ok: false, error: 'Invalid client_notes JSON' });
    }
    if (!Array.isArray(notes)) return c.json({ ok: false, error: 'client_notes is not an array' });

    let updatedNotes: Array<Record<string, unknown>>;
    if (mode === 'permanent') {
      updatedNotes = notes.filter(n => n.id !== note_id);
    } else {
      updatedNotes = notes.map(n => n.id === note_id ? { ...n, hidden_from_dashboard: true } : n);
    }

    await airtable.updateRecord('tbls7m3hmHC4hhQVy', report_id, {
      client_notes: JSON.stringify(updatedNotes),
    });

    // Invalidate recent messages cache for current year
    const year = String(report.fields.year || new Date().getFullYear());
    invalidateCache(c.env.CACHE_KV, `cache:recent_messages:${year}`);

    logAudit(c.executionCtx, airtable, {
      action: mode === 'permanent' ? 'client_note_deleted' : 'client_note_hidden',
      report_id,
      details: `Note ${note_id} ${mode === 'permanent' ? 'permanently deleted' : 'hidden from dashboard'}`,
    });

    return c.json({ ok: true });
  }

  if (action === 'get') {
    const clientRec = await airtable.getRecord('tblFFttFScDRZ7Ah5', clientId);
    return c.json({
      ok: true,
      client: {
        name: clientRec.fields.name || '',
        email: clientRec.fields.email || '',
        cc_email: clientRec.fields.cc_email || '',
        phone: clientRec.fields.phone || '',
      },
    });
  }

  // action === 'update'
  const updateFields: Record<string, unknown> = {};
  if (body.name !== undefined) updateFields.name = body.name;
  if (body.email !== undefined) updateFields.email = body.email;
  if (body.cc_email !== undefined) updateFields.cc_email = body.cc_email;
  if (body.phone !== undefined) updateFields.phone = body.phone;

  await airtable.updateRecord('tblFFttFScDRZ7Ah5', clientId, updateFields);

  logAudit(c.executionCtx, airtable, {
    action: 'client_updated', report_id,
    details: `Updated: ${Object.keys(updateFields).join(', ')}`,
  });

  return c.json({ ok: true });
});

export default client;
