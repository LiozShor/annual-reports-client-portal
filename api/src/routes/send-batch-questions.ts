import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { logError } from '../lib/error-logger';
import { buildBatchQuestionsSubject, buildBatchQuestionsHtml } from '../lib/email-html';
import { isOffHours, getNext0800Israel } from '../lib/israel-time';
import type { Env } from '../lib/types';
import type { BatchQuestionItem } from '../lib/email-html';

const sendBatchQuestions = new Hono<{ Bindings: Env }>();

const TABLES = { REPORTS: 'tbls7m3hmHC4hhQVy', CLASSIFICATIONS: 'tbloiSDN3rwRcl1ii' };
const SENDER = 'reports@moshe-atsits.co.il';

function first(val: unknown): string {
  if (Array.isArray(val)) return (val[0] ?? '') as string;
  return (val ?? '') as string;
}

sendBatchQuestions.post('/send-batch-questions', async (c) => {
  try {
    // Auth: Bearer token only (admin endpoint)
    const authHeader = c.req.header('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return c.json({ ok: false, error: 'INVALID_TOKEN' }, 401);
    }
    const tokenResult = await verifyToken(authHeader.slice(7), c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, error: 'INVALID_TOKEN' }, 401);
    }

    // Parse + validate body
    let body: { report_id?: string; questions?: BatchQuestionItem[]; preview?: boolean };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const { report_id, questions, preview } = body;

    if (!report_id) return c.json({ ok: false, error: 'Missing report_id' }, 400);
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return c.json({ ok: false, error: 'At least one question is required' }, 400);
    }
    const validQuestions = questions.filter(q => q.question && q.question.trim().length > 0);
    if (validQuestions.length === 0) {
      return c.json({ ok: false, error: 'At least one non-empty question is required' }, 400);
    }

    // Fetch report
    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
    const report = await airtable.getRecord(TABLES.REPORTS, report_id);

    const clientName = first(report.fields.client_name);
    const clientEmail = first(report.fields.client_email);
    const language = first(report.fields.source_language) || 'he';
    const filingType = first(report.fields.filing_type) || 'annual_report';
    const year = first(report.fields.year) || new Date().getFullYear();

    // Build email
    const subject = buildBatchQuestionsSubject(filingType, year, language);
    const html = buildBatchQuestionsHtml(clientName, language, validQuestions, filingType, year);

    // Preview mode — return rendered email, skip send
    if (preview === true) {
      return c.json({ ok: true, subject, html, language, client_email: clientEmail });
    }

    if (!clientEmail) {
      return c.json({ ok: false, error: 'No client email on report' }, 400);
    }

    // Send email — off-hours (20:00-08:00 Israel) defers to next 08:00 via PidTagDeferredSendTime (DL-264/273)
    const graph = new MSGraphClient(c.env, c.executionCtx);
    const offHours = isOffHours();
    let deferredMessageId: string | null = null;
    if (offHours) {
      const deferredUtc = getNext0800Israel();
      const r = await graph.sendMailDeferred(subject, html, clientEmail, SENDER, deferredUtc);
      deferredMessageId = r.messageId;
    } else {
      await graph.sendMail(subject, html, clientEmail, SENDER);
    }

    // Append to client_notes + set on_hold on classification records that have questions (DL-335).
    // Keep pending_question intact on on_hold rows so the held card can display the question text.
    // When queued, stamp graph_message_id so DL-281 queue modal (Outlook = source of truth) can surface it.
    const existingNotes = first(report.fields.client_notes);
    let notes: unknown[] = [];
    try { notes = JSON.parse(existingNotes || '[]'); } catch { notes = []; }
    if (!Array.isArray(notes)) notes = [];
    const heldCount = validQuestions.length;
    const summaryHe = `שלחנו ללקוח ${heldCount} שאל${heldCount === 1 ? 'ה' : 'ות'} לגבי המסמכים שהעברת`;
    const summaryEn = `Sent ${heldCount} question${heldCount === 1 ? '' : 's'} to client about submitted documents`;
    notes.push({
      id: `bq_${Date.now()}`,
      type: 'batch_questions_sent',
      date: new Date().toISOString(),
      summary: language === 'en' ? summaryEn : summaryHe,
      source: 'office_question',
      items: validQuestions,
      language,
      ...(deferredMessageId ? { graph_message_id: deferredMessageId, queued: true } : {}),
    });

    // DL-335: set review_status='on_hold' to keep rows in AI Review (not cleared from queue).
    // pending_question is kept so the held card can display the question text.
    const fileIds = validQuestions.map(q => q.file_id).filter(Boolean);
    await Promise.all([
      airtable.updateRecord(TABLES.REPORTS, report_id, { client_notes: JSON.stringify(notes) }),
      ...fileIds.map(id => airtable.updateRecord(TABLES.CLASSIFICATIONS, id, { review_status: 'on_hold' })),
    ]);

    return c.json({ ok: true, queued: offHours, held_count: heldCount, ...(offHours ? { scheduled_for: '08:00' } : {}) });

  } catch (err) {
    console.error('[send-batch-questions] CAUGHT ERROR:', (err as Error).message, (err as Error).stack);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/send-batch-questions',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default sendBatchQuestions;
