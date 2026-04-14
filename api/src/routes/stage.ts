import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { logAudit } from '../lib/audit-log';
import { calcReminderNextDate, isReminderStage } from '../lib/reminders';
import type { Env } from '../lib/types';

const stage = new Hono<{ Bindings: Env }>();

const STAGE_ORDER: Record<string, number> = {
  Send_Questionnaire: 1, Waiting_For_Answers: 2, Pending_Approval: 3,
  Collecting_Docs: 4, Review: 5, Moshe_Review: 6, Before_Signing: 7, Completed: 8,
};
const VALID_STAGES = Object.keys(STAGE_ORDER);

// POST /webhook/admin-change-stage
stage.post('/admin-change-stage', async (c) => {
  const body = await c.req.json<{ token?: string; report_id?: string; target_stage?: string }>();
  const tokenResult = await verifyToken(body.token || '', c.env.SECRET_KEY);
  if (!tokenResult.valid) return c.json({ ok: false, error: 'unauthorized' });

  const { report_id, target_stage } = body;
  if (!report_id || !target_stage || !VALID_STAGES.includes(target_stage)) {
    return c.json({ ok: false, error: 'invalid_input' });
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Get current report
  const report = await airtable.getRecord('tbls7m3hmHC4hhQVy', report_id);
  const prevStage = (report.fields.stage as string) || 'Send_Questionnaire';
  const prevNum = STAGE_ORDER[prevStage] || 0;
  const targetNum = STAGE_ORDER[target_stage] || 0;
  const isBackward = targetNum < prevNum;

  // Build update fields
  const fields: Record<string, unknown> = { stage: target_stage };

  // Clear docs_completed_at on backward moves from stage 5+
  if (isBackward && prevNum >= 5) {
    fields.docs_completed_at = null;
  }

  // Reminder logic (DL-155)
  if (isReminderStage(targetNum)) {
    fields.reminder_next_date = calcReminderNextDate();
    fields.reminder_count = 0;
    fields.last_reminder_sent_at = null;
    // Preserve 'forever' suppress
    const currentSuppress = ((report.fields.reminder_suppress as string) || '').trim();
    fields.reminder_suppress = currentSuppress === 'forever' ? 'forever' : null;
  } else if (targetNum >= 5) {
    // Clear reminder fields for stages 5+
    fields.reminder_next_date = null;
    fields.reminder_count = null;
    fields.reminder_suppress = null;
    fields.last_reminder_sent_at = null;
    fields.rejected_uploads_log = '';
  }

  await airtable.updateRecord('tbls7m3hmHC4hhQVy', report_id, fields);

  const clientName = Array.isArray(report.fields.client_name)
    ? report.fields.client_name[0] : (report.fields.client_name || 'Unknown');

  logAudit(c.executionCtx, airtable, {
    action: 'stage_change',
    report_id,
    details: `${clientName}: ${prevStage} → ${target_stage}`,
  });

  return c.json({ ok: true });
});

// POST /webhook/admin-mark-complete
stage.post('/admin-mark-complete', async (c) => {
  const body = await c.req.json<{ token?: string; report_id?: string }>();
  const tokenResult = await verifyToken(body.token || '', c.env.SECRET_KEY);
  if (!tokenResult.valid) return c.json({ ok: false, error: 'unauthorized' });

  if (!body.report_id) return c.json({ ok: false, error: 'invalid_input' });

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  await airtable.updateRecord('tbls7m3hmHC4hhQVy', body.report_id, { stage: 'Completed' });

  return c.json({ ok: true });
});

export default stage;
