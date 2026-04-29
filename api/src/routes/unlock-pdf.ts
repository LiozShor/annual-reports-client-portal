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

    // Archive a COPY of the encrypted original to /ארכיון/encrypted-originals/<filename>
    // (DO NOT move — moving would change the file's location while keeping its itemId,
    //  and the subsequent putBinaryReplace would write to the moved file, leaving
    //  the original year-folder location empty.)
    try {
      const fileInfo = await msGraph.get(`/drives/${DRIVE_ID}/items/${itemId}?$select=id,name,parentReference`);
      const filename: string = fileInfo?.name ?? `unlock-${itemId}.pdf`;
      const filingFolderId: string | undefined = fileInfo?.parentReference?.id;
      if (filingFolderId) {
        const filingFolderInfo = await msGraph.get(`/drives/${DRIVE_ID}/items/${filingFolderId}?$select=id,parentReference`);
        const yearFolderId: string = filingFolderInfo?.parentReference?.id || filingFolderId;

        const ensureChildFolder = async (parentId: string, name: string): Promise<string | null> => {
          try {
            const created = await msGraph.post(`/drives/${DRIVE_ID}/items/${parentId}/children`, {
              name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail',
            });
            return created?.id ?? null;
          } catch {
            try {
              const existing = await msGraph.get(`/drives/${DRIVE_ID}/items/${parentId}:/${encodeURIComponent(name)}:`);
              return existing?.id ?? null;
            } catch (e) {
              console.error('[unlock-pdf] ensureChildFolder failed:', name, (e as Error).message);
              return null;
            }
          }
        };

        const archiveRootId = await ensureChildFolder(yearFolderId, 'ארכיון');
        const archiveTargetId = archiveRootId
          ? (await ensureChildFolder(archiveRootId, 'encrypted-originals')) ?? archiveRootId
          : null;

        if (archiveTargetId) {
          await msGraph.putBinary(
            `/drives/${DRIVE_ID}/items/${archiveTargetId}:/${encodeURIComponent(filename)}:/content?@microsoft.graph.conflictBehavior=rename`,
            encryptedBytes,
          );
        } else {
          console.error('[unlock-pdf] archive folder unresolved — proceeding without archive copy');
        }
      }
    } catch (archiveErr) {
      // Archive copy is best-effort — never block the unlock on it.
      console.error('[unlock-pdf] archive copy failed:', (archiveErr as Error).message);
    }

    // Replace original file in-place with decrypted bytes (itemId + parent unchanged)
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
