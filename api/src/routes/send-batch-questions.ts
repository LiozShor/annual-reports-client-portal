import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { logError } from '../lib/error-logger';
import { buildBatchQuestionsSubject, buildBatchQuestionsHtml } from '../lib/email-html';
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

    // Send email
    const graph = new MSGraphClient(c.env, c.executionCtx);
    await graph.sendMail(subject, html, clientEmail, SENDER);

    // Append to client_notes + clear pending_question on classification records
    const existingNotes = first(report.fields.client_notes);
    let notes: unknown[] = [];
    try { notes = JSON.parse(existingNotes || '[]'); } catch { notes = []; }
    if (!Array.isArray(notes)) notes = [];
    notes.push({
      type: 'batch_questions_sent',
      date: new Date().toISOString(),
      items: validQuestions,
      language,
    });

    const fileIds = validQuestions.map(q => q.file_id).filter(Boolean);
    await Promise.all([
      airtable.updateRecord(TABLES.REPORTS, report_id, { client_notes: JSON.stringify(notes) }),
      ...fileIds.map(id => airtable.updateRecord(TABLES.CLASSIFICATIONS, id, { pending_question: null })),
    ]);

    return c.json({ ok: true });

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
