/**
 * Cloudflare Queues consumer for inbound email notifications (DL-287).
 *
 * Invoked by the Workers runtime for each batch delivered from INBOUND_QUEUE.
 * Mirrors the dedup + processing logic previously inline in
 * routes/inbound-email.ts so the producer route can shrink to enqueue-only.
 *
 * Retries: thrown errors trigger message.retry(); Cloudflare applies the
 * exponential backoff configured in wrangler.toml (max_retries=3,
 * retry_delay=30s). Messages past max_retries land in the DLQ.
 *
 * Idempotency: processInboundEmail already performs Airtable upserts
 * (email_events by message_id; pending_classifications via performUpsert
 * on filename+hash), so a retry after partial completion is safe.
 */

import type { Env, InboundQueueMessage } from '../types';
import { processInboundEmail } from './processor';
import { logError } from '../error-logger';

export async function handleInboundQueue(
  batch: MessageBatch<InboundQueueMessage>,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    const { message_id, change_type } = message.body;

    console.log(
      `[queue] processing message_id=${message_id} attempt=${message.attempts}`,
    );

    // Layer 0: Skip non-created events (delete/undo fires as 'updated').
    if (change_type && change_type !== 'created') {
      console.log(
        `[queue] skip message_id=${message_id} reason=change_type_not_created`,
      );
      message.ack();
      continue;
    }

    // Layer 1: KV dedup — only checked on the first delivery attempt.
    // On retries (attempts > 1) the lock we took on attempt 1 is still present;
    // short-circuiting on it would silently ack the retry and defeat the whole
    // max_retries+DLQ machinery. processInboundEmail's internal Airtable
    // upserts (email_events by source_message_id, pending_classifications via
    // performUpsert) make re-execution safe, so retries skip this check and
    // proceed straight to the pipeline.
    const dedupKey = `dedup:${message_id}`;

    try {
      if (message.attempts === 1) {
        const existing = await env.CACHE_KV.get(dedupKey);
        if (existing) {
          console.log(
            `[queue] skip message_id=${message_id} reason=duplicate`,
          );
          message.ack();
          continue;
        }

        const lockValue = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        await env.CACHE_KV.put(dedupKey, lockValue, { expirationTtl: 86400 });
        const stored = await env.CACHE_KV.get(dedupKey);
        if (stored !== lockValue) {
          console.log(
            `[queue] skip message_id=${message_id} reason=duplicate_race`,
          );
          message.ack();
          continue;
        }
      }
    } catch (err) {
      // Transient KV error — retry; batch size is 1 so cost is bounded.
      console.error(
        `[queue] dedup error message_id=${message_id}:`,
        (err as Error).message,
      );
      logError(ctx, env, {
        endpoint: '/queue/inbound-email',
        error: err,
        category: 'INTERNAL',
        details: `message_id=${message_id} phase=dedup`,
      });
      message.retry();
      continue;
    }

    // Process the email. On failure, log + retry; Cloudflare handles backoff.
    // Note: processInboundEmail also calls logError internally before re-throwing
    // (processor.ts ~line 949), matching the pre-existing sync producer route's
    // double-log pattern. Kept for parity — cleaning up the duplication touches
    // the processor contract used by the sync path too.
    try {
      await processInboundEmail(env, ctx, message_id);
      console.log(`[queue] done message_id=${message_id} status=completed`);
      message.ack();
    } catch (err) {
      // wrangler.toml max_retries=3 → total deliveries = initial + 3 retries = 4.
      // On the 4th attempt Cloudflare DLQs on next failure.
      const willDlq = message.attempts >= 4;
      console.error(
        `[queue] pipeline error message_id=${message_id} attempt=${message.attempts}/4 ${willDlq ? 'WILL_DLQ' : 'will_retry'}:`,
        (err as Error).message,
      );
      logError(ctx, env, {
        endpoint: '/queue/inbound-email',
        error: err,
        category: 'INTERNAL',
        details: `message_id=${message_id} attempt=${message.attempts}`,
      });
      message.retry();
    }
  }
}
