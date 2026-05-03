/**
 * DL-365 Phase 3 — Dev-only activity viewer endpoints.
 *
 * All three endpoints require a valid admin Bearer token.
 * The query + lookup endpoints additionally require an X-Dev-Token that was
 * issued by /admin-dev-verify within the last 30 minutes.
 *
 * Endpoints:
 *   POST /webhook/admin-dev-verify     — validate DEV_PASSWORD, return 30-min dev-token
 *   GET  /webhook/admin-dev-activity   — query events (CF Logs API + R2 fallback)
 *   POST /webhook/admin-clients-lookup — resolve client_ids → {name, email_masked}
 */

import { Hono } from 'hono';
import type { Env } from '../lib/types';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { logEvent } from '../lib/activity-logger';
import { maskEmail, hashPhone } from '../lib/pii';

// ─── Constants ───────────────────────────────────────────────────────────────

const REPORTS_TABLE = 'tbls7m3hmHC4hhQVy';
const DEV_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const encoder = new TextEncoder();

// ─── Dev-token helpers ───────────────────────────────────────────────────────

async function signDevToken(secret: string): Promise<string> {
  const payload = JSON.stringify({ exp: Date.now() + DEV_TOKEN_TTL_MS, type: 'dev' });
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(payload) + '.' + sigHex;
}

async function verifyDevToken(token: string, secret: string): Promise<boolean> {
  try {
    if (!token || !token.includes('.')) return false;
    const dotIdx = token.indexOf('.');
    const payloadB64 = token.substring(0, dotIdx);
    const sigHex = token.substring(dotIdx + 1);
    const payload = atob(payloadB64);
    const parsed = JSON.parse(payload) as { exp: number; type: string };
    if (parsed.type !== 'dev' || parsed.exp < Date.now()) return false;
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = new Uint8Array(sigHex.length / 2);
    for (let i = 0; i < sigHex.length; i += 2) {
      sigBytes[i / 2] = parseInt(sigHex.substring(i, i + 2), 16);
    }
    return await crypto.subtle.verify('HMAC', key, sigBytes.buffer, encoder.encode(payload));
  } catch {
    return false;
  }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function requireAdmin(c: { req: { header: (k: string) => string | undefined }; env: Env }): Promise<boolean> {
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const result = await verifyToken(token, c.env.SECRET_KEY);
  return result.valid;
}

async function requireDevToken(c: { req: { header: (k: string) => string | undefined }; env: Env }): Promise<boolean> {
  const devToken = c.req.header('X-Dev-Token') ?? '';
  return verifyDevToken(devToken, c.env.PII_HASH_KEY);
}

// ─── Router ──────────────────────────────────────────────────────────────────

const adminDevActivity = new Hono<{ Bindings: Env }>();

// POST /webhook/admin-dev-verify
adminDevActivity.post('/admin-dev-verify', async (c) => {
  if (!await requireAdmin(c)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { body = {}; }

  const provided = (body as Record<string, unknown>)?.password;
  const actorIp = c.req.header('CF-Connecting-IP') ?? undefined;

  if (typeof provided !== 'string' || provided !== c.env.DEV_PASSWORD) {
    logEvent({
      event_type: 'dev_login',
      category: 'AUTH',
      severity: 'WARN',
      actor: 'admin',
      actor_ip: actorIp,
      endpoint: 'POST /webhook/admin-dev-verify',
      status: 401,
    });
    return c.json({ ok: false, error: 'invalid_password' }, 401);
  }

  const devToken = await signDevToken(c.env.PII_HASH_KEY);

  logEvent({
    event_type: 'dev_login',
    category: 'AUTH',
    severity: 'INFO',
    actor: 'admin',
    actor_ip: actorIp,
    endpoint: 'POST /webhook/admin-dev-verify',
    status: 200,
  });

  return c.json({ ok: true, dev_token: devToken, expires_in: DEV_TOKEN_TTL_MS / 1000 });
});

// GET /webhook/admin-dev-activity
adminDevActivity.get('/admin-dev-activity', async (c) => {
  if (!await requireAdmin(c)) return c.json({ ok: false, error: 'unauthorized' }, 401);
  if (!await requireDevToken(c)) return c.json({ ok: false, error: 'dev_token_required' }, 401);

  const actorIp = c.req.header('CF-Connecting-IP') ?? undefined;
  const since = c.req.query('since') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const until = c.req.query('until') ?? new Date().toISOString();
  const eventType = c.req.query('event_type') ?? undefined;
  const clientId = c.req.query('client_id') ?? undefined;
  const actor = c.req.query('actor') ?? undefined;
  const limitParam = parseInt(c.req.query('limit') ?? '200', 10);
  const limit = isNaN(limitParam) || limitParam < 1 ? 200 : Math.min(limitParam, 500);

  logEvent({
    event_type: 'dev_query',
    category: 'ADMIN',
    severity: 'INFO',
    actor: 'admin',
    actor_ip: actorIp,
    endpoint: 'GET /webhook/admin-dev-activity',
    details: { since, until, event_type: eventType, client_id: clientId, actor, limit },
  });

  const sinceMs = new Date(since).getTime();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const events: unknown[] = [];
  let source: 'hot' | 'r2' | 'unavailable' = 'unavailable';

  // ── Hot-tier: CF Logs Analytics API (last 7d) ────────────────────────────
  if (sinceMs >= sevenDaysAgo && c.env.CF_ACCOUNT_ID && c.env.CF_API_TOKEN) {
    try {
      const cfResult = await queryCfLogsApi(
        c.env.CF_ACCOUNT_ID,
        c.env.CF_API_TOKEN,
        since, until, eventType, clientId, actor, limit
      );
      events.push(...cfResult);
      source = 'hot';
    } catch {
      // fall through to R2
    }
  }

  // ── Archive: R2 NDJSON (>7d or hot-tier unavailable) ────────────────────
  if (source === 'unavailable' || (source === 'hot' && events.length === 0 && sinceMs < sevenDaysAgo)) {
    try {
      const r2Result = await queryR2Archive(
        c.env.ACTIVITY_LOGS,
        since, until, eventType, clientId, actor, limit
      );
      events.push(...r2Result);
      source = 'r2';
    } catch {
      // best-effort
    }
  }

  return c.json({ ok: true, events, source, count: events.length });
});

// POST /webhook/admin-clients-lookup
adminDevActivity.post('/admin-clients-lookup', async (c) => {
  if (!await requireAdmin(c)) return c.json({ ok: false, error: 'unauthorized' }, 401);
  if (!await requireDevToken(c)) return c.json({ ok: false, error: 'dev_token_required' }, 401);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid_json' }, 400); }

  const ids = (body as Record<string, unknown>)?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ ok: true, clients: {} });
  }

  const stringIds = ids.filter((id): id is string => typeof id === 'string').slice(0, 200);
  const recIds = stringIds.filter(id => /^rec[A-Za-z0-9]+$/.test(id));
  const cpaIds = stringIds.filter(id => /^CPA-\d+$/i.test(id));
  if (recIds.length === 0 && cpaIds.length === 0) return c.json({ ok: true, clients: {} });

  const actorIp = c.req.header('CF-Connecting-IP') ?? undefined;
  logEvent({
    event_type: 'dev_lookup',
    category: 'ADMIN',
    severity: 'INFO',
    actor: 'admin',
    actor_ip: actorIp,
    endpoint: 'POST /webhook/admin-clients-lookup',
    details: { rec_count: recIds.length, cpa_count: cpaIds.length },
  });

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  const clients: Record<string, { name: string; email_masked: string; phone_hash: string }> = {};

  const buildClient = async (fields: Record<string, unknown>) => {
    const name = getField(fields.client_name) || '';
    const email = getField(fields.client_email) || '';
    const phone = getField(fields.client_phone) || '';
    return {
      name: String(name),
      email_masked: maskEmail(String(email)),
      phone_hash: phone ? await hashPhone(String(phone)) : '',
    };
  };

  if (recIds.length > 0) {
    const fieldMap = await airtable.batchGetRecords<Record<string, unknown>>(
      REPORTS_TABLE,
      recIds,
      ['client_name', 'client_email', 'client_phone']
    );
    for (const [id, fields] of fieldMap.entries()) {
      clients[id] = await buildClient(fields);
    }
  }

  if (cpaIds.length > 0) {
    const unique = [...new Set(cpaIds.map(id => id.toUpperCase()))];
    for (let i = 0; i < unique.length; i += 10) {
      const chunk = unique.slice(i, i + 10);
      const orParts = chunk.map(id => `UPPER({client_id})='${id.replace(/'/g, "\\'")}'`).join(', ');
      const formula = chunk.length === 1 ? orParts : `OR(${orParts})`;
      const records = await airtable.listAllRecords<Record<string, unknown>>(REPORTS_TABLE, {
        filterByFormula: formula,
        fields: ['client_id', 'client_name', 'client_email', 'client_phone'],
      });
      for (const r of records) {
        const cpa = String(getField(r.fields.client_id) || '').toUpperCase();
        if (cpa) clients[cpa] = await buildClient(r.fields);
      }
    }
    // Also populate the original-case keys the viewer asked for, so Map.get() hits.
    for (const original of cpaIds) {
      const upper = original.toUpperCase();
      if (clients[upper] && !clients[original]) clients[original] = clients[upper];
    }
  }

  return c.json({ ok: true, clients });
});

// ─── CF Logs Analytics helper ────────────────────────────────────────────────

async function queryCfLogsApi(
  accountId: string,
  apiToken: string,
  since: string,
  until: string,
  eventType: string | undefined,
  clientId: string | undefined,
  actor: string | undefined,
  limit: number
): Promise<unknown[]> {
  // Cloudflare Logs Analytics API (Workers Trace Events dataset)
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/logs/received`;
  const params = new URLSearchParams({
    start: since,
    end: until,
    count: String(limit),
    fields: 'Message,TimestampRange,Outcome',
  });

  const res = await fetch(`${url}?${params}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) throw new Error(`CF Logs API error: ${res.status}`);

  const text = await res.text();
  const allEvents: unknown[] = [];

  // Response is NDJSON — one JSON object per line
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      // Each line may have a Message field containing our structured log JSON
      const message = parsed?.Message ?? parsed;
      if (typeof message !== 'string') {
        allEvents.push(parsed);
        continue;
      }
      try {
        const evt = JSON.parse(message) as Record<string, unknown>;
        if (!evt.event_type) continue;
        if (eventType && evt.event_type !== eventType) continue;
        if (clientId && evt.client_id !== clientId) continue;
        if (actor && evt.actor !== actor) continue;
        allEvents.push({ ...evt, _source: 'hot' });
      } catch {
        // not our structured log format
      }
    } catch {
      // skip malformed line
    }
  }

  return allEvents;
}

// ─── R2 archive helper ───────────────────────────────────────────────────────

async function queryR2Archive(
  bucket: R2Bucket,
  since: string,
  until: string,
  eventType: string | undefined,
  clientId: string | undefined,
  actor: string | undefined,
  limit: number
): Promise<unknown[]> {
  const sinceDate = new Date(since);
  const untilDate = new Date(until);

  // Build list of day-prefixes to scan
  const prefixes: string[] = [];
  const cursor = new Date(sinceDate);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= untilDate && prefixes.length < 30) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cursor.getUTCDate()).padStart(2, '0');
    prefixes.push(`${y}-${m}-${d}/`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const allEvents: unknown[] = [];
  let objectCount = 0;

  for (const prefix of prefixes) {
    if (allEvents.length >= limit) break;
    const listed = await bucket.list({ prefix, limit: 100 });
    for (const obj of listed.objects) {
      if (allEvents.length >= limit) break;
      if (objectCount++ > 200) break; // CPU budget cap
      try {
        const r2Obj = await bucket.get(obj.key);
        if (!r2Obj) continue;

        const isGzip = obj.key.endsWith('.gz');
        let text: string;
        if (isGzip) {
          const compressed = await r2Obj.arrayBuffer();
          const ds = new DecompressionStream('gzip');
          const writer = ds.writable.getWriter();
          writer.write(compressed);
          writer.close();
          const reader = ds.readable.getReader();
          const chunks: Uint8Array[] = [];
          let done = false;
          while (!done) {
            const { value, done: d } = await reader.read();
            if (d) { done = true; break; }
            if (value) chunks.push(value);
          }
          const total = chunks.reduce((s, c) => s + c.length, 0);
          const combined = new Uint8Array(total);
          let off = 0;
          for (const chunk of chunks) { combined.set(chunk, off); off += chunk.length; }
          text = new TextDecoder().decode(combined);
        } else {
          text = await r2Obj.text();
        }

        for (const line of text.split('\n')) {
          if (allEvents.length >= limit) break;
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed) as Record<string, unknown>;
            if (!evt.event_type) continue;
            const ts = evt.ts as string | undefined;
            if (ts) {
              const evtMs = new Date(ts).getTime();
              if (evtMs < sinceDate.getTime() || evtMs > untilDate.getTime()) continue;
            }
            if (eventType && evt.event_type !== eventType) continue;
            if (clientId && evt.client_id !== clientId) continue;
            if (actor && evt.actor !== actor) continue;
            allEvents.push({ ...evt, _source: 'r2' });
          } catch { /* skip */ }
        }
      } catch { /* skip bad object */ }
    }
  }

  return allEvents;
}

// ─── Field accessor ──────────────────────────────────────────────────────────

function getField(val: unknown): string {
  if (Array.isArray(val)) return String(val[0] ?? '');
  if (val === null || val === undefined) return '';
  return String(val);
}

export default adminDevActivity;
