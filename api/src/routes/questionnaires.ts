import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { formatQuestionnaire } from '../lib/format-questionnaire';
import type { Env } from '../lib/types';

const questionnaires = new Hono<{ Bindings: Env }>();

// GET /webhook/admin-questionnaires
// Note: frontend sends token via ?token= query param (not Authorization header)
questionnaires.get('/admin-questionnaires', async (c) => {
  const query = c.req.query();
  const token = query.token || '';

  const result = await verifyToken(token, c.env.SECRET_KEY);
  if (!result.valid) {
    return c.json({ ok: false, error: 'unauthorized' });
  }

  const year = query.year || String(new Date().getFullYear());
  const reportId = query.report_id || null;
  const filingType = query.filing_type || 'annual_report';
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Search questionnaires by report_id or year
  const filter = reportId
    ? `{report_record_id}='${reportId}'`
    : `{year}='${year}'`;

  const records = await airtable.listAllRecords('tblxEox8MsbliwTZI', {
    filterByFormula: filter,
  });

  // Format Q&A (replaces [SUB] Format Questionnaire sub-workflow)
  const formatted = records
    .filter((r) => r.fields && (r.fields.report_record_id || r.fields.client_id))
    .map((r) => {
      const qa = formatQuestionnaire(r.fields as Record<string, unknown>);
      return {
        report_record_id: qa.client_info.report_record_id,
        client_info: qa.client_info,
        answers: qa.answers,
        raw_answers: qa.raw_answers,
      };
    });

  // Batch-fetch client_questions from annual_reports
  const reportIds = [...new Set(formatted.map((f) => f.report_record_id).filter(Boolean))];

  let questionsMap: Record<string, string> = {};
  const filingTypeMap: Record<string, string> = {};
  const notesMap: Record<string, string> = {};
  if (reportIds.length > 0) {
    const parts = reportIds.map((id) => `{record_id}='${id}'`);
    const formula = reportIds.length === 1 ? parts[0] : `OR(${parts.join(',')})`;
    const reportRecords = await airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
      filterByFormula: formula,
      fields: ['record_id', 'client_questions', 'filing_type', 'notes'],
    });
    for (const r of reportRecords) {
      const rid = r.fields.record_id as string;
      if (rid) {
        questionsMap[rid] = (r.fields.client_questions as string) || '';
        filingTypeMap[rid] = (r.fields.filing_type as string) || 'annual_report';
        notesMap[rid] = (r.fields.notes as string) || '';
      }
    }
  }

  // Enrich with client_questions + notes + filter by filing_type
  const items = formatted
    .filter((f) => (filingTypeMap[f.report_record_id] || 'annual_report') === filingType)
    .map((f) => ({
      ...f,
      client_questions: questionsMap[f.report_record_id] || '',
      notes: notesMap[f.report_record_id] || '',
      filing_type: filingTypeMap[f.report_record_id] || 'annual_report',
    }));

  return c.json({ ok: true, items, count: items.length });
});

export default questionnaires;
