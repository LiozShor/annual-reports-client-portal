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

    // Ack unconditionally — the log + alert IS the recovery path.
    // Retrying a DLQ message would either spin on a vendor outage or
    // silently repeat a code-bug failure.
    message.ack();
  }
}
