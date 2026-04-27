import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { getCachedOrFetch, invalidateCache } from '../lib/cache';
import { MSGraphClient } from '../lib/ms-graph';
import { isOffHours, getNext0800Israel } from '../lib/israel-time';
import { buildCommentEmailHtml, buildCommentEmailSubject } from '../lib/email-html';
import { logError } from '../lib/error-logger';
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
  const q = (c.req.query('q') || '').trim().toLowerCase();
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // DL-273: search mode (q present) returns all years for client-side filtering; normal = by year
  const isSearch = !!q;
  const cacheKey = isSearch
    ? `cache:msg_all_years`
    : `cache:recent_messages:${year}`;
  const cacheTTL = isSearch ? 1800 : 300; // 30 min for search index, 5 min for recent

  const messages = await getCachedOrFetch(
    c.env.CACHE_KV,
    cacheKey,
    cacheTTL,
    async () => {
      const filterByFormula = q
        ? `{client_notes}!=''`
        : `AND({year}=${year},{client_notes}!='')`;

      const records = await airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
        filterByFormula,
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

        // DL-288: Collect ALL office replies per original message (was single-reply map in DL-266)
        const repliesByOriginal = new Map<string, Array<{ id: string; summary: string; date: string }>>();
        for (const note of notes) {
          if (note.type === 'office_reply' && note.reply_to) {
            const key = String(note.reply_to);
            const arr = repliesByOriginal.get(key) || [];
            arr.push({
              id: String(note.id || ''),
              summary: String(note.summary || ''),
              date: String(note.date || ''),
            });
            repliesByOriginal.set(key, arr);
          }
        }
        // Sort each thread oldest-first so UI reads top-to-bottom chronologically
        for (const arr of repliesByOriginal.values()) {
          arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        }

        for (const note of notes) {
          if (note.source !== 'email') continue; // DL-262: dashboard shows client emails
          if (note.hidden_from_dashboard) continue; // DL-263: skip hidden notes
          const replies = repliesByOriginal.get(String(note.id || '')) || [];
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
            replies, // DL-288: array (was `reply: reply || null` — single)
          });
        }
      }

      // Sort by date descending; tiebreaker: numeric timestamp from note id (cn_{Date.now()})
      allMessages.sort((a, b) => {
        const cmp = String(b.date).localeCompare(String(a.date));
        if (cmp !== 0) return cmp;
        const tsA = parseInt(String(a.id).replace('cn_', ''), 10) || 0;
        const tsB = parseInt(String(b.id).replace('cn_', ''), 10) || 0;
        return tsB - tsA;
      });

      return allMessages;
    }
  );

  return c.json({ ok: true, messages });
});

// POST /webhook/admin-send-comment (DL-266)
const REPORTS_TABLE = 'tbls7m3hmHC4hhQVy';
const SENDER = 'reports@moshe-atsits.co.il';

dashboard.post('/admin-send-comment', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7) : '';
  const authResult = await verifyToken(token, c.env.SECRET_KEY);
  if (!authResult.valid) return c.json({ ok: false, error: 'unauthorized' });

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid_json' }); }

  const { report_id, note_id, comment_text } = body as { report_id?: string; note_id?: string; comment_text?: string };
  if (!report_id || !comment_text || typeof comment_text !== 'string' || !comment_text.trim()) {
    return c.json({ ok: false, error: 'report_id and non-empty comment_text are required' });
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  let report: { id: string; fields: Record<string, unknown> };
  try {
    report = await airtable.getRecord(REPORTS_TABLE, report_id);
  } catch {
    return c.json({ ok: false, error: 'report_not_found' });
  }

  const first = (v: unknown) => Array.isArray(v) ? v[0] : v;
  const clientEmail = String(first(report.fields.client_email) || '');
  const clientName = String(first(report.fields.client_name) || 'לקוח');
  const year = String(report.fields.year || new Date().getFullYear());

  if (!clientEmail) {
    return c.json({ ok: false, error: 'no_client_email' });
  }

  const trimmed = comment_text.trim();

  // Find original message text for quoting in email
  const notesRaw = report.fields.client_notes as string | undefined;
  let notes: Array<Record<string, unknown>> = [];
  if (notesRaw) {
    try { notes = JSON.parse(notesRaw); } catch { /* start fresh */ }
  }
  if (!Array.isArray(notes)) notes = [];

  let originalMessageId = '';
  if (note_id) {
    const original = notes.find(n => n.id === note_id);
    if (original) {
      originalMessageId = String(original.message_id || '');
    }
  }

  // Build HTML for both reply and fallback sendMail
  const subject = buildCommentEmailSubject(year);
  const commentHtml = buildCommentEmailHtml({ commentText: trimmed, clientName, year });

  // Build note entry for client_notes
  const parentNote = note_id ? notes.find((n: any) => n.id === note_id) : null;
  const noteEntry = {
    id: 'reply_' + Date.now(),
    date: new Date().toISOString(),
    summary: trimmed,
    source: 'manual' as const,
    type: 'office_reply',
    ...(note_id ? { reply_to: note_id } : {}),
    ...(parentNote?.conversation_id ? { conversation_id: parentNote.conversation_id } : {}),
  };

  notes.push(noteEntry);

  // Save note first (always persists, even if email fails)
  try {
    await airtable.updateRecord(REPORTS_TABLE, report_id, {
      client_notes: JSON.stringify(notes),
    });
    invalidateCache(c.env.CACHE_KV, `cache:recent_messages:${year}`);
  } catch (err) {
    logError(c.executionCtx, c.env, {
      endpoint: 'admin-send-comment',
      error: err as Error,
      category: 'DEPENDENCY',
      details: `Failed to save note for ${report_id}`,
    });
    return c.json({ ok: false, error: 'save_note_failed' });
  }

  try {
    // DL-273: Deferred send via PidTagDeferredSendTime if off-hours
    const graph = new MSGraphClient(c.env, c.executionCtx);
    const offHours = isOffHours();

    if (offHours) {
      const deferredUtc = getNext0800Israel();
      let deferredMessageId: string | null = null;
      if (originalMessageId) {
        try {
          const r = await graph.replyToMessageDeferred(originalMessageId, commentHtml, SENDER, deferredUtc);
          deferredMessageId = r.messageId;
        } catch (replyErr) {
          console.error('[send-comment] replyToMessageDeferred failed, falling back to sendMailDeferred:', (replyErr as Error).message);
        }
      }
      if (!deferredMessageId) {
        const r = await graph.sendMailDeferred(subject, commentHtml, clientEmail, SENDER, deferredUtc);
        deferredMessageId = r.messageId;
      }

      // DL-281: stamp graph_message_id on the note we just saved so the queue
      // view can correlate Outbox messages back to client notes.
      try {
        const lastIdx = notes.length - 1;
        if (lastIdx >= 0 && notes[lastIdx].id === noteEntry.id) {
          notes[lastIdx] = { ...notes[lastIdx], graph_message_id: deferredMessageId };
          await airtable.updateRecord(REPORTS_TABLE, report_id, {
            client_notes: JSON.stringify(notes),
          });
          invalidateCache(c.env.CACHE_KV, `cache:recent_messages:${year}`);
        }
      } catch (stampErr) {
        console.error('[send-comment] failed to stamp graph_message_id on note:', (stampErr as Error).message);
      }

      return c.json({ ok: true, queued: true, scheduled_for: '08:00' });
    }

    // Business hours — send immediately
    let sentViaReply = false;
    if (originalMessageId) {
      try {
        await graph.replyToMessage(originalMessageId, commentHtml, SENDER);
        sentViaReply = true;
      } catch (replyErr) {
        console.error('[send-comment] replyToMessage failed, falling back to sendMail:', (replyErr as Error).message);
      }
    }
    if (!sentViaReply) {
      await graph.sendMail(subject, commentHtml, clientEmail, SENDER);
    }

    return c.json({ ok: true, queued: false });
  } catch (err) {
    logError(c.executionCtx, c.env, {
      endpoint: 'admin-send-comment',
      error: err as Error,
      category: 'DEPENDENCY',
      details: `Note saved but email failed for ${clientEmail}`,
    });
    return c.json({ ok: true, queued: false, email_failed: true });
  }
});

// POST /webhook/admin-comment-preview (DL-288)
// Pure render — no email sent, no Airtable mutation, no KV cache.
dashboard.post('/admin-comment-preview', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7) : '';
  const authResult = await verifyToken(token, c.env.SECRET_KEY);
  if (!authResult.valid) return c.json({ ok: false, error: 'unauthorized' });

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid_json' }); }

  const { report_id, comment_text, client_name: bodyClientName, year: bodyYear } =
    body as { report_id?: string; comment_text?: string; client_name?: string; year?: string };
  if (!report_id) {
    return c.json({ ok: false, error: 'report_id is required' });
  }

  let clientName: string;
  let year: string;

  // Skip Airtable roundtrip when frontend passes client_name + year (fast path)
  if (bodyClientName && bodyYear) {
    clientName = bodyClientName;
    year = bodyYear;
  } else {
    const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
    let report: { id: string; fields: Record<string, unknown> };
    try {
      report = await airtable.getRecord(REPORTS_TABLE, report_id);
    } catch {
      return c.json({ ok: false, error: 'report_not_found' });
    }
    const first = (v: unknown) => Array.isArray(v) ? v[0] : v;
    clientName = String(first(report.fields.client_name) || 'לקוח');
    year = String(report.fields.year || new Date().getFullYear());
  }

  const html = buildCommentEmailHtml({ commentText: comment_text || '', clientName, year });
  const subject = buildCommentEmailSubject(year);

  return c.json({ ok: true, html, subject });
});

// GET /webhook/admin-queued-emails (DL-281)
// Queries Outlook Outbox as source of truth for pending deferred sends,
// joins with Airtable data, returns list of genuinely pending queued emails.
dashboard.get('/admin-queued-emails', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : c.req.query('token') || '';
  const authResult = await verifyToken(token, c.env.SECRET_KEY);
  if (!authResult.valid) return c.json({ ok: false, error: 'unauthorized' });

  const filing_type = c.req.query('filing_type') || 'annual_report';
  const year = c.req.query('year') || String(new Date().getFullYear());

  // Cache Outbox listing for 60s — one Graph call covers many dashboard loads.
  // Short TTL keeps the view fresh; at 08:00 delivery window stale state
  // self-resolves within a minute.
  let outboxIds: Set<string>;
  let outboxById: Map<string, { deferredUtc: string }>;
  try {
    const graph = new MSGraphClient(c.env, c.executionCtx);
    const outbox = await getCachedOrFetch(
      c.env.CACHE_KV,
      `cache:outbox_deferred:${SENDER}`,
      60,
      () => graph.listOutboxDeferred(SENDER),
    );
    outboxIds = new Set(outbox.map(m => m.messageId));
    outboxById = new Map(outbox.map(m => [m.messageId, { deferredUtc: m.deferredUtc }]));
  } catch (err) {
    logError(c.executionCtx, c.env, {
      endpoint: 'admin-queued-emails',
      error: err as Error,
      category: 'DEPENDENCY',
      details: 'Failed to list Outbox deferred messages',
    });
    return c.json({ ok: false, error: 'outbox_unavailable' });
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Pull every report in the active year that has a graph_message_id (set on
  // queueing) OR a non-empty client_notes (might contain queued reply notes).
  // Filter rows in memory by Outbox membership — Outbox is the source of truth.
  const reports = await airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
    filterByFormula: `AND({year}=${year},OR({graph_message_id}!='',{client_notes}!=''))`,
    fields: [
      'client_name', 'filing_type', 'client_is_active',
      'graph_message_id', 'queued_send_at', 'client_notes',
    ],
  });

  const first = (v: unknown) => Array.isArray(v) ? v[0] : v;
  type QueuedRow = {
    report_id: string;
    client_name: string;
    filing_type: string;
    type: 'doc_request' | 'reply' | 'batch_questions';
    queued_at: string;
    scheduled_for: string;
    graph_message_id: string | null;
  };
  const queued: QueuedRow[] = [];

  for (const r of reports) {
    const f = r.fields;
    const rowFilingType = (f.filing_type as string) || 'annual_report';
    if (rowFilingType !== filing_type) continue;

    const isActiveRaw = f.client_is_active;
    const is_active = isActiveRaw === undefined
      ? true
      : (Array.isArray(isActiveRaw) ? (isActiveRaw[0] === true) : (isActiveRaw === true));
    if (!is_active) continue;

    const clientName = String(first(f.client_name) || 'לקוח');

    // Doc-request path: record-level graph_message_id on the report.
    // Outlook Outbox is the single source of truth — records without a matching
    // message in the Outbox are NOT shown (delivered, cancelled, or pre-DL-281
    // legacy records that already went out).
    const reportGraphId = (f.graph_message_id as string | undefined) || '';
    if (reportGraphId && outboxIds.has(reportGraphId)) {
      const queuedSendAt = (f.queued_send_at as string | undefined) || '';
      queued.push({
        report_id: r.id,
        client_name: clientName,
        filing_type: rowFilingType,
        type: 'doc_request',
        queued_at: queuedSendAt || new Date().toISOString(),
        scheduled_for: outboxById.get(reportGraphId)!.deferredUtc,
        graph_message_id: reportGraphId,
      });
    }

    // Reply + batch-questions path: graph_message_id stored inside client_notes JSON entries.
    // DL-281: office_reply notes. DL-333: batch_questions_sent notes (off-hours).
    const notesRaw = f.client_notes as string | undefined;
    if (notesRaw) {
      let notes: Array<Record<string, unknown>> = [];
      try { notes = JSON.parse(notesRaw); } catch { notes = []; }
      if (!Array.isArray(notes)) notes = [];
      for (const n of notes) {
        const gid = n.graph_message_id;
        if (typeof gid !== 'string' || !gid) continue;
        if (!outboxIds.has(gid)) continue;
        const noteType = n.type === 'batch_questions_sent' ? 'batch_questions' : 'reply';
        queued.push({
          report_id: r.id,
          client_name: clientName,
          filing_type: rowFilingType,
          type: noteType,
          queued_at: String(n.date || new Date().toISOString()),
          scheduled_for: outboxById.get(gid)!.deferredUtc,
          graph_message_id: gid,
        });
      }
    }
  }

  queued.sort((a, b) => new Date(a.queued_at).getTime() - new Date(b.queued_at).getTime());

  return c.json({ ok: true, queued });
});

export default dashboard;
