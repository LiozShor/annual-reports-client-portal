/**
 * POST /webhook/process-inbound-email
 *
 * Receives forwarded MS Graph email notifications from n8n,
 * validates, deduplicates, and processes the email in the background.
 * DL-203: Migrated from n8n WF05 (56 nodes → this endpoint).
 */

import { Hono } from 'hono';
import type { Env } from '../lib/types';
import { processInboundEmail } from '../lib/inbound/processor';
import { logError } from '../lib/error-logger';
import type { InboundEmailRequest } from '../lib/inbound/types';

const inboundEmail = new Hono<{ Bindings: Env }>();

inboundEmail.post('/process-inbound-email', async (c) => {
  try {
    // Auth: validate N8N_INTERNAL_KEY
    const authHeader = c.req.header('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

    if (!token || token !== c.env.N8N_INTERNAL_KEY) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    // Parse body
    const body = await c.req.json<InboundEmailRequest>();
    const { message_id, change_type } = body;

    if (!message_id) {
      return c.json({ ok: false, error: 'message_id required' }, 400);
    }

    // Layer 0: Skip non-created events (delete/undo fires as 'updated')
    if (change_type && change_type !== 'created') {
      return c.json({ ok: true, status: 'skipped', reason: 'change_type_not_created' });
    }

    const dedupKey = `dedup:${message_id}`;

    // DL-287: Feature-flag branch for Cloudflare Queues migration.
    // Two paths exist during rollout: the queue path (async producer) and
    // the sync path (legacy DL-286 behavior). Controlled by env.USE_QUEUE
    // so we can flip back instantly if the queue consumer misbehaves.
    if (c.env.USE_QUEUE === 'true') {
      // Layer 1 (queue path): CHECK-ONLY dedup.
      // The consumer (api/src/lib/inbound/queue-consumer.ts) takes the write
      // lock when it picks up the message. The producer only short-circuits
      // on an already-locked key to avoid enqueueing obvious duplicates.
      const existing = await c.env.CACHE_KV.get(dedupKey);
      if (existing) {
        return c.json({ ok: true, status: 'skipped', reason: 'duplicate' });
      }

      try {
        await c.env.INBOUND_QUEUE.send({ message_id, change_type });
        return c.json({ ok: true, status: 'enqueued' }, 202);
      } catch (err) {
        console.error('[inbound-email] Enqueue error:', (err as Error).message);
        logError(c.executionCtx, c.env, {
          endpoint: '/process-inbound-email',
          error: err,
          category: 'INTERNAL',
          details: `enqueue failed; message_id=${message_id}`,
        });
        return c.json(
          { ok: false, error: (err as Error).message || 'enqueue failed' },
          500
        );
      }
    }

    // Sync path (DL-286 fallback) — unchanged behavior.
    // Layer 1: KV dedup — read-first + write-first-then-verify pattern
    // MS Graph fires 2 notifications. n8n forwards them ~2s apart.
    // Read-first catches the delayed duplicate. Write-then-verify catches simultaneous arrivals.
    const existing = await c.env.CACHE_KV.get(dedupKey);
    if (existing) {
      return c.json({ ok: true, status: 'skipped', reason: 'duplicate' });
    }

    const lockValue = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    await c.env.CACHE_KV.put(dedupKey, lockValue, { expirationTtl: 86400 });
    const stored = await c.env.CACHE_KV.get(dedupKey);
    if (stored !== lockValue) {
      return c.json({ ok: true, status: 'skipped', reason: 'duplicate' });
    }

    // DL-286: revert DL-283's ctx.waitUntil wrap. waitUntil has a hard 30s cap
    // after response, which conflicted with DL-277's Anthropic 429 retry wait
    // (31–64s based on Retry-After) — Worker was cancelled mid-retry on every
    // multi-attachment email when Anthropic rate-limited, dropping all
    // classifications. Synchronous processing uses Cloudflare's full CPU budget
    // (5min per wrangler.toml); n8n's 120s HTTP timeout risk returns for emails
    // with 6+ attachments but at least classifications persist when they complete.
    // Proper fix is Cloudflare Queues migration — tracked as follow-up.
    try {
      await processInboundEmail(c.env, c.executionCtx, message_id);
      return c.json({ ok: true, status: 'completed' });
    } catch (err) {
      console.error('[inbound-email] Pipeline error:', (err as Error).message);
      logError(c.executionCtx, c.env, {
        endpoint: '/process-inbound-email',
        error: err,
        category: 'INTERNAL',
        details: `message_id=${message_id}`,
      });
      return c.json({ ok: true, status: 'failed', error: (err as Error).message });
    }
  } catch (err) {
    console.error('[inbound-email] Route error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/process-inbound-email',
      error: err,
      category: 'INTERNAL',
    });
    return c.json({ ok: false, error: (err as Error).message || 'Internal error' }, 500);
  }
});

export default inboundEmail;
