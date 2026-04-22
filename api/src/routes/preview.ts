import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { MSGraphClient } from '../lib/ms-graph';
import { logError } from '../lib/error-logger';
import type { Env } from '../lib/types';

const preview = new Hono<{ Bindings: Env }>();

// GET|POST /webhook/get-preview-url
const previewHandler = async (c: any) => {
  // Auth: Bearer header or ?token= query param
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : c.req.query('token') || '';

  const tokenResult = await verifyToken(token, c.env.SECRET_KEY);
  if (!tokenResult.valid) return c.json({ ok: false, error: 'unauthorized' }, 401);

  // Extract itemId from body or query param
  let itemId: string | undefined;
  try {
    const body = await c.req.json() as { itemId?: string };
    itemId = body.itemId;
  } catch {
    // body parse failed — fall through to query param
  }
  if (!itemId) {
    itemId = c.req.query('itemId');
  }

  if (!itemId) {
    return c.json({ ok: false, error: 'Missing itemId' });
  }

  const msGraph = new MSGraphClient(c.env, c.executionCtx);
  const t0 = Date.now();
  let stage: 'preview' | 'downloadUrl' = 'preview';

  // Diagnostic: always log entry so we see every invocation even if client cancels
  console.log('[get-preview-url] START', { itemId });

  try {
    // Call 1: get embed/preview URL
    const previewResponse = await msGraph.post(`/me/drive/items/${itemId}/preview`, {});
    const previewUrl: string = previewResponse?.getUrl ?? '';
    const tPreview = Date.now() - t0;

    // Call 2: get download URL
    stage = 'downloadUrl';
    const itemResponse = await msGraph.get(
      `/me/drive/items/${itemId}?$select=@microsoft.graph.downloadUrl`
    );
    const downloadUrl: string = itemResponse?.['@microsoft.graph.downloadUrl'] ?? '';
    const totalMs = Date.now() - t0;
    const logFn = totalMs > 2000 ? console.warn : console.log;
    logFn('[get-preview-url] DONE', { itemId, preview_ms: tPreview, total_ms: totalMs });

    return c.json({ ok: true, previewUrl, downloadUrl });
  } catch (err: any) {
    const totalMs = Date.now() - t0;
    const message = err?.message ?? 'MS Graph request failed';
    console.error('[get-preview-url] failed', { stage, itemId, total_ms: totalMs, message });
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/get-preview-url',
      error: err as Error,
      details: `stage=${stage} itemId=${itemId} total_ms=${totalMs}`,
    });
    return c.json({ ok: false, error: message, stage });
  }
};

preview.get('/get-preview-url', previewHandler);
preview.post('/get-preview-url', previewHandler);

// GET /webhook/download-file — DL-237: proxy PDF binary for client-side pdf.js rendering
// Returns raw PDF bytes (avoids CSP connect-src blocking SharePoint download URLs)
preview.get('/download-file', async (c) => {
  const token = c.req.query('token') || '';
  const tokenResult = await verifyToken(token, c.env.SECRET_KEY);
  if (!tokenResult.valid) return c.json({ ok: false, error: 'unauthorized' }, 401);

  const itemId = c.req.query('itemId');
  if (!itemId) return c.json({ ok: false, error: 'Missing itemId' }, 400);

  const msGraph = new MSGraphClient(c.env, c.executionCtx);
  try {
    const bytes = await msGraph.getBinary(`/me/drive/items/${itemId}/content`);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err: any) {
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/download-file',
      error: err as Error,
    });
    return c.json({ ok: false, error: err?.message ?? 'Download failed' }, 500);
  }
});

export default preview;
