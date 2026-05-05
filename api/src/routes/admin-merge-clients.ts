/**
 * POST /webhook/admin-merge-clients — DL-404
 *
 * Merges two client records into one. Delegates to mergeClients() lib.
 *
 * Auth: Bearer JWT (admin token) OR X-N8N-Key (n8n internal key).
 * Both are constant-time compared to prevent timing attacks.
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { timingSafeEqual } from '../lib/crypto';
import { logError } from '../lib/error-logger';
import { mergeClients } from '../lib/merge-clients';
import type { Env } from '../lib/types';

const adminMergeClients = new Hono<{ Bindings: Env }>();

adminMergeClients.post('/admin-merge-clients', async (c) => {
  // ── Auth ───────────────────────────────────────────────────────────────────
  let actor: string;

  const n8nKey = c.req.header('X-N8N-Key') ?? '';
  const authHeader = c.req.header('Authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (n8nKey && timingSafeEqual(n8nKey, c.env.N8N_INTERNAL_KEY)) {
    actor = 'n8n';
  } else if (bearerToken) {
    const tokenResult = await verifyToken(bearerToken, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, code: 'unauthorized', message: 'Invalid or expired admin token' }, 401);
    }
    actor = 'admin';
  } else {
    return c.json({ ok: false, code: 'unauthorized', message: 'Missing authentication' }, 401);
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, code: 'invalid_input', message: 'Request body must be valid JSON' }, 400);
  }

  // ── Validate required fields ───────────────────────────────────────────────
  const clientAId = typeof body.client_a_id === 'string' ? body.client_a_id.trim() : '';
  const clientBId = typeof body.client_b_id === 'string' ? body.client_b_id.trim() : '';
  const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
  const mergedName = typeof body.merged_name === 'string' ? body.merged_name.trim() : undefined;

  if (!clientAId) {
    return c.json({ ok: false, code: 'invalid_input', message: 'client_a_id is required and must be a non-empty string' }, 400);
  }
  if (!clientBId) {
    return c.json({ ok: false, code: 'invalid_input', message: 'client_b_id is required and must be a non-empty string' }, 400);
  }
  if (!idempotencyKey) {
    return c.json({ ok: false, code: 'invalid_input', message: 'idempotency_key is required and must be a non-empty string' }, 400);
  }
  if (clientAId === clientBId) {
    return c.json({ ok: false, code: 'same_client', message: 'client_a_id and client_b_id must refer to different clients' }, 400);
  }

  // ── Delegate to lib ────────────────────────────────────────────────────────
  try {
    const result = await mergeClients(c.env, c.executionCtx, {
      clientIdA: clientAId,
      clientIdB: clientBId,
      mergedName: mergedName || undefined,
      actor,
      idempotencyKey,
    });

    if (result.ok) {
      return c.json(result, 200);
    }

    // Map error codes to HTTP status codes
    switch (result.code) {
      case 'cross_filing_type':
      case 'lock_contention':
        return c.json(result, 409);

      case 'partial_onedrive_move':
        return c.json({ ok: false, code: result.code, message: result.message, partial: result.partial }, 502);

      case 'invalid_input':
      case 'not_found':
        return c.json(result, 400);

      default:
        return c.json(result, 500);
    }
  } catch (err) {
    console.error('[admin-merge-clients] Unexpected error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/admin-merge-clients',
      error: err as Error,
    });
    return c.json({ ok: false, code: 'internal_error', message: 'Internal server error' }, 500);
  }
});

export default adminMergeClients;
