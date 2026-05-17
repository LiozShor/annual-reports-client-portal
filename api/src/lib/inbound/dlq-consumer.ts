/**
 * Cloudflare Queues DLQ consumer for inbound email notifications (DL-287).
 *
 * Each message delivered here is an inbound-email notification that already
 * failed 3 processing attempts on the main queue (see queue-consumer.ts).
 * The DLQ handler is the *recovery path*: we log the failure to the Airtable
 * security_logs table and (throttled) email `env.ALERT_EMAIL` so the operator
 * can investigate. We do NOT retry — retrying a message that has already
 * exhausted its budget would either spin forever (vendor outage) or mask a
 * code bug.
 *
 * Category: `DEPENDENCY` distinguishes the terminal DLQ alert from the
 * mid-retry transient errors emitted by queue-consumer.ts with `INTERNAL`.
 *
 * Retries on THIS handler: wrangler.toml sets `max_retries = 1` on the DLQ,
 * so a single thrown error drops the message. That's acceptable because
 * `logError` is fire-and-forget (ctx.waitUntil + catch wrapper in
 * error-logger.ts) and should essentially never throw synchronously.
 */

import type { Env, InboundQueueMessage } from '../types';
import { logError } from '../error-logger';
import { AirtableClient } from '../airtable';
import { TABLES } from './types';

/**
 * DL-417 — stamp Airtable email_events row Failed when DLQ exhausts retries.
 * Fail-open: ANY error here is logged but never propagated, so the ack contract
 * downstream is preserved. Worst case: the row stays at its prior status
 * (Detected) and the existing R2 log + alert email remain the audit trail.
 */
async function stampDlqFailureOnAirtable(
  env: Env,
  messageId: string,
  reason: string,
): Promise<void> {
  if (!messageId || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_PAT) return;
  try {
    const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);
    await airtable.upsertRecords(
      TABLES.EMAIL_EVENTS,
      [{
        fields: {
          source_message_id: messageId,
          processing_status: 'Failed',
          error_message: reason.slice(0, 1000),
          last_error_step: 'dlq_exhausted',
        },
      }],
      ['source_message_id'],
    );
  } catch (err) {
    console.error(`[dlq] airtable stamp failed (fail-open) message_id=${messageId}: ${(err as Error).message}`);
  }
}

export async function handleInboundDLQ(
  batch: MessageBatch<InboundQueueMessage>,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    const { message_id, change_type } = message.body;
    const timestamp = new Date().toISOString();

    console.error(
      `[dlq] dead-lettered message_id=${message_id} change_type=${change_type ?? 'unknown'} attempts=${message.attempts} queue=${batch.queue} timestamp=${timestamp}`,
    );

    const error = new Error(
      `DLQ: inbound email dead-lettered after max retries (message_id=${message_id}, attempts=${message.attempts}, timestamp=${timestamp}, queue=${batch.queue})`,
    );

    logError(ctx, env, {
      endpoint: '/queue/inbound-email-dlq',
      error,
      category: 'DEPENDENCY',
      details: `change_type=${change_type ?? 'unknown'}`,
    });

    // DL-417: stamp email_events row as Failed so the admin "stuck emails"
    // widget surfaces this terminal failure. Fail-open — does not affect ack.
    ctx.waitUntil(
      stampDlqFailureOnAirtable(
        env,
        message_id,
        `DLQ exhausted (attempts=${message.attempts}, change_type=${change_type ?? 'unknown'}, ts=${timestamp})`,
      ),
    );

    // Ack unconditionally — the log + alert IS the recovery path.
    // Retrying a DLQ message would either spin on a vendor outage or
    // silently repeat a code-bug failure.
    message.ack();
  }
}
