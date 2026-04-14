import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { verifyClientToken } from '../lib/client-token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { logSecurity, getClientIp } from '../lib/security-log';
import {
  buildCategoryMap, buildTemplateMap, buildCompanyLinkMap,
  groupDocsByPerson, filterForClientMode, formatForOfficeMode,
  type DocFields, type ReportContext, type DocGroup,
} from '../lib/doc-builder';
import { getCachedOrFetch } from '../lib/cache';
import { logError } from '../lib/error-logger';
import type { Env } from '../lib/types';

const documents = new Hono<{ Bindings: Env }>();

const TABLES = {
  REPORTS: 'tbls7m3hmHC4hhQVy',
  DOCUMENTS: 'tblcwptR63skeODPn',
  CATEGORIES: 'tblbn6qzWNfR8uL2b',
  TEMPLATES: 'tblQTsbhC6ZBrhspc',
  COMPANY_LINKS: 'tblDQJvIaEgBw2L6T',
};

const FILING_CONFIG: Record<string, { label_he: string; label_en: string }> = {
  annual_report: { label_he: 'דוח שנתי', label_en: 'Annual Report' },
  capital_statement: { label_he: 'הצהרת הון', label_en: 'Capital Statement' },
};

/** Extract first element from Airtable lookup arrays, or return value as-is. */
const getField = (val: unknown): unknown =>
  Array.isArray(val) ? val[0] : (val || '');

/** Collect unique onedrive_item_id values from nested groups (max limit). */
function collectItemIds(groups: DocGroup[], max: number): string[] {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const cat of group.categories) {
      for (const doc of cat.docs) {
        const itemId = doc['onedrive_item_id'] as string | undefined;
        if (itemId && ids.size < max) ids.add(itemId);
      }
    }
  }
  return Array.from(ids);
}

/** Patch resolved URLs into doc groups and optionally strip onedrive_item_id. */
function patchUrls(
  groups: DocGroup[],
  urlMap: Map<string, { webUrl?: string; downloadUrl?: string }>,
  stripItemId: boolean,
): void {
  for (const group of groups) {
    for (const cat of group.categories) {
      for (const doc of cat.docs) {
        const itemId = doc['onedrive_item_id'] as string | undefined;
        if (itemId && urlMap.has(itemId)) {
          const resolved = urlMap.get(itemId)!;
          if (resolved.webUrl) doc['file_url'] = resolved.webUrl;
          if (resolved.downloadUrl) doc['download_url'] = resolved.downloadUrl;
        }
        if (stripItemId) delete doc['onedrive_item_id'];
      }
    }
  }
}

/** Count non-Waived/non-Removed docs across groups. */
function countActiveDocs(groups: DocGroup[]): number {
  let count = 0;
  for (const group of groups) {
    for (const cat of group.categories) {
      for (const doc of cat.docs) {
        const status = doc['status'] as string | undefined;
        if (status !== 'Waived' && status !== 'Removed') count++;
      }
    }
  }
  return count;
}

/** Convert company link map to plain object. */
function companyLinksToObject(map: Map<string, string>): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [k, v] of map) obj[k] = v;
  return obj;
}

// GET /webhook/get-client-documents
documents.get('/get-client-documents', async (c) => {
  try {
    const query = c.req.query();
    const mode = query.mode || 'client';
    const reportId = query.report_id;

    if (!reportId) {
      return c.json({ ok: false, error: 'Missing report_id' }, 400);
    }

    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
    const clientIp = getClientIp(c.req.raw.headers);

    // ---- Authentication ----
    if (mode === 'office') {
      const authHeader = c.req.header('Authorization') || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const tokenResult = await verifyToken(bearerToken, c.env.SECRET_KEY);

      if (!tokenResult.valid) {
        logSecurity(c.executionCtx, airtable, {
          timestamp: new Date().toISOString(),
          event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
          severity: 'WARNING',
          actor: 'admin-token',
          actor_ip: clientIp,
          endpoint: '/webhook/get-client-documents',
          http_status: 401,
          error_message: tokenResult.reason || '',
        });
        return c.json({ ok: false, error: 'Unauthorized' }, 401);
      }
    } else {
      // Client mode
      const token = query.token || '';
      const tokenResult = await verifyClientToken(reportId, token, c.env.CLIENT_SECRET_KEY);

      if (!tokenResult.valid) {
        logSecurity(c.executionCtx, airtable, {
          timestamp: new Date().toISOString(),
          event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
          severity: 'WARNING',
          actor: 'client-token',
          actor_ip: clientIp,
          endpoint: '/webhook/get-client-documents',
          http_status: 200,
          error_message: tokenResult.reason || '',
        });
        return c.json({ ok: false, error: tokenResult.reason });
      }
    }

    // ---- Parallel Airtable Queries (categories/templates/links cached in KV) ----
    let reportRec;
    try {
      reportRec = await airtable.getRecord(TABLES.REPORTS, reportId);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('404') || msg.includes('NOT_FOUND')) {
        return c.json({ ok: false, error: 'Report not found' }, 404);
      }
      throw err;
    }

    const [docRecords, categoryRecords, templateRecords, companyLinkRecords] = await Promise.all([
      airtable.listAllRecords(TABLES.DOCUMENTS, {
        filterByFormula: `FIND('${reportId}', ARRAYJOIN({report_record_id}))`,
      }),
      getCachedOrFetch(c.env.CACHE_KV, 'cache:categories', 3600,
        () => airtable.listAllRecords(TABLES.CATEGORIES)),
      getCachedOrFetch(c.env.CACHE_KV, 'cache:templates', 3600,
        () => airtable.listAllRecords(TABLES.TEMPLATES)),
      getCachedOrFetch(c.env.CACHE_KV, 'cache:company-links', 3600,
        () => airtable.listAllRecords(TABLES.COMPANY_LINKS)),
    ]);

    // ---- Build Lookup Maps ----
    const categoryMap = buildCategoryMap(categoryRecords);
    const templateMap = buildTemplateMap(templateRecords);
    const companyLinks = buildCompanyLinkMap(companyLinkRecords);

    // ---- Convert Doc Records ----
    const docs: DocFields[] = docRecords
      .filter(r => r.id)
      .map(r => ({
        id: r.id,
        ...r.fields as Record<string, unknown>,
      }));

    // ---- Build Report Context ----
    const rf = reportRec.fields as Record<string, unknown>;
    const report: ReportContext = {
      client_name: getField(rf['client_name']) as string,
      spouse_name: (rf['spouse_name'] as string) || '',
      year: String(rf['year'] || ''),
      source_language: (rf['source_language'] as string) || 'he',
    };

    // ---- Group Documents ----
    const groups = groupDocsByPerson(docs, report, categoryMap, templateMap, companyLinks);

    // ---- MS Graph Batch URL Resolution (non-fatal) ----
    const itemIds = collectItemIds(groups, 20);
    let urlMap = new Map<string, { webUrl?: string; downloadUrl?: string }>();

    if (itemIds.length > 0) {
      try {
        const graph = new MSGraphClient(c.env, c.executionCtx);
        urlMap = await graph.batchResolveUrls(itemIds);
      } catch (err) {
        console.error('[documents] MS Graph batch resolve failed:', (err as Error).message);
        // Non-fatal — docs just won't have resolved URLs
      }
    }

    // ---- Build Response by Mode ----
    const companyLinksObj = companyLinksToObject(companyLinks);

    if (mode === 'office') {
      // Patch URLs but keep onedrive_item_id
      patchUrls(groups, urlMap, false);
      const officeGroups = formatForOfficeMode(groups);
      const documentCount = docs.length;

      const officeFilingType = (rf['filing_type'] as string) || 'annual_report';

      return c.json({
        ok: true,
        client_id: String(getField(rf['client_id']) || ''),
        report_id: reportId,
        filing_type: officeFilingType,
        report: {
          year: report.year,
          client_name: report.client_name,
          spouse_name: report.spouse_name,
          source_language: report.source_language,
          stage: (rf['stage'] as string) || '',
          client_id: String(getField(rf['client_id']) || ''),
          filing_type: officeFilingType,
          report_id: reportId,
        },
        stage: (rf['stage'] as string) || '',
        docs_first_sent_at: (rf['docs_first_sent_at'] as string) || '',
        queued_send_at: (rf['queued_send_at'] as string) || null,
        year: report.year,
        client_name: report.client_name,
        spouse_name: report.spouse_name,
        groups: officeGroups,
        document_count: documentCount,
        client_questions: (rf['client_questions'] as string) || '',
        notes: (rf['notes'] as string) || '',
        client_notes: (rf['client_notes'] as string) || '',
        templates: templateRecords
          .filter(r => r.id)
          .map(r => {
            const f = r.fields as Record<string, unknown>;
            return {
              template_id: f['template_id'] || '',
              name_he: f['name_he'] || '',
              name_en: f['name_en'] || '',
              category: f['category'] || '',
              scope: f['scope'] || '',
              variables: typeof f['variables'] === 'string'
                ? f['variables'].split(',').map((v: string) => v.trim()).filter(Boolean)
                : (f['variables'] || []),
              filing_type: (f['filing_type'] as string) || '',
            };
          }),
        categories_list: categoryRecords
          .filter(r => r.id)
          .map(r => {
            const f = r.fields as Record<string, unknown>;
            return {
              id: f['category_id'] || r.id,
              emoji: f['emoji'] || '',
              name_he: f['name_he'] || '',
            };
          }),
        company_links: companyLinksObj,
      });
    }

    // ---- Client Mode ----
    // Patch URLs and strip onedrive_item_id
    patchUrls(groups, urlMap, true);
    const clientGroups = filterForClientMode(groups);
    const documentCount = countActiveDocs(groups);

    const filingType = (rf['filing_type'] as string) || 'annual_report';
    const ftConfig = FILING_CONFIG[filingType] || FILING_CONFIG.annual_report;

    return c.json({
      ok: true,
      report: {
        year: report.year,
        client_name: report.client_name,
        spouse_name: report.spouse_name,
        source_language: report.source_language,
        stage: (rf['stage'] as string) || '',
        filing_type: filingType,
        filing_type_label_he: ftConfig.label_he,
        filing_type_label_en: ftConfig.label_en,
      },
      groups: clientGroups,
      document_count: documentCount,
      company_links: companyLinksObj,
    });
  } catch (err) {
    console.error('[documents] Unhandled error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/get-client-documents',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default documents;
