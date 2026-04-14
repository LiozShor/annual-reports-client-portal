/**
 * DL-267: Auto-advance to Review when docs_missing_count reaches 0.
 * Single helper called from all document-status-change code paths.
 */

import { AirtableClient } from './airtable';

const REPORTS_TABLE = 'tbls7m3hmHC4hhQVy';

const ELIGIBLE_STAGES = ['Pending_Approval', 'Collecting_Docs'];

/**
 * Check if a report should auto-advance to Review (stage 5).
 * Guard: docs_missing_count === 0 AND stage is Pending_Approval or Collecting_Docs.
 * Idempotent — safe to call multiple times.
 */
export async function checkAutoAdvanceToReview(
  airtable: AirtableClient,
  reportId: string,
): Promise<boolean> {
  const report = await airtable.getRecord(REPORTS_TABLE, reportId);
  const fields = report.fields as Record<string, unknown>;
  const stage = fields.stage as string;
  const docsMissing = (fields.docs_missing_count as number) || 0;

  if (docsMissing === 0 && ELIGIBLE_STAGES.includes(stage)) {
    await airtable.updateRecord(REPORTS_TABLE, reportId, {
      stage: 'Review',
      docs_completed_at: fields.docs_completed_at || new Date().toISOString(),
      // Clear reminder fields — Review is not a reminder stage
      reminder_next_date: null,
      reminder_count: null,
      reminder_suppress: null,
      last_reminder_sent_at: null,
    });
    return true;
  }
  return false;
}
