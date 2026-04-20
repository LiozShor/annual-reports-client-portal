import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { verifyClientToken, generateClientToken } from '../lib/client-token';
import { AirtableClient } from '../lib/airtable';
import { logSecurity, getClientIp } from '../lib/security-log';
import { logError } from '../lib/error-logger';
import type { Env } from '../lib/types';

const router = new Hono<{ Bindings: Env }>();

const TABLES = {
  CLIENTS: 'tblFFttFScDRZ7Ah5',
  REPORTS: 'tbls7m3hmHC4hhQVy',
  PENDING_CLASSIFICATIONS: 'tbloiSDN3rwRcl1ii',
};

const FILING_CONFIG: Record<string, { label_he: string; label_en: string }> = {
  annual_report: { label_he: 'דוח שנתי', label_en: 'Annual Report' },
  capital_statement: { label_he: 'הצהרת הון', label_en: 'Capital Statement' },
};

/** Extract first element from Airtable lookup arrays, or return value as-is. */
const getField = (val: unknown): unknown =>
  Array.isArray(val) ? val[0] : (val || '');

/**
 * GET /webhook/get-client-reports
 *
 * Two auth modes:
 *   Office: ?client_id=CPA-XXX + Authorization: Bearer <admin_token>
 *   Client: ?report_id=recXXX&token=T → validate token, extract client_id from report
 *
 * Returns all reports for the client. Office: all stages. Client: stages 3-7 (docs visible).
 */
router.get('/get-client-reports', async (c) => {
  try {
    const query = c.req.query();
    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
    const clientIp = getClientIp(c.req.raw.headers);

    let clientId = '';
    let clientName = '';
    let mode: 'office' | 'client' = 'office';

    // ---- Determine Auth Mode ----
    if (query.client_id) {
      // Office mode — requires admin bearer token
      mode = 'office';
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
          endpoint: '/webhook/get-client-reports',
          http_status: 401,
          error_message: tokenResult.reason || '',
        });
        return c.json({ ok: false, error: 'Unauthorized' }, 401);
      }

      clientId = query.client_id;
    } else if (query.report_id && query.token) {
      // Client mode — validate client token against the provided report
      mode = 'client';
      const tokenResult = await verifyClientToken(query.report_id, query.token, c.env.CLIENT_SECRET_KEY);

      if (!tokenResult.valid) {
        logSecurity(c.executionCtx, airtable, {
          timestamp: new Date().toISOString(),
          event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
          severity: 'WARNING',
          actor: 'client-token',
          actor_ip: clientIp,
          endpoint: '/webhook/get-client-reports',
          http_status: 200,
          error_message: tokenResult.reason || '',
        });
        return c.json({ ok: false, error: tokenResult.reason });
      }

      // Fetch the report to extract client_id
      const reportRec = await airtable.getRecord(TABLES.REPORTS, query.report_id);
      const rf = reportRec.fields as Record<string, unknown>;
      clientId = String(getField(rf['client_id']) || '');

      if (!clientId) {
        return c.json({ ok: false, error: 'Could not resolve client_id from report' }, 400);
      }
    } else {
      return c.json({ ok: false, error: 'Missing required parameters: client_id or report_id+token' }, 400);
    }

    // ---- Fetch client record (office mode) + all reports in parallel ----
    // Office mode: return all stages (DL-258 shows notes at stages 1-2)
    // Client mode: only stages 3-7 where docs are visible
    const formula = mode === 'office'
      ? `{client_id} = '${clientId}'`
      : `AND({client_id} = '${clientId}', OR({stage} = 'Pending_Approval', {stage} = 'Collecting_Docs', {stage} = 'Review', {stage} = 'Moshe_Review', {stage} = 'Before_Signing'))`;
    const clientRecordPromise = mode === 'office'
      ? airtable.listAllRecords(TABLES.CLIENTS, { filterByFormula: `{client_id}='${clientId}'`, maxRecords: 1 })
      : Promise.resolve([]);
    const [reports, clientRecords] = await Promise.all([
      airtable.listAllRecords(TABLES.REPORTS, { filterByFormula: formula }),
      clientRecordPromise,
    ]);
    const clientRec = clientRecords[0];
    const clientEmail = clientRec ? String(clientRec.fields.email || '') : '';
    const clientCcEmail = clientRec ? String(clientRec.fields.cc_email || '') : '';
    const clientPhone = clientRec ? String(clientRec.fields.phone || '') : '';

    // DL-306: fetch pending AI classifications grouped by report.
    // Filter by client_id + year (direct fields) — Airtable formula ARRAYJOIN({report})
    // returns display names not record IDs, so linked-record FIND is unreliable.
    const pendingByReport = new Map<string, number>();
    if (reports.length > 0) {
      const yearToReportId = new Map<number, string>();
      for (const r of reports) {
        const yr = Number((r.fields as Record<string, unknown>).year) || 0;
        if (yr && !yearToReportId.has(yr)) yearToReportId.set(yr, r.id);
      }
      const pendingFormula = `AND(OR({review_status}='', {review_status}='pending'), {client_id}='${clientId}')`;
      const pendingRecords = await airtable.listAllRecords(TABLES.PENDING_CLASSIFICATIONS, { filterByFormula: pendingFormula });
      for (const p of pendingRecords) {
        const yr = Number((p.fields as Record<string, unknown>).year) || 0;
        const rid = yearToReportId.get(yr);
        if (rid) {
          pendingByReport.set(rid, (pendingByReport.get(rid) || 0) + 1);
        }
      }
    }

    // ---- Build response ----
    const reportItems = await Promise.all(
      reports
        .filter(r => r.id)
        .map(async (r) => {
          const f = r.fields as Record<string, unknown>;
          const filingType = (f['filing_type'] as string) || 'annual_report';
          const ftConfig = FILING_CONFIG[filingType] || FILING_CONFIG.annual_report;

          // Capture client_name from first report if not yet set
          if (!clientName) {
            clientName = String(getField(f['client_name']) || '');
          }

          const item: Record<string, unknown> = {
            report_id: r.id,
            filing_type: filingType,
            label_he: ftConfig.label_he,
            label_en: ftConfig.label_en,
            year: f['year'] || '',
            stage: (f['stage'] as string) || '',
            docs_total: parseInt(String(f['docs_total'])) || 0,
            docs_received: parseInt(String(f['docs_received_count'])) || 0,
            rejected_uploads_log: (f['rejected_uploads_log'] as string) || '',
            queued_send_at: (f['queued_send_at'] as string) || null,
            // DL-306: count of pending AI classifications for this report
            pending_reviews_count: pendingByReport.get(r.id) || 0,
          };

          // Client mode: generate a token for each report
          if (mode === 'client') {
            item.token = await generateClientToken(r.id, c.env.CLIENT_SECRET_KEY);
          }

          return item;
        })
    );

    const result: Record<string, unknown> = {
      ok: true,
      client_id: clientId,
      client_name: clientName,
      reports: reportItems,
    };
    if (mode === 'office') {
      result.client_email = clientEmail;
      result.cc_email = clientCcEmail;
      result.client_phone = clientPhone;
    }
    return c.json(result);
  } catch (err) {
    console.error('[client-reports] Unhandled error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/get-client-reports',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default router;
