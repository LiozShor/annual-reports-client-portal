/**
 * Phase 5 — /admin-reminders endpoint (DL-174)
 *
 * All actions via POST with `action` field in body.
 * Hybrid: send_now fires n8n async, everything else handled directly.
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { logSecurity, getClientIp } from '../lib/security-log';
import { getCachedOrFetch, invalidateCache } from '../lib/cache';
import { logError } from '../lib/error-logger';
import type { Env } from '../lib/types';

const reminders = new Hono<{ Bindings: Env }>();

const TABLES = {
  REPORTS: 'tbls7m3hmHC4hhQVy',
  CONFIG: 'tblqHOkDnvb95YL3O',
};

/** Build reminder filter with optional filing_type scope */
function buildReminderFilter(filingType?: string): string {
  const base = `OR({stage}='Waiting_For_Answers', {stage}='Collecting_Docs'), {client_is_active}=TRUE()`;
  if (filingType) {
    return `AND(${base}, {filing_type}='${filingType}')`;
  }
  return `AND(${base})`;
}

const REMINDER_FIELDS = [
  'client_name', 'client_email', 'stage', 'year',
  'reminder_count', 'reminder_max', 'reminder_next_date',
  'reminder_suppress', 'last_reminder_sent_at', 'reminder_history',
  'docs_total', 'docs_received_count', 'docs_missing_count',
  'pending_classifications',
  'filing_type',
];

interface ReminderItem {
  report_id: string;
  name: string;
  email: string;
  stage: string;
  year: string;
  reminder_type: string;
  reminder_count: number;
  reminder_max: number | null;
  reminder_next_date: string | null;
  reminder_suppress: string | null;
  last_reminder_sent_at: string | null;
  docs_total: number;
  docs_received: number;
  docs_missing_count: number;
  pending_count: number;
  history: unknown[];
  _exhausted?: boolean;
}

/** Build the reminder list response from Airtable records + config */
function buildReminderResponse(
  records: { id: string; fields: Record<string, unknown> }[],
  defaultMax: number | null,
  statsOnly: boolean
): Record<string, unknown> {
  // Deduplicate by record ID
  const seen = new Set<string>();
  const deduped = records.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const mapped: ReminderItem[] = deduped.map(r => {
    const f = r.fields;
    const reminderMax = f.reminder_max != null ? Number(f.reminder_max) : null;
    const effectiveMax = reminderMax != null ? reminderMax : defaultMax;
    const reminderCount = Number(f.reminder_count) || 0;
    const isExhausted = effectiveMax != null && reminderCount >= effectiveMax && !f.reminder_suppress;

    let history: unknown[] = [];
    try {
      if (f.reminder_history) history = JSON.parse(f.reminder_history as string);
      if (!Array.isArray(history)) history = [];
    } catch { history = []; }

    return {
      report_id: r.id,
      name: (Array.isArray(f.client_name) ? f.client_name[0] : f.client_name) as string || '',
      email: (f.client_email as string) || '',
      stage: (f.stage as string) || '',
      year: (f.year as string) || '',
      reminder_type: f.stage === 'Waiting_For_Answers' ? 'A' : 'B',
      reminder_count: reminderCount,
      reminder_max: reminderMax,
      reminder_next_date: (f.reminder_next_date as string) || null,
      reminder_suppress: (f.reminder_suppress as string) || null,
      last_reminder_sent_at: (f.last_reminder_sent_at as string) || null,
      docs_total: Number(f.docs_total) || 0,
      docs_received: Number(f.docs_received_count) || 0,
      docs_missing_count: Number(f.docs_missing_count) || 0,
      pending_count: Array.isArray(f.pending_classifications) ? (f.pending_classifications as string[]).length : 0,
      history,
      _exhausted: isExhausted,
    };
  });

  const stats = {
    total: mapped.length,
    scheduled: mapped.filter(r => r.reminder_next_date && !r.reminder_suppress && !r._exhausted).length,
    due_this_week: mapped.filter(r => r.reminder_next_date && r.reminder_next_date <= weekFromNow && !r.reminder_suppress && !r._exhausted).length,
    suppressed: mapped.filter(r => !!r.reminder_suppress).length,
    exhausted: mapped.filter(r => r._exhausted).length,
    pending_review: mapped.filter(r => r.pending_count > 0 && r.stage === 'Collecting_Docs').length,
  };

  if (statsOnly) {
    return { ok: true, stats, items: [], default_max: defaultMax };
  }

  // Strip internal _exhausted flag before returning
  const items = mapped.map(({ _exhausted, ...rest }) => rest);
  return { ok: true, stats, items, default_max: defaultMax };
}

/** Fetch default_max from config table (cached in KV for 1h) */
async function fetchDefaultMax(airtable: AirtableClient, kv?: KVNamespace): Promise<number | null> {
  const fetcher = async () => {
    const configs = await airtable.listAllRecords(TABLES.CONFIG, {
      filterByFormula: `{config_key}='reminder_default_max'`,
    });
    for (const c of configs) {
      const val = c.fields.config_value;
      if (val !== '' && val !== null && val !== undefined) {
        const parsed = parseInt(String(val));
        if (!isNaN(parsed)) return parsed;
      }
    }
    return null;
  };

  if (kv) {
    return getCachedOrFetch(kv, 'cache:reminder-config', 3600, fetcher);
  }
  return fetcher();
}

/** Fire n8n internal webhook asynchronously */
function fireN8n(
  ctx: ExecutionContext,
  env: Env,
  path: string,
  payload: Record<string, unknown>
): void {
  const url = `https://liozshor.app.n8n.cloud/webhook${path}`;
  ctx.waitUntil(
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': env.N8N_INTERNAL_KEY,
      },
      body: JSON.stringify(payload),
    }).catch(err => {
      console.error(`[n8n-webhook] ${path} failed:`, err.message);
    })
  );
}

// POST /webhook/admin-reminders
reminders.post('/admin-reminders', async (c) => {
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  const clientIp = getClientIp(c.req.raw.headers);

  try {
    const body = await c.req.json() as Record<string, unknown>;
    const token = (body.token as string) || '';

    // Auth
    const tokenResult = await verifyToken(token, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      logSecurity(c.executionCtx, airtable, {
        timestamp: new Date().toISOString(),
        event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        severity: 'WARNING',
        actor: 'admin-token',
        actor_ip: clientIp,
        endpoint: '/webhook/admin-reminders',
        http_status: 401,
        error_message: tokenResult.reason || '',
      });
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    const action = (body.action as string) || 'list';
    const reportIds = (body.report_ids as string[]) || [];
    const value = body.value as string | number | undefined;
    const filingType = (body.filing_type as string) || 'annual_report';

    // ---- LIST ----
    if (action === 'list') {
      const [records, defaultMax] = await Promise.all([
        airtable.listAllRecords(TABLES.REPORTS, {
          filterByFormula: buildReminderFilter(filingType),
          fields: REMINDER_FIELDS,
        }),
        fetchDefaultMax(airtable, c.env.CACHE_KV),
      ]);
      const statsOnly = body.stats_only === true || body.stats_only === '1';
      return c.json(buildReminderResponse(records, defaultMax, statsOnly));
    }

    // ---- UPDATE_CONFIGS (batch) ----
    if (action === 'update_configs') {
      const configs = body.configs as Record<string, unknown> | undefined;
      if (!configs || Object.keys(configs).length === 0) {
        return c.json({ ok: false, error: 'No configs provided' }, 400);
      }

      const upsertRecords = Object.entries(configs).map(([key, val]) => ({
        fields: { config_key: key, config_value: val !== undefined ? String(val) : '' },
      }));

      await airtable.upsertRecords(TABLES.CONFIG, upsertRecords, ['config_key']);
      invalidateCache(c.env.CACHE_KV, 'cache:reminder-config');

      // Re-fetch list to return refreshed data (bypasses cache since we just invalidated)
      const [records, defaultMax] = await Promise.all([
        airtable.listAllRecords(TABLES.REPORTS, {
          filterByFormula: buildReminderFilter(filingType),
          fields: REMINDER_FIELDS,
        }),
        fetchDefaultMax(airtable, c.env.CACHE_KV),
      ]);
      return c.json(buildReminderResponse(records, defaultMax, false));
    }

    // ---- UPDATE_CONFIG (single) ----
    if (action === 'update_config') {
      const configKey = body.config_key as string;
      const configValue = body.config_value;
      if (!configKey) return c.json({ ok: false, error: 'No config_key provided' }, 400);

      await airtable.upsertRecords(
        TABLES.CONFIG,
        [{ fields: { config_key: configKey, config_value: configValue !== undefined ? String(configValue) : '' } }],
        ['config_key']
      );
      invalidateCache(c.env.CACHE_KV, 'cache:reminder-config');

      // Re-fetch list (bypasses cache since we just invalidated)
      const [records, defaultMax] = await Promise.all([
        airtable.listAllRecords(TABLES.REPORTS, {
          filterByFormula: buildReminderFilter(filingType),
          fields: REMINDER_FIELDS,
        }),
        fetchDefaultMax(airtable, c.env.CACHE_KV),
      ]);
      return c.json(buildReminderResponse(records, defaultMax, false));
    }

    // ---- SEND_NOW (hybrid → fire n8n async) ----
    if (action === 'send_now') {
      if (!reportIds.length) return c.json({ ok: false, error: 'No report_ids provided' }, 400);

      // Check for warnings before sending (pending classifications + recent sends)
      const orClauses = reportIds.map(id => `RECORD_ID()='${id}'`).join(',');
      const warnRecords = await airtable.listAllRecords(TABLES.REPORTS, {
        filterByFormula: `OR(${orClauses})`,
        fields: ['client_name', 'stage', 'pending_classifications', 'last_reminder_sent_at'],
      });

      const forceOverride = body.force_override === true;

      // Check for warnings (pending classifications + recent sends) unless force_override
      if (!forceOverride) {
        // Group warnings per client
        const warningsByClient: Record<string, string[]> = {};
        for (const r of warnRecords) {
          const f = r.fields;
          const name = (Array.isArray(f.client_name) ? f.client_name[0] : f.client_name) as string || '';
          const clientWarns: string[] = [];
          const pending = f.pending_classifications as string[] | undefined;
          if (pending && pending.length > 0 && f.stage === 'Collecting_Docs') {
            clientWarns.push(`${pending.length} מסמכים ממתינים לסיווג`);
          }
          const lastSent = f.last_reminder_sent_at as string;
          if (lastSent) {
            const hoursSince = (Date.now() - new Date(lastSent).getTime()) / 3600000;
            if (hoursSince < 24) {
              const hoursAgo = Math.floor(hoursSince);
              const timeStr = hoursAgo < 1 ? 'פחות משעה' : `${hoursAgo} שעות`;
              clientWarns.push(`תזכורת נשלחה לפני ${timeStr}`);
            }
          }
          if (clientWarns.length > 0) {
            warningsByClient[name] = clientWarns;
          }
        }
        const warnings = Object.entries(warningsByClient).map(
          ([name, warns]) => `<b>${name}</b>: ${warns.join(' · ')}`
        );

        // If warnings found, return them without sending — frontend will ask for confirmation
        if (warnings.length > 0) {
          return c.json({ ok: true, warning: warnings.join('<br>'), report_ids: reportIds });
        }
      }

      // Clear suppress for selected reports before sending
      const updates = reportIds.map(id => ({
        id,
        fields: { reminder_suppress: null as unknown } as Record<string, unknown>,
      }));

      // Batch update in chunks of 10
      for (let i = 0; i < updates.length; i += 10) {
        await airtable.batchUpdate(TABLES.REPORTS, updates.slice(i, i + 10));
      }

      // Fire n8n webhook to send the email
      fireN8n(c.executionCtx, c.env, '/send-reminder-manual', {
        token: '',
        action: 'send_now',
        report_ids: reportIds,
        default_max: body.default_max ?? null,
        force_override: true,
      });

      // Re-fetch list so frontend can update the table
      const [refreshedRecords, refreshedMax] = await Promise.all([
        airtable.listAllRecords(TABLES.REPORTS, {
          filterByFormula: buildReminderFilter(filingType),
          fields: REMINDER_FIELDS,
        }),
        fetchDefaultMax(airtable, c.env.CACHE_KV),
      ]);
      return c.json(buildReminderResponse(refreshedRecords, refreshedMax, false));
    }

    // ---- FIELD UPDATE ACTIONS (suppress, unsuppress, change_date, set_max) ----
    if (!reportIds.length) return c.json({ ok: false, error: 'No report_ids provided' }, 400);

    const updates: { id: string; fields: Record<string, unknown> }[] = [];

    for (const rid of reportIds) {
      const fields: Record<string, unknown> = {};

      switch (action) {
        case 'suppress_this_month':
          fields.reminder_suppress = 'this_month';
          break;
        case 'suppress_forever':
          fields.reminder_suppress = 'forever';
          break;
        case 'unsuppress':
          fields.reminder_suppress = null;
          fields.reminder_count = 0;
          break;
        case 'change_date':
          if (!value) return c.json({ ok: false, error: 'No date value' }, 400);
          fields.reminder_next_date = String(value);
          break;
        case 'set_max':
          if (value === null || value === 'null' || value === '') {
            fields.reminder_max = null;
          } else {
            const parsed = parseInt(String(value));
            if (isNaN(parsed) || parsed < 1) return c.json({ ok: false, error: 'Invalid max value' }, 400);
            fields.reminder_max = parsed;
          }
          break;
        default:
          return c.json({ ok: false, error: `Unknown action: ${action}` }, 400);
      }

      updates.push({ id: rid, fields });
    }

    // Batch update in chunks of 10
    for (let i = 0; i < updates.length; i += 10) {
      await airtable.batchUpdate(TABLES.REPORTS, updates.slice(i, i + 10));
    }

    // Re-fetch list so frontend can update the table
    const [refreshedRecords, refreshedMax] = await Promise.all([
      airtable.listAllRecords(TABLES.REPORTS, {
        filterByFormula: buildReminderFilter(filingType),
        fields: REMINDER_FIELDS,
      }),
      fetchDefaultMax(airtable, c.env.CACHE_KV),
    ]);
    return c.json(buildReminderResponse(refreshedRecords, refreshedMax, false));

  } catch (err) {
    console.error('[reminders] Error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/reminders',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default reminders;
