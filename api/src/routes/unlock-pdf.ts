/**
 * unlock-pdf.ts — DL-373
 *
 * POST /webhook/unlock-pdf
 * Decrypts a password-protected PDF, archives the encrypted original to
 * /ארכיון/encrypted-originals/, and replaces it with the unlocked bytes.
 * Password is NEVER logged or stored.
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { MSGraphClient } from '../lib/ms-graph';
import { tryDecryptPDF } from '../lib/pdf-decrypt-helper';
import { logError } from '../lib/error-logger';
import { logEvent } from '../lib/activity-logger';
import { DRIVE_ID } from '../lib/classification-helpers';
import { moveFileToArchive } from './classifications';
import type { Env } from '../lib/types';

const unlockPdf = new Hono<{ Bindings: Env }>();

const MAX_ATTEMPTS = 5;
const RATE_LIMIT_TTL_SECONDS = 60;

unlockPdf.post('/unlock-pdf', async (c) => {
  try {
    // Auth
    const authHeader = c.req.header('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const tokenResult = await verifyToken(bearerToken, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    const body = await c.req.json() as Record<string, unknown>;
    const { itemId, recordId, password } = body;
    // password is intentionally not destructured into a const we might accidentally log

    if (typeof itemId !== 'string' || !itemId) return c.json({ ok: false, error: 'Missing itemId' }, 400);
    if (typeof recordId !== 'string' || !recordId) return c.json({ ok: false, error: 'Missing recordId' }, 400);
    if (typeof password !== 'string' || !password) return c.json({ ok: false, error: 'Missing password' }, 400);

    // Rate limit — 5 attempts per itemId per minute
    const rlKey = `unlock_attempts:${itemId}`;
    const attemptsRaw = await c.env.CACHE_KV.get(rlKey);
    const attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;
    if (attempts >= MAX_ATTEMPTS) {
      return c.json({ ok: false, error: 'RATE_LIMITED', attemptsRemaining: 0, message: 'Too many attempts — try again in 60 seconds' }, 429);
    }
    // Increment counter (fire-and-forget is fine)
    c.executionCtx.waitUntil(
      c.env.CACHE_KV.put(rlKey, String(attempts + 1), { expirationTtl: RATE_LIMIT_TTL_SECONDS })
    );

    const msGraph = new MSGraphClient(c.env, c.executionCtx);

    // Fetch encrypted PDF bytes
    const encryptedBytes = await msGraph.getBinary(`/drives/${DRIVE_ID}/items/${itemId}/content`);

    // Try to decrypt
    const decryptResult = await tryDecryptPDF(encryptedBytes, password as string);

    if (!decryptResult.ok) {
      if (decryptResult.error === 'NOT_ENCRYPTED') {
        return c.json({ ok: false, error: 'ALREADY_UNLOCKED', message: 'PDF is already unlocked' }, 409);
      }
      if (decryptResult.error === 'WRONG_PASSWORD') {
        logEvent({
          event_type: 'pdf_unlock_attempt',
          category: 'ADMIN',
          details: { recordId, success: false, reason: 'wrong_password' },
        });
        return c.json({
          ok: false,
          error: 'WRONG_PASSWORD',
          attemptsRemaining: MAX_ATTEMPTS - (attempts + 1),
          message: 'Wrong password',
        }, 401);
      }
      if (decryptResult.error === 'UNSUPPORTED_ENCRYPTION') {
        return c.json({ ok: false, error: 'UNSUPPORTED_ENCRYPTION', message: decryptResult.message }, 422);
      }
      return c.json({ ok: false, error: 'DECRYPT_FAILED', message: decryptResult.message }, 500);
    }

    // Archive encrypted original first — abort if archive fails
    await moveFileToArchive(msGraph, itemId, { subfolder: 'encrypted-originals' });

    // Replace with unlocked bytes at original path
    await msGraph.putBinaryReplace(itemId, decryptResult.bytes);

    // Clear rate limit on success
    c.executionCtx.waitUntil(c.env.CACHE_KV.delete(rlKey));

    logEvent({
      event_type: 'pdf_unlocked',
      category: 'ADMIN',
      details: { recordId, success: true },
    });

    return c.json({ ok: true });
  } catch (err: any) {
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/unlock-pdf',
      error: err,
      category: 'INTERNAL',
    });
    return c.json({ ok: false, error: 'GRAPH_FAILED', message: err.message }, 500);
  }
});

export default unlockPdf;
