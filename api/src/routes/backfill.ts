/**
 * DL-279 / DL-282: Backfill note sender_email — fix forwarded notes that show
 * an office member's email instead of the real client's email.
 * DL-314: Backfill pending_classifications for clients who received docs before
 * submitting their questionnaire (initially scoped to CPA-XXX).
 * Remove after running once in production.
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { DRIVE_ID } from '../lib/classification-helpers';
import { classifyAttachment } from '../lib/inbound/document-classifier';
import type { AttachmentInfo, ProcessingContext } from '../lib/inbound/types';
import type { Env } from '../lib/types';

const backfill = new Hono<{ Bindings: Env }>();

const TABLES = {
  REPORTS: 'tbls7m3hmHC4hhQVy',
  PENDING_CLASSIFICATIONS: 'tbloiSDN3rwRcl1ii',
};

const OFFICE_DOMAIN = '@moshe-atsits.co.il';

backfill.post('/backfill-note-sender', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') || c.req.query('token') || '';
  if (!verifyToken(token, c.env.ADMIN_SECRET)) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Find reports that have client_notes containing ANY office address
  // (DL-282: broaden from natan@ only to catch moshe@ and any other @moshe-atsits.co.il)
  const reports = await airtable.listAllRecords(TABLES.REPORTS, {
    filterByFormula: `FIND('${OFFICE_DOMAIN}', {client_notes})`,
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
      // Only rewrite notes that look like ingested client email (source='email')
      // AND whose sender_email sits in the office domain — leave office_reply
      // notes (DL-266) alone since those genuinely originate from the office.
      if (note.type === 'office_reply') continue;
      if (note.source !== 'email') continue;
      const existing = typeof note.sender_email === 'string' ? note.sender_email.toLowerCase() : '';
      if (existing && existing.endsWith(OFFICE_DOMAIN)) {
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

// ---------------------------------------------------------------------------
// DL-314: Re-classify pre-questionnaire pending_classifications (null template)
// Usage:
//   POST /webhook/backfill-dl314?clientId=CPA-XXX&dryRun=1
//   Authorization: Bearer <ADMIN_SECRET token>
// Remove after CPA-XXX backfill is verified in production.
// ---------------------------------------------------------------------------

backfill.post('/backfill-dl314', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') || c.req.query('token') || '';
  const auth = await verifyToken(token, c.env.SECRET_KEY);
  if (!auth.valid) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const clientId = c.req.query('clientId') || '';
  const dryRun = c.req.query('dryRun') !== '0';
  if (!clientId) {
    return c.json({ ok: false, error: 'clientId query param required' }, 400);
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  const msGraph = new MSGraphClient(c.env, c.executionCtx);

  // Load pending_classifications for this client with no template and not already reviewed
  const escClientId = clientId.replace(/'/g, "\\'");
  const rows = await airtable.listAllRecords(TABLES.PENDING_CLASSIFICATIONS, {
    filterByFormula: `AND({client_id} = '${escClientId}', {matched_template_id} = BLANK(), {review_status} = 'pending')`,
  });

  // Prefetch reports to resolve filing_type + stage per row
  const reportCache = new Map<string, { filingType: string; stage: string; clientName: string }>();
  async function getReport(reportId: string) {
    if (reportCache.has(reportId)) return reportCache.get(reportId)!;
    const rec = await airtable.getRecord(TABLES.REPORTS, reportId);
    const f = rec.fields as Record<string, unknown>;
    const info = {
      filingType: (f.filing_type as string) || 'annual_report',
      stage: (f.stage as string) || '',
      clientName: (f.client_name as string) || '',
    };
    reportCache.set(reportId, info);
    return info;
  }

  const results: Array<{
    id: string;
    attachment_name: string;
    newTemplate: string | null;
    confidence: number;
    reason: string;
    filingType: string;
    stage: string;
    error?: string;
  }> = [];

  for (const row of rows) {
    const f = row.fields as Record<string, unknown>;
    const attName = (f.attachment_name as string) || '';
    const itemId = (f.onedrive_item_id as string) || '';
    const reportLinks = Array.isArray(f.report) ? (f.report as string[]) : [];
    const reportId = reportLinks[0] || '';

    if (!itemId || !reportId) {
      results.push({ id: row.id, attachment_name: attName, newTemplate: null, confidence: 0, reason: '', filingType: '', stage: '', error: 'missing onedrive_item_id or report link' });
      continue;
    }

    try {
      const report = await getReport(reportId);

      const bytes = await msGraph.getBinary(`/drives/${DRIVE_ID}/items/${itemId}/content`);

      const attachment: AttachmentInfo = {
        id: `backfill-${row.id}`,
        name: attName || 'document.pdf',
        contentType: (f.attachment_content_type as string) || 'application/pdf',
        size: (f.attachment_size as number) || bytes.byteLength,
        content: bytes,
        sha256: (f.file_hash as string) || '',
      };

      const pCtx: ProcessingContext = {
        env: c.env,
        ctx: c.executionCtx,
        messageId: `backfill-dl314-${row.id}`,
        airtable,
        graph: msGraph,
      };

      const classification = await classifyAttachment(
        pCtx,
        attachment,
        [],
        report.clientName,
        {
          subject: `Backfill ${attName}`,
          bodyPreview: (f.email_body_text as string) || '',
          senderName: (f.sender_name as string) || '',
          senderEmail: (f.sender_email as string) || '',
          fallbackMode: true,
          filingType: report.filingType,
        },
      );

      results.push({
        id: row.id,
        attachment_name: attName,
        newTemplate: classification.templateId,
        confidence: classification.confidence,
        reason: (classification.reason || '').slice(0, 160),
        filingType: report.filingType,
        stage: report.stage,
      });

      if (!dryRun && classification.templateId) {
        await airtable.updateRecord(TABLES.PENDING_CLASSIFICATIONS, row.id, {
          matched_template_id: classification.templateId,
          ai_confidence: classification.confidence,
          ai_reason: classification.reason,
          issuer_name: classification.issuerName || '',
          pre_questionnaire: true,
        });
      }
    } catch (err) {
      results.push({
        id: row.id,
        attachment_name: attName,
        newTemplate: null,
        confidence: 0,
        reason: '',
        filingType: '',
        stage: '',
        error: (err as Error).message,
      });
    }
  }

  return c.json({
    ok: true,
    clientId,
    dryRun,
    rowsChecked: rows.length,
    resultsCount: results.length,
    results,
  });
});

export default backfill;
