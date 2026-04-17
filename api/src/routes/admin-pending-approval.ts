/**
 * GET /webhook/admin-pending-approval (DL-292; DL-294 redesign)
 *
 * Returns stage-3 (Pending_Approval) reports enriched with:
 *   - questionnaire answers (non-negative only for chips, full for preview)
 *   - doc_chips[]  — flat, template short_name + issuer (raw <b>...</b> HTML)
 *   - doc_groups[] — per-person / per-category (from groupDocsByPerson)
 *   - notes, client_notes, client_questions
 *
 * Auth: Bearer header OR ?token= query param.
 * Query: year, filing_type (annual_report | capital_statement)
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { getCachedOrFetch } from '../lib/cache';
import {
  buildCategoryMap, buildTemplateMap, buildCompanyLinkMap,
  groupDocsByPerson, formatForOfficeMode,
  type DocFields, type ReportContext,
} from '../lib/doc-builder';
import { formatQuestionnaire } from '../lib/format-questionnaire';
import { logError } from '../lib/error-logger';
import type { Env } from '../lib/types';

const adminPendingApproval = new Hono<{ Bindings: Env }>();

const TABLES = {
  REPORTS: 'tbls7m3hmHC4hhQVy',
  DOCUMENTS: 'tblcwptR63skeODPn',
  CATEGORIES: 'tblbn6qzWNfR8uL2b',
  TEMPLATES: 'tblQTsbhC6ZBrhspc',
  COMPANY_LINKS: 'tblDQJvIaEgBw2L6T',
  QUESTIONNAIRES: 'tblxEox8MsbliwTZI',
};

const getField = (val: unknown): unknown =>
  Array.isArray(val) ? val[0] : (val ?? '');

function isNegativeAnswer(value: string): boolean {
  return value === '✗ לא' || value === '✗ No';
}

adminPendingApproval.get('/admin-pending-approval', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : c.req.query('token') || '';

    const result = await verifyToken(token, c.env.SECRET_KEY);
    if (!result.valid) {
      return c.json({ ok: false, error: 'unauthorized' });
    }

    const year = c.req.query('year') || String(new Date().getFullYear());
    const filingType = c.req.query('filing_type') || 'annual_report';
    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

    const [reportRecords, categoryRecords, templateRecords, companyLinkRecords] = await Promise.all([
      airtable.listAllRecords(TABLES.REPORTS, {
        filterByFormula: `AND({year}=${year}, {stage}='Pending_Approval', {client_is_active}=TRUE(), {filing_type}='${filingType}')`,
      }),
      getCachedOrFetch(c.env.CACHE_KV, 'cache:categories', 3600,
        () => airtable.listAllRecords(TABLES.CATEGORIES)),
      getCachedOrFetch(c.env.CACHE_KV, 'cache:templates', 3600,
        () => airtable.listAllRecords(TABLES.TEMPLATES)),
      getCachedOrFetch(c.env.CACHE_KV, 'cache:company-links', 3600,
        () => airtable.listAllRecords(TABLES.COMPANY_LINKS)),
    ]);

    if (reportRecords.length === 0) {
      return c.json({ ok: true, items: [], count: 0 });
    }

    const categoryMap = buildCategoryMap(categoryRecords);
    const templateMap = buildTemplateMap(templateRecords);
    const companyLinks = buildCompanyLinkMap(companyLinkRecords);

    const reportIds = reportRecords.map(r => r.id);

    const idParts = reportIds.map(id => `{report_record_id}='${id}'`);
    const idFormula = idParts.length === 1 ? idParts[0] : `OR(${idParts.join(',')})`;

    const docParts = reportIds.map(id => `FIND('${id}', ARRAYJOIN({report_record_id}))`);
    const docFormula = docParts.length === 1 ? docParts[0] : `OR(${docParts.join(',')})`;

    const [questionnaireRecords, docRecords] = await Promise.all([
      airtable.listAllRecords(TABLES.QUESTIONNAIRES, { filterByFormula: idFormula }),
      airtable.listAllRecords(TABLES.DOCUMENTS, { filterByFormula: docFormula }),
    ]);

    const questionnaireByReport = new Map<string, Record<string, unknown>>();
    for (const q of questionnaireRecords) {
      const rid = q.fields.report_record_id as string;
      if (rid && !questionnaireByReport.has(rid)) {
        questionnaireByReport.set(rid, q.fields as Record<string, unknown>);
      }
    }

    const docsByReport = new Map<string, typeof docRecords>();
    for (const doc of docRecords) {
      const rids = doc.fields.report_record_id;
      const rid = Array.isArray(rids) ? rids[0] : rids;
      if (typeof rid === 'string') {
        if (!docsByReport.has(rid)) docsByReport.set(rid, []);
        docsByReport.get(rid)!.push(doc);
      }
    }

    const items = reportRecords.map(report => {
      const rf = report.fields as Record<string, unknown>;

      const qFields = questionnaireByReport.get(report.id);
      let answers_summary: { label: string; value: string }[] = [];
      let answers_all: { label: string; value: string }[] = [];
      let submitted_at: string | null = null;
      if (qFields) {
        const formatted = formatQuestionnaire(qFields);
        answers_all = formatted.answers;
        answers_summary = formatted.answers.filter(a => !isNegativeAnswer(a.value));
        submitted_at = (qFields['תאריך הגשה'] as string) || null;
      }

      // Build doc chips (flat) — short_name from template, issuer_name as raw HTML
      const reportDocRecords = (docsByReport.get(report.id) || []).filter(d => {
        const s = d.fields.status as string;
        return s !== 'Removed' && s !== 'Waived';
      });

      const doc_chips = reportDocRecords.map(d => {
        const df = d.fields as Record<string, unknown>;
        const templateId = df.type as string | undefined;
        const tmpl = templateId ? templateMap.get(templateId) : undefined;
        const categoryId = df.category as string | undefined;
        const cat = categoryId ? categoryMap.get(categoryId) : undefined;
        return {
          doc_id: d.id,
          template_id: templateId || '',
          short_name_he: tmpl?.short_name_he || tmpl?.name_he || templateId || '',
          issuer_name: (df.issuer_name as string) || '',  // raw <b>...</b> HTML
          category_emoji: cat?.emoji || '📄',
          status: (df.status as string) || 'Required_Missing',
        };
      });

      // Build grouped structure for preview panel — reuse doc-builder pipeline
      const reportCtx: ReportContext = {
        client_name: String(getField(rf.client_name) || ''),
        spouse_name: (rf.spouse_name as string) || '',
        year: String(rf.year || year),
        source_language: (rf.source_language as string) || 'he',
      };
      const docFields: DocFields[] = reportDocRecords
        .filter(d => d.id)
        .map(d => ({ id: d.id, ...d.fields as Record<string, unknown> }));
      const groupedRaw = groupDocsByPerson(docFields, reportCtx, categoryMap, templateMap, companyLinks);
      const doc_groups = formatForOfficeMode(groupedRaw);

      let client_questions: unknown[] = [];
      const rawCQ = rf.client_questions as string | undefined;
      if (rawCQ) {
        try { client_questions = JSON.parse(rawCQ); } catch { /* malformed — ignore */ }
      }

      return {
        report_id: report.id,
        client_id: String(getField(rf.client_id) || ''),
        client_name: reportCtx.client_name,
        spouse_name: reportCtx.spouse_name,
        filing_type: (rf.filing_type as string) || filingType,
        year: Number(rf.year) || Number(year),
        submitted_at,
        answers_summary,
        answers_all,
        doc_chips,
        doc_groups,
        notes: (rf.notes as string) || '',
        client_notes: (rf.client_notes as string) || '',
        client_questions,
        prior_year_placeholder: true,
        docs_first_sent_at: (rf.docs_first_sent_at as string) || null,
      };
    });

    items.sort((a, b) => {
      if (!a.submitted_at && !b.submitted_at) return 0;
      if (!a.submitted_at) return 1;
      if (!b.submitted_at) return -1;
      return new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
    });

    return c.json({ ok: true, items, count: items.length });
  } catch (err) {
    console.error('[admin-pending-approval] Unhandled error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/admin-pending-approval',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default adminPendingApproval;
