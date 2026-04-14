import { Hono } from 'hono';
import { verifyClientToken } from '../lib/client-token';
import { AirtableClient } from '../lib/airtable';
import { logSecurity, getClientIp } from '../lib/security-log';
import type { Env } from '../lib/types';

const submission = new Hono<{ Bindings: Env }>();

const STAGE_ORDER: Record<string, number> = {
  Send_Questionnaire: 1,
  Waiting_For_Answers: 2,
  Pending_Approval: 3,
  Collecting_Docs: 4,
  Review: 5,
  Moshe_Review: 6,
  Before_Signing: 7,
  Completed: 8,
};

const FILING_CONFIG: Record<string, { form_id_he: string; form_id_en: string; label_he: string; label_en: string }> = {
  annual_report: {
    form_id_he: '1AkYKb',
    form_id_en: '1AkopM',
    label_he: 'דוח שנתי',
    label_en: 'Annual Report',
  },
  capital_statement: {
    form_id_he: '7Roovz',
    form_id_en: '',
    label_he: 'הצהרת הון',
    label_en: 'Capital Statement',
  },
};

// GET /webhook/check-existing-submission
submission.get('/check-existing-submission', async (c) => {
  const query = c.req.query();
  const reportId = query.report_id;

  if (!reportId) {
    return c.json({ ok: false, error: 'Missing report_id' });
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Get report by ID
  let report: Record<string, unknown>;
  try {
    const rec = await airtable.getRecord('tbls7m3hmHC4hhQVy', reportId);
    report = { id: rec.id, ...rec.fields };
  } catch {
    return c.json({ ok: false, error: 'Report not found' });
  }

  // Validate client token
  const token = query.token || '';
  const tokenResult = await verifyClientToken(report.id as string, token, c.env.CLIENT_SECRET_KEY);

  if (!tokenResult.valid) {
    const clientIp = getClientIp(c.req.raw.headers);
    logSecurity(c.executionCtx, airtable, {
      timestamp: new Date().toISOString(),
      event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      severity: 'WARNING',
      actor: 'client-token',
      actor_ip: clientIp,
      endpoint: '/webhook/check-existing-submission',
      http_status: 200,
      error_message: tokenResult.reason || '',
    });
    return c.json({ ok: false, error: tokenResult.reason });
  }

  // Search non-waived/removed documents
  const docRecords = await airtable.listAllRecords('tblcwptR63skeODPn', {
    filterByFormula: `AND(FIND('${reportId}', ARRAYJOIN({report_record_id})), {status} != 'Waived', {status} != 'Removed')`,
  });
  const documentCount = docRecords.length;

  const stage = (report.stage as string) || 'Send_Questionnaire';
  const stageRank = STAGE_ORDER[stage] || 0;
  const hasSubmission = stageRank >= 3 || documentCount > 0;

  const filingType = (report.filing_type as string) || 'annual_report';
  const ftConfig = FILING_CONFIG[filingType] || FILING_CONFIG.annual_report;

  const getField = (val: unknown) => Array.isArray(val) ? val[0] : (val || '');

  return c.json({
    ok: true,
    has_submission: hasSubmission,
    document_count: documentCount,
    stage,
    stage_rank: stageRank,
    report_id: report.id,
    year: String(report.year || ''),
    client_name: getField(report.client_name),
    client_email: getField(report.client_email),
    client_id: getField(report.client_id),
    spouse_name: (report.spouse_name as string) || '',
    filing_type: filingType,
    form_id_he: ftConfig.form_id_he,
    form_id_en: ftConfig.form_id_en,
    filing_type_label_he: ftConfig.label_he,
    filing_type_label_en: ftConfig.label_en,
  });
});

export default submission;
