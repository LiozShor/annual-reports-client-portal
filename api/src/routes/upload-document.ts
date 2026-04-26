/**
 * POST /upload-document — Admin uploads a file for a specific document row.
 * File goes to OneDrive, doc marked as Received in Airtable. (DL-198)
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { resolveOneDriveRoot, uploadToOneDrive } from '../lib/inbound/attachment-utils';
import { logError } from '../lib/error-logger';
import { resolveOneDriveFilename } from '../lib/classification-helpers';
import { buildTemplateMap } from '../lib/doc-builder';
import { getCachedOrFetch } from '../lib/cache';
import type { Env } from '../lib/types';

const uploadDocument = new Hono<{ Bindings: Env }>();

const TABLES = {
  REPORTS: 'tbls7m3hmHC4hhQVy',
  DOCUMENTS: 'tblcwptR63skeODPn',
  TEMPLATES: 'tblQTsbhC6ZBrhspc',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'heic', 'tif', 'tiff', 'xlsx', 'docx', 'xls', 'doc',
]);

uploadDocument.post('/upload-document', async (c) => {
  try {
    // Auth
    const authHeader = c.req.header('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const tokenResult = await verifyToken(bearerToken, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    // Parse multipart form
    const formData = await c.req.formData();
    const docId = (formData.get('doc_id') as string || '').trim();
    const reportId = (formData.get('report_id') as string || '').trim();
    const file = formData.get('file') as File | null;
    const skipOneDrive = (formData.get('skip_onedrive') as string) === 'true';

    if (!docId || !reportId) {
      return c.json({ ok: false, error: 'doc_id and report_id are required' }, 400);
    }
    if (!file || !(file instanceof File) || file.size === 0) {
      return c.json({ ok: false, error: 'file is required' }, 400);
    }
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ ok: false, error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, 400);
    }

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return c.json({ ok: false, error: `File type .${ext} not allowed` }, 400);
    }

    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

    // Fetch report for client_name + year
    const report = await airtable.getRecord(TABLES.REPORTS, reportId);
    const clientName = (report.fields.client_name as string) || 'Unknown';
    const year = (report.fields.year as string) || 'Unknown';
    const filingType = (report.fields.filing_type as string) || 'annual_report';

    // DL-355: route admin upload through resolveOneDriveFilename so the file lands
    // with the same canonical short-name format as approve/reassign/inbound paths.
    const docRecord = await airtable.getRecord(TABLES.DOCUMENTS, docId);
    const templateId = (docRecord.fields.type as string) || '';
    const issuerName = (docRecord.fields.issuer_name as string) || '';

    const templateRecords = await getCachedOrFetch(c.env.CACHE_KV, 'cache:templates', 3600,
      () => airtable.listAllRecords(TABLES.TEMPLATES));
    const templateMap = buildTemplateMap(templateRecords);

    const uploadName = resolveOneDriveFilename({
      templateId,
      issuerName,
      attachmentName: file.name,
      templateMap,
    });

    let fileUrl: string | null = null;
    let downloadUrl: string | null = null;
    let onedriveItemId: string | null = null;

    if (!skipOneDrive) {
      const graph = new MSGraphClient(c.env, c.executionCtx);
      const root = await resolveOneDriveRoot(graph);
      const fileBuffer = await file.arrayBuffer();
      const result = await uploadToOneDrive(
        graph, root, clientName, String(year),
        uploadName, fileBuffer, filingType,
      );

      fileUrl = result.webUrl;
      downloadUrl = result.downloadUrl;
      onedriveItemId = result.itemId;
    }

    // Update Airtable doc record
    const airtableFields: Record<string, unknown> = {
      uploaded_at: new Date().toISOString(),
      status: 'Received',
    };
    if (fileUrl) airtableFields.file_url = fileUrl;
    if (onedriveItemId) airtableFields.onedrive_item_id = onedriveItemId;

    await airtable.updateRecord(TABLES.DOCUMENTS, docId, airtableFields);

    return c.json({
      ok: true,
      file_url: fileUrl,
      download_url: downloadUrl,
      onedrive_item_id: onedriveItemId,
    });
  } catch (err: any) {
    console.error('[upload-document] Error:', err.message);
    logError(c.executionCtx, c.env, {
      endpoint: '/upload-document',
      error: err,
      category: 'INTERNAL',
    });
    return c.json({ ok: false, error: err.message || 'Upload failed' }, 500);
  }
});

export default uploadDocument;
