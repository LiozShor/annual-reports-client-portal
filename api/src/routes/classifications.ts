import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { logSecurity, getClientIp } from '../lib/security-log';
import { buildTemplateMap, buildCategoryMap } from '../lib/doc-builder';
import type { TemplateInfo } from '../lib/doc-builder';
import { buildShortName, REJECTION_REASONS, DRIVE_ID, sanitizeFilename, HE_TITLE } from '../lib/classification-helpers';
import { mergePdfs } from '../lib/pdf-merge';
import { splitPdf } from '../lib/pdf-split';
import { computeSha256 } from '../lib/inbound/attachment-utils';
import { classifyAttachment } from '../lib/inbound/document-classifier';
import type { ProcessingContext, AttachmentInfo, ClassificationResult } from '../lib/inbound/types';
import { getCachedOrFetch, invalidateCache } from '../lib/cache';
import { logError } from '../lib/error-logger';
import { checkAutoAdvanceToReview } from '../lib/auto-advance';
import { isLastReference, buildSharedRefMap } from '../lib/file-refcount';
import type { Env } from '../lib/types';

const classifications = new Hono<{ Bindings: Env }>();

// DL-224: Move a file to the ארכיון folder (same pattern as reject)
// DL-240: Files are directly in filing type folder — traverse: file → filingFolder → yearFolder (2 levels up)
async function moveFileToArchive(msGraph: MSGraphClient, itemId: string) {
  try {
    const fileInfo = await msGraph.get(`/drives/${DRIVE_ID}/items/${itemId}?$select=id,name,parentReference`);
    const filingFolderId = fileInfo?.parentReference?.id;
    if (!filingFolderId) return;

    const filingFolderInfo = await msGraph.get(`/drives/${DRIVE_ID}/items/${filingFolderId}?$select=id,name,parentReference`);
    const yearFolderId = filingFolderInfo?.parentReference?.id || filingFolderId;

    let archiveFolderId: string | null = null;
    try {
      const created = await msGraph.post(`/drives/${DRIVE_ID}/items/${yearFolderId}/children`, {
        name: 'ארכיון',
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      });
      archiveFolderId = created?.id;
    } catch {
      try {
        const existing = await msGraph.get(`/drives/${DRIVE_ID}/items/${yearFolderId}:/${encodeURIComponent('ארכיון')}:`);
        archiveFolderId = existing?.id;
      } catch (e2) {
        console.error('[moveFileToArchive] Failed to get ארכיון folder:', (e2 as Error).message);
      }
    }

    if (archiveFolderId) {
      await msGraph.patch(`/drives/${DRIVE_ID}/items/${itemId}`, { parentReference: { id: archiveFolderId } });
      console.log('[moveFileToArchive] Moved', itemId, 'to ארכיון (year level)');
    }
  } catch (err) {
    console.error('[moveFileToArchive] Failed:', (err as Error).message);
  }
}

const TABLES = {
  CLASSIFICATIONS: 'tbloiSDN3rwRcl1ii',
  REPORTS: 'tbls7m3hmHC4hhQVy',
  DOCUMENTS: 'tblcwptR63skeODPn',
  TEMPLATES: 'tblQTsbhC6ZBrhspc',
  CATEGORIES: 'tblbn6qzWNfR8uL2b',
};

const EMPTY_STATS = {
  total_pending: 0,
  pending_review: 0,
  reviewed_unsent: 0,
  matched: 0,
  unmatched: 0,
  high_confidence: 0,
};

/** Extract first element from Airtable lookup arrays, or return value as-is. */
const getField = (val: unknown): unknown =>
  Array.isArray(val) ? val[0] : (val || '');

// GET /webhook/get-pending-classifications
classifications.get('/get-pending-classifications', async (c) => {
  // DL-323: hoist perf state so catch block can log marks too
  const t0 = Date.now();
  const marks: string[] = [];
  const mark = (label: string, extra?: Record<string, unknown>) => {
    const ms = Date.now() - t0;
    marks.push(extra ? `${label}=${ms}ms ${JSON.stringify(extra)}` : `${label}=${ms}ms`);
  };
  try {
    // ---- Authentication (office mode only) ----
    const authHeader = c.req.header('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : (c.req.query('token') || '');

    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
    const clientIp = getClientIp(c.req.raw.headers);

    const tokenResult = await verifyToken(bearerToken, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      logSecurity(c.executionCtx, airtable, {
        timestamp: new Date().toISOString(),
        event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        severity: 'WARNING',
        actor: 'admin-token',
        actor_ip: clientIp,
        endpoint: '/webhook/get-pending-classifications',
        http_status: 401,
        error_message: tokenResult.reason || '',
      });
      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }

    // DL-323: per-step perf instrumentation. Logs to wrangler tail only when total > 5s
    // (or on error) so the 80% happy path doesn't spam logs. State hoisted above try {}.

    // ---- Step 1: Search classifications ----
    const records = await airtable.listAllRecords(TABLES.CLASSIFICATIONS, {
      filterByFormula: `AND({notification_status} = '', {review_status} != 'splitting')`,
      sort: [{ field: 'received_at', direction: 'desc' }],
    });
    mark('step1.classifications', { n: records.length });

    if (records.length === 0) {
      return c.json({ ok: true, items: [], stats: EMPTY_STATS });
    }

    // ---- Step 2: DL-112 file hash dedup ----
    const seenHashes = new Set<string>();
    const deduped = records.filter(r => {
      const hash = r.fields.file_hash as string | undefined;
      if (!hash) return true;
      if (seenHashes.has(hash)) return false;
      seenHashes.add(hash);
      return true;
    });

    // ---- Step 3: DL-102 inactive client filter + DL-216/DL-238 filing_type filter ----
    const filingType = c.req.query('filing_type') || 'annual_report'; // DL-238: 'all' = no filter

    // Collect unique report IDs
    const reportIdSet = new Set<string>();
    for (const rec of deduped) {
      const reportField = rec.fields.report;
      const reportId = Array.isArray(reportField) ? reportField[0] : reportField;
      if (reportId) reportIdSet.add(reportId as string);
    }

    const reportIds = Array.from(reportIdSet);
    const activeMap = new Map<string, boolean>();
    const clientNotesMap = new Map<string, string>();
    const filingTypeMap = new Map<string, string>();

    // DL-254: Parallel batch fetch reports in chunks of 50
    // DL-322: also collect linked `documents` IDs to scope the docs fetch below
    const docIdsToFetch = new Set<string>();
    const reportChunkPromises = [];
    for (let i = 0; i < reportIds.length; i += 50) {
      const chunk = reportIds.slice(i, i + 50);
      const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      reportChunkPromises.push(airtable.listAllRecords(TABLES.REPORTS, {
        filterByFormula: formula,
        fields: ['client_is_active', 'client_notes', 'filing_type', 'documents'],
      }));
    }
    const reportBatches = await Promise.all(reportChunkPromises);
    for (const reportRecords of reportBatches) {
      for (const rep of reportRecords) {
        activeMap.set(rep.id, (rep.fields.client_is_active as boolean) ?? true);
        filingTypeMap.set(rep.id, (rep.fields.filing_type as string) || 'annual_report');
        if (rep.fields.client_notes) {
          clientNotesMap.set(rep.id, rep.fields.client_notes as string);
        }
        const docs = rep.fields.documents;
        if (Array.isArray(docs)) for (const d of docs) docIdsToFetch.add(d as string);
      }
    }
    mark('step2.reports', { nChunks: reportChunkPromises.length, nReports: reportBatches.flat().length });

    // Filter deduped by filing_type (DL-238: skip when 'all')
    const filteredByType = filingType === 'all' ? deduped : deduped.filter(rec => {
      const reportField = rec.fields.report;
      const reportId = Array.isArray(reportField) ? reportField[0] : reportField;
      if (!reportId) return true; // keep orphans
      return (filingTypeMap.get(reportId as string) || 'annual_report') === filingType;
    });

    // DL-239: Build clientToReports map for cross-filing-type reassign
    // Collect unique client IDs from classifications, then fetch ALL their active reports
    const clientIdSet = new Set<string>();
    for (const rec of deduped) {
      const f = rec.fields as Record<string, unknown>;
      const cid = (Array.isArray(f.client_id) ? f.client_id[0] : f.client_id) as string;
      if (cid) clientIdSet.add(cid);
    }
    const clientToReports = new Map<string, { reportId: string; filingType: string }[]>();
    const clientIds = Array.from(clientIdSet);
    // DL-254: Parallel batch fetch client reports
    const clientChunkPromises = [];
    for (let i = 0; i < clientIds.length; i += 50) {
      const chunk = clientIds.slice(i, i + 50);
      const formula = `AND(OR(${chunk.map(id => `{client_id} = '${id}'`).join(',')}), OR({stage} = 'Collecting_Docs', {stage} = 'Review', {stage} = 'Pending_Approval'))`;
      clientChunkPromises.push(airtable.listAllRecords(TABLES.REPORTS, {
        filterByFormula: formula,
        // DL-322: include documents so cross-filing-type reports also contribute doc IDs
        fields: ['client_id', 'filing_type', 'documents'],
      }));
    }
    const clientBatches = await Promise.all(clientChunkPromises);
    for (const clientReports of clientBatches) {
      for (const rep of clientReports) {
        const rawCid = rep.fields.client_id;
        const cid = (Array.isArray(rawCid) ? rawCid[0] : rawCid) as string || '';
        const ft = (rep.fields.filing_type as string) || 'annual_report';
        if (!cid) continue;
        if (!clientToReports.has(cid)) clientToReports.set(cid, []);
        const arr = clientToReports.get(cid)!;
        if (!arr.some(r => r.reportId === rep.id)) arr.push({ reportId: rep.id, filingType: ft });
        if (!filingTypeMap.has(rep.id)) filingTypeMap.set(rep.id, ft);
        const docs = rep.fields.documents;
        if (Array.isArray(docs)) for (const d of docs) docIdsToFetch.add(d as string);
      }
    }
    mark('step3.clientReports', { nChunks: clientChunkPromises.length, nReports: clientBatches.flat().length, nDocIds: docIdsToFetch.size });

    // ---- Step 4: Fetch documents + templates + categories (parallel) ----
    // DL-322: scope DOCUMENTS fetch by RECORD_ID() of the linked `documents` field on REPORTS
    // (collected above). RECORD_ID() lookup is indexed in Airtable — same fast pattern used
    // for the REPORTS chunk fetch. Avoids the DL-321 FIND/ARRAYJOIN timeout regression.
    const docIdList = Array.from(docIdsToFetch);
    const docFetchPromise: Promise<any[]> = docIdList.length === 0
      ? Promise.resolve([])
      : Promise.all(
          (() => {
            const chunks: Promise<any[]>[] = [];
            for (let i = 0; i < docIdList.length; i += 50) {
              const chunk = docIdList.slice(i, i + 50);
              const formula = `AND({status} != 'Waived', OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')}))`;
              chunks.push(
                airtable.listAllRecords(TABLES.DOCUMENTS, {
                  filterByFormula: formula,
                  fields: ['report', 'type', 'issuer_name', 'status', 'category', 'onedrive_item_id'],
                })
              );
            }
            return chunks;
          })()
        ).then(batches => batches.flat());

    const [docRecords, templateRecords, categoryRecords] = await Promise.all([
      docFetchPromise,
      getCachedOrFetch(c.env.CACHE_KV, 'cache:templates', 3600,
        () => airtable.listAllRecords(TABLES.TEMPLATES)),
      getCachedOrFetch(c.env.CACHE_KV, 'cache:categories', 3600,
        () => airtable.listAllRecords(TABLES.CATEGORIES)),
    ]);
    mark('step4.docs+templates+categories', { nDocs: docRecords.length, nTemplates: templateRecords.length, nCategories: categoryRecords.length });

    // ---- Step 5: Build lookups ----
    const templateMap = buildTemplateMap(templateRecords);
    const categoryMap = buildCategoryMap(categoryRecords);

    // DL-320: Build shared-reference map for multi-match (DL-314) sibling visibility.
    // Keyed by onedrive_item_id → { count, titles[], ids[] } across all Received docs.
    const sharedRefMap = buildSharedRefMap(
      docRecords.map(d => ({
        id: d.id,
        onedrive_item_id: (d.fields as any).onedrive_item_id,
        issuer_name: (d.fields as any).issuer_name,
        status: (d.fields as any).status,
      }))
    );

    // DL-321: Memoize buildShortName calls across Steps 5 and 6 (called per doc and per item).
    const shortNameMemo = new Map<string, string | null>();
    const memoShortName = (templateId: string, docName: string): string | null => {
      const key = `${templateId}::${docName}`;
      if (shortNameMemo.has(key)) return shortNameMemo.get(key)!;
      const resolved = templateId ? buildShortName(templateId, docName, templateMap) : null;
      shortNameMemo.set(key, resolved);
      return resolved;
    };

    // Group docs by report ID
    const docsByReport = new Map<string, { missing: any[]; all: any[] }>();

    for (const doc of docRecords) {
      const f = doc.fields as Record<string, unknown>;
      const reportId = Array.isArray(f.report) ? f.report[0] : f.report;
      if (!reportId) continue;

      const rid = reportId as string;
      if (!docsByReport.has(rid)) {
        docsByReport.set(rid, { missing: [], all: [] });
      }

      const bucket = docsByReport.get(rid)!;
      const tmpl = f.type ? templateMap.get(f.type as string) : undefined;
      const catId = (f.category as string) || 'general';
      const catInfo = categoryMap.get(catId);
      const docName = (f.issuer_name as string) || tmpl?.name_he || (f.type as string) || '';
      const resolvedShort = f.type ? memoShortName(f.type as string, docName) : null;
      const shortName = resolvedShort || tmpl?.name_he || '';
      const docEntry = {
        doc_record_id: doc.id,
        template_id: f.type,
        name: docName,
        name_short: shortName,
        name_html: docName,
        status: f.status,
        onedrive_item_id: f.onedrive_item_id,
        category: catId,
        category_name: catInfo?.name_he || catId,
        category_emoji: catInfo?.emoji || '',
        sort_order: catInfo?.sort_order ?? 99,
      };

      bucket.all.push(docEntry);
      if (f.status === 'Required_Missing') {
        bucket.missing.push(docEntry);
      }
    }

    // ---- Step 6: Build items array ----
    const items = filteredByType.map(rec => {
      const f = rec.fields as Record<string, unknown>;
      const reportId = getField(f.report) as string;
      const reportDocs = docsByReport.get(reportId);
      const tmpl = f.matched_template_id
        ? templateMap.get(f.matched_template_id as string)
        : undefined;

      // Try to resolve short name from the linked document record first
      const linkedDocId = getField(f.document) as string | undefined;
      const issuerName = f.issuer_name as string | undefined;
      let matchedShortName: string | null = null;

      // Strategy 1: use linked document's pre-computed name_short
      if (linkedDocId && reportDocs) {
        const linkedDoc = reportDocs.all.find(d => d.doc_record_id === linkedDocId);
        if (linkedDoc?.name_short) matchedShortName = linkedDoc.name_short;
      }

      // Strategy 2: for unrequested docs, find a matching doc by template + issuer overlap
      if (!matchedShortName && issuerName && f.matched_template_id && reportDocs) {
        const candidateDoc = reportDocs.all.find(d => {
          if (d.template_id !== f.matched_template_id) return false;
          // Extract bold segments from the doc's full name
          const boldRx = /<b>(.*?)<\/b>/gi;
          let bm: RegExpExecArray | null;
          while ((bm = boldRx.exec(d.name as string || '')) !== null) {
            const seg = bm[1];
            // Check bidirectional overlap (AI may add/drop ה prefix, or use longer name)
            if (issuerName.includes(seg) || seg.includes(issuerName)) return true;
          }
          return false;
        });
        if (candidateDoc?.name_short) matchedShortName = candidateDoc.name_short;
      }

      // Strategy 3: fall back to buildShortName with matched_doc_name or issuer_name
      if (!matchedShortName) {
        matchedShortName = memoShortName(
          f.matched_template_id as string,
          (f.matched_doc_name as string) || (issuerName ? `<b>${issuerName}</b>` : ''),
        );
      }

      return {
        id: rec.id,
        client_name: getField(f.client_name),
        client_id: getField(f.client_id),
        client_is_active: activeMap.get(reportId) ?? true,
        year: f.year,
        report_record_id: reportId,
        attachment_name: f.attachment_name,
        attachment_content_type: f.attachment_content_type,
        attachment_size: f.attachment_size,
        matched_template_id: f.matched_template_id,
        matched_template_name: tmpl?.name_he || (f.matched_template_id as string) || '',
        matched_short_name: matchedShortName,
        ai_confidence: f.ai_confidence,
        ai_reason: f.ai_reason,
        issuer_name: f.issuer_name,
        issuer_match_quality: f.issuer_match_quality,
        matched_doc_name: f.matched_doc_name,
        file_url: f.file_url,
        onedrive_item_id: f.onedrive_item_id,
        // DL-320: sibling visibility for "הקובץ תואם למסמך נוסף" + cascade revert confirmation
        ...(() => {
          const itemId = typeof f.onedrive_item_id === 'string' ? f.onedrive_item_id : '';
          const entry = itemId ? sharedRefMap.get(itemId) : undefined;
          return entry
            ? { shared_ref_count: entry.count, shared_with_titles: entry.titles, shared_record_ids: entry.ids }
            : { shared_ref_count: 0, shared_with_titles: [], shared_record_ids: [] };
        })(),
        sender_email: f.sender_email,
        sender_name: f.sender_name,
        received_at: f.received_at,
        is_matched: !!f.matched_template_id,
        matched_doc_record_id: getField(f.document),
        is_unrequested: !!f.matched_template_id && !f.document &&
          !(reportDocs?.all || []).some((d: any) => d.template_id === f.matched_template_id),
        missing_docs: reportDocs?.missing || [],
        all_docs: reportDocs?.all || [],
        docs_received_count: (reportDocs?.all || []).filter((d: any) => d.status === 'Received').length,
        docs_total_count: (reportDocs?.all || []).length,
        email_body_text: (f.email_body_text as string) || '',
        review_status: (f.review_status as string) || 'pending',
        notes: (f.notes as string) || '',
        reviewed_at: (f.reviewed_at as string) || '',
        page_count: (f.page_count as number) || null,
        contract_period: (() => {
          try { return f.contract_period ? JSON.parse(f.contract_period as string) : null; } catch { return null; }
        })(),
        // DL-315: classifier ran against full filing-type catalog (client had no required_docs yet)
        pre_questionnaire: !!f.pre_questionnaire,
        client_notes: clientNotesMap.get(reportId) || '',
        filing_type: filingTypeMap.get(reportId) || 'annual_report', // DL-238
        // DL-239: Cross-filing-type reassign — include sibling report's docs
        ...(() => {
          const clientId = getField(f.client_id) as string;
          const reports = clientId ? clientToReports.get(clientId) : undefined;
          const sibling = reports?.find(r => r.reportId !== reportId);
          if (!sibling) return {};
          const siblingDocs = docsByReport.get(sibling.reportId);
          return {
            other_report_id: sibling.reportId,
            other_filing_type: sibling.filingType,
            other_report_docs: siblingDocs?.all || [],
          };
        })(),
        // DL-328: office-saved question for this classification (cleared after batch send)
        pending_question: (f.pending_question as string) || '',
      };
    });

    // ---- Step 7: Stats ----
    const stats = {
      total_pending: items.length,
      pending_review: items.filter(i => i.review_status === 'pending').length,
      reviewed_unsent: items.filter(i => i.review_status !== 'pending').length,
      matched: items.filter(i => i.is_matched).length,
      unmatched: items.filter(i => !i.is_matched).length,
      high_confidence: items.filter(i => (i.ai_confidence as number) >= 0.85).length,
    };

    // ---- Step 8: MS Graph batch URL resolution (non-fatal) ----
    const itemIdSet = new Set<string>();
    for (const item of items) {
      const itemId = item.onedrive_item_id as string | undefined;
      if (itemId && itemIdSet.size < 20) itemIdSet.add(itemId);
    }

    if (itemIdSet.size > 0) {
      try {
        const msGraph = new MSGraphClient(c.env, c.executionCtx);
        // DL-323: 2s hard timeout — MS Graph $batch can stall 10-40s when items 404
        // (e.g., stale DL-320 fake IDs in DOCUMENTS). On timeout, cards render without
        // file_url, same as the existing error fallback. Better than blocking the response.
        const MS_GRAPH_TIMEOUT_MS = 2000;
        const urlMap = await Promise.race([
          msGraph.batchResolveUrls(Array.from(itemIdSet)),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`MS Graph timeout after ${MS_GRAPH_TIMEOUT_MS}ms`)), MS_GRAPH_TIMEOUT_MS)
          ),
        ]);
        for (const item of items) {
          const itemId = item.onedrive_item_id as string | undefined;
          if (itemId && urlMap.has(itemId)) {
            const resolved = urlMap.get(itemId)!;
            if (resolved.webUrl) item.file_url = resolved.webUrl;
          }
        }
      } catch (err) {
        console.error('[classifications] MS Graph batch resolve failed:', (err as Error).message);
        // Non-fatal — items just won't have resolved URLs
      }
    }
    mark('step8.msGraph', { nItems: itemIdSet.size });

    // ---- Step 9: Return ----
    mark('step9.return', { nItems: items.length, filing_type: filingType });
    const totalMs = Date.now() - t0;
    if (totalMs > 5000) {
      console.warn('[classifications] SLOW', { total_ms: totalMs, filing_type: filingType, marks });
    }
    return c.json({ ok: true, items, stats });
  } catch (err) {
    const totalMs = Date.now() - t0;
    console.error('[classifications] Unhandled error:', (err as Error).message, { total_ms: totalMs, marks });
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/get-client-classifications',
      error: err as Error,
      details: `total_ms=${totalMs} marks=${marks.join(' | ')}`,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// POST /webhook/review-classification
classifications.post('/review-classification', async (c) => {
  try {
    const env = c.env;
    const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);

    // ---- Step 1: Validate request ----
    const body = await c.req.json() as Record<string, unknown>;
    const { token, classification_id, action, reassign_template_id, reassign_doc_record_id, notes, new_doc_name, force_overwrite, approve_mode, target_report_id, additional_targets, create_if_missing, template_id } = body as {
      token: string;
      classification_id: string;
      action: string;
      reassign_template_id?: string;
      reassign_doc_record_id?: string;
      notes?: string;
      new_doc_name?: string;
      force_overwrite?: boolean;
      approve_mode?: 'override' | 'merge' | 'keep_both';
      target_report_id?: string; // DL-239: cross-filing-type reassign
      // DL-314: multi-template match — one file → N doc records
      additional_targets?: Array<{
        template_id: string;
        doc_record_id?: string;
        target_report_id?: string;
        new_doc_name?: string;
      }>;
      // DL-319: atomically create required-doc row when none exists, then approve
      create_if_missing?: boolean;
      template_id?: string;
    };

    if (!token) {
      return c.json({ ok: false, error: 'Missing token' }, 400);
    }

    const tokenResult = await verifyToken(token, env.SECRET_KEY);
    if (!tokenResult.valid) {
      const clientIp = getClientIp(c.req.raw.headers);
      logSecurity(c.executionCtx, airtable, {
        timestamp: new Date().toISOString(),
        event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        severity: 'WARNING',
        actor: 'admin-token',
        actor_ip: clientIp,
        endpoint: '/webhook/review-classification',
        http_status: 401,
        error_message: tokenResult.reason || '',
      });
      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }

    if (!classification_id || !action) {
      return c.json({ ok: false, error: 'Missing classification_id or action' }, 400);
    }

    if (!['approve', 'reject', 'reassign', 'split', 'classify-segment', 'finalize-split', 'request-remaining-contract', 'update-contract-period', 're-classify', 'also_match', 'revert_cascade'].includes(action)) {
      return c.json({ ok: false, error: `Invalid action: ${action}` }, 400);
    }

    if (action === 'reassign' && !reassign_template_id) {
      return c.json({ ok: false, error: 'reassign_template_id required for reassign action' }, 400);
    }

    // ---- Step 2: Fetch classification + source document ----
    const cls = await airtable.getRecord(TABLES.CLASSIFICATIONS, classification_id);
    const clsFields = cls.fields as Record<string, unknown>;
    const docId = getField(clsFields.document) as string;
    let sourceDoc = docId ? await airtable.getRecord(TABLES.DOCUMENTS, docId) : null;

    // ---- Step 3: DL-070/DL-224 conflict guard (reassign only) ----
    if (action === 'reassign' && reassign_doc_record_id && !force_overwrite) {
      const targetCheck = await airtable.getRecord(TABLES.DOCUMENTS, reassign_doc_record_id);
      if ((targetCheck.fields as any).status === 'Received' && (targetCheck.fields as any).onedrive_item_id) {
        return c.json({
          ok: false,
          conflict: true,
          conflict_doc_title: (targetCheck.fields as any).issuer_name || '',
          conflict_existing_name: (targetCheck.fields as any).source_attachment_name || '',
          conflict_new_name: clsFields.attachment_name || '',
          error: 'Target document already has an approved file',
        }, 409);
      }
    }

    // ---- Step 4: Process action ----
    let targetDoc: any = null;
    let docTitle = '';
    let approveDocId = ''; // May be set by approve action's template lookup

    // Helper: sanitize email for Airtable email-type fields (empty/invalid → omit)
    const sanitizeEmail = (v: unknown): string | undefined => {
      if (!v || typeof v !== 'string') return undefined;
      const trimmed = v.trim();
      return trimmed.includes('@') ? trimmed : undefined;
    };

    // Helper: strip null/undefined/empty-string values — Airtable rejects null AND empty strings
    // for typed fields (email, url, dateTime, singleSelect, etc.)
    const stripEmpty = (obj: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null && v !== ''));

    // ---- DL-270: Update contract period dates — early return ----
    if (action === 'update-contract-period') {
      const { start_date, end_date } = body as { start_date?: string; end_date?: string };
      if (!start_date || !end_date) {
        return c.json({ ok: false, error: 'start_date and end_date are required' }, 400);
      }
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
        return c.json({ ok: false, error: 'Dates must be in YYYY-MM-DD format' }, 400);
      }
      const startD = new Date(start_date);
      const endD = new Date(end_date);
      if (startD >= endD) {
        return c.json({ ok: false, error: 'start_date must be before end_date' }, 400);
      }
      const coversFullYear = startD.getMonth() === 0 && startD.getDate() === 1 &&
        endD.getMonth() === 11 && endD.getDate() === 31 &&
        startD.getFullYear() === endD.getFullYear();

      const contractPeriod = { startDate: start_date, endDate: end_date, coversFullYear };
      await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, {
        contract_period: JSON.stringify(contractPeriod),
      });

      return c.json({ ok: true, action: 'update-contract-period', contract_period: contractPeriod });
    }

    // ---- DL-268/271: Request missing contract period — early return ----
    if (action === 'request-remaining-contract') {
      const templateId = clsFields.matched_template_id as string;
      if (!templateId || !['T901', 'T902'].includes(templateId)) {
        return c.json({ ok: false, error: 'Only T901/T902 classifications support this action' }, 400);
      }
      const reportId = getField(clsFields.report) as string;
      if (!reportId) {
        return c.json({ ok: false, error: 'No report linked to this classification' }, 400);
      }

      // Accept explicit months from frontend, or compute from contract_period
      let missingStartMonth = body.missing_start_month as number | undefined;
      let missingEndMonth = body.missing_end_month as number | undefined;

      if (!missingStartMonth || !missingEndMonth) {
        // Fallback: compute from contract_period (legacy path)
        const contractPeriodRaw = clsFields.contract_period as string;
        if (!contractPeriodRaw) {
          return c.json({ ok: false, error: 'No contract_period data and no explicit months provided' }, 400);
        }
        try {
          const cp = JSON.parse(contractPeriodRaw);
          if (cp.coversFullYear) {
            return c.json({ ok: false, error: 'Contract already covers the full year' }, 400);
          }
          const endM = new Date(cp.endDate).getMonth() + 1;
          if (endM >= 12) {
            return c.json({ ok: false, error: 'Contract ends in December — no remaining period' }, 400);
          }
          missingStartMonth = endM + 1;
          missingEndMonth = 12;
        } catch {
          return c.json({ ok: false, error: 'Invalid contract_period JSON' }, 400);
        }
      }

      if (missingStartMonth < 1 || missingEndMonth > 12 || missingStartMonth > missingEndMonth) {
        return c.json({ ok: false, error: 'Invalid month range' }, 400);
      }

      const year = clsFields.year as string || String(new Date().getFullYear());
      const startPad = String(missingStartMonth).padStart(2, '0');
      const endPad = String(missingEndMonth).padStart(2, '0');
      const periodLabel = `${startPad}.${year}-${endPad}.${year}`;
      const templateTitle = templateId === 'T901'
        ? `חוזה שכירות – דירה מושכרת (הכנסה) <b>${periodLabel}</b>`
        : `חוזה שכירות – דירה שכורה למגורים (הוצאה) <b>${periodLabel}</b>`;
      const docKey = `${reportId}_${templateId}_client_${missingStartMonth}-${missingEndMonth}`;

      // Check if this doc already exists (dedup)
      const existingFormula = `AND({document_key} = '${docKey}')`;
      const existing = await airtable.listAllRecords(TABLES.DOCUMENTS, { filterByFormula: existingFormula });
      if (existing.length > 0) {
        return c.json({ ok: false, error: 'מסמך לתקופה זו כבר נוסף' }, 409);
      }

      const newDocFields: Record<string, unknown> = {
        report: [reportId],
        type: templateId,
        category: 'rental',
        person: 'client',
        issuer_name: templateTitle,
        document_key: docKey,
        status: 'Required_Missing',
      };
      const created = await airtable.createRecords(TABLES.DOCUMENTS, [{ fields: stripEmpty(newDocFields) }]);
      const newDocId = created[0]?.id || '';

      invalidateCache(c.env.CACHE_KV, 'cache:documents_non_waived_v2');

      return c.json({
        ok: true,
        action: 'request-remaining-contract',
        doc_id: newDocId,
        doc_title: templateTitle.replace(/<\/?b>/g, ''),
        period_label: periodLabel,
      });
    }

    // ---- DL-271: Helper to compute rental contract period label ----
    const getRentalPeriodLabel = (): { html: string; filename: string } | null => {
      const templateId = clsFields.matched_template_id as string;
      if (!['T901', 'T902'].includes(templateId)) return null;
      const cpRaw = clsFields.contract_period as string;
      if (!cpRaw) return null;
      try {
        const cp = JSON.parse(cpRaw);
        if (cp.coversFullYear) return null;
        const startM = String(new Date(cp.startDate).getMonth() + 1).padStart(2, '0');
        const endM = String(new Date(cp.endDate).getMonth() + 1).padStart(2, '0');
        const year = (clsFields.year as string) || String(new Date(cp.endDate).getFullYear());
        return {
          html: `<b>${startM}.${year}-${endM}.${year}</b>`,
          filename: `${startM}.${year}-${endM}.${year}`,
        };
      } catch { return null; }
    };

    // ---- Split action: early return ----
    // DL-250: Split is now frontend-orchestrated in 3 phases:
    //   1. split — PDF split + upload segments to OneDrive (synchronous, returns segment metadata)
    //   2. classify-segment — classify + create Airtable record for one segment (called per-segment by frontend)
    //   3. finalize-split — delete original after all segments are done

    if (action === 'split') {
      const groups = body.groups as number[][];
      if (!groups || !Array.isArray(groups) || groups.length < 2) {
        return c.json({ ok: false, error: 'groups must be an array with at least 2 page groups' }, 400);
      }

      for (let g = 0; g < groups.length; g++) {
        if (!Array.isArray(groups[g]) || groups[g].length === 0) {
          return c.json({ ok: false, error: `groups[${g}] must be a non-empty array of page numbers` }, 400);
        }
        if (groups[g].some(n => typeof n !== 'number' || n < 1)) {
          return c.json({ ok: false, error: `groups[${g}] contains invalid page numbers` }, 400);
        }
      }

      const itemId = clsFields.onedrive_item_id as string;
      if (!itemId) {
        return c.json({ ok: false, error: 'No OneDrive file to split' }, 400);
      }

      // Mark as 'splitting' so it disappears from the pending list
      await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, { review_status: 'splitting' });

      try {
        const msGraph = new MSGraphClient(env, c.executionCtx);
        const pdfBytes = await msGraph.getBinary(`/drives/${DRIVE_ID}/items/${itemId}/content`);
        const splitResults = await splitPdf(pdfBytes, groups);

        const fileInfo = await msGraph.get(`/drives/${DRIVE_ID}/items/${itemId}?$select=id,name,parentReference`);
        const parentId = fileInfo?.parentReference?.id;
        if (!parentId) throw new Error('Cannot determine parent folder');

        const origName = (clsFields.attachment_name as string) || 'document.pdf';
        const baseName = origName.replace(/\.pdf$/i, '');

        // Upload all segments to OneDrive, return metadata
        const segments: Array<Record<string, unknown>> = [];
        for (let i = 0; i < splitResults.length; i++) {
          const segmentBytes = splitResults[i];
          const partNum = i + 1;
          const segmentFilename = `${baseName}_part${partNum}.pdf`;

          const segmentBuffer = segmentBytes.buffer.slice(
            segmentBytes.byteOffset,
            segmentBytes.byteOffset + segmentBytes.byteLength,
          ) as ArrayBuffer;
          const uploadResult = await msGraph.putBinary(
            `/drives/${DRIVE_ID}/items/${parentId}:/${encodeURIComponent(segmentFilename)}:/content?@microsoft.graph.conflictBehavior=rename`,
            segmentBuffer,
          );

          const pageRange = groups[i].length === 1
            ? String(groups[i][0])
            : `${groups[i][0]}-${groups[i][groups[i].length - 1]}`;

          segments.push({
            index: i,
            filename: segmentFilename,
            onedrive_item_id: uploadResult?.id || '',
            web_url: uploadResult?.webUrl || '',
            file_hash: await computeSha256(segmentBuffer),
            page_range: pageRange,
            page_count: groups[i].length,
            size: segmentBuffer.byteLength,
          });
        }

        return c.json({ ok: true, action: 'split', classification_id, segments });
      } catch (err) {
        // Revert to pending on failure
        await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, {
          review_status: 'pending',
          notes: `פיצול נכשל: ${(err as Error).message}`,
        });
        return c.json({ ok: false, error: (err as Error).message }, 500);
      }
    }

    if (action === 'classify-segment') {
      // Frontend calls this once per segment after split
      const segment = body.segment as Record<string, unknown>;
      if (!segment?.onedrive_item_id || !segment?.filename) {
        return c.json({ ok: false, error: 'Missing segment data' }, 400);
      }

      const msGraph = new MSGraphClient(env, c.executionCtx);
      const reportId = getField(clsFields.report) as string;

      // Classify the segment
      let classification: ClassificationResult | null = null;
      try {
        const reportDocs = reportId
          ? await airtable.listAllRecords(TABLES.DOCUMENTS, {
              filterByFormula: `FIND('${reportId}', ARRAYJOIN({report_record_id}))`,
            })
          : [];

        const segmentBytes = await msGraph.getBinary(
          `/drives/${DRIVE_ID}/items/${segment.onedrive_item_id}/content`,
        );

        const origName = (clsFields.attachment_name as string) || 'document.pdf';
        const attachment: AttachmentInfo = {
          id: `split-${classification_id}-${segment.filename}`,
          name: segment.filename as string,
          contentType: 'application/pdf',
          size: segment.size as number || segmentBytes.byteLength,
          content: segmentBytes,
          sha256: (segment.file_hash as string) || '',
        };

        const pCtx: ProcessingContext = {
          env,
          ctx: c.executionCtx,
          messageId: `split-${classification_id}`,
          airtable,
          graph: msGraph,
        };

        classification = await classifyAttachment(
          pCtx,
          attachment,
          reportDocs as any,
          (clsFields.client_name as string) || (getField(clsFields.client_name) as string) || '',
          {
            subject: `Split from ${origName}`,
            bodyPreview: (clsFields.email_body_text as string) || '',
            senderName: (clsFields.sender_name as string) || '',
            senderEmail: (clsFields.sender_email as string) || '',
          },
        );
      } catch (err) {
        console.error(`[split] Classification failed for ${segment.filename}:`, (err as Error).message);
      }

      // Rename file on OneDrive based on classification (matches WF05 inbound behavior)
      const origName = (clsFields.attachment_name as string) || 'document.pdf';
      let finalFilename = segment.filename as string;
      let finalWebUrl = segment.web_url as string;
      if (classification?.templateId) {
        const sanitizeOD = (s: string) => s.replace(/[\\/*<>?:|#"~&{}%]/g, '').replace(/\.+$/, '').trim();
        const heTitle = HE_TITLE[classification.templateId] || 'מסמך';
        let base = sanitizeOD(heTitle);
        if (classification.issuerName) base += ' - ' + sanitizeOD(classification.issuerName);
        const expectedName = `${base}.pdf`;
        try {
          const renamed = await msGraph.patch(
            `/drives/${DRIVE_ID}/items/${segment.onedrive_item_id}`,
            { name: expectedName },
          );
          if (renamed?.name) finalFilename = renamed.name;
          if (renamed?.webUrl) finalWebUrl = renamed.webUrl;
        } catch (renameErr) {
          console.error(`[split] Rename failed for ${segment.filename}:`, (renameErr as Error).message);
        }
      }

      // Create Airtable record (with or without classification)
      const newFields: Record<string, unknown> = {
        classification_key: `${(clsFields.client_id as string) || 'unknown'}-${clsFields.year}-${finalFilename}`,
        report: reportId ? [reportId] : [],
        document: classification?.matchedDocRecordId ? [classification.matchedDocRecordId] : [],
        email_event: clsFields.email_event ? [getField(clsFields.email_event)] : [],
        attachment_name: finalFilename,
        attachment_content_type: 'application/pdf',
        attachment_size: segment.size,
        sender_email: sanitizeEmail(clsFields.sender_email),
        sender_name: clsFields.sender_name,
        received_at: clsFields.received_at,
        matched_template_id: classification?.templateId ?? null,
        ai_confidence: classification?.confidence ?? 0,
        ai_reason: classification?.reason ?? '',
        issuer_name: classification?.issuerName ?? '',
        file_url: finalWebUrl,
        onedrive_item_id: segment.onedrive_item_id,
        file_hash: segment.file_hash,
        review_status: 'pending',
        client_name: clsFields.client_name,
        client_id: clsFields.client_id,
        year: clsFields.year,
        issuer_match_quality: classification?.matchQuality ?? null,
        matched_doc_name: classification?.matchedDocName ?? null,
        expected_filename: finalFilename !== segment.filename ? finalFilename : null,
        page_range: segment.page_range,
        page_count: segment.page_count,
        notes: `פוצל מ-${origName} (עמודים ${segment.page_range})`,
      };

      const created = await airtable.createRecords(TABLES.CLASSIFICATIONS, [{ fields: stripEmpty(newFields) }]);

      return c.json({
        ok: true,
        action: 'classify-segment',
        record_id: created?.[0]?.id || null,
        matched_doc_name: classification?.matchedDocName ?? null,
        ai_confidence: classification?.confidence ?? 0,
        issuer_name: classification?.issuerName ?? '',
        classified: !!classification,
        renamed_to: finalFilename !== segment.filename ? finalFilename : null,
      });
    }

    // DL-277: Re-classify a record that failed (e.g., 429 rate limit)
    if (action === 're-classify') {
      const itemId = clsFields.onedrive_item_id as string;
      if (!itemId) {
        return c.json({ ok: false, error: 'No onedrive_item_id on record' }, 400);
      }

      const msGraph = new MSGraphClient(env, c.executionCtx);
      const reportId = getField(clsFields.report) as string;

      let classification: ClassificationResult | null = null;
      try {
        const reportDocs = reportId
          ? await airtable.listAllRecords(TABLES.DOCUMENTS, {
              filterByFormula: `FIND('${reportId}', ARRAYJOIN({report_record_id}))`,
            })
          : [];

        const fileBytes = await msGraph.getBinary(
          `/drives/${DRIVE_ID}/items/${itemId}/content`,
        );

        const filename = (clsFields.attachment_name as string) || 'document.pdf';
        const attachment: AttachmentInfo = {
          id: `reclassify-${classification_id}`,
          name: filename,
          contentType: clsFields.attachment_content_type as string || 'application/pdf',
          size: (clsFields.attachment_size as number) || fileBytes.byteLength,
          content: fileBytes,
          sha256: (clsFields.file_hash as string) || '',
        };

        const pCtx: ProcessingContext = {
          env,
          ctx: c.executionCtx,
          messageId: `reclassify-${classification_id}`,
          airtable,
          graph: msGraph,
        };

        classification = await classifyAttachment(
          pCtx,
          attachment,
          reportDocs as any,
          (clsFields.client_name as string) || '',
          {
            subject: `Re-classify ${filename}`,
            bodyPreview: (clsFields.email_body_text as string) || '',
            senderName: (clsFields.sender_name as string) || '',
            senderEmail: (clsFields.sender_email as string) || '',
          },
        );
      } catch (err) {
        console.error(`[re-classify] Failed for ${classification_id}:`, (err as Error).message);
        return c.json({ ok: false, error: (err as Error).message }, 500);
      }

      // Update record with new classification
      const updateFields: Record<string, unknown> = {
        ai_confidence: classification?.confidence ?? 0,
        ai_reason: classification?.reason || 'Re-classification returned no result',
        matched_template_id: classification?.templateId || null,
        issuer_name: classification?.issuerName || null,
        issuer_match_quality: classification?.matchQuality || null,
        matched_doc_name: classification?.matchedDocName || null,
        page_count: classification?.pageCount || (clsFields.page_count as number) || null,
      };
      // Link to matched doc, or clear stale link if no match
      updateFields.document = classification?.matchedDocRecordId
        ? [classification.matchedDocRecordId]
        : [];
      await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, updateFields);

      return c.json({
        ok: true,
        classification_id,
        template_id: classification?.templateId || null,
        confidence: classification?.confidence ?? 0,
        issuer_name: classification?.issuerName || null,
      });
    }

    if (action === 'finalize-split') {
      // Frontend calls this after all segments are classified
      if (clsFields.review_status !== 'splitting') {
        return c.json({ ok: false, error: 'Record is not in splitting state' }, 400);
      }
      await airtable.deleteRecords(TABLES.CLASSIFICATIONS, [classification_id]);
      return c.json({ ok: true, action: 'finalize-split' });
    }

    // ---- DL-320: revert_cascade — clear primary + all sibling records sharing the file, archive it ----
    if (action === 'revert_cascade') {
      const sharedItemId = clsFields.onedrive_item_id as string;
      if (!sharedItemId) {
        return c.json({ ok: false, error: 'Classification has no onedrive_item_id to cascade' }, 400);
      }

      // Find all Received doc records sharing this file
      const esc = sharedItemId.replace(/'/g, "\\'");
      const sharedDocs = await airtable.listAllRecords(TABLES.DOCUMENTS, {
        filterByFormula: `AND({onedrive_item_id} = '${esc}', {status} = 'Received')`,
      });

      // Defense-in-depth: verify all shared docs belong to the same client as the classification
      const clsClientId = (Array.isArray(clsFields.client_id) ? clsFields.client_id[0] : clsFields.client_id) as string;
      if (clsClientId) {
        for (const sd of sharedDocs) {
          const sdClientId = (() => {
            const v = (sd.fields as any).client_id;
            return (Array.isArray(v) ? v[0] : v) as string;
          })();
          if (sdClientId && sdClientId !== clsClientId) {
            return c.json({ ok: false, error: 'Sibling record belongs to a different client — aborting cascade' }, 400);
          }
        }
      }

      // Clear each doc record: back to Required_Missing, strip file fields
      const clearedDocIds: string[] = [];
      for (const sd of sharedDocs) {
        try {
          await airtable.updateRecord(TABLES.DOCUMENTS, sd.id, {
            status: 'Required_Missing',
            file_url: null,
            onedrive_item_id: null,
            file_hash: null,
            attachment_name: null,
            source_attachment_name: null,
            document_uid: null,
          } as any);
          clearedDocIds.push(sd.id);
        } catch (err) {
          console.error('[revert_cascade] Failed to clear doc', sd.id, (err as Error).message);
        }
      }

      // Reset classification to pending
      await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, {
        review_status: 'pending',
        notification_status: '',
        document: [],
      } as any);

      // Archive the OneDrive file (no more references)
      let archived = false;
      try {
        const msGraph = new MSGraphClient(c.env, c.executionCtx);
        await moveFileToArchive(msGraph, sharedItemId);
        archived = true;
      } catch (err) {
        console.error('[revert_cascade] archive failed:', (err as Error).message);
      }

      invalidateCache(c.env.CACHE_KV, 'cache:documents_non_waived_v2');

      return c.json({
        ok: true,
        action: 'revert_cascade',
        cleared_doc_ids: clearedDocIds,
        archived,
        shared_onedrive_item_id: sharedItemId,
      });
    }

    // ---- DL-314: also_match — fan out one classification file to N doc records ----
    if (action === 'also_match') {
      if (!Array.isArray(additional_targets) || additional_targets.length === 0) {
        return c.json({ ok: false, error: 'additional_targets[] required for also_match action' }, 400);
      }

      const sharedItemId = clsFields.onedrive_item_id as string;
      const sharedFileUrl = clsFields.file_url as string;
      const sharedFileHash = clsFields.file_hash as string;
      if (!sharedItemId || !sharedFileUrl) {
        return c.json({ ok: false, error: 'Classification has no file to share' }, 400);
      }

      const sourceReportId = getField(clsFields.report) as string;
      const sourceReport = sourceReportId ? await airtable.getRecord(TABLES.REPORTS, sourceReportId) : null;
      const sourceClientId = sourceReport ? String(getField((sourceReport.fields as any).client_id) || '') : '';

      // Step A: resolve every target to a concrete Airtable doc record.
      // Step B: validate same-client + pre-flight conflict check. Abort batch on ANY conflict.
      const resolvedTargets: Array<{
        docId: string;
        fields: Record<string, unknown>;
        reportId: string;
        templateId: string;
        isNewlyCreated: boolean;
      }> = [];
      const conflicts: Array<{ template_id: string; doc_title: string; existing_name: string }> = [];

      for (const t of additional_targets) {
        const tReportId = t.target_report_id || sourceReportId;
        if (!tReportId) {
          return c.json({ ok: false, error: 'Missing target_report_id for one or more targets' }, 400);
        }

        // Cross-client leak guard: verify each target_report_id belongs to same client
        if (tReportId !== sourceReportId) {
          const targetReport = await airtable.getRecord(TABLES.REPORTS, tReportId);
          const tClientId = String(getField((targetReport.fields as any).client_id) || '');
          if (!tClientId || tClientId !== sourceClientId) {
            return c.json({ ok: false, error: `target_report_id ${tReportId} belongs to a different client` }, 400);
          }
        }

        let targetDocRec: any = null;
        let isNewlyCreated = false;

        if (t.doc_record_id) {
          targetDocRec = await airtable.getRecord(TABLES.DOCUMENTS, t.doc_record_id);
        } else if (t.template_id === 'general_doc' && t.new_doc_name) {
          const issuerKey = t.new_doc_name.toLowerCase().replace(/[^a-zA-Zא-ת0-9\s]/g, '').replace(/\s+/g, '_');
          const docUid = `${tReportId}_general_doc_client_${issuerKey}`;
          const created = await airtable.createRecords(TABLES.DOCUMENTS, [{
            fields: {
              type: 'general_doc',
              issuer_name: t.new_doc_name,
              issuer_name_en: t.new_doc_name,
              issuer_key: t.new_doc_name,
              category: 'general',
              person: 'client',
              status: 'Required_Missing',
              report: [tReportId],
              document_uid: docUid,
              document_key: docUid,
            },
          }]);
          targetDocRec = created[0];
          isNewlyCreated = true;
        } else {
          const found = await airtable.listAllRecords(TABLES.DOCUMENTS, {
            filterByFormula: `AND({type} = '${t.template_id}', FIND('${tReportId}', ARRAYJOIN({report})))`,
            maxRecords: 1,
          });
          targetDocRec = found[0];
        }

        if (!targetDocRec) {
          return c.json({ ok: false, error: `Target doc not found for template ${t.template_id}` }, 404);
        }

        const tFields = targetDocRec.fields as Record<string, unknown>;

        // Per-target conflict guard — v1 aborts the whole batch on any conflict.
        if (tFields.status === 'Received' && tFields.onedrive_item_id && tFields.onedrive_item_id !== sharedItemId) {
          conflicts.push({
            template_id: t.template_id,
            doc_title: String(tFields.issuer_name || ''),
            existing_name: String(tFields.source_attachment_name || ''),
          });
        }

        resolvedTargets.push({
          docId: targetDocRec.id,
          fields: tFields,
          reportId: tReportId,
          templateId: t.template_id,
          isNewlyCreated,
        });
      }

      if (conflicts.length > 0) {
        return c.json({ ok: false, conflict: true, conflicts, error: 'One or more targets already have approved files' }, 409);
      }

      // Step C: write shared file pointer onto every target record.
      const now = new Date().toISOString();
      const createdDocIds: string[] = [];
      for (const r of resolvedTargets) {
        const update: Record<string, unknown> = {
          status: 'Received',
          review_status: 'approved_shared',
          reviewed_by: 'Natan',
          reviewed_at: now,
          file_url: sharedFileUrl,
          onedrive_item_id: sharedItemId,
          file_hash: sharedFileHash || null,
          ai_confidence: clsFields.ai_confidence ?? null,
          ai_reason: `Multi-match from ${clsFields.matched_template_id || 'classification'}: ${clsFields.ai_reason || ''}`,
          source_attachment_name: clsFields.attachment_name || null,
          source_sender_email: sanitizeEmail(clsFields.sender_email),
          uploaded_at: clsFields.received_at || null,
        };
        await airtable.updateRecord(TABLES.DOCUMENTS, r.docId, stripEmpty(update));
        createdDocIds.push(r.docId);
      }

      // Step D: stage auto-advance for source + any distinct target reports.
      const distinctReports = Array.from(new Set([sourceReportId, ...resolvedTargets.map(r => r.reportId)].filter(Boolean)));
      for (const rid of distinctReports) {
        try {
          await checkAutoAdvanceToReview(airtable, rid);
        } catch (err) {
          console.error('[also_match] stage check failed for', rid, (err as Error).message);
        }
      }

      // Step E: invalidate doc cache.
      invalidateCache(c.env.CACHE_KV, 'cache:documents_non_waived_v2');

      return c.json({
        ok: true,
        action: 'also_match',
        classification_id,
        shared_onedrive_item_id: sharedItemId,
        created_doc_ids: createdDocIds,
        linked_count: createdDocIds.length,
      });
    }

    if (action === 'approve') {
      // Approve: update source document with classification data
      // If no direct document link, look up by matched_template_id + report
      approveDocId = docId;
      console.log('[review-classification] approve debug:', JSON.stringify({
        docId,
        matched_template_id: clsFields.matched_template_id,
        report: clsFields.report,
        document: clsFields.document,
      }));
      if (!approveDocId && clsFields.matched_template_id) {
        const reportId = getField(clsFields.report) as string;
        // DL-224: Fetch ALL docs of this type+report, prefer Required_Missing over Received
        // This prevents false conflicts when multiple issuers share the same template type
        const formula = `AND({type} = '${clsFields.matched_template_id}', FIND('${reportId}', ARRAYJOIN({report_record_id})))`;
        console.log('[review-classification] approve: template lookup formula:', formula);
        if (reportId) {
          const found = await airtable.listAllRecords(TABLES.DOCUMENTS, {
            filterByFormula: formula,
          });
          console.log('[review-classification] approve: template lookup found:', found.length, 'records');
          if (found.length > 0) {
            // Prefer a doc that still needs a file (Required_Missing) over one already Received
            const missing = found.find(d => (d.fields as any).status === 'Required_Missing');
            const pick = missing || found[0];
            approveDocId = pick.id;
            sourceDoc = pick;
            console.log('[review-classification] approve: resolved doc by template lookup:', approveDocId, 'status:', (pick.fields as any).status);
          }
        } else {
          console.log('[review-classification] approve: no reportId to lookup');
        }
      }
      // ---- DL-319: create_if_missing — atomically create required-doc row then approve ----
      if (!approveDocId && create_if_missing === true) {
        if (!template_id || typeof template_id !== 'string' || !template_id.trim()) {
          return c.json({ ok: false, error: 'template_id required when create_if_missing is true' }, 400);
        }
        const reportId = getField(clsFields.report) as string;
        if (!reportId) {
          return c.json({ ok: false, error: 'Cannot create required doc: no report linked to this classification' }, 400);
        }
        // Server-side value always wins — don't trust the client's template_id blindly
        const serverTemplateId = (clsFields.matched_template_id as string) || template_id.trim();
        if (template_id.trim() !== serverTemplateId) {
          console.warn('[review-classification] approve create_if_missing: client template_id mismatch',
            JSON.stringify({ client: template_id.trim(), server: serverTemplateId }));
        }
        // Race guard: re-check for existing row before creating (small window, no Airtable unique constraint)
        const raceCheck = await airtable.listAllRecords(TABLES.DOCUMENTS, {
          filterByFormula: `AND({type} = '${serverTemplateId}', FIND('${reportId}', ARRAYJOIN({report_record_id})))`,
          maxRecords: 1,
        });
        if (raceCheck.length > 0) {
          // Another concurrent request already created the row — use it
          const racePick = raceCheck.find(d => (d.fields as any).status === 'Required_Missing') || raceCheck[0];
          approveDocId = racePick.id;
          sourceDoc = racePick;
          console.log('[review-classification] approve create_if_missing: race winner found existing row', approveDocId);
        } else {
          // Create a minimal required-doc placeholder row; approve flow below will flip it to Received
          const newDocFields: Record<string, unknown> = {
            type: serverTemplateId,
            report: [reportId],
            status: 'Required_Missing',
          };
          const created = await airtable.createRecords(TABLES.DOCUMENTS, [{ fields: newDocFields }], { typecast: true });
          const newRec = created[0];
          approveDocId = newRec.id;
          sourceDoc = newRec;
          console.log('[review-classification] approve create_if_missing: created required-doc row', approveDocId, 'type:', serverTemplateId);
        }
      }
      // ---- end DL-319 ----

      if (!approveDocId) {
        console.log('[review-classification] approve: FAILED - no doc found');
        return c.json({ ok: false, error: 'Cannot approve: no matching document found' }, 400);
      }

      // ---- DL-222: Conflict guard for approve (mirror of DL-070 reassign guard) ----
      const targetDocCheck = sourceDoc || await airtable.getRecord(TABLES.DOCUMENTS, approveDocId);
      const targetDocFields = targetDocCheck.fields as Record<string, unknown>;
      if (targetDocFields.status === 'Received' && targetDocFields.onedrive_item_id && !force_overwrite) {
        return c.json({
          ok: false,
          conflict: true,
          conflict_doc_title: targetDocFields.issuer_name || '',
          conflict_existing_name: targetDocFields.source_attachment_name || '',
          conflict_new_name: clsFields.attachment_name || '',
          error: 'Target document already has an approved file',
        }, 409);
      }

      // ---- DL-222: Mode-branching for approve conflict resolution ----
      const resolvedMode = force_overwrite ? (approve_mode || 'override') : 'standard';

      if (resolvedMode === 'merge') {
        // Merge: download both PDFs, merge chronologically, re-upload to existing item
        const msGraph = new MSGraphClient(c.env, c.executionCtx);
        const existingItemId = targetDocFields.onedrive_item_id as string;
        const newItemId = clsFields.onedrive_item_id as string;

        const [existingPdf, newPdf] = await Promise.all([
          msGraph.getBinary(`/drives/${DRIVE_ID}/items/${existingItemId}/content`),
          msGraph.getBinary(`/drives/${DRIVE_ID}/items/${newItemId}/content`),
        ]);

        // Order chronologically: existing doc's uploaded_at vs classification's received_at
        const existingDate = new Date(targetDocFields.uploaded_at as string || '1970-01-01');
        const newDate = new Date(clsFields.received_at as string || '1970-01-01');
        const [firstPdf, secondPdf] = existingDate <= newDate
          ? [existingPdf, newPdf]
          : [newPdf, existingPdf];

        const mergedBytes = await mergePdfs(firstPdf, secondPdf);
        const mergedHash = await computeSha256(mergedBytes.buffer as ArrayBuffer);

        // Upload merged content back to existing item (preserves URL and itemId)
        await msGraph.putBinary(
          `/drives/${DRIVE_ID}/items/${existingItemId}/content`,
          mergedBytes.buffer as ArrayBuffer,
        );

        // Delete the redundant new file
        try {
          await msGraph.delete(`/drives/${DRIVE_ID}/items/${newItemId}`);
        } catch (delErr) {
          console.error('[review-classification] merge: failed to delete redundant file:', (delErr as Error).message);
        }

        // Update doc record with new hash (file_url and onedrive_item_id stay the same)
        const mergeUpdate: Record<string, unknown> = {
          file_hash: mergedHash,
          reviewed_by: 'Natan',
          reviewed_at: new Date().toISOString(),
        };
        await airtable.updateRecord(TABLES.DOCUMENTS, approveDocId, stripEmpty(mergeUpdate));
        docTitle = targetDocFields.issuer_name as string || '';
        console.log('[review-classification] approve merge: merged into', existingItemId, 'deleted', newItemId);

      } else if (resolvedMode === 'keep_both') {
        // Keep both: create a new document record with suffixed title
        const reportId = getField(clsFields.report) as string;
        const templateId = (clsFields.matched_template_id || targetDocFields.type) as string;

        // DL-224: Count existing docs of same type+report+issuer to determine part number
        const keepBothIssuer = targetDocFields.issuer_name as string || '';
        const keepBothIssuerClause = keepBothIssuer
          ? `, {issuer_name} = '${keepBothIssuer.replace(/ — חלק \d+$/, '').replace(/'/g, "\\'")}'`
          : '';
        const existingDocs = await airtable.listAllRecords(TABLES.DOCUMENTS, {
          filterByFormula: `AND({type} = '${templateId}', FIND('${reportId}', ARRAYJOIN({report_record_id}))${keepBothIssuerClause})`,
        });
        const partNumber = existingDocs.length + 1;
        const existingTitle = targetDocFields.issuer_name as string || '';
        // Strip any existing " — חלק N" suffix before adding new one
        const baseTitle = existingTitle.replace(/ — חלק \d+$/, '');
        const suffixedTitle = `${baseTitle} — חלק ${partNumber}`;

        // DL-231: Derive document_uid/key from original doc's key + part suffix
        const origKey = (targetDocFields.document_uid || targetDocFields.document_key || '') as string;
        const partSuffix = `_part${partNumber}`;
        const docUid = origKey ? `${origKey}${partSuffix}` : '';

        const newDocFields: Record<string, unknown> = {
          type: templateId,
          issuer_name: suffixedTitle,
          issuer_key: targetDocFields.issuer_key || null,
          document_uid: docUid || null,
          document_key: docUid || null,
          status: 'Received',
          review_status: 'confirmed',
          reviewed_by: 'Natan',
          reviewed_at: new Date().toISOString(),
          file_url: clsFields.file_url || null,
          onedrive_item_id: clsFields.onedrive_item_id || null,
          file_hash: clsFields.file_hash || null,
          ai_confidence: clsFields.ai_confidence ?? null,
          ai_reason: clsFields.ai_reason || null,
          source_attachment_name: clsFields.attachment_name || null,
          source_sender_email: sanitizeEmail(clsFields.sender_email),
          uploaded_at: clsFields.received_at || null,
          report: reportId ? [reportId] : null,
          person: targetDocFields.person || null,
          category: targetDocFields.category || null,
        };
        const newDocCleaned = stripEmpty(newDocFields);
        const created = await airtable.createRecords(TABLES.DOCUMENTS, [{ fields: newDocCleaned }]);
        approveDocId = created[0].id;
        docTitle = suffixedTitle;
        console.log('[review-classification] approve keep_both: created doc', approveDocId, 'as', suffixedTitle);

      } else {
        // Standard approve or override: update source document with classification data
        // DL-224: If overriding, move the old file to ארכיון
        // DL-314: Only archive if this record is the LAST reference to the file
        if (resolvedMode === 'override' && targetDocFields.onedrive_item_id) {
          const oldItemId = targetDocFields.onedrive_item_id as string;
          if (await isLastReference(airtable, oldItemId, approveDocId)) {
            const msGraph = new MSGraphClient(c.env, c.executionCtx);
            await moveFileToArchive(msGraph, oldItemId);
          } else {
            console.log('[review-classification] approve override: skip archive — file still referenced by siblings', oldItemId);
          }
        }
        const docUpdate: Record<string, unknown> = {
          status: 'Received',
          review_status: 'confirmed',
          reviewed_by: 'Natan',
          reviewed_at: new Date().toISOString(),
          file_url: clsFields.file_url || null,
          onedrive_item_id: clsFields.onedrive_item_id || null,
          file_hash: clsFields.file_hash || null,
          ai_confidence: clsFields.ai_confidence ?? null,
          ai_reason: clsFields.ai_reason || null,
          source_attachment_name: clsFields.attachment_name || null,
          source_sender_email: sanitizeEmail(clsFields.sender_email),
          uploaded_at: clsFields.received_at || null,
        };
        // DL-271: Append rental contract period to doc title
        const periodInfo = getRentalPeriodLabel();
        if (periodInfo && sourceDoc) {
          const currentTitle = (sourceDoc.fields as any).issuer_name as string || '';
          // Strip any existing period suffix (e.g., <b>1-8/2025</b>) before appending new one
          const stripped = currentTitle.replace(/\s*<b>\d+-\d+\/\d+<\/b>\s*$/, '');
          docUpdate.issuer_name = `${stripped} ${periodInfo.html}`;
        }
        const cleaned = stripEmpty(docUpdate);
        console.log('[review-classification] approve docId:', approveDocId, 'fields:', JSON.stringify(cleaned));
        await airtable.updateRecord(TABLES.DOCUMENTS, approveDocId, cleaned);
        docTitle = docUpdate.issuer_name as string || (sourceDoc ? (sourceDoc.fields as any).issuer_name || '' : '');
      }

    } else if (action === 'reject') {
      // Reject (DL-081 inline PATCH): clear fields and set rejection reason
      let fixReasonClient = '';
      if (notes) {
        try {
          const parsed = JSON.parse(notes);
          fixReasonClient = REJECTION_REASONS[parsed.reason] || parsed.text || notes;
        } catch {
          fixReasonClient = notes;
        }
      }

      // Inline PATCH to ensure null fields are cleared
      const rejectFields: Record<string, unknown> = {
        status: 'Required_Missing',
        review_status: null,
        reviewed_by: null,
        reviewed_at: null,
        ai_confidence: null,
        ai_reason: null,
        file_url: null,
        onedrive_item_id: null,
        file_hash: null,
        source_attachment_name: null,
        source_sender_email: null,
        uploaded_at: null,
        fix_reason_client: fixReasonClient,
      };
      // DL-344: Guard — don't clear if a different file was already approved to this doc
      // (mirror of DL-248 reassign guard at L1582-1612). Multiple AI classifications often
      // pre-link to the same source doc; rejecting one must not wipe the file another
      // approve put there.
      let rejectSkipClear = false;
      if (docId) {
        const srcDocForGuard = sourceDoc || await airtable.getRecord(TABLES.DOCUMENTS, docId);
        const srcItemId = (srcDocForGuard.fields as any).onedrive_item_id as string;
        const clsItemId = clsFields.onedrive_item_id as string;
        if (srcItemId && srcItemId !== clsItemId) {
          rejectSkipClear = true;
          console.log('[review-classification] reject: skip clear — source doc has different file',
            JSON.stringify({ docId, srcItemId, clsItemId }));
        }
      }
      if (!rejectSkipClear) {
        // Use direct Airtable API PATCH (not the client's updateRecord which may drop nulls)
        await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${TABLES.DOCUMENTS}/${docId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: rejectFields }),
        });
      }
      docTitle = sourceDoc ? (sourceDoc.fields as any).issuer_name || '' : '';

      // DL-244: Append to report's rejected_uploads_log (fail-soft)
      try {
        const reportId = target_report_id || getField(clsFields.report) as string;
        if (!reportId) {
          console.warn('[reject] no reportId — skipping rejected_uploads_log append');
        } else {
          // Parse notes for reason_code / reason_text / free-text
          let reasonCode = '';
          let reasonText = '';
          let freeText = '';
          if (notes) {
            try {
              const parsed = JSON.parse(notes);
              reasonCode = parsed.reason || '';
              reasonText = REJECTION_REASONS[reasonCode] || '';
              freeText = parsed.text || '';
            } catch {
              freeText = notes;
            }
          }

          // Read-modify-write on the report record
          const reportRec = await airtable.getRecord(TABLES.REPORTS, reportId);
          const existingRaw = (reportRec.fields as any).rejected_uploads_log as string | undefined;
          let logEntries: Array<Record<string, unknown>> = [];
          try {
            logEntries = JSON.parse(existingRaw || '[]');
            if (!Array.isArray(logEntries)) logEntries = [];
          } catch {
            logEntries = [];
          }

          // Dedup by classification id
          const alreadyLogged = logEntries.some(e => e.cls_id === classification_id);
          if (!alreadyLogged) {
            const today = new Date().toISOString().slice(0, 10);
            const newEntry: Record<string, unknown> = {
              id: `ru_${Date.now()}`,
              cls_id: classification_id,
              filename: (clsFields.attachment_name as string) || 'מסמך ללא שם',
              received_at: (clsFields.received_at as string) || today,
              reason_code: reasonCode,
              reason_text: reasonText,
              notes: freeText,
              rejected_at: new Date().toISOString(),
              rejected_by: 'office',
            };
            logEntries.push(newEntry);
            await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${TABLES.REPORTS}/${reportId}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { rejected_uploads_log: JSON.stringify(logEntries) } }),
            });
          }
        }
      } catch (err) {
        console.error('[reject] failed to append rejected_uploads_log:', err);
      }

    } else if (action === 'reassign') {
      // Reassign: clear source doc, find/create target doc, update target

      // Clear source doc via inline PATCH (same null-clearing pattern as reject)
      // DL-248: Guard — don't clear if a different file was already approved to this doc
      if (docId) {
        const srcDoc = sourceDoc || await airtable.getRecord(TABLES.DOCUMENTS, docId);
        const srcFields = srcDoc.fields as Record<string, unknown>;
        const srcItemId = srcFields.onedrive_item_id as string;
        const clsItemId = clsFields.onedrive_item_id as string;

        if (srcItemId && srcItemId !== clsItemId) {
          console.log('[review-classification] reassign: skip clear — source doc has different file',
            JSON.stringify({ docId, srcItemId, clsItemId }));
        } else {
          const clearFields: Record<string, unknown> = {
            status: 'Required_Missing',
            review_status: null,
            reviewed_by: null,
            reviewed_at: null,
            ai_confidence: null,
            ai_reason: null,
            file_url: null,
            onedrive_item_id: null,
            file_hash: null,
            source_attachment_name: null,
            source_sender_email: null,
            uploaded_at: null,
          };
          await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${TABLES.DOCUMENTS}/${docId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: clearFields }),
          });
        }
      }

      // Find target doc (3 paths)
      // DL-239: target_report_id overrides for cross-filing-type reassign
      const reportId = target_report_id || getField(clsFields.report) as string;

      if (reassign_doc_record_id) {
        // Path 1: Direct target doc ID
        targetDoc = await airtable.getRecord(TABLES.DOCUMENTS, reassign_doc_record_id);
      } else if (reassign_template_id === 'general_doc' && new_doc_name && !reassign_doc_record_id) {
        // Path 2: Create new general doc
        const issuerKey = new_doc_name.toLowerCase().replace(/[^a-zA-Zא-ת0-9\s]/g, '').replace(/\s+/g, '_');
        const docUid = `${reportId}_general_doc_client_${issuerKey}`;
        const created = await airtable.createRecords(TABLES.DOCUMENTS, [{
          fields: {
            type: 'general_doc',
            issuer_name: new_doc_name,
            issuer_name_en: new_doc_name,
            issuer_key: new_doc_name,
            category: 'general',
            person: 'client',
            status: 'Required_Missing',
            report: [reportId],
            document_uid: docUid,
            document_key: docUid,
          }
        }]);
        targetDoc = created[0];
      } else {
        // Path 3: Search by template + report
        const found = await airtable.listAllRecords(TABLES.DOCUMENTS, {
          filterByFormula: `AND({type} = '${reassign_template_id}', FIND('${reportId}', ARRAYJOIN({report})))`,
          maxRecords: 1,
        });
        targetDoc = found[0];

        // DL-350: When picker (DL-336) returns a real template_id for a doc
        // that doesn't yet exist on this report, create it on the fly. Mirrors
        // Path 2 but preserves the chosen template type. Falls back to the
        // template's own name fields when the frontend didn't supply
        // new_doc_name (which can happen for var-less templates).
        if (!targetDoc && reassign_template_id) {
          const tpl = await airtable.listAllRecords(TABLES.TEMPLATES, {
            filterByFormula: `{template_id} = '${reassign_template_id}'`,
            maxRecords: 1,
          });
          const tplFields = (tpl[0]?.fields || {}) as Record<string, unknown>;
          const derivedName = new_doc_name
            || (tplFields.name_he as string)
            || (tplFields.name as string)
            || (tplFields.name_en as string)
            || reassign_template_id;
          const issuerKey = derivedName.toLowerCase().replace(/[^a-zA-Zא-ת0-9\s]/g, '').replace(/\s+/g, '_');
          const docUid = `${reportId}_${reassign_template_id}_${issuerKey}`;
          const created = await airtable.createRecords(TABLES.DOCUMENTS, [{
            fields: {
              type: reassign_template_id,
              issuer_name: derivedName,
              issuer_name_en: derivedName,
              issuer_key: derivedName,
              category: (tplFields.category as string) || 'general',
              person: (tplFields.person as string) || 'client',
              status: 'Required_Missing',
              report: [reportId],
              document_uid: docUid,
              document_key: docUid,
            }
          }]);
          targetDoc = created[0];
        }
      }

      if (!targetDoc) {
        return c.json({ ok: false, error: 'Target document not found for reassign' }, 404);
      }

      // DL-224: Mode-branching for reassign conflict resolution (mirrors approve logic)
      const reassignMode = force_overwrite ? (approve_mode || 'override') : 'standard';
      const targetDocFields_r = targetDoc.fields as Record<string, unknown>;

      if (reassignMode === 'merge') {
        const msGraph = new MSGraphClient(c.env, c.executionCtx);
        const existingItemId = targetDocFields_r.onedrive_item_id as string;
        const newItemId = clsFields.onedrive_item_id as string;

        const [existingPdf, newPdf] = await Promise.all([
          msGraph.getBinary(`/drives/${DRIVE_ID}/items/${existingItemId}/content`),
          msGraph.getBinary(`/drives/${DRIVE_ID}/items/${newItemId}/content`),
        ]);

        const existingDate = new Date(targetDocFields_r.uploaded_at as string || '1970-01-01');
        const newDate = new Date(clsFields.received_at as string || '1970-01-01');
        const [firstPdf, secondPdf] = existingDate <= newDate
          ? [existingPdf, newPdf]
          : [newPdf, existingPdf];

        const mergedBytes = await mergePdfs(firstPdf, secondPdf);
        const mergedHash = await computeSha256(mergedBytes.buffer as ArrayBuffer);

        await msGraph.putBinary(
          `/drives/${DRIVE_ID}/items/${existingItemId}/content`,
          mergedBytes.buffer as ArrayBuffer,
        );

        try {
          await msGraph.delete(`/drives/${DRIVE_ID}/items/${newItemId}`);
        } catch (delErr) {
          console.error('[review-classification] reassign merge: failed to delete redundant file:', (delErr as Error).message);
        }

        await airtable.updateRecord(TABLES.DOCUMENTS, targetDoc.id, stripEmpty({
          file_hash: mergedHash,
          reviewed_by: 'Natan',
          reviewed_at: new Date().toISOString(),
        }));
        docTitle = targetDocFields_r.issuer_name as string || '';
        console.log('[review-classification] reassign merge: merged into', existingItemId);

      } else if (reassignMode === 'keep_both') {
        const reportId = getField(clsFields.report) as string;
        const templateId = (reassign_template_id || targetDocFields_r.type) as string;

        const keepBothIssuer = targetDocFields_r.issuer_name as string || '';
        const keepBothIssuerClause = keepBothIssuer
          ? `, {issuer_name} = '${keepBothIssuer.replace(/ — חלק \d+$/, '').replace(/'/g, "\\'")}'`
          : '';
        const existingDocs = await airtable.listAllRecords(TABLES.DOCUMENTS, {
          filterByFormula: `AND({type} = '${templateId}', FIND('${reportId}', ARRAYJOIN({report_record_id}))${keepBothIssuerClause})`,
        });
        const partNumber = existingDocs.length + 1;
        const existingTitle = targetDocFields_r.issuer_name as string || '';
        const baseTitle = existingTitle.replace(/ — חלק \d+$/, '');
        const suffixedTitle = `${baseTitle} — חלק ${partNumber}`;

        // DL-231: Derive document_uid/key from original doc's key + part suffix
        const origKey_r = (targetDocFields_r.document_uid || targetDocFields_r.document_key || '') as string;
        const partSuffix_r = `_part${partNumber}`;
        const docUid_r = origKey_r ? `${origKey_r}${partSuffix_r}` : '';

        const newDocFields: Record<string, unknown> = {
          type: templateId,
          issuer_name: suffixedTitle,
          issuer_key: targetDocFields_r.issuer_key || null,
          document_uid: docUid_r || null,
          document_key: docUid_r || null,
          status: 'Received',
          review_status: 'confirmed',
          reviewed_by: 'Natan',
          reviewed_at: new Date().toISOString(),
          file_url: clsFields.file_url || null,
          onedrive_item_id: clsFields.onedrive_item_id || null,
          file_hash: clsFields.file_hash || null,
          ai_confidence: clsFields.ai_confidence ?? null,
          ai_reason: `Reassigned from ${clsFields.matched_template_id}: ${clsFields.ai_reason || ''}`,
          source_attachment_name: clsFields.attachment_name || null,
          source_sender_email: sanitizeEmail(clsFields.sender_email),
          uploaded_at: clsFields.received_at || null,
          report: reportId ? [reportId] : null,
          person: targetDocFields_r.person || null,
          category: targetDocFields_r.category || null,
        };
        const created = await airtable.createRecords(TABLES.DOCUMENTS, [{ fields: stripEmpty(newDocFields) }]);
        targetDoc = created[0];
        docTitle = suffixedTitle;
        console.log('[review-classification] reassign keep_both: created doc', targetDoc.id, 'as', suffixedTitle);

      } else {
        // Standard reassign or override
        // DL-224: If overriding, move the old file to ארכיון
        // DL-314: Only archive if this record is the LAST reference to the file
        if (reassignMode === 'override' && targetDocFields_r.onedrive_item_id) {
          const oldItemId = targetDocFields_r.onedrive_item_id as string;
          if (await isLastReference(airtable, oldItemId, targetDoc.id)) {
            const msGraph = new MSGraphClient(c.env, c.executionCtx);
            await moveFileToArchive(msGraph, oldItemId);
          } else {
            console.log('[review-classification] reassign override: skip archive — file still referenced by siblings', oldItemId);
          }
        }
        await airtable.updateRecord(TABLES.DOCUMENTS, targetDoc.id, stripEmpty({
          status: 'Received',
          review_status: 'confirmed',
          reviewed_by: 'Natan',
          reviewed_at: new Date().toISOString(),
          file_url: clsFields.file_url || null,
          onedrive_item_id: clsFields.onedrive_item_id || null,
          file_hash: clsFields.file_hash || null,
          ai_confidence: clsFields.ai_confidence ?? null,
          ai_reason: `Reassigned from ${clsFields.matched_template_id}: ${clsFields.ai_reason || ''}`,
          source_attachment_name: clsFields.attachment_name || null,
          source_sender_email: sanitizeEmail(clsFields.sender_email),
          uploaded_at: clsFields.received_at || null,
        }));
        docTitle = (targetDoc.fields as any).issuer_name || new_doc_name || '';
      }
    }

    // ---- Step 5: Update classification record ----
    await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${TABLES.CLASSIFICATIONS}/${classification_id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          review_status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'reassigned',
          reviewed_at: new Date().toISOString(),
          notes: notes || '',
        }
      }),
    });

    // DL-210: notification_status is no longer auto-set here.
    // Records are deleted by POST /dismiss-classifications when admin clicks "סיום בדיקה".

    // ---- Step 6: OneDrive file operations ----
    if (!clsFields.onedrive_item_id) {
      // No file to move — skip
    } else {
      const msGraph = new MSGraphClient(c.env, c.executionCtx);
      const itemId = clsFields.onedrive_item_id as string;

      try {
        // Fetch templates for buildShortName (cached)
        const templateRecords = await getCachedOrFetch(c.env.CACHE_KV, 'cache:templates', 3600,
          () => airtable.listAllRecords(TABLES.TEMPLATES));
        const templateMap = buildTemplateMap(templateRecords);

        // Determine new filename
        let newFilename: string | null = null;
        let moveToArchive = false;

        if (action === 'approve') {
          // Rename to short name (unless exact match)
          const matchQuality = clsFields.issuer_match_quality as string;
          if (matchQuality !== 'exact' && matchQuality !== 'single') {
            const templateId = clsFields.matched_template_id as string;
            const docName =
              (clsFields.matched_doc_name as string) ||
              (clsFields.issuer_name as string) ||
              ((sourceDoc?.fields as any)?.issuer_name as string) ||
              '';
            const shortName = buildShortName(templateId, docName, templateMap);
            const fallback = HE_TITLE[templateId];
            if (shortName) {
              newFilename = sanitizeFilename(shortName) + '.pdf';
            } else if (fallback) {
              // Extract issuer from bold tags (or use the whole docName if no bold tags)
              const boldMatch = docName.match(/<b>(.*?)<\/b>/i);
              const issuer = boldMatch ? boldMatch[1] : docName;
              newFilename = sanitizeFilename(fallback + (issuer ? ' \u2013 ' + issuer : '')) + '.pdf';
            }
          }
          // DL-271: Always rename T901/T902 with period suffix, even for exact/single match
          const periodForFile = getRentalPeriodLabel();
          if (periodForFile) {
            if (newFilename) {
              newFilename = newFilename.replace('.pdf', ` ${periodForFile.filename}.pdf`);
            } else {
              // No rename was planned (exact/single match) — build from HE_TITLE + period
              const templateId = clsFields.matched_template_id as string;
              const fallback = HE_TITLE[templateId] || 'חוזה שכירות';
              newFilename = sanitizeFilename(`${fallback} ${periodForFile.filename}`) + '.pdf';
            }
          }
        } else if (action === 'reject') {
          // DL-314: Only archive if no OTHER doc record holds this file
          moveToArchive = await isLastReference(airtable, itemId, docId);
          if (!moveToArchive) {
            console.log('[review-classification] reject: skip archive — file still referenced by other doc(s)', itemId);
          }
          // No rename for reject
        } else if (action === 'reassign') {
          // DL-240: no subfolder move — file stays in filing type root, just rename
          // Rename to target doc short name
          if (targetDoc) {
            const tf = targetDoc.fields as Record<string, unknown>;
            const targetTemplateId = (tf.type as string) || 'general_doc';
            const targetIssuer = (tf.issuer_name as string) || new_doc_name || '';
            const shortName = buildShortName(targetTemplateId, targetIssuer, templateMap);
            const fallback = HE_TITLE[targetTemplateId];
            if (shortName) {
              newFilename = sanitizeFilename(shortName) + '.pdf';
            } else if (fallback) {
              newFilename = sanitizeFilename(fallback) + '.pdf';
            } else if (targetTemplateId === 'general_doc' && targetIssuer) {
              // DL-210 Bug 3: general_doc has no HE_TITLE entry — use issuer name directly
              newFilename = sanitizeFilename(targetIssuer) + '.pdf';
            }
            // DL-271: Append period for T901/T902 reassign
            const periodForReassign = getRentalPeriodLabel();
            if (periodForReassign && newFilename) {
              newFilename = newFilename.replace('.pdf', ` ${periodForReassign.filename}.pdf`);
            }
          }
        }

        if (newFilename || moveToArchive) {
          // 1. Get current file location
          const fileInfo = await msGraph.get(`/drives/${DRIVE_ID}/items/${itemId}?$select=id,name,parentReference`);
          const parentId = fileInfo?.parentReference?.id;

          if (parentId) {
            let targetFolderId: string | null = null;

            if (moveToArchive) {
              // DL-240: file is directly in filing type folder — 2 levels: file → filingFolder → yearFolder
              const filingFolderInfo = await msGraph.get(`/drives/${DRIVE_ID}/items/${parentId}?$select=id,name,parentReference`);
              const yearFolderId = filingFolderInfo?.parentReference?.id || parentId;

              try {
                const created = await msGraph.post(`/drives/${DRIVE_ID}/items/${yearFolderId}/children`, {
                  name: 'ארכיון',
                  folder: {},
                  '@microsoft.graph.conflictBehavior': 'fail',
                });
                targetFolderId = created?.id;
              } catch {
                try {
                  const existing = await msGraph.get(`/drives/${DRIVE_ID}/items/${yearFolderId}:/${encodeURIComponent('ארכיון')}:`);
                  targetFolderId = existing?.id;
                } catch (e2) {
                  console.error('[review-classification] Failed to get ארכיון folder:', (e2 as Error).message);
                }
              }
            }

            // 4. PATCH file: rename and/or move
            const patchBody: Record<string, unknown> = {};
            if (newFilename) patchBody.name = newFilename;
            if (targetFolderId) patchBody.parentReference = { id: targetFolderId };

            if (Object.keys(patchBody).length > 0) {
              try {
                const moveResult = await msGraph.patch(
                  `/drives/${DRIVE_ID}/items/${itemId}?@microsoft.graph.conflictBehavior=rename`,
                  patchBody
                );

                // 5. Update Airtable doc record with new file URL (skip for reject — doc fields already cleared)
                if (moveResult?.webUrl && action !== 'reject') {
                  const updateDocId = action === 'reassign' && targetDoc ? targetDoc.id : (approveDocId || docId);
                  if (updateDocId) {
                    await airtable.updateRecord(TABLES.DOCUMENTS, updateDocId, {
                      file_url: moveResult.webUrl,
                      onedrive_item_id: moveResult.id || itemId,
                    });
                  }
                }
              } catch (moveErr) {
                console.error('[review-classification] File move failed:', (moveErr as Error).message);
                // Non-fatal: response already structured, just log the error
              }
            }
          }
        }
      } catch (graphErr) {
        console.error('[review-classification] OneDrive operations failed:', (graphErr as Error).message);
        // Non-fatal: Airtable updates already done
      }
    }

    // ---- Step 7: Stage advancement (DL-267) ----
    const reportId = getField(clsFields.report) as string;
    if (action === 'approve' || action === 'reassign') {
      await checkAutoAdvanceToReview(airtable, reportId);
    }

    // ---- Step 8: Return response ----
    // DL-254: Invalidate documents cache after approve/reject/reassign changes doc status
    invalidateCache(c.env.CACHE_KV, 'cache:documents_non_waived_v2');

    return c.json({
      ok: true,
      action,
      classification_id,
      doc_id: approveDocId || docId || targetDoc?.id || '',
      doc_title: docTitle,
      client_name: getField(clsFields.client_name) as string,
      report_key: (getField(clsFields.report_key) as string) || '',
      report_record_id: getField(clsFields.report) as string,
      reassigned: action === 'reassign',
      errors: [],
    });
  } catch (err) {
    console.error('[review-classification] Unhandled error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/review-classification',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// POST /webhook/dismiss-classifications — DL-210: bulk delete reviewed classification records
classifications.post('/dismiss-classifications', async (c) => {
  try {
    const env = c.env;
    const body = await c.req.json() as Record<string, unknown>;
    const { token, record_ids } = body as { token: string; record_ids: string[] };

    if (!token) return c.json({ ok: false, error: 'Missing token' }, 400);

    const tokenResult = await verifyToken(token, env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }

    if (!Array.isArray(record_ids) || record_ids.length === 0) {
      return c.json({ ok: false, error: 'Missing record_ids' }, 400);
    }

    // Delete in batches of 10 (Airtable limit)
    const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);
    let deleted = 0;
    for (let i = 0; i < record_ids.length; i += 10) {
      const chunk = record_ids.slice(i, i + 10);
      const qs = chunk.map(id => `records[]=${encodeURIComponent(id)}`).join('&');
      const res = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${TABLES.CLASSIFICATIONS}?${qs}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}` } }
      );
      if (res.ok) {
        const data = (await res.json()) as { records: { id: string; deleted: boolean }[] };
        deleted += data.records.filter(r => r.deleted).length;
      }
    }

    return c.json({ ok: true, deleted });
  } catch (err) {
    console.error('[dismiss-classifications] Error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// POST /webhook/save-classification-question — DL-328
// Saves or clears pending_question on a single classification record.
classifications.post('/save-classification-question', async (c) => {
  const env = c.env;
  const authHeader = c.req.header('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }
  const { verifyToken } = await import('../lib/token');
  const tokenResult = await verifyToken(authHeader.slice(7), env.SECRET_KEY);
  if (!tokenResult.valid) {
    return c.json({ ok: false, error: 'INVALID_TOKEN' }, 401);
  }

  let body: { classification_id?: string; question?: string };
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'Invalid JSON' }, 400); }

  const { classification_id, question } = body;
  if (!classification_id) return c.json({ ok: false, error: 'Missing classification_id' }, 400);

  const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);
  await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, {
    pending_question: question || null,
  });
  return c.json({ ok: true });
});

export default classifications;
