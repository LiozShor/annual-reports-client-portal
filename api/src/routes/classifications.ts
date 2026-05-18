import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { logSecurity, getClientIp } from '../lib/security-log';
import { buildTemplateMap, buildCategoryMap } from '../lib/doc-builder';
import type { TemplateInfo } from '../lib/doc-builder';
import { buildShortName, REJECTION_REASONS, DRIVE_ID, sanitizeFilename, HE_TITLE, resolveOneDriveFilename } from '../lib/classification-helpers';
import { mergePdfs, mergePdfsN } from '../lib/pdf-merge';
import { splitPdf } from '../lib/pdf-split';
import { computeSha256, resolveOneDriveRoot, uploadToOneDrive, getFileExtension } from '../lib/inbound/attachment-utils';
import { classifyAttachment } from '../lib/inbound/document-classifier';
import type { ProcessingContext, AttachmentInfo, ClassificationResult } from '../lib/inbound/types';
import { getCachedOrFetch, invalidateCache } from '../lib/cache';
import { logError } from '../lib/error-logger';
import { logEvent } from '../lib/activity-logger';
import { checkAutoAdvanceToReview } from '../lib/auto-advance';
import { isLastReference, buildSharedRefMap } from '../lib/file-refcount';
import { applyMissingStatusInvariant } from '../lib/doc-invariants';
import type { Env } from '../lib/types';

const classifications = new Hono<{ Bindings: Env }>();

// DL-224: Move a file to the ארכיון folder (same pattern as reject)
// DL-240: Files are directly in filing type folder — traverse: file → filingFolder → yearFolder (2 levels up)
export async function moveFileToArchive(msGraph: MSGraphClient, itemId: string, opts?: { subfolder?: string }) {
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

    // Optional: move into a subfolder inside ארכיון
    if (archiveFolderId && opts?.subfolder) {
      try {
        const created = await msGraph.post(`/drives/${DRIVE_ID}/items/${archiveFolderId}/children`, {
          name: opts.subfolder,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        });
        archiveFolderId = created?.id ?? archiveFolderId;
      } catch {
        try {
          const existing = await msGraph.get(`/drives/${DRIVE_ID}/items/${archiveFolderId}:/${encodeURIComponent(opts.subfolder)}:`);
          archiveFolderId = existing?.id ?? archiveFolderId;
        } catch {
          // subfolder creation failed — fall back to year-level ארכיון
        }
      }
    }

    if (archiveFolderId) {
      await msGraph.patch(`/drives/${DRIVE_ID}/items/${itemId}`, { parentReference: { id: archiveFolderId } });
      console.log('[moveFileToArchive] Moved', itemId, 'to ארכיון', opts?.subfolder ?? '(year level)');
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
  CLIENTS: 'tblFFttFScDRZ7Ah5',
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

const escapeAirtableValue = (value: string): string => value.replace(/'/g, "\\'");

// DL-397: Validate + serialize contract_period payload. Reused by `update-contract-period`
// and the manual-reassign path so both callers produce identical JSON shape and validation.
function buildContractPeriod(startDate: string, endDate: string):
  | { json: string; contractPeriod: { startDate: string; endDate: string; coversFullYear: boolean } }
  | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { error: 'Dates must be in YYYY-MM-DD format' };
  }
  const startD = new Date(startDate);
  const endD = new Date(endDate);
  if (startD >= endD) {
    return { error: 'start_date must be before end_date' };
  }
  const coversFullYear = startD.getMonth() === 0 && startD.getDate() === 1 &&
    endD.getMonth() === 11 && endD.getDate() === 31 &&
    startD.getFullYear() === endD.getFullYear();
  const contractPeriod = { startDate, endDate, coversFullYear };
  return { json: JSON.stringify(contractPeriod), contractPeriod };
}

// DL-415: Strip any prior <b>MM.YYYY-MM.YYYY</b> from issuer_name/issuer_name_en and any
// `_M-M` segment from document_key/document_uid, then re-apply the period derived from
// the CLASSIFICATION's contract_period. Mutates and returns the same docFields object.
// Only acts when matched_template_id ∈ {T901, T902} and contract_period is partial-year.
function applyPeriodSuffixToDocFields(
  docFields: Record<string, unknown>,
  clsFields: Record<string, unknown>,
): Record<string, unknown> {
  const templateId = (clsFields.matched_template_id as string) || '';
  if (!['T901', 'T902'].includes(templateId)) return docFields;
  const cpRaw = clsFields.contract_period as string;
  if (!cpRaw) return docFields;
  let cp: { startDate?: string; endDate?: string; coversFullYear?: boolean };
  try { cp = JSON.parse(cpRaw); } catch { return docFields; }
  if (!cp || !cp.startDate || !cp.endDate || cp.coversFullYear) return docFields;
  const startM = String(new Date(cp.startDate).getMonth() + 1).padStart(2, '0');
  const endM = String(new Date(cp.endDate).getMonth() + 1).padStart(2, '0');
  const year = (clsFields.year as string) || String(new Date(cp.endDate).getFullYear());
  const html = `<b>${startM}.${year}-${endM}.${year}</b>`;
  const keySuffix = `_${parseInt(startM, 10)}-${parseInt(endM, 10)}`;
  const issuerPeriodRegex = /\s*<b>\d{1,2}\.\d{4}-\d{1,2}\.\d{4}<\/b>/g;
  const partSuffixRegex = /\s*—\s*חלק\s*\d+\s*$/;
  const keyPeriodRegex = /_\d+-\d+(?=(?:_part\d+)?$)/;
  for (const field of ['issuer_name', 'issuer_name_en'] as const) {
    const v = docFields[field];
    if (typeof v === 'string' && v) {
      // Strip any prior period HTML, then split off any trailing "— חלק N" so the new
      // period lands BEFORE the part marker (matches the established T901 missing-row
      // format: "<title> <b>MM.YYYY-MM.YYYY</b> — חלק 2").
      const noPeriod = v.replace(issuerPeriodRegex, '').trim();
      const partMatch = noPeriod.match(partSuffixRegex);
      const partTail = partMatch ? partMatch[0] : '';
      const head = partTail ? noPeriod.slice(0, -partTail.length).trim() : noPeriod;
      docFields[field] = partTail ? `${head} ${html}${partTail}` : `${head} ${html}`;
    }
  }
  for (const field of ['document_key', 'document_uid'] as const) {
    const v = docFields[field];
    if (typeof v === 'string' && v) {
      const partMatch = v.match(/_part\d+$/);
      const partSuffix = partMatch ? partMatch[0] : '';
      const withoutPart = partSuffix ? v.slice(0, -partSuffix.length) : v;
      const strippedKey = withoutPart.replace(keyPeriodRegex, '');
      docFields[field] = `${strippedKey}${keySuffix}${partSuffix}`;
    }
  }
  return docFields;
}

// DL-415: Parse <b>MM.YYYY-MM.YYYY</b> embedded in an issuer_name into an ISO range.
// Used by the period-overlap conflict gate to decide if a "target Received" reassign
// is actually a clash or a clearly-different period.
function parseIssuerNamePeriod(issuerName: string): { startDate: string; endDate: string } | null {
  const m = (issuerName || '').match(/<b>(\d{1,2})\.(\d{4})-(\d{1,2})\.(\d{4})<\/b>/);
  if (!m) return null;
  const [, sm, sy, em, ey] = m;
  const startMonth = sm.padStart(2, '0');
  const endMonth = em.padStart(2, '0');
  const lastDay = new Date(Number(ey), Number(em), 0).getDate();
  return {
    startDate: `${sy}-${startMonth}-01`,
    endDate: `${ey}-${endMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

// DL-415: Returns true iff intervals [a.startDate, a.endDate] and [b.startDate, b.endDate]
// overlap on the ISO date axis. Conservative on missing/unparseable input — returns true,
// so the caller still prompts/conflicts rather than silently auto-keeping-both.
function periodsOverlap(
  a: { startDate?: string; endDate?: string } | null,
  b: { startDate?: string; endDate?: string } | null,
): boolean {
  if (!a || !b || !a.startDate || !a.endDate || !b.startDate || !b.endDate) return true;
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

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
      logSecurity(c.executionCtx, c.env, airtable, {
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
    // DL-386: spouse_name per report so the AI-tab "+ הוסף מסמך" popover can render the person picker.
    const spouseNameMap = new Map<string, string>();

    // DL-254: Parallel batch fetch reports in chunks of 50
    // DL-322: also collect linked `documents` IDs to scope the docs fetch below
    const docIdsToFetch = new Set<string>();
    const reportChunkPromises = [];
    for (let i = 0; i < reportIds.length; i += 50) {
      const chunk = reportIds.slice(i, i + 50);
      const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      reportChunkPromises.push(airtable.listAllRecords(TABLES.REPORTS, {
        filterByFormula: formula,
        fields: ['client_is_active', 'client_notes', 'filing_type', 'documents', 'spouse_name'],
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
        if (rep.fields.spouse_name) {
          spouseNameMap.set(rep.id, rep.fields.spouse_name as string);
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

    // ---- Step 3.5 (DL-361): For unidentified rows (client_id=''), fetch the
    // linked email_events records to surface email subject in pane 1 accordion.
    // Sender + received_at are already on the classification row.
    const emailEventIdSet = new Set<string>();
    for (const rec of deduped) {
      const f = rec.fields as Record<string, unknown>;
      const cid = (Array.isArray(f.client_id) ? f.client_id[0] : f.client_id) as string;
      if (cid) continue; // only need event lookups for unidentified rows
      const evField = f.email_event;
      const evId = Array.isArray(evField) ? evField[0] : evField;
      if (evId) emailEventIdSet.add(evId as string);
    }
    const emailEventSubjectMap = new Map<string, string>();
    if (emailEventIdSet.size > 0) {
      const evIdList = Array.from(emailEventIdSet);
      const evChunkPromises: Promise<any[]>[] = [];
      for (let i = 0; i < evIdList.length; i += 50) {
        const chunk = evIdList.slice(i, i + 50);
        const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
        evChunkPromises.push(
          airtable.listAllRecords('tblJAPEcSJpzdEBcW', {
            filterByFormula: formula,
            fields: ['subject'],
          }),
        );
      }
      const evBatches = await Promise.all(evChunkPromises);
      for (const batch of evBatches) {
        for (const ev of batch) {
          emailEventSubjectMap.set(ev.id, (ev.fields.subject as string) || '');
        }
      }
      mark('step3.5.emailEvents', { n: emailEventIdSet.size });
    }

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
                  fields: ['report', 'type', 'issuer_name', 'status', 'category', 'onedrive_item_id', 'person'],
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
    // DL-412: key by person + spouseName too — output diverges for spouse docs.
    const shortNameMemo = new Map<string, string | null>();
    const memoShortName = (templateId: string, docName: string, person?: string, spouseName?: string): string | null => {
      const key = `${templateId}::${docName}::${person || ''}::${spouseName || ''}`;
      if (shortNameMemo.has(key)) return shortNameMemo.get(key)!;
      const resolved = templateId ? buildShortName(templateId, docName, templateMap, person, spouseName) : null;
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
      // DL-412: pass doc.person + report.spouse_name so spouse docs render with the suffix
      const docPerson = (f.person as string) || 'client';
      const reportSpouseName = spouseNameMap.get(rid) || '';
      const resolvedShort = f.type ? memoShortName(f.type as string, docName, docPerson, reportSpouseName) : null;
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
        // DL-386: expose spouse_name (from report) so the AI-tab "+ הוסף מסמך"
        // popover renders the client/spouse selector for couples.
        spouse_name: spouseNameMap.get(reportId) || '',
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
        // DL-380/382: encrypted PDF password fields
        suggested_password: (f.suggested_password as string) || '',
        password_request_sent_at: (f.password_request_sent_at as string) || '',
        password_reply_raw: (f.password_reply_raw as string) || '',
        // DL-328: office-saved question for this classification (cleared after batch send)
        pending_question: (f.pending_question as string) || '',
        // DL-361: surface email_event link + subject so frontend can group
        // unidentified rows (client_id='') by email into per-email accordions.
        email_event_id: (() => {
          const ev = f.email_event;
          return (Array.isArray(ev) ? ev[0] : ev) as string || '';
        })(),
        email_subject: (() => {
          const ev = f.email_event;
          const evId = (Array.isArray(ev) ? ev[0] : ev) as string;
          return evId ? (emailEventSubjectMap.get(evId) || '') : '';
        })(),
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
    // DL-365 Phase 2: list-success event.
    logEvent({
      event_type: 'classifications_listed',
      category: 'AI',
      source: 'worker',
      request_id: c.get('request_id' as never) as string | undefined,
      endpoint: '/webhook/get-client-classifications',
      duration_ms: totalMs,
      details: { n_items: items.length, filing_type: filingType },
    });
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
    // DL-415: force_overwrite + approve_mode are `let` so the period-aware conflict
    // gate (Step 3) can silently auto-promote a non-overlapping-period reassign to
    // keep_both without bouncing through the frontend conflict dialog.
    let { force_overwrite, approve_mode } = body as { force_overwrite?: boolean; approve_mode?: string };
    const { token, classification_id, action, reassign_template_id, reassign_doc_record_id, notes, new_doc_name, target_report_id, additional_targets, create_if_missing, template_id, contract_period, person: bodyPerson } = body as {
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
        person?: string; // DL-412: client | spouse — applied to newly created docs
      }>;
      // DL-319: atomically create required-doc row when none exists, then approve
      create_if_missing?: boolean;
      template_id?: string;
      // DL-397: capture contract months at manual reassign to T901/T902
      contract_period?: { startDate?: string; endDate?: string };
      // DL-412: person tab from reassign picker — 'client' | 'spouse'
      person?: string;
    };

    // DL-412: validate person values up front
    if (bodyPerson && bodyPerson !== 'client' && bodyPerson !== 'spouse') {
      return c.json({ ok: false, error: `Invalid person: ${bodyPerson}` }, 400);
    }
    if (Array.isArray(additional_targets)) {
      for (const t of additional_targets) {
        if (t.person && t.person !== 'client' && t.person !== 'spouse') {
          return c.json({ ok: false, error: `Invalid additional_targets[].person: ${t.person}` }, 400);
        }
      }
    }

    // DL-412: per-request spouse_name lookup with tiny cache to avoid repeat fetches.
    const _spouseNameCache = new Map<string, string>();
    const getSpouseNameForReport = async (rid: string | null | undefined): Promise<string> => {
      if (!rid) return '';
      if (_spouseNameCache.has(rid)) return _spouseNameCache.get(rid)!;
      try {
        const rep = await airtable.getRecord(TABLES.REPORTS, rid);
        const sn = ((rep.fields as any)?.spouse_name as string) || '';
        _spouseNameCache.set(rid, sn);
        return sn;
      } catch {
        _spouseNameCache.set(rid, '');
        return '';
      }
    };
    const appendSpouseSuffix = (name: string, person: string, spouseName: string): string => {
      if (person !== 'spouse' || !spouseName || !name) return name;
      if (name.includes(spouseName)) return name;
      return `${name} – ${spouseName}`;
    };

    if (!token) {
      return c.json({ ok: false, error: 'Missing token' }, 400);
    }

    const tokenResult = await verifyToken(token, env.SECRET_KEY);
    if (!tokenResult.valid) {
      const clientIp = getClientIp(c.req.raw.headers);
      logSecurity(c.executionCtx, c.env, airtable, {
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

    if (!['approve', 'reject', 'reassign', 'split', 'classify-segment', 'finalize-split', 'request-remaining-contract', 'update-contract-period', 're-classify', 'also_match', 'revert_cascade', 'swap-classification'].includes(action)) {
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
    // DL-415: period-aware gate — when both target and new request carry parseable
    // contract periods AND they don't overlap, suppress the conflict prompt entirely.
    // The user clearly wants a separate row for a different time range. Falls back to
    // the legacy prompt when either period is missing/unparseable.
    if (action === 'reassign' && reassign_doc_record_id && !force_overwrite) {
      const targetCheck = await airtable.getRecord(TABLES.DOCUMENTS, reassign_doc_record_id);
      const targetFields = targetCheck.fields as Record<string, unknown>;
      if (targetFields.status === 'Received' && targetFields.onedrive_item_id) {
        const targetPeriod = parseIssuerNamePeriod(targetFields.issuer_name as string || '');
        const newPeriod = (
          contract_period &&
          contract_period.startDate &&
          contract_period.endDate &&
          /^\d{4}-\d{2}-\d{2}$/.test(contract_period.startDate) &&
          /^\d{4}-\d{2}-\d{2}$/.test(contract_period.endDate)
        )
          ? { startDate: contract_period.startDate, endDate: contract_period.endDate }
          : null;
        const overlap = periodsOverlap(targetPeriod, newPeriod);
        if (overlap) {
          return c.json({
            ok: false,
            conflict: true,
            conflict_doc_title: (targetFields.issuer_name as string) || '',
            conflict_existing_name: (targetFields.source_attachment_name as string) || '',
            conflict_new_name: clsFields.attachment_name || '',
            error: 'Target document already has an approved file',
          }, 409);
        }
        // Non-overlapping periods → silently promote to keep_both with the new period.
        force_overwrite = true;
        approve_mode = 'keep_both';
        console.log('[review-classification] DL-415: non-overlapping periods, auto keep_both', {
          target: targetPeriod, new: newPeriod,
        });
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
      const built = buildContractPeriod(start_date, end_date);
      if ('error' in built) {
        return c.json({ ok: false, error: built.error }, 400);
      }
      await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, {
        contract_period: built.json,
      });
      return c.json({ ok: true, action: 'update-contract-period', contract_period: built.contractPeriod });
    }

    // ---- DL-385: Swap T901↔T902 classification — early return ----
    if (action === 'swap-classification') {
      const { target_template_id } = body as { target_template_id?: string };
      if (!target_template_id || !['T901', 'T902'].includes(target_template_id)) {
        return c.json({ ok: false, error: 'target_template_id must be T901 or T902' }, 400);
      }
      await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, {
        matched_template_id: target_template_id,
      });
      logEvent({
        event_type: 'classification_swap',
        category: 'ADMIN',
        source: 'worker',
        endpoint: '/webhook/review-classification',
        details: {
          from: String(clsFields.matched_template_id || ''),
          to: target_template_id,
          classification_id,
          client_id: String(clsFields.client_id || ''),
        },
      });
      return c.json({ ok: true, action: 'swap-classification', matched_template_id: target_template_id });
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

      // Rename file on OneDrive based on classification (DL-355: via resolveOneDriveFilename)
      const origName = (clsFields.attachment_name as string) || 'document.pdf';
      let finalFilename = segment.filename as string;
      let finalWebUrl = segment.web_url as string;
      if (classification?.templateId) {
        const splitTemplateRecords = await getCachedOrFetch(c.env.CACHE_KV, 'cache:templates', 3600,
          () => airtable.listAllRecords(TABLES.TEMPLATES));
        const splitTemplateMap = buildTemplateMap(splitTemplateRecords);
        const expectedName = resolveOneDriveFilename({
          templateId: classification.templateId,
          issuerName: classification.issuerName,
          attachmentName: segment.filename as string,
          templateMap: splitTemplateMap,
        });
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
          // DL-356: centralized Required_Missing invariant clears all file/source/AI/review fields.
          await airtable.updateRecord(
            TABLES.DOCUMENTS,
            sd.id,
            applyMissingStatusInvariant({ status: 'Required_Missing' }) as any,
          );
          clearedDocIds.push(sd.id);
        } catch (err) {
          console.error('[revert_cascade] Failed to clear doc', sd.id, (err as Error).message);
        }
      }

      // Reset classification to pending.
      // DL-391 follow-up: notification_status is a single-select; sending '' tries
      // to create an empty option and 422s on a token without schema-create perms.
      // null clears the field properly.
      await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, {
        review_status: 'pending',
        notification_status: null,
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
        // DL-388: structured code so the client can humanize even if the
        // English message slips past — see formatAIResponseError mapping.
        return c.json({
          ok: false,
          code: 'no_file_to_share',
          error: 'Classification has no file to share',
          message: 'לסיווג זה אין קובץ זמין לשיתוף',
        }, 400);
      }

      const sourceReportId = getField(clsFields.report) as string;
      const sourceReport = sourceReportId ? await airtable.getRecord(TABLES.REPORTS, sourceReportId) : null;
      const sourceClientId = sourceReport ? String(getField((sourceReport.fields as any).client_id) || '') : '';

      // DL-391 follow-up: cache templates for auto-create fallback when a target
      // template's Documents row doesn't exist on the report yet.
      const _alsoMatchTemplateRecords = await getCachedOrFetch(c.env.CACHE_KV, 'cache:templates', 3600,
        () => airtable.listAllRecords(TABLES.TEMPLATES));
      const templateMap = buildTemplateMap(_alsoMatchTemplateRecords);

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
        } else if (t.new_doc_name) {
          // DL-391 follow-up: any picker selection (general_doc OR templated)
          // with new_doc_name means "create a NEW instance, don't match an
          // existing row". Previously only general_doc honored this; templated
          // picks with new_doc_name silently fell through to find-existing and
          // overwrote the first matching type=template_id row.
          const tmpl = t.template_id !== 'general_doc' ? templateMap.get(t.template_id) : null;
          const tmplCategory = tmpl ? ((tmpl as any).category as string) : null;
          const tmplPerson = tmpl ? ((tmpl as any).person as string) : null;
          // DL-412 — honor per-target `person` from picker tab + append spouse suffix.
          const personForDoc = t.person === 'spouse' || t.person === 'client'
            ? t.person
            : (tmplPerson || 'client');
          const spouseName = personForDoc === 'spouse' ? await getSpouseNameForReport(tReportId) : '';
          const finalName = appendSpouseSuffix(t.new_doc_name, personForDoc, spouseName);
          const issuerKey = finalName.toLowerCase().replace(/[^a-zA-Zא-ת0-9\s]/g, '').replace(/\s+/g, '_');
          const docUid = `${tReportId}_${t.template_id.toLowerCase()}_${personForDoc}_${issuerKey}_${Date.now()}`;
          const fields: Record<string, unknown> = {
            type: t.template_id,
            issuer_name: finalName,
            issuer_name_en: finalName,
            issuer_key: finalName,
            person: personForDoc,
            status: 'Required_Missing',
            report: [tReportId],
            document_uid: docUid,
            document_key: docUid,
          };
          if (t.template_id === 'general_doc') fields.category = 'general';
          else if (tmplCategory) fields.category = tmplCategory;
          const created = await airtable.createRecords(TABLES.DOCUMENTS, [{ fields }], { typecast: true });
          targetDocRec = created[0];
          isNewlyCreated = true;
        } else {
          // DL-391 follow-up: ARRAYJOIN({report}) on a linked-record field returns the
          // linked record's primary display value (not its id), so the previous
          // FIND('${tReportId}', ARRAYJOIN({report})) filter never matched. Switch to
          // pulling the report's `documents` link list and matching by template_id in code —
          // same pattern used by Step 5 above.
          const targetReportRec = await airtable.getRecord(TABLES.REPORTS, tReportId);
          const linkedDocIds = ((targetReportRec.fields as any)?.documents as string[]) || [];
          if (linkedDocIds.length > 0) {
            const orFilter = linkedDocIds.map(id => `RECORD_ID()='${id}'`).join(',');
            const linkedDocs = await airtable.listAllRecords(TABLES.DOCUMENTS, {
              filterByFormula: `AND(OR(${orFilter}), {type} = '${t.template_id}')`,
              maxRecords: 1,
            });
            targetDocRec = linkedDocs[0];
          }
        }

        if (!targetDocRec) {
          // DL-391 follow-up: auto-create the target Documents record (templated) when
          // none exists for this report. Mirrors the general_doc branch above. Allows
          // also_match to link the same file to a template even before its Documents
          // row was materialized.
          const tmplRecord = templateMap.get(t.template_id);
          if (tmplRecord) {
            const tmplFields = (tmplRecord as any).fields || tmplRecord || {};
            const issuerName = (tmplFields.name_he as string) || t.template_id;
            const issuerKey = t.template_id.toLowerCase();
            const docUid = `${tReportId}_${t.template_id.toLowerCase()}_client_${issuerKey}_${Date.now()}`;
            // DL-391 follow-up: typecast=true so Airtable coerces unknown
            // category values (single-select options on DOCUMENTS may not
            // perfectly mirror TEMPLATES). Drop fields that would reject
            // outright if the option doesn't exist.
            try {
              const created = await airtable.createRecords(TABLES.DOCUMENTS, [{
                fields: {
                  type: t.template_id,
                  issuer_name: issuerName,
                  issuer_name_en: (tmplFields.name_en as string) || issuerName,
                  issuer_key: issuerKey,
                  person: 'client',
                  status: 'Required_Missing',
                  report: [tReportId],
                  document_uid: docUid,
                  document_key: docUid,
                  // category intentionally omitted on auto-create — DOCUMENTS
                  // single-select doesn't accept arbitrary new values, and the
                  // category isn't required for also-match linking. Existing
                  // categorized docs unaffected.
                },
              }], { typecast: true });
              targetDocRec = created[0];
              isNewlyCreated = true;
            } catch (createErr) {
              console.error('[also_match] auto-create failed:', t.template_id, (createErr as Error).message);
              return c.json({
                ok: false,
                error: `Could not create target doc for ${t.template_id}: ${(createErr as Error).message}`,
              }, 500);
            }
          }
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

      // Step C (DL-394): upload a physical copy per target; each gets its own OneDrive item.
      const now = new Date().toISOString();
      const createdDocIds: string[] = [];
      const msGraph = new MSGraphClient(c.env, c.executionCtx);

      // C1: resolve source file's parent folder (copies land in same OneDrive folder).
      const sourceItem = await msGraph.get(`/drives/${DRIVE_ID}/items/${sharedItemId}?$select=parentReference`);
      const folderId = (sourceItem?.parentReference as any)?.id as string | undefined;
      if (!folderId) {
        return c.json({ ok: false, code: 'no_parent_folder', error: 'Source file has no parent folder' }, 502);
      }

      // C2: download source binary once.
      const sourceBinary = await msGraph.getBinary(`/drives/${DRIVE_ID}/items/${sharedItemId}/content`);

      // C3: upload one copy per target; roll back all on any failure.
      const uploadedItemIds: string[] = [];
      const targetUploads: Array<{ docId: string; newItemId: string; newWebUrl: string }> = [];

      try {
        for (const r of resolvedTargets) {
          // For virtual templates (general_doc, spouse_doc, etc.) not in templateMap,
          // the user's custom issuer_name IS the intended filename — use it as the
          // attachmentName fallback so resolveOneDriveFilename doesn't fall back to
          // the source file's original name (which would cause a same-path PUT that
          // updates the source in-place instead of creating a new copy).
          const isVirtualTemplate = !templateMap.has(r.templateId);
          const targetAttachmentName = isVirtualTemplate
            ? String((r.fields.issuer_name as string | undefined) ?? (clsFields.attachment_name as string | null | undefined) ?? '')
            : (clsFields.attachment_name as string | null | undefined) ?? null;
          let filename = resolveOneDriveFilename({
            templateId: r.templateId,
            issuerName: String((r.fields.issuer_name as string | undefined) ?? ''),
            attachmentName: targetAttachmentName,
            templateMap,
          });
          // Collision guard: if resolved name still matches the source attachment name,
          // append the template_id so the PUT targets a new path rather than the source file.
          const sourceBaseName = String(clsFields.attachment_name ?? '').replace(/\.[^.]+$/, '');
          if (filename.replace(/\.pdf$/i, '') === sourceBaseName) {
            filename = filename.replace(/\.pdf$/i, '') + `_${r.templateId}.pdf`;
          }
          const newItem = await msGraph.putBinary(
            `/drives/${DRIVE_ID}/items/${folderId}:/${encodeURIComponent(filename)}:/content?@microsoft.graph.conflictBehavior=rename`,
            sourceBinary,
          );
          uploadedItemIds.push(newItem.id);
          targetUploads.push({
            docId: r.docId,
            newItemId: String(newItem.id),
            newWebUrl: typeof newItem.webUrl === 'string' ? newItem.webUrl : sharedFileUrl,
          });
        }
      } catch (err) {
        for (const id of uploadedItemIds) {
          try { await msGraph.delete(`/drives/${DRIVE_ID}/items/${id}`); } catch (e) {
            console.error('[also_match rollback] failed to delete', id, (e as Error).message);
          }
        }
        return c.json({ ok: false, code: 'partial_copy_failure', error: `Copy to target failed: ${(err as Error).message}` }, 502);
      }

      // C4: patch each target Documents record with its own file pointer.
      for (const u of targetUploads) {
        const update: Record<string, unknown> = {
          status: 'Received',
          review_status: 'confirmed',
          reviewed_by: 'Natan',
          reviewed_at: now,
          file_url: u.newWebUrl,
          onedrive_item_id: u.newItemId,
          file_hash: sharedFileHash || null,
          ai_confidence: clsFields.ai_confidence ?? null,
          ai_reason: `Multi-match (per-target copy, DL-394) from ${clsFields.matched_template_id || 'classification'}: ${clsFields.ai_reason || ''}`,
          source_attachment_name: clsFields.attachment_name || null,
          source_sender_email: sanitizeEmail(clsFields.sender_email),
          uploaded_at: clsFields.received_at || null,
        };
        await airtable.updateRecord(TABLES.DOCUMENTS, u.docId, stripEmpty(update));
        createdDocIds.push(u.docId);
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
        created_doc_ids: createdDocIds,
        uploaded_item_ids: targetUploads.map(u => u.newItemId),
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

        const mergedBytes = await mergePdfsN([firstPdf, secondPdf]);
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

      // DL-356: centralized Required_Missing invariant — see lib/doc-invariants.ts.
      const rejectFields: Record<string, unknown> = applyMissingStatusInvariant({
        status: 'Required_Missing',
        fix_reason_client: fixReasonClient,
      });
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

      // DL-415: Sync the NEW matched_template_id + contract_period onto in-memory
      // clsFields BEFORE Step 4 target operations so the downstream period-suffix
      // helper (applyPeriodSuffixToDocFields) and the existing OneDrive-rename
      // getRentalPeriodLabel() both see the modal-supplied values. Previously
      // this sync only happened at Step 5 (after target doc was already written),
      // so the documents row never got the period suffix.
      if (reassign_template_id) {
        clsFields.matched_template_id = reassign_template_id;
        if (
          ['T901', 'T902'].includes(reassign_template_id) &&
          contract_period &&
          contract_period.startDate &&
          contract_period.endDate
        ) {
          const builtEarly = buildContractPeriod(contract_period.startDate, contract_period.endDate);
          if ('error' in builtEarly) {
            return c.json({ ok: false, error: builtEarly.error }, 400);
          }
          clsFields.contract_period = builtEarly.json;
        }
      }

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
          // DL-356: centralized Required_Missing invariant — see lib/doc-invariants.ts.
          const clearFields: Record<string, unknown> = applyMissingStatusInvariant({
            status: 'Required_Missing',
          });
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
        // DL-412 — honor `person` from picker tab + append spouse name to issuer fields.
        const personForDoc = bodyPerson === 'spouse' ? 'spouse' : 'client';
        const spouseName = personForDoc === 'spouse' ? await getSpouseNameForReport(reportId) : '';
        const issuerNameWithSpouse = appendSpouseSuffix(new_doc_name, personForDoc, spouseName);
        const issuerKey = issuerNameWithSpouse.toLowerCase().replace(/[^a-zA-Zא-ת0-9\s]/g, '').replace(/\s+/g, '_');
        const docUid = `${reportId}_general_doc_${personForDoc}_${issuerKey}`;
        // DL-415: apply period suffix on T901/T902 (general_doc itself is non-rental, so
        // this is a no-op in practice — guarded for safety).
        const path2Fields = applyPeriodSuffixToDocFields({
          type: 'general_doc',
          issuer_name: issuerNameWithSpouse,
          issuer_name_en: issuerNameWithSpouse,
          issuer_key: issuerNameWithSpouse,
          category: 'general',
          person: personForDoc,
          status: 'Required_Missing',
          report: [reportId],
          document_uid: docUid,
          document_key: docUid,
        }, clsFields);
        const created = await airtable.createRecords(TABLES.DOCUMENTS, [{ fields: path2Fields }]);
        targetDoc = created[0];
      } else {
        // Path 3: Search by template + report
        // DL-415: Prefer Required_Missing placeholders (the user's intent when picking a
        // generic template from the dropdown) over any already-Received row. Falls back to
        // any matching row of that type only if no missing placeholder exists.
        const foundMissing = await airtable.listAllRecords(TABLES.DOCUMENTS, {
          filterByFormula: `AND({type} = '${reassign_template_id}', {status} = 'Required_Missing', FIND('${reportId}', ARRAYJOIN({report})))`,
        });
        if (foundMissing.length > 0) {
          targetDoc = foundMissing[0];
        } else {
          const foundAny = await airtable.listAllRecords(TABLES.DOCUMENTS, {
            filterByFormula: `AND({type} = '${reassign_template_id}', FIND('${reportId}', ARRAYJOIN({report})))`,
            maxRecords: 1,
          });
          targetDoc = foundAny[0];
        }

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
          // DL-350: reject names that still contain {placeholder} tokens —
          // the picker should have filled them, but if a slip-through ever
          // sneaks in we strip them to avoid persisting "*{bank_name}*" etc.
          const stripPlaceholders = (s: string) =>
            s.replace(/\*?\*?\{[a-zA-Z_][a-zA-Z0-9_]*\}\*?\*?/g, '').replace(/\s+/g, ' ').replace(/\s*[–—-]\s*$/, '').trim();
          const candidate = new_doc_name
            || (tplFields.name_he as string)
            || (tplFields.name as string)
            || (tplFields.name_en as string)
            || '';
          const derivedName = stripPlaceholders(candidate);
          if (!derivedName) {
            return c.json({
              ok: false,
              error: 'Cannot create doc: no name supplied and template has no resolved name. Please re-pick the template and fill any required fields.',
            }, 400);
          }
          // DL-412 — picker `person` overrides template default; append spouse suffix.
          const tmplPerson = (tplFields.person as string) || 'client';
          const personForDoc = bodyPerson === 'spouse' || bodyPerson === 'client'
            ? bodyPerson
            : tmplPerson;
          const spouseName = personForDoc === 'spouse' ? await getSpouseNameForReport(reportId) : '';
          const finalName = appendSpouseSuffix(derivedName, personForDoc, spouseName);
          const issuerKey = finalName.toLowerCase().replace(/[^a-zA-Zא-ת0-9\s]/g, '').replace(/\s+/g, '_');
          const docUid = `${reportId}_${reassign_template_id}_${issuerKey}`;
          // DL-415: bake the period into issuer_name + document_key for T901/T902.
          const path3Fields = applyPeriodSuffixToDocFields({
            type: reassign_template_id,
            issuer_name: finalName,
            issuer_name_en: finalName,
            issuer_key: finalName,
            category: (tplFields.category as string) || 'general',
            person: personForDoc,
            status: 'Required_Missing',
            report: [reportId],
            document_uid: docUid,
            document_key: docUid,
          }, clsFields);
          const created = await airtable.createRecords(TABLES.DOCUMENTS, [{ fields: path3Fields }]);
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

        const mergedBytes = await mergePdfsN([firstPdf, secondPdf]);
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

        // DL-415: dedup the "— חלק N" counter on a base WITHOUT the target's embedded
        // <b>MM.YYYY-MM.YYYY</b> period, so non-overlapping siblings count together.
        const keepBothIssuer = targetDocFields_r.issuer_name as string || '';
        const periodStripRegex = / *<b>\d{1,2}\.\d{4}-\d{1,2}\.\d{4}<\/b>/g;
        const titleSansPeriod = keepBothIssuer
          .replace(/ — חלק \d+$/, '')
          .replace(periodStripRegex, '')
          .trim();
        const keepBothIssuerClause = titleSansPeriod
          ? `, FIND('${titleSansPeriod.replace(/'/g, "\\'")}', {issuer_name})`
          : '';
        const existingDocs = await airtable.listAllRecords(TABLES.DOCUMENTS, {
          filterByFormula: `AND({type} = '${templateId}', FIND('${reportId}', ARRAYJOIN({report_record_id}))${keepBothIssuerClause})`,
        });
        const partNumber = existingDocs.length + 1;
        const suffixedTitle = `${titleSansPeriod} — חלק ${partNumber}`;

        // DL-231 + DL-415: Derive document_uid/key from the target's key WITHOUT any prior
        // `_M-M` period segment; applyPeriodSuffixToDocFields below will re-stamp the NEW
        // period (from the modal's contract_period) before insert.
        const origKey_r = (targetDocFields_r.document_uid || targetDocFields_r.document_key || '') as string;
        const keyPeriodStripRegex = /_\d+-\d+(?=(?:_part\d+)?$)/;
        const baseKey_r = origKey_r.replace(keyPeriodStripRegex, '');
        const partSuffix_r = `_part${partNumber}`;
        const docUid_r = baseKey_r ? `${baseKey_r}${partSuffix_r}` : '';

        const newDocFields: Record<string, unknown> = {
          type: templateId,
          issuer_name: suffixedTitle,
          issuer_name_en: suffixedTitle,
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
        // DL-415: stamp the NEW period (from modal-supplied contract_period synced onto
        // clsFields above) into issuer_name + document_key. Inserts <b>MM.YYYY-MM.YYYY</b>
        // immediately before the " — חלק N" suffix and `_M-M` immediately before `_partN`.
        applyPeriodSuffixToDocFields(newDocFields, clsFields);
        const created = await airtable.createRecords(TABLES.DOCUMENTS, [{ fields: stripEmpty(newDocFields) }]);
        targetDoc = created[0];
        docTitle = (newDocFields.issuer_name as string) || suffixedTitle;
        console.log('[review-classification] reassign keep_both: created doc', targetDoc.id, 'as', docTitle);

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
        // DL-415: rewrite issuer_name + document_key with period suffix when target is
        // T901/T902 and modal supplied contract_period. Picks up target's existing
        // issuer_name/document_key so we strip-then-reapply (instead of preserving stale
        // period from a prior assignment).
        const updateFields: Record<string, unknown> = {
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
        };
        const templateForUpdate = (reassign_template_id || (targetDoc.fields as any).type) as string;
        if (['T901', 'T902'].includes(templateForUpdate) && clsFields.contract_period) {
          updateFields.issuer_name = (targetDoc.fields as any).issuer_name as string;
          updateFields.issuer_name_en = (targetDoc.fields as any).issuer_name_en as string
            || (targetDoc.fields as any).issuer_name as string;
          updateFields.document_key = (targetDoc.fields as any).document_key as string;
          updateFields.document_uid = (targetDoc.fields as any).document_uid as string
            || (targetDoc.fields as any).document_key as string;
          applyPeriodSuffixToDocFields(updateFields, clsFields);
        }
        await airtable.updateRecord(TABLES.DOCUMENTS, targetDoc.id, stripEmpty(updateFields));
        docTitle = (updateFields.issuer_name as string) || (targetDoc.fields as any).issuer_name || new_doc_name || '';
      }
    }

    // ---- Step 5: Update classification record ----
    // DL-397: persist matched_template_id on reassign (was previously only updated on local
    // frontend cache, leaving server-side stale → silent 400 from request-remaining-contract).
    // Also accept optional contract_period when target letter ∈ {T901, T902}.
    const step5Fields: Record<string, unknown> = {
      review_status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'reassigned',
      reviewed_at: new Date().toISOString(),
      notes: notes || '',
    };
    if (action === 'reassign' && reassign_template_id) {
      step5Fields.matched_template_id = reassign_template_id;
      // DL-397 fix: sync in-memory clsFields so Step 6 (OneDrive rename via
      // getRentalPeriodLabel → reads clsFields.matched_template_id / contract_period)
      // uses the new values. Without this, manual reassign to T901/T902 produced
      // filenames without the period suffix (`חוזה שכירות (הוצאה).pdf` instead of
      // `חוזה שכירות (הוצאה) 01.2025-09.2025.pdf`).
      clsFields.matched_template_id = reassign_template_id;
      if (
        ['T901', 'T902'].includes(reassign_template_id) &&
        contract_period &&
        contract_period.startDate &&
        contract_period.endDate
      ) {
        const built = buildContractPeriod(contract_period.startDate, contract_period.endDate);
        if ('error' in built) {
          return c.json({ ok: false, error: built.error }, 400);
        }
        step5Fields.contract_period = built.json;
        clsFields.contract_period = built.json;
      }
    }
    await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${TABLES.CLASSIFICATIONS}/${classification_id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: step5Fields }),
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
          // DL-355: ALWAYS rename via resolveOneDriveFilename (canonical short_name_he).
          // Previously skipped for exact/single match — that left files with their
          // original attachment_name. Now every approve normalizes the filename.
          const _approveTemplateId = clsFields.matched_template_id as string;
          // DL-376: prefer the source doc's rich issuer_name (HTML with <b>company</b>
          // tags) so resolveOneDriveFilename can substitute the {issuer} placeholder.
          // matched_doc_name is the plain template-title label (e.g. "טופס 867") and
          // would be detected as a template-title echo, stripping the issuer entirely.
          const _approveDocName =
            ((sourceDoc?.fields as any)?.issuer_name as string) ||
            (clsFields.issuer_name as string) ||
            (clsFields.matched_doc_name as string) ||
            '';
          const _approvePeriod = getRentalPeriodLabel();
          newFilename = resolveOneDriveFilename({
            templateId: _approveTemplateId,
            issuerName: _approveDocName,
            attachmentName: clsFields.attachment_name as string,
            templateMap,
            suffix: _approvePeriod?.filename ?? null,
          });
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
            const periodForReassign = getRentalPeriodLabel();
            // DL-355: route through canonical resolveOneDriveFilename
            newFilename = resolveOneDriveFilename({
              templateId: targetTemplateId,
              issuerName: targetIssuer,
              attachmentName: clsFields.attachment_name as string,
              templateMap,
              suffix: periodForReassign?.filename ?? null,
            });

            // DL-415: refresh classifications.expected_filename so the AI-review tab
            // shows the correct target name after a template change (e.g. T501 → T902
            // used to stay as the old broker-cert filename). Non-fatal on failure.
            if (newFilename) {
              try {
                await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, {
                  expected_filename: newFilename,
                });
              } catch (efErr) {
                console.error('[review-classification] DL-415: classifications.expected_filename PATCH failed:', (efErr as Error).message);
              }
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
              // DL-407: split into two try blocks so a future field-shape error
              // in the Airtable PATCH (Step 5) cannot abandon the OneDrive move
              // result. Previous shape silently swallowed `matched_doc_name` 422s
              // and left the Documents row with a stale file_url, so the admin
              // UI re-rendered the doc as "pending" after AI-review approve.
              let moveResult: { webUrl?: string; id?: string } | null = null;
              try {
                moveResult = await msGraph.patch(
                  `/drives/${DRIVE_ID}/items/${itemId}?@microsoft.graph.conflictBehavior=rename`,
                  patchBody
                );
              } catch (moveErr) {
                console.error('[review-classification] OneDrive move failed:', (moveErr as Error).message);
              }

              // 5. Update Airtable doc record with new file URL + issuer info (skip for reject — doc fields already cleared)
              // DL-355: propagate issuer_name + expected_filename so the Documents row
              // carries the same identity as the OneDrive file.
              if (moveResult?.webUrl && action !== 'reject') {
                const updateDocId = action === 'reassign' && targetDoc ? targetDoc.id : (approveDocId || docId);
                if (updateDocId) {
                  const docPatch: Record<string, unknown> = {
                    file_url: moveResult.webUrl,
                    onedrive_item_id: moveResult.id || itemId,
                  };
                  const clsIssuer = (clsFields.issuer_name as string) || '';
                  if (clsIssuer && action !== 'reassign') docPatch.issuer_name = clsIssuer;
                  if (newFilename) docPatch.expected_filename = newFilename;
                  try {
                    await airtable.updateRecord(TABLES.DOCUMENTS, updateDocId, docPatch);
                  } catch (patchErr) {
                    console.error('[review-classification] documents PATCH failed:', (patchErr as Error).message);
                    logError(c.executionCtx, c.env, {
                      endpoint: '/webhook/review-classification',
                      category: 'DEPENDENCY',
                      error: patchErr as Error,
                      details: `documents PATCH failed for ${updateDocId} (keys: ${Object.keys(docPatch).join(',')})`,
                    });
                  }
                }
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
    // DL-254: Invalidate documents cache after approve/reject/reassign changes doc status.
    // DL-391 follow-up: also bust the pending-classifications response cache —
    // also_match auto-create writes new DOCUMENTS rows that the silent
    // loadAIClassifications refetch wouldn't see otherwise. Mirrors lines 2540
    // and 2691 (move-classification-client + dismiss-classifications paths).
    invalidateCache(
      c.env.CACHE_KV,
      'cache:documents_non_waived_v2',
      'pending-classifications:annual_report',
      'pending-classifications:capital_statements',
      'pending-classifications:all',
    );

    // DL-365 Phase 2: emit ADMIN review action event (doc_approve / doc_reject / doc_reassign).
    const reviewClientId = (Array.isArray(clsFields.client_id) ? clsFields.client_id[0] : clsFields.client_id) as string | undefined;
    logEvent({
      event_type: action === 'approve' ? 'doc_approve' : action === 'reject' ? 'doc_reject' : 'doc_reassign',
      category: 'ADMIN',
      source: 'admin-ui',
      request_id: c.get('request_id' as never) as string | undefined,
      actor: 'admin',
      actor_ip: getClientIp(c.req.raw.headers),
      client_id: reviewClientId,
      endpoint: '/webhook/review-classification',
      details: {
        classification_id,
        action,
        doc_id: approveDocId || docId || targetDoc?.id || '',
        report_record_id: reportId,
      },
    });

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

// =====================================================================
// DL-369: POST /webhook/move-classification-client
// =====================================================================
// Move one current AI Review classification/file to another client, then
// reclassify it against the target client's required documents.
classifications.post('/move-classification-client', async (c) => {
  const env = c.env;
  const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);
  const clientIp = getClientIp(c.req.raw.headers);

  let body: { token?: string; classification_id?: string; target_client_id?: string };
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'Invalid JSON' }, 400); }

  const authHeader = c.req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const tokenResult = await verifyToken(body.token || bearer || '', env.SECRET_KEY);
  if (!tokenResult.valid) {
    logSecurity(c.executionCtx, c.env, airtable, {
      timestamp: new Date().toISOString(),
      event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      severity: 'WARNING',
      actor: 'admin-token',
      actor_ip: clientIp,
      endpoint: '/webhook/move-classification-client',
      http_status: 401,
      error_message: tokenResult.reason || '',
    });
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const { classification_id, target_client_id } = body;
  if (!classification_id) return c.json({ ok: false, error: 'Missing classification_id' }, 400);
  if (!target_client_id) return c.json({ ok: false, error: 'Missing target_client_id' }, 400);

  try {
    const cls = await airtable.getRecord(TABLES.CLASSIFICATIONS, classification_id);
    const clsFields = cls.fields as Record<string, any>;
    const oldItemId = clsFields.onedrive_item_id as string;
    if (!oldItemId) {
      return c.json({ ok: false, code: 'missing_onedrive_item', error: 'Classification has no OneDrive item to move' }, 400);
    }

    const sourceClientId = (getField(clsFields.client_id) as string) || '';
    const sourceClientName = (getField(clsFields.client_name) as string) || '';
    if (sourceClientId && sourceClientId === target_client_id) {
      return c.json({ ok: false, code: 'same_client', error: 'Target client is the same as source client' }, 400);
    }

    const sourceReportId = getField(clsFields.report) as string;
    let sourceFilingType = (clsFields.filing_type as string) || '';
    if (!sourceFilingType && sourceReportId) {
      try {
        const sourceReport = await airtable.getRecord(TABLES.REPORTS, sourceReportId);
        sourceFilingType = ((sourceReport.fields as any).filing_type as string) || 'annual_report';
      } catch {
        sourceFilingType = 'annual_report';
      }
    }
    sourceFilingType = sourceFilingType || 'annual_report';

    let clientRec: { id: string; fields: { name?: string; client_id?: string } } | null = null;
    if (target_client_id.startsWith('rec')) {
      clientRec = await airtable.getRecord<{ name?: string; client_id?: string }>(TABLES.CLIENTS, target_client_id);
    } else {
      const lookups = await airtable.listAllRecords<{ name?: string; client_id?: string }>(TABLES.CLIENTS, {
        filterByFormula: `{client_id} = '${escapeAirtableValue(target_client_id)}'`,
        fields: ['name', 'client_id'],
        maxRecords: 1,
      });
      clientRec = lookups[0] || null;
    }
    if (!clientRec) {
      return c.json({ ok: false, code: 'target_client_not_found', error: 'Target client not found' }, 404);
    }

    const targetClientName = clientRec.fields.name || '';
    const targetClientCpaId = clientRec.fields.client_id || '';
    if (!targetClientName || !targetClientCpaId) {
      return c.json({ ok: false, code: 'target_client_invalid', error: 'Target client is missing name or client_id' }, 400);
    }
    if (sourceClientId && sourceClientId === targetClientCpaId) {
      return c.json({ ok: false, code: 'same_client', error: 'Target client is the same as source client' }, 400);
    }

    const targetReports = await airtable.listAllRecords(TABLES.REPORTS, {
      filterByFormula: `AND({client_id} = '${escapeAirtableValue(targetClientCpaId)}', OR({stage} = 'Send_Questionnaire', {stage} = 'Waiting_For_Answers', {stage} = 'Pending_Approval', {stage} = 'Collecting_Docs', {stage} = 'Review'))`,
      fields: ['report_key', 'year', 'stage', 'client_name', 'filing_type'],
    });
    const sameTypeReports = targetReports.filter((r) => (((r.fields as any).filing_type as string) || 'annual_report') === sourceFilingType);
    if (sameTypeReports.length === 0) {
      return c.json({ ok: false, code: 'target_report_not_found', error: 'Target client has no active report for this filing type' }, 400);
    }
    sameTypeReports.sort((a, b) => Number((b.fields as any).year || 0) - Number((a.fields as any).year || 0));
    const topYear = Number((sameTypeReports[0].fields as any).year || 0);
    const topReports = sameTypeReports.filter((r) => Number((r.fields as any).year || 0) === topYear);
    if (topReports.length > 1) {
      return c.json({ ok: false, code: 'ambiguous_target_report', error: 'Target client has multiple active reports for the same filing type and year' }, 409);
    }

    const targetReport = topReports[0];
    const targetReportId = targetReport.id;
    const targetReportKey = ((targetReport.fields as any).report_key as string) || '';
    const targetYear = String((targetReport.fields as any).year ?? new Date().getFullYear());
    const targetDocsFormula = targetReportKey
      ? `AND({report_key_lookup} = '${escapeAirtableValue(targetReportKey)}', {status} = 'Required_Missing')`
      : `AND(FIND('${escapeAirtableValue(targetReportId)}', ARRAYJOIN({report})), {status} = 'Required_Missing')`;
    const requiredDocs = await airtable.listAllRecords(TABLES.DOCUMENTS, {
      filterByFormula: targetDocsFormula,
      fields: ['type', 'issuer_name', 'issuer_key', 'person', 'status', 'report_key_lookup', 'expected_filename', 'category', 'onedrive_item_id'],
    });

    const msGraph = new MSGraphClient(env, c.executionCtx);
    const oneDriveRoot = await resolveOneDriveRoot(msGraph);
    const fileBytes = await msGraph.getBinary(`/drives/${oneDriveRoot.driveId}/items/${oldItemId}/content`);
    if (!fileBytes || fileBytes.byteLength === 0) {
      return c.json({ ok: false, code: 'missing_onedrive_item', error: 'Could not download source OneDrive file' }, 404);
    }

    const templateRecords = await getCachedOrFetch(env.CACHE_KV, 'cache:templates', 3600,
      () => airtable.listAllRecords(TABLES.TEMPLATES));
    const templateMap = buildTemplateMap(templateRecords);
    const attachmentName = (clsFields.attachment_name as string) || (clsFields.expected_filename as string) || 'document.pdf';
    const contentType = (clsFields.attachment_content_type as string) || 'application/octet-stream';
    const fileHash = (clsFields.file_hash as string) || await computeSha256(fileBytes);
    const attachment: AttachmentInfo = {
      id: oldItemId,
      name: attachmentName,
      contentType,
      size: (clsFields.attachment_size as number) || fileBytes.byteLength,
      content: fileBytes,
      sha256: fileHash,
    };

    const pCtx: ProcessingContext = {
      env,
      ctx: c.executionCtx,
      graph: msGraph,
      airtable,
      messageId: `move-client-${classification_id}`,
      templateMap,
    };

    let classification: ClassificationResult | null = null;
    try {
      classification = await classifyAttachment(pCtx, attachment, requiredDocs as any, targetClientName, {
        subject: (clsFields.email_subject as string) || '',
        bodyPreview: (clsFields.email_body_text as string) || '',
        senderName: (clsFields.sender_name as string) || '',
        senderEmail: (clsFields.sender_email as string) || '',
        fallbackMode: requiredDocs.length === 0,
        filingType: sourceFilingType,
      });
    } catch (e) {
      console.warn('[move-classification-client] classify failed', classification_id, (e as Error).message);
    }

    let targetDoc: { id: string; fields: Record<string, any> } | null = null;
    let targetDocConflict = false;
    if (classification?.matchedDocRecordId) {
      const fetched = await airtable.getRecord(TABLES.DOCUMENTS, classification.matchedDocRecordId) as { id: string; fields: Record<string, any> };
      const tf = fetched.fields || {};
      if (tf.status === 'Received' && tf.onedrive_item_id) {
        // DL-370: target slot already has a received file. Skip patching it,
        // upload the moved file anyway, and leave the classification pending
        // for office to resolve manually.
        targetDocConflict = true;
        targetDoc = null;
      } else {
        targetDoc = fetched;
      }
    }

    const finalName = classification?.templateId
      ? resolveOneDriveFilename({ templateId: classification.templateId, issuerName: classification.issuerName, attachmentName, templateMap })
      : attachmentName;

    let upload: { itemId: string; webUrl: string };
    try {
      upload = await uploadToOneDrive(msGraph, oneDriveRoot, targetClientName, targetYear, finalName, fileBytes, sourceFilingType);
    } catch (e) {
      console.error('[move-classification-client] target upload failed', classification_id, (e as Error).message);
      return c.json({ ok: false, code: 'file_move_failed', error: 'Failed to upload file to target client folder' }, 502);
    }

    const sourceDocId = getField(clsFields.document) as string;
    if (sourceDocId) {
      try {
        const sourceDoc = await airtable.getRecord(TABLES.DOCUMENTS, sourceDocId);
        const sourceDocFields = sourceDoc.fields as any;
        const sourceDocItemId = sourceDocFields.onedrive_item_id as string;
        const sourceDocStatus = sourceDocFields.status as string;
        if (sourceDocStatus === 'Required_Missing') {
          console.log('[move-classification-client] skip source clear: already Required_Missing', sourceDocId);
        } else if (!sourceDocItemId || sourceDocItemId === oldItemId) {
          await airtable.updateRecord(TABLES.DOCUMENTS, sourceDocId, applyMissingStatusInvariant({ status: 'Required_Missing' }));
        } else {
          console.log('[move-classification-client] skip source clear: document now references a different file', JSON.stringify({ sourceDocId, sourceDocItemId, oldItemId }));
        }
      } catch (e) {
        console.error('[move-classification-client] source clear failed', sourceDocId, (e as Error).message);
        return c.json({ ok: false, code: 'source_clear_failed', error: 'Moved file to target folder but failed to clear source document' }, 500);
      }
    }

    if (targetDoc) {
      await airtable.updateRecord(TABLES.DOCUMENTS, targetDoc.id, {
        status: 'Received',
        review_status: 'confirmed',
        reviewed_by: 'Natan',
        reviewed_at: new Date().toISOString(),
        file_url: upload.webUrl,
        onedrive_item_id: upload.itemId,
        file_hash: fileHash,
        ai_confidence: classification?.confidence ?? 0,
        ai_reason: `Moved from ${sourceClientName || sourceClientId}: ${classification?.reason || ''}`,
        source_attachment_name: attachmentName,
        source_sender_email: clsFields.sender_email || null,
        uploaded_at: clsFields.received_at || new Date().toISOString(),
        expected_filename: finalName,
        matched_doc_name: classification?.matchedDocName || null,
      });
    }

    await airtable.updateRecord(TABLES.CLASSIFICATIONS, classification_id, {
      report: [targetReportId],
      client_name: targetClientName,
      client_id: targetClientCpaId,
      year: parseInt(targetYear, 10),
      file_url: upload.webUrl,
      onedrive_item_id: upload.itemId,
      expected_filename: finalName,
      matched_template_id: classification?.templateId ?? null,
      ai_confidence: classification?.confidence ?? 0,
      ai_reason: classification?.reason ?? 'moved to another client by office',
      issuer_name: classification?.issuerName ?? '',
      issuer_match_quality: classification?.matchQuality ?? null,
      matched_doc_name: classification?.matchedDocName ?? null,
      document: classification?.matchedDocRecordId && !targetDocConflict ? [classification.matchedDocRecordId] : [],
      review_status: 'pending',
      reviewed_at: new Date().toISOString(),
      notes: `Moved from ${sourceClientName || sourceClientId || 'source client'} to ${targetClientName}`,
    });

    try {
      await msGraph.delete(`/drives/${oneDriveRoot.driveId}/items/${oldItemId}`);
    } catch (e) {
      console.warn('[move-classification-client] old OneDrive delete failed', oldItemId, (e as Error).message);
    }

    if (sourceReportId) await checkAutoAdvanceToReview(airtable, sourceReportId);
    await checkAutoAdvanceToReview(airtable, targetReportId);
    invalidateCache(env.CACHE_KV, 'cache:documents_non_waived_v2', 'pending-classifications:annual_report', 'pending-classifications:capital_statements', 'pending-classifications:all');

    logSecurity(c.executionCtx, c.env, airtable, {
      timestamp: new Date().toISOString(),
      event_type: 'CLASSIFICATION_MOVED_CLIENT',
      severity: 'INFO',
      actor: 'admin-token',
      actor_ip: clientIp,
      endpoint: '/webhook/move-classification-client',
      http_status: 200,
      details: JSON.stringify({ classification_id, source_client_id: sourceClientId, target_client_id: targetClientCpaId }),
    });

    return c.json({
      ok: true,
      classification_id,
      source_client_name: sourceClientName,
      target_client_name: targetClientName,
      target_report_id: targetReportId,
      target_document_id: classification?.matchedDocRecordId || '',
      doc_title: classification?.matchedDocName || classification?.issuerName || finalName,
      file_url: upload.webUrl,
      target_doc_conflict: targetDocConflict,
      target_matched: Boolean(classification?.matchedDocRecordId) && !targetDocConflict,
    });
  } catch (err) {
    console.error('[move-classification-client] fatal', (err as Error).message);
    logSecurity(c.executionCtx, c.env, airtable, {
      timestamp: new Date().toISOString(),
      event_type: 'API_ERROR',
      severity: 'ERROR',
      actor: 'admin-token',
      actor_ip: clientIp,
      endpoint: '/webhook/move-classification-client',
      http_status: 500,
      error_message: (err as Error).message,
    });
    return c.json({ ok: false, error: 'Move failed', details: (err as Error).message }, 500);
  }
});

// =====================================================================
// DL-421: POST /webhook/bulk-move-classification-client
// =====================================================================
// Bulk version of /move-classification-client. Moves up to 20 AI Review
// classification rows (and their OneDrive files) to a different client.
// Each item is processed sequentially. Partial success is returned with
// a list of failures.
classifications.post('/bulk-move-classification-client', async (c) => {
  const env = c.env;
  const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);
  const clientIp = getClientIp(c.req.raw.headers);

  let body: { token?: string; source_client_id?: string; target_client_id?: string; classification_ids?: string[] };
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'Invalid JSON' }, 400); }

  const authHeader = c.req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const tokenResult = await verifyToken(body.token || bearer || '', env.SECRET_KEY);
  if (!tokenResult.valid) {
    logSecurity(c.executionCtx, c.env, airtable, {
      timestamp: new Date().toISOString(),
      event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      severity: 'WARNING',
      actor: 'admin-token',
      actor_ip: clientIp,
      endpoint: '/webhook/bulk-move-classification-client',
      http_status: 401,
      error_message: tokenResult.reason || '',
    });
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const { source_client_id, target_client_id, classification_ids } = body;
  if (!source_client_id) return c.json({ ok: false, error: 'Missing source_client_id' }, 400);
  if (!target_client_id) return c.json({ ok: false, error: 'Missing target_client_id' }, 400);
  if (!Array.isArray(classification_ids) || classification_ids.length < 1 || classification_ids.length > 20) {
    return c.json({ ok: false, error: 'classification_ids must be an array of 1..20 ids' }, 400);
  }
  if (source_client_id === target_client_id) {
    return c.json({ ok: false, error: 'source_client_id and target_client_id must differ' }, 400);
  }

  try {
    // Step 1: validate all classification rows exist and belong to source_client_id
    const clsRowsToMove: Array<{ id: string; fields: Record<string, unknown> }> = [];
    for (const cid of classification_ids) {
      let rec: { id: string; fields: Record<string, unknown> };
      try {
        rec = await airtable.getRecord(TABLES.CLASSIFICATIONS, cid) as { id: string; fields: Record<string, unknown> };
      } catch {
        return c.json({ ok: false, error: 'cross_client_or_missing' }, 400);
      }
      const recClientId = getField((rec.fields as Record<string, unknown>).client_id) as string;
      if (recClientId !== source_client_id) {
        return c.json({ ok: false, error: 'cross_client_or_missing' }, 400);
      }
      clsRowsToMove.push(rec);
    }

    // Step 2: resolve target client and their OneDrive folder
    let targetClientRec: { id: string; fields: { name?: string; client_id?: string } } | null = null;
    if (target_client_id.startsWith('rec')) {
      targetClientRec = await airtable.getRecord<{ name?: string; client_id?: string }>(TABLES.CLIENTS, target_client_id);
    } else {
      const lookups = await airtable.listAllRecords<{ name?: string; client_id?: string }>(TABLES.CLIENTS, {
        filterByFormula: `{client_id} = '${escapeAirtableValue(target_client_id)}'`,
        fields: ['name', 'client_id'],
        maxRecords: 1,
      });
      targetClientRec = lookups[0] || null;
    }
    if (!targetClientRec) {
      return c.json({ ok: false, code: 'target_client_not_found', error: 'Target client not found' }, 404);
    }
    const targetClientName = targetClientRec.fields.name || '';
    const targetClientCpaId = targetClientRec.fields.client_id || '';
    if (!targetClientName || !targetClientCpaId) {
      return c.json({ ok: false, code: 'target_client_invalid', error: 'Target client missing name or client_id' }, 400);
    }

    const msGraph = new MSGraphClient(env, c.executionCtx);
    const oneDriveRoot = await resolveOneDriveRoot(msGraph);

    // Step 3: iterate sequentially — move each file, patch each classification
    let movedCount = 0;
    const failures: Array<{ classification_id: string; reason: string }> = [];

    for (const rec of clsRowsToMove) {
      const f = rec.fields as Record<string, unknown>;
      const oldItemId = f.onedrive_item_id as string;
      const filingType = (f.filing_type as string) || 'annual_report';
      const attachmentName = (f.attachment_name as string) || (f.expected_filename as string) || 'document.pdf';
      const year = String((f.year as number) || new Date().getFullYear());

      if (!oldItemId) {
        failures.push({ classification_id: rec.id, reason: 'missing_onedrive_item' });
        continue;
      }

      try {
        // Download source file
        const fileBytes = await msGraph.getBinary(`/drives/${oneDriveRoot.driveId}/items/${oldItemId}/content`);
        if (!fileBytes || fileBytes.byteLength === 0) {
          failures.push({ classification_id: rec.id, reason: 'source_file_empty' });
          continue;
        }

        // Upload to target client folder (always download→re-upload→delete for safety)
        let upload: { itemId: string; webUrl: string };
        try {
          upload = await uploadToOneDrive(msGraph, oneDriveRoot, targetClientName, year, attachmentName, fileBytes, filingType);
        } catch (uploadErr) {
          failures.push({ classification_id: rec.id, reason: `upload_failed: ${(uploadErr as Error).message}` });
          continue;
        }

        // Delete source file (non-fatal)
        try {
          await msGraph.delete(`/drives/${oneDriveRoot.driveId}/items/${oldItemId}`);
        } catch (delErr) {
          console.warn('[bulk-move-classification-client] old file delete failed', rec.id, (delErr as Error).message);
        }

        // Patch classification row with new client info
        await airtable.updateRecord(TABLES.CLASSIFICATIONS, rec.id, {
          client_id: targetClientCpaId,
          client_name: targetClientName,
          onedrive_item_id: upload.itemId,
          file_url: upload.webUrl,
          review_status: 'pending',
        });

        movedCount++;
      } catch (itemErr) {
        console.error('[bulk-move-classification-client] item failed', rec.id, (itemErr as Error).message);
        failures.push({ classification_id: rec.id, reason: (itemErr as Error).message });
      }
    }

    // Step 4: log (PII-safe — IDs and counts only)
    logEvent({
      event_type: 'bulk_move_client',
      category: 'ADMIN',
      source: 'admin-ui',
      details: {
        source_client_id,
        target_client_id: targetClientCpaId,
        count: classification_ids.length,
        moved: movedCount,
        failed: failures.length,
      },
    });

    invalidateCache(
      env.CACHE_KV,
      'pending-classifications:annual_report',
      'pending-classifications:capital_statements',
      'pending-classifications:all',
    );

    logSecurity(c.executionCtx, c.env, airtable, {
      timestamp: new Date().toISOString(),
      event_type: 'CLASSIFICATION_BULK_MOVED_CLIENT',
      severity: 'INFO',
      actor: 'admin-token',
      actor_ip: clientIp,
      endpoint: '/webhook/bulk-move-classification-client',
      http_status: 200,
      details: JSON.stringify({ source_client_id, target_client_id: targetClientCpaId, moved: movedCount, failed: failures.length }),
    });

    return c.json({ ok: true, moved: movedCount, failed: failures });
  } catch (err) {
    console.error('[bulk-move-classification-client] fatal', (err as Error).message);
    logSecurity(c.executionCtx, c.env, airtable, {
      timestamp: new Date().toISOString(),
      event_type: 'API_ERROR',
      severity: 'ERROR',
      actor: 'admin-token',
      actor_ip: clientIp,
      endpoint: '/webhook/bulk-move-classification-client',
      http_status: 500,
      error_message: (err as Error).message,
    });
    return c.json({ ok: false, error: 'Bulk move failed', details: (err as Error).message }, 500);
  }
});

// =====================================================================
// DL-421: POST /webhook/bulk-merge-classifications
// =====================================================================
// Merge N AI Review classification rows (and their OneDrive PDFs) into a
// single merged document. Extracted from /review-classification where it
// was dead code (blocked by pre-existing gates at L786 + L790).
// Body: { token?, client_id, target_template_id, ordered_classification_ids: string[] }
// =====================================================================
classifications.post('/bulk-merge-classifications', async (c) => {
  const env = c.env;
  const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);

  let body: {
    token?: string;
    action?: string;
    client_id?: string;
    target_template_id?: string;
    new_doc_name?: string;
    target_doc_record_id?: string;
    ordered_classification_ids?: string[];
  };
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'Invalid JSON' }, 400); }

  const authHeader = c.req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const tokenResult = await verifyToken(body.token || bearer || '', env.SECRET_KEY);
  if (!tokenResult.valid) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  // ---- Validate body ----
  const { client_id: bulkClientId, target_template_id: bulkTemplateId, new_doc_name: bulkNewDocName, target_doc_record_id: bulkTargetDocId, ordered_classification_ids: orderedIds } = body;

  if (!bulkClientId || typeof bulkClientId !== 'string') {
    return c.json({ ok: false, error: 'invalid_request', detail: 'client_id required' }, 400);
  }
  if (!bulkTemplateId || typeof bulkTemplateId !== 'string') {
    return c.json({ ok: false, error: 'invalid_request', detail: 'target_template_id required' }, 400);
  }
  if (bulkTemplateId === 'general_doc' && (!bulkNewDocName || typeof bulkNewDocName !== 'string' || !bulkNewDocName.trim())) {
    return c.json({ ok: false, error: 'invalid_request', detail: 'new_doc_name required when target_template_id is general_doc' }, 400);
  }
  if (!Array.isArray(orderedIds) || orderedIds.length < 1 || orderedIds.length > 20) {
    return c.json({ ok: false, error: 'invalid_request', detail: 'ordered_classification_ids must be an array of 1..20 ids' }, 400);
  }

  try {
    // ---- Step 1: validate all classification rows exist and belong to the given client ----
    const clsRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
    for (const cid of orderedIds) {
      let rec: { id: string; fields: Record<string, unknown> };
      try {
        rec = await airtable.getRecord(TABLES.CLASSIFICATIONS, cid) as { id: string; fields: Record<string, unknown> };
      } catch {
        return c.json({ ok: false, error: 'cross_client_or_missing' }, 400);
      }
      const recClientId = getField((rec.fields as Record<string, unknown>).client_id) as string;
      if (recClientId !== bulkClientId) {
        return c.json({ ok: false, error: 'cross_client_or_missing' }, 400);
      }
      clsRecords.push(rec);
    }

    // ---- Step 2: fetch each PDF from OneDrive in declared order ----
    const msGraphBulk = new MSGraphClient(env, c.executionCtx);
    const pdfBuffers: ArrayBuffer[] = [];
    for (const rec of clsRecords) {
      const itemId = (rec.fields as Record<string, unknown>).onedrive_item_id as string;
      if (!itemId) {
        return c.json({ ok: false, error: `Classification ${rec.id} has no onedrive_item_id` }, 400);
      }
      const buf = await msGraphBulk.getBinary(`/drives/${DRIVE_ID}/items/${itemId}/content`);
      pdfBuffers.push(buf);
    }

    // ---- Step 3: resolve target doc ----
    // Priority: (a) explicit target_doc_record_id from the picker (admin chose
    // an existing chip — that exact doc is the target); (b) general_doc OR
    // new_doc_name (always create a fresh row); (c) look up the latest Received
    // doc of this template on the report (silent-append path).
    // DL-404 typecast gate: do NOT reference merged_into in filterByFormula AND
    // do not include typecast-created fields in `fields:[]`.
    // Filter by report_record_id (the documents→reports link).
    const lookupReportId = getField((clsRecords[0].fields as Record<string, unknown>).report) as string;
    let existingReceivedDoc: { id: string; fields: Record<string, unknown> } | null = null;
    if (bulkTargetDocId) {
      try {
        existingReceivedDoc = await airtable.getRecord(TABLES.DOCUMENTS, bulkTargetDocId) as { id: string; fields: Record<string, unknown> };
      } catch {
        return c.json({ ok: false, error: 'target_doc_not_found' }, 400);
      }
    } else if (!(bulkTemplateId === 'general_doc' || !!bulkNewDocName || !lookupReportId)) {
      const found = await airtable.listAllRecords(TABLES.DOCUMENTS, {
        filterByFormula: `AND({type} = '${escapeAirtableValue(bulkTemplateId)}', FIND('${escapeAirtableValue(lookupReportId)}', ARRAYJOIN({report_record_id})), {status} = 'Received')`,
        maxRecords: 1,
      });
      existingReceivedDoc = found.length > 0 ? (found[0] as { id: string; fields: Record<string, unknown> }) : null;
    }

    let bulkDocId: string;
    let finalMergedBytes: Uint8Array;
    let existingDocItemId: string | null = null;
    let isAppendMode = false;
    if (existingReceivedDoc) {
      const ef = existingReceivedDoc.fields as Record<string, unknown>;
      existingDocItemId = ef.onedrive_item_id as string | null;
      if (existingDocItemId && ef.file_url) {
        isAppendMode = true;
        bulkDocId = existingReceivedDoc.id;
        // Download existing doc and prepend it
        const existingBuf = await msGraphBulk.getBinary(`/drives/${DRIVE_ID}/items/${existingDocItemId}/content`);
        finalMergedBytes = await mergePdfsN([existingBuf, ...pdfBuffers]);
      } else {
        // Existing doc row but no file — treat as create
        bulkDocId = existingReceivedDoc.id;
        isAppendMode = false;
        finalMergedBytes = await mergePdfsN(pdfBuffers);
      }
    } else {
      // Will create a new doc row below after upload
      bulkDocId = '';
      finalMergedBytes = await mergePdfsN(pdfBuffers);
    }

    const mergedBuf = finalMergedBytes.buffer as ArrayBuffer;
    const mergedHash = await computeSha256(mergedBuf);
    const mergedSize = mergedBuf.byteLength;

    // ---- Step 4: compute page count — sum from classification records ----
    let mergedPageCount = 0;
    for (const rec of clsRecords) {
      mergedPageCount += Number((rec.fields as Record<string, unknown>).page_count || 0);
    }
    if (isAppendMode) {
      const ef = (existingReceivedDoc as { id: string; fields: Record<string, unknown> }).fields;
      mergedPageCount += Number(ef.page_count || 0);
    }

    // ---- Step 5: upload merged PDF to OneDrive ----
    const LARGE_THRESHOLD = 25 * 1024 * 1024;
    let mergedWebUrl: string;
    let mergedItemId: string;

    if (isAppendMode && existingDocItemId) {
      // Re-upload over the same item (preserves URL)
      if (mergedSize > LARGE_THRESHOLD) {
        const uploadPath = `/drives/${DRIVE_ID}/items/${existingDocItemId}/content`;
        const uploadResult = await msGraphBulk.putBinary(uploadPath, mergedBuf);
        mergedWebUrl = uploadResult.webUrl || '';
        mergedItemId = uploadResult.id || existingDocItemId;
      } else {
        const uploadResult = await msGraphBulk.putBinary(
          `/drives/${DRIVE_ID}/items/${existingDocItemId}/content`,
          mergedBuf,
        );
        mergedWebUrl = uploadResult.webUrl || '';
        mergedItemId = uploadResult.id || existingDocItemId;
      }
    } else {
      // New upload — use uploadToOneDrive which handles large files via createUploadSession
      const oneDriveRootBulk = await resolveOneDriveRoot(msGraphBulk);
      const firstCls = clsRecords[0].fields as Record<string, unknown>;
      const clientNameBulk = (getField(firstCls.client_name) as string) || bulkClientId;
      const yearBulk = String((firstCls.year as number) || new Date().getFullYear());
      const filingTypeBulk = (firstCls.filing_type as string) || 'annual_report';
      // DL-355 canonical filename — same helper single-approve/reassign use, so
      // bulk-merge files look identical to office.
      // buildShortName expects issuerName to be EITHER the existing doc's
      // issuer_name (with <b>…</b> tags around var values) OR the bare var value
      // (e.g. "לקוח"). It does NOT expect the already-substituted full display
      // name — that would double-substitute into the template's "… – {issuer}"
      // pattern (e.g. "ניכוי בט"ל – ניכוי בט"ל – לקוח").
      // Resolution:
      //   chip-pick   → use existing doc's issuer_name (has <b>) if present.
      //   create-new  → pass empty so buildShortName uses the template title only;
      //                 the typed name lands as issuer_name on the row but is not
      //                 baked into the filename.
      const bulkTemplateRecs = await airtable.listAllRecords(TABLES.TEMPLATES);
      const bulkTemplateMap = buildTemplateMap(bulkTemplateRecs);
      const existingIssuerForFilename =
        (existingReceivedDoc?.fields.issuer_name as string) || '';
      const mergedFilename = resolveOneDriveFilename({
        templateId: bulkTemplateId,
        issuerName: existingIssuerForFilename,
        attachmentName: null,
        templateMap: bulkTemplateMap,
      });
      const uploadResult = await uploadToOneDrive(
        msGraphBulk,
        oneDriveRootBulk,
        clientNameBulk,
        yearBulk,
        mergedFilename,
        mergedBuf,
        filingTypeBulk,
      );
      mergedWebUrl = uploadResult.webUrl;
      mergedItemId = uploadResult.itemId;
    }

    // ---- Step 6: Airtable writes — Drive first, then Airtable (atomicity rule) ----
    // Documents table fields (verified live 2026-05-18): file_url, onedrive_item_id,
    // file_hash. NO file_sha256, file_size, page_count — those live on
    // pending_classifications. Don't try to write them here.
    // Aggregate provenance from all merged PCs. Mirrors single-reassign's doc
    // PATCH (classifications.ts:2279-2292) so admin/UI see the same field set
    // regardless of single vs bulk path.
    const firstClsForDoc = clsRecords[0].fields as Record<string, unknown>;
    const allAttachmentNames = clsRecords
      .map(r => (r.fields as Record<string, unknown>).attachment_name as string)
      .filter(Boolean)
      .join(', ');
    const aiConfFirst = firstClsForDoc.ai_confidence as number | undefined;
    const senderFirst = firstClsForDoc.sender_email as string | undefined;
    const receivedFirst = firstClsForDoc.received_at as string | undefined;
    const docPatchFields: Record<string, unknown> = {
      status: 'Received',
      review_status: 'confirmed',
      reviewed_by: 'Natan',
      reviewed_at: new Date().toISOString(),
      file_url: mergedWebUrl,
      onedrive_item_id: mergedItemId,
      file_hash: mergedHash,
      ai_confidence: aiConfFirst ?? null,
      ai_reason: `[bulk_merge] ${clsRecords.length} attachments merged into ${bulkTemplateId}`,
      source_attachment_name: allAttachmentNames || null,
      source_sender_email: senderFirst || null,
      uploaded_at: receivedFirst || new Date().toISOString(),
    };
    // When admin picked an existing chip and the chip's underlying doc has empty
    // issuer_name (template placeholder leaks `{var}` into the UI), fill it from
    // the chip's displayed (substituted) name so the required-docs list renders
    // properly. Mirrors how single-reassign collects substituted names via
    // _buildDocTemplatePicker.renderVars (script.js:8164+).
    if (bulkNewDocName && bulkTargetDocId) {
      const trimmed = bulkNewDocName.trim();
      const existingIssuer = (existingReceivedDoc?.fields.issuer_name as string) || '';
      const placeholderRe = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;
      if (!existingIssuer || placeholderRe.test(existingIssuer)) {
        docPatchFields.issuer_name = trimmed;
        docPatchFields.issuer_name_en = trimmed;
        docPatchFields.issuer_key = trimmed;
      }
    }
    void mergedSize; // computed for API response only — schema-absent on documents

    if (!bulkDocId) {
      // Create new documents row — derive reportId from first classification (Fix 2: scope-leak fix)
      const reportId = getField((clsRecords[0].fields as Record<string, unknown>).report) as string;
      // When new_doc_name is set (general_doc OR templated pick with vars
      // filled in via the expanded picker), write issuer_name + key + uid so the
      // doc renders the substituted name on admin + portal surfaces. Mirrors
      // single-reassign DL-391 (classifications.ts:1454-1466).
      const docExtraFields = bulkNewDocName ? (() => {
        const trimmed = bulkNewDocName.trim();
        const issuerKey = trimmed.toLowerCase().replace(/[^a-zA-Zא-ת0-9\s]/g, '').replace(/\s+/g, '_');
        const docUid = `${reportId}_${bulkTemplateId.toLowerCase()}_client_${issuerKey}_${Date.now()}`;
        const f: Record<string, unknown> = {
          issuer_name: trimmed,
          issuer_name_en: trimmed,
          issuer_key: trimmed,
          person: 'client',
          document_uid: docUid,
          document_key: docUid,
        };
        if (bulkTemplateId === 'general_doc') f.category = 'general';
        return f;
      })() : {};
      const newDocRow: Record<string, unknown> = {
        type: bulkTemplateId,
        status: 'Received',
        review_status: 'confirmed',
        reviewed_by: 'Natan',
        reviewed_at: new Date().toISOString(),
        file_url: mergedWebUrl,
        onedrive_item_id: mergedItemId,
        file_hash: mergedHash,
        ai_confidence: aiConfFirst ?? null,
        ai_reason: `[bulk_merge] ${clsRecords.length} attachments merged into ${bulkTemplateId}`,
        source_attachment_name: allAttachmentNames || null,
        source_sender_email: senderFirst || null,
        uploaded_at: receivedFirst || new Date().toISOString(),
        ...(reportId ? { report: [reportId] } : {}),
        ...docExtraFields,
      };
      const stripEmpBulk = (obj: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null && v !== ''));
      const createdBulk = await airtable.createRecords(TABLES.DOCUMENTS, [{ fields: stripEmpBulk(newDocRow) }], { typecast: true });
      bulkDocId = createdBulk[0].id;
    } else {
      // PATCH existing doc row — if fails, abort before touching classifications
      try {
        await airtable.updateRecord(TABLES.DOCUMENTS, bulkDocId, docPatchFields);
      } catch (patchErr) {
        logError(c.executionCtx, c.env, {
          endpoint: '/webhook/bulk-merge-classifications',
          category: 'DEPENDENCY',
          error: patchErr as Error,
          details: `CRITICAL: bulk_merge doc PATCH failed for ${bulkDocId}`,
        });
        return c.json({ ok: false, error: 'documents PATCH failed', details: (patchErr as Error).message }, 500);
      }
    }

    // PATCH each pending_classifications row
    for (const rec of clsRecords) {
      try {
        // pending_classifications uses `review_status` not `status` (verified
        // live 2026-05-18). merged_into is a multipleRecordLinks field (created
        // via Schema API on 2026-05-18, fldJ4MsZdxHflXbbf) — must send an array
        // of record IDs, not a bare string.
        // Also overwrite matched_template_id / matched_doc_name on every merged
        // PC so the AI Review "תואם ל" label reflects the admin's chosen target
        // (was: PCs the classifier didn't match showed "לא ידוע" post-merge).
        await airtable.updateRecord(TABLES.CLASSIFICATIONS, rec.id, {
          review_status: 'approved',
          merged_into: [bulkDocId],
          matched_template_id: bulkTemplateId,
          matched_doc_name: bulkTemplateId === 'general_doc' ? (bulkNewDocName || '') : '',
          reviewed_at: new Date().toISOString(),
        }, { typecast: true });
      } catch (clsPatchErr) {
        // Log loudly but continue — partial state is alarmed, not fatal
        logError(c.executionCtx, c.env, {
          endpoint: '/webhook/bulk-merge-classifications',
          category: 'DEPENDENCY',
          error: clsPatchErr as Error,
          details: `CRITICAL: bulk_merge classifications PATCH failed for ${rec.id} → doc ${bulkDocId}`,
        });
      }
    }

    // ---- Step 7: log (PII-safe — IDs and counts only) ----
    logEvent({
      event_type: 'bulk_merge',
      category: 'ADMIN',
      source: 'admin-ui',
      client_id: bulkClientId,
      details: {
        count: orderedIds.length,
        template_id: bulkTemplateId,
        doc_id: bulkDocId,
      },
    });

    invalidateCache(
      c.env.CACHE_KV,
      'cache:documents_non_waived_v2',
      'pending-classifications:annual_report',
      'pending-classifications:capital_statements',
      'pending-classifications:all',
    );

    return c.json({ ok: true, doc_id: bulkDocId, merged_page_count: mergedPageCount });
  } catch (err) {
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/bulk-merge-classifications',
      category: 'INTERNAL',
      error: err as Error,
    });
    return c.json({ ok: false, error: 'Bulk merge failed', details: (err as Error).message }, 500);
  }
});

// =====================================================================
// DL-361: POST /webhook/assign-unidentified
// =====================================================================
// Assign an unidentified inbound email (and all its attachments) to a
// chosen client, OR discard it as junk. The endpoint operates on every
// pending_classifications row whose `email_event` link matches the
// supplied id AND whose client_id is empty (sentinel for unidentified).
//
// action='assign'
//   1. Re-fetch each attachment's bytes from OneDrive.
//   2. Re-classify against the chosen client's Required_Missing docs.
//   3. Upload to the client's OneDrive folder (with DL-355 short_name_he).
//   4. Delete the original file in לקוח לא מזוהה/{year}/.
//   5. PATCH the classification row with new client_id, client_name,
//      report link, matched_template_id, ai_*, file_url, expected_filename.
//   6. Mark email_event Completed + match_method='manual_assignment'.
//
// action='discard'
//   1. Move OneDrive items to לקוח לא מזוהה/ארכיון/.
//   2. PATCH classification rows: review_status=rejected,
//      notification_status=discarded.
//   3. Mark email_event Discarded.
classifications.post('/assign-unidentified', async (c) => {
  const env = c.env;
  const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);
  const clientIp = getClientIp(c.req.raw.headers);

  // ---- Auth ----
  const authHeader = c.req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const tokenResult = await verifyToken(bearer, env.SECRET_KEY);
  if (!tokenResult.valid) {
    logSecurity(c.executionCtx, c.env, airtable, {
      timestamp: new Date().toISOString(),
      event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      severity: 'WARNING',
      actor: 'admin-token',
      actor_ip: clientIp,
      endpoint: '/webhook/assign-unidentified',
      http_status: 401,
      error_message: tokenResult.reason || '',
    });
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  // ---- Parse body ----
  let body: { email_event_id?: string; action?: string; target_client_id?: string };
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'Invalid JSON' }, 400); }

  const { email_event_id, action, target_client_id } = body;
  if (!email_event_id) return c.json({ ok: false, error: 'Missing email_event_id' }, 400);
  if (action !== 'assign' && action !== 'discard') {
    return c.json({ ok: false, error: 'action must be "assign" or "discard"' }, 400);
  }
  if (action === 'assign' && !target_client_id) {
    return c.json({ ok: false, error: 'target_client_id required when action=assign' }, 400);
  }

  try {
    // ---- Fetch unidentified classifications for this email_event ----
    // ARRAYJOIN on a linked-record field returns primary field values (event_key),
    // not record ids — so we filter in-memory by the linked record id instead.
    const allUnidentified = await airtable.listAllRecords(TABLES.CLASSIFICATIONS, {
      filterByFormula: `{client_id} = ''`,
    });
    const allRows = allUnidentified.filter((r) => {
      const ev = (r.fields as any).email_event;
      const evId = Array.isArray(ev) ? ev[0] : ev;
      return evId === email_event_id;
    });

    if (allRows.length === 0) {
      return c.json({ ok: false, error: 'No unidentified rows for this email_event_id' }, 404);
    }

    const msGraph = new MSGraphClient(env, c.executionCtx);

    if (action === 'discard') {
      // ---- Move OneDrive items to ארכיון ----
      let archived = 0;
      for (const row of allRows) {
        const itemId = (row.fields as any).onedrive_item_id as string | undefined;
        if (itemId) {
          await moveFileToArchive(msGraph, itemId);
          archived++;
        }
      }
      // ---- PATCH rows ----
      for (const row of allRows) {
        try {
          await airtable.updateRecord(TABLES.CLASSIFICATIONS, row.id, {
            review_status: 'rejected',
            notification_status: 'discarded',
            ai_reason: 'discarded by office — unidentified email',
          });
        } catch (e) {
          console.error('[assign-unidentified] discard PATCH failed', row.id, (e as Error).message);
        }
      }
      // ---- Update email_event ----
      try {
        await airtable.updateRecord('tblJAPEcSJpzdEBcW', email_event_id, {
          processing_status: 'Discarded',
        });
      } catch (e) {
        console.error('[assign-unidentified] email_event PATCH failed', (e as Error).message);
      }
      // ---- Invalidate KV cache (DL-318) ----
      invalidateCache(
        env.CACHE_KV,
        'pending-classifications:annual_report',
        'pending-classifications:capital_statements',
        'pending-classifications:all',
      );

      logSecurity(c.executionCtx, c.env, airtable, {
        timestamp: new Date().toISOString(),
        event_type: 'INBOUND_DISCARDED',
        severity: 'INFO',
        actor: 'admin-token',
        actor_ip: clientIp,
        endpoint: '/webhook/assign-unidentified',
        http_status: 200,
        details: JSON.stringify({ email_event_id, attachment_count: allRows.length }),
      });

      return c.json({ ok: true, action: 'discarded', attachments_processed: allRows.length, archived });
    }

    // ===== action === 'assign' =====

    // ---- Resolve target client ----
    // target_client_id may be either an Airtable record id (rec...) or a CPA-id (CPA-XXX).
    // Frontend uses CPA-id since that's what dashboard `clientsData` carries.
    let clientRec: { id: string; fields: { name?: string; client_id?: string } } | null = null;
    if (target_client_id!.startsWith('rec')) {
      clientRec = await airtable.getRecord<{ name?: string; client_id?: string }>('tblFFttFScDRZ7Ah5', target_client_id!);
    } else {
      const lookups = await airtable.listAllRecords<{ name?: string; client_id?: string }>('tblFFttFScDRZ7Ah5', {
        filterByFormula: `{client_id} = '${target_client_id!.replace(/'/g, "\\'")}'`,
        fields: ['name', 'client_id'],
        maxRecords: 1,
      } as any);
      if (lookups.length > 0) clientRec = lookups[0];
    }
    if (!clientRec) {
      return c.json({ ok: false, error: 'Client not found' }, 400);
    }
    const clientName = clientRec.fields.name || '';
    const clientId = clientRec.fields.client_id || '';
    if (!clientName || !clientId) {
      return c.json({ ok: false, error: 'Client missing name or client_id' }, 400);
    }

    // ---- Find active report (stages 1-4) ----
    const reports = await airtable.listAllRecords(TABLES.REPORTS, {
      filterByFormula: `AND({client_id} = '${clientId.replace(/'/g, "\\'")}', OR({stage} = 'Send_Questionnaire', {stage} = 'Waiting_For_Answers', {stage} = 'Pending_Approval', {stage} = 'Collecting_Docs', {stage} = 'Review'))`,
      fields: ['report_key', 'year', 'stage', 'client_name', 'filing_type'],
    });
    if (reports.length === 0) {
      return c.json({ ok: false, error: 'Target client has no active report (stages 1-5)' }, 400);
    }
    // Prefer highest year + non-CS by default; CS rows route below
    reports.sort((a, b) => ((b.fields as any).year ?? 0) - ((a.fields as any).year ?? 0));
    const primaryReport = reports[0];
    const primaryReportId = primaryReport.id;
    const primaryYear = String((primaryReport.fields as any).year ?? new Date().getFullYear());
    const primaryFilingType = ((primaryReport.fields as any).filing_type as string) || 'annual_report';
    const primaryReportKey = ((primaryReport.fields as any).report_key as string) || '';

    // ---- Fetch required docs for the report ----
    const requiredDocs = await airtable.listAllRecords(TABLES.DOCUMENTS, {
      filterByFormula: `AND({report_key_lookup} = '${primaryReportKey.replace(/'/g, "\\'")}', {status} = 'Required_Missing')`,
      fields: ['type', 'issuer_name', 'issuer_key', 'person', 'status', 'report_key_lookup', 'expected_filename', 'category'],
    });

    // ---- Build template map for resolveOneDriveFilename + ProcessingContext ----
    const templateRecords = await getCachedOrFetch(env.CACHE_KV, 'cache:templates', 3600,
      () => airtable.listAllRecords(TABLES.TEMPLATES));
    const templateMap = buildTemplateMap(templateRecords);

    const oneDriveRoot = await resolveOneDriveRoot(msGraph);
    const pCtx: ProcessingContext = {
      env,
      ctx: c.executionCtx,
      graph: msGraph,
      airtable,
      messageId: '',
      templateMap,
    };

    let processed = 0;
    let failed = 0;
    const errors: { row_id: string; reason: string }[] = [];

    for (const row of allRows) {
      const f = row.fields as Record<string, any>;
      const oldItemId = f.onedrive_item_id as string;
      const attachmentName = f.attachment_name as string;
      const contentType = (f.attachment_content_type as string) || 'application/octet-stream';
      const size = (f.attachment_size as number) || 0;
      const fileHash = (f.file_hash as string) || '';

      try {
        if (!oldItemId) { errors.push({ row_id: row.id, reason: 'no onedrive_item_id' }); failed++; continue; }

        // ---- Re-download bytes ----
        const fileBytes = await msGraph.getBinary(`/drives/${oneDriveRoot.driveId}/items/${oldItemId}/content`);
        if (!fileBytes || fileBytes.byteLength === 0) {
          errors.push({ row_id: row.id, reason: 'empty file bytes' });
          failed++;
          continue;
        }

        // ---- Build AttachmentInfo ----
        const sha256 = fileHash || await computeSha256(fileBytes);
        const att: AttachmentInfo = {
          id: oldItemId,
          name: attachmentName,
          contentType,
          size,
          content: fileBytes,
          sha256,
        };

        // ---- Re-classify ----
        let classification: ClassificationResult | null = null;
        try {
          classification = await classifyAttachment(pCtx, att, requiredDocs as any, clientName, {
            subject: (f.email_body_text as string) || '',
            bodyPreview: (f.email_body_text as string) || '',
            senderName: (f.sender_name as string) || '',
            senderEmail: (f.sender_email as string) || '',
            fallbackMode: requiredDocs.length === 0,
            filingType: primaryFilingType,
          });
        } catch (e) {
          console.warn('[assign-unidentified] classify failed', attachmentName, (e as Error).message);
        }

        // ---- Resolve filename via DL-355 ----
        const expected = classification?.templateId
          ? resolveOneDriveFilename({
              templateId: classification.templateId,
              issuerName: classification.issuerName,
              attachmentName,
              templateMap,
            })
          : attachmentName;
        const finalName = expected || attachmentName;

        // ---- Upload to client folder ----
        const upload = await uploadToOneDrive(
          msGraph,
          oneDriveRoot,
          clientName,
          primaryYear,
          finalName,
          fileBytes,
          primaryFilingType,
        );

        // ---- Delete original ----
        try {
          await msGraph.delete(`/drives/${oneDriveRoot.driveId}/items/${oldItemId}`);
        } catch (e) {
          console.warn('[assign-unidentified] delete original failed', oldItemId, (e as Error).message);
        }

        // ---- PATCH classification row ----
        const updateFields: Record<string, unknown> = {
          report: [primaryReportId],
          client_name: clientName,
          client_id: clientId,
          year: parseInt(primaryYear, 10),
          file_url: upload.webUrl,
          onedrive_item_id: upload.itemId,
          expected_filename: finalName,
          matched_template_id: classification?.templateId ?? null,
          ai_confidence: classification?.confidence ?? 0,
          ai_reason: classification?.reason ?? 'manually assigned by office',
          issuer_name: classification?.issuerName ?? '',
          issuer_match_quality: classification?.matchQuality ?? null,
          matched_doc_name: classification?.matchedDocName ?? null,
          document: classification?.matchedDocRecordId ? [classification.matchedDocRecordId] : [],
        };
        await airtable.updateRecord(TABLES.CLASSIFICATIONS, row.id, updateFields);

        processed++;
      } catch (e) {
        console.error('[assign-unidentified] row failed', row.id, (e as Error).message);
        errors.push({ row_id: row.id, reason: (e as Error).message });
        failed++;
      }
    }

    // ---- Update email_event ----
    try {
      await airtable.updateRecord('tblJAPEcSJpzdEBcW', email_event_id, {
        processing_status: 'Completed',
        match_method: 'manual_assignment',
      });
    } catch (e) {
      console.error('[assign-unidentified] email_event PATCH failed', (e as Error).message);
    }

    // ---- Invalidate KV cache ----
    invalidateCache(
      env.CACHE_KV,
      'pending-classifications:annual_report',
      'pending-classifications:capital_statements',
      'pending-classifications:all',
    );

    logSecurity(c.executionCtx, c.env, airtable, {
      timestamp: new Date().toISOString(),
      event_type: 'INBOUND_MANUAL_ASSIGN',
      severity: 'INFO',
      actor: 'admin-token',
      actor_ip: clientIp,
      endpoint: '/webhook/assign-unidentified',
      http_status: 200,
      details: JSON.stringify({ email_event_id, target_client_id, processed, failed }),
    });

    return c.json({ ok: true, action: 'assigned', attachments_processed: processed, attachments_failed: failed, errors });
  } catch (err) {
    console.error('[assign-unidentified] fatal', (err as Error).message);
    logError(c.executionCtx, env, {
      endpoint: '/webhook/assign-unidentified',
      error: err as Error,
      details: JSON.stringify({ email_event_id, action }),
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default classifications;
