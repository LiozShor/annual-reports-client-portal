import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { generateClientToken } from '../lib/client-token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { logSecurity, getClientIp } from '../lib/security-log';
import { getCachedOrFetch, invalidateCache } from '../lib/cache';
import { calcReminderNextDate } from '../lib/reminders';
import { buildClientEmailHtml, buildClientEmailSubject } from '../lib/email-html';
import { logError } from '../lib/error-logger';
import { isOffHours, getNext0800Israel } from '../lib/israel-time';
import { checkAutoAdvanceToReview } from '../lib/auto-advance';
import type { Env } from '../lib/types';
import type { DocItem, CategoryInfo, ClientEmailParams, RejectedUpload } from '../lib/email-html';

const approveAndSend = new Hono<{ Bindings: Env }>();

const FRONTEND_BASE = 'https://docs.moshe-atsits.com';
const SENDER = 'reports@moshe-atsits.co.il';

const TABLES = {
  REPORTS: 'tbls7m3hmHC4hhQVy',
  DOCUMENTS: 'tblcwptR63skeODPn',
  CATEGORIES: 'tblbn6qzWNfR8uL2b',
};

function first(val: unknown): string {
  if (Array.isArray(val)) return (val[0] ?? '') as string;
  return (val ?? '') as string;
}

function generateApprovalToken(reportId: string, secret: string): string {
  const str = reportId + ':' + secret;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

approveAndSend.get('/approve-and-send', async (c) => {
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  const clientIp = getClientIp(c.req.raw.headers);
  const reportId = c.req.query('report_id') || '';
  const respondJson = c.req.query('respond') === 'json';

  const errorResponse = (message: string, status: number = 400) => {
    if (respondJson) return c.json({ ok: false, error: message }, status as any);
    const url = `${FRONTEND_BASE}/approve-confirm.html?report_id=${reportId}&result=error`;
    return c.redirect(url, 302);
  };

  try {
    // Step 1: Auth
    const authHeader = c.req.header('Authorization') || '';
    let authed = false;

    if (authHeader.startsWith('Bearer ')) {
      const tokenResult = await verifyToken(authHeader.slice(7), c.env.SECRET_KEY);
      if (!tokenResult.valid) {
        logSecurity(c.executionCtx, airtable, {
          timestamp: new Date().toISOString(),
          event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
          severity: 'WARNING',
          actor: 'admin-token',
          actor_ip: clientIp,
          endpoint: '/webhook/approve-and-send',
          http_status: 401,
          error_message: tokenResult.reason || '',
        });
        return c.json({ ok: false, error: 'INVALID_TOKEN' }, 401);
      }
      authed = true;
    } else {
      const hashToken = c.req.query('token') || '';
      if (!reportId || !hashToken) {
        return errorResponse('INVALID_TOKEN', 401);
      }
      const expected = generateApprovalToken(reportId, c.env.APPROVAL_SECRET);
      if (hashToken !== expected) {
        logSecurity(c.executionCtx, airtable, {
          timestamp: new Date().toISOString(),
          event_type: 'TOKEN_INVALID',
          severity: 'WARNING',
          actor: 'approval-hash',
          actor_ip: clientIp,
          endpoint: '/webhook/approve-and-send',
          http_status: 401,
          error_message: 'Hash mismatch',
        });
        return errorResponse('INVALID_TOKEN', 401);
      }
      authed = true;
    }

    if (!reportId) return errorResponse('Missing report_id');

    // Step 2: Check confirm — redirect to confirmation page if not confirmed
    const confirm = c.req.query('confirm');
    if (confirm !== '1') {
      const report = await airtable.getRecord(TABLES.REPORTS, reportId);
      const docsFirstSent = first(report.fields.docs_first_sent_at);
      let redirectUrl = `${FRONTEND_BASE}/approve-confirm.html?report_id=${reportId}&token=${c.req.query('token') || ''}`;
      if (docsFirstSent) {
        redirectUrl += `&warning=already_sent&sent_at=${encodeURIComponent(docsFirstSent)}`;
      }
      return c.redirect(redirectUrl, 302);
    }

    // Step 3: Fetch data
    const [report, docsResult, categories] = await Promise.all([
      airtable.getRecord(TABLES.REPORTS, reportId),
      airtable.listRecords(TABLES.DOCUMENTS, {
        filterByFormula: `AND(FIND('${reportId}', ARRAYJOIN({report_record_id})), {status}='Required_Missing')`,
        fields: ['type', 'person', 'category', 'issuer_name', 'issuer_name_en', 'status'],
      }),
      getCachedOrFetch(c.env.CACHE_KV, 'cache:categories', 3600,
        () => airtable.listAllRecords(TABLES.CATEGORIES, {
          fields: ['category_id', 'name_he', 'name_en', 'emoji', 'sort_order'],
        }),
      ),
    ]);

    // Step 4: Build email
    const clientName = first(report.fields.client_name);
    const spouseName = first(report.fields.spouse_name);
    const clientEmail = first(report.fields.client_email);
    const year = first(report.fields.year);
    const language = first(report.fields.source_language) || 'he';
    const filingType = first(report.fields.filing_type) || 'annual_report';

    let questions: Array<{ text: string; answer?: string }> | undefined;
    const questionsRaw = first(report.fields.client_questions);
    if (questionsRaw) {
      try { questions = JSON.parse(questionsRaw); } catch { /* ignore */ }
    }

    let rejectedUploads: RejectedUpload[] | undefined;
    const rejectedUploadsRaw = first(report.fields.rejected_uploads_log);
    if (rejectedUploadsRaw) {
      try {
        const parsed = JSON.parse(rejectedUploadsRaw);
        if (Array.isArray(parsed)) rejectedUploads = parsed as RejectedUpload[];
      } catch { /* ignore — missing/malformed field renders nothing */ }
    }

    const clientToken = await generateClientToken(reportId, c.env.CLIENT_SECRET_KEY);

    const sortedCategories: CategoryInfo[] = categories.map((r) => ({
      category_id: first(r.fields.category_id),
      name_he: first(r.fields.name_he),
      name_en: first(r.fields.name_en),
      emoji: first(r.fields.emoji),
      sort_order: Number(first(r.fields.sort_order)) || 0,
    }));

    const documents: DocItem[] = docsResult.records.map((r) => ({
      type: first(r.fields.type),
      person: first(r.fields.person),
      category: first(r.fields.category),
      issuer_name: first(r.fields.issuer_name),
      issuer_name_en: first(r.fields.issuer_name_en),
      status: first(r.fields.status),
    }));

    const emailParams: ClientEmailParams = {
      clientName, spouseName, year, language, reportId,
      documents, sortedCategories, clientToken, questions, filingType, rejectedUploads,
    };

    const subject = buildClientEmailSubject(emailParams);
    const html = buildClientEmailHtml(emailParams);

    if (!clientEmail) return errorResponse('No client email on report');

    // Compute existingFirstSent early — needed by both queue and normal paths
    const existingFirstSent = first(report.fields.docs_first_sent_at);

    // Step 5: Send email — deferred if off-hours (DL-273: PidTagDeferredSendTime)
    const graph = new MSGraphClient(c.env, c.executionCtx);
    const offHours = isOffHours();
    if (offHours) {
      const deferredUtc = getNext0800Israel();
      await graph.sendMailDeferred(subject, html, clientEmail, SENDER, deferredUtc);
    } else {
      await graph.sendMail(subject, html, clientEmail, SENDER);
    }

    // Step 6: Update Airtable — stage advances immediately regardless of deferred send
    const now = new Date().toISOString();

    // DL-267: If 0 docs to send, advance straight to Review
    const targetStage = documents.length === 0 ? 'Review' : 'Collecting_Docs';
    const stageFields: Record<string, unknown> = {
      stage: targetStage,
      last_progress_check_at: now,
      docs_first_sent_at: existingFirstSent || now,
      queued_send_at: offHours ? now : null,
    };
    if (targetStage === 'Collecting_Docs') {
      stageFields.reminder_next_date = calcReminderNextDate();
      stageFields.reminder_count = 0;
      stageFields.last_reminder_sent_at = null;
    } else {
      // Review — clear reminders, set completion timestamp
      stageFields.docs_completed_at = now;
      stageFields.reminder_next_date = null;
      stageFields.reminder_count = null;
      stageFields.last_reminder_sent_at = null;
    }
    await airtable.updateRecord(TABLES.REPORTS, reportId, stageFields);

    // DL-254: Invalidate documents cache after approve changes doc statuses
    invalidateCache(c.env.CACHE_KV, 'cache:documents_non_waived');

    // Step 7: Respond
    if (offHours) {
      if (respondJson) return c.json({ ok: true, queued: true, scheduled_for: '08:00' });
      return c.redirect(`${FRONTEND_BASE}/approve-confirm.html?report_id=${reportId}&result=queued`, 302);
    }
    if (respondJson) return c.json({ ok: true, stage: targetStage });
    return c.redirect(`${FRONTEND_BASE}/approve-confirm.html?report_id=${reportId}&result=success`, 302);

  } catch (err) {
    console.error('[approve-and-send] CAUGHT ERROR:', (err as Error).message, (err as Error).stack);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/approve-and-send',
      error: err as Error,
    });
    return errorResponse((err as Error).message, 500);
  }
});

export default approveAndSend;
