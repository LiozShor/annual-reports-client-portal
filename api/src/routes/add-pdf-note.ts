/**
 * add-pdf-note.ts — DL-372
 *
 * POST /webhook/add-pdf-note
 * Adds a /Annot Text sticky-note to page 1 of a PDF and mirrors the text to
 * Airtable documents.internal_pdf_note. Requires admin Bearer token.
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { logError } from '../lib/error-logger';
import { logEvent } from '../lib/activity-logger';
import { addStickyNote, type Corner } from '../lib/pdf-annotations';
import { DRIVE_ID } from '../lib/classification-helpers';
import type { Env } from '../lib/types';

const addPdfNote = new Hono<{ Bindings: Env }>();

const VALID_CORNERS = new Set<string>(['tl', 'tr', 'bl', 'br']);
const TABLE_DOCUMENTS = 'tblcwptR63skeODPn';

addPdfNote.post('/add-pdf-note', async (c) => {
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  try {
    // Auth
    const authHeader = c.req.header('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const tokenResult = await verifyToken(bearerToken, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    const body = await c.req.json() as Record<string, unknown>;
    const { itemId, recordId, note, corner } = body;

    if (typeof itemId !== 'string' || !itemId) return c.json({ ok: false, error: 'Missing itemId' }, 400);
    if (typeof recordId !== 'string' || !recordId) return c.json({ ok: false, error: 'Missing recordId' }, 400);
    if (typeof note !== 'string' || !note.trim()) return c.json({ ok: false, error: 'Missing note' }, 400);
    if (note.length > 500) return c.json({ ok: false, error: 'Note exceeds 500 characters' }, 400);
    if (typeof corner !== 'string' || !VALID_CORNERS.has(corner)) return c.json({ ok: false, error: 'Invalid corner' }, 400);

    const msGraph = new MSGraphClient(c.env, c.executionCtx);

    // Fetch PDF bytes
    const pdfBytes = await msGraph.getBinary(`/drives/${DRIVE_ID}/items/${itemId}/content`);

    // Annotate
    let annotatedBytes: Uint8Array;
    try {
      annotatedBytes = await addStickyNote(pdfBytes, { text: note.trim(), corner: corner as Corner });
    } catch (err: any) {
      if (/encrypted|password/i.test(err?.message || '')) {
        return c.json({ ok: false, error: 'PDF_ENCRYPTED', message: 'PDF is encrypted — unlock it first via the unlock flow' }, 422);
      }
      if (/pdf.?a/i.test(err?.message || '') || /read.?only/i.test(err?.message || '')) {
        return c.json({ ok: false, error: 'PDF_LOCKED_PDFA', message: 'This PDF cannot be annotated (PDF/A restricted) — note saved on record only' }, 422);
      }
      throw err;
    }

    // Replace file in OneDrive
    await msGraph.putBinaryReplace(itemId, annotatedBytes.buffer as ArrayBuffer);

    // Mirror note to Airtable
    const noteWithMeta = `[${new Date().toISOString().slice(0, 10)}] ${note.trim()}`;
    await airtable.updateRecord(TABLE_DOCUMENTS, recordId, { 'internal_pdf_note': noteWithMeta });

    logEvent({
      event_type: 'pdf_note_added',
      category: 'ADMIN',
      details: { recordId, corner },
    });

    return c.json({
      ok: true,
      hasNote: true,
      noteSnippet: note.trim().slice(0, 60),
    });
  } catch (err: any) {
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/add-pdf-note',
      error: err,
      category: 'INTERNAL',
    });
    return c.json({ ok: false, error: 'GRAPH_FAILED', message: err.message }, 500);
  }
});

export default addPdfNote;
