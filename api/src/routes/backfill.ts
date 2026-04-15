/**
 * DL-279: Backfill note sender_email — fix forwarded notes that show
 * office member email instead of client email.
 * Remove after running once in production.
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import type { Env } from '../lib/types';

const backfill = new Hono<{ Bindings: Env }>();

const TABLES = {
  REPORTS: 'tbls7m3hmHC4hhQVy',
};

const OFFICE_EMAIL = 'natan@moshe-atsits.co.il';

backfill.post('/backfill-note-sender', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') || c.req.query('token') || '';
  if (!verifyToken(token, c.env.ADMIN_SECRET)) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Find reports that have client_notes containing natan's email
  const reports = await airtable.listAllRecords(TABLES.REPORTS, {
    filterByFormula: `FIND('${OFFICE_EMAIL}', {client_notes})`,
    fields: ['client_notes', 'client_email', 'client_name'],
  });

  let fixed = 0;
  const results: Array<{ id: string; name: string; notesFixed: number }> = [];

  for (const report of reports) {
    const f = report.fields as Record<string, unknown>;
    const clientEmail = Array.isArray(f.client_email)
      ? (f.client_email[0] as string || '').toLowerCase()
      : ((f.client_email as string) || '').toLowerCase();

    if (!clientEmail) continue;

    let notes: Array<Record<string, unknown>> = [];
    try {
      notes = JSON.parse((f.client_notes as string) || '[]');
      if (!Array.isArray(notes)) continue;
    } catch { continue; }

    let notesFixed = 0;
    for (const note of notes) {
      if (typeof note.sender_email === 'string' && note.sender_email.toLowerCase() === OFFICE_EMAIL) {
        note.sender_email = clientEmail;
        notesFixed++;
      }
    }

    if (notesFixed > 0) {
      await airtable.updateRecord(TABLES.REPORTS, report.id, {
        client_notes: JSON.stringify(notes),
      });
      fixed += notesFixed;
      results.push({
        id: report.id,
        name: (f.client_name as string) || '',
        notesFixed,
      });
    }
  }

  return c.json({
    ok: true,
    reports_checked: reports.length,
    notes_fixed: fixed,
    results,
  });
});

export default backfill;
