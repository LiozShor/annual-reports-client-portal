import { AirtableClient } from './airtable';
import { MSGraphClient } from './ms-graph';
import { calcReminderNextDate } from './reminders';
import { invalidateCache } from './cache';
import type { Env } from './types';

interface QueuedEmail {
  reportId: string;
  subject: string;
  html: string;
  toAddress: string;
  fromMailbox: string;
  queuedAt: string;
  existingFirstSent: string | null;
  docsCount?: number; // DL-267: 0 docs → advance to Review instead of Collecting_Docs
}

const REPORTS_TABLE = 'tbls7m3hmHC4hhQVy';

export async function processQueuedEmails(env: Env, ctx: ExecutionContext): Promise<void> {
  const list = await env.CACHE_KV.list({ prefix: 'queued_email:' });
  if (list.keys.length === 0) return;

  console.log(`[email-queue] Processing ${list.keys.length} queued emails`);
  const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);
  const graph = new MSGraphClient(env, ctx);
  let sent = 0;

  for (const key of list.keys) {
    try {
      const raw = await env.CACHE_KV.get(key.name, 'json');
      if (!raw) {
        await env.CACHE_KV.delete(key.name);
        continue;
      }
      const payload = raw as QueuedEmail;

      // Send email
      await graph.sendMail(payload.subject, payload.html, payload.toAddress, payload.fromMailbox);

      // Update Airtable: advance stage (DL-267: Review if 0 docs, else Collecting_Docs)
      const now = new Date().toISOString();
      const targetStage = (payload.docsCount ?? 1) === 0 ? 'Review' : 'Collecting_Docs';
      const stageFields: Record<string, unknown> = {
        stage: targetStage,
        last_progress_check_at: now,
        docs_first_sent_at: payload.existingFirstSent || now,
        queued_send_at: null,
      };
      if (targetStage === 'Collecting_Docs') {
        stageFields.reminder_next_date = calcReminderNextDate();
        stageFields.reminder_count = 0;
        stageFields.last_reminder_sent_at = null;
      } else {
        stageFields.docs_completed_at = now;
        stageFields.reminder_next_date = null;
        stageFields.reminder_count = null;
        stageFields.last_reminder_sent_at = null;
      }
      await airtable.updateRecord(REPORTS_TABLE, payload.reportId, stageFields);

      // Delete from queue
      await env.CACHE_KV.delete(key.name);
      sent++;

      // Small delay between sends to avoid MS Graph rate limits
      if (list.keys.indexOf(key) < list.keys.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error(`[email-queue] Failed to send ${key.name}:`, (err as Error).message);
      // Don't delete — will retry next cron run (TTL handles cleanup after 24h)
    }
  }

  // Invalidate documents cache if any were sent
  if (sent > 0) {
    invalidateCache(env.CACHE_KV, 'cache:documents_non_waived');
    console.log(`[email-queue] Sent ${sent}/${list.keys.length} queued emails`);
  }
}
