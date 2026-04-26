import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { MSGraphClient } from '../lib/ms-graph';
import { logError } from '../lib/error-logger';
import { AirtableClient } from '../lib/airtable';
import type { Env } from '../lib/types';

const DOCUMENTS_TABLE = 'tblcwptR63skeODPn';

/**
 * DL-356: detect MS Graph "permanent 404" — file removed from OneDrive,
 * not a transient network error. Only this case triggers self-heal.
 */
function isItemNotFoundError(err: any): boolean {
  const msg = String(err?.message ?? '').toLowerCase();
  if (!msg) return false;
  if (!msg.includes('404') && !msg.includes('itemnotfound')) return false;
  return msg.includes('itemnotfound') || msg.includes('could not be found') || msg.includes('not found');
}

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

  // Extract itemId + recordId from body or query param.
  // DL-356: recordId is the Airtable Documents row whose `onedrive_item_id`
  // we received — used for self-heal on 404 from MS Graph.
  let itemId: string | undefined;
  let recordId: string | undefined;
  try {
    const body = await c.req.json() as { itemId?: string; recordId?: string };
    itemId = body.itemId;
    recordId = body.recordId;
  } catch {
    // body parse failed — fall through to query params
  }
  if (!itemId) itemId = c.req.query('itemId');
  if (!recordId) recordId = c.req.query('recordId');

  if (!itemId) {
    return c.json({ ok: false, error: 'Missing itemId' });
  }

  const msGraph = new MSGraphClient(c.env, c.executionCtx);
  const t0 = Date.now();

  // Diagnostic: always log entry so we see every invocation even if client cancels
  console.log('[get-preview-url] START', { itemId });

  try {
    const [previewResponse, itemResponse] = await Promise.all([
      msGraph.post(`/me/drive/items/${itemId}/preview`, { viewer: 'onedrive', zoom: 0.75 }),
      msGraph.get(`/me/drive/items/${itemId}?$select=@microsoft.graph.downloadUrl`),
    ]);
    const rawGetUrl: string = previewResponse?.getUrl ?? '';
    // DL-341: append &nb=true to hide the Microsoft banner in the embedded viewer
    const previewUrl: string = rawGetUrl
      ? `${rawGetUrl}${rawGetUrl.includes('?') ? '&' : '?'}nb=true`
      : '';
    const downloadUrl: string = itemResponse?.['@microsoft.graph.downloadUrl'] ?? '';
    const totalMs = Date.now() - t0;
    const logFn = totalMs > 2000 ? console.warn : console.log;
    logFn('[get-preview-url] DONE', { itemId, total_ms: totalMs });

    return c.json({ ok: true, previewUrl, downloadUrl });
  } catch (err: any) {
    const totalMs = Date.now() - t0;
    const message = err?.message ?? 'MS Graph request failed';

    // DL-356: self-heal on permanent 404 — the OneDrive file is gone.
    // PATCH the originating Airtable row to null its file fields so
    // (a) the next preview attempt is impossible (button hides),
    // (b) the 404 alert noise stops, and
    // (c) admin sees the doc as Required_Missing and re-collects.
    // Match by recordId only — DL-230 lets two records share an itemId,
    // so we MUST NOT clear by itemId.
    if (isItemNotFoundError(err)) {
      // FILE_GONE is recoverable — do NOT call logError (which sends alert email).
      // Self-heal + console.warn is sufficient.
      console.warn('[get-preview-url] FILE_GONE', {
        itemId,
        recordId: recordId ?? '(none)',
        total_ms: totalMs,
        selfHeal: recordId ? 'attempted' : 'skipped',
      });
      if (recordId) {
        try {
          const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
          await airtable.updateRecord(DOCUMENTS_TABLE, recordId, {
            file_url: null,
            onedrive_item_id: null,
            expected_filename: null,
            file_hash: null,
            uploaded_at: null,
          } as any);
        } catch (patchErr: any) {
          console.error('[get-preview-url] self-heal PATCH failed', { recordId, err: patchErr?.message });
        }
      }
      return c.json({
        ok: false,
        code: 'FILE_GONE',
        message: 'הקובץ אינו זמין יותר ב-OneDrive',
      });
    }

    console.error('[get-preview-url] failed', { itemId, total_ms: totalMs, message });
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/get-preview-url',
      error: err as Error,
      details: `itemId=${itemId} total_ms=${totalMs}`,
    });
    return c.json({ ok: false, error: message });
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
