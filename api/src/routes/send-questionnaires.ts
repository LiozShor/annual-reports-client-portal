import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { generateClientToken } from '../lib/client-token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { calcReminderNextDate } from '../lib/reminders';
import { buildQuestionnaireEmailHtml } from '../lib/email-html';
import { logError } from '../lib/error-logger';
import type { Env } from '../lib/types';

const sendQuestionnaires = new Hono<{ Bindings: Env }>();

const FRONTEND_BASE = 'https://liozshor.github.io/annual-reports-client-portal';
const SENDER = 'reports@moshe-atsits.co.il';
const REPORTS_TABLE = 'tbls7m3hmHC4hhQVy';
const CLIENTS_TABLE = 'tblFFttFScDRZ7Ah5';

const FILING_LABELS: Record<string, string> = {
  annual_report: 'דוח שנתי',
  capital_statement: 'הצהרת הון',
};

function first(val: unknown): string {
  if (Array.isArray(val)) return (val[0] ?? '') as string;
  return (val ?? '') as string;
}

sendQuestionnaires.post('/admin-send-questionnaires', async (c) => {
  try {
    const body = await c.req.json();

    // Step 1: Auth
    const tokenResult = await verifyToken(body.token, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    // Step 2: Validate input & deduplicate
    const rawIds: string[] = body.report_ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return c.json({ ok: false, error: 'No report_ids provided' }, 400);
    }
    const reportIds = [...new Set(rawIds)];

    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
    const graph = new MSGraphClient(c.env, c.executionCtx);

    let sent = 0;
    const errors: { message: string; report_id: string }[] = [];

    // Step 3: Process each report — update stage immediately after email sends
    for (const reportId of reportIds) {
      try {
        const report = await airtable.getRecord(REPORTS_TABLE, reportId);

        // Stage guard — only send if report is still pending questionnaire
        const stage = first(report.fields.stage);
        if (stage !== 'Send_Questionnaire') {
          errors.push({ message: `Skipped — stage is "${stage}", not Send_Questionnaire`, report_id: reportId });
          continue;
        }

        const clientRecordId = first(report.fields.client);
        if (!clientRecordId) {
          errors.push({ message: 'No linked client', report_id: reportId });
          continue;
        }

        const client = await airtable.getRecord(CLIENTS_TABLE, clientRecordId);
        const clientName = first(client.fields.name);
        const clientEmail = first(client.fields.email);
        const year = first(report.fields.year);
        const filingType = first(report.fields.filing_type) || 'annual_report';

        if (!clientEmail) {
          errors.push({ message: 'No client email', report_id: reportId });
          continue;
        }

        const clientToken = await generateClientToken(reportId, c.env.CLIENT_SECRET_KEY);
        const landingPageUrl = `${FRONTEND_BASE}/?report_id=${reportId}&token=${encodeURIComponent(clientToken)}`;

        const ccEmail = first(client.fields.cc_email) || undefined;
        const html = buildQuestionnaireEmailHtml({ clientName, year, landingPageUrl, showFamilyNote: !!ccEmail, filingType });
        const label = FILING_LABELS[filingType] || FILING_LABELS.annual_report;
        const subject = `שאלון \u2014 ${label} ${year} | ${clientName}`;

        await graph.sendMail(subject, html, clientEmail, SENDER, ccEmail);

        // Update stage immediately after email confirmed sent — never defer
        await airtable.updateRecord(REPORTS_TABLE, reportId, {
          stage: 'Waiting_For_Answers',
          last_progress_check_at: new Date().toISOString(),
          reminder_next_date: calcReminderNextDate(),
          reminder_count: 0,
          last_reminder_sent_at: null,
        });

        sent++;
      } catch (err) {
        errors.push({
          message: (err as Error).message,
          report_id: reportId,
        });
      }
    }

    // Step 4: Return results
    return c.json({
      ok: sent > 0 || errors.length === 0,
      sent,
      failed: errors.length,
      errors,
    });
  } catch (err) {
    console.error('[send-questionnaires] Error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/send-questionnaires',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default sendQuestionnaires;
