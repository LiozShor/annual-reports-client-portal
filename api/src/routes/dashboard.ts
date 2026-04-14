import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { getCachedOrFetch } from '../lib/cache';
import type { Env } from '../lib/types';

const dashboard = new Hono<{ Bindings: Env }>();

const STAGE_ORDER: Record<string, number> = {
  Send_Questionnaire: 1,
  Waiting_For_Answers: 2,
  Pending_Approval: 3,
  Collecting_Docs: 4,
  Review: 5,
  Moshe_Review: 6,
  Before_Signing: 7,
  Completed: 8,
};

const heCollator = new Intl.Collator('he');

// GET /webhook/admin-dashboard
dashboard.get('/admin-dashboard', async (c) => {
  // Auth: Bearer header or ?token= query
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : c.req.query('token') || '';

  const result = await verifyToken(token, c.env.SECRET_KEY);
  if (!result.valid) {
    return c.json({ ok: false, error: 'unauthorized' });
  }

  const year = c.req.query('year') || String(new Date().getFullYear());
  const filing_type = c.req.query('filing_type');
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  const filters = [`{year}=${year}`];
  if (filing_type) filters.push(`{filing_type}='${filing_type}'`);
  const filterByFormula = `AND(${filters.join(',')})`;

  // Parallel Airtable queries (replaces n8n Merge node)
  // DL-254: Cache available_years in KV (1hr TTL) to avoid full-table scan
  const [reports, yearRecords] = await Promise.all([
    airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
      filterByFormula,
    }),
    getCachedOrFetch(c.env.CACHE_KV, 'cache:available_years', 3600, () =>
      airtable.listAllRecords('tbls7m3hmHC4hhQVy', { fields: ['year'] })
    ),
  ]);

  // Distinct years
  const available_years = [
    ...new Set(yearRecords.map(r => r.fields.year as number).filter(Boolean)),
  ].sort((a, b) => b - a);

  // Single-pass: stats + clients + review queue
  const stats: Record<string, number> = {
    total: reports.length,
    stage1: 0, stage2: 0, stage3: 0, stage4: 0,
    stage5: 0, stage6: 0, stage7: 0, stage8: 0,
    queued_count: 0,
  };

  const clients: Array<Record<string, unknown>> = [];

  for (const report of reports) {
    const f = report.fields;
    const stage = (f.stage as string) || 'Send_Questionnaire';
    const stageNum = STAGE_ORDER[stage] || 0;
    if (stageNum >= 1 && stageNum <= 8) {
      stats['stage' + stageNum]++;
    }

    const queuedSendAt = f.queued_send_at;
    if (queuedSendAt && (Array.isArray(queuedSendAt) ? queuedSendAt[0] : queuedSendAt)) {
      stats.queued_count++;
    }

    // client_is_active: lookup returns [true], [null], true, false, or undefined
    let is_active = true;
    const raw = f.client_is_active;
    if (raw !== undefined) {
      is_active = Array.isArray(raw) ? (raw[0] === true) : (raw === true);
    }

    const getField = (val: unknown) => Array.isArray(val) ? val[0] : (val || '');

    clients.push({
      report_id: report.id,
      client_id: String(getField(f.client_id) || ''),
      name: getField(f.client_name) || 'Unknown',
      email: getField(f.client_email) || '',
      year: f.year,
      stage,
      docs_received: parseInt(String(f.docs_received_count)) || 0,
      docs_total: parseInt(String(f.docs_total)) || 0,
      docs_completed_at: f.docs_completed_at || null,
      is_active,
      notes: f.notes || '',
      filing_type: (f.filing_type as string) || 'annual_report',
      queued_send_at: f.queued_send_at || null,
    });
  }

  // Sort by Hebrew name
  clients.sort((a, b) => heCollator.compare(String(a.name), String(b.name)));

  // Review queue: stage=Review + docs_completed_at + active, FIFO
  const review_queue = clients
    .filter(
      (c) => c.stage === 'Review' && c.docs_completed_at && c.is_active !== false
    )
    .sort(
      (a, b) =>
        new Date(a.docs_completed_at as string).getTime() -
        new Date(b.docs_completed_at as string).getTime()
    );

  stats.review_queue_count = review_queue.length;

  return c.json({
    ok: true,
    stats,
    clients,
    review_queue,
    available_years,
  });
});

// GET /webhook/admin-recent-messages
dashboard.get('/admin-recent-messages', async (c) => {
  // Auth: Bearer header or ?token= query
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : c.req.query('token') || '';

  const result = await verifyToken(token, c.env.SECRET_KEY);
  if (!result.valid) {
    return c.json({ ok: false, error: 'unauthorized' });
  }

  const year = c.req.query('year') || String(new Date().getFullYear());
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  const messages = await getCachedOrFetch(
    c.env.CACHE_KV,
    `cache:recent_messages:${year}`,
    300,
    async () => {
      const records = await airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
        filterByFormula: `AND({year}=${year},{client_notes}!='')`,
        fields: ['client_name', 'client_id', 'client_notes', 'year'],
      });

      const getField = (val: unknown) => Array.isArray(val) ? val[0] : (val || '');

      const allMessages: Array<Record<string, unknown>> = [];

      for (const record of records) {
        const f = record.fields;
        const clientName = String(getField(f.client_name) || 'Unknown');
        const yearVal = f.year;
        const notesRaw = f.client_notes as string | undefined;
        if (!notesRaw) continue;

        let notes: Array<Record<string, unknown>>;
        try {
          notes = JSON.parse(notesRaw);
        } catch {
          continue;
        }

        if (!Array.isArray(notes)) continue;

        const clientId = String(getField(f.client_id) || '');

        for (const note of notes) {
          if (note.source !== 'email') continue; // DL-262: dashboard shows emails only
          if (note.hidden_from_dashboard) continue; // DL-263: skip hidden notes
          allMessages.push({
            id: note.id || '',
            report_id: record.id,
            client_id: clientId,
            client_name: clientName,
            year: yearVal,
            date: note.date || '',
            summary: note.summary || '',
            source: note.source || '',
            sender_email: note.sender_email || '',
            raw_snippet: note.raw_snippet || '',
          });
        }
      }

      // Sort by date descending (ISO strings sort lexicographically), return top 10
      allMessages.sort((a, b) =>
        String(b.date).localeCompare(String(a.date))
      );

      return allMessages.slice(0, 10);
    }
  );

  return c.json({ ok: true, messages });
});

export default dashboard;
