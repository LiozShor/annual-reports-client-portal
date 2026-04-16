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

    // Layer 1: KV dedup — read-first + write-first-then-verify pattern
    // MS Graph fires 2 notifications. n8n forwards them ~2s apart.
    // Read-first catches the delayed duplicate. Write-then-verify catches simultaneous arrivals.
    const dedupKey = `dedup:${message_id}`;

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

    // DL-283: process in background via ctx.waitUntil so n8n's 120s HTTP timeout
    // can't abort mid-flight (which previously cancelled the Worker and left partial
    // Airtable/OneDrive state). waitUntil has a 30s cap after response — most emails
    // finish in <30s; large batches (6+ attachments) log a truncation error via logError
    // and will migrate to Cloudflare Queues in a follow-up DL.
    c.executionCtx.waitUntil(
      (async () => {
        try {
          await processInboundEmail(c.env, c.executionCtx, message_id);
        } catch (err) {
          console.error('[inbound-email] Pipeline error:', (err as Error).message);
          logError(c.executionCtx, c.env, {
            endpoint: '/process-inbound-email',
            error: err,
            category: 'INTERNAL',
            details: `message_id=${message_id}`,
          });
        }
      })()
    );

    return c.json({ ok: true, status: 'accepted' }, 202);
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
