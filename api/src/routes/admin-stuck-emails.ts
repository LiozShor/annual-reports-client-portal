/**
 * DL-417 — Admin endpoint for stuck inbound email_events.
 *
 * GET /webhook/admin-stuck-emails?bucket=all|stuck|action-required|terminal&since=30d&limit=200
 *
 * Buckets:
 *   stuck            — Failed | Detected (real bugs / pipeline aborts)
 *   action-required  — NeedsHuman | PasswordReply (surface in AI-Review tab)
 *   terminal         — Bounced | Discarded (intentional terminal failures)
 *
 * Auth: admin Bearer token (same pattern as other /webhook/admin-* routes).
 * Read-only — does no Airtable writes and never hits R2 (per-request CPU budget).
 */

import { Hono } from 'hono';
import type { Env } from '../lib/types';
import { verifyToken } from '../lib/token';
import { AirtableClient, type AirtableRecord } from '../lib/airtable';
import { TABLES } from '../lib/inbound/types';

const BUCKETS: Record<string, Set<string>> = {
  stuck: new Set(['Failed', 'Detected']),
  'action-required': new Set(['NeedsHuman', 'PasswordReply']),
  terminal: new Set(['Bounced', 'Discarded']),
};

type EmailEventFields = {
  source_message_id?: string;
  source_internet_message_id?: string;
  received_at?: string;
  processing_status?: string;
  sender_email?: string;
  subject?: string;
  error_message?: string;
  last_error_step?: string;
  match_method?: string;
  report?: string[];
  pending_classifications?: string[];
  document?: string[];
  // DL-420: partial-failure counters. Auto-created by inbound on first PATCH
  // (typecast). Until Airtable confirms the field exists in the schema, the
  // listAllRecords call below MUST NOT reference them in `fields:[]` or it
  // 422s — we read them post-fetch via `unknown` cast.
};

function parseSinceDays(s: string | undefined): number {
  if (!s) return 30;
  const m = String(s).match(/^(\d+)(h|d)$/);
  if (!m) return 30;
  const n = parseInt(m[1], 10);
  return m[2] === 'h' ? n / 24 : n;
}

type Bucket = 'stuck' | 'action-required' | 'terminal' | 'unknown' | 'partial-failure';

function bucketOf(status: string | undefined): Bucket {
  if (!status) return 'stuck';
  if (BUCKETS.stuck.has(status)) return 'stuck';
  if (BUCKETS['action-required'].has(status)) return 'action-required';
  if (BUCKETS.terminal.has(status)) return 'terminal';
  return 'unknown';
}

async function requireAdmin(c: { req: { header: (k: string) => string | undefined }; env: Env }): Promise<boolean> {
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const result = await verifyToken(token, c.env.SECRET_KEY);
  return result.valid;
}

const adminStuckEmails = new Hono<{ Bindings: Env }>();

adminStuckEmails.get('/admin-stuck-emails', async (c) => {
  if (!await requireAdmin(c)) return c.json({ ok: false, error: 'unauthorized' }, 401);

  const bucketParam = c.req.query('bucket') ?? 'all';
  const sinceDays = parseSinceDays(c.req.query('since'));
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10) || 200, 500);

  const sinceIso = new Date(Date.now() - sinceDays * 86400000).toISOString();

  // Airtable formula: anything not Completed, within the time window.
  // OR(processing_status = '', NOT(... = 'Completed')) covers null/empty too.
  const formula = `AND(OR({processing_status}='',NOT({processing_status}='Completed')),OR({received_at}='',IS_AFTER({received_at},'${sinceIso}')))`;

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // DL-420: omit `fields:[]` so we transparently pick up `attachments_failed_count` +
  // `failed_attachments` once inbound's first failure-typecast PATCH creates them.
  // Per memory feedback_airtable_typecast_field_existence we must NOT reference
  // these in filterByFormula or `fields:[]` until Airtable confirms existence.
  let records: AirtableRecord<EmailEventFields>[];
  try {
    records = await airtable.listAllRecords<EmailEventFields>(TABLES.EMAIL_EVENTS, {
      filterByFormula: formula,
      pageSize: 100,
      maxRecords: limit,
      sort: [{ field: 'received_at', direction: 'desc' }],
    });
  } catch (e) {
    return c.json({ ok: false, error: `airtable_query_failed: ${(e as Error).message.slice(0, 200)}` }, 500);
  }

  // DL-420: also surface Completed emails that have partial-failure markers.
  // Wrapped in try/catch — if the typecast fields haven't been autocreated yet
  // (no inbound failure has happened post-DL-420 deploy), Airtable 422s and we
  // skip silently. Once the first failure lands, this query starts returning rows.
  try {
    const completedWithFailures = await airtable.listAllRecords<EmailEventFields>(TABLES.EMAIL_EVENTS, {
      filterByFormula: `AND({processing_status}='Completed',{attachments_failed_count}>0,OR({received_at}='',IS_AFTER({received_at},'${sinceIso}')))`,
      pageSize: 100,
      maxRecords: limit,
      sort: [{ field: 'received_at', direction: 'desc' }],
    });
    const seen = new Set(records.map((r) => r.id));
    for (const r of completedWithFailures) {
      if (!seen.has(r.id)) records.push(r);
    }
  } catch {
    // Typecast field not yet in schema — first inbound failure post-deploy creates it.
  }

  const counts = { stuck: 0, 'action-required': 0, terminal: 0, unknown: 0, 'partial-failure': 0 };
  const rows: Array<{
    id: string;
    bucket: string;
    status: string;
    received_at: string;
    age_hours: number | null;
    sender_email: string;
    subject: string;
    has_pending_classifications: boolean;
    has_matched_document: boolean;
    has_linked_report: boolean;
    error_message: string;
    last_error_step: string;
    match_method: string;
    airtable_url: string;
    /** DL-420 */
    attachments_failed_count: number;
    failed_attachments: string;
  }> = [];

  const now = Date.now();

  for (const rec of records) {
    const f = rec.fields as EmailEventFields & {
      attachments_failed_count?: number;
      failed_attachments?: string;
    };
    const failedCount = typeof f.attachments_failed_count === 'number' ? f.attachments_failed_count : 0;
    // DL-420: Completed emails with partial failures get their own bucket so the
    // widget shows them separately from full pipeline aborts.
    const isCompletedWithFailures = f.processing_status === 'Completed' && failedCount > 0;
    const bkt = isCompletedWithFailures ? 'partial-failure' : bucketOf(f.processing_status);
    (counts as Record<string, number>)[bkt]++;

    if (bucketParam !== 'all' && bkt !== bucketParam) continue;

    const receivedMs = f.received_at ? new Date(f.received_at).getTime() : NaN;
    const ageHours = isFinite(receivedMs) ? Math.round((now - receivedMs) / 3.6e6) : null;

    rows.push({
      id: rec.id,
      bucket: bkt,
      status: f.processing_status || '(null)',
      received_at: f.received_at || '',
      age_hours: ageHours,
      sender_email: f.sender_email || '',
      subject: f.subject || '',
      has_pending_classifications: Array.isArray(f.pending_classifications) && f.pending_classifications.length > 0,
      has_matched_document: Array.isArray(f.document) && f.document.length > 0,
      has_linked_report: Array.isArray(f.report) && f.report.length > 0,
      error_message: (f.error_message || '').slice(0, 500),
      last_error_step: f.last_error_step || '',
      match_method: f.match_method || '',
      airtable_url: `https://airtable.com/${c.env.AIRTABLE_BASE_ID}/${TABLES.EMAIL_EVENTS}/${rec.id}`,
      attachments_failed_count: failedCount,
      failed_attachments: (f.failed_attachments || '').slice(0, 1000),
    });
  }

  return c.json({
    ok: true,
    bucket: bucketParam,
    since_days: sinceDays,
    counts,
    total: records.length,
    rows,
  });
});

export default adminStuckEmails;
