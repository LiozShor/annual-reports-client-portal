/**
 * POST /webhook/events — activity-event ingestion endpoint.
 *
 * Accepts single ActivityEventInput or a batched `{ events: ActivityEventInput[] }`.
 * Auth: admin Bearer token | X-N8N-Key header | client HMAC Bearer token.
 * Body size cap: 64 KB.  Batch cap: 50 events.
 *
 * The endpoint MUST NOT throw to the caller — telemetry is best-effort.
 */

import { Hono } from 'hono';
import type { Env } from '../lib/types';
import {
  logEvent,
  type ActivityEventInput,
  type EventCategory,
  type EventSource,
} from '../lib/activity-logger';
import { verifyToken } from '../lib/token';
import { verifyClientToken } from '../lib/client-token';
import { timingSafeEqual } from '../lib/crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 64 * 1024; // 64 KB
const MAX_BATCH_SIZE = 50;
const EVENT_TYPE_RE = /^[a-zA-Z0-9_]{1,64}$/;

const VALID_CATEGORIES: ReadonlySet<string> = new Set<EventCategory>([
  'AUTH',
  'INBOUND',
  'AI',
  'ADMIN',
  'CLIENT',
  'EMAIL',
  'WORKFLOW',
  'ERROR',
]);

// ─── Router ──────────────────────────────────────────────────────────────────

const events = new Hono<{ Bindings: Env }>();

events.post('/events', async (c) => {
  try {
    // ── 1. Body size guard (fast-path before parsing) ──────────────────────
    const contentLengthHeader = c.req.header('Content-Length');
    if (contentLengthHeader !== undefined) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
        return c.json({ ok: false, error: 'payload_too_large' }, 400);
      }
    }

    // ── 2. Parse body ──────────────────────────────────────────────────────
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid_json' }, 400);
    }

    // Post-parse size check (Content-Length may be absent, e.g. chunked)
    const bodyText = JSON.stringify(rawBody);
    if (bodyText.length > MAX_BODY_BYTES) {
      return c.json({ ok: false, error: 'payload_too_large' }, 400);
    }

    // ── 3. Authentication ──────────────────────────────────────────────────
    let authenticatedSource: EventSource | null = null;

    const authHeader = c.req.header('Authorization') ?? '';
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

    const n8nKey = c.req.header('X-N8N-Key') ?? '';

    // Mode A: n8n internal key (X-N8N-Key header)
    if (n8nKey && timingSafeEqual(n8nKey, c.env.N8N_INTERNAL_KEY)) {
      authenticatedSource = 'n8n';
    }

    // Mode B: admin Bearer token
    if (authenticatedSource === null && bearerToken) {
      const adminResult = await verifyToken(bearerToken, c.env.SECRET_KEY);
      if (adminResult.valid) {
        authenticatedSource = 'admin-ui';
      }
    }

    // Mode C: client HMAC Bearer token
    // verifyClientToken requires a reportId; we attempt to derive it from the
    // body's client_id field (the Airtable record ID that serves as the portal
    // token scope).  If absent the check is skipped.
    if (authenticatedSource === null && bearerToken) {
      const candidateId = deriveClientId(rawBody);
      if (candidateId) {
        const clientResult = await verifyClientToken(
          candidateId,
          bearerToken,
          c.env.CLIENT_SECRET_KEY
        );
        if (clientResult.valid) {
          authenticatedSource = 'client-portal';
        }
      }
    }

    if (authenticatedSource === null) {
      // Do NOT log the request body here — PII risk.
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    // ── 4. Collect event(s) from body ──────────────────────────────────────
    const rawEvents: unknown[] = collectEvents(rawBody);

    if (rawEvents.length > MAX_BATCH_SIZE) {
      return c.json({ ok: false, error: 'batch_too_large' }, 400);
    }

    // ── 5. Process each event ──────────────────────────────────────────────
    const actorIp = c.req.header('CF-Connecting-IP') ?? undefined;
    let accepted = 0;
    let rejected = 0;

    for (const raw of rawEvents) {
      if (!isPlainObject(raw)) {
        rejected++;
        continue;
      }

      // 5a. Whitelist: event_type
      const eventType = raw['event_type'];
      if (typeof eventType !== 'string' || !EVENT_TYPE_RE.test(eventType)) {
        rejected++;
        continue;
      }

      // 5b. Whitelist: category
      let category: EventCategory;
      const rawCategory = raw['category'];
      let extraDetails: Record<string, unknown> = {};
      if (typeof rawCategory === 'string' && VALID_CATEGORIES.has(rawCategory)) {
        category = rawCategory as EventCategory;
      } else {
        category = 'ADMIN';
        extraDetails = { _invalid_category: rawCategory };
      }

      // 5c. Move client-supplied endpoint into details.origin_endpoint
      const originEndpoint =
        typeof raw['endpoint'] === 'string' ? raw['endpoint'] : undefined;

      // 5d. Merge caller details with our injected fields
      const callerDetails: Record<string, unknown> =
        isPlainObject(raw['details'])
          ? { ...(raw['details'] as Record<string, unknown>) }
          : {};
      const mergedDetails: Record<string, unknown> = {
        ...callerDetails,
        ...extraDetails,
        ...(originEndpoint !== undefined ? { origin_endpoint: originEndpoint } : {}),
      };

      // 5e. Build stamped input — authoritative fields override whatever the
      //     client sent; we strip `endpoint` so logEvent receives ours.
      const stamped: ActivityEventInput = {
        // Passthrough safe fields from raw
        event_type: eventType,
        category,
        ...(typeof raw['severity'] === 'string'
          ? { severity: raw['severity'] as ActivityEventInput['severity'] }
          : {}),
        ...(typeof raw['request_id'] === 'string'
          ? { request_id: raw['request_id'] }
          : {}),
        ...(typeof raw['actor'] === 'string' ? { actor: raw['actor'] } : {}),
        ...(typeof raw['client_id'] === 'string'
          ? { client_id: raw['client_id'] }
          : {}),
        ...(typeof raw['duration_ms'] === 'number'
          ? { duration_ms: raw['duration_ms'] }
          : {}),
        ...(typeof raw['status'] === 'number'
          ? { status: raw['status'] }
          : {}),
        ...(raw['error'] !== undefined ? { error: raw['error'] as ActivityEventInput['error'] } : {}),
        // Stamp authoritative fields (client cannot override these)
        source: authenticatedSource,
        actor_ip: actorIp,
        endpoint: 'POST /webhook/events',
        // Merged details (may include origin_endpoint + _invalid_category)
        details: Object.keys(mergedDetails).length > 0 ? mergedDetails : undefined,
      };

      logEvent(stamped);
      accepted++;
    }

    return c.json({ ok: true, accepted, rejected });
  } catch {
    // Best-effort: never surface internal errors to the caller.
    return c.json({ ok: true, accepted: 0, rejected: 0 });
  }
});

// ─── Private helpers ─────────────────────────────────────────────────────────

/** Normalise body to an array of raw event objects. */
function collectEvents(body: unknown): unknown[] {
  if (isPlainObject(body)) {
    const batchKey = body['events'];
    if (Array.isArray(batchKey)) {
      return batchKey;
    }
    // Single-event object
    return [body];
  }
  if (Array.isArray(body)) {
    return body;
  }
  return [];
}

/** Attempt to derive a client_id from the body for client-token verification. */
function deriveClientId(body: unknown): string | null {
  if (isPlainObject(body)) {
    // Single-event path
    if (typeof body['client_id'] === 'string' && body['client_id']) {
      return body['client_id'] as string;
    }
    // Batch path — use first event's client_id
    if (Array.isArray(body['events'])) {
      const first = body['events'][0];
      if (isPlainObject(first) && typeof first['client_id'] === 'string') {
        return first['client_id'] as string;
      }
    }
  }
  return null;
}

/** Type-guard: plain object (not array, not null). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export default events;
