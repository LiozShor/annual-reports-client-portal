import { AirtableClient } from './airtable';

const AUDIT_TABLE = 'tblVjLznorm0jrRtd';

/** Fire-and-forget audit log entry via waitUntil */
export function logAudit(
  ctx: ExecutionContext,
  airtable: AirtableClient,
  entry: { action: string; report_id?: string; details: string }
): void {
  ctx.waitUntil(
    airtable
      .createRecords(AUDIT_TABLE, [{
        fields: {
          action: entry.action,
          report_id: entry.report_id || '',
          details: entry.details,
          timestamp: new Date().toISOString(),
          actor: 'admin',
        },
      }])
      .catch(() => { /* fire-and-forget */ })
  );
}
